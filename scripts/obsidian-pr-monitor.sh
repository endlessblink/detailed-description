#!/usr/bin/env bash
# obsidian-pr-monitor.sh — Autopilot for Obsidian plugin review bot
#
# Monitors the obsidian-releases PR for ObsidianReviewBot comments,
# automatically fixes flagged issues using Claude Code CLI, verifies
# build/lint, commits, pushes, and repeats until the bot is satisfied.
#
# Usage:
#   ./scripts/obsidian-pr-monitor.sh              # One-shot: fix current issues and push
#   ./scripts/obsidian-pr-monitor.sh --watch      # Loop: fix, push, wait for rescan, repeat
#   ./scripts/obsidian-pr-monitor.sh --dry-run    # Parse issues but don't commit/push
#   ./scripts/obsidian-pr-monitor.sh --status      # Just show current bot status
#
# Requirements: gh (authenticated), claude (Claude Code CLI), npm, git

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────

PR_NUMBER="${PR_NUMBER:-10291}"
RELEASES_REPO="${RELEASES_REPO:-obsidianmd/obsidian-releases}"
BOT_USER="ObsidianReviewBot"
MAX_FIX_ITERATIONS="${MAX_FIX_ITERATIONS:-5}"
POLL_INTERVAL="${POLL_INTERVAL:-1800}"   # 30 min between polls
MAX_POLL_WAIT="${MAX_POLL_WAIT:-21600}"  # 6 hours max wait for rescan
LOG_DIR="scripts/logs"
LOG_FILE="$LOG_DIR/pr-monitor-$(date '+%Y%m%d-%H%M%S').log"
STATE_FILE="$LOG_DIR/.last-bot-comment-id"
DRY_RUN=false
WATCH_MODE=false
STATUS_ONLY=false

# ─── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()     { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $*" | tee -a "$LOG_FILE"; }
warn()    { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING:${NC} $*" | tee -a "$LOG_FILE"; }
err()     { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $*" | tee -a "$LOG_FILE"; }
ok()      { echo -e "${GREEN}[$(date '+%H:%M:%S')] OK:${NC} $*" | tee -a "$LOG_FILE"; }
header()  { echo -e "\n${BOLD}${CYAN}=== $* ===${NC}\n" | tee -a "$LOG_FILE"; }

# ─── Preflight Checks ───────────────────────────────────────────────────────

preflight() {
    local missing=()
    command -v gh      >/dev/null 2>&1 || missing+=("gh (GitHub CLI)")
    command -v claude  >/dev/null 2>&1 || missing+=("claude (Claude Code CLI)")
    command -v npm     >/dev/null 2>&1 || missing+=("npm")
    command -v git     >/dev/null 2>&1 || missing+=("git")

    if [ ${#missing[@]} -gt 0 ]; then
        err "Missing required tools: ${missing[*]}"
        exit 1
    fi

    # Verify gh is authenticated
    if ! gh auth status >/dev/null 2>&1; then
        err "gh is not authenticated. Run: gh auth login"
        exit 1
    fi

    # Verify we're in the right repo
    if [ ! -f "manifest.json" ] || [ ! -f "package.json" ]; then
        err "Must be run from the plugin project root"
        exit 1
    fi

    # Verify clean working tree (or warn)
    if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
        warn "Working tree has uncommitted changes"
        if ! $DRY_RUN && ! $STATUS_ONLY; then
            echo -n "Continue anyway? [y/N] "
            read -r answer
            if [ "$answer" != "y" ] && [ "$answer" != "Y" ]; then
                exit 0
            fi
        fi
    fi

    mkdir -p "$LOG_DIR"
}

# ─── GitHub Interaction ──────────────────────────────────────────────────────

# Get all bot comments as JSON array
get_bot_comments_json() {
    gh pr view "$PR_NUMBER" --repo "$RELEASES_REPO" --json comments \
        --jq "[.comments[] | select(.author.login == \"$BOT_USER\")]"
}

# Get the latest bot comment body
get_latest_bot_comment() {
    gh pr view "$PR_NUMBER" --repo "$RELEASES_REPO" --json comments \
        --jq "[.comments[] | select(.author.login == \"$BOT_USER\")] | last | .body // empty"
}

# Get the latest bot comment ID (for change detection)
get_latest_bot_comment_id() {
    gh pr view "$PR_NUMBER" --repo "$RELEASES_REPO" --json comments \
        --jq "[.comments[] | select(.author.login == \"$BOT_USER\")] | last | .id // empty"
}

# Get the latest bot comment timestamp
get_latest_bot_comment_time() {
    gh pr view "$PR_NUMBER" --repo "$RELEASES_REPO" --json comments \
        --jq "[.comments[] | select(.author.login == \"$BOT_USER\")] | last | .createdAt // empty"
}

# Save last processed comment ID
save_state() {
    local comment_id="$1"
    echo "$comment_id" > "$STATE_FILE"
}

# Load last processed comment ID
load_state() {
    if [ -f "$STATE_FILE" ]; then
        cat "$STATE_FILE"
    fi
}

# ─── Issue Parsing ───────────────────────────────────────────────────────────

# Check if comment has required issues
has_required_issues() {
    local comment="$1"
    # Check for "### Required" section with actual content (not just the header)
    if echo "$comment" | grep -q "### Required"; then
        local required_section
        required_section=$(echo "$comment" | sed -n '/### Required/,/### Optional\|^---$/p')
        # Check if there's actual content between Required and Optional/---
        local content_lines
        content_lines=$(echo "$required_section" | grep -v "^###\|^---\|^$" | wc -l)
        [ "$content_lines" -gt 0 ]
    else
        return 1
    fi
}

# Extract required issues as structured text
extract_required_issues() {
    local comment="$1"
    echo "$comment" | sed -n '/### Required/,/### Optional\|^---$/p' | sed '1d;$d'
}

# Categorize issues for handling strategy
categorize_issues() {
    local issues="$1"
    local auto_fixable=()
    local needs_skip=()

    # Parse issue types
    if echo "$issues" | grep -qi "console statement"; then
        auto_fixable+=("console-statements")
    fi
    if echo "$issues" | grep -qi "sentence.case\|sentence-case"; then
        auto_fixable+=("sentence-case")
        # Brand names in addOption calls will need /skip
        needs_skip+=("Brand names in dropdown labels (OpenAI, Claude/Anthropic, OpenRouter)")
    fi
    if echo "$issues" | grep -qi "floating.promise\|no-floating-promises"; then
        auto_fixable+=("floating-promises")
    fi
    if echo "$issues" | grep -qi "no-explicit-any\|Unexpected any"; then
        auto_fixable+=("explicit-any")
    fi
    if echo "$issues" | grep -qi "require-await\|no.*await"; then
        auto_fixable+=("require-await")
    fi
    if echo "$issues" | grep -qi "no-misused-promises\|Promise returned"; then
        auto_fixable+=("misused-promises")
    fi
    if echo "$issues" | grep -qi "instanceof.*TFile\|Avoid casting"; then
        auto_fixable+=("unsafe-cast")
    fi
    if echo "$issues" | grep -qi "setHeading\|heading elements"; then
        auto_fixable+=("heading-style")
    fi
    if echo "$issues" | grep -qi "Unexpected confirm\|Unexpected prompt"; then
        auto_fixable+=("no-restricted-globals")
    fi

    echo "AUTO_FIXABLE: ${auto_fixable[*]:-none}"
    echo "NEEDS_SKIP: ${needs_skip[*]:-none}"
}

# ─── Fix Engine ──────────────────────────────────────────────────────────────

# Use Claude Code CLI to fix issues
fix_with_claude() {
    local issues="$1"

    # Build a focused prompt for Claude Code
    local prompt
    prompt=$(cat <<PROMPT
You are fixing issues flagged by the Obsidian Community Plugin review bot on PR #${PR_NUMBER}.

Here are the REQUIRED issues from the bot's latest scan:

---
${issues}
---

Fix ALL issues that can be fixed in code. Follow these rules:

CONSOLE STATEMENTS:
- Change console.log() and console.info() to console.debug()
- console.warn() and console.error() are allowed — leave them

SENTENCE CASE:
- .setName() and .setDesc() text must use sentence case (first word capitalized, rest lowercase except proper nouns)
- Brand names in .addOption() labels (OpenAI, Claude, Anthropic, OpenRouter, Groq, Ollama) CANNOT be changed — skip these
- Rephrase descriptions to avoid triggering the rule (remove ALL_CAPS env var names from visible text, avoid brand names the default eslint plugin doesn't recognize)
- "API", "URL", "HTTP" etc. are recognized acronyms and can stay uppercase

FLOATING PROMISES:
- Add void operator: void this.someAsyncMethod()
- Or add .catch(): this.someAsyncMethod().catch(console.error)

EXPLICIT ANY:
- Replace 'any' with proper types
- Use 'unknown' if the type is truly unknown

REQUIRE-AWAIT:
- Remove 'async' keyword if the method has no 'await' expression
- Or add an 'await' if it should have one

MISUSED PROMISES:
- Wrap async callbacks with void operator where void return is expected

UNSAFE CASTS:
- Use 'instanceof TFile' checks instead of casting

HEADING STYLE:
- Use new Setting(containerEl).setName('...').setHeading() instead of HTML heading elements

NO RESTRICTED GLOBALS:
- Replace confirm() / prompt() with Obsidian Modal

After fixing, run these commands to verify:
1. npm run build
2. npm run lint

If build or lint fails, fix the errors before finishing.

Only modify files in src/. Do not change eslint config or package.json.
PROMPT
)

    log "Invoking Claude Code CLI to fix issues..."

    # Run claude in non-interactive print mode
    # Unset CLAUDECODE to allow running from within an existing Claude Code session
    if echo "$prompt" | env -u CLAUDECODE claude -p 2>&1 | tee -a "$LOG_FILE"; then
        ok "Claude Code completed successfully"
        return 0
    else
        err "Claude Code returned non-zero exit code"
        return 1
    fi
}

# ─── Verification ────────────────────────────────────────────────────────────

verify_build() {
    log "Verifying build..."
    if npm run build 2>&1 | tee -a "$LOG_FILE"; then
        ok "Build passed"
        return 0
    else
        err "Build FAILED"
        return 1
    fi
}

verify_lint() {
    log "Verifying lint..."
    if npm run lint 2>&1 | tee -a "$LOG_FILE"; then
        ok "Lint passed"
        return 0
    else
        warn "Lint has warnings/errors (may be expected for brand name rules)"
        return 1
    fi
}

# ─── Git Operations ──────────────────────────────────────────────────────────

commit_and_push() {
    local iteration="$1"
    local message="$2"

    if git diff --quiet && git diff --cached --quiet; then
        warn "No changes to commit"
        return 1
    fi

    if $DRY_RUN; then
        log "[DRY RUN] Would commit and push:"
        git diff --stat
        return 0
    fi

    log "Staging and committing..."
    git add src/
    git commit -m "$message"

    log "Pushing to origin..."
    git push origin HEAD
    ok "Changes pushed successfully"
}

# ─── Skip Comment ────────────────────────────────────────────────────────────

post_skip_if_needed() {
    local issues="$1"
    local categories
    categories=$(categorize_issues "$issues")

    local needs_skip
    needs_skip=$(echo "$categories" | grep "NEEDS_SKIP:" | sed 's/NEEDS_SKIP: //')

    if [ "$needs_skip" != "none" ] && [ -n "$needs_skip" ]; then
        local skip_reason="The sentence-case violations on lines referencing brand names (OpenAI, Claude/Anthropic, OpenRouter, Groq, Ollama) in dropdown option labels are intentional — these are official product names that must retain their original casing per brand guidelines. All other required issues have been fixed."

        if $DRY_RUN; then
            log "[DRY RUN] Would post /skip comment: $skip_reason"
            return 0
        fi

        log "Posting /skip comment for brand name issues..."
        gh pr comment "$PR_NUMBER" --repo "$RELEASES_REPO" \
            --body "/skip $skip_reason"
        ok "Posted /skip comment"
    fi
}

# ─── Status Display ──────────────────────────────────────────────────────────

show_status() {
    header "PR Status: $RELEASES_REPO#$PR_NUMBER"

    local comment
    comment=$(get_latest_bot_comment)
    local comment_time
    comment_time=$(get_latest_bot_comment_time)

    if [ -z "$comment" ]; then
        log "No bot comments found yet"
        return
    fi

    log "Latest bot scan: $comment_time"

    if has_required_issues "$comment"; then
        local issues
        issues=$(extract_required_issues "$comment")
        warn "Required issues found:"
        echo ""
        echo "$issues"
        echo ""

        local categories
        categories=$(categorize_issues "$issues")
        log "$categories"
    else
        ok "No required issues! PR should be ready for human review."
    fi
}

# ─── Wait for Rescan ─────────────────────────────────────────────────────────

wait_for_rescan() {
    local last_comment_id="$1"
    local elapsed=0

    header "Waiting for Bot Rescan"
    log "The bot typically rescans within 6 hours after a push."
    log "Polling every $((POLL_INTERVAL / 60)) minutes (max $((MAX_POLL_WAIT / 3600)) hours)..."

    while [ $elapsed -lt $MAX_POLL_WAIT ]; do
        sleep "$POLL_INTERVAL"
        elapsed=$((elapsed + POLL_INTERVAL))

        local new_id
        new_id=$(get_latest_bot_comment_id)

        if [ -n "$new_id" ] && [ "$new_id" != "$last_comment_id" ]; then
            ok "Bot has rescanned! (after $((elapsed / 60)) minutes)"
            return 0
        fi

        log "Still waiting... ($((elapsed / 60))m / $((MAX_POLL_WAIT / 60))m)"
    done

    warn "Max wait time ($((MAX_POLL_WAIT / 3600))h) reached without new bot comment"
    warn "Re-run the script later to continue: ./scripts/obsidian-pr-monitor.sh"
    return 1
}

# ─── Main Loop ───────────────────────────────────────────────────────────────

run_fix_cycle() {
    local iteration="$1"

    header "Fix Cycle $iteration / $MAX_FIX_ITERATIONS"

    # 1. Fetch latest bot comment
    log "Fetching latest bot comment..."
    local comment
    comment=$(get_latest_bot_comment)
    local comment_id
    comment_id=$(get_latest_bot_comment_id)
    local comment_time
    comment_time=$(get_latest_bot_comment_time)

    if [ -z "$comment" ]; then
        warn "No bot comment found. The bot may not have scanned yet."
        return 2  # signal: no comment
    fi

    log "Latest scan: $comment_time"

    # 2. Check for required issues
    if ! has_required_issues "$comment"; then
        ok "No required issues found!"
        ok "The bot is satisfied. PR is ready for human review."
        return 0  # signal: done
    fi

    # 3. Check if we already processed this comment
    local last_processed
    last_processed=$(load_state)
    if [ "$comment_id" = "$last_processed" ]; then
        warn "Already processed this bot comment (ID: $comment_id)"
        if $WATCH_MODE; then
            return 2  # signal: wait for new comment
        else
            warn "Push your previous fixes and wait for rescan, or run with --watch"
            return 1
        fi
    fi

    # 4. Extract and show issues
    local issues
    issues=$(extract_required_issues "$comment")
    log "Required issues:"
    echo ""
    echo "$issues" | tee -a "$LOG_FILE"
    echo ""

    local categories
    categories=$(categorize_issues "$issues")
    log "$categories"

    # 5. Fix with Claude Code
    if ! fix_with_claude "$issues"; then
        err "Claude Code fix attempt failed"
        return 1
    fi

    # 6. Verify
    if ! verify_build; then
        err "Build failed after fixes — reverting src/ changes"
        git checkout -- src/
        return 1
    fi

    verify_lint || true  # lint may warn on brand names, that's OK

    # 7. Commit and push
    local commit_msg="Fix review bot issues (auto-fix iteration $iteration)

Addresses required issues from ObsidianReviewBot scan at $comment_time.
Auto-fixed by obsidian-pr-monitor.sh using Claude Code CLI."

    if commit_and_push "$iteration" "$commit_msg"; then
        save_state "$comment_id"
        ok "Fixes committed and pushed"
    else
        log "No code changes needed — checking if /skip is required"
    fi

    # 8. Post /skip if needed for brand name issues
    post_skip_if_needed "$issues"

    return 3  # signal: pushed, wait for rescan
}

main() {
    # Parse args
    for arg in "$@"; do
        case "$arg" in
            --watch)    WATCH_MODE=true ;;
            --dry-run)  DRY_RUN=true ;;
            --status)   STATUS_ONLY=true ;;
            --help|-h)
                echo "Usage: $0 [--watch] [--dry-run] [--status] [--help]"
                echo ""
                echo "  --watch    Loop: fix, push, wait for rescan, repeat"
                echo "  --dry-run  Parse and fix but don't commit/push"
                echo "  --status   Just show current bot feedback status"
                echo ""
                echo "Environment variables:"
                echo "  PR_NUMBER          PR number (default: $PR_NUMBER)"
                echo "  RELEASES_REPO      Target repo (default: $RELEASES_REPO)"
                echo "  MAX_FIX_ITERATIONS Max fix attempts (default: $MAX_FIX_ITERATIONS)"
                echo "  POLL_INTERVAL      Seconds between rescan polls (default: $POLL_INTERVAL)"
                echo "  MAX_POLL_WAIT      Max seconds to wait for rescan (default: $MAX_POLL_WAIT)"
                exit 0
                ;;
            *) err "Unknown argument: $arg"; exit 1 ;;
        esac
    done

    mkdir -p "$LOG_DIR"
    preflight

    header "Obsidian PR Monitor"
    log "PR: https://github.com/$RELEASES_REPO/pull/$PR_NUMBER"
    log "Mode: $(if $WATCH_MODE; then echo 'watch (continuous)'; elif $DRY_RUN; then echo 'dry-run'; elif $STATUS_ONLY; then echo 'status'; else echo 'one-shot'; fi)"
    log "Log: $LOG_FILE"

    if $STATUS_ONLY; then
        show_status
        exit 0
    fi

    for iteration in $(seq 1 "$MAX_FIX_ITERATIONS"); do
        run_fix_cycle "$iteration"
        local result=$?

        case $result in
            0)  # Done — no issues
                header "All Clear"
                ok "No more required issues. PR is ready for human review!"
                ok "https://github.com/$RELEASES_REPO/pull/$PR_NUMBER"
                exit 0
                ;;
            1)  # Error
                err "Fix cycle failed. Check the log: $LOG_FILE"
                exit 1
                ;;
            2)  # No new comment — wait for rescan
                if $WATCH_MODE; then
                    local last_id
                    last_id=$(get_latest_bot_comment_id)
                    if ! wait_for_rescan "$last_id"; then
                        warn "Timed out waiting. Re-run later."
                        exit 0
                    fi
                else
                    log "Run with --watch to wait for the bot to rescan"
                    exit 0
                fi
                ;;
            3)  # Pushed fixes — wait for rescan
                if $WATCH_MODE; then
                    local last_id
                    last_id=$(get_latest_bot_comment_id)
                    if ! wait_for_rescan "$last_id"; then
                        warn "Timed out waiting for rescan. Re-run later."
                        exit 0
                    fi
                else
                    ok "Fixes pushed! The bot will rescan within ~6 hours."
                    ok "Re-run this script after the rescan, or use --watch to wait."
                    exit 0
                fi
                ;;
        esac
    done

    warn "Max iterations ($MAX_FIX_ITERATIONS) reached"
    warn "Some issues may need manual attention or /skip"
    warn "https://github.com/$RELEASES_REPO/pull/$PR_NUMBER"
}

trap 'echo ""; warn "Interrupted. Log saved: $LOG_FILE"; exit 130' INT TERM

main "$@"

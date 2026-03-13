import { AIProvider, AIGenerateOptions, LLMClassificationResponse } from '../types';

interface NodeSummary {
	id: string;
	content: string;
}

interface ExistingGroup {
	id: string;
	label: string;
}

/**
 * Attempt to repair common JSON issues from LLM output.
 */
function repairJson(text: string): string {
	let s = text;

	// Remove trailing commas before } or ]
	s = s.replace(/,\s*([}\]])/g, '$1');

	// Close truncated JSON by counting brackets
	let braces = 0;
	let brackets = 0;
	let inString = false;
	let escape = false;

	for (const ch of s) {
		if (escape) { escape = false; continue; }
		if (ch === '\\' && inString) { escape = true; continue; }
		if (ch === '"') { inString = !inString; continue; }
		if (inString) continue;
		if (ch === '{') braces++;
		if (ch === '}') braces--;
		if (ch === '[') brackets++;
		if (ch === ']') brackets--;
	}

	while (brackets > 0) { s += ']'; brackets--; }
	while (braces > 0) { s += '}'; braces--; }

	return s;
}

function extractJson(text: string): string {
	// Strip markdown fences and surrounding text
	let s = text.replace(/^[\s\S]*?```(?:json)?\s*\n?/i, '').replace(/\n?```[\s\S]*$/i, '');
	// Extract from first { to last }
	const start = s.indexOf('{');
	const end = s.lastIndexOf('}');
	if (start !== -1 && end > start) {
		s = s.substring(start, end + 1);
	}
	return s.trim();
}

const generateOptions: AIGenerateOptions = {
	maxTokens: 4096,
	jsonMode: true,
};

/**
 * Classify canvas nodes into groups — preferring existing groups when available.
 * Uses simple numbered aliases (G1, G2...) so the AI can reliably reference groups.
 */
export async function classifyNodes(
	provider: AIProvider,
	nodes: NodeSummary[],
	existingGroups: ExistingGroup[],
	organizePrompt: string,
	maxCategories: number
): Promise<LLMClassificationResponse> {
	const nodeList = nodes.map((n, i) => `CARD_${i + 1} [${n.id}]:\n${n.content}`).join('\n\n---\n\n');

	// Map existing groups to simple aliases (G1, G2, ...) so the AI doesn't need to copy hex IDs
	const groupAliasMap = new Map<string, string>(); // alias -> real ID
	const reverseAliasMap = new Map<string, string>(); // real ID -> alias

	let groupSection = '';
	if (existingGroups.length > 0) {
		const groupLines = existingGroups.map((g, i) => {
			const alias = `G${i + 1}`;
			groupAliasMap.set(alias, g.id);
			reverseAliasMap.set(g.id, alias);
			return `${alias}: "${g.label}"`;
		});
		groupSection = `EXISTING GROUPS on this canvas:
${groupLines.join('\n')}

INSTRUCTIONS:
- Assign each card to the BEST MATCHING existing group using its alias (G1, G2, etc.)
- Match by TOPIC and CONTENT RELEVANCE, not just keywords
- Only use "NEW" as the id if a card truly does not fit ANY existing group
`;
	} else {
		groupSection = `Create at most ${maxCategories} groups. Use short slugs as ids.
`;
	}

	const prompt = `${organizePrompt}

${groupSection}
--- CARDS TO SORT (${nodes.length}) ---

${nodeList}

--- END CARDS ---

Respond with ONLY valid JSON:
{"categories":[{"id":"G1","label":"Group Label","group_color":"1","importance_score":0.8,"members":[{"node_id":"actual-node-id-from-brackets","importance_score":0.7}]}]}

CRITICAL RULES:
- "id" must be an existing group alias (G1, G2, etc.) or "NEW_something" for new groups
- "node_id" must be the exact id from the [brackets] above — NOT the CARD_ number
- Every card's node_id must appear exactly once
- group_color: "1"-"6", importance_score: 0.0-1.0`;

	const context = '';

	// Try up to 2 attempts
	let lastError = '';
	for (let attempt = 0; attempt < 2; attempt++) {
		let responseText = await provider.generate(prompt, context, generateOptions);
		responseText = extractJson(responseText);

		try {
			const repaired = repairJson(responseText);
			const parsed = JSON.parse(repaired) as LLMClassificationResponse;
			if (parsed.categories && Array.isArray(parsed.categories)) {
				// Map group aliases (G1, G2...) back to real group IDs
				for (const cat of parsed.categories) {
					const realId = groupAliasMap.get(cat.id);
					if (realId) {
						cat.id = realId;
					}
				}
				return validateAndNormalize(parsed, nodes, maxCategories);
			}
			lastError = 'Response missing categories array';
		} catch (e) {
			lastError = e instanceof Error ? e.message : String(e);
		}
	}

	throw new Error(`AI returned invalid JSON after 2 attempts: ${lastError}`);
}

function validateAndNormalize(
	parsed: LLMClassificationResponse,
	nodes: NodeSummary[],
	maxCategories: number
): LLMClassificationResponse {
	const inputIds = new Set(nodes.map(n => n.id));
	const seenIds = new Set<string>();

	for (const cat of parsed.categories) {
		cat.members = cat.members.filter(m => {
			if (!inputIds.has(m.node_id) || seenIds.has(m.node_id)) {
				return false;
			}
			seenIds.add(m.node_id);
			return true;
		});
	}

	parsed.categories = parsed.categories.filter(c => c.members.length > 0);

	const missing = [...inputIds].filter(id => !seenIds.has(id));
	if (missing.length > 0) {
		const uncategorized = parsed.categories.find(c => c.id === 'uncategorized');
		const missingMembers = missing.map(id => ({ node_id: id, importance_score: 0.3 }));

		if (uncategorized) {
			uncategorized.members.push(...missingMembers);
		} else {
			parsed.categories.push({
				id: 'uncategorized',
				label: 'Uncategorized',
				group_color: '6',
				importance_score: 0.1,
				members: missingMembers,
			});
		}
	}

	if (parsed.categories.length > maxCategories) {
		parsed.categories.sort((a, b) => b.importance_score - a.importance_score);
		const kept = parsed.categories.slice(0, maxCategories - 1);
		const merged = parsed.categories.slice(maxCategories - 1);
		const otherMembers = merged.flatMap(c => c.members);
		kept.push({
			id: 'other',
			label: 'Other',
			group_color: '6',
			importance_score: 0.1,
			members: otherMembers,
		});
		parsed.categories = kept;
	}

	return parsed;
}

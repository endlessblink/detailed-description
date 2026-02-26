import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts"],
    plugins: {
      "@typescript-eslint": tseslint,
      obsidianmd: obsidianmd,
    },
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        sourceType: "module",
        project: "./tsconfig.json",
      },
    },
    rules: {
      ...obsidianmd.configs.recommended,
      // Override sentence-case to add AI provider brand names and env var patterns
      "obsidianmd/ui/sentence-case": ["error", {
        enforceCamelCaseLower: true,
        brands: [
          // Default Obsidian brands
          "iOS", "iPadOS", "macOS", "Windows", "Android", "Linux",
          "Obsidian", "Obsidian Sync", "Obsidian Publish",
          "Google Drive", "Dropbox", "OneDrive", "iCloud Drive",
          "YouTube", "Slack", "Discord", "Telegram", "WhatsApp", "Twitter", "X",
          "Readwise", "Zotero", "Excalidraw", "Mermaid",
          "Markdown", "LaTeX", "JavaScript", "TypeScript", "Node.js",
          "npm", "pnpm", "Yarn", "Git", "GitHub", "GitLab",
          "Notion", "Evernote", "Roam Research", "Logseq", "Anki", "Reddit",
          "VS Code", "Visual Studio Code", "IntelliJ IDEA", "WebStorm", "PyCharm",
          // AI provider brands
          "OpenAI", "Anthropic", "OpenRouter", "Groq", "Ollama", "Azure",
        ],
        ignoreWords: ["APIs"],
        ignoreRegex: ["[A-Z]+_API_KEY"],
      }],
      // Also check typescript rules from the review
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/require-await": "error",
      "no-restricted-globals": ["error", "confirm", "prompt"],
    },
  },
];

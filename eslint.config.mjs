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
      // Also check typescript rules from the review
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/require-await": "error",
      "no-restricted-globals": ["error", "confirm", "prompt"],
    },
  },
];

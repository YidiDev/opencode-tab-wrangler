import js from "@eslint/js";
import ts from "typescript-eslint";
import globals from "globals";

export default ts.config(
  { ignores: ["node_modules/**", "coverage/**", ".artifacts/**", ".venv/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, Bun: "readonly" } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: ["node:fs", "node:fs/promises", "bun:sqlite"] },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name=/^(remove|interrupt|archive|reply|generate|cancel|prompt)$/][callee.object.name!='env'][callee.object.name!='dialog'][callee.object.property.name!='dialog']",
          message:
            "Production code must not mutate session/request execution state. Only UI dialogs and local timer cancellation are permitted.",
        },
      ],
    },
  },
);

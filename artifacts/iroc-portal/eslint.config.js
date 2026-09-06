import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      // Preserve the standard Hooks checks without enabling React Compiler rules.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Keep existing any usages visible without blocking the current portal rollout.
      "@typescript-eslint/no-explicit-any": "warn",
      // Ternary and short-circuit side effects are intentional in this codebase.
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowTernary: true, allowShortCircuit: true },
      ],
      // _-prefixed names are intentionally unused (destructuring discards, etc.).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // shadcn/ui generates empty interface extensions; this pattern is intentional.
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
);

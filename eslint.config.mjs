import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
    {
        files: ["**/*.ts"],
    },
    {
        plugins: {
            "@typescript-eslint": typescriptEslint,
        },

        languageOptions: {
            parser: tsParser,
            ecmaVersion: 2022,
            sourceType: "module",
        },

        rules: {
            // Naming conventions
            "@typescript-eslint/naming-convention": ["warn", {
                selector: "import",
                format: ["camelCase", "PascalCase"],
            }],

            // Code style (enforced)
            curly: "warn",
            eqeqeq: "warn",
            "no-throw-literal": "warn",
            semi: "warn",
            "no-duplicate-imports": "error",

            // File size limits to prevent module bloat
            "max-lines": ["warn", {
                max: 400,
                skipBlankLines: true,
                skipComments: true,
            }],

            // Function size and complexity (aligned with coding standards)
            "max-lines-per-function": ["warn", {
                max: 20,
                skipBlankLines: true,
                skipComments: true,
            }],
            complexity: ["warn", { max: 10 }],
            "max-depth": ["warn", { max: 2 }],
            "max-nested-callbacks": ["warn", { max: 2 }],
            "max-params": ["warn", { max: 4 }],

            // TypeScript strictness (warn initially)
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/explicit-function-return-type": ["warn", {
                allowExpressions: true,
                allowTypedFunctionExpressions: true,
                allowHigherOrderFunctions: true,
            }],
        },
    },
    // Prettier compatibility - disables rules that conflict with Prettier
    eslintConfigPrettier,
];
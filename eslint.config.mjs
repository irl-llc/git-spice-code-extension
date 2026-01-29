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

            // Function size and complexity (warn initially, promote to error after refactoring)
            "max-lines-per-function": ["warn", {
                max: 25,
                skipBlankLines: true,
                skipComments: true,
            }],
            complexity: ["warn", { max: 8 }],
            "max-depth": ["warn", { max: 2 }],
            "max-nested-callbacks": ["warn", { max: 2 }],

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
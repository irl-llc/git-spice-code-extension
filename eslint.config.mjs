import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
	{
		files: ['**/*.ts', '**/*.tsx'],
	},
	{
		plugins: {
			'@typescript-eslint': typescriptEslint,
		},

		languageOptions: {
			parser: tsParser,
			ecmaVersion: 2022,
			sourceType: 'module',
		},

		rules: {
			// Naming conventions
			'@typescript-eslint/naming-convention': [
				'warn',
				{
					selector: 'import',
					format: ['camelCase', 'PascalCase'],
				},
			],

			// Code style (enforced)
			curly: 'warn',
			eqeqeq: 'warn',
			'no-throw-literal': 'warn',
			semi: 'warn',
			'no-duplicate-imports': 'error',

			// File size limits to prevent module bloat
			'max-lines': [
				'warn',
				{
					max: 400,
					skipBlankLines: true,
					skipComments: true,
				},
			],

			// Function size and complexity (aligned with coding standards)
			'max-lines-per-function': [
				'warn',
				{
					max: 20,
					skipBlankLines: true,
					skipComments: true,
				},
			],
			complexity: ['warn', { max: 10 }],
			'max-depth': ['warn', { max: 2 }],
			'max-nested-callbacks': ['warn', { max: 2 }],
			'max-params': ['warn', { max: 4 }],

			// TypeScript strictness (warn initially)
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/explicit-function-return-type': [
				'warn',
				{
					allowExpressions: true,
					allowTypedFunctionExpressions: true,
					allowHigherOrderFunctions: true,
				},
			],
		},
	},
	// Test files: BDD suites are intentionally deeply nested
	// (describe/it/assert) and long. Relax the structural size rules that
	// this idiom inherently trips, while keeping the substantive checks
	// (max-depth, max-params, complexity) so test helpers stay honest.
	{
		files: ['src/test/**/*.{ts,tsx}'],
		rules: {
			'max-nested-callbacks': 'off',
			'max-lines-per-function': 'off',
			'max-lines': 'off',
		},
	},
	// React components (.tsx): a render function is a single returned JSX tree,
	// so it legitimately exceeds the line-count limits (one "long" function /
	// file) — relax only those, the same rationale as the test-file relaxation
	// above. Logic-quality rules (complexity, max-depth, max-params, naming,
	// eqeqeq, return types, no-explicit-any, …) STILL apply: JSX markup doesn't
	// raise cyclomatic complexity or block depth, so a component that trips them
	// has real branching/nesting that should be split out. Without this block,
	// `.tsx` was unmatched by the `**/*.ts`-only config and went unlinted.
	{
		files: ['**/*.tsx'],
		rules: {
			'max-lines-per-function': 'off',
			'max-lines': 'off',
		},
	},
	// Prettier compatibility - disables rules that conflict with Prettier
	eslintConfigPrettier,
];

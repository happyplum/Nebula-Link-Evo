import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/static/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': ['warn', { fixToUnknown: true, ignoreRestArgs: false }],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': 'off',
      'prefer-const': 'error',
    },
  },
  {
    files: ['ai-chat-service/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./ai-chat-service/tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['ai-chat-service/tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./ai-chat-service/tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['proxy-adapter/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./proxy-adapter/tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['proxy-adapter/tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./proxy-adapter/tsconfig.tests.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['debug-ui/e2e/**/*.ts', 'debug-ui/playwright*.config.ts', 'debug-ui/vite.config.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./debug-ui/tsconfig.playwright.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['ai-e2e/ui/e2e/**/*.ts', 'ai-e2e/ui/playwright.config.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./ai-e2e/ui/tsconfig.playwright.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  }
);

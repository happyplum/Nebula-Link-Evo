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
    files: ['services/ai-chat-service/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./services/ai-chat-service/tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['services/ai-chat-service/tests/**/*.ts', 'services/ai-chat-service/*.config.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./services/ai-chat-service/tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['services/proxy-adapter/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./services/proxy-adapter/tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['services/proxy-adapter/tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./services/proxy-adapter/tsconfig.tests.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['apps/debug-ui/e2e/**/*.ts', 'apps/debug-ui/playwright*.config.ts', 'apps/debug-ui/vite.config.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./apps/debug-ui/tsconfig.playwright.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['libs/shared/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./libs/shared/tsconfig.lint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['integrations/browser-control-client/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./integrations/browser-control-client/tsconfig.lint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['integrations/deepseek-harness-plugin/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./integrations/deepseek-harness-plugin/tsconfig.lint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['libs/agent-activity-ui/src/**/*.ts', 'libs/agent-activity-ui/src/**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./libs/agent-activity-ui/tsconfig.lint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['libs/agent-stream-client/src/**/*.ts'],
    languageOptions: { parserOptions: { projectService: false, project: ['./libs/agent-stream-client/tsconfig.lint.json'], tsconfigRootDir: import.meta.dirname } },
  },
  {
    files: ['services/ai-e2e/ui/e2e/**/*.ts', 'services/ai-e2e/ui/playwright.config.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./services/ai-e2e/ui/tsconfig.playwright.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['services/ai-e2e/ui/src/**/*.ts', 'services/ai-e2e/ui/src/**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./services/ai-e2e/ui/tsconfig.lint.json'],
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
        DOMException: 'readonly',
        clearTimeout: 'readonly',
        setTimeout: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        console: 'readonly',
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

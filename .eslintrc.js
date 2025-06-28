module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended'
  ],
  plugins: ['@typescript-eslint'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  env: {
    node: true,
    es2022: true
  },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_'
    }],
    'no-case-declarations': 'error',
    'no-console': 'off',
    'prefer-const': 'error',
    'no-var': 'error',
    'no-unreachable': 'error',
    'no-unused-vars': 'off' // TypeScript版を使用
  }
};

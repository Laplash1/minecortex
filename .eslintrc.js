module.exports = {
  env: {
    browser: false,
    es2021: true,
    node: true,
    mocha: true,
    jest: true
  },
  extends: [
    'standard'
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    // Allow console.log in this project
    'no-console': 'off',

    // Allow unused vars for parameters (common in callbacks)
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

    // Allow async functions without await
    'require-await': 'off',

    // Allow function declarations after return statements
    'no-unreachable': 'error',

    // Enforce semicolons
    semi: ['error', 'always'],

    // Allow trailing commas
    'comma-dangle': ['error', 'never'],

    // Allow spaces before function parentheses
    'space-before-function-paren': ['error', {
      anonymous: 'always',
      named: 'never',
      asyncArrow: 'always'
    }],

    // Allow single quotes
    quotes: ['error', 'single'],

    // Allow 2 space indentation
    indent: ['error', 2],

    // Allow multiple empty lines for readability
    'no-multiple-empty-lines': ['error', { max: 3, maxEOF: 1 }],

    // Allow long lines for complex expressions
    'max-len': ['warn', { code: 120, ignoreUrls: true }],

    // Allow promise rejections without catch
    'prefer-promise-reject-errors': 'off',

    // Allow non-camelcase for external API properties
    camelcase: ['error', { properties: 'never' }]
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    '*.min.js'
  ]
};

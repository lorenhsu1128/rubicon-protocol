'use strict';
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'test-results/**'] },
  js.configs.recommended,
  {
    files: ['server.js', 'eslint.config.js', 'scripts/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    // 遊戲原始碼：ES modules，由 esbuild 打包；THREE／Peer 等函式庫從 CDN 以全域變數載入
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, THREE: 'readonly', Peer: 'readonly', SimplexNoise: 'readonly' },
    },
  },
  {
    rules: {
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-cond-assign': 'off',
      'no-case-declarations': 'off',
      'no-fallthrough': 'off',
      // UI 字串中刻意使用全形空白（U+3000）
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true }],
    },
  },
];

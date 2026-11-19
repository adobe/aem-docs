module.exports = {
  root: true,
  extends: 'airbnb-base',
  env: {
    browser: true,
  },
  parser: '@babel/eslint-parser',
  parserOptions: {
    allowImportExportEverywhere: true,
    sourceType: 'module',
    requireConfigFile: false,
  },
  overrides: [{
    files: ['scripts/docs/*.mjs', 'test/docs/*.mjs', 'test/browser/*.mjs', 'playwright.config.mjs'],
    env: { node: true },
    rules: {
      'import/extensions': ['error', { js: 'always', mjs: 'always' }],
      'import/prefer-default-export': 'off',
    },
  }, {
    files: ['test/browser/*.mjs', 'playwright.config.mjs'],
    rules: {
      'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
    },
  }],
  rules: {
    'import/extensions': ['error', { js: 'always' }], // require js file extensions in imports
    'linebreak-style': ['error', 'unix'], // enforce unix linebreaks
    'no-param-reassign': [2, { props: false }], // allow modifying properties of param
  },
};

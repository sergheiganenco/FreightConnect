module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js', '**/tests/**/*.test.js'],
  testTimeout: 30000,
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
  // Note: __tests__/setup.js is loaded via require('./setup') in each __tests__/*.test.js file.
  // tests/setup.js is loaded via require('./setup') in each tests/*.test.js file.
  // No global setupFilesAfterEnv needed since each test file handles its own setup.
};

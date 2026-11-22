module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  // Blank real secrets before any module can load backend/.env (see __tests__/env.js).
  setupFiles: ['<rootDir>/__tests__/env.js'],
  testTimeout: 30000,
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
};

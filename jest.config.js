module.exports = {
  preset: '@vue/cli-plugin-unit-jest',
  transform: {
    '^.+\\.vue$': '@vue/vue3-jest',
    '^.+\\.m?js$': 'babel-jest',
  },
  testMatch: ['**/*.spec.js'],
  testPathIgnorePatterns: ['/e2e/', '/functions/'],
  transformIgnorePatterns: ['/node_modules/(?!axios|@google/genai|p-retry|is-network-error)'],
  moduleNameMapper: {
    '^axios$': '<rootDir>/node_modules/axios/dist/node/axios.cjs',
  },
  setupFilesAfterEnv: ['./tests/mocks/firebase.js'],
  resetMocks: true,
  clearMocks: true,
}

/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: ["**/?(*.)+(spec|test).ts"],
  setupFiles: ["<rootDir>/jest.setup.js"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/server.ts",
    "!src/**/*.d.ts",
  ],
  reporters: [
    "default",
    [
      "@casualbot/jest-sonar-reporter",
      {
        outputDirectory: ".",
        outputName: "sonar-report.xml",
        relativePaths: true,
      },
    ],
  ],
  coverageReporters: ["text", "lcov", "json-summary"],
  coverageThreshold: {
    global: {
      lines: 85,
      statements: 85,
      branches: 85,
      functions: 85,
    },
  },
};

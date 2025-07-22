// funcqc configuration
// See https://github.com/yourusername/funcqc for documentation

module.exports = {
  "roots": [
    "src"
  ],
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/__tests__/**",
    "**/node_modules/**"
  ],
  // Multi-scope configuration for independent quality management
  "scopes": {
    "src": {
      "roots": ["src"],
      "exclude": [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/__tests__/**"
      ],
      "description": "Production source code"
    },
    "test": {
      "roots": ["test", "tests", "__tests__", "src/__tests__"],
      "include": ["**/*.test.ts", "**/*.spec.ts", "**/*.test.js", "**/*.spec.js"],
      "exclude": [],
      "description": "Test code files"
    },
    "all": {
      "roots": ["src", "test", "tests", "__tests__"],
      "exclude": [
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**"
      ],
      "description": "All source and test code"
    }
  },
  "storage": {
    "type": "pglite",
    "path": ".funcqc/funcqc.db"
  },
  "metrics": {
    "complexityThreshold": 10,
    "cognitiveComplexityThreshold": 15,
    "linesOfCodeThreshold": 40,
    "parameterCountThreshold": 4,
    "maxNestingLevelThreshold": 3
  },
  "git": {
    "enabled": true,
    "autoLabel": true
  }
};

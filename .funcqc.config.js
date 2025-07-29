// funcqc configuration
// See https://github.com/yourusername/funcqc for documentation

module.exports = {
  // Legacy support - deprecated in favor of scopes
  "roots": [
    "src"
  ],
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/__tests__/**",
    "**/node_modules/**"
  ],
  
  // New scope-based configuration
  "defaultScope": "src",
  "globalExclude": [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**"
  ],
  
  // Scope-based configuration for independent quality management
  "scopes": {
    "src": {
      "roots": ["src"],
      "exclude": [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/__tests__/**"
      ],
      "description": "Production source code - high quality standards"
    },
    "test": {
      "roots": ["test", "tests", "__tests__", "src/__tests__"],
      "include": ["**/*.test.ts", "**/*.spec.ts", "**/*.test.js", "**/*.spec.js"],
      "exclude": [],
      "description": "Test code files - readability focused"
    },
    "all": {
      "roots": ["src", "test", "tests", "__tests__"],
      "exclude": [],
      "description": "Complete codebase overview"
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

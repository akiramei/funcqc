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
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.git/**"
  ],
  "defaultScope": "src",
  "globalExclude": [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**"
  ],
  "scopes": {
    "src": {
      "roots": [
        "src"
      ],
      "exclude": [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/__tests__/**"
      ],
      "description": "Production source code"
    },
    "test": {
      "roots": [
        "test",
        "src/__tests__"
      ],
      "include": [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/*.test.js",
        "**/*.spec.js"
      ],
      "exclude": [],
      "description": "Test code files"
    },
    "docs": {
      "roots": [
        "docs"
      ],
      "include": [
        "**/*.ts",
        "**/*.js"
      ],
      "exclude": [],
      "description": "Documentation and examples"
    },
    "scripts": {
      "roots": [
        "scripts",
        "bin"
      ],
      "include": [
        "**/*.ts",
        "**/*.js"
      ],
      "exclude": [],
      "description": "Build scripts and tools"
    },
    "all": {
      "roots": [
        "src",
        "test",
        "docs",
        "scripts",
        "bin"
      ],
      "exclude": [
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/coverage/**"
      ],
      "description": "All source, test, and utility code"
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

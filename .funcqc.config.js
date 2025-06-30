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

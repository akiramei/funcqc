// funcqc configuration
// See https://github.com/akiramei/funcqc for documentation

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
    "path": ".funcqc/test.db"
  },
  "metrics": {
    "complexityThreshold": 10,
    "linesOfCodeThreshold": 50,
    "parameterCountThreshold": 5
  },
  "git": {
    "enabled": true,
    "autoLabel": true
  }
};

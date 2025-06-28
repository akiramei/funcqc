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
    "linesOfCodeThreshold": 50,
    "parameterCountThreshold": 5
  },
  "git": {
    "enabled": true,
    "autoLabel": true
  }
};

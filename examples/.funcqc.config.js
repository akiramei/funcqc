// funcqc configuration file example
// Copy this file to .funcqc.config.js in your project root

module.exports = {
  // Root directories to scan for TypeScript files
  roots: ['src', 'lib'],
  
  // Files and directories to exclude from analysis
  exclude: [
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/__tests__/**',
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/*.d.ts'
  ],
  
  // Optional: Files to explicitly include (glob patterns)
  // include: ['**/*.ts', '**/*.tsx'],
  
  // Storage configuration
  storage: {
    type: 'pglite', // 'pglite' | 'postgres'
    path: '.funcqc/funcqc.db', // For PGLite
    // url: 'postgresql://user:pass@localhost/funcqc' // For PostgreSQL
  },
  
  // Quality metrics thresholds
  metrics: {
    complexityThreshold: 10,
    linesOfCodeThreshold: 50,
    parameterCountThreshold: 5
  },
  
  // Git integration settings
  git: {
    enabled: true,
    autoLabel: true // Automatically label snapshots with git info
  },
  
  // Similarity detection settings (for future phases)
  similarity: {
    detectors: {
      'builtin-ast': {
        enabled: true,
        threshold: 0.8
      },
      'mizchi-similarity': {
        enabled: false, // Enable when available
        threshold: 0.85,
        options: {
          minLines: 5,
          crossFile: true
        }
      }
    },
    consensus: {
      strategy: 'weighted',
      weightings: {
        'builtin-ast': 0.8,
        'mizchi-similarity': 1.0
      },
      threshold: 0.7
    }
  }
};

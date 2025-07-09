/**
 * Phase 4: Project Configuration Presets
 * 
 * Provides pre-configured settings optimized for different development contexts
 * and project types to enhance AI-assisted development workflows.
 */

import { ProjectPreset } from '../types';

/**
 * Built-in configuration presets for common project types
 */

export const PRESET_WEB_FRONTEND: ProjectPreset = {
  id: 'web-frontend',
  name: 'Web Frontend (React/Vue/Angular)',
  description: 'Optimized for modern frontend applications with component-based architecture',
  category: 'framework',
  context: {
    domain: 'web',
    projectType: 'production',
    codebaseSize: 'medium'
  },
  config: {
    roots: ['src'],
    exclude: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/__tests__/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/*.stories.*',
      '**/coverage/**'
    ],
    metrics: {
      complexityThreshold: 8,           // Lower for UI components
      cognitiveComplexityThreshold: 12, // UI logic should be simple
      linesOfCodeThreshold: 35,         // Components should be concise
      parameterCountThreshold: 5,       // Props can be numerous
      maxNestingLevelThreshold: 3       // Flat component structure
    },
    funcqcThresholds: {
      quality: {
        complexity: {
          warning: 4,
          critical: 8,
          warningPenalty: 6,
          criticalPenalty: 12
        },
        size: {
          warning: 25,
          critical: 40,
          warningPenalty: 2,
          criticalPenalty: 4
        },
        maintainability: {
          critical: 60,
          warning: 75
        },
        grading: {
          A: 90,
          B: 80,
          C: 70,
          D: 60
        }
      }
    }
  },
  recommendations: [
    {
      type: 'tip',
      category: 'maintainability',
      message: 'Keep components focused on single responsibilities',
      action: 'Consider extracting complex logic into custom hooks'
    },
    {
      type: 'tip',
      category: 'ai-optimization',
      message: 'Lower complexity thresholds help AI better understand component structure',
      action: 'Use funcqc health to identify components that need refactoring'
    }
  ],
  metadata: {
    version: '1.0.0',
    author: 'funcqc-team',
    created: Date.now(),
    compatibility: ['0.1.0'],
    tags: ['frontend', 'components', 'ui', 'react', 'vue', 'angular']
  }
};

export const PRESET_API_BACKEND: ProjectPreset = {
  id: 'api-backend',
  name: 'API Backend (REST/GraphQL)',
  description: 'Optimized for backend API services with business logic and data handling',
  category: 'platform',
  context: {
    domain: 'api',
    projectType: 'production',
    codebaseSize: 'large'
  },
  config: {
    roots: ['src'],
    exclude: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/__tests__/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/migrations/**'
    ],
    metrics: {
      complexityThreshold: 12,          // Higher for business logic
      cognitiveComplexityThreshold: 18, // Business rules can be complex
      linesOfCodeThreshold: 50,         // API handlers can be larger
      parameterCountThreshold: 6,       // API functions often have many params
      maxNestingLevelThreshold: 4       // Allow deeper nesting for validation
    },
    funcqcThresholds: {
      quality: {
        complexity: {
          warning: 6,
          critical: 12,
          warningPenalty: 8,
          criticalPenalty: 15
        },
        size: {
          warning: 30,
          critical: 60,
          warningPenalty: 3,
          criticalPenalty: 6
        },
        maintainability: {
          critical: 45,
          warning: 65
        },
        grading: {
          A: 90,
          B: 80,
          C: 70,
          D: 60
        }
      }
    }
  },
  recommendations: [
    {
      type: 'warning',
      category: 'performance',
      message: 'Monitor functions with high parameter counts for potential optimization',
      action: 'Consider using parameter objects or dependency injection'
    },
    {
      type: 'tip',
      category: 'ai-optimization',
      message: 'Higher complexity thresholds account for business logic complexity',
      action: 'Focus on cognitive complexity to improve code readability'
    }
  ],
  metadata: {
    version: '1.0.0',
    author: 'funcqc-team',
    created: Date.now(),
    compatibility: ['0.1.0'],
    tags: ['backend', 'api', 'rest', 'graphql', 'business-logic', 'server']
  }
};

export const PRESET_CLI_TOOL: ProjectPreset = {
  id: 'cli-tool',
  name: 'CLI Tool',
  description: 'Optimized for command-line tools with argument parsing and user interaction',
  category: 'domain',
  context: {
    domain: 'cli',
    projectType: 'production',
    codebaseSize: 'small'
  },
  config: {
    roots: ['src'],
    exclude: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/__tests__/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**'
    ],
    metrics: {
      complexityThreshold: 10,          // Moderate for CLI logic
      cognitiveComplexityThreshold: 15, // Command parsing can be complex
      linesOfCodeThreshold: 40,         // CLI functions are typically focused
      parameterCountThreshold: 4,       // CLI functions should be simple
      maxNestingLevelThreshold: 3       // Avoid deep nesting in CLI code
    },
    funcqcThresholds: {
      quality: {
        complexity: {
          warning: 5,
          critical: 10,
          warningPenalty: 8,
          criticalPenalty: 15
        },
        size: {
          warning: 25,
          critical: 45,
          warningPenalty: 2,
          criticalPenalty: 5
        },
        maintainability: {
          critical: 50,
          warning: 70
        },
        grading: {
          A: 90,
          B: 80,
          C: 70,
          D: 60
        }
      }
    }
  },
  recommendations: [
    {
      type: 'tip',
      category: 'maintainability',
      message: 'Keep CLI commands focused and composable',
      action: 'Extract complex operations into separate modules'
    },
    {
      type: 'info',
      category: 'team',
      message: 'CLI tools benefit from clear, self-documenting function names',
      action: 'Use descriptive names that explain the command\'s purpose'
    }
  ],
  metadata: {
    version: '1.0.0',
    author: 'funcqc-team',
    created: Date.now(),
    compatibility: ['0.1.0'],
    tags: ['cli', 'command-line', 'tool', 'terminal', 'scripting']
  }
};

export const PRESET_LIBRARY: ProjectPreset = {
  id: 'library',
  name: 'Library/Package',
  description: 'Optimized for reusable libraries and npm packages with public APIs',
  category: 'domain',
  context: {
    domain: 'library',
    projectType: 'production',
    codebaseSize: 'medium'
  },
  config: {
    roots: ['src'],
    exclude: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/__tests__/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/examples/**'
    ],
    metrics: {
      complexityThreshold: 8,           // Libraries should be simple and predictable
      cognitiveComplexityThreshold: 12, // Easy to understand for consumers
      linesOfCodeThreshold: 30,         // Keep functions focused and testable
      parameterCountThreshold: 4,       // Simple, clear APIs
      maxNestingLevelThreshold: 3       // Flat, readable structure
    },
    funcqcThresholds: {
      quality: {
        complexity: {
          warning: 4,
          critical: 8,
          warningPenalty: 10,
          criticalPenalty: 20
        },
        size: {
          warning: 20,
          critical: 35,
          warningPenalty: 3,
          criticalPenalty: 6
        },
        maintainability: {
          critical: 60,
          warning: 80
        },
        grading: {
          A: 95,  // Higher standards for libraries
          B: 85,
          C: 75,
          D: 65
        }
      }
    }
  },
  recommendations: [
    {
      type: 'warning',
      category: 'maintainability',
      message: 'Libraries require higher quality standards as they affect many consumers',
      action: 'Aim for A or B grade overall to ensure reliability'
    },
    {
      type: 'tip',
      category: 'ai-optimization',
      message: 'Lower complexity thresholds help maintain library quality',
      action: 'Use funcqc regularly during development to catch quality issues early'
    }
  ],
  metadata: {
    version: '1.0.0',
    author: 'funcqc-team',
    created: Date.now(),
    compatibility: ['0.1.0'],
    tags: ['library', 'package', 'npm', 'reusable', 'api', 'public']
  }
};

export const PRESET_JUNIOR_TEAM: ProjectPreset = {
  id: 'junior-team',
  name: 'Junior Team Friendly',
  description: 'Stricter thresholds to encourage best practices for developing teams',
  category: 'team',
  context: {
    experienceLevel: 'junior',
    projectType: 'production',
    codebaseSize: 'medium'
  },
  config: {
    roots: ['src'],
    exclude: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/__tests__/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**'
    ],
    metrics: {
      complexityThreshold: 6,           // Lower threshold to encourage simplicity
      cognitiveComplexityThreshold: 10, // Cognitive load should be minimal
      linesOfCodeThreshold: 25,         // Keep functions small and focused
      parameterCountThreshold: 3,       // Encourage simple function signatures
      maxNestingLevelThreshold: 2       // Avoid complex nesting
    },
    funcqcThresholds: {
      quality: {
        complexity: {
          warning: 3,
          critical: 6,
          warningPenalty: 12,
          criticalPenalty: 25
        },
        size: {
          warning: 15,
          critical: 30,
          warningPenalty: 4,
          criticalPenalty: 8
        },
        maintainability: {
          critical: 65,
          warning: 80
        },
        grading: {
          A: 95,  // Encourage high quality
          B: 85,
          C: 75,
          D: 65
        }
      }
    }
  },
  recommendations: [
    {
      type: 'info',
      category: 'team',
      message: 'Stricter thresholds help develop good coding habits',
      action: 'Focus on writing simple, readable functions that do one thing well'
    },
    {
      type: 'tip',
      category: 'ai-optimization',
      message: 'AI can provide better suggestions with simpler, well-structured code',
      action: 'Use AI tools to get refactoring suggestions for complex functions'
    }
  ],
  metadata: {
    version: '1.0.0',
    author: 'funcqc-team',
    created: Date.now(),
    compatibility: ['0.1.0'],
    tags: ['junior', 'team', 'learning', 'best-practices', 'education']
  }
};

export const PRESET_AI_OPTIMIZED: ProjectPreset = {
  id: 'ai-optimized',
  name: 'AI-Optimized Development',
  description: 'Optimized for AI-assisted development with enhanced code analysis and suggestions',
  category: 'methodology',
  context: {
    projectType: 'production',
    codebaseSize: 'large',
    experienceLevel: 'mid'
  },
  config: {
    roots: ['src'],
    exclude: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/__tests__/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**'
    ],
    metrics: {
      complexityThreshold: 8,           // Balanced for AI analysis
      cognitiveComplexityThreshold: 12, // AI can handle moderate complexity
      linesOfCodeThreshold: 35,         // Good for AI context windows
      parameterCountThreshold: 4,       // Clean interfaces for AI understanding
      maxNestingLevelThreshold: 3       // Structured for AI comprehension
    },
    funcqcThresholds: {
      quality: {
        complexity: {
          warning: 4,
          critical: 8,
          warningPenalty: 8,
          criticalPenalty: 16
        },
        size: {
          warning: 25,
          critical: 40,
          warningPenalty: 2,
          criticalPenalty: 5
        },
        maintainability: {
          critical: 55,
          warning: 75
        },
        grading: {
          A: 90,
          B: 80,
          C: 70,
          D: 60
        }
      }
    }
  },
  recommendations: [
    {
      type: 'tip',
      category: 'ai-optimization',
      message: 'These thresholds are optimized for AI code analysis and suggestions',
      action: 'Use funcqc health regularly to maintain AI-friendly code structure'
    },
    {
      type: 'info',
      category: 'performance',
      message: 'AI tools work best with well-structured, moderately complex functions',
      action: 'Aim for functions that fit within AI context windows (~35 lines)'
    }
  ],
  metadata: {
    version: '1.0.0',
    author: 'funcqc-team',
    created: Date.now(),
    compatibility: ['0.1.0'],
    tags: ['ai', 'optimization', 'assistant', 'analysis', 'suggestions', 'modern']
  }
};

/**
 * Registry of all available presets
 */
export const BUILTIN_PRESETS: ProjectPreset[] = [
  PRESET_WEB_FRONTEND,
  PRESET_API_BACKEND,
  PRESET_CLI_TOOL,
  PRESET_LIBRARY,
  PRESET_JUNIOR_TEAM,
  PRESET_AI_OPTIMIZED
];

/**
 * Get preset by ID
 */
export function getPreset(id: string): ProjectPreset | undefined {
  return BUILTIN_PRESETS.find(preset => preset.id === id);
}

/**
 * Get presets by category
 */
export function getPresetsByCategory(category: string): ProjectPreset[] {
  return BUILTIN_PRESETS.filter(preset => preset.category === category);
}

/**
 * Get presets by context
 */
export function getPresetsByContext(context: Partial<ProjectPreset['context']>): ProjectPreset[] {
  return BUILTIN_PRESETS.filter(preset => {
    const presetContext = preset.context;
    return Object.entries(context).every(([key, value]) => 
      !value || presetContext[key as keyof typeof presetContext] === value
    );
  });
}

/**
 * List all available preset IDs and names
 */
export function listPresets(): Array<{ id: string; name: string; description: string; category: string }> {
  return BUILTIN_PRESETS.map(preset => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    category: preset.category
  }));
}
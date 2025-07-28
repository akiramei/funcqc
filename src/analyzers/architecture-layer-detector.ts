/**
 * Architecture Layer Detection System
 * 
 * Automatically detects architectural layers based on file path conventions
 * and function characteristics.
 */

import path from 'path';
import { ArchitecturalLayer, FunctionRole, CriticalityLevel, FunctionContext } from '../types/dynamic-weights';
import { FunctionInfo } from '../types';

/**
 * Architecture layer detection patterns
 */
interface LayerDetectionPattern {
  layer: ArchitecturalLayer;
  patterns: string[];
  priority: number; // Higher number = higher priority
}

/**
 * Default layer detection patterns based on common conventions
 */
const LAYER_PATTERNS: LayerDetectionPattern[] = [
  {
    layer: 'presentation',
    patterns: [
      '**/controllers/**',
      '**/routes/**', 
      '**/api/**',
      '**/handlers/**',
      '**/endpoints/**',
      '**/components/**',
      '**/views/**',
      '**/pages/**',
      '**/ui/**'
    ],
    priority: 100
  },
  {
    layer: 'business',
    patterns: [
      '**/services/**',
      '**/domain/**',
      '**/business/**',
      '**/core/**',
      '**/logic/**',
      '**/use-cases/**',
      '**/usecases/**',
      '**/features/**'
    ],
    priority: 90
  },
  {
    layer: 'data',
    patterns: [
      '**/repositories/**',
      '**/data/**',
      '**/dao/**',
      '**/models/**',
      '**/entities/**',
      '**/database/**',
      '**/storage/**',
      '**/persistence/**'
    ],
    priority: 80
  },
  {
    layer: 'infrastructure',
    patterns: [
      '**/config/**',
      '**/configuration/**',
      '**/infrastructure/**',
      '**/framework/**',
      '**/middleware/**',
      '**/plugins/**',
      '**/adapters/**'
    ],
    priority: 70
  },
  {
    layer: 'utility',
    patterns: [
      '**/utils/**',
      '**/utilities/**',
      '**/helpers/**',
      '**/common/**',
      '**/shared/**',
      '**/lib/**',
      '**/tools/**'
    ],
    priority: 60
  }
];

/**
 * Function role detection based on fan-in/fan-out patterns
 */
interface RoleDetectionCriteria {
  role: FunctionRole;
  predicate: (fanIn: number, fanOut: number, totalFunctions: number) => boolean;
}

const ROLE_CRITERIA: RoleDetectionCriteria[] = [
  {
    role: 'facade',
    predicate: (fanIn, fanOut, total) => fanOut > Math.max(5, total * 0.02) && fanIn < fanOut * 0.3
  },
  {
    role: 'core', 
    predicate: (fanIn, fanOut, total) => fanIn > Math.max(3, total * 0.01) && fanOut > 2
  },
  {
    role: 'utility',
    predicate: (fanIn, fanOut, total) => fanIn > Math.max(2, total * 0.005) && fanOut <= 2
  },
  {
    role: 'support',
    predicate: (fanIn, fanOut, total) => fanIn >= Math.max(1, total * 0.001) && fanOut >= 1
  }
];

/**
 * Architecture Layer Detector
 */
export class ArchitectureLayerDetector {
  private layerPatterns: LayerDetectionPattern[];
  
  constructor(customPatterns?: LayerDetectionPattern[]) {
    this.layerPatterns = customPatterns || LAYER_PATTERNS;
  }

  /**
   * Detect architectural layer from file path
   */
  detectLayer(filePath: string): ArchitecturalLayer {
    // Normalize path separators
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    // Find matching patterns with highest priority
    let bestMatch: ArchitecturalLayer = 'unknown';
    let highestPriority = -1;
    
    for (const patternGroup of this.layerPatterns) {
      for (const pattern of patternGroup.patterns) {
        if (this.matchesPattern(normalizedPath, pattern)) {
          if (patternGroup.priority > highestPriority) {
            bestMatch = patternGroup.layer;
            highestPriority = patternGroup.priority;
          }
        }
      }
    }
    
    return bestMatch;
  }

  /**
   * Detect function role based on coupling metrics
   */
  detectRole(fanIn: number, fanOut: number, totalFunctions: number): FunctionRole {
    for (const criteria of ROLE_CRITERIA) {
      if (criteria.predicate(fanIn, fanOut, totalFunctions)) {
        return criteria.role;
      }
    }
    return 'unknown';
  }

  /**
   * Extract criticality from JSDoc comments
   */
  detectCriticality(functionInfo: FunctionInfo): CriticalityLevel {
    const jsDocContent = functionInfo.jsDoc || '';
    
    // Check for JSDoc annotations
    const criticalityPatterns = [
      { pattern: /@critical/i, level: 'Critical' as CriticalityLevel },
      { pattern: /@important/i, level: 'Important' as CriticalityLevel },
      { pattern: /@low-priority/i, level: 'Low' as CriticalityLevel },
      { pattern: /@todo|@fixme|@hack/i, level: 'Low' as CriticalityLevel }
    ];
    
    for (const { pattern, level } of criticalityPatterns) {
      if (pattern.test(jsDocContent)) {
        return level;
      }
    }
    
    return 'Normal';
  }

  /**
   * Create function context from function info and metrics
   */
  createFunctionContext(
    functionInfo: FunctionInfo,
    fanIn: number = 0,
    fanOut: number = 0,
    totalFunctions: number = 1000
  ): FunctionContext {
    const layer = this.detectLayer(functionInfo.filePath);
    const role = this.detectRole(fanIn, fanOut, totalFunctions);
    const criticality = this.detectCriticality(functionInfo);
    
    return {
      functionId: functionInfo.id,
      layer,
      role,
      criticality,
      filePath: functionInfo.filePath,
      fanIn,
      fanOut
    };
  }

  /**
   * Analyze project architecture patterns
   */
  analyzeArchitecturePattern(functions: FunctionInfo[]): 'MVC' | 'Microservices' | 'Layered' | 'Unknown' {
    if (functions.length === 0) return 'Unknown';
    
    const layerCounts = new Map<ArchitecturalLayer, number>();
    
    // Count functions by layer
    for (const func of functions) {
      const layer = this.detectLayer(func.filePath);
      layerCounts.set(layer, (layerCounts.get(layer) || 0) + 1);
    }
    
    const totalFunctions = functions.length;
    const presentationCount = layerCounts.get('presentation') || 0;
    const businessCount = layerCounts.get('business') || 0;
    const dataCount = layerCounts.get('data') || 0;
    
    // Calculate layer ratios
    const presentationRatio = presentationCount / totalFunctions;
    const businessRatio = businessCount / totalFunctions;
    const dataRatio = dataCount / totalFunctions;
    
    // Pattern detection heuristics
    if (presentationRatio > 0.3 && businessRatio > 0.3 && dataRatio > 0.15) {
      return 'MVC';
    }
    
    if (presentationRatio > 0.4 && businessRatio > 0.2) {
      return 'Layered';
    }
    
    // Check for microservices pattern (multiple small modules)
    const uniqueDirectories = new Set(
      functions.map(f => path.dirname(f.filePath).split('/')[0])
    ).size;
    
    if (uniqueDirectories > 5 && totalFunctions / uniqueDirectories < 50) {
      return 'Microservices';
    }
    
    return 'Unknown';
  }

  /**
   * Get layer distribution statistics
   */
  getLayerDistribution(functions: FunctionInfo[]): Record<ArchitecturalLayer, number> {
    const distribution: Record<ArchitecturalLayer, number> = {
      presentation: 0,
      business: 0,
      data: 0,
      utility: 0,
      infrastructure: 0,
      unknown: 0
    };
    
    for (const func of functions) {
      const layer = this.detectLayer(func.filePath);
      distribution[layer]++;
    }
    
    return distribution;
  }

  /**
   * Validate layer detection patterns
   */
  validatePatterns(testPaths: string[]): Record<string, ArchitecturalLayer> {
    const results: Record<string, ArchitecturalLayer> = {};
    
    for (const testPath of testPaths) {
      results[testPath] = this.detectLayer(testPath);
    }
    
    return results;
  }

  /**
   * Match file path against glob-like pattern
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*\*/g, '§§DOUBLESTAR§§')  // Temporary placeholder
      .replace(/\*/g, '[^/]*')              // Single * matches anything except /
      .replace(/§§DOUBLESTAR§§/g, '.*')     // ** matches anything including /
      .replace(/\?/g, '[^/]');              // ? matches single character except /
    
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(filePath);
  }
}

/**
 * Default instance for global use
 */
export const defaultLayerDetector = new ArchitectureLayerDetector();
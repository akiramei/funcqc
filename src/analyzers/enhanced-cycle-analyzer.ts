import { CallEdge, FunctionInfo } from '../types';
import { SCCAnalyzer, StronglyConnectedComponent } from './scc-analyzer';
import { 
  ClassifiedCycle, 
  CycleType, 
  ImportanceLevel, 
  CyclesAnalysisResult 
} from '../cli/dep/types';

/**
 * Enhanced cycle analyzer with classification and importance scoring
 */
export class EnhancedCycleAnalyzer {
  private sccAnalyzer: SCCAnalyzer;

  constructor() {
    this.sccAnalyzer = new SCCAnalyzer();
  }

  /**
   * Analyze cycles with classification and filtering
   */
  analyzeClassifiedCycles(
    callEdges: CallEdge[],
    functions: FunctionInfo[],
    options: {
      excludeRecursive?: boolean;
      excludeClear?: boolean;
      minComplexity?: number;
      crossModuleOnly?: boolean;
      crossLayerOnly?: boolean;
      recursiveOnly?: boolean;
    } = {}
  ): CyclesAnalysisResult {
    // Get SCCs using existing Tarjan implementation
    const sccResult = this.sccAnalyzer.findStronglyConnectedComponents(callEdges);
    
    // Create function map for quick lookup
    const functionMap = new Map(functions.map(f => [f.id, f]));
    
    // Convert SCCs to classified cycles
    const allClassifiedCycles = sccResult.components.map(component => 
      this.classifySCC(component, functionMap)
    );

    // Apply filters
    const filteredCycles = this.applyFilters(allClassifiedCycles, options, functions);
    
    // Sort by importance
    filteredCycles.sort((a, b) => b.score - a.score);
    
    // Calculate filter statistics
    const filterStats = {
      excludedRecursive: options.excludeRecursive ? 
        allClassifiedCycles.filter(c => c.type === CycleType.RECURSIVE).length : 0,
      excludedClear: options.excludeClear ? 
        allClassifiedCycles.filter(c => this.isClearCycle(c, functionMap)).length : 0,
      excludedByComplexity: options.minComplexity ? 
        allClassifiedCycles.filter(c => c.nodes.length < (options.minComplexity || 0)).length : 0,
      excludedBySize: 0 // Will be calculated during filtering
    };

    // Calculate importance summary
    const importanceSummary = {
      critical: filteredCycles.filter(c => c.importance === ImportanceLevel.CRITICAL).length,
      high: filteredCycles.filter(c => c.importance === ImportanceLevel.HIGH).length,
      medium: filteredCycles.filter(c => c.importance === ImportanceLevel.MEDIUM).length,
      low: filteredCycles.filter(c => c.importance === ImportanceLevel.LOW).length
    };

    return {
      classifiedCycles: filteredCycles,
      totalCycles: allClassifiedCycles.length,
      filteredCycles: filteredCycles.length,
      filterStats,
      importanceSummary
    };
  }

  /**
   * Classify an SCC into a ClassifiedCycle
   */
  private classifySCC(
    component: StronglyConnectedComponent,
    functionMap: Map<string, FunctionInfo>
  ): ClassifiedCycle {
    // Determine cycle type
    const type = this.determineCycleType(component);
    
    // Get function info for analysis
    const functions = component.functionIds
      .map(id => functionMap.get(id))
      .filter((f): f is FunctionInfo => f !== undefined);
    
    // Analyze cross-boundary characteristics
    const { crossModule, crossLayer, crossFile, fileCount, moduleCount, layerCount } = 
      this.analyzeCrossBoundaries(functions);
    
    // Calculate importance
    const importance = this.calculateImportance(crossLayer, crossModule, crossFile);
    const score = this.calculateImportanceScore(importance, component.size, functions);
    
    // Calculate complexity metrics
    const cyclomaticComplexity = functions.reduce((sum, f) => {
      const complexity = (f as FunctionInfo & { cyclomaticComplexity?: number }).cyclomaticComplexity || 0;
      return sum + complexity;
    }, 0);
    const averageComplexity = functions.length > 0 ? cyclomaticComplexity / functions.length : 0;
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(
      type, importance, component.size, crossLayer, crossModule
    );

    return {
      id: component.id,
      nodes: component.functionIds,
      type,
      importance,
      score,
      crossModule,
      crossLayer,
      crossFile,
      fileCount,
      moduleCount,
      layerCount,
      cyclomaticComplexity,
      averageComplexity,
      recommendations
    };
  }

  /**
   * Determine cycle type based on SCC characteristics
   */
  private determineCycleType(component: StronglyConnectedComponent): CycleType {
    if (component.size === 1) {
      return CycleType.RECURSIVE;
    } else if (component.size <= 3) {
      return CycleType.MUTUAL;
    } else {
      return CycleType.COMPLEX;
    }
  }

  /**
   * Analyze cross-boundary characteristics
   */
  private analyzeCrossBoundaries(functions: FunctionInfo[]): {
    crossModule: boolean;
    crossLayer: boolean;
    crossFile: boolean;
    fileCount: number;
    moduleCount: number;
    layerCount: number;
  } {
    const files = new Set(functions.map(f => f.filePath));
    const modules = new Set(functions.map(f => this.extractModuleName(f.filePath)));
    const layers = new Set(functions.map(f => this.extractLayerName(f.filePath)));

    return {
      crossFile: files.size > 1,
      crossModule: modules.size > 1,
      crossLayer: layers.size > 1,
      fileCount: files.size,
      moduleCount: modules.size,
      layerCount: layers.size
    };
  }

  /**
   * Extract module name from file path
   */
  private extractModuleName(filePath: string): string {
    const parts = filePath.split('/');
    // Look for src/<module>/ pattern
    const srcIndex = parts.findIndex(part => part === 'src');
    if (srcIndex !== -1 && srcIndex + 1 < parts.length) {
      return parts[srcIndex + 1];
    }
    return 'unknown';
  }

  /**
   * Extract layer name from file path
   */
  private extractLayerName(filePath: string): string {
    const parts = filePath.split('/');
    
    // Define layer patterns
    const layerPatterns = {
      'cli': /^(cli|commands)$/,
      'core': /^(core|domain)$/,
      'storage': /^(storage|database)$/,
      'analyzers': /^(analyzers|analysis)$/,
      'utils': /^(utils|utilities|helpers)$/,
      'types': /^(types|interfaces)$/,
      'services': /^(services)$/,
      'config': /^(config|configuration)$/
    };

    for (const [layer, pattern] of Object.entries(layerPatterns)) {
      if (parts.some(part => pattern.test(part))) {
        return layer;
      }
    }
    
    return 'unknown';
  }

  /**
   * Calculate importance level
   */
  private calculateImportance(
    crossLayer: boolean,
    crossModule: boolean,
    crossFile: boolean
  ): ImportanceLevel {
    if (crossLayer) {
      return ImportanceLevel.CRITICAL;
    } else if (crossModule) {
      return ImportanceLevel.HIGH;
    } else if (crossFile) {
      return ImportanceLevel.MEDIUM;
    } else {
      return ImportanceLevel.LOW;
    }
  }

  /**
   * Calculate numeric importance score (0-10)
   */
  private calculateImportanceScore(
    importance: ImportanceLevel,
    cycleSize: number,
    functions: FunctionInfo[]
  ): number {
    // Base score from importance level
    let baseScore = 0;
    switch (importance) {
      case ImportanceLevel.CRITICAL: baseScore = 8; break;
      case ImportanceLevel.HIGH: baseScore = 6; break;
      case ImportanceLevel.MEDIUM: baseScore = 4; break;
      case ImportanceLevel.LOW: baseScore = 2; break;
    }

    // Adjust for cycle size (larger cycles are more problematic)
    const sizeMultiplier = Math.min(1 + (cycleSize - 1) * 0.1, 2.0);
    
    // Adjust for complexity
    const avgComplexity = functions.length > 0 
      ? functions.reduce((sum, f) => {
          const complexity = (f as FunctionInfo & { cyclomaticComplexity?: number }).cyclomaticComplexity || 0;
          return sum + complexity;
        }, 0) / functions.length 
      : 0;
    const complexityMultiplier = Math.min(1 + avgComplexity * 0.05, 1.5);

    const finalScore = baseScore * sizeMultiplier * complexityMultiplier;
    return Math.min(Math.round(finalScore * 10) / 10, 10);
  }

  /**
   * Generate improvement recommendations
   */
  private generateRecommendations(
    type: CycleType,
    importance: ImportanceLevel,
    size: number,
    crossLayer: boolean,
    crossModule: boolean
  ): string[] {
    const recommendations: string[] = [];

    if (crossLayer) {
      recommendations.push('URGENT: Cross-layer cycle violates architectural boundaries');
      recommendations.push('Consider introducing interfaces or dependency injection');
      recommendations.push('Review layer separation and abstraction patterns');
    } else if (crossModule) {
      recommendations.push('Cross-module cycle increases coupling');
      recommendations.push('Extract common functionality to shared module');
      recommendations.push('Consider using dependency injection or event patterns');
    }

    if (importance === ImportanceLevel.CRITICAL) {
      recommendations.push('High priority: Architectural integrity at risk');
    }

    if (type === CycleType.COMPLEX && size > 5) {
      recommendations.push('Large cycle suggests design issues');
      recommendations.push('Break into smaller, focused components');
    }

    if (type === CycleType.MUTUAL && size === 2) {
      recommendations.push('Consider merging functions or introducing mediator pattern');
    }

    return recommendations;
  }

  /**
   * Apply filters to cycles
   */
  private applyFilters(
    cycles: ClassifiedCycle[],
    options: {
      excludeRecursive?: boolean;
      excludeClear?: boolean;
      minComplexity?: number;
      crossModuleOnly?: boolean;
      crossLayerOnly?: boolean;
      recursiveOnly?: boolean;
    },
    functions?: FunctionInfo[]
  ): ClassifiedCycle[] {
    let filtered = cycles;

    // Recursive filter (apply first, before complexity filter)
    if (options.excludeRecursive) {
      filtered = filtered.filter(c => c.type !== CycleType.RECURSIVE);
    }
    if (options.recursiveOnly) {
      filtered = filtered.filter(c => c.type === CycleType.RECURSIVE);
      // For recursive-only mode, skip the minComplexity filter since recursive cycles are size 1
      return filtered;
    }

    // Clear functions filter
    if (options.excludeClear && functions) {
      // Create function map for clear detection
      const functionMap = new Map(functions.map(f => [f.id, f]));
      filtered = filtered.filter(c => !this.isClearCycle(c, functionMap));
    }

    // Complexity filter (only apply if not in recursive-only mode)
    if (options.minComplexity !== undefined) {
      const minComplexity = options.minComplexity;
      filtered = filtered.filter(c => c.nodes.length >= minComplexity);
    }

    // Boundary filters
    if (options.crossLayerOnly) {
      filtered = filtered.filter(c => c.crossLayer);
    }
    if (options.crossModuleOnly) {
      filtered = filtered.filter(c => c.crossModule);
    }

    return filtered;
  }

  /**
   * Check if cycle involves clear functions
   */
  private isClearCycle(cycle: ClassifiedCycle, functionMap: Map<string, FunctionInfo>): boolean {
    return cycle.nodes.some(nodeId => {
      const func = functionMap.get(nodeId);
      return func?.name === 'clear';
    });
  }
}
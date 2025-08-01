import * as path from 'path';
import { minimatch } from 'minimatch';
import { ArchitectureConfig, LayerAssignment } from '../types/architecture';
import { FunctionInfo } from '../types';

/**
 * Assigns functions to architecture layers based on configuration patterns
 */
export class LayerAssigner {
  private config: ArchitectureConfig;

  constructor(config: ArchitectureConfig) {
    this.config = config;
  }

  /**
   * Assign layers to all functions based on their file paths
   */
  assignLayers(functions: FunctionInfo[]): LayerAssignment[] {
    const assignments: LayerAssignment[] = [];

    for (const func of functions) {
      const assignment = this.assignFunction(func);
      if (assignment) {
        assignments.push(assignment);
      }
    }

    return assignments;
  }

  /**
   * Assign a layer to a single function
   */
  assignFunction(func: FunctionInfo): LayerAssignment | null {
    const filePath = this.normalizePath(func.filePath);
    
    // Find matching layers
    const matches: Array<{ layer: string; confidence: number; pattern: string }> = [];

    for (const [layerName, layerConfig] of Object.entries(this.config.layers)) {
      const patterns = Array.isArray(layerConfig) ? layerConfig : layerConfig.patterns;
      for (const pattern of patterns) {
        const confidence = this.calculateMatchConfidence(filePath, pattern);
        if (confidence > 0) {
          matches.push({ layer: layerName, confidence, pattern });
        }
      }
    }

    if (matches.length === 0) {
      // No layer assignment found
      if (this.config.settings?.strictMode) {
        // In strict mode, create an "unassigned" layer assignment with low confidence
        return {
          path: filePath,
          layer: '__unassigned__',
          confidence: 0,
        };
      }
      return null;
    }

    // Sort by confidence (descending) and pick the best match
    matches.sort((a, b) => b.confidence - a.confidence);
    const bestMatch = matches[0];

    return {
      path: filePath,
      layer: bestMatch.layer,
      confidence: bestMatch.confidence,
    };
  }

  /**
   * Calculate match confidence for a file path against a pattern
   */
  private calculateMatchConfidence(filePath: string, pattern: string): number {
    if (!minimatch(filePath, pattern)) {
      return 0;
    }

    // Base confidence for any match
    let confidence = 0.5;

    // Increase confidence based on pattern specificity
    const patternSpecificity = this.calculatePatternSpecificity(pattern);
    confidence += patternSpecificity * 0.4;

    // Increase confidence for exact directory matches
    if (this.isExactDirectoryMatch(filePath, pattern)) {
      confidence += 0.1;
    }

    // Ensure confidence is within [0, 1] range
    return Math.min(1, Math.max(0, confidence));
  }

  /**
   * Calculate pattern specificity (more specific patterns get higher scores)
   */
  private calculatePatternSpecificity(pattern: string): number {
    let specificity = 0;

    // Count directory depth
    const directories = pattern.split('/').filter(part => part && part !== '**' && part !== '*');
    specificity += directories.length * 0.1;

    // Exact file name matches are more specific
    if (!pattern.includes('*')) {
      specificity += 0.3;
    }

    // Single * is more specific than **
    const singleWildcards = (pattern.match(/(?<!\*)\*(?!\*)/g) || []).length;
    const doubleWildcards = (pattern.match(/\*\*/g) || []).length;
    
    specificity -= doubleWildcards * 0.1;
    specificity -= singleWildcards * 0.05;

    return Math.min(1, Math.max(0, specificity));
  }

  /**
   * Check if the file path exactly matches the directory structure of the pattern
   */
  private isExactDirectoryMatch(filePath: string, pattern: string): boolean {
    // Remove wildcards and get the base directory pattern
    const basePattern = pattern.replace(/\/\*+.*$/, '');
    const fileDir = path.dirname(filePath);
    
    return fileDir.startsWith(basePattern);
  }

  /**
   * Normalize file path for consistent matching
   */
  private normalizePath(filePath: string): string {
    // Convert to forward slashes and remove leading ./
    return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  }

  /**
   * Get the layer name for a given file path
   */
  getLayer(filePath: string): string | null {
    const normalizedPath = this.normalizePath(filePath);
    
    // Find matching layers with their confidence scores
    const matches: Array<{ layer: string; confidence: number }> = [];

    for (const [layerName, layerConfig] of Object.entries(this.config.layers)) {
      const patterns = Array.isArray(layerConfig) ? layerConfig : layerConfig.patterns;
      for (const pattern of patterns) {
        const confidence = this.calculateMatchConfidence(normalizedPath, pattern);
        if (confidence > 0) {
          matches.push({ layer: layerName, confidence });
        }
      }
    }

    if (matches.length === 0) {
      return null;
    }

    // Return the layer with the highest confidence
    matches.sort((a, b) => b.confidence - a.confidence);
    return matches[0].layer;
  }

  /**
   * Get all layer names defined in the configuration
   */
  getLayerNames(): string[] {
    return Object.keys(this.config.layers);
  }

  /**
   * Get layer patterns for a specific layer
   */
  getLayerPatterns(layerName: string): string[] {
    const layerConfig = this.config.layers[layerName];
    if (!layerConfig) return [];
    return Array.isArray(layerConfig) ? layerConfig : layerConfig.patterns;
  }

  /**
   * Check if a file path matches any layer pattern
   */
  matchesAnyLayer(filePath: string): boolean {
    const normalizedPath = this.normalizePath(filePath);
    
    for (const layerConfig of Object.values(this.config.layers)) {
      const patterns = Array.isArray(layerConfig) ? layerConfig : layerConfig.patterns;
      for (const pattern of patterns) {
        if (minimatch(normalizedPath, pattern)) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Get statistics about layer assignments
   */
  getAssignmentStats(assignments: LayerAssignment[]): {
    totalFunctions: number;
    assignedFunctions: number;
    unassignedFunctions: number;
    layerCounts: Record<string, number>;
    averageConfidence: number;
    lowConfidenceCount: number;
  } {
    const stats = {
      totalFunctions: assignments.length,
      assignedFunctions: 0,
      unassignedFunctions: 0,
      layerCounts: {} as Record<string, number>,
      averageConfidence: 0,
      lowConfidenceCount: 0,
    };

    let totalConfidence = 0;
    const confidenceThreshold = 0.6;

    for (const assignment of assignments) {
      if (assignment.layer === '__unassigned__') {
        stats.unassignedFunctions++;
      } else {
        stats.assignedFunctions++;
        stats.layerCounts[assignment.layer] = (stats.layerCounts[assignment.layer] || 0) + 1;
      }

      totalConfidence += assignment.confidence;
      
      if (assignment.confidence < confidenceThreshold) {
        stats.lowConfidenceCount++;
      }
    }

    stats.averageConfidence = assignments.length > 0 ? totalConfidence / assignments.length : 0;

    return stats;
  }
}
/**
 * ID Resolution Utility
 * 
 * Provides unified ID resolution across funcqc commands:
 * - Short ID (8 characters) -> Full UUID
 * - Function name -> ID
 * - File path + line number -> ID
 * - Fuzzy matching for improved usability
 */

import { FunctionInfo, QueryOptions } from '../types';
import { CommandEnvironment } from '../types/environment';

export interface IDResolutionResult {
  id: string;
  confidence: 'exact' | 'high' | 'medium' | 'low';
  matches: Array<{
    id: string;
    name: string;
    filePath: string;
    startLine: number;
    reason: string;
  }>;
}

export interface IDResolutionOptions {
  /**
   * If true, return multiple matches for ambiguous queries
   */
  allowMultiple?: boolean;
  
  /**
   * Maximum number of matches to return
   */
  maxMatches?: number;
  
  /**
   * Minimum confidence level required
   */
  minConfidence?: 'exact' | 'high' | 'medium' | 'low';
  
  /**
   * Include debug information in the result
   */
  debug?: boolean;
}

/**
 * Unified ID resolver that can handle various input formats
 */
export class IDResolver {
  private env: CommandEnvironment;
  private functionCache: Map<string, FunctionInfo> | null = null;
  private shortIdCache: Map<string, string[]> | null = null;
  
  constructor(env: CommandEnvironment) {
    this.env = env;
  }
  
  /**
   * Resolve an ID from various input formats
   */
  async resolveID(input: string, options: IDResolutionOptions = {}): Promise<IDResolutionResult | null> {
    const {
      allowMultiple = false,
      maxMatches = 10,
      minConfidence = 'low',
      debug = false
    } = options;
    
    // Ensure we have function data loaded
    await this.ensureFunctionData();
    
    // Try different resolution strategies in order of confidence
    const strategies = [
      () => this.resolveByFullUUID(input),
      () => this.resolveByShortID(input),
      () => this.resolveByExactName(input),
      () => this.resolveByFilePath(input),
      () => this.resolveByFuzzyName(input),
      () => this.resolveByPartialPath(input)
    ];
    
    for (const strategy of strategies) {
      const result = await strategy();
      if (result && this.meetsConfidenceThreshold(result.confidence, minConfidence)) {
        // Limit matches if needed
        if (!allowMultiple && result.matches.length > 1) {
          result.matches = result.matches.slice(0, 1);
        } else {
          result.matches = result.matches.slice(0, maxMatches);
        }
        
        if (debug) {
          this.addDebugInfo(result, input);
        }
        
        return result;
      }
    }
    
    return null;
  }
  
  /**
   * Resolve multiple IDs from a list of inputs
   */
  async resolveMultipleIDs(
    inputs: string[], 
    options: IDResolutionOptions = {}
  ): Promise<Array<{ input: string; result: IDResolutionResult | null }>> {
    const results: Array<{ input: string; result: IDResolutionResult | null }> = [];
    
    for (const input of inputs) {
      const result = await this.resolveID(input, options);
      results.push({ input, result });
    }
    
    return results;
  }
  
  /**
   * Get short ID from full UUID
   */
  getShortID(fullID: string): string {
    return fullID.substring(0, 8);
  }
  
  /**
   * Check if input looks like a short ID (8 hex characters)
   */
  isShortID(input: string): boolean {
    return /^[a-f0-9]{8}$/i.test(input);
  }
  
  /**
   * Check if input looks like a full UUID
   */
  isFullUUID(input: string): boolean {
    return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input);
  }
  
  /**
   * Ensure function data is loaded and cached
   */
  private async ensureFunctionData(): Promise<void> {
    if (this.functionCache) return;
    
    const queryOptions: QueryOptions = {
      sort: 'name,file_path,start_line'
    };
    
    const functions = await this.env.storage.findFunctions(queryOptions);
    this.functionCache = new Map(functions.map(f => [f.id, f]));
    
    // Build short ID cache
    this.shortIdCache = new Map();
    for (const func of functions) {
      const shortId = this.getShortID(func.id);
      if (!this.shortIdCache.has(shortId)) {
        this.shortIdCache.set(shortId, []);
      }
      this.shortIdCache.get(shortId)!.push(func.id);
    }
  }
  
  /**
   * Resolve by full UUID (exact match)
   */
  private async resolveByFullUUID(input: string): Promise<IDResolutionResult | null> {
    if (!this.isFullUUID(input)) return null;
    
    const func = this.functionCache!.get(input);
    if (!func) return null;
    
    return {
      id: input,
      confidence: 'exact',
      matches: [{
        id: func.id,
        name: func.name,
        filePath: func.filePath,
        startLine: func.startLine,
        reason: 'Exact UUID match'
      }]
    };
  }
  
  /**
   * Resolve by short ID (8 characters)
   */
  private async resolveByShortID(input: string): Promise<IDResolutionResult | null> {
    if (!this.isShortID(input)) return null;
    
    const matchingIds = this.shortIdCache!.get(input.toLowerCase());
    if (!matchingIds || matchingIds.length === 0) return null;
    
    const matches = matchingIds.map(id => {
      const func = this.functionCache!.get(id)!;
      return {
        id: func.id,
        name: func.name,
        filePath: func.filePath,
        startLine: func.startLine,
        reason: 'Short ID match'
      };
    });
    
    return {
      id: matches[0].id,
      confidence: matchingIds.length === 1 ? 'exact' : 'high',
      matches
    };
  }
  
  /**
   * Resolve by exact function name
   */
  private async resolveByExactName(input: string): Promise<IDResolutionResult | null> {
    const matches: IDResolutionResult['matches'] = [];
    
    for (const func of this.functionCache!.values()) {
      if (func.name === input) {
        matches.push({
          id: func.id,
          name: func.name,
          filePath: func.filePath,
          startLine: func.startLine,
          reason: 'Exact name match'
        });
      }
    }
    
    if (matches.length === 0) return null;
    
    return {
      id: matches[0].id,
      confidence: matches.length === 1 ? 'exact' : 'high',
      matches
    };
  }
  
  /**
   * Resolve by file path pattern (e.g., "file.ts:123" or "path/file.ts")
   */
  private async resolveByFilePath(input: string): Promise<IDResolutionResult | null> {
    const matches: IDResolutionResult['matches'] = [];
    
    // Check for file:line pattern
    const fileLineMatch = input.match(/^(.+):(\d+)$/);
    if (fileLineMatch) {
      const [, filePath, lineStr] = fileLineMatch;
      const line = parseInt(lineStr, 10);
      
      for (const func of this.functionCache!.values()) {
        if (func.filePath.includes(filePath) && func.startLine === line) {
          matches.push({
            id: func.id,
            name: func.name,
            filePath: func.filePath,
            startLine: func.startLine,
            reason: 'File path and line match'
          });
        }
      }
    } else {
      // Just file path
      for (const func of this.functionCache!.values()) {
        if (func.filePath.includes(input)) {
          matches.push({
            id: func.id,
            name: func.name,
            filePath: func.filePath,
            startLine: func.startLine,
            reason: 'File path match'
          });
        }
      }
    }
    
    if (matches.length === 0) return null;
    
    return {
      id: matches[0].id,
      confidence: matches.length === 1 ? 'high' : 'medium',
      matches
    };
  }
  
  /**
   * Resolve by fuzzy name matching
   */
  private async resolveByFuzzyName(input: string): Promise<IDResolutionResult | null> {
    const matches: IDResolutionResult['matches'] = [];
    const lowerInput = input.toLowerCase();
    
    for (const func of this.functionCache!.values()) {
      const lowerName = func.name.toLowerCase();
      
      // Check for various fuzzy matching conditions
      if (lowerName.includes(lowerInput) || 
          lowerName.startsWith(lowerInput) ||
          this.calculateSimilarity(lowerName, lowerInput) > 0.7) {
        matches.push({
          id: func.id,
          name: func.name,
          filePath: func.filePath,
          startLine: func.startLine,
          reason: 'Fuzzy name match'
        });
      }
    }
    
    if (matches.length === 0) return null;
    
    // Sort by name similarity
    matches.sort((a, b) => {
      const simA = this.calculateSimilarity(a.name.toLowerCase(), lowerInput);
      const simB = this.calculateSimilarity(b.name.toLowerCase(), lowerInput);
      return simB - simA;
    });
    
    return {
      id: matches[0].id,
      confidence: 'medium',
      matches: matches.slice(0, 10) // Limit fuzzy matches
    };
  }
  
  /**
   * Resolve by partial file path
   */
  private async resolveByPartialPath(input: string): Promise<IDResolutionResult | null> {
    const matches: IDResolutionResult['matches'] = [];
    const lowerInput = input.toLowerCase();
    
    for (const func of this.functionCache!.values()) {
      const lowerPath = func.filePath.toLowerCase();
      
      if (lowerPath.includes(lowerInput)) {
        matches.push({
          id: func.id,
          name: func.name,
          filePath: func.filePath,
          startLine: func.startLine,
          reason: 'Partial path match'
        });
      }
    }
    
    if (matches.length === 0) return null;
    
    return {
      id: matches[0].id,
      confidence: 'low',
      matches: matches.slice(0, 20) // Limit path matches
    };
  }
  
  /**
   * Calculate string similarity using Levenshtein distance
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const matrix: number[][] = [];
    const len1 = str1.length;
    const len2 = str2.length;
    
    for (let i = 0; i <= len2; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= len1; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= len2; i++) {
      for (let j = 1; j <= len1; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }
    
    const maxLength = Math.max(len1, len2);
    return maxLength === 0 ? 1 : (maxLength - matrix[len2][len1]) / maxLength;
  }
  
  /**
   * Check if confidence meets threshold
   */
  private meetsConfidenceThreshold(confidence: string, minConfidence: string): boolean {
    const levels = ['low', 'medium', 'high', 'exact'];
    const confIndex = levels.indexOf(confidence);
    const minIndex = levels.indexOf(minConfidence);
    return confIndex >= minIndex;
  }
  
  /**
   * Add debug information to result
   */
  private addDebugInfo(result: IDResolutionResult, input: string): void {
    (result as IDResolutionResult & { debug: Record<string, unknown> }).debug = {
      input,
      cacheSize: this.functionCache?.size || 0,
      shortIdCollisions: this.countShortIdCollisions(),
      strategy: this.getStrategyUsed(result)
    };
  }
  
  /**
   * Count short ID collisions in cache
   */
  private countShortIdCollisions(): number {
    let collisions = 0;
    for (const ids of this.shortIdCache!.values()) {
      if (ids.length > 1) collisions++;
    }
    return collisions;
  }
  
  /**
   * Determine which strategy was used based on result
   */
  private getStrategyUsed(result: IDResolutionResult): string {
    if (result.matches.length > 0) {
      return result.matches[0].reason.split(' ')[0].toLowerCase();
    }
    return 'unknown';
  }
  
  /**
   * Clear internal caches
   */
  clearCache(): void {
    this.functionCache = null;
    this.shortIdCache = null;
  }
}

/**
 * Helper function to create and use ID resolver
 */
export async function resolveID(
  env: CommandEnvironment, 
  input: string, 
  options?: IDResolutionOptions
): Promise<IDResolutionResult | null> {
  const resolver = new IDResolver(env);
  return resolver.resolveID(input, options);
}

/**
 * Helper function to resolve multiple IDs
 */
export async function resolveMultipleIDs(
  env: CommandEnvironment,
  inputs: string[],
  options?: IDResolutionOptions
): Promise<Array<{ input: string; result: IDResolutionResult | null }>> {
  const resolver = new IDResolver(env);
  return resolver.resolveMultipleIDs(inputs, options);
}
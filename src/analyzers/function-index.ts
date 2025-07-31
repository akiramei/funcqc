import { FunctionMetadata } from './ideal-call-graph-analyzer';
import { MethodInfo } from './cha-analyzer';
import { Node } from 'ts-morph';
import * as path from 'path';

/**
 * High-performance O(1) function lookup index
 * Replaces the O(F) linear search in findMatchingFunctionId
 */
export class FunctionIndex {
  // Primary index: filePath|startLine|className|name -> functionId
  private byExact = new Map<string, string>();
  
  // Secondary index: lexicalPath -> functionId
  private byLexical = new Map<string, string>();
  
  // Fallback index: filePath|className|name -> functionId[] (for overloads)
  private byClassName = new Map<string, string[]>();
  
  // Loose index: filePath|name -> functionId[] (method name only)
  private byFileName = new Map<string, string[]>();
  
  // Line-based lookup for better matching
  private byFileNameWithLines = new Map<string, Array<{ id: string; startLine: number }>>();
  
  // Declaration node to function ID mapping for symbol resolution
  private byDeclaration = new Map<Node, string>();
  
  // Store function metadata for additional lookups
  private functions = new Map<string, FunctionMetadata>();

  /**
   * Build all indexes from function metadata
   */
  build(functions: Map<string, FunctionMetadata>): void {
    this.clear();
    this.functions = new Map(functions);
    
    for (const [id, func] of functions) {
      const normalizedPath = this.normalizePath(func.filePath);
      
      // Strategy 1: Exact match (filePath + startLine + className + name)
      const exactKey = `${normalizedPath}|${func.startLine}|${func.className || ''}|${func.name}`;
      this.byExact.set(exactKey, id);
      
      // Strategy 2: Lexical path match
      if (func.lexicalPath) {
        this.byLexical.set(func.lexicalPath, id);
      }
      
      // Strategy 3: Class method match (filePath + className + name)
      if (func.className) {
        const classKey = `${normalizedPath}|${func.className}|${func.name}`;
        this.pushToArray(this.byClassName, classKey, id);
      }
      
      // Strategy 4: File + name match (filePath + name)
      const fileNameKey = `${normalizedPath}|${func.name}`;
      this.pushToArray(this.byFileName, fileNameKey, id);
      
      // Strategy 5: File + name with line info for proximity matching
      this.pushToArray(this.byFileNameWithLines, fileNameKey, { id, startLine: func.startLine });
    }
  }

  /**
   * Resolve candidate to function ID using optimized lookup strategies
   * Replaces the 5-pass linear search with O(1) map lookups
   */
  resolve(candidate: MethodInfo): string | undefined {
    const normalizedPath = this.normalizePath(candidate.filePath);
    
    // Strategy 1: Exact match (highest priority)
    const exactKey = `${normalizedPath}|${candidate.startLine}|${candidate.className || ''}|${candidate.name}`;
    const exactMatch = this.byExact.get(exactKey);
    if (exactMatch) return exactMatch;
    
    // Strategy 2: Lexical path match (build expected lexical path)
    const relativePath = this.getRelativePath(candidate.filePath);
    const expectedLexicalPath = candidate.className 
      ? `${relativePath}#${candidate.className}.${candidate.name}`
      : `${relativePath}#${candidate.name}`;
    const lexicalMatch = this.byLexical.get(expectedLexicalPath);
    if (lexicalMatch) return lexicalMatch;
    
    // Strategy 3: Class method match
    if (candidate.className) {
      const classKey = `${normalizedPath}|${candidate.className}|${candidate.name}`;
      const classCandidates = this.byClassName.get(classKey);
      if (classCandidates?.length) {
        return classCandidates[0]; // Take first match for now
      }
    }
    
    // Strategy 4: File + name with line proximity
    const fileNameKey = `${normalizedPath}|${candidate.name}`;
    const fileNameCandidates = this.byFileNameWithLines.get(fileNameKey);
    if (fileNameCandidates?.length) {
      // Find closest match by line number
      return this.findClosestByLine(fileNameCandidates, candidate.startLine);
    }
    
    // Strategy 5: Fallback to simple file + name match
    const simpleCandidates = this.byFileName.get(fileNameKey);
    if (simpleCandidates?.length) {
      return simpleCandidates[0]; // Take first match as fallback
    }
    
    return undefined;
  }
  
  /**
   * Get function ID by declaration node for symbol resolution
   * This is used by the symbol resolver to map AST nodes to function IDs
   */
  getIdByDeclaration(decl: Node): string | undefined {
    return this.byDeclaration.get(decl);
  }

  /**
   * Register declaration node → functionId mapping
   * Call this once per discovered function during analysis
   */
  registerDeclaration(functionId: string, decl: Node): void {
    this.byDeclaration.set(decl, functionId);
  }

  /**
   * Clear all indexes
   */
  clear(): void {
    this.byExact.clear();
    this.byLexical.clear();
    this.byClassName.clear();
    this.byFileName.clear();
    this.byFileNameWithLines.clear();
    this.byDeclaration.clear();
    this.functions.clear();
  }

  /**
   * Get index statistics for debugging
   */
  getStats(): {
    exactEntries: number;
    lexicalEntries: number;
    classNameEntries: number;
    fileNameEntries: number;
  } {
    return {
      exactEntries: this.byExact.size,
      lexicalEntries: this.byLexical.size,
      classNameEntries: this.byClassName.size,
      fileNameEntries: this.byFileName.size,
    };
  }

  /**
   * Normalize file path for consistent lookup
   */
  private normalizePath(filePath: string): string {
    return path.normalize(filePath).replace(/\\/g, '/');
  }

  /**
   * Helper to push value to array in map
   */
  private pushToArray<T>(map: Map<string, T[]>, key: string, value: T): void {
    const existing = map.get(key);
    if (existing) {
      existing.push(value);
    } else {
      map.set(key, [value]);
    }
  }

  /**
   * Find function ID closest to target line number
   */
  private findClosestByLine(candidates: Array<{ id: string; startLine: number }>, targetLine: number): string {
    let bestMatch = candidates[0];
    let bestDistance = Math.abs(bestMatch.startLine - targetLine);
    
    for (let i = 1; i < candidates.length; i++) {
      const distance = Math.abs(candidates[i].startLine - targetLine);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = candidates[i];
      }
    }
    
    return bestMatch.id;
  }

  /**
   * Get relative path from current working directory
   */
  private getRelativePath(filePath: string): string {
    try {
      const cwd = process.cwd();
      return path.relative(cwd, filePath);
    } catch {
      // Preserve directory structure by keeping last two path segments
      const parts = filePath.split(path.sep);
      return parts.length > 1 ? parts.slice(-2).join(path.sep) : parts[0];
    }
  }
}
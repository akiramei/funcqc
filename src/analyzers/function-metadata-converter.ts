/**
 * Function Metadata Converter - Performance optimization utility
 * 
 * Converts FunctionInfo (from BASIC analysis) to FunctionMetadata (for Call Graph analysis)
 * using semanticId as lightweight key to avoid duplicate function ID generation.
 */

import { FunctionInfo } from '../types';
import type { FunctionMetadata } from './ideal-call-graph-analyzer';
import { getRelativePath } from '../utils/path-utils';
import { toUnifiedProjectPath } from '../utils/path-normalizer';

export interface ConversionResult {
  metadataMap: Map<string, FunctionMetadata>;
  semanticIdMap: Map<string, string>; // semanticId → function.id
}

export class FunctionMetadataConverter {
  /**
   * Convert FunctionInfo array to FunctionMetadata map with semantic ID mapping
   * Reuses existing function IDs to avoid duplicate SHA-256 hash calculations
   */
  static convert(functions: FunctionInfo[]): ConversionResult {
    const metadataMap = new Map<string, FunctionMetadata>();
    const semanticIdMap = new Map<string, string>();
    
    for (const func of functions) {
      // Register semanticId → function.id mapping for lightweight lookup
      semanticIdMap.set(func.semanticId, func.id);
      
      // Convert FunctionInfo to FunctionMetadata
      // Normalize file path to unified project-root path: '/src/...' (POSIX separators, leading slash)
      // If already unified-like (starts with '/'), keep as-is (after POSIX slash conversion)
      const normalizedFilePath = toUnifiedProjectPath(func.filePath);

      const metadata: FunctionMetadata = {
        id: func.id, // Reuse existing UUID (no recalculation)
        name: func.name,
        filePath: normalizedFilePath,
        lexicalPath: this.buildLexicalPath(func),
        nodeKind: func.functionType || 'function',
        isExported: func.isExported,
        isMethod: func.isMethod,
        isStatic: func.isStatic,
        signature: func.signature,
        startLine: func.startLine,
        endLine: func.endLine,
        contentHash: func.contentId || func.astHash || func.signatureHash || func.semanticId,
        // Extract className from contextPath for constructor resolution
        ...(func.className && { className: func.className }),
        ...(!func.className && func.contextPath && func.contextPath.length > 0 && { className: func.contextPath[0] })
      };
      
      metadataMap.set(func.id, metadata);
    }
    
    return { metadataMap, semanticIdMap };
  }

  /**
   * Build lexical path from FunctionInfo
   * Format: relativePath#contextPath.functionName
   */
  private static buildLexicalPath(func: FunctionInfo): string {
    const relativePath = getRelativePath(func.filePath);
    
    // Build context path from contextPath array
    const contextParts: string[] = [];
    
    if (func.contextPath && func.contextPath.length > 0) {
      contextParts.push(...func.contextPath);
    }
    
    // Add function name
    const functionName = func.name || `anonymous_${func.startLine}`;
    
    if (contextParts.length > 0) {
      return `${relativePath}#${contextParts.join('.')}.${functionName}`;
    } else {
      return `${relativePath}#${functionName}`;
    }
  }

  /**
   * Create semantic ID based function lookup map
   * Replaces file-path:line based lookup with semantic ID lookup
   */
  static createSemanticLookupMap(functions: FunctionInfo[]): Map<string, string> {
    const lookupMap = new Map<string, string>();
    
    for (const func of functions) {
      // Primary key: semanticId
      lookupMap.set(func.semanticId, func.id);
      
      // Fallback key: filePath:startLine (for compatibility)
      const fallbackKey = `${func.filePath}:${func.startLine}`;
      lookupMap.set(fallbackKey, func.id);
      
      // Additional key: filePath:startLine:startColumn (for precision)
      const precisionKey = `${func.filePath}:${func.startLine}:${func.startColumn}`;
      lookupMap.set(precisionKey, func.id);
    }
    
    return lookupMap;
  }

  /**
   * Validate conversion result consistency
   * Returns validation result and error messages for caller to handle logging
   */
  static validateConversion(originalFunctions: FunctionInfo[], result: ConversionResult): { 
    isValid: boolean; 
    errors: string[] 
  } {
    const errors: string[] = [];

    // Check for duplicate IDs in input
    const seen = new Set<string>();
    const dupIds: string[] = [];
    for (const f of originalFunctions) {
      if (seen.has(f.id)) dupIds.push(f.id);
      else seen.add(f.id);
    }
    if (dupIds.length > 0) {
      errors.push(`Duplicate FunctionInfo IDs detected: ${Array.from(new Set(dupIds)).slice(0,5).join(', ')}${dupIds.length>5?'...':''}`);
    }

    if (originalFunctions.length !== result.metadataMap.size) {
      errors.push(`Conversion size mismatch: ${originalFunctions.length} → ${result.metadataMap.size}`);
    }

    if (originalFunctions.length !== result.semanticIdMap.size) {
      errors.push(`Semantic ID map size mismatch: ${originalFunctions.length} → ${result.semanticIdMap.size}`);
    }

    // Validate ID consistency
    for (const func of originalFunctions) {
      const convertedId = result.semanticIdMap.get(func.semanticId);
      if (convertedId !== func.id) {
        errors.push(`ID mismatch for ${func.name}: expected ${func.id}, got ${convertedId}`);
      }

      const metadata = result.metadataMap.get(func.id);
      if (!metadata) {
        errors.push(`Missing metadata for function ${func.name} (${func.id})`);
      }
    }

    return { isValid: errors.length === 0, errors };
  }
}

/**
 * Function ID Generator - Centralized function identification system
 * 
 * Provides consistent function ID generation across all analyzers
 * to ensure foreign key constraints are satisfied.
 */

import { Node } from 'ts-morph';
import * as crypto from 'crypto';
import { getRelativePath } from './path-utils';

/**
 * Cache for memoizing function ID generation results
 */
const functionIdCache = new Map<string, string>();

export class FunctionIdGenerator {
  /**
   * Generate unique function ID using position-enhanced lexical path
   * Format: lexicalPath:startLine:startColumn
   */
  static generateId(
    lexicalPath: string,
    startLine: number,
    startColumn: number
  ): string {
    return `${lexicalPath}:${startLine}:${startColumn}`;
  }

  /**
   * Generate ID from ts-morph node with content-based stability
   * @deprecated Use generateDeterministicUUID instead for new code
   */
  static generateFromNode(
    node: Node,
    lexicalPath: string
  ): string {
    // Create a stable hash from the function's content and position
    const startLine = node.getStartLineNumber();
    const startColumn = node.getStart() - node.getStartLinePos();
    const nodeStart = node.getStart();
    
    // Use content hash for maximum stability across multiple scans
    const content = node.getFullText().trim();
    const contentHash = crypto.createHash('md5').update(content).digest('hex');
    
    // Create a deterministic identifier combining position and content
    const uniqueString = `${lexicalPath}:${startLine}:${startColumn}:${nodeStart}:${contentHash}`;
    const stableHash = crypto.createHash('md5').update(uniqueString).digest('hex');
    
    // Return a shortened hash for readability
    return stableHash.substring(0, 16);
  }

  /**
   * Generate deterministic UUID with same precision as UUID v4
   * Creates a stable, reproducible ID based on function location and context
   * Returns UUID format string (36 chars with hyphens)
   * 
   * IMPORTANT: This generates a "physical ID" that is unique per snapshot
   * by including snapshotId to avoid duplicate key violations.
   */
  static generateDeterministicUUID(
    filePath: string,
    functionName: string,
    className: string | null,
    startLine: number,
    startColumn: number,
    snapshotId: string
  ): string {
    // Normalize file path to ensure cross-environment stability
    const normalizedPath = getRelativePath(filePath);
    
    // Combine all identifying information (including snapshotId for uniqueness)
    const cacheKey = [
      normalizedPath,
      className || '',
      functionName,
      startLine.toString(),
      startColumn.toString(),
      snapshotId
    ].join(':');
    
    // Check cache first
    const cachedResult = functionIdCache.get(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }
    
    // Generate SHA-256 hash (256 bits), take first 128 bits for UUID
    const hashHex = crypto.createHash('sha256').update(cacheKey).digest('hex');
    const bytes = Buffer.from(hashHex.slice(0, 32), 'hex'); // 16 bytes = 128 bits
    
    // Set RFC 4122 version 5 (name-based) and variant bits for proper UUID format
    bytes[6] = (bytes[6] & 0x0f) | 0x50; // Version 5 (0101xxxx)
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant RFC 4122 (10xxxxxx)
    
    const hex = bytes.toString('hex');
    const uuid = [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32)
    ].join('-');
    
    // Store in cache
    functionIdCache.set(cacheKey, uuid);
    
    return uuid;
  }

  /**
   * Generate deterministic UUID from ts-morph Node
   * Convenience method that extracts required information from Node
   * Includes proper getter/setter/constructor naming normalization
   */
  static generateDeterministicUUIDFromNode(
    node: Node,
    filePath: string,
    snapshotId: string,
    className: string | null = null
  ): string {
    // Extract function name with proper normalization for consistency across analyzers
    let functionName = '<anonymous>';
    if (Node.isGetAccessorDeclaration(node)) {
      functionName = `get_${node.getName()}`;
    } else if (Node.isSetAccessorDeclaration(node)) {
      functionName = `set_${node.getName()}`;
    } else if (Node.isConstructorDeclaration(node) || node.getKindName() === 'Constructor') {
      functionName = 'constructor';
    } else if ('getName' in node && typeof node.getName === 'function') {
      functionName = node.getName() || '<anonymous>';
    }
    
    const startLine = node.getStartLineNumber();
    const startColumn = node.getStart() - node.getStartLinePos();
    
    return this.generateDeterministicUUID(
      filePath,
      functionName,
      className,
      startLine,
      startColumn,
      snapshotId
    );
  }

  /**
   * Build lexical path for method
   * Format: relativePath#ClassName.methodName
   */
  static buildMethodPath(
    filePath: string,
    className: string,
    methodName: string
  ): string {
    const relativePath = getRelativePath(filePath);
    return `${relativePath}#${className}.${methodName}`;
  }


  /**
   * Parse function ID to extract components
   * Note: Hash-based IDs are not parseable, this method is for legacy compatibility
   */
  static parseId(functionId: string): {
    lexicalPath: string;
    startLine: number;
    startColumn: number;
    nodeStart?: number;
  } | null {
    // If it's a hash-based ID (16 hex characters), it's not parseable
    if (/^[a-f0-9]{16}$/.test(functionId)) {
      return null;
    }

    const parts = functionId.split(':');
    if (parts.length < 3) {
      return null;
    }

    // Handle both old format (3 parts) and new format (4 parts)
    if (parts.length >= 4) {
      // New format: lexicalPath:startLine:startColumn:nodeStart
      const startLine = parseInt(parts[parts.length - 3], 10);
      const startColumn = parseInt(parts[parts.length - 2], 10);
      const nodeStart = parseInt(parts[parts.length - 1], 10);
      const lexicalPath = parts.slice(0, -3).join(':');

      if (isNaN(startLine) || isNaN(startColumn) || isNaN(nodeStart)) {
        return null;
      }

      return {
        lexicalPath,
        startLine,
        startColumn,
        nodeStart
      };
    } else {
      // Old format: lexicalPath:startLine:startColumn
      const startLine = parseInt(parts[parts.length - 2], 10);
      const startColumn = parseInt(parts[parts.length - 1], 10);
      const lexicalPath = parts.slice(0, -2).join(':');

      if (isNaN(startLine) || isNaN(startColumn)) {
        return null;
      }

      return {
        lexicalPath,
        startLine,
        startColumn
      };
    }
  }
}
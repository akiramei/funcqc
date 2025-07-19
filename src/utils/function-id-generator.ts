/**
 * Function ID Generator - Centralized function identification system
 * 
 * Provides consistent function ID generation across all analyzers
 * to ensure foreign key constraints are satisfied.
 */

import { Node } from 'ts-morph';
import * as path from 'path';
import * as crypto from 'crypto';

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
   * Build lexical path for method
   * Format: relativePath#ClassName.methodName
   */
  static buildMethodPath(
    filePath: string,
    className: string,
    methodName: string
  ): string {
    const relativePath = this.getRelativePath(filePath);
    return `${relativePath}#${className}.${methodName}`;
  }

  /**
   * Extract relative path from absolute file path
   */
  static getRelativePath(filePath: string): string {
    try {
      const cwd = process.cwd();
      return path.relative(cwd, filePath);
    } catch {
      return path.basename(filePath);
    }
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
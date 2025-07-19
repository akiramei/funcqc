/**
 * Function ID Generator - Centralized function identification system
 * 
 * Provides consistent function ID generation across all analyzers
 * to ensure foreign key constraints are satisfied.
 */

import { Node } from 'ts-morph';
import * as path from 'path';

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
   * Generate ID from ts-morph node
   */
  static generateFromNode(
    node: Node,
    lexicalPath: string
  ): string {
    const startLine = node.getStartLineNumber();
    const startColumn = node.getStart() - node.getStartLinePos();
    const nodeStart = node.getStart(); // Absolute character position for extra uniqueness
    
    // Use both lexical path and absolute position for maximum uniqueness
    return `${lexicalPath}:${startLine}:${startColumn}:${nodeStart}`;
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
   */
  static parseId(functionId: string): {
    lexicalPath: string;
    startLine: number;
    startColumn: number;
    nodeStart?: number;
  } | null {
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
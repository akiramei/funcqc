import { FunctionInfo } from '../types';
import { Node, SourceFile } from 'ts-morph';

export interface EntryPoint {
  functionId: string;
  reason: 'exported' | 'main' | 'test' | 'cli' | 'handler' | 'index';
}

/**
 * Detects entry points in the codebase
 * Entry points are functions that are called from outside the analyzed codebase
 */
export class EntryPointDetector {
  private readonly testFilePatterns = [
    /\.test\.(ts|tsx|js|jsx)$/,
    /\.spec\.(ts|tsx|js|jsx)$/,
    /__tests__\//,
    /test\//,
  ];

  private readonly cliFilePatterns = [
    /cli\.ts$/,
    /cli\/.*\.ts$/,
    /bin\/.*\.(ts|js)$/,
    /scripts\/.*\.(ts|js)$/,
  ];

  private readonly handlerPatterns = [
    /handler/i,
    /controller/i,
    /route/i,
    /endpoint/i,
  ];

  private readonly mainFilePatterns = [
    /index\.(ts|tsx|js|jsx)$/,
    /main\.(ts|tsx|js|jsx)$/,
    /app\.(ts|tsx|js|jsx)$/,
  ];

  private readonly httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'use'];
  private readonly httpObjects = ['app', 'router', 'server'];

  /**
   * Detect all entry points from a list of functions
   */
  detectEntryPoints(functions: FunctionInfo[]): EntryPoint[] {
    const entryPoints: EntryPoint[] = [];
    
    for (const func of functions) {
      const reasons = this.getEntryPointReasons(func);
      
      // A function can be an entry point for multiple reasons
      for (const reason of reasons) {
        entryPoints.push({
          functionId: func.id,
          reason,
        });
      }
    }

    return entryPoints;
  }

  /**
   * Determine why a function is an entry point
   */
  private getEntryPointReasons(func: FunctionInfo): EntryPoint['reason'][] {
    const reasons: EntryPoint['reason'][] = [];

    // Note: Export functions are NOT automatically considered entry points
    // They need to be explicitly used or fall into other categories
    // This allows detection of unused export functions

    // Check file patterns
    const filePath = func.filePath;
    
    if (this.isTestFile(filePath)) {
      reasons.push('test');
    }

    if (this.isCliFile(filePath)) {
      reasons.push('cli');
    }

    if (this.isMainFile(filePath)) {
      // Check if it's a top-level function in main/index file
      if (!func.contextPath || func.contextPath.length === 0) {
        reasons.push('main');
      }
    }

    // Check function name patterns for handlers
    if (this.isHandlerFunction(func.name)) {
      reasons.push('handler');
    }

    // Special case: functions in index files are often entry points
    if (this.mainFilePatterns.some(pattern => pattern.test(filePath)) && func.isExported) {
      if (!reasons.includes('index')) {
        reasons.push('index');
      }
    }

    return reasons;
  }

  /**
   * Check if a file is a test file
   */
  private isTestFile(filePath: string): boolean {
    return this.testFilePatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Check if a file is a CLI file
   */
  private isCliFile(filePath: string): boolean {
    return this.cliFilePatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Check if a file is a main entry file
   */
  private isMainFile(filePath: string): boolean {
    return this.mainFilePatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Check if a function name suggests it's a handler
   */
  private isHandlerFunction(functionName: string): boolean {
    return this.handlerPatterns.some(pattern => pattern.test(functionName));
  }

  /**
   * Advanced entry point detection using AST analysis
   * This can detect callbacks, event handlers, and other patterns
   */
  detectAdvancedEntryPoints(
    sourceFile: SourceFile,
    functions: Map<string, FunctionInfo>
  ): EntryPoint[] {
    const advancedEntryPoints: EntryPoint[] = [];

    // Detect functions passed as callbacks to external libraries
    sourceFile.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expression = node.getExpression();
        
        // Check for common patterns like addEventListener, app.get, etc.
        if (Node.isPropertyAccessExpression(expression)) {
          const propertyName = expression.getName();
          if (!propertyName) return;
          const objectName = expression.getExpression().getText();

          // Event listeners
          if (propertyName === 'addEventListener' || propertyName === 'on') {
            const args = node.getArguments();
            if (args.length >= 2) {
              const callbackArg = args[1];
              const functionId = this.extractFunctionId(callbackArg, functions);
              if (functionId) {
                advancedEntryPoints.push({
                  functionId,
                  reason: 'handler',
                });
              }
            }
          }

          // Express/HTTP handlers
          if (this.httpMethods.includes(propertyName) &&
              this.httpObjects.includes(objectName)) {
            const args = node.getArguments();
            // Find callback arguments (usually the last one or multiple)
            for (let i = 1; i < args.length; i++) {
              const functionId = this.extractFunctionId(args[i], functions);
              if (functionId) {
                advancedEntryPoints.push({
                  functionId,
                  reason: 'handler',
                });
              }
            }
          }
        }

        // setTimeout, setInterval
        const callName = expression.getText();
        if (callName === 'setTimeout' || callName === 'setInterval') {
          const args = node.getArguments();
          if (args.length >= 1) {
            const functionId = this.extractFunctionId(args[0], functions);
            if (functionId) {
              advancedEntryPoints.push({
                functionId,
                reason: 'handler',
              });
            }
          }
        }
      }
    });

    return advancedEntryPoints;
  }

  /**
   * Extract function ID from a node (if it references a function)
   */
  private extractFunctionId(
    node: Node,
    functions: Map<string, FunctionInfo>
  ): string | null {
    if (Node.isIdentifier(node)) {
      const name = node.getText();
      // Find function by name
      for (const [id, info] of functions.entries()) {
        if (info.name === name) {
          return id;
        }
      }
    }

    // Handle arrow functions and function expressions
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const startLine = node.getStartLineNumber();
      const endLine = node.getEndLineNumber();
      
      // Find function by position
      for (const [id, info] of functions.entries()) {
        if (info.startLine === startLine && info.endLine === endLine) {
          return id;
        }
      }
    }

    return null;
  }
}
import { FunctionInfo } from '../types';
import { Node, SourceFile } from 'ts-morph';
import { PathNormalizer } from '../utils/path-normalizer';
import { ArchitectureConfigManager } from '../config/architecture-config';

export interface EntryPoint {
  functionId: string;
  reason: 'exported' | 'main' | 'test' | 'cli' | 'handler' | 'index' | 'layer' | 'static-method';
  layerName?: string; // For layer-based entry points
  className?: string; // For static method entry points
}

export interface EntryPointDetectionOptions {
  verbose?: boolean;
  debug?: boolean;
  layerEntryPoints?: string[]; // Layer names to treat as entry points
  excludeStaticMethods?: boolean; // Exclude static methods from entry points
}

/**
 * Detects entry points in the codebase
 * Entry points are functions that are called from outside the analyzed codebase
 */
export class EntryPointDetector {
  private options: EntryPointDetectionOptions;
  private layerPatterns: Map<string, string[]> | null = null;
  private readonly testFilePatterns = [
    /\.test\.[jt]sx?$/,        // .test.ts, .test.js, .test.tsx, .test.jsx
    /\.spec\.[jt]sx?$/,        // .spec.ts, .spec.js, .spec.tsx, .spec.jsx
    /(\/|\\)__tests__(\/|\\)/, // /__tests__/ or \__tests__\ (Windows/Unix)
    /(\/|\\)test(\/|\\)/,      // /test/ or \test\ (Windows/Unix)
    /(\/|\\)tests(\/|\\)/,     // /tests/ or \tests\ (Windows/Unix)
    /(\/|\\)e2e(\/|\\)/,       // /e2e/ or \e2e\ (Windows/Unix)
    /cypress\//,               // Cypress test files
    /playwright\//,            // Playwright test files
    /vitest\//,                // Vitest test files
    /jest\//,                  // Jest test files
    /\.integration\.[jt]sx?$/, // .integration.ts, .integration.js, etc.
    /\.e2e\.[jt]sx?$/,         // .e2e.ts, .e2e.js, etc.
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

  constructor(options: EntryPointDetectionOptions = {}) {
    this.options = options;
    
    // Load architecture configuration if layer entry points are specified
    if (options.layerEntryPoints && options.layerEntryPoints.length > 0) {
      this.loadLayerPatterns();
    }
  }

  /**
   * Load layer patterns from architecture configuration
   */
  private loadLayerPatterns(): void {
    try {
      const configManager = new ArchitectureConfigManager();
      const archConfig = configManager.load();
      
      this.layerPatterns = new Map();
      
      // Load patterns for requested layers
      for (const layerName of this.options.layerEntryPoints || []) {
        if (archConfig.layers[layerName]) {
          const layerConfig = archConfig.layers[layerName];
          const patterns = Array.isArray(layerConfig) ? layerConfig : layerConfig.patterns;
          this.layerPatterns.set(layerName, patterns);
        } else {
          console.warn(`⚠️  Layer '${layerName}' not found in architecture configuration`);
        }
      }
      
      if (this.options.debug) {
        console.log(`📋 Loaded layer patterns for: ${Array.from(this.layerPatterns.keys()).join(', ')}`);
      }
    } catch (error) {
      console.warn('⚠️  Failed to load architecture configuration for layer entry points:', error instanceof Error ? error.message : error);
      if (this.options.debug) {
        console.error('Full error:', error);
      }
    }
  }

  /**
   * Detect all entry points from a list of functions
   */
  detectEntryPoints(functions: FunctionInfo[]): EntryPoint[] {
    const entryPoints: EntryPoint[] = [];
    const testFileStats = { files: 0, functions: 0 };
    
    if (this.options.debug) {
      console.log('🔍 Entry Point Detection Debug:');
    }
    
    for (const func of functions) {
      const reasons = this.getEntryPointReasons(func);
      
      // Track test file statistics for debugging
      if (this.isTestFile(func.filePath)) {
        if (testFileStats.files === 0 || !entryPoints.some(ep => 
          PathNormalizer.areEqual(functions.find(f => f.id === ep.functionId)?.filePath || '', func.filePath)
        )) {
          testFileStats.files++;
        }
        testFileStats.functions++;
      }
      
      // A function can be an entry point for multiple reasons
      for (const reason of reasons) {
        const entryPoint: EntryPoint = {
          functionId: func.id,
          reason,
        };
        
        // Add layer name if this is a layer-based entry point
        if (reason === 'layer' && this.layerPatterns) {
          const layerName = this.getLayerForFunction(func);
          if (layerName) {
            entryPoint.layerName = layerName;
          }
        }

        // Add class name if this is a static method entry point
        if (reason === 'static-method') {
          const className = func.className ??
            (func.contextPath && func.contextPath.length > 0 ? func.contextPath[0] : undefined);
          if (className) {
            entryPoint.className = className;
          }
        }
        
        entryPoints.push(entryPoint);
        
        if (this.options.debug) {
          if (reason === 'test') {
            console.log(`  📋 Test entry point: ${func.name} (${func.filePath}:${func.startLine})`);
          } else if (reason === 'layer') {
            console.log(`  🏷️  Layer entry point: ${func.name} (layer: ${entryPoint.layerName})`);
          }
        }
      }
    }

    if (this.options.verbose || this.options.debug) {
      console.log(`📊 Entry Point Detection Summary:`);
      console.log(`  Total entry points: ${entryPoints.length}`);
      console.log(`  Test files detected: ${testFileStats.files}`);
      console.log(`  Test functions as entry points: ${testFileStats.functions}`);
      
      const reasonCounts = entryPoints.reduce((acc, ep) => {
        acc[ep.reason] = (acc[ep.reason] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      console.log(`  Breakdown by reason:`, reasonCounts);
    }

    return entryPoints;
  }

  /**
   * Determine why a function is an entry point
   */
  private getEntryPointReasons(func: FunctionInfo): EntryPoint['reason'][] {
    const reasons: EntryPoint['reason'][] = [];

    // Check if this is a static method first
    const isStatic = this.isStaticMethod(func);
    if (isStatic && !this.options.excludeStaticMethods) {
      reasons.push('static-method');
      if (this.options.debug) {
        console.log(`  📋 Static method entry point: ${func.contextPath}.${func.name} (${func.filePath}:${func.startLine})`);
      }
    }

    // 🔧 CRITICAL FIX: Exported functions should be considered entry points
    // This prevents false positives where internal functions called by exports are marked as unreachable
    if (func.isExported) {
      reasons.push('exported');
    }

    // Check file patterns
    const filePath = func.filePath;
    
    // Note: This marks test file functions as entry points, but the real issue
    // with dead code detection is in CallGraphAnalyzer not tracking cross-file calls.
    // See DCD-001 and DCD-002 for details.
    if (this.isTestFile(filePath)) {
      reasons.push('test');
      // No need to check other patterns for test files - they are all entry points
      return reasons;
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

    // Check if function belongs to any specified layers
    if (this.layerPatterns && this.layerPatterns.size > 0) {
      const layerName = this.getLayerForFunction(func);
      if (layerName) {
        reasons.push('layer');
      }
    }

    return reasons;
  }

  /**
   * Check if a file is a test file
   */
  private isTestFile(filePath: string): boolean {
    const isTest = this.testFilePatterns.some(pattern => pattern.test(filePath));
    
    if (this.options.debug && isTest) {
      const matchedPattern = this.testFilePatterns.find(pattern => pattern.test(filePath));
      console.log(`  🧪 Test file detected: ${filePath} (pattern: ${matchedPattern})`);
    }
    
    return isTest;
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
   * Check if a function is a static method
   */
  private isStaticMethod(func: FunctionInfo): boolean {
    // Only class methods explicitly marked as static
    return (
      func.isMethod === true &&
      (func.isStatic === true || func.modifiers?.includes('static') === true)
    );
  }

  /**
   * Get the layer name for a function based on its file path
   */
  private getLayerForFunction(func: FunctionInfo): string | null {
    if (!this.layerPatterns) return null;
    
    const normalizedPath = PathNormalizer.normalize(func.filePath);
    
    for (const [layerName, patterns] of this.layerPatterns) {
      for (const pattern of patterns) {
        // Convert glob pattern to regex
        const regexPattern = this.globToRegex(pattern);
        if (regexPattern.test(normalizedPath)) {
          if (this.options.debug) {
            console.log(`  🏷️  Function ${func.name} in ${func.filePath} matches layer '${layerName}'`);
          }
          return layerName;
        }
      }
    }
    
    return null;
  }

  /**
   * Convert glob pattern to regex
   */
  private globToRegex(glob: string): RegExp {
    // Normalize path separators
    glob = glob.replace(/\\/g, '/');
    
    // Escape special regex characters except * and **
    let regex = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    
    // Replace ** with regex for any directory depth
    regex = regex.replace(/\*\*/g, '.*');
    
    // Replace remaining * with regex for any characters except /
    regex = regex.replace(/\*/g, '[^/]*');
    
    // Ensure the pattern matches from the beginning
    if (!regex.startsWith('^')) {
      regex = '.*' + regex;
    }
    
    return new RegExp(regex);
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
import { FunctionInfo, CallEdge } from '../types';
import { DependencyUtils } from '../utils/dependency-utils';
import { Logger } from '../utils/cli-utils';
import { FunctionClassifier } from '../utils/function-classifier';
import { 
  AnalysisCandidate, 
  CandidateGenerator, 
  AnalysisFoundationData, 
  DependencyAnalysisOptions 
} from './dependency-analysis-engine';
import { TypeAwareDeletionSafety, TypeAwareDeletionInfo } from './type-aware-deletion-safety';

/**
 * Safe Deletion Candidate with specialized properties
 */
export interface SafeDeletionCandidate extends AnalysisCandidate {
  reason: 'unreachable' | 'no-high-confidence-callers' | 'isolated';
  callersCount: number;
  sourceLines: string[];
  typeInfo?: TypeAwareDeletionInfo;
}

/**
 * Candidate Generator for Safe Deletion Analysis
 * 
 * Implements the CandidateGenerator interface to integrate with DependencyAnalysisEngine.
 * Uses the proven safe-delete logic for identifying deletion candidates.
 */
export class SafeDeletionCandidateGenerator implements CandidateGenerator<SafeDeletionCandidate> {
  private logger: Logger;
  private typeAwareSafety: TypeAwareDeletionSafety;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger(false, false);
    this.typeAwareSafety = new TypeAwareDeletionSafety(this.logger);
  }
  
  /**
   * Generate safe deletion candidates using high-confidence analysis
   */
  async generateCandidates(
    _functions: FunctionInfo[],
    _highConfidenceEdges: CallEdge[],
    foundationData: AnalysisFoundationData,
    config: DependencyAnalysisOptions
  ): Promise<SafeDeletionCandidate[]> {
    
    console.time('processCandidates');
    
    const candidates: SafeDeletionCandidate[] = [];
    const stats = { 
      skippedAnonymous: 0, 
      skippedInternal: 0, 
      skippedTypeProtected: 0,
      skippedStaticMethod: 0,
      skippedTestFunction: 0
    };

    // Set up type-aware safety analysis
    if (foundationData.storage) {
      this.typeAwareSafety.setStorage(foundationData.storage);
    }
    
    // Process only truly unreachable functions
    for (const functionId of foundationData.reachabilityResult.unreachable) {
      const func = foundationData.functionsById.get(functionId);
      if (!func) continue;

      const skipReason = await this.shouldSkipFunction(func, config, foundationData);
      if (skipReason) {
        this.updateSkipStats(stats, skipReason);
        continue;
      }

      // DISABLED: Type-aware deletion safety uses heuristics and speculation
      // Only use actual call graph data for deletion decisions
      // 
      // Reasoning: Functions should only be protected if they are:
      // 1. Actually called (detected by call graph analysis)
      // 2. Entry points (detected by entry point analysis)  
      // 3. Genuinely unsafe to delete (anonymous callbacks, etc.)
      //
      // Type information should NOT be used for speculative protection
      // as it leads to false positives and prevents legitimate dead code removal
      
      let typeInfo: TypeAwareDeletionInfo | undefined;
      // Skip type-aware protection entirely - rely on call graph analysis only

      const callers = foundationData.reverseCallGraph.get(functionId) || new Set();
      const highConfidenceCallersSet = foundationData.highConfidenceEdgeMap.get(functionId) || new Set();
      const highConfidenceCallers = Array.from(callers).filter(callerId => 
        highConfidenceCallersSet.has(callerId)
      );

      // 🔧 FIXED: Improved deletion reason logic
      let reason: SafeDeletionCandidate['reason'] = 'unreachable';
      let confidenceScore = 1.0;
      
      // If function is truly unreachable from entry points, it's safe to delete
      if (callers.size === 0) {
        reason = 'unreachable';
        confidenceScore = 1.0;
      } else if (highConfidenceCallers.length === 0) {
        // Has callers but none are high-confidence - conservative approach
        reason = 'no-high-confidence-callers';
        confidenceScore = 0.90;
      } else {
        // 🚨 CRITICAL: If there are high-confidence callers, this function should NOT be unreachable
        // This indicates a bug in reachability analysis - skip this function
        if (config.verbose) {
          console.warn(`⚠️  Function ${func.name} marked as unreachable but has ${highConfidenceCallers.length} high-confidence callers. Skipping deletion.`);
        }
        continue;
      }

      // Skip source line loading in dry run mode for performance
      const sourceLines = config.dryRun ? [] : await this.extractSourceLines(func);

      const candidate: SafeDeletionCandidate = {
        functionInfo: func,
        reason,
        confidenceScore,
        callersCount: callers.size,
        sourceLines,
        analysisReason: `Function is ${reason}`,
        metadata: {
          reason,
          callersCount: callers.size,
          highConfidenceCallers: highConfidenceCallers.length,
          typeProtection: typeInfo?.protectionReason || 'none',
          typeEvidence: typeInfo ? {
            interfaceCount: typeInfo.evidenceStrength.interfaceCount,
            classCount: typeInfo.evidenceStrength.classCount,
            overrideCount: typeInfo.evidenceStrength.overrideCount,
            compatibilityScore: typeInfo.signatureCompatibility?.compatibilityScore || 0,
            protectionScore: typeInfo.confidenceScore
          } : null
        },
        estimatedImpact: DependencyUtils.estimateImpact(func, callers.size)
      };

      if (typeInfo) {
        candidate.typeInfo = typeInfo;
      }

      candidates.push(candidate);
    }
    
    console.timeEnd('processCandidates');
    
    // Log safety check summary (only if verbose or if significant skips occurred)
    if (config.verbose || stats.skippedAnonymous > 0 || stats.skippedInternal > 0 || stats.skippedTypeProtected > 0) {
      this.logger.info(
        `Safety checks: ${stats.skippedAnonymous} anonymous functions, ` +
        `${stats.skippedInternal} internal functions, ` +
        `${stats.skippedTypeProtected} type-protected functions`
      );
    }
    
    // Sort candidates by confidence score and impact (safer deletions first)
    const sortedCandidates = this.sortDeletionCandidates(candidates);
    return sortedCandidates;
  }

  /**
   * Extract source lines for a function
   */
  private async extractSourceLines(func: FunctionInfo): Promise<string[]> {
    try {
      const fs = await import('fs/promises');
      const fileContent = await fs.readFile(func.filePath, 'utf8');
      const lines = fileContent.split('\n');
      return lines.slice(func.startLine - 1, func.endLine);
    } catch (error) {
      return [`// Error reading source: ${error}`];
    }
  }

  /**
   * Sort deletion candidates by confidence score and impact
   */
  private sortDeletionCandidates(candidates: SafeDeletionCandidate[]): SafeDeletionCandidate[] {
    return candidates.sort((a, b) => {
      // Primary sort: confidence score (higher first)
      if (a.confidenceScore !== b.confidenceScore) {
        return b.confidenceScore - a.confidenceScore;
      }
      
      // Secondary sort: impact (lower first - safer to delete)
      const impactOrder = { low: 0, medium: 1, high: 2 };
      return impactOrder[a.estimatedImpact] - impactOrder[b.estimatedImpact];
    });
  }

  /**
   * Check if a function is an inline anonymous function (likely used as callback)
   * This is a critical safety check to prevent deletion of callbacks passed to
   * higher-order functions like map, filter, reduce, forEach, etc.
   */
  private isInlineAnonymousFunction(func: FunctionInfo): boolean {
    // Check if the function is anonymous or arrow function
    const isAnonymous = !func.name || 
                        func.name === 'anonymous' || 
                        func.name === '<anonymous>' ||
                        func.name === '' ||
                        /^anonymous_\d+/.test(func.name) ||  // Actual pattern used in funcqc
                        /^arrow_\d+/.test(func.name) ||      // Common pattern for unnamed arrow functions
                        /^__\d+/.test(func.name);            // Another common pattern
    
    // Conservative approach: ALL anonymous functions are excluded from deletion
    // This is because we cannot reliably determine if they are used as callbacks
    // without proper call graph analysis that tracks function arguments
    return isAnonymous;
  }

  /**
   * Check if a function is an internal helper function that should not be deleted
   * Uses existing call edge data to determine if non-exported functions are actually called within the same file
   * Falls back to AST analysis if call graph data is incomplete
   * @deprecated Currently disabled to allow more aggressive deletion detection
   */
  private async isInternalHelperFunction(func: FunctionInfo, foundationData: AnalysisFoundationData): Promise<boolean> {
    // Skip if function is exported (exported functions can be safely analyzed)
    if (func.isExported) {
      return false;
    }

    // Check if the function is actually called within the same file using existing call edge data
    // This bypasses potential CallGraphAnalyzer issues while being more precise than blanket protection
    return await this.isCalledWithinFile(func, foundationData);
  }

  /**
   * Check if a function is called within its own file using internal call edges data
   * Falls back to existing call edge data, then AST analysis if needed
   */
  private async isCalledWithinFile(func: FunctionInfo, foundationData: AnalysisFoundationData): Promise<boolean> {
    // Primary: Check internal call edges table for intra-file calls
    // This is the most reliable method for snapshot-consistent analysis
    try {
      const storage = foundationData.storage;
      if (storage && 'isInternalFunctionCalled' in storage && foundationData.snapshotId) {
        const isInternallyCalled = await (storage as import('../types').StorageAdapter).isInternalFunctionCalled(func.id, foundationData.snapshotId);
        this.logger.debug(`Function ${func.name} internal call check: ${isInternallyCalled} (internal_call_edges)`);
        return isInternallyCalled; // Trust the internal_call_edges result completely
      }
    } catch (error) {
      this.logger.debug(`Internal call edge check failed for ${func.name}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Fallback: Use existing call edge data (backward compatibility)
    const callers = foundationData.reverseCallGraph.get(func.id) || new Set();
    if (callers.size > 0) {
      // Check if any caller is in the same file
      for (const callerId of callers) {
        const callerFunc = foundationData.functionsById.get(callerId);
        if (callerFunc && callerFunc.filePath === func.filePath) {
          this.logger.debug(`Function ${func.name} is called within file (call_edges)`);
          return true;
        }
      }
      // Found callers but none in same file
      return false;
    }

    // No call graph data available - assume not called within file
    this.logger.debug(`No call edges found for ${func.name}, assuming not called within file`);
    return false;
  }

  /**
   * Check if a function is a factory method that should be protected from deletion
   * Factory methods are often called via property access which is hard to track statically
   * @deprecated Temporarily disabled to allow more aggressive deletion detection
   */
  private async isFactoryMethod(_func: FunctionInfo): Promise<boolean> {
    // Skip if function is exported (exported functions can be safely analyzed)
    if (_func.isExported) {
      return false;
    }

    // Check if this function could be part of an object factory pattern
    return (await this.hasFactoryFunctionInFile(_func.filePath)) && this.isCommonObjectMethod(_func.name);
  }

  /**
   * Check if a function is used as a worker entry point
   * Worker files have special patterns that call functions at the top level
   */
  private async isWorkerEntryFunction(func: FunctionInfo): Promise<boolean> {
    // Skip if function is exported (exported functions can be safely analyzed)
    if (func.isExported) {
      return false;
    }

    // Check if this is a worker file and function is called at top level
    return await this.isInWorkerFile(func.filePath, func.name);
  }

  /**
   * Check if a file is a worker file and contains worker entry patterns
   */
  private async isInWorkerFile(filePath: string, functionName: string): Promise<boolean> {
    // Cache this check per file-function to avoid repeated file reading
    if (!this.workerEntryCache) {
      this.workerEntryCache = new Map();
    }

    const cacheKey = `${filePath}:${functionName}`;
    const cached = this.workerEntryCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const fs = await import('fs');
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Check if this is a worker file (contains worker-specific APIs)
      const workerIndicators = [
        'parentPort',
        'workerData', 
        'worker_threads',
        'isMainThread',
        'threadId'
      ];

      const isWorkerFile = workerIndicators.some(indicator => content.includes(indicator));
      if (!isWorkerFile) {
        this.workerEntryCache.set(cacheKey, false);
        return false;
      }

      // Look for worker entry patterns that call the specific function
      const workerEntryPatterns = [
        // Direct function call in worker context
        new RegExp(`if\\s*\\(\\s*parentPort\\s*&&\\s*workerData\\s*\\)[\\s\\S]*?${functionName}\\s*\\(`),
        
        // Function call in worker conditional
        new RegExp(`if\\s*\\([^)]*(?:parentPort|workerData)[^)]*\\)[\\s\\S]*?${functionName}\\s*\\(`),
        
        // Top-level function call in worker
        new RegExp(`(?:^|\\n)\\s*${functionName}\\s*\\([^)]*workerData`),
        
        // Worker message handler calling function
        new RegExp(`parentPort\\.on\\s*\\([^)]*\\)[\\s\\S]*?${functionName}\\s*\\(`),
        
        // Process message calling function
        new RegExp(`process\\.on\\s*\\(\\s*['"]message['"]\\s*[\\s\\S]*?${functionName}\\s*\\(`),
        
        // Function called with worker data
        new RegExp(`${functionName}\\s*\\([^)]*workerData`),
        
        // Function in worker promise chain
        new RegExp(`${functionName}\\s*\\([^)]*\\)\\s*\\.then`),
      ];

      const hasWorkerEntry = workerEntryPatterns.some(pattern => pattern.test(content));
      this.workerEntryCache.set(cacheKey, hasWorkerEntry);
      return hasWorkerEntry;
    } catch {
      // If file reading fails, be conservative and assume it might be a worker entry
      this.workerEntryCache.set(cacheKey, true);
      return true;
    }
  }

  /**
   * Check if a function is a local/nested function defined within another function
   * Local functions are often used for recursion or as helpers but hard to track
   */
  private isLocalFunction(func: FunctionInfo): boolean {
    // Check if this function has a high nesting level (likely inside another function)
    if (func.nestingLevel && func.nestingLevel > 0) {
      return true;
    }

    // Check if function type indicates it's local
    if (func.functionType === 'local') {
      return true;
    }

    // Check if the function name suggests it's a local helper
    if (this.isLocalFunctionName(func.name)) {
      return true;
    }

    // Check if the function is an arrow function (often used for local functions)
    if (func.isArrowFunction) {
      return true;
    }

    // CRITICAL: Check if function is in a class context but not a method
    // This catches const declarations inside class methods
    if (func.contextPath && func.contextPath.length > 0 && !func.isMethod && !func.isConstructor) {
      return true;
    }

    return false;
  }

  /**
   * Check if a function name suggests it's a local helper function
   */
  private isLocalFunctionName(name: string): boolean {
    // Common local function names
    const localFunctionPatterns = [
      // Visitor pattern functions
      'visit', 'visitor', 'traverse', 'walk',
      
      // Helper functions
      'helper', 'util', 'internal', 'inner',
      
      // Recursive functions
      'recurse', 'loop', 'iterate',
      
      // Processing functions
      'process', 'handle', 'check', 'validate',
      
      // Calculation functions
      'calc', 'calculate', 'compute', 'eval',
      
      // Anonymous/generated names (common in transpiled code)
      'anonymous', 'lambda', 'closure',
      
      // Common local variable names used for functions
      'fn', 'func', 'callback', 'cb', 'handler'
    ];
    
    // Check exact matches
    if (localFunctionPatterns.includes(name)) {
      return true;
    }
    
    // Check if name starts with common local prefixes
    const localPrefixes = ['_', 'inner', 'local', 'helper', 'temp'];
    if (localPrefixes.some(prefix => name.startsWith(prefix))) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if a function is used as a direct reference (passed as argument without calling)
   * Examples: map(functionName), setTimeout(functionName), callback references
   */
  private async isFunctionReference(func: FunctionInfo): Promise<boolean> {
    // Skip if function is exported (exported functions can be safely analyzed)
    if (func.isExported) {
      return false;
    }

    // Check if this function name appears as a direct reference in the file
    return await this.hasFunctionReferencePattern(func.filePath, func.name);
  }

  /**
   * Check if a file contains function reference patterns
   */
  private async hasFunctionReferencePattern(filePath: string, functionName: string): Promise<boolean> {
    // Cache this check per file-function to avoid repeated file reading
    if (!this.functionReferenceCache) {
      this.functionReferenceCache = new Map();
    }

    const cacheKey = `${filePath}:${functionName}`;
    const cached = this.functionReferenceCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const fs = await import('fs');
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Look for function reference patterns (function name without parentheses)
      const referencePatterns = [
        // Array method callbacks: .map(functionName), .filter(functionName), etc.
        new RegExp(`\\.(?:map|filter|reduce|forEach|find|some|every|sort)\\s*\\(\\s*${functionName}\\s*[,)]`),
        
        // setTimeout/setInterval: setTimeout(functionName, ...)
        new RegExp(`(?:setTimeout|setInterval)\\s*\\(\\s*${functionName}\\s*,`),
        
        // Event listeners: addEventListener('event', functionName)
        new RegExp(`addEventListener\\s*\\([^,]+,\\s*${functionName}\\s*[,)]`),
        
        // Promise methods: .then(functionName), .catch(functionName)
        new RegExp(`\\.(?:then|catch|finally)\\s*\\(\\s*${functionName}\\s*[,)]`),
        
        // Function assignment: const fn = functionName
        new RegExp(`(?:const|let|var)\\s+\\w+\\s*=\\s*${functionName}\\s*[;,]`),
        
        // Object property assignment: { prop: functionName }
        new RegExp(`\\w+\\s*:\\s*${functionName}\\s*[,}]`),
        
        // Function arguments: someFunction(functionName, ...)
        new RegExp(`\\w+\\s*\\(\\s*${functionName}\\s*[,)]`),
        
        // Return statement: return functionName
        new RegExp(`return\\s+${functionName}\\s*[;,}]`),
        
        // Logical operators: functionName || defaultFunction
        new RegExp(`${functionName}\\s*(?:\\|\\||&&|\\?)`),
      ];

      const hasReference = referencePatterns.some(pattern => pattern.test(content));
      this.functionReferenceCache.set(cacheKey, hasReference);
      return hasReference;
    } catch {
      // If file reading fails, be conservative and assume function is referenced
      this.functionReferenceCache.set(cacheKey, true);
      return true;
    }
  }

  /**
   * Check if a function is defined in an object literal that gets returned or exported
   * These functions are accessed via property references which are hard to track
   */
  private async isObjectLiteralFunction(func: FunctionInfo): Promise<boolean> {
    // Skip if function is exported (exported functions can be safely analyzed)
    if (func.isExported) {
      return false;
    }

    // Check if this function is in a file that has object literal patterns
    return await this.hasObjectLiteralPattern(func.filePath, func.name);
  }

  /**
   * Check if a file contains object literal patterns with function properties
   */
  private async hasObjectLiteralPattern(filePath: string, functionName: string): Promise<boolean> {
    // Cache this check per file-function to avoid repeated file reading
    if (!this.objectLiteralCache) {
      this.objectLiteralCache = new Map();
    }

    const cacheKey = `${filePath}:${functionName}`;
    const cached = this.objectLiteralCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const fs = await import('fs');
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Look for object literal patterns that include the function name
      const objectLiteralPatterns = [
        // const/let obj = { functionName: ... }
        new RegExp(`(?:const|let|var)\\s+\\w+\\s*=\\s*\\{[\\s\\S]*?${functionName}\\s*:`),
        
        // return { functionName: ... }
        new RegExp(`return\\s*\\{[\\s\\S]*?${functionName}\\s*:`),
        
        // } as SomeInterface or } as const
        new RegExp(`\\{[\\s\\S]*?${functionName}\\s*:[\\s\\S]*?\\}\\s*as\\s+`),
        
        // Object method shorthand: { functionName() { ... } }
        new RegExp(`\\{[\\s\\S]*?${functionName}\\s*\\([^)]*\\)\\s*\\{`),
        
        // Object property with arrow function: { functionName: () => ... }
        new RegExp(`\\{[\\s\\S]*?${functionName}\\s*:\\s*\\([^)]*\\)\\s*=>`),
        
        // Object property with async function: { functionName: async ... }
        new RegExp(`\\{[\\s\\S]*?${functionName}\\s*:\\s*async\\s+`),
      ];

      const hasPattern = objectLiteralPatterns.some(pattern => pattern.test(content));
      this.objectLiteralCache.set(cacheKey, hasPattern);
      return hasPattern;
    } catch {
      // If file reading fails, be conservative and assume it might be in object literal
      this.objectLiteralCache.set(cacheKey, true);
      return true;
    }
  }

  /**
   * Check if a function is a callback function in an object literal
   * These are typically passed as configuration options to libraries
   */
  private isCallbackFunction(func: FunctionInfo): boolean {
    // Skip if function is exported (exported functions can be safely analyzed)
    if (func.isExported) {
      return false;
    }

    // Check if this looks like a callback function name
    if (this.isCommonCallbackName(func.name)) {
      return true;
    }

    // Check if this is an arrow function or anonymous function (likely callbacks)
    if (func.isArrowFunction || this.isInlineAnonymousFunction(func)) {
      return true;
    }

    return false;
  }

  /**
   * Check if a function name matches common callback patterns
   */
  private isCommonCallbackName(name: string): boolean {
    // Common callback function names used in configuration objects
    const callbackPatterns = [
      // Size/memory calculation callbacks
      'sizeCalculation', 'calculateSize', 'getSize',
      
      // Event handlers
      'onSuccess', 'onError', 'onComplete', 'onFailure', 'onProgress',
      'onChange', 'onClick', 'onSubmit', 'onFocus', 'onBlur',
      'onLoad', 'onUnload', 'onReady',
      
      // Lifecycle callbacks
      'beforeCreate', 'afterCreate', 'beforeUpdate', 'afterUpdate',
      'beforeDelete', 'afterDelete', 'beforeSave', 'afterSave',
      
      // Validation/transformation callbacks
      'validate', 'transform', 'filter', 'map', 'reduce',
      'serialize', 'deserialize', 'format', 'parse',
      
      // Custom handlers
      'handler', 'callback', 'listener', 'processor',
      'resolver', 'rejecter', 'executor',
      
      // Configuration callbacks
      'configure', 'setup', 'init', 'dispose', 'cleanup',
      'factory', 'creator', 'builder', 'getter', 'setter',
      
      // Comparison/sorting callbacks
      'compare', 'sort', 'equals', 'match',
      
      // Stream/data processing callbacks
      'processBatch', 'processItem', 'processData',
      'onData', 'onEnd', 'onClose', 'onFinish'
    ];
    
    return callbackPatterns.includes(name);
  }

  /**
   * Check if a function is a method in a class that gets instantiated
   * Classes with 'new ClassName()' calls should have their methods protected
   */
  private async isInstantiatedClassMethod(func: FunctionInfo): Promise<boolean> {
    // Only check methods (not standalone functions)
    if (!func.isMethod && !func.isConstructor) {
      return false;
    }

    // Skip if function is exported (exported functions can be safely analyzed)
    if (func.isExported) {
      return false;
    }

    // Check if the class containing this method is instantiated somewhere
    const className = func.className || (func.contextPath && func.contextPath[0]);
    if (!className) {
      return false;
    }

    return await this.isClassInstantiated(className, func.filePath);
  }

  /**
   * Check if a class is instantiated with 'new ClassName()' pattern
   */
  private async isClassInstantiated(className: string, filePath: string): Promise<boolean> {
    // Cache this check per class to avoid repeated file reading
    if (!this.instantiatedClassCache) {
      this.instantiatedClassCache = new Map();
    }

    const cacheKey = `${filePath}:${className}`;
    const cached = this.instantiatedClassCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const fs = await import('fs');
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Look for 'new ClassName(' patterns
      const instantiationPatterns = [
        new RegExp(`new\\s+${className}\\s*\\(`),                    // new ClassName(
        new RegExp(`new\\s+${className}\\s*<[^>]*>\\s*\\(`),        // new ClassName<T>(
        new RegExp(`:\\s*${className}\\s*=\\s*new\\s+${className}`), // : ClassName = new ClassName
      ];

      const isInstantiated = instantiationPatterns.some(pattern => pattern.test(content));
      this.instantiatedClassCache.set(cacheKey, isInstantiated);
      return isInstantiated;
    } catch {
      // If file reading fails, be conservative and assume class is instantiated
      this.instantiatedClassCache.set(cacheKey, true);
      return true;
    }
  }

  /**
   * Check if the file contains factory function patterns
   */
  private async hasFactoryFunctionInFile(filePath: string): Promise<boolean> {
    // Cache this check per file to avoid repeated file reading
    if (!this.factoryFileCache) {
      this.factoryFileCache = new Map();
    }

    const cached = this.factoryFileCache.get(filePath);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const fs = await import('fs');
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Look for factory function patterns in the file
      const factoryPatterns = [
        /const\s+\w*(create|make|build|get)\w*\s*=\s*\(\s*\)\s*:\s*\w+\s*=>\s*\(/,  // const createDummyPool = (): Type => ({
        /function\s+\w*(create|make|build|get)\w*\s*\(\s*\)\s*:\s*\w+\s*\{/,         // function createDummyPool(): Type {
        /\w*(create|make|build|get)\w*\s*\(\s*\)\s*:\s*\w+\s*=>\s*\{/,               // createDummyPool(): Type => {
        /return\s*\{[\s\S]*?connect\s*:|query\s*:|end\s*:/,                         // return { connect:, query:, end:
      ];

      const hasFactory = factoryPatterns.some(pattern => pattern.test(content));
      this.factoryFileCache.set(filePath, hasFactory);
      return hasFactory;
    } catch {
      // If file reading fails, be conservative and assume it might have factories
      this.factoryFileCache.set(filePath, true);
      return true;
    }
  }

  /**
   * Check if a function name matches common object method patterns
   */
  private isCommonObjectMethod(name: string): boolean {
    // Common methods in factory-created objects
    const commonMethods = [
      // Database/Connection methods
      'connect', 'end', 'query', 'on', 'removeListener', 'off', 'emit',
      'acquireConnection', 'releaseConnection', 'beginTransaction', 'commitTransaction', 'rollbackTransaction',
      
      // Lifecycle methods
      'init', 'destroy', 'start', 'stop', 'close', 'open', 'dispose',
      
      // HTTP/API methods
      'get', 'set', 'put', 'delete', 'post', 'patch', 'head', 'options',
      
      // Stream/Event methods
      'read', 'write', 'pipe', 'unpipe', 'listen', 'unlisten',
      
      // Configuration methods
      'configure', 'setup', 'reset', 'clear', 'update',
      
      // File system methods
      'readFile', 'writeFile', 'exists', 'mkdir', 'rmdir',
      
      // Worker/Process methods
      'run', 'execute', 'process', 'handle', 'send', 'receive',
      
      // Validation/Utility methods
      'validate', 'check', 'test', 'verify', 'transform', 'parse', 'stringify',
      
      // Cache/Storage methods
      'cache', 'store', 'retrieve', 'remove', 'flush', 'evict'
    ];
    
    return commonMethods.includes(name);
  }

  // Cache for file factory pattern detection (to avoid repeated file reads)
  private factoryFileCache?: Map<string, boolean>;
  
  // Cache for class instantiation detection (to avoid repeated file reads)
  private instantiatedClassCache?: Map<string, boolean>;
  
  // Cache for object literal pattern detection (to avoid repeated file reads)
  private objectLiteralCache?: Map<string, boolean>;
  
  // Cache for function reference pattern detection (to avoid repeated file reads)
  private functionReferenceCache?: Map<string, boolean>;
  
  // Cache for worker entry pattern detection (to avoid repeated file reads)
  private workerEntryCache?: Map<string, boolean>;

  /**
   * Determine if a function should be skipped and why
   */
  private async shouldSkipFunction(func: FunctionInfo, config: DependencyAnalysisOptions, _foundationData?: AnalysisFoundationData): Promise<string | null> {
    // Apply exclusion filters
    // Skip exported functions UNLESS includeExports is true
    if (!config.includeExports && func.isExported) return 'exported';
    if (DependencyUtils.isExcludedByPattern(func.filePath, config.excludePatterns)) return null;
    if (DependencyUtils.isExternalLibraryFunction(func.filePath)) return null;

    // Use shared function classification logic
    // REMOVED: Static method skip (includeStaticMethods option doesn't exist)
    // Static methods are now handled by normal entry point detection
    
    // TEMPORARILY ALLOW: Constructor deletion for testing
    // Constructors of unused classes should be deletable
    // if (FunctionClassifier.isConstructor(func)) return 'internal';
    if (FunctionClassifier.isTestFunction(func) && config.excludeTests) return 'test-function';

    // Essential safety conditions (keep these)
    if (this.isInlineAnonymousFunction(func)) return 'anonymous';
    
    // TEMPORARILY DISABLED: Additional safety checks for testing
    // if (this.isLocalFunction(func)) return 'internal';
    // if (await this.isWorkerEntryFunction(func)) return 'internal';
    
    // REMOVED: Overly conservative speculative checks
    // These were blocking legitimate dead code deletion:
    // - isFactoryMethod: Too speculative, many legitimate unused functions
    // - isInstantiatedClassMethod: Should rely on actual call graph data
    // - isCallbackFunction: Too broad, blocks many unused functions
    // - isObjectLiteralFunction: Should rely on actual usage analysis
    // - isFunctionReference: Too speculative
    // - isInternalHelperFunction: Already covered by reachability analysis
    
    // TEMPORARILY DISABLED: Internal helper function check
    // This was blocking all 30 unused functions from being detected
    // The reachability analysis should already cover truly reachable functions
    // if (foundationData && await this.isInternalHelperFunction(func, foundationData)) return 'internal';
    
    return null; // Function can be processed
  }

  /**
   * Update skip statistics based on skip reason
   */
  private updateSkipStats(stats: { 
    skippedAnonymous: number; 
    skippedInternal: number; 
    skippedTypeProtected: number;
    skippedStaticMethod: number;
    skippedTestFunction: number;
  }, reason: string): void {
    switch (reason) {
      case 'anonymous':
        stats.skippedAnonymous++;
        break;
      case 'internal':
        stats.skippedInternal++;
        break;
      case 'static-method':
        stats.skippedStaticMethod++;
        break;
      case 'test-function':
        stats.skippedTestFunction++;
        break;
      default:
        // Unknown reason, could log or handle specially
        break;
    }
  }

}
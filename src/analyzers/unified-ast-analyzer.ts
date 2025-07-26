/**
 * Unified AST Analyzer
 * 
 * Combines TypeScript analysis and quality metrics calculation
 * to avoid duplicate AST parsing and improve performance
 */

import * as ts from 'typescript';
import { SourceFile as TsMorphSourceFile, Project, FunctionDeclaration, MethodDeclaration, ArrowFunction, FunctionExpression, ConstructorDeclaration, VariableDeclaration, ParameterDeclaration } from 'ts-morph';
import { FunctionInfo, QualityMetrics, ParameterInfo, ReturnTypeInfo } from '../types';
// import { createHash } from 'crypto'; // Now using globalHashCache
import { QualityCalculator } from '../metrics/quality-calculator';
// Option 1: Use custom LRU cache (better performance for our use case)
import { LRUCache } from '../utils/lru-cache';
import { globalHashCache } from '../utils/hash-cache';

// Option 2: Use npm lru-cache (uncomment to switch)
// import { LRUCache as NodeLRUCache } from 'lru-cache';

export interface UnifiedAnalysisResult {
  functionInfo: FunctionInfo;
  qualityMetrics: QualityMetrics;
}

export class UnifiedASTAnalyzer {
  private project: Project;
  private qualityCalculator: QualityCalculator;
  private cache: LRUCache<TsMorphSourceFile>;
  // private maxSourceFilesInMemory: number; // Stored in cache options

  constructor(maxSourceFilesInMemory: number = 50) {
    // this.maxSourceFilesInMemory = maxSourceFilesInMemory;
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      skipLoadingLibFiles: true,
      compilerOptions: {
        isolatedModules: true,
        skipLibCheck: true,
        noResolve: true,
        noLib: true,
      },
    });
    this.qualityCalculator = new QualityCalculator();
    
    // Initialize LRU cache with eviction callback
    this.cache = new LRUCache<TsMorphSourceFile>({
      maxSize: maxSourceFilesInMemory,
      onEvict: (_filePath: string, sourceFile: unknown) => {
        // Clean up ts-morph resources when evicted
        if (sourceFile && typeof sourceFile === 'object' && 'forget' in sourceFile) {
          (sourceFile as TsMorphSourceFile).forget();
        }
      }
    });
  }

  /**
   * Analyze a single file and extract all functions with quality metrics
   * in one AST traversal pass
   */
  async analyzeFile(filePath: string, content: string): Promise<UnifiedAnalysisResult[]> {
    // Get or create source file
    const sourceFile = this.getOrCreateSourceFile(filePath, content);
    const results: UnifiedAnalysisResult[] = [];

    // Process all function-like nodes in a single pass
    const functionNodes = this.getAllFunctionNodes(sourceFile);

    for (const node of functionNodes) {
      const result = this.analyzeFunction(node, filePath, content);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  private getOrCreateSourceFile(filePath: string, content: string): TsMorphSourceFile {
    const cached = this.cache.get(filePath);
    if (cached && cached.getFullText() === content) {
      return cached;
    }

    // Remove old file if exists
    const existing = this.project.getSourceFile(filePath);
    if (existing) {
      existing.forget();
    }

    const sourceFile = this.project.createSourceFile(filePath, content, { overwrite: true });
    
    // LRU cache automatically handles eviction when limit is reached
    this.cache.set(filePath, sourceFile);
    
    return sourceFile;
  }

  private getAllFunctionNodes(sourceFile: TsMorphSourceFile): Array<FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration> {
    const functions: Array<FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration> = [];
    const processedNodes = new Set<string>(); // Prevent duplicates

    // Get all function declarations (O(1) with direct API)
    const functionDecls = sourceFile.getFunctions();
    for (const func of functionDecls) {
      const nodeId = func.getFullStart() + '-' + func.getFullWidth();
      if (!processedNodes.has(nodeId)) {
        functions.push(func);
        processedNodes.add(nodeId);
      }
    }

    // Get all classes and their methods/constructors (O(1) with direct API)
    for (const classDecl of sourceFile.getClasses()) {
      const methods = classDecl.getMethods();
      for (const method of methods) {
        const nodeId = method.getFullStart() + '-' + method.getFullWidth();
        if (!processedNodes.has(nodeId)) {
          functions.push(method);
          processedNodes.add(nodeId);
        }
      }
      
      const constructors = classDecl.getConstructors();
      for (const constructor of constructors) {
        const nodeId = constructor.getFullStart() + '-' + constructor.getFullWidth();
        if (!processedNodes.has(nodeId)) {
          functions.push(constructor);
          processedNodes.add(nodeId);
        }
      }
    }

    // Get arrow functions using efficient Kind-based API
    const arrowFunctions = sourceFile.getDescendantsOfKind(ts.SyntaxKind.ArrowFunction) as ArrowFunction[];
    for (const arrowFunc of arrowFunctions) {
      const nodeId = arrowFunc.getFullStart() + '-' + arrowFunc.getFullWidth();
      if (!processedNodes.has(nodeId)) {
        functions.push(arrowFunc);
        processedNodes.add(nodeId);
      }
    }

    // Get function expressions using efficient Kind-based API
    const functionExpressions = sourceFile.getDescendantsOfKind(ts.SyntaxKind.FunctionExpression) as FunctionExpression[];
    for (const funcExpr of functionExpressions) {
      const nodeId = funcExpr.getFullStart() + '-' + funcExpr.getFullWidth();
      if (!processedNodes.has(nodeId)) {
        functions.push(funcExpr);
        processedNodes.add(nodeId);
      }
    }

    return functions;
  }

  private analyzeFunction(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration,
    filePath: string,
    _fileContent: string
  ): UnifiedAnalysisResult | null {
    try {
      // Extract function info
      const functionInfo = this.extractFunctionInfo(node, filePath);
      
      // Calculate quality metrics using the same AST node
      const qualityMetrics = this.calculateQualityMetrics(node, functionInfo);

      return {
        functionInfo,
        qualityMetrics
      };
    } catch (error) {
      console.warn(`Failed to analyze function: ${error}`);
      return null;
    }
  }

  private extractFunctionInfo(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration,
    filePath: string
  ): FunctionInfo {
    const name = this.getFunctionName(node);
    const startLine = node.getStartLineNumber();
    const endLine = node.getEndLineNumber();
    const sourceCode = node.getFullText();
    const parameters = this.extractParameters(node);
    const returnType = this.getReturnType(node);
    const isAsync = this.isAsyncFunction(node);
    const isExported = this.isExported(node);
    const modifiers = this.getModifiers(node);

    // Generate IDs using optimized hash cache
    const hashes = globalHashCache.getOrCalculateHashes(
      filePath,
      sourceCode,
      undefined, // No modification time available at this level
      this.generateSignatureText(node)
    );
    const contentId = hashes.contentHash;
    const semanticId = this.generateSemanticId(filePath, name, startLine);

    const description = this.extractJsDocDescription(node);
    const functionInfo: FunctionInfo = {
      id: contentId,
      name,
      filePath,
      startLine,
      endLine,
      sourceCode,
      parameters,
      returnType,
      isAsync,
      isExported,
      modifiers,
      metrics: {} as QualityMetrics, // Will be filled next
      semanticId,
      contentId,
      // Required fields from FunctionInfo interface  
      startColumn: 0,
      endColumn: 0,
      displayName: name,
      signature: this.generateSignatureText(node),
      astHash: hashes.astHash,
      signatureHash: hashes.signatureHash,
      fileHash: hashes.fileHash,
      isGenerator: false,
      isArrowFunction: node instanceof ArrowFunction,
      isMethod: node instanceof MethodDeclaration,
      isConstructor: node instanceof ConstructorDeclaration,
      isStatic: false
    };

    // Add description only if it exists
    if (description) {
      functionInfo.description = description;
    }

    return functionInfo;
  }

  private calculateQualityMetrics(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration,
    functionInfo: FunctionInfo
  ): QualityMetrics {
    // Use optimized path that avoids double AST generation
    return this.qualityCalculator.calculateFromTsMorphNode(node, functionInfo);
  }


  private getFunctionName(node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration): string {
    if (node instanceof ConstructorDeclaration) {
      return 'constructor';
    }

    if ('getName' in node) {
      return node.getName() || '<anonymous>';
    }

    // For arrow functions, try to get name from variable declaration
    const parent = node.getParent();
    if (parent && parent.getKind() === ts.SyntaxKind.VariableDeclaration) {
      const varDecl = parent as VariableDeclaration;
      if (varDecl.getName) {
        return varDecl.getName();
      }
    }

    return '<anonymous>';
  }

  private extractParameters(node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration): ParameterInfo[] {
    if (!('getParameters' in node)) return [];

    return node.getParameters().map((param: ParameterDeclaration, index: number) => ({
      name: param.getName(),
      type: param.getType().getText() || 'any',
      typeSimple: param.getType().getText() || 'any',
      isOptional: param.isOptional() || false,
      position: index,
      isRest: param.isRestParameter?.() || false
    }));
  }

  private getReturnType(node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration): ReturnTypeInfo {
    const typeText = ('getReturnType' in node) ? node.getReturnType().getText() : 'any';
    return {
      type: typeText,
      typeSimple: typeText,
      isPromise: typeText.includes('Promise')
    };
  }

  private isAsyncFunction(node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration): boolean {
    if ('isAsync' in node && typeof node.isAsync === 'function') {
      return node.isAsync();
    }
    return false;
  }

  private isExported(node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration): boolean {
    if (!('isExported' in node)) return false;
    return node.isExported();
  }

  private getModifiers(node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration): string[] {
    const modifiers: string[] = [];
    
    if ('isAsync' in node && typeof node.isAsync === 'function' && node.isAsync()) {
      modifiers.push('async');
    }
    if ('isStatic' in node && typeof node.isStatic === 'function' && node.isStatic()) {
      modifiers.push('static');
    }
    if ('isAbstract' in node && typeof node.isAbstract === 'function' && node.isAbstract()) {
      modifiers.push('abstract');
    }
    if ('isReadonly' in node && typeof node.isReadonly === 'function' && node.isReadonly()) {
      modifiers.push('readonly');
    }
    
    return modifiers;
  }

  private extractJsDocDescription(node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration): string | undefined {
    if (!('getJsDocs' in node)) return undefined;
    
    const jsDocs = node.getJsDocs();
    if (jsDocs.length === 0) return undefined;
    
    return jsDocs[0].getDescription().trim() || undefined;
  }

  private generateSemanticId(filePath: string, name: string, startLine: number): string {
    const data = `${filePath}#${name}#${startLine}`;
    return globalHashCache.getOrCalculateContentHash(data);
  }

  /**
   * Generate signature text for a function node
   */
  private generateSignatureText(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration
  ): string {
    const name = this.getFunctionName(node);
    
    if (!('getParameters' in node)) {
      return `${name}()`;
    }
    
    const params = node.getParameters().map(param => {
      const paramName = param.getName();
      const paramType = param.getType()?.getText() || 'any';
      const optional = param.isOptional() ? '?' : '';
      const rest = param.isRestParameter?.() ? '...' : '';
      return `${rest}${paramName}${optional}: ${paramType}`;
    }).join(', ');
    
    const returnType = ('getReturnType' in node) 
      ? node.getReturnType().getText() 
      : 'any';
    
    const asyncModifier = this.isAsyncFunction(node) ? 'async ' : '';
    
    return `${asyncModifier}${name}(${params}): ${returnType}`;
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Cleanup expired entries and get cleanup count
   */
  cleanup(): number {
    return this.cache.cleanup();
  }

  /**
   * Clear all cached source files and free memory
   */
  dispose(): void {
    this.cache.clear();
  }

  /**
   * Get hash cache statistics
   */
  getHashCacheStats() {
    return globalHashCache.getStats();
  }

  /**
   * Clear hash cache
   */
  clearHashCache(): void {
    globalHashCache.clear();
  }
}
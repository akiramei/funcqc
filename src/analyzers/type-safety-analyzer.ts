/**
 * Type Safety Analyzer for funcqc v1.6
 * 
 * Evaluates TypeScript type safety based on TypeScript best practices:
 * - Any Type Usage (40%): Penalty for `any` type usage
 * - Type Annotation Completeness (30%): All parameters and return values properly typed
 * - Type Specificity (20%): Preference for specific interfaces over generic types
 * - Return Type Explicitness (10%): Explicit return type declarations
 */

import * as ts from 'typescript';
import { FunctionInfo } from '../types';
import { TypeSafetyScore, TypeSafetyIssue } from '../types/quality-enhancements';

interface ASTContext {
  sourceFile: ts.SourceFile | undefined;
  functionNode: ts.Node | undefined;
  typeChecker: ts.TypeChecker | undefined;
  hasValidAST: boolean;
  error: string | undefined;
}

export class TypeSafetyAnalyzer {
  private readonly GENERIC_TYPES = new Set([
    'object', 'Object', 'any', 'unknown', 'Record<string, any>',
    'Record<string, unknown>', '{[key: string]: any}', '{[key: string]: unknown}'
  ]);

  private readonly UNSAFE_TYPES = new Set([
    'any', 'Function', 'Object'
  ]);

  private readonly PREFERRED_TYPE_MAPPINGS: Record<string, string> = {
    'object': 'specific interface',
    'Object': 'specific interface',
    'any': 'specific type',
    'unknown': 'specific type with type guards',
    'Function': 'specific function signature'
  };

  /**
   * Analyzes type safety for a single function
   */
  analyze(functionInfo: FunctionInfo): TypeSafetyScore {
    const issues: TypeSafetyIssue[] = [];
    
    // Parse function source code into AST for accurate analysis
    const astContext = this.parseToAST(functionInfo);
    
    // Calculate component scores using AST analysis where possible
    const anyTypeUsage = this.checkAnyTypeUsage(functionInfo, issues);
    const typeAnnotation = this.checkTypeAnnotationCompleteness(functionInfo, issues);
    const typeSpecificity = this.checkTypeSpecificity(functionInfo, issues);
    const returnTypeExplicit = this.checkReturnTypeExplicitness(functionInfo, astContext, issues);

    // Calculate overall score with weights
    const score = Math.round(
      anyTypeUsage * 0.40 +
      typeAnnotation * 0.30 +
      typeSpecificity * 0.20 +
      returnTypeExplicit * 0.10
    );

    // Calculate metrics
    const metrics = this.calculateMetrics(functionInfo);

    return {
      score: Math.max(0, Math.min(100, score)),
      components: {
        anyTypeUsage,
        typeAnnotation,
        typeSpecificity,
        returnTypeExplicit
      },
      issues,
      metrics
    };
  }

  /**
   * Checks for any type usage (40% weight)
   * Highest priority as it negates TypeScript benefits
   */
  private checkAnyTypeUsage(functionInfo: FunctionInfo, issues: TypeSafetyIssue[]): number {
    let score = 100;
    let anyTypeCount = 0;

    // Check parameters for any types
    functionInfo.parameters.forEach((param, index) => {
      if (this.isAnyType(param.type)) {
        anyTypeCount++;
        const penalty = 20; // Heavy penalty for any types
        score -= penalty;
        
        issues.push({
          type: 'any-type',
          severity: 'high',
          description: `Parameter "${param.name}" uses 'any' type`,
          points: penalty,
          suggestion: 'Define specific type or interface for this parameter',
          location: `parameter ${index + 1}`
        });
      }
    });

    // Check return type for any
    if (functionInfo.returnType && this.isAnyType(functionInfo.returnType.type)) {
      anyTypeCount++;
      const penalty = 25; // Even higher penalty for return type any
      score -= penalty;
      
      issues.push({
        type: 'any-type',
        severity: 'high',
        description: 'Return type uses \'any\' type',
        points: penalty,
        suggestion: 'Define specific return type or interface',
        location: 'return type'
      });
    }

    // Additional penalty for multiple any types
    if (anyTypeCount > 1) {
      const additionalPenalty = (anyTypeCount - 1) * 5;
      score -= additionalPenalty;
      
      issues.push({
        type: 'any-type',
        severity: 'high',
        description: `Multiple 'any' types found (${anyTypeCount} total)`,
        points: additionalPenalty,
        suggestion: 'Replace all any types with specific type definitions'
      });
    }

    return Math.max(0, score);
  }

  /**
   * Checks type annotation completeness (30% weight)
   * All parameters and return values should be properly typed
   */
  private checkTypeAnnotationCompleteness(functionInfo: FunctionInfo, issues: TypeSafetyIssue[]): number {
    let score = 100;
    let untypedCount = 0;

    // Check for untyped parameters
    functionInfo.parameters.forEach((param, index) => {
      if (!param.type || param.type.trim() === '' || param.type === 'unknown') {
        untypedCount++;
        const penalty = functionInfo.isExported ? 15 : 10; // Higher penalty for exported functions
        score -= penalty;
        
        issues.push({
          type: 'missing-annotation',
          severity: functionInfo.isExported ? 'high' : 'medium',
          description: `Parameter "${param.name}" lacks type annotation`,
          points: penalty,
          suggestion: 'Add explicit type annotation for this parameter',
          location: `parameter ${index + 1}`
        });
      }
    });

    // Check for missing return type annotation
    if (!functionInfo.returnType || !functionInfo.returnType.type || 
        functionInfo.returnType.type.trim() === '') {
      
      // Only penalize if not void/constructor and is exported or complex
      const isVoidLike = functionInfo.name === 'constructor' || 
                        this.looksLikeVoidFunction(functionInfo);
      
      if (!isVoidLike && (functionInfo.isExported || this.isComplexFunction(functionInfo))) {
        const penalty = 15;
        score -= penalty;
        
        issues.push({
          type: 'missing-annotation',
          severity: 'medium',
          description: 'Missing explicit return type annotation',
          points: penalty,
          suggestion: 'Add explicit return type annotation',
          location: 'return type'
        });
      }
    }

    // Penalty for high proportion of untyped parameters
    if (functionInfo.parameters.length > 0) {
      const untypedRatio = untypedCount / functionInfo.parameters.length;
      if (untypedRatio > 0.5) {
        const penalty = Math.round(untypedRatio * 20);
        score -= penalty;
        
        issues.push({
          type: 'missing-annotation',
          severity: 'medium',
          description: `High proportion of untyped parameters (${Math.round(untypedRatio * 100)}%)`,
          points: penalty,
          suggestion: 'Add type annotations to improve type safety'
        });
      }
    }

    return Math.max(0, score);
  }

  /**
   * Checks type specificity (20% weight)
   * Preference for specific interfaces over generic object types
   */
  private checkTypeSpecificity(functionInfo: FunctionInfo, issues: TypeSafetyIssue[]): number {
    let score = 100;

    // Check parameters for generic types
    functionInfo.parameters.forEach((param, index) => {
      if (this.isGenericType(param.type)) {
        const penalty = 8;
        score -= penalty;
        
        const preferredType = this.PREFERRED_TYPE_MAPPINGS[param.type] || 'more specific type';
        
        issues.push({
          type: 'generic-type',
          severity: 'medium',
          description: `Parameter "${param.name}" uses generic type "${param.type}"`,
          points: penalty,
          suggestion: `Consider using ${preferredType} instead`,
          location: `parameter ${index + 1}`
        });
      }
    });

    // Check return type for generic types
    if (functionInfo.returnType && this.isGenericType(functionInfo.returnType.type)) {
      const penalty = 10;
      score -= penalty;
      
      const preferredType = this.PREFERRED_TYPE_MAPPINGS[functionInfo.returnType.type] || 'more specific type';
      
      issues.push({
        type: 'generic-type',
        severity: 'medium',
        description: `Return type uses generic "${functionInfo.returnType.type}"`,
        points: penalty,
        suggestion: `Consider using ${preferredType} instead`,
        location: 'return type'
      });
    }

    // Check for unsafe type usage
    const unsafeTypes = this.findUnsafeTypes(functionInfo);
    unsafeTypes.forEach(unsafeType => {
      const penalty = 12;
      score -= penalty;
      
      issues.push({
        type: 'generic-type',
        severity: 'high',
        description: `Uses unsafe type "${unsafeType.type}"`,
        points: penalty,
        suggestion: 'Replace with type-safe alternative',
        location: unsafeType.location
      });
    });

    return Math.max(0, score);
  }

  /**
   * Checks return type explicitness (10% weight)
   * Explicit return type declarations for non-void functions
   */
  private checkReturnTypeExplicitness(functionInfo: FunctionInfo, astContext: ASTContext, issues: TypeSafetyIssue[]): number {
    let score = 100;

    // Skip constructors and void-like functions
    if (functionInfo.isConstructor || this.looksLikeVoidFunction(functionInfo)) {
      return score;
    }

    // Check if return type is explicitly declared
    if (!functionInfo.returnType || !functionInfo.returnType.type) {
      const penalty = functionInfo.isExported ? 15 : 8;
      score -= penalty;
      
      issues.push({
        type: 'implicit-return',
        severity: functionInfo.isExported ? 'medium' : 'low',
        description: 'Missing explicit return type declaration',
        points: penalty,
        suggestion: 'Add explicit return type for better code documentation and type safety',
        location: 'return type'
      });
    } else {
      // Use AST analysis for accurate implicit return type detection
      if (this.isImplicitReturnType(functionInfo, astContext)) {
        const penalty = 5;
        score -= penalty;
        
        issues.push({
          type: 'implicit-return',
          severity: 'low',
          description: 'Return type appears to be inferred rather than explicit',
          points: penalty,
          suggestion: 'Consider adding explicit return type annotation',
          location: 'return type'
        });
      }
    }

    return Math.max(0, score);
  }

  /**
   * Calculates TypeScript-specific metrics
   */
  private calculateMetrics(functionInfo: FunctionInfo): TypeSafetyScore['metrics'] {
    const anyTypeCount = this.countAnyTypes(functionInfo);
    const untypedParamCount = this.countUntypedParameters(functionInfo);
    const hasExplicitReturnType = !!(functionInfo.returnType?.type);
    const usesGenericObjectTypes = this.usesGenericObjectTypes(functionInfo);

    return {
      anyTypeCount,
      untypedParamCount,
      hasExplicitReturnType,
      usesGenericObjectTypes
    };
  }

  // =============================================================================
  // Helper Methods
  // =============================================================================

  private isAnyType(type: string): boolean {
    if (!type) return false;
    const cleanType = type.trim().toLowerCase();
    // Check for exact 'any' or 'any' as part of union types like 'any | string'
    return cleanType === 'any' || 
           cleanType.match(/\bany\b/) !== null;
  }

  private isGenericType(type: string): boolean {
    if (!type) return false;
    const cleanType = type.trim();
    
    // Check exact matches
    if (this.GENERIC_TYPES.has(cleanType)) return true;
    
    // Check for Record<string, any/unknown> patterns
    if (/Record<string,\s*(any|unknown)>/.test(cleanType)) return true;
    
    // Check for object index signatures
    if (/\{\s*\[\s*\w+\s*:\s*string\s*\]\s*:\s*(any|unknown)\s*\}/.test(cleanType)) return true;
    
    return false;
  }

  private findUnsafeTypes(functionInfo: FunctionInfo): Array<{ type: string; location: string }> {
    const unsafeTypes: Array<{ type: string; location: string }> = [];

    // Check parameters
    functionInfo.parameters.forEach((param, index) => {
      if (this.UNSAFE_TYPES.has(param.type)) {
        unsafeTypes.push({
          type: param.type,
          location: `parameter ${index + 1} (${param.name})`
        });
      }
    });

    // Check return type
    if (functionInfo.returnType && this.UNSAFE_TYPES.has(functionInfo.returnType.type)) {
      unsafeTypes.push({
        type: functionInfo.returnType.type,
        location: 'return type'
      });
    }

    return unsafeTypes;
  }

  private looksLikeVoidFunction(functionInfo: FunctionInfo): boolean {
    // Check if function likely returns void based on name patterns
    const voidPatterns = [
      /^(set|update|delete|remove|clear|reset|init|setup|configure)/i,
      /^(handle|process|execute|run|start|stop|pause)/i,
      /^(log|print|write|save|store)/i,
      /^(add|append|insert|push)/i
    ];

    return voidPatterns.some(pattern => pattern.test(functionInfo.name)) ||
           functionInfo.returnType?.type === 'void' ||
           functionInfo.returnType?.type === 'undefined';
  }

  private isComplexFunction(functionInfo: FunctionInfo): boolean {
    const complexity = functionInfo.metrics?.cyclomaticComplexity || 1;
    const lines = functionInfo.metrics?.linesOfCode || 0;
    const params = functionInfo.parameters.length;
    
    return complexity > 5 || lines > 20 || params > 3;
  }

  /**
   * Uses AST analysis to accurately determine if return type is implicit
   */
  private isImplicitReturnType(functionInfo: FunctionInfo, astContext: ASTContext): boolean {
    // If AST analysis is available, use it for accurate detection
    if (astContext.hasValidAST && astContext.functionNode) {
      return this.hasImplicitReturnTypeFromAST(astContext);
    }
    
    // Fallback to heuristic approach if AST is not available
    const returnType = functionInfo.returnType?.type;
    if (!returnType) return true;
    
    // Simple heuristics for common inferred types
    const commonInferredTypes = ['string', 'number', 'boolean', 'void', 'undefined'];
    return commonInferredTypes.includes(returnType.toLowerCase());
  }

  /**
   * Checks if function has implicit return type using AST analysis
   */
  private hasImplicitReturnTypeFromAST(astContext: ASTContext): boolean {
    if (!astContext.functionNode || !astContext.typeChecker) {
      return false;
    }
    
    const node = astContext.functionNode;
    
    // Check if function has explicit return type annotation
    if (ts.isFunctionLike(node)) {
      // If there's a type annotation, it's explicit
      if (node.type) {
        return false;
      }
      
      // If no type annotation, it's implicit
      return true;
    }
    
    // For arrow functions, check the variable declaration
    if (ts.isArrowFunction(node)) {
      const parent = node.parent;
      if (ts.isVariableDeclaration(parent)) {
        // Check if the variable has type annotation
        if (parent.type) {
          // Check if the type annotation is a function type
          return !ts.isFunctionTypeNode(parent.type) &&
                 !ts.isCallSignatureDeclaration(parent.type);
        }
        // No type annotation on variable, check the arrow function itself
        return !node.type;
      }
    }
    
    return false;
  }

  private countAnyTypes(functionInfo: FunctionInfo): number {
    let count = 0;
    
    // Count in parameters
    functionInfo.parameters.forEach(param => {
      if (this.isAnyType(param.type)) count++;
    });
    
    // Count in return type
    if (functionInfo.returnType && this.isAnyType(functionInfo.returnType.type)) {
      count++;
    }
    
    return count;
  }

  private countUntypedParameters(functionInfo: FunctionInfo): number {
    return functionInfo.parameters.filter(param => 
      !param.type || param.type.trim() === '' || param.type === 'unknown'
    ).length;
  }

  private usesGenericObjectTypes(functionInfo: FunctionInfo): boolean {
    // Check parameters
    const hasGenericInParams = functionInfo.parameters.some(param => 
      this.isGenericType(param.type)
    );
    
    // Check return type
    const hasGenericInReturn = functionInfo.returnType && 
      this.isGenericType(functionInfo.returnType.type);
    
    return hasGenericInParams || !!hasGenericInReturn;
  }

  /**
   * Analyzes a batch of functions for type safety patterns
   */
  analyzeBatch(functions: FunctionInfo[]): {
    results: Array<{ functionInfo: FunctionInfo; score: TypeSafetyScore }>;
    statistics: {
      averageScore: number;
      totalAnyTypes: number;
      untypedFunctions: number;
      functionsWithExplicitTypes: number;
      commonIssues: Array<{ type: string; count: number }>;
    };
  } {
    const results = functions.map(func => ({
      functionInfo: func,
      score: this.analyze(func)
    }));

    // Calculate statistics
    const scores = results.map(r => r.score.score);
    const averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    
    const totalAnyTypes = results.reduce((sum, r) => 
      sum + r.score.metrics.anyTypeCount, 0
    );
    
    const untypedFunctions = results.filter(r => 
      r.score.metrics.untypedParamCount > 0
    ).length;
    
    const functionsWithExplicitTypes = results.filter(r => 
      r.score.metrics.hasExplicitReturnType
    ).length;

    // Count common issues
    const issueCountMap = new Map<string, number>();
    results.forEach(r => {
      r.score.issues.forEach(issue => {
        const key = `${issue.type}-${issue.severity}`;
        issueCountMap.set(key, (issueCountMap.get(key) || 0) + 1);
      });
    });

    const commonIssues = Array.from(issueCountMap.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      results,
      statistics: {
        averageScore,
        totalAnyTypes,
        untypedFunctions,
        functionsWithExplicitTypes,
        commonIssues
      }
    };
  }

  /**
   * Parses function source code into TypeScript AST for accurate type analysis
   */
  private parseToAST(functionInfo: FunctionInfo): ASTContext {
    try {
      // Create a simple source file for parsing
      const sourceText = this.createParseableSource(functionInfo);
      const sourceFile = ts.createSourceFile(
        "temp.ts",
        sourceText,
        ts.ScriptTarget.Latest,
        true
      );
      
      // Create a basic program and type checker for type analysis
      const program = ts.createProgram(["temp.ts"], {
        target: ts.ScriptTarget.Latest,
        moduleResolution: ts.ModuleResolutionKind.NodeJs
      }, {
        getSourceFile: (fileName) => fileName === "temp.ts" ? sourceFile : undefined,
        writeFile: () => {},
        getCurrentDirectory: () => "",
        getDirectories: () => [],
        fileExists: (fileName) => fileName === "temp.ts",
        readFile: () => "",
        getCanonicalFileName: (fileName) => fileName,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
        getDefaultLibFileName: () => "lib.d.ts"
      });
      
      const typeChecker = program.getTypeChecker();
      
      // Find the function declaration/expression in the AST
      const functionNode = this.findFunctionNode(sourceFile, functionInfo.name);
      
      return {
        sourceFile,
        functionNode,
        typeChecker,
        hasValidAST: functionNode !== undefined,
        error: undefined
      };
    } catch (error) {
      return {
        sourceFile: undefined,
        functionNode: undefined,
        typeChecker: undefined,
        hasValidAST: false,
        error: error instanceof Error ? error.message : "Unknown AST parsing error"
      };
    }
  }

  /**
   * Creates parseable TypeScript source from function info
   */
  private createParseableSource(functionInfo: FunctionInfo): string {
    const name = functionInfo.name || "anonymousFunction";
    if (!name || name.trim() === "") {
      throw new Error("Function name is required for AST parsing");
    }
    const params = functionInfo.parameters?.map(p => `${p.name}: ${p.type || "any"}`).join(", ") || "";
    const returnType = functionInfo.returnType?.type || "void";
    
    if (functionInfo.isConstructor) {
      return `class TempClass { constructor(${params}) {} }`;
    } else if (functionInfo.functionType === "arrow") {
      return `const ${name} = (${params}): ${returnType} => { return undefined; };`;
    } else {
      return `function ${name}(${params}): ${returnType} { return undefined; }`;
    }
  }

  /**
   * Finds the function node in the AST
   */
  private findFunctionNode(sourceFile: ts.SourceFile, functionName: string): ts.Node | undefined {
    let result: ts.Node | undefined;
    
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
        result = node;
        return;
      }
      if (ts.isVariableDeclaration(node) && 
          node.name.kind === ts.SyntaxKind.Identifier &&
          (node.name as ts.Identifier).text === functionName &&
          node.initializer && 
          ts.isArrowFunction(node.initializer)) {
        result = node.initializer;
        return;
      }
      if (ts.isMethodDeclaration(node) && 
          node.name?.kind === ts.SyntaxKind.Identifier &&
          (node.name as ts.Identifier).text === functionName) {
        result = node;
        return;
      }
      if (ts.isConstructorDeclaration(node) && functionName === "constructor") {
        result = node;
        return;
      }
      
      ts.forEachChild(node, visit);
    };
    
    visit(sourceFile);
    return result;
  }
}

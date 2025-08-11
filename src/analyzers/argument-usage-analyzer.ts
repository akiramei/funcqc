/**
 * Argument Usage Analyzer
 * 
 * Analyzes how function arguments and their properties are used within functions.
 * Detects property access patterns, pass-through behavior, and Law of Demeter violations.
 */

import {
  Node,
  SyntaxKind,
  FunctionDeclaration,
  MethodDeclaration,
  ArrowFunction,
  FunctionExpression,
  ConstructorDeclaration,
  ParameterDeclaration,
  SourceFile
} from 'ts-morph';
import * as ts from 'typescript';
import { TypePropertyAnalyzer } from './type-property-analyzer';

export interface ArgumentUsage {
  functionId: string;
  functionName: string;
  filePath: string;
  startLine: number;
  parameterUsages: ParameterUsage[];
}

export interface ParameterUsage {
  parameterName: string;
  parameterIndex: number;
  parameterType?: string | undefined;
  actualPropertyCount?: number | undefined; // Accurate count from TypeChecker
  typeAnalysisConfidence?: 'high' | 'medium' | 'low' | undefined; // Confidence level
  localUsage: PropertyAccessInfo;
  passThrough: PassThroughInfo[];
  demeterViolations: DemeterViolation[];
}

export interface PropertyAccessInfo {
  accessedProperties: Set<string>;
  totalAccesses: number;
  accessTypes: Map<string, PropertyAccessType[]>;
  maxDepth: number;
}

export interface PassThroughInfo {
  targetFunctionName: string;
  targetParameterIndex: number;
  callSite: {
    line: number;
    column: number;
  };
  isDirectPassThrough: boolean; // true if parameter passed as-is
  passedProperties: string[]; // specific properties passed if destructured
}

export interface DemeterViolation {
  propertyChain: string[];
  depth: number;
  location: {
    line: number;
    column: number;
  };
  expression: string;
}

export type PropertyAccessType = 'read' | 'write' | 'method_call' | 'passed_through';

type FunctionNode = FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration;

/**
 * Fast analysis state for single-pass traversal
 * Minimal state management for performance
 */
class FastAnalysisState {
  // paramAliases: Map<paramId, Set<identifier>>
  private paramAliases = new Map<string, Set<string>>();
  
  // propUse: Map<paramId, Map<propKey, UsageKind>>
  private propUse = new Map<string, Map<string, Set<PropertyAccessType>>>();
  
  // passThroughEdges: Map<paramId, Array<{calleeId, argIndex, via?>
  private passThroughEdges = new Map<string, Array<{calleeId: string, argIndex: number, via?: string}>>();
  
  // maxChainDepth: Map<paramId, number> (LoD)
  private maxChainDepth = new Map<string, number>();
  
  private parameterNames: string[];
  private parameterMap: Map<string, ParameterDeclaration>;
  private typeAnalyzer?: TypePropertyAnalyzer | undefined;
  
  constructor(parameters: ParameterDeclaration[], typeAnalyzer?: TypePropertyAnalyzer) {
    this.parameterNames = parameters.map(p => p.getName());
    this.parameterMap = new Map(parameters.map(p => [p.getName(), p]));
    this.typeAnalyzer = typeAnalyzer;
    
    // Initialize maps
    for (const paramName of this.parameterNames) {
      this.paramAliases.set(paramName, new Set([paramName]));
      this.propUse.set(paramName, new Map());
      this.passThroughEdges.set(paramName, []);
      this.maxChainDepth.set(paramName, 0);
    }
  }
  
  addPropertyUsage(paramName: string, propName: string, accessType: PropertyAccessType): void {
    const propMap = this.propUse.get(paramName);
    if (propMap) {
      if (!propMap.has(propName)) {
        propMap.set(propName, new Set());
      }
      propMap.get(propName)!.add(accessType);
    }
  }
  
  addPassThrough(paramName: string, calleeId: string, argIndex: number, via?: string): void {
    const edges = this.passThroughEdges.get(paramName);
    if (edges) {
      edges.push({ calleeId, argIndex, ...(via && { via }) });
    }
  }
  
  updateMaxChainDepth(paramName: string, depth: number): void {
    const currentMax = this.maxChainDepth.get(paramName) || 0;
    if (depth > currentMax) {
      this.maxChainDepth.set(paramName, depth);
    }
  }
  
  addAlias(paramName: string, alias: string): void {
    const aliases = this.paramAliases.get(paramName);
    if (aliases) {
      aliases.add(alias);
    }
  }
  
  isParamOrAlias(identifier: string): string | null {
    for (const [paramName, aliases] of this.paramAliases) {
      if (aliases.has(identifier)) {
        return paramName;
      }
    }
    return null;
  }
  
  buildResults(): ParameterUsage[] {
    const results: ParameterUsage[] = [];
    
    for (const paramName of this.parameterNames) {
      const param = this.parameterMap.get(paramName);
      if (!param) continue;
      
      const propMap = this.propUse.get(paramName) || new Map();
      const accessedProperties = new Set(propMap.keys());
      
      // Build access types map
      const accessTypes = new Map<string, PropertyAccessType[]>();
      for (const [prop, typeSet] of propMap) {
        accessTypes.set(prop, Array.from(typeSet));
      }
      
      // Build pass-through info
      const passThrough: PassThroughInfo[] = [];
      const edges = this.passThroughEdges.get(paramName) || [];
      for (const edge of edges) {
        passThrough.push({
          targetFunctionName: edge.calleeId,
          targetParameterIndex: edge.argIndex,
          passedProperties: edge.via ? [edge.via] : [],
          callSite: { line: 0, column: 0 }, // Simplified
          isDirectPassThrough: !edge.via
        });
      }
      
      // Build demeter violations
      const maxDepth = this.maxChainDepth.get(paramName) || 0;
      const demeterViolations: DemeterViolation[] = [];
      if (maxDepth >= 3) {
        demeterViolations.push({
          propertyChain: [`${paramName}`, 'property', '...'],
          depth: maxDepth,
          location: { line: 0, column: 0 },
          expression: `${paramName}.property...` // Simplified
        });
      }
      
      // Perform accurate type analysis if TypeAnalyzer is available
      let actualPropertyCount: number | undefined;
      let typeAnalysisConfidence: 'high' | 'medium' | 'low' | undefined;
      
      if (this.typeAnalyzer) {
        try {
          const paramType = param.getType();
          const typeInfo = this.typeAnalyzer.analyzeType(paramType);
          actualPropertyCount = typeInfo.propertyCount;
          typeAnalysisConfidence = typeInfo.confidence;
        } catch (error) {
          // Fallback to string-based analysis
          const typeText = param.getTypeNode()?.getText();
          if (typeText) {
            const typeInfo = this.typeAnalyzer.analyzeTypeString(typeText);
            actualPropertyCount = typeInfo.propertyCount;
            typeAnalysisConfidence = typeInfo.confidence;
          }
        }
      }
      
      results.push({
        parameterName: paramName,
        parameterIndex: this.parameterNames.indexOf(paramName),
        parameterType: param.getTypeNode()?.getText() || undefined,
        actualPropertyCount,
        typeAnalysisConfidence,
        localUsage: {
          accessedProperties,
          accessTypes,
          totalAccesses: Array.from(propMap.values()).reduce((sum, typeSet) => sum + typeSet.size, 0),
          maxDepth
        },
        passThrough,
        demeterViolations
      });
    }
    
    return results;
  }
}

export class ArgumentUsageAnalyzer {
  /**
   * Analyze argument usage for all functions in a source file (optimized 1-pass version)
   */
  analyzeSourceFile(sourceFile: SourceFile): ArgumentUsage[] {
    const results: ArgumentUsage[] = [];
    
    // Initialize TypePropertyAnalyzer for accurate type analysis
    let typeAnalyzer: TypePropertyAnalyzer | undefined;
    try {
      const project = sourceFile.getProject();
      const typeChecker = project.getTypeChecker();
      typeAnalyzer = new TypePropertyAnalyzer(typeChecker);
    } catch (error) {
      // Continue without TypeChecker - will use fallback analysis
    }
    
    // Get all function-like nodes
    const functionNodes = this.getAllFunctionNodes(sourceFile);
    
    for (const node of functionNodes) {
      const usage = this.analyzeFunctionArgumentUsageOptimized(node, typeAnalyzer);
      if (usage) {
        results.push(usage);
      }
    }
    
    return results;
  }
  
  private getAllFunctionNodes(sourceFile: SourceFile): FunctionNode[] {
    const functions: FunctionNode[] = [];
    
    // Function declarations
    functions.push(...sourceFile.getFunctions());
    
    // Class methods and constructors
    for (const classDecl of sourceFile.getClasses()) {
      functions.push(...classDecl.getMethods());
      functions.push(...classDecl.getConstructors());
    }
    
    // Arrow functions and function expressions
    functions.push(...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction));
    functions.push(...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression));
    
    return functions;
  }
  
  /**
   * Optimized single-pass analysis using compiler node traversal
   */
  private analyzeFunctionArgumentUsageOptimized(node: FunctionNode, typeAnalyzer?: TypePropertyAnalyzer): ArgumentUsage | null {
    const parameters = node.getParameters();
    if (parameters.length === 0) return null;

    const functionName = this.getFunctionName(node);
    const filePath = node.getSourceFile().getFilePath();
    const startLine = node.getStartLineNumber();
    const functionId = `${filePath}:${startLine}:${functionName}`;

    // Fast single-pass analysis using compiler node with TypePropertyAnalyzer
    const analysisState = new FastAnalysisState(parameters, typeAnalyzer);
    const compilerNode = node.compilerNode;
    
    // Single traversal of function body only
    if (compilerNode.body) {
      this.traverseFunctionBody(compilerNode.body, analysisState);
    }

    // Convert state to parameter usage results
    const parameterUsages = analysisState.buildResults();

    return {
      functionId,
      functionName,
      filePath,
      startLine,
      parameterUsages
    };
  }

  /**
   * Fast single-pass traversal of function body using TypeScript compiler API
   * Only visits minimum required SyntaxKind nodes for performance
   */
  private traverseFunctionBody(body: ts.Node, state: FastAnalysisState): void {
    const visit = (node: ts.Node, currentDepth: number = 0): void => {
      // Early termination for deep nesting (performance guard)
      if (currentDepth > 20) return;
      
      switch (node.kind) {
        case ts.SyntaxKind.Identifier:
          // Check if this identifier is a parameter or alias
          const identifier = (node as ts.Identifier).text;
          const paramName = state.isParamOrAlias(identifier);
          if (paramName) {
            // Simple parameter reference (depth = 0)
            state.updateMaxChainDepth(paramName, 0);
          }
          break;
          
        case ts.SyntaxKind.PropertyAccessExpression:
          this.handlePropertyAccess(node as ts.PropertyAccessExpression, state, currentDepth);
          break;
          
        case ts.SyntaxKind.ElementAccessExpression:
          this.handleElementAccess(node as ts.ElementAccessExpression, state, currentDepth);
          break;
          
        case ts.SyntaxKind.CallExpression:
          this.handleCallExpression(node as ts.CallExpression, state);
          break;
          
        case ts.SyntaxKind.BindingElement:
          this.handleBindingElement(node as ts.BindingElement, state);
          break;
          
        case ts.SyntaxKind.ShorthandPropertyAssignment:
          this.handleShorthandProperty(node as ts.ShorthandPropertyAssignment, state);
          break;
          
        case ts.SyntaxKind.SpreadAssignment:
          this.handleSpreadAssignment(node as ts.SpreadAssignment, state);
          break;
      }
      
      // Continue traversal for child nodes
      ts.forEachChild(node, (child) => visit(child, currentDepth + 1));
    };
    
    visit(body);
  }
  
  private handlePropertyAccess(node: ts.PropertyAccessExpression, state: FastAnalysisState, _depth: number): void {
    // Calculate chain depth for Law of Demeter
    const chainDepth = this.calculatePropertyChainDepth(node);
    
    // Find the base expression and check if it's a parameter
    const baseExpr = this.getBaseExpression(node);
    if (baseExpr && ts.isIdentifier(baseExpr)) {
      const paramName = state.isParamOrAlias(baseExpr.text);
      if (paramName) {
        const propName = node.name.text;
        state.addPropertyUsage(paramName, propName, 'read');
        state.updateMaxChainDepth(paramName, chainDepth);
      }
    }
  }
  
  private handleElementAccess(node: ts.ElementAccessExpression, state: FastAnalysisState, _depth: number): void {
    // Similar to property access but for element access (param[key])
    const chainDepth = this.calculatePropertyChainDepth(node);
    
    const baseExpr = this.getBaseExpression(node);
    if (baseExpr && ts.isIdentifier(baseExpr)) {
      const paramName = state.isParamOrAlias(baseExpr.text);
      if (paramName) {
        // Use argument expression as property key if it's a string literal
        let propKey = 'element_access';
        if (node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) {
          propKey = node.argumentExpression.text;
        }
        state.addPropertyUsage(paramName, propKey, 'read');
        state.updateMaxChainDepth(paramName, chainDepth);
      }
    }
  }
  
  private handleCallExpression(node: ts.CallExpression, state: FastAnalysisState): void {
    // Check if any arguments are parameters (pass-through detection)
    node.arguments.forEach((arg, index) => {
      if (ts.isIdentifier(arg)) {
        const paramName = state.isParamOrAlias(arg.text);
        if (paramName) {
          // Direct parameter pass-through
          const calleeName = this.getCalleeIdentifier(node);
          if (calleeName) {
            state.addPassThrough(paramName, calleeName, index);
          }
        }
      } else if (ts.isPropertyAccessExpression(arg)) {
        // Property pass-through (e.g., f(param.x))
        const baseExpr = this.getBaseExpression(arg);
        if (baseExpr && ts.isIdentifier(baseExpr)) {
          const paramName = state.isParamOrAlias(baseExpr.text);
          if (paramName) {
            const propName = arg.name.text;
            const calleeName = this.getCalleeIdentifier(node);
            if (calleeName) {
              state.addPassThrough(paramName, calleeName, index, propName);
            }
          }
        }
      }
    });
  }
  
  private handleBindingElement(node: ts.BindingElement, _state: FastAnalysisState): void {
    // Handle destructuring assignment: const {x, y} = param
    // This creates aliases for parameter properties
    if (node.name && ts.isIdentifier(node.name)) {
      // const _aliasName = node.name.text;
      // Find the source parameter (simplified - would need more context in real implementation)
      // For now, we'll skip complex destructuring analysis
    }
  }
  
  private handleShorthandProperty(node: ts.ShorthandPropertyAssignment, state: FastAnalysisState): void {
    // Handle {param} shorthand in object literals (pass-through)
    if (ts.isIdentifier(node.name)) {
      const paramName = state.isParamOrAlias(node.name.text);
      if (paramName) {
        // This is a pass-through via object literal
        state.addPropertyUsage(paramName, node.name.text, 'passed_through');
      }
    }
  }
  
  private handleSpreadAssignment(node: ts.SpreadAssignment, state: FastAnalysisState): void {
    // Handle {...param} spread in object literals
    if (ts.isIdentifier(node.expression)) {
      const paramName = state.isParamOrAlias(node.expression.text);
      if (paramName) {
        // Spread assignment - mark as special pass-through
        state.addPropertyUsage(paramName, '*', 'passed_through');
      }
    }
  }
  
  // Helper methods for chain depth calculation and expression analysis
  private calculatePropertyChainDepth(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): number {
    let depth = 1;
    let current = node.expression;
    
    while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      depth++;
      current = current.expression;
      
      // Prevent infinite loops and excessive depth
      if (depth > 10) break;
    }
    
    return depth;
  }
  
  private getBaseExpression(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): ts.Expression | null {
    let current: ts.Expression = node;
    
    while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = current.expression;
    }
    
    return current;
  }
  
  private getCalleeIdentifier(node: ts.CallExpression): string | null {
    if (ts.isIdentifier(node.expression)) {
      return node.expression.text;
    }
    if (ts.isPropertyAccessExpression(node.expression)) {
      return node.expression.name.text;
    }
    return null;
  }

  // Legacy methods removed for optimization - using only the fast 1-pass analyzer
  
  private getFunctionName(node: FunctionNode): string {
    if (Node.isConstructorDeclaration(node)) {
      return 'constructor';
    }
    
    if ('getName' in node) {
      const name = node.getName();
      if (name) return name;
    }
    
    // For arrow functions, try to get name from variable declaration
    const parent = node.getParent();
    if (Node.isVariableDeclaration(parent)) {
      return parent.getName();
    }
    
    return '<anonymous>';
  }
  
  // getParameters method removed - using node.getParameters() directly in optimized version
}
/**
 * Argument Usage Analyzer
 * 
 * Analyzes how function arguments and their properties are used within functions.
 * Detects property access patterns, pass-through behavior, and Law of Demeter violations.
 */

import {
  Node,
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

// EXPERT #8: Bit flags for memory efficiency
export const PropertyAccessFlags = {
  READ: 1,           // 0001
  WRITE: 2,          // 0010  
  METHOD_CALL: 4,    // 0100
  PASSED_THROUGH: 8  // 1000
} as const;

// Helper functions for bitflags operations
function propertyAccessTypeToFlag(accessType: PropertyAccessType): number {
  switch (accessType) {
    case 'read': return PropertyAccessFlags.READ;
    case 'write': return PropertyAccessFlags.WRITE;
    case 'method_call': return PropertyAccessFlags.METHOD_CALL;
    case 'passed_through': return PropertyAccessFlags.PASSED_THROUGH;
  }
}

function bitflagsToPropertyAccessTypes(flags: number): PropertyAccessType[] {
  const types: PropertyAccessType[] = [];
  if (flags & PropertyAccessFlags.READ) types.push('read');
  if (flags & PropertyAccessFlags.WRITE) types.push('write');
  if (flags & PropertyAccessFlags.METHOD_CALL) types.push('method_call');
  if (flags & PropertyAccessFlags.PASSED_THROUGH) types.push('passed_through');
  return types;
}

type FunctionNode = FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration;

/**
 * Fast analysis state for single-pass traversal
 * Minimal state management for performance
 */
class FastAnalysisState {
  // paramAliases: Map<paramId, Set<identifier>>
  private paramAliases = new Map<string, Set<string>>();
  
  // EXPERT #8: BitFlags optimization - propUse: Map<paramId, Map<propKey, bitflags>>
  private propUse = new Map<string, Map<string, number>>();
  
  // OPTIMIZED: Separate immediate and delayed pass-through for efficiency
  // Immediate: Direct parameter passing (light weight)
  private immediatePassThrough = new Map<string, Array<{calleeId: string, argIndex: number}>>();
  
  // Delayed: Property-based passing (heavier analysis)
  private delayedPassThrough = new Map<string, Array<{calleeId: string, argIndex: number, property: string, depth: number}>>();
  
  // Pass-through chain tracking (limited depth for performance)
  private passThroughChains = new Map<string, number>(); // paramName -> max chain depth
  readonly MAX_CHAIN_DEPTH = 3; // Performance guard (public for access in analyzer)
  
  // Law of Demeter optimization constants
  readonly LOD_VIOLATION_THRESHOLD = 3; // Depth >= 3 is a violation
  readonly LOD_MAX_TRACK_DEPTH = 5; // Stop tracking beyond this depth for performance
  
  // maxChainDepth: Map<paramId, number> (LoD)
  private maxChainDepth = new Map<string, number>();
  private lodViolationCount = 0; // Track violations for early termination
  
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
      this.propUse.set(paramName, new Map<string, number>()); // EXPERT #8: BitFlags
      this.immediatePassThrough.set(paramName, []);
      this.delayedPassThrough.set(paramName, []);
      this.passThroughChains.set(paramName, 0);
      this.maxChainDepth.set(paramName, 0);
    }
  }
  
  addPropertyUsage(paramName: string, propName: string, accessType: PropertyAccessType): void {
    // EXPERT #8: BitFlags implementation for memory efficiency
    const propMap = this.propUse.get(paramName);
    if (propMap) {
      const currentFlags = propMap.get(propName) || 0;
      const newFlag = propertyAccessTypeToFlag(accessType);
      propMap.set(propName, currentFlags | newFlag); // OR operation to combine flags
    }
  }
  
  // Optimized: Light-weight tracking for direct pass-through
  addImmediatePassThrough(paramName: string, calleeId: string, argIndex: number): void {
    const immediates = this.immediatePassThrough.get(paramName);
    if (immediates) {
      // Simple tracking - just count and target
      immediates.push({ calleeId, argIndex });
      
      // Update chain depth (immediate = depth 1)
      const currentChain = this.passThroughChains.get(paramName) || 0;
      if (currentChain < this.MAX_CHAIN_DEPTH) {
        this.passThroughChains.set(paramName, Math.max(currentChain, 1));
      }
    }
  }
  
  // Optimized: Detailed tracking for property-based pass-through
  addDelayedPassThrough(paramName: string, calleeId: string, argIndex: number, property: string, depth: number = 1): void {
    const delayed = this.delayedPassThrough.get(paramName);
    if (delayed) {
      // Early termination if chain is too deep
      if (depth > this.MAX_CHAIN_DEPTH) {
        return;
      }
      
      // Detailed tracking with property and depth
      delayed.push({ calleeId, argIndex, property, depth });
      
      // Update chain depth
      const currentChain = this.passThroughChains.get(paramName) || 0;
      this.passThroughChains.set(paramName, Math.max(currentChain, depth));
    }
  }
  
  updateMaxChainDepth(paramName: string, depth: number): void {
    // Early termination if already beyond tracking limit
    if (depth > this.LOD_MAX_TRACK_DEPTH) {
      this.maxChainDepth.set(paramName, this.LOD_MAX_TRACK_DEPTH);
      this.lodViolationCount++;
      return;
    }
    
    const currentMax = this.maxChainDepth.get(paramName) || 0;
    if (depth > currentMax) {
      this.maxChainDepth.set(paramName, depth);
      
      // Track violations for performance monitoring
      if (depth >= this.LOD_VIOLATION_THRESHOLD) {
        this.lodViolationCount++;
      }
    }
  }
  
  // Helper to check if we should stop tracking (performance optimization)
  shouldStopLoDTracking(): boolean {
    // Stop if we've found too many violations (likely a problematic codebase)
    return this.lodViolationCount > 10;
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
      
      // EXPERT #8: Build access types map from bitflags
      const accessTypes = new Map<string, PropertyAccessType[]>();
      for (const [prop, flags] of propMap) {
        accessTypes.set(prop, bitflagsToPropertyAccessTypes(flags));
      }
      
      // Build pass-through info from separated collections
      const passThrough: PassThroughInfo[] = [];
      
      // Add immediate pass-throughs (lightweight)
      const immediates = this.immediatePassThrough.get(paramName) || [];
      for (const imm of immediates) {
        passThrough.push({
          targetFunctionName: imm.calleeId,
          targetParameterIndex: imm.argIndex,
          passedProperties: [],
          callSite: { line: 0, column: 0 }, // Simplified
          isDirectPassThrough: true
        });
      }
      
      // Add delayed pass-throughs (with property info)
      const delayed = this.delayedPassThrough.get(paramName) || [];
      for (const del of delayed) {
        passThrough.push({
          targetFunctionName: del.calleeId,
          targetParameterIndex: del.argIndex,
          passedProperties: [del.property],
          callSite: { line: 0, column: 0 }, // Simplified
          isDirectPassThrough: false
        });
      }
      
      // Build demeter violations using optimized thresholds
      const maxDepth = this.maxChainDepth.get(paramName) || 0;
      const demeterViolations: DemeterViolation[] = [];
      
      // Only track violations that exceed the threshold
      if (maxDepth >= this.LOD_VIOLATION_THRESHOLD) {
        demeterViolations.push({
          propertyChain: [`${paramName}`, 'property', '...'],
          depth: Math.min(maxDepth, this.LOD_MAX_TRACK_DEPTH), // Cap at max track depth
          location: { line: 0, column: 0 },
          expression: `${paramName}.property...` // Simplified
        });
      }
      
      // CRITICAL FIX #2: Only analyze types for USED parameters (major performance gain)
      let actualPropertyCount: number | undefined;
      let typeAnalysisConfidence: 'high' | 'medium' | 'low' | undefined;
      
      const isParameterUsed = accessedProperties.size > 0 || passThrough.length > 0;
      if (isParameterUsed && this.typeAnalyzer) {
        try {
          const paramType = param.getType();
          const typeInfo = this.typeAnalyzer.analyzeType(paramType);
          actualPropertyCount = typeInfo.propertyCount;
          typeAnalysisConfidence = typeInfo.confidence;
        } catch {
          // Fallback to string-based analysis
          const typeText = param.getTypeNode()?.getText();
          if (typeText) {
            const typeInfo = this.typeAnalyzer.analyzeTypeString(typeText);
            actualPropertyCount = typeInfo.propertyCount;
            typeAnalysisConfidence = typeInfo.confidence;
          }
        }
      }
      // For unused parameters: actualPropertyCount remains undefined, Aggregator uses heuristic fallback
      
      results.push({
        parameterName: paramName,
        parameterIndex: this.parameterNames.indexOf(paramName),
        parameterType: param.getTypeNode()?.getText() || undefined,
        actualPropertyCount,
        typeAnalysisConfidence,
        localUsage: {
          accessedProperties,
          accessTypes,
          totalAccesses: Array.from(propMap.values()).reduce((sum, flags) => {
            // EXPERT #8: Count set bits in flags (population count)
            let count = 0;
            for (let f = flags; f > 0; f >>= 1) {
              count += f & 1;
            }
            return sum + count;
          }, 0),
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
   * CRITICAL FIX #1: Accept shared TypePropertyAnalyzer for cache reuse across files
   */
  analyzeSourceFile(sourceFile: SourceFile, sharedTypeAnalyzer?: TypePropertyAnalyzer): ArgumentUsage[] {
    const results: ArgumentUsage[] = [];
    
    // CRITICAL FIX #1: Use shared TypePropertyAnalyzer (cache reuse across files)
    const typeAnalyzer = sharedTypeAnalyzer;
    
    // Get all function-like nodes
    const functionNodes = this.getAllFunctionNodes(sourceFile);
    
    // OPTIMIZATION: Early exit if no functions
    if (functionNodes.length === 0) {
      return results;
    }
    
    for (const node of functionNodes) {
      const usage = this.analyzeFunctionArgumentUsageOptimized(node, typeAnalyzer);
      if (usage) {
        results.push(usage);
      }
    }
    
    return results;
  }
  
  /**
   * CRITICAL FIX #3: Single-traversal function node collection (eliminates duplicate AST walks)
   * Expert recommendation: Use 1 compiler AST walk instead of multiple getDescendantsOfKind calls
   */
  private getAllFunctionNodes(sourceFile: SourceFile): FunctionNode[] {
    const functions: FunctionNode[] = [];
    
    const visit = (node: ts.Node): void => {
      // Check if node is a function-like construct
      if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
          ts.isConstructorDeclaration(node) || ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node)) {
        // Convert ts.Node back to ts-morph Node using position
        try {
          const morphNode = sourceFile.getDescendantAtPos(node.getStart());
          if (morphNode && (Node.isFunctionDeclaration(morphNode) || Node.isMethodDeclaration(morphNode) ||
                           Node.isConstructorDeclaration(morphNode) || Node.isFunctionExpression(morphNode) ||
                           Node.isArrowFunction(morphNode))) {
            functions.push(morphNode as FunctionNode);
          }
        } catch {
          // Skip if conversion fails
        }
      }
      
      // Continue visiting children
      node.forEachChild(visit);
    };
    
    // Single traversal starting from compiler node
    visit(sourceFile.compilerNode);
    
    return functions;
  }
  
  /**
   * Optimized single-pass analysis using compiler node traversal
   * OPTIMIZED: Pre-filter functions without parameter references in body text
   */
  private analyzeFunctionArgumentUsageOptimized(node: FunctionNode, typeAnalyzer?: TypePropertyAnalyzer): ArgumentUsage | null {
    const parameters = node.getParameters();
    if (parameters.length === 0) return null;

    const functionName = this.getFunctionName(node);
    const filePath = node.getSourceFile().getFilePath();
    const startLine = node.getStartLineNumber();
    const functionId = `${filePath}:${startLine}:${functionName}`;

    // PRECISION FIX #1: Improved pre-filter with destructuring support
    // Extract all identifiers from parameters (including destructuring patterns)
    const bodyText = node.getBodyText() ?? "";
    const allParameterIdentifiers = this.extractParameterIdentifiers(parameters);
    
    let anyParameterMentioned = false;
    for (const identifier of allParameterIdentifiers) {
      if (bodyText.indexOf(identifier) !== -1) {
        anyParameterMentioned = true;
        break;
      }
    }
    
    if (!anyParameterMentioned) {
      // Return zero-cost empty result - no parameters are used
      return this.buildEmptyUsage(functionId, functionName, filePath, startLine, parameters);
    }

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
   * OPTIMIZED: Skip child traversal for parameter property/element access chains
   */
  private traverseFunctionBody(body: ts.Node, state: FastAnalysisState): void {
    const visit = (node: ts.Node, currentDepth: number = 0): void => {
      // Early termination for deep nesting (performance guard)
      if (currentDepth > 20) return;
      
      let descend = true; // Flag to control child node traversal
      
      switch (node.kind) {
        case ts.SyntaxKind.Identifier: {
          // Check if this identifier is a parameter or alias
          const identifier = (node as ts.Identifier).text;
          const paramName = state.isParamOrAlias(identifier);
          if (paramName) {
            // Simple parameter reference (depth = 0)
            state.updateMaxChainDepth(paramName, 0);
          }
          break;
        }
          
        case ts.SyntaxKind.PropertyAccessExpression: {
          const pae = node as ts.PropertyAccessExpression;
          this.handlePropertyAccess(pae, state, currentDepth);
          
          // OPTIMIZATION: If this property chain is based on a parameter,
          // don't descend into children (already processed the entire chain)
          const baseExpr = this.getBaseExpression(pae);
          if (baseExpr && ts.isIdentifier(baseExpr)) {
            const paramName = state.isParamOrAlias(baseExpr.text);
            if (paramName) {
              descend = false; // Skip child traversal - chain already processed
            }
          }
          break;
        }
          
        case ts.SyntaxKind.ElementAccessExpression: {
          const eae = node as ts.ElementAccessExpression;
          this.handleElementAccess(eae, state, currentDepth);
          
          // OPTIMIZATION: If this element access chain is based on a parameter,
          // don't descend into children (already processed the entire chain)
          const baseExpr = this.getBaseExpression(eae);
          if (baseExpr && ts.isIdentifier(baseExpr)) {
            const paramName = state.isParamOrAlias(baseExpr.text);
            if (paramName) {
              descend = false; // Skip child traversal - chain already processed
            }
          }
          break;
        }
          
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
          
        case ts.SyntaxKind.VariableDeclaration:
          this.handleVariableDeclaration(node as ts.VariableDeclaration, state);
          break;
          
        case ts.SyntaxKind.BinaryExpression:
          this.handleBinaryExpression(node as ts.BinaryExpression, state);
          break;
      }
      
      // Continue traversal for child nodes only if not skipped by optimization
      if (descend) {
        ts.forEachChild(node, (child) => visit(child, currentDepth + 1));
      }
    };
    
    visit(body);
  }
  
  private handlePropertyAccess(node: ts.PropertyAccessExpression, state: FastAnalysisState, _depth: number): void {
    // EXPERT #7: Immediate exit if LoD tracking should stop (early termination)
    if (state.shouldStopLoDTracking()) {
      return; // Exit immediately - no further processing
    }
    
    // Find the base expression and check if it's a parameter
    const baseExpr = this.getBaseExpression(node);
    if (baseExpr && ts.isIdentifier(baseExpr)) {
      const paramName = state.isParamOrAlias(baseExpr.text);
      if (paramName) {
        // Calculate chain depth with early termination
        const chainDepth = this.calculatePropertyChainDepth(node, state.LOD_MAX_TRACK_DEPTH);
        const propName = node.name.text;
        state.addPropertyUsage(paramName, propName, 'read');
        state.updateMaxChainDepth(paramName, chainDepth);
      }
    }
  }
  
  private handleElementAccess(node: ts.ElementAccessExpression, state: FastAnalysisState, _depth: number): void {
    // EXPERT #7: Immediate exit if LoD tracking should stop (early termination)
    if (state.shouldStopLoDTracking()) {
      return; // Exit immediately - no further processing
    }
    
    const baseExpr = this.getBaseExpression(node);
    if (baseExpr && ts.isIdentifier(baseExpr)) {
      const paramName = state.isParamOrAlias(baseExpr.text);
      if (paramName) {
        // Optimized: Calculate chain depth with early termination
        const chainDepth = this.calculatePropertyChainDepth(node, state.LOD_MAX_TRACK_DEPTH);
        
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
    // Optimized pass-through detection with immediate/delayed separation
    const calleeName = this.getCalleeIdentifier(node);
    if (!calleeName) return; // Early exit if no callee
    
    node.arguments.forEach((arg, index) => {
      if (ts.isIdentifier(arg)) {
        const paramName = state.isParamOrAlias(arg.text);
        if (paramName) {
          // IMMEDIATE: Direct parameter pass-through (lightweight)
          state.addImmediatePassThrough(paramName, calleeName, index);
        }
      } else if (ts.isPropertyAccessExpression(arg)) {
        // DELAYED: Property pass-through with depth tracking
        const baseExpr = this.getBaseExpression(arg);
        if (baseExpr && ts.isIdentifier(baseExpr)) {
          const paramName = state.isParamOrAlias(baseExpr.text);
          if (paramName) {
            const propName = arg.name.text;
            const depth = this.calculatePropertyChainDepth(arg);
            
            // Only track if within depth limit (performance guard)
            if (depth <= state.MAX_CHAIN_DEPTH) {
              state.addDelayedPassThrough(paramName, calleeName, index, propName, depth);
            }
          }
        }
      }
      // Skip complex expressions for performance (spread, destructuring, etc.)
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
  
  // PRECISION FIX #2: Ultra-lightweight alias detection with destructuring support
  private handleVariableDeclaration(node: ts.VariableDeclaration, state: FastAnalysisState): void {
    if (!node.initializer) return;
    
    // Handle: const alias = param (simple alias assignment)
    if (ts.isIdentifier(node.name) && ts.isIdentifier(node.initializer)) {
      const paramName = state.isParamOrAlias(node.initializer.text);
      if (paramName) {
        const aliasName = node.name.text;
        state.addAlias(paramName, aliasName);
      }
    }
    
    // PRECISION FIX #3: Minimal destructuring support
    // Handle: const {x, y} = param
    else if (ts.isObjectBindingPattern(node.name) && ts.isIdentifier(node.initializer)) {
      const paramName = state.isParamOrAlias(node.initializer.text);
      if (paramName) {
        // Register destructured properties as aliases (x -> param.x)
        for (const element of node.name.elements) {
          if (element.name && ts.isIdentifier(element.name)) {
            const propName = element.name.text;
            state.addAlias(paramName, propName);
            // Also track as property access
            state.addPropertyUsage(paramName, propName, 'read');
          }
        }
      }
    }
    
    // Handle: const [a, b] = param
    else if (ts.isArrayBindingPattern(node.name) && ts.isIdentifier(node.initializer)) {
      const paramName = state.isParamOrAlias(node.initializer.text);
      if (paramName) {
        // Register array destructured elements as aliases
        node.name.elements.forEach((element, index) => {
          if (element && ts.isBindingElement(element) && element.name && ts.isIdentifier(element.name)) {
            const aliasName = element.name.text;
            state.addAlias(paramName, aliasName);
            // Track as array access
            state.addPropertyUsage(paramName, `[${index}]`, 'read');
          }
        });
      }
    }
  }
  
  private handleBinaryExpression(node: ts.BinaryExpression, state: FastAnalysisState): void {
    // Handle: alias = param (simple assignment)
    if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isIdentifier(node.left) && ts.isIdentifier(node.right)) {
        const paramName = state.isParamOrAlias(node.right.text);
        if (paramName) {
          const aliasName = node.left.text;
          state.addAlias(paramName, aliasName);
        }
      }
    }
  }
  
  // EXPERT APPROACH: Helper methods for chain depth calculation with early termination
  private calculatePropertyChainDepth(node: ts.PropertyAccessExpression | ts.ElementAccessExpression, maxDepth: number = 5): number {
    let depth = 1;
    let current = node.expression;
    
    // Early exit if max depth is 1 (no need to traverse)
    if (maxDepth === 1) return 1;
    
    while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      depth++;
      
      // Early termination at specified max depth
      if (depth >= maxDepth) {
        return maxDepth; // Return immediately, no need to continue
      }
      
      current = current.expression;
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

  /**
   * Build empty usage result for functions with no parameter references
   * OPTIMIZATION: Avoid expensive AST analysis when parameters are unused
   */
  private buildEmptyUsage(
    functionId: string,
    functionName: string, 
    filePath: string,
    startLine: number,
    parameters: ParameterDeclaration[]
  ): ArgumentUsage {
    const parameterUsages: ParameterUsage[] = parameters.map((param, index) => ({
      parameterName: param.getName(),
      parameterIndex: index,
      parameterType: param.getTypeNode()?.getText() ?? undefined,
      actualPropertyCount: undefined, // No type analysis needed for unused params
      typeAnalysisConfidence: undefined,
      localUsage: {
        accessedProperties: new Set<string>(), // Empty - no properties accessed
        accessTypes: new Map<string, PropertyAccessType[]>(), // Empty
        totalAccesses: 0, // No accesses
        maxDepth: 0 // No property access depth
      },
      passThrough: [], // Empty - no pass-through behavior
      demeterViolations: [] // Empty - no violations
    }));

    return {
      functionId,
      functionName,
      filePath,
      startLine,
      parameterUsages
    };
  }

  // PRECISION FIX #1: Helper method to extract all identifiers from parameters
  private extractParameterIdentifiers(parameters: ParameterDeclaration[]): string[] {
    const identifiers: string[] = [];
    
    for (const param of parameters) {
      // Primary parameter name (always include)
      const paramName = param.getName();
      if (paramName) {
        identifiers.push(paramName);
      }
      
      // Extract from binding patterns (destructuring)
      const nameNode = param.getNameNode();
      if (nameNode) {
        this.extractBindingIdentifiers(nameNode, identifiers);
      }
    }
    
    return identifiers;
  }
  
  // Helper to recursively extract identifiers from binding patterns
  private extractBindingIdentifiers(node: Node, identifiers: string[]): void {
    if (Node.isIdentifier(node)) {
      identifiers.push(node.getText());
    } else if (Node.isObjectBindingPattern(node)) {
      // Handle: {x, y, z} = param
      for (const element of node.getElements()) {
        if (Node.isBindingElement(element)) {
          const name = element.getNameNode();
          if (name && Node.isIdentifier(name)) {
            identifiers.push(name.getText());
          }
        }
      }
    } else if (Node.isArrayBindingPattern(node)) {
      // Handle: [a, b, c] = param
      for (const element of node.getElements()) {
        if (Node.isBindingElement(element)) {
          const name = element.getNameNode();
          if (name && Node.isIdentifier(name)) {
            identifiers.push(name.getText());
          }
        }
      }
    }
  }

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
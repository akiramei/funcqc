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
  PropertyAccessExpression,
  CallExpression,
  SourceFile
} from 'ts-morph';

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
  parameterType?: string;
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

export class ArgumentUsageAnalyzer {
  // Context for current analysis (stored for potential future use)
  
  /**
   * Analyze argument usage for all functions in a source file
   */
  analyzeSourceFile(sourceFile: SourceFile): ArgumentUsage[] {
    const results: ArgumentUsage[] = [];
    
    // Get all function-like nodes
    const functionNodes = this.getAllFunctionNodes(sourceFile);
    
    for (const node of functionNodes) {
      const usage = this.analyzeFunctionArgumentUsage(node);
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
  
  private analyzeFunctionArgumentUsage(node: FunctionNode): ArgumentUsage | null {
    try {
      const functionName = this.getFunctionName(node);
      const filePath = node.getSourceFile().getFilePath();
      const startLine = node.getStartLineNumber();
      
      // Generate a simple function ID based on location and name
      const functionId = `${filePath}:${startLine}:${functionName}`;
      
      const parameters = this.getParameters(node);
      const parameterUsages: ParameterUsage[] = [];
      
      for (let i = 0; i < parameters.length; i++) {
        const param = parameters[i];
        const usage = this.analyzeParameterUsage(node, param, i);
        parameterUsages.push(usage);
      }
      
      return {
        functionId,
        functionName,
        filePath,
        startLine,
        parameterUsages
      };
    } catch (error) {
      console.warn(`Failed to analyze argument usage for function: ${error}`);
      return null;
    }
  }
  
  private analyzeParameterUsage(
    functionNode: FunctionNode,
    parameter: ParameterDeclaration,
    parameterIndex: number
  ): ParameterUsage {
    const parameterName = parameter.getName();
    const parameterType = parameter.getType()?.getText();
    
    // Analyze local usage within the function body
    const localUsage = this.analyzeLocalPropertyAccess(functionNode, parameterName);
    
    // Analyze pass-through behavior
    const passThrough = this.analyzePassThrough(functionNode, parameterName);
    
    // Detect Law of Demeter violations
    const demeterViolations = this.detectDemeterViolations(functionNode, parameterName);
    
    return {
      parameterName,
      parameterIndex,
      parameterType,
      localUsage,
      passThrough,
      demeterViolations
    };
  }
  
  private analyzeLocalPropertyAccess(functionNode: FunctionNode, parameterName: string): PropertyAccessInfo {
    const body = functionNode.getBody();
    if (!body) {
      return {
        accessedProperties: new Set(),
        totalAccesses: 0,
        accessTypes: new Map(),
        maxDepth: 0
      };
    }
    
    const accessedProperties = new Set<string>();
    const accessTypes = new Map<string, PropertyAccessType[]>();
    let totalAccesses = 0;
    let maxDepth = 0;
    
    // Find all property access expressions
    const propertyAccesses = body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);
    
    for (const access of propertyAccesses) {
      const chain = this.getPropertyAccessChain(access);
      
      // Check if this access starts with our parameter
      if (chain.length > 0 && chain[0] === parameterName) {
        totalAccesses++;
        maxDepth = Math.max(maxDepth, chain.length - 1);
        
        // Record the accessed property (first level after parameter)
        if (chain.length > 1) {
          const property = chain[1];
          accessedProperties.add(property);
          
          // Determine access type
          const accessType = this.determineAccessType(access);
          const existing = accessTypes.get(property) || [];
          existing.push(accessType);
          accessTypes.set(property, existing);
        }
      }
    }
    
    return {
      accessedProperties,
      totalAccesses,
      accessTypes,
      maxDepth
    };
  }
  
  private analyzePassThrough(functionNode: FunctionNode, parameterName: string): PassThroughInfo[] {
    const body = functionNode.getBody();
    if (!body) {
      return [];
    }
    
    const passThroughInfo: PassThroughInfo[] = [];
    const callExpressions = body.getDescendantsOfKind(SyntaxKind.CallExpression);
    
    for (const call of callExpressions) {
      const args = call.getArguments();
      
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        // Check if argument is direct parameter pass-through
        if (Node.isIdentifier(arg) && arg.getText() === parameterName) {
          passThroughInfo.push({
            targetFunctionName: this.getCallTarget(call),
            targetParameterIndex: i,
            callSite: {
              line: call.getStartLineNumber(),
              column: call.getStart() - call.getStartLinePos()
            },
            isDirectPassThrough: true,
            passedProperties: []
          });
        }
        
        // Check if argument uses properties of the parameter
        if (Node.isPropertyAccessExpression(arg)) {
          const chain = this.getPropertyAccessChain(arg);
          if (chain.length > 0 && chain[0] === parameterName) {
            passThroughInfo.push({
              targetFunctionName: this.getCallTarget(call),
              targetParameterIndex: i,
              callSite: {
                line: call.getStartLineNumber(),
                column: call.getStart() - call.getStartLinePos()
              },
              isDirectPassThrough: false,
              passedProperties: chain.slice(1)
            });
          }
        }
        
        // Handle object literals and destructuring
        // TODO: Add support for { prop: param.prop } patterns
      }
    }
    
    return passThroughInfo;
  }
  
  private detectDemeterViolations(functionNode: FunctionNode, parameterName: string): DemeterViolation[] {
    const body = functionNode.getBody();
    if (!body) {
      return [];
    }
    
    const violations: DemeterViolation[] = [];
    const propertyAccesses = body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);
    
    for (const access of propertyAccesses) {
      const chain = this.getPropertyAccessChain(access);
      
      // Check if this is a deep property access on our parameter
      if (chain.length > 0 && chain[0] === parameterName && chain.length >= 3) {
        // Deep access: param.a.b.c... (depth >= 3 is considered a violation)
        violations.push({
          propertyChain: chain,
          depth: chain.length - 1,
          location: {
            line: access.getStartLineNumber(),
            column: access.getStart() - access.getStartLinePos()
          },
          expression: access.getText()
        });
      }
    }
    
    return violations;
  }
  
  private getPropertyAccessChain(node: PropertyAccessExpression): string[] {
    const chain: string[] = [];
    let current: Node = node;
    
    while (Node.isPropertyAccessExpression(current)) {
      chain.unshift(current.getName());
      current = current.getExpression();
    }
    
    if (Node.isIdentifier(current)) {
      chain.unshift(current.getText());
    }
    
    return chain;
  }
  
  private determineAccessType(access: PropertyAccessExpression): PropertyAccessType {
    const parent = access.getParent();
    
    // Check if it's a method call
    if (Node.isCallExpression(parent) && parent.getExpression() === access) {
      return 'method_call';
    }
    
    // Check if it's being assigned to (write access)
    if (Node.isBinaryExpression(parent) && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken && parent.getLeft() === access) {
      return 'write';
    }
    
    // Check if it's being passed to another function
    if (Node.isCallExpression(parent)) {
      return 'passed_through';
    }
    
    // Default to read access
    return 'read';
  }
  
  private getCallTarget(call: CallExpression): string {
    const expression = call.getExpression();
    
    if (Node.isIdentifier(expression)) {
      return expression.getText();
    }
    
    if (Node.isPropertyAccessExpression(expression)) {
      return expression.getName();
    }
    
    return '<unknown>';
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
  
  private getParameters(node: FunctionNode): ParameterDeclaration[] {
    if ('getParameters' in node) {
      return node.getParameters();
    }
    return [];
  }
}
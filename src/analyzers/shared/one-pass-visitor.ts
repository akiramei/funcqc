import {
  Node,
  SourceFile,
  TypeChecker,
  Type,
  SyntaxKind,
  PropertyAccessExpression,
  CallExpression,
  FunctionLikeDeclaration
} from 'ts-morph';
import { createHash } from 'crypto';

/**
 * Shared context for all visitors during 1-pass AST traversal
 */
export interface ScanContext {
  checker: TypeChecker;
  file: SourceFile;
  
  // Shared caches (computed lazily)
  paramTypeMap: Map<FunctionLikeDeclaration, Map<string, Type>>;
  sourceHash: string;
  
  // Collection results
  usageData: UsageCollectionMap;
  couplingData: CouplingDataMap;
  cohesionData: CohesionDataMap;
}

/**
 * Usage pattern data structure
 */
export interface UsageCollectionMap {
  propertyAccesses: Map<string, Map<string, PropertyAccessInfo[]>>; // funcId -> paramName -> accesses
  functionCalls: Map<string, CallInfo[]>; // funcId -> calls
}

export interface PropertyAccessInfo {
  property: string;
  accessType: 'read' | 'write' | 'modify' | 'pass';
  line: number;
  context: string;
}

export interface CallInfo {
  callee: string;
  args: string[];
  line: number;
}

/**
 * Coupling analysis data structure
 */
export interface CouplingDataMap {
  parameterUsage: Map<string, Map<string, Set<string>>>; // funcId -> paramName -> usedProperties
  bucketBrigade: Map<string, Map<string, Set<string>>>; // funcId -> paramName -> calleeIds
  overCoupling: Map<string, CouplingAnalysis[]>; // funcId -> coupling issues
}

export interface CouplingAnalysis {
  parameterName: string;
  usedProperties: string[];
  totalProperties: number;
  usageRatio: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  bucketBrigadeDepth?: number;
}

/**
 * Cohesion analysis data structure
 */
export interface CohesionDataMap {
  propertyGroups: Map<string, Map<string, Set<string>>>; // funcId -> property -> coAccessedProperties
  functionGroups: Map<string, PropertyUsageGroup[]>; // typeId -> usage groups
}

export interface PropertyUsageGroup {
  properties: string[];
  functions: string[];
  correlation: number; // 0-1, Jaccard coefficient
}

/**
 * Node visitor function type
 */
export type NodeVisitor = (node: Node, ctx: ScanContext) => void;

/**
 * Core 1-pass AST scanner
 */
export class OnePassASTVisitor {
  private visitors: NodeVisitor[] = [];
  
  constructor() {
    this.visitors = [
      this.usageCollector,
      this.couplingCollector, 
      this.cohesionCollector
    ];
  }
  
  /**
   * Scan a single source file with all registered visitors
   */
  scanFile(file: SourceFile, checker: TypeChecker): ScanContext {
    const ctx: ScanContext = {
      checker,
      file,
      paramTypeMap: new Map(),
      sourceHash: this.computeSourceHash(file),
      usageData: {
        propertyAccesses: new Map(),
        functionCalls: new Map()
      },
      couplingData: {
        parameterUsage: new Map(),
        bucketBrigade: new Map(),
        overCoupling: new Map()
      },
      cohesionData: {
        propertyGroups: new Map(),
        functionGroups: new Map()
      }
    };
    
    // Single AST traversal with all visitors
    file.forEachDescendant((node) => {
      for (const visitor of this.visitors) {
        visitor(node, ctx);
      }
    });
    
    // Post-process coupling analysis
    this.analyzeCoupling(ctx);
    
    return ctx;
  }
  
  /**
   * Usage pattern collector visitor
   */
  private usageCollector: NodeVisitor = (node, ctx) => {
    if (Node.isPropertyAccessExpression(node)) {
      this.collectPropertyAccess(node, ctx);
    } else if (Node.isCallExpression(node)) {
      this.collectFunctionCall(node, ctx);
    }
  };
  
  /**
   * Coupling data collector visitor  
   */
  private couplingCollector: NodeVisitor = (node, ctx) => {
    if (Node.isPropertyAccessExpression(node)) {
      this.collectCouplingData(node, ctx);
    }
  };
  
  /**
   * Cohesion data collector visitor
   */
  private cohesionCollector: NodeVisitor = (node, ctx) => {
    if (Node.isPropertyAccessExpression(node)) {
      this.collectCohesionData(node, ctx);
    }
  };
  
  private collectPropertyAccess(node: PropertyAccessExpression, ctx: ScanContext): void {
    const func = this.findContainingFunction(node);
    if (!func) return;
    
    const funcId = this.getFunctionId(func);
    const expression = node.getExpression();
    const propertyName = node.getName();
    
    // Get parameter type map (lazy computation)
    const paramMap = this.getOrCreateParamTypeMap(func, ctx);
    
    // Check if this is a parameter access
    const paramName = expression.getText();
    if (!paramMap.has(paramName)) return;
    
    // Classify access type
    const accessType = this.classifyPropertyAccess(node);
    
    // Store usage data
    if (!ctx.usageData.propertyAccesses.has(funcId)) {
      ctx.usageData.propertyAccesses.set(funcId, new Map());
    }
    
    const funcUsage = ctx.usageData.propertyAccesses.get(funcId)!;
    if (!funcUsage.has(paramName)) {
      funcUsage.set(paramName, []);
    }
    
    funcUsage.get(paramName)!.push({
      property: propertyName,
      accessType,
      line: node.getStartLineNumber(),
      context: this.getAccessContext(node)
    });
  }
  
  private collectFunctionCall(node: CallExpression, ctx: ScanContext): void {
    const func = this.findContainingFunction(node);
    if (!func) return;
    
    const funcId = this.getFunctionId(func);
    const calleeText = node.getExpression().getText();
    const args = node.getArguments().map(arg => arg.getText());
    
    if (!ctx.usageData.functionCalls.has(funcId)) {
      ctx.usageData.functionCalls.set(funcId, []);
    }
    
    ctx.usageData.functionCalls.get(funcId)!.push({
      callee: calleeText,
      args,
      line: node.getStartLineNumber()
    });
  }
  
  private collectCouplingData(node: PropertyAccessExpression, ctx: ScanContext): void {
    const func = this.findContainingFunction(node);
    if (!func) return;
    
    const funcId = this.getFunctionId(func);
    const expression = node.getExpression();
    const propertyName = node.getName();
    
    const paramMap = this.getOrCreateParamTypeMap(func, ctx);
    const paramName = expression.getText();
    
    if (!paramMap.has(paramName)) return;
    
    // Store parameter usage for coupling analysis
    if (!ctx.couplingData.parameterUsage.has(funcId)) {
      ctx.couplingData.parameterUsage.set(funcId, new Map());
    }
    
    const funcCoupling = ctx.couplingData.parameterUsage.get(funcId)!;
    if (!funcCoupling.has(paramName)) {
      funcCoupling.set(paramName, new Set());
    }
    
    funcCoupling.get(paramName)!.add(propertyName);
  }
  
  private collectCohesionData(node: PropertyAccessExpression, ctx: ScanContext): void {
    const func = this.findContainingFunction(node);
    if (!func) return;
    
    const funcId = this.getFunctionId(func);
    const propertyName = node.getName();
    
    // Track property co-access patterns for cohesion analysis
    if (!ctx.cohesionData.propertyGroups.has(funcId)) {
      ctx.cohesionData.propertyGroups.set(funcId, new Map());
    }
    
    const propertyGroups = ctx.cohesionData.propertyGroups.get(funcId)!;
    if (!propertyGroups.has(propertyName)) {
      propertyGroups.set(propertyName, new Set());
    }
    
    // Find other properties accessed in the same function
    const allAccesses = this.findAllPropertyAccessesInFunction(func);
    for (const otherProp of allAccesses) {
      if (otherProp !== propertyName) {
        propertyGroups.get(propertyName)!.add(otherProp);
      }
    }
  }
  
  /**
   * Analyze coupling patterns and compute severity scores
   */
  private analyzeCoupling(ctx: ScanContext): void {
    for (const [funcId, paramUsage] of ctx.couplingData.parameterUsage) {
      const analyses: CouplingAnalysis[] = [];
      
      for (const [paramName, usedProps] of paramUsage) {
        // Get total properties for this parameter type
        const totalProps = this.getTotalPropertiesForParam(funcId, paramName, ctx);
        if (totalProps === 0) continue;
        
        const usageRatio = usedProps.size / totalProps;
        let severity: 'LOW' | 'MEDIUM' | 'HIGH';
        
        if (usageRatio <= 0.25) severity = 'HIGH';
        else if (usageRatio <= 0.5) severity = 'MEDIUM'; 
        else severity = 'LOW';
        
        analyses.push({
          parameterName: paramName,
          usedProperties: Array.from(usedProps),
          totalProperties: totalProps,
          usageRatio,
          severity
        });
      }
      
      if (analyses.length > 0) {
        ctx.couplingData.overCoupling.set(funcId, analyses);
      }
    }
  }
  
  private findContainingFunction(node: Node): Node | undefined {
    return node.getFirstAncestor((n) => {
      return Node.isFunctionDeclaration(n) ||
             Node.isMethodDeclaration(n) ||
             Node.isArrowFunction(n) ||
             Node.isFunctionExpression(n) ||
             Node.isConstructorDeclaration(n) ||
             Node.isGetAccessorDeclaration(n) ||
             Node.isSetAccessorDeclaration(n);
    });
  }
  
  private getFunctionId(func: Node): string {
    const filePath = func.getSourceFile().getFilePath();
    const startPos = func.getStart();
    const name = this.getFunctionName(func);
    return createHash('md5').update(`${filePath}:${startPos}:${name}`).digest('hex').substring(0, 8);
  }
  
  private getFunctionName(func: Node): string {
    if (Node.isFunctionDeclaration(func) || Node.isMethodDeclaration(func)) {
      return func.getName() || '<anonymous>';
    } else if (Node.isConstructorDeclaration(func)) {
      return 'constructor';
    } else if (Node.isGetAccessorDeclaration(func)) {
      return `get ${func.getName()}`;
    } else if (Node.isSetAccessorDeclaration(func)) {
      return `set ${func.getName()}`;
    }
    return '<anonymous>';
  }
  
  private getOrCreateParamTypeMap(func: Node, ctx: ScanContext): Map<string, Type> {
    // Type assertion for function-like nodes
    const funcLike = func as unknown as FunctionLikeDeclaration;
    let paramMap = ctx.paramTypeMap.get(funcLike);
    if (!paramMap) {
      paramMap = new Map();
      if ('getParameters' in funcLike && typeof funcLike.getParameters === 'function') {
        for (const param of funcLike.getParameters()) {
          const name = param.getName();
          const type = param.getType();
          paramMap.set(name, type);
        }
      }
      ctx.paramTypeMap.set(funcLike, paramMap);
    }
    return paramMap;
  }
  
  private classifyPropertyAccess(node: PropertyAccessExpression): 'read' | 'write' | 'modify' | 'pass' {
    const parent = node.getParent();
    if (!parent) return 'read';
    
    // Simple heuristic - can be enhanced
    if (Node.isBinaryExpression(parent) && parent.getLeft() === node) {
      const operator = parent.getOperatorToken();
      if (operator.getKind() === SyntaxKind.EqualsToken) return 'write';
      if ([SyntaxKind.PlusEqualsToken, SyntaxKind.MinusEqualsToken].includes(operator.getKind())) {
        return 'modify';
      }
    }
    
    if (Node.isCallExpression(parent) && parent.getArguments().includes(node)) {
      return 'pass';
    }
    
    return 'read';
  }
  
  private getAccessContext(node: PropertyAccessExpression): string {
    const parent = node.getParent();
    if (!parent) return 'unknown';
    
    if (Node.isBinaryExpression(parent)) return 'assignment';
    if (Node.isCallExpression(parent)) return 'function_call';
    if (Node.isReturnStatement(parent)) return 'return';
    
    return 'expression';
  }
  
  private findAllPropertyAccessesInFunction(func: Node): string[] {
    const properties: string[] = [];
    
    func.forEachDescendant((node: Node) => {
      if (Node.isPropertyAccessExpression(node)) {
        properties.push(node.getName());
      }
    });
    
    return [...new Set(properties)]; // deduplicate
  }
  
  private getTotalPropertiesForParam(funcId: string, paramName: string, ctx: ScanContext): number {
    try {
      // Find the function by funcId to get its parameter type map
      let targetFunc: Node | undefined;
      ctx.file.forEachDescendant((node) => {
        if (targetFunc) return;
        if (this.getFunctionId(node) === funcId) {
          targetFunc = node;
        }
      });

      if (!targetFunc) return 0;

      const paramMap = this.getOrCreateParamTypeMap(targetFunc, ctx);
      const paramType = paramMap.get(paramName);
      
      if (!paramType) return 0;

      // Count properties of the parameter type
      return this.countTypeProperties(paramType, ctx.checker);
    } catch {
      return 0; // Fallback to 0 if counting fails
    }
  }

  /**
   * Count the number of accessible properties in a type
   */
  private countTypeProperties(type: Type, checker: TypeChecker): number {
    try {
      const symbol = type.getSymbol();
      if (!symbol) return 0;

      // Get all accessible properties/methods
      const properties = checker.getPropertiesOfType(type);
      return properties.length;
    } catch {
      return 0;
    }
  }
  
  private computeSourceHash(file: SourceFile): string {
    return createHash('sha1').update(file.getFullText()).digest('hex');
  }
}
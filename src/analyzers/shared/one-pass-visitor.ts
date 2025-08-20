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
import { FunctionIdGenerator } from '../../utils/function-id-generator';

/**
 * Shared context for all visitors during 1-pass AST traversal
 */
export interface ScanContext {
  checker: TypeChecker;
  file: SourceFile;
  snapshotId?: string | undefined; // Added for deterministic ID generation
  
  // Shared caches (computed lazily)
  paramTypeMap: Map<FunctionLikeDeclaration, Map<string, Type>>;
  sourceHash: string;
  
  // Performance optimization: Cache funcId to Node mapping
  funcIdToNodeCache?: Map<string, Node>;
  
  // Temporary cohesion data for 1-pass collection (performance optimization)
  cohesionTempData: Map<string, Set<string>>;
  
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
  overCoupling: Map<string, SimpleCouplingAnalysis[]>; // funcId -> coupling issues
}

export interface SimpleCouplingAnalysis {
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
  // Performance optimization: Cache function IDs to avoid repeated MD5 calculations
  private funcIdCache = new WeakMap<Node, string>();
  
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
  scanFile(file: SourceFile, checker: TypeChecker, snapshotId?: string): ScanContext {
    // Reset function ID cache for new file (WeakMap doesn't have clear method)
    this.funcIdCache = new WeakMap();
    
    const ctx: ScanContext = {
      checker,
      file,
      snapshotId,
      paramTypeMap: new Map(),
      sourceHash: this.computeSourceHash(file),
      funcIdToNodeCache: new Map(),
      cohesionTempData: new Map(),
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
      // Build funcId to Node cache during traversal for performance
      if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node) || 
          Node.isArrowFunction(node) || Node.isFunctionExpression(node) ||
          Node.isConstructorDeclaration(node) || Node.isGetAccessorDeclaration(node) ||
          Node.isSetAccessorDeclaration(node)) {
        const funcId = this.getFunctionId(node, ctx);
        if (funcId) {
          ctx.funcIdToNodeCache!.set(funcId, node);
        }
      }
      
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
    if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
      this.collectPropertyAccess(node, ctx);
    } else if (Node.isCallExpression(node)) {
      this.collectFunctionCall(node, ctx);
    }
  };
  
  /**
   * Coupling data collector visitor  
   */
  private couplingCollector: NodeVisitor = (node, ctx) => {
    if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
      this.collectCouplingData(node, ctx);
    }
  };
  
  /**
   * Cohesion data collector visitor
   */
  private cohesionCollector: NodeVisitor = (node, ctx) => {
    if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
      this.collectCohesionData(node, ctx);
    }
  };
  
  private collectPropertyAccess(node: PropertyAccessExpression | Node, ctx: ScanContext): void {
    const func = this.findContainingFunction(node);
    if (!func) return;
    
    const funcId = this.getFunctionId(func, ctx);
    const expression = Node.isPropertyAccessExpression(node) ? node.getExpression() : 
                       Node.isElementAccessExpression(node) ? node.getExpression() : null;
    const propertyName = Node.isPropertyAccessExpression(node) ? node.getName() : 
                        Node.isElementAccessExpression(node) ? this.getElementAccessName(node) : 'unknown';
    
    if (!expression || !propertyName || propertyName === 'unknown') return;
    
    // Get parameter type map (lazy computation)
    const paramMap = this.getOrCreateParamTypeMap(func, ctx);
    
    // Check if this is a parameter access
    // Fixed: Properly extract parameter name from expression
    let paramName: string | null = null;
    if (Node.isIdentifier(expression)) {
      paramName = expression.getText();
    } else if (Node.isThisExpression(expression)) {
      paramName = 'this';
    }
    
    // `this` は関数パラメータに含まれないため、型を動的に注入する
    if (paramName === 'this' && !paramMap.has('this')) {
      try {
        const thisType = ctx.checker.getTypeAtLocation(expression);
        paramMap.set('this', thisType);
      } catch {
        return; // 型解決に失敗した場合はスキップ
      }
    }
    
    if (!paramName || !paramMap.has(paramName)) {
      return;
    }
    
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
    
    const funcId = this.getFunctionId(func, ctx);
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
  
  private collectCouplingData(node: PropertyAccessExpression | Node, ctx: ScanContext): void {
    const func = this.findContainingFunction(node);
    if (!func) return;
    
    const funcId = this.getFunctionId(func, ctx);
    const expression = Node.isPropertyAccessExpression(node) ? node.getExpression() : 
                       Node.isElementAccessExpression(node) ? node.getExpression() : null;
    const propertyName = Node.isPropertyAccessExpression(node) ? node.getName() : 
                        Node.isElementAccessExpression(node) ? this.getElementAccessName(node) : 'unknown';
    
    if (!expression || !propertyName || propertyName === 'unknown') return;
    
    const paramMap = this.getOrCreateParamTypeMap(func, ctx);
    
    // Fixed: Properly extract parameter name from expression
    let paramName: string | null = null;
    if (Node.isIdentifier(expression)) {
      paramName = expression.getText();
    } else if (Node.isThisExpression(expression)) {
      paramName = 'this';
    }
    
    // `this` はパラメータマップに存在しないため型情報を取得して登録
    if (paramName === 'this' && !paramMap.has('this')) {
      try {
        const thisType = ctx.checker.getTypeAtLocation(expression);
        paramMap.set('this', thisType);
      } catch {
        return;
      }
    }
    
    if (!paramName || !paramMap.has(paramName)) {
      return;
    }
    
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
  
  private collectCohesionData(node: PropertyAccessExpression | Node, ctx: ScanContext): void {
    const func = this.findContainingFunction(node);
    if (!func) return;
    
    const funcId = this.getFunctionId(func, ctx);
    const propertyName = Node.isPropertyAccessExpression(node)
      ? node.getName()
      : Node.isElementAccessExpression(node)
        ? (this.getElementAccessName(node) ?? '[computed]')
        : 'unknown';
    if (!propertyName || propertyName === 'unknown') return;
    
    // 1-pass cohesion collection (performance optimization)
    if (!ctx.cohesionTempData.has(funcId)) {
      ctx.cohesionTempData.set(funcId, new Set());
    }
    
    const currentProps = ctx.cohesionTempData.get(funcId)!;
    
    // Track property co-access patterns for cohesion analysis
    if (!ctx.cohesionData.propertyGroups.has(funcId)) {
      ctx.cohesionData.propertyGroups.set(funcId, new Map());
    }
    
    const propertyGroups = ctx.cohesionData.propertyGroups.get(funcId)!;
    if (!propertyGroups.has(propertyName)) {
      propertyGroups.set(propertyName, new Set());
    }
    
    // Add bidirectional co-occurrence with all previously seen properties in this function
    for (const existingProp of currentProps) {
      if (existingProp !== propertyName) {
        // Add bidirectional edges
        if (!propertyGroups.has(existingProp)) {
          propertyGroups.set(existingProp, new Set());
        }
        propertyGroups.get(propertyName)!.add(existingProp);
        propertyGroups.get(existingProp)!.add(propertyName);
      }
    }
    
    // Add current property to the seen set
    currentProps.add(propertyName);
  }
  
  /**
   * Analyze coupling patterns and compute severity scores
   */
  private analyzeCoupling(ctx: ScanContext): void {
    // console.log(`🔍 analyzeCoupling: processing ${ctx.couplingData.parameterUsage.size} functions`);
    
    for (const [funcId, paramUsage] of ctx.couplingData.parameterUsage) {
      const analyses: SimpleCouplingAnalysis[] = [];
      // console.log(`  📋 Function ${funcId}: ${paramUsage.size} parameters`);
      
      for (const [paramName, usedProps] of paramUsage) {
        // console.log(`    🔧 Parameter ${paramName}: ${usedProps.size} used properties`);
        
        // Get total properties for this parameter type
        let totalProps = this.getTotalPropertiesForParam(funcId, paramName, ctx);
        // console.log(`    📊 totalProps for ${paramName}: ${totalProps}`);
        
        // Skip if no properties are used
        if (usedProps.size === 0) {
          // console.log(`    ⚠️  Skipping ${paramName}: no properties used`);
          continue;
        }
        
        // Fallback: If TypeChecker cannot resolve type properties, 
        // still proceed with coupling analysis based on observed usage
        if (totalProps === 0) {
          totalProps = Math.max(usedProps.size, 1);
          // console.log(`    🔄 Using fallback totalProps=${totalProps} for ${paramName}`);
        }
        
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
        // console.log(`  ✅ Added ${analyses.length} coupling analyses for function ${funcId}`);
        ctx.couplingData.overCoupling.set(funcId, analyses);
      } else {
        // console.log(`  ❌ No coupling analyses created for function ${funcId}`);
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
  
  private getFunctionId(func: Node, _ctx: ScanContext): string {
    // Check cache first (major performance optimization)
    const cached = this.funcIdCache.get(func);
    if (cached) {
      return cached;
    }
    
    // Extract function information for deterministic ID generation
    const rawFilePath = func.getSourceFile().getFilePath();
    
    // CRITICAL FIX: Use same file path normalization as DB storage
    // This ensures OnePassASTVisitor generates same IDs as unified-ast-analyzer
    const filePath = rawFilePath.startsWith('/') ? rawFilePath.slice(1) : rawFilePath;
    
    // DEBUG: Log filePath used by OnePassASTVisitor
    if (process.env['FUNCQC_DEBUG_COUPLING'] === '1') {
      console.log(`    🗂️  OnePassASTVisitor rawFilePath: ${rawFilePath}`);
      console.log(`    🗂️  OnePassASTVisitor normalized filePath: ${filePath}`);
    }
    
    // Extract class name from parent context using same method as unified-ast-analyzer
    // This ensures consistent ID generation between coupling analysis and DB storage
    const contextPath: string[] = [];
    let current: Node | undefined = func.getParent();
    while (current) {
      if (Node.isClassDeclaration(current)) {
        const className = current.getName();
        if (className) contextPath.unshift(className);
      } else if (Node.isModuleDeclaration(current)) {
        const moduleName = current.getName();
        if (moduleName) contextPath.unshift(moduleName);
      } else if (Node.isFunctionDeclaration(current)) {
        const funcName = current.getName();
        if (funcName) contextPath.unshift(funcName);
      }
      current = current.getParent();
    }
    
    // Use last element of contextPath as className (same as unified-ast-analyzer)
    const className = contextPath.length > 0 ? contextPath[contextPath.length - 1] : null;
    
    // Use FunctionIdGenerator.generateDeterministicUUIDFromNode for consistent ID generation
    // This ensures proper normalization of getter/setter/constructor names
    
    // DEBUG: Log all ID generation parameters
    if (process.env['FUNCQC_DEBUG_COUPLING'] === '1') {
      const startLine = func.getStartLineNumber();
      const startColumn = func.getStart() - func.getStartLinePos();
      let functionName = '<anonymous>';
      if (Node.isGetAccessorDeclaration(func)) {
        functionName = `get_${func.getName()}`;
      } else if (Node.isSetAccessorDeclaration(func)) {
        functionName = `set_${func.getName()}`;
      } else if (Node.isConstructorDeclaration(func) || func.getKindName() === 'Constructor') {
        functionName = 'constructor';
      } else if ('getName' in func && typeof func.getName === 'function') {
        functionName = func.getName() || '<anonymous>';
      }
      
      console.log(`    🏗️  OnePassASTVisitor ID params:`);
      console.log(`      filePath: ${filePath}`);
      console.log(`      functionName: ${functionName}`);
      console.log(`      className: ${className}`);
      console.log(`      startLine: ${startLine}`);
      console.log(`      startColumn: ${startColumn}`);
      console.log(`      snapshotId: ${_ctx.snapshotId || 'unknown'}`);
    }
    
    // CRITICAL FIX: Use same ID generation method as unified-ast-analyzer
    // Extract function name using same logic as unified-ast-analyzer
    let functionName = '<anonymous>';
    if (Node.isConstructorDeclaration(func)) {
      functionName = 'constructor';
    } else if ('getName' in func && typeof func.getName === 'function') {
      functionName = func.getName() || '<anonymous>';
    }
    // Note: NO special getter/setter prefixing (unified-ast-analyzer doesn't do this)
    
    const startLine = func.getStartLineNumber();
    const startColumn = func.getStart() - func.getStartLinePos();
    
    // Use same method as unified-ast-analyzer
    const funcId = FunctionIdGenerator.generateDeterministicUUID(
      filePath,
      functionName,
      className,
      startLine,
      startColumn,
      _ctx.snapshotId || 'unknown'
    );
    
    // DEBUG: Log generated ID (disabled for performance)
    // console.log(`    🆔 OnePassASTVisitor: filePath=${filePath}, name=${functionName}, className=${className}, line=${startLine}:${startColumn}`);
    // console.log(`    🆔 OnePassASTVisitor generated ID: ${funcId}`);
    
    this.funcIdCache.set(func, funcId);
    return funcId;
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
  
  private classifyPropertyAccess(node: PropertyAccessExpression | Node): 'read' | 'write' | 'modify' | 'pass' {
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
  
  private getElementAccessName(node: Node): string | null {
    if (Node.isElementAccessExpression(node)) {
      const argumentExpression = node.getArgumentExpression();
      if (argumentExpression && Node.isStringLiteral(argumentExpression)) {
        return argumentExpression.getLiteralValue();
      }
      // For non-string literals, return a generic identifier
      return '[computed]';
    }
    return null;
  }
  
  private getAccessContext(node: PropertyAccessExpression | Node): string {
    const parent = node.getParent();
    if (!parent) return 'unknown';
    
    if (Node.isBinaryExpression(parent)) return 'assignment';
    if (Node.isCallExpression(parent)) return 'function_call';
    if (Node.isReturnStatement(parent)) return 'return';
    
    return 'expression';
  }
  
  
  private getTotalPropertiesForParam(funcId: string, paramName: string, ctx: ScanContext): number {
    try {
      // Use cached funcId to Node mapping for O(1) lookup instead of O(N) traversal
      const targetFunc = ctx.funcIdToNodeCache?.get(funcId);
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
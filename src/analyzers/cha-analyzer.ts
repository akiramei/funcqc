import { Project, Node, ClassDeclaration, InterfaceDeclaration, MethodDeclaration, GetAccessorDeclaration, SetAccessorDeclaration, ConstructorDeclaration, MethodSignature, TypeChecker } from 'ts-morph';
import { FunctionMetadata, IdealCallEdge, ResolutionLevel } from './ideal-call-graph-analyzer';
import { generateStableEdgeId } from '../utils/edge-id-generator';
import { PathNormalizer } from '../utils/path-normalizer';
import * as path from 'path';

/**
 * Class Hierarchy Analysis (CHA) Analyzer
 * 
 * Implements Class Hierarchy Analysis for method call resolution:
 * 1. Build inheritance graph from class declarations
 * 2. Resolve method calls to all possible implementations
 * 3. Calculate confidence based on inheritance depth
 * 
 * Design principles:
 * - Conservative approach: Include all possible targets
 * - Confidence decreases with inheritance depth
 * - Handle interface implementations and abstract classes
 */
export class CHAAnalyzer {
  private project: Project;
  private inheritanceGraph = new Map<string, ClassHierarchyNode>();
  private methodIndex = new Map<string, Set<MethodInfo>>();

  constructor(project: Project, _typeChecker: TypeChecker) {
    this.project = project;
    // Note: typeChecker reserved for future use in type analysis
    // Currently unused but kept for potential type-based method resolution
  }

  /**
   * Perform CHA analysis to resolve method calls
   */
  async performCHAAnalysis(
    functions: Map<string, FunctionMetadata>,
    unresolvedEdges: UnresolvedMethodCall[]
  ): Promise<IdealCallEdge[]> {
    console.log('   🏗️  Building class hierarchy graph...');
    this.buildInheritanceGraph();
    
    console.log('   📚 Indexing methods and properties...');
    this.buildMethodIndex(functions);
    
    console.log('   🎯 Resolving method calls via CHA...');
    const resolvedEdges = this.resolveMethodCalls(functions, unresolvedEdges);
    
    console.log(`   ✅ CHA resolved ${resolvedEdges.length} method calls`);
    return resolvedEdges;
  }

  /**
   * Build inheritance graph from all class declarations (optimized sync)
   */
  private buildInheritanceGraph(): void {
    const sourceFiles = this.project.getSourceFiles();
    
    for (const sourceFile of sourceFiles) {
      // Process class declarations
      const classes = sourceFile.getClasses();
      for (const classDecl of classes) {
        this.processClassDeclaration(classDecl);
      }
      
      // Process interface declarations
      const interfaces = sourceFile.getInterfaces();
      for (const interfaceDecl of interfaces) {
        this.processInterfaceDeclaration(interfaceDecl);
      }
    }
    
    // Build inheritance relationships
    this.buildInheritanceRelationships();
  }

  /**
   * Process a class declaration for hierarchy analysis (optimized sync)
   */
  private processClassDeclaration(classDecl: ClassDeclaration): void {
    const className = classDecl.getName();
    if (!className) return;
    
    const filePath = classDecl.getSourceFile().getFilePath();
    const node: ClassHierarchyNode = {
      name: className,
      type: 'class',
      filePath,
      startLine: classDecl.getStartLineNumber(),
      isAbstract: classDecl.isAbstract(),
      parents: [],
      children: [],
      methods: [],
      interfaces: []
    };
    
    // Get extends clause
    const extendsClause = classDecl.getExtends();
    if (extendsClause) {
      const parentName = extendsClause.getExpression().getText();
      node.parents.push(parentName);
    }
    
    // Get implements clauses
    const implementsClauses = classDecl.getImplements();
    for (const implementsClause of implementsClauses) {
      const interfaceName = implementsClause.getExpression().getText();
      node.interfaces.push(interfaceName);
    }
    
    // Extract methods
    const methods = classDecl.getMethods();
    for (const method of methods) {
      const methodInfo = this.extractMethodInfo(method, className);
      if (methodInfo) {
        node.methods.push(methodInfo);
      }
    }
    
    // Extract getters and setters
    const getAccessors = classDecl.getGetAccessors();
    for (const getter of getAccessors) {
      const methodInfo = this.extractMethodInfo(getter, className);
      if (methodInfo) {
        node.methods.push(methodInfo);
      }
    }
    
    const setAccessors = classDecl.getSetAccessors();
    for (const setter of setAccessors) {
      const methodInfo = this.extractMethodInfo(setter, className);
      if (methodInfo) {
        node.methods.push(methodInfo);
      }
    }
    
    // Extract constructor
    const constructors = classDecl.getConstructors();
    for (const ctor of constructors) {
      const methodInfo = this.extractMethodInfo(ctor, className);
      if (methodInfo) {
        node.methods.push(methodInfo);
      }
    }
    
    this.inheritanceGraph.set(className, node);
  }

  /**
   * Process interface declaration for hierarchy analysis (optimized sync)
   */
  private processInterfaceDeclaration(interfaceDecl: InterfaceDeclaration): void {
    const interfaceName = interfaceDecl.getName();
    if (!interfaceName) return;
    
    const filePath = interfaceDecl.getSourceFile().getFilePath();
    const node: ClassHierarchyNode = {
      name: interfaceName,
      type: 'interface',
      filePath,
      startLine: interfaceDecl.getStartLineNumber(),
      isAbstract: false,
      parents: [],
      children: [],
      methods: [],
      interfaces: []
    };
    
    // Get extends clauses for interfaces
    const extendsClause = interfaceDecl.getExtends();
    for (const extend of extendsClause) {
      const parentName = extend.getExpression().getText();
      node.parents.push(parentName);
    }
    
    // Extract method signatures
    const methods = interfaceDecl.getMethods();
    for (const method of methods) {
      const methodInfo = this.extractMethodInfoFromSignature(method, interfaceName);
      if (methodInfo) {
        node.methods.push(methodInfo);
      }
    }
    
    this.inheritanceGraph.set(interfaceName, node);
  }

  /**
   * Extract method information from interface method signatures
   */
  private extractMethodInfoFromSignature(
    node: MethodSignature,
    interfaceName: string
  ): MethodInfo | undefined {
    const methodName = node.getName();
    const parameters = node.getParameters();
    const parameterTypes = parameters.map(p => p.getType().getText());
    
    return {
      name: methodName,
      type: 'method',
      className: interfaceName,
      isStatic: false,
      isAbstract: true, // Interface methods are abstract by definition
      parameters: parameterTypes,
      signature: `${interfaceName}.${methodName}(${parameterTypes.join(', ')})`,
      startLine: node.getStartLineNumber(),
      filePath: node.getSourceFile().getFilePath()
    };
  }

  /**
   * Extract method information from various method-like nodes
   */
  private extractMethodInfo(
    node: MethodDeclaration | GetAccessorDeclaration | SetAccessorDeclaration | ConstructorDeclaration,
    className: string
  ): MethodInfo | undefined {
    let methodName: string;
    let methodType: 'method' | 'getter' | 'setter' | 'constructor';
    
    if (Node.isMethodDeclaration(node)) {
      methodName = node.getName();
      methodType = 'method';
    } else if (Node.isGetAccessorDeclaration(node)) {
      methodName = `get_${node.getName()}`;
      methodType = 'getter';
    } else if (Node.isSetAccessorDeclaration(node)) {
      methodName = `set_${node.getName()}`;
      methodType = 'setter';
    } else if (Node.isConstructorDeclaration(node)) {
      methodName = 'constructor';
      methodType = 'constructor';
    } else {
      return undefined;
    }
    
    const parameters = node.getParameters();
    const parameterTypes = parameters.map(p => p.getType().getText());
    
    return {
      name: methodName,
      type: methodType,
      className,
      isStatic: Node.isMethodDeclaration(node) ? node.isStatic() : false,
      isAbstract: Node.isMethodDeclaration(node) ? node.isAbstract() : false,
      parameters: parameterTypes,
      signature: `${className}.${methodName}(${parameterTypes.join(', ')})`,
      startLine: node.getStartLineNumber(),
      filePath: node.getSourceFile().getFilePath()
    };
  }

  /**
   * Build parent-child relationships in inheritance graph (optimized sync)
   */
  private buildInheritanceRelationships(): void {
    for (const [className, node] of this.inheritanceGraph) {
      for (const parentName of node.parents) {
        const parentNode = this.inheritanceGraph.get(parentName);
        if (parentNode) {
          parentNode.children.push(className);
        }
      }
      
      for (const interfaceName of node.interfaces) {
        const interfaceNode = this.inheritanceGraph.get(interfaceName);
        if (interfaceNode) {
          interfaceNode.children.push(className);
        }
      }
    }
  }

  /**
   * Build method index for fast lookup (with duplicate prevention, optimized sync)
   * Only index methods that are in the FunctionRegistry to prevent false positives
   */
  private buildMethodIndex(functions: Map<string, FunctionMetadata>): void {
    for (const [className, node] of this.inheritanceGraph) {
      // Skip interface nodes - their methods are signatures, not implementations
      if (node.type === 'interface') {
        continue;
      }
      
      for (const method of node.methods) {
        // Check if this method exists in the FunctionRegistry
        const methodLexicalPath = this.buildMethodLexicalPath(method, className);
        if (!functions.has(methodLexicalPath)) {
          // Skip methods not in FunctionRegistry to avoid false positives
          continue;
        }
        
        const methodKey = `${className}.${method.name}`;
        if (!this.methodIndex.has(methodKey)) {
          this.methodIndex.set(methodKey, new Set<MethodInfo>());
        }
        this.methodIndex.get(methodKey)!.add(method);
        
        // Also index by method name alone for polymorphic calls
        if (!this.methodIndex.has(method.name)) {
          this.methodIndex.set(method.name, new Set<MethodInfo>());
        }
        this.methodIndex.get(method.name)!.add(method);
      }
    }
  }

  /**
   * Build lexical path for method that matches FunctionRegistry format
   */
  private buildMethodLexicalPath(method: MethodInfo, className: string): string {
    const relativePath = this.getRelativePath(method.filePath);
    return `${relativePath}#${className}.${method.name}`;
  }

  /**
   * Resolve method calls using CHA (optimized sync)
   */
  private resolveMethodCalls(functions: Map<string, FunctionMetadata>, unresolvedEdges: UnresolvedMethodCall[]): IdealCallEdge[] {
    const resolvedEdges: IdealCallEdge[] = [];
    
    for (const unresolved of unresolvedEdges) {
      const candidates = this.findMethodCandidates(unresolved.methodName, unresolved.receiverType);
      
      if (candidates.length > 0) {
        // Create edges for all candidates with inheritance depth
        for (const candidate of candidates) {
          const functionId = this.findMatchingFunctionId(functions, candidate);
          if (functionId) {
            // Calculate inheritance depth for this candidate
            const inheritanceDepth = this.calculateInheritanceDepth(candidate, unresolved.receiverType);
            
            const edge: IdealCallEdge = {
              id: generateStableEdgeId(unresolved.callerFunctionId, functionId),
              callerFunctionId: unresolved.callerFunctionId,
              calleeFunctionId: functionId,
              calleeName: candidate.signature,
              calleeSignature: candidate.signature,
              callType: 'direct',
              callContext: 'cha_resolved',
              lineNumber: unresolved.lineNumber,
              columnNumber: unresolved.columnNumber,
              isAsync: false,
              isChained: false,
              confidenceScore: this.calculateCHAConfidence(candidate, candidates.length, inheritanceDepth),
              metadata: {
                chaCandidate: true,
                receiverType: unresolved.receiverType,
                methodName: unresolved.methodName,
                inheritanceDepth
              },
              createdAt: new Date().toISOString(),
              
              // Ideal system properties
              resolutionLevel: 'cha_resolved' as ResolutionLevel,
              resolutionSource: 'cha_analysis',
              runtimeConfirmed: false,
              candidates: candidates.map(c => this.findMatchingFunctionId(functions, c)).filter(id => id !== undefined) as string[],
              analysisMetadata: {
                timestamp: Date.now(),
                analysisVersion: '1.0',
                sourceHash: candidate.filePath
              }
            };
            
            resolvedEdges.push(edge);
          }
        }
      }
    }
    
    return resolvedEdges;
  }

  /**
   * Find method candidates for a given method name and receiver type
   */
  private findMethodCandidates(methodName: string, receiverType?: string): MethodInfo[] {
    const candidates: MethodInfo[] = [];
    
    if (receiverType) {
      // Look for specific class/interface methods
      const classNode = this.inheritanceGraph.get(receiverType);
      if (classNode) {
        // Only add methods from concrete classes, not interface signatures
        if (classNode.type === 'class') {
          const directMethods = classNode.methods.filter(m => m.name === methodName);
          candidates.push(...directMethods);
        }
        
        // Add methods from parent classes (with fresh visited set)
        const parentMethods = this.getMethodsFromParents(classNode, methodName, new Set<string>());
        candidates.push(...parentMethods);
        
        // Skip interface methods - they are signatures, not callable implementations
        // const interfaceMethods = this.getMethodsFromInterfaces(classNode, methodName, new Set<string>());
        // candidates.push(...interfaceMethods);
      }
    } else {
      // Look for all methods with the given name (polymorphic call)
      const allMethods = this.methodIndex.get(methodName) || new Set<MethodInfo>();
      candidates.push(...Array.from(allMethods));
    }
    
    return candidates;
  }

  /**
   * Get methods from parent classes (with cycle detection)
   */
  private getMethodsFromParents(
    node: ClassHierarchyNode, 
    methodName: string, 
    visited = new Set<string>()
  ): MethodInfo[] {
    if (visited.has(node.name)) return [];
    visited.add(node.name);
    
    const methods: MethodInfo[] = [];
    
    for (const parentName of node.parents) {
      const parentNode = this.inheritanceGraph.get(parentName);
      if (parentNode) {
        // Only include methods from concrete classes, not interface signatures
        if (parentNode.type === 'class') {
          const parentMethods = parentNode.methods.filter(m => m.name === methodName);
          methods.push(...parentMethods);
        }
        
        // Recursively check parent's parents with cycle detection
        const grandParentMethods = this.getMethodsFromParents(parentNode, methodName, visited);
        methods.push(...grandParentMethods);
      }
    }
    
    return methods;
  }


  /**
   * Calculate inheritance depth from receiver type to method's class
   */
  private calculateInheritanceDepth(candidate: MethodInfo, receiverType?: string): number {
    if (!receiverType || candidate.className === receiverType) {
      return 0; // Direct implementation
    }
    
    // Search for path from receiverType to candidate's class
    const depth = this.findInheritanceDepth(receiverType, candidate.className, new Set<string>());
    return depth >= 0 ? depth : 0;
  }
  
  /**
   * Find inheritance depth between two classes (BFS-like traversal)
   */
  private findInheritanceDepth(fromClass: string, toClass: string, visited = new Set<string>()): number {
    if (fromClass === toClass) return 0;
    if (visited.has(fromClass)) return -1;
    
    visited.add(fromClass);
    const node = this.inheritanceGraph.get(fromClass);
    if (!node) return -1;
    
    // Check parents (inheritance chain)
    for (const parent of node.parents) {
      const parentDepth = this.findInheritanceDepth(parent, toClass, new Set(visited));
      if (parentDepth >= 0) {
        return parentDepth + 1;
      }
    }
    
    // Check interfaces
    for (const interfaceName of node.interfaces) {
      const interfaceDepth = this.findInheritanceDepth(interfaceName, toClass, new Set(visited));
      if (interfaceDepth >= 0) {
        return interfaceDepth + 1;
      }
    }
    
    return -1; // No path found
  }

  /**
   * Calculate CHA confidence score with inheritance depth consideration
   */
  private calculateCHAConfidence(candidate: MethodInfo, totalCandidates: number, inheritanceDepth: number = 0): number {
    const baseConfidence = 0.8; // Base CHA confidence
    
    // Reduce confidence based on number of candidates
    const candidatePenalty = Math.min(0.3, (totalCandidates - 1) * 0.05);
    
    // Boost confidence for non-abstract methods
    const abstractBonus = candidate.isAbstract ? 0 : 0.1;
    
    // Boost confidence for concrete classes vs interfaces
    const classBonus = candidate.type === 'method' ? 0.05 : 0;
    
    // Inheritance depth penalty - closer implementations get higher confidence
    // Depth 0 (direct implementation): no penalty
    // Depth 1 (parent class): small penalty
    // Depth 2+ (grandparent+): increasing penalty
    const depthPenalty = inheritanceDepth > 0 ? Math.min(0.2, inheritanceDepth * 0.05) : 0;
    
    const confidence = baseConfidence - candidatePenalty + abstractBonus + classBonus - depthPenalty;
    
    return Math.max(0.5, Math.min(1.0, confidence));
  }


  /**
   * Find matching function ID in the function registry for a method candidate
   */
  private findMatchingFunctionId(functions: Map<string, FunctionMetadata>, candidate: MethodInfo): string | undefined {
    try {
      // Strategy 1: Exact match with position and metadata (most accurate)
      for (const [functionId, functionMetadata] of functions) {
        if (PathNormalizer.areEqual(functionMetadata.filePath, candidate.filePath) &&
            functionMetadata.startLine === candidate.startLine &&
            functionMetadata.name === candidate.name &&
            functionMetadata.className === candidate.className) {
          return functionId;
        }
      }
      
      // Strategy 2: Match by lexical path construction (fallback compatibility)
      // Build the expected lexical path as FunctionRegistry would
      const relativePath = this.getRelativePath(candidate.filePath);
      const expectedLexicalPath = `${relativePath}#${candidate.className}.${candidate.name}`;
      
      for (const [functionId, functionMetadata] of functions) {
        if (functionMetadata.lexicalPath === expectedLexicalPath &&
            Math.abs(functionMetadata.startLine - candidate.startLine) <= 2) { // Allow small line differences
          return functionId;
        }
      }
      
      // Strategy 3: Search by file path and line number with tolerance
      for (const [functionId, functionMetadata] of functions) {
        if (PathNormalizer.areEqual(functionMetadata.filePath, candidate.filePath) &&
            Math.abs(functionMetadata.startLine - candidate.startLine) <= 2 && // Allow small line differences
            functionMetadata.name === candidate.name &&
            functionMetadata.className === candidate.className) {
          return functionId;
        }
      }
      
      // Strategy 4: Search by class and method name in same file
      for (const [functionId, functionMetadata] of functions) {
        if (PathNormalizer.areEqual(functionMetadata.filePath, candidate.filePath) &&
            functionMetadata.name === candidate.name &&
            functionMetadata.className === candidate.className) {
          return functionId;
        }
      }
      
      // Strategy 5: Search by method name only in same file (most lenient)
      for (const [functionId, functionMetadata] of functions) {
        if (PathNormalizer.areEqual(functionMetadata.filePath, candidate.filePath) &&
            functionMetadata.name === candidate.name &&
            functionMetadata.isMethod) {
          return functionId;
        }
      }
      
      // Debug: log failed match attempts
      console.warn(`CHA: Failed to find function ID for candidate:`, {
        name: candidate.name,
        className: candidate.className,
        filePath: candidate.filePath,
        startLine: candidate.startLine
      });
      
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Get relative path from current working directory
   */
  private getRelativePath(filePath: string): string {
    try {
      const cwd = process.cwd();
      return path.relative(cwd, filePath);
    } catch {
      return path.basename(filePath);
    }
  }

  /**
   * Get inheritance graph for debugging
   */
  getInheritanceGraph(): Map<string, ClassHierarchyNode> {
    return this.inheritanceGraph;
  }

  /**
   * Get method index for debugging
   */
  getMethodIndex(): Map<string, Set<MethodInfo>> {
    return this.methodIndex;
  }

  /**
   * Clear internal state
   */
  clear(): void {
    this.inheritanceGraph.clear();
    this.methodIndex.clear();
  }

}

export interface ClassHierarchyNode {
  name: string;
  type: 'class' | 'interface';
  filePath: string;
  startLine: number;
  isAbstract: boolean;
  parents: string[];
  children: string[];
  methods: MethodInfo[];
  interfaces: string[];
}

export interface MethodInfo {
  name: string;
  type: 'method' | 'getter' | 'setter' | 'constructor';
  className: string;
  isStatic: boolean;
  isAbstract: boolean;
  parameters: string[];
  signature: string;
  startLine: number;
  filePath: string;
}

export interface UnresolvedMethodCall {
  callerFunctionId: string;
  methodName: string;
  receiverType?: string | undefined;
  lineNumber: number;
  columnNumber: number;
}
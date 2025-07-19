import { Project, Node, TypeChecker, CallExpression, NewExpression } from 'ts-morph';
import { FunctionMetadata, IdealCallEdge, ResolutionLevel } from './ideal-call-graph-analyzer';
import { MethodInfo, UnresolvedMethodCall } from './cha-analyzer';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Rapid Type Analysis (RTA) Analyzer
 * 
 * Implements Rapid Type Analysis to refine CHA candidates by filtering
 * based on actually instantiated types:
 * 1. Track constructor calls and object instantiations
 * 2. Build set of instantiated types throughout the program
 * 3. Filter CHA candidates to only include methods from instantiated types
 * 4. Boost confidence scores for RTA-refined candidates
 * 
 * Design principles:
 * - Conservative precision: Only include types that are definitely instantiated
 * - Performance-focused: Cache instantiated types for multiple method calls
 * - Confidence boost: RTA candidates get higher confidence than pure CHA
 */
export class RTAAnalyzer {
  private project: Project;
  private typeChecker: TypeChecker;
  private instantiatedTypes = new Set<string>();
  private typeInstantiationMap = new Map<string, InstantiationInfo[]>();
  private classInterfacesMap = new Map<string, string[]>();

  constructor(project: Project, typeChecker: TypeChecker) {
    this.project = project;
    this.typeChecker = typeChecker;
  }

  /**
   * Perform RTA analysis to refine CHA candidates
   */
  async performRTAAnalysis(
    functions: Map<string, FunctionMetadata>,
    chaCandidates: Map<string, MethodInfo[]>,
    unresolvedMethodCalls: UnresolvedMethodCall[]
  ): Promise<IdealCallEdge[]> {
    console.log('   🎯 Building instantiated types registry...');
    await this.buildInstantiatedTypesRegistry();
    
    console.log('   🔬 Filtering CHA candidates with RTA...');
    const rtaEdges = this.filterCHACandidatesWithRTA(functions, chaCandidates, unresolvedMethodCalls);
    
    console.log(`   ✅ RTA refined ${rtaEdges.length} method calls`);
    return rtaEdges;
  }

  /**
   * Build registry of all instantiated types in the program
   */
  private async buildInstantiatedTypesRegistry(): Promise<void> {
    const sourceFiles = this.project.getSourceFiles();
    
    for (const sourceFile of sourceFiles) {
      sourceFile.forEachDescendant(node => {
        if (Node.isNewExpression(node)) {
          this.processNewExpression(node);
        } else if (Node.isCallExpression(node)) {
          this.processCallExpression(node);
        }
      });
    }
    
    console.log(`   📊 Found ${this.instantiatedTypes.size} instantiated types`);
  }

  /**
   * Process constructor calls (new expressions)
   */
  private processNewExpression(node: NewExpression): void {
    try {
      const expression = node.getExpression();
      let typeName: string | undefined;
      
      if (Node.isIdentifier(expression)) {
        typeName = expression.getText();
      } else if (Node.isPropertyAccessExpression(expression)) {
        // Handle namespaced constructors like MyNamespace.MyClass
        typeName = expression.getName();
      }
      
      if (typeName) {
        this.instantiatedTypes.add(typeName);
        
        // Add interface names if the class implements them
        this.addImplementedInterfaces(typeName, node);
        
        // Record instantiation location for debugging
        const instantiationInfo: InstantiationInfo = {
          typeName,
          filePath: node.getSourceFile().getFilePath(),
          lineNumber: node.getStartLineNumber(),
          instantiationType: 'constructor'
        };
        
        if (!this.typeInstantiationMap.has(typeName)) {
          this.typeInstantiationMap.set(typeName, []);
        }
        this.typeInstantiationMap.get(typeName)!.push(instantiationInfo);
      }
    } catch {
      // Ignore errors in type resolution
    }
  }

  /**
   * Process call expressions that might create instances
   */
  private processCallExpression(node: CallExpression): void {
    try {
      const expression = node.getExpression();
      
      // Look for factory methods or other instance creation patterns
      if (Node.isPropertyAccessExpression(expression)) {
        const methodName = expression.getName();
        
        // Common factory method patterns
        if (methodName === 'create' || methodName === 'getInstance' || 
            methodName === 'build' || methodName === 'new') {
          
          // Try to determine the return type
          const type = this.typeChecker.getTypeAtLocation(node);
          const symbol = type.getSymbol();
          
          if (symbol) {
            const typeName = symbol.getName();
            if (typeName && typeName !== 'unknown') {
              this.instantiatedTypes.add(typeName);
              
              const instantiationInfo: InstantiationInfo = {
                typeName,
                filePath: node.getSourceFile().getFilePath(),
                lineNumber: node.getStartLineNumber(),
                instantiationType: 'factory'
              };
              
              if (!this.typeInstantiationMap.has(typeName)) {
                this.typeInstantiationMap.set(typeName, []);
              }
              this.typeInstantiationMap.get(typeName)!.push(instantiationInfo);
            }
          }
        }
      }
    } catch {
      // Ignore errors in type resolution
    }
  }

  /**
   * Filter CHA candidates based on instantiated types
   */
  private filterCHACandidatesWithRTA(
    functions: Map<string, FunctionMetadata>,
    chaCandidates: Map<string, MethodInfo[]>, 
    unresolvedMethodCalls: UnresolvedMethodCall[]
  ): IdealCallEdge[] {
    const rtaEdges: IdealCallEdge[] = [];
    
    // Create mapping from method name to unresolved calls
    const methodCallMap = new Map<string, UnresolvedMethodCall[]>();
    for (const call of unresolvedMethodCalls) {
      if (!methodCallMap.has(call.methodName)) {
        methodCallMap.set(call.methodName, []);
      }
      methodCallMap.get(call.methodName)!.push(call);
    }
    
    for (const [methodName, candidates] of chaCandidates) {
      const rtaFilteredCandidates = candidates.filter(candidate => {
        // Include candidates whose class is instantiated OR whose interfaces are instantiated
        const classInstantiated = this.instantiatedTypes.has(candidate.className);
        const interfacesOfClass = this.classInterfacesMap.get(candidate.className) || [];
        const interfaceInstantiated = interfacesOfClass.some(interfaceName => 
          this.instantiatedTypes.has(interfaceName)
        );
        return classInstantiated || interfaceInstantiated;
      });
      
      if (rtaFilteredCandidates.length > 0) {
        // Get corresponding unresolved calls for this method
        const methodCalls = methodCallMap.get(methodName) || [];
        
        // Create edges for each unresolved call with RTA-filtered candidates
        for (const unresolvedCall of methodCalls) {
          for (const candidate of rtaFilteredCandidates) {
            const functionId = this.findMatchingFunctionId(functions, candidate);
            if (functionId) {
              const edge: IdealCallEdge = {
                id: crypto.randomUUID(),
                callerFunctionId: unresolvedCall.callerFunctionId,
                calleeFunctionId: functionId,
                calleeName: candidate.signature,
                calleeSignature: candidate.signature,
                callType: 'direct',
                callContext: 'rta_resolved',
                lineNumber: unresolvedCall.lineNumber,
                columnNumber: unresolvedCall.columnNumber,
                isAsync: false,
                isChained: false,
                confidenceScore: this.calculateRTAConfidence(candidate, rtaFilteredCandidates.length),
                metadata: {
                  rtaCandidate: true,
                  originalCHACandidates: candidates.length,
                  rtaFilteredCandidates: rtaFilteredCandidates.length,
                  instantiatedType: candidate.className,
                  receiverType: unresolvedCall.receiverType
                },
                createdAt: new Date().toISOString(),
                
                // Ideal system properties
                resolutionLevel: 'rta_resolved' as ResolutionLevel,
                resolutionSource: 'rta_analysis',
                runtimeConfirmed: false,
                candidates: rtaFilteredCandidates.map(c => this.findMatchingFunctionId(functions, c)).filter(id => id !== undefined) as string[],
                analysisMetadata: {
                  timestamp: Date.now(),
                  analysisVersion: '1.0',
                  sourceHash: candidate.filePath
                }
              };
              
              rtaEdges.push(edge);
            }
          }
        }
      }
    }
    
    return rtaEdges;
  }

  /**
   * Calculate RTA confidence score
   */
  private calculateRTAConfidence(candidate: MethodInfo, totalRTACandidates: number): number {
    const baseConfidence = 0.9; // Base RTA confidence (higher than CHA)
    
    // Non-linear penalty: 1 - 1/√n approach
    // As candidates increase, penalty grows more slowly (non-linear)
    const candidatePenalty = totalRTACandidates > 1 ? 
      Math.min(0.2, 1 - (1 / Math.sqrt(totalRTACandidates))) : 0;
    
    // Boost confidence for concrete implementations
    const concreteBonus = candidate.isAbstract ? 0 : 0.05;
    
    // Boost confidence for constructor calls vs factory methods or interface implementations
    const instantiationInfo = this.typeInstantiationMap.get(candidate.className);
    const constructorBonus = instantiationInfo?.some(info => info.instantiationType === 'constructor') ? 0.02 : 0;
    
    // Check if class implements any instantiated interfaces
    const interfacesOfClass = this.classInterfacesMap.get(candidate.className) || [];
    const interfaceBonus = interfacesOfClass.some(interfaceName => 
      this.instantiatedTypes.has(interfaceName)
    ) ? 0.01 : 0;
    
    const confidence = baseConfidence - candidatePenalty + concreteBonus + constructorBonus + interfaceBonus;
    
    return Math.max(0.7, Math.min(1.0, confidence));
  }

  /**
   * Find matching function ID in the function registry for a method candidate
   */
  private findMatchingFunctionId(functions: Map<string, FunctionMetadata>, candidate: MethodInfo): string | undefined {
    try {
      // Strategy 1: Exact match with position and metadata (most accurate)
      for (const [functionId, functionMetadata] of functions) {
        if (functionMetadata.filePath === candidate.filePath &&
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
        if (functionMetadata.filePath === candidate.filePath &&
            Math.abs(functionMetadata.startLine - candidate.startLine) <= 2 && // Allow small line differences
            functionMetadata.name === candidate.name &&
            functionMetadata.className === candidate.className) {
          return functionId;
        }
      }
      
      // Strategy 4: Search by class and method name in same file
      for (const [functionId, functionMetadata] of functions) {
        if (functionMetadata.filePath === candidate.filePath &&
            functionMetadata.name === candidate.name &&
            functionMetadata.className === candidate.className) {
          return functionId;
        }
      }
      
      // Strategy 5: Search by method name only in same file (most lenient)
      for (const [functionId, functionMetadata] of functions) {
        if (functionMetadata.filePath === candidate.filePath &&
            functionMetadata.name === candidate.name &&
            functionMetadata.isMethod) {
          return functionId;
        }
      }
      
      // Debug: log failed match attempts
      console.warn(`RTA: Failed to find function ID for candidate:`, {
        name: candidate.name,
        className: candidate.className,
        filePath: candidate.filePath,
        startLine: candidate.startLine
      });
      
      return undefined;
    } catch (error) {
      console.warn(`RTA: Error in findMatchingFunctionId:`, error);
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
   * Get instantiated types for debugging
   */
  getInstantiatedTypes(): Set<string> {
    return new Set(this.instantiatedTypes);
  }

  /**
   * Get type instantiation information
   */
  getTypeInstantiationInfo(): Map<string, InstantiationInfo[]> {
    return new Map(this.typeInstantiationMap);
  }

  /**
   * Check if a type is instantiated
   */
  isTypeInstantiated(typeName: string): boolean {
    return this.instantiatedTypes.has(typeName);
  }

  /**
   * Add interface names to instantiated types when a class implements them
   */
  private addImplementedInterfaces(typeName: string, node: NewExpression): void {
    try {
      // Use ts-morph to navigate the AST instead of the TypeScript compiler API
      const expression = node.getExpression();
      
      if (expression) {
        // Try to get the symbol and find the class declaration
        const symbol = expression.getSymbol();
        if (symbol) {
          const declarations = symbol.getDeclarations();
          for (const declaration of declarations) {
            if (Node.isClassDeclaration(declaration)) {
              const implementsClauses = declaration.getImplements();
              const implementedInterfaces: string[] = [];
              
              for (const implementsClause of implementsClauses) {
                const interfaceName = implementsClause.getExpression().getText();
                if (interfaceName) {
                  this.instantiatedTypes.add(interfaceName);
                  implementedInterfaces.push(interfaceName);
                  
                  // Record interface instantiation info
                  const instantiationInfo: InstantiationInfo = {
                    typeName: interfaceName,
                    filePath: node.getSourceFile().getFilePath(),
                    lineNumber: node.getStartLineNumber(),
                    instantiationType: 'interface'
                  };
                  
                  if (!this.typeInstantiationMap.has(interfaceName)) {
                    this.typeInstantiationMap.set(interfaceName, []);
                  }
                  this.typeInstantiationMap.get(interfaceName)!.push(instantiationInfo);
                }
              }
              
              // Build class -> interfaces mapping
              if (implementedInterfaces.length > 0) {
                const existingInterfaces = this.classInterfacesMap.get(typeName) || [];
                const allInterfaces = [...new Set([...existingInterfaces, ...implementedInterfaces])];
                this.classInterfacesMap.set(typeName, allInterfaces);
              }
            }
          }
        }
      }
    } catch {
      // Ignore errors in interface resolution
    }
  }

  /**
   * Clear internal state
   */
  clear(): void {
    this.instantiatedTypes.clear();
    this.typeInstantiationMap.clear();
    this.classInterfacesMap.clear();
  }
}

export interface InstantiationInfo {
  typeName: string;
  filePath: string;
  lineNumber: number;
  instantiationType: 'constructor' | 'factory' | 'interface';
}
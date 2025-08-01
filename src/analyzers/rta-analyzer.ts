import { Project, Node, TypeChecker, CallExpression, NewExpression } from 'ts-morph';
import { FunctionMetadata, IdealCallEdge, ResolutionLevel } from './ideal-call-graph-analyzer';
import { MethodInfo, UnresolvedMethodCall } from './cha-analyzer';
import { generateStableEdgeId } from '../utils/edge-id-generator';
import { PathNormalizer } from '../utils/path-normalizer';
import { FunctionIndex } from './function-index';
import { getRelativePath } from '../utils/path-utils';

// Import InstantiationEvent from staged-analysis types
import type { InstantiationEvent } from './staged-analysis/types';

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
  
  // Performance optimization: O(1) function lookup index
  private functionIndex: FunctionIndex | undefined;
  private candidateIdCache = new Map<string, string | undefined>();

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
    unresolvedMethodCalls: UnresolvedMethodCall[],
    prebuiltClassToInterfacesMap?: Map<string, string[]>
  ): Promise<IdealCallEdge[]> {
    // Use prebuilt class-to-interfaces mapping if available
    if (prebuiltClassToInterfacesMap) {
      this.classInterfacesMap = new Map(prebuiltClassToInterfacesMap);
    }
    
    await this.buildInstantiatedTypesRegistry();
    
    const rtaEdges = this.filterCHACandidatesWithRTA(functions, chaCandidates, unresolvedMethodCalls);
    
    return rtaEdges;
  }

  /**
   * Optimized RTA analysis using prebuilt instantiation events
   * Eliminates duplicate AST traversal by using events collected during Stage 1&2
   */
  async performRTAAnalysisOptimized(
    functions: Map<string, FunctionMetadata>,
    chaCandidates: Map<string, MethodInfo[]>,
    unresolvedMethodCalls: UnresolvedMethodCall[],
    prebuiltInstantiationEvents: InstantiationEvent[],
    prebuiltClassToInterfacesMap?: Map<string, string[]>
  ): Promise<IdealCallEdge[]> {
    
    // Use prebuilt class-to-interfaces mapping if available
    if (prebuiltClassToInterfacesMap) {
      this.classInterfacesMap = new Map(prebuiltClassToInterfacesMap);
    }
    
    this.buildInstantiatedTypesFromEvents(prebuiltInstantiationEvents);
    
    const rtaEdges = this.filterCHACandidatesWithRTA(functions, chaCandidates, unresolvedMethodCalls);
    
    return rtaEdges;
  }

  /**
   * Build instantiated types registry from prebuilt events (optimization)
   * Eliminates duplicate AST traversal - events were collected during Stage 1&2
   */
  private buildInstantiatedTypesFromEvents(instantiationEvents: InstantiationEvent[]): void {
    this.instantiatedTypes.clear();
    this.typeInstantiationMap.clear();
    // Only clear classInterfacesMap if it wasn't prebuilt from CHA
    if (this.classInterfacesMap.size === 0) {
      this.classInterfacesMap.clear();
    }
    
    for (const event of instantiationEvents) {
      this.instantiatedTypes.add(event.typeName);
      
      // Add implemented interfaces if available (only if not prebuilt from CHA)
      if (event.instantiationType === 'constructor' && Node.isNewExpression(event.node)) {
        // Only call expensive addImplementedInterfaces if mapping wasn't prebuilt
        if (!this.classInterfacesMap.has(event.typeName)) {
          this.addImplementedInterfaces(event.typeName, event.node);
        } else {
          // Use prebuilt mapping - much faster
          const implementedInterfaces = this.classInterfacesMap.get(event.typeName) || [];
          for (const interfaceName of implementedInterfaces) {
            this.instantiatedTypes.add(interfaceName);
            
            // Record interface instantiation info
            const instantiationInfo: InstantiationInfo = {
              typeName: interfaceName,
              filePath: event.filePath,
              lineNumber: event.lineNumber,
              instantiationType: 'interface'
            };
            
            if (!this.typeInstantiationMap.has(interfaceName)) {
              this.typeInstantiationMap.set(interfaceName, []);
            }
            this.typeInstantiationMap.get(interfaceName)!.push(instantiationInfo);
          }
        }
      }
      
      // Convert InstantiationEvent to InstantiationInfo format
      const instantiationInfo: InstantiationInfo = {
        typeName: event.typeName,
        filePath: event.filePath,
        lineNumber: event.lineNumber,
        instantiationType: event.instantiationType
      };
      
      if (!this.typeInstantiationMap.has(event.typeName)) {
        this.typeInstantiationMap.set(event.typeName, []);
      }
      this.typeInstantiationMap.get(event.typeName)!.push(instantiationInfo);
    }
    
    const prebuiltMappingCount = this.classInterfacesMap.size;
    if (prebuiltMappingCount > 0) {
    }
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
        
        // Add interface names if the class implements them (check prebuilt mapping first)
        if (this.classInterfacesMap.has(typeName)) {
          // Use prebuilt mapping - much faster
          const implementedInterfaces = this.classInterfacesMap.get(typeName) || [];
          for (const interfaceName of implementedInterfaces) {
            this.instantiatedTypes.add(interfaceName);
            
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
        } else {
          // Fallback to expensive addImplementedInterfaces
          this.addImplementedInterfaces(typeName, node);
        }
        
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
   * Filter CHA candidates based on instantiated types (optimized reverse strategy)
   * Instead of filtering all candidates, start from instantiated types for efficiency
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
    
    // Use optimized reverse strategy if we have many instantiated types
    if (this.instantiatedTypes.size >= 10) {
      return this.filterCHACandidatesWithRTAReverse(functions, chaCandidates, unresolvedMethodCalls, methodCallMap);
    }
    
    // Fallback to original strategy for small type sets
    for (const [methodName, candidates] of chaCandidates) {
      const rtaFilteredCandidates = candidates.filter(candidate => {
        // RTA Filtering: Only include candidates whose concrete class is directly instantiated
        // This is the core principle of RTA - filter based on actual instantiations
        return this.instantiatedTypes.has(candidate.className);
      });
      
      if (rtaFilteredCandidates.length > 0) {
        // Get corresponding unresolved calls for this method
        const methodCalls = methodCallMap.get(methodName) || [];
        
        // Use helper method for edge creation (shared with reverse strategy)
        this.createRTAEdgesForCandidates(
          rtaEdges,
          functions,
          rtaFilteredCandidates,
          candidates, // Pass all candidates for metadata
          methodCalls
        );
      }
    }
    
    return rtaEdges;
  }

  /**
   * Reverse RTA filtering strategy: Start from instantiated types for efficiency
   * O(I) where I = instantiated types, instead of O(C) where C = all candidates
   */
  private filterCHACandidatesWithRTAReverse(
    functions: Map<string, FunctionMetadata>,
    chaCandidates: Map<string, MethodInfo[]>,
    _unresolvedMethodCalls: UnresolvedMethodCall[],
    methodCallMap: Map<string, UnresolvedMethodCall[]>
  ): IdealCallEdge[] {
    const rtaEdges: IdealCallEdge[] = [];
    
    // Build reverse index: className -> Set<methodName> for O(1) lookup
    const classToMethodsIndex = new Map<string, Set<string>>();
    for (const [methodName, candidates] of chaCandidates) {
      for (const candidate of candidates) {
        if (!classToMethodsIndex.has(candidate.className)) {
          classToMethodsIndex.set(candidate.className, new Set());
        }
        classToMethodsIndex.get(candidate.className)!.add(methodName);
      }
    }
    
    // Process each instantiated type (much smaller set than all candidates)
    const processedMethods = new Set<string>(); // Avoid duplicate processing
    
    for (const instantiatedType of this.instantiatedTypes) {
      // Find methods for this instantiated type
      const methodsForType = classToMethodsIndex.get(instantiatedType);
      if (!methodsForType) continue;
      
      for (const methodName of methodsForType) {
        if (processedMethods.has(`${instantiatedType}.${methodName}`)) continue;
        processedMethods.add(`${instantiatedType}.${methodName}`);
        
        // Get all candidates for this method
        const allCandidates = chaCandidates.get(methodName) || [];
        
        // RTA Filtering: Only include candidates whose class types are instantiated
        const rtaFilteredCandidates = allCandidates.filter(candidate => {
          // Check if this candidate's class is instantiated
          return this.instantiatedTypes.has(candidate.className);
        });
        
        if (rtaFilteredCandidates.length > 0) {
          this.createRTAEdgesForCandidates(
            rtaEdges,
            functions,
            rtaFilteredCandidates,
            allCandidates,
            methodCallMap.get(methodName) || []
          );
        }
      }
    }
    
    
    return rtaEdges;
  }

  /**
   * Helper method to create RTA edges for filtered candidates (optimized aggregation)
   * Reduces O(U × C) double nesting through candidate aggregation
   */
  private createRTAEdgesForCandidates(
    rtaEdges: IdealCallEdge[],
    functions: Map<string, FunctionMetadata>,
    rtaFilteredCandidates: MethodInfo[],
    allCandidates: MethodInfo[],
    methodCalls: UnresolvedMethodCall[]
  ): void {
    if (rtaFilteredCandidates.length === 0 || methodCalls.length === 0) return;
    
    // Pre-resolve all candidates with memoization to avoid duplicate lookups
    const resolvedCandidates = rtaFilteredCandidates
      .map(candidate => ({
        candidate,
        functionId: this.resolveCandidateId(candidate, functions)
      }))
      .filter(resolved => resolved.functionId !== undefined) as Array<{ candidate: MethodInfo; functionId: string }>;
    
    if (resolvedCandidates.length === 0) return;
    
    // Extract function IDs for candidates array (reuse resolved results)
    const candidateIds = resolvedCandidates.map(r => r.functionId!);
    
    // Pre-calculate common metadata once
    const commonMetadata = {
      rtaCandidate: true,
      originalCHACandidates: allCandidates.length,
      rtaFilteredCandidates: rtaFilteredCandidates.length
    };
    
    const analysisMetadata = {
      timestamp: Date.now(),
      analysisVersion: '1.0'
    };
    
    // Use optimized aggregation if we have many calls and candidates
    if (methodCalls.length > 5 && resolvedCandidates.length > 3) {
      this.createAggregatedEdges(rtaEdges, resolvedCandidates, methodCalls, candidateIds, commonMetadata, analysisMetadata);
    } else {
      this.createIndividualEdges(rtaEdges, resolvedCandidates, methodCalls, candidateIds, commonMetadata, analysisMetadata);
    }
  }

  /**
   * Create aggregated edges for high-volume scenarios
   * Groups candidates by caller to reduce duplicate edge creation
   */
  private createAggregatedEdges(
    rtaEdges: IdealCallEdge[],
    resolvedCandidates: Array<{ candidate: MethodInfo; functionId: string }>,
    methodCalls: UnresolvedMethodCall[],
    candidateIds: string[],
    commonMetadata: object,
    analysisMetadata: { timestamp: number; analysisVersion: string }
  ): void {
    // Group method calls by caller for batch processing
    const callsByCaller = new Map<string, UnresolvedMethodCall[]>();
    for (const call of methodCalls) {
      if (!callsByCaller.has(call.callerFunctionId)) {
        callsByCaller.set(call.callerFunctionId, []);
      }
      callsByCaller.get(call.callerFunctionId)!.push(call);
    }
    
    // Process each caller group
    for (const [callerFunctionId, callerCalls] of callsByCaller) {
      // Pick representative call for shared properties
      const representativeCall = callerCalls[0];
      
      // Create edges for each candidate from this caller
      for (const resolved of resolvedCandidates) {
        const edge: IdealCallEdge = {
          id: generateStableEdgeId(callerFunctionId, resolved.functionId),
          callerFunctionId,
          calleeFunctionId: resolved.functionId,
          calleeName: resolved.candidate.signature,
          calleeSignature: resolved.candidate.signature,
          callType: 'direct',
          callContext: 'rta_resolved',
          lineNumber: representativeCall.lineNumber,
          columnNumber: representativeCall.columnNumber,
          isAsync: false,
          isChained: false,
          confidenceScore: this.calculateRTAConfidence(resolved.candidate, resolvedCandidates.length),
          metadata: {
            ...commonMetadata,
            instantiatedType: resolved.candidate.className,
            receiverType: representativeCall.receiverType,
            aggregatedCalls: callerCalls.length // Indicate aggregation
          },
          createdAt: new Date().toISOString(),
          
          // Ideal system properties
          resolutionLevel: 'rta_resolved' as ResolutionLevel,
          resolutionSource: 'rta_analysis',
          runtimeConfirmed: false,
          candidates: candidateIds,
          analysisMetadata: {
            timestamp: analysisMetadata.timestamp,
            analysisVersion: analysisMetadata.analysisVersion,
            sourceHash: resolved.candidate.filePath
          }
        };
        
        rtaEdges.push(edge);
      }
    }
    
    if (methodCalls.length > 10) {
    }
  }

  /**
   * Create individual edges for low-volume scenarios (original behavior)
   * Maintains full fidelity for smaller datasets
   */
  private createIndividualEdges(
    rtaEdges: IdealCallEdge[],
    resolvedCandidates: Array<{ candidate: MethodInfo; functionId: string }>,
    methodCalls: UnresolvedMethodCall[],
    candidateIds: string[],
    commonMetadata: object,
    analysisMetadata: { timestamp: number; analysisVersion: string }
  ): void {
    // Traditional double loop for small datasets
    for (const unresolvedCall of methodCalls) {
      for (const resolved of resolvedCandidates) {
        const edge: IdealCallEdge = {
          id: generateStableEdgeId(unresolvedCall.callerFunctionId, resolved.functionId),
          callerFunctionId: unresolvedCall.callerFunctionId,
          calleeFunctionId: resolved.functionId,
          calleeName: resolved.candidate.signature,
          calleeSignature: resolved.candidate.signature,
          callType: 'direct',
          callContext: 'rta_resolved',
          lineNumber: unresolvedCall.lineNumber,
          columnNumber: unresolvedCall.columnNumber,
          isAsync: false,
          isChained: false,
          confidenceScore: this.calculateRTAConfidence(resolved.candidate, resolvedCandidates.length),
          metadata: {
            ...commonMetadata,
            instantiatedType: resolved.candidate.className,
            receiverType: unresolvedCall.receiverType
          },
          createdAt: new Date().toISOString(),
          
          // Ideal system properties
          resolutionLevel: 'rta_resolved' as ResolutionLevel,
          resolutionSource: 'rta_analysis',
          runtimeConfirmed: false,
          candidates: candidateIds,
          analysisMetadata: {
            timestamp: analysisMetadata.timestamp,
            analysisVersion: analysisMetadata.analysisVersion,
            sourceHash: resolved.candidate.filePath
          }
        };
        
        rtaEdges.push(edge);
      }
    }
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
   * @deprecated Use FunctionIndex.resolve() instead for O(1) performance
   */
  // @ts-expect-error - Method kept for future use
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
      const relativePath = getRelativePath(candidate.filePath);
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
    this.functionIndex?.clear();
    this.functionIndex = undefined;
    this.candidateIdCache.clear();
  }

  /**
   * Ensure function index is built for O(1) lookups
   */
  private ensureFunctionIndex(functions: Map<string, FunctionMetadata>): void {
    if (!this.functionIndex) {
      this.functionIndex = new FunctionIndex();
      this.functionIndex.build(functions);
    }
  }

  /**
   * Optimized candidate resolution with memoization
   * Replaces the expensive findMatchingFunctionId with O(1) lookup
   */
  private resolveCandidateId(candidate: MethodInfo, functions: Map<string, FunctionMetadata>): string | undefined {
    // Create cache key from candidate properties
    const cacheKey = `${candidate.filePath}|${candidate.startLine}|${candidate.className || ''}|${candidate.name}`;
    
    // Check cache first
    if (this.candidateIdCache.has(cacheKey)) {
      return this.candidateIdCache.get(cacheKey);
    }
    
    // Ensure index is built
    this.ensureFunctionIndex(functions);
    
    // Resolve using O(1) index lookup
    const functionId = this.functionIndex!.resolve(candidate);
    
    // Cache result for future use
    this.candidateIdCache.set(cacheKey, functionId);
    
    return functionId;
  }

}

export interface InstantiationInfo {
  typeName: string;
  filePath: string;
  lineNumber: number;
  instantiationType: 'constructor' | 'factory' | 'interface';
}
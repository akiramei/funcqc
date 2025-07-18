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

  constructor(project: Project, typeChecker: TypeChecker) {
    this.project = project;
    this.typeChecker = typeChecker;
  }

  /**
   * Perform RTA analysis to refine CHA candidates
   */
  async performRTAAnalysis(
    _functions: Map<string, FunctionMetadata>,
    chaCandidates: Map<string, MethodInfo[]>,
    unresolvedMethodCalls: UnresolvedMethodCall[]
  ): Promise<IdealCallEdge[]> {
    console.log('   🎯 Building instantiated types registry...');
    await this.buildInstantiatedTypesRegistry();
    
    console.log('   🔬 Filtering CHA candidates with RTA...');
    const rtaEdges = this.filterCHACandidatesWithRTA(chaCandidates, unresolvedMethodCalls);
    
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
        // Only include candidates whose class is actually instantiated
        return this.instantiatedTypes.has(candidate.className);
      });
      
      if (rtaFilteredCandidates.length > 0) {
        // Get corresponding unresolved calls for this method
        const methodCalls = methodCallMap.get(methodName) || [];
        
        // Create edges for each unresolved call with RTA-filtered candidates
        for (const unresolvedCall of methodCalls) {
          for (const candidate of rtaFilteredCandidates) {
            const functionId = this.buildFunctionId(candidate);
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
                candidates: rtaFilteredCandidates.map(c => this.buildFunctionId(c)).filter(id => id !== undefined) as string[],
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
    
    // Reduce confidence based on number of remaining candidates
    const candidatePenalty = Math.min(0.2, (totalRTACandidates - 1) * 0.03);
    
    // Boost confidence for concrete implementations
    const concreteBonus = candidate.isAbstract ? 0 : 0.05;
    
    // Boost confidence for constructor calls vs factory methods
    const instantiationInfo = this.typeInstantiationMap.get(candidate.className);
    const constructorBonus = instantiationInfo?.some(info => info.instantiationType === 'constructor') ? 0.02 : 0;
    
    const confidence = baseConfidence - candidatePenalty + concreteBonus + constructorBonus;
    
    return Math.max(0.7, Math.min(1.0, confidence));
  }

  /**
   * Build function ID for a method candidate
   */
  private buildFunctionId(candidate: MethodInfo): string | undefined {
    const relativePath = this.getRelativePath(candidate.filePath);
    return `${relativePath}#${candidate.className}.${candidate.name}`;
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
   * Clear internal state
   */
  clear(): void {
    this.instantiatedTypes.clear();
    this.typeInstantiationMap.clear();
  }
}

export interface InstantiationInfo {
  typeName: string;
  filePath: string;
  lineNumber: number;
  instantiationType: 'constructor' | 'factory';
}
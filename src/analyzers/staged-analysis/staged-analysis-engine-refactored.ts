/**
 * Refactored Staged Analysis Engine
 * 
 * Performs call graph analysis in stages with increasing sophistication using modular stages:
 * 1. Local Exact - Same file calls (confidence: 1.0)
 * 2. Import Exact - Cross-file imports via TypeChecker (confidence: 0.95)
 * 3. CHA Resolved - Class Hierarchy Analysis (confidence: 0.8)
 * 4. RTA Resolved - Rapid Type Analysis (confidence: 0.9)
 * 5. Runtime Confirmed - V8 Coverage integration (confidence: 1.0)
 */

import { Project, Node, TypeChecker, CallExpression, NewExpression, SourceFile } from 'ts-morph';
import { IdealCallEdge, FunctionMetadata } from '../ideal-call-graph-analyzer';
import { CHAAnalyzer } from '../cha-analyzer';
import { RTAAnalyzer } from '../rta-analyzer';
import { RuntimeTraceIntegrator } from '../runtime-trace-integrator';
import { SymbolCache } from '../../utils/symbol-cache';
import { Logger } from '../../utils/cli-utils';

// Import stage modules
import { LocalExactAnalysisStage } from './stages/local-exact-analysis';
import { ImportExactAnalysisStage } from './stages/import-exact-analysis';
import { CHAAnalysisStage } from './stages/cha-analysis';
import { RTAAnalysisStage } from './stages/rta-analysis';
import { RuntimeTraceIntegrationStage } from './stages/runtime-trace-integration';

// Import types and constants
import { StagedAnalysisOptions, AnalysisState, AnalysisStatistics } from './types';

export class StagedAnalysisEngine {
  private project: Project;
  // @ts-ignore - Reserved for future use
  private _typeChecker: TypeChecker;
  private logger: Logger;
  // @ts-ignore - Reserved for future use
  private _debug: boolean;

  // Core analyzers
  private chaAnalyzer: CHAAnalyzer;
  private rtaAnalyzer: RTAAnalyzer;
  private runtimeTraceIntegrator: RuntimeTraceIntegrator;
  private symbolCache: SymbolCache;

  // Analysis stages
  private localExactStage: LocalExactAnalysisStage;
  private importExactStage: ImportExactAnalysisStage;
  private chaStage: CHAAnalysisStage;
  private rtaStage: RTAAnalysisStage;
  private runtimeStage: RuntimeTraceIntegrationStage;

  // Analysis state
  private state!: AnalysisState;
  private statistics!: AnalysisStatistics;

  constructor(project: Project, typeChecker: TypeChecker, options: StagedAnalysisOptions = {}) {
    this.project = project;
    this._typeChecker = typeChecker;
    this.logger = options.logger ?? new Logger(false);
    this._debug = process.env['DEBUG_STAGED_ANALYSIS'] === 'true';

    // Initialize state and statistics
    this.resetState();

    // Initialize core analyzers
    this.symbolCache = new SymbolCache(typeChecker);
    this.chaAnalyzer = new CHAAnalyzer(project, typeChecker);
    this.rtaAnalyzer = new RTAAnalyzer(project, typeChecker);
    this.runtimeTraceIntegrator = new RuntimeTraceIntegrator();

    // Initialize analysis stages
    this.localExactStage = new LocalExactAnalysisStage(this.logger);
    this.importExactStage = new ImportExactAnalysisStage(project, typeChecker, this.symbolCache, this.logger);
    this.chaStage = new CHAAnalysisStage(this.chaAnalyzer, this.logger);
    this.rtaStage = new RTAAnalysisStage(this.rtaAnalyzer, this.logger);
    this.runtimeStage = new RuntimeTraceIntegrationStage(this.runtimeTraceIntegrator, this.logger);
  }

  /**
   * Reset analysis state for fresh analysis
   */
  private resetState(): void {
    this.state = {
      edges: [],
      edgeKeys: new Set(),
      edgeIndex: new Map(),
      functionLookupMap: new Map(),
      unresolvedMethodCalls: [],
      instantiationEvents: [],
      unresolvedMethodCallsForRTA: [],
      unresolvedMethodCallsSet: new Set(),
      chaCandidates: new Map(),
      fileToFunctionsMap: new Map(),
      functionContainmentMaps: new Map(),
      positionIdCache: new WeakMap()
    };

    this.statistics = {
      localExactCount: 0,
      importExactCount: 0,
      chaResolvedCount: 0,
      rtaResolvedCount: 0,
      runtimeConfirmedCount: 0,
      unresolvedCount: 0,
      totalTime: 0,
      stageTimings: {
        localExact: 0,
        importExact: 0,
        cha: 0,
        rta: 0,
        runtime: 0
      }
    };
  }

  /**
   * Main entry point for staged analysis
   */
  async performStagedAnalysis(functions: Map<string, FunctionMetadata>): Promise<IdealCallEdge[]> {
    const startTime = performance.now();
    this.resetState();

    this.logger.debug('Starting 5-stage call graph analysis...');
    this.logger.debug(`Functions to analyze: ${functions.size}`);

    // Prepare data structures
    this.buildLookupMaps(functions);

    // Stage 1 & 2: Combined Local and Import Analysis
    this.logger.debug('Stage 1 & 2: Combined local and import analysis...');
    const localImportResult = await this.performCombinedLocalAndImportAnalysis(functions);
    this.statistics.localExactCount = localImportResult.localEdges;
    this.statistics.importExactCount = localImportResult.importEdges;

    // Stage 3: CHA Analysis
    this.logger.debug('Stage 3: CHA analysis...');
    const chaResult = await this.chaStage.performCHAAnalysis(
      functions,
      this.state.unresolvedMethodCalls,
      this.state
    );
    this.statistics.chaResolvedCount = chaResult.resolvedEdges;
    this.state.chaCandidates = chaResult.chaCandidates;
    this.state.unresolvedMethodCallsForRTA = chaResult.unresolvedMethodCallsForRTA;

    // Stage 4: RTA Analysis
    this.logger.debug('Stage 4: RTA analysis...');
    const classToInterfacesMap = this.chaStage.getClassToInterfacesMap();
    const rtaResult = await this.rtaStage.performRTAAnalysis(
      functions,
      this.state.chaCandidates,
      this.state.unresolvedMethodCallsForRTA,
      this.state.instantiationEvents,
      classToInterfacesMap,
      this.state
    );
    this.statistics.rtaResolvedCount = rtaResult;

    // Stage 5: Runtime Trace Integration
    this.logger.debug('Stage 5: Runtime trace integration...');
    const runtimeResult = await this.runtimeStage.performRuntimeTraceIntegration(
      this.state.edges,
      functions
    );
    this.state.edges = runtimeResult.integratedEdges;
    this.statistics.runtimeConfirmedCount = runtimeResult.enhancedEdgesCount;

    // Calculate final statistics
    const endTime = performance.now();
    this.statistics.totalTime = (endTime - startTime) / 1000;
    this.statistics.unresolvedCount = this.state.unresolvedMethodCalls.length;

    this.logFinalStatistics();
    return this.state.edges;
  }

  /**
   * Combined Local and Import Analysis (optimized single-pass)
   */
  private async performCombinedLocalAndImportAnalysis(
    functions: Map<string, FunctionMetadata>
  ): Promise<{ localEdges: number, importEdges: number }> {
    const startTime = performance.now();
    const sourceFiles = this.project.getSourceFiles();
    let localEdgesCount = 0;
    let importEdgesCount = 0;
    let processedFiles = 0;

    // Build import stage lookup map
    this.importExactStage.buildFunctionLookupMap(functions);

    for (const sourceFile of sourceFiles) {
      if (processedFiles % 20 === 0) {
        this.logger.debug(`      Progress: ${processedFiles}/${sourceFiles.length} files processed...`);
      }

      const filePath = sourceFile.getFilePath();
      const fileFunctions = this.state.fileToFunctionsMap.get(filePath) || [];

      if (fileFunctions.length === 0) {
        processedFiles++;
        continue;
      }

      // Stage 1: Local Exact Analysis
      const localResult = await this.localExactStage.analyzeFile(
        sourceFile,
        fileFunctions,
        functions,
        this.state
      );
      localEdgesCount += localResult.localEdges;
      this.state.instantiationEvents.push(...localResult.instantiationEvents);

      // Collect expressions for import analysis
      const callExpressions: Node[] = [];
      const newExpressions: Node[] = [];
      this.collectUnresolvedExpressions(sourceFile, callExpressions, newExpressions, fileFunctions);

      // Stage 2: Import Exact Analysis
      const importResult = await this.importExactStage.analyzeImportCalls(
        callExpressions,
        newExpressions,
        functions,
        this.state
      );
      importEdgesCount += importResult;

      processedFiles++;
    }

    const endTime = performance.now();
    const duration = (endTime - startTime) / 1000;
    this.statistics.stageTimings.localExact = duration / 2; // Approximation
    this.statistics.stageTimings.importExact = duration / 2;

    this.logger.debug(`      Completed: ${processedFiles}/${sourceFiles.length} files processed in ${duration.toFixed(2)}s`);
    return { localEdges: localEdgesCount, importEdges: importEdgesCount };
  }

  /**
   * Collect expressions that weren't resolved by local analysis
   */
  private collectUnresolvedExpressions(
    sourceFile: SourceFile,
    callExpressions: Node[],
    newExpressions: Node[],
    fileFunctions: FunctionMetadata[]
  ): void {
    const stack: Node[] = [sourceFile];

    while (stack.length > 0) {
      const current = stack.pop()!;

      if (Node.isCallExpression(current)) {
        // Only add if not already resolved locally
        const edgeKey = this.generateCallEdgeKey(current, fileFunctions);
        if (edgeKey && !this.state.edgeKeys.has(edgeKey)) {
          callExpressions.push(current);
        }
      } else if (Node.isNewExpression(current)) {
        const edgeKey = this.generateNewEdgeKey(current, fileFunctions);
        if (edgeKey && !this.state.edgeKeys.has(edgeKey)) {
          newExpressions.push(current);
        }
      }

      // Add children to stack
      for (const child of current.getChildren()) {
        stack.push(child);
      }
    }
  }

  /**
   * Generate edge key for call expression
   */
  private generateCallEdgeKey(callExpr: CallExpression, fileFunctions: FunctionMetadata[]): string | undefined {
    // This is a simplified version - implement full edge key generation logic
    const caller = this.findContainingFunction(callExpr, fileFunctions);
    if (!caller) return undefined;

    const expression = callExpr.getExpression();
    let calleeSignature = 'unknown';
    
    if (Node.isIdentifier(expression)) {
      calleeSignature = expression.getText();
    } else if (Node.isPropertyAccessExpression(expression)) {
      calleeSignature = expression.getName();
    }

    return `${caller.id}->${calleeSignature}`;
  }

  /**
   * Generate edge key for new expression
   */
  private generateNewEdgeKey(newExpr: NewExpression, fileFunctions: FunctionMetadata[]): string | undefined {
    const caller = this.findContainingFunction(newExpr, fileFunctions);
    if (!caller) return undefined;

    const expression = newExpr.getExpression();
    let className = 'unknown';
    
    if (Node.isIdentifier(expression)) {
      className = expression.getText();
    }

    return `${caller.id}->new ${className}`;
  }

  /**
   * Find containing function for a node
   */
  private findContainingFunction(node: Node, fileFunctions: FunctionMetadata[]): FunctionMetadata | undefined {
    let current = node.getParent();

    while (current) {
      if (Node.isFunctionDeclaration(current) || 
          Node.isMethodDeclaration(current) || 
          Node.isArrowFunction(current) || 
          Node.isFunctionExpression(current) || 
          Node.isConstructorDeclaration(current)) {
        
        const startLine = current.getStartLineNumber();
        const endLine = current.getEndLineNumber();

        // Find matching function
        const match = fileFunctions.find(f => 
          f.startLine === startLine && f.endLine === endLine
        );
        if (match) return match;
      }

      current = current.getParent();
    }

    return undefined;
  }

  /**
   * Build lookup maps for efficient analysis
   */
  private buildLookupMaps(functions: Map<string, FunctionMetadata>): void {
    // Build file to functions map
    for (const [id, func] of functions) {
      const existing = this.state.fileToFunctionsMap.get(func.filePath) || [];
      existing.push(func);
      this.state.fileToFunctionsMap.set(func.filePath, existing);

      // Build function lookup map
      const startColumn = 0; // Use 0 as default since startColumn is not available in FunctionMetadata
      const key = `${func.filePath}:${func.startLine}:${startColumn}`;
      this.state.functionLookupMap.set(key, id);
    }

    this.logger.debug(`Built lookup maps: ${this.state.fileToFunctionsMap.size} files, ${functions.size} functions`);
  }

  /**
   * Log final analysis statistics
   */
  private logFinalStatistics(): void {
    const total = this.statistics.localExactCount + 
                  this.statistics.importExactCount + 
                  this.statistics.chaResolvedCount + 
                  this.statistics.rtaResolvedCount;

    this.logger.debug('=== Staged Analysis Results ===');
    this.logger.debug(`Local Exact:     ${this.statistics.localExactCount} edges`);
    this.logger.debug(`Import Exact:    ${this.statistics.importExactCount} edges`);
    this.logger.debug(`CHA Resolved:    ${this.statistics.chaResolvedCount} edges`);
    this.logger.debug(`RTA Resolved:    ${this.statistics.rtaResolvedCount} edges`);
    this.logger.debug(`Runtime Enhanced: ${this.statistics.runtimeConfirmedCount} edges`);
    this.logger.debug(`Total Edges:     ${total} edges`);
    this.logger.debug(`Analysis Time:   ${this.statistics.totalTime.toFixed(2)}s`);
    this.logger.debug('==============================');
  }

  /**
   * Get analysis statistics
   */
  getStatistics(): AnalysisStatistics {
    return { ...this.statistics };
  }

  /**
   * Get all resolved edges
   */
  getEdges(): IdealCallEdge[] {
    return [...this.state.edges];
  }
}
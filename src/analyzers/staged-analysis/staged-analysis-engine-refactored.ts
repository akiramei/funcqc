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

import { Project, TypeChecker } from 'ts-morph';
import { IdealCallEdge, FunctionMetadata } from '../ideal-call-graph-analyzer';
import { RTAAnalyzer } from '../rta-analyzer';
import { RuntimeTraceIntegrator } from '../runtime-trace-integrator';
import { SymbolCache } from '../../utils/symbol-cache';
import { Logger } from '../../utils/cli-utils';

// Import stage modules
import { LocalExactAnalysisStage } from './stages/local-exact-analysis';
import { ImportExactAnalysisStage } from './stages/import-exact-analysis';
import { CHATypeSystemAnalysisStage } from './stages/cha-type-system-analysis';
import { RTAAnalysisStage } from './stages/rta-analysis';
import { RuntimeTraceIntegrationStage } from './stages/runtime-trace-integration';
import { ExternalCallAnalysisStage } from './stages/external-call-analysis';
import { CallbackRegistrationAnalysisStage } from '../callback-registration/callback-registration-stage';

// Import types and constants
import { StagedAnalysisOptions, AnalysisState, AnalysisStatistics } from './types';
import { StorageAdapter } from '../../types';

export class StagedAnalysisEngine {
  private project: Project;
  // @ts-expect-error - Reserved for future use
  private _typeChecker: TypeChecker;
  private logger: Logger;
  // @ts-expect-error - Reserved for future use
  private _debug: boolean;

  // Core analyzers
  private rtaAnalyzer: RTAAnalyzer;
  private runtimeTraceIntegrator: RuntimeTraceIntegrator;
  private symbolCache: SymbolCache;

  // Analysis stages
  private localExactStage: LocalExactAnalysisStage;
  private importExactStage: ImportExactAnalysisStage;
  private chaStage: CHATypeSystemAnalysisStage;
  private rtaStage: RTAAnalysisStage;
  private runtimeStage: RuntimeTraceIntegrationStage;
  private externalCallStage: ExternalCallAnalysisStage;
  private callbackRegistrationStage: CallbackRegistrationAnalysisStage;

  // Storage adapter for type information
  private storage: StorageAdapter | undefined;

  // Analysis state
  private state!: AnalysisState;
  private statistics!: AnalysisStatistics;

  constructor(project: Project, typeChecker: TypeChecker, options: StagedAnalysisOptions & {
    snapshotId?: string;
    storage?: StorageAdapter;
  } = {}) {
    this.project = project;
    this._typeChecker = typeChecker;
    this.logger = options.logger ?? new Logger(false);
    this._debug = process.env['DEBUG_STAGED_ANALYSIS'] === 'true';
    console.log(`[STAGE-DEBUG] Constructor: DEBUG_STAGED_ANALYSIS=${process.env['DEBUG_STAGED_ANALYSIS']}, _debug=${this._debug}`);
    this.storage = options.storage;

    // Initialize state and statistics
    this.resetState();

    // Initialize core analyzers
    this.symbolCache = new SymbolCache(typeChecker);
    this.rtaAnalyzer = new RTAAnalyzer(project, typeChecker);
    this.runtimeTraceIntegrator = new RuntimeTraceIntegrator();

    // Initialize analysis stages
    this.localExactStage = new LocalExactAnalysisStage(this.logger);
    this.importExactStage = new ImportExactAnalysisStage(project, typeChecker, this.symbolCache, this.logger);
    this.chaStage = new CHATypeSystemAnalysisStage(project, typeChecker, this.logger);
    
    // Set storage adapter for type system integration if available
    if (this.storage) {
      this.chaStage.setStorage(this.storage);
    }
    
    this.rtaStage = new RTAAnalysisStage(this.rtaAnalyzer, this.logger);
    this.runtimeStage = new RuntimeTraceIntegrationStage(this.runtimeTraceIntegrator, this.logger);
    this.externalCallStage = new ExternalCallAnalysisStage(this.logger);
    this.callbackRegistrationStage = new CallbackRegistrationAnalysisStage(this.logger);
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
      positionIdCache: new WeakMap(),
      snapshotId: undefined
    };

    this.statistics = {
      localExactCount: 0,
      importExactCount: 0,
      chaResolvedCount: 0,
      rtaResolvedCount: 0,
      runtimeConfirmedCount: 0,
      externalCallsCount: 0,
      callbackRegistrationsCount: 0,
      virtualEdgesCount: 0,
      unresolvedCount: 0,
      totalTime: 0,
      stageTimings: {
        localExact: 0,
        importExact: 0,
        cha: 0,
        rta: 0,
        runtime: 0,
        external: 0,
        callbackRegistration: 0
      }
    };
  }

  /**
   * Main entry point for staged analysis
   */
  async performStagedAnalysis(functions: Map<string, FunctionMetadata>, snapshotId?: string): Promise<IdealCallEdge[]> {
    const startTime = performance.now();
    this.resetState();
    this.state.snapshotId = snapshotId; // Set snapshot ID for unique edge generation

    this.logger.debug('Starting 7-stage call graph analysis...');
    this.logger.debug(`Functions to analyze: ${functions.size}`);

    // Prepare data structures
    const prepStartTime = performance.now();
    this.buildLookupMaps(functions);
    console.log(`  ⏱️  Build lookup maps: ${((performance.now() - prepStartTime) / 1000).toFixed(3)}s`);

    // Stage 1 & 2: Combined Local and Import Analysis
    this.logger.debug('Stage 1 & 2: Combined local and import analysis...');
    const stage1StartTime = performance.now();
    const localImportResult = await this.performCombinedLocalAndImportAnalysis(functions);
    console.log(`[STAGE-DEBUG] localImportResult: localEdges=${localImportResult.localEdges}, importEdges=${localImportResult.importEdges}`);
    console.log(`  ⏱️  Stage 1&2 (Local/Import): ${((performance.now() - stage1StartTime) / 1000).toFixed(3)}s`);
    this.statistics.localExactCount = localImportResult.localEdges;
    this.statistics.importExactCount = localImportResult.importEdges;

    // Stage 3: CHA Analysis
    this.logger.debug('Stage 3: CHA analysis...');
    const stage3StartTime = performance.now();
    const chaResult = await this.chaStage.performCHAAnalysis(
      functions,
      this.state.unresolvedMethodCalls,
      this.state,
      snapshotId || 'unknown'
    );
    console.log(`  ⏱️  Stage 3 (CHA): ${((performance.now() - stage3StartTime) / 1000).toFixed(3)}s`);
    this.statistics.chaResolvedCount = chaResult.resolvedEdges;
    this.state.chaCandidates = chaResult.chaCandidates;
    this.state.unresolvedMethodCallsForRTA = chaResult.unresolvedMethodCallsForRTA;

    // Save type information to database using transaction-based approach (責務分離)
    if (this.storage && chaResult.typeInfo) {
      try {
        this.logger.debug('Saving type information to database...');
        // Use the CHA stage to save the type information with proper transaction handling
        // Note: This should use transaction-based save methods to avoid duplicate key violations
        // For now, we defer to the existing save methods in storage adapter
        await this.storage.saveAllTypeInformation(chaResult.typeInfo);
        this.logger.debug(`Successfully saved ${chaResult.typeInfo.typeDefinitions.length} type definitions`);
      } catch (error) {
        // Log error but don't fail the entire analysis
        this.logger.error(`Failed to save type information: ${error}`);
        this.logger.debug('Analysis will continue despite type information save failure');
      }
    }

    // Stage 4: RTA Analysis
    this.logger.debug('Stage 4: RTA analysis...');
    const stage4StartTime = performance.now();
    // Note: Type information is now extracted and stored during CHA stage
    const classToInterfacesMap = new Map<string, string[]>(); // Placeholder for RTA compatibility
    const rtaResult = await this.rtaStage.performRTAAnalysis(
      functions,
      this.state.chaCandidates,
      this.state.unresolvedMethodCallsForRTA,
      this.state.instantiationEvents,
      classToInterfacesMap,
      this.state
    );
    console.log(`  ⏱️  Stage 4 (RTA): ${((performance.now() - stage4StartTime) / 1000).toFixed(3)}s`);
    this.statistics.rtaResolvedCount = rtaResult;

    // Stage 5: Runtime Trace Integration
    this.logger.debug('Stage 5: Runtime trace integration...');
    const stage5StartTime = performance.now();
    const runtimeResult = await this.runtimeStage.performRuntimeTraceIntegration(
      this.state.edges,
      functions
    );
    console.log(`  ⏱️  Stage 5 (Runtime): ${((performance.now() - stage5StartTime) / 1000).toFixed(3)}s`);
    this.state.edges = runtimeResult.integratedEdges;
    this.statistics.runtimeConfirmedCount = runtimeResult.enhancedEdgesCount;

    // Stage 6: External Function Call Analysis
    this.logger.debug('Stage 6: External function call analysis...');
    const stage6StartTime = performance.now();
    const externalResult = await this.performExternalCallAnalysis(functions);
    console.log(`  ⏱️  Stage 6 (External): ${((performance.now() - stage6StartTime) / 1000).toFixed(3)}s`);
    this.statistics.externalCallsCount = externalResult.externalCallsCount;

    // Stage 7: Callback Registration Analysis
    this.logger.debug('Stage 7: Callback registration analysis...');
    const stage7StartTime = performance.now();
    const callbackResult = await this.performCallbackRegistrationAnalysis(functions);
    console.log(`  ⏱️  Stage 7 (Callbacks): ${((performance.now() - stage7StartTime) / 1000).toFixed(3)}s`);
    this.statistics.callbackRegistrationsCount = callbackResult.totalRegistrations;
    this.statistics.virtualEdgesCount = callbackResult.totalVirtualEdges;
    
    this.logger.debug(`[CallbackRegistration] Stage 7 complete: ${callbackResult.totalRegistrations} registrations, ${callbackResult.totalVirtualEdges} virtual edges`);
    if (callbackResult.totalVirtualEdges > 0) {
      this.logger.debug(`[CallbackRegistration] Virtual edges found: ${callbackResult.totalVirtualEdges} edges`);
    }

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

    // Share the function lookup map with import stage (no duplicate construction)
    this.importExactStage.setSharedFunctionLookupMap(this.state.functionLookupMap);

    for (const sourceFile of sourceFiles) {
      if (processedFiles % 50 === 0 && processedFiles > 0) {
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

      // Stage 2: Import Exact Analysis (use unresolved nodes from Local analysis)
      const importResult = await this.importExactStage.analyzeImportCalls(
        localResult.unresolvedCallNodes,
        localResult.unresolvedNewNodes,
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
   * Build lookup maps for efficient analysis
   */
  private buildLookupMaps(functions: Map<string, FunctionMetadata>): void {
    // Build file to functions map
    for (const [id, func] of functions) {
      // Normalize path: ensure leading slash for consistency with ts-morph paths
      const normalizedPath = func.filePath.startsWith('/') ? func.filePath : '/' + func.filePath;
      
      const existing = this.state.fileToFunctionsMap.get(normalizedPath) || [];
      existing.push(func);
      this.state.fileToFunctionsMap.set(normalizedPath, existing);

      // Build function lookup map (per-line for O(1) lookup compatibility)
      for (let line = func.startLine; line <= func.endLine; line++) {
        const key = `${normalizedPath}:${line}`;
        this.state.functionLookupMap.set(key, id);
      }
    }

    this.logger.debug(`Built lookup maps: ${this.state.fileToFunctionsMap.size} files, ${functions.size} functions`);
  }

  /**
   * Perform external function call analysis
   */
  private async performExternalCallAnalysis(
    functions: Map<string, FunctionMetadata>
  ): Promise<{ externalCallsCount: number }> {
    const startTime = performance.now();
    const sourceFiles = this.project.getSourceFiles();
    let totalExternalCalls = 0;

    for (const sourceFile of sourceFiles) {
      const filePath = sourceFile.getFilePath();
      const fileFunctions = this.state.fileToFunctionsMap.get(filePath) || [];
      
      if (fileFunctions.length === 0) {
        continue;
      }

      try {
        const result = await this.externalCallStage.analyzeFile(
          sourceFile,
          fileFunctions,
          functions,
          this.state
        );

        // Add external call edges to the main edges collection
        this.state.edges.push(...result.externalEdges);
        totalExternalCalls += result.externalCallsCount;

        if (result.externalCallsCount > 0) {
          this.logger.debug(`External calls in ${filePath}: ${result.externalCallsCount}`);
        }
      } catch (error) {
        this.logger.debug(`Error analyzing external calls in ${filePath}: ${error}`);
      }
    }

    const endTime = performance.now();
    this.statistics.stageTimings.external = (endTime - startTime) / 1000;

    this.logger.debug(`External analysis completed: ${totalExternalCalls} external calls found`);
    return { externalCallsCount: totalExternalCalls };
  }

  /**
   * Perform callback registration analysis
   */
  private async performCallbackRegistrationAnalysis(
    functions: Map<string, FunctionMetadata>
  ): Promise<{ totalRegistrations: number; totalVirtualEdges: number }> {
    const startTime = performance.now();
    const sourceFiles = this.project.getSourceFiles();

    try {
      const result = await this.callbackRegistrationStage.analyzeProject(
        sourceFiles,
        functions,
        this.state
      );

      // Convert virtual edges to ideal call edges and add them to the main collection
      const idealEdges = this.callbackRegistrationStage.convertVirtualEdgesToIdealEdges(result.virtualEdges);
      this.state.edges.push(...idealEdges);

      const endTime = performance.now();
      this.statistics.stageTimings.callbackRegistration = (endTime - startTime) / 1000;

      this.logger.debug(`Callback registration analysis completed: ${result.totalRegistrations} registrations, ${result.totalVirtualEdges} virtual edges`);
      
      return {
        totalRegistrations: result.totalRegistrations,
        totalVirtualEdges: result.totalVirtualEdges
      };
    } catch (error) {
      const endTime = performance.now();
      this.statistics.stageTimings.callbackRegistration = (endTime - startTime) / 1000;
      
      this.logger.warn(`Callback registration analysis failed: ${error instanceof Error ? error.message : String(error)}`);
      return { totalRegistrations: 0, totalVirtualEdges: 0 };
    }
  }

  /**
   * Log final analysis statistics
   */
  private logFinalStatistics(): void {
    const total = this.statistics.localExactCount + 
                  this.statistics.importExactCount + 
                  this.statistics.chaResolvedCount + 
                  this.statistics.rtaResolvedCount +
                  this.statistics.externalCallsCount;

    this.logger.debug('=== Staged Analysis Results ===');
    this.logger.debug(`Local Exact:     ${this.statistics.localExactCount} edges`);
    this.logger.debug(`Import Exact:    ${this.statistics.importExactCount} edges`);
    this.logger.debug(`CHA Resolved:    ${this.statistics.chaResolvedCount} edges`);
    this.logger.debug(`RTA Resolved:    ${this.statistics.rtaResolvedCount} edges`);
    this.logger.debug(`Runtime Enhanced: ${this.statistics.runtimeConfirmedCount} edges`);
    this.logger.debug(`External Calls:  ${this.statistics.externalCallsCount} edges`);
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
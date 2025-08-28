import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import * as fs from 'fs/promises';
import { globby } from 'globby';
import {
  ScanCommandOptions,
  FunctionInfo,
  CliComponents,
  FuncqcConfig,
  SpinnerInterface,
  CallEdge,
} from '../../types';
import { ConfigManager } from '../../core/config';
import { TypeScriptAnalyzer } from '../../analyzers/typescript-analyzer';
import { QualityCalculator } from '../../metrics/quality-calculator';
import { SystemResourceManager } from '../../utils/system-resource-manager';
import { RealTimeQualityGate, QualityAssessment } from '../../core/realtime-quality-gate.js';
import { Logger } from '../../utils/cli-utils';
import { FunctionIdGenerator } from '../../utils/function-id-generator';
import { ErrorCode, createErrorHandler, type DatabaseErrorLike } from '../../utils/error-handler';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { IdealCallGraphAnalyzer } from '../../analyzers/ideal-call-graph-analyzer';
import { OnePassASTVisitor } from '../../analyzers/shared/one-pass-visitor';
import { Project, TypeChecker, ts, Node } from 'ts-morph';
import { getOrLoadFunctions, ensureSharedProject } from '../../core/env-facade';
// import { SnapshotMetadata } from '../../types'; // REMOVED - not needed for read-only scan command
import { generateFunctionCompositeKey } from '../../utils/function-mapping-utils';

/**
 * Result type for batch processing operations
 */
interface BatchProcessingResult {
  functionCount: number;
  errors: string[];
  functions: FunctionInfo[];
}



/**
 * REMOVED: Command Protocol violation - metadata updates should be handled by dependency manager
 * This function violated Command Protocol by updating snapshots in scan command
 */
// async function updateSnapshotMetadata - REMOVED

/**
 * Parameter property usage data for coupling analysis
 */
interface ParameterPropertyUsage {
  functionId: string;
  parameterName: string;
  parameterTypeId: string | null;
  accessedProperty: string;
  accessType: 'read' | 'write' | 'modify' | 'pass';
  accessLine: number;
  accessContext: string;
}

// Removed ProcessedFileResult - no longer used

/**
 * Scan command as a Reader function
 * Uses shared storage and config from environment
 */
export const scanCommand: VoidCommand<ScanCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {

    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora();

    try {
      if (options.verbose) {
        env.commandLogger.info('🔍 Starting function analysis...');
      }
      
      await executeScanCommand(env, options, spinner);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        const dbErr = error as DatabaseErrorLike;
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          dbErr.message,
          { dbCode: dbErr.code },
          dbErr.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Scan failed: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

async function executeScanCommand(
  env: CommandEnvironment, 
  options: ScanCommandOptions,
  spinner: SpinnerInterface
): Promise<void> {
  const startTime = performance.now();
  
  try {
    // Handle realtime gate mode
    if (options.realtimeGate) {
      await runRealtimeGateMode(env.config, options, spinner);
      return;
    }


    // COMMAND PROTOCOL COMPLIANCE: All actual processing (snapshot creation, analysis) 
    // is already completed by CLI wrapper + dependency manager
    // Scan command should only display results
    
    // Get latest snapshot created by dependency manager
    const latestSnapshot = await env.storage.getLatestSnapshot();
    if (!latestSnapshot) {
      if (options.json) {
        console.log(JSON.stringify({
          success: false,
          message: 'No snapshot found. Analysis not completed by dependency manager.',
          filesAnalyzed: 0,
          functionsAnalyzed: 0,
          snapshotId: null,
          timestamp: new Date().toISOString()
        }, null, 2));
      } else {
        console.log(chalk.red('❌ No snapshot found. This suggests dependency manager failed.'));
      }
      return;
    }
    
    const snapshotId = latestSnapshot.id;
    const metadata = (latestSnapshot.metadata as Record<string, unknown>) || {};
    
    // Get information from snapshot metadata (no DB queries needed)
    const functionsAnalyzed = metadata['functionCount'] as number || 0;
    const filesAnalyzed = metadata['sourceFileCount'] as number || 0;
    const analysisLevel = metadata['analysisLevel'] as string || 'NONE';
    const callEdgesCount = metadata['callEdgeCount'] as number || 0;
    const internalCallEdgesCount = metadata['internalCallEdgeCount'] as number || 0;
    
    // Record scan duration for display only
    const endTime = performance.now();
    const scanDuration = Math.round(endTime - startTime);
    
    // Output results
    if (options.json) {
      outputScanResultsJSON({
        success: true,
        snapshotId,
        filesAnalyzed,
        functionsAnalyzed,
        callEdges: callEdgesCount,
        internalCallEdges: internalCallEdgesCount,
        scope: options.scope || 'src',
        ...(options.label && { label: options.label }),
        ...(options.comment && { comment: options.comment }),
        timestamp: new Date().toISOString(),
        analysisLevel,
        scanDuration
      });
    } else {
      showCompletionMessage();
    }
  } catch (error) {
    handleScanError(error, options, spinner);
  }
}

/**
 * REMOVED: Command Protocol violation - snapshot creation should be handled by dependency manager
 * This function violated Command Protocol by creating snapshots in scan command
 */
// async function saveSourceFilesWithDeduplication - REMOVED

/**
 * Get source file ID mapping: filePath -> source_file_refs.id
 */
async function getSourceFileIdMapping(
  storage: CliComponents['storage'],
  snapshotId: string
): Promise<Map<string, string>> {
  const resultMap = new Map<string, string>();
  
  // Get all source files for this snapshot using the new optimized method
  const snapshotContents = await storage.getSnapshotContentsForAnalysis(snapshotId);
  
  // Create mapping from filePath to source_file_refs.id (refId)
  for (const content of snapshotContents) {
    resultMap.set(content.filePath, content.refId);
  }
  
  return resultMap;
}

/**
 * Save source files and create initial snapshot (fast operation)
 */
/**
 * REMOVED: Command Protocol violation - snapshot creation should be handled by dependency manager  
 * This function violated Command Protocol by creating snapshots and saving files in scan command
 */
// async function saveSourceFiles - REMOVED

/**
 * Perform basic analysis on stored files (can be called later)
 */
/**
 * Prepare batches for parallel processing
 */
function prepareBatchProcessing(
  sourceFiles: import('../../types').SourceFile[],
  maxConcurrency: number
): typeof sourceFiles[] {
  const batchSize = Math.ceil(sourceFiles.length / maxConcurrency);
  const batches: typeof sourceFiles[] = [];
  
  for (let i = 0; i < sourceFiles.length; i += batchSize) {
    batches.push(sourceFiles.slice(i, i + batchSize));
  }
  
  return batches;
}

/**
 * Store parameter property usage data in database
 */
async function storeParameterPropertyUsage(
  storage: CliComponents['storage'],
  couplingData: ParameterPropertyUsage[],
  snapshotId: string
): Promise<void> {
  if (couplingData.length === 0) return;

  try {
    // FIXED: Now using correct function IDs from FunctionInfo
    await storage.storeParameterPropertyUsage(couplingData, snapshotId);
  } catch (error) {
    console.warn(`Warning: Failed to store coupling analysis data: ${error}`);
  }
}

// Removed processSingleSourceFile - replaced by executePureBasicBatchAnalysis and performCouplingAnalysisForFile

/**
 * Execute batch analysis and storage
 */
// Removed executeBatchAnalysis - replaced by executePureBasicBatchAnalysis
// Removed performCouplingAnalysisLegacy - replaced by performCouplingAnalysisForFile

/**
 * Perform cleanup operations
 */
async function performAnalysisCleanup(
  components: Awaited<ReturnType<typeof initializeComponents>>,
  env: CommandEnvironment
): Promise<void> {
  // Clean up memory monitoring to prevent hanging process
  if (components.memoryMonitor) {
    clearInterval(components.memoryMonitor);
    env.logger.debug('Memory monitoring stopped after analysis completion');
  }
  if (components.monitoringTimeout) {
    clearTimeout(components.monitoringTimeout);
  }
  
  // Clean up analyzer resources
  if (components.analyzer && typeof components.analyzer.cleanup === 'function') {
    await components.analyzer.cleanup();
  }
}

/**
 * Perform deferred PURE BASIC analysis on an existing snapshot
 * Used by cli-wrapper for automatic analysis when needed (LIGHTWEIGHT commands)
 */
export async function performDeferredBasicAnalysis(
  snapshotId: string,
  env: CommandEnvironment,
  showProgress: boolean = true
): Promise<void> {
  // Get snapshot contents optimized for virtual project analysis
  const snapshotContents = await env.storage.getSnapshotContentsForAnalysis(snapshotId);
  
  if (snapshotContents.length === 0) {
    throw new Error(`No source files found for snapshot ${snapshotId}`);
  }

  // Convert to SourceFile format for compatibility with existing analysis
  const sourceFiles = snapshotContents.map(content => ({
    id: content.refId,
    snapshotId: snapshotId,
    filePath: content.filePath,
    fileContent: content.content,
    fileHash: '', // Not needed for analysis
    encoding: 'utf-8',
    fileSizeBytes: content.content.length,
    lineCount: content.content.split('\n').length,
    language: 'typescript',
    functionCount: 0,
    exportCount: 0,
    importCount: 0,
    fileModifiedTime: new Date(),
    createdAt: new Date()
  }));


  const ora = (await import('ora')).default;
  const spinner = ora();
  
  if (showProgress) {
    spinner.start('Performing basic function analysis...');
  }
  
  try {
    // Get source file ID mapping
    const sourceFileIdMap = await getSourceFileIdMapping(env.storage, snapshotId);
    
    // Perform the PURE basic analysis (no coupling)
    await performPureBasicAnalysis(snapshotId, sourceFiles, env, spinner, sourceFileIdMap);
  } catch (error) {
    if (showProgress) {
      spinner.fail(`Basic analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw error;
  }
}

/**
 * Perform PURE BASIC analysis without coupling analysis
 * For LIGHTWEIGHT commands that only need function metadata
 */
export async function performPureBasicAnalysis(
  snapshotId: string,
  sourceFiles: import('../../types').SourceFile[],
  env: CommandEnvironment,
  spinner: SpinnerInterface,
  sourceFileIdMap?: Map<string, string>
): Promise<{ functionsAnalyzed: number }> {
  spinner.start('Performing basic function analysis (no coupling)...');
  
  const components = await initializeComponents(env, spinner, sourceFiles.length);
  let totalFunctions = 0;
  
  const maxConcurrency = components.optimalConfig.maxWorkers;
  spinner.text = `Analyzing ${sourceFiles.length} files with ${maxConcurrency} concurrent workers... (BASIC only)`;
  
  try {
    const batches = prepareBatchProcessing(sourceFiles, maxConcurrency);
    
    // Use a simpler batch processing for BASIC only
    const batchResults = await executePureBasicBatchAnalysis(batches, components, snapshotId, env, { verbose: false }, sourceFileIdMap);
    
    const allErrors: string[] = [];
    for (const batchResult of batchResults) {
      totalFunctions += batchResult.functionCount;
      allErrors.push(...batchResult.errors);
    }
    
    // Success/error reporting handled by caller via spinner
    
    // Only update analysis level if functions were successfully analyzed
    if (totalFunctions > 0) {
      await env.storage.updateAnalysisLevel(snapshotId, 'BASIC');
      spinner.succeed(`Basic analysis completed (${totalFunctions} functions)`);
    } else {
      spinner.fail(`No functions were analyzed - analysis level not updated`);
      throw new Error('No functions were successfully analyzed');
    }
    
    return { functionsAnalyzed: totalFunctions };
  } catch (error) {
    spinner.fail(`Basic analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    // Don't update analysis level on error to prevent incomplete state
    throw error;
  } finally {
    await performAnalysisCleanup(components, env);
  }
}

/**
 * Execute PURE BASIC batch analysis (no coupling) 
 * Modified to use single transaction for all batches to prevent duplicate key violations
 */
async function executePureBasicBatchAnalysis(
  batches: import('../../types').SourceFile[][],
  components: Awaited<ReturnType<typeof initializeComponents>>,
  snapshotId: string,
  env: CommandEnvironment,
  options?: { verbose?: boolean },
  sourceFileIdMap?: Map<string, string>
): Promise<{ functionCount: number; errors: string[] }[]> {
  // Prepare shared virtual project for true integration
  if (options?.verbose) {
    env.commandLogger.info('🔧 Preparing shared virtual project for BASIC analysis...');
  }

  // Get existing shared project (should already be created by cli-wrapper)
  if (!env.projectManager) {
    env.commandLogger.debug?.('No projectManager available in env — proceeding without shared project');
  }

  const batchPromises: Promise<BatchProcessingResult>[] = batches.map(async (batch, batchIndex) => {
    const batchFunctions: FunctionInfo[] = [];
    const batchErrors: string[] = [];
    const batchFunctionCounts = new Map<string, number>();
    
    console.log(chalk.blue(`📦 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} files)`));
    
    for (const sourceFile of batch) {
      try {
        // Use analyzer with content instead of file path
        const functions = await components.analyzer.analyzeContent(
          sourceFile.fileContent,
          sourceFile.filePath,
          snapshotId,
          env
        );
        
        // Set source file ID and verify metrics calculation
        for (const func of functions) {
          if (!func.metrics) {
            func.metrics = components.qualityCalculator.calculate(func);
          }
          
          // Use sourceFileIdMap from N:1 design (must exist)
          const mappedId = sourceFileIdMap?.get(func.filePath);
          if (!mappedId) {
            throw new Error(`No source_file_ref_id found for ${func.filePath}`);
          }
          func.sourceFileRefId = mappedId;
        }
        
        sourceFile.functionCount = functions.length;
        batchFunctions.push(...functions);
        
        // Track function counts for this batch
        const count = batchFunctionCounts.get(sourceFile.filePath) || 0;
        batchFunctionCounts.set(sourceFile.filePath, count + functions.length);
      } catch (error) {
        const errorMessage = `Error analyzing file ${sourceFile.filePath}: ${error instanceof Error ? error.message : String(error)}`;
        batchErrors.push(errorMessage);
        console.warn(chalk.yellow(`Warning: ${errorMessage}`));
      }
    }
    
    // Store functions only (no coupling data)
    if (batchFunctions.length > 0) {
      await env.storage.storeFunctions(batchFunctions, snapshotId);
    }
    
    
    if (batchErrors.length > 0) {
      console.log(chalk.yellow(`⚠️  Batch ${batchIndex + 1} completed with ${batchErrors.length} errors`));
    } else {
      console.log(chalk.green(`✅ Batch ${batchIndex + 1} completed successfully (${batchFunctions.length} functions)`));
    }
    
    return { 
      functionCount: batchFunctions.length, 
      errors: batchErrors,
      functions: [] // Empty array since functions are already stored
    };
  });
  
  // Execute all batch processing in parallel (each batch stores its own functions)
  const batchResults = await Promise.all(batchPromises);
  
  return batchResults;
}

export async function performBasicAnalysis(
  snapshotId: string,
  sourceFiles: import('../../types').SourceFile[],
  env: CommandEnvironment,
  spinner: SpinnerInterface,
  sourceFileIdMap?: Map<string, string>
): Promise<{ functionsAnalyzed: number }> {
  // DRY: Delegate to performPureBasicAnalysis (no behavior change)
  return performPureBasicAnalysis(snapshotId, sourceFiles, env, spinner, sourceFileIdMap);
}

/**
 * Perform COUPLING analysis on existing functions in a snapshot
 * This should be called after basic analysis is complete
 */
export async function performDeferredCouplingAnalysis(
  snapshotId: string,
  env: CommandEnvironment,
  spinner?: SpinnerInterface
): Promise<{ couplingDataStored: number }> {
  const showSpinner = spinner !== undefined;
  if (showSpinner) {
    spinner.start('Performing coupling analysis...');
  }
  
  // Get source files and functions for the snapshot (functions are cached in env when possible)
  const sourceFiles = await env.storage.getSourceFilesBySnapshot(snapshotId);
  const { functions } = await getOrLoadFunctions(env, snapshotId);
  
  if (sourceFiles.length === 0 || functions.length === 0) {
    throw new Error(`No source files or functions found for snapshot ${snapshotId}`);
  }
  
  const components = await initializeComponents(env, spinner || { start: () => {}, text: '', succeed: () => {}, stop: () => {} } as SpinnerInterface, sourceFiles.length);
  let totalCouplingData = 0;
  
  try {
    const maxConcurrency = components.optimalConfig.maxWorkers;
    const batches = prepareBatchProcessing(sourceFiles, maxConcurrency);
    
    if (showSpinner) {
      spinner.text = `Performing coupling analysis on ${sourceFiles.length} files...`;
    }
    
    // Reuse existing shared project (should already be created by cli-wrapper)
    let project: Project;
    if (env.projectManager) {
      // Use existing cached project - no need to create or update
      project = env.projectManager.getProject(snapshotId);
      console.log(`📁 Reusing shared project with ${project.getSourceFiles().length} files for call graph analysis`);
    } else {
      // Fallback for environments/tests that don't provide projectManager yet
      project = new Project({
        useInMemoryFileSystem: true,
        compilerOptions: {
          target: ts.ScriptTarget.Latest,
          allowJs: true,
          skipLibCheck: true,
        }
      });
      console.log(chalk.blue(`📚 Loading ${sourceFiles.length} files into TypeScript project for type resolution...`));
      for (const sourceFile of sourceFiles) {
        project.createSourceFile(sourceFile.filePath, sourceFile.fileContent);
      }
      console.log(`📁 Loaded ${project.getSourceFiles().length} files into project`);
    }
    
    const typeChecker = project.getTypeChecker();
    
    // Process batches sequentially to avoid memory pressure from multiple Project instances
    const batchResults: number[] = [];
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const batchCouplingData: ParameterPropertyUsage[] = [];
      
      console.log(chalk.blue(`📊 Coupling batch ${batchIndex + 1}/${batches.length} (${batch.length} files)`));
      
      for (const sourceFile of batch) {
        try {
          // Get functions for this source file
          const fileFunctions = functions.filter(f => f.filePath === sourceFile.filePath);
          
          // Perform coupling analysis using shared project and typeChecker
          const couplingData = await performCouplingAnalysisForFile(sourceFile, fileFunctions, project, typeChecker, snapshotId);
          batchCouplingData.push(...couplingData);
        } catch (error) {
          console.warn(chalk.yellow(`Warning: Coupling analysis failed for ${sourceFile.filePath}: ${error}`));
        }
      }
      
      // Store coupling analysis data
      if (batchCouplingData.length > 0) {
        await storeParameterPropertyUsage(env.storage, batchCouplingData, snapshotId);
        console.log(`📊 Stored ${batchCouplingData.length} coupling analysis records`);
      }
      
      batchResults.push(batchCouplingData.length);
    }
    totalCouplingData = batchResults.reduce((sum, count) => sum + count, 0);
    
    // Update analysis level to indicate coupling analysis is complete
    await env.storage.updateAnalysisLevel(snapshotId, 'COUPLING');
    
    if (showSpinner) {
      spinner.succeed(`Coupling analysis completed: ${totalCouplingData} coupling data points`);
    }
    
    return { couplingDataStored: totalCouplingData };
  } finally {
    await performAnalysisCleanup(components, env);
  }
}

/**
 * Perform coupling analysis for a single file (renamed from existing function)
 */
async function performCouplingAnalysisForFile(
  sourceFile: import('../../types').SourceFile,
  fileFunctions: FunctionInfo[],
  project: Project,
  typeChecker: TypeChecker,
  snapshotId: string
): Promise<ParameterPropertyUsage[]> {
  try {
    // Get the source file from the shared project (already loaded during initialization)
    const tsSourceFile = project.getSourceFile(sourceFile.filePath);
    if (!tsSourceFile) {
      console.warn(`⚠️  Warning: Source file not found in project: ${sourceFile.filePath}`);
      console.warn(`📋 Available files in project: ${project.getSourceFiles().map(f => f.getFilePath()).slice(0, 3).join(', ')}...`);
      return [];
    }

    // Execute 1-pass AST visitor with the actual snapshot ID
    const visitor = new OnePassASTVisitor();
    const context = visitor.scanFile(tsSourceFile, typeChecker, snapshotId);

    // Debug output for coupling analysis troubleshooting
    if (process.env['FUNCQC_DEBUG_COUPLING'] === '1') {
      console.log(`📁 Project contains ${project.getSourceFiles().length} files for ${sourceFile.filePath}`);
      console.log(`[DEBUG] Scanning ${sourceFile.filePath}`);
      console.log(`[DEBUG] overCoupling.size=${context.couplingData.overCoupling.size}`);
      console.log(`[DEBUG] parameterUsage.size=${context.couplingData.parameterUsage.size}`);
      console.log(`[DEBUG] propertyAccesses.size=${context.usageData.propertyAccesses.size}`);
    }

    // Create FunctionInfo lookup map using composite keys for better matching
    const functionLookupMap = new Map<string, string>();
    
    // Build lookup map with multiple key strategies for robust matching
    for (const func of fileFunctions) {
      // Strategy 1: Composite key (most reliable)
      const compositeKey = generateFunctionCompositeKey(func.filePath, func.startLine, func.name);
      functionLookupMap.set(compositeKey, func.id);
      
      // Strategy 2: Direct ID mapping (if IDs match)
      functionLookupMap.set(func.id, func.id);
      
      // Strategy 3: Alternative composite without full path (for path mismatches)
      const fileName = path.basename(func.filePath);
      const altCompositeKey = generateFunctionCompositeKey(fileName, func.startLine, func.name);
      functionLookupMap.set(altCompositeKey, func.id);
      
      // Strategy 4: CRITICAL FIX - Use the same ID generation as OnePassASTVisitor
      // This generates the exact same hash ID that coupling analysis uses
      const couplingHashId = FunctionIdGenerator.generateDeterministicUUID(
        func.filePath,
        func.name,
        func.className || null, // Use className when available for better matching
        func.startLine,
        func.startColumn || 0,
        snapshotId
      );
      functionLookupMap.set(couplingHashId, func.id);
      
      // Note: semanticId mapping was removed as it was not being used in lookup chains
      // Future enhancement: Implement semanticId-based lookup if fallback routing is needed
    }

    // Convert coupling data to parameter property usage format
    const couplingData: ParameterPropertyUsage[] = [];

    // Create a function ID lookup map for debugging and fallback
    const dbFunctionIds = new Set(fileFunctions.map(f => f.id));
    
    // Collect skipped function analysis for better diagnostics (function-level tracking)
    const skippedFunctionIds = new Set<string>();
    const skippedFunctions: Array<{
      funcHashId: string;
      functionName?: string;
      functionType?: string;
      contextPath?: string[];
      isAnonymous?: boolean;
      reason: string;
    }> = [];
    
    let totalProcessed = 0;
    let totalSuccessful = 0;
    
    // Extract property access data from coupling analysis
    for (const [funcHashId, analyses] of context.couplingData.overCoupling) {
      totalProcessed++;
      
      // Only show processing logs in DEBUG mode
      if (process.env['FUNCQC_DEBUG_COUPLING'] === '1') {
        console.log(`🔍 Processing function hash ID: ${funcHashId}`);
      }
      
      // Try to resolve function ID: first direct match, then fallback lookup
      let resolvedFunctionId: string | undefined = dbFunctionIds.has(funcHashId) ? funcHashId : undefined;

      // If not found in DB, try fallback lookup using functionLookupMap
      if (!resolvedFunctionId) {
        // 1) まず couplingHashId での直接参照を試す（最も安価でヒット率が高い）
        const mappedByHash = functionLookupMap.get(funcHashId);
        if (mappedByHash && dbFunctionIds.has(mappedByHash)) {
          resolvedFunctionId = mappedByHash;
          if (process.env['FUNCQC_DEBUG_COUPLING'] === '1') {
            console.log(`  🔁 Fallback resolved via couplingHashId: ${funcHashId} -> ${resolvedFunctionId}`);
          }
        }

        // 2) 未解決なら AST 特性に基づく複合キーでの探索
        if (!resolvedFunctionId) {
          const funcNode = context.funcIdToNodeCache?.get(funcHashId);
          if (funcNode) {
            const info = extractFunctionCharacteristics(funcNode);
            const startLine = funcNode.getStartLineNumber();
            const nameForKey = info.name || '<anonymous>';
            
            // Try multiple composite key strategies
            const directKey = generateFunctionCompositeKey(sourceFile.filePath, startLine, nameForKey);
            const altKey = generateFunctionCompositeKey(path.basename(sourceFile.filePath), startLine, nameForKey);
            
            const mappedId = functionLookupMap.get(directKey) || functionLookupMap.get(altKey);
            if (mappedId && dbFunctionIds.has(mappedId)) {
              resolvedFunctionId = mappedId;
              if (process.env['FUNCQC_DEBUG_COUPLING'] === '1') {
                console.log(`  🔁 Fallback resolved: ${funcHashId} -> ${resolvedFunctionId}`);
              }
            }
          }
        }
      }

      // If still not resolved, skip with detailed logging
      if (!resolvedFunctionId) {
        // Track skipped function only once per function (not per parameter)
        if (!skippedFunctionIds.has(funcHashId)) {
          skippedFunctionIds.add(funcHashId);
          
          // Try to find the actual function node in AST to get more info
          const funcNode = context.funcIdToNodeCache?.get(funcHashId);
          let functionInfo: { name?: string; type?: string; contextPath?: string[]; isAnonymous?: boolean } = {};
          
          if (funcNode) {
            functionInfo = extractFunctionCharacteristics(funcNode);
          }
          
          const skippedFunction: {
            funcHashId: string;
            functionName?: string;
            functionType?: string;
            contextPath?: string[];
            isAnonymous?: boolean;
            reason: string;
          } = {
            funcHashId,
            reason: 'ID_NOT_FOUND_AFTER_FALLBACK'
          };
          
          if (functionInfo.name) {
            skippedFunction.functionName = functionInfo.name;
          }
          if (functionInfo.type) {
            skippedFunction.functionType = functionInfo.type;
          }
          if (functionInfo.contextPath) {
            skippedFunction.contextPath = functionInfo.contextPath;
          }
          if (functionInfo.isAnonymous !== undefined) {
            skippedFunction.isAnonymous = functionInfo.isAnonymous;
          }
          
          skippedFunctions.push(skippedFunction);
          
          // Only show detailed debug in DEBUG mode and only once per function
          if (process.env['FUNCQC_DEBUG_COUPLING'] === '1') {
            console.log(`  ⚠️  Skipping ${funcHashId}: not found even after fallback`);
            console.log(`    Function info: ${JSON.stringify(functionInfo)}`);
            console.log(`    Available function IDs in file (first 3):`, 
              Array.from(dbFunctionIds).slice(0, 3));
            console.log(`    Total DB functions in file: ${dbFunctionIds.size}`);
          }
        }
        
        // Skip all analyses for this function
        continue; 
      }
      
      // Function was successfully processed
      totalSuccessful++;
      
      for (const analysis of analyses) {
        
        const correctFunctionId = resolvedFunctionId!;
        
        if (process.env['FUNCQC_DEBUG_COUPLING'] === '1') {
          console.log(`  ✅ Using function ID: ${correctFunctionId}`);
        }
        
        // Rename for clarity and index accesses by property for O(1) lookups
        const paramAccesses = context.usageData.propertyAccesses
          .get(funcHashId)
          ?.get(analysis.parameterName) ?? [];

        const accessesByProp = new Map<string, typeof paramAccesses>();
        for (const a of paramAccesses) {
          const list = accessesByProp.get(a.property);
          if (list) {
            list.push(a);
          } else {
            accessesByProp.set(a.property, [a]);
          }
        }

        for (const prop of analysis.usedProperties) {
          // Find all accesses for this property
          const accesses = accessesByProp.get(prop) ?? [];
          
          if (accesses.length === 0) {
            // Fallback to fixed values if no detailed access data found
            couplingData.push({
              functionId: correctFunctionId,
              parameterName: analysis.parameterName,
              parameterTypeId: null, // Will be resolved later if needed
              accessedProperty: prop,
              accessType: 'read', // Fallback default
              accessLine: 0, // Fallback default
              accessContext: 'property_access' // Fallback default
            });
          } else {
            // Use actual access data for each access occurrence
            for (const access of accesses) {
              couplingData.push({
                functionId: correctFunctionId,
                parameterName: analysis.parameterName,
                parameterTypeId: null, // Will be resolved later if needed
                accessedProperty: prop,
                accessType: access.accessType, // Actual access type from AST analysis
                accessLine: access.line, // Actual line number from AST analysis
                accessContext: access.context // Actual context from AST analysis
              });
            }
          }
        }
      }
    }

    // Generate summary report instead of verbose individual logs
    const totalSkipped = skippedFunctions.length;
    
    if (totalSkipped > 0 && process.env['FUNCQC_DEBUG_COUPLING'] === '1') {
      console.log(`\n📊 Coupling Analysis Summary for ${sourceFile.filePath}:`);
      console.log(`  ✅ Processed: ${totalSuccessful}/${totalProcessed} functions`);
      console.log(`  ⚠️  Skipped: ${totalSkipped} functions`);
      
      // Analyze patterns in skipped functions
      const skippedPatterns = analyzeSkippedFunctionPatterns(skippedFunctions);
      
      if (skippedPatterns.anonymous > 0) {
        console.log(`    • Anonymous functions: ${skippedPatterns.anonymous}`);
      }
      if (skippedPatterns.constructors > 0) {
        console.log(`    • Constructors: ${skippedPatterns.constructors}`);
      }
      if (skippedPatterns.methods > 0) {
        console.log(`    • Methods: ${skippedPatterns.methods}`);
      }
      if (skippedPatterns.arrows > 0) {
        console.log(`    • Arrow functions: ${skippedPatterns.arrows}`);
      }
      if (skippedPatterns.getters > 0) {
        console.log(`    • Getters/Setters: ${skippedPatterns.getters}`);
      }
      
      // Show most common function names that were skipped (already deduplicated by function)
      const nameFreq = skippedFunctions
        .filter(f => f.functionName && !f.isAnonymous)
        .reduce((acc, f) => {
          acc[f.functionName!] = (acc[f.functionName!] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
      
      const topSkippedNames = Object.entries(nameFreq)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3);
      
      if (topSkippedNames.length > 0) {
        console.log(`    • Top skipped names: ${topSkippedNames.map(([name, count]) => `${name}(${count})`).join(', ')}`);
      }
      
      // Show sample of skipped functions for investigation
      if (skippedFunctions.length > 0) {
        console.log(`\n🔍 Sample skipped functions (first 3):`);
        skippedFunctions.slice(0, 3).forEach((func, i) => {
          console.log(`  ${i + 1}. ${func.functionName || '<anonymous>'} (${func.functionType || 'unknown'})`);
          console.log(`     ID: ${func.funcHashId}`);
          console.log(`     Context: ${func.contextPath?.join('.') || 'none'}`);
        });
      }
    } else {
      // console.log(`✅ All ${totalProcessed} functions processed successfully in ${sourceFile.filePath}`);
    }

    return couplingData;
  } catch (error) {
    console.warn(`Warning: Coupling analysis failed for ${sourceFile.filePath}: ${error}`);
    return [];
  }
}

/**
 * Perform call graph analysis on stored files (called by dep/dead/clean commands)
 */
export async function performCallGraphAnalysis(
  snapshotId: string,
  env: CommandEnvironment,
  spinner?: SpinnerInterface
): Promise<{ callEdges: CallEdge[]; internalCallEdges: import('../../types').InternalCallEdge[] }> {
  // Call graph analysis starting
  const showSpinner = spinner !== undefined;
  if (showSpinner) {
    spinner.start('Performing call graph analysis...');
  }
  
  // Get stored files and functions (functions cached in env when available)
  const sourceFiles = await env.storage.getSourceFilesBySnapshot(snapshotId);
  const { functions } = await getOrLoadFunctions(env, snapshotId);
  // Data fetched from database
  
  // Reconstruct file map for analyzer (include all files for proper type resolution)
  const fileContentMap = new Map<string, string>();
  sourceFiles.forEach(file => {
    fileContentMap.set(file.filePath, file.fileContent);
  });
  
  let idealCallGraphAnalyzer: IdealCallGraphAnalyzer | null = null;
  
  try {
    // Ensure shared project is initialized with all files
    await ensureSharedProject(env, snapshotId, fileContentMap);
    
    // Get shared project directly (no middle layer)
    const project = env.projectManager?.getProject(snapshotId);
    if (!project) {
      throw new Error(`No shared project found for snapshot ${snapshotId}. Project should be created by dependency manager.`);
    }
    
    // Use IdealCallGraphAnalyzer directly (remove FunctionAnalyzer middle layer)
    idealCallGraphAnalyzer = new IdealCallGraphAnalyzer(project, { 
      logger: env.commandLogger,
      snapshotId,
      storage: env.storage
    });
    
    // Perform call graph analysis directly
    const startTime = performance.now();
    const callGraphResult = await idealCallGraphAnalyzer.analyzeProject(functions);
    const endTime = performance.now();
    console.log(`⏱️  Direct call graph analysis: ${((endTime - startTime) / 1000).toFixed(2)}s`);
    
    // Convert to expected format (IdealCallEdge extends CallEdge, so direct cast)
    let result = {
      callEdges: callGraphResult.edges as CallEdge[],
      internalCallEdges: [] as import('../../types').InternalCallEdge[] // Will be handled separately if needed
    };

    // Diagnostics: optional debug on empty first pass
    if (result.callEdges.length === 0 && process.env['FUNCQC_DEBUG_PATHS'] === 'true') {
      env.commandLogger.debug?.(`DEBUG(call-graph): first pass yielded 0 edges; functions=${functions.length}, files=${sourceFiles.length}`);
    }

    // Optional fallback (disabled by default) to avoid masking design issues
    const enableFallback = /^(1|true|yes)$/i.test(process.env['FUNCQC_ENABLE_DB_FUNCTIONS_FALLBACK'] || '');
    if (enableFallback && result.callEdges.length === 0 && functions.length > 100 && sourceFiles.length > 50) {
      env.commandLogger.warn('⚠️  No call edges found on first pass. Retrying with functions loaded from DB (fallback enabled)...');
      const freshFunctions = await env.storage.findFunctionsInSnapshot(snapshotId);
      
      // Re-run with fresh functions using direct IdealCallGraphAnalyzer
      const fallbackStartTime = performance.now();
      const fallbackResult = await idealCallGraphAnalyzer.analyzeProject(freshFunctions);
      const fallbackEndTime = performance.now();
      console.log(`⏱️  Fallback call graph analysis: ${((fallbackEndTime - fallbackStartTime) / 1000).toFixed(2)}s`);
      
      result = {
        callEdges: fallbackResult.edges as CallEdge[],
        internalCallEdges: [] as import('../../types').InternalCallEdge[]
      };
      if (result.callEdges.length > 0) {
        const snapshot = await env.storage.getSnapshot(snapshotId);
        if (snapshot) {
          env.callGraphData = {
            snapshot,
            functions: freshFunctions,
            callEdges: env.callGraphData?.callEdges || [],
            internalCallEdges: env.callGraphData?.internalCallEdges || [],
            allEdges: env.callGraphData?.allEdges || [],
            ...(env.callGraphData?.lazyAnalysisPerformed !== undefined
              ? { lazyAnalysisPerformed: env.callGraphData.lazyAnalysisPerformed }
              : {}),
          } as import('../../types/environment').CallGraphData;
        }
      }
    }
    // Call graph analysis completed
    
    // Save call edges
    await env.storage.insertCallEdges(result.callEdges, snapshotId);
    // Call edges saved to database
    
    // Update snapshotId for internal call edges and save
    const internalCallEdgesWithSnapshotId = result.internalCallEdges.map(edge => ({
      ...edge,
      snapshotId: snapshotId
    }));
    await env.storage.insertInternalCallEdges(internalCallEdgesWithSnapshotId);
    // Internal call edges saved to database
    
    await env.storage.updateAnalysisLevel(snapshotId, 'CALL_GRAPH');
    
    // Call graph analysis completed
    
    if (showSpinner) {
      spinner!.succeed(`Call graph analysis completed: ${result.callEdges.length} edges found`);
    }
    
    return result;
    
  } finally {
    // Cleanup if needed
    idealCallGraphAnalyzer?.dispose?.();
  }
}

/**
 * Perform deferred type system analysis for a snapshot
 * Analyzes TypeScript types and stores them in the database
 */
export async function performDeferredTypeSystemAnalysis(
  snapshotId: string,
  env: CommandEnvironment,
  showProgress: boolean = true
): Promise<{ typesAnalyzed: number }> {
  const ora = showProgress ? (await import('ora')).default : null;
  const spinner = ora ? ora() : null;
  
  if (spinner && showProgress) {
    spinner.start('Performing type system analysis...');
  }
  
  try {
    // Check if type system analysis has already been performed for this snapshot
    // Checking for existing type analysis
    const existingTypes = await env.storage.query(
      'SELECT COUNT(*) as count FROM type_definitions WHERE snapshot_id = $1', 
      [snapshotId]
    );
    const typeCount = (existingTypes.rows[0] as { count?: number })?.count || 0;
    
    if (typeCount > 0) {
      // Type system analysis already completed
      if (spinner) {
        spinner.succeed(`Type system analysis already completed (${typeCount} types found)`);
      }
      return { typesAnalyzed: typeCount };
    }
    
    console.log(`🚀 No existing types found - proceeding with type system analysis`);
    
    // Get source files for the snapshot
    const sourceFiles = await env.storage.getSourceFilesBySnapshot(snapshotId);
    
    if (sourceFiles.length === 0) {
      throw new Error(`No source files found for snapshot ${snapshotId}`);
    }
    
    // Create TypeScript analyzer (for utilities) and TypeSystemAnalyzer bound to shared Project
    const analyzer = new TypeScriptAnalyzer(
      100, // maxSourceFilesInMemory
      true, // enableCache
      env.commandLogger // logger
    );
    analyzer.setStorage(env.storage);

    // Reuse existing shared project for type analysis (should already be created by cli-wrapper)
    let typeProject: Project;
    if (env.projectManager) {
      // Use existing cached project - no need to create or update
      typeProject = env.projectManager.getProject(snapshotId);
      console.log(`📁 Reusing shared project for type analysis with ${typeProject.getSourceFiles().length} files`);
    } else {
      // Fallback for test environments without projectManager
      typeProject = new Project({ useInMemoryFileSystem: true });
      sourceFiles.forEach(sourceFile => {
        typeProject.createSourceFile(sourceFile.filePath, sourceFile.fileContent, { overwrite: true });
      });
    }

    // Initialize TypeSystemAnalyzer directly with shared project
    const typeSystemAnalyzer = new (await import('../../analyzers/type-system-analyzer')).TypeSystemAnalyzer(
      typeProject,
      env.commandLogger
    );
    typeSystemAnalyzer.setStorage(env.storage);

    // Analyze types from all source files in batch for better performance
    const typeDefinitions: import('../../types').TypeDefinition[] = [];
    const typeRelationships: import('../../types').TypeRelationship[] = [];
    const typeMembers: import('../../types').TypeMember[] = [];
    const methodOverrides: import('../../types').MethodOverride[] = [];
    
    try {
      // Batch analyze all files from shared project at once
      const result = await typeSystemAnalyzer.extractTypeInformation(
        snapshotId,
        typeProject.getSourceFiles()
      );
      
      // Add snapshotId to each type definition (should already be included but ensure consistency)
      const typesWithSnapshot = result.typeDefinitions.map(type => ({
        ...type,
        snapshotId
      }));
      
      // Add snapshotId to each relationship (should already be included but ensure consistency) 
      const relationshipsWithSnapshot = result.typeRelationships.map(rel => ({
        ...rel,
        snapshotId
      }));

      // Add snapshotId to each type member (should already be included but ensure consistency)
      const membersWithSnapshot = result.typeMembers.map(member => ({
        ...member,
        snapshotId
      }));

      // Add snapshotId to each method override (should already be included but ensure consistency)
      const overridesWithSnapshot = result.methodOverrides.map(override => ({
        ...override,
        snapshotId
      }));
      
      typeDefinitions.push(...typesWithSnapshot);
      typeRelationships.push(...relationshipsWithSnapshot);
      typeMembers.push(...membersWithSnapshot);
      methodOverrides.push(...overridesWithSnapshot);
    } catch (error) {
      env.commandLogger.warn(`Failed to analyze types in batch: ${error}`);
      // Fallback to individual file processing if batch fails
      for (const sourceFile of sourceFiles) {
        try {
          // Ensure file exists in shared project (create if missing in fallback)
          let sf = typeProject.getSourceFile(sourceFile.filePath);
          if (!sf) {
            sf = typeProject.createSourceFile(sourceFile.filePath, sourceFile.fileContent, { overwrite: true });
          }
          const result = await typeSystemAnalyzer.extractTypeInformation(snapshotId, [sf]);
          
          const typesWithSnapshot = result.typeDefinitions.map(type => ({
            ...type,
            snapshotId
          }));
          
          const relationshipsWithSnapshot = result.typeRelationships.map(rel => ({
            ...rel,
            snapshotId
          }));
          
          typeDefinitions.push(...typesWithSnapshot);
          typeRelationships.push(...relationshipsWithSnapshot);
          if (result.typeMembers?.length) {
            typeMembers.push(...result.typeMembers.map(m => ({ ...m, snapshotId })));
          }
          if (result.methodOverrides?.length) {
            methodOverrides.push(...result.methodOverrides.map(m => ({ ...m, snapshotId })));
          }
        } catch (error) {
          env.commandLogger.warn(`Failed to analyze types for ${sourceFile.filePath}: ${error}`);
        }
      }
    }
    
    // Store types in database
    if (typeDefinitions.length > 0) {
      console.log(`🔧 Saving ${typeDefinitions.length} type definitions and ${typeRelationships.length} relationships...`);
      try {
        await env.storage.saveTypeDefinitions(typeDefinitions);
        console.log(`✅ Type definitions saved successfully`);
        
        await env.storage.saveTypeRelationships(typeRelationships);
        console.log(`✅ Type relationships saved successfully`);
        
        if (typeMembers.length > 0) {
          await env.storage.saveTypeMembers(typeMembers);
          console.log(`✅ Type members saved successfully (${typeMembers.length} members)`);
        }
        
        if (methodOverrides.length > 0) {
          await env.storage.saveMethodOverrides(methodOverrides);
          console.log(`✅ Method overrides saved successfully (${methodOverrides.length} overrides)`);
        }
        
        console.log(`✅ All type data saved successfully`);
      } catch (error) {
        env.commandLogger.error(`Failed to save type data: ${error instanceof Error ? error.message : String(error)}`);
        if (env.commandLogger.isVerbose || process.env['DEBUG'] === 'true') {
          env.commandLogger.debug('Error details:', {
            name: error instanceof Error ? error.name : 'Unknown',
            stack: error instanceof Error ? error.stack?.split('\n').slice(0, 5) : undefined
          });
        }
        throw error;
      }
    }
    
    // Update analysis level
    try {
      console.log(`🔧 Updating analysis level to TYPE_SYSTEM for snapshot ${snapshotId}`);
      await env.storage.updateAnalysisLevel(snapshotId, 'TYPE_SYSTEM');
      console.log(`✅ Analysis level updated successfully`);
      
      // Force database sync
      console.log(`🔧 Forcing database sync...`);
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log(`✅ Database sync completed`);
    } catch (error) {
      console.error(`❌ Failed to update analysis level: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    
    if (spinner && showProgress) {
      spinner.succeed(`Type system analysis completed (${typeDefinitions.length} types, ${typeRelationships.length} relationships)`);
    }
    
    return { typesAnalyzed: typeDefinitions.length };
  } catch (error) {
    if (spinner && showProgress) {
      spinner.fail(`Type system analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw error;
  }
}

/*
// REMOVED: Command Protocol violation
async function checkConfigurationChanges(
  env: CommandEnvironment,
  options: ScanCommandOptions,
  spinner: SpinnerInterface
): Promise<string> {
  const configManager = new ConfigManager();
  const currentConfigHash = configManager.generateScanConfigHash(env.config);

  try {
    const lastConfigHash = await env.storage.getLastConfigHash();

    if (lastConfigHash && lastConfigHash !== currentConfigHash && lastConfigHash !== 'unknown') {
      // Configuration has changed
      if (!options.comment) {
        spinner.stop();
        console.log(chalk.blue('📋 Configuration change detected'));
        console.log(chalk.gray('Your scan configuration has been updated since the last snapshot.'));
        console.log(chalk.gray('Previous config hash:'), chalk.dim(lastConfigHash));
        console.log(chalk.gray('Current config hash: '), chalk.dim(currentConfigHash));
        console.log();
        console.log(chalk.blue('Please add a comment to document this change:'));
        console.log(chalk.green('Usage: funcqc scan --comment "Brief description of the change"'));
        console.log();
        console.log(chalk.gray('Examples:'));
        console.log(chalk.gray('  funcqc scan --comment "Added new src/components directory"'));
        console.log(
          chalk.gray('  funcqc scan --comment "Moved from src/ to lib/ folder structure"')
        );
        console.log(
          chalk.gray('  funcqc scan --comment "Updated exclude patterns for test files"')
        );

        process.exit(1);
      }

      // Valid comment provided
      console.log(chalk.blue('ℹ️  Configuration change documented:'));
      console.log(chalk.gray(`   "${options.comment}"`));
      console.log();
    }
  } catch (error) {
    // Handle storage errors gracefully - continue with scan
    env.commandLogger.warn(`Warning: Could not check configuration hash: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // Return the current config hash to be stored with the snapshot
  return currentConfigHash;
}
*/

async function determineScanPaths(config: FuncqcConfig, scopeName?: string): Promise<string[]> {
  const configManager = new ConfigManager();
  await configManager.load(); // Ensure config is loaded
  
  // Use default scope if none specified
  const actualScopeName = scopeName || config.defaultScope || 'src';
  const scopeConfig = configManager.resolveScopeConfig(actualScopeName);
  return scopeConfig.roots;
}

async function initializeComponents(
  env: CommandEnvironment,
  spinner: SpinnerInterface,
  projectSize?: number
): Promise<CliComponents> {
  spinner.start('Initializing funcqc scan...');

  // Get optimal configuration based on system resources
  const resourceManager = SystemResourceManager.getInstance();
  const optimalConfig = resourceManager.getOptimalConfig(projectSize);
  
  // Log system information and monitor memory usage
  if (process.env['DEBUG'] === 'true') {
    resourceManager.logSystemInfo(optimalConfig);
  }
  
  // Monitor memory usage periodically during analysis with dynamic limits
  const v8 = await import('v8');
  const heapStats = v8.getHeapStatistics();
  
  // V8のヒープサイズ制限が0の場合（制限なし）のフォールバック処理を追加
  const heapLimit = heapStats.heap_size_limit || (2 * 1024 * 1024 * 1024); // 2GB fallback
  const maxHeapMB = Math.floor(heapLimit / 1024 / 1024 * 0.9);
  
  // より詳細なメモリ閾値管理
  const warningThreshold = maxHeapMB * 0.8;
  const criticalThreshold = maxHeapMB * 0.9;
  
  const memoryMonitor = setInterval(() => {
    const memoryUsage = process.memoryUsage();
    const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
    
    if (heapUsedMB > criticalThreshold) {
      env.logger.error(`Critical memory usage: ${heapUsedMB.toFixed(1)}MB (${(heapUsedMB/maxHeapMB*100).toFixed(1)}%)`);
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        const afterGC = process.memoryUsage().heapUsed / 1024 / 1024;
        env.logger.debug(`Memory after GC: ${afterGC.toFixed(1)}MB (freed ${(heapUsedMB - afterGC).toFixed(1)}MB)`);
      } else {
        env.logger.debug('Garbage collection not available (run with --expose-gc for forced GC)');
      }
    } else if (heapUsedMB > warningThreshold) {
      env.logger.warn(`High memory usage: ${heapUsedMB.toFixed(1)}MB (${(heapUsedMB/maxHeapMB*100).toFixed(1)}%)`);
    }
  }, 10000); // Check every 10 seconds
  
  // Dynamic cleanup timing based on project size with proper cleanup
  const maxMonitoringTime = Math.max(300000, (projectSize || 100) * 100); // At least 5 minutes or 100ms per file
  const monitoringTimeout = setTimeout(() => {
    clearInterval(memoryMonitor);
    env.logger.debug('Memory monitoring stopped after timeout');
  }, maxMonitoringTime);
  
  // Store timeout reference for potential early cleanup
  (memoryMonitor as NodeJS.Timeout & { __timeout?: NodeJS.Timeout }).__timeout = monitoringTimeout;

  // Configure analyzer with optimal settings
  const analyzer = new TypeScriptAnalyzer(
    optimalConfig.maxSourceFilesInMemory,
    true, // Enable cache
    env.logger
  );
  const qualityCalculator = new QualityCalculator();

  spinner.succeed(`Components initialized (${optimalConfig.maxSourceFilesInMemory} files in memory, ${optimalConfig.maxWorkers} workers)`);

  return { 
    analyzer, 
    storage: env.storage, 
    qualityCalculator,
    optimalConfig,
    memoryMonitor,
    monitoringTimeout
  };
}

async function discoverFiles(
  scanPaths: string[],
  config: FuncqcConfig,
  spinner: SpinnerInterface,
  scopeName?: string
): Promise<string[]> {
  spinner.start('Finding TypeScript files...');
  
  const configManager = new ConfigManager();
  await configManager.load(); // Ensure config is loaded
  
  // Use default scope if none specified
  const actualScopeName = scopeName || config.defaultScope || 'src';
  const scopeConfig = configManager.resolveScopeConfig(actualScopeName);
  
  let excludePatterns = scopeConfig.exclude || [];
  const includePatterns = scopeConfig.include;
  
  // Apply global exclude patterns
  if (config.globalExclude) {
    excludePatterns = Array.from(new Set([...excludePatterns, ...config.globalExclude]));
  }
  
  const files = await findTypeScriptFiles(scanPaths, excludePatterns, includePatterns);
  spinner.succeed(`Found ${files.length} TypeScript files`);
  return files;
}

interface ScanResultsJSON {
  success: boolean;
  snapshotId?: string;
  filesAnalyzed: number;
  functionsAnalyzed: number;
  callEdges: number;
  internalCallEdges: number;
  scope: string;
  label?: string;
  comment?: string;
  timestamp: string;
  analysisLevel: string;
  scanDuration?: number;
  message?: string;
}

function outputScanResultsJSON(results: ScanResultsJSON): void {
  console.log(JSON.stringify(results, null, 2));
}

function showCompletionMessage(): void {
  console.log(chalk.green('✓ Scan completed successfully!'));
  console.log();
  console.log(chalk.blue('Next steps:'));
  console.log(chalk.gray('  • Run `funcqc list` to view functions'));
  console.log(chalk.gray('  • Run `funcqc list --cc-ge 10` to find complex functions'));
  console.log(chalk.gray('  • Run `funcqc health` to see overall quality analysis'));
  console.log(chalk.gray('  • Run `funcqc dep show <function>` to analyze dependencies'));
  console.log();
  // Additional analysis options available
}

function handleScanError(
  error: unknown,
  options: ScanCommandOptions,
  spinner: SpinnerInterface
): void {
  if (options.json) {
    console.log(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stack: options.verbose && error instanceof Error ? error.stack : undefined,
      filesAnalyzed: 0,
      functionsAnalyzed: 0,
      snapshotId: null,
      timestamp: new Date().toISOString()
    }, null, 2));
  } else {
    spinner.fail('Scan failed');
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));

    if (options.verbose && error instanceof Error) {
      console.error(chalk.gray(error.stack));
    }
  }

  process.exit(1);
}

async function findTypeScriptFiles(roots: string[], excludePatterns: string[], customIncludePatterns?: string[]): Promise<string[]> {
  // Create include patterns for TypeScript files in all roots
  let includePatterns: string[];
  
  if (customIncludePatterns && customIncludePatterns.length > 0) {
    // Use custom include patterns if provided (for scopes like 'test')
    includePatterns = roots.flatMap(root => 
      customIncludePatterns.map(pattern => path.join(root, pattern))
    );
  } else {
    // Default TypeScript file patterns
    includePatterns = roots.flatMap(root => [
      path.join(root, '**/*.ts'),
      path.join(root, '**/*.tsx'),
    ]);
  }

  // Convert exclude patterns to proper ignore patterns
  const ignorePatterns = excludePatterns.map(pattern => {
    // If pattern doesn't contain wildcards, treat as directory/file name
    if (!pattern.includes('*') && !pattern.includes('?')) {
      return `**/${pattern}/**`;
    }
    return pattern;
  });

  try {
    const files = await globby(includePatterns, {
      ignore: ignorePatterns,
      absolute: true,
      onlyFiles: true,
      followSymbolicLinks: false,
    });

    return files;
  } catch (error) {
    console.warn(
      chalk.yellow(
        `Warning: Error finding files: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    return [];
  }
}

/**
 * Run real-time quality gate mode with adaptive thresholds
 */
async function runRealtimeGateMode(
  config: FuncqcConfig,
  _options: ScanCommandOptions,
  spinner: typeof ora.prototype
): Promise<void> {
  spinner.start('Initializing real-time quality gate...');

  try {
    // Create temporary storage for real-time analysis
    const logger = new Logger();
    const storage = new (await import('../../storage/pglite-adapter')).PGLiteStorageAdapter(
      config.storage.path || '.funcqc/funcqc.db', 
      logger
    );
    await storage.init();
    
    const initResult = await initializeQualityGate(config, spinner, storage);
    
    const analysisResult = await performRealTimeAnalysis(config, initResult.qualityGate);
    
    if (analysisResult.files.length === 0) {
      console.log(chalk.yellow('No TypeScript files found to analyze.'));
      return;
    }

    displayAnalysisResults(analysisResult);
    
    await storage.close();
  } catch (error) {
    spinner.fail(
      `Real-time quality gate failed: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

async function initializeQualityGate(
  _config: FuncqcConfig, 
  spinner: typeof ora.prototype,
  storage: import('../../types').StorageAdapter
) {
  const allHistoricalFunctions = await loadHistoricalFunctions(storage);
  const qualityGate = createQualityGate(allHistoricalFunctions, spinner);

  return { storage, qualityGate };
}

async function loadHistoricalFunctions(storage: import('../../types').StorageAdapter): Promise<FunctionInfo[]> {
  const recentSnapshots = await storage.getSnapshots({ limit: 5 });
  const allHistoricalFunctions: FunctionInfo[] = [];

  for (const snapshot of recentSnapshots) {
    const functions = await storage.findFunctionsInSnapshot(snapshot.id);
    allHistoricalFunctions.push(...functions);
  }

  return allHistoricalFunctions;
}

function createQualityGate(historicalFunctions: FunctionInfo[], spinner: typeof ora.prototype) {
  const qualityGate = new RealTimeQualityGate({
    warningThreshold: 2.0,
    criticalThreshold: 3.0,
    minBaselineFunctions: 20,
  });

  if (historicalFunctions.length > 0) {
    qualityGate.updateBaseline(historicalFunctions);
    spinner.succeed(
      `Baseline established from ${historicalFunctions.length} historical functions`
    );
  } else {
    spinner.warn('No historical data found - using static thresholds');
  }

  return qualityGate;
}

async function performRealTimeAnalysis(config: FuncqcConfig, qualityGate: RealTimeQualityGate) {
  const scanPaths = await determineScanPaths(config, 'src');
  const files = await discoverFiles(scanPaths, config, ora());

  console.log(chalk.cyan('\n🚀 Real-time Quality Gate Analysis\n'));

  let totalViolations = 0;
  let criticalViolations = 0;

  for (const file of files) {
    try {
      const result = await analyzeFile(file, qualityGate);
      totalViolations += result.totalViolations;
      criticalViolations += result.criticalViolations;
    } catch (error) {
      console.log(
        chalk.red(
          `✗ Failed to analyze ${path.relative(process.cwd(), file)}: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  return { files, totalViolations, criticalViolations };
}

async function analyzeFile(file: string, qualityGate: RealTimeQualityGate) {
  const fileContent = await fs.readFile(file, 'utf-8');
  const assessment = await qualityGate.evaluateCode(fileContent, { filename: file });

  let totalViolations = 0;
  let criticalViolations = 0;

  if (
    !assessment.acceptable ||
    assessment.violations.length > 0 ||
    assessment.structuralAnomalies.length > 0
  ) {
    await displayQualityAssessment(file, assessment);
    totalViolations = assessment.violations.length + assessment.structuralAnomalies.length;
    criticalViolations =
      assessment.violations.filter(v => v.severity === 'critical').length +
      assessment.structuralAnomalies.filter(a => a.severity === 'critical').length;
  }

  return { totalViolations, criticalViolations };
}

function displayAnalysisResults(result: { files: string[], totalViolations: number, criticalViolations: number }) {
  console.log(chalk.cyan('\n📊 Real-time Analysis Summary'));
  console.log(`Files analyzed: ${result.files.length}`);
  console.log(`Total violations: ${result.totalViolations}`);
  console.log(`Critical violations: ${result.criticalViolations}`);

  if (result.criticalViolations > 0) {
    console.log(
      chalk.red(`\n❌ Quality gate failed: ${result.criticalViolations} critical violations found`)
    );
    process.exit(1);
  } else if (result.totalViolations > 0) {
    console.log(
      chalk.yellow(`\n⚠️  Quality gate passed with warnings: ${result.totalViolations} violations found`)
    );
  } else {
    console.log(chalk.green('\n✅ Quality gate passed: All code meets quality standards'));
  }
}

/**
 * Display quality assessment results
 */
async function displayQualityAssessment(
  filePath: string,
  assessment: QualityAssessment
): Promise<void> {
  const relativePath = path.relative(process.cwd(), filePath);

  console.log(chalk.magenta(`\n📁 ${relativePath}`));
  console.log(`   Quality Score: ${assessment.qualityScore}/100`);
  console.log(`   Response Time: ${assessment.responseTime.toFixed(1)}ms`);

  if (assessment.violations.length > 0) {
    console.log(chalk.yellow('   Violations:'));
    for (const violation of assessment.violations) {
      const icon = violation.severity === 'critical' ? '🔴' : '🟡';
      console.log(
        `   ${icon} ${violation.metric}: ${violation.value} (threshold: ${violation.threshold.toFixed(1)})`
      );
      console.log(`      ${violation.suggestion}`);
    }
  }

  if (assessment.structuralAnomalies.length > 0) {
    console.log(chalk.magenta('   Structural Anomalies:'));
    for (const anomaly of assessment.structuralAnomalies) {
      const icon = anomaly.severity === 'critical' ? '🔴' : '🟡';
      console.log(
        `   ${icon} ${anomaly.metric}: ${anomaly.value.toFixed(3)} (expected: ${anomaly.expectedRange[0]}-${anomaly.expectedRange[1]})`
      );
      console.log(`      ${anomaly.suggestion}`);
    }
  }

  if (assessment.improvementInstruction) {
    console.log(chalk.blue(`   💡 Suggestion: ${assessment.improvementInstruction}`));
  }
}

/**
 * Extract function characteristics for diagnostic analysis
 */
function extractFunctionCharacteristics(node: Node): {
  name?: string;
  type?: string;
  contextPath?: string[];
  isAnonymous?: boolean;
} {
  let functionName = '<anonymous>';
  let functionType = 'unknown';
  let isAnonymous = true;
  
  // Determine function type and name
  if (Node.isFunctionDeclaration(node)) {
    functionType = 'function';
    functionName = node.getName() || '<anonymous>';
    isAnonymous = !node.getName();
  } else if (Node.isMethodDeclaration(node)) {
    functionType = 'method';
    functionName = node.getName() || '<anonymous>';
    isAnonymous = !node.getName();
  } else if (Node.isArrowFunction(node)) {
    functionType = 'arrow';
    // Try to get name from variable declaration
    const parent = node.getParent();
    if (parent && Node.isVariableDeclaration(parent)) {
      const varName = parent.getName();
      if (varName) {
        functionName = varName;
        isAnonymous = false;
      }
    }
  } else if (Node.isFunctionExpression(node)) {
    functionType = 'expression';
    functionName = node.getName() || '<anonymous>';
    isAnonymous = !node.getName();
  } else if (Node.isConstructorDeclaration(node)) {
    functionType = 'constructor';
    functionName = 'constructor';
    isAnonymous = false;
  } else if (Node.isGetAccessorDeclaration(node)) {
    functionType = 'getter';
    functionName = `get_${node.getName()}`;
    isAnonymous = false;
  } else if (Node.isSetAccessorDeclaration(node)) {
    functionType = 'setter';
    functionName = `set_${node.getName()}`;
    isAnonymous = false;
  }
  
  // Extract context path
  const contextPath: string[] = [];
  let current: Node | undefined = node.getParent();
  
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
  
  return {
    name: functionName,
    type: functionType,
    contextPath,
    isAnonymous
  };
}

/**
 * Analyze patterns in skipped functions to identify common issues
 */
function analyzeSkippedFunctionPatterns(skippedFunctions: Array<{
  funcHashId: string;
  functionName?: string;
  functionType?: string;
  contextPath?: string[];
  isAnonymous?: boolean;
  reason: string;
}>): {
  anonymous: number;
  constructors: number;
  methods: number;
  arrows: number;
  getters: number;
} {
  const patterns = {
    anonymous: 0,
    constructors: 0,
    methods: 0,
    arrows: 0,
    getters: 0
  };
  
  for (const func of skippedFunctions) {
    if (func.isAnonymous) {
      patterns.anonymous++;
    }
    
    if (func.functionType === 'constructor') {
      patterns.constructors++;
    } else if (func.functionType === 'method') {
      patterns.methods++;
    } else if (func.functionType === 'arrow') {
      patterns.arrows++;
    } else if (func.functionType === 'getter' || func.functionType === 'setter') {
      patterns.getters++;
    }
  }
  
  return patterns;
}

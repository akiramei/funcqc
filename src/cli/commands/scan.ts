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
import { ParallelFileProcessor, ParallelProcessingResult } from '../../utils/parallel-processor';
import { SystemResourceManager } from '../../utils/system-resource-manager';
import { RealTimeQualityGate, QualityAssessment } from '../../core/realtime-quality-gate.js';
import { Logger } from '../../utils/cli-utils';
import { FunctionIdGenerator } from '../../utils/function-id-generator';
import { ErrorCode, createErrorHandler, type DatabaseErrorLike } from '../../utils/error-handler';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { FunctionAnalyzer } from '../../core/analyzer';
import { OnePassASTVisitor } from '../../analyzers/shared/one-pass-visitor';
import { Project, TypeChecker, ts, Node } from 'ts-morph';
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
 * Scan level configuration
 */
interface ScanLevel {
  mode: 'quick' | 'basic' | 'standard' | 'full';
  includes: string[];
  targetTime: string;
}

/**
 * Determine scan level based on command options
 */
function determineScanLevel(options: ScanCommandOptions): ScanLevel {
  if (options.full) {
    return {
      mode: 'full',
      includes: ['BASIC', 'COUPLING', 'CALL_GRAPH', 'TYPE_SYSTEM'],
      targetTime: 'variable'
    };
  }
  
  if (options.withTypes) {
    return {
      mode: 'full',
      includes: ['BASIC', 'COUPLING', 'CALL_GRAPH', 'TYPE_SYSTEM'],
      targetTime: 'variable'
    };
  }
  
  if (options.withGraph) {
    return {
      mode: 'standard',
      includes: ['BASIC', 'COUPLING', 'CALL_GRAPH'],
      targetTime: 'variable'
    };
  }
  
  // New option: --with-basic for including basic analysis only
  if (options.withBasic) {
    return {
      mode: 'basic',
      includes: ['BASIC'],
      targetTime: 'variable'
    };
  }
  
  // New option: --with-coupling for including coupling analysis  
  if (options.withCoupling) {
    return {
      mode: 'basic',
      includes: ['BASIC', 'COUPLING'],
      targetTime: 'variable'
    };
  }
  
  if (options.quick) {
    return {
      mode: 'quick',
      includes: [],  // No analysis, just snapshot
      targetTime: 'variable'
    };
  }
  
  // Default to basic analysis for productive workflow
  if (!options.withGraph && !options.withTypes && !options.full && !options.withBasic) {
    return {
      mode: 'basic',
      includes: ['BASIC'],  // Basic analysis by default
      targetTime: 'variable'
    };
  }
  
  // Fallback
  return {
    mode: 'basic',
    includes: ['BASIC'],
    targetTime: '15-20s'
  };
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

    // Determine scan level based on options
    const scanLevel = determineScanLevel(options);
    if (!options.json) {
      console.log(chalk.cyan(`🎯 Scan mode: ${scanLevel.mode}`));
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
    const functions = await env.storage.findFunctionsInSnapshot(snapshotId);
    const functionsAnalyzed = functions.length;
    const analysisLevel = (latestSnapshot.metadata as Record<string, unknown>)?.['analysisLevel'] as string || 'NONE';
    
    // Get source files and call edges from existing snapshot
    const sourceFiles = await env.storage.getSourceFilesBySnapshot(snapshotId);
    const callEdges = await env.storage.getCallEdgesBySnapshot(snapshotId);
    const internalCallEdges = await env.storage.getInternalCallEdgesBySnapshot(snapshotId);
    
    // Record scan duration for display only
    const endTime = performance.now();
    const scanDuration = Math.round(endTime - startTime);
    
    // Output results
    if (options.json) {
      outputScanResultsJSON({
        success: true,
        snapshotId,
        filesAnalyzed: sourceFiles.length,
        functionsAnalyzed,
        callEdges: callEdges.length,
        internalCallEdges: internalCallEdges.length,
        scope: options.scope || 'src',
        ...(options.label && { label: options.label }),
        ...(options.comment && { comment: options.comment }),
        timestamp: new Date().toISOString(),
        analysisLevel,
        scanDuration
      });
    } else {
      const durationSec = (scanDuration / 1000).toFixed(1);
      console.log(chalk.green(`✓ ${scanLevel.mode} scan completed in ${durationSec}s`));
      
      // Show analysis results
      console.log(chalk.blue(`📊 Results: ${functionsAnalyzed} functions, ${callEdges.length} call edges`));
      console.log(chalk.blue(`📁 Files analyzed: ${sourceFiles.length}`));
      console.log(chalk.blue(`🎯 Analysis level: ${analysisLevel}`));
      
      // Show next steps based on scan level
      if (scanLevel.mode === 'quick') {
        console.log(chalk.gray('  Run `funcqc measure --with-basic` for function analysis'));
        console.log(chalk.gray('  Run `funcqc analyze --call-graph` for dependency analysis'));
      } else if (scanLevel.mode === 'basic') {
        console.log(chalk.gray('  Run `funcqc analyze --call-graph` for dependency analysis'));
      } else if (scanLevel.mode === 'standard') {
        console.log(chalk.gray('  Run `funcqc analyze --types` for type system analysis'));
      }
      
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

  // Check for incomplete previous analysis to prevent duplicate key violations
  const existingFunctions = await env.storage.findFunctionsInSnapshot(snapshotId);
  const currentSnapshot = await env.storage.getSnapshot(snapshotId);
  const metadata = currentSnapshot?.metadata as Record<string, unknown>;
  const analysisLevel = (metadata?.['analysisLevel'] as string) || 'NONE';
  
  if (existingFunctions.length > 0 && analysisLevel === 'NONE') {
    // Detected incomplete previous analysis - functions exist but analysis level not updated
    env.logger?.warn(`Detected incomplete previous analysis for snapshot ${snapshotId.substring(0, 8)} (${existingFunctions.length} functions exist but analysis level is NONE)`);
    
    // Clean up incomplete state by updating analysis level to prevent duplicate execution
    await env.storage.updateAnalysisLevel(snapshotId, 'BASIC');
    env.logger?.info(`Fixed incomplete analysis state for snapshot ${snapshotId.substring(0, 8)}`);
    return; // Skip re-analysis since functions are already present
  }

  const ora = (await import('ora')).default;
  const spinner = ora();
  
  if (showProgress) {
    spinner.start('Performing basic function analysis...');
  }
  
  try {
    // Get source file ID mapping
    const sourceFileIdMap = await getSourceFileIdMapping(env.storage, snapshotId);
    
    // Perform the PURE basic analysis (no coupling)
    const result = await performPureBasicAnalysis(snapshotId, sourceFiles, env, spinner, sourceFileIdMap);
    
    if (showProgress) {
      spinner.succeed(`Basic analysis completed (${result.functionsAnalyzed} functions)`);
    }
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
    
    if (allErrors.length > 0) {
      console.log(chalk.yellow(`⚠️  Basic analysis completed with ${allErrors.length} errors`));
    } else {
      console.log(chalk.green(`✅ Basic analysis completed! Analyzed ${totalFunctions} functions (no coupling)`));
    }
    
    // Only update analysis level if functions were successfully analyzed
    if (totalFunctions > 0) {
      await env.storage.updateAnalysisLevel(snapshotId, 'BASIC');
      spinner.succeed(`Analyzed ${totalFunctions} functions from ${sourceFiles.length} files (BASIC only)`);
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

  // Collect all file contents for shared project creation
  const allFileContentMap = new Map<string, string>();
  for (const batch of batches) {
    for (const sourceFile of batch) {
      allFileContentMap.set(sourceFile.filePath, sourceFile.fileContent);
    }
  }

  // Create shared project once for all analysis using TypeScript analyzer
  const maybePrepare =
    (components.analyzer as unknown as {
      prepareSharedProject?: (
        sid: string,
        map: Map<string, string>
      ) => Promise<{ project: import('ts-morph').Project; isNewlyCreated: boolean }>;
    }).prepareSharedProject;
  let isNewlyCreated = false;
  if (typeof maybePrepare === 'function') {
    ({ isNewlyCreated } = await maybePrepare(snapshotId, allFileContentMap));
  } else {
    env.commandLogger.debug?.(
      'Shared project not supported by analyzer — skipping prepareSharedProject'
    );
  }

  if (isNewlyCreated) {
    if (options?.verbose) {
      env.commandLogger.info(`✅ Shared virtual project created (${allFileContentMap.size} files)`);
    }
  } else {
    if (options?.verbose) {
      env.commandLogger.info(`⚡ Reusing existing virtual project (${allFileContentMap.size} files)`);
    }
  }

  const batchPromises: Promise<BatchProcessingResult>[] = batches.map(async (batch, batchIndex) => {
    const batchFunctions: FunctionInfo[] = [];
    const batchErrors: string[] = [];
    
    console.log(chalk.blue(`📦 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} files)`));
    
    for (const sourceFile of batch) {
      try {
        // Use analyzer with content instead of file path
        const functions = await components.analyzer.analyzeContent(
          sourceFile.fileContent,
          sourceFile.filePath,
          snapshotId
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
      } catch (error) {
        const errorMessage = `Error analyzing file ${sourceFile.filePath}: ${error instanceof Error ? error.message : String(error)}`;
        batchErrors.push(errorMessage);
        console.warn(chalk.yellow(`Warning: ${errorMessage}`));
      }
    }
    
    if (batchErrors.length > 0) {
      console.log(chalk.yellow(`⚠️  Batch ${batchIndex + 1} completed with ${batchErrors.length} errors`));
    } else {
      console.log(chalk.green(`✅ Batch ${batchIndex + 1} completed successfully (${batchFunctions.length} functions)`));
    }
    
    return { 
      functionCount: batchFunctions.length, 
      errors: batchErrors,
      functions: batchFunctions // Return functions for later storage
    };
  });
  
  // Execute all batch processing in parallel
  const batchResults = await Promise.all(batchPromises);
  
  // Collect all functions from all batches
  const allFunctions: FunctionInfo[] = [];
  const allFunctionCounts = new Map<string, number>();
  
  for (const result of batchResults) {
    allFunctions.push(...result.functions);
    
    // Collect function counts by file
    for (const func of result.functions) {
      const count = allFunctionCounts.get(func.filePath) || 0;
      allFunctionCounts.set(func.filePath, count + 1);
    }
  }
  
  // Store all functions in a single transaction to prevent duplicate key violations
  if (allFunctions.length > 0) {
    try {
      await env.storage.storeFunctions(allFunctions, snapshotId);
      
      // Update function counts for all files
      if (allFunctionCounts.size > 0) {
        await env.storage.updateSourceFileFunctionCounts(allFunctionCounts, snapshotId);
      }
      
      console.log(chalk.green(`💾 Stored ${allFunctions.length} functions across ${allFunctionCounts.size} files in single transaction`));
    } catch (error) {
      console.error(chalk.red(`❌ Failed to store functions in single transaction: ${error instanceof Error ? error.message : String(error)}`));
      
      // Don't update analysis level on error to prevent incomplete state
      throw new Error(`Function storage failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Return results without functions property (clean up)
  return batchResults.map(result => ({
    functionCount: result.functionCount,
    errors: result.errors
  }));
}

export async function performBasicAnalysis(
  snapshotId: string,
  sourceFiles: import('../../types').SourceFile[],
  env: CommandEnvironment,
  spinner: SpinnerInterface,
  sourceFileIdMap?: Map<string, string>
): Promise<{ functionsAnalyzed: number }> {
  spinner.start('Performing basic function analysis...');
  
  const components = await initializeComponents(env, spinner, sourceFiles.length);
  let totalFunctions = 0; // Track total instead of accumulating all in memory
  
  // Determine optimal concurrency based on system resources
  // Trust SystemResourceManager's calculations - it already considers project size and system capabilities
  const maxConcurrency = components.optimalConfig.maxWorkers;
  
  spinner.text = `Analyzing ${sourceFiles.length} files with ${maxConcurrency} concurrent workers...`;
  
  try {
    // Prepare batches for parallel processing
    const batches = prepareBatchProcessing(sourceFiles, maxConcurrency);
    
    // Execute BASIC batch analysis (no coupling)
    const batchResults = await executePureBasicBatchAnalysis(batches, components, snapshotId, env, { verbose: false }, sourceFileIdMap);
    
    // Collect summary results
    const allErrors: string[] = [];
    for (const batchResult of batchResults) {
      totalFunctions += batchResult.functionCount;
      allErrors.push(...batchResult.errors);
    }
    
    if (allErrors.length > 0) {
      console.log(chalk.yellow(`⚠️  Total analysis completed with ${allErrors.length} errors across ${batchResults.length} batches`));
    } else {
      console.log(chalk.green(`✅ All batches completed successfully! Analyzed ${totalFunctions} functions from ${sourceFiles.length} files`));
    }
    
    // Update analysis level after all batches complete
    await env.storage.updateAnalysisLevel(snapshotId, 'BASIC');
    
    spinner.succeed(`Analyzed ${totalFunctions} functions from ${sourceFiles.length} files`);
    
    // Skip heavy summary calculation for performance unless explicitly requested
    if (process.env['FUNCQC_SHOW_SUMMARY'] === 'true' || totalFunctions < 100) {
      // Summary requires function array but we optimized it away for memory efficiency
      console.log(chalk.blue(`📋 Analysis completed: ${totalFunctions} functions from ${sourceFiles.length} files`));
    }
    
    return { functionsAnalyzed: totalFunctions };
  } finally {
    // Always perform cleanup
    await performAnalysisCleanup(components, env);
  }
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
  
  // Get source files and functions for the snapshot
  const sourceFiles = await env.storage.getSourceFilesBySnapshot(snapshotId);
  const functions = await env.storage.findFunctionsInSnapshot(snapshotId);
  
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
    
    // Create shared Project/TypeChecker for coupling analysis to reduce memory usage
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: ts.ScriptTarget.Latest,
        allowJs: true,
        skipLibCheck: true,
      }
    });
    
    // Load all source files into the project for complete type resolution
    // This ensures that imported types and interfaces are available for coupling analysis
    console.log(chalk.blue(`📚 Loading ${sourceFiles.length} files into TypeScript project for type resolution...`));
    for (const sourceFile of sourceFiles) {
      project.createSourceFile(sourceFile.filePath, sourceFile.fileContent);
    }
    console.log(`📁 Loaded ${project.getSourceFiles().length} files into project`);
    
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
  const totalStartTime = performance.now();
  const showSpinner = spinner !== undefined;
  if (showSpinner) {
    spinner.start('Performing call graph analysis...');
  }
  
  // Get stored files and functions
  const fetchStartTime = performance.now();
  const sourceFiles = await env.storage.getSourceFilesBySnapshot(snapshotId);
  const functions = await env.storage.findFunctionsInSnapshot(snapshotId);
  const fetchEndTime = performance.now();
  console.log(chalk.gray(`⏱️  Fetching data from DB: ${((fetchEndTime - fetchStartTime) / 1000).toFixed(2)}s (${sourceFiles.length} files, ${functions.length} functions)`));
  
  // Reconstruct file map for analyzer (include all files for proper type resolution)
  const fileContentMap = new Map<string, string>();
  sourceFiles.forEach(file => {
    fileContentMap.set(file.filePath, file.fileContent);
  });
  
  // Use FunctionAnalyzer with stored content
  const functionAnalyzer = new FunctionAnalyzer(env.config, { logger: env.commandLogger });
  
  try {
    // Analyze call graph from stored content
    const analysisStartTime = performance.now();
    const result = await functionAnalyzer.analyzeCallGraphFromContent(fileContentMap, functions, snapshotId, env.storage);
    const analysisEndTime = performance.now();
    console.log(chalk.blue(`⏱️  analyzeCallGraphFromContent: ${((analysisEndTime - analysisStartTime) / 1000).toFixed(2)}s`));
    
    // Save call edges
    const insertStartTime = performance.now();
    await env.storage.insertCallEdges(result.callEdges, snapshotId);
    const insertEndTime = performance.now();
    console.log(chalk.blue(`⏱️  insertCallEdges: ${((insertEndTime - insertStartTime) / 1000).toFixed(2)}s for ${result.callEdges.length} edges`));
    
    // Update snapshotId for internal call edges and save
    const internalCallEdgesWithSnapshotId = result.internalCallEdges.map(edge => ({
      ...edge,
      snapshotId: snapshotId
    }));
    const internalInsertStartTime = performance.now();
    await env.storage.insertInternalCallEdges(internalCallEdgesWithSnapshotId);
    const internalInsertEndTime = performance.now();
    console.log(chalk.blue(`⏱️  insertInternalCallEdges: ${((internalInsertEndTime - internalInsertStartTime) / 1000).toFixed(2)}s for ${internalCallEdgesWithSnapshotId.length} edges`));
    
    await env.storage.updateAnalysisLevel(snapshotId, 'CALL_GRAPH');
    
    const totalEndTime = performance.now();
    console.log(chalk.cyan(`⏱️  Total performCallGraphAnalysis time: ${((totalEndTime - totalStartTime) / 1000).toFixed(2)}s`));
    
    if (showSpinner) {
      spinner!.succeed(`Call graph analysis completed: ${result.callEdges.length} edges found`);
    }
    
    return result;
    
  } finally {
    functionAnalyzer.dispose();
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
    console.log(`🔍 Checking existing types for snapshot ${snapshotId}`);
    const existingTypes = await env.storage.query(
      'SELECT COUNT(*) as count FROM type_definitions WHERE snapshot_id = $1', 
      [snapshotId]
    );
    const typeCount = (existingTypes.rows[0] as { count?: number })?.count || 0;
    
    if (typeCount > 0) {
      console.log(`⏭️  Type system analysis already completed for snapshot ${snapshotId} (${typeCount} types found) - skipping duplicate analysis`);
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
    
    // Create TypeScript analyzer
    const analyzer = new TypeScriptAnalyzer(
      100, // maxSourceFilesInMemory
      true, // enableCache
      env.commandLogger // logger
    );
    
    // Set storage for function ID lookup in type members
    analyzer.setStorage(env.storage);
    
    // Analyze types from all source files in batch for better performance
    const typeDefinitions: import('../../types').TypeDefinition[] = [];
    const typeRelationships: import('../../types').TypeRelationship[] = [];
    const typeMembers: import('../../types').TypeMember[] = [];
    const methodOverrides: import('../../types').MethodOverride[] = [];
    
    try {
      // Create file path to content mapping for batch processing
      const fileContentsMap = new Map<string, string>();
      sourceFiles.forEach(sourceFile => {
        fileContentsMap.set(sourceFile.filePath, sourceFile.fileContent);
      });
      
      // Batch analyze all files at once instead of one by one
      const result = await analyzer.extractTypeInformationFromContents(
        fileContentsMap,
        snapshotId
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
          const result = await analyzer.analyzeTypesFromContent(
            sourceFile.filePath,
            sourceFile.fileContent
          );
          
          const typesWithSnapshot = result.types.map(type => ({
            ...type,
            snapshotId
          }));
          
          const relationshipsWithSnapshot = result.relationships.map(rel => ({
            ...rel,
            snapshotId
          }));
          
          typeDefinitions.push(...typesWithSnapshot);
          typeRelationships.push(...relationshipsWithSnapshot);
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

// Legacy analysis function - replaced by staged analysis
// @ts-expect-error - Legacy function kept for reference
async function _performAnalysis(
  files: string[],
  components: CliComponents,
  spinner: SpinnerInterface,
  env: CommandEnvironment
): Promise<{ functions: FunctionInfo[]; callEdges: CallEdge[]; internalCallEdges?: import('../../types').InternalCallEdge[] }> {
  spinner.start('Analyzing functions...');

  const result = await performFullAnalysis(files, components, spinner, env);

  spinner.succeed(`Analyzed ${result.functions.length} functions from ${files.length} files`);
  return result;
}

async function performFullAnalysis(
  files: string[],
  components: CliComponents,
  spinner: SpinnerInterface,
  env: CommandEnvironment
): Promise<{ functions: FunctionInfo[]; callEdges: CallEdge[]; internalCallEdges?: import('../../types').InternalCallEdge[] }> {
  // Try ideal call graph analysis first
  const functionAnalyzer = new FunctionAnalyzer(env.config, { logger: env.commandLogger });
  
  try {
    spinner.text = `Using ideal call graph analysis for ${files.length} files...`;
    const result = await functionAnalyzer.analyzeFilesWithIdealCallGraph(files);
    
    spinner.text = `Ideal analysis completed: ${result.functions.length} functions, ${result.callEdges.length} call edges`;
    
    // Show analysis statistics
    if (result.callEdges.length > 0) {
      const highConfidenceEdges = result.callEdges.filter(
        e => e.confidenceScore !== undefined && e.confidenceScore >= 0.95
      );
      const mediumConfidenceEdges = result.callEdges.filter(
        e =>
          e.confidenceScore !== undefined &&
          e.confidenceScore >= 0.7 &&
          e.confidenceScore < 0.95
      );
      const lowConfidenceEdges = result.callEdges.filter(
        e => e.confidenceScore !== undefined && e.confidenceScore < 0.7
      );
      
      spinner.text = `Call graph: ${result.callEdges.length} edges (High: ${highConfidenceEdges.length}, Medium: ${mediumConfidenceEdges.length}, Low: ${lowConfidenceEdges.length})`;
    }
    
    return {
      functions: result.functions,
      callEdges: result.callEdges,
      internalCallEdges: result.internalCallEdges
    };
    
  } catch (error) {
    console.warn('⚠️  Ideal call graph analysis failed, falling back to legacy analysis');
    console.warn(`Error: ${error instanceof Error ? error.message : String(error)}`);
    
    // Fallback to legacy analysis
    const fallbackResult = await performLegacyAnalysis(files, components, spinner);
    return { ...fallbackResult, internalCallEdges: [] };
    
  } finally {
    // Always dispose the function analyzer after analysis is complete
    functionAnalyzer.dispose();
  }
}

async function performLegacyAnalysis(
  files: string[],
  components: CliComponents,
  spinner: SpinnerInterface
): Promise<{ functions: FunctionInfo[]; callEdges: CallEdge[] }> {
  const allFunctions: FunctionInfo[] = [];
  const allCallEdges: CallEdge[] = [];

  // Determine processing strategy based on project size and system capabilities
  const useParallel = ParallelFileProcessor.shouldUseParallelProcessing(files.length);
  const useStreaming = files.length > 1000 && !useParallel; // Use streaming for very large projects when parallel isn't suitable

  if (useParallel) {
    spinner.text = `Using parallel processing for ${files.length} files...`;
    const result = await performParallelAnalysis(files, spinner);
    allFunctions.push(...result.functions);
    // Note: Parallel processing doesn't support call graph analysis yet

    // Show parallel processing stats
    if (result.stats.workersUsed > 1) {
      spinner.text = `Parallel analysis completed: ${result.stats.workersUsed} workers, ${result.stats.avgFunctionsPerFile.toFixed(1)} functions/file`;
    }
  } else if (useStreaming) {
    spinner.text = `Using streaming mode for ${files.length} files...`;
    await performStreamingAnalysis(files, components, allFunctions, spinner);
    // Note: Streaming processing doesn't support call graph analysis yet
  } else {
    const batchSize = 50; // Fixed batch size for smaller projects
    const batchResult = await performBatchAnalysis(files, components, allFunctions, batchSize, spinner);
    allCallEdges.push(...batchResult.callEdges);
  }

  return { functions: allFunctions, callEdges: allCallEdges };
}

async function performBatchAnalysis(
  files: string[],
  components: CliComponents,
  allFunctions: FunctionInfo[],
  batchSize: number,
  spinner: SpinnerInterface
): Promise<{ callEdges: CallEdge[] }> {
  const allCallEdges: CallEdge[] = [];
  
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchResult = await analyzeBatch(
      batch,
      components.analyzer,
      components.qualityCalculator
    );
    allFunctions.push(...batchResult.functions);
    allCallEdges.push(...batchResult.callEdges);

    spinner.text = `Analyzing functions... (${i + batch.length}/${files.length} files)`;
  }
  
  return { callEdges: allCallEdges };
}

async function performParallelAnalysis(
  files: string[],
  spinner: SpinnerInterface
): Promise<ParallelProcessingResult> {
  const processor = new ParallelFileProcessor(ParallelFileProcessor.getRecommendedConfig());

  try {
    return await runParallelProcessing(processor, files, spinner);
  } catch (error) {
    logParallelProcessingError(error, spinner);
    return await fallbackToSequentialProcessing(files, spinner);
  }
}

/**
 * Run parallel processing with progress tracking
 */
async function runParallelProcessing(
  processor: ParallelFileProcessor,
  files: string[],
  spinner: SpinnerInterface
): Promise<ParallelProcessingResult> {
  let completedFiles = 0;
  
  return processor.processFiles(files, {
    onProgress: completed => {
      completedFiles = completed;
      spinner.text = `Parallel analysis: ${completedFiles}/${files.length} files processed...`;
    },
  });
}

/**
 * Log parallel processing error
 */
function logParallelProcessingError(error: unknown, spinner: SpinnerInterface): void {
  spinner.text = `Parallel processing failed, falling back to sequential analysis...`;
  console.warn(
    `Parallel processing error: ${error instanceof Error ? error.message : String(error)}`
  );
}

/**
 * Fallback to sequential processing when parallel processing fails
 */
async function fallbackToSequentialProcessing(
  files: string[],
  spinner: SpinnerInterface
): Promise<ParallelProcessingResult> {
  const analyzer = new TypeScriptAnalyzer();
  const qualityCalculator = new QualityCalculator();
  const allFunctions: FunctionInfo[] = [];
  const startTime = Date.now();

  // Process files sequentially
  await processFilesSequentially(files, analyzer, qualityCalculator, allFunctions, spinner);
  
  // Cleanup analyzer
  await analyzer.cleanup();

  return createSequentialResult(files, allFunctions, startTime);
}

/**
 * Process files sequentially
 */
async function processFilesSequentially(
  files: string[],
  analyzer: TypeScriptAnalyzer,
  qualityCalculator: QualityCalculator,
  allFunctions: FunctionInfo[],
  spinner: SpinnerInterface
): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    await analyzeFileWithFallback(filePath, analyzer, qualityCalculator, allFunctions);
    spinner.text = `Sequential analysis: ${i + 1}/${files.length} files processed...`;
  }
}

/**
 * Analyze a single file with error handling
 */
async function analyzeFileWithFallback(
  filePath: string,
  analyzer: TypeScriptAnalyzer,
  qualityCalculator: QualityCalculator,
  allFunctions: FunctionInfo[],
  snapshotId?: string
): Promise<void> {
  try {
    const functions = await analyzer.analyzeFile(filePath, snapshotId);
    await calculateMetricsForFunctions(functions, qualityCalculator);
    allFunctions.push(...functions);
  } catch (fileError) {
    console.warn(
      `Failed to analyze ${filePath}: ${fileError instanceof Error ? fileError.message : String(fileError)}`
    );
  }
}

/**
 * Calculate metrics for all functions
 */
async function calculateMetricsForFunctions(
  functions: FunctionInfo[],
  qualityCalculator: QualityCalculator
): Promise<void> {
  for (const func of functions) {
    func.metrics = qualityCalculator.calculate(func);
  }
}

/**
 * Create result object for sequential processing
 */
function createSequentialResult(
  files: string[],
  allFunctions: FunctionInfo[],
  startTime: number
): ParallelProcessingResult {
  return {
    functions: allFunctions,
    stats: {
      totalFiles: files.length,
      totalFunctions: allFunctions.length,
      avgFunctionsPerFile: files.length > 0 ? allFunctions.length / files.length : 0,
      totalProcessingTime: Date.now() - startTime,
      workersUsed: 0, // Sequential processing uses 0 workers
    },
  };
}

async function performStreamingAnalysis(
  files: string[],
  components: CliComponents,
  allFunctions: FunctionInfo[],
  spinner: SpinnerInterface
): Promise<void> {
  // Note: Streaming analysis requires analyzer method extension
  // For now, fall back to batch processing for large projects
  await performBatchAnalysis(files, components, allFunctions, 25, spinner); // Smaller batches for memory efficiency
}

/*
// REMOVED: Command Protocol violation  
async function collectSourceFiles(
  files: string[],
  spinner: SpinnerInterface
): Promise<import('../../types').SourceFile[]> {
  spinner.start('Collecting source files...');
  
  const sourceFiles: import('../../types').SourceFile[] = [];
  const crypto = await import('crypto');
  
  // Pre-compile regular expressions for better performance
  const exportRegex = /^export\s+/gm;
  const importRegex = /^import\s+/gm;
  
  // Process files in parallel batches for better I/O performance
  const batchSize = 20; // Process 20 files at a time to avoid overwhelming the system
  const batches: string[][] = [];
  
  for (let i = 0; i < files.length; i += batchSize) {
    batches.push(files.slice(i, i + batchSize));
  }
  
  for (const batch of batches) {
    const batchPromises = batch.map(async (filePath) => {
      try {
        // Parallel I/O operations: read file content and get file stats
        const [fileContent, fileStats] = await Promise.all([
          fs.readFile(filePath, 'utf-8'),
          fs.stat(filePath)
        ]);
        
        const relativePath = path.relative(process.cwd(), filePath);
        
        // Calculate file hash for deduplication
        const fileHash = crypto.createHash('sha256').update(fileContent).digest('hex');
        
        // Generate content ID for deduplication
        // Format: {fileHash}_{fileSizeBytes}
        const fileSizeBytes = Buffer.byteLength(fileContent, 'utf-8');
        const contentId = `${fileHash}_${fileSizeBytes}`;
        
        // Count lines
        const lineCount = fileContent.split('\n').length;
        
        // Detect language from file extension
        const language = path.extname(filePath).slice(1) || 'typescript';
        
        // Basic analysis for exports/imports using pre-compiled regex
        const exportCount = (fileContent.match(exportRegex) || []).length;
        const importCount = (fileContent.match(importRegex) || []).length;
        
        const sourceFile: import('../../types').SourceFile = {
          id: contentId, // Use content ID for deduplication
          snapshotId: '', // Will be set when saved
          filePath: relativePath,
          fileContent,
          fileHash,
          encoding: 'utf-8',
          fileSizeBytes,
          lineCount,
          language,
          functionCount: 0, // Will be updated after function analysis
          exportCount,
          importCount,
          fileModifiedTime: fileStats.mtime, // Use actual file modification time
          createdAt: new Date(),
        };
        
        return sourceFile;
        
      } catch (error) {
        console.warn(
          chalk.yellow(
            `Warning: Failed to read file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
          )
        );
        return null;
      }
    });
    
    // Wait for batch to complete and add valid source files
    const batchResults = await Promise.all(batchPromises);
    sourceFiles.push(...batchResults.filter((file): file is import('../../types').SourceFile => file !== null));
    
    // Update progress
    spinner.text = `Collecting source files... (${sourceFiles.length}/${files.length})`;
  }
  
  spinner.succeed(`Collected ${sourceFiles.length} source files`);
  return sourceFiles;
}
*/

// Legacy save function - replaced by staged save
// @ts-expect-error - Legacy function kept for reference  
async function _saveResults(
  allFunctions: FunctionInfo[],
  allCallEdges: CallEdge[],
  allInternalCallEdges: import('../../types').InternalCallEdge[] | undefined,
  sourceFiles: import('../../types').SourceFile[],
  storage: CliComponents['storage'],
  options: ScanCommandOptions,
  spinner: SpinnerInterface
): Promise<void> {
  spinner.start('Saving to database...');

  // Show estimated time for large datasets
  if (allFunctions.length > 5000) {
    const estimatedSeconds = Math.ceil(allFunctions.length / 200); // Rough estimate: 200 functions per second
    spinner.text = `Saving ${allFunctions.length} functions to database (estimated ${estimatedSeconds}s)...`;
  }

  const startTime = Date.now();
  const snapshotId = await storage.saveSnapshot(allFunctions, options.label, options.comment);
  
  // Update source files with snapshot ID and function counts
  const functionCountByFile = new Map<string, number>();
  allFunctions.forEach(func => {
    const count = functionCountByFile.get(func.filePath) || 0;
    functionCountByFile.set(func.filePath, count + 1);
  });
  
  // Update function counts in source files
  sourceFiles.forEach(file => {
    file.snapshotId = snapshotId;
    file.functionCount = functionCountByFile.get(file.filePath) || 0;
  });
  
  // Save source files
  if (sourceFiles.length > 0) {
    spinner.text = `Saving ${sourceFiles.length} source files to database...`;
    await storage.saveSourceFiles(sourceFiles, snapshotId);
  }
  
  // Save call edges if any were found
  if (allCallEdges.length > 0) {
    spinner.text = `Saving ${allCallEdges.length} call edges to database...`;
    await storage.insertCallEdges(allCallEdges, snapshotId);
  }

  // Save internal call edges for safe-delete functionality  
  if (allInternalCallEdges && allInternalCallEdges.length > 0) {
    spinner.text = `Saving ${allInternalCallEdges.length} internal call edges for safe-delete...`;
    
    // Update snapshotId in the internal call edges
    const edgesWithSnapshotId = allInternalCallEdges.map(edge => ({
      ...edge,
      snapshotId
    }));
    
    await storage.insertInternalCallEdges(edgesWithSnapshotId);
  } else {
    // Log info if no internal call edges were found during analysis
    console.log(chalk.gray('ℹ️  No internal call edges found during analysis. Safe-delete functionality may be limited.'));
  }
  
  const elapsed = Math.ceil((Date.now() - startTime) / 1000);

  if (allFunctions.length > 1000) {
    const functionsPerSecond = Math.round(allFunctions.length / elapsed);
    spinner.succeed(
      `Saved snapshot: ${snapshotId} (${elapsed}s, ${functionsPerSecond} functions/sec, ${sourceFiles.length} files)`
    );
  } else {
    spinner.succeed(`Saved snapshot: ${snapshotId} (${sourceFiles.length} files)`);
  }
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

async function analyzeBatch(
  files: string[],
  analyzer: CliComponents['analyzer'],
  qualityCalculator: CliComponents['qualityCalculator']
): Promise<{ functions: FunctionInfo[]; callEdges: CallEdge[] }> {
  const functions: FunctionInfo[] = [];
  const callEdges: CallEdge[] = [];

  for (const file of files) {
    try {
      // Use call graph analysis if available
      if (typeof analyzer.analyzeFileWithCallGraph === 'function') {
        const result = await analyzer.analyzeFileWithCallGraph(file);
        
        // Calculate quality metrics for each function
        for (const func of result.functions) {
          func.metrics = qualityCalculator.calculate(func);
        }
        
        functions.push(...result.functions);
        callEdges.push(...result.callEdges);
      } else {
        // Fallback to regular analysis
        const fileFunctions = await analyzer.analyzeFile(file);
        
        // Calculate quality metrics for each function
        for (const func of fileFunctions) {
          func.metrics = qualityCalculator.calculate(func);
        }
        
        functions.push(...fileFunctions);
      }
    } catch (error) {
      console.warn(
        chalk.yellow(
          `Warning: Failed to analyze ${file}: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  return { functions, callEdges };
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
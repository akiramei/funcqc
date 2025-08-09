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
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';
import { FunctionAnalyzer } from '../../core/analyzer';
import { OnePassASTVisitor } from '../../analyzers/shared/one-pass-visitor';
import { Project, SyntaxKind, TypeChecker } from 'ts-morph';
import { createHash } from 'crypto';

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

/**
 * Result of processing a single source file
 */
interface ProcessedFileResult {
  functions: FunctionInfo[];
  couplingData: ParameterPropertyUsage[];
}

/**
 * Scan command as a Reader function
 * Uses shared storage and config from environment
 */
export const scanCommand: VoidCommand<ScanCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora();

    try {
      env.commandLogger.log('🔍 Starting function analysis...');
      
      await executeScanCommand(env, options, spinner);
    } catch (error) {
      if (error instanceof DatabaseError) {
        const funcqcError = errorHandler.createError(
          error.code,
          error.message,
          {},
          error.originalError
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
  try {
    // Handle realtime gate mode
    if (options.realtimeGate) {
      await runRealtimeGateMode(env.config, options, spinner);
      return;
    }

    // Check for configuration changes and enforce comment requirement
    const configHash = await checkConfigurationChanges(env, options, spinner);

    const scanPaths = await determineScanPaths(env.config, options.scope);
    const files = await discoverFiles(scanPaths, env.config, spinner, options.scope);

    if (files.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({
          success: false,
          message: 'No TypeScript files found to analyze',
          filesAnalyzed: 0,
          functionsAnalyzed: 0,
          snapshotId: null,
          timestamp: new Date().toISOString()
        }, null, 2));
      } else {
        console.log(chalk.yellow('No TypeScript files found to analyze.'));
      }
      return;
    }

    // Step 1: Collect and store source files (fast)
    const sourceFiles = await collectSourceFiles(files, spinner);
    const { snapshotId, sourceFileIdMap } = await saveSourceFilesWithDeduplication(sourceFiles, env.storage, options, spinner, configHash);
    
    // Step 2: Perform basic analysis (configurable timing)
    const shouldPerformBasicAnalysis = !options.skipBasicAnalysis;
    let functionsAnalyzed = 0;
    if (shouldPerformBasicAnalysis) {
      const basicResult = await performBasicAnalysis(snapshotId, sourceFiles, env, spinner, sourceFileIdMap);
      functionsAnalyzed = basicResult?.functionsAnalyzed || 0;
    } else {
      if (!options.json) {
        console.log(chalk.blue('ℹ️  Basic analysis skipped. Will be performed on first use.'));
      }
    }
    
    // Step 3: Call graph analysis - perform immediately for optimal performance
    if (!options.json) {
      console.log(chalk.blue('📊 Performing call graph analysis...'));
    }
    const callGraphResult = await performCallGraphAnalysis(snapshotId, env, spinner);
    
    // Output results
    if (options.json) {
      outputScanResultsJSON({
        success: true,
        snapshotId,
        filesAnalyzed: sourceFiles.length,
        functionsAnalyzed,
        callEdges: callGraphResult?.callEdges?.length || 0,
        internalCallEdges: callGraphResult?.internalCallEdges?.length || 0,
        scope: options.scope || 'src',
        ...(options.label && { label: options.label }),
        ...(options.comment && { comment: options.comment }),
        timestamp: new Date().toISOString(),
        analysisLevel: shouldPerformBasicAnalysis ? 'CALL_GRAPH' : 'PARTIAL'
      });
    } else {
      showCompletionMessage();
    }
  } catch (error) {
    handleScanError(error, options, spinner);
  }
}

/**
 * Save source files with proper deduplication and create initial snapshot
 */
async function saveSourceFilesWithDeduplication(
  sourceFiles: import('../../types').SourceFile[],
  storage: CliComponents['storage'],
  options: ScanCommandOptions,
  spinner: SpinnerInterface,
  configHash: string
): Promise<{ snapshotId: string; sourceFileIdMap: Map<string, string> }> {
  spinner.start('Checking for existing source files...');
  
  // All files are saved as new records for each snapshot (correct behavior)
  spinner.succeed(`Processing ${sourceFiles.length} files for snapshot`);
  
  const snapshotId = await saveSourceFiles(sourceFiles, storage, options, spinner, configHash);
  
  // Get source file IDs for all files
  const sourceFileIdMap = await getSourceFileIdMapping(storage, snapshotId);
  
  return { snapshotId, sourceFileIdMap };
}

/**
 * Get source file ID mapping: filePath -> source_files.id
 */
async function getSourceFileIdMapping(
  storage: CliComponents['storage'],
  snapshotId: string
): Promise<Map<string, string>> {
  const resultMap = new Map<string, string>();
  
  // Get all source files for this snapshot
  const savedSourceFiles = await storage.getSourceFilesBySnapshot(snapshotId);
  
  // Create mapping from filePath to source_files.id
  for (const file of savedSourceFiles) {
    resultMap.set(file.filePath, file.id);
  }
  
  return resultMap;
}

/**
 * Save source files and create initial snapshot (fast operation)
 */
async function saveSourceFiles(
  sourceFiles: import('../../types').SourceFile[],
  storage: CliComponents['storage'],
  options: ScanCommandOptions,
  spinner: SpinnerInterface,
  configHash: string
): Promise<string> {
  spinner.start('Saving source files...');
  
  // Create snapshot with minimal metadata
  const createSnapshotOptions: { label?: string; comment?: string; analysisLevel?: string; scope?: string; configHash?: string } = {
    comment: options.comment || 'Source files stored (analysis pending)',
    analysisLevel: 'NONE', // Will be added to snapshot type
    scope: options.scope || 'src', // Use specified scope or default to 'src'
    configHash: configHash, // Store the current configuration hash
  };
  
  if (options.label) {
    createSnapshotOptions.label = options.label;
  }
  
  const snapshotId = await storage.createSnapshot(createSnapshotOptions);
  
  // Update source files with snapshot ID and save
  sourceFiles.forEach(file => {
    file.snapshotId = snapshotId;
  });
  
  // Only save new source files that don't already exist
  if (sourceFiles.length > 0) {
    await storage.saveSourceFiles(sourceFiles, snapshotId);
  }
  
  spinner.succeed(`Saved ${sourceFiles.length} new source files to snapshot: ${snapshotId}`);
  return snapshotId;
}

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
    // Use the storage adapter's method for storing coupling data
    await storage.storeParameterPropertyUsage(couplingData, snapshotId);

    console.log(`📊 Stored ${couplingData.length} coupling analysis records`);
  } catch (error) {
    console.warn(`Warning: Failed to store coupling analysis data: ${error}`);
  }
}

/**
 * Process a single source file and return function info with coupling analysis data
 */
async function processSingleSourceFile(
  sourceFile: import('../../types').SourceFile,
  components: Awaited<ReturnType<typeof initializeComponents>>,
  project: Project,
  typeChecker: TypeChecker,
  sourceFileIdMap?: Map<string, string>
): Promise<ProcessedFileResult> {
  // Create virtual source file for TypeScript analyzer
  const virtualFile = {
    path: sourceFile.filePath,
    content: sourceFile.fileContent,
  };
  
  // Use analyzer with content instead of file path
  const functions = await components.analyzer.analyzeContent(
    virtualFile.content,
    virtualFile.path
  );
  
  // Set source file ID and verify metrics calculation
  for (const func of functions) {
    // Metrics are pre-calculated in TypeScriptAnalyzer.create*FunctionInfo methods
    // This fallback exists for robustness and potential future analyzer implementations
    // Note: TypeScriptAnalyzer always sets metrics, so this block is currently unused
    if (!func.metrics) {
      // Legacy compatibility: fallback to separate calculation if metrics missing
      // This preserves backward compatibility and provides safety for edge cases
      func.metrics = components.qualityCalculator.calculate(func);
      
      if (process.env['NODE_ENV'] !== 'production') {
        console.warn(`⚠️  Fallback metrics calculation used for ${func.name} - analyzer may need optimization`);
      }
    }
    
    // Use sourceFileIdMap from N:1 design (must exist)
    const mappedId = sourceFileIdMap?.get(func.filePath);
    if (!mappedId) {
      throw new Error(`No source_file_ref_id found for ${func.filePath}. N:1 design mapping failed.`);
    }
    func.sourceFileId = mappedId;
  }
  
  sourceFile.functionCount = functions.length;

  // Perform coupling analysis using 1-pass AST visitor with shared Project/TypeChecker
  const couplingData = await performCouplingAnalysis(sourceFile, functions, project, typeChecker);

  return {
    functions,
    couplingData
  };
}

/**
 * Perform coupling analysis using 1-pass AST visitor with shared Project/TypeChecker
 */
async function performCouplingAnalysis(
  sourceFile: import('../../types').SourceFile,
  functions: FunctionInfo[],
  project: Project,
  typeChecker: TypeChecker
): Promise<ParameterPropertyUsage[]> {
  try {
    // Reuse shared project and add source file
    const tsSourceFile = project.createSourceFile(sourceFile.filePath, sourceFile.fileContent, { overwrite: true });

    // Execute 1-pass AST visitor
    const visitor = new OnePassASTVisitor();
    const context = visitor.scanFile(tsSourceFile, typeChecker);

    // Convert coupling data to parameter property usage format
    const couplingData: ParameterPropertyUsage[] = [];
    
    // Build mapping: visitor shortId -> persisted functionId
    const visitorIdToFunctionId = new Map<string, string>();
    
    // Find AST function nodes and recreate visitor IDs using the same logic as OnePassASTVisitor
    tsSourceFile.forEachDescendant((node) => {
      if (
        node.getKind() === SyntaxKind.FunctionDeclaration ||
        node.getKind() === SyntaxKind.MethodDeclaration ||
        node.getKind() === SyntaxKind.ArrowFunction ||
        node.getKind() === SyntaxKind.FunctionExpression ||
        node.getKind() === SyntaxKind.Constructor ||
        node.getKind() === SyntaxKind.GetAccessor ||
        node.getKind() === SyntaxKind.SetAccessor
      ) {
        // Get name using the same logic as OnePassASTVisitor
        let name = '<anonymous>';
        if (node.getKind() === SyntaxKind.Constructor) {
          name = 'constructor';
        } else if ('getName' in node && typeof node.getName === 'function') {
          name = node.getName() || '<anonymous>';
        }
        
        const startLine = node.getStartLineNumber();
        const startPos = node.getStart(); // Character offset, not line number
        
        // Recreate the same short ID as OnePassASTVisitor.getFunctionId
        const shortId = createHash('md5')
          .update(`${tsSourceFile.getFilePath()}:${startPos}:${name}`)
          .digest('hex')
          .substring(0, 16);
        
        // Find matching function from the persisted functions list
        const match = functions.find(f => 
          f.startLine === startLine && 
          (f.name || '<anonymous>') === name
        );
        
        if (match) {
          visitorIdToFunctionId.set(shortId, match.id);
        }
      }
    });

    // Extract property access data from coupling analysis
    for (const [funcId, analyses] of context.couplingData.overCoupling) {
      for (const analysis of analyses) {
        // Use the visitor ID directly to find the corresponding function ID
        const actualFuncId = visitorIdToFunctionId.get(funcId);

        if (actualFuncId) {
          for (const prop of analysis.usedProperties) {
            couplingData.push({
              functionId: actualFuncId,
              parameterName: analysis.parameterName,
              parameterTypeId: null, // Will be resolved later if needed
              accessedProperty: prop,
              accessType: 'read', // Default to read access
              accessLine: 0, // Line info would need to be extracted from AST
              accessContext: 'property_access'
            });
          }
        }
      }
    }
    return couplingData;
  } catch (error) {
    console.warn(`Warning: Coupling analysis failed for ${sourceFile.filePath}: ${error}`);
    return [];
  }
}

/**
 * Execute batch analysis and storage
 */
async function executeBatchAnalysis(
  batches: import('../../types').SourceFile[][],
  components: Awaited<ReturnType<typeof initializeComponents>>,
  snapshotId: string,
  env: CommandEnvironment,
  sourceFileIdMap?: Map<string, string>
): Promise<{ functionCount: number; errors: string[] }[]> {
  const batchPromises = batches.map(async (batch, batchIndex) => {
    const batchFunctions: FunctionInfo[] = [];
    const batchCouplingData: ParameterPropertyUsage[] = [];
    const batchErrors: string[] = [];
    
    console.log(chalk.blue(`📦 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} files)`));
    
    // Create shared Project/TypeChecker for this batch (major performance optimization)
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: 99, // Latest
        allowJs: true,
        skipLibCheck: true,
      }
    });
    const typeChecker = project.getTypeChecker();
    
    for (const sourceFile of batch) {
      try {
        const result = await processSingleSourceFile(sourceFile, components, project, typeChecker, sourceFileIdMap);
        batchFunctions.push(...result.functions);
        batchCouplingData.push(...result.couplingData);
      } catch (error) {
        const errorMessage = `Error analyzing file ${sourceFile.filePath}: ${error instanceof Error ? error.message : String(error)}`;
        batchErrors.push(errorMessage);
        console.warn(chalk.yellow(`Warning: ${errorMessage}`));
      }
    }
    
    // Immediate storage per batch to reduce peak memory usage
    if (batchFunctions.length > 0) {
      await env.storage.storeFunctions(batchFunctions, snapshotId);
      
      // Store coupling analysis data
      if (batchCouplingData.length > 0) {
        await storeParameterPropertyUsage(env.storage, batchCouplingData, snapshotId);
      }
      
      // Update function counts for files in this batch
      const batchFunctionCounts = new Map<string, number>();
      batchFunctions.forEach(func => {
        const count = batchFunctionCounts.get(func.filePath) || 0;
        batchFunctionCounts.set(func.filePath, count + 1);
      });
      
      if (batchFunctionCounts.size > 0) {
        await env.storage.updateSourceFileFunctionCounts(batchFunctionCounts, snapshotId);
      }
    }
    
    if (batchErrors.length > 0) {
      console.log(chalk.yellow(`⚠️  Batch ${batchIndex + 1} completed with ${batchErrors.length} errors`));
    } else {
      console.log(chalk.green(`✅ Batch ${batchIndex + 1} completed successfully (${batchFunctions.length} functions)`));
    }
    
    // Force garbage collection after each batch if available
    if (global.gc) {
      global.gc();
    }
    
    return { functionCount: batchFunctions.length, errors: batchErrors };
  });
  
  return Promise.all(batchPromises);
}

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
    
    // Execute batch analysis
    const batchResults = await executeBatchAnalysis(batches, components, snapshotId, env, sourceFileIdMap);
    
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
 * Perform call graph analysis on stored files (called by dep/dead/clean commands)
 */
export async function performCallGraphAnalysis(
  snapshotId: string,
  env: CommandEnvironment,
  spinner?: SpinnerInterface
): Promise<{ callEdges: CallEdge[]; internalCallEdges: import('../../types').InternalCallEdge[] }> {
  const showSpinner = spinner !== undefined;
  if (showSpinner) {
    spinner.start('Performing call graph analysis...');
  }
  
  // Get stored files and functions
  const sourceFiles = await env.storage.getSourceFilesBySnapshot(snapshotId);
  const functions = await env.storage.findFunctionsInSnapshot(snapshotId);
  
  // Reconstruct file map for analyzer (include all files for proper type resolution)
  const fileContentMap = new Map<string, string>();
  sourceFiles.forEach(file => {
    fileContentMap.set(file.filePath, file.fileContent);
  });
  
  // Use FunctionAnalyzer with stored content
  const functionAnalyzer = new FunctionAnalyzer(env.config, { logger: env.commandLogger });
  
  try {
    // Analyze call graph from stored content
    const result = await functionAnalyzer.analyzeCallGraphFromContent(fileContentMap, functions, snapshotId, env.storage);
    
    // Save call edges
    await env.storage.insertCallEdges(result.callEdges, snapshotId);
    
    // Update snapshotId for internal call edges and save
    const internalCallEdgesWithSnapshotId = result.internalCallEdges.map(edge => ({
      ...edge,
      snapshotId: snapshotId
    }));
    await env.storage.insertInternalCallEdges(internalCallEdgesWithSnapshotId);
    await env.storage.updateAnalysisLevel(snapshotId, 'CALL_GRAPH');
    
    if (showSpinner) {
      spinner!.succeed(`Call graph analysis completed: ${result.callEdges.length} edges found`);
    }
    
    return result;
    
  } finally {
    functionAnalyzer.dispose();
  }
}

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
  allFunctions: FunctionInfo[]
): Promise<void> {
  try {
    const functions = await analyzer.analyzeFile(filePath);
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
  console.log(chalk.blue('💡 Tips:'));
  console.log(chalk.gray('  • Use `funcqc db` to ensure complete analysis for AI collaboration'));
  console.log(chalk.gray('  • Set NODE_OPTIONS="--max-old-space-size=4096" for very large projects'));
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
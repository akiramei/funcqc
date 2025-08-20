import { MeasureCommandOptions, ScanCommandOptions, SnapshotInfo } from '../../types';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { createErrorHandler, ErrorCode, DatabaseErrorLike } from '../../utils/error-handler';
import chalk from 'chalk';
import { formatRelativeDate, formatDiffValue, formatSizeDisplay } from './history';

/**
 * Measure command - unified scan and analyze functionality
 * Consolidates scan + analyze into a single measurement workflow
 */
export const measureCommand: VoidCommand<MeasureCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      // Handle history display mode
      if (options.history) {
        await displaySnapshotHistory(env, options);
        return;
      }

      if (!options.quiet) {
        env.commandLogger.info('📊 Starting comprehensive measurement...');
      }

      // Determine measurement level and scope
      const measurementPlan = determineMeasurementPlan(options);
      
      if (!options.quiet) {
        env.commandLogger.info(`🎯 Measurement plan: ${measurementPlan.description}`);
        env.commandLogger.info(`📈 Estimated time: ${measurementPlan.estimatedTime}`);
      }

      // Execute measurement workflow
      await executeMeasurementWorkflow(env, options, measurementPlan);

      if (!options.quiet) {
        env.commandLogger.info('✅ Comprehensive measurement completed successfully!');
      }
      if (options.json) {
        await outputMeasurementResults(env, options);
      } else if (!options.quiet) {
        await displayMeasurementSummary(env, options);
      }

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
          `Failed to execute measurement: ${error instanceof Error ? error.message : String(error)}`,
          { options },
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Measurement plan configuration
 */
interface MeasurementPlan {
  level: string;
  description: string;
  estimatedTime: string;
  includesScan: boolean;
  includesCallGraph: boolean;
  includesTypes: boolean;
  includesCoupling: boolean;
  scanOptions: Partial<ScanCommandOptions>; // Options to pass to scan command
  analyzeOptions: { // Options to pass to analyze command
    callGraph?: boolean;
    types?: boolean;
    all?: boolean;
  };
}

/**
 * Determine measurement plan based on options with performance optimization
 */
function determineMeasurementPlan(options: MeasureCommandOptions): MeasurementPlan {
  // Handle level-based configuration
  if (options.level) {
    switch (options.level) {
      case 'quick':
        return {
          level: 'quick',
          description: 'Quick measurement (existing snapshot reuse)',
          estimatedTime: '1-2s',
          includesScan: true, // Allow scan when snapshot is old or missing
          includesCallGraph: false,
          includesTypes: false,
          includesCoupling: false,
          scanOptions: { quick: true },
          analyzeOptions: {}
        };
      
      case 'basic':
        return {
          level: 'basic',
          description: 'Basic measurement (light analysis)',
          estimatedTime: '2-5s',
          includesScan: true, // Allow scan when snapshot is old or missing
          includesCallGraph: false,
          includesTypes: false,
          includesCoupling: false,
          scanOptions: { withBasic: true },
          analyzeOptions: {}
        };
      
      case 'standard':
        return {
          level: 'standard',
          description: 'Standard measurement (with call graph)',
          estimatedTime: '30-40s',
          includesScan: true,
          includesCallGraph: true,
          includesTypes: false,
          includesCoupling: false,
          scanOptions: { withGraph: true },
          analyzeOptions: { callGraph: true }
        };
      
      case 'deep':
        return {
          level: 'deep',
          description: 'Deep measurement (with types and coupling)',
          estimatedTime: '40-50s',
          includesScan: true,
          includesCallGraph: true,
          includesTypes: true,
          includesCoupling: true,
          scanOptions: { withTypes: true, withCoupling: true },
          analyzeOptions: { callGraph: true, types: true }
        };
      
      case 'complete':
        return {
          level: 'complete',
          description: 'Complete measurement (all analyses)',
          estimatedTime: '50-60s',
          includesScan: true,
          includesCallGraph: true,
          includesTypes: true,
          includesCoupling: true,
          scanOptions: { full: true },
          analyzeOptions: { all: true }
        };
    }
  }

  // Handle legacy option combinations
  if (options.full) {
    // 無限再帰を防ぐためにlegacyオプションを削除
    const { full: _, ...cleanOptions } = options;
    return determineMeasurementPlan({ ...cleanOptions, level: 'complete' });
  }

  if (options.withBasic) {
    const { withBasic: _, ...cleanOptions } = options;
    return determineMeasurementPlan({ ...cleanOptions, level: 'basic' });
  }

  // Build custom plan based on specific options with performance optimization
  const includesCallGraph = !!(options.callGraph || options.withGraph);
  const includesTypes = !!(options.types || options.withTypes);
  const includesCoupling = !!(options.coupling || options.withCoupling);

  // Performance optimization: Default to lightweight mode
  let estimatedTime = '2-5s';
  let description = 'Custom measurement (optimized)';
  let needsScan = false;
  
  if (includesCallGraph && includesTypes && includesCoupling) {
    estimatedTime = '50-60s';
    description = 'Complete custom measurement';
    needsScan = true;
  } else if (includesCallGraph || includesTypes || includesCoupling) {
    // CRITICAL FIX: Coupling analysis also requires scan, not just callGraph/types
    if (includesCoupling && !includesCallGraph && !includesTypes) {
      estimatedTime = '15-25s';
      description = 'Coupling analysis measurement';
    } else {
      estimatedTime = '30-40s';
      description = 'Extended custom measurement';
    }
    needsScan = true;
  }

  return {
    level: 'custom',
    description,
    estimatedTime,
    includesScan: needsScan, // Performance: Only scan when heavy analysis is requested
    includesCallGraph,
    includesTypes,
    includesCoupling,
    scanOptions: {
      withBasic: !needsScan, // Light mode if no scan needed
      withGraph: includesCallGraph,
      withTypes: includesTypes,
      withCoupling: includesCoupling
    },
    analyzeOptions: {
      callGraph: includesCallGraph,
      types: includesTypes
    }
  };
}

/**
 * Execute the complete measurement workflow with intelligent snapshot reuse
 */
async function executeMeasurementWorkflow(
  env: CommandEnvironment,
  options: MeasureCommandOptions,
  plan: MeasurementPlan
): Promise<void> {
  // Phase 0: Check existing snapshot and determine if new scan is needed
  const existingSnapshot = await checkExistingSnapshot(env, options);
  const needsNewScan = await determineScanNecessity(existingSnapshot, plan);

  if (!options.quiet) {
    env.commandLogger.info(`🔍 Scan necessity check: needsNewScan=${needsNewScan}, existingLevel=${existingSnapshot?.analysisLevel || 'none'}`);
  }

  // Phase 1: Scan (only if needed or forced)  
  if (options.force || needsNewScan) {
    if (!options.quiet) {
      env.commandLogger.info('📦 Phase 1: Function scanning...');
      if (!needsNewScan) {
        env.commandLogger.info('   🔄 Force scan requested, creating new snapshot');
      }
    }
    
    // Execute integrated scan functionality
    await executeScanPhase(env, options, plan);
  } else if (existingSnapshot && !options.quiet) {
    env.commandLogger.info('📦 Phase 1: Using existing snapshot (performance optimized)');
    env.commandLogger.info(`   📅 Snapshot: ${existingSnapshot.id.slice(0, 8)} (${new Date(existingSnapshot.createdAt).toLocaleString()})`);
    env.commandLogger.info(`   📊 Analysis level: ${existingSnapshot.analysisLevel}`);
  }

  // Phase 2: Additional analyses (only if specifically requested)
  if (plan.includesCallGraph || plan.includesTypes || plan.includesCoupling) {
    if (!options.quiet) {
      env.commandLogger.info('🔄 Phase 2: Advanced analysis (on-demand)...');
    }
    
    // Execute lazy analyze functionality
    await executeLazyAnalyzePhase(env, options, plan);
  }
  
  // Note: Coupling analysis can be executed in either scan phase or analyze phase
  // depending on when analysis is needed and snapshot availability
}

/**
 * Execute scan functionality (integrated from scan command)
 */
async function executeScanPhase(
  env: CommandEnvironment,
  options: MeasureCommandOptions,
  plan: MeasurementPlan
): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info(`   📊 Scanning functions (${plan.level} level)...`);
  }
  
  // Convert measure options to scan options
  const scanOptions: ScanCommandOptions = {
    json: false, // Internal execution, no JSON output
    verbose: options.verbose || false,
    quiet: options.quiet || false,
    ...plan.scanOptions // Apply level-specific options
  };
  
  if (options.force !== undefined) {
    scanOptions.force = options.force;
  }
  
  // Only add defined optional properties
  if (options.label !== undefined) scanOptions.label = options.label;
  if (options.comment !== undefined) scanOptions.comment = options.comment;
  if (options.scope !== undefined) scanOptions.scope = options.scope;
  if (options.realtimeGate !== undefined) scanOptions.realtimeGate = options.realtimeGate;
  
  try {
    // Import and execute scan command functionality
    const { scanCommand } = await import('./scan');
    await scanCommand(scanOptions)(env);
    
    if (options.verbose) {
      env.commandLogger.info('   ✅ Function scanning completed');
    }
  } catch (error) {
    throw new Error(`Scan phase failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Check for existing snapshot and return latest if available
 */
async function checkExistingSnapshot(
  env: CommandEnvironment,
  _options: MeasureCommandOptions
): Promise<{ id: string; createdAt: string; analysisLevel: string } | null> {
  try {
    const snapshots = await env.storage.getSnapshots({ limit: 1 });
    if (snapshots.length === 0) return null;
    
    const snapshot = snapshots[0];
    const metadata = snapshot.metadata as Record<string, unknown>;
    const analysisLevel = (metadata['analysisLevel'] as string) || 'NONE';
    
    return {
      id: snapshot.id,
      createdAt: new Date(snapshot.createdAt).toISOString(),
      analysisLevel
    };
  } catch {
    return null;
  }
}

/**
 * Determine if a new scan is necessary based on existing snapshot and plan
 */
async function determineScanNecessity(
  existingSnapshot: { id: string; createdAt: string; analysisLevel: string } | null,
  plan: MeasurementPlan
): Promise<boolean> {
  // No existing snapshot - scan needed
  if (!existingSnapshot) {
    return true;
  }

  const currentLevel = existingSnapshot.analysisLevel;
  
  // Define analysis level hierarchy
  const levelHierarchy: Record<string, number> = {
    'NONE': 0,
    'BASIC': 1,
    'COUPLING': 2,
    'CALL_GRAPH': 3,
    'TYPE_SYSTEM': 4,
    'COMPLETE': 5
  };
  
  // Determine required level based on plan
  let requiredLevel = 'BASIC';
  if (plan.includesCallGraph && plan.includesTypes && plan.includesCoupling) {
    requiredLevel = 'COMPLETE';
  } else if (plan.includesTypes) {
    requiredLevel = 'TYPE_SYSTEM';
  } else if (plan.includesCallGraph) {
    requiredLevel = 'CALL_GRAPH';
  } else if (plan.includesCoupling) {
    requiredLevel = 'COUPLING';
  }
  
  const currentLevelNum = levelHierarchy[currentLevel] || 0;
  const requiredLevelNum = levelHierarchy[requiredLevel] || 0;
  
  // If current level meets or exceeds required level, no new scan needed
  if (currentLevelNum >= requiredLevelNum) {
    return false;
  }
  
  // Check snapshot age for time-based invalidation
  const snapshotAge = Date.now() - new Date(existingSnapshot.createdAt).getTime();
  const maxAge = 24 * 60 * 60 * 1000; // 1 day
  
  if (snapshotAge > maxAge) {
    return true;
  }
  
  // Need new scan if analysis level is insufficient
  return true;
}

/**
 * Execute lazy analyze functionality (only when explicitly requested)
 */
async function executeLazyAnalyzePhase(
  env: CommandEnvironment,
  options: MeasureCommandOptions,
  plan: MeasurementPlan
): Promise<void> {
  const analyses = [];
  if (plan.includesCallGraph) analyses.push('call graph');
  if (plan.includesTypes) analyses.push('type system');
  if (plan.includesCoupling) analyses.push('coupling');

  if (!options.quiet) {
    env.commandLogger.info(`   🔍 Running ${analyses.join(', ')} analysis (lazy execution)...`);
  }
  
  // Convert measure options to analyze options
  const analyzeOptions = {
    callGraph: plan.includesCallGraph,
    types: plan.includesTypes,
    // Enable coupling analysis if requested (may be skipped if already completed in scan phase)
    coupling: plan.includesCoupling,
    all: plan.includesCallGraph && plan.includesTypes,
    json: false, // Internal execution, no JSON output
    verbose: options.verbose || false,
    quiet: options.quiet || false
  };
  
  try {
    // Import and execute analyze command functionality
    const { analyzeCommand } = await import('./analyze');
    await analyzeCommand(analyzeOptions)(env);
    
    if (options.verbose) {
      env.commandLogger.info(`   ✅ ${analyses.join(', ')} analysis completed`);
    }
  } catch (error) {
    throw new Error(`Analysis phase failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Output measurement results in JSON format
 */
async function outputMeasurementResults(
  _env: CommandEnvironment,
  options: MeasureCommandOptions
): Promise<void> {
  // TODO: Implement comprehensive JSON output
  // This should include:
  // - Snapshot information
  // - Function metrics
  // - Analysis results
  // - Quality metrics

  const results = {
    measurement: {
      timestamp: new Date().toISOString(),
      level: options.level || 'custom',
      scope: options.scope || 'all'
    },
    // TODO: Add real measurement data
    placeholder: 'Full JSON output to be implemented with real data'
  };

  console.log(JSON.stringify(results, null, 2));
}

/**
 * Display measurement summary in human-readable format
 */
async function displayMeasurementSummary(
  _env: CommandEnvironment,
  options: MeasureCommandOptions
): Promise<void> {
  console.log();
  console.log('📊 Measurement Summary');
  console.log('--------------------------------------------------');
  console.log(`🎯 Level: ${options.level || 'custom'}`);
  console.log(`📦 Scope: ${options.scope || 'all'}`);
  console.log();
  
  // TODO: Add real measurement statistics
  console.log('📈 Results:');
  console.log('   • Functions analyzed: [to be implemented]');
  console.log('   • Quality metrics: [to be implemented]');
  console.log('   • Analysis time: [to be implemented]');
  console.log();
  
  console.log('💡 Next steps:');
  console.log('   • Run `funcqc inspect` to explore results');
  console.log('   • Run `funcqc assess` for quality analysis');
  console.log('   • Run `funcqc inspect --cc-ge 10` for complex functions');
}

/**
 * Display snapshot history (integrated from history command)
 */
async function displaySnapshotHistory(
  env: CommandEnvironment,
  options: MeasureCommandOptions
): Promise<void> {
  const limit = 20; // Default limit
  
  const snapshots = await env.storage.getSnapshots({ limit });
  
  if (snapshots.length === 0) {
    console.log('📈 No snapshots found. Run `funcqc measure` to create your first snapshot.');
    return;
  }

  if (options.json) {
    displaySnapshotHistoryJSON(snapshots);
    return;
  }

  console.log(chalk.cyan.bold(`\n📈 Snapshot History (${snapshots.length} snapshots)\n`));
  displayCompactHistory(snapshots);
}

/**
 * Display snapshot history in JSON format
 */
function displaySnapshotHistoryJSON(snapshots: SnapshotInfo[]): void {
  const output = {
    snapshots: snapshots.map(snapshot => ({
      id: snapshot.id,
      label: snapshot.label || null,
      comment: snapshot.comment || null,     
      scope: snapshot.scope || 'src',
      createdAt: new Date(snapshot.createdAt).toISOString(),
      gitBranch: snapshot.gitBranch || null,
      gitCommit: snapshot.gitCommit || null,
      metadata: {
        totalFunctions: snapshot.metadata.totalFunctions,
        totalFiles: snapshot.metadata.totalFiles,
        avgComplexity: snapshot.metadata.avgComplexity,
        maxComplexity: snapshot.metadata.maxComplexity
      }
    })),
    summary: {
      totalSnapshots: snapshots.length
    }
  };

  console.log(JSON.stringify(output, null, 2));
}

/**
 * Display compact history table
 */
function displayCompactHistory(snapshots: SnapshotInfo[]): void {
  // Display header with fixed-width columns
  console.log(
    'ID       Created       Scope Label               Functions +/-      Files +/-    Size'
  );
  console.log(
    '-------- ------------- ----- ------------------- --------- -------- ----- ------ ----------'
  );

  // Display each snapshot
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    const prevSnapshot = findPreviousSnapshotWithSameScope(snapshots, i);

    const id = formatSnapshotIdForDisplay(snapshot.id);
    const created = formatRelativeDate(snapshot.createdAt).padEnd(13);
    const scope = (snapshot.scope || 'src').padEnd(5);
    const label = truncateWithEllipsis(snapshot.label || '', 19).padEnd(19);

    // Functions with diff (only compare with same scope)
    const currentFunctions = snapshot.metadata.totalFunctions ?? 0;
    const prevFunctions = prevSnapshot?.metadata.totalFunctions ?? 0;
    const functionDiff = prevSnapshot ? currentFunctions - prevFunctions : 0;
    const functionsDisplay = currentFunctions.toString().padStart(9);
    const functionsDiffDisplay = formatDiffValue(functionDiff, 8);

    // Files count (only compare with same scope)
    const currentFiles = snapshot.metadata.totalFiles ?? 0;
    const prevFiles = prevSnapshot?.metadata.totalFiles ?? 0;
    const filesDiff = prevSnapshot ? currentFiles - prevFiles : 0;
    const filesDisplay = currentFiles.toString().padStart(5);
    const filesDiffDisplay = formatDiffValue(filesDiff, 6);

    // Size estimation (rough LOC calculation)
    const sizeDisplay = formatSizeDisplay(snapshot.metadata);

    console.log(
      `${id} ${created} ${scope} ${label} ${functionsDisplay} ${functionsDiffDisplay} ${filesDisplay} ${filesDiffDisplay} ${sizeDisplay}`
    );
  }
}

/**
 * Display a shortened version of snapshot ID for table display
 */
function formatSnapshotIdForDisplay(id: string): string {
  return id.substring(0, 8);
}

/**
 * Truncate string with ellipsis if it exceeds max length
 */
function truncateWithEllipsis(str: string, maxLength: number): string {
  if (!str || str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Find the previous snapshot with the same scope
 */
function findPreviousSnapshotWithSameScope(snapshots: SnapshotInfo[], currentIndex: number): SnapshotInfo | null {
  const currentSnapshot = snapshots[currentIndex];
  const currentScope = currentSnapshot.scope || 'src';
  
  // Look for the next snapshot (older) with the same scope
  for (let i = currentIndex + 1; i < snapshots.length; i++) {
    const candidateSnapshot = snapshots[i];
    const candidateScope = candidateSnapshot.scope || 'src';
    
    if (candidateScope === currentScope) {
      return candidateSnapshot;
    }
  }
  
  return null;
}
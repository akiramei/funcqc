import chalk from 'chalk';
import ora from 'ora';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { createErrorHandler } from '../../utils/error-handler';
import { ReachabilityAnalyzer } from '../../analyzers/reachability-analyzer';
import { EnhancedCycleAnalyzer } from '../../analyzers/enhanced-cycle-analyzer';
import { DotGenerator } from '../../visualization/dot-generator';
import { DepCyclesOptions, ClassifiedCycle, ImportanceLevel, CyclesAnalysisResult } from './types';

/**
 * Default options for enhanced cycle detection
 */
const DEFAULT_CYCLE_OPTIONS = {
  excludeRecursive: true,
  excludeClear: true,
  minComplexity: 4,
  sortByImportance: true,
  limit: 20
};

/**
 * Detect circular dependencies in the call graph with enhanced classification
 */
export const depCyclesCommand: VoidCommand<DepCyclesOptions> = (options) =>
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora('Analyzing circular dependencies...').start();

    try {
      // Get the latest snapshot
      const snapshot = await env.storage.getLatestSnapshot();
      if (!snapshot) {
        spinner.fail(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
        return;
      }

      spinner.text = 'Loading call graph...';

      // Get call edges
      const callEdges = await env.storage.getCallEdgesBySnapshot(snapshot.id);

      if (callEdges.length === 0) {
        spinner.fail(chalk.yellow('No call graph data found. Run `funcqc scan` first.'));
        return;
      }

      spinner.text = 'Loading function information...';
      
      // Get function information for better display
      const functions = await env.storage.findFunctionsInSnapshot(snapshot.id);
      const functionMap = new Map(functions.map(f => [f.id, f]));

      spinner.text = 'Detecting and classifying circular dependencies...';

      // Use enhanced analyzer or fallback to legacy
      const useEnhanced = !options.includeAll && !isLegacyMode(options);
      
      if (useEnhanced) {
        const enhancedAnalyzer = new EnhancedCycleAnalyzer();
        const analysisOptions = buildAnalysisOptions(options);
        const result = enhancedAnalyzer.analyzeClassifiedCycles(callEdges, functions, analysisOptions);
        
        // Apply limit
        let displayCycles = result.classifiedCycles;
        if (options.limit) {
          const limit = parseInt(options.limit, 10);
          if (!isNaN(limit) && limit > 0) {
            displayCycles = displayCycles.slice(0, limit);
          }
        }
        
        const totalFound = result.totalCycles;
        const displayCount = displayCycles.length;
        
        spinner.succeed(`Found ${totalFound} cycles, displaying ${displayCount} after filtering`);

        // Output enhanced results
        if (options.format === 'json') {
          outputEnhancedCyclesJSON(result, displayCycles, options);
        } else if (options.format === 'dot') {
          outputCyclesDot(displayCycles.map(c => c.nodes), functions, callEdges);
        } else {
          outputEnhancedCyclesTable(result, displayCycles, functionMap, options);
        }
      } else {
        // Legacy mode for backward compatibility
        const reachabilityAnalyzer = new ReachabilityAnalyzer();
        const cycles = reachabilityAnalyzer.findCircularDependencies(callEdges);
        
        // Apply legacy filters
        let filteredCycles = cycles;
        if (options.minSize) {
          const minSize = parseInt(options.minSize, 10);
          if (!isNaN(minSize) && minSize > 0) {
            filteredCycles = cycles.filter(cycle => cycle.length >= minSize);
          }
        }
        
        if (options.limit) {
          const limit = parseInt(options.limit, 10);
          if (!isNaN(limit) && limit > 0) {
            filteredCycles = filteredCycles.slice(0, limit);
          }
        }
        
        spinner.succeed(`Found ${cycles.length} circular dependencies`);
        
        // Output legacy results
        if (options.format === 'json') {
          outputCyclesJSON(filteredCycles, functionMap, cycles.length, options);
        } else if (options.format === 'dot') {
          outputCyclesDot(filteredCycles, functions, callEdges);
        } else {
          outputCyclesTable(filteredCycles, functionMap, cycles.length, options);
        }
      }
    } catch (error) {
      spinner.fail('Failed to analyze circular dependencies');
      errorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  };

/**
 * Check if legacy mode should be used
 */
function isLegacyMode(options: DepCyclesOptions): boolean {
  return options.includeAll === true || 
         options.includeRecursive === true ||
         (options.excludeRecursive === false && options.includeAll !== false);
}

/**
 * Build analysis options from CLI options
 */
function buildAnalysisOptions(options: DepCyclesOptions): {
  excludeRecursive?: boolean;
  excludeClear?: boolean;
  minComplexity?: number;
  crossModuleOnly?: boolean;
  crossLayerOnly?: boolean;
  recursiveOnly?: boolean;
} {
  // When recursiveOnly is true, we need to override defaults to include recursive functions
  const excludeRecursive = options.recursiveOnly ? false : 
    (options.excludeRecursive ?? DEFAULT_CYCLE_OPTIONS.excludeRecursive);
  
  const result: {
    excludeRecursive?: boolean;
    excludeClear?: boolean;
    minComplexity?: number;
    crossModuleOnly?: boolean;
    crossLayerOnly?: boolean;
    recursiveOnly?: boolean;
  } = {
    excludeRecursive,
    excludeClear: options.excludeClear ?? DEFAULT_CYCLE_OPTIONS.excludeClear,
    minComplexity: options.minComplexity ? parseInt(options.minComplexity, 10) : DEFAULT_CYCLE_OPTIONS.minComplexity,
  };

  if (options.crossModuleOnly !== undefined) {
    result.crossModuleOnly = options.crossModuleOnly;
  }
  if (options.crossLayerOnly !== undefined) {
    result.crossLayerOnly = options.crossLayerOnly;
  }
  if (options.recursiveOnly !== undefined) {
    result.recursiveOnly = options.recursiveOnly;
  }

  return result;
}

/**
 * Get importance color for display
 */ 
function getImportanceColor(importance: ImportanceLevel): (text: string) => string {
  switch (importance) {
    case ImportanceLevel.CRITICAL: return chalk.red.bold;
    case ImportanceLevel.HIGH: return chalk.yellow.bold;
    case ImportanceLevel.MEDIUM: return chalk.blue;
    case ImportanceLevel.LOW: return chalk.gray;
    default: return chalk.white;
  }
}

/**
 * Get importance icon
 */
function getImportanceIcon(importance: ImportanceLevel): string {
  switch (importance) {
    case ImportanceLevel.CRITICAL: return '🚨';
    case ImportanceLevel.HIGH: return '🔶';
    case ImportanceLevel.MEDIUM: return '🔷';
    case ImportanceLevel.LOW: return '💡';
    default: return '⚪';
  }
}

/**
 * Output enhanced cycles as formatted table
 */
function outputEnhancedCyclesTable(
  result: CyclesAnalysisResult,
  displayCycles: ClassifiedCycle[],
  functionMap: Map<string, import('../../types').FunctionInfo>,
  _options: DepCyclesOptions
): void {
  console.log(chalk.bold('\n🔄 Enhanced Circular Dependencies Analysis\n'));
  
  // Summary statistics
  console.log(`Total cycles found: ${chalk.cyan(result.totalCycles)}`);
  console.log(`Displayed after filtering: ${chalk.yellow(displayCycles.length)}\n`);
  
  // Importance summary
  if (result.importanceSummary.critical > 0 || result.importanceSummary.high > 0) {
    console.log(chalk.bold('📊 Importance Summary:'));
    if (result.importanceSummary.critical > 0) {
      console.log(`  🚨 Critical (Cross-Layer): ${chalk.red.bold(result.importanceSummary.critical)}`);
    }
    if (result.importanceSummary.high > 0) {
      console.log(`  🔶 High (Cross-Module): ${chalk.yellow.bold(result.importanceSummary.high)}`);
    }
    if (result.importanceSummary.medium > 0) {
      console.log(`  🔷 Medium (Cross-File): ${chalk.blue(result.importanceSummary.medium)}`);
    }
    if (result.importanceSummary.low > 0) {
      console.log(`  💡 Low (Same File): ${chalk.gray(result.importanceSummary.low)}`);
    }
    console.log();
  }

  if (displayCycles.length === 0) {
    console.log(chalk.green('✅ No problematic circular dependencies found!'));
    
    // Show what was filtered out
    if (result.filterStats.excludedRecursive > 0 || result.filterStats.excludedClear > 0) {
      console.log(chalk.dim('\n💡 Filtered out:'));
      if (result.filterStats.excludedRecursive > 0) {
        console.log(chalk.dim(`   ${result.filterStats.excludedRecursive} recursive functions`));
      }
      if (result.filterStats.excludedClear > 0) {
        console.log(chalk.dim(`   ${result.filterStats.excludedClear} clear chains`));
      }
      console.log(chalk.dim('   Use --include-all to see all cycles'));
    }
    
    return;
  }

  // Group by importance
  const groupedByImportance = new Map<ImportanceLevel, ClassifiedCycle[]>();
  for (const cycle of displayCycles) {
    const existing = groupedByImportance.get(cycle.importance) || [];
    existing.push(cycle);
    groupedByImportance.set(cycle.importance, existing);
  }

  // Display cycles by importance
  const importanceOrder = [ImportanceLevel.CRITICAL, ImportanceLevel.HIGH, ImportanceLevel.MEDIUM, ImportanceLevel.LOW];
  
  for (const importance of importanceOrder) {
    const cycles = groupedByImportance.get(importance);
    if (!cycles || cycles.length === 0) continue;
    
    const colorFn = getImportanceColor(importance);
    const icon = getImportanceIcon(importance);
    
    console.log(colorFn(`${icon} ${importance.toUpperCase()} PRIORITY:`));
    
    cycles.forEach((cycle, index) => {
      const prefix = index === cycles.length - 1 ? '└──' : '├──';
      console.log(`${prefix} ${colorFn(`${cycle.type} cycle`)} (score: ${cycle.score}/10, ${cycle.nodes.length} functions)`);
      
      // Show function chain
      cycle.nodes.forEach((funcId, funcIndex) => {
        const func = functionMap.get(funcId);
        const isLast = funcIndex === cycle.nodes.length - 1;
        const connector = isLast ? '    └──→' : '    ├──→';
        const functionName = func?.name || 'unknown';
        const location = func ? `${func.filePath}:${func.startLine}` : 'unknown';
        
        console.log(`${connector} ${chalk.cyan(functionName)} ${chalk.gray(`(${location})`)}`);
      });
      
      // Show cycle completion
      const firstFunc = functionMap.get(cycle.nodes[0]);
      const firstFunctionName = firstFunc?.name || 'unknown';
      console.log(`         └──→ ${chalk.dim(firstFunctionName)} ${chalk.gray('(cycle complete)')}`);
      
      // Show recommendations
      if (cycle.recommendations.length > 0) {
        console.log(chalk.dim('    💡 Recommendations:'));
        cycle.recommendations.forEach(rec => {
          console.log(chalk.dim(`       • ${rec}`));
        });
      }
      
      console.log();
    });
  }
  
  // Show filter summary
  if (result.filterStats.excludedRecursive > 0 || result.filterStats.excludedClear > 0) {
    console.log(chalk.dim('💡 Filtered out:'));
    if (result.filterStats.excludedRecursive > 0) {
      console.log(chalk.dim(`   ${result.filterStats.excludedRecursive} recursive functions`));
    }
    if (result.filterStats.excludedClear > 0) {
      console.log(chalk.dim(`   ${result.filterStats.excludedClear} clear chains`));
    }
    console.log(chalk.dim('   Use --include-all to see all cycles'));
  }
}

/**
 * Output enhanced cycles as JSON
 */
function outputEnhancedCyclesJSON(
  result: CyclesAnalysisResult,
  displayCycles: ClassifiedCycle[],
  options: DepCyclesOptions
): void {
  const output = {
    summary: {
      totalCycles: result.totalCycles,
      displayedCycles: displayCycles.length,
      filters: {
        excludeRecursive: options.excludeRecursive ?? DEFAULT_CYCLE_OPTIONS.excludeRecursive,
        excludeClear: options.excludeClear ?? DEFAULT_CYCLE_OPTIONS.excludeClear,
        minComplexity: options.minComplexity || DEFAULT_CYCLE_OPTIONS.minComplexity,
        limit: options.limit,
      },
      filterStats: result.filterStats,
      importanceSummary: result.importanceSummary
    },
    cycles: displayCycles.map((cycle, index) => ({
      id: index + 1,
      cycleId: cycle.id,
      type: cycle.type,
      importance: cycle.importance,
      score: cycle.score,
      size: cycle.nodes.length,
      crossBoundaries: {
        crossFile: cycle.crossFile,
        crossModule: cycle.crossModule,
        crossLayer: cycle.crossLayer,
        fileCount: cycle.fileCount,
        moduleCount: cycle.moduleCount,
        layerCount: cycle.layerCount
      },
      complexity: {
        total: cycle.cyclomaticComplexity,
        average: cycle.averageComplexity
      },
      functions: cycle.nodes,
      recommendations: cycle.recommendations
    }))
  };

  console.log(JSON.stringify(output, null, 2));
}

/**
 * Output cycles as JSON (legacy)
 */
function outputCyclesJSON(
  cycles: string[][],
  functionMap: Map<string, import('../../types').FunctionInfo>,
  totalCycles: number,
  options: DepCyclesOptions
): void {
  const result = {
    summary: {
      totalCycles,
      displayedCycles: cycles.length,
      filters: {
        minSize: options.minSize,
        limit: options.limit,
      },
    },
    cycles: cycles.map((cycle, index) => ({
      id: index + 1,
      length: cycle.length,
      functions: cycle.map(funcId => {
        const func = functionMap.get(funcId);
        return {
          id: funcId,
          name: func?.name || 'unknown',
          filePath: func?.filePath || 'unknown',
          startLine: func?.startLine || 0,
        };
      }),
    })),
  };

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Output cycles as formatted table (legacy)
 */
function outputCyclesTable(
  cycles: string[][],
  functionMap: Map<string, import('../../types').FunctionInfo>,
  totalCycles: number,
  _options: DepCyclesOptions
): void {
  console.log(chalk.bold('\n🔄 Circular Dependencies Analysis (Legacy Mode)\n'));
  console.log(`Total cycles found: ${chalk.cyan(totalCycles)}`);
  console.log(`Displayed cycles: ${chalk.yellow(cycles.length)}\n`);

  if (cycles.length === 0) {
    console.log(chalk.green('✅ No circular dependencies found!'));
    return;
  }

  cycles.forEach((cycle, index) => {
    console.log(chalk.bold(`Cycle ${index + 1} (${cycle.length} functions):`));
    
    cycle.forEach((funcId, funcIndex) => {
      const func = functionMap.get(funcId);
      const isLast = funcIndex === cycle.length - 1;
      const connector = isLast ? '└──→' : '├──→';
      const functionName = func?.name || 'unknown';
      const location = func ? `${func.filePath}:${func.startLine}` : 'unknown';
      
      console.log(`  ${connector} ${chalk.cyan(functionName)} ${chalk.gray(`(${location})`)}`);
    });
    
    // Show completion of cycle
    const firstFunc = functionMap.get(cycle[0]);
    const firstFunctionName = firstFunc?.name || 'unknown';
    console.log(`      └──→ ${chalk.dim(firstFunctionName)} ${chalk.gray('(cycle complete)')}`);
    console.log();
  });
}

/**
 * Output cycles as DOT format
 */
function outputCyclesDot(
  cycles: string[][],
  functions: import('../../types').FunctionInfo[],
  callEdges: import('../../types').CallEdge[]
): void {
  const dotGenerator = new DotGenerator();
  
  // Create a subset containing only cyclic functions
  const cyclicFunctionIds = new Set(cycles.flat());
  const cyclicFunctions = functions.filter(f => cyclicFunctionIds.has(f.id));
  const cyclicEdges = callEdges.filter(edge => 
    cyclicFunctionIds.has(edge.callerFunctionId) && 
    cyclicFunctionIds.has(edge.calleeFunctionId || '')
  );

  // Note: generateCycleGraph method may not exist
  // Using generateSCCGraph instead or fallback to dependency graph
  const dotContent = dotGenerator.generateDependencyGraph(
    cyclicFunctions,
    cyclicEdges,
    []
  );
  
  console.log(dotContent);
}
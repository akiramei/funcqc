import chalk from 'chalk';
import ora from 'ora';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { createErrorHandler } from '../../utils/error-handler';
import { ReachabilityAnalyzer } from '../../analyzers/reachability-analyzer';
import { DotGenerator } from '../../visualization/dot-generator';
import { DepCyclesOptions } from './types';

/**
 * Detect circular dependencies in the call graph
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

      spinner.text = 'Detecting circular dependencies...';

      // Analyze circular dependencies
      const reachabilityAnalyzer = new ReachabilityAnalyzer();
      const cycles = reachabilityAnalyzer.findCircularDependencies(callEdges);

      // Filter cycles by minimum size
      let filteredCycles = cycles;
      if (options.minSize) {
        const minSize = parseInt(options.minSize, 10);
        if (!isNaN(minSize) && minSize > 0) {
          filteredCycles = cycles.filter(cycle => cycle.length >= minSize);
        }
      }

      // Apply limit
      if (options.limit) {
        const limit = parseInt(options.limit, 10);
        if (!isNaN(limit) && limit > 0) {
          filteredCycles = filteredCycles.slice(0, limit);
        }
      }

      spinner.succeed(`Found ${cycles.length} circular dependencies`);

      // Output results
      if (options.format === 'json') {
        outputCyclesJSON(filteredCycles, functionMap, cycles.length, options);
      } else if (options.format === 'dot') {
        outputCyclesDot(filteredCycles, functions, callEdges);
      } else {
        outputCyclesTable(filteredCycles, functionMap, cycles.length, options);
      }
    } catch (error) {
      spinner.fail('Failed to analyze circular dependencies');
      errorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  };

/**
 * Output cycles as JSON
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
 * Output cycles as formatted table
 */
function outputCyclesTable(
  cycles: string[][],
  functionMap: Map<string, import('../../types').FunctionInfo>,
  totalCycles: number,
  _options: DepCyclesOptions
): void {
  console.log(chalk.bold('\n🔄 Circular Dependencies Analysis\n'));
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
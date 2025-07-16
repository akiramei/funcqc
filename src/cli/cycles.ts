import { OptionValues } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { VoidCommand } from '../types/command';
import { CommandEnvironment } from '../types/environment';
import { createErrorHandler } from '../utils/error-handler';
import { ReachabilityAnalyzer } from '../analyzers/reachability-analyzer';
import { CallEdge } from '../types';

interface CyclesOptions extends OptionValues {
  minSize?: string;
  format?: 'table' | 'json' | 'dot';
  verbose?: boolean;
}

/**
 * Detect circular dependencies in the call graph
 */
export const cyclesCommand: VoidCommand<CyclesOptions> = (options) =>
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

      spinner.text = 'Detecting circular dependencies...';

      // Analyze circular dependencies
      const analyzer = new ReachabilityAnalyzer();
      const cycles = analyzer.findCircularDependencies(callEdges);

      // Filter by minimum size
      const minSize = options.minSize ? parseInt(options.minSize) : 2;
      const filteredCycles = cycles.filter(cycle => cycle.length >= minSize);

      spinner.succeed('Circular dependency analysis complete');

      // Output results
      if (options.format === 'json') {
        outputCyclesJSON(filteredCycles, options);
      } else if (options.format === 'dot') {
        outputCyclesDOT(filteredCycles, callEdges);
      } else {
        outputCyclesTable(filteredCycles, callEdges, options);
      }
    } catch (error) {
      spinner.fail('Failed to analyze circular dependencies');
      errorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  };

/**
 * Output cycles as JSON
 */
function outputCyclesJSON(cycles: string[][], options: CyclesOptions): void {
  const result = {
    summary: {
      totalCycles: cycles.length,
      averageSize: cycles.length > 0 ? cycles.reduce((sum, cycle) => sum + cycle.length, 0) / cycles.length : 0,
      largestCycle: cycles.length > 0 ? Math.max(...cycles.map(cycle => cycle.length)) : 0,
    },
    cycles: cycles.map((cycle, index) => ({
      id: index + 1,
      functions: cycle,
      size: cycle.length,
    })),
    filters: {
      minSize: options.minSize ? parseInt(options.minSize) : 2,
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Output cycles as DOT format for Graphviz
 */
function outputCyclesDOT(cycles: string[][], _callEdges: CallEdge[]): void {
  console.log('digraph CircularDependencies {');
  console.log('  rankdir=LR;');
  console.log('  node [shape=box, style=filled, fillcolor=lightblue];');
  console.log('  edge [color=red, penwidth=2];');
  console.log();

  // Get unique functions in cycles
  const cyclesFunctions = new Set<string>();
  cycles.forEach(cycle => cycle.forEach(func => cyclesFunctions.add(func)));

  // Add nodes
  cyclesFunctions.forEach(func => {
    const truncated = func.length > 20 ? func.substring(0, 20) + '...' : func;
    console.log(`  "${func}" [label="${truncated}"];`);
  });

  console.log();

  // Add edges for cycles
  cycles.forEach(cycle => {
    for (let i = 0; i < cycle.length; i++) {
      const from = cycle[i];
      const to = cycle[(i + 1) % cycle.length];
      console.log(`  "${from}" -> "${to}";`);
    }
  });

  console.log('}');
}

/**
 * Output cycles as formatted table
 */
function outputCyclesTable(cycles: string[][], _callEdges: CallEdge[], options: CyclesOptions): void {
  console.log(chalk.bold('\n🔄 Circular Dependency Analysis\n'));

  if (cycles.length === 0) {
    console.log(chalk.green('✅ No circular dependencies found!'));
    return;
  }

  // Summary
  const avgSize = cycles.reduce((sum, cycle) => sum + cycle.length, 0) / cycles.length;
  const largestCycle = Math.max(...cycles.map(cycle => cycle.length));
  
  console.log(`Total cycles found: ${chalk.red(cycles.length)}`);
  console.log(`Average cycle size: ${chalk.yellow(avgSize.toFixed(1))}`);
  console.log(`Largest cycle: ${chalk.yellow(largestCycle)} functions\n`);

  // Display each cycle
  cycles.forEach((cycle, index) => {
    console.log(chalk.bold(`🔄 Cycle ${index + 1} (${cycle.length} functions):`));
    
    // Show the cycle path
    const cyclePath = cycle.map((func, i) => {
      const isLast = i === cycle.length - 1;
      const arrow = isLast ? ' → ' + chalk.dim(`(${cycle[0]})`) : ' → ';
      return chalk.cyan(func) + (isLast ? '' : arrow);
    }).join('');

    console.log(`  ${cyclePath}`);

    if (options.verbose) {
      // Show detailed function information
      console.log(chalk.dim('  Functions in cycle:'));
      cycle.forEach(func => {
        console.log(chalk.dim(`    • ${func}`));
      });
    }

    console.log(); // Empty line between cycles
  });

  // Suggestions
  console.log(chalk.dim('───────────────────────────────'));
  console.log(chalk.bold('💡 Recommendations:'));
  console.log(chalk.dim('• Extract common functionality to break cycles'));
  console.log(chalk.dim('• Use dependency injection to invert dependencies'));
  console.log(chalk.dim('• Consider refactoring large cycles into smaller modules'));
  
  if (cycles.length > 5) {
    console.log(chalk.dim('• Large number of cycles detected - consider architectural review'));
  }
}
/**
 * PageRank command - Function importance analysis using PageRank algorithm
 */

import { OptionValues } from 'commander';
import chalk from 'chalk';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { resolveSnapshotId } from '../../utils/snapshot-resolver';
import { PageRankCalculator, PageRankScore, PageRankOptions } from '../../analyzers/pagerank-calculator';
import { loadCallGraphWithLazyAnalysis } from '../../utils/lazy-analysis';

export interface PageRankCommandOptions extends OptionValues {
  damping?: string;
  maxIterations?: string;
  tolerance?: string;
  limit?: string;
  importance?: 'critical' | 'high' | 'medium' | 'low';
  sort?: 'score' | 'name' | 'centrality';
  desc?: boolean;
  includeMetrics?: boolean;
  json?: boolean;
  snapshot?: string;
}

interface PageRankJsonOutput {
  metadata: {
    snapshot: string;
    totalFunctions: number;
    convergence: {
      converged: boolean;
      iterations: number;
    };
    parameters: PageRankOptions;
    filtering: {
      importance: string;
      limit: number;
      sort: string;
      desc: boolean;
    };
  };
  statistics: {
    averageScore: number;
    maxScore: number;
    minScore: number;
    importanceDistribution: Record<string, number>;
    centralityMetrics?: {
      variance: number;
      gini: number;
      topCentralFunctions: Array<{ functionName: string; score: number }>;
    };
  };
  functions: Array<{
    id: string;
    name: string;
    filePath: string;
    pageRankScore: number;
    normalizedScore: number;
    rank: number;
    importance: string;
  }>;
}

/**
 * PageRank command implementation
 */
export const pageRankCommand: VoidCommand<PageRankCommandOptions> = (options) =>
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      // Resolve snapshot
      const targetSnapshotId = options.snapshot || 'latest';
      const resolvedSnapshotId = await resolveSnapshotId(env, targetSnapshotId);
      
      if (!resolvedSnapshotId) {
        throw new Error('No snapshot found. Please run "funcqc scan" first.');
      }

      // Load call graph data with lazy analysis if needed
      env.commandLogger.log('🔍 Loading call graph data for PageRank analysis...');
      const { functions, callEdges, snapshot } = await loadCallGraphWithLazyAnalysis(env, {
        showProgress: true,
        snapshotId: resolvedSnapshotId
      });

      if (functions.length === 0) {
        console.log(chalk.yellow('No functions found in the snapshot.'));
        return;
      }

      if (callEdges.length === 0) {
        console.log(chalk.yellow('No call graph data found. PageRank analysis requires function dependencies.'));
        console.log(chalk.gray('This could mean:'));
        console.log(chalk.gray('  • No function calls were detected in your code'));
        console.log(chalk.gray('  • Project contains only isolated functions'));
        console.log(chalk.gray('  • Call graph analysis needs to be performed'));
        console.log();
        console.log(chalk.blue('💡 Try running `funcqc scan` to re-analyze your project.'));
        return;
      }

      // Parse PageRank options
      const pageRankOptions: PageRankOptions = {
        dampingFactor: options.damping ? parseFloat(options.damping) : 0.85,
        maxIterations: options.maxIterations ? parseInt(options.maxIterations, 10) : 100,
        tolerance: options.tolerance ? parseFloat(options.tolerance) : 1e-6,
        initialValue: 1.0
      };

      // Validate options
      if (pageRankOptions.dampingFactor! < 0 || pageRankOptions.dampingFactor! > 1) {
        throw new Error('Damping factor must be between 0 and 1');
      }

      // Calculate PageRank
      env.commandLogger.log('🎯 Calculating PageRank scores...');
      const calculator = new PageRankCalculator(pageRankOptions);
      const result = await calculator.calculatePageRank(functions, callEdges);

      // Filter by importance if specified
      let filteredScores = result.scores;
      if (options.importance) {
        filteredScores = result.scores.filter(score => score.importance === options.importance);
      }

      // Sort results
      const sortField = options.sort || 'score';
      const isDesc = options.desc ?? (sortField === 'score'); // Default desc for score, asc for others
      
      filteredScores.sort((a, b) => {
        let comparison = 0;
        switch (sortField) {
          case 'score':
            comparison = a.score - b.score;
            break;
          case 'name':
            comparison = a.functionName.localeCompare(b.functionName);
            break;
          case 'centrality':
            comparison = a.normalizedScore - b.normalizedScore;
            break;
          default:
            comparison = a.score - b.score;
        }
        return isDesc ? -comparison : comparison;
      });

      // Limit results
      const limit = options.limit ? parseInt(options.limit, 10) : 20;
      const limitedScores = filteredScores.slice(0, limit);

      // Output results
      if (options.json) {
        const output: PageRankJsonOutput = {
          metadata: {
            snapshot: snapshot?.id || resolvedSnapshotId,
            totalFunctions: result.totalFunctions,
            convergence: {
              converged: result.converged,
              iterations: result.iterations
            },
            parameters: pageRankOptions,
            filtering: {
              importance: options.importance || 'all',
              limit,
              sort: sortField,
              desc: isDesc
            }
          },
          statistics: {
            averageScore: result.averageScore,
            maxScore: result.maxScore,
            minScore: result.minScore,
            importanceDistribution: result.importanceDistribution
          },
          functions: limitedScores.map(score => ({
            id: score.functionId,
            name: score.functionName,
            filePath: score.filePath,
            pageRankScore: score.score,
            normalizedScore: score.normalizedScore,
            rank: score.rank,
            importance: score.importance
          }))
        };

        if (options.includeMetrics) {
          const centralityMetrics = calculator.calculateCentralityMetrics(functions, callEdges);
          output.statistics.centralityMetrics = {
            variance: centralityMetrics.centralityVariance,
            gini: centralityMetrics.centralityGini,
            topCentralFunctions: centralityMetrics.topCentralFunctions.map(f => ({
              functionName: f.functionName,
              score: f.centrality
            }))
          };
        }

        console.log(JSON.stringify(output, null, 2));
      } else {
        displayPageRankResults(result, limitedScores, options);
      }

    } catch (error) {
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `PageRank analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
    }
  };

/**
 * Display PageRank results in table format
 */
function displayPageRankResults(
  result: import('../../analyzers/pagerank-calculator').PageRankResult,
  scores: PageRankScore[],
  options: PageRankCommandOptions
): void {
  console.log(chalk.cyan('🎯 PageRank Function Importance Analysis'));
  console.log(chalk.cyan('='.repeat(60)));
  console.log();

  // Display metadata
  const convergenceStatus = result.converged 
    ? chalk.green(`✅ Converged in ${result.iterations} iterations`)
    : chalk.red(`❌ Did not converge (${result.iterations} iterations)`);
  
  console.log(chalk.yellow('📊 Analysis Overview:'));
  console.log(`  ├── Functions Analyzed: ${result.totalFunctions}`);
  console.log(`  ├── Convergence: ${convergenceStatus}`);
  console.log(`  ├── Average Score: ${result.averageScore.toFixed(6)}`);
  console.log(`  └── Max Score: ${result.maxScore.toFixed(6)}`);
  console.log();

  // Display importance distribution
  if (!options.importance) {
    console.log(chalk.yellow('🏆 Importance Distribution:'));
    const { critical, high, medium, low } = result.importanceDistribution;
    const total = result.totalFunctions;
    
    console.log(`  ├── ${chalk.red('Critical')}: ${critical} functions (${((critical/total)*100).toFixed(1)}%)`);
    console.log(`  ├── ${chalk.yellow('High')}: ${high} functions (${((high/total)*100).toFixed(1)}%)`);
    console.log(`  ├── ${chalk.blue('Medium')}: ${medium} functions (${((medium/total)*100).toFixed(1)}%)`);
    console.log(`  └── ${chalk.gray('Low')}: ${low} functions (${((low/total)*100).toFixed(1)}%)`);
    console.log();
  }

  // Display top functions
  if (scores.length === 0) {
    console.log(chalk.yellow(`No functions found with importance level: ${options.importance}`));
    return;
  }

  const filterInfo = options.importance ? ` (${options.importance} importance)` : '';
  console.log(chalk.yellow(`🔍 Top ${scores.length} Functions${filterInfo}:`));
  console.log();

  // Table header
  console.log(
    chalk.bold(
      'Rank'.padEnd(6) +
      'Score'.padEnd(12) +
      'Centrality%'.padEnd(12) +
      'Importance'.padEnd(12) +
      'Function Name'.padEnd(35) +
      'File Path'
    )
  );
  console.log('-'.repeat(120));

  // Table rows
  scores.forEach((score, _index) => {
    const rankStr = `#${score.rank}`.padEnd(6);
    const scoreStr = score.score.toFixed(6).padEnd(12);
    const centralityStr = `${(score.normalizedScore * 100).toFixed(2)}%`.padEnd(12);
    
    let importanceStr = score.importance.padEnd(12);
    switch (score.importance) {
      case 'critical':
        importanceStr = chalk.red(score.importance).padEnd(12);
        break;
      case 'high':
        importanceStr = chalk.yellow(score.importance).padEnd(12);
        break;
      case 'medium':
        importanceStr = chalk.blue(score.importance).padEnd(12);
        break;
      default:
        importanceStr = chalk.gray(score.importance).padEnd(12);
    }
    
    const nameStr = score.functionName.slice(0, 34).padEnd(35);
    const pathStr = score.filePath;
    
    console.log(`${rankStr}${scoreStr}${centralityStr}${importanceStr}${nameStr}${pathStr}`);
  });

  console.log();

  // Display additional metrics if requested
  if (options.includeMetrics) {
    console.log(chalk.yellow('📈 Centrality Metrics:'));
    console.log('  └── (Use --json with --include-metrics to see centrality metrics)');
    console.log();
  }

  // Display recommendations
  console.log(chalk.blue('💡 Recommendations:'));
  if (result.importanceDistribution.critical > 0) {
    console.log(chalk.blue('  • Focus testing efforts on critical importance functions'));
    console.log(chalk.blue('  • Consider breaking down large critical functions'));
  }
  if (result.importanceDistribution.high > result.totalFunctions * 0.1) {
    console.log(chalk.blue('  • Many functions have high importance - consider architectural refactoring'));
  }
  if (scores.length > 0 && scores[0].normalizedScore > 0.8) {
    console.log(chalk.blue(`  • Function "${scores[0].functionName}" has very high centrality - monitor carefully`));
  }
  console.log();
}
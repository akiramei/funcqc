import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { createErrorHandler } from '../../utils/error-handler';
import { DatabaseError } from '../../storage/pglite-adapter';
import { FunctionInfo } from '../../types';
import { loadComprehensiveCallGraphData, validateCallGraphRequirements } from '../../utils/lazy-analysis';
import { DepShowOptions } from './types';
import { findTargetFunction, createQualityMetricsMap, parseNumericOption, buildDependencyTree } from './utils';
import { outputDepShowJSON, outputDepShowFormatted } from './output';

/**
 * Perform single function dependency analysis
 */
function performSingleFunctionAnalysis(
  targetFunction: FunctionInfo,
  callEdges: import('../../types').CallEdge[],
  functions: FunctionInfo[],
  options: DepShowOptions,
  maxDepth: number,
  maxRoutes: number,
  qualityMetricsMap?: Map<string, { cyclomaticComplexity: number; cognitiveComplexity: number }>
): void {
  const dependencies = buildDependencyTree(
    targetFunction.id,
    callEdges,
    functions,
    options.direction || 'out',  // Default to 'out' for more natural flow
    maxDepth,
    options.includeExternal || false,
    {
      showComplexity: options.showComplexity,
      rankByLength: options.rankByLength,
      maxRoutes,
      qualityMetrics: qualityMetricsMap,
      externalFilter: options.externalFilter || 'transit',
    }
  );

  if (options.json) {
    outputDepShowJSON({
      id: targetFunction.id,
      name: targetFunction.name,
      file_path: targetFunction.filePath,
      start_line: targetFunction.startLine
    }, dependencies);
  } else {
    const functionMap = new Map(functions.map(f => [f.id, f]));
    outputDepShowFormatted({
      id: targetFunction.id,
      name: targetFunction.name,
      file_path: targetFunction.filePath,
      start_line: targetFunction.startLine
    }, dependencies, options, functionMap);
  }
}

/**
 * Perform global route analysis (placeholder)
 */
async function performGlobalRouteAnalysis(
  _functions: FunctionInfo[], 
  _allEdges: import('../../types').CallEdge[], 
  _maxDepth: number, 
  _maxRoutes: number, 
  _options: DepShowOptions, 
  _qualityMetricsMap?: Map<string, { cyclomaticComplexity: number; cognitiveComplexity: number }>
): Promise<void> {
  throw new Error('Global route analysis is not yet implemented');
}

/**
 * Show detailed dependency information for a function
 * 
 * @param functionRef - Optional function ID or name. If provided, overrides the --name option.
 *                      This parameter enables both programmatic usage and CLI argument passing.
 * 
 * @example
 * // CLI usage with positional argument
 * funcqc dep show myFunction
 * 
 * // CLI usage with option
 * funcqc dep show --name myFunction
 * 
 * // Programmatic usage
 * depShowCommand('myFunction')(options)(env)
 */
export const depShowCommand = (functionRef?: string): VoidCommand<DepShowOptions> => 
  (options) => async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      const { allEdges, functions } = await loadComprehensiveCallGraphData(env, {
        showProgress: true,
        snapshotId: options.snapshot
      });

      validateCallGraphRequirements(allEdges, 'dep show');

      const targetFunction = functionRef ? findTargetFunction(functionRef, functions) : null;
      if (functionRef && !targetFunction) {
        return;
      }

      const qualityMetricsMap = options.showComplexity ? createQualityMetricsMap(functions) : undefined;
      
      const maxDepth = parseNumericOption(options.depth, 2, 'depth');
      const maxRoutes = parseNumericOption(options.maxRoutes, 5, 'maxRoutes');
      
      if (maxDepth === null || maxRoutes === null) {
        return;
      }

      if (targetFunction) {
        performSingleFunctionAnalysis(
          targetFunction,
          allEdges,
          functions,
          options,
          maxDepth,
          maxRoutes,
          qualityMetricsMap
        );
      } else {
        await performGlobalRouteAnalysis(
          functions, 
          allEdges, 
          maxDepth, 
          maxRoutes, 
          options, 
          qualityMetricsMap
        );
      }
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
        errorHandler.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };
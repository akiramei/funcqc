/**
 * Worker thread for parallel TypeScript file analysis
 */

import { parentPort, workerData } from 'worker_threads';
import { TypeScriptAnalyzer } from '../analyzers/typescript-analyzer';
import { QualityCalculator } from '../metrics/quality-calculator';
import { FunctionInfo } from '../types';

export interface WorkerInput {
  filePaths: string[];
  maxSourceFilesInMemory: number;
}

export interface WorkerOutput {
  success: boolean;
  functions: FunctionInfo[];
  error?: string;
  stats: {
    filesProcessed: number;
    failedFiles: number;
    functionsFound: number;
    processingTime: number;
  };
}

/**
 * Processes a single file and returns its functions with quality metrics
 */
async function processFile(
  filePath: string,
  analyzer: TypeScriptAnalyzer,
  qualityCalculator: QualityCalculator
): Promise<{ functions: FunctionInfo[]; failed: boolean }> {
  try {
    const fileFunctions = await analyzer.analyzeFile(filePath);

    // Calculate quality metrics for each function
    for (const func of fileFunctions) {
      func.metrics = await qualityCalculator.calculate(func);
    }

    return { functions: fileFunctions, failed: false };
  } catch (error) {
    // Log error but continue processing other files
    console.warn(
      `Worker: Failed to analyze ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
    return { functions: [], failed: true };
  }
}

/**
 * Creates success response for worker output
 */
function createSuccessResponse(
  allFunctions: FunctionInfo[],
  totalFiles: number,
  failedFiles: number,
  processingTime: number
): WorkerOutput {
  return {
    success: true,
    functions: allFunctions,
    stats: {
      filesProcessed: totalFiles,
      failedFiles,
      functionsFound: allFunctions.length,
      processingTime,
    },
  };
}

/**
 * Creates error response for worker output
 */
function createErrorResponse(error: unknown, processingTime: number): WorkerOutput {
  return {
    success: false,
    functions: [],
    error: error instanceof Error ? error.message : String(error),
    stats: {
      filesProcessed: 0,
      failedFiles: 0,
      functionsFound: 0,
      processingTime,
    },
  };
}

async function processFiles(input: WorkerInput): Promise<WorkerOutput> {
  const startTime = Date.now();

  try {
    const analyzer = new TypeScriptAnalyzer(input.maxSourceFilesInMemory);
    const qualityCalculator = new QualityCalculator();
    const allFunctions: FunctionInfo[] = [];
    let failedFiles = 0;

    for (const filePath of input.filePaths) {
      const result = await processFile(filePath, analyzer, qualityCalculator);
      
      if (result.failed) {
        failedFiles++;
      } else {
        allFunctions.push(...result.functions);
      }
    }

    // Clean up analyzer resources
    await analyzer.cleanup();

    const processingTime = Date.now() - startTime;
    return createSuccessResponse(allFunctions, input.filePaths.length, failedFiles, processingTime);
  } catch (error) {
    const processingTime = Date.now() - startTime;
    return createErrorResponse(error, processingTime);
  }
}

// Worker entry point
if (parentPort && workerData) {
  processFiles(workerData as WorkerInput)
    .then(result => {
      parentPort!.postMessage(result);
    })
    .catch(error => {
      // processFiles already handles errors, this should not happen
      console.error('Unexpected worker error:', error);
    });
}

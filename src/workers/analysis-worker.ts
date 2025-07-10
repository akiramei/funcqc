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

async function processFiles(input: WorkerInput): Promise<WorkerOutput> {
  const startTime = Date.now();

  try {
    const analyzer = new TypeScriptAnalyzer(input.maxSourceFilesInMemory);
    const qualityCalculator = new QualityCalculator();
    const allFunctions: FunctionInfo[] = [];
    let failedFiles = 0;

    for (const filePath of input.filePaths) {
      try {
        const fileFunctions = await analyzer.analyzeFile(filePath);

        // Calculate quality metrics for each function
        for (const func of fileFunctions) {
          func.metrics = await qualityCalculator.calculate(func);
        }

        allFunctions.push(...fileFunctions);
      } catch (error) {
        failedFiles++;
        // Log error but continue processing other files
        console.warn(
          `Worker: Failed to analyze ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Clean up analyzer resources
    await analyzer.cleanup();

    const processingTime = Date.now() - startTime;

    return {
      success: true,
      functions: allFunctions,
      stats: {
        filesProcessed: input.filePaths.length,
        failedFiles,
        functionsFound: allFunctions.length,
        processingTime,
      },
    };
  } catch (error) {
    return {
      success: false,
      functions: [],
      error: error instanceof Error ? error.message : String(error),
      stats: {
        filesProcessed: 0,
        failedFiles: 0,
        functionsFound: 0,
        processingTime: Date.now() - startTime,
      },
    };
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

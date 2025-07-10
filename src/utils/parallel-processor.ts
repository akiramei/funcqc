/**
 * Parallel processing utilities using worker threads
 */

import { Worker } from 'worker_threads';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { FunctionInfo } from '../types';
import { WorkerInput, WorkerOutput } from '../workers/analysis-worker';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ParallelProcessingOptions {
  maxWorkers?: number;
  filesPerWorker?: number;
  maxSourceFilesInMemory?: number;
  onProgress?: (completed: number, total: number) => void;
}

export interface ParallelProcessingResult {
  functions: FunctionInfo[];
  stats: {
    totalFiles: number;
    totalFunctions: number;
    totalProcessingTime: number;
    workersUsed: number;
    avgFunctionsPerFile: number;
  };
}

export class ParallelFileProcessor {
  private maxWorkers: number;
  private maxSourceFilesInMemory: number;

  constructor(options: ParallelProcessingOptions = {}) {
    // Default to CPU count, but cap at 8 workers to avoid resource exhaustion
    this.maxWorkers = Math.min(options.maxWorkers || os.cpus().length, 8);
    this.maxSourceFilesInMemory = options.maxSourceFilesInMemory || 50;
  }

  /**
   * Process files in parallel using worker threads
   */
  async processFiles(
    filePaths: string[],
    options: ParallelProcessingOptions = {}
  ): Promise<ParallelProcessingResult> {
    if (filePaths.length === 0) {
      return {
        functions: [],
        stats: {
          totalFiles: 0,
          totalFunctions: 0,
          totalProcessingTime: 0,
          workersUsed: 0,
          avgFunctionsPerFile: 0,
        },
      };
    }

    const startTime = Date.now();
    const filesPerWorker =
      options.filesPerWorker || this.calculateOptimalFilesPerWorker(filePaths.length);
    const workerCount = Math.min(Math.ceil(filePaths.length / filesPerWorker), this.maxWorkers);

    // Split files into batches for workers
    const fileBatches = this.splitFilesForWorkers(filePaths, workerCount);

    // Process batches in parallel
    const workerPromises = fileBatches.map((batch, index) =>
      this.processFileBatch(batch, index, options.onProgress)
    );

    const results = await Promise.all(workerPromises);

    // Aggregate results
    const allFunctions: FunctionInfo[] = [];
    let totalProcessingTime = 0;

    for (const result of results) {
      if (result.success) {
        allFunctions.push(...result.functions);
        totalProcessingTime = Math.max(totalProcessingTime, result.stats.processingTime);
      } else {
        console.warn(`Worker failed: ${result.error}`);
      }
    }

    const totalProcessingTimeMs = Date.now() - startTime;

    return {
      functions: allFunctions,
      stats: {
        totalFiles: filePaths.length,
        totalFunctions: allFunctions.length,
        totalProcessingTime: totalProcessingTimeMs,
        workersUsed: workerCount,
        avgFunctionsPerFile: filePaths.length > 0 ? allFunctions.length / filePaths.length : 0,
      },
    };
  }

  /**
   * Process a batch of files using a single worker
   */
  private async processFileBatch(
    filePaths: string[],
    workerIndex: number,
    onProgress?: (completed: number, total: number) => void
  ): Promise<WorkerOutput> {
    return new Promise((resolve, reject) => {
      const workerPath = path.join(__dirname, '../workers/analysis-worker.js');
      const workerInput: WorkerInput = {
        filePaths,
        maxSourceFilesInMemory: this.maxSourceFilesInMemory,
      };

      const worker = new Worker(workerPath, {
        workerData: workerInput,
      });

      // Add timeout to prevent hanging workers
      const timeout = setTimeout(
        () => {
          worker.terminate();
          reject(new Error(`Worker ${workerIndex} timed out after 5 minutes`));
        },
        5 * 60 * 1000
      ); // 5 minutes

      worker.on('message', (result: WorkerOutput) => {
        clearTimeout(timeout);
        worker.terminate();

        // Update progress if callback provided
        if (onProgress) {
          onProgress(result.stats.filesProcessed, filePaths.length);
        }

        resolve(result);
      });

      worker.on('error', error => {
        clearTimeout(timeout);
        worker.terminate();
        reject(error);
      });

      worker.on('exit', code => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`Worker ${workerIndex} stopped with exit code ${code}`));
        }
      });
    });
  }

  /**
   * Split files into batches for optimal worker distribution
   */
  private splitFilesForWorkers(filePaths: string[], workerCount: number): string[][] {
    const batches: string[][] = [];
    const filesPerBatch = Math.ceil(filePaths.length / workerCount);

    for (let i = 0; i < filePaths.length; i += filesPerBatch) {
      batches.push(filePaths.slice(i, i + filesPerBatch));
    }

    return batches;
  }

  /**
   * Calculate optimal files per worker based on total file count
   */
  private calculateOptimalFilesPerWorker(totalFiles: number): number {
    // Balance between parallelism and overhead
    if (totalFiles <= 50) return Math.ceil(totalFiles / 2); // Use fewer workers for small projects
    if (totalFiles <= 200) return 25; // Medium projects
    if (totalFiles <= 1000) return 50; // Large projects
    return 100; // Very large projects
  }

  /**
   * Determine if parallel processing is beneficial
   */
  static shouldUseParallelProcessing(_fileCount: number): boolean {
    // Temporarily disable parallel processing until worker compilation is resolved
    return false;
    // return fileCount >= 20 && os.cpus().length > 1;
  }

  /**
   * Get recommended worker configuration for the current system
   */
  static getRecommendedConfig(): ParallelProcessingOptions {
    const cpuCount = os.cpus().length;
    const totalMemoryGB = os.totalmem() / (1024 * 1024 * 1024);

    return {
      maxWorkers: Math.min(cpuCount, 8),
      maxSourceFilesInMemory: totalMemoryGB >= 8 ? 100 : 50,
      filesPerWorker: totalMemoryGB >= 8 ? 100 : 50,
    };
  }
}

/**
 * Parallel processing utilities using worker threads
 */

import { Worker } from 'worker_threads';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { FunctionInfo } from '../types';
import { WorkerInput, WorkerOutput } from '../workers/analysis-worker';
import { SystemResourceManager } from './system-resource-manager';

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
    // Use SystemResourceManager for optimal configuration
    const resourceManager = SystemResourceManager.getInstance();
    const optimalConfig = resourceManager.getOptimalConfig();
    
    // Default to CPU count, but cap at 8 workers to avoid resource exhaustion
    this.maxWorkers = Math.min(options.maxWorkers || optimalConfig.maxWorkers, 8);
    this.maxSourceFilesInMemory = options.maxSourceFilesInMemory || optimalConfig.maxSourceFilesInMemory;
  }

  /**
   * Calculate dynamic timeout based on project size and system resources
   */
  private calculateWorkerTimeout(fileCount: number): number {
    const resourceManager = SystemResourceManager.getInstance();
    const systemInfo = resourceManager.getSystemInfo();
    
    // Base timeout: 30 seconds for small projects
    let timeoutMs = 30 * 1000;
    
    // Scale with file count (500ms per file base)
    const fileTimeoutMs = fileCount * 500;
    
    // Adjust for system performance
    const cpuFactor = Math.max(0.5, systemInfo.cpuCount / 8); // Normalize to 8 cores
    const memoryFactor = Math.max(0.5, systemInfo.totalMemoryGB / 8); // Normalize to 8GB
    const systemFactor = (cpuFactor + memoryFactor) / 2;
    
    // Calculate adjusted timeout
    timeoutMs = Math.max(timeoutMs, fileTimeoutMs / systemFactor);
    
    // Apply bounds: min 30s, max 15 minutes
    timeoutMs = Math.max(30 * 1000, Math.min(timeoutMs, 15 * 60 * 1000));
    
    return Math.round(timeoutMs);
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

      // Calculate dynamic timeout based on file count and system resources
      const timeoutMs = this.calculateWorkerTimeout(filePaths.length);
      const timeoutMinutes = Math.round(timeoutMs / 60000 * 10) / 10; // Round to 1 decimal
      
      const timeout = setTimeout(
        () => {
          worker.terminate();
          reject(new Error(`Worker ${workerIndex} timed out after ${timeoutMinutes} minutes (${filePaths.length} files, dynamic timeout)`));
        },
        timeoutMs
      );

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
  static shouldUseParallelProcessing(fileCount: number): boolean {
    // Enable parallel processing for better performance on multi-core systems
    return fileCount >= 20 && os.cpus().length > 1;
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

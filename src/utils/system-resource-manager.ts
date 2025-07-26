/**
 * System Resource Manager
 * 
 * Dynamically adjusts processing parameters based on available system resources
 * to optimize performance and prevent memory exhaustion
 */

import * as os from 'os';

export interface SystemResources {
  totalMemoryGB: number;
  availableMemoryGB: number;
  cpuCount: number;
  cpuArchitecture: string;
  platform: string;
}

export interface OptimalConfig {
  maxSourceFilesInMemory: number;
  maxWorkers: number;
  filesPerWorker: number;
  batchSize: number;
  cacheSize: number;
  enableParallelProcessing: boolean;
}

export class SystemResourceManager {
  private static instance: SystemResourceManager;
  private systemResources: SystemResources;

  private constructor() {
    this.systemResources = this.detectSystemResources();
  }

  static getInstance(): SystemResourceManager {
    if (!SystemResourceManager.instance) {
      SystemResourceManager.instance = new SystemResourceManager();
    }
    return SystemResourceManager.instance;
  }

  /**
   * Detect current system resources
   */
  private detectSystemResources(): SystemResources {
    const totalMemoryBytes = os.totalmem();
    const freeMemoryBytes = os.freemem();
    
    return {
      totalMemoryGB: totalMemoryBytes / (1024 * 1024 * 1024),
      availableMemoryGB: freeMemoryBytes / (1024 * 1024 * 1024),
      cpuCount: os.cpus().length,
      cpuArchitecture: os.arch(),
      platform: os.platform()
    };
  }

  /**
   * Get optimal configuration based on current system resources
   */
  getOptimalConfig(projectSize?: number): OptimalConfig {
    const resources = this.detectSystemResources(); // Refresh for current state
    
    // Calculate optimal maxSourceFilesInMemory based on available memory
    const maxSourceFilesInMemory = this.calculateOptimalSourceFilesInMemory(resources.totalMemoryGB);
    
    // Calculate optimal worker configuration
    const { maxWorkers, filesPerWorker } = this.calculateOptimalWorkerConfig(
      resources.cpuCount, 
      resources.totalMemoryGB,
      projectSize
    );
    
    // Calculate batch size based on memory and CPU
    const batchSize = this.calculateOptimalBatchSize(resources.totalMemoryGB, maxWorkers);
    
    // Calculate cache size
    const cacheSize = this.calculateOptimalCacheSize(resources.totalMemoryGB);
    
    // Determine if parallel processing should be enabled
    const enableParallelProcessing = this.shouldEnableParallelProcessing(
      resources.cpuCount,
      resources.totalMemoryGB,
      projectSize
    );

    return {
      maxSourceFilesInMemory,
      maxWorkers,
      filesPerWorker,
      batchSize,
      cacheSize,
      enableParallelProcessing
    };
  }

  /**
   * Calculate optimal number of source files to keep in memory
   */
  private calculateOptimalSourceFilesInMemory(totalMemoryGB: number): number {
    // Base calculation: 10 files per GB, with reasonable bounds
    let optimalCount = Math.floor(totalMemoryGB * 10);
    
    // Apply bounds based on system characteristics
    if (totalMemoryGB < 4) {
      // Low memory systems
      optimalCount = Math.max(20, Math.min(optimalCount, 50));
    } else if (totalMemoryGB < 8) {
      // Medium memory systems
      optimalCount = Math.max(50, Math.min(optimalCount, 100));
    } else if (totalMemoryGB < 16) {
      // High memory systems
      optimalCount = Math.max(100, Math.min(optimalCount, 200));
    } else {
      // Very high memory systems
      optimalCount = Math.max(200, Math.min(optimalCount, 500));
    }
    
    return optimalCount;
  }

  /**
   * Calculate optimal worker configuration
   */
  private calculateOptimalWorkerConfig(
    cpuCount: number, 
    totalMemoryGB: number,
    projectSize?: number
  ): { maxWorkers: number; filesPerWorker: number } {
    // Base worker count: use all CPUs but cap to prevent resource exhaustion
    let maxWorkers = Math.min(cpuCount, 8);
    
    // Adjust based on memory constraints
    if (totalMemoryGB < 4) {
      maxWorkers = Math.min(maxWorkers, 2); // Conservative for low memory
    } else if (totalMemoryGB < 8) {
      maxWorkers = Math.min(maxWorkers, 4); // Moderate for medium memory
    }
    // High memory systems can use more workers
    
    // Calculate files per worker based on project size
    let filesPerWorker: number;
    
    if (!projectSize || projectSize <= 50) {
      filesPerWorker = Math.max(10, Math.ceil((projectSize || 50) / maxWorkers));
    } else if (projectSize <= 200) {
      filesPerWorker = 25;
    } else if (projectSize <= 1000) {
      filesPerWorker = 50;
    } else {
      filesPerWorker = 100;
    }
    
    return { maxWorkers, filesPerWorker };
  }

  /**
   * Calculate optimal batch size for database operations
   */
  private calculateOptimalBatchSize(totalMemoryGB: number, maxWorkers: number): number {
    // Base batch size adjusted for memory and concurrency
    let batchSize = Math.floor(totalMemoryGB * 50); // 50 items per GB base
    
    // Adjust for worker concurrency
    batchSize = Math.floor(batchSize / maxWorkers);
    
    // Apply reasonable bounds
    return Math.max(10, Math.min(batchSize, 500));
  }

  /**
   * Calculate optimal cache size
   */
  private calculateOptimalCacheSize(totalMemoryGB: number): number {
    // Cache size as percentage of available memory
    if (totalMemoryGB < 4) {
      return 100; // 100 MB for low memory
    } else if (totalMemoryGB < 8) {
      return 250; // 250 MB for medium memory
    } else if (totalMemoryGB < 16) {
      return 500; // 500 MB for high memory
    } else {
      return 1000; // 1 GB for very high memory
    }
  }

  /**
   * Determine if parallel processing should be enabled
   */
  private shouldEnableParallelProcessing(
    cpuCount: number,
    totalMemoryGB: number,
    projectSize?: number
  ): boolean {
    // Basic requirements
    if (cpuCount <= 1 || totalMemoryGB < 2) {
      return false;
    }
    
    // Project size consideration
    if (projectSize && projectSize < 20) {
      return false; // Too small to benefit from parallelization overhead
    }
    
    // Memory threshold for parallel processing
    if (totalMemoryGB < 4 && projectSize && projectSize > 100) {
      return false; // Avoid memory pressure on large projects with low memory
    }
    
    return true;
  }

  /**
   * Get current system resource information
   */
  getSystemInfo(): SystemResources {
    return { ...this.systemResources };
  }

  /**
   * Log system resources and recommended configuration
   */
  logSystemInfo(config: OptimalConfig): void {
    const resources = this.detectSystemResources();
    
    console.log('📊 System Resources:');
    console.log(`   Memory: ${resources.totalMemoryGB.toFixed(1)} GB total, ${resources.availableMemoryGB.toFixed(1)} GB available`);
    console.log(`   CPU: ${resources.cpuCount} cores (${resources.cpuArchitecture})`);
    console.log(`   Platform: ${resources.platform}`);
    console.log('');
    console.log('⚙️  Optimal Configuration:');
    console.log(`   Max source files in memory: ${config.maxSourceFilesInMemory}`);
    console.log(`   Max workers: ${config.maxWorkers}`);
    console.log(`   Files per worker: ${config.filesPerWorker}`);
    console.log(`   Batch size: ${config.batchSize}`);
    console.log(`   Parallel processing: ${config.enableParallelProcessing ? 'enabled' : 'disabled'}`);
  }

  /**
   * Monitor current memory usage and return recommendations
   */
  getCurrentMemoryUsage(): {
    usedMemoryGB: number;
    usedMemoryPercent: number;
    recommendation: 'optimal' | 'warning' | 'critical';
  } {
    const resources = this.detectSystemResources();
    const usedMemoryGB = resources.totalMemoryGB - resources.availableMemoryGB;
    const usedMemoryPercent = (usedMemoryGB / resources.totalMemoryGB) * 100;
    
    let recommendation: 'optimal' | 'warning' | 'critical';
    if (usedMemoryPercent < 70) {
      recommendation = 'optimal';
    } else if (usedMemoryPercent < 85) {
      recommendation = 'warning';
    } else {
      recommendation = 'critical';
    }
    
    return {
      usedMemoryGB,
      usedMemoryPercent,
      recommendation
    };
  }
}
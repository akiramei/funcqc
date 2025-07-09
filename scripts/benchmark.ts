#!/usr/bin/env tsx
/**
 * Performance benchmark script for funcqc
 * Measures and profiles various operations on large datasets
 */

import { performance } from 'perf_hooks';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';

interface BenchmarkResult {
  operation: string;
  filesCount: number;
  functionsCount: number;
  duration: number;
  memoryUsed: number;
  memoryPeak: number;
}

class MemoryTracker {
  private initialMemory: number;
  private peakMemory: number;
  private interval: NodeJS.Timeout | null = null;

  constructor() {
    this.initialMemory = process.memoryUsage().heapUsed;
    this.peakMemory = this.initialMemory;
  }

  start(): void {
    this.interval = setInterval(() => {
      const currentMemory = process.memoryUsage().heapUsed;
      if (currentMemory > this.peakMemory) {
        this.peakMemory = currentMemory;
      }
    }, 100);
  }

  stop(): { used: number; peak: number } {
    if (this.interval) {
      clearInterval(this.interval);
    }
    const finalMemory = process.memoryUsage().heapUsed;
    return {
      used: (finalMemory - this.initialMemory) / 1024 / 1024, // MB
      peak: (this.peakMemory - this.initialMemory) / 1024 / 1024 // MB
    };
  }
}

async function runBenchmark(projectPath: string): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  const spinner = ora();

  console.log(chalk.blue('\n🚀 funcqc Performance Benchmark\n'));

  // Prepare test database
  const testDbPath = path.join(process.cwd(), '.benchmark-db');
  if (fs.existsSync(testDbPath)) {
    fs.rmSync(testDbPath, { recursive: true });
  }

  // Set environment for testing
  process.env.FUNCQC_DB_PATH = testDbPath;

  try {
    // 1. Benchmark: Initial Scan
    spinner.start('Running initial scan benchmark...');
    const scanResult = await benchmarkScan(projectPath);
    results.push(scanResult);
    spinner.succeed(`Scan completed: ${scanResult.duration.toFixed(2)}s, ${scanResult.functionsCount} functions`);

    // 2. Benchmark: List Operations
    spinner.start('Running list operation benchmarks...');
    const listResults = await benchmarkListOperations();
    results.push(...listResults);
    spinner.succeed(`List operations completed`);

    // 3. Benchmark: History Query
    spinner.start('Running history query benchmark...');
    const historyResult = await benchmarkHistory();
    results.push(historyResult);
    spinner.succeed(`History query completed: ${historyResult.duration.toFixed(2)}s`);

    // 4. Benchmark: Complex Queries
    spinner.start('Running complex query benchmarks...');
    const queryResults = await benchmarkComplexQueries();
    results.push(...queryResults);
    spinner.succeed(`Complex queries completed`);

    return results;
  } finally {
    // Cleanup
    if (fs.existsSync(testDbPath)) {
      fs.rmSync(testDbPath, { recursive: true });
    }
  }
}

async function benchmarkScan(projectPath: string): Promise<BenchmarkResult> {
  const memoryTracker = new MemoryTracker();
  
  // Count files first - using path.resolve to prevent shell injection
  const safeProjectPath = path.resolve(projectPath);
  const filesOutput = execSync(
    `find ${JSON.stringify(safeProjectPath)} -name "*.ts" -o -name "*.tsx" | grep -v node_modules | wc -l`,
    { encoding: 'utf-8' }
  );
  const filesCount = parseInt(filesOutput.trim());

  memoryTracker.start();
  const startTime = performance.now();

  // Run scan
  execSync(`npm run --silent dev -- scan --comment "Benchmark test"`, {
    cwd: process.cwd(),
    stdio: 'pipe'
  });

  const duration = (performance.now() - startTime) / 1000;
  const memory = memoryTracker.stop();

  // Get function count with error handling
  const listOutput = execSync(`npm run --silent dev -- list --json`, {
    encoding: 'utf-8'
  });
  
  let functionsCount = 0;
  try {
    const listData = JSON.parse(listOutput);
    functionsCount = listData.meta.total;
  } catch (error) {
    console.warn('Failed to parse list output:', error instanceof Error ? error.message : String(error));
  }

  return {
    operation: 'scan',
    filesCount,
    functionsCount,
    duration,
    memoryUsed: memory.used,
    memoryPeak: memory.peak
  };
}

async function benchmarkListOperations(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  const operations = [
    { name: 'list-all', command: 'list' },
    { name: 'list-complex', command: 'list --cc-ge 10' },
    { name: 'list-sorted', command: 'list --sort cc --desc --limit 100' },
    { name: 'list-filtered', command: 'list --file "src" --name "*test*"' }
  ];

  for (const op of operations) {
    const memoryTracker = new MemoryTracker();
    memoryTracker.start();
    const startTime = performance.now();

    execSync(`npm run --silent dev -- ${op.command}`, {
      cwd: process.cwd(),
      stdio: 'pipe'
    });

    const duration = (performance.now() - startTime) / 1000;
    const memory = memoryTracker.stop();

    results.push({
      operation: op.name,
      filesCount: 0,
      functionsCount: 0,
      duration,
      memoryUsed: memory.used,
      memoryPeak: memory.peak
    });
  }

  return results;
}

async function benchmarkHistory(): Promise<BenchmarkResult> {
  const memoryTracker = new MemoryTracker();
  memoryTracker.start();
  const startTime = performance.now();

  execSync(`npm run --silent dev -- history --limit 50`, {
    cwd: process.cwd(),
    stdio: 'pipe'
  });

  const duration = (performance.now() - startTime) / 1000;
  const memory = memoryTracker.stop();

  return {
    operation: 'history',
    filesCount: 0,
    functionsCount: 0,
    duration,
    memoryUsed: memory.used,
    memoryPeak: memory.peak
  };
}

async function benchmarkComplexQueries(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  
  // Add more snapshots for comparison
  for (let i = 0; i < 3; i++) {
    execSync(`npm run --silent dev -- scan --comment "Benchmark snapshot ${i + 2}"`, {
      cwd: process.cwd(),
      stdio: 'pipe'
    });
  }

  const operations = [
    { name: 'diff-snapshots', command: 'diff HEAD~1 HEAD' },
    { name: 'search-functions', command: 'search "test"' },
    { name: 'show-details', command: 'show "analyze"' }
  ];

  for (const op of operations) {
    const memoryTracker = new MemoryTracker();
    memoryTracker.start();
    const startTime = performance.now();

    try {
      execSync(`npm run --silent dev -- ${op.command}`, {
        cwd: process.cwd(),
        stdio: 'pipe'
      });
    } catch (error) {
      // Some commands might fail if function not found, that's ok
      console.debug(`Command failed: ${op.command}`, error instanceof Error ? error.message : String(error));
    }

    const duration = (performance.now() - startTime) / 1000;
    const memory = memoryTracker.stop();

    results.push({
      operation: op.name,
      filesCount: 0,
      functionsCount: 0,
      duration,
      memoryUsed: memory.used,
      memoryPeak: memory.peak
    });
  }

  return results;
}

function displayResults(results: BenchmarkResult[]): void {
  console.log(chalk.blue('\n📊 Benchmark Results\n'));
  
  console.log('Operation            Files    Functions  Duration(s)  Memory(MB)  Peak(MB)');
  console.log('-------------------- -------- ---------- ----------- ----------- ---------');
  
  for (const result of results) {
    const operation = result.operation.padEnd(20);
    const files = result.filesCount > 0 ? result.filesCount.toString().padStart(8) : ''.padStart(8);
    const functions = result.functionsCount > 0 ? result.functionsCount.toString().padStart(10) : ''.padStart(10);
    const duration = result.duration.toFixed(3).padStart(11);
    const memory = result.memoryUsed.toFixed(1).padStart(11);
    const peak = result.memoryPeak.toFixed(1).padStart(9);
    
    console.log(`${operation} ${files} ${functions} ${duration} ${memory} ${peak}`);
  }

  // Performance summary
  const scanResult = results.find(r => r.operation === 'scan');
  if (scanResult) {
    console.log(chalk.blue('\n🎯 Performance Metrics\n'));
    console.log(`Files per second: ${(scanResult.filesCount / scanResult.duration).toFixed(0)}`);
    console.log(`Functions per second: ${(scanResult.functionsCount / scanResult.duration).toFixed(0)}`);
    console.log(`Memory efficiency: ${(scanResult.functionsCount / scanResult.memoryPeak).toFixed(0)} functions/MB`);
    
    // Performance rating
    const funcPerSec = scanResult.functionsCount / scanResult.duration;
    let rating = '';
    if (funcPerSec > 500) rating = chalk.green('Excellent');
    else if (funcPerSec > 200) rating = chalk.blue('Good');
    else if (funcPerSec > 100) rating = chalk.yellow('Fair');
    else rating = chalk.red('Needs improvement');
    
    console.log(`\nPerformance rating: ${rating}`);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const projectPath = args[0] || process.cwd();

  if (!fs.existsSync(projectPath)) {
    console.error(chalk.red(`Error: Path ${projectPath} does not exist`));
    process.exit(1);
  }

  try {
    const results = await runBenchmark(projectPath);
    displayResults(results);
    
    // Save results to file
    const resultsPath = path.join(process.cwd(), 'benchmark-results.json');
    fs.writeFileSync(resultsPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      projectPath,
      results
    }, null, 2));
    
    console.log(chalk.gray(`\nResults saved to: ${resultsPath}`));
  } catch (error) {
    console.error(chalk.red('Benchmark failed:'), error);
    process.exit(1);
  }
}

main().catch(console.error);
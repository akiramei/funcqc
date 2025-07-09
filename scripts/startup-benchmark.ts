#!/usr/bin/env tsx
/**
 * Startup performance benchmark for funcqc
 * Measures CLI startup time and memory usage for different commands
 */

import { performance } from 'perf_hooks';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

interface StartupBenchmarkResult {
  command: string;
  iterations: number;
  avgStartupTime: number;
  minStartupTime: number;
  maxStartupTime: number;
  stdDeviation: number;
  memoryUsage: number;
  exitCode: number;
}

interface MemorySnapshot {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

class StartupBenchmark {
  private iterations: number;
  private warmupIterations: number;
  private testDbPath: string;

  constructor(iterations: number = 10, warmupIterations: number = 2) {
    this.iterations = iterations;
    this.warmupIterations = warmupIterations;
    this.testDbPath = path.join(process.cwd(), '.startup-benchmark-db');
  }

  async run(): Promise<StartupBenchmarkResult[]> {
    console.log(chalk.blue('🚀 funcqc Startup Performance Benchmark\n'));
    
    await this.prepareTestEnvironment();
    
    try {
      const commands = [
        'help',
        'list',
        'list --cc-ge 10',
        'show --help',
        'search --help',
        'health',
        'history --help',
        'diff --help',
        'explain --help'
      ];

      const results: StartupBenchmarkResult[] = [];

      for (const cmd of commands) {
        console.log(chalk.gray(`Testing: ${cmd}`));
        const result = await this.benchmarkCommand(cmd);
        results.push(result);
        
        // Show quick results
        console.log(chalk.green(`  ✓ ${result.avgStartupTime.toFixed(0)}ms avg (${result.minStartupTime.toFixed(0)}-${result.maxStartupTime.toFixed(0)}ms)`));
      }

      return results;
    } finally {
      await this.cleanup();
    }
  }

  private async prepareTestEnvironment(): Promise<void> {
    // Clean up any existing test database
    if (fs.existsSync(this.testDbPath)) {
      fs.rmSync(this.testDbPath, { recursive: true });
    }

    // Create a minimal test database for commands that need it
    try {
      execSync(`npm run --silent dev -- init --db ${this.testDbPath} --root test/fixtures`, {
        stdio: 'pipe',
        cwd: process.cwd()
      });
      
      execSync(`npm run --silent dev -- scan --comment "Startup benchmark test"`, {
        stdio: 'pipe',
        cwd: process.cwd(),
        env: { ...process.env, FUNCQC_DB_PATH: this.testDbPath }
      });
    } catch (error) {
      console.warn('Failed to create test database, some commands may fail');
    }
  }

  private async benchmarkCommand(command: string): Promise<StartupBenchmarkResult> {
    const times: number[] = [];
    const memories: number[] = [];
    let lastExitCode = 0;

    // Warmup iterations
    for (let i = 0; i < this.warmupIterations; i++) {
      try {
        execSync(`npm run --silent dev -- ${command}`, {
          stdio: 'pipe',
          cwd: process.cwd(),
          env: { ...process.env, FUNCQC_DB_PATH: this.testDbPath }
        });
      } catch (error) {
        // Ignore warmup errors
      }
    }

    // Actual benchmark iterations
    for (let i = 0; i < this.iterations; i++) {
      const startTime = performance.now();
      
      try {
        const result = execSync(`npm run --silent dev -- ${command}`, {
          stdio: 'pipe',
          cwd: process.cwd(),
          env: { ...process.env, FUNCQC_DB_PATH: this.testDbPath },
          timeout: 30000 // 30 second timeout
        });
        
        lastExitCode = 0;
      } catch (error: any) {
        lastExitCode = error.status || 1;
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      times.push(duration);
      
      // Memory usage approximation (not precise but gives relative comparison)
      const memoryUsage = process.memoryUsage();
      memories.push(memoryUsage.heapUsed / 1024 / 1024); // MB
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const avgMemory = memories.reduce((a, b) => a + b, 0) / memories.length;
    
    // Calculate standard deviation
    const variance = times.reduce((acc, time) => acc + Math.pow(time - avgTime, 2), 0) / times.length;
    const stdDev = Math.sqrt(variance);

    return {
      command,
      iterations: this.iterations,
      avgStartupTime: avgTime,
      minStartupTime: minTime,
      maxStartupTime: maxTime,
      stdDeviation: stdDev,
      memoryUsage: avgMemory,
      exitCode: lastExitCode
    };
  }

  private async cleanup(): Promise<void> {
    if (fs.existsSync(this.testDbPath)) {
      fs.rmSync(this.testDbPath, { recursive: true });
    }
  }
}

function displayResults(results: StartupBenchmarkResult[]): void {
  console.log(chalk.blue('\n📊 Startup Performance Results\n'));
  
  console.log('Command                     Iterations  Avg(ms)  Min(ms)  Max(ms)  StdDev  Memory(MB)  Status');
  console.log('-'.repeat(90));
  
  for (const result of results) {
    const command = result.command.padEnd(25);
    const iterations = result.iterations.toString().padStart(10);
    const avg = result.avgStartupTime.toFixed(0).padStart(7);
    const min = result.minStartupTime.toFixed(0).padStart(7);
    const max = result.maxStartupTime.toFixed(0).padStart(7);
    const stdDev = result.stdDeviation.toFixed(1).padStart(6);
    const memory = result.memoryUsage.toFixed(1).padStart(10);
    const status = result.exitCode === 0 ? chalk.green('✓') : chalk.red('✗');
    
    console.log(`${command} ${iterations} ${avg} ${min} ${max} ${stdDev} ${memory}  ${status}`);
  }

  // Performance summary
  console.log(chalk.blue('\n🎯 Performance Summary\n'));
  
  const avgStartupTime = results.reduce((acc, r) => acc + r.avgStartupTime, 0) / results.length;
  const fastestCommand = results.reduce((min, r) => r.avgStartupTime < min.avgStartupTime ? r : min);
  const slowestCommand = results.reduce((max, r) => r.avgStartupTime > max.avgStartupTime ? r : max);
  
  console.log(`Average startup time: ${avgStartupTime.toFixed(0)}ms`);
  console.log(`Fastest command: ${fastestCommand.command} (${fastestCommand.avgStartupTime.toFixed(0)}ms)`);
  console.log(`Slowest command: ${slowestCommand.command} (${slowestCommand.avgStartupTime.toFixed(0)}ms)`);
  
  // Performance rating
  let rating = '';
  if (avgStartupTime < 500) rating = chalk.green('Excellent');
  else if (avgStartupTime < 1000) rating = chalk.blue('Good');
  else if (avgStartupTime < 2000) rating = chalk.yellow('Fair');
  else rating = chalk.red('Needs improvement');
  
  console.log(`Overall rating: ${rating}`);
  
  // Recommendations
  console.log(chalk.blue('\n💡 Optimization Opportunities\n'));
  
  const slowCommands = results.filter(r => r.avgStartupTime > avgStartupTime * 1.2);
  if (slowCommands.length > 0) {
    console.log('Commands slower than average:');
    slowCommands.forEach(cmd => {
      console.log(`  - ${cmd.command}: ${cmd.avgStartupTime.toFixed(0)}ms`);
    });
  }
  
  const highVarianceCommands = results.filter(r => r.stdDeviation > 100);
  if (highVarianceCommands.length > 0) {
    console.log('\nCommands with high variance (inconsistent performance):');
    highVarianceCommands.forEach(cmd => {
      console.log(`  - ${cmd.command}: ±${cmd.stdDeviation.toFixed(1)}ms`);
    });
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const iterations = args[0] ? parseInt(args[0]) : 10;
  
  if (isNaN(iterations) || iterations < 1) {
    console.error(chalk.red('Error: Iterations must be a positive integer'));
    process.exit(1);
  }

  try {
    const benchmark = new StartupBenchmark(iterations);
    const results = await benchmark.run();
    
    displayResults(results);
    
    // Save results to file
    const resultsPath = path.join(process.cwd(), 'startup-benchmark-results.json');
    fs.writeFileSync(resultsPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      iterations,
      results,
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch
      }
    }, null, 2));
    
    console.log(chalk.gray(`\nResults saved to: ${resultsPath}`));
    
  } catch (error) {
    console.error(chalk.red('Benchmark failed:'), error);
    process.exit(1);
  }
}

main().catch(console.error);
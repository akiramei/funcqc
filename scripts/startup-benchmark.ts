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
        // Lightweight commands
        'help',
        'list',
        'list --cc-ge 10',
        'show --help',
        'search --help',
        'health',
        'history --help',
        'diff --help',
        'explain --help',
        // Heavier commands to measure dynamic import overhead
        'evaluate --help',
        'refactor analyze --help',
        'refactor detect --help',
        'refactor track --help',
        'lineage review --help'
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
    // Verify test fixtures directory exists
    const fixturesPath = path.join(process.cwd(), 'test/fixtures');
    if (!fs.existsSync(fixturesPath)) {
      throw new Error('Test fixtures directory not found. Please ensure test/fixtures exists with sample TypeScript files.');
    }

    // Verify npm scripts exist
    try {
      const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
      if (!packageJson.scripts?.dev) {
        throw new Error('npm run dev script not found in package.json');
      }
    } catch (error) {
      throw new Error('Failed to read package.json or verify scripts: ' + (error instanceof Error ? error.message : error));
    }

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
      console.warn('Failed to create test database, some commands may fail:', error instanceof Error ? error.message : error);
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
          timeout: 10000 // 10 second timeout - more appropriate for startup benchmarking
        });
        
        lastExitCode = 0;
      } catch (error: any) {
        lastExitCode = error.status || 1;
        
        // Log timeout errors specifically
        if (error.code === 'ETIMEDOUT') {
          console.warn(chalk.yellow(`  ⚠ Command timed out after 10s: ${command}`));
        } else if (process.env.DEBUG) {
          console.debug(`  Command failed: ${command}`, error.message);
        }
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      times.push(duration);
      
      // Note: This measures parent process memory, not actual CLI process memory
      // Real CLI memory usage would require process monitoring or child_process.spawn
      // with memory tracking. Current measurement provides relative comparison only.
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
  
  // Define heavy commands that use dynamic imports
  const HEAVY_COMMANDS = ['evaluate', 'refactor', 'lineage'];
  
  // Separate commands by type
  const commandCategories = {
    lightweight: results.filter(r => !HEAVY_COMMANDS.some(cmd => r.command.includes(cmd))),
    heavy: results.filter(r => HEAVY_COMMANDS.some(cmd => r.command.includes(cmd)))
  };
  
  const lightweightCmds = commandCategories.lightweight;
  const heavyCmds = commandCategories.heavy;
  
  const avgStartupTime = results.reduce((acc, r) => acc + r.avgStartupTime, 0) / results.length;
  const avgLightweight = lightweightCmds.reduce((acc, r) => acc + r.avgStartupTime, 0) / lightweightCmds.length;
  const avgHeavy = heavyCmds.length > 0 ? heavyCmds.reduce((acc, r) => acc + r.avgStartupTime, 0) / heavyCmds.length : 0;
  
  const fastestCommand = results.reduce((min, r) => r.avgStartupTime < min.avgStartupTime ? r : min);
  const slowestCommand = results.reduce((max, r) => r.avgStartupTime > max.avgStartupTime ? r : max);
  
  console.log(`Overall average: ${avgStartupTime.toFixed(0)}ms`);
  console.log(`Lightweight commands average: ${avgLightweight.toFixed(0)}ms`);
  if (heavyCmds.length > 0) {
    console.log(`Heavy commands average: ${avgHeavy.toFixed(0)}ms`);
    console.log(`Dynamic import overhead: ${(avgHeavy - avgLightweight).toFixed(0)}ms`);
  }
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
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultsPath = path.join(process.cwd(), `startup-benchmark-results-${timestamp}.json`);
    
    try {
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
      console.warn(chalk.yellow('\n⚠ Warning: Failed to save results to file'), error instanceof Error ? error.message : error);
    }
    
  } catch (error) {
    console.error(chalk.red('Benchmark failed:'), error);
    process.exit(1);
  }
}

main().catch(console.error);
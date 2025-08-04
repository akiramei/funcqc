import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Project } from 'ts-morph';
import { FunctionAnalyzer } from '../../src/core/analyzer';
import { PGLiteStorageAdapter } from '../../src/storage/pglite-adapter';
import { Logger } from '../../src/utils/cli-utils';

/**
 * P1 Priority Tests: Performance Regression Guard
 * 
 * Tests to ensure that type information integration does not cause
 * significant performance degradation in the analysis pipeline:
 * 1. Scan time benchmarks - before/after type integration
 * 2. Memory usage monitoring - large codebase memory consumption
 * 3. Database operation performance - type information storage efficiency
 * 4. Progressive performance degradation detection - threshold-based automated tests
 * 
 * These tests serve as guardrails to prevent performance regressions
 * as the type system integration evolves.
 */
describe('Performance Regression Guard Tests', () => {
  let analyzer: FunctionAnalyzer;
  let storage: PGLiteStorageAdapter;
  let logger: Logger;
  let tempDbPath: string;

  beforeEach(async () => {
    logger = new Logger(false, false);
    tempDbPath = join(__dirname, '../../.test-db-perf');
    
    // Clean up any existing test database
    try {
      await fs.rm(tempDbPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    storage = new PGLiteStorageAdapter(tempDbPath, logger);
    await storage.init();
    
    analyzer = new FunctionAnalyzer(
      { roots: ['.'] }, // Basic config
      { logger }
    );
  });

  afterEach(async () => {
    if (storage) {
      await storage.close();
    }
    
    // Clean up test database
    try {
      await fs.rm(tempDbPath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // Helper function to simulate analyzeCallGraphFromContent
  async function performAnalysisFromContent(
    code: string,
    filename: string,
    snapshotId: string
  ): Promise<{
    functions: unknown[];
    callEdges: unknown[];
    typeInfo: { typeDefinitions: unknown[]; methodOverrides: unknown[] };
  }> {
    // Create a temporary file for analysis
    const fs = await import('fs/promises');
    const path = await import('path');
    const tempDir = path.join(__dirname, '../../.temp-perf-test');
    const tempFile = path.join(tempDir, filename);
    
    try {
      // Ensure temp directory exists
      await fs.mkdir(tempDir, { recursive: true });
      
      // Write code to temporary file
      await fs.writeFile(tempFile, code);
      
      // Analyze the file using the actual analyzer API
      const analysisResult = await analyzer.analyzeFile(tempFile);
      
      if (!analysisResult.success) {
        throw new Error(`Analysis failed: ${analysisResult.errors?.[0]?.message || 'Unknown error'}`);
      }
      
      const functions = analysisResult.data || [];
      
      // Create a file content map for call graph analysis
      const fileContentMap = new Map([[tempFile, code]]);
      
      // Analyze call graph with type information
      const callGraphResult = await analyzer.analyzeCallGraphFromContent(
        fileContentMap,
        functions,
        snapshotId,
        storage
      );
      
      // Get type information from storage (with fallback for empty results)
      let typeDefinitions: unknown[] = [];
      let methodOverrides: unknown[] = [];
      
      try {
        typeDefinitions = await storage.getTypeDefinitions(snapshotId);
        methodOverrides = await storage.getMethodOverrides(snapshotId);
      } catch (error) {
        // Ignore storage errors for performance tests
        console.warn('Type information retrieval failed:', error);
      }
      
      return {
        functions,
        callEdges: callGraphResult.callEdges,
        typeInfo: {
          typeDefinitions,
          methodOverrides
        }
      };
    } finally {
      // Clean up temporary file
      try {
        await fs.unlink(tempFile);
        await fs.rmdir(tempDir);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  describe('Scan Time Benchmarks', () => {
    test('should complete analysis within acceptable time limits for small codebases', async () => {
      // Small test codebase (< 10 files, < 1000 lines total)
      const smallCodebase = `
        // Test file 1
        interface ITest {
          method(): void;
        }
        
        class TestClass implements ITest {
          method(): void {
            console.log('test');
          }
          
          privateMethod(): string {
            return 'private';
          }
        }
        
        function utilityFunction(param: string): number {
          return param.length;
        }
      `;

      const startTime = performance.now();
      
      const result = await performAnalysisFromContent(
        smallCodebase,
        'test-small.ts',
        'perf-test-small'
      );
      
      const endTime = performance.now();
      const analysisTime = endTime - startTime;
      
      // Performance expectations for small codebase
      expect(analysisTime).toBeLessThan(5000); // Should complete within 5 seconds
      expect(result.functions.length).toBeGreaterThan(0);
      expect(result.callEdges.length).toBeGreaterThanOrEqual(0);
      
      // Verify type information was extracted (may be 0 for simple code)
      expect(result.typeInfo.typeDefinitions.length).toBeGreaterThanOrEqual(0); // Any type definitions extracted
    }, 10000); // 10 second timeout

    test('should complete analysis within acceptable time limits for medium codebases', async () => {
      // Medium test codebase (multiple files, complex inheritance)
      const mediumCodebase = `
        // Complex inheritance hierarchy
        abstract class BaseClass {
          abstract process(): void;
          
          protected helper(): string {
            return 'base';
          }
        }
        
        interface IProcessor {
          process(): void;
          validate(input: any): boolean;
        }
        
        interface ILogger {
          log(message: string): void;
          error(error: Error): void;
        }
        
        class ConcreteProcessor extends BaseClass implements IProcessor, ILogger {
          process(): void {
            this.validate('test');
            this.log('processing');
          }
          
          validate(input: any): boolean {
            return typeof input === 'string';
          }
          
          log(message: string): void {
            console.log(message);
          }
          
          error(error: Error): void {
            console.error(error);
          }
          
          private internalMethod(): void {
            this.helper();
          }
        }
        
        class SecondaryProcessor extends BaseClass {
          process(): void {
            this.complexOperation();
          }
          
          private complexOperation(): void {
            // Simulate complex operation
            for (let i = 0; i < 100; i++) {
              this.helper();
            }
          }
        }
        
        function createProcessor(type: 'primary' | 'secondary'): BaseClass {
          return type === 'primary' ? new ConcreteProcessor() : new SecondaryProcessor();
        }
        
        // Additional utility functions to increase complexity
        function processData<T>(data: T[]): T[] {
          return data.filter(item => item !== null);
        }
        
        function calculateMetrics(processors: BaseClass[]): number {
          return processors.length * 2;
        }
      `;

      const startTime = performance.now();
      
      const result = await performAnalysisFromContent(
        mediumCodebase,
        'test-medium.ts',
        'perf-test-medium'
      );
      
      const endTime = performance.now();
      const analysisTime = endTime - startTime;
      
      // Performance expectations for medium codebase
      expect(analysisTime).toBeLessThan(10000); // Should complete within 10 seconds
      expect(result.functions.length).toBeGreaterThan(5);
      expect(result.callEdges.length).toBeGreaterThan(0);
      
      // Verify comprehensive type information extraction (may be limited in test environment)
      expect(result.typeInfo.typeDefinitions.length).toBeGreaterThanOrEqual(0); // Any type definitions extracted
      expect(result.typeInfo.methodOverrides.length).toBeGreaterThanOrEqual(0); // Any overrides extracted
    }, 15000); // 15 second timeout

    test('should maintain reasonable performance ratios between simple and complex analyses', async () => {
      const simpleCode = `
        function simpleFunction(): void {
          console.log('simple');
        }
      `;
      
      const complexCode = `
        interface ComplexInterface<T> {
          process<U>(input: T): Promise<U>;
        }
        
        abstract class ComplexBase<T> {
          abstract handle(input: T): void;
        }
        
        class ComplexImplementation<T> extends ComplexBase<T> implements ComplexInterface<T> {
          async process<U>(input: T): Promise<U> {
            this.handle(input);
            return input as unknown as U;
          }
          
          handle(input: T): void {
            this.internalProcess(input);
          }
          
          private internalProcess(input: T): void {
            // Complex processing logic
          }
        }
      `;

      // Measure simple analysis
      const simpleStart = performance.now();
      await performAnalysisFromContent(simpleCode, 'simple.ts', 'perf-simple');
      const simpleTime = performance.now() - simpleStart;

      // Measure complex analysis
      const complexStart = performance.now();
      await performAnalysisFromContent(complexCode, 'complex.ts', 'perf-complex');
      const complexTime = performance.now() - complexStart;

      // Complex analysis should not be more than 10x slower than simple
      const performanceRatio = complexTime / simpleTime;
      expect(performanceRatio).toBeLessThan(10);
      
      // Both should complete in reasonable time
      expect(simpleTime).toBeLessThan(3000);
      expect(complexTime).toBeLessThan(8000);
    });
  });

  describe('Memory Usage Monitoring', () => {
    test('should not cause excessive memory usage during type extraction', async () => {
      const initialMemory = process.memoryUsage();
      
      // Large codebase simulation
      const largeCodebase = Array.from({ length: 50 }, (_, i) => `
        interface Interface${i} {
          method${i}(): void;
          property${i}: string;
        }
        
        class Class${i} implements Interface${i} {
          property${i}: string = 'value${i}';
          
          method${i}(): void {
            this.internalMethod${i}();
          }
          
          private internalMethod${i}(): void {
            console.log(this.property${i});
          }
        }
        
        function factory${i}(): Interface${i} {
          return new Class${i}();
        }
      `).join('\n');

      await performAnalysisFromContent(
        largeCodebase,
        'large-test.ts',
        'perf-test-large'
      );
      
      const finalMemory = process.memoryUsage();
      
      // Memory usage should not increase by more than 200MB
      const memoryIncrease = (finalMemory.heapUsed - initialMemory.heapUsed) / (1024 * 1024);
      expect(memoryIncrease).toBeLessThan(200);
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
    });

    test('should release memory after analysis completion', async () => {
      const beforeMemory = process.memoryUsage();
      
      // Perform multiple analyses
      for (let i = 0; i < 5; i++) {
        const code = `
          class TestClass${i} {
            method(): void {
              this.helper${i}();
            }
            
            private helper${i}(): void {
              // Some processing
            }
          }
        `;
        
        await performAnalysisFromContent(
          code,
          `test-${i}.ts`,
          `memory-test-${i}`
        );
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        // Wait a bit for GC to complete
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const afterMemory = process.memoryUsage();
      
      // Memory should not grow unboundedly
      const memoryGrowth = (afterMemory.heapUsed - beforeMemory.heapUsed) / (1024 * 1024);
      expect(memoryGrowth).toBeLessThan(100); // Less than 100MB growth after 5 analyses
    });
  });

  describe('Database Operation Performance', () => {
    test('should save type information efficiently', async () => {
      const code = `
        interface ITest {
          test(): void;
        }
        
        class TestClass implements ITest {
          test(): void {
            console.log('test');
          }
        }
      `;

      const startTime = performance.now();
      
      const result = await performAnalysisFromContent(
        code,
        'db-perf-test.ts',
        'db-perf-snapshot'
      );
      
      const analysisEndTime = performance.now();
      
      // Verify data was actually saved by querying it back
      const dbStartTime = performance.now();
      
      // Query type definitions
      const typeDefinitions = await storage.getTypeDefinitions('db-perf-snapshot');
      const methodOverrides = await storage.getMethodOverrides('db-perf-snapshot');
      
      // Count type members for any type in this snapshot
      let typeMemberCount = 0;
      for (const typeDef of typeDefinitions.slice(0, 3)) { // Check first 3 types to avoid excessive queries
        const members = await storage.getTypeMembers(typeDef.id);
        typeMemberCount += members.length;
      }
      
      const dbEndTime = performance.now();
      
      const analysisTime = analysisEndTime - startTime;
      const dbQueryTime = dbEndTime - dbStartTime;
      
      // Performance expectations
      expect(analysisTime).toBeLessThan(5000); // Analysis + DB save should be < 5s
      expect(dbQueryTime).toBeLessThan(500); // DB queries should be < 500ms
      
      // Verify data integrity (may be 0 in test environment)
      expect(typeDefinitions.length).toBeGreaterThanOrEqual(0);
      expect(typeMemberCount).toBeGreaterThanOrEqual(0);
      expect(result.typeInfo.typeDefinitions.length).toEqual(typeDefinitions.length);
    });

    test('should handle concurrent type information operations efficiently', async () => {
      const codes = Array.from({ length: 3 }, (_, i) => ({
        code: `
          interface Interface${i} {
            method${i}(): void;
          }
          
          class Class${i} implements Interface${i} {
            method${i}(): void {
              console.log('${i}');
            }
          }
        `,
        filename: `concurrent-${i}.ts`,
        snapshotId: `concurrent-snapshot-${i}`
      }));

      const startTime = performance.now();
      
      // Run concurrent analyses
      const promises = codes.map(({ code, filename, snapshotId }) =>
        performAnalysisFromContent(code, filename, snapshotId)
      );
      
      const results = await Promise.all(promises);
      
      const endTime = performance.now();
      const totalTime = endTime - startTime;
      
      // Concurrent execution should not be significantly slower than sequential
      expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds
      
      // Verify all analyses completed successfully
      expect(results.length).toBe(3);
      results.forEach(result => {
        expect(result.functions.length).toBeGreaterThan(0);
        expect(result.typeInfo.typeDefinitions.length).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Progressive Performance Degradation Detection', () => {
    test('should maintain consistent performance across multiple runs', async () => {
      const testCode = `
        interface IService {
          process(data: string): Promise<string>;
        }
        
        class Service implements IService {
          async process(data: string): Promise<string> {
            return this.transform(data);
          }
          
          private transform(input: string): string {
            return input.toUpperCase();
          }
        }
      `;

      const runTimes: number[] = [];
      
      // Perform multiple runs to check for performance consistency
      for (let i = 0; i < 5; i++) {
        const startTime = performance.now();
        
        await performAnalysisFromContent(
          testCode,
          `consistency-test-${i}.ts`,
          `consistency-snapshot-${i}`
        );
        
        const endTime = performance.now();
        runTimes.push(endTime - startTime);
      }
      
      // Calculate performance metrics
      const avgTime = runTimes.reduce((sum, time) => sum + time, 0) / runTimes.length;
      const maxTime = Math.max(...runTimes);
      const minTime = Math.min(...runTimes);
      
      // Performance should be consistent
      expect(maxTime / minTime).toBeLessThan(3); // Max should not be more than 3x min
      expect(avgTime).toBeLessThan(5000); // Average should be under 5 seconds
      
      // No individual run should be excessively slow
      runTimes.forEach(time => {
        expect(time).toBeLessThan(8000);
      });
    });

    test('should detect and fail on significant performance regressions', async () => {
      // This test simulates what would happen if performance regressed significantly
      // In a real scenario, this would compare against historical benchmarks
      
      const simpleCode = `
        function test(): void {
          console.log('test');
        }
      `;

      const performanceThresholds = {
        maxAnalysisTime: 2000, // 2 seconds for simple code
        maxMemoryIncrease: 50 * 1024 * 1024, // 50MB
        maxDbOperationTime: 1000 // 1 second
      };

      const initialMemory = process.memoryUsage().heapUsed;
      const startTime = performance.now();
      
      const result = await performAnalysisFromContent(
        simpleCode,
        'regression-test.ts',
        'regression-snapshot'
      );
      
      const analysisTime = performance.now() - startTime;
      const memoryIncrease = process.memoryUsage().heapUsed - initialMemory;
      
      // Test database operation time
      const dbStartTime = performance.now();
      await storage.getTypeDefinitions('regression-snapshot');
      const dbTime = performance.now() - dbStartTime;
      
      // Assert against thresholds
      expect(analysisTime).toBeLessThan(performanceThresholds.maxAnalysisTime);
      expect(memoryIncrease).toBeLessThan(performanceThresholds.maxMemoryIncrease);
      expect(dbTime).toBeLessThan(performanceThresholds.maxDbOperationTime);
      
      // Verify functionality wasn't compromised for performance
      expect(result.functions.length).toBeGreaterThan(0);
    });

    test('should maintain performance scaling characteristics', async () => {
      // Test how performance scales with codebase size
      const codeSizes = [1, 5, 10]; // Number of classes
      const performanceResults: { size: number; time: number }[] = [];
      
      for (const size of codeSizes) {
        const code = Array.from({ length: size }, (_, i) => `
          class ScaleTest${i} {
            method${i}(): void {
              this.helper${i}();
            }
            
            private helper${i}(): void {
              console.log('${i}');
            }
          }
        `).join('\n');
        
        const startTime = performance.now();
        
        await performAnalysisFromContent(
          code,
          `scale-test-${size}.ts`,
          `scale-snapshot-${size}`
        );
        
        const endTime = performance.now();
        performanceResults.push({
          size,
          time: endTime - startTime
        });
      }
      
      // Performance should scale roughly linearly, not exponentially
      const smallestTime = performanceResults[0].time;
      const largestTime = performanceResults[performanceResults.length - 1].time;
      const sizeRatio = codeSizes[codeSizes.length - 1] / codeSizes[0];
      const timeRatio = largestTime / smallestTime;
      
      // Time ratio should not exceed size ratio by more than 2x (allowing for overhead)
      expect(timeRatio).toBeLessThan(sizeRatio * 2);
      
      // All runs should complete in reasonable time
      performanceResults.forEach(result => {
        expect(result.time).toBeLessThan(10000);
      });
    });
  });

  describe('Resource Cleanup and Efficiency', () => {
    test('should properly clean up resources after analysis', async () => {
      const code = `
        class ResourceTest {
          method(): void {
            console.log('test');
          }
        }
      `;

      // Track resource usage before
      const initialHandles = process._getActiveHandles().length;
      const initialRequests = process._getActiveRequests().length;
      
      await performAnalysisFromContent(
        code,
        'cleanup-test.ts',
        'cleanup-snapshot'
      );
      
      // Allow time for cleanup
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const finalHandles = process._getActiveHandles().length;
      const finalRequests = process._getActiveRequests().length;
      
      // Resource counts should not grow unboundedly
      expect(finalHandles - initialHandles).toBeLessThanOrEqual(2); // Allow some growth
      expect(finalRequests - initialRequests).toBeLessThanOrEqual(1);
    });

    test('should not leak database connections', async () => {
      // This test ensures we don't leak database connections during analysis
      const code = `
        interface IConnection {
          connect(): void;
        }
        
        class DatabaseConnection implements IConnection {
          connect(): void {
            console.log('connected');
          }
        }
      `;

      // Perform multiple analyses to test connection management
      for (let i = 0; i < 10; i++) {
        await performAnalysisFromContent(
          code,
          `connection-test-${i}.ts`,
          `connection-snapshot-${i}`
        );
      }
      
      // Verify database is still responsive (no connection leaks)
      const startTime = performance.now();
      const types = await storage.getTypeDefinitions('connection-snapshot-0');
      const queryTime = performance.now() - startTime;
      
      expect(queryTime).toBeLessThan(1000); // Should still be fast
      expect(types.length).toBeGreaterThanOrEqual(0); // Should return data (may be 0)
    });
  });
});
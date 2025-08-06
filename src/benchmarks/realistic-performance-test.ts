/**
 * Realistic performance test using actual funcqc project data
 */

import { performance } from 'perf_hooks';
import { FunctionAnalyzer } from '../core/analyzer';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { StorageAdapter } from '../types';

interface TestResults {
  description: string;
  executionTime: number;
  callEdgesFound: number;
  functionsAnalyzed: number;
  memoryUsed: number;
  cacheStats?: {
    hits: number;
    misses: number;
    hitRate: number;
  };
}

async function getLatestSnapshotData(storage: StorageAdapter) {
  const snapshots = await storage.getSnapshots({ limit: 1 });
  if (snapshots.length === 0) {
    throw new Error('No snapshots found. Please run `funcqc scan` first.');
  }

  const snapshot = snapshots[0];
  const functions = await storage.findFunctionsInSnapshot(snapshot.id);
  const sourceFiles = await storage.getSourceFilesBySnapshot(snapshot.id);
  
  return { snapshot, functions, sourceFiles };
}

async function runRealisticPerformanceTest(): Promise<void> {
  console.log('🚀 Realistic CallGraphAnalyzer Performance Test');
  console.log('============================================\n');

  // Setup storage and get real project data
  const configManager = new ConfigManager();
  const config = await configManager.load();
  const storage = new PGLiteStorageAdapter(config.storage?.path || '.funcqc/funcqc.db');

  let testData;
  try {
    testData = await getLatestSnapshotData(storage);
  } catch (error) {
    console.log(`❌ Error loading test data: ${error}`);
    console.log('Please run `funcqc scan` first to create test data.');
    return;
  }

  const { snapshot, functions, sourceFiles } = testData;
  console.log(`📊 Test Dataset:`);
  console.log(`   Snapshot ID: ${snapshot.id.substring(0, 8)}...`);
  console.log(`   Functions: ${functions.length}`);
  console.log(`   Source Files: ${sourceFiles.length}`);
  console.log(`   Snapshot Date: ${new Date(snapshot.createdAt).toLocaleString()}\n`);

  // Test 1: Original implementation (measure existing call graph)
  console.log('📊 Test 1: Loading existing call graph data...');
  const test1Start = performance.now();
  const memBefore1 = process.memoryUsage().heapUsed / 1024 / 1024;

  const existingCallEdges = await storage.getCallEdgesBySnapshot(snapshot.id);
  const existingInternalEdges = await storage.getInternalCallEdgesBySnapshot(snapshot.id);
  
  const test1Time = performance.now() - test1Start;
  const memAfter1 = process.memoryUsage().heapUsed / 1024 / 1024;

  const test1Results: TestResults = {
    description: 'Existing Call Graph Data (DB Load)',
    executionTime: test1Time,
    callEdgesFound: existingCallEdges.length + existingInternalEdges.length,
    functionsAnalyzed: functions.length,
    memoryUsed: memAfter1 - memBefore1
  };

  console.log(`✅ Test 1 completed in ${test1Time.toFixed(2)}ms`);
  console.log(`   Call Edges: ${existingCallEdges.length} (external) + ${existingInternalEdges.length} (internal) = ${test1Results.callEdgesFound} total\n`);

  // Test 2: Re-analyze with optimized CallGraphAnalyzer
  console.log('🚀 Test 2: Re-analyzing with optimized CallGraphAnalyzer...');
  const test2Start = performance.now();
  const memBefore2 = process.memoryUsage().heapUsed / 1024 / 1024;

  const analyzer = new FunctionAnalyzer(config);
  
  // Create file content map from stored source files
  const fileContentMap = new Map<string, string>();
  sourceFiles.forEach(file => {
    fileContentMap.set(file.filePath, file.fileContent);
  });

  // Analyze call graph with performance measurement enabled
  process.env['FUNCQC_DEBUG_PERFORMANCE'] = 'true';
  
  const analysisResult = await analyzer.analyzeCallGraphFromContent(
    fileContentMap,
    functions,
    'temp', // Use temp snapshot ID
    storage
  );

  const test2Time = performance.now() - test2Start;
  const memAfter2 = process.memoryUsage().heapUsed / 1024 / 1024;

  const test2Results: TestResults = {
    description: 'Fresh Analysis (Optimized)',
    executionTime: test2Time,
    callEdgesFound: analysisResult.callEdges.length + analysisResult.internalCallEdges.length,
    functionsAnalyzed: functions.length,
    memoryUsed: memAfter2 - memBefore2
  };

  console.log(`✅ Test 2 completed in ${test2Time.toFixed(2)}ms`);
  console.log(`   Call Edges: ${analysisResult.callEdges.length} (external) + ${analysisResult.internalCallEdges.length} (internal) = ${test2Results.callEdgesFound} total\n`);

  // Test 3: Measure import resolution performance specifically
  console.log('🔍 Test 3: Import resolution stress test...');
  
  // Select files with many imports for focused testing
  const complexFiles = sourceFiles
    .filter(f => f.fileContent.includes('import') && f.fileContent.split('import').length > 10)
    .slice(0, 10); // Test first 10 complex files

  console.log(`   Testing ${complexFiles.length} files with heavy import usage`);
  
  const test3Start = performance.now();
  const memBefore3 = process.memoryUsage().heapUsed / 1024 / 1024;

  let test3CallEdges = 0;
  for (const sourceFile of complexFiles) {
    const fileFunctions = functions.filter(f => f.filePath === sourceFile.filePath);
    
    if (fileFunctions.length > 0) {
      // Create a subset analysis for this specific file
      const fileContentMapSubset = new Map();
      fileContentMapSubset.set(sourceFile.filePath, sourceFile.fileContent);
      
      const fileResult = await analyzer.analyzeCallGraphFromContent(
        fileContentMapSubset,
        fileFunctions,
        'temp-file-test',
        storage
      );
      
      test3CallEdges += fileResult.callEdges.length + fileResult.internalCallEdges.length;
    }
  }

  const test3Time = performance.now() - test3Start;
  const memAfter3 = process.memoryUsage().heapUsed / 1024 / 1024;

  const test3Results: TestResults = {
    description: 'Import-Heavy Files Analysis',
    executionTime: test3Time,
    callEdgesFound: test3CallEdges,
    functionsAnalyzed: complexFiles.reduce((sum, f) => sum + functions.filter(fn => fn.filePath === f.filePath).length, 0),
    memoryUsed: memAfter3 - memBefore3
  };

  console.log(`✅ Test 3 completed in ${test3Time.toFixed(2)}ms`);
  console.log(`   Call Edges: ${test3CallEdges} from ${test3Results.functionsAnalyzed} functions\n`);

  // Performance comparison results
  console.log('📈 PERFORMANCE TEST RESULTS');
  console.log('===========================\n');

  const tests = [test1Results, test2Results, test3Results];
  
  tests.forEach((test, index) => {
    console.log(`🧪 Test ${index + 1}: ${test.description}`);
    console.log(`   ⏱️  Execution Time: ${test.executionTime.toFixed(2)}ms`);
    console.log(`   🔗 Call Edges Found: ${test.callEdgesFound}`);
    console.log(`   ⚙️  Functions Analyzed: ${test.functionsAnalyzed}`);
    console.log(`   🧠 Memory Used: ${test.memoryUsed.toFixed(1)}MB`);
    
    if (test.functionsAnalyzed > 0) {
      console.log(`   📊 Performance Ratios:`);
      console.log(`      ${(test.executionTime / test.functionsAnalyzed).toFixed(2)}ms per function`);
      console.log(`      ${(test.callEdgesFound / test.functionsAnalyzed).toFixed(2)} edges per function`);
    }
    console.log('');
  });

  // Efficiency Analysis
  console.log('🎯 EFFICIENCY ANALYSIS');
  console.log('======================\n');

  // Compare DB load vs fresh analysis
  const dbVsAnalysis = test2Results.executionTime / test1Results.executionTime;
  console.log(`📊 DB Load vs Fresh Analysis:`);
  console.log(`   DB Load Time: ${test1Results.executionTime.toFixed(2)}ms`);
  console.log(`   Fresh Analysis Time: ${test2Results.executionTime.toFixed(2)}ms`);
  console.log(`   Ratio: ${dbVsAnalysis.toFixed(2)}x (${dbVsAnalysis > 1 ? 'slower' : 'faster'})\n`);

  // Quality of analysis
  const edgeDetectionImprovement = ((test2Results.callEdgesFound - test1Results.callEdgesFound) / test1Results.callEdgesFound * 100);
  console.log(`🔍 Call Edge Detection:`);
  console.log(`   Existing (DB): ${test1Results.callEdgesFound} edges`);
  console.log(`   Fresh Analysis: ${test2Results.callEdgesFound} edges`);
  console.log(`   Improvement: ${edgeDetectionImprovement > 0 ? '+' : ''}${edgeDetectionImprovement.toFixed(1)}%\n`);

  // Per-function analysis efficiency
  if (test3Results.functionsAnalyzed > 0 && test2Results.functionsAnalyzed > 0) {
    const focusedEfficiency = test3Results.executionTime / test3Results.functionsAnalyzed;
    const fullEfficiency = test2Results.executionTime / test2Results.functionsAnalyzed;
    
    console.log(`⚡ Analysis Efficiency:`);
    console.log(`   Full Project: ${fullEfficiency.toFixed(2)}ms per function`);
    console.log(`   Focused (Import-Heavy): ${focusedEfficiency.toFixed(2)}ms per function`);
    console.log(`   Efficiency Ratio: ${(focusedEfficiency / fullEfficiency).toFixed(2)}x\n`);
  }

  // Memory efficiency
  console.log(`💾 Memory Efficiency:`);
  console.log(`   DB Load: ${test1Results.memoryUsed.toFixed(1)}MB`);
  console.log(`   Fresh Analysis: ${test2Results.memoryUsed.toFixed(1)}MB`);
  console.log(`   Memory Overhead: ${(test2Results.memoryUsed - test1Results.memoryUsed).toFixed(1)}MB\n`);

  console.log('✅ Realistic performance test completed!');
  
  // Cleanup
  process.env['FUNCQC_DEBUG_PERFORMANCE'] = '';
}

// Run test if this file is executed directly
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  runRealisticPerformanceTest().catch(console.error);
}

export { runRealisticPerformanceTest };
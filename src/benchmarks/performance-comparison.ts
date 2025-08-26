/**
 * Performance comparison script for CallGraphAnalyzer optimization
 */

import { performance } from 'perf_hooks';
import { CallGraphAnalyzer } from '../analyzers/call-graph-analyzer';
import { Project, Node } from 'ts-morph';
import { PerformanceProfiler } from '../utils/performance-metrics';
import * as path from 'path';

/**
 * CallGraphAnalyzer without caching for baseline comparison
 */
class NoCacheCallGraphAnalyzer extends CallGraphAnalyzer {
  private baselineProfiler: PerformanceProfiler;

  constructor() {
    super(undefined, false); // Disable cache
    this.baselineProfiler = new PerformanceProfiler('Baseline-NoCache');
  }

  /**
   * Override to use non-cached version
   */
  protected override resolveImportedSymbolWithCache(
    moduleSpecifier: string,
    exportedName: string,
    currentFilePath: string
  ): Node | undefined {
    return this.resolveImportedSymbolBaseline(moduleSpecifier, exportedName, currentFilePath);
  }

  protected resolveImportedSymbolBaseline(
    moduleSpecifier: string, 
    exportedName: string, 
    currentFilePath: string
  ): Node | undefined {
    this.baselineProfiler.recordDetail('import_resolution', 'baseline_calls', 1);
    
    const startTime = performance.now();
    
    // Enhanced import resolution: relative + tsconfig paths + absolute
    let resolvedPath: string;
    
    if (moduleSpecifier.startsWith('./') || moduleSpecifier.startsWith('../')) {
      // Relative imports with normalized paths
      resolvedPath = path.normalize(path.resolve(path.dirname(currentFilePath), moduleSpecifier));
    } else if (moduleSpecifier.startsWith('@/') || moduleSpecifier.startsWith('#/')) {
      // tsconfig paths aliases (basic support)
      const projectRoot = this.findProjectRoot();
      
      if (moduleSpecifier.startsWith('@/')) {
        const relativePath = moduleSpecifier.substring(2);
        resolvedPath = path.normalize(path.join(projectRoot, 'src', relativePath));
      } else if (moduleSpecifier.startsWith('#/')) {
        const relativePath = moduleSpecifier.substring(2);
        resolvedPath = path.normalize(path.join(projectRoot, relativePath));
      } else {
        return undefined;
      }
    } else if (moduleSpecifier.startsWith('/')) {
      // Absolute path (unified format: all paths start with /)
      resolvedPath = moduleSpecifier;
    } else {
      // External module or unsupported pattern
      this.baselineProfiler.recordDetail('import_resolution', 'external_modules', 1);
      return undefined;
    }
    
    // Try to find the source file with comprehensive extension support
    const extensionCandidates = [
      '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts',
      '/index.ts', '/index.tsx', '/index.js', '/index.jsx'
    ];
    
    let targetSourceFile;
    for (const ext of extensionCandidates) {
      targetSourceFile = this.project.getSourceFile(resolvedPath + ext);
      if (targetSourceFile) {
        break;
      }
    }
    
    if (targetSourceFile) {
      this.baselineProfiler.recordDetail('import_resolution', 'files_found', 1);
      
      // Always call getExportedDeclarations (no caching)
      const exportedDecls = targetSourceFile.getExportedDeclarations();
      this.baselineProfiler.recordDetail('import_resolution', 'export_declarations_calls', 1);
      
      const decls = exportedDecls.get(exportedName);
      
      if (decls && decls.length > 0) {
        for (const decl of decls) {
          if (this.isFunctionDeclaration(decl)) {
            const duration = performance.now() - startTime;
            this.baselineProfiler.recordDetail('import_resolution', 'successful_resolutions', 1);
            this.baselineProfiler.recordDetail('import_resolution', 'total_duration', duration);
            return decl as Node;
          }
        }
      }
    } else {
      this.baselineProfiler.recordDetail('import_resolution', 'files_not_found', 1);
    }
    
    const duration = performance.now() - startTime;
    this.baselineProfiler.recordDetail('import_resolution', 'failed_resolutions', 1);
    this.baselineProfiler.recordDetail('import_resolution', 'total_duration', duration);
    return undefined;
  }

  getBaselineMetrics() {
    return this.baselineProfiler.getMetrics();
  }

  printBaselineSummary() {
    this.baselineProfiler.printSummary();
  }
}

/**
 * Test function for performance comparison
 */
async function runPerformanceComparison(): Promise<void> {
  console.log('🚀 Starting CallGraphAnalyzer Performance Comparison');
  console.log('================================================\n');

  // Create test project
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
  });

  // Add sample files to test
  const testFiles = [
    'src/cli/commands/health/risk-evaluator.ts',
    'src/analyzers/call-graph-analyzer.ts',
    'src/analyzers/symbol-resolver.ts',
    'src/core/analyzer.ts',
    'src/utils/lazy-analysis.ts'
  ];

  // Load test files
  for (const filePath of testFiles) {
    try {
      project.addSourceFileAtPath(filePath);
    } catch (error) {
      console.log(`⚠️ Could not load ${filePath}: ${error}`);
    }
  }

  const sourceFiles = project.getSourceFiles();
  console.log(`📁 Loaded ${sourceFiles.length} test files for comparison\n`);

  if (sourceFiles.length === 0) {
    console.log('❌ No source files loaded. Cannot perform comparison.');
    return;
  }

  // Test with baseline (no cache)
  console.log('📊 Running baseline test (no caching)...');
  const baselineAnalyzer = new NoCacheCallGraphAnalyzer();
  const baselineStart = performance.now();
  
  let baselineEdges = 0;
  for (const sourceFile of sourceFiles.slice(0, 3)) { // Test first 3 files
    const functionMap = new Map();
    // Create dummy function map for testing
    sourceFile.forEachDescendant(node => {
      if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
        const name = node.getName?.() || 'anonymous';
        const id = `test-${Math.random().toString(36).substr(2, 9)}`;
        functionMap.set(name, {
          id,
          name,
          startLine: node.getStartLineNumber(),
          endLine: node.getEndLineNumber()
        });
      }
    });

    if (functionMap.size > 0) {
      try {
        const edges = await baselineAnalyzer.analyzeFile(sourceFile.getFilePath(), functionMap);
        baselineEdges += edges.length;
      } catch (error) {
        console.log(`⚠️ Error analyzing ${sourceFile.getFilePath()}: ${error}`);
      }
    }
  }
  
  const baselineTime = performance.now() - baselineStart;
  const baselineMetrics = baselineAnalyzer.getBaselineMetrics();
  
  console.log(`✅ Baseline completed in ${baselineTime.toFixed(2)}ms`);
  console.log(`   Generated ${baselineEdges} call edges\n`);

  // Test with optimized version (with caching)
  console.log('🚀 Running optimized test (with caching)...');
  const optimizedAnalyzer = new CallGraphAnalyzer(project, true);
  const optimizedStart = performance.now();
  
  let optimizedEdges = 0;
  for (const sourceFile of sourceFiles.slice(0, 3)) { // Test same 3 files
    const functionMap = new Map();
    // Create same dummy function map for testing
    sourceFile.forEachDescendant(node => {
      if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
        const name = node.getName?.() || 'anonymous';
        const id = `test-${Math.random().toString(36).substr(2, 9)}`;
        functionMap.set(name, {
          id,
          name,
          startLine: node.getStartLineNumber(),
          endLine: node.getEndLineNumber()
        });
      }
    });

    if (functionMap.size > 0) {
      try {
        const edges = await optimizedAnalyzer.analyzeFile(sourceFile.getFilePath(), functionMap);
        optimizedEdges += edges.length;
      } catch (error) {
        console.log(`⚠️ Error analyzing ${sourceFile.getFilePath()}: ${error}`);
      }
    }
  }
  
  const optimizedTime = performance.now() - optimizedStart;
  const optimizedMetrics = optimizedAnalyzer.getPerformanceMetrics();

  console.log(`✅ Optimized completed in ${optimizedTime.toFixed(2)}ms`);
  console.log(`   Generated ${optimizedEdges} call edges\n`);

  // Performance comparison results
  console.log('📈 PERFORMANCE COMPARISON RESULTS');
  console.log('=====================================\n');

  console.log(`⏱️  Total Execution Time:`);
  console.log(`   Baseline (no cache): ${baselineTime.toFixed(2)}ms`);
  console.log(`   Optimized (cached):  ${optimizedTime.toFixed(2)}ms`);
  console.log(`   Improvement:         ${((baselineTime - optimizedTime) / baselineTime * 100).toFixed(1)}%\n`);

  console.log(`🔄 Call Edges Generated:`);
  console.log(`   Baseline:  ${baselineEdges} edges`);
  console.log(`   Optimized: ${optimizedEdges} edges`);
  console.log(`   Difference: ${optimizedEdges - baselineEdges} edges\n`);

  // Detailed metrics from baseline
  console.log(`📊 Baseline Metrics (No Cache):`);
  if (baselineMetrics.phases['import_resolution']) {
    const phase = baselineMetrics.phases['import_resolution'];
    console.log(`   Import Resolution Calls: ${phase.details?.['baseline_calls'] || 0}`);
    console.log(`   Export Declaration Calls: ${phase.details?.['export_declarations_calls'] || 0}`);
    console.log(`   Files Found: ${phase.details?.['files_found'] || 0}`);
    console.log(`   Files Not Found: ${phase.details?.['files_not_found'] || 0}`);
    console.log(`   Successful Resolutions: ${phase.details?.['successful_resolutions'] || 0}`);
    console.log(`   Failed Resolutions: ${phase.details?.['failed_resolutions'] || 0}`);
    console.log(`   Average Duration: ${phase.averageDuration.toFixed(2)}ms\n`);
  }

  // Detailed metrics from optimized version
  console.log(`🚀 Optimized Metrics (With Cache):`);
  if (optimizedMetrics.phases['import_resolution']) {
    const phase = optimizedMetrics.phases['import_resolution'];
    console.log(`   Cache Hits: ${phase.details?.['cache_hits'] || 0}`);
    console.log(`   Cache Misses: ${phase.details?.['cache_misses'] || 0}`);
    console.log(`   Export Cache Builds: ${phase.details?.['export_cache_builds'] || 0}`);
    console.log(`   Files Found: ${phase.details?.['files_found'] || 0}`);
    console.log(`   Files Not Found: ${phase.details?.['files_not_found'] || 0}`);
    console.log(`   Successful Resolutions: ${phase.details?.['successful_resolutions'] || 0}`);
    console.log(`   Failed Resolutions: ${phase.details?.['failed_resolutions'] || 0}`);
    
    const totalCalls = (phase.details?.['cache_hits'] || 0) + (phase.details?.['cache_misses'] || 0);
    const hitRate = totalCalls > 0 ? ((phase.details?.['cache_hits'] || 0) / totalCalls * 100).toFixed(1) : '0.0';
    console.log(`   Cache Hit Rate: ${hitRate}%`);
    console.log(`   Average Duration: ${phase.averageDuration.toFixed(2)}ms\n`);
  }

  // Memory usage comparison
  console.log(`🧠 Memory Usage:`);
  console.log(`   Baseline:  ${baselineMetrics.memory.heapUsed}MB used / ${baselineMetrics.memory.heapTotal}MB total`);
  console.log(`   Optimized: ${optimizedMetrics.memory.heapUsed}MB used / ${optimizedMetrics.memory.heapTotal}MB total`);
  console.log(`   Memory Overhead: ${(optimizedMetrics.memory.heapUsed - baselineMetrics.memory.heapUsed).toFixed(1)}MB\n`);

  console.log('✅ Performance comparison completed!');
}

// Run comparison if this file is executed directly
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  runPerformanceComparison().catch(console.error);
}

export { runPerformanceComparison };
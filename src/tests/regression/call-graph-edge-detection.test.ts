/**
 * Regression test for critical call graph edge detection
 * Ensures that key function call relationships are properly detected
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { ConfigManager } from '../../core/config';
import { PGLiteStorageAdapter } from '../../storage/pglite-adapter';
import { loadComprehensiveCallGraphData } from '../../utils/lazy-analysis';
import { CommandEnvironment } from '../../types/environment';
import { Logger } from '../../utils/cli-utils';

describe('Call Graph Edge Detection Regression Tests', () => {
  let env: CommandEnvironment;
  let snapshot: any;
  let allEdges: any[];
  let functions: any[];

  beforeAll(async () => {
    // Setup test environment
    const configManager = new ConfigManager();
    const config = await configManager.load();
    const storage = new PGLiteStorageAdapter(config.storage?.path || '.funcqc/funcqc.db');
    const logger = new Logger(false, true); // quiet mode

    env = {
      config,
      storage,
      logger
    };

    // Load comprehensive call graph data
    const result = await loadComprehensiveCallGraphData(env, { showProgress: false });
    snapshot = result.snapshot;
    allEdges = result.allEdges;
    functions = result.functions;

    if (!snapshot) {
      throw new Error('No snapshot found. Please run `funcqc scan` first.');
    }
  });

  describe('Critical Function Call Detection', () => {
    it('should detect performSingleFunctionAnalysis → buildDependencyTree edge', () => {
      // Find the caller function
      const callerFunction = functions.find(f => 
        f.name === 'performSingleFunctionAnalysis' && 
        f.filePath.includes('src/cli/dep/show.ts')
      );
      
      expect(callerFunction).toBeDefined();
      expect(callerFunction).toMatchObject({
        name: 'performSingleFunctionAnalysis',
        filePath: expect.stringContaining('src/cli/dep/show.ts')
      });

      // Find the callee function
      const calleeFunction = functions.find(f => 
        f.name === 'buildDependencyTree' && 
        f.filePath.includes('utils')
      );
      
      expect(calleeFunction).toBeDefined();
      expect(calleeFunction).toMatchObject({
        name: 'buildDependencyTree',
        filePath: expect.stringContaining('utils')
      });

      // Find the edge between them
      const criticalEdge = allEdges.find(edge => 
        edge.callerFunctionId === callerFunction.id && 
        edge.calleeFunctionId === calleeFunction.id
      );

      expect(criticalEdge).toBeDefined();
      expect(criticalEdge).toMatchObject({
        callerFunctionId: callerFunction.id,
        calleeFunctionId: calleeFunction.id,
        calleeName: 'buildDependencyTree'
      });

      console.log(`✅ Critical edge detected: ${callerFunction.name} → ${calleeFunction.name}`);
      console.log(`   Caller: ${callerFunction.filePath}:${callerFunction.startLine}`);
      console.log(`   Callee: ${calleeFunction.filePath}:${calleeFunction.startLine}`);
      console.log(`   Edge: ${criticalEdge.callType} call at line ${criticalEdge.lineNumber}`);
    });

    it('should have comprehensive call edge coverage', () => {
      // Basic sanity checks
      expect(functions.length).toBeGreaterThan(2000);
      expect(allEdges.length).toBeGreaterThan(8000);
      
      // Ensure we have both external and internal edges
      const externalEdges = allEdges.filter(edge => !edge.metadata?.source || edge.metadata.source !== 'internal');
      const internalEdges = allEdges.filter(edge => edge.metadata?.source === 'internal');
      
      expect(externalEdges.length).toBeGreaterThan(5000);
      expect(internalEdges.length).toBeGreaterThan(2000);

      console.log(`📊 Call graph coverage:`);
      console.log(`   Total functions: ${functions.length}`);
      console.log(`   Total edges: ${allEdges.length}`);
      console.log(`   External edges: ${externalEdges.length}`);
      console.log(`   Internal edges: ${internalEdges.length}`);
    });
  });

  describe('Import Resolution Edge Detection', () => {
    it('should detect cross-file function calls', () => {
      // Find edges that represent cross-file calls (import-based)
      const crossFileEdges = allEdges.filter(edge => {
        if (!edge.callerFunctionId || !edge.calleeFunctionId) return false;
        
        const caller = functions.find(f => f.id === edge.callerFunctionId);
        const callee = functions.find(f => f.id === edge.calleeFunctionId);
        
        return caller && callee && caller.filePath !== callee.filePath;
      });

      expect(crossFileEdges.length).toBeGreaterThan(100);
      
      // Sample some cross-file edges for verification
      const sampleEdges = crossFileEdges.slice(0, 5);
      sampleEdges.forEach(edge => {
        const caller = functions.find(f => f.id === edge.callerFunctionId);
        const callee = functions.find(f => f.id === edge.calleeFunctionId);
        
        expect(caller).toBeDefined();
        expect(callee).toBeDefined();
        expect(caller.filePath).not.toBe(callee.filePath);
      });

      console.log(`🔗 Cross-file edges detected: ${crossFileEdges.length}`);
    });

    it('should detect various call types', () => {
      const callTypeDistribution = allEdges.reduce((acc, edge) => {
        acc[edge.callType] = (acc[edge.callType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Should have multiple call types
      expect(Object.keys(callTypeDistribution)).toContain('direct');
      expect(callTypeDistribution.direct).toBeGreaterThan(1000);

      console.log(`📈 Call type distribution:`, callTypeDistribution);
    });
  });

  describe('Confidence and Quality Metrics', () => {
    it('should have high confidence scores for most edges', () => {
      const highConfidenceEdges = allEdges.filter(edge => 
        edge.confidenceScore && edge.confidenceScore >= 0.8
      );
      
      const confidenceRate = (highConfidenceEdges.length / allEdges.length) * 100;
      
      // At least 70% of edges should have high confidence
      expect(confidenceRate).toBeGreaterThan(70);

      console.log(`🎯 High confidence edges: ${confidenceRate.toFixed(1)}% (${highConfidenceEdges.length}/${allEdges.length})`);
    });

    it('should have proper metadata for traceability', () => {
      const edgesWithMetadata = allEdges.filter(edge => 
        edge.metadata && (edge.metadata.via || edge.metadata.source)
      );
      
      const metadataRate = (edgesWithMetadata.length / allEdges.length) * 100;
      
      // Most edges should have traceability metadata
      expect(metadataRate).toBeGreaterThan(50);

      console.log(`📋 Edges with metadata: ${metadataRate.toFixed(1)}% (${edgesWithMetadata.length}/${allEdges.length})`);
    });
  });
});

/**
 * Integration test helper for specific edge patterns
 */
export async function findEdgePattern(
  env: CommandEnvironment,
  pattern: {
    callerName: string;
    callerFile?: string;
    calleeName: string;
    calleeFile?: string;
  }
): Promise<{
  edge: any | null;
  caller: any | null;
  callee: any | null;
}> {
  const result = await loadComprehensiveCallGraphData(env, { showProgress: false });
  
  const caller = result.functions.find(f => 
    f.name === pattern.callerName && 
    (!pattern.callerFile || f.filePath.includes(pattern.callerFile))
  );
  
  const callee = result.functions.find(f => 
    f.name === pattern.calleeName && 
    (!pattern.calleeFile || f.filePath.includes(pattern.calleeFile))
  );
  
  const edge = caller && callee ? result.allEdges.find(e => 
    e.callerFunctionId === caller.id && 
    e.calleeFunctionId === callee.id
  ) : null;
  
  return { edge, caller, callee };
}
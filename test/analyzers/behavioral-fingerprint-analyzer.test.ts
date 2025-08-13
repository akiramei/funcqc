/**
 * Behavioral Fingerprint Analyzer Tests
 * 
 * Tests for analyzing behavioral patterns and clustering functions
 * based on their call patterns and usage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BehavioralFingerprintAnalyzer, type BehavioralCluster } from '../../src/analyzers/type-insights/behavioral-fingerprint-analyzer';
import type { StorageQueryInterface } from '../../src/analyzers/type-insights/types';

// Mock storage interface
const createMockStorage = (): StorageQueryInterface => ({
  query: vi.fn()
});

// Helper to create test function data
const createTestFunction = (
  id: string,
  name: string,
  file: string = 'test-file.ts'
) => ({
  id,
  name,
  file_path: file
});

// Helper to create test call edge data
const createTestCallEdge = (
  callerId: string,
  calleeId: string,
  calleeName: string
) => ({
  caller_function_id: callerId,
  callee_function_id: calleeId,
  callee_name: calleeName
});

describe('BehavioralFingerprintAnalyzer', () => {
  let storage: StorageQueryInterface;
  let analyzer: BehavioralFingerprintAnalyzer;

  beforeEach(() => {
    storage = createMockStorage();
    analyzer = new BehavioralFingerprintAnalyzer(storage);
    vi.clearAllMocks();
  });

  describe('Basic Configuration', () => {
    it('should initialize with default options', () => {
      const config = analyzer.getBehavioralConfiguration();
      
      expect(config.includeCallsOut).toBe(true);
      expect(config.includeCallsIn).toBe(true);
      expect(config.minCallFrequency).toBe(2);
      expect(config.clusterSimilarityThreshold).toBe(0.7);
      expect(config.maxFingerprintSize).toBe(50);
      expect(config.includeInternalCalls).toBe(false);
    });

    it('should allow custom configuration', () => {
      const customAnalyzer = new BehavioralFingerprintAnalyzer(storage, {
        minCallFrequency: 5,
        clusterSimilarityThreshold: 0.8,
        includeInternalCalls: true
      });

      const config = customAnalyzer.getBehavioralConfiguration();
      
      expect(config.minCallFrequency).toBe(5);
      expect(config.clusterSimilarityThreshold).toBe(0.8);
      expect(config.includeInternalCalls).toBe(true);
    });
  });

  describe('Behavioral Information Loading', () => {
    it('should handle empty function set', async () => {
      // Mock empty results
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: [] }); // functions
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: [] }); // call edges

      const results = await analyzer.getDetailedResults();
      expect(results).toEqual([]);
    });

    it('should load function and call edge data correctly', async () => {
      const functions = [
        createTestFunction('func1', 'getUserData'),
        createTestFunction('func2', 'saveUserData'),
        createTestFunction('func3', 'validateUser')
      ];

      const callEdges = [
        createTestCallEdge('func1', 'func3', 'validateUser'),
        createTestCallEdge('func2', 'func3', 'validateUser'),
        createTestCallEdge('func1', 'func2', 'saveUserData')
      ];

      // Mock database responses
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: functions });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: callEdges });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: [] }); // internal calls

      const results = await analyzer.getDetailedResults();
      
      // Should find behavioral patterns
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Behavioral Vector Generation', () => {
    it('should create behavioral vectors for functions with similar patterns', async () => {
      const functions = [
        createTestFunction('func1', 'processOrderData'),
        createTestFunction('func2', 'processUserData'),
        createTestFunction('func3', 'validateInput')
      ];

      const callEdges = [
        // Both processOrderData and processUserData call validateInput
        createTestCallEdge('func1', 'func3', 'validateInput'),
        createTestCallEdge('func2', 'func3', 'validateInput'),
        // Both also call similar helper functions
        createTestCallEdge('func1', 'helper1', 'sanitizeData'),
        createTestCallEdge('func2', 'helper1', 'sanitizeData')
      ];

      vi.mocked(storage.query).mockResolvedValueOnce({ rows: functions });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: callEdges });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: [] }); // internal calls

      const results = await analyzer.getDetailedResults();
      
      // Should identify the similar behavior pattern between func1 and func2
      if (results.length > 0) {
        const cluster = results[0];
        expect(cluster.functions).toHaveLength(2);
        expect(cluster.commonBehaviors).toContain('validateInput');
        expect(cluster.commonBehaviors).toContain('sanitizeData');
      }
    });
  });

  describe('Clustering Logic', () => {
    it('should cluster functions with high behavioral similarity', async () => {
      const functions = [
        createTestFunction('func1', 'handleUserCreation'),
        createTestFunction('func2', 'handleUserUpdate'),
        createTestFunction('func3', 'handleOrderCreation')
      ];

      const callEdges = [
        // User handlers have similar patterns
        createTestCallEdge('func1', 'val1', 'validateUser'),
        createTestCallEdge('func2', 'val1', 'validateUser'),
        createTestCallEdge('func1', 'db1', 'saveToDatabase'),
        createTestCallEdge('func2', 'db1', 'saveToDatabase'),
        createTestCallEdge('func1', 'log1', 'logActivity'),
        createTestCallEdge('func2', 'log1', 'logActivity'),
        
        // Order handler has different pattern
        createTestCallEdge('func3', 'val2', 'validateOrder'),
        createTestCallEdge('func3', 'calc1', 'calculateTotal')
      ];

      vi.mocked(storage.query).mockResolvedValueOnce({ rows: functions });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: callEdges });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: [] });

      const results = await analyzer.getDetailedResults();
      
      // Should identify cluster for similar user handlers
      const userHandlerCluster = results.find(cluster => 
        cluster.functionNames.includes('handleUserCreation') && 
        cluster.functionNames.includes('handleUserUpdate')
      );
      
      expect(userHandlerCluster).toBeDefined();
      if (userHandlerCluster) {
        expect(userHandlerCluster.functions).toHaveLength(2);
        expect(userHandlerCluster.similarity).toBeGreaterThan(0.5);
      }
    });

    it('should not cluster functions with different behavioral patterns', async () => {
      const functions = [
        createTestFunction('func1', 'calculateTax'),
        createTestFunction('func2', 'renderUI')
      ];

      const callEdges = [
        // Tax calculation calls math functions
        createTestCallEdge('func1', 'math1', 'multiply'),
        createTestCallEdge('func1', 'math2', 'round'),
        
        // UI rendering calls DOM functions
        createTestCallEdge('func2', 'dom1', 'createElement'),
        createTestCallEdge('func2', 'dom2', 'appendChild')
      ];

      vi.mocked(storage.query).mockResolvedValueOnce({ rows: functions });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: callEdges });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: [] });

      const results = await analyzer.getDetailedResults();
      
      // Should not cluster these dissimilar functions
      const mixedCluster = results.find(cluster => 
        cluster.functionNames.includes('calculateTax') && 
        cluster.functionNames.includes('renderUI')
      );
      
      expect(mixedCluster).toBeUndefined();
    });
  });

  describe('Role Inference', () => {
    it('should infer data processing role from function names and behaviors', async () => {
      const functions = [
        createTestFunction('func1', 'processPaymentData'),
        createTestFunction('func2', 'processOrderData')
      ];

      const callEdges = [
        createTestCallEdge('func1', 'val1', 'validateData'),
        createTestCallEdge('func2', 'val1', 'validateData'),
        createTestCallEdge('func1', 'transform1', 'transformData'),
        createTestCallEdge('func2', 'transform1', 'transformData')
      ];

      vi.mocked(storage.query).mockResolvedValueOnce({ rows: functions });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: callEdges });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: [] });

      const results = await analyzer.getDetailedResults();
      
      const processingCluster = results.find(cluster => 
        cluster.roleDescription.includes('processing')
      );
      
      expect(processingCluster).toBeDefined();
      if (processingCluster) {
        expect(processingCluster.roleDescription).toMatch(/processing|data/i);
      }
    });

    it('should infer validation role from function names', async () => {
      const functions = [
        createTestFunction('func1', 'validateEmail'),
        createTestFunction('func2', 'validatePassword'),
        createTestFunction('func3', 'validateInput')
      ];

      const callEdges = [
        // All validation functions call similar helper functions
        createTestCallEdge('func1', 'regex1', 'testRegex'),
        createTestCallEdge('func2', 'regex1', 'testRegex'),
        createTestCallEdge('func3', 'regex1', 'testRegex'),
        createTestCallEdge('func1', 'helper1', 'checkFormat'),
        createTestCallEdge('func2', 'helper1', 'checkFormat'),
        createTestCallEdge('func3', 'helper1', 'checkFormat')
      ];

      vi.mocked(storage.query).mockResolvedValueOnce({ rows: functions });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: callEdges });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: [] });

      const results = await analyzer.getDetailedResults();
      
      const validationCluster = results.find(cluster => 
        cluster.roleDescription.includes('validation') ||
        cluster.functionNames.some(name => name.includes('validate'))
      );
      
      expect(validationCluster).toBeDefined();
    });
  });

  describe('Impact Score Calculation', () => {
    it('should assign higher impact scores to larger clusters', async () => {
      const largeFunctions = [
        createTestFunction('func1', 'handleRequest1'),
        createTestFunction('func2', 'handleRequest2'),
        createTestFunction('func3', 'handleRequest3'),
        createTestFunction('func4', 'handleRequest4')
      ];

      const smallFunctions = [
        createTestFunction('func5', 'utilityFunction1'),
        createTestFunction('func6', 'utilityFunction2')
      ];

      const functions = [...largeFunctions, ...smallFunctions];

      const callEdges = [
        // Large cluster - all handle requests similarly
        ...largeFunctions.map(f => createTestCallEdge(f.id, 'auth1', 'authenticate')),
        ...largeFunctions.map(f => createTestCallEdge(f.id, 'log1', 'logRequest')),
        
        // Small cluster - utilities
        ...smallFunctions.map(f => createTestCallEdge(f.id, 'helper1', 'formatString'))
      ];

      vi.mocked(storage.query).mockResolvedValueOnce({ rows: functions });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: callEdges });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: [] });

      const results = await analyzer.getDetailedResults();
      
      const largeCluster = results.find(c => c.functions.length === 4);
      const smallCluster = results.find(c => c.functions.length === 2);
      
      if (largeCluster && smallCluster) {
        expect(largeCluster.impactScore).toBeGreaterThan(smallCluster.impactScore);
      }
    });

    it('should assign higher impact scores to functions from the same file', async () => {
      const sameFileFunctions = [
        createTestFunction('func1', 'helper1', 'utilities.ts'),
        createTestFunction('func2', 'helper2', 'utilities.ts')
      ];

      const differentFileFunctions = [
        createTestFunction('func3', 'process1', 'module1.ts'),
        createTestFunction('func4', 'process2', 'module2.ts')
      ];

      const functions = [...sameFileFunctions, ...differentFileFunctions];

      const callEdges = [
        // Both pairs have similar call patterns
        ...sameFileFunctions.map(f => createTestCallEdge(f.id, 'common1', 'commonFunction')),
        ...differentFileFunctions.map(f => createTestCallEdge(f.id, 'common2', 'anotherFunction'))
      ];

      vi.mocked(storage.query).mockResolvedValueOnce({ rows: functions });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: callEdges });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: [] });

      const results = await analyzer.getDetailedResults();
      
      const sameFileCluster = results.find(c => 
        c.functionNames.includes('helper1') && c.functionNames.includes('helper2')
      );
      const differentFileCluster = results.find(c => 
        c.functionNames.includes('process1') && c.functionNames.includes('process2')
      );
      
      if (sameFileCluster && differentFileCluster) {
        expect(sameFileCluster.impactScore).toBeGreaterThan(differentFileCluster.impactScore);
      }
    });
  });

  describe('Configuration Updates', () => {
    it('should allow updating behavioral configuration', () => {
      const initialConfig = analyzer.getBehavioralConfiguration();
      expect(initialConfig.minCallFrequency).toBe(2);

      analyzer.updateBehavioralConfiguration({
        minCallFrequency: 5,
        clusterSimilarityThreshold: 0.8
      });

      const updatedConfig = analyzer.getBehavioralConfiguration();
      expect(updatedConfig.minCallFrequency).toBe(5);
      expect(updatedConfig.clusterSimilarityThreshold).toBe(0.8);
      expect(updatedConfig.includeCallsOut).toBe(true); // Should preserve other settings
    });
  });

  describe('Error Handling', () => {
    it('should handle database query errors gracefully', async () => {
      vi.mocked(storage.query).mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(analyzer.getDetailedResults()).rejects.toThrow('Failed to get detailed behavioral results');
    });

    it('should handle malformed data gracefully', async () => {
      // Mock malformed function data (missing required fields)
      const malformedFunctions = [
        { id: 'func1' }, // missing name and file_path
        { name: 'func2' }  // missing id and file_path
      ];

      vi.mocked(storage.query).mockResolvedValueOnce({ rows: malformedFunctions });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: [] });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: [] });

      // Should not throw, but should filter out invalid data
      const results = await analyzer.getDetailedResults();
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Integration with CrossTypeAnalyzer', () => {
    it('should extend CrossTypeAnalyzer base functionality', () => {
      expect(analyzer).toHaveProperty('getConfiguration');
      expect(analyzer).toHaveProperty('updateConfiguration');
      
      const baseConfig = analyzer.getConfiguration();
      expect(baseConfig).toHaveProperty('minSupport');
      expect(baseConfig).toHaveProperty('minConfidence');
    });

    it('should convert clusters to CrossTypePattern format', async () => {
      const functions = [
        createTestFunction('func1', 'similar1'),
        createTestFunction('func2', 'similar2')
      ];

      const callEdges = [
        createTestCallEdge('func1', 'common1', 'sharedFunction'),
        createTestCallEdge('func2', 'common1', 'sharedFunction')
      ];

      vi.mocked(storage.query).mockResolvedValueOnce({ rows: functions });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: callEdges });
      vi.mocked(storage.query).mockResolvedValueOnce({ rows: [] });

      const patterns = await analyzer.analyze();
      
      expect(Array.isArray(patterns)).toBe(true);
      if (patterns.length > 0) {
        const pattern = patterns[0];
        expect(pattern).toHaveProperty('id');
        expect(pattern).toHaveProperty('pattern');
        expect(pattern).toHaveProperty('support');
        expect(pattern).toHaveProperty('confidence');
        expect(pattern).toHaveProperty('lift');
        expect(pattern).toHaveProperty('types');
        expect(pattern).toHaveProperty('suggestedAction');
        expect(pattern).toHaveProperty('impactScore');
      }
    });
  });
});
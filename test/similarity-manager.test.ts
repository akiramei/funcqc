import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SimilarityManager } from '../src/similarity/similarity-manager';
import { FunctionInfo, SimilarityDetector, SimilarityOptions, SimilarityResult } from '../src/types';

describe('SimilarityManager', () => {
  let manager: SimilarityManager;

  beforeEach(() => {
    // Create manager without default detectors for cleaner testing
    manager = new SimilarityManager();
  });

  const createMockFunction = (id: string, name: string): FunctionInfo => ({
    id,
    semanticId: `semantic-${id}`,
    contentId: `content-${id}`,
    name,
    displayName: name,
    signature: `function ${name}()`,
    signatureHash: `hash-${name}`,
    filePath: `file-${id}.ts`,
    fileHash: 'file-hash',
    startLine: 1,
    endLine: 10,
    startColumn: 0,
    endColumn: 100,
    astHash: `ast-${name}`,
    isExported: true,
    isAsync: false,
    isGenerator: false,
    isArrowFunction: false,
    isMethod: false,
    isConstructor: false,
    isStatic: false,
    parameters: []
  });

  const createMockDetector = (
    name: string,
    results: SimilarityResult[]
  ): SimilarityDetector => ({
    name,
    version: '1.0.0',
    supportedLanguages: ['typescript'],
    detect: vi.fn().mockResolvedValue(results),
    isAvailable: vi.fn().mockResolvedValue(true)
  });

  describe('detectSimilarities', () => {
    it('should use registered detectors', async () => {
      const mockResult: SimilarityResult = {
        type: 'structural',
        similarity: 0.9,
        functions: [
          { functionId: 'f1', functionName: 'func1', filePath: 'file1.ts', startLine: 1, endLine: 10 },
          { functionId: 'f2', functionName: 'func2', filePath: 'file2.ts', startLine: 1, endLine: 10 }
        ],
        detector: 'mock-detector'
      };

      const mockDetector = createMockDetector('mock-detector', [mockResult]);
      manager.registerDetector(mockDetector);

      const functions = [
        createMockFunction('f1', 'func1'),
        createMockFunction('f2', 'func2')
      ];

      // Use enabledDetectors to only run the mock detector
      const results = await manager.detectSimilarities(functions, {}, ['mock-detector']);

      expect(mockDetector.detect).toHaveBeenCalledWith(functions, {});
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(mockResult);
    });

    it('should filter detectors by enabled list', async () => {
      const detector1 = createMockDetector('detector1', []);
      const detector2 = createMockDetector('detector2', []);
      
      manager.registerDetector(detector1);
      manager.registerDetector(detector2);

      const functions = [createMockFunction('f1', 'func1')];

      await manager.detectSimilarities(functions, {}, ['detector1']);

      expect(detector1.detect).toHaveBeenCalled();
      expect(detector2.detect).not.toHaveBeenCalled();
    });

    it('should pass options to detectors', async () => {
      const detector = createMockDetector('detector', []);
      manager.registerDetector(detector);

      const functions = [createMockFunction('f1', 'func1')];
      const options: SimilarityOptions = {
        threshold: 0.9,
        minLines: 10,
        crossFile: false
      };

      // Use enabledDetectors to force specific detector usage
      await manager.detectSimilarities(functions, options, ['detector']);

      expect(detector.detect).toHaveBeenCalledWith(functions, options);
    });

    it('should handle detector errors gracefully', async () => {
      // Mock console.warn to suppress error messages in test output
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const workingDetector = createMockDetector('working-detector', []);
      const errorDetector = {
        name: 'error-detector',
        version: '1.0.0',
        supportedLanguages: ['typescript'],
        detect: vi.fn().mockRejectedValue(new Error('Detector error')),
        isAvailable: vi.fn().mockResolvedValue(true)
      };
      
      manager.registerDetector(workingDetector);
      manager.registerDetector(errorDetector);

      const functions = [createMockFunction('f1', 'func1')];

      // Should not throw, but handle error gracefully and still return results from working detector
      const results = await manager.detectSimilarities(functions, {}, ['working-detector', 'error-detector']);
      
      expect(results).toEqual([]);
      expect(workingDetector.detect).toHaveBeenCalled();
      expect(errorDetector.detect).toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith('Detector error-detector failed:', expect.any(Error));
      
      consoleWarnSpy.mockRestore();
    });
  });

  describe('consensus strategies', () => {
    const createResult = (detector: string, funcIds: string[], similarity: number): SimilarityResult => ({
      type: 'structural',
      similarity,
      functions: funcIds.map(id => ({
        functionId: id,
        functionName: `func${id}`,
        filePath: `file${id}.ts`,
        startLine: 1,
        endLine: 10
      })),
      detector
    });

    it('should apply majority consensus', async () => {
      // Create a fresh manager for this test to avoid default detectors
      const freshManager = new SimilarityManager();
      
      const detector1 = createMockDetector('d1', [
        createResult('d1', ['f1', 'f2'], 0.8),
        createResult('d1', ['f3', 'f4'], 0.9)
      ]);
      const detector2 = createMockDetector('d2', [
        createResult('d2', ['f1', 'f2'], 0.85),
        createResult('d2', ['f5', 'f6'], 0.7)
      ]);
      const detector3 = createMockDetector('d3', [
        createResult('d3', ['f1', 'f2'], 0.9)
      ]);

      freshManager.registerDetector(detector1);
      freshManager.registerDetector(detector2);
      freshManager.registerDetector(detector3);

      const functions = Array.from({ length: 6 }, (_, i) => 
        createMockFunction(`f${i+1}`, `func${i+1}`)
      );

      const results = await freshManager.detectSimilarities(
        functions,
        {},
        ['d1', 'd2', 'd3'],
        { strategy: 'majority', threshold: 0.6 }
      );

      // f1-f2 pair detected by all 3 detectors (100% > 60% threshold)
      // Other pairs detected by only 1 detector (33% < 60% threshold)
      expect(results).toHaveLength(1);
      expect(results[0].detector).toBe('consensus-majority');
      expect(results[0].similarity).toBeCloseTo(0.85, 2); // Average of 0.8, 0.85, 0.9
    });

    it('should apply intersection consensus', async () => {
      const freshManager = new SimilarityManager();
      
      const detector1 = createMockDetector('d1', [
        createResult('d1', ['f1', 'f2'], 0.8),
        createResult('d1', ['f3', 'f4'], 0.9)
      ]);
      const detector2 = createMockDetector('d2', [
        createResult('d2', ['f1', 'f2'], 0.85),
        createResult('d2', ['f3', 'f4'], 0.75)
      ]);

      freshManager.registerDetector(detector1);
      freshManager.registerDetector(detector2);

      const functions = Array.from({ length: 4 }, (_, i) => 
        createMockFunction(`f${i+1}`, `func${i+1}`)
      );

      const results = await freshManager.detectSimilarities(
        functions,
        {},
        ['d1', 'd2'],
        { strategy: 'intersection' }
      );

      // Both f1-f2 and f3-f4 detected by both detectors
      expect(results).toHaveLength(2);
      expect(results.every(r => r.detector === 'consensus-intersection')).toBe(true);
    });

    it('should apply union consensus', async () => {
      const freshManager = new SimilarityManager();
      
      const detector1 = createMockDetector('d1', [
        createResult('d1', ['f1', 'f2'], 0.8)
      ]);
      const detector2 = createMockDetector('d2', [
        createResult('d2', ['f3', 'f4'], 0.9)
      ]);

      freshManager.registerDetector(detector1);
      freshManager.registerDetector(detector2);

      const functions = Array.from({ length: 4 }, (_, i) => 
        createMockFunction(`f${i+1}`, `func${i+1}`)
      );

      const results = await freshManager.detectSimilarities(
        functions,
        {},
        ['d1', 'd2'],
        { strategy: 'union' }
      );

      // All results from both detectors
      expect(results).toHaveLength(2);
    });

    it('should apply weighted consensus', async () => {
      const freshManager = new SimilarityManager();
      
      const detector1 = createMockDetector('d1', [
        createResult('d1', ['f1', 'f2'], 0.8)
      ]);
      const detector2 = createMockDetector('d2', [
        createResult('d2', ['f1', 'f2'], 0.6)
      ]);

      freshManager.registerDetector(detector1);
      freshManager.registerDetector(detector2);

      const functions = [
        createMockFunction('f1', 'func1'),
        createMockFunction('f2', 'func2')
      ];

      const results = await freshManager.detectSimilarities(
        functions,
        {},
        ['d1', 'd2'],
        { 
          strategy: 'weighted',
          weightings: { 'd1': 2, 'd2': 1 }
        }
      );

      expect(results).toHaveLength(1);
      expect(results[0].detector).toBe('consensus-weighted');
      // Weighted average: (0.8 * 2 + 0.6 * 1) / 3 = 0.733...
      expect(results[0].similarity).toBeCloseTo(0.733, 2);
    });
  });

  describe('getAvailableDetectors', () => {
    it('should return list of registered detector names', () => {
      const detector1 = createMockDetector('detector1', []);
      const detector2 = createMockDetector('detector2', []);
      
      manager.registerDetector(detector1);
      manager.registerDetector(detector2);

      const detectors = manager.getAvailableDetectors();
      
      expect(detectors).toContain('detector1');
      expect(detectors).toContain('detector2');
      // Check for default detectors that are always registered
      expect(detectors).toContain('advanced-structural');
      expect(detectors).toContain('hash-duplicate');
      expect(detectors).toContain('ast-structural');
    });
  });
});
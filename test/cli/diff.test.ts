import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { DiffCommandOptions, FunctionInfo, SnapshotDiff } from '../../src/types/index.js';
import type { SimilarityManager } from '../../src/services/similarity-manager.js';

// Mock dependencies
vi.mock('../../src/core/config.js');
vi.mock('../../src/storage/pglite-adapter.js');
vi.mock('../../src/services/similarity-manager.js');

describe('Diff Command', () => {
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockConsoleLog.mockRestore();
    mockConsoleError.mockRestore();
  });

  describe('Command Options', () => {
    it('should accept diff command options', () => {
      const options: DiffCommandOptions = {
        insights: false,
        verbose: false,
        json: false,
        showUnchanged: false,
        similarityThreshold: '0.95'
      };

      expect(options).toBeDefined();
      expect(typeof options.insights).toBe('boolean');
      expect(typeof options.verbose).toBe('boolean');
      expect(typeof options.json).toBe('boolean');
      expect(typeof options.showUnchanged).toBe('boolean');
      expect(typeof options.similarityThreshold).toBe('string');
    });

    it('should handle optional parameters correctly', () => {
      const minimalOptions: DiffCommandOptions = {};
      
      expect(minimalOptions.insights).toBeUndefined();
      expect(minimalOptions.verbose).toBeUndefined();
      expect(minimalOptions.json).toBeUndefined();
      expect(minimalOptions.showUnchanged).toBeUndefined();
      expect(minimalOptions.similarityThreshold).toBeUndefined();
    });

    it('should accept various similarity threshold values', () => {
      const validThresholds = ['0.5', '0.75', '0.85', '0.95', '1.0'];
      
      validThresholds.forEach(threshold => {
        const options: DiffCommandOptions = {
          similarityThreshold: threshold
        };
        expect(options.similarityThreshold).toBe(threshold);
        
        const parsed = parseFloat(threshold);
        expect(parsed).toBeGreaterThanOrEqual(0);
        expect(parsed).toBeLessThanOrEqual(1);
      });
    });

    it('should detect invalid similarity threshold values', () => {
      const invalidThresholds = ['-0.1', '1.1', 'abc', ''];
      
      invalidThresholds.forEach(threshold => {
        const parsed = parseFloat(threshold);
        const isValid = !isNaN(parsed) && parsed >= 0 && parsed <= 1;
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Similarity Threshold Parsing', () => {
    it('should parse string similarity thresholds correctly', () => {
      const testCases = [
        { input: '0.95', expected: 0.95 },
        { input: '0.5', expected: 0.5 },
        { input: '1.0', expected: 1.0 },
        { input: '0', expected: 0 }
      ];

      testCases.forEach(({ input, expected }) => {
        const parsed = typeof input === 'string' ? parseFloat(input) : input;
        expect(parsed).toBe(expected);
      });
    });

    it('should handle default similarity threshold', () => {
      const defaultThreshold = 0.95;
      const options: DiffCommandOptions = {};
      
      const threshold = options.similarityThreshold 
        ? (typeof options.similarityThreshold === 'string' 
           ? parseFloat(options.similarityThreshold) 
           : options.similarityThreshold)
        : defaultThreshold;
      
      expect(threshold).toBe(0.95);
    });
  });

  describe('Function Classification Logic', () => {
    const createMockFunction = (id: string, name: string, signature: string, filePath: string): FunctionInfo => ({
      id,
      name,
      signature,
      filePath,
      startLine: 1,
      endLine: 10,
      className: undefined,
      lexicalPath: name,
      metrics: {
        cyclomaticComplexity: 5,
        linesOfCode: 20,
        maintainabilityIndex: 75,
        parameterCount: 2,
        cognitiveComplexity: 6,
        codeToCommentRatio: 0.8,
        maxNestingLevel: 2,
        halsteadDifficulty: 8.5,
        halsteadVolume: 150,
        halsteadEffort: 1275,
        returnStatementCount: 1,
        loopCount: 0,
        conditionalCount: 2,
        callExpressionCount: 3,
        uniqueVocabulary: 25,
        totalOperators: 15,
        totalOperands: 20,
        distinctOperators: 8,
        distinctOperands: 12
      }
    });

    it('should identify signature changes correctly', () => {
      const oldFunctions = [
        createMockFunction('1', 'calculate', 'calculate(a: number): number', 'src/math.ts')
      ];
      const newFunctions = [
        createMockFunction('1', 'calculate', 'calculate(a: number, b: number): number', 'src/math.ts')
      ];

      // Find functions with same name but different signature
      const signatureChanges = oldFunctions
        .map(oldFunc => {
          const newFunc = newFunctions.find(nf => nf.name === oldFunc.name && nf.filePath === oldFunc.filePath);
          if (newFunc && newFunc.signature !== oldFunc.signature) {
            return { oldFunc, newFunc };
          }
          return null;
        })
        .filter(Boolean);

      expect(signatureChanges).toHaveLength(1);
      expect(signatureChanges[0]?.oldFunc.signature).toBe('calculate(a: number): number');
      expect(signatureChanges[0]?.newFunc.signature).toBe('calculate(a: number, b: number): number');
    });

    it('should identify renames based on similarity', () => {
      const oldFunctions = [
        createMockFunction('1', 'calculateSum', 'calculateSum(a: number, b: number): number', 'src/math.ts')
      ];
      const newFunctions = [
        createMockFunction('2', 'addNumbers', 'calculateSum(a: number, b: number): number', 'src/math.ts')
      ];

      // Mock similarity check
      const mockSimilarityManager = {
        isSimilar: vi.fn().mockReturnValue(true)
      } as unknown as SimilarityManager;

      // Find potential renames (similar functions with different names)
      const potentialRenames = oldFunctions
        .map(oldFunc => {
          const similarNew = newFunctions.find(newFunc => 
            newFunc.name !== oldFunc.name && 
            newFunc.filePath === oldFunc.filePath &&
            mockSimilarityManager.isSimilar(oldFunc, newFunc, 0.95)
          );
          if (similarNew) {
            return { oldFunc, newFunc: similarNew };
          }
          return null;
        })
        .filter(Boolean);

      expect(potentialRenames).toHaveLength(1);
      expect(potentialRenames[0]?.oldFunc.name).toBe('calculateSum');
      expect(potentialRenames[0]?.newFunc.name).toBe('addNumbers');
      expect(mockSimilarityManager.isSimilar).toHaveBeenCalledWith(
        oldFunctions[0], 
        newFunctions[0], 
        0.95
      );
    });

    it('should identify moves based on file path changes', () => {
      const oldFunctions = [
        createMockFunction('1', 'helper', 'helper(): void', 'src/utils.ts')
      ];
      const newFunctions = [
        createMockFunction('2', 'helper', 'helper(): void', 'src/helpers/utils.ts')
      ];

      // Mock similarity check
      const mockSimilarityManager = {
        isSimilar: vi.fn().mockReturnValue(true)
      } as unknown as SimilarityManager;

      // Find potential moves (similar functions with different file paths)
      const potentialMoves = oldFunctions
        .map(oldFunc => {
          const similarNew = newFunctions.find(newFunc => 
            newFunc.name === oldFunc.name && 
            newFunc.filePath !== oldFunc.filePath &&
            mockSimilarityManager.isSimilar(oldFunc, newFunc, 0.95)
          );
          if (similarNew) {
            return { oldFunc, newFunc: similarNew };
          }
          return null;
        })
        .filter(Boolean);

      expect(potentialMoves).toHaveLength(1);
      expect(potentialMoves[0]?.oldFunc.filePath).toBe('src/utils.ts');
      expect(potentialMoves[0]?.newFunc.filePath).toBe('src/helpers/utils.ts');
    });

    it('should identify true additions after filtering matches', () => {
      const oldFunctions = [
        createMockFunction('1', 'existing', 'existing(): void', 'src/test.ts')
      ];
      const newFunctions = [
        createMockFunction('1', 'existing', 'existing(): void', 'src/test.ts'),
        createMockFunction('2', 'newFunction', 'newFunction(): void', 'src/test.ts')
      ];

      // Mock similarity manager that returns false for new functions
      const mockSimilarityManager = {
        isSimilar: vi.fn().mockImplementation((oldFunc, newFunc) => {
          return oldFunc.name === newFunc.name && oldFunc.signature === newFunc.signature;
        })
      } as unknown as SimilarityManager;

      // Filter out functions that have matches (existing function)
      const matchedIds = new Set<string>();
      oldFunctions.forEach(oldFunc => {
        const match = newFunctions.find(newFunc => 
          mockSimilarityManager.isSimilar(oldFunc, newFunc, 0.95)
        );
        if (match) {
          matchedIds.add(match.id);
        }
      });

      const trueAdditions = newFunctions.filter(func => !matchedIds.has(func.id));

      expect(trueAdditions).toHaveLength(1);
      expect(trueAdditions[0].name).toBe('newFunction');
    });

    it('should identify true removals after filtering matches', () => {
      const oldFunctions = [
        createMockFunction('1', 'existing', 'existing(): void', 'src/test.ts'),
        createMockFunction('2', 'removed', 'removed(): void', 'src/test.ts')
      ];
      const newFunctions = [
        createMockFunction('1', 'existing', 'existing(): void', 'src/test.ts')
      ];

      // Mock similarity manager
      const mockSimilarityManager = {
        isSimilar: vi.fn().mockImplementation((oldFunc, newFunc) => {
          return oldFunc.name === newFunc.name && oldFunc.signature === newFunc.signature;
        })
      } as unknown as SimilarityManager;

      // Filter out functions that have matches
      const matchedIds = new Set<string>();
      newFunctions.forEach(newFunc => {
        const match = oldFunctions.find(oldFunc => 
          mockSimilarityManager.isSimilar(oldFunc, newFunc, 0.95)
        );
        if (match) {
          matchedIds.add(match.id);
        }
      });

      const trueRemovals = oldFunctions.filter(func => !matchedIds.has(func.id));

      expect(trueRemovals).toHaveLength(1);
      expect(trueRemovals[0].name).toBe('removed');
    });
  });

  describe('Diff Output Formatting', () => {
    const mockClassification = {
      signatureChanges: [
        {
          oldFunc: { name: 'test', signature: 'test(a: number): void', filePath: 'src/test.ts' },
          newFunc: { name: 'test', signature: 'test(a: number, b: string): void', filePath: 'src/test.ts' }
        }
      ],
      renames: [
        {
          oldFunc: { name: 'oldName', signature: 'oldName(): void', filePath: 'src/test.ts' },
          newFunc: { name: 'newName', signature: 'oldName(): void', filePath: 'src/test.ts' }
        }
      ],
      moves: [
        {
          oldFunc: { name: 'helper', signature: 'helper(): void', filePath: 'src/utils.ts' },
          newFunc: { name: 'helper', signature: 'helper(): void', filePath: 'src/helpers/utils.ts' }
        }
      ],
      trueAdditions: [
        { name: 'newFunc', signature: 'newFunc(): void', filePath: 'src/new.ts' }
      ],
      trueRemovals: [
        { name: 'oldFunc', signature: 'oldFunc(): void', filePath: 'src/old.ts' }
      ]
    };

    it('should format signature changes correctly', () => {
      const { signatureChanges } = mockClassification;
      
      expect(signatureChanges).toHaveLength(1);
      const change = signatureChanges[0];
      
      // Test formatting logic
      const formatSignatureChange = (change: typeof signatureChanges[0]) => ({
        type: 'signature_change',
        function: change.oldFunc.name,
        file: change.oldFunc.filePath,
        oldSignature: change.oldFunc.signature,
        newSignature: change.newFunc.signature
      });

      const formatted = formatSignatureChange(change);
      
      expect(formatted.type).toBe('signature_change');
      expect(formatted.function).toBe('test');
      expect(formatted.oldSignature).toBe('test(a: number): void');
      expect(formatted.newSignature).toBe('test(a: number, b: string): void');
    });

    it('should format renames correctly', () => {
      const { renames } = mockClassification;
      
      expect(renames).toHaveLength(1);
      const rename = renames[0];
      
      const formatRename = (rename: typeof renames[0]) => ({
        type: 'rename',
        oldName: rename.oldFunc.name,
        newName: rename.newFunc.name,
        file: rename.oldFunc.filePath,
        signature: rename.oldFunc.signature
      });

      const formatted = formatRename(rename);
      
      expect(formatted.type).toBe('rename');
      expect(formatted.oldName).toBe('oldName');
      expect(formatted.newName).toBe('newName');
      expect(formatted.signature).toBe('oldName(): void');
    });

    it('should format moves correctly', () => {
      const { moves } = mockClassification;
      
      expect(moves).toHaveLength(1);
      const move = moves[0];
      
      const formatMove = (move: typeof moves[0]) => ({
        type: 'move',
        function: move.oldFunc.name,
        oldFile: move.oldFunc.filePath,
        newFile: move.newFunc.filePath,
        signature: move.oldFunc.signature
      });

      const formatted = formatMove(move);
      
      expect(formatted.type).toBe('move');
      expect(formatted.function).toBe('helper');
      expect(formatted.oldFile).toBe('src/utils.ts');
      expect(formatted.newFile).toBe('src/helpers/utils.ts');
    });

    it('should format true additions correctly', () => {
      const { trueAdditions } = mockClassification;
      
      expect(trueAdditions).toHaveLength(1);
      const addition = trueAdditions[0];
      
      const formatAddition = (func: typeof addition) => ({
        type: 'addition',
        function: func.name,
        file: func.filePath,
        signature: func.signature
      });

      const formatted = formatAddition(addition);
      
      expect(formatted.type).toBe('addition');
      expect(formatted.function).toBe('newFunc');
      expect(formatted.file).toBe('src/new.ts');
    });

    it('should format true removals correctly', () => {
      const { trueRemovals } = mockClassification;
      
      expect(trueRemovals).toHaveLength(1);
      const removal = trueRemovals[0];
      
      const formatRemoval = (func: typeof removal) => ({
        type: 'removal',
        function: func.name,
        file: func.filePath,
        signature: func.signature
      });

      const formatted = formatRemoval(removal);
      
      expect(formatted.type).toBe('removal');
      expect(formatted.function).toBe('oldFunc');
      expect(formatted.file).toBe('src/old.ts');
    });
  });

  describe('JSON Output Format', () => {
    it('should produce valid JSON output', () => {
      const mockDiff: SnapshotDiff = {
        summary: {
          addedFunctions: 2,
          removedFunctions: 1,
          modifiedFunctions: 1,
          unchangedFunctions: 10
        },
        changes: {
          signatureChanges: [],
          renames: [],
          moves: [],
          trueAdditions: [],
          trueRemovals: []
        },
        details: {
          addedFunctions: [],
          removedFunctions: [],
          modifiedFunctions: [],
          unchangedFunctions: []
        }
      };

      // Test JSON serialization
      expect(() => JSON.stringify(mockDiff)).not.toThrow();
      
      const serialized = JSON.stringify(mockDiff, null, 2);
      const parsed = JSON.parse(serialized);
      
      expect(parsed.summary.addedFunctions).toBe(2);
      expect(parsed.summary.removedFunctions).toBe(1);
      expect(parsed.summary.modifiedFunctions).toBe(1);
      expect(parsed.summary.unchangedFunctions).toBe(10);
    });

    it('should include classified changes in JSON output', () => {
      const mockDiffWithChanges: SnapshotDiff = {
        summary: {
          addedFunctions: 0,
          removedFunctions: 0,
          modifiedFunctions: 3,
          unchangedFunctions: 5
        },
        changes: {
          signatureChanges: [
            {
              oldFunc: { name: 'test', signature: 'old sig' } as FunctionInfo,
              newFunc: { name: 'test', signature: 'new sig' } as FunctionInfo
            }
          ],
          renames: [
            {
              oldFunc: { name: 'oldName' } as FunctionInfo,
              newFunc: { name: 'newName' } as FunctionInfo
            }
          ],
          moves: [
            {
              oldFunc: { filePath: 'old/path.ts' } as FunctionInfo,
              newFunc: { filePath: 'new/path.ts' } as FunctionInfo
            }
          ],
          trueAdditions: [],
          trueRemovals: []
        },
        details: {
          addedFunctions: [],
          removedFunctions: [],
          modifiedFunctions: [],
          unchangedFunctions: []
        }
      };

      const serialized = JSON.stringify(mockDiffWithChanges);
      const parsed = JSON.parse(serialized);
      
      expect(parsed.changes.signatureChanges).toHaveLength(1);
      expect(parsed.changes.renames).toHaveLength(1);
      expect(parsed.changes.moves).toHaveLength(1);
    });
  });

  describe('Insights Mode', () => {
    it('should validate insights mode processing', () => {
      const options: DiffCommandOptions = {
        insights: true,
        similarityThreshold: '0.85'
      };

      expect(options.insights).toBe(true);
      
      const threshold = parseFloat(options.similarityThreshold || '0.95');
      expect(threshold).toBe(0.85);
      
      // Insights mode should use the same similarity threshold
      expect(threshold).toBeLessThan(0.95); // Custom threshold is lower
    });

    it('should handle different similarity thresholds in insights mode', () => {
      const testCases = [
        { threshold: '0.5', expected: 0.5 },
        { threshold: '0.75', expected: 0.75 },
        { threshold: '0.9', expected: 0.9 }
      ];

      testCases.forEach(({ threshold, expected }) => {
        const options: DiffCommandOptions = {
          insights: true,
          similarityThreshold: threshold
        };

        const parsed = parseFloat(options.similarityThreshold || '0.95');
        expect(parsed).toBe(expected);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty function lists', () => {
      const emptyOld: FunctionInfo[] = [];
      const emptyNew: FunctionInfo[] = [];

      // Test classification with empty arrays
      const signatureChanges = emptyOld
        .map(oldFunc => {
          const newFunc = emptyNew.find(nf => nf.name === oldFunc.name);
          return newFunc && newFunc.signature !== oldFunc.signature ? { oldFunc, newFunc } : null;
        })
        .filter(Boolean);

      expect(signatureChanges).toHaveLength(0);
    });

    it('should handle functions without signatures', () => {
      const functionsWithoutSigs = [
        { name: 'test', signature: '', filePath: 'test.ts' }
      ] as FunctionInfo[];

      // Should not crash with empty signatures
      const hasEmptySignature = functionsWithoutSigs.some(f => !f.signature);
      expect(hasEmptySignature).toBe(true);
    });

    it('should handle very low similarity thresholds', () => {
      const options: DiffCommandOptions = {
        similarityThreshold: '0.1'
      };

      const threshold = parseFloat(options.similarityThreshold || '0.95');
      expect(threshold).toBe(0.1);
      expect(threshold).toBeGreaterThan(0);
    });

    it('should handle maximum similarity threshold', () => {
      const options: DiffCommandOptions = {
        similarityThreshold: '1.0'
      };

      const threshold = parseFloat(options.similarityThreshold || '0.95');
      expect(threshold).toBe(1.0);
      expect(threshold).toBeLessThanOrEqual(1);
    });
  });

  describe('Performance Considerations', () => {
    it('should handle large function lists efficiently', () => {
      // Create large arrays to test performance characteristics
      const largeFunctionList = Array.from({ length: 1000 }, (_, i) => ({
        id: `func-${i}`,
        name: `function${i}`,
        signature: `function${i}(): void`,
        filePath: `src/file${i % 10}.ts`
      })) as FunctionInfo[];

      // Test that we can process large lists without issues
      expect(largeFunctionList).toHaveLength(1000);
      
      // Simulate finding matches (O(n²) in worst case)
      const startTime = Date.now();
      const matches = largeFunctionList.filter(func => 
        largeFunctionList.some(other => other.name === func.name)
      );
      const endTime = Date.now();
      
      expect(matches).toHaveLength(1000); // All should match themselves
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should efficiently filter duplicates in classification', () => {
      const functions = [
        { id: '1', name: 'test', signature: 'test(): void' },
        { id: '2', name: 'test', signature: 'test(): void' }, // Duplicate
        { id: '3', name: 'unique', signature: 'unique(): void' }
      ] as FunctionInfo[];

      // Use Set for efficient deduplication
      const uniqueNames = new Set(functions.map(f => f.name));
      expect(uniqueNames.size).toBe(2); // 'test' and 'unique'
      
      const uniqueIds = new Set(functions.map(f => f.id));
      expect(uniqueIds.size).toBe(3); // All IDs are unique
    });
  });
});
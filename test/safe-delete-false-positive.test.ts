/**
 * Test cases for safe-delete false positive issues
 * Based on actual failure cases from empirical validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SafeDeletionSystem } from '../src/analyzers/safe-deletion-system';
import { ReachabilityAnalyzer } from '../src/analyzers/reachability-analyzer';
import { EntryPointDetector } from '../src/analyzers/entry-point-detector';
import { FunctionInfo, CallEdge } from '../src/types';

describe('Safe Delete False Positive Analysis', () => {
  let safeDeletionSystem: SafeDeletionSystem;
  let reachabilityAnalyzer: ReachabilityAnalyzer;
  let entryPointDetector: EntryPointDetector;

  beforeEach(() => {
    safeDeletionSystem = new SafeDeletionSystem();
    reachabilityAnalyzer = new ReachabilityAnalyzer();
    entryPointDetector = new EntryPointDetector();
  });

  describe('Failure Case 1: findMinimumHash', () => {
    it('should NOT identify findMinimumHash as deletable when called by winnowHashes', async () => {
      // Mock the exact structure from hash-winnowing-utility.ts
      const functions: FunctionInfo[] = [
        {
          id: 'findMinimumHash-id',
          name: 'findMinimumHash',
          filePath: '/mnt/c/Users/akira/source/repos/funcqc/src/utils/hash-winnowing-utility.ts',
          startLine: 10,
          endLine: 18,
          startColumn: 1,
          endColumn: 1,
          isExported: false,
          semanticId: 'hash-winnowing-utility.ts#findMinimumHash',
          contentId: 'content-findMinimumHash',
          signature: 'function findMinimumHash(hashes: bigint[]): bigint',
          signatureHash: 'sig-findMinimumHash',
          fileHash: 'file-hash-winnowing',
          astHash: 'ast-findMinimumHash',
          displayName: 'findMinimumHash',
          lexicalPath: 'hash-winnowing-utility.ts#findMinimumHash',
          parameters: [
            {
              name: 'hashes',
              type: 'bigint[]',
              typeSimple: 'bigint[]',
              position: 0,
              isOptional: false,
              isRest: false
            }
          ],
          contextPath: [],
          functionType: 'function',
          modifiers: [],
          nestingLevel: 0,
          isAsync: false,
          isGenerator: false,
          isArrowFunction: false,
          isMethod: false,
          isConstructor: false,
          isStatic: false,
          sourceCode: `function findMinimumHash(hashes: bigint[]): bigint {
  let minHash = hashes[0];
  for (let i = 1; i < hashes.length; i++) {
    if (hashes[i] < minHash) {
      minHash = hashes[i];
    }
  }
  return minHash;
}`
        },
        {
          id: 'winnowHashes-id',
          name: 'winnowHashes',
          filePath: '/mnt/c/Users/akira/source/repos/funcqc/src/utils/hash-winnowing-utility.ts',
          startLine: 48,
          endLine: 76,
          startColumn: 1,
          endColumn: 1,
          isExported: true,
          semanticId: 'hash-winnowing-utility.ts#winnowHashes',
          contentId: 'content-winnowHashes',
          signature: 'export function winnowHashes(hashes: bigint[], windowSize: number): bigint[]',
          signatureHash: 'sig-winnowHashes',
          fileHash: 'file-hash-winnowing',
          astHash: 'ast-winnowHashes',
          displayName: 'winnowHashes',
          lexicalPath: 'hash-winnowing-utility.ts#winnowHashes',
          parameters: [
            {
              name: 'hashes',
              type: 'bigint[]',
              typeSimple: 'bigint[]',
              position: 0,
              isOptional: false,
              isRest: false
            },
            {
              name: 'windowSize',
              type: 'number',
              typeSimple: 'number',
              position: 1,
              isOptional: false,
              isRest: false
            }
          ],
          contextPath: [],
          functionType: 'function',
          modifiers: ['export'],
          nestingLevel: 0,
          isAsync: false,
          isGenerator: false,
          isArrowFunction: false,
          isMethod: false,
          isConstructor: false,
          isStatic: false,
          sourceCode: `export function winnowHashes(hashes: bigint[], windowSize: number): bigint[] {
  if (hashes.length === 0) return [];

  // Handle edge cases: window size larger than hash array or invalid window size
  if (windowSize <= 0 || windowSize >= hashes.length) {
    return [findMinimumHash(hashes)];  // ← LINE 53: CRITICAL CALL
  }

  const winnowed: bigint[] = [];
  // ... rest of implementation
  return winnowed;
}`
        }
      ];

      // Mock the call edge from winnowHashes to findMinimumHash (line 53)
      const callEdges: CallEdge[] = [
        {
          id: 'edge-winnow-to-findmin',
          callerFunctionId: 'winnowHashes-id',
          calleeFunctionId: 'findMinimumHash-id',
          confidenceScore: 1.0, // Local exact = 100% confidence
          resolutionLevel: 'local_exact',
          resolutionSource: 'local_exact',
          runtimeConfirmed: false,
          lineNumber: 53,
          columnNumber: 12,
          metadata: {},
          callType: 'function_call',
          callContext: 'conditional_return',
          isAsync: false,
          isChained: false,
          analysisMetadata: {
            timestamp: Date.now(),
            analysisVersion: '1.0',
            sourceHash: 'hash-winnowing-utility.ts'
          }
        }
      ];

      // Execute safe deletion analysis
      const result = await safeDeletionSystem.performSafeDeletion(
        functions,
        callEdges,
        {
          confidenceThreshold: 0.95,
          dryRun: true,
          excludeExports: true,
          createBackup: false,
          maxFunctionsPerBatch: 10,
          excludePatterns: ['**/node_modules/**']
        }
      );

      // ASSERTION: findMinimumHash should NOT be in deletion candidates
      const findMinimumHashCandidate = result.candidateFunctions.find(
        c => c.functionInfo.name === 'findMinimumHash'
      );

      expect(findMinimumHashCandidate).toBeUndefined();
      expect(result.candidateFunctions).not.toContain(
        expect.objectContaining({
          functionInfo: expect.objectContaining({
            name: 'findMinimumHash'
          })
        })
      );

      // Log for debugging
      if (findMinimumHashCandidate) {
        console.error('❌ FAILED: findMinimumHash was identified as deletable:', {
          reason: findMinimumHashCandidate.reason,
          confidenceScore: findMinimumHashCandidate.confidenceScore,
          callersCount: findMinimumHashCandidate.callersCount
        });
      }
    });
  });

  describe('Failure Case 2: formatPostgresArray', () => {
    it('should NOT identify formatPostgresArray as deletable when called by buildFunctionRow', async () => {
      // Mock the exact structure from bulk-insert-utils.ts
      const functions: FunctionInfo[] = [
        {
          id: 'formatPostgresArray-id',
          name: 'formatPostgresArray',
          filePath: '/mnt/c/Users/akira/source/repos/funcqc/src/storage/bulk-insert-utils.ts',
          startLine: 11,
          endLine: 21,
          startColumn: 1,
          endColumn: 1,
          isExported: false,
          semanticId: 'bulk-insert-utils.ts#formatPostgresArray',
          contentId: 'content-formatPostgresArray',
          signature: 'function formatPostgresArray(arr: string[]): string',
          signatureHash: 'sig-formatPostgresArray',
          fileHash: 'file-hash-bulk',
          astHash: 'ast-formatPostgresArray',
          displayName: 'formatPostgresArray',
          lexicalPath: 'bulk-insert-utils.ts#formatPostgresArray',
          parameters: [
            {
              name: 'arr',
              type: 'string[]',
              typeSimple: 'string[]',
              position: 0,
              isOptional: false,
              isRest: false
            }
          ],
          contextPath: [],
          functionType: 'function',
          modifiers: [],
          nestingLevel: 0,
          isAsync: false,
          isGenerator: false,
          isArrowFunction: false,
          isMethod: false,
          isConstructor: false,
          isStatic: false,
          sourceCode: `function formatPostgresArray(arr: string[]): string {
  if (!arr || arr.length === 0) return '{}';
  return \`{\${arr.map(item => {
    const escaped = item
      .replace(/\\\\/g, '\\\\\\\\')
      .replace(/"/g, '\\\\"');
    return \`"\${escaped}"\`;
  }).join(',')}\}\`;
}`
        },
        {
          id: 'buildFunctionRow-id',
          name: 'buildFunctionRow',
          filePath: '/mnt/c/Users/akira/source/repos/funcqc/src/storage/bulk-insert-utils.ts',
          startLine: 57,
          endLine: 88,
          startColumn: 1,
          endColumn: 1,
          isExported: false,
          semanticId: 'bulk-insert-utils.ts#buildFunctionRow',
          contentId: 'content-buildFunctionRow',
          signature: 'function buildFunctionRow(func: FunctionInfo, snapshotId: string): unknown[]',
          signatureHash: 'sig-buildFunctionRow',
          fileHash: 'file-hash-bulk',
          astHash: 'ast-buildFunctionRow',
          displayName: 'buildFunctionRow',
          lexicalPath: 'bulk-insert-utils.ts#buildFunctionRow',
          parameters: [
            {
              name: 'func',
              type: 'FunctionInfo',
              typeSimple: 'FunctionInfo',
              position: 0,
              isOptional: false,
              isRest: false
            },
            {
              name: 'snapshotId',
              type: 'string',
              typeSimple: 'string',
              position: 1,
              isOptional: false,
              isRest: false
            }
          ],
          contextPath: [],
          functionType: 'function',
          modifiers: [],
          nestingLevel: 0,
          isAsync: false,
          isGenerator: false,
          isArrowFunction: false,
          isMethod: false,
          isConstructor: false,
          isStatic: false,
          sourceCode: `function buildFunctionRow(func: FunctionInfo, snapshotId: string): unknown[] {
  return [
    func.id,
    func.semanticId,
    func.contentId,
    snapshotId,
    func.name,
    func.displayName,
    func.signature,
    func.signatureHash,
    func.filePath,
    func.fileHash,
    func.startLine,
    func.endLine,
    func.startColumn,
    func.endColumn,
    func.astHash,
    formatPostgresArray(func.contextPath || []),    // ← LINE 74: CRITICAL CALL
    func.functionType || null,
    formatPostgresArray(func.modifiers || []),      // ← LINE 76: CRITICAL CALL
    func.nestingLevel || 0,
    func.isExported,
    func.isAsync,
    func.isGenerator,
    func.isArrowFunction,
    func.isMethod,
    func.isConstructor,
    func.isStatic,
    func.accessModifier || null,
    func.sourceCode || null,
  ];
}`
        }
      ];

      // Mock the call edges from buildFunctionRow to formatPostgresArray (lines 74, 76)
      const callEdges: CallEdge[] = [
        {
          id: 'edge-build-to-format-74',
          callerFunctionId: 'buildFunctionRow-id',
          calleeFunctionId: 'formatPostgresArray-id',
          confidenceScore: 1.0,
          resolutionLevel: 'local_exact',
          resolutionSource: 'local_exact',
          runtimeConfirmed: false,
          lineNumber: 74,
          columnNumber: 5,
          metadata: {},
          callType: 'function_call',
          callContext: 'array_return',
          isAsync: false,
          isChained: false,
          analysisMetadata: {
            timestamp: Date.now(),
            analysisVersion: '1.0',
            sourceHash: 'bulk-insert-utils.ts'
          }
        },
        {
          id: 'edge-build-to-format-76',
          callerFunctionId: 'buildFunctionRow-id',
          calleeFunctionId: 'formatPostgresArray-id',
          confidenceScore: 1.0,
          resolutionLevel: 'local_exact',
          resolutionSource: 'local_exact',
          runtimeConfirmed: false,
          lineNumber: 76,
          columnNumber: 5,
          metadata: {},
          callType: 'function_call',
          callContext: 'array_return',
          isAsync: false,
          isChained: false,
          analysisMetadata: {
            timestamp: Date.now(),
            analysisVersion: '1.0',
            sourceHash: 'bulk-insert-utils.ts'
          }
        }
      ];

      // Execute safe deletion analysis
      const result = await safeDeletionSystem.performSafeDeletion(
        functions,
        callEdges,
        {
          confidenceThreshold: 0.95,
          dryRun: true,
          excludeExports: true,
          createBackup: false,
          maxFunctionsPerBatch: 10,
          excludePatterns: ['**/node_modules/**']
        }
      );

      // ASSERTION: formatPostgresArray should NOT be in deletion candidates
      const formatPostgresArrayCandidate = result.candidateFunctions.find(
        c => c.functionInfo.name === 'formatPostgresArray'
      );

      expect(formatPostgresArrayCandidate).toBeUndefined();
      expect(result.candidateFunctions).not.toContain(
        expect.objectContaining({
          functionInfo: expect.objectContaining({
            name: 'formatPostgresArray'
          })
        })
      );

      // Log for debugging
      if (formatPostgresArrayCandidate) {
        console.error('❌ FAILED: formatPostgresArray was identified as deletable:', {
          reason: formatPostgresArrayCandidate.reason,
          confidenceScore: formatPostgresArrayCandidate.confidenceScore,
          callersCount: formatPostgresArrayCandidate.callersCount
        });
      }
    });
  });

  describe('Root Cause Analysis', () => {
    it('should verify that high-confidence call edges are properly detected', async () => {
      // This is a diagnostic test to understand where the problem lies
      const functions: FunctionInfo[] = [
        {
          id: 'caller-id',
          name: 'caller',
          filePath: '/test/same-file.ts',
          startLine: 1,
          endLine: 5,
          isExported: true,
          // ... minimal required properties
        } as FunctionInfo,
        {
          id: 'callee-id',
          name: 'callee',
          filePath: '/test/same-file.ts',
          startLine: 7,
          endLine: 10,
          isExported: false,
          // ... minimal required properties
        } as FunctionInfo,
      ];

      const callEdges: CallEdge[] = [
        {
          id: 'test-edge',
          callerFunctionId: 'caller-id',
          calleeFunctionId: 'callee-id',
          confidenceScore: 1.0,
          resolutionLevel: 'local_exact',
          resolutionSource: 'local_exact',
          // ... minimal required properties
        } as CallEdge
      ];

      // Test the individual components
      const entryPoints = entryPointDetector.detectEntryPoints(functions);
      console.log('Entry points detected:', entryPoints.map(ep => ep.functionId));

      const reachabilityResult = reachabilityAnalyzer.analyzeReachability(
        functions,
        callEdges,
        entryPoints
      );
      console.log('Reachability result:', {
        reachable: reachabilityResult.reachable.size,
        unreachable: reachabilityResult.unreachable.size,
        reachableIds: Array.from(reachabilityResult.reachable),
        unreachableIds: Array.from(reachabilityResult.unreachable)
      });

      // The callee should be reachable from the caller if entry point detection works correctly
      expect(reachabilityResult.reachable).toContain('callee-id');
    });
  });
});
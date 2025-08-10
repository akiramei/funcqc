/**
 * Regression test for import resolution functionality
 * 
 * This test ensures that the CallGraphAnalyzer correctly resolves imports
 * and detects cross-file function calls, fixing the issue where 
 * performSingleFunctionAnalysis → buildDependencyTree edge wasn't detected.
 */

import { describe, it, expect } from 'vitest';
import { CallGraphAnalyzer } from '../../analyzers/call-graph-analyzer';
import { Project, Node } from 'ts-morph';

describe('Import Resolution', () => {
  it('should detect simple import and function call', async () => {
    // Create test project
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      skipLoadingLibFiles: true,
    });

    // Add test files
    const callerFile = project.createSourceFile('test-caller.ts', `
import { testCallee } from './test-helper';

export function testCaller() {
  return testCallee();
}
`);

    const calleeFile = project.createSourceFile('test-helper.ts', `
export function testCallee() {
  return "Hello";
}
`);

    // Create unified function map that includes all functions from all files
    const allFunctionMap = new Map();
    
    callerFile.forEachDescendant(node => {
      if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
        const name = node.getName?.() || 'anonymous';
        const id = `caller-${name}-test-id`;
        allFunctionMap.set(`test-caller.ts:${name}`, {
          id,
          name,
          startLine: node.getStartLineNumber(),
          endLine: node.getEndLineNumber()
        });
      }
    });

    calleeFile.forEachDescendant(node => {
      if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
        const name = node.getName?.() || 'anonymous';
        const id = `callee-${name}-test-id`;
        allFunctionMap.set(`test-helper.ts:${name}`, {
          id,
          name,
          startLine: node.getStartLineNumber(),
          endLine: node.getEndLineNumber()
        });
      }
    });

    // Create global allowed function set
    const allFunctions = new Set(Array.from(allFunctionMap.values()).map(f => f.id));

    // Create getFunctionIdByDeclaration function using unified map
    const getFunctionIdByDeclaration = (decl: Node): string | undefined => {
      for (const [, func] of allFunctionMap.entries()) {
        const s = decl.getStartLineNumber();
        const e = decl.getEndLineNumber();
        if (Math.abs(s - func.startLine) <= 1 && Math.abs(e - func.endLine) <= 1) {
          return func.id;
        }
      }
      return undefined;
    };

    const analyzer = new CallGraphAnalyzer(project, true);

    // Analyze caller file with unified function map
    const edges = await analyzer.analyzeFile(
      'test-caller.ts',
      allFunctionMap,
      getFunctionIdByDeclaration,
      allFunctions
    );

    // Assertions
    expect(edges.length).toBe(1);
    expect(edges[0].calleeName).toBe('testCallee');
    expect(edges[0].callType).toBe('direct');
    expect(edges[0].callerFunctionId).toBe('caller-testCaller-test-id');
    expect(edges[0].calleeFunctionId).toBe('callee-testCallee-test-id');
    expect(edges[0].confidenceScore).toBeGreaterThan(0.8);
  });

  it('should handle different import patterns', async () => {
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      skipLoadingLibFiles: true,
    });

    // Test named imports
    const namedImportFile = project.createSourceFile('named-import.ts', `
import { namedFunction } from './utils';
export function caller() {
  return namedFunction();
}
`);

    const utilsFile = project.createSourceFile('utils.ts', `
export function namedFunction() {
  return "named";
}

export function anotherFunction() {
  return "another";
}
`);

    // Create unified function map with file-specific line number mapping to avoid conflicts
    const allFunctionMap = new Map();
    const sourceFileToOffset = new Map([
      ['named-import.ts', 0],
      ['utils.ts', 1000]  // Use large offset to avoid line number conflicts
    ]);
    
    // Add functions from named-import.ts with original line numbers
    namedImportFile.forEachDescendant(node => {
      if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
        const name = node.getName?.() || 'anonymous';
        const id = `caller-${name}-test-id`;
        allFunctionMap.set(`named-import:${name}`, {
          id,
          name,
          startLine: node.getStartLineNumber(),
          endLine: node.getEndLineNumber()
        });
      }
    });

    // Add functions from utils.ts with offset line numbers to avoid conflicts
    utilsFile.forEachDescendant(node => {
      if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
        const name = node.getName?.() || 'anonymous';
        const id = `utils-${name}-test-id`;
        const offset = sourceFileToOffset.get('utils.ts') || 0;
        allFunctionMap.set(`utils:${name}`, {
          id,
          name,
          startLine: node.getStartLineNumber() + offset,
          endLine: node.getEndLineNumber() + offset
        });
      }
    });

    const allFunctions = new Set(Array.from(allFunctionMap.values()).map(f => f.id));

    const getFunctionId = (decl: Node): string | undefined => {
      const sourceLine = decl.getStartLineNumber();
      const sourceEnd = decl.getEndLineNumber();
      const sourceFile = decl.getSourceFile();
      const fileName = sourceFile.getBaseName();
      
      // Try file-specific offset match first for external files
      if (fileName !== 'named-import.ts') {
        const offset = sourceFileToOffset.get(fileName) || 0;
        const adjustedStartLine = sourceLine + offset;
        const adjustedEndLine = sourceEnd + offset;
        
        // Create expected key prefix by removing .ts extension
        const expectedPrefix = fileName.replace('.ts', '');
        
        for (const [key, func] of allFunctionMap.entries()) {
          if (Math.abs(adjustedStartLine - func.startLine) <= 1 && Math.abs(adjustedEndLine - func.endLine) <= 1) {
            // Ensure key matches the expected file prefix
            if (key.startsWith(`${expectedPrefix}:`)) {
              return func.id;
            }
          }
        }
      }
      
      // Try direct match for same-file functions (±1 tolerance)
      const expectedPrefix = fileName.replace('.ts', '');
      for (const [key, func] of allFunctionMap.entries()) {
        if (Math.abs(sourceLine - func.startLine) <= 1 && Math.abs(sourceEnd - func.endLine) <= 1) {
          // Ensure key matches the expected file prefix
          if (key.startsWith(`${expectedPrefix}:`)) {
            return func.id;
          }
        }
      }
      
      return undefined;
    };

    const analyzer = new CallGraphAnalyzer(project, true);
    const edges = await analyzer.analyzeFile('named-import.ts', allFunctionMap, getFunctionId, allFunctions);

    expect(edges.length).toBe(1);
    expect(edges[0].calleeName).toBe('namedFunction');
    expect(edges[0].calleeFunctionId).toBe('utils-namedFunction-test-id');
  });
});
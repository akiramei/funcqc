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

    // Create function maps
    const callerFunctionMap = new Map();
    callerFile.forEachDescendant(node => {
      if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
        const name = node.getName?.() || 'anonymous';
        const id = `caller-${name}-test-id`;
        callerFunctionMap.set(name, {
          id,
          name,
          startLine: node.getStartLineNumber(),
          endLine: node.getEndLineNumber()
        });
      }
    });

    const calleeFunctionMap = new Map();
    calleeFile.forEachDescendant(node => {
      if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
        const name = node.getName?.() || 'anonymous';
        const id = `callee-${name}-test-id`;
        calleeFunctionMap.set(name, {
          id,
          name,
          startLine: node.getStartLineNumber(),
          endLine: node.getEndLineNumber()
        });
      }
    });

    // Create global allowed function set
    const allFunctions = new Set([
      ...Array.from(callerFunctionMap.values()).map(f => f.id),
      ...Array.from(calleeFunctionMap.values()).map(f => f.id)
    ]);

    // Create getFunctionIdByDeclaration function
    const getFunctionIdByDeclaration = (decl: Node): string | undefined => {
      // Check caller functions
      for (const [name, func] of callerFunctionMap.entries()) {
        if (decl.getStartLineNumber() === func.startLine && decl.getEndLineNumber() === func.endLine) {
          return func.id;
        }
      }
      
      // Check callee functions
      for (const [name, func] of calleeFunctionMap.entries()) {
        if (decl.getStartLineNumber() === func.startLine && decl.getEndLineNumber() === func.endLine) {
          return func.id;
        }
      }
      
      return undefined;
    };

    // Create analyzer
    const analyzer = new CallGraphAnalyzer(project, true);

    // Analyze caller file
    const edges = await analyzer.analyzeFile(
      'test-caller.ts',
      callerFunctionMap,
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

    // Create simple function maps
    const functionMap = new Map([
      ['caller', { id: 'caller-id', name: 'caller', startLine: 3, endLine: 5 }]
    ]);
    
    const utilsMap = new Map([
      ['namedFunction', { id: 'named-id', name: 'namedFunction', startLine: 2, endLine: 4 }],
      ['anotherFunction', { id: 'another-id', name: 'anotherFunction', startLine: 6, endLine: 8 }]
    ]);

    const allFunctions = new Set(['caller-id', 'named-id', 'another-id']);

    const getFunctionId = (decl: Node): string | undefined => {
      const line = decl.getStartLineNumber();
      if (line === 3) return 'caller-id';
      if (line === 2) return 'named-id';
      if (line === 6) return 'another-id';
      return undefined;
    };

    const analyzer = new CallGraphAnalyzer(project, true);
    const edges = await analyzer.analyzeFile('named-import.ts', functionMap, getFunctionId, allFunctions);

    expect(edges.length).toBe(1);
    expect(edges[0].calleeName).toBe('namedFunction');
    expect(edges[0].calleeFunctionId).toBe('named-id');
  });
});
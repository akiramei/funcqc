import { describe, expect, it } from 'vitest';
import { CallGraphAnalyzer } from '../src/analyzers/call-graph-analyzer';
import path from 'path';

describe('CallGraphAnalyzer Integration Tests', () => {
  it('should analyze call relationships in test file', async () => {
    const analyzer = new CallGraphAnalyzer(false);
    const testFilePath = path.join(__dirname, 'fixtures/call-graph-test.ts');
    
    // Create function map matching the actual fixture file
    const functionMap = new Map([
      ['func1', { id: 'func1', name: 'testFunction1', startLine: 2, endLine: 5 }],
      ['func2', { id: 'func2', name: 'testFunction2', startLine: 7, endLine: 10 }],
      ['func3', { id: 'func3', name: 'testFunction3', startLine: 12, endLine: 14 }],
      ['func4', { id: 'func4', name: 'externalCall', startLine: 17, endLine: 20 }],
      ['func5', { id: 'func5', name: 'asyncFunction', startLine: 23, endLine: 26 }],
    ]);

    const callEdges = await analyzer.analyzeFile(testFilePath, functionMap);
    
    // Should find at least some call relationships
    expect(callEdges).toBeDefined();
    expect(Array.isArray(callEdges)).toBe(true);
    
    // Should have some call edges (at least testFunction1 -> testFunction2)
    expect(callEdges.length).toBeGreaterThan(0);
    
    // Verify specific call relationships from the fixture
    const testFunction1ToTestFunction2 = callEdges.find(
      edge => edge.callerFunctionId === 'func1' && edge.calleeName === 'testFunction2'
    );
    expect(testFunction1ToTestFunction2).toBeDefined();
    expect(testFunction1ToTestFunction2?.callType).toBe('direct');
    expect(testFunction1ToTestFunction2?.lineNumber).toBe(3);
    
    const testFunction2ToTestFunction3 = callEdges.find(
      edge => edge.callerFunctionId === 'func2' && edge.calleeName === 'testFunction3'
    );
    expect(testFunction2ToTestFunction3).toBeDefined();
    expect(testFunction2ToTestFunction3?.callType).toBe('direct');
    expect(testFunction2ToTestFunction3?.lineNumber).toBe(8);
    
    // Check that call edges have required properties
    for (const edge of callEdges) {
      expect(edge).toHaveProperty('id');
      expect(edge).toHaveProperty('callerFunctionId');
      expect(edge).toHaveProperty('calleeName');
      expect(edge).toHaveProperty('callType');
      expect(edge).toHaveProperty('lineNumber');
      expect(edge).toHaveProperty('confidenceScore');
      expect(edge.confidenceScore).toBeGreaterThan(0);
    }
  });

  it('should handle files with no function calls', async () => {
    const analyzer = new CallGraphAnalyzer(false);
    
    // Use a simple file with no calls
    const functionMap = new Map([
      ['simple', { id: 'simple', name: 'simpleFunction', startLine: 1, endLine: 3 }],
    ]);

    const callEdges = await analyzer.analyzeFile(path.join(__dirname, 'fixtures/sample.ts'), functionMap);
    
    expect(callEdges).toBeDefined();
    expect(Array.isArray(callEdges)).toBe(true);
    // May be empty if no calls are found
  });
});
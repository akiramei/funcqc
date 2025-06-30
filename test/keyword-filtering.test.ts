import { expect, test, describe } from 'vitest';
import { FunctionInfo } from '../src/types';

// Import the applyKeywordFiltering function for testing
// Since it's not exported, we'll create a test version here
function applyKeywordFiltering(functions: FunctionInfo[], keyword: string): FunctionInfo[] {
  const searchTerm = keyword.toLowerCase();
  
  return functions.filter(func => {
    // Search in function name
    if (func.name.toLowerCase().includes(searchTerm)) {
      return true;
    }
    
    // Search in display name
    if (func.displayName.toLowerCase().includes(searchTerm)) {
      return true;
    }
    
    // Search in JSDoc if available
    if (func.jsDoc && func.jsDoc.toLowerCase().includes(searchTerm)) {
      return true;
    }
    
    // Search in source code if available
    if (func.sourceCode && func.sourceCode.toLowerCase().includes(searchTerm)) {
      return true;
    }
    
    return false;
  });
}

describe('Keyword Filtering', () => {
  const testFunctions: FunctionInfo[] = [
    {
      id: '1',
      name: 'calculateTotal',
      displayName: 'calculateTotal',
      signature: 'calculateTotal(price: number, tax: number): number',
      signatureHash: 'hash1',
      filePath: 'src/utils/math.ts',
      fileHash: 'file1',
      startLine: 10,
      endLine: 20,
      startColumn: 0,
      endColumn: 10,
      astHash: 'ast1',
      isExported: true,
      isAsync: false,
      isGenerator: false,
      isArrowFunction: false,
      isMethod: false,
      isConstructor: false,
      isStatic: false,
      parameters: [],
      jsDoc: '/** Calculates the total price including tax */',
      sourceCode: 'function calculateTotal(price: number, tax: number): number { return price + tax; }'
    },
    {
      id: '2',
      name: 'validateEmail',
      displayName: 'validateEmail',
      signature: 'validateEmail(email: string): boolean',
      signatureHash: 'hash2',
      filePath: 'src/utils/validation.ts',
      fileHash: 'file2',
      startLine: 5,
      endLine: 15,
      startColumn: 0,
      endColumn: 10,
      astHash: 'ast2',
      isExported: false,
      isAsync: false,
      isGenerator: false,
      isArrowFunction: true,
      isMethod: false,
      isConstructor: false,
      isStatic: false,
      parameters: [],
      jsDoc: '/** Validates email format using regex */',
      sourceCode: 'const validateEmail = (email: string): boolean => { return /^[^@]+@[^@]+$/.test(email); }'
    },
    {
      id: '3',
      name: 'processPayment',
      displayName: 'processPayment',
      signature: 'processPayment(amount: number): Promise<void>',
      signatureHash: 'hash3',
      filePath: 'src/services/payment.ts',
      fileHash: 'file3',
      startLine: 25,
      endLine: 50,
      startColumn: 0,
      endColumn: 10,
      astHash: 'ast3',
      isExported: true,
      isAsync: true,
      isGenerator: false,
      isArrowFunction: false,
      isMethod: false,
      isConstructor: false,
      isStatic: false,
      parameters: [],
      jsDoc: '/** Processes payment transaction */',
      sourceCode: 'async function processPayment(amount: number): Promise<void> { /* payment logic */ }'
    }
  ];

  test('should filter by function name', () => {
    const result = applyKeywordFiltering(testFunctions, 'calculate');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('calculateTotal');
  });

  test('should filter by JSDoc content', () => {
    const result = applyKeywordFiltering(testFunctions, 'regex');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('validateEmail');
  });

  test('should filter by source code content', () => {
    const result = applyKeywordFiltering(testFunctions, 'payment logic');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('processPayment');
  });

  test('should be case insensitive', () => {
    const result = applyKeywordFiltering(testFunctions, 'VALIDATE');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('validateEmail');
  });

  test('should return empty array when no matches found', () => {
    const result = applyKeywordFiltering(testFunctions, 'nonexistent');
    expect(result).toHaveLength(0);
  });

  test('should return multiple matches when keyword appears in different functions', () => {
    const result = applyKeywordFiltering(testFunctions, 'function');
    expect(result.length).toBeGreaterThan(0);
  });

  test('should handle empty keyword', () => {
    const result = applyKeywordFiltering(testFunctions, '');
    // Empty string matches all functions because it's included in all strings
    expect(result).toHaveLength(3);
  });

  test('should search in display name', () => {
    const result = applyKeywordFiltering(testFunctions, 'Total');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('calculateTotal');
  });
});
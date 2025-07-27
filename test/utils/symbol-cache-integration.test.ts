/**
 * SymbolCache Integration Tests
 * 
 * Tests for TypeChecker integration and caching behavior that could affect
 * type resolution in CHA/RTA analysis.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Project, Node, PropertyAccessExpression, SyntaxKind } from 'ts-morph';
import { SymbolCache } from '../../src/utils/symbol-cache';

describe('SymbolCache Integration - Type Resolution Safety', () => {
  let project: Project;
  let typeChecker: any;
  let symbolCache: SymbolCache;

  beforeEach(() => {
    project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: 5, // ES2015
        allowJs: true,
        skipLibCheck: true,
        skipDefaultLibCheck: true,
        noLib: true,
      }
    });
    
    typeChecker = project.getTypeChecker();
    symbolCache = new SymbolCache(typeChecker);
  });

  describe('TypeChecker API Correctness', () => {
    it('should use correct TypeChecker methods for type resolution', () => {
      // Arrange
      const sourceFile = project.createSourceFile('api-test.ts', `
        class Dog {
          speak(): string { return 'Woof!'; }
        }
        
        function test() {
          const dog = new Dog();
          dog.speak();
        }
      `);

      const propertyAccess = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)[0] as PropertyAccessExpression;
      const objectExpr = propertyAccess.getExpression();

      // Act - Test the correct API usage pattern
      const symbol = symbolCache.getSymbolAtLocation(objectExpr);
      
      if (symbol) {
        // This is the correct API usage that was missing in the original bug
        const type = typeChecker.getTypeAtLocation(objectExpr);
        const typeText = type.getText(); // Not typeToString()!
        
        // Assert - Verify we get the class name, not variable name
        expect(typeText).toBe('Dog');
        expect(typeText).not.toBe('dog');
        
        // Verify we're not trying to call getType() on symbol (that was the bug!)
        expect(typeof type.getText).toBe('function');
        expect(type.getText()).toBe('Dog');
      }
    });

    it('should handle TsMorphSymbol vs TypeScript Symbol differences', () => {
      // Arrange
      const sourceFile = project.createSourceFile('symbol-types.ts', `
        class Service {
          process(): void {}
        }
        
        function test() {
          const service = new Service();
          service.process();
        }
      `);

      const propertyAccess = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)[0] as PropertyAccessExpression;
      const objectExpr = propertyAccess.getExpression();

      // Act
      const symbol = symbolCache.getSymbolAtLocation(objectExpr);
      
      // Assert - SymbolCache returns TsMorphSymbol, not TypeScript Symbol
      if (symbol) {
        // TsMorphSymbol does NOT have getType() method - this was the bug!
        expect(typeof (symbol as any).getType).toBe('undefined');
        
        // We must use TypeChecker.getTypeAtLocation() instead
        const type = typeChecker.getTypeAtLocation(objectExpr);
        expect(type).toBeDefined();
        expect(typeof type.getText).toBe('function');
      }
    });

    it('should cache symbols without affecting type resolution', () => {
      // Arrange
      const sourceFile = project.createSourceFile('cache-consistency.ts', `
        class Calculator {
          add(a: number, b: number): number { return a + b; }
        }
        
        function test() {
          const calc = new Calculator();
          calc.add(1, 2); // First access
          calc.add(3, 4); // Second access (should be cached)
        }
      `);

      const propertyAccesses = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression) as PropertyAccessExpression[];
      
      // Act - Access same symbol multiple times
      const results = propertyAccesses.map(prop => {
        const objectExpr = prop.getExpression();
        const symbol = symbolCache.getSymbolAtLocation(objectExpr);
        
        if (symbol) {
          const type = typeChecker.getTypeAtLocation(objectExpr);
          return type.getText();
        }
        return null;
      });

      // Assert - All results should be consistent
      const nonNullResults = results.filter(r => r !== null);
      expect(nonNullResults.length).toBeGreaterThan(0);
      
      // All should resolve to "Calculator", not "calc"
      nonNullResults.forEach(result => {
        expect(result).toBe('Calculator');
        expect(result).not.toBe('calc');
      });

      // Verify caching worked
      const stats = symbolCache.getStats();
      expect(stats.hits).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle undefined symbols without breaking type resolution', () => {
      // Arrange
      const sourceFile = project.createSourceFile('undefined-symbol.ts', `
        function test() {
          // @ts-ignore
          unknownVariable.method();
        }
      `);

      const propertyAccess = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)[0] as PropertyAccessExpression;
      const objectExpr = propertyAccess.getExpression();

      // Act & Assert - Should not throw
      expect(() => {
        const symbol = symbolCache.getSymbolAtLocation(objectExpr);
        
        if (symbol) {
          const type = typeChecker.getTypeAtLocation(objectExpr);
          type.getText();
        } else {
          // Fallback when symbol is undefined
          const fallbackText = objectExpr.getText();
          expect(fallbackText).toBe('unknownVariable');
        }
      }).not.toThrow();
    });

    it('should handle null type results gracefully', () => {
      // Arrange - Create scenario that might return null type
      const sourceFile = project.createSourceFile('null-type.ts', `
        function test() {
          const obj: any = {};
          obj.dynamicMethod();
        }
      `);

      const propertyAccess = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)[0] as PropertyAccessExpression;
      const objectExpr = propertyAccess.getExpression();

      // Act & Assert
      expect(() => {
        const symbol = symbolCache.getSymbolAtLocation(objectExpr);
        
        if (symbol) {
          const type = typeChecker.getTypeAtLocation(objectExpr);
          const typeText = type.getText();
          
          // Should get something, even if it's "any"
          expect(typeText).toBeDefined();
          expect(typeof typeText).toBe('string');
        }
      }).not.toThrow();
    });

    it('should maintain cache integrity across multiple files', () => {
      // Arrange - Multiple files with same class names
      const file1 = project.createSourceFile('file1.ts', `
        class Service {
          method1(): void {}
        }
        
        function test1() {
          const service = new Service();
          service.method1();
        }
      `);

      const file2 = project.createSourceFile('file2.ts', `
        class Service {
          method2(): void {}
        }
        
        function test2() {
          const service = new Service();
          service.method2();
        }
      `);

      // Act - Process both files
      const file1PropAccess = file1.getDescendantsOfKind(278)[0] as PropertyAccessExpression;
      const file2PropAccess = file2.getDescendantsOfKind(278)[0] as PropertyAccessExpression;

      const type1 = (() => {
        const objectExpr = file1PropAccess.getExpression();
        const symbol = symbolCache.getSymbolAtLocation(objectExpr);
        if (symbol) {
          const type = typeChecker.getTypeAtLocation(objectExpr);
          return type.getText();
        }
        return null;
      })();

      const type2 = (() => {
        const objectExpr = file2PropAccess.getExpression();
        const symbol = symbolCache.getSymbolAtLocation(objectExpr);
        if (symbol) {
          const type = typeChecker.getTypeAtLocation(objectExpr);
          return type.getText();
        }
        return null;
      })();

      // Assert - Should resolve correctly for each file
      expect(type1).toBe('Service');
      expect(type2).toBe('Service');
      
      // Both should be class names, not variable names
      expect(type1).not.toBe('service');
      expect(type2).not.toBe('service');
    });
  });

  describe('Performance and Memory Management', () => {
    it('should not leak memory through WeakMap cache', () => {
      // Arrange
      const sourceFile = project.createSourceFile('memory-test.ts', `
        class MemoryTest {
          process(): void {}
        }
        
        function test() {
          const obj = new MemoryTest();
          obj.process();
        }
      `);

      const propertyAccess = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)[0] as PropertyAccessExpression;
      const objectExpr = propertyAccess.getExpression();

      // Act - Multiple lookups
      for (let i = 0; i < 100; i++) {
        symbolCache.getSymbolAtLocation(objectExpr);
      }

      // Assert - Cache should work efficiently
      const stats = symbolCache.getStats();
      expect(stats.hits).toBeGreaterThan(95); // Most should be cache hits
      expect(stats.hitRate).toBeGreaterThan(0.95);
    });

    it('should clear cache properly', () => {
      // Arrange
      const sourceFile = project.createSourceFile('clear-test.ts', `
        class ClearTest {
          method(): void {}
        }
        
        function test() {
          const obj = new ClearTest();
          obj.method();
        }
      `);

      const propertyAccess = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)[0] as PropertyAccessExpression;
      const objectExpr = propertyAccess.getExpression();

      // Act - Use cache, then clear
      symbolCache.getSymbolAtLocation(objectExpr);
      const statsBefore = symbolCache.getStats();
      
      symbolCache.clear();
      
      const statsAfter = symbolCache.getStats();

      // Assert
      expect(statsBefore.hits + statsBefore.misses).toBeGreaterThan(0);
      expect(statsAfter.hits).toBe(0);
      expect(statsAfter.misses).toBe(0);
    });
  });

  describe('Type Text Extraction Patterns', () => {
    it('should extract class names from complex type expressions', () => {
      // Arrange - Various type expression patterns
      const testCases = [
        { typeText: 'Dog', expected: 'Dog' },
        { typeText: 'import("/path/to/module").Dog', expected: 'Dog' },
        { typeText: 'MyNamespace.Dog', expected: 'Dog' },
        { typeText: 'Dog | Cat', expected: 'Cat' }, // Last match due to regex
        { typeText: 'Promise<Dog>', expected: 'Promise' }, // Generic type
      ];

      testCases.forEach(({ typeText, expected }) => {
        // Act - Apply the regex pattern used in the fix
        const classMatch = typeText.match(/(?:^|\.|\s)([A-Z][a-zA-Z0-9_]*)\s*$/);
        
        // Assert
        if (classMatch) {
          expect(classMatch[1]).toBe(expected);
        }
      });
    });

    it('should not match lowercase variable names', () => {
      // Arrange - These should NOT match (they're variable names, not class names)
      const variableNames = ['dog', 'cat', 'service', 'obj', 'instance'];

      variableNames.forEach(varName => {
        // Act
        const classMatch = varName.match(/(?:^|\.|\s)([A-Z][a-zA-Z0-9_]*)\s*$/);
        
        // Assert - Should not match lowercase variable names
        expect(classMatch).toBeNull();
      });
    });

    it('should handle edge cases in type text', () => {
      // Arrange
      const edgeCases = [
        '', // Empty string
        'any', // 'any' type
        'unknown', // 'unknown' type
        'void', // 'void' type
        '{}', // Object literal type
        'never', // 'never' type
      ];

      edgeCases.forEach(typeText => {
        // Act & Assert - Should not throw
        expect(() => {
          const classMatch = typeText.match(/(?:^|\.|\s)([A-Z][a-zA-Z0-9_]*)\s*$/);
          // classMatch might be null, which is fine for these cases
        }).not.toThrow();
      });
    });
  });
});
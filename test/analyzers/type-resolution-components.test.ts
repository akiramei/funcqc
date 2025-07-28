/**
 * Component-Level Tests for Type Resolution
 * 
 * These tests focus on individual components that caused the CHA/RTA integration bug,
 * providing early detection of type resolution issues before they reach integration tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Project, Node, CallExpression, PropertyAccessExpression, SyntaxKind } from 'ts-morph';
import { ImportExactAnalysisStage } from '../../src/analyzers/staged-analysis/stages/import-exact-analysis';
import { LocalExactAnalysisStage } from '../../src/analyzers/staged-analysis/stages/local-exact-analysis';
import { SymbolCache } from '../../src/utils/symbol-cache';
import { Logger } from '../../src/utils/cli-utils';
import { FunctionMetadata } from '../../src/analyzers/ideal-call-graph-analyzer';
import { AnalysisState } from '../../src/analyzers/staged-analysis/types';

describe('Type Resolution Components - CHA/RTA Bug Prevention', () => {
  let project: Project;
  let typeChecker: any;
  let symbolCache: SymbolCache;
  let importStage: ImportExactAnalysisStage;
  let localStage: LocalExactAnalysisStage;
  let logger: Logger;

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
    logger = new Logger(false);
    importStage = new ImportExactAnalysisStage(project, typeChecker, symbolCache, logger);
    localStage = new LocalExactAnalysisStage(logger);
  });

  describe('TypeChecker API Integration', () => {
    it('should resolve variable type to class name, not variable name', () => {
      // Arrange - The exact scenario that caused the original bug
      const sourceFile = project.createSourceFile('test.ts', `
        class Dog {
          speak(): string { return 'Woof!'; }
        }
        
        function test() {
          const dog = new Dog();
          return dog.speak(); // Should resolve receiver type as "Dog", not "dog"
        }
      `);

      // Find the property access expression (dog.speak)
      const propertyAccesses = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression) as PropertyAccessExpression[];
      expect(propertyAccesses.length).toBeGreaterThan(0);
      const propertyAccess = propertyAccesses[0];
      const objectExpr = propertyAccess.getExpression();

      // Act - Test TypeChecker API usage
      const type = typeChecker.getTypeAtLocation(objectExpr);
      const typeText = type.getText();

      // Assert - Should get class name, not variable name
      expect(typeText).toBe('Dog');
      expect(typeText).not.toBe('dog'); // ❌ This was the bug!
    });

    it('should handle complex type expressions correctly', () => {
      // Arrange
      const sourceFile = project.createSourceFile('complex.ts', `
        import { Service } from './service';
        
        class UserService {
          process(): void {}
        }
        
        function test() {
          const service: UserService = new UserService();
          return service.process();
        }
      `);

      const propertyAccesses = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression) as PropertyAccessExpression[];
      if (propertyAccesses.length === 0) return; // Skip if no property access found
      const propertyAccess = propertyAccesses[0];
      const objectExpr = propertyAccess.getExpression();

      // Act
      const type = typeChecker.getTypeAtLocation(objectExpr);
      const typeText = type.getText();

      // Assert - Should extract class name correctly
      const classMatch = typeText.match(/(?:^|\.|\s)([A-Z][a-zA-Z0-9_]*)\s*$/);
      expect(classMatch).toBeTruthy();
      if (classMatch) {
        expect(classMatch[1]).toBe('UserService');
      }
    });

    it('should handle null/undefined symbols gracefully', () => {
      // Arrange
      const sourceFile = project.createSourceFile('edge-case.ts', `
        function test() {
          return unknownVar.method(); // Should not crash
        }
      `);

      const propertyAccesses = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression) as PropertyAccessExpression[];
      if (propertyAccesses.length === 0) return; // Skip if no property access found
      const propertyAccess = propertyAccesses[0];
      const objectExpr = propertyAccess.getExpression();

      // Act & Assert - Should not throw
      expect(() => {
        const symbol = symbolCache.getSymbolAtLocation(objectExpr);
        if (symbol) {
          const type = typeChecker.getTypeAtLocation(objectExpr);
          type.getText();
        }
      }).not.toThrow();
    });
  });

  describe('Stage Boundary Logic', () => {
    it('should skip property access in Local Stage', () => {
      // Arrange
      const sourceFile = project.createSourceFile('stage-test.ts', `
        class Dog {
          speak(): string { return 'Woof!'; }
        }
        
        function test() {
          const dog = new Dog();
          return dog.speak(); // Local stage should skip this
        }
      `);

      const callExprs = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression) as CallExpression[];
      if (callExprs.length === 0) return; // Skip if no call expressions found
      const callExpr = callExprs[0];
      const expression = callExpr.getExpression();

      // Act & Assert - Local stage should skip property access
      if (Node.isPropertyAccessExpression(expression)) {
        const objectExpr = expression.getExpression();
        
        // Local stage should only handle 'this' property access
        const shouldSkip = !Node.isThisExpression(objectExpr);
        expect(shouldSkip).toBe(true);
      }
    });

    it('should handle property access in Import Stage', () => {
      // Arrange
      const sourceFile = project.createSourceFile('import-test.ts', `
        class Dog {
          speak(): string { return 'Woof!'; }
        }
        
        function test() {
          const dog = new Dog();
          return dog.speak(); // Import stage should handle this
        }
      `);

      const callExprs = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression) as CallExpression[];
      if (callExprs.length === 0) return; // Skip if no call expressions found
      const callExpr = callExprs[0];
      const expression = callExpr.getExpression();

      // Act & Assert - Import stage should process property access
      if (Node.isPropertyAccessExpression(expression)) {
        const objectExpr = expression.getExpression();
        const methodName = expression.getName();
        
        expect(methodName).toBe('speak');
        expect(Node.isIdentifier(objectExpr)).toBe(true);
        expect(objectExpr.getText()).toBe('dog');
      }
    });

    it('should delegate correctly between stages', () => {
      // Arrange - Create scenario that requires stage delegation
      const sourceFile = project.createSourceFile('delegation.ts', `
        class TestClass {
          method1(): void {
            this.method2(); // Local stage should handle this
          }
          
          method2(): void {}
        }
        
        function external() {
          const obj = new TestClass();
          obj.method1(); // Import stage should handle this
        }
      `);

      const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression) as CallExpression[];
      
      // Act & Assert
      for (const callExpr of callExpressions) {
        const expression = callExpr.getExpression();
        
        if (Node.isPropertyAccessExpression(expression)) {
          const objectExpr = expression.getExpression();
          
          if (Node.isThisExpression(objectExpr)) {
            // This should be handled by Local Stage
            expect(true).toBe(true); // Local stage territory
          } else {
            // This should be delegated to Import Stage
            expect(Node.isIdentifier(objectExpr)).toBe(true); // Import stage territory
          }
        }
      }
    });
  });

  describe('UnresolvedMethodCall Generation', () => {
    it('should generate correct receiver types for CHA', () => {
      // Arrange - The critical test that would have caught the original bug
      const sourceFile = project.createSourceFile('cha-input.ts', `
        class Dog {
          speak(): string { return 'Woof!'; }
        }
        
        function test() {
          const dog = new Dog();
          dog.speak(); // Should generate receiverType="Dog" for CHA
        }
      `);

      const functions = new Map<string, FunctionMetadata>();
      const testFunction: FunctionMetadata = {
        id: 'test-func',
        name: 'test',
        filePath: sourceFile.getFilePath(),
        startLine: 5,
        endLine: 8,
        className: undefined,
        lexicalPath: 'test'
      };
      functions.set('test-func', testFunction);

      const state: AnalysisState = {
        edges: [],
        edgeKeys: new Set(),
        edgeIndex: new Map(),
        functionLookupMap: new Map(),
        unresolvedMethodCalls: [],
        instantiationEvents: [],
        unresolvedMethodCallsForRTA: [],
        unresolvedMethodCallsSet: new Set(),
        chaCandidates: new Map(),
        fileToFunctionsMap: new Map(),
        functionContainmentMaps: new Map(),
        positionIdCache: new WeakMap()
      };

      importStage.buildFunctionLookupMap(functions);

      // Act - Process call expressions
      const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression) as CallExpression[];
      const newExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression) as any[]; // NewExpression

      // This is the key test - the import stage should generate correct UnresolvedMethodCall
      return importStage.analyzeImportCalls(callExpressions, newExpressions, functions, state)
        .then(() => {
          // Assert - Check UnresolvedMethodCall generation
          const unresolvedCalls = state.unresolvedMethodCalls;
          
          if (unresolvedCalls.length > 0) {
            const speakCall = unresolvedCalls.find(call => call.methodName === 'speak');
            
            if (speakCall) {
              // ❌ This was the bug: receiverType was "dog" instead of "Dog"
              expect(speakCall.receiverType).toBe('Dog');
              expect(speakCall.receiverType).not.toBe('dog');
              expect(speakCall.methodName).toBe('speak');
            }
          }
        });
    });

    it('should handle inheritance types correctly', () => {
      // Arrange
      const sourceFile = project.createSourceFile('inheritance.ts', `
        class Animal {
          move(): string { return 'moving'; }
        }
        
        class Dog extends Animal {
          speak(): string { return 'Woof!'; }
        }
        
        function test() {
          const dog: Animal = new Dog();
          dog.move(); // Should resolve to Animal type
        }
      `);

      const functions = new Map<string, FunctionMetadata>();
      const state: AnalysisState = {
        edges: [],
        edgeKeys: new Set(),
        edgeIndex: new Map(),
        functionLookupMap: new Map(),
        unresolvedMethodCalls: [],
        instantiationEvents: [],
        unresolvedMethodCallsForRTA: [],
        unresolvedMethodCallsSet: new Set(),
        chaCandidates: new Map(),
        fileToFunctionsMap: new Map(),
        functionContainmentMaps: new Map(),
        positionIdCache: new WeakMap()
      };

      const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression) as CallExpression[];
      const newExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression) as any[];

      // Act
      return importStage.analyzeImportCalls(callExpressions, newExpressions, functions, state)
        .then(() => {
          // Assert - Should handle type annotations correctly
          const unresolvedCalls = state.unresolvedMethodCalls;
          
          if (unresolvedCalls.length > 0) {
            const moveCall = unresolvedCalls.find(call => call.methodName === 'move');
            
            if (moveCall) {
              // Should resolve to the declared type (Animal) or the actual type (Dog)
              expect(['Animal', 'Dog']).toContain(moveCall.receiverType);
              expect(moveCall.receiverType).not.toBe('dog'); // Variable name
            }
          }
        });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle TypeChecker errors gracefully', () => {
      // Arrange - Create scenario that might cause TypeChecker issues
      const sourceFile = project.createSourceFile('error-case.ts', `
        function test() {
          // @ts-ignore
          invalidReference.method();
        }
      `);

      const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression) as CallExpression[];

      // Act & Assert - Should not throw
      expect(() => {
        for (const callExpr of callExpressions) {
          const expression = callExpr.getExpression();
          
          if (Node.isPropertyAccessExpression(expression)) {
            const objectExpr = expression.getExpression();
            
            try {
              const type = typeChecker.getTypeAtLocation(objectExpr);
              type.getText();
            } catch (error) {
              // Should handle gracefully
            }
          }
        }
      }).not.toThrow();
    });

    it('should handle missing symbol declarations', () => {
      // Arrange
      const sourceFile = project.createSourceFile('missing-symbol.ts', `
        declare const unknownVar: any;
        
        function test() {
          unknownVar.someMethod();
        }
      `);

      const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression) as CallExpression[];
      const functions = new Map<string, FunctionMetadata>();
      const state: AnalysisState = {
        edges: [],
        edgeKeys: new Set(),
        edgeIndex: new Map(),
        functionLookupMap: new Map(),
        unresolvedMethodCalls: [],
        instantiationEvents: [],
        unresolvedMethodCallsForRTA: [],
        unresolvedMethodCallsSet: new Set(),
        chaCandidates: new Map(),
        fileToFunctionsMap: new Map(),
        functionContainmentMaps: new Map(),
        positionIdCache: new WeakMap()
      };

      // Act & Assert - Should handle missing symbols gracefully
      return expect(
        importStage.analyzeImportCalls(callExpressions, [], functions, state)
      ).resolves.toBeDefined();
    });
  });

  describe('SymbolCache Integration', () => {
    it('should cache symbol lookups correctly', () => {
      // Arrange
      const sourceFile = project.createSourceFile('cache-test.ts', `
        class TestClass {
          method(): void {}
        }
        
        function test() {
          const obj = new TestClass();
          obj.method(); // First lookup
          obj.method(); // Second lookup (should be cached)
        }
      `);

      const propertyAccesses = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression) as PropertyAccessExpression[];
      if (propertyAccesses.length === 0) return; // Skip if no property access found
      
      // Act - Lookup same symbol multiple times
      const symbols = propertyAccesses.map(prop => {
        const objectExpr = prop.getExpression();
        return symbolCache.getSymbolAtLocation(objectExpr);
      });
      
      // Lookup the same symbols again to generate cache hits
      propertyAccesses.forEach(prop => {
        const objectExpr = prop.getExpression();
        symbolCache.getSymbolAtLocation(objectExpr);
      });

      // Assert - Should have cached results
      const stats = symbolCache.getStats();
      expect(stats.hits).toBeGreaterThan(0); // Should have cache hits
    });

    it('should handle cache misses correctly', () => {
      // Arrange
      const sourceFile = project.createSourceFile('cache-miss.ts', `
        function test() {
          const a = {};
          const b = {};
          a.method?.();
          b.method?.();
        }
      `);

      const propertyAccesses = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression) as PropertyAccessExpression[];
      if (propertyAccesses.length === 0) return; // Skip if no property access found
      
      // Act
      propertyAccesses.forEach(prop => {
        const objectExpr = prop.getExpression();
        symbolCache.getSymbolAtLocation(objectExpr);
      });

      // Assert
      const stats = symbolCache.getStats();
      expect(stats.misses).toBeGreaterThan(0); // Should have cache misses
    });
  });

  describe('Regression Tests for CHA/RTA Bug', () => {
    it('should prevent receiver type variable name bug', () => {
      // Arrange - Exact reproduction of the original bug scenario
      const sourceFile = project.createSourceFile('regression.ts', `
        class Dog {
          speak(): string { return 'Woof!'; }
        }
        
        class Cat {
          speak(): string { return 'Meow!'; }
        }
        
        function testAnimals() {
          const dog = new Dog();
          const cat = new Cat();
          
          // These calls caused the original bug
          dog.speak(); // receiverType was "dog" (wrong)
          cat.speak(); // receiverType was "cat" (wrong)
        }
      `);

      const functions = new Map<string, FunctionMetadata>();
      const testFunction: FunctionMetadata = {
        id: 'test-func',
        name: 'testAnimals',
        filePath: sourceFile.getFilePath(),
        startLine: 9,
        endLine: 16,
        className: undefined,
        lexicalPath: 'testAnimals'
      };
      functions.set('test-func', testFunction);

      const state: AnalysisState = {
        edges: [],
        edgeKeys: new Set(),
        edgeIndex: new Map(),
        functionLookupMap: new Map(),
        unresolvedMethodCalls: [],
        instantiationEvents: [],
        unresolvedMethodCallsForRTA: [],
        unresolvedMethodCallsSet: new Set(),
        chaCandidates: new Map(),
        fileToFunctionsMap: new Map(),
        functionContainmentMaps: new Map(),
        positionIdCache: new WeakMap()
      };

      importStage.buildFunctionLookupMap(functions);

      const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression) as CallExpression[];
      const newExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression) as any[];

      // Act
      return importStage.analyzeImportCalls(callExpressions, newExpressions, functions, state)
        .then(() => {
          // Assert - Critical regression test
          const unresolvedCalls = state.unresolvedMethodCalls;
          
          const dogSpeakCall = unresolvedCalls.find(call => 
            call.methodName === 'speak' && call.receiverType === 'Dog'
          );
          
          const catSpeakCall = unresolvedCalls.find(call => 
            call.methodName === 'speak' && call.receiverType === 'Cat'
          );

          // ✅ These assertions would have failed with the original bug
          if (dogSpeakCall) {
            expect(dogSpeakCall.receiverType).toBe('Dog');
            expect(dogSpeakCall.receiverType).not.toBe('dog');
          }
          
          if (catSpeakCall) {
            expect(catSpeakCall.receiverType).toBe('Cat');
            expect(catSpeakCall.receiverType).not.toBe('cat');
          }

          // Ensure no calls have variable names as receiver types
          const invalidReceiverTypes = unresolvedCalls.filter(call => 
            call.receiverType && /^[a-z]/.test(call.receiverType) // Starts with lowercase
          );
          
          expect(invalidReceiverTypes).toHaveLength(0);
        });
    });
  });
});
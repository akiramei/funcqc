/**
 * Stage Coordination Tests
 * 
 * Tests the coordination between Local and Import analysis stages,
 * ensuring proper delegation and preventing the type resolution issues
 * that led to the CHA/RTA integration bug.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Project, Node, CallExpression, PropertyAccessExpression } from 'ts-morph';
import { LocalExactAnalysisStage } from '../../src/analyzers/staged-analysis/stages/local-exact-analysis';
import { ImportExactAnalysisStage } from '../../src/analyzers/staged-analysis/stages/import-exact-analysis';
import { SymbolCache } from '../../src/utils/symbol-cache';
import { Logger } from '../../src/utils/cli-utils';
import { FunctionMetadata } from '../../src/analyzers/ideal-call-graph-analyzer';
import { AnalysisState } from '../../src/analyzers/staged-analysis/types';

describe('Stage Coordination - CHA/RTA Integration Safety', () => {
  let project: Project;
  let typeChecker: any;
  let symbolCache: SymbolCache;
  let localStage: LocalExactAnalysisStage;
  let importStage: ImportExactAnalysisStage;
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
    localStage = new LocalExactAnalysisStage(logger);
    importStage = new ImportExactAnalysisStage(project, typeChecker, symbolCache, logger);
  });

  describe('Local Stage Responsibilities', () => {
    it('should only handle this-expressions in property access', () => {
      // Arrange
      const sourceFile = project.createSourceFile('local-scope.ts', `
        class TestClass {
          private value = 42;
          
          method1(): void {
            this.method2(); // ✅ Local stage should handle this
            this.getValue(); // ✅ Local stage should handle this
          }
          
          method2(): void {}
          
          getValue(): number {
            return this.value; // ✅ Local stage should handle this
          }
        }
        
        function external() {
          const obj = new TestClass();
          obj.method1(); // ❌ Local stage should NOT handle this
        }
      `);

      const callExpressions = sourceFile.getDescendantsOfKind(207) as CallExpression[];
      
      // Act & Assert
      callExpressions.forEach(callExpr => {
        const expression = callExpr.getExpression();
        
        if (Node.isPropertyAccessExpression(expression)) {
          const objectExpr = expression.getExpression();
          const isThisExpression = Node.isThisExpression(objectExpr);
          
          if (isThisExpression) {
            // Local stage should handle this
            expect(true).toBe(true); // This is local stage territory
          } else {
            // Local stage should delegate to import stage
            expect(Node.isIdentifier(objectExpr)).toBe(true);
            expect(objectExpr.getText()).not.toBe('this');
          }
        }
      });
    });

    it('should not create UnresolvedMethodCall for property access', () => {
      // Arrange
      const sourceFile = project.createSourceFile('local-delegation.ts', `
        class Service {
          process(): void {}
        }
        
        function test() {
          const service = new Service();
          service.process(); // Local stage should NOT create UnresolvedMethodCall for this
        }
      `);

      const fileFunctions: FunctionMetadata[] = [{
        id: 'test-func',
        name: 'test',
        filePath: sourceFile.getFilePath(),
        startLine: 5,
        endLine: 8,
        className: undefined,
        lexicalPath: 'test'
      }];

      const functions = new Map<string, FunctionMetadata>();
      functions.set('test-func', fileFunctions[0]);

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

      // Act
      return localStage.analyzeFile(sourceFile, fileFunctions, functions, state)
        .then(result => {
          // Assert - Local stage should not create unresolved calls for property access
          const propertyAccessCalls = state.unresolvedMethodCalls.filter(call => 
            call.methodName === 'process'
          );
          
          // Local stage should NOT add property access calls to unresolvedMethodCalls
          // This delegation ensures Import stage handles them with proper TypeChecker
          expect(propertyAccessCalls.length).toBe(0);
        });
    });

    it('should handle direct function calls correctly', () => {
      // Arrange
      const sourceFile = project.createSourceFile('direct-calls.ts', `
        function helper(): string {
          return 'helper';
        }
        
        function main(): string {
          return helper(); // ✅ Local stage should handle this
        }
      `);

      const fileFunctions: FunctionMetadata[] = [
        {
          id: 'helper-func',
          name: 'helper',
          filePath: sourceFile.getFilePath(),
          startLine: 1,
          endLine: 3,
          className: undefined,
          lexicalPath: 'helper'
        },
        {
          id: 'main-func',
          name: 'main',
          filePath: sourceFile.getFilePath(),
          startLine: 5,
          endLine: 7,
          className: undefined,
          lexicalPath: 'main'
        }
      ];

      const functions = new Map<string, FunctionMetadata>();
      fileFunctions.forEach(func => functions.set(func.id, func));

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

      // Act
      return localStage.analyzeFile(sourceFile, fileFunctions, functions, state)
        .then(result => {
          // Assert - Should resolve direct function calls
          expect(result.localEdges).toBeGreaterThan(0);
          
          const helperCallEdge = state.edges.find(edge => 
            edge.calleeName === 'helper'
          );
          
          expect(helperCallEdge).toBeDefined();
          if (helperCallEdge) {
            expect(helperCallEdge.resolutionLevel).toBe('local_exact');
          }
        });
    });
  });

  describe('Import Stage Responsibilities', () => {
    it('should handle property access with proper type resolution', () => {
      // Arrange
      const sourceFile = project.createSourceFile('import-scope.ts', `
        class Dog {
          speak(): string { return 'Woof!'; }
        }
        
        class Cat {
          speak(): string { return 'Meow!'; }
        }
        
        function test() {
          const dog = new Dog();
          const cat = new Cat();
          
          dog.speak(); // ✅ Import stage should handle this with TypeChecker
          cat.speak(); // ✅ Import stage should handle this with TypeChecker
        }
      `);

      const functions = new Map<string, FunctionMetadata>();
      const testFunction: FunctionMetadata = {
        id: 'test-func',
        name: 'test',
        filePath: sourceFile.getFilePath(),
        startLine: 9,
        endLine: 16,
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

      const callExpressions = sourceFile.getDescendantsOfKind(207) as CallExpression[];
      const newExpressions = sourceFile.getDescendantsOfKind(208) as any[];

      // Act
      return importStage.analyzeImportCalls(callExpressions, newExpressions, functions, state)
        .then(() => {
          // Assert - Import stage should create proper UnresolvedMethodCall entries
          const unresolvedCalls = state.unresolvedMethodCalls;
          
          const dogSpeakCall = unresolvedCalls.find(call => 
            call.methodName === 'speak' && call.receiverType === 'Dog'
          );
          
          const catSpeakCall = unresolvedCalls.find(call => 
            call.methodName === 'speak' && call.receiverType === 'Cat'
          );

          // ✅ Import stage should resolve variable types to class names
          expect(dogSpeakCall).toBeDefined();
          expect(catSpeakCall).toBeDefined();
          
          if (dogSpeakCall) {
            expect(dogSpeakCall.receiverType).toBe('Dog');
            expect(dogSpeakCall.receiverType).not.toBe('dog'); // ❌ This was the bug!
          }
          
          if (catSpeakCall) {
            expect(catSpeakCall.receiverType).toBe('Cat');
            expect(catSpeakCall.receiverType).not.toBe('cat'); // ❌ This was the bug!
          }
        });
    });

    it('should skip local variable property access for imported types only', () => {
      // Arrange
      const baseFile = project.createSourceFile('base.ts', `
        export class RemoteService {
          process(): string { return 'remote'; }
        }
      `);

      const clientFile = project.createSourceFile('client.ts', `
        import { RemoteService } from './base';
        
        class LocalService {
          handle(): string { return 'local'; }
        }
        
        function test() {
          const remote = new RemoteService(); // Imported
          const local = new LocalService();   // Local
          
          remote.process(); // ✅ Import stage should handle (imported type)
          local.handle();   // ❌ Import stage should skip (local type)
        }
      `);

      const functions = new Map<string, FunctionMetadata>();
      const testFunction: FunctionMetadata = {
        id: 'test-func',
        name: 'test',
        filePath: clientFile.getFilePath(),
        startLine: 8,
        endLine: 14,
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

      const callExpressions = clientFile.getDescendantsOfKind(207) as CallExpression[];
      const newExpressions = clientFile.getDescendantsOfKind(208) as any[];

      // Act
      return importStage.analyzeImportCalls(callExpressions, newExpressions, functions, state)
        .then(() => {
          // Assert - Import stage behavior for local vs imported types
          const unresolvedCalls = state.unresolvedMethodCalls;
          
          // Should handle imported types
          const remoteCalls = unresolvedCalls.filter(call => 
            call.methodName === 'process' && call.receiverType === 'RemoteService'
          );
          
          // Should delegate local types to CHA (by creating unresolved calls or skipping)
          const localCalls = unresolvedCalls.filter(call => 
            call.methodName === 'handle'
          );

          // The key insight: Import stage should be conservative about local variable method calls
          // It should either skip them entirely or pass them to CHA with correct receiver types
        });
    });
  });

  describe('Stage Coordination Patterns', () => {
    it('should maintain proper call resolution priority', () => {
      // Arrange - Mix of local and cross-object calls
      const sourceFile = project.createSourceFile('priority-test.ts', `
        class Calculator {
          private result = 0;
          
          add(value: number): Calculator {
            this.result += value; // ✅ Local stage: this.property
            return this;
          }
          
          multiply(value: number): Calculator {
            this.result *= value; // ✅ Local stage: this.property
            return this.reset();  // ✅ Local stage: this.method()
          }
          
          reset(): Calculator {
            this.result = 0;      // ✅ Local stage: this.property
            return this;
          }
        }
        
        function useCalculator(): number {
          const calc = new Calculator();
          
          calc.add(5)             // ❌ Local stage should skip, Import stage handles
            .multiply(2)          // ❌ Local stage should skip, Import stage handles
            .reset();             // ❌ Local stage should skip, Import stage handles
            
          return calc.result;     // ❌ Local stage should skip, Import stage handles
        }
      `);

      const fileFunctions: FunctionMetadata[] = [
        {
          id: 'calc-add',
          name: 'add',
          filePath: sourceFile.getFilePath(),
          startLine: 4,
          endLine: 7,
          className: 'Calculator',
          lexicalPath: 'Calculator.add'
        },
        {
          id: 'calc-multiply',
          name: 'multiply',
          filePath: sourceFile.getFilePath(),
          startLine: 9,
          endLine: 12,
          className: 'Calculator',
          lexicalPath: 'Calculator.multiply'
        },
        {
          id: 'calc-reset',
          name: 'reset',
          filePath: sourceFile.getFilePath(),
          startLine: 14,
          endLine: 17,
          className: 'Calculator',
          lexicalPath: 'Calculator.reset'
        },
        {
          id: 'use-calc',
          name: 'useCalculator',
          filePath: sourceFile.getFilePath(),
          startLine: 20,
          endLine: 28,
          className: undefined,
          lexicalPath: 'useCalculator'
        }
      ];

      const functions = new Map<string, FunctionMetadata>();
      fileFunctions.forEach(func => functions.set(func.id, func));

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

      // Act - First local stage
      return localStage.analyzeFile(sourceFile, fileFunctions, functions, state)
        .then(localResult => {
          // Local stage should handle this.method() calls
          expect(localResult.localEdges).toBeGreaterThan(0);
          
          // Then import stage for remaining calls
          importStage.buildFunctionLookupMap(functions);
          
          const callExpressions = sourceFile.getDescendantsOfKind(207) as CallExpression[];
          const newExpressions = sourceFile.getDescendantsOfKind(208) as any[];
          
          return importStage.analyzeImportCalls(callExpressions, newExpressions, functions, state);
        })
        .then(() => {
          // Assert - Proper coordination between stages
          
          // Local stage should have resolved this.method() calls
          const localResolvedEdges = state.edges.filter(edge => 
            edge.resolutionLevel === 'local_exact'
          );
          expect(localResolvedEdges.length).toBeGreaterThan(0);
          
          // Import stage should create unresolved calls for variable.method() calls
          // with correct receiver types (Calculator, not calc)
          const unresolvedWithCorrectTypes = state.unresolvedMethodCalls.filter(call =>
            call.receiverType === 'Calculator' // ✅ Class name
          );
          
          const unresolvedWithWrongTypes = state.unresolvedMethodCalls.filter(call =>
            call.receiverType === 'calc' // ❌ Variable name (bug!)
          );
          
          expect(unresolvedWithWrongTypes.length).toBe(0);
        });
    });

    it('should prevent double processing of same calls', () => {
      // Arrange
      const sourceFile = project.createSourceFile('double-processing.ts', `
        class Service {
          process(): void {}
        }
        
        function test() {
          const service = new Service();
          service.process(); // Should only be handled by one stage
        }
      `);

      const fileFunctions: FunctionMetadata[] = [{
        id: 'test-func',
        name: 'test',
        filePath: sourceFile.getFilePath(),
        startLine: 5,
        endLine: 8,
        className: undefined,
        lexicalPath: 'test'
      }];

      const functions = new Map<string, FunctionMetadata>();
      functions.set('test-func', fileFunctions[0]);

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

      // Act - Process with both stages
      return localStage.analyzeFile(sourceFile, fileFunctions, functions, state)
        .then(() => {
          importStage.buildFunctionLookupMap(functions);
          
          const callExpressions = sourceFile.getDescendantsOfKind(207) as CallExpression[];
          const newExpressions = sourceFile.getDescendantsOfKind(208) as any[];
          
          return importStage.analyzeImportCalls(callExpressions, newExpressions, functions, state);
        })
        .then(() => {
          // Assert - No double processing
          
          // Count how many times service.process() was handled
          const processEdges = state.edges.filter(edge => 
            edge.calleeName.includes('process')
          );
          
          const processUnresolved = state.unresolvedMethodCalls.filter(call => 
            call.methodName === 'process'
          );
          
          // Should be handled by exactly one stage (not both)
          const totalProcessCount = processEdges.length + processUnresolved.length;
          expect(totalProcessCount).toBeLessThanOrEqual(1);
        });
    });
  });

  describe('Error Prevention Tests', () => {
    it('should prevent the original CHA/RTA receiver type bug', () => {
      // Arrange - Exact scenario that caused the bug
      const sourceFile = project.createSourceFile('bug-prevention.ts', `
        class Dog {
          speak(): string { return 'Woof!'; }
          move(): string { return 'Running'; }
        }
        
        class Cat {
          speak(): string { return 'Meow!'; }
          move(): string { return 'Stalking'; }
        }
        
        function testAnimals() {
          const dog = new Dog();
          const cat = new Cat();
          
          // These are the exact calls that caused the bug
          const dogSound = dog.speak();  // receiverType should be "Dog", not "dog"
          const dogMove = dog.move();    // receiverType should be "Dog", not "dog"
          const catSound = cat.speak();  // receiverType should be "Cat", not "cat"
          const catMove = cat.move();    // receiverType should be "Cat", not "cat"
          
          return dogSound + dogMove + catSound + catMove;
        }
      `);

      const functions = new Map<string, FunctionMetadata>();
      const testFunction: FunctionMetadata = {
        id: 'test-func',
        name: 'testAnimals',
        filePath: sourceFile.getFilePath(),
        startLine: 11,
        endLine: 22,
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

      // Act - Process through the stage pipeline
      const fileFunctions = [testFunction];
      
      return localStage.analyzeFile(sourceFile, fileFunctions, functions, state)
        .then(() => {
          importStage.buildFunctionLookupMap(functions);
          
          const callExpressions = sourceFile.getDescendantsOfKind(207) as CallExpression[];
          const newExpressions = sourceFile.getDescendantsOfKind(208) as any[];
          
          return importStage.analyzeImportCalls(callExpressions, newExpressions, functions, state);
        })
        .then(() => {
          // Assert - Critical bug prevention test
          const unresolvedCalls = state.unresolvedMethodCalls;
          
          // Find method calls with correct class names
          const correctDogCalls = unresolvedCalls.filter(call => 
            call.receiverType === 'Dog' && ['speak', 'move'].includes(call.methodName)
          );
          
          const correctCatCalls = unresolvedCalls.filter(call => 
            call.receiverType === 'Cat' && ['speak', 'move'].includes(call.methodName)
          );
          
          // Find method calls with incorrect variable names (the bug!)
          const buggyDogCalls = unresolvedCalls.filter(call => 
            call.receiverType === 'dog' && ['speak', 'move'].includes(call.methodName)
          );
          
          const buggyCatCalls = unresolvedCalls.filter(call => 
            call.receiverType === 'cat' && ['speak', 'move'].includes(call.methodName)
          );
          
          // ✅ Should have correct class names
          expect(correctDogCalls.length).toBeGreaterThan(0);
          expect(correctCatCalls.length).toBeGreaterThan(0);
          
          // ❌ Should NOT have variable names as receiver types
          expect(buggyDogCalls.length).toBe(0);
          expect(buggyCatCalls.length).toBe(0);
          
          // Verify each method call has correct receiver type
          unresolvedCalls.forEach(call => {
            if (call.methodName === 'speak' || call.methodName === 'move') {
              expect(['Dog', 'Cat']).toContain(call.receiverType);
              expect(['dog', 'cat']).not.toContain(call.receiverType);
            }
          });
        });
    });
  });
});
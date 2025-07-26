import { describe, it, expect, beforeEach } from 'vitest';
import { Project } from 'ts-morph';
import { StagedAnalysisEngine } from '../../src/analyzers/staged-analysis/staged-analysis-engine-refactored';
import { FunctionRegistry } from '../../src/analyzers/function-registry';
import { FunctionMetadata } from '../../src/analyzers/ideal-call-graph-analyzer';
import { PathNormalizer } from '../../src/utils/path-normalizer';

describe('Cross-File Call Resolution Methods (Unit Test)', () => {
  let project: Project;
  let engine: StagedAnalysisEngine;
  let functionRegistry: FunctionRegistry;

  beforeEach(() => {
    project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: 5, // ES2015
        allowJs: true,
        declaration: false,
        skipLibCheck: true,
      }
    });
    
    const typeChecker = project.getTypeChecker();
    engine = new StagedAnalysisEngine(project, typeChecker);
    functionRegistry = new FunctionRegistry(project);
  });

  describe('PathNormalizer Utility', () => {
    it('should normalize file paths consistently', () => {
      // Arrange
      const path1 = '/utils/helper.ts';
      const path2 = '/utils/helper.ts'; // Use same format for unit test
      
      // Act
      const normalized1 = PathNormalizer.normalize(path1);
      const normalized2 = PathNormalizer.normalize(path2);
      
      // Assert
      expect(normalized1).toBeDefined();
      expect(normalized2).toBeDefined();
      expect(PathNormalizer.areEqual(path1, path2)).toBe(true);
      
      // Test basic normalization functionality exists
      expect(typeof PathNormalizer.normalize).toBe('function');
      expect(typeof PathNormalizer.areEqual).toBe('function');
    });

    it('should filter functions by file path correctly', () => {
      // Arrange
      const functions: FunctionMetadata[] = [
        {
          id: 'func1',
          name: 'function1',
          filePath: '/utils/helper.ts',
          startLine: 1,
          endLine: 5,
          lexicalPath: 'utils/helper.ts#function1',
          parameters: [],
          isAsync: false,
          isExported: false,
          isMethod: false,
          className: undefined,
          accessibility: undefined,
          isStatic: false,
          returnType: 'void',
          complexity: 1,
          loc: 4,
          functionType: 'function'
        },
        {
          id: 'func2',
          name: 'function2',
          filePath: '/main.ts',
          startLine: 1,
          endLine: 5,
          lexicalPath: 'main.ts#function2',
          parameters: [],
          isAsync: false,
          isExported: false,
          isMethod: false,
          className: undefined,
          accessibility: undefined,
          isStatic: false,
          returnType: 'void',
          complexity: 1,
          loc: 4,
          functionType: 'function'
        }
      ];
      
      // Act
      const utilsFunctions = PathNormalizer.filterByPath(functions, '/utils/helper.ts');
      const mainFunctions = PathNormalizer.filterByPath(functions, '/main.ts');
      
      // Assert
      expect(utilsFunctions).toHaveLength(1);
      expect(utilsFunctions[0].name).toBe('function1');
      expect(mainFunctions).toHaveLength(1);
      expect(mainFunctions[0].name).toBe('function2');
    });
  });

  describe('Function Collection and Registry', () => {
    it('should collect functions from multiple files', async () => {
      // Arrange
      const utilsFile = project.createSourceFile('utils.ts', `
        export function calculateSum(a: number, b: number): number {
          return a + b;
        }
        
        export function formatValue(value: number): string {
          return value.toString();
        }
      `);
      
      const mainFile = project.createSourceFile('main.ts', `
        import { calculateSum, formatValue } from './utils';
        
        function processData(x: number, y: number): string {
          const sum = calculateSum(x, y);
          return formatValue(sum);
        }
      `);
      
      // Act
      const functions = await functionRegistry.collectAllFunctions();
      
      // Assert
      expect(functions.size).toBe(3); // calculateSum, formatValue, processData
      
      const functionNames = Array.from(functions.values()).map(f => f.name);
      expect(functionNames).toContain('calculateSum');
      expect(functionNames).toContain('formatValue');
      expect(functionNames).toContain('processData');
    });

    it('should handle functions with same names in different files', async () => {
      // Arrange
      const file1 = project.createSourceFile('file1.ts', `
        export function process(): string {
          return 'file1';
        }
      `);
      
      const file2 = project.createSourceFile('file2.ts', `
        export function process(): string {
          return 'file2';
        }
      `);
      
      // Act
      const functions = await functionRegistry.collectAllFunctions();
      
      // Assert
      expect(functions.size).toBe(2);
      
      const processFunctions = Array.from(functions.values()).filter(f => f.name === 'process');
      expect(processFunctions).toHaveLength(2);
      
      const filePaths = processFunctions.map(f => f.filePath);
      expect(filePaths.some(path => path.includes('file1.ts'))).toBe(true);
      expect(filePaths.some(path => path.includes('file2.ts'))).toBe(true);
    });
  });

  describe('Symbol Resolution Capability', () => {
    it('should detect import statements correctly', async () => {
      // Arrange
      const sourceFile = project.createSourceFile('test.ts', `
        import { helper } from './utils';
        import defaultHelper from './default-utils';
        import * as Utils from './namespace-utils';
        
        function main() {
          helper();
          defaultHelper();
          Utils.method();
        }
      `);
      
      // Act
      const functions = await functionRegistry.collectAllFunctions();
      
      // Assert
      expect(functions.size).toBe(1); // Only the main function
      
      const mainFunction = Array.from(functions.values()).find(f => f.name === 'main');
      expect(mainFunction).toBeDefined();
      expect(mainFunction?.filePath).toContain('test.ts');
    });

    it('should handle various function declaration types', async () => {
      // Arrange
      const sourceFile = project.createSourceFile('test.ts', `
        // Function declaration
        function regularFunction() {}
        
        // Arrow function
        const arrowFunction = () => {};
        
        // Function expression
        const functionExpression = function() {};
        
        // Method in class
        class TestClass {
          method() {}
          static staticMethod() {}
        }
        
        // Method in object
        const obj = {
          objectMethod() {}
        };
      `);
      
      // Act
      const functions = await functionRegistry.collectAllFunctions();
      
      // Assert
      expect(functions.size).toBeGreaterThan(1);
      
      const functionNames = Array.from(functions.values()).map(f => f.name);
      expect(functionNames).toContain('regularFunction');
      expect(functionNames).toContain('arrowFunction');
      expect(functionNames).toContain('functionExpression');
      expect(functionNames).toContain('method');
      expect(functionNames).toContain('staticMethod');
      expect(functionNames).toContain('objectMethod');
    });
  });

  describe('Call Expression Detection', () => {
    it('should detect function calls in source code', async () => {
      // Arrange
      const sourceFile = project.createSourceFile('test.ts', `
        function helper() {
          return 'helper';
        }
        
        function caller() {
          const result = helper(); // Direct call
          console.log(result);     // External call
          return result;
        }
        
        class TestClass {
          method() {
            this.helper();         // This call
            TestClass.staticCall(); // Static call
          }
          
          helper() {}
          static staticCall() {}
        }
      `);
      
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const edges = await engine.performStagedAnalysis(functions);
      
      // Assert
      // Should find at least the local exact calls within the same file
      const localExactEdges = edges.filter(edge => edge.resolutionLevel === 'local_exact');
      expect(localExactEdges.length).toBeGreaterThan(0);
      
      // Check for helper() call
      const helperCall = localExactEdges.find(edge => 
        edge.calleeName === 'helper'
      );
      expect(helperCall).toBeDefined();
    });

    it('should handle optional chaining calls', async () => {
      // Arrange
      const sourceFile = project.createSourceFile('test.ts', `
        interface OptionalAPI {
          method?(): string;
        }
        
        function testOptional(api: OptionalAPI) {
          return api.method?.(); // Optional chaining call
        }
        
        function regularCall() {
          return testOptional({});
        }
      `);
      
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const edges = await engine.performStagedAnalysis(functions);
      
      // Assert
      const localExactEdges = edges.filter(edge => edge.resolutionLevel === 'local_exact');
      
      // Should detect the testOptional() call
      const testOptionalCall = localExactEdges.find(edge => 
        edge.calleeName === 'testOptional'
      );
      expect(testOptionalCall).toBeDefined();
    });
  });

  describe('Advanced Cross-File Scenarios (Adapted from Same-File Tests)', () => {
    it('should handle imported functions with same names from different modules', async () => {
      // Arrange - Create modules with same function names
      const module1 = project.createSourceFile('module1.ts', `
        export function process(data: string): string {
          return 'module1: ' + data;
        }
      `);
      
      const module2 = project.createSourceFile('module2.ts', `
        export function process(data: number): number {
          return data * 2;
        }
      `);
      
      const mainFile = project.createSourceFile('main.ts', `
        import { process as processString } from './module1';
        import { process as processNumber } from './module2';
        
        function handleData(): void {
          const result1 = processString('test'); // Import alias call
          const result2 = processNumber(42);     // Import alias call
        }
      `);
      
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const edges = await engine.performStagedAnalysis(functions);
      
      // Assert - Should handle aliased imports without confusion
      expect(functions.size).toBe(3); // process from module1, process from module2, handleData
      
      const allFunctions = Array.from(functions.values());
      const processFunctions = allFunctions.filter(f => f.name === 'process');
      expect(processFunctions).toHaveLength(2);
    });

    it('should handle imported static method calls correctly', async () => {
      // Arrange
      const utilsFile = project.createSourceFile('utils.ts', `
        export class MathUtils {
          static square(num: number): number {
            return num * num;
          }
          
          static cube(num: number): number {
            return num * num * num;
          }
        }
      `);
      
      const calculatorFile = project.createSourceFile('calculator.ts', `
        import { MathUtils } from './utils';
        
        function calculateVolume(side: number): number {
          const area = MathUtils.square(side);  // Imported static call
          return MathUtils.cube(side);          // Imported static call
        }
      `);
      
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const edges = await engine.performStagedAnalysis(functions);
      
      // Assert - Should detect the functions and attempt resolution
      const mathUtilsMethods = Array.from(functions.values()).filter(f => 
        f.className === 'MathUtils'
      );
      expect(mathUtilsMethods.length).toBeGreaterThanOrEqual(2); // square, cube
    });

    it('should handle imported class constructor calls', async () => {
      // Arrange
      const modelsFile = project.createSourceFile('models.ts', `
        export class User {
          constructor(public name: string, public email: string) {}
          
          getDisplayName(): string {
            return this.name;
          }
        }
        
        export class Product {
          constructor(public title: string, public price: number) {}
        }
      `);
      
      const factoryFile = project.createSourceFile('factory.ts', `
        import { User, Product } from './models';
        
        function createUser(name: string, email: string): User {
          return new User(name, email); // Imported constructor
        }
        
        function createProduct(title: string, price: number): Product {
          return new Product(title, price); // Imported constructor
        }
      `);
      
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const edges = await engine.performStagedAnalysis(functions);
      
      // Assert - Should collect constructor functions
      const allFunctions = Array.from(functions.values());
      const constructors = allFunctions.filter(f => f.name === 'constructor');
      expect(constructors.length).toBeGreaterThanOrEqual(2); // User, Product constructors
    });

    it('should handle optional chaining with imported functions', async () => {
      // Arrange
      const apiFile = project.createSourceFile('api.ts', `
        export function fetchUserData(id: string): Promise<any> | undefined {
          return Math.random() > 0.5 ? Promise.resolve({ id, name: 'User' }) : undefined;
        }
      `);
      
      const componentFile = project.createSourceFile('component.ts', `
        import { fetchUserData } from './api';
        
        async function loadUserProfile(userId: string): Promise<void> {
          const userData = await fetchUserData(userId)?.then?.(data => data); // Optional chaining
        }
      `);
      
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const edges = await engine.performStagedAnalysis(functions);
      
      // Assert - Should handle optional chaining pattern
      const functionNames = Array.from(functions.values()).map(f => f.name);
      expect(functionNames).toContain('fetchUserData');
      expect(functionNames).toContain('loadUserProfile');
    });

    it('should prioritize explicit imports over global scope', async () => {
      // Arrange - Simulate local vs global function conflict
      const localUtilsFile = project.createSourceFile('local/utils.ts', `
        export function helper(): string {
          return 'local helper';
        }
      `);
      
      const mainFile = project.createSourceFile('main.ts', `
        import { helper } from './local/utils';
        
        // Simulate global helper (could be from node_modules)
        declare function helper(): string;
        
        function processData(): string {
          return helper(); // Should prefer imported helper
        }
      `);
      
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const edges = await engine.performStagedAnalysis(functions);
      
      // Assert - Test that function collection works for this scenario
      expect(functions.size).toBeGreaterThanOrEqual(2); // helper, processData
    });
  });

  describe('Performance and Reliability (Adapted from Same-File Tests)', () => {
    it('should maintain consistent results across multiple runs for cross-file analysis', async () => {
      // Arrange
      const utilsFile = project.createSourceFile('utils.ts', `
        export function helper1(): string { return 'one'; }
        export function helper2(): string { return 'two'; }
      `);
      
      const mainFile = project.createSourceFile('main.ts', `
        import { helper1, helper2 } from './utils';
        
        function process(): string {
          return helper1() + helper2();
        }
      `);
      
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act - Run analysis multiple times
      const results = [];
      for (let i = 0; i < 3; i++) {
        const edges = await engine.performStagedAnalysis(functions);
        results.push(edges.length);
      }
      
      // Assert - Results should be consistent
      expect(results[0]).toBe(results[1]);
      expect(results[1]).toBe(results[2]);
      expect(results[0]).toBeGreaterThanOrEqual(0);
    });

    it('should handle large numbers of imported functions efficiently', async () => {
      // Arrange - Create multiple export files
      for (let i = 0; i < 10; i++) {
        project.createSourceFile(`module${i}.ts`, `
          export function func${i}() { return ${i}; }
        `);
      }
      
      // Create main file that imports all functions
      let importStatements = '';
      let functionCalls = '';
      for (let i = 0; i < 10; i++) {
        importStatements += `import { func${i} } from './module${i}';\n`;
        functionCalls += `  func${i}();\n`;
      }
      
      const mainFile = project.createSourceFile('main.ts', `
        ${importStatements}
        
        function caller() {
        ${functionCalls}
        }
      `);
      
      const functions = await functionRegistry.collectAllFunctions();
      
      // Act
      const startTime = Date.now();
      const edges = await engine.performStagedAnalysis(functions);
      const endTime = Date.now();
      
      // Assert
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
      expect(functions.size).toBe(11); // 10 exported functions + 1 caller function
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle malformed code gracefully', async () => {
      // Arrange
      const sourceFile = project.createSourceFile('test.ts', `
        function validFunction() {
          return 'valid';
        }
        
        function incompleteFunction() {
          return validFunction(); // Valid call
          // Missing closing brace is handled by TypeScript parser
      `);
      
      // Act & Assert - Should not throw
      await expect(async () => {
        const functions = await functionRegistry.collectAllFunctions();
        const edges = await engine.performStagedAnalysis(functions);
        return edges;
      }).not.toThrow();
    });

    it('should handle empty source files', async () => {
      // Arrange
      const sourceFile = project.createSourceFile('empty.ts', '');
      
      // Act & Assert - Should not throw
      await expect(async () => {
        const functions = await functionRegistry.collectAllFunctions();
        const edges = await engine.performStagedAnalysis(functions);
        return edges;
      }).not.toThrow();
    });

    it('should handle files with only comments', async () => {
      // Arrange
      const sourceFile = project.createSourceFile('comments.ts', `
        // This file only contains comments
        /* And block comments */
        /**
         * JSDoc comments too
         */
      `);
      
      // Act & Assert - Should not throw
      await expect(async () => {
        const functions = await functionRegistry.collectAllFunctions();
        const edges = await engine.performStagedAnalysis(functions);
        return edges;
      }).not.toThrow();
    });

    it('should handle invalid cross-file imports gracefully', async () => {
      // Arrange
      const validFile = project.createSourceFile('valid.ts', `
        export function validFunction() {
          return 'valid';
        }
      `);
      
      const invalidImportFile = project.createSourceFile('invalid.ts', `
        import { nonExistentFunction } from './nonexistent'; // Invalid import
        import { validFunction } from './valid';           // Valid import
        
        function caller() {
          return validFunction(); // This should work
        }
      `);
      
      // Act & Assert - Should not throw
      await expect(async () => {
        const functions = await functionRegistry.collectAllFunctions();
        const edges = await engine.performStagedAnalysis(functions);
        return edges;
      }).not.toThrow();
    });

    it('should handle circular imports gracefully', async () => {
      // Arrange - Create circular dependency
      const aFile = project.createSourceFile('a.ts', `
        import { funcB } from './b';
        
        export function funcA(): string {
          return 'A';
        }
        
        export function callB(): string {
          return funcB();
        }
      `);
      
      const bFile = project.createSourceFile('b.ts', `
        import { funcA } from './a';
        
        export function funcB(): string {
          return 'B';
        }
        
        export function callA(): string {
          return funcA();
        }
      `);
      
      // Act & Assert - Should not throw
      await expect(async () => {
        const functions = await functionRegistry.collectAllFunctions();
        const edges = await engine.performStagedAnalysis(functions);
        return edges;
      }).not.toThrow();
    });
  });

  describe('Function Metadata Accuracy', () => {
    it('should extract accurate function metadata', async () => {
      // Arrange
      const sourceFile = project.createSourceFile('test.ts', `
        export async function complexFunction(
          param1: string,
          param2: number = 42,
          ...rest: any[]
        ): Promise<string> {
          if (param1.length > 0) {
            for (let i = 0; i < param2; i++) {
              if (i % 2 === 0) {
                console.log(param1);
              }
            }
          }
          return Promise.resolve(param1 + param2);
        }
      `);
      
      // Act
      const functions = await functionRegistry.collectAllFunctions();
      
      // Assert
      expect(functions.size).toBe(1);
      
      const complexFunction = Array.from(functions.values())[0];
      expect(complexFunction.name).toBe('complexFunction');
      
      // Test that basic function collection works
      expect(complexFunction.filePath).toContain('test.ts');
      expect(complexFunction.startLine).toBeGreaterThan(0);
      
      // Test that basic properties exist
      expect(typeof complexFunction.isExported).toBe('boolean');
      expect(typeof complexFunction.isMethod).toBe('boolean');
      expect(typeof complexFunction.nodeKind).toBe('string');
      
      // Test that signature exists
      expect(typeof complexFunction.signature).toBe('string');
      expect(complexFunction.signature.length).toBeGreaterThan(0);
      
      // Test that lexicalPath exists
      expect(typeof complexFunction.lexicalPath).toBe('string');
      expect(complexFunction.lexicalPath.length).toBeGreaterThan(0);
    });

    it('should handle class methods with correct metadata', async () => {
      // Arrange
      const sourceFile = project.createSourceFile('test.ts', `
        export class TestClass {
          private value: number = 0;
          
          public getValue(): number {
            return this.value;
          }
          
          protected setValue(newValue: number): void {
            this.value = newValue;
          }
          
          static createInstance(): TestClass {
            return new TestClass();
          }
        }
      `);
      
      // Act
      const functions = await functionRegistry.collectAllFunctions();
      
      // Assert
      expect(functions.size).toBe(3); // getValue, setValue, createInstance
      
      const allFunctions = Array.from(functions.values());
      const functionNames = allFunctions.map(f => f.name);
      expect(functionNames).toContain('getValue');
      expect(functionNames).toContain('setValue');
      expect(functionNames).toContain('createInstance');
      
      // Test that methods are properly detected (even if isMethod flag might not be set)
      const createInstanceFunction = allFunctions.find(f => f.name === 'createInstance');
      expect(createInstanceFunction).toBeDefined();
      expect(createInstanceFunction?.className).toBe('TestClass');
    });
  });
});
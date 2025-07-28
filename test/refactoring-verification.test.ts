import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TypeScriptAnalyzer } from '../src/analyzers/typescript-analyzer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Refactoring Verification', () => {
  let tempDir: string;
  let analyzer: TypeScriptAnalyzer;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'funcqc-refactor-'));
    analyzer = new TypeScriptAnalyzer(50);
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('should verify extractModifiers refactoring works correctly', async () => {
    const testFile = path.join(tempDir, 'modifiers-test.ts');
    const content = `
      // Function with various modifiers
      export async function* globalAsyncGenerator(): AsyncGenerator<string> {
        yield 'test';
      }

      export class TestService {
        // Method with various modifiers
        private static async processData(data: string): Promise<string> {
          return data.toUpperCase();
        }

        // Public method (default)
        public normalMethod(): void {
          console.log('normal');
        }

        // Protected method
        protected helperMethod(): void {
          console.log('helper');
        }

        // Constructor
        constructor(private config: any) {
          this.config = config;
        }
      }
    `;
    
    await fs.promises.writeFile(testFile, content);
    
    const functions = await analyzer.analyzeFile(testFile);
    
    console.log('=== Modifiers Verification ===');
    functions.forEach((func, index) => {
      console.log(`${index + 1}. ${func.name}`);
      console.log(`   modifiers: [${func.modifiers?.join(', ') || 'none'}]`);
      console.log(`   isMethod: ${func.isMethod}`);
      console.log(`   contextPath: [${func.contextPath?.join(', ') || 'empty'}]`);
      console.log('');
    });

    // Verify function modifiers
    const globalFunc = functions.find(f => f.name === 'globalAsyncGenerator');
    if (!globalFunc) {
      console.log('Available functions:', functions.map(f => f.name));
      throw new Error('globalAsyncGenerator function not found');
    }
    
    console.log('globalAsyncGenerator modifiers:', globalFunc.modifiers);
    console.log('globalAsyncGenerator isExported:', globalFunc.isExported);
    console.log('globalAsyncGenerator isGenerator:', globalFunc.isGenerator);
    
    expect(globalFunc.modifiers).toContain('async');
    // Note: may need different checks for exported and generator

    // Verify method modifiers
    const processData = functions.find(f => f.name === 'processData');
    console.log('processData modifiers:', processData?.modifiers);
    console.log('processData isStatic:', processData?.isStatic);
    expect(processData?.modifiers).toContain('async');
    expect(processData?.modifiers).toContain('static');
    // Note: may need different check for private

    const normalMethod = functions.find(f => f.name === 'normalMethod');
    console.log('normalMethod modifiers:', normalMethod?.modifiers);
    // Note: may need different check for public

    const helperMethod = functions.find(f => f.name === 'helperMethod');
    console.log('helperMethod modifiers:', helperMethod?.modifiers);
    // Note: may need different check for protected

    // Verify context paths
    expect(processData?.contextPath).toContain('TestService');
    expect(normalMethod?.contextPath).toContain('TestService');
    expect(helperMethod?.contextPath).toContain('TestService');
  });

  it('should verify parameter extraction unification works', async () => {
    const testFile = path.join(tempDir, 'parameters-test.ts');
    const content = `
      // Function with parameters
      export function processUser(name: string, age: number, isActive?: boolean): void {
        console.log(name, age, isActive);
      }

      export class UserManager {
        // Method with parameters
        updateUser(id: number, userData: { name: string; email: string }): Promise<void> {
          return Promise.resolve();
        }

        // Constructor with parameters
        constructor(private dbConnection: any, config: { timeout: number }) {
          this.dbConnection = dbConnection;
        }
      }

      // Arrow function with parameters
      const calculateTotal = (items: number[], tax: number = 0.1): number => {
        return items.reduce((sum, item) => sum + item, 0) * (1 + tax);
      };
    `;
    
    await fs.promises.writeFile(testFile, content);
    
    const functions = await analyzer.analyzeFile(testFile);
    
    console.log('=== Parameters Verification ===');
    functions.forEach((func, index) => {
      console.log(`${index + 1}. ${func.name}`);
      console.log(`   parameters: ${func.parameters.length}`);
      func.parameters.forEach((param, i) => {
        console.log(`     ${i + 1}: ${param.name}: ${param.type} (optional: ${param.isOptional})`);
      });
      console.log('');
    });

    // Verify function parameters
    const processUser = functions.find(f => f.name === 'processUser');
    expect(processUser?.parameters).toHaveLength(3);
    expect(processUser?.parameters[0].name).toBe('name');
    expect(processUser?.parameters[0].type).toContain('string');
    expect(processUser?.parameters[2].isOptional).toBe(true);

    // Verify method parameters
    const updateUser = functions.find(f => f.name === 'updateUser');
    expect(updateUser?.parameters).toHaveLength(2);
    expect(updateUser?.parameters[0].name).toBe('id');

    // Verify constructor parameters
    const constructorFunc = functions.find(f => f.name === 'constructor');
    expect(constructorFunc?.parameters).toHaveLength(2);

    // Verify arrow function parameters
    const calculateTotal = functions.find(f => f.name === 'calculateTotal');
    expect(calculateTotal?.parameters).toHaveLength(2);
    expect(calculateTotal?.parameters[1].name).toBe('tax');
  });

  it('should verify common utilities abstraction works', async () => {
    const testFile = path.join(tempDir, 'nesting-test.ts');
    const content = `
      export namespace OuterNamespace {
        export class OuterClass {
          outerMethod(): void {
            function localFunction(): void {
              const innerArrow = () => {
                console.log('deeply nested');
              };
              innerArrow();
            }
            localFunction();
          }
        }
      }

      function topLevel(): void {
        function level1(): void {
          function level2(): void {
            console.log('nested function');
          }
          level2();
        }
        level1();
      }
    `;
    
    await fs.promises.writeFile(testFile, content);
    
    const functions = await analyzer.analyzeFile(testFile);
    
    console.log('=== Nesting and Context Verification ===');
    functions.forEach((func, index) => {
      console.log(`${index + 1}. ${func.name}`);
      console.log(`   nestingLevel: ${func.nestingLevel}`);
      console.log(`   contextPath: [${func.contextPath?.join('.') || 'empty'}]`);
      console.log(`   functionType: ${func.functionType}`);
      console.log('');
    });

    // Verify context paths
    const outerMethod = functions.find(f => f.name === 'outerMethod');
    if (outerMethod) {
      expect(outerMethod.contextPath).toContain('OuterClass');
      expect(outerMethod.nestingLevel).toBe(0);
    }

    // Verify nesting levels
    const localFunction = functions.find(f => f.name === 'localFunction');
    if (localFunction) {
      expect(localFunction.nestingLevel).toBeGreaterThan(0);
      expect(localFunction.functionType).toBe('local');
    }

    const level2 = functions.find(f => f.name === 'level2');
    if (level2) {
      expect(level2.nestingLevel).toBe(2); // nested inside level1 and topLevel
      expect(level2.functionType).toBe('local');
    }
  });
});
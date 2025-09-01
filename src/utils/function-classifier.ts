import { FunctionInfo } from '../types';

/**
 * Utility class for classifying and identifying function types
 * Provides common logic shared between dep dead and dep delete commands
 */
export class FunctionClassifier {
  /**
   * Check if a function is a static method
   */
  static isStaticMethod(func: FunctionInfo): boolean {
    return func.isMethod === true && 
      (func.isStatic === true || func.modifiers?.includes('static') === true);
  }

  /**
   * Check if a function is an instance method (non-static method)
   */
  static isInstanceMethod(func: FunctionInfo): boolean {
    return func.isMethod === true && !this.isStaticMethod(func);
  }

  /**
   * Check if a function is a constructor
   */
  static isConstructor(func: FunctionInfo): boolean {
    return func.isConstructor === true || 
      func.name === 'constructor' || 
      func.modifiers?.includes('constructor') === true;
  }

  /**
   * Check if a function is exported
   */
  static isExported(func: FunctionInfo): boolean {
    return func.isExported === true;
  }

  /**
   * Check if a function is in a test file or is a test function
   */
  static isTestFunction(func: FunctionInfo): boolean {
    // Check if file is a test file
    const isTestFile = this.isTestFile(func.filePath);
    
    // Check if function name suggests it's a test function
    const isTestFunctionName = /^(test|it|describe|beforeAll|beforeEach|afterAll|afterEach|expect|jest|vitest|suite|setup|teardown)/.test(func.name);
    
    return isTestFile || isTestFunctionName;
  }

  /**
   * Check if a file is a test file based on path patterns
   */
  static isTestFile(filePath: string): boolean {
    const testPatterns = [
      /\.test\.[jt]sx?$/,        // .test.ts, .test.js, .test.tsx, .test.jsx
      /\.spec\.[jt]sx?$/,        // .spec.ts, .spec.js, .spec.tsx, .spec.jsx
      /(\/|\\)__tests__(\/|\\)/, // /__tests__/ or \__tests__\ (Windows/Unix)
      /(\/|\\)test(\/|\\)/,      // /test/ or \test\ (Windows/Unix)
      /(\/|\\)tests(\/|\\)/,     // /tests/ or \tests\ (Windows/Unix)
      /(\/|\\)e2e(\/|\\)/,       // /e2e/ or \e2e\ (Windows/Unix)
      /cypress\//,               // Cypress test files
      /playwright\//,            // Playwright test files
      /vitest\//,                // Vitest test files
      /jest\//,                  // Jest test files
      /\.integration\.[jt]sx?$/, // .integration.ts, .integration.js, etc.
      /\.e2e\.[jt]sx?$/,         // .e2e.ts, .e2e.js, etc.
    ];

    return testPatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Check if a function is a CLI command or handler
   */
  static isCliFunction(func: FunctionInfo): boolean {
    const cliPatterns = [
      /cli\.ts$/,
      /cli\/.*\.ts$/,
      /bin\/.*\.(ts|js)$/,
      /scripts\/.*\.(ts|js)$/,
    ];

    const isCliFile = cliPatterns.some(pattern => pattern.test(func.filePath));
    const isCliFunction = /^(command|handler|cli|main|run)/.test(func.name);

    return isCliFile || isCliFunction;
  }

  /**
   * Check if a function is a handler (e.g., event handler, API handler)
   */
  static isHandlerFunction(func: FunctionInfo): boolean {
    const handlerPatterns = [
      /handler/i,
      /^handle/i,
      /^on[A-Z]/,  // onClick, onSubmit, etc.
      /middleware/i,
      /controller/i,
      /route/i,
    ];

    const isHandlerFile = handlerPatterns.some(pattern => pattern.test(func.filePath));
    const isHandlerFunction = handlerPatterns.some(pattern => pattern.test(func.name));

    return isHandlerFile || isHandlerFunction;
  }

  /**
   * Check if a function is in an index file (likely an entry point)
   */
  static isIndexFunction(func: FunctionInfo): boolean {
    const indexPatterns = [
      /index\.[jt]sx?$/,
      /main\.[jt]sx?$/,
    ];

    return indexPatterns.some(pattern => pattern.test(func.filePath));
  }

  /**
   * Get a human-readable classification of the function
   */
  static getClassification(func: FunctionInfo): string[] {
    const classifications: string[] = [];

    if (this.isConstructor(func)) classifications.push('constructor');
    if (this.isStaticMethod(func)) classifications.push('static-method');
    if (this.isInstanceMethod(func)) classifications.push('instance-method');
    if (this.isExported(func)) classifications.push('exported');
    if (this.isTestFunction(func)) classifications.push('test');
    if (this.isCliFunction(func)) classifications.push('cli');
    if (this.isHandlerFunction(func)) classifications.push('handler');
    if (this.isIndexFunction(func)) classifications.push('index');

    if (classifications.length === 0) {
      classifications.push('regular');
    }

    return classifications;
  }

  /**
   * Get function metadata for analysis
   */
  static getMetadata(func: FunctionInfo): {
    isStaticMethod: boolean;
    isInstanceMethod: boolean;
    isConstructor: boolean;
    isExported: boolean;
    isTest: boolean;
    isCli: boolean;
    isHandler: boolean;
    isIndex: boolean;
    classifications: string[];
    className?: string;
  } {
    const metadata = {
      isStaticMethod: this.isStaticMethod(func),
      isInstanceMethod: this.isInstanceMethod(func),
      isConstructor: this.isConstructor(func),
      isExported: this.isExported(func),
      isTest: this.isTestFunction(func),
      isCli: this.isCliFunction(func),
      isHandler: this.isHandlerFunction(func),
      isIndex: this.isIndexFunction(func),
      classifications: this.getClassification(func),
    } as const;

    // Add className only if it exists
    if (func.className !== undefined) {
      return { ...metadata, className: func.className };
    }

    return metadata;
  }
}
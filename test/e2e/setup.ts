import * as fs from 'fs/promises';
import * as path from 'path';
import { fileExists } from '../../src/utils/file-utils';

// Test environment setup
export const TEST_PROJECT_DIR = path.join(__dirname, 'test-project');
export const TEST_CONFIG_FILE = path.join(TEST_PROJECT_DIR, '.funcqc.config.js');
export const TEST_DB_PATH = path.join(TEST_PROJECT_DIR, '.funcqc', 'test.db');

/**
 * Setup test project directory with sample TypeScript files
 */
export async function setupTestProject(): Promise<void> {
  // Clean up any existing test project
  await cleanupTestProject();

  // Create test project directory
  await fs.mkdir(TEST_PROJECT_DIR, { recursive: true });
  await fs.mkdir(path.join(TEST_PROJECT_DIR, 'src'), { recursive: true });
  await fs.mkdir(path.join(TEST_PROJECT_DIR, '.funcqc'), { recursive: true });

  // Create sample TypeScript files
  await createSampleFiles();

  // Create test configuration
  await createTestConfig();
}

/**
 * Cleanup test project directory
 */
export async function cleanupTestProject(): Promise<void> {
  if (await fileExists(TEST_PROJECT_DIR)) {
    await fs.rm(TEST_PROJECT_DIR, { recursive: true, force: true });
  }
}

async function createSampleFiles(): Promise<void> {
  // Simple function file
  await fs.writeFile(
    path.join(TEST_PROJECT_DIR, 'src', 'utils.ts'),
    `export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(x: number, y: number): number {
  return x * y;
}

export async function fetchData(url: string): Promise<any> {
  const response = await fetch(url);
  return response.json();
}
`
  );

  // Complex function file
  await fs.writeFile(
    path.join(TEST_PROJECT_DIR, 'src', 'complex.ts'),
    `export function complexFunction(input: any): string {
  if (typeof input === 'string') {
    if (input.length > 10) {
      for (let i = 0; i < input.length; i++) {
        if (input[i] === 'x') {
          try {
            return input.substring(0, i);
          } catch (error) {
            console.error(error);
            return '';
          }
        }
      }
      return input.toUpperCase();
    } else if (input.length > 5) {
      return input.toLowerCase();
    } else {
      return input;
    }
  } else if (typeof input === 'number') {
    if (input > 100) {
      return 'large';
    } else if (input > 50) {
      return 'medium';
    } else {
      return 'small';
    }
  } else {
    return 'unknown';
  }
}

class Calculator {
  private result: number = 0;

  constructor(initial: number = 0) {
    this.result = initial;
  }

  add(value: number): this {
    this.result += value;
    return this;
  }

  multiply(value: number): this {
    this.result *= value;
    return this;
  }

  getResult(): number {
    return this.result;
  }

  reset(): void {
    this.result = 0;
  }
}
`
  );

  // Arrow function file
  await fs.writeFile(
    path.join(TEST_PROJECT_DIR, 'src', 'arrows.ts'),
    `export const arrowAdd = (a: number, b: number): number => a + b;

export const arrowMultiply = (x: number, y: number): number => {
  return x * y;
};

export const processArray = (items: string[]): string[] => {
  return items
    .filter(item => item.length > 0)
    .map(item => item.toUpperCase())
    .sort();
};

const privateHelper = (value: string): boolean => {
  return value.trim().length > 0;
};
`
  );
}

async function createTestConfig(): Promise<void> {
  const config = `module.exports = {
  roots: ['src'],
  exclude: ['**/*.test.ts', '**/node_modules/**'],
  storage: {
    type: 'pglite',
    path: '.funcqc/test.db'
  },
  metrics: {
    complexityThreshold: 5,
    linesOfCodeThreshold: 20,
    parameterCountThreshold: 3
  },
  git: {
    enabled: false
  }
};`;

  await fs.writeFile(TEST_CONFIG_FILE, config);
}

// Global setup and teardown
beforeAll(async () => {
  await setupTestProject();
});

afterAll(async () => {
  await cleanupTestProject();
});

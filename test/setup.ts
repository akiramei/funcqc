/**
 * Global test setup for funcqc
 */

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mockProcessExit } from './test-utils';

// Track open connections to ensure proper cleanup
const openConnections = new Set<unknown>();

// Global connection tracker
global.__TEST_TRACK_CONNECTION__ = (connection: unknown) => {
  openConnections.add(connection);
};

global.__TEST_UNTRACK_CONNECTION__ = (connection: unknown) => {
  openConnections.delete(connection);
};

beforeAll(() => {
  console.log('🧪 Starting funcqc test suite...');
});

// Mock process.exit for all tests
let processExitSpy: ReturnType<typeof mockProcessExit>;

beforeEach(() => {
  // Mock process.exit to prevent test runner termination
  processExitSpy = mockProcessExit();
});

afterEach(() => {
  // Restore process.exit after each test
  processExitSpy.mockRestore();
});

afterAll(async () => {
  console.log('🧹 Cleaning up funcqc test suite...');
  
  // Force close any remaining connections
  if (openConnections.size > 0) {
    console.warn(`⚠️ Found ${openConnections.size} unclosed connections, forcing cleanup...`);
    
    for (const connection of openConnections) {
      try {
        if (connection && typeof connection === 'object' && connection !== null && 'close' in connection && typeof (connection as Record<string, unknown>)['close'] === 'function') {
          const closeMethod = (connection as Record<string, unknown>)['close'] as () => Promise<void>;
          await closeMethod();
        }
      } catch (error) {
        console.warn('Failed to close connection:', error);
      }
    }
    
    openConnections.clear();
  }
  
  console.log('✅ Test cleanup completed');
});
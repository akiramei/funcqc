/**
 * CI environment specific test setup
 * Handles WASM/PGLite stability issues in containerized environments
 */

import { beforeAll, afterAll } from 'vitest';

// Track open connections to ensure proper cleanup
const openConnections = new Set<unknown>();

// Global connection tracker with CI-specific handling
global.__TEST_TRACK_CONNECTION__ = (connection: unknown) => {
  openConnections.add(connection);
};

global.__TEST_UNTRACK_CONNECTION__ = (connection: unknown) => {
  openConnections.delete(connection);
};

beforeAll(() => {
  console.log('🔧 Starting funcqc CI test suite...');
  
  // Set environment variables for WASM stability
  process.env.NODE_OPTIONS = '--max-old-space-size=4096';
  
  // Disable problematic WASM optimizations in CI
  if (process.env.CI) {
    process.env.WASM_DISABLE_TIER_UP = '1';
    process.env.V8_FLAGS = '--no-wasm-tier-up --no-wasm-lazy-compilation';
  }
});

afterAll(async () => {
  console.log('🧹 Cleaning up funcqc CI test suite...');
  
  // More aggressive cleanup for CI environment
  if (openConnections.size > 0) {
    console.warn(`⚠️ Found ${openConnections.size} unclosed connections, forcing cleanup...`);
    
    const cleanupPromises = Array.from(openConnections).map(async connection => {
      try {
        if (connection && typeof connection === 'object' && connection !== null && 'close' in connection && typeof (connection as Record<string, unknown>)['close'] === 'function') {
          const closeMethod = (connection as Record<string, unknown>)['close'] as () => Promise<void>;
          await Promise.race([
            closeMethod(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Cleanup timeout')), 5000))
          ]);
        }
      } catch (error) {
        console.warn('Failed to close connection:', error);
      }
    });
    
    await Promise.allSettled(cleanupPromises);
    openConnections.clear();
  }
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
  
  console.log('✅ CI test cleanup completed');
});
/**
 * Global test setup for funcqc
 */

import { beforeAll, afterAll } from 'vitest';

// Track open connections to ensure proper cleanup
const openConnections = new Set<any>();

// Global connection tracker
global.__TEST_TRACK_CONNECTION__ = (connection: any) => {
  openConnections.add(connection);
};

global.__TEST_UNTRACK_CONNECTION__ = (connection: any) => {
  openConnections.delete(connection);
};

beforeAll(() => {
  console.log('🧪 Starting funcqc test suite...');
});

afterAll(async () => {
  console.log('🧹 Cleaning up funcqc test suite...');
  
  // Force close any remaining connections
  if (openConnections.size > 0) {
    console.warn(`⚠️ Found ${openConnections.size} unclosed connections, forcing cleanup...`);
    
    for (const connection of openConnections) {
      try {
        if (connection && typeof connection.close === 'function') {
          await connection.close();
        }
      } catch (error) {
        console.warn('Failed to close connection:', error);
      }
    }
    
    openConnections.clear();
  }
  
  console.log('✅ Test cleanup completed');
});
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseError, PGLiteStorageAdapter } from '../src/storage/pglite-adapter';
import { ErrorCode } from '../src/utils/error-handler';
import * as fs from 'fs';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

describe('Database Error Handling', () => {
  let mockFs: any;
  
  beforeEach(() => {
    mockFs = vi.mocked(fs);
    vi.clearAllMocks();
  });

  describe('Windows Path Handling', () => {
    it('should handle Windows drive paths correctly', () => {
      const adapter = new PGLiteStorageAdapter('C:\\path\\to\\database.db');
      
      // Windows drive paths with actual paths should be valid
      expect(() => new PGLiteStorageAdapter('C:\\path\\to\\database.db')).not.toThrow();
      expect(() => new PGLiteStorageAdapter('D:\\funcqc\\data\\db.sqlite')).not.toThrow();
    });

    it('should skip directory check for drive letters only', () => {
      // Drive letters only should not cause directory checks
      expect(() => new PGLiteStorageAdapter('C:')).not.toThrow();
      expect(() => new PGLiteStorageAdapter('D:')).not.toThrow();
    });

    it('should handle Unix-style paths', () => {
      expect(() => new PGLiteStorageAdapter('/path/to/database.db')).not.toThrow();
      expect(() => new PGLiteStorageAdapter('./relative/path/db.sqlite')).not.toThrow();
    });

    it('should handle special database paths', () => {
      expect(() => new PGLiteStorageAdapter(':memory:')).not.toThrow();
      expect(() => new PGLiteStorageAdapter('postgres://user:pass@host:port/db')).not.toThrow();
    });

    it('should properly check directory existence for Windows paths', async () => {
      mockFs.existsSync.mockReturnValue(false);
      
      const adapter = new PGLiteStorageAdapter('C:\\nonexistent\\path\\db.sqlite');
      
      await expect(adapter.init()).rejects.toThrow(DatabaseError);
      await expect(adapter.init()).rejects.toThrow('Database directory not found');
    });

    it('should not check directory for Windows drive letters only', () => {
      // Test that shouldCheckDatabaseDirectory method works correctly
      const adapter = new PGLiteStorageAdapter('C:');
      
      // This should not throw during construction
      expect(() => new PGLiteStorageAdapter('C:')).not.toThrow();
      expect(() => new PGLiteStorageAdapter('D:')).not.toThrow();
    });
  });

  describe('DatabaseError', () => {
    it('should create DatabaseError with correct properties', () => {
      const originalError = new Error('Original error message');
      const dbError = new DatabaseError(
        ErrorCode.DATABASE_NOT_INITIALIZED,
        'Database not initialized',
        originalError
      );

      expect(dbError.code).toBe(ErrorCode.DATABASE_NOT_INITIALIZED);
      expect(dbError.message).toBe('Database not initialized');
      expect(dbError.originalError).toBe(originalError);
      expect(dbError.name).toBe('DatabaseError');
    });

    it('should work without original error', () => {
      const dbError = new DatabaseError(
        ErrorCode.DATABASE_NOT_INITIALIZED,
        'Database not initialized'
      );

      expect(dbError.code).toBe(ErrorCode.DATABASE_NOT_INITIALIZED);
      expect(dbError.message).toBe('Database not initialized');
      expect(dbError.originalError).toBeUndefined();
      expect(dbError.name).toBe('DatabaseError');
    });
  });
});
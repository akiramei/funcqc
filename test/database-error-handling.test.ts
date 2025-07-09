import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseError, PGLiteStorageAdapter } from '../src/storage/pglite-adapter';
import { ErrorCode } from '../src/utils/error-handler';
import * as fs from 'fs';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

// Mock PGLite to avoid filesystem operations in this specific test
// This test focuses on path validation logic, not database operations
vi.mock('@electric-sql/pglite', () => ({
  PGlite: vi.fn().mockImplementation((path: string) => {
    // Don't create actual filesystem structures for any path in tests
    // This prevents creation of :memory:, C:, D:, etc. directories
    console.log(`PGLite mock intercepted: ${path}`);
    return {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      close: vi.fn().mockResolvedValue(undefined),
      exec: vi.fn().mockResolvedValue(undefined),
      path: path, // Store path but don't use it for filesystem operations
    };
  }),
}));

describe('Database Error Handling', () => {
  let mockFs: any;
  
  beforeEach(() => {
    mockFs = vi.mocked(fs);
    vi.clearAllMocks();
  });

  describe('Path Validation', () => {
    it('should accept valid Windows drive paths', () => {
      // Full Windows paths should be valid
      expect(() => new PGLiteStorageAdapter('C:\\path\\to\\database.db')).not.toThrow();
      expect(() => new PGLiteStorageAdapter('D:\\funcqc\\data\\db.sqlite')).not.toThrow();
    });

    it('should reject Windows drive letters only', () => {
      // Drive letters only should be rejected to prevent filesystem pollution
      expect(() => new PGLiteStorageAdapter('C:')).toThrow(DatabaseError);
      expect(() => new PGLiteStorageAdapter('D:')).toThrow(DatabaseError);
      
      // Test specific error message
      expect(() => new PGLiteStorageAdapter('C:')).toThrow(/Drive letters alone are not valid database paths/);
    });

    it('should handle Unix-style paths', () => {
      expect(() => new PGLiteStorageAdapter('/path/to/database.db')).not.toThrow();
      expect(() => new PGLiteStorageAdapter('./relative/path/db.sqlite')).not.toThrow();
    });

    it('should allow special database paths', () => {
      expect(() => new PGLiteStorageAdapter(':memory:')).not.toThrow();
      expect(() => new PGLiteStorageAdapter('postgres://user:pass@host:port/db')).not.toThrow();
      expect(() => new PGLiteStorageAdapter('postgresql://user:pass@host:port/db')).not.toThrow();
    });

    it('should reject invalid path formats', () => {
      // Empty or null paths
      expect(() => new PGLiteStorageAdapter('')).toThrow(DatabaseError);
      expect(() => new PGLiteStorageAdapter(null as any)).toThrow(DatabaseError);
      expect(() => new PGLiteStorageAdapter(undefined as any)).toThrow(DatabaseError);

      // Paths with invalid characters (Windows)
      expect(() => new PGLiteStorageAdapter('path<with>invalid:chars')).toThrow(DatabaseError);
      expect(() => new PGLiteStorageAdapter('path|with|pipes')).toThrow(DatabaseError);
      expect(() => new PGLiteStorageAdapter('path"with"quotes')).toThrow(DatabaseError);

      // Paths with leading/trailing whitespace
      expect(() => new PGLiteStorageAdapter(' leadingspace')).toThrow(DatabaseError);
      expect(() => new PGLiteStorageAdapter('trailingspace ')).toThrow(DatabaseError);
    });

    it('should reject excessively long paths', () => {
      const longPath = 'a'.repeat(300); // Exceeds Windows MAX_PATH (260)
      expect(() => new PGLiteStorageAdapter(longPath)).toThrow(DatabaseError);
      expect(() => new PGLiteStorageAdapter(longPath)).toThrow(/Database path too long/);
    });

    it('should properly check directory existence for Windows paths', async () => {
      mockFs.existsSync.mockReturnValue(false);
      
      const adapter = new PGLiteStorageAdapter('C:\\nonexistent\\path\\db.sqlite');
      
      await expect(adapter.init()).rejects.toThrow(DatabaseError);
      await expect(adapter.init()).rejects.toThrow('Database directory not found');
    });

    it('should provide helpful error messages for common mistakes', () => {
      // Test that error messages are helpful for users
      try {
        new PGLiteStorageAdapter('C:');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).message).toContain('Drive letters alone are not valid');
        expect((error as DatabaseError).message).toContain('Use a full path like');
      }
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
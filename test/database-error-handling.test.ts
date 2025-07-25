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
      expect(() => new PGLiteStorageAdapter('C:')).toThrow(/Drive letter only is not a valid path/);
    });

    it('should handle Unix-style paths', () => {
      expect(() => new PGLiteStorageAdapter('/path/to/database.db')).not.toThrow();
      expect(() => new PGLiteStorageAdapter('./relative/path/db.sqlite')).not.toThrow();
    });

    it('should allow connection string database paths', () => {
      // PostgreSQL connection strings are valid paths for PGLite
      expect(() => new PGLiteStorageAdapter('postgres://user:pass@host:port/db')).not.toThrow();
      expect(() => new PGLiteStorageAdapter('postgresql://user:pass@host:port/db')).not.toThrow();
    });

    it('should handle problematic paths that look like special syntax', () => {
      // :memory: looks like special syntax but PGLite treats it as a regular file path
      // This can cause issues on Windows due to invalid ':' character
      // We allow it in path validation but it will fail during actual filesystem operations
      expect(() => new PGLiteStorageAdapter(':memory:')).not.toThrow();
      
      // The issue becomes apparent during init() when filesystem operations are attempted
      // (This is mocked in these tests to prevent actual filesystem pollution)
    });

    it('should reject invalid path formats', () => {
      // Empty or null paths
      expect(() => new PGLiteStorageAdapter('')).toThrow(DatabaseError);
      expect(() => new PGLiteStorageAdapter(null as any)).toThrow(DatabaseError);
      expect(() => new PGLiteStorageAdapter(undefined as any)).toThrow(DatabaseError);

      // Note: Current implementation doesn't validate special characters
      // These paths are accepted by the constructor but might fail during initialization
      // This is intentional to allow connection strings and various path formats
    });

    it('should reject excessively long paths', () => {
      const longPath = 'a'.repeat(300); // Exceeds Windows MAX_PATH (260)
      expect(() => new PGLiteStorageAdapter(longPath)).toThrow(DatabaseError);
      expect(() => new PGLiteStorageAdapter(longPath)).toThrow(/Database path exceeds maximum length/);
    });

    it('should properly check directory existence for Windows paths', async () => {
      mockFs.existsSync.mockReturnValue(false);
      
      const adapter = new PGLiteStorageAdapter('C:\\nonexistent\\path\\db.sqlite');
      
      try {
        // 1. 非同期メソッドを一度だけ呼び出す
        await adapter.init();
        
        // 2. ここに到達した場合、エラーがスローされなかったのでテストを失敗させる
        expect.fail('adapter.init() should have thrown a DatabaseError');

      } catch (error) {
        // 3. catchしたエラーオブジェクトに対して複数の検証を行う
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).message).toContain('Failed to initialize database');
      }
    });

    it('should provide helpful error messages for common mistakes', () => {
      // Test that error messages are helpful for users
      try {
        new PGLiteStorageAdapter('C:');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).message).toContain('Drive letter only is not a valid path');
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
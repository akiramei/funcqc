import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseError, PGLiteStorageAdapter } from '../src/storage/pglite-adapter';
import { ErrorCode } from '../src/utils/error-handler';
import * as fs from 'fs';

// Clear any existing mocks first to ensure clean test state
vi.unmock('@electric-sql/pglite');
vi.unmock('fs');
vi.clearAllMocks();

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
      transaction: vi.fn().mockImplementation(async (callback) => {
        // Mock transaction by calling the callback with a mock transaction object
        const mockTrx = {
          query: vi.fn().mockResolvedValue({ rows: [] }),
          exec: vi.fn().mockResolvedValue(undefined),
        };
        return await callback(mockTrx);
      }),
      path: path, // Store path but don't use it for filesystem operations
    };
  }),
}));

describe('Database Error Handling', () => {
  let mockFs: any;
  
  beforeEach(() => {
    mockFs = vi.mocked(fs);
    vi.clearAllMocks();
    
    // Verify imports work correctly in CI environment
    console.log('DatabaseError constructor:', DatabaseError.name);
    console.log('ErrorCode values:', Object.keys(ErrorCode));
  });

  describe('Path Validation', () => {
    it('should accept valid absolute paths', () => {
      // Unix-style absolute paths should be valid
      expect(() => new PGLiteStorageAdapter('/tmp/database.db')).not.toThrow();
      expect(() => new PGLiteStorageAdapter('/var/lib/funcqc/data.db')).not.toThrow();
    });

    it('should reject invalid root paths', () => {
      // Invalid root paths should be rejected to prevent filesystem pollution
      try {
        new PGLiteStorageAdapter('/');
        expect.fail('Expected DatabaseError to be thrown for root path "/"');
      } catch (error) {
        console.log('Error for "/" path:', error?.constructor?.name, error?.message);
        expect(error).toBeInstanceOf(DatabaseError);
        expect(error.message).toContain('Root directory is not a valid database path');
      }

      try {
        new PGLiteStorageAdapter('//');
        expect.fail('Expected DatabaseError to be thrown for root path "//"');
      } catch (error) {
        console.log('Error for "//" path:', error?.constructor?.name, error?.message);
        expect(error).toBeInstanceOf(DatabaseError);
        expect(error.message).toContain('Root directory is not a valid database path');
      }
    });

    it('should handle relative and absolute paths', () => {
      expect(() => new PGLiteStorageAdapter('/tmp/test/database.db')).not.toThrow();
      expect(() => new PGLiteStorageAdapter('./relative/path/db.db')).not.toThrow();
      expect(() => new PGLiteStorageAdapter('../parent/path/db.db')).not.toThrow();
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
      // Note: Special syntax like :memory: is NOT supported by PGLite (unlike SQLite)
      // PGLite treats it as a directory name which can cause filesystem issues
      // Skip this test in environments where colon is problematic
      if (process.platform !== 'win32' && !process.env.WSL_DISTRO_NAME) {
        expect(() => new PGLiteStorageAdapter(':memory:')).not.toThrow();
      }
      
      // The issue becomes apparent during init() when filesystem operations are attempted
      // (This is mocked in these tests to prevent actual filesystem pollution)
    });

    it('should reject invalid path formats', () => {
      // Empty or null paths
      try {
        new PGLiteStorageAdapter('');
        expect.fail('Expected DatabaseError to be thrown for empty path');
      } catch (error) {
        console.log('Error for empty path:', error?.constructor?.name, error?.message);
        expect(error).toBeInstanceOf(DatabaseError);
        expect(error.message).toContain('Database path must be a non-empty string');
      }

      try {
        new PGLiteStorageAdapter(null as any);
        expect.fail('Expected DatabaseError to be thrown for null path');
      } catch (error) {
        console.log('Error for null path:', error?.constructor?.name, error?.message);
        expect(error).toBeInstanceOf(DatabaseError);
        expect(error.message).toContain('Database path must be a non-empty string');
      }

      try {
        new PGLiteStorageAdapter(undefined as any);
        expect.fail('Expected DatabaseError to be thrown for undefined path');
      } catch (error) {
        console.log('Error for undefined path:', error?.constructor?.name, error?.message);
        expect(error).toBeInstanceOf(DatabaseError);
        expect(error.message).toContain('Database path must be a non-empty string');
      }

      // Note: Current implementation doesn't validate special characters
      // These paths are accepted by the constructor but might fail during initialization
      // This is intentional to allow connection strings and various path formats
    });

    it('should reject excessively long paths', () => {
      const longPath = 'a'.repeat(300); // Exceeds Windows MAX_PATH (260)
      try {
        new PGLiteStorageAdapter(longPath);
        expect.fail('Expected DatabaseError to be thrown for excessively long path');
      } catch (error) {
        console.log('Error for long path:', error?.constructor?.name, error?.message);
        expect(error).toBeInstanceOf(DatabaseError);
        expect(error.message).toContain('Database path exceeds maximum length');
      }
    });

    it('should properly check directory existence for nonexistent paths', async () => {
      mockFs.existsSync.mockReturnValue(false);
      
      const adapter = new PGLiteStorageAdapter('/tmp/nonexistent/path/db.db');
      
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
        new PGLiteStorageAdapter('/');
        expect.fail('Should have thrown an error');
      } catch (error) {
        console.log('Error for helpful messages test:', error?.constructor?.name, error?.message);
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).message).toContain('Root directory is not a valid database path');
        expect((error as DatabaseError).message).toContain('Use a specific directory like');
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
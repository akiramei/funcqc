import { describe, it, expect } from 'vitest';
import { DatabaseError } from '../src/storage/pglite-adapter';
import { ErrorCode } from '../src/utils/error-handler';

describe('Database Error Handling', () => {

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
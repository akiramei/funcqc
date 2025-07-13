import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { lineageDeleteCommand, lineageCleanCommand } from '../../src/cli/commands/lineage';
import { Logger } from '../../src/utils/cli-utils';
import { ConfigManager } from '../../src/core/config';
import { PGLiteStorageAdapter } from '../../src/storage/pglite-adapter';
import { Lineage } from '../../src/types';
import * as readline from 'readline';

// Mock dependencies
vi.mock('../../src/core/config');
vi.mock('../../src/storage/pglite-adapter');
vi.mock('../../src/utils/cli-utils');
vi.mock('readline');

describe('lineage delete command', () => {
  let mockStorage: any;
  let mockLogger: any;
  let mockReadline: any;
  let mockEnv: any;

  beforeEach(() => {
    mockStorage = {
      init: vi.fn(),
      close: vi.fn(),
      getLineage: vi.fn(),
      deleteLineage: vi.fn(),
      getLineages: vi.fn(),
    };

    mockLogger = {
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
    };

    mockReadline = {
      question: vi.fn(),
      close: vi.fn(),
    };

    mockEnv = {
      storage: mockStorage,
      commandLogger: mockLogger,
      config: {},
    };

    vi.mocked(ConfigManager).mockImplementation(() => ({
      load: vi.fn().mockResolvedValue({ storage: { path: '/test/path' } }),
    } as any));

    vi.mocked(PGLiteStorageAdapter).mockImplementation(() => mockStorage);
    vi.mocked(Logger).mockImplementation(() => mockLogger);
    vi.mocked(readline.createInterface).mockReturnValue(mockReadline);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('lineageDeleteCommand', () => {
    it('should error when lineage not found', async () => {
      mockStorage.getLineage.mockResolvedValue(null);
      const mockExit = vi.spyOn(process, 'exit').mockImplementation((code?: any) => {
        throw new Error(`Process exited with code ${code}`);
      });

      await expect(lineageDeleteCommand('test-id', {}, mockEnv)).rejects.toThrow('Process exited with code 1');
      
      expect(mockLogger.error).toHaveBeenCalledWith('Lineage not found: test-id');
      mockExit.mockRestore();
    });

    it('should delete draft lineage with confirmation', async () => {
      const mockLineage: Lineage = {
        id: 'test-id',
        fromIds: ['func1'],
        toIds: ['func2'],
        kind: 'rename',
        status: 'draft',
        confidence: 0.9,
        gitCommit: 'abc123',
        createdAt: new Date(),
      };

      mockStorage.getLineage.mockResolvedValue(mockLineage);
      mockStorage.deleteLineage.mockResolvedValue(true);
      mockReadline.question.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        callback('y');
      });

      await lineageDeleteCommand('test-id', {}, mockEnv);

      expect(mockStorage.deleteLineage).toHaveBeenCalledWith('test-id');
      expect(mockLogger.success).toHaveBeenCalledWith('Lineage test-id has been deleted.');
    });

    it('should show extra warning for approved lineage', async () => {
      const mockLineage: Lineage = {
        id: 'test-id',
        fromIds: ['func1'],
        toIds: ['func2'],
        kind: 'rename',
        status: 'approved',
        confidence: 0.9,
        gitCommit: 'abc123',
        createdAt: new Date(),
      };

      mockStorage.getLineage.mockResolvedValue(mockLineage);
      mockStorage.deleteLineage.mockResolvedValue(true);
      mockReadline.question.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        // Require 'yes' for approved lineages
        callback('yes');
      });

      await lineageDeleteCommand('test-id', {}, mockEnv);

      expect(mockReadline.question).toHaveBeenCalledWith(
        expect.stringContaining('Type "yes" to confirm'),
        expect.any(Function)
      );
    });

    it('should cancel deletion when not confirmed', async () => {
      const mockLineage: Lineage = {
        id: 'test-id',
        fromIds: ['func1'],
        toIds: ['func2'],
        kind: 'rename',
        status: 'draft',
        confidence: 0.9,
        gitCommit: 'abc123',
        createdAt: new Date(),
      };

      mockStorage.getLineage.mockResolvedValue(mockLineage);
      mockReadline.question.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        callback('n');
      });

      await lineageDeleteCommand('test-id', {}, mockEnv);

      expect(mockStorage.deleteLineage).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Deletion cancelled.');
    });
  });

  describe('lineageCleanCommand', () => {
    it('should delete draft lineages by default', async () => {
      const mockLineages: Lineage[] = [
        {
          id: 'draft1',
          fromIds: ['func1'],
          toIds: ['func2'],
          kind: 'rename',
          status: 'draft',
          confidence: 0.9,
          gitCommit: 'abc123',
          createdAt: new Date(),
        },
        {
          id: 'draft2',
          fromIds: ['func3'],
          toIds: ['func4'],
          kind: 'split',
          status: 'draft',
          confidence: 0.8,
          gitCommit: 'def456',
          createdAt: new Date(),
        },
      ];

      mockStorage.getLineages.mockResolvedValue(mockLineages);
      mockStorage.deleteLineage.mockResolvedValue(true);
      mockReadline.question.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        callback('y');
      });

      await lineageCleanCommand({}, mockEnv);

      expect(mockStorage.getLineages).toHaveBeenCalledWith({ status: 'draft' });
      expect(mockStorage.deleteLineage).toHaveBeenCalledTimes(2);
      expect(mockLogger.success).toHaveBeenCalledWith('Deleted 2 lineages.');
    });

    it('should support dry run mode', async () => {
      const mockLineages: Lineage[] = [
        {
          id: 'draft1',
          fromIds: ['func1'],
          toIds: ['func2'],
          kind: 'rename',
          status: 'draft',
          confidence: 0.9,
          gitCommit: 'abc123',
          createdAt: new Date(),
        },
      ];

      mockStorage.getLineages.mockResolvedValue(mockLineages);

      await lineageCleanCommand({ dryRun: true }, mockEnv);

      expect(mockStorage.deleteLineage).not.toHaveBeenCalled();
    });

    it('should filter by older-than days', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40);
      
      const mockLineages: Lineage[] = [
        {
          id: 'old',
          fromIds: ['func1'],
          toIds: ['func2'],
          kind: 'rename',
          status: 'draft',
          confidence: 0.9,
          gitCommit: 'abc123',
          createdAt: oldDate,
        },
        {
          id: 'recent',
          fromIds: ['func3'],
          toIds: ['func4'],
          kind: 'split',
          status: 'draft',
          confidence: 0.8,
          gitCommit: 'def456',
          createdAt: new Date(),
        },
      ];

      mockStorage.getLineages.mockResolvedValue(mockLineages);
      mockStorage.deleteLineage.mockResolvedValue(true);
      mockReadline.question.mockImplementation((prompt: string, callback: (answer: string) => void) => {
        callback('y');
      });

      await lineageCleanCommand({ olderThan: '30' }, mockEnv);

      expect(mockStorage.deleteLineage).toHaveBeenCalledTimes(1);
      expect(mockStorage.deleteLineage).toHaveBeenCalledWith('old');
    });

    it('should require force flag for approved lineages', async () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation((code?: any) => {
        throw new Error(`Process exited with code ${code}`);
      });

      await expect(lineageCleanCommand({ includeApproved: true }, mockEnv)).rejects.toThrow('Process exited with code 1');
      
      expect(mockLogger.error).toHaveBeenCalledWith('--include-approved requires --force flag for safety');
      mockExit.mockRestore();
    });

    it('should skip confirmation with --yes flag', async () => {
      const mockLineages: Lineage[] = [
        {
          id: 'draft1',
          fromIds: ['func1'],
          toIds: ['func2'],
          kind: 'rename',
          status: 'draft',
          confidence: 0.9,
          gitCommit: 'abc123',
          createdAt: new Date(),
        },
      ];

      mockStorage.getLineages.mockResolvedValue(mockLineages);
      mockStorage.deleteLineage.mockResolvedValue(true);

      await lineageCleanCommand({ yes: true }, mockEnv);

      expect(mockReadline.question).not.toHaveBeenCalled();
      expect(mockStorage.deleteLineage).toHaveBeenCalledWith('draft1');
    });
  });
});
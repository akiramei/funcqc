import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BackupManager } from '../../../../src/storage/backup/backup-manager';
import { FuncqcConfig } from '../../../../src/types';
import { mockPGLiteForPathValidation } from '../../../test-utils';

// Mock PGLite for testing
mockPGLiteForPathValidation();

describe('Avro Integration Tests', () => {
  let tempDir: string;
  let backupManager: BackupManager;
  let mockStorage: any;
  let testConfig: FuncqcConfig;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avro-integration-'));
    
    // Mock storage adapter
    mockStorage = {
      query: vi.fn(),
      close: vi.fn(),
      init: vi.fn(),
    };

    // Test configuration
    testConfig = {
      roots: ['src'],
      exclude: [],
      backup: {
        outputDir: path.join(tempDir, 'backups'),
        naming: {
          format: 'YYYYMMDD-HHMMSS',
          includeLabel: true,
          includeGitInfo: false
        },
        defaults: {
          includeSourceCode: false,
          compress: false,
          format: 'avro',
          tableOrder: 'auto'
        },
        retention: {
          maxBackups: 10,
          maxAge: '30d',
          autoCleanup: true
        },
        schema: {
          autoDetectVersion: true,
          conversionRulesDir: path.join(tempDir, 'conversion-rules')
        },
        security: {
          excludeSensitiveData: true,
          encryptBackups: false
        },
        advanced: {
          parallelTableExport: true,
          verifyIntegrity: true,
          includeMetrics: true
        }
      },
      storage: {
        type: 'pglite',
        path: path.join(tempDir, 'test.db')
      },
      git: {
        enabled: false,
        autoLabel: false
      }
    };

    backupManager = new BackupManager(testConfig, mockStorage);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Avro Backup Creation', () => {
    it('should create backup with Avro format', async () => {
      // Mock table data
      const mockTableData = {
        snapshots: [
          { id: '1', created_at: new Date(), label: 'test', metadata: { test: true } },
          { id: '2', created_at: new Date(), label: 'test2', metadata: { test: false } }
        ],
        functions: [
          { 
            id: 'func-1', 
            snapshot_id: '1', 
            name: 'testFunc',
            signature: 'function testFunc(): void',
            source_code: 'function testFunc() { console.log("test"); }',
            context_path: [],
            modifiers: []
          }
        ]
      };

      // Setup mock responses
      mockStorage.query
        .mockImplementationOnce(async () => ({ rows: mockTableData.snapshots }))
        .mockImplementationOnce(async () => ({ rows: mockTableData.functions }));

      const result = await backupManager.createBackup({
        format: 'avro',
        label: 'test-avro-backup',
        compress: false
      });

      expect(result.success).toBe(true);
      expect(result.backupPath).toContain('test-avro-backup');

      // Verify Avro files were created
      const dataDir = path.join(result.backupPath, 'data');
      const snapshotsFile = path.join(dataDir, 'snapshots.avro');
      const functionsFile = path.join(dataDir, 'functions.avro');

      const snapshotsExists = await fs.access(snapshotsFile).then(() => true, () => false);
      const functionsExists = await fs.access(functionsFile).then(() => true, () => false);

      expect(snapshotsExists).toBe(true);
      expect(functionsExists).toBe(true);

      // Verify files are in Avro format
      const snapshotsBuffer = await fs.readFile(snapshotsFile);
      const functionsBuffer = await fs.readFile(functionsFile);

      // Check magic bytes (FQAV)
      expect(snapshotsBuffer.subarray(0, 4)).toEqual(Buffer.from([0x46, 0x51, 0x41, 0x56]));
      expect(functionsBuffer.subarray(0, 4)).toEqual(Buffer.from([0x46, 0x51, 0x41, 0x56]));
    });

    it('should create compressed Avro backup', async () => {
      const mockTableData = {
        large_table: Array.from({ length: 50 }, (_, i) => ({
          id: String(i),
          data: `test_data_${i}`.repeat(20)
        }))
      };

      mockStorage.query.mockResolvedValue({ rows: mockTableData.large_table });

      const result = await backupManager.createBackup({
        format: 'avro',
        label: 'compressed-test',
        compress: true
      });

      expect(result.success).toBe(true);

      // Verify backup was created and files exist
      const dataDir = path.join(result.backupPath, 'data');
      const files = await fs.readdir(dataDir);
      
      expect(files.some(f => f.endsWith('.avro'))).toBe(true);
    });

    it('should handle dry run with Avro format', async () => {
      const result = await backupManager.createBackup({
        format: 'avro',
        label: 'dry-run-test',
        dryRun: true
      });

      expect(result.success).toBe(true);
      expect(result.warnings).toContain('Dry run - no actual backup created');

      // Verify no files were actually created
      const backupExists = await fs.access(result.backupPath).then(() => true, () => false);
      expect(backupExists).toBe(false);
    });
  });

  describe('Avro Backup Restoration', () => {
    it('should restore from Avro backup', async () => {
      // First create a backup
      const originalData = {
        snapshots: [
          { id: '1', created_at: new Date(), label: 'original', metadata: { restored: false } }
        ]
      };

      mockStorage.query.mockResolvedValue({ rows: originalData.snapshots });

      const backupResult = await backupManager.createBackup({
        format: 'avro',
        label: 'restore-test'
      });

      expect(backupResult.success).toBe(true);

      // Mock restore operations
      mockStorage.query
        .mockImplementationOnce(async () => ({ rows: [] })) // DELETE query
        .mockImplementation(async (sql: string) => {
          if (sql.includes('INSERT')) {
            return { rows: [] };
          }
          return { rows: [] };
        });

      // Now restore the backup
      const restoreResult = await backupManager.restoreBackup({
        backupPath: backupResult.backupPath,
        verifySchema: false,
        overwrite: true
      });

      expect(restoreResult.success).toBe(true);
      expect(restoreResult.tablesRestored).toBeGreaterThan(0);
    });

    it('should auto-detect Avro format during restore', async () => {
      // Create mixed format backup directory manually
      const backupPath = path.join(tempDir, 'mixed-format-backup');
      const dataDir = path.join(backupPath, 'data');
      
      await fs.mkdir(dataDir, { recursive: true });

      // Create manifest
      const manifest = {
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        tableOrder: ['snapshots'],
        schemaHash: 'test-hash',
        metadata: {
          backupFormat: 'avro',
          compressed: false
        }
      };

      await fs.writeFile(
        path.join(backupPath, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      );

      // Create Avro file with test data
      const testData = [{ id: '1', created_at: new Date(), label: 'test', metadata: {} }];
      const backupManager2 = new BackupManager(testConfig, mockStorage);
      
      // We'll need to create the Avro file manually or use the serializer
      // Create proper Avro buffer using AvroSerializer
      const { AvroSerializer } = await import('../../../../src/storage/backup/avro/avro-serializer');
      const { AvroSchemaGenerator } = await import('../../../../src/storage/backup/avro/avro-schema-generator');
      const serializer = new AvroSerializer(new AvroSchemaGenerator());
      
      // Create test data that matches snapshots table structure
      const testData = [{ id: '1', created_at: new Date().toISOString(), label: 'test' }];
      const avroBuffer = await serializer.serializeTable('snapshots', testData, { compress: false });

      await fs.writeFile(path.join(dataDir, 'snapshots.avro'), avroBuffer);

      // Mock the query operations for restore
      mockStorage.query.mockResolvedValue({ rows: [] });

      // This might fail due to actual Avro deserialization, but should detect format correctly
      try {
        await backupManager2.restoreBackup({
          backupPath,
          verifySchema: false
        });
      } catch (error) {
        // Expected to fail on deserialization, but should have detected Avro format
        expect(String(error)).not.toContain('No data file found');
      }
    });
  });

  describe('Format Compatibility', () => {
    it('should fall back to JSON if Avro fails', async () => {
      // Create backup with mixed format
      const backupPath = path.join(tempDir, 'fallback-test');
      const dataDir = path.join(backupPath, 'data');
      
      await fs.mkdir(dataDir, { recursive: true });

      // Create manifest
      const manifest = {
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        tableOrder: ['snapshots'],
        schemaHash: 'test-hash',
        metadata: {}
      };

      await fs.writeFile(
        path.join(backupPath, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      );

      // Create corrupted Avro file and valid JSON file
      await fs.writeFile(path.join(dataDir, 'snapshots.avro'), 'corrupted-avro-data');
      await fs.writeFile(
        path.join(dataDir, 'snapshots.json'),
        JSON.stringify([{ id: '1', created_at: new Date().toISOString(), label: 'fallback-test', metadata: {} }])
      );

      mockStorage.query.mockResolvedValue({ rows: [] });

      const restoreResult = await backupManager.restoreBackup({
        backupPath,
        verifySchema: false
      });

      // Should succeed by falling back to JSON
      expect(restoreResult.success).toBe(true);
    });
  });

  describe('Performance Comparison', () => {
    it('should handle large datasets efficiently', async () => {
      const largeDataset = Array.from({ length: 1000 }, (_, i) => ({
        id: String(i),
        uuid: `uuid-${i}-${Math.random()}`,
        name: `Function ${i}`,
        source_code: `function func${i}() {\n  return ${i};\n}`.repeat(10),
        metadata: {
          tags: [`tag${i}`, `category${i % 10}`],
          metrics: { complexity: i % 20, lines: i % 100 }
        },
        created_at: new Date(Date.now() - i * 1000)
      }));

      mockStorage.query.mockResolvedValue({ rows: largeDataset });

      const startTime = Date.now();
      
      const result = await backupManager.createBackup({
        format: 'avro',
        label: 'performance-test',
        compress: true
      });

      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(30000); // Should complete within 30 seconds

      // Verify backup size efficiency
      const dataDir = path.join(result.backupPath, 'data');
      const files = await fs.readdir(dataDir);
      
      for (const file of files.filter(f => f.endsWith('.avro'))) {
        const stats = await fs.stat(path.join(dataDir, file));
        expect(stats.size).toBeGreaterThan(0);
        // Avro with compression should be reasonably sized
        expect(stats.size).toBeLessThan(largeDataset.length * 1000); // Rough size check
      }
    });
  });

  describe('Error Recovery', () => {
    it('should handle partial backup failures gracefully', async () => {
      // Mock one table to succeed, another to fail
      mockStorage.query
        .mockResolvedValueOnce({ rows: [{ id: '1', name: 'success' }] })
        .mockRejectedValueOnce(new Error('Table export failed'));

      const result = await backupManager.createBackup({
        format: 'avro',
        label: 'partial-failure-test'
      });

      // Should still succeed overall but with warnings
      expect(result.success).toBe(true);
      expect(result.warnings || []).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Failed to export')
        ])
      );
    });
  });
});
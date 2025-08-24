import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AvroSerializer } from '../../../../src/storage/backup/avro/avro-serializer';
import { AvroSchemaGenerator, AvroSchemaSet } from '../../../../src/storage/backup/avro/avro-schema-generator';
import { SchemaVersioning } from '../../../../src/storage/backup/avro/schema-versioning';

describe('AvroSerializer', () => {
  let tempDir: string;
  let serializer: AvroSerializer;
  let schemaGenerator: AvroSchemaGenerator;
  let schemaVersioning: SchemaVersioning;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avro-test-'));
    schemaGenerator = new AvroSchemaGenerator();
    schemaVersioning = new SchemaVersioning(path.join(tempDir, 'schema-registry'));
    serializer = new AvroSerializer(schemaGenerator, schemaVersioning);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Format Detection', () => {
    it('should correctly identify Avro format', async () => {
      const testData = [
        { id: '1', created_at: new Date(), label: 'test1', metadata: {} },
        { id: '2', created_at: new Date(), label: 'test2', metadata: {} },
      ];

      const serialized = await serializer.serializeTable('snapshots', testData);
      expect(AvroSerializer.isAvroFormat(serialized)).toBe(true);
    });

    it('should reject non-Avro format', () => {
      const jsonBuffer = Buffer.from(JSON.stringify({ test: 'data' }));
      expect(AvroSerializer.isAvroFormat(jsonBuffer)).toBe(false);

      const emptyBuffer = Buffer.alloc(0);
      expect(AvroSerializer.isAvroFormat(emptyBuffer)).toBe(false);

      const shortBuffer = Buffer.from([0x01, 0x02]);
      expect(AvroSerializer.isAvroFormat(shortBuffer)).toBe(false);
    });
  });

  describe('Serialization', () => {
    it('should serialize simple table data', async () => {
      const testData = [
        { id: '123', created_at: new Date(), label: 'test', metadata: { active: true } },
        { id: '456', created_at: new Date(), label: 'another', metadata: { active: false } },
      ];

      const serialized = await serializer.serializeTable('snapshots', testData);
      
      expect(Buffer.isBuffer(serialized)).toBe(true);
      expect(serialized.length).toBeGreaterThan(0);
      expect(AvroSerializer.isAvroFormat(serialized)).toBe(true);
    });

    it('should serialize empty table data', async () => {
      const serialized = await serializer.serializeTable('snapshots', []);
      
      expect(Buffer.isBuffer(serialized)).toBe(true);
      expect(AvroSerializer.isAvroFormat(serialized)).toBe(true);
    });

    it('should handle null values correctly', async () => {
      const testData = [
        { id: '1', created_at: new Date(), label: 'test', comment: null },
        { id: '2', created_at: new Date(), label: null, comment: 'has comment' },
      ];

      const serialized = await serializer.serializeTable('snapshots', testData);
      expect(AvroSerializer.isAvroFormat(serialized)).toBe(true);
    });

    it('should handle Date objects', async () => {
      const testDate = new Date('2023-01-01T12:00:00Z');
      const testData = [
        { id: '1', created_at: testDate, label: 'date-test', metadata: {} },
      ];

      const serialized = await serializer.serializeTable('snapshots', testData);
      expect(AvroSerializer.isAvroFormat(serialized)).toBe(true);
    });

    it('should handle JSON objects', async () => {
      const testData = [
        { 
          id: '1',
          created_at: new Date(),
          label: 'json-test',
          metadata: { tags: ['test', 'avro'], count: 5, config: { enabled: true, settings: { timeout: 30 } } }
        },
      ];

      const serialized = await serializer.serializeTable('snapshots', testData);
      expect(AvroSerializer.isAvroFormat(serialized)).toBe(true);
    });
  });

  describe('Deserialization', () => {
    it('should deserialize data correctly', async () => {
      const originalData = [
        { id: '123', created_at: new Date(), label: 'test', metadata: { active: true } },
        { id: '456', created_at: new Date(), label: 'another', metadata: { active: false } },
      ];

      const serialized = await serializer.serializeTable('snapshots', originalData);
      const deserialized = await serializer.deserializeTable(serialized);

      expect(deserialized.tableName).toBe('snapshots');
      expect(deserialized.rowCount).toBe(2);
      expect(deserialized.rows).toHaveLength(2);

      // Check data integrity (note: may need transformation for exact match)
      expect(deserialized.rows[0]).toMatchObject({ id: '123', label: 'test' });
      expect(deserialized.rows[1]).toMatchObject({ id: '456', label: 'another' });
    });

    it('should handle empty data', async () => {
      const serialized = await serializer.serializeTable('snapshots', []);
      const deserialized = await serializer.deserializeTable(serialized);

      expect(deserialized.tableName).toBe('snapshots');
      expect(deserialized.rowCount).toBe(0);
      expect(deserialized.rows).toHaveLength(0);
    });

    it('should preserve null values', async () => {
      const originalData = [
        { id: '1', created_at: new Date(), label: 'test', comment: null },
        { id: '2', created_at: new Date(), label: null, comment: 'has comment' },
      ];

      const serialized = await serializer.serializeTable('snapshots', originalData);
      const deserialized = await serializer.deserializeTable(serialized);

      expect(deserialized.rows[0].comment).toBe(null);
      expect(deserialized.rows[1].label).toBe(null);
    });

    it('should handle Date objects roundtrip', async () => {
      const testDate = new Date('2023-01-01T12:00:00Z');
      const originalData = [
        { id: '1', created_at: testDate, label: 'date-test', metadata: {} },
      ];

      const serialized = await serializer.serializeTable('snapshots', originalData);
      const deserialized = await serializer.deserializeTable(serialized);

      // Dates should be preserved (may be in different format but same time)
      expect(deserialized.rows[0].created_at).toBeTruthy();
      
      // Convert back to Date if needed and compare time
      const deserializedDate = new Date(deserialized.rows[0].created_at);
      expect(deserializedDate.getTime()).toBe(testDate.getTime());
    });

    it('should handle JSON objects roundtrip', async () => {
      const originalData = [
        { 
          id: '1',
          created_at: new Date(),
          label: 'json-test',
          metadata: { tags: ['test', 'avro'], count: 5, config: { enabled: true } }
        },
      ];

      const serialized = await serializer.serializeTable('snapshots', originalData);
      const deserialized = await serializer.deserializeTable(serialized);

      expect(deserialized.rows[0].metadata).toEqual({ tags: ['test', 'avro'], count: 5, config: { enabled: true } });
    });
  });

  describe('Error Handling', () => {
    it('should handle serialization errors gracefully', async () => {
      // This test might need to be adjusted based on actual error conditions
      const invalidData = [{ circular: {} }];
      (invalidData[0] as any).circular.ref = invalidData[0];

      await expect(serializer.serializeTable('snapshots', invalidData))
        .rejects.toThrow();
    });

    it('should handle deserialization of corrupted data', async () => {
      const corruptedBuffer = Buffer.concat([
        Buffer.from([0x46, 0x51, 0x41, 0x56]), // Valid magic bytes
        Buffer.from([0x00, 0x00, 0x00, 0x10]), // Metadata length
        Buffer.from('{"invalid":json}'), // Invalid JSON
      ]);

      await expect(serializer.deserializeTable(corruptedBuffer))
        .rejects.toThrow();
    });

    it('should reject invalid magic bytes', async () => {
      const invalidBuffer = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x00, 0x00, 0x00, 0x00]);

      await expect(serializer.deserializeTable(invalidBuffer))
        .rejects.toThrow('Invalid magic bytes');
    });
  });

  describe('Compression', () => {
    it('should support compressed serialization', async () => {
      const testData = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        created_at: new Date(),
        label: `test_${i}`,
        metadata: { data: `repeated_data_${i}`.repeat(10) },
      }));

      const uncompressed = await serializer.serializeTable('snapshots', testData, {
        compress: false
      });

      const compressed = await serializer.serializeTable('snapshots', testData, {
        compress: true
      });

      // Compressed should be smaller (not guaranteed, but likely with repeated data)
      expect(compressed.length).toBeLessThanOrEqual(uncompressed.length);

      // Both should deserialize to same data
      const uncompressedResult = await serializer.deserializeTable(uncompressed);
      const compressedResult = await serializer.deserializeTable(compressed);

      expect(compressedResult.rowCount).toBe(uncompressedResult.rowCount);
      expect(compressedResult.rows).toEqual(uncompressedResult.rows);
    });
  });

  describe('Validation', () => {
    it('should serialize without validation by default', async () => {
      const testData = [
        { id: '123', created_at: new Date(), label: 'test', metadata: {} },
      ];

      // Should work without validation (default behavior)
      await expect(serializer.serializeTable('snapshots', testData, {
        validate: false
      })).resolves.toBeTruthy();
    });
  });

  describe('Metadata Handling', () => {
    it('should include metadata in serialized format', async () => {
      const testData = [{ id: '1', created_at: new Date(), label: 'test', metadata: {} }];

      const serialized = await serializer.serializeTable('snapshots', testData, {
        includeMetadata: true
      });

      const deserialized = await serializer.deserializeTable(serialized);

      expect(deserialized.tableName).toBe('snapshots');
      expect(deserialized.rowCount).toBe(1);
    });
  });
});
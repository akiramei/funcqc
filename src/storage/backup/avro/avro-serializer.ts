/**
 * Avro Serializer/Deserializer - Handle Avro encoding and decoding
 * 
 * This module provides efficient binary serialization and deserialization
 * of database table data using Avro format, with automatic schema resolution
 * and version compatibility handling.
 */

import { AvroSchemaGenerator } from './avro-schema-generator';
import { SchemaVersioning } from './schema-versioning';
import { Type as AvroType, Schema as AvroSchema } from 'avsc';

export interface SerializationOptions {
  compress?: boolean;
  validate?: boolean;
  includeMetadata?: boolean;
}

export interface DeserializationOptions {
  strict?: boolean;
  schemaRegistry?: SchemaVersioning;
}

export interface SerializedData {
  magic: Buffer; // Magic bytes to identify Avro format
  version: string;
  schemaHash: string;
  metadata: Record<string, unknown>;
  data: Buffer;
}

// Import avsc module dynamically
type AvscModule = typeof import('avsc');

export interface TableData {
  tableName: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  schema?: AvroSchema;
}

export class AvroSerializer {
  private schemaGenerator: AvroSchemaGenerator;
  private _schemaVersioning: SchemaVersioning; // Reserved for future schema evolution features
  private compiledSchemas: Map<string, AvroType> = new Map();
  private _avro: AvscModule | null = null;
  
  // Magic bytes to identify our Avro format: "FQAV" (FuncQC AVro)
  private static readonly MAGIC_BYTES = Buffer.from([0x46, 0x51, 0x41, 0x56]);
  private static readonly FORMAT_VERSION = '1.0.0';

  constructor(schemaGenerator?: AvroSchemaGenerator, _schemaVersioning?: SchemaVersioning) {
    this.schemaGenerator = schemaGenerator || new AvroSchemaGenerator();
    this._schemaVersioning = _schemaVersioning || new SchemaVersioning();
  }

  /**
   * Lazy load avsc library
   */
  private async getAvro(): Promise<AvscModule> {
    if (!this._avro) {
      this._avro = await import('avsc');
    }
    return this._avro;
  }

  /**
   * Get schema versioning system (reserved for future use)
   */
  get schemaVersioning(): SchemaVersioning {
    return this._schemaVersioning;
  }

  /**
   * Serialize table data to Avro binary format
   */
  async serializeTable(
    tableName: string, 
    rows: Record<string, unknown>[], 
    options: SerializationOptions = {}
  ): Promise<Buffer> {
    try {
      // Get or generate schema
      const schema = await this.getCompiledSchema(tableName);
      
      // Validate data if requested
      if (options.validate) {
        this.validateRows(rows, schema);
      }

      // Transform data for Avro compatibility
      const transformedRows = this.transformRowsForAvro(rows, tableName);
      
      // Serialize data
      const dataBuffer = await this.encodeRows(transformedRows, schema);
      
      // Create complete serialized format
      const serializedData: SerializedData = {
        magic: AvroSerializer.MAGIC_BYTES,
        version: AvroSerializer.FORMAT_VERSION,
        schemaHash: await this.getSchemaHash(tableName),
        metadata: {
          tableName,
          rowCount: rows.length,
          serializedAt: new Date().toISOString(),
          compressed: options.compress || false,
        },
        data: options.compress ? await this.compressBuffer(dataBuffer) : dataBuffer,
      };

      return this.packSerializedData(serializedData);

    } catch (error) {
      throw new Error(`Failed to serialize table ${tableName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Deserialize Avro binary format back to table data
   */
  async deserializeTable(
    buffer: Buffer, 
    options: DeserializationOptions = {}
  ): Promise<TableData> {
    try {
      // Validate magic bytes and unpack
      const serializedData = this.unpackSerializedData(buffer);
      
      // Validate version compatibility
      if (options.strict && serializedData.version !== AvroSerializer.FORMAT_VERSION) {
        throw new Error(`Version mismatch: expected ${AvroSerializer.FORMAT_VERSION}, got ${serializedData.version}`);
      }

      // Decompress if needed
      const dataBuffer = serializedData.metadata['compressed'] 
        ? await this.decompressBuffer(serializedData.data)
        : serializedData.data;

      // Get schema for deserialization
      const schema = await this.getCompiledSchemaByHash(
        serializedData.schemaHash, 
        String(serializedData.metadata['tableName'])
      );

      // Deserialize rows
      const rows = await this.decodeRows(dataBuffer, schema);
      
      // Transform back from Avro format
      const transformedRows = this.transformRowsFromAvro(rows, String(serializedData.metadata['tableName']));

      return {
        tableName: String(serializedData.metadata['tableName']),
        rows: transformedRows,
        rowCount: transformedRows.length,
        schema: (schema as any).schema,
      };

    } catch (error) {
      throw new Error(`Failed to deserialize table data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if buffer contains Avro-serialized data
   */
  static isAvroFormat(buffer: Buffer): boolean {
    return buffer.length >= 4 && 
           buffer.subarray(0, 4).equals(AvroSerializer.MAGIC_BYTES);
  }

  /**
   * Get compiled Avro schema for table
   */
  private async getCompiledSchema(tableName: string): Promise<AvroType> {
    if (this.compiledSchemas.has(tableName)) {
      return this.compiledSchemas.get(tableName)!;
    }

    const schemaSet = await this.schemaGenerator.generateSchemas();
    const tableSchema = schemaSet.schemas[tableName];
    
    if (!tableSchema) {
      throw new Error(`Schema not found for table: ${tableName}`);
    }

    const avro = await this.getAvro();
    const compiledSchema = avro.Type.forSchema(tableSchema);
    this.compiledSchemas.set(tableName, compiledSchema);
    
    return compiledSchema;
  }

  /**
   * Get schema hash for versioning
   */
  private async getSchemaHash(tableName: string): Promise<string> {
    const schemaSet = await this.schemaGenerator.generateSchemas();
    return schemaSet.metadata.sourceSchemaHash + ':' + tableName;
  }

  /**
   * Get compiled schema by hash (for deserialization)
   */
  private async getCompiledSchemaByHash(_hash: string, tableName: string): Promise<AvroType> {
    // For now, use current schema - in future, implement schema evolution
    return this.getCompiledSchema(tableName);
  }

  /**
   * Transform database rows to Avro-compatible format
   */
  private transformRowsForAvro(rows: Record<string, unknown>[], tableName: string): Record<string, unknown>[] {
    return rows.map(row => this.transformRowForAvro(row, tableName));
  }

  /**
   * Transform single row to Avro format
   */
  private transformRowForAvro(row: Record<string, unknown>, _tableName: string): Record<string, unknown> {
    const transformed: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(row)) {
      if (value === null || value === undefined) {
        transformed[key] = null;
      } else if (value instanceof Date) {
        // Convert to timestamp-micros (microseconds since epoch)
        transformed[key] = value.getTime() * 1000;
      } else if (typeof value === 'object' && !Buffer.isBuffer(value)) {
        // Convert objects to JSON strings for JSONB fields
        transformed[key] = JSON.stringify(value);
      } else if (typeof value === 'boolean') {
        transformed[key] = value;
      } else if (typeof value === 'number') {
        transformed[key] = value;
      } else {
        // Convert everything else to string
        transformed[key] = String(value);
      }
    }
    
    return transformed;
  }

  /**
   * Transform rows back from Avro format
   */
  private transformRowsFromAvro(rows: Record<string, unknown>[], tableName: string): Record<string, unknown>[] {
    return rows.map(row => this.transformRowFromAvro(row, tableName));
  }

  /**
   * Transform single row back from Avro format
   */
  private transformRowFromAvro(row: Record<string, unknown>, tableName: string): Record<string, unknown> {
    const transformed: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(row)) {
      if (value === null) {
        transformed[key] = null;
      } else if (key.includes('_at') && typeof value === 'number') {
        // Convert timestamp-micros back to Date
        transformed[key] = new Date(value / 1000);
      } else if (this.isJsonField(key, tableName) && typeof value === 'string') {
        // Parse JSON strings back to objects for JSONB fields
        try {
          transformed[key] = JSON.parse(value);
        } catch {
          transformed[key] = value;
        }
      } else {
        transformed[key] = value;
      }
    }
    
    return transformed;
  }

  /**
   * Check if field should be treated as JSON
   */
  private isJsonField(fieldName: string, _tableName: string): boolean {
    // Known JSONB fields from schema
    const jsonFields = ['metadata', 'context_path', 'modifiers', 'parameters', 'tags'];
    return jsonFields.includes(fieldName);
  }

  /**
   * Encode rows using Avro schema
   */
  private async encodeRows(rows: Record<string, unknown>[], schema: AvroType): Promise<Buffer> {
    try {
      // Create array schema
      const avro = await this.getAvro();
      const arraySchema = avro.Type.forSchema({
        type: 'array',
        items: (schema as any).schema
      });
      
      // Encode all rows as a single array
      return arraySchema.toBuffer(rows);
    } catch (error) {
      console.warn(`Warning: Failed to encode rows as array, falling back to individual encoding:`, error);
      
      // Fallback: encode individual rows with length prefixes
      const buffers: Buffer[] = [];
      
      for (const row of rows) {
        try {
          const encoded = schema.toBuffer(row);
          const lengthPrefix = Buffer.alloc(4);
          lengthPrefix.writeUInt32BE(encoded.length, 0);
          buffers.push(lengthPrefix, encoded);
        } catch (error) {
          console.warn(`Warning: Failed to encode row, skipping:`, error);
        }
      }
      
      return Buffer.concat(buffers);
    }
  }

  /**
   * Decode rows using Avro schema
   */
  private async decodeRows(buffer: Buffer, schema: AvroType): Promise<Record<string, unknown>[]> {
    try {
      // Try to decode as array first
      const avro = await this.getAvro();
      const arraySchema = avro.Type.forSchema({
        type: 'array',
        items: (schema as any).schema
      });
      
      const result = arraySchema.fromBuffer(buffer);
      if (result && Array.isArray(result)) {
        return result;
      }
    } catch (error) {
      console.warn(`Warning: Failed to decode as array, falling back to individual decoding:`, error);
    }
    
    // Fallback: decode individual rows with length prefixes
    const rows: Record<string, unknown>[] = [];
    let offset = 0;
    
    while (offset < buffer.length) {
      try {
        // Check if we have a length prefix (fallback format)
        if (offset + 4 <= buffer.length) {
          const recordLength = buffer.readUInt32BE(offset);
          if (offset + 4 + recordLength <= buffer.length) {
            // This looks like a length-prefixed record
            const recordBuffer = buffer.subarray(offset + 4, offset + 4 + recordLength);
            const decoded = schema.fromBuffer(recordBuffer);
            rows.push(decoded);
            offset += 4 + recordLength;
            continue;
          }
        }
        
        // Try to decode without length prefix
        const result = schema.fromBuffer(buffer.subarray(offset), undefined, true);
        
        // Check if result is valid
        if (!result || typeof result !== 'object') {
          console.warn(`Warning: Invalid decode result at offset ${offset}:`, result);
          break;
        }
        
        rows.push(result.value);
        offset += result.offset || 0;
        
        if (!result.offset || result.offset === 0) {
          break; // Prevent infinite loop
        }
      } catch (error) {
        console.warn(`Warning: Failed to decode row at offset ${offset}:`, error);
        break;
      }
    }
    
    return rows;
  }

  /**
   * Validate rows against schema
   */
  private validateRows(rows: Record<string, unknown>[], schema: AvroType): void {
    for (const [index, row] of rows.entries()) {
      if (!schema.isValid(row)) {
        throw new Error(`Row ${index} does not match schema`);
      }
    }
  }

  /**
   * Pack serialized data with metadata
   */
  private packSerializedData(data: SerializedData): Buffer {
    const metadataJson = JSON.stringify({
      version: data.version,
      schemaHash: data.schemaHash,
      metadata: data.metadata,
    });
    
    const metadataBuffer = Buffer.from(metadataJson, 'utf-8');
    const metadataLength = Buffer.alloc(4);
    metadataLength.writeUInt32BE(metadataBuffer.length, 0);
    
    return Buffer.concat([
      data.magic,           // 4 bytes
      metadataLength,       // 4 bytes
      metadataBuffer,       // Variable length
      data.data,           // Variable length
    ]);
  }

  /**
   * Unpack serialized data and extract metadata
   */
  private unpackSerializedData(buffer: Buffer): SerializedData {
    if (buffer.length < 8) {
      throw new Error('Buffer too small to contain valid Avro data');
    }

    // Check magic bytes
    const magic = buffer.subarray(0, 4);
    if (!magic.equals(AvroSerializer.MAGIC_BYTES)) {
      throw new Error('Invalid magic bytes: not Avro format');
    }

    // Read metadata length
    const metadataLength = buffer.readUInt32BE(4);
    if (buffer.length < 8 + metadataLength) {
      throw new Error('Buffer too small to contain metadata');
    }

    // Read metadata
    const metadataBuffer = buffer.subarray(8, 8 + metadataLength);
    const metadata = JSON.parse(metadataBuffer.toString('utf-8'));

    // Read data
    const data = buffer.subarray(8 + metadataLength);

    return {
      magic,
      version: metadata.version,
      schemaHash: metadata.schemaHash,
      metadata: metadata.metadata,
      data,
    };
  }

  /**
   * Compress buffer using zlib
   */
  private async compressBuffer(buffer: Buffer): Promise<Buffer> {
    const zlib = await import('zlib');
    return new Promise((resolve, reject) => {
      zlib.gzip(buffer, (err, compressed) => {
        if (err) reject(err);
        else resolve(compressed);
      });
    });
  }

  /**
   * Decompress buffer using zlib
   */
  private async decompressBuffer(buffer: Buffer): Promise<Buffer> {
    const zlib = await import('zlib');
    return new Promise((resolve, reject) => {
      zlib.gunzip(buffer, (err, decompressed) => {
        if (err) reject(err);
        else resolve(decompressed);
      });
    });
  }
}
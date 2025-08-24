/**
 * Avro Schema Generator - Convert database.sql to Avro schemas
 * 
 * This module analyzes the PostgreSQL schema definition and generates
 * corresponding Avro schemas for all tables, ensuring type compatibility
 * and proper field mapping.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Schema as AvroSchema } from 'avsc';

export interface AvroSchemaSet {
  schemas: Record<string, AvroSchema>;
  metadata: {
    version: string;
    generatedAt: string;
    sourceSchemaHash: string;
    tableOrder: string[];
  };
}

export interface TableSchema {
  name: string;
  columns: ColumnDefinition[];
  indexes: IndexDefinition[];
  constraints: ConstraintDefinition[];
}

interface ColumnDefinition {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string | undefined;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  references?: string;
}

interface IndexDefinition {
  name: string;
  columns: string[];
  unique: boolean;
}

interface ConstraintDefinition {
  name: string;
  type: 'PRIMARY KEY' | 'FOREIGN KEY' | 'UNIQUE' | 'CHECK';
  columns: string[];
  references?: string;
}

export class AvroSchemaGenerator {
  private schemaPath: string;

  constructor(schemaPath?: string) {
    this.schemaPath = schemaPath || path.join(process.cwd(), 'src/schemas/database.sql');
  }

  /**
   * Generate complete Avro schema set from database.sql
   */
  async generateSchemas(): Promise<AvroSchemaSet> {
    const sqlContent = await this.loadDatabaseSchema();
    const tables = this.parseTables(sqlContent);
    
    const schemas: Record<string, AvroSchema> = {};
    const tableOrder: string[] = [];
    
    // Generate schemas in dependency order
    const sortedTables = this.sortTablesByDependencies(tables);
    
    for (const table of sortedTables) {
      const avroSchema = this.generateTableSchema(table);
      schemas[table.name] = avroSchema;
      tableOrder.push(table.name);
    }

    return {
      schemas,
      metadata: {
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        sourceSchemaHash: await this.calculateSchemaHash(sqlContent),
        tableOrder,
      },
    };
  }

  /**
   * Generate Avro schema for a single table
   */
  private generateTableSchema(table: TableSchema): AvroSchema {
    const fields = table.columns.map(column => this.convertColumnToAvroField(column));
    
    return {
      type: 'record',
      name: this.toPascalCase(table.name),
      namespace: 'com.funcqc.backup',
      fields: fields as any, // Cast to any due to complex avsc field type
      doc: `Avro schema for ${table.name} table`,
    } as AvroSchema;
  }

  /**
   * Convert PostgreSQL column to Avro field
   */
  private convertColumnToAvroField(column: ColumnDefinition): Record<string, unknown> {
    const baseType = this.mapPostgreSQLTypeToAvro(column.type);
    const fieldType = column.nullable ? ['null', baseType] : baseType;
    
    const field: Record<string, unknown> = {
      name: column.name,
      type: fieldType,
      doc: `${column.type} field${column.nullable ? ' (nullable)' : ''}`,
    };

    // Add default value if present
    if (column.defaultValue !== undefined) {
      const defaultValue = this.convertDefaultValue(column.defaultValue, baseType);
      // For nullable fields, if the default is not null, we need to handle union defaults carefully
      if (column.nullable && defaultValue !== null) {
        // For Avro union types, defaults must match the first branch's type
        // Since our nullable fields are ["null", <type>], default must be null
        field['default'] = null;
      } else {
        field['default'] = defaultValue;
      }
    } else if (column.nullable) {
      field['default'] = null;
    }

    return field;
  }

  /**
   * Map PostgreSQL types to Avro types
   */
  private mapPostgreSQLTypeToAvro(pgType: string): string | object {
    const cleanType = pgType.toLowerCase().split('(')[0].trim();
    
    switch (cleanType) {
      case 'text':
      case 'varchar':
      case 'char':
      case 'uuid':
        return 'string';
        
      case 'integer':
      case 'int':
      case 'int4':
      case 'serial':
        return 'int';
        
      case 'bigint':
      case 'int8':
      case 'bigserial':
        return 'long';
        
      case 'boolean':
      case 'bool':
        return 'boolean';
        
      case 'real':
      case 'float4':
        return 'float';
        
      case 'double precision':
      case 'float8':
        return 'double';
        
      case 'timestamptz':
      case 'timestamp':
        return { type: 'long', logicalType: 'timestamp-micros' };
        
      case 'jsonb':
      case 'json':
        return 'string'; // Store as JSON string, deserialize on demand
        
      case 'numeric':
      case 'decimal':
        return { type: 'bytes', logicalType: 'decimal', precision: 38, scale: 10 };
        
      default:
        console.warn(`Unknown PostgreSQL type: ${pgType}, defaulting to string`);
        return 'string';
    }
  }

  /**
   * Convert PostgreSQL default value to Avro-compatible value
   */
  private convertDefaultValue(defaultVal: string, _avroType: string | object): unknown {
    if (defaultVal === 'NULL' || defaultVal === 'null') {
      return null;
    }
    
    const normalized = defaultVal.toLowerCase().trim();
    
    // Handle common PostgreSQL functions
    if (normalized === 'current_timestamp' || normalized.startsWith('now()')) {
      return Date.now() * 1000; // Avro timestamp-micros
    }
    
    if (normalized === 'false') return false;
    if (normalized === 'true') return true;
    
    // Remove quotes for string values
    if (defaultVal.startsWith("'") && defaultVal.endsWith("'")) {
      return defaultVal.slice(1, -1);
    }
    
    // Try to parse as number
    const numVal = Number(defaultVal);
    if (!isNaN(numVal)) {
      return numVal;
    }
    
    return defaultVal;
  }

  /**
   * Parse SQL content to extract table definitions
   */
  private parseTables(sqlContent: string): TableSchema[] {
    const tables: TableSchema[] = [];
    const tableMatches = sqlContent.match(/CREATE TABLE\s+(\w+)\s*\(([\s\S]*?)\);/gi);
    
    if (!tableMatches) {
      throw new Error('No CREATE TABLE statements found in schema');
    }

    for (const tableMatch of tableMatches) {
      const table = this.parseTableDefinition(tableMatch);
      if (table) {
        tables.push(table);
      }
    }

    return tables;
  }

  /**
   * Parse individual CREATE TABLE statement
   */
  private parseTableDefinition(tableSQL: string): TableSchema | null {
    const nameMatch = tableSQL.match(/CREATE TABLE\s+(\w+)/i);
    if (!nameMatch) return null;
    
    const tableName = nameMatch[1];
    const columnsMatch = tableSQL.match(/CREATE TABLE\s+\w+\s*\(([\s\S]*)\);/i);
    if (!columnsMatch) return null;
    
    const columnsSection = columnsMatch[1];
    const columns = this.parseColumns(columnsSection);
    
    return {
      name: tableName,
      columns,
      indexes: [], // Parsed separately if needed
      constraints: [], // Parsed separately if needed
    };
  }

  /**
   * Parse column definitions from table SQL
   */
  private parseColumns(columnsSection: string): ColumnDefinition[] {
    const columns: ColumnDefinition[] = [];
    const lines = columnsSection.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('--') && !line.match(/^(FOREIGN KEY|PRIMARY KEY|UNIQUE|CHECK|CONSTRAINT)/i));

    for (const line of lines) {
      const column = this.parseColumn(line);
      if (column) {
        columns.push(column);
      }
    }

    return columns;
  }

  /**
   * Parse individual column definition
   */
  private parseColumn(line: string): ColumnDefinition | null {
    // Remove trailing comma and comments
    const cleanLine = line.replace(/,?\s*--.*$/, '').replace(/,$/, '').trim();
    if (!cleanLine || cleanLine.match(/^(FOREIGN KEY|UNIQUE|CHECK)/i)) {
      return null;
    }

    const parts = cleanLine.split(/\s+/);
    if (parts.length < 2) return null;

    const name = parts[0];
    const type = parts[1];
    
    const nullable = !cleanLine.includes('NOT NULL');
    const isPrimaryKey = cleanLine.includes('PRIMARY KEY');
    const isForeignKey = cleanLine.includes('REFERENCES');
    
    // Extract default value
    let defaultValue: string | undefined;
    const defaultMatch = cleanLine.match(/DEFAULT\s+([^,\s]+(?:\([^)]*\))?)/i);
    if (defaultMatch) {
      defaultValue = defaultMatch[1];
    }

    return {
      name,
      type,
      nullable,
      defaultValue,
      isPrimaryKey,
      isForeignKey,
    };
  }

  /**
   * Sort tables by dependency order (referenced tables first)
   */
  private sortTablesByDependencies(tables: TableSchema[]): TableSchema[] {
    // Simple topological sort - for now, return as-is
    // This could be enhanced to properly handle foreign key dependencies
    return tables;
  }

  /**
   * Load database schema from file
   */
  private async loadDatabaseSchema(): Promise<string> {
    try {
      return await fs.readFile(this.schemaPath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to load database schema from ${this.schemaPath}: ${error}`);
    }
  }

  /**
   * Calculate hash of schema content for versioning
   */
  private async calculateSchemaHash(content: string): Promise<string> {
    const crypto = await import('crypto');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Convert snake_case to PascalCase for Avro record names
   */
  private toPascalCase(str: string): string {
    return str
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }
}
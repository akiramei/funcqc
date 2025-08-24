/**
 * Schema Versioning - Handle Avro schema evolution and compatibility
 * 
 * This module manages schema versioning, evolution rules, and compatibility
 * checking to ensure data can be migrated between different schema versions.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { Schema as AvroSchema } from 'avsc';
import { AvroSchemaSet } from './avro-schema-generator';

export interface SchemaVersion {
  hash: string;
  version: string;
  schemas: Record<string, AvroSchema>;
  createdAt: string;
  description?: string | undefined;
  migrationRules?: MigrationRule[];
}

export interface MigrationRule {
  fromVersion: string;
  toVersion: string;
  tableName: string;
  transformations: FieldTransformation[];
}

export interface FieldTransformation {
  type: 'rename' | 'convert' | 'add' | 'remove' | 'split' | 'merge';
  sourceFields: string[];
  targetField: string;
  converter?: string; // JavaScript function as string
  defaultValue?: unknown;
}

export interface CompatibilityResult {
  compatible: boolean;
  issues: CompatibilityIssue[];
  migrationRequired: boolean;
  migrationPath?: string[];
}

export interface CompatibilityIssue {
  severity: 'error' | 'warning' | 'info';
  table: string;
  field: string;
  message: string;
  suggestedAction?: string;
}

export class SchemaVersioning {
  private schemaRegistryPath: string;
  private versionCache: Map<string, SchemaVersion> = new Map();

  constructor(registryPath?: string) {
    this.schemaRegistryPath = registryPath || 
      path.join(process.cwd(), '.funcqc/schema-registry');
  }

  /**
   * Register a new schema version
   */
  async registerSchema(schemaSet: AvroSchemaSet, description?: string): Promise<SchemaVersion> {
    const hash = await this.calculateSchemaSetHash(schemaSet);
    
    // Check if this version already exists
    if (await this.hasVersion(hash)) {
      return await this.getVersion(hash);
    }

    const version: SchemaVersion = {
      hash,
      version: this.generateVersionNumber(),
      schemas: schemaSet.schemas,
      createdAt: new Date().toISOString(),
      description,
    };

    await this.saveVersion(version);
    this.versionCache.set(hash, version);

    return version;
  }

  /**
   * Get schema version by hash
   */
  async getVersion(hash: string): Promise<SchemaVersion> {
    if (this.versionCache.has(hash)) {
      return this.versionCache.get(hash)!;
    }

    const versionPath = path.join(this.schemaRegistryPath, `${hash}.json`);
    
    try {
      const content = await fs.readFile(versionPath, 'utf-8');
      const version: SchemaVersion = JSON.parse(content);
      this.versionCache.set(hash, version);
      return version;
    } catch {
      throw new Error(`Schema version ${hash} not found in registry`);
    }
  }

  /**
   * Check if schema version exists
   */
  async hasVersion(hash: string): Promise<boolean> {
    if (this.versionCache.has(hash)) {
      return true;
    }

    const versionPath = path.join(this.schemaRegistryPath, `${hash}.json`);
    
    try {
      await fs.access(versionPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check compatibility between two schema versions
   */
  async checkCompatibility(
    fromHash: string, 
    toHash: string
  ): Promise<CompatibilityResult> {
    if (fromHash === toHash) {
      return {
        compatible: true,
        issues: [],
        migrationRequired: false,
      };
    }

    const fromVersion = await this.getVersion(fromHash);
    const toVersion = await this.getVersion(toHash);

    return this.analyzeCompatibility(fromVersion, toVersion);
  }

  /**
   * Get all available schema versions
   */
  async getAllVersions(): Promise<SchemaVersion[]> {
    await this.ensureRegistryExists();
    
    try {
      const files = await fs.readdir(this.schemaRegistryPath);
      const versions: SchemaVersion[] = [];
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const hash = file.replace('.json', '');
          try {
            const version = await this.getVersion(hash);
            versions.push(version);
          } catch {
            // Skip invalid version files
          }
        }
      }
      
      return versions.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } catch {
      return [];
    }
  }

  /**
   * Clean up old schema versions
   */
  async cleanupOldVersions(keepCount: number = 10): Promise<number> {
    const versions = await this.getAllVersions();
    
    if (versions.length <= keepCount) {
      return 0;
    }

    const toDelete = versions.slice(keepCount);
    let deletedCount = 0;

    for (const version of toDelete) {
      try {
        const versionPath = path.join(this.schemaRegistryPath, `${version.hash}.json`);
        await fs.unlink(versionPath);
        this.versionCache.delete(version.hash);
        deletedCount++;
      } catch {
        // Ignore deletion errors
      }
    }

    return deletedCount;
  }

  /**
   * Add migration rule between schema versions
   */
  async addMigrationRule(rule: MigrationRule): Promise<void> {
    const fromVersion = await this.getVersion(rule.fromVersion);
    
    if (!fromVersion.migrationRules) {
      fromVersion.migrationRules = [];
    }
    
    // Remove existing rule for same target
    fromVersion.migrationRules = fromVersion.migrationRules.filter(
      r => !(r.toVersion === rule.toVersion && r.tableName === rule.tableName)
    );
    
    fromVersion.migrationRules.push(rule);
    await this.saveVersion(fromVersion);
    this.versionCache.set(fromVersion.hash, fromVersion);
  }

  /**
   * Find migration path between versions
   */
  async findMigrationPath(fromHash: string, toHash: string): Promise<string[]> {
    if (fromHash === toHash) {
      return [];
    }

    // Simple direct migration check for now
    // In future, implement proper graph traversal for multi-step migrations
    const fromVersion = await this.getVersion(fromHash);
    
    if (fromVersion.migrationRules?.some(r => r.toVersion === toHash)) {
      return [fromHash, toHash];
    }

    throw new Error(`No migration path found from ${fromHash} to ${toHash}`);
  }

  /**
   * Calculate hash of schema set for versioning
   */
  private async calculateSchemaSetHash(schemaSet: AvroSchemaSet): Promise<string> {
    const canonical = this.canonicalizeSchemaSet(schemaSet);
    const content = JSON.stringify(canonical);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Canonicalize schema set for consistent hashing
   */
  private canonicalizeSchemaSet(schemaSet: AvroSchemaSet): Record<string, unknown> {
    const sortedSchemas: Record<string, unknown> = {};
    
    // Sort schemas by name for consistent ordering
    const sortedKeys = Object.keys(schemaSet.schemas).sort();
    for (const key of sortedKeys) {
      sortedSchemas[key] = this.canonicalizeSchema(schemaSet.schemas[key]);
    }

    return {
      schemas: sortedSchemas,
      tableOrder: [...schemaSet.metadata.tableOrder].sort(),
    };
  }

  /**
   * Canonicalize single schema for hashing
   */
  private canonicalizeSchema(schema: AvroSchema): AvroSchema {
    if (typeof schema === 'object' && schema !== null && 'fields' in schema) {
      const canonicalized = { ...schema };
      
      // Sort fields by name
      if (Array.isArray(canonicalized.fields)) {
        canonicalized.fields = [...canonicalized.fields].sort((a, b) => {
          const nameA = typeof a === 'object' && a !== null && 'name' in a ? String(a.name) : '';
          const nameB = typeof b === 'object' && b !== null && 'name' in b ? String(b.name) : '';
          return nameA.localeCompare(nameB);
        });
      }
      
      return canonicalized;
    }
    
    return schema;
  }

  /**
   * Generate version number based on timestamp
   */
  private generateVersionNumber(): string {
    const now = new Date();
    return `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}.${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  }

  /**
   * Save schema version to registry
   */
  private async saveVersion(version: SchemaVersion): Promise<void> {
    await this.ensureRegistryExists();
    
    const versionPath = path.join(this.schemaRegistryPath, `${version.hash}.json`);
    const content = JSON.stringify(version, null, 2);
    
    await fs.writeFile(versionPath, content, 'utf-8');
  }

  /**
   * Ensure schema registry directory exists
   */
  private async ensureRegistryExists(): Promise<void> {
    try {
      await fs.mkdir(this.schemaRegistryPath, { recursive: true });
    } catch {
      // Directory might already exist
    }
  }

  /**
   * Analyze compatibility between two schema versions
   */
  private analyzeCompatibility(
    fromVersion: SchemaVersion, 
    toVersion: SchemaVersion
  ): CompatibilityResult {
    const issues: CompatibilityIssue[] = [];
    let compatible = true;
    let migrationRequired = false;

    // Check each table for compatibility
    for (const tableName of Object.keys(fromVersion.schemas)) {
      const fromSchema = fromVersion.schemas[tableName];
      const toSchema = toVersion.schemas[tableName];

      if (!toSchema) {
        issues.push({
          severity: 'error',
          table: tableName,
          field: '*',
          message: `Table ${tableName} was removed`,
          suggestedAction: 'Create migration rule to handle table removal',
        });
        compatible = false;
        migrationRequired = true;
        continue;
      }

      const tableIssues = this.compareSchemas(tableName, fromSchema, toSchema);
      issues.push(...tableIssues);

      if (tableIssues.some(issue => issue.severity === 'error')) {
        compatible = false;
        migrationRequired = true;
      }
    }

    // Check for new tables
    for (const tableName of Object.keys(toVersion.schemas)) {
      if (!fromVersion.schemas[tableName]) {
        issues.push({
          severity: 'info',
          table: tableName,
          field: '*',
          message: `New table ${tableName} added`,
          suggestedAction: 'No action needed for new tables',
        });
      }
    }

    return {
      compatible,
      issues,
      migrationRequired,
    };
  }

  /**
   * Compare two Avro schemas for compatibility
   */
  private compareSchemas(tableName: string, fromSchema: AvroSchema, toSchema: AvroSchema): CompatibilityIssue[] {
    const issues: CompatibilityIssue[] = [];

    // Simple field-level comparison for now
    // In a full implementation, this would handle complex Avro schema evolution rules
    
    if (typeof fromSchema === 'object' && fromSchema !== null && 'fields' in fromSchema &&
        typeof toSchema === 'object' && toSchema !== null && 'fields' in toSchema) {
      
      const fromFields = Array.isArray(fromSchema.fields) ? fromSchema.fields : [];
      const toFields = Array.isArray(toSchema.fields) ? toSchema.fields : [];
      
      // Check for removed fields
      for (const fromField of fromFields) {
        if (typeof fromField === 'object' && fromField !== null && 'name' in fromField) {
          const fieldName = String(fromField.name);
          const toField = toFields.find(f => 
            typeof f === 'object' && f !== null && 'name' in f && String(f.name) === fieldName
          );
          
          if (!toField) {
            issues.push({
              severity: 'error',
              table: tableName,
              field: fieldName,
              message: `Field ${fieldName} was removed`,
              suggestedAction: 'Add migration rule to handle field removal',
            });
          }
        }
      }
      
      // Check for type changes
      for (const toField of toFields) {
        if (typeof toField === 'object' && toField !== null && 'name' in toField && 'type' in toField) {
          const fieldName = String(toField.name);
          const fromField = fromFields.find(f => 
            typeof f === 'object' && f !== null && 'name' in f && String(f.name) === fieldName
          );
          
          if (fromField && typeof fromField === 'object' && fromField !== null && 'type' in fromField) {
            if (JSON.stringify(fromField.type) !== JSON.stringify(toField.type)) {
              issues.push({
                severity: 'warning',
                table: tableName,
                field: fieldName,
                message: `Field ${fieldName} type changed from ${JSON.stringify(fromField.type)} to ${JSON.stringify(toField.type)}`,
                suggestedAction: 'Verify type compatibility or add conversion rule',
              });
            }
          }
        }
      }
    }

    return issues;
  }
}
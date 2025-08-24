/**
 * Backup Manager - Comprehensive database backup and restore functionality
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { FuncqcConfig, BackupConfig, BackupManifest } from '../../types';
import { SchemaAnalyzer, SchemaAnalysisResult } from './schema-analyzer';
import { StorageAdapter } from '../../types';
import { AvroSerializer } from './avro/avro-serializer';
import { AvroSchemaGenerator } from './avro/avro-schema-generator';
import { SchemaVersioning } from './avro/schema-versioning';

// Extended interface for backup operations
interface BackupStorageAdapter extends StorageAdapter {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface BackupOptions {
  label?: string;
  outputDir?: string;
  includeSourceCode?: boolean;
  compress?: boolean;
  format?: 'json' | 'sql' | 'avro';
  dryRun?: boolean;
}

export interface RestoreOptions {
  backupPath: string;
  verifySchema?: boolean;
  dryRun?: boolean;
  overwrite?: boolean;
}

export interface BackupResult {
  success: boolean;
  backupPath: string;
  manifest: BackupManifest;
  duration: number;
  stats: {
    tablesExported: number;
    totalRows: number;
    backupSize: string;
  };
  warnings?: string[];
  errors?: string[];
}

export class BackupManager {
  private backupConfig: BackupConfig;
  private schemaAnalyzer: SchemaAnalyzer;
  private storage: BackupStorageAdapter;
  private avroSerializer: AvroSerializer;
  private avroSchemaGenerator: AvroSchemaGenerator;
  private schemaVersioning: SchemaVersioning;

  constructor(config: FuncqcConfig, storage: StorageAdapter) {
    this.backupConfig = config.backup || this.getDefaultBackupConfig();
    this.schemaAnalyzer = new SchemaAnalyzer();
    if (!('query' in storage) || typeof (storage as unknown as Record<string, unknown>)['query'] !== 'function') {
      throw new Error('Storage adapter must implement query method for backup operations');
    }
    this.storage = storage as BackupStorageAdapter;
    
    // Initialize Avro components
    this.avroSchemaGenerator = new AvroSchemaGenerator();
    this.schemaVersioning = new SchemaVersioning();
    this.avroSerializer = new AvroSerializer(this.avroSchemaGenerator, this.schemaVersioning);
  }

  /**
   * Create a comprehensive database backup
   */
  async createBackup(options: BackupOptions = {}): Promise<BackupResult> {
    const startTime = Date.now();
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      // Resolve backup path
      const backupPath = await this.resolveBackupPath(options.label, options.outputDir);
      
      // Analyze schema (needed for both dry-run and actual backup)
      const schemaAnalysis = await this.schemaAnalyzer.analyzeSchema();
      
      if (options.dryRun) {
        console.log(`[DRY RUN] Would create backup at: ${backupPath}`);
        return this.createDryRunResult(backupPath, startTime, schemaAnalysis);
      }

      // Create backup directory
      await fs.mkdir(backupPath, { recursive: true });
      
      if (schemaAnalysis.circularDependencies.length > 0) {
        warnings.push(`Circular dependencies detected: ${schemaAnalysis.circularDependencies.join(', ')}`);
      }

      // Create data directory
      const dataDir = path.join(backupPath, 'data');
      await fs.mkdir(dataDir, { recursive: true });

      // Export tables in correct order
      const tableStats = await this.exportTables(
        schemaAnalysis.tableOrder,
        dataDir,
        options.format || this.backupConfig.defaults.format
      );

      // Copy schema file
      await this.copySchemaFile(backupPath);

      // Generate manifest
      const manifest = await this.generateManifest(
        schemaAnalysis,
        tableStats,
        options
      );

      // Save manifest
      await this.saveManifest(backupPath, manifest);

      // Calculate backup size
      const backupSize = await this.calculateBackupSize(backupPath);

      const duration = Date.now() - startTime;

      return {
        success: true,
        backupPath,
        manifest,
        duration,
        stats: {
          tablesExported: Object.keys(tableStats).length,
          totalRows: Object.values(tableStats).reduce((sum, count) => sum + count, 0),
          backupSize: this.formatBytes(backupSize),
        },
        ...(warnings.length > 0 && { warnings }),
        ...(errors.length > 0 && { errors }),
      };

    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      
      return {
        success: false,
        backupPath: '',
        manifest: {} as BackupManifest,
        duration: Date.now() - startTime,
        stats: {
          tablesExported: 0,
          totalRows: 0,
          backupSize: '0 B',
        },
        errors,
      };
    }
  }

  /**
   * Restore database from backup
   */
  async restoreBackup(options: RestoreOptions): Promise<{
    success: boolean;
    tablesRestored: number;
    rowsRestored: number;
    duration: number;
    warnings?: string[];
    errors?: string[];
  }> {
    const startTime = Date.now();
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      // Load and validate manifest
      const manifest = await this.loadManifest(options.backupPath);
      
      if (options.verifySchema) {
        const currentSchema = await this.schemaAnalyzer.analyzeSchema();
        if (currentSchema.schemaHash !== manifest.schemaHash) {
          warnings.push(`Schema version mismatch. Backup: ${manifest.schemaHash}, Current: ${currentSchema.schemaHash}`);
        }
      }

      if (options.dryRun) {
        console.log(`[DRY RUN] Would restore ${Object.keys(manifest.tables).length} tables`);
        return {
          success: true,
          tablesRestored: Object.keys(manifest.tables).length,
          rowsRestored: Object.values(manifest.tables).reduce((sum, table) => sum + table.rows, 0),
          duration: Date.now() - startTime,
          warnings,
        };
      }

      // Check if database is empty (for safety)
      if (!options.overwrite) {
        await this.verifyDatabaseEmpty();
      }

      // Restore tables in correct order
      let tablesRestored = 0;
      let rowsRestored = 0;

      for (const tableName of manifest.tableOrder) {
        const tableData = await this.loadTableData(options.backupPath, tableName);
        const rows = await this.restoreTableData(tableName, tableData);
        
        tablesRestored++;
        rowsRestored += rows;
      }

      return {
        success: true,
        tablesRestored,
        rowsRestored,
        duration: Date.now() - startTime,
        ...(warnings.length > 0 && { warnings }),
      };

    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      
      return {
        success: false,
        tablesRestored: 0,
        rowsRestored: 0,
        duration: Date.now() - startTime,
        errors,
      };
    }
  }

  /**
   * List available backups
   */
  async listBackups(): Promise<Array<{
    path: string;
    manifest: BackupManifest;
    size: string;
    age: string;
  }>> {
    const backupDir = this.backupConfig.outputDir;
    
    try {
      const entries = await fs.readdir(backupDir, { withFileTypes: true });
      const backups = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            const backupPath = path.join(backupDir, entry.name);
            const manifest = await this.loadManifest(backupPath);
            const size = await this.calculateBackupSize(backupPath);
            const age = this.calculateAge(new Date(manifest.createdAt));

            backups.push({
              path: backupPath,
              manifest,
              size: this.formatBytes(size),
              age,
            });
          } catch {
            // Skip invalid backups
          }
        }
      }

      return backups.sort((a, b) => 
        new Date(b.manifest.createdAt).getTime() - new Date(a.manifest.createdAt).getTime()
      );

    } catch {
      return [];
    }
  }

  /**
   * Clean up old backups according to retention policy
   */
  async cleanupOldBackups(): Promise<{
    removed: number;
    freed: string;
  }> {
    if (!this.backupConfig.retention.autoCleanup) {
      return { removed: 0, freed: '0 B' };
    }

    const backups = await this.listBackups();
    const maxBackups = this.backupConfig.retention.maxBackups;
    const maxAge = this.parseMaxAge(this.backupConfig.retention.maxAge);
    
    let removed = 0;
    let freedBytes = 0;

    // Remove by count limit
    if (backups.length > maxBackups) {
      const toRemove = backups.slice(maxBackups);
      
      for (const backup of toRemove) {
        const size = await this.calculateBackupSize(backup.path);
        await fs.rm(backup.path, { recursive: true });
        removed++;
        freedBytes += size;
      }
    }

    // Remove by age limit
    const now = new Date();
    for (const backup of backups) {
      const backupAge = now.getTime() - new Date(backup.manifest.createdAt).getTime();
      
      if (backupAge > maxAge) {
        const size = await this.calculateBackupSize(backup.path);
        await fs.rm(backup.path, { recursive: true });
        removed++;
        freedBytes += size;
      }
    }

    return {
      removed,
      freed: this.formatBytes(freedBytes),
    };
  }

  /**
   * Resolve backup path with timestamp and label
   */
  private async resolveBackupPath(label?: string, outputDir?: string): Promise<string> {
    const baseDir = outputDir || this.backupConfig.outputDir;
    const timestamp = this.formatTimestamp(new Date());
    
    let dirName = timestamp;
    
    if (label && this.backupConfig.naming.includeLabel) {
      dirName += `-${label}`;
    }
    
    if (this.backupConfig.naming.includeGitInfo) {
      try {
        // This would need Git integration
        // For now, we'll skip git info
      } catch {
        // Ignore git errors
      }
    }

    return path.resolve(baseDir, dirName);
  }

  /**
   * Export all tables to specified format (JSON, SQL, or Avro)
   */
  private async exportTables(
    tableOrder: string[],
    dataDir: string,
    format: 'json' | 'sql' | 'avro'
  ): Promise<Record<string, number>> {
    const tableStats: Record<string, number> = {};

    for (const tableName of tableOrder) {
      try {
        const data = await this.exportTableData(tableName);
        const fileName = `${tableName}.${format}`;
        const filePath = path.join(dataDir, fileName);
        
        if (format === 'json') {
          await fs.writeFile(filePath, JSON.stringify(data, null, 2));
        } else if (format === 'avro') {
          // Serialize using Avro format
          const avroData = await this.avroSerializer.serializeTable(
            tableName, 
            Array.isArray(data) ? data.map(row => row as Record<string, unknown>) : [],
            { 
              compress: this.backupConfig.defaults.compress,
              validate: true,
              includeMetadata: true
            }
          );
          await fs.writeFile(filePath, avroData);
        } else if (format === 'sql') {
          // SQL format implementation would go here
          throw new Error('SQL format not yet implemented');
        }
        
        tableStats[tableName] = Array.isArray(data) ? data.length : 0;
      } catch (error) {
        console.warn(`Warning: Failed to export table ${tableName}:`, error);
        tableStats[tableName] = 0;
      }
    }

    return tableStats;
  }

  /**
   * Export data from a single table
   */
  private async exportTableData(tableName: string): Promise<unknown[]> {
    try {
      // Validate table name against known tables
      const validTables = await this.schemaAnalyzer.analyzeSchema();
      if (!validTables.tables.includes(tableName)) {
        throw new Error(`Invalid table name: ${tableName}`);
      }
      
      // Use escaped identifier to prevent SQL injection
      const query = `SELECT * FROM "${tableName}"`;
      if (process.env['DEBUG_BACKUP']) {
        console.log(`[BackupManager] Executing query: ${query}`);
      }
      
      const result = await this.storage.query(query);
      const rows = (result as { rows: unknown[] }).rows || [];
      
      if (process.env['DEBUG_BACKUP']) {
        console.log(`[BackupManager] Table ${tableName}: ${rows.length} rows exported, result:`, 
          JSON.stringify(result, null, 2).substring(0, 200) + '...');
      }
      
      return rows;
    } catch (error) {
      console.warn(`[BackupManager] Failed to export table ${tableName}:`, error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  /**
   * Copy schema file to backup directory
   */
  private async copySchemaFile(backupPath: string): Promise<void> {
    const schemaPath = 'src/schemas/database.sql';
    const targetPath = path.join(backupPath, 'database.sql');
    
    try {
      await fs.copyFile(schemaPath, targetPath);
    } catch (error) {
      throw new Error(`Failed to copy schema file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate backup manifest
   */
  private async generateManifest(
    schemaAnalysis: SchemaAnalysisResult,
    tableStats: Record<string, number>,
    options: BackupOptions
  ): Promise<BackupManifest> {
    const tables: Record<string, { rows: number; dependencies: string[] }> = {};
    
    for (const [tableName, rowCount] of Object.entries(tableStats)) {
      const deps = schemaAnalysis.dependencies.find(d => d.tableName === tableName);
      tables[tableName] = {
        rows: rowCount,
        dependencies: deps?.dependencies || [],
      };
    }

    const manifest: BackupManifest = {
      createdAt: new Date().toISOString(),
      schemaHash: schemaAnalysis.schemaHash,
      tableOrder: schemaAnalysis.tableOrder,
      tables,
      schemaInfo: {
        version: schemaAnalysis.version,
        constraints: schemaAnalysis.circularDependencies.length > 0 ? 'warning' : 'verified',
        circularDeps: schemaAnalysis.circularDependencies,
      },
      metadata: {
        funcqcVersion: '1.0.0', // This should come from package.json
        backupFormat: options.format || 'json',
        compressed: options.compress || false,
        includesSourceCode: options.includeSourceCode || false,
      },
    };

    if (options.label) {
      manifest.label = options.label;
    }

    return manifest;
  }

  /**
   * Save manifest to backup directory
   */
  private async saveManifest(backupPath: string, manifest: BackupManifest): Promise<void> {
    const manifestPath = path.join(backupPath, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }

  /**
   * Load manifest from backup directory
   */
  private async loadManifest(backupPath: string): Promise<BackupManifest> {
    const manifestPath = path.join(backupPath, 'manifest.json');
    const content = await fs.readFile(manifestPath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * Load table data from backup (auto-detect format)
   */
  private async loadTableData(backupPath: string, tableName: string): Promise<unknown[]> {
    const dataDir = path.join(backupPath, 'data');
    
    // Try different formats in order of preference
    const formats = ['avro', 'json', 'sql'];
    
    for (const format of formats) {
      const dataPath = path.join(dataDir, `${tableName}.${format}`);
      
      try {
        await fs.access(dataPath);
        
        if (format === 'avro') {
          // Load Avro file
          const buffer = await fs.readFile(dataPath);
          
          // Verify it's actually Avro format
          if (AvroSerializer.isAvroFormat(buffer)) {
            const tableData = await this.avroSerializer.deserializeTable(buffer);
            return tableData.rows;
          } else {
            console.warn(`File ${dataPath} has .avro extension but is not Avro format`);
            continue;
          }
        } else if (format === 'json') {
          // Load JSON file
          const content = await fs.readFile(dataPath, 'utf-8');
          const data = JSON.parse(content);
          return Array.isArray(data) ? data : [];
        } else if (format === 'sql') {
          // SQL format not yet implemented
          throw new Error('SQL format restoration not yet implemented');
        }
      } catch {
        // File doesn't exist or can't be read, try next format
        continue;
      }
    }
    
    // If no format found, throw error
    throw new Error(`No data file found for table ${tableName} in formats: ${formats.join(', ')}`);
  }

  /**
   * Restore data to a table
   */
  private async restoreTableData(tableName: string, data: unknown[]): Promise<number> {
    if (!Array.isArray(data) || data.length === 0) {
      return 0;
    }

    try {
      // First, clear the table (if overwrite is enabled)
      await this.storage.query(`DELETE FROM "${tableName}"`);
      
      let restoredRows = 0;
      
      // Insert data in batches to avoid memory issues
      const batchSize = 100; // Reduced batch size for better performance
      const totalRows = data.length;
      
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        
        // Progress logging for large tables
        if (totalRows > 1000 && i % 1000 === 0) {
          console.log(`[BackupManager] Restoring ${tableName}: ${i}/${totalRows} rows (${Math.round(i/totalRows*100)}%)`);
        }
        
        for (const row of batch) {
          if (row && typeof row === 'object') {
            const record = row as Record<string, unknown>;
            const columns = Object.keys(record);
            const values = Object.values(record).map(value => {
              // Handle JSON/JSONB fields by stringifying objects and arrays
              if (value !== null && typeof value === 'object') {
                return JSON.stringify(value);
              }
              return value;
            });
            
            if (columns.length > 0) {
              const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
              const escapedColumns = columns.map(col => `"${col}"`).join(', ');
              const query = `INSERT INTO "${tableName}" (${escapedColumns}) VALUES (${placeholders})`;
              
              await this.storage.query(query, values);
              restoredRows++;
            }
          }
        }
      }
      
      return restoredRows;
    } catch (error) {
      throw new Error(`Failed to restore table ${tableName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Verify database is empty for safe restore
   */
  private async verifyDatabaseEmpty(): Promise<void> {
    try {
      // Get list of tables with data
      const tablesWithData: string[] = [];
      
      // Check core tables for data
      const tablesToCheck = [
        'snapshots', 'functions', 'function_metrics', 'source_contents',
        'call_edges', 'internal_call_edges', 'type_definitions', 
        'type_relationships', 'type_members', 'method_overrides'
      ];
      
      for (const tableName of tablesToCheck) {
        try {
          const result = await this.storage.query(`SELECT COUNT(*) as count FROM "${tableName}" LIMIT 1`);
          const rows = (result as { rows: { count: number }[] }).rows;
          
          if (rows && rows.length > 0 && rows[0].count > 0) {
            tablesWithData.push(tableName);
          }
        } catch {
          // Table might not exist, skip
          continue;
        }
      }
      
      if (tablesWithData.length > 0) {
        throw new Error(`Database is not empty. Tables with data: ${tablesWithData.join(', ')}. Use --overwrite to proceed anyway.`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('not empty')) {
        throw error;
      }
      // If we can't verify, assume it's safe (database might be new)
      console.warn(`Warning: Could not verify database state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Calculate backup directory size
   */
  private async calculateBackupSize(backupPath: string): Promise<number> {
    try {
      const entries = await fs.readdir(backupPath, { withFileTypes: true });
      let size = 0;

      for (const entry of entries) {
        const fullPath = path.join(backupPath, entry.name);
        
        if (entry.isFile()) {
          const stats = await fs.stat(fullPath);
          size += stats.size;
        } else if (entry.isDirectory()) {
          size += await this.calculateBackupSize(fullPath);
        }
      }

      return size;
    } catch {
      return 0;
    }
  }

  /**
   * Utility methods
   */
  private getDefaultBackupConfig(): BackupConfig {
    return {
      outputDir: '.funcqc/backups',
      naming: { format: 'YYYYMMDD-HHMMSS', includeLabel: true, includeGitInfo: false },
      defaults: { includeSourceCode: false, compress: false, format: 'json', tableOrder: 'auto' },
      retention: { maxBackups: 10, maxAge: '30d', autoCleanup: true },
      schema: { autoDetectVersion: true, conversionRulesDir: '.funcqc/conversion-rules' },
      security: { excludeSensitiveData: true, encryptBackups: false },
      advanced: { parallelTableExport: true, verifyIntegrity: true, includeMetrics: true },
    };
  }

  private formatTimestamp(date: Date): string {
    return date.toISOString()
      .replace(/[T:.-]/g, '')
      .substring(0, 14); // YYYYMMDDHHMMSS
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  private calculateAge(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (days === 0) return 'Today';
    if (days === 1) return '1 day ago';
    if (days < 30) return `${days} days ago`;
    
    const months = Math.floor(days / 30);
    if (months === 1) return '1 month ago';
    if (months < 12) return `${months} months ago`;
    
    const years = Math.floor(months / 12);
    return years === 1 ? '1 year ago' : `${years} years ago`;
  }

  private parseMaxAge(maxAge: string): number {
    const match = maxAge.match(/^(\d+)([dmyh])$/);
    if (!match) return 30 * 24 * 60 * 60 * 1000; // Default 30 days
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      case 'm': return value * 30 * 24 * 60 * 60 * 1000;
      case 'y': return value * 365 * 24 * 60 * 60 * 1000;
      default: return 30 * 24 * 60 * 60 * 1000;
    }
  }

  private createDryRunResult(backupPath: string, startTime: number, schemaAnalysis?: SchemaAnalysisResult): BackupResult {
    const tablesExported = schemaAnalysis?.tables.length || 0;
    const tableOrder = schemaAnalysis?.tableOrder || [];
    
    // Show table list in debug mode
    if (process.env['DEBUG_BACKUP'] && tableOrder.length > 0) {
      console.log(`[BackupManager] Dry run would export ${tablesExported} tables: [${tableOrder.join(', ')}]`);
    }
    
    return {
      success: true,
      backupPath,
      manifest: {} as BackupManifest,
      duration: Date.now() - startTime,
      stats: {
        tablesExported,
        totalRows: 0, // Can't determine row count in dry-run without actual queries
        backupSize: '0 B',
      },
      warnings: ['Dry run - no actual backup created'],
    };
  }
}
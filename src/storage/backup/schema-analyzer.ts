/**
 * Schema Analyzer - DDL parsing and topological sorting for safe database operations
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export interface TableDependency {
  tableName: string;
  dependencies: string[];
  foreignKeys: Array<{
    column: string;
    referencedTable: string;
    referencedColumn: string;
  }>;
}

export interface SchemaAnalysisResult {
  tables: string[];
  dependencies: TableDependency[];
  tableOrder: string[];
  schemaHash: string;
  circularDependencies: string[];
  version: string;
}

export class SchemaAnalyzer {
  private schemaPath: string;

  constructor(schemaPath: string = 'src/schemas/database.sql') {
    this.schemaPath = schemaPath;
  }

  /**
   * Analyze the database schema and generate safe table order
   */
  async analyzeSchema(): Promise<SchemaAnalysisResult> {
    const schemaContent = await this.loadSchemaFile();
    const normalizedSchema = this.normalizeSchema(schemaContent);
    const schemaHash = this.generateSchemaHash(normalizedSchema);
    
    const tables = this.extractTableNames(schemaContent);
    const dependencies = this.analyzeDependencies(schemaContent, tables);
    const { tableOrder, circularDependencies } = this.performTopologicalSort(dependencies);
    
    // Only log issues or in debug mode
    if (circularDependencies.length > 0) {
      console.log(`[SchemaAnalyzer] Circular dependencies detected: [${circularDependencies.join(', ')}]`);
    }
    if (process.env['DEBUG_SCHEMA']) {
      console.log(`[SchemaAnalyzer] Tables: ${tables.length}, Order: [${tableOrder.join(', ')}]`);
    }
    
    return {
      tables,
      dependencies,
      tableOrder,
      schemaHash,
      circularDependencies,
      version: this.detectSchemaVersion(schemaHash),
    };
  }

  /**
   * Load and validate schema file
   */
  private async loadSchemaFile(): Promise<string> {
    try {
      const fullPath = path.resolve(this.schemaPath);
      const content = await fs.readFile(fullPath, 'utf-8');
      
      if (!content.trim()) {
        throw new Error(`Schema file is empty: ${fullPath}`);
      }
      
      return content;
    } catch (error) {
      throw new Error(`Failed to load schema file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Normalize schema content for consistent hashing
   */
  private normalizeSchema(content: string): string {
    return content
      // Remove comments
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Remove empty lines
      .replace(/^\s*$/gm, '')
      // Convert to lowercase for consistency
      .toLowerCase()
      .trim();
  }

  /**
   * Generate schema version hash
   */
  private generateSchemaHash(normalizedContent: string): string {
    return crypto
      .createHash('sha256')
      .update(normalizedContent)
      .digest('hex')
      .substring(0, 8);
  }

  /**
   * Extract table names from CREATE TABLE statements
   */
  private extractTableNames(content: string): string[] {
    // CREATE TABLE [IF NOT EXISTS] [schema.]("table" | table)
    const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:[A-Za-z_][A-Za-z0-9_]*|"[^"]+")\.)*(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/gi;
    const matches = [...content.matchAll(tableRegex)];
    
    // Warn if no tables found
    if (matches.length === 0) {
      console.warn(`[SchemaAnalyzer] No CREATE TABLE statements found in schema file`);
      if (process.env['DEBUG_SCHEMA']) {
        const lines = content.split('\n');
        const createTableLines = lines.filter(line => line.includes('CREATE TABLE')).slice(0, 5);
        console.log(`[SchemaAnalyzer] Sample lines containing 'CREATE TABLE':`, createTableLines);
      }
    }
    
    const tables = matches
      .map(match => match[1] ?? match[2])
      .filter((table, index, arr) => arr.indexOf(table) === index) // Remove duplicates
      .sort();
    
    return tables;
  }

  /**
   * Analyze foreign key dependencies between tables
   */
  private analyzeDependencies(content: string, tables: string[]): TableDependency[] {
    const dependencies: TableDependency[] = [];
    
    for (const tableName of tables) {
      const tableBlock = this.extractTableBlock(content, tableName);
      const foreignKeys = this.extractForeignKeys(tableBlock);
      const deps = foreignKeys.map(fk => fk.referencedTable);
      
      dependencies.push({
        tableName,
        dependencies: [...new Set(deps)], // Remove duplicates
        foreignKeys,
      });
    }
    
    return dependencies;
  }

  /**
   * Extract the complete CREATE TABLE block for a table
   */
  private extractTableBlock(content: string, tableName: string): string {
    // Escape special regex characters
    const escapedTableName = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `CREATE\\s+TABLE\\s+${escapedTableName}\\s*\\([\\s\\S]*?\\);`,
      'i'
    );
    const match = content.match(regex);
    return match ? match[0] : '';
  }

  /**
   * Extract foreign key constraints from table definition
   */
  private extractForeignKeys(tableBlock: string): Array<{
    column: string;
    referencedTable: string;
    referencedColumn: string;
  }> {
    const foreignKeys: Array<{
      column: string;
      referencedTable: string;
      referencedColumn: string;
    }> = [];
    
    // Pattern for FOREIGN KEY constraints
    const fkRegex = /FOREIGN\s+KEY\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)\s+REFERENCES\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/gi;
    
    let match;
    while ((match = fkRegex.exec(tableBlock)) !== null) {
      foreignKeys.push({
        column: match[1],
        referencedTable: match[2],
        referencedColumn: match[3],
      });
    }
    
    return foreignKeys;
  }

  /**
   * Perform topological sort to determine safe table order
   * Uses Kahn's algorithm to detect cycles and generate ordering
   */
  private performTopologicalSort(dependencies: TableDependency[]): {
    tableOrder: string[];
    circularDependencies: string[];
  } {
    const graph = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();
    const allTables = new Set<string>();
    
    // Initialize graph
    for (const dep of dependencies) {
      allTables.add(dep.tableName);
      graph.set(dep.tableName, new Set());
      inDegree.set(dep.tableName, 0);
      
      for (const depTable of dep.dependencies) {
        allTables.add(depTable);
        if (!graph.has(depTable)) {
          graph.set(depTable, new Set());
          inDegree.set(depTable, 0);
        }
      }
    }
    
    // Build graph and calculate in-degrees
    for (const dep of dependencies) {
      for (const depTable of dep.dependencies) {
        if (depTable !== dep.tableName) { // Avoid self-references
          graph.get(depTable)?.add(dep.tableName);
          inDegree.set(dep.tableName, (inDegree.get(dep.tableName) || 0) + 1);
        }
      }
    }
    
    // Kahn's algorithm
    const queue: string[] = [];
    const result: string[] = [];
    
    // Find tables with no dependencies
    for (const [table, degree] of inDegree) {
      if (degree === 0) {
        queue.push(table);
      }
    }
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);
      
      const neighbors = graph.get(current) || new Set();
      for (const neighbor of neighbors) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);
        
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }
    
    // Detect circular dependencies
    const circularDependencies: string[] = [];
    if (result.length < allTables.size) {
      for (const table of allTables) {
        if (!result.includes(table)) {
          circularDependencies.push(table);
        }
      }
    }
    
    return {
      tableOrder: result,
      circularDependencies,
    };
  }

  /**
   * Detect schema version based on hash
   */
  private detectSchemaVersion(schemaHash: string): string {
    // This could be enhanced to maintain a mapping of known schema versions
    // For now, we use the hash as version identifier
    return `v${schemaHash}`;
  }

  /**
   * Generate schema summary for manifest
   */
  async generateSchemaSummary(): Promise<{
    hash: string;
    version: string;
    tableCount: number;
    hasCircularDeps: boolean;
    lastModified: Date;
  }> {
    const analysis = await this.analyzeSchema();
    
    let lastModified: Date;
    try {
      const stats = await fs.stat(this.schemaPath);
      lastModified = stats.mtime;
    } catch {
      lastModified = new Date();
    }
    
    return {
      hash: analysis.schemaHash,
      version: analysis.version,
      tableCount: analysis.tables.length,
      hasCircularDeps: analysis.circularDependencies.length > 0,
      lastModified,
    };
  }

  /**
   * Validate table order against dependencies
   */
  validateTableOrder(tableOrder: string[], dependencies: TableDependency[]): {
    isValid: boolean;
    violations: string[];
  } {
    const violations: string[] = [];
    const processed = new Set<string>();
    
    for (const tableName of tableOrder) {
      const tableDeps = dependencies.find(d => d.tableName === tableName);
      
      if (tableDeps) {
        for (const dep of tableDeps.dependencies) {
          if (!processed.has(dep)) {
            violations.push(`Table '${tableName}' depends on '${dep}' but '${dep}' comes later in order`);
          }
        }
      }
      
      processed.add(tableName);
    }
    
    return {
      isValid: violations.length === 0,
      violations,
    };
  }
}
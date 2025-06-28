import { PGlite } from '@electric-sql/pglite';
import simpleGit, { SimpleGit } from 'simple-git';
import { 
  FunctionInfo, 
  SnapshotInfo, 
  StorageAdapter, 
  QueryOptions, 
  SnapshotMetadata
} from '../types';

/**
 * Clean PGLite storage adapter implementation
 * Focuses on type safety, proper error handling, and clean architecture
 */
export class PGLiteStorageAdapter implements StorageAdapter {
  private db: PGlite;
  private git: SimpleGit;

  constructor(dbPath: string) {
    this.db = new PGlite(dbPath);
    this.git = simpleGit();
  }

  async init(): Promise<void> {
    try {
      await this.db.waitReady;
      await this.createSchema();
      await this.createIndexes();
    } catch (error) {
      throw new Error(`Failed to initialize database: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async close(): Promise<void> {
    try {
      await this.db.close();
    } catch (error) {
      throw new Error(`Failed to close database: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ========================================
  // SNAPSHOT OPERATIONS
  // ========================================

  async saveSnapshot(functions: FunctionInfo[], label?: string): Promise<string> {
    const snapshotId = this.generateSnapshotId();
    
    try {
      // Create snapshot record
      await this.createSnapshotRecord(snapshotId, functions, label);
      
      // Save functions in batch
      await this.saveFunctions(snapshotId, functions);
      
      return snapshotId;
    } catch (error) {
      throw new Error(`Failed to save snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getSnapshots(options?: QueryOptions): Promise<SnapshotInfo[]> {
    try {
      let sql = 'SELECT * FROM snapshots ORDER BY created_at DESC';
      const params: any[] = [];

      if (options?.limit) {
        sql += ' LIMIT $' + (params.length + 1);
        params.push(options.limit);
      }

      if (options?.offset) {
        sql += ' OFFSET $' + (params.length + 1);
        params.push(options.offset);
      }

      const result = await this.db.query(sql, params);

      return result.rows.map(this.mapRowToSnapshotInfo);
    } catch (error) {
      throw new Error(`Failed to get snapshots: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getSnapshot(id: string): Promise<SnapshotInfo | null> {
    try {
      const result = await this.db.query('SELECT * FROM snapshots WHERE id = $1', [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToSnapshotInfo(result.rows[0]);
    } catch (error) {
      throw new Error(`Failed to get snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async deleteSnapshot(id: string): Promise<boolean> {
    try {
      const result = await this.db.query('DELETE FROM snapshots WHERE id = $1', [id]);
      return (result as any).changes > 0;
    } catch (error) {
      throw new Error(`Failed to delete snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ========================================
  // FUNCTION OPERATIONS
  // ========================================

  async getFunctions(snapshotId: string, options?: QueryOptions): Promise<FunctionInfo[]> {
    try {
      let sql = `
        SELECT 
          f.*,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.max_nesting_level, q.parameter_count, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.comment_lines, q.code_to_comment_ratio, q.halstead_volume, q.halstead_difficulty,
          q.maintainability_index
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        WHERE f.snapshot_id = $1
      `;
      const params: any[] = [snapshotId];

      // Add filters if provided
      if (options?.filters) {
        const filterClauses = options.filters.map((filter) => {
          params.push(filter.value);
          return `f.${filter.field} ${filter.operator} $${params.length}`;
        });
        sql += ' AND ' + filterClauses.join(' AND ');
      }

      // Add sorting
      if (options?.sort) {
        sql += ` ORDER BY f.${options.sort}`;
      } else {
        sql += ' ORDER BY f.start_line';
      }

      // Add pagination
      if (options?.limit) {
        sql += ` LIMIT $${params.length + 1}`;
        params.push(options.limit);
      }

      if (options?.offset) {
        sql += ` OFFSET $${params.length + 1}`;
        params.push(options.offset);
      }

      const result = await this.db.query(sql, params);

      // Get parameters for each function
      const functions = await Promise.all(
        result.rows.map(async (row: any) => {
          const parameters = await this.getFunctionParameters(row.id);
          return this.mapRowToFunctionInfo(row, parameters);
        })
      );

      return functions;
    } catch (error) {
      throw new Error(`Failed to get functions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getFunctionsBySnapshot(snapshotId: string): Promise<FunctionInfo[]> {
    try {
      const result = await this.db.query(`
        SELECT f.*, qm.*
        FROM functions f
        LEFT JOIN quality_metrics qm ON f.id = qm.function_id
        WHERE f.snapshot_id = $1
        ORDER BY f.start_line
      `, [snapshotId]);

      // Get parameters for each function
      const functions = await Promise.all(
        result.rows.map(async (row: any) => {
          const parameters = await this.getFunctionParameters(row.id);
          return this.mapRowToFunctionInfo(row, parameters);
        })
      );

      return functions;
    } catch (error) {
      throw new Error(`Failed to get functions for snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async queryFunctions(): Promise<FunctionInfo[]> {
    // For now, stub implementation - can be enhanced later
    throw new Error('queryFunctions not implemented yet');
  }

  // ========================================
  // ANALYSIS OPERATIONS (FUTURE)
  // ========================================

  async diffSnapshots(fromId: string, toId: string): Promise<any> {
    try {
      // Get snapshot info
      const fromSnapshot = await this.getSnapshot(fromId);
      const toSnapshot = await this.getSnapshot(toId);

      if (!fromSnapshot || !toSnapshot) {
        throw new Error(`Snapshot not found: ${!fromSnapshot ? fromId : toId}`);
      }

      // Get functions for both snapshots
      const fromFunctions = await this.getFunctionsBySnapshot(fromId);
      const toFunctions = await this.getFunctionsBySnapshot(toId);

      // Create lookup maps for efficient comparison
      const fromMap = new Map(fromFunctions.map((f: FunctionInfo) => [f.signature, f]));
      const toMap = new Map(toFunctions.map((f: FunctionInfo) => [f.signature, f]));

      // Calculate differences
      const added: any[] = [];
      const removed: any[] = [];
      const modified: any[] = [];
      const unchanged: any[] = [];

      // Find added and modified functions
      for (const toFunc of toFunctions) {
        const fromFunc: FunctionInfo | undefined = fromMap.get(toFunc.signature);
        if (!fromFunc) {
          added.push(toFunc);
        } else if (fromFunc.astHash !== toFunc.astHash) {
          modified.push({
            before: fromFunc,
            after: toFunc,
            changes: this.calculateFunctionChanges(fromFunc, toFunc)
          });
        } else {
          unchanged.push(toFunc);
        }
      }

      // Find removed functions
      for (const fromFunc of fromFunctions) {
        if (!toMap.has(fromFunc.signature)) {
          removed.push(fromFunc);
        }
      }

      // Calculate statistics
      const statistics = this.calculateDiffStatistics(fromFunctions, toFunctions, added, removed, modified);

      return {
        from: fromSnapshot,
        to: toSnapshot,
        added,
        removed,
        modified,
        unchanged,
        statistics
      };
    } catch (error) {
      throw new Error(`Failed to diff snapshots: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private calculateFunctionChanges(fromFunc: any, toFunc: any): any[] {
    const changes: any[] = [];

    // Compare metrics if both have them
    if (fromFunc.metrics && toFunc.metrics) {
      const metrics = ['cyclomaticComplexity', 'linesOfCode', 'cognitiveComplexity', 'parameterCount'];
      for (const metric of metrics) {
        if (fromFunc.metrics[metric] !== toFunc.metrics[metric]) {
          changes.push({
            field: metric,
            oldValue: fromFunc.metrics[metric],
            newValue: toFunc.metrics[metric],
            impact: this.calculateChangeImpact(metric, fromFunc.metrics[metric], toFunc.metrics[metric])
          });
        }
      }
    }

    // Compare basic properties
    const basicProps = ['name', 'filePath', 'startLine', 'endLine'];
    for (const prop of basicProps) {
      if (fromFunc[prop] !== toFunc[prop]) {
        changes.push({
          field: prop,
          oldValue: fromFunc[prop],
          newValue: toFunc[prop],
          impact: 'low'
        });
      }
    }

    return changes;
  }

  private calculateChangeImpact(metric: string, oldValue: number, newValue: number): 'low' | 'medium' | 'high' {
    const diff = Math.abs(newValue - oldValue);
    const relativeChange = diff / Math.max(oldValue, 1);

    switch (metric) {
      case 'cyclomaticComplexity':
      case 'cognitiveComplexity':
        if (diff >= 5 || relativeChange >= 0.5) return 'high';
        if (diff >= 2 || relativeChange >= 0.2) return 'medium';
        return 'low';
      
      case 'linesOfCode':
        if (diff >= 50 || relativeChange >= 1.0) return 'high';
        if (diff >= 20 || relativeChange >= 0.5) return 'medium';
        return 'low';
      
      default:
        if (relativeChange >= 0.5) return 'high';
        if (relativeChange >= 0.2) return 'medium';
        return 'low';
    }
  }

  private calculateDiffStatistics(fromFunctions: any[], toFunctions: any[], added: any[], removed: any[], modified: any[]): any {
    const fromMetrics = this.aggregateMetrics(fromFunctions);
    const toMetrics = this.aggregateMetrics(toFunctions);

    return {
      addedCount: added.length,
      removedCount: removed.length,
      modifiedCount: modified.length,
      unchangedCount: toFunctions.length - added.length - modified.length,
      complexityChange: toMetrics.avgComplexity - fromMetrics.avgComplexity,
      linesChange: toMetrics.totalLines - fromMetrics.totalLines
    };
  }

  private aggregateMetrics(functions: any[]): { avgComplexity: number; totalLines: number } {
    if (functions.length === 0) {
      return { avgComplexity: 0, totalLines: 0 };
    }

    const totalComplexity = functions.reduce((sum, f) => 
      sum + (f.metrics?.cyclomaticComplexity || 1), 0);
    const totalLines = functions.reduce((sum, f) => 
      sum + (f.metrics?.linesOfCode || 0), 0);

    return {
      avgComplexity: totalComplexity / functions.length,
      totalLines
    };
  }

  // ========================================
  // MAINTENANCE OPERATIONS (FUTURE)
  // ========================================

  async cleanup(): Promise<number> {
    throw new Error('cleanup not implemented yet');
  }

  async backup(): Promise<string> {
    throw new Error('backup not implemented yet');
  }

  async restore(): Promise<void> {
    throw new Error('restore not implemented yet');
  }

  // ========================================
  // PRIVATE HELPER METHODS
  // ========================================

  private async createSchema(): Promise<void> {
    await this.db.exec(this.getSnapshotsTableSQL());
    await this.db.exec(this.getFunctionsTableSQL());
    await this.db.exec(this.getParametersTableSQL());
    await this.db.exec(this.getMetricsTableSQL());
  }

  private getSnapshotsTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        label TEXT,
        git_commit TEXT,
        git_branch TEXT,
        git_tag TEXT,
        project_root TEXT NOT NULL DEFAULT '',
        config_hash TEXT NOT NULL DEFAULT '',
        metadata TEXT DEFAULT '{}'
      );`;
  }

  private getFunctionsTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS functions (
        id TEXT PRIMARY KEY,
        snapshot_id TEXT NOT NULL,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        signature TEXT NOT NULL,
        signature_hash TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        start_column INTEGER NOT NULL DEFAULT 0,
        end_column INTEGER NOT NULL DEFAULT 0,
        ast_hash TEXT NOT NULL,
        is_exported BOOLEAN DEFAULT FALSE,
        is_async BOOLEAN DEFAULT FALSE,
        is_generator BOOLEAN DEFAULT FALSE,
        is_arrow_function BOOLEAN DEFAULT FALSE,
        is_method BOOLEAN DEFAULT FALSE,
        is_constructor BOOLEAN DEFAULT FALSE,
        is_static BOOLEAN DEFAULT FALSE,
        access_modifier TEXT,
        parent_class TEXT,
        parent_namespace TEXT,
        js_doc TEXT,
        source_code TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
      );`;
  }

  private getParametersTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS function_parameters (
        id SERIAL PRIMARY KEY,
        function_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        type_simple TEXT NOT NULL,
        position INTEGER NOT NULL,
        is_optional BOOLEAN DEFAULT FALSE,
        is_rest BOOLEAN DEFAULT FALSE,
        default_value TEXT,
        description TEXT,
        FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
      );`;
  }

  private getMetricsTableSQL(): string {
    return `
      CREATE TABLE IF NOT EXISTS quality_metrics (
        function_id TEXT PRIMARY KEY,
        lines_of_code INTEGER NOT NULL,
        total_lines INTEGER NOT NULL,
        cyclomatic_complexity INTEGER NOT NULL,
        cognitive_complexity INTEGER NOT NULL,
        max_nesting_level INTEGER NOT NULL,
        parameter_count INTEGER NOT NULL,
        return_statement_count INTEGER NOT NULL,
        branch_count INTEGER NOT NULL,
        loop_count INTEGER NOT NULL,
        try_catch_count INTEGER NOT NULL,
        async_await_count INTEGER NOT NULL,
        callback_count INTEGER NOT NULL,
        comment_lines INTEGER NOT NULL,
        code_to_comment_ratio REAL NOT NULL,
        halstead_volume REAL,
        halstead_difficulty REAL,
        maintainability_index REAL,
        FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
      );`;
  }

  private async createIndexes(): Promise<void> {
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_functions_snapshot_id ON functions(snapshot_id);
      CREATE INDEX IF NOT EXISTS idx_functions_name ON functions(name);
      CREATE INDEX IF NOT EXISTS idx_functions_file_path ON functions(file_path);
      CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at);
      CREATE INDEX IF NOT EXISTS idx_snapshots_git_commit ON snapshots(git_commit);
    `);
  }

  private generateSnapshotId(): string {
    return `snap_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private async createSnapshotRecord(
    snapshotId: string,
    functions: FunctionInfo[],
    label?: string
  ): Promise<void> {
    const metadata = this.calculateSnapshotMetadata(functions);
    
    await this.db.query(`
      INSERT INTO snapshots (id, label, git_commit, git_branch, git_tag, project_root, config_hash, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      snapshotId,
      label || null,
      await this.getGitCommit(),
      await this.getGitBranch(),
      await this.getGitTag(),
      process.cwd(),
      'generated', // TODO: Implement config hash
      JSON.stringify(metadata)
    ]);
  }

  private async saveFunctions(snapshotId: string, functions: FunctionInfo[]): Promise<void> {
    for (const func of functions) {
      // Insert function
      await this.db.query(`
        INSERT INTO functions (
          id, snapshot_id, name, display_name, signature, signature_hash,
          file_path, file_hash, start_line, end_line, start_column, end_column,
          ast_hash, is_exported, is_async, is_generator, is_arrow_function,
          is_method, is_constructor, is_static, access_modifier, parent_class,
          parent_namespace, js_doc, source_code
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24, $25
        )
      `, [
        func.id, snapshotId, func.name, func.displayName, func.signature, func.signatureHash,
        func.filePath, func.fileHash, func.startLine, func.endLine, func.startColumn, func.endColumn,
        func.astHash, func.isExported, func.isAsync, func.isGenerator, func.isArrowFunction,
        func.isMethod, func.isConstructor, func.isStatic, func.accessModifier || null, func.parentClass || null,
        func.parentNamespace || null, func.jsDoc || null, func.sourceCode || null
      ]);

      // Insert parameters
      for (const param of func.parameters) {
        await this.db.query(`
          INSERT INTO function_parameters (
            function_id, name, type, type_simple, position, is_optional, is_rest, default_value, description
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          func.id, param.name, param.type, param.typeSimple, param.position,
          param.isOptional, param.isRest, param.defaultValue || null, param.description || null
        ]);
      }

      // Insert metrics if available
      if (func.metrics) {
        await this.db.query(`
          INSERT INTO quality_metrics (
            function_id, lines_of_code, total_lines, cyclomatic_complexity, cognitive_complexity,
            max_nesting_level, parameter_count, return_statement_count, branch_count, loop_count,
            try_catch_count, async_await_count, callback_count, comment_lines, code_to_comment_ratio,
            halstead_volume, halstead_difficulty, maintainability_index
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
          )
        `, [
          func.id, func.metrics.linesOfCode, func.metrics.totalLines, func.metrics.cyclomaticComplexity,
          func.metrics.cognitiveComplexity, func.metrics.maxNestingLevel, func.metrics.parameterCount,
          func.metrics.returnStatementCount, func.metrics.branchCount, func.metrics.loopCount,
          func.metrics.tryCatchCount, func.metrics.asyncAwaitCount, func.metrics.callbackCount,
          func.metrics.commentLines, func.metrics.codeToCommentRatio, func.metrics.halsteadVolume || null,
          func.metrics.halsteadDifficulty || null, func.metrics.maintainabilityIndex || null
        ]);
      }
    }
  }

  private async getFunctionParameters(functionId: string): Promise<any[]> {
    const result = await this.db.query(
      'SELECT * FROM function_parameters WHERE function_id = $1 ORDER BY position',
      [functionId]
    );
    return result.rows;
  }

  private mapRowToSnapshotInfo(row: any): SnapshotInfo {
    return {
      id: row.id,
      createdAt: new Date(row.created_at).getTime(),
      label: row.label || undefined,
      gitCommit: row.git_commit || undefined,
      gitBranch: row.git_branch || undefined,
      gitTag: row.git_tag || undefined,
      projectRoot: row.project_root,
      configHash: row.config_hash,
      metadata: JSON.parse(row.metadata || '{}')
    };
  }

  private mapRowToFunctionInfo(row: any, parameters: any[]): FunctionInfo {
    const functionInfo: FunctionInfo = {
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      signature: row.signature,
      signatureHash: row.signature_hash,
      filePath: row.file_path,
      fileHash: row.file_hash,
      startLine: row.start_line,
      endLine: row.end_line,
      startColumn: row.start_column,
      endColumn: row.end_column,
      astHash: row.ast_hash,
      isExported: row.is_exported,
      isAsync: row.is_async,
      isGenerator: row.is_generator,
      isArrowFunction: row.is_arrow_function,
      isMethod: row.is_method,
      isConstructor: row.is_constructor,
      isStatic: row.is_static,
      parameters: parameters.map(p => ({
        name: p.name,
        type: p.type,
        typeSimple: p.type_simple,
        position: p.position,
        isOptional: p.is_optional,
        isRest: p.is_rest,
        defaultValue: p.default_value || undefined,
        description: p.description || undefined
      }))
    };

    // Add optional properties only if they exist
    if (row.access_modifier) functionInfo.accessModifier = row.access_modifier;
    if (row.parent_class) functionInfo.parentClass = row.parent_class;
    if (row.parent_namespace) functionInfo.parentNamespace = row.parent_namespace;
    if (row.js_doc) functionInfo.jsDoc = row.js_doc;
    if (row.source_code) functionInfo.sourceCode = row.source_code;

    // Add metrics if available
    if (row.lines_of_code !== null) {
      functionInfo.metrics = {
        linesOfCode: row.lines_of_code,
        totalLines: row.total_lines,
        cyclomaticComplexity: row.cyclomatic_complexity,
        cognitiveComplexity: row.cognitive_complexity,
        maxNestingLevel: row.max_nesting_level,
        parameterCount: row.parameter_count,
        returnStatementCount: row.return_statement_count,
        branchCount: row.branch_count,
        loopCount: row.loop_count,
        tryCatchCount: row.try_catch_count,
        asyncAwaitCount: row.async_await_count,
        callbackCount: row.callback_count,
        commentLines: row.comment_lines,
        codeToCommentRatio: row.code_to_comment_ratio,
        halsteadVolume: row.halstead_volume || undefined,
        halsteadDifficulty: row.halstead_difficulty || undefined,
        maintainabilityIndex: row.maintainability_index || undefined
      };
    }

    return functionInfo;
  }

  private calculateSnapshotMetadata(functions: FunctionInfo[]): SnapshotMetadata {
    if (functions.length === 0) {
      return {
        totalFunctions: 0,
        totalFiles: 0,
        avgComplexity: 0,
        maxComplexity: 0,
        exportedFunctions: 0,
        asyncFunctions: 0,
        complexityDistribution: {},
        fileExtensions: {}
      };
    }

    const uniqueFiles = new Set(functions.map(f => f.filePath));
    const complexities = functions
      .map(f => f.metrics?.cyclomaticComplexity || 1)
      .filter(c => c > 0);
    
    const complexityDistribution: Record<number, number> = {};
    complexities.forEach(complexity => {
      complexityDistribution[complexity] = (complexityDistribution[complexity] || 0) + 1;
    });

    const fileExtensions: Record<string, number> = {};
    functions.forEach(f => {
      const ext = f.filePath.split('.').pop() || 'unknown';
      fileExtensions[ext] = (fileExtensions[ext] || 0) + 1;
    });

    return {
      totalFunctions: functions.length,
      totalFiles: uniqueFiles.size,
      avgComplexity: complexities.length > 0 ? 
        Math.round((complexities.reduce((a, b) => a + b, 0) / complexities.length) * 10) / 10 : 0,
      maxComplexity: complexities.length > 0 ? Math.max(...complexities) : 0,
      exportedFunctions: functions.filter(f => f.isExported).length,
      asyncFunctions: functions.filter(f => f.isAsync).length,
      complexityDistribution,
      fileExtensions
    };
  }

  // Git helper methods
  private async getGitCommit(): Promise<string | null> {
    try {
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) return null;
      
      return await this.git.revparse(['HEAD']);
    } catch {
      return null;
    }
  }

  private async getGitBranch(): Promise<string | null> {
    try {
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) return null;
      
      return await this.git.revparse(['--abbrev-ref', 'HEAD']);
    } catch {
      return null;
    }
  }

  private async getGitTag(): Promise<string | null> {
    try {
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) return null;
      
      const tags = await this.git.tags(['--points-at', 'HEAD']);
      return tags.latest || null;
    } catch {
      return null;
    }
  }
}

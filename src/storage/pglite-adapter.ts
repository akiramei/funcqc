import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { FunctionInfo, SnapshotInfo, StorageAdapter, QueryOptions, QueryFilter, SnapshotDiff, BackupOptions, FunctionChange, ChangeDetail, DiffStatistics } from '../types';

interface DatabaseSchema {
  snapshots: {
    id: string;
    created_at: Date;
    label: string | null;
    git_commit: string | null;
    git_branch: string | null;
    git_tag: string | null;
    project_root: string;
    config_hash: string;
    metadata: {
      totalFunctions: number;
      totalFiles: number;
      avgComplexity: number;
      maxComplexity: number;
      exportedFunctions: number;
      asyncFunctions: number;
      complexityDistribution: Record<number, number>;
      fileExtensions: Record<string, number>;
    };
  };
  
  functions: {
    id: string;
    snapshot_id: string;
    name: string;
    display_name: string;
    signature: string;
    signature_hash: string;
    file_path: string;
    file_hash: string;
    start_line: number;
    end_line: number;
    start_column: number;
    end_column: number;
    ast_hash: string;
    is_exported: boolean;
    is_async: boolean;
    is_generator: boolean;
    is_arrow_function: boolean;
    is_method: boolean;
    is_constructor: boolean;
    is_static: boolean;
    access_modifier: string | null;
    parent_class: string | null;
    parent_namespace: string | null;
    js_doc: string | null;
    source_code: string | null;
    created_at: Date;
  };
  
  function_parameters: {
    id: number;
    function_id: string;
    name: string;
    type: string;
    type_simple: string;
    position: number;
    is_optional: boolean;
    is_rest: boolean;
    default_value: string | null;
    description: string | null;
  };
  
  quality_metrics: {
    function_id: string;
    lines_of_code: number;
    total_lines: number;
    cyclomatic_complexity: number;
    cognitive_complexity: number;
    max_nesting_level: number;
    parameter_count: number;
    return_statement_count: number;
    branch_count: number;
    loop_count: number;
    try_catch_count: number;
    async_await_count: number;
    callback_count: number;
    comment_lines: number;
    code_to_comment_ratio: number;
    halstead_volume: number | null;
    halstead_difficulty: number | null;
    maintainability_index: number | null;
  };
}

export class PGLiteStorageAdapter implements StorageAdapter {
  private db: PGlite;
  private kysely: Kysely<DatabaseSchema>;

  constructor(private dbPath: string) {
    this.db = new PGlite(dbPath);
    this.kysely = new Kysely({
      dialect: new PostgresDialect({
        pool: this.db as any
      })
    });
  }

  async init(): Promise<void> {
    await this.createSchema();
    await this.createIndexes();
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  private async createSchema(): Promise<void> {
    await this.db.exec(`
      -- Snapshots table
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        label TEXT,
        git_commit TEXT,
        git_branch TEXT,
        git_tag TEXT,
        project_root TEXT NOT NULL DEFAULT '',
        config_hash TEXT NOT NULL DEFAULT '',
        metadata JSONB DEFAULT '{}'::jsonb
      );

      -- Functions table
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
      );

      -- Function parameters table
      CREATE TABLE IF NOT EXISTS function_parameters (
        id SERIAL PRIMARY KEY,
        function_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        type_simple TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL,
        is_optional BOOLEAN DEFAULT FALSE,
        is_rest BOOLEAN DEFAULT FALSE,
        default_value TEXT,
        description TEXT,
        FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
      );

      -- Quality metrics table
      CREATE TABLE IF NOT EXISTS quality_metrics (
        function_id TEXT PRIMARY KEY,
        lines_of_code INTEGER NOT NULL DEFAULT 0,
        total_lines INTEGER NOT NULL DEFAULT 0,
        cyclomatic_complexity INTEGER NOT NULL DEFAULT 1,
        cognitive_complexity INTEGER NOT NULL DEFAULT 1,
        max_nesting_level INTEGER NOT NULL DEFAULT 1,
        parameter_count INTEGER NOT NULL DEFAULT 0,
        return_statement_count INTEGER NOT NULL DEFAULT 0,
        branch_count INTEGER NOT NULL DEFAULT 0,
        loop_count INTEGER NOT NULL DEFAULT 0,
        try_catch_count INTEGER NOT NULL DEFAULT 0,
        async_await_count INTEGER NOT NULL DEFAULT 0,
        callback_count INTEGER NOT NULL DEFAULT 0,
        comment_lines INTEGER NOT NULL DEFAULT 0,
        code_to_comment_ratio REAL NOT NULL DEFAULT 0,
        halstead_volume REAL,
        halstead_difficulty REAL,
        maintainability_index REAL,
        FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
      );
    `);
  }

  private async createIndexes(): Promise<void> {
    await this.db.exec(`
      -- Function indexes
      CREATE INDEX IF NOT EXISTS idx_functions_snapshot_id ON functions(snapshot_id);
      CREATE INDEX IF NOT EXISTS idx_functions_name ON functions(name);
      CREATE INDEX IF NOT EXISTS idx_functions_file_path ON functions(file_path);
      CREATE INDEX IF NOT EXISTS idx_functions_ast_hash ON functions(ast_hash);
      CREATE INDEX IF NOT EXISTS idx_functions_signature_hash ON functions(signature_hash);
      CREATE INDEX IF NOT EXISTS idx_functions_exported ON functions(is_exported) WHERE is_exported = TRUE;
      CREATE INDEX IF NOT EXISTS idx_functions_async ON functions(is_async) WHERE is_async = TRUE;
      
      -- Parameter indexes
      CREATE INDEX IF NOT EXISTS idx_parameters_function_id ON function_parameters(function_id);
      
      -- Quality metrics indexes
      CREATE INDEX IF NOT EXISTS idx_metrics_complexity ON quality_metrics(cyclomatic_complexity);
      CREATE INDEX IF NOT EXISTS idx_metrics_lines ON quality_metrics(lines_of_code);
      
      -- Snapshot indexes
      CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_snapshots_label ON snapshots(label);
      CREATE INDEX IF NOT EXISTS idx_snapshots_git_commit ON snapshots(git_commit);
    `);
  }

  async saveSnapshot(functions: FunctionInfo[], label?: string): Promise<string> {
    const snapshotId = this.generateSnapshotId();
    
    return await this.kysely.transaction().execute(async (trx) => {
      await this.createSnapshotRecord(trx, snapshotId, functions, label);
      await this.saveFunctionsBatch(trx, snapshotId, functions);
      return snapshotId;
    });
  }

  private generateSnapshotId(): string {
    return `snap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async createSnapshotRecord(
    trx: any,
    snapshotId: string,
    functions: FunctionInfo[],
    label?: string
  ): Promise<void> {
    const metadata = this.calculateSnapshotMetadata(functions);
    
    await trx
      .insertInto('snapshots')
      .values({
        id: snapshotId,
        label,
        git_commit: await this.getGitCommit(),
        git_branch: await this.getGitBranch(),
        git_tag: await this.getGitTag(),
        project_root: process.cwd(),
        config_hash: 'todo',
        metadata
      })
      .execute();
  }

  private async saveFunctionsBatch(
    trx: any,
    snapshotId: string,
    functions: FunctionInfo[]
  ): Promise<void> {
    const batchSize = 100;
    for (let i = 0; i < functions.length; i += batchSize) {
      const batch = functions.slice(i, i + batchSize);
      await this.insertFunctions(trx, snapshotId, batch);
      await this.insertParameters(trx, batch);
      await this.insertMetrics(trx, batch);
    }
  }

  private async insertFunctions(
    trx: any,
    snapshotId: string,
    functions: FunctionInfo[]
  ): Promise<void> {
    await trx
      .insertInto('functions')
      .values(functions.map(f => ({
        id: f.id,
        snapshot_id: snapshotId,
        name: f.name,
        display_name: f.displayName,
        signature: f.signature,
        signature_hash: f.signatureHash,
        file_path: f.filePath,
        file_hash: f.fileHash,
        start_line: f.startLine,
        end_line: f.endLine,
        start_column: f.startColumn || 0,
        end_column: f.endColumn || 0,
        ast_hash: f.astHash,
        is_exported: f.isExported,
        is_async: f.isAsync,
        is_generator: f.isGenerator || false,
        is_arrow_function: f.isArrowFunction || false,
        is_method: f.isMethod || false,
        is_constructor: f.isConstructor || false,
        is_static: f.isStatic || false,
        access_modifier: f.accessModifier || null,
        parent_class: f.parentClass || null,
        parent_namespace: f.parentNamespace || null,
        js_doc: f.jsDoc || null,
        source_code: f.sourceCode || null
      })))
      .execute();
  }

  private async insertParameters(trx: any, functions: FunctionInfo[]): Promise<void> {
    const paramInserts = functions.flatMap(f => 
      f.parameters.map(p => ({
        function_id: f.id,
        name: p.name,
        type: p.type,
        type_simple: p.typeSimple || '',
        position: p.position,
        is_optional: p.isOptional,
        is_rest: p.isRest || false,
        default_value: p.defaultValue || null,
        description: p.description || null
      }))
    );

    if (paramInserts.length > 0) {
      await trx
        .insertInto('function_parameters')
        .values(paramInserts)
        .execute();
    }
  }

  private async insertMetrics(trx: any, functions: FunctionInfo[]): Promise<void> {
    const metricsInserts = functions
      .filter(f => f.metrics)
      .map(f => ({
        function_id: f.id,
        lines_of_code: f.metrics!.linesOfCode,
        total_lines: f.metrics!.totalLines || f.metrics!.linesOfCode,
        cyclomatic_complexity: f.metrics!.cyclomaticComplexity,
        cognitive_complexity: f.metrics!.cognitiveComplexity,
        max_nesting_level: f.metrics!.maxNestingLevel,
        parameter_count: f.metrics!.parameterCount,
        return_statement_count: f.metrics!.returnStatementCount || 0,
        branch_count: f.metrics!.branchCount || 0,
        loop_count: f.metrics!.loopCount || 0,
        try_catch_count: f.metrics!.tryCatchCount || 0,
        async_await_count: f.metrics!.asyncAwaitCount || 0,
        callback_count: f.metrics!.callbackCount || 0,
        comment_lines: f.metrics!.commentLines || 0,
        code_to_comment_ratio: f.metrics!.codeToCommentRatio || 0,
        halstead_volume: f.metrics!.halsteadVolume || null,
        halstead_difficulty: f.metrics!.halsteadDifficulty || null,
        maintainability_index: f.metrics!.maintainabilityIndex || null
      }));

    if (metricsInserts.length > 0) {
      await trx
        .insertInto('quality_metrics')
        .values(metricsInserts)
        .execute();
    }
  }

  async getSnapshots(options?: QueryOptions): Promise<SnapshotInfo[]> {
    let query = this.kysely
      .selectFrom('snapshots')
      .selectAll()
      .orderBy('created_at', 'desc');

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.offset(options.offset);
    }

    const results = await query.execute();

    return results.map(row => ({
      id: row.id,
      createdAt: row.created_at.getTime(),
      label: row.label || undefined,
      gitCommit: row.git_commit || undefined,
      gitBranch: row.git_branch || undefined,
      gitTag: row.git_tag || undefined,
      projectRoot: row.project_root,
      configHash: row.config_hash,
      metadata: row.metadata
    }));
  }

  async getSnapshot(id: string): Promise<SnapshotInfo | null> {
    const result = await this.kysely
      .selectFrom('snapshots')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!result) return null;

    return {
      id: result.id,
      createdAt: result.created_at.getTime(),
      label: result.label || undefined,
      gitCommit: result.git_commit || undefined,
      gitBranch: result.git_branch || undefined,
      gitTag: result.git_tag || undefined,
      projectRoot: result.project_root,
      configHash: result.config_hash,
      metadata: result.metadata
    };
  }

  async deleteSnapshot(id: string): Promise<boolean> {
    const result = await this.kysely
      .deleteFrom('snapshots')
      .where('id', '=', id)
      .execute();

    return result.length > 0;
  }

  async getFunctions(snapshotId: string, options?: QueryOptions): Promise<FunctionInfo[]> {
    let query = this.kysely
      .selectFrom('functions')
      .leftJoin('quality_metrics', 'functions.id', 'quality_metrics.function_id')
      .selectAll('functions')
      .selectAll('quality_metrics')
      .where('functions.snapshot_id', '=', snapshotId);

    // Apply filters
    if (options?.filters) {
      for (const filter of options.filters) {
        query = this.applyFilter(query, filter);
      }
    }

    // Apply sorting
    if (options?.sort) {
      const [field, direction] = options.sort.split(':');
      query = query.orderBy(field as any, direction === 'desc' ? 'desc' : 'asc');
    } else {
      query = query.orderBy('functions.name');
    }

    // Apply pagination
    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.offset(options.offset);
    }

    const results = await query.execute();

    // Get parameters for all functions
    const functionIds = results.map(r => r.id);
    const parameters = await this.kysely
      .selectFrom('function_parameters')
      .selectAll()
      .where('function_id', 'in', functionIds)
      .orderBy(['function_id', 'position'])
      .execute();

    const parameterMap = new Map<string, typeof parameters>();
    for (const param of parameters) {
      if (!parameterMap.has(param.function_id)) {
        parameterMap.set(param.function_id, []);
      }
      parameterMap.get(param.function_id)!.push(param);
    }

    return results.map(row => this.mapToFunctionInfo(row, parameterMap.get(row.id) || []));
  }

  async queryFunctions(options?: QueryOptions): Promise<FunctionInfo[]> {
    // Get latest snapshot
    const latestSnapshot = await this.kysely
      .selectFrom('snapshots')
      .select('id')
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!latestSnapshot) {
      return [];
    }

    return this.getFunctions(latestSnapshot.id, options);
  }

  async diffSnapshots(fromId: string, toId: string): Promise<SnapshotDiff> {
    // Get snapshot information
    const [fromSnapshot, toSnapshot] = await Promise.all([
      this.getSnapshot(fromId),
      this.getSnapshot(toId)
    ]);

    if (!fromSnapshot || !toSnapshot) {
      throw new Error(`Snapshot not found: ${!fromSnapshot ? fromId : toId}`);
    }

    // Get functions from both snapshots
    const [fromFunctions, toFunctions] = await Promise.all([
      this.getFunctions(fromId),
      this.getFunctions(toId)
    ]);

    // Create maps for efficient lookup
    const fromMap = new Map(fromFunctions.map(f => [f.astHash, f]));
    const toMap = new Map(toFunctions.map(f => [f.astHash, f]));
    const fromSignatureMap = new Map(fromFunctions.map(f => [`${f.name}:${f.filePath}`, f]));
    const toSignatureMap = new Map(toFunctions.map(f => [`${f.name}:${f.filePath}`, f]));

    // Find added functions (exist in 'to' but not in 'from')
    const added = toFunctions.filter(f => !fromMap.has(f.astHash));

    // Find removed functions (exist in 'from' but not in 'to')
    const removed = fromFunctions.filter(f => !toMap.has(f.astHash));

    // Find unchanged functions (same AST hash)
    const unchanged = toFunctions.filter(f => fromMap.has(f.astHash));

    // Find modified functions (same name/file but different AST hash)
    const modified: FunctionChange[] = [];
    
    for (const toFunc of toFunctions) {
      const key = `${toFunc.name}:${toFunc.filePath}`;
      const fromFunc = fromSignatureMap.get(key);
      
      if (fromFunc && fromFunc.astHash !== toFunc.astHash) {
        const changes = this.analyzeChanges(fromFunc, toFunc);
        if (changes.length > 0) {
          modified.push({
            before: fromFunc,
            after: toFunc,
            changes
          });
        }
      }
    }

    // Calculate statistics
    const statistics = this.calculateDiffStatistics(added, removed, modified, fromFunctions, toFunctions);

    return {
      from: fromSnapshot,
      to: toSnapshot,
      added,
      removed,
      modified,
      unchanged,
      statistics
    };
  }

  async cleanup(retentionDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await this.kysely
      .deleteFrom('snapshots')
      .where('created_at', '<', cutoffDate)
      .execute();

    return result.length;
  }

  async backup(options: BackupOptions): Promise<string> {
    if (options.format === 'sql') {
      return this.createSQLBackup(options);
    } else {
      return this.createJSONBackup(options);
    }
  }

  async restore(backupData: string): Promise<void> {
    const data = JSON.parse(backupData);
    
    if (data.format === 'sql') {
      await this.restoreFromSQL(data.content);
    } else {
      await this.restoreFromJSON(data);
    }
  }

  private async createSQLBackup(options: BackupOptions): Promise<string> {
    const tables = ['snapshots', 'functions', 'function_parameters', 'quality_metrics'];
    let backup = `-- funcqc Database Backup\n-- Generated: ${new Date().toISOString()}\n\n`;

    // Add schema creation
    backup += `-- Schema\n`;
    backup += await this.getSchemaSQL();
    backup += '\n\n';

    // Export data from each table
    for (const table of tables) {
      backup += `-- Table: ${table}\n`;
      
      let query = this.kysely.selectFrom(table as any).selectAll();
      
      // Apply filters if specified
      if (options.filters) {
        for (const filter of options.filters) {
          query = this.applyFilter(query, filter);
        }
      }
      
      const rows = await query.execute();
      
      if (rows.length > 0) {
        const columns = Object.keys(rows[0]).join(', ');
        backup += `INSERT INTO ${table} (${columns}) VALUES\n`;
        
        const values = rows.map(row => {
          const vals = Object.values(row).map(val => {
            if (val === null) return 'NULL';
            if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
            if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
            return String(val);
          }).join(', ');
          return `  (${vals})`;
        }).join(',\n');
        
        backup += values + ';\n\n';
      }
    }

    return JSON.stringify({
      format: 'sql',
      timestamp: Date.now(),
      content: backup,
      options
    });
  }

  private async createJSONBackup(options: BackupOptions): Promise<string> {
    // Get all snapshots
    let snapshots = await this.getSnapshots();
    
    // Apply filters if specified
    if (options.filters) {
      // This is simplified - in a real implementation, we'd apply filters properly
      snapshots = snapshots.slice(0, 10); // Limit for demo
    }

    const backupData: any = {
      format: 'json',
      timestamp: Date.now(),
      version: '0.1.0',
      snapshots: [],
      options
    };

    // Export each snapshot with its functions
    for (const snapshot of snapshots) {
      const functions = await this.getFunctions(snapshot.id);
      
      // Optionally exclude source code
      if (!options.includeSourceCode) {
        functions.forEach(f => { f.sourceCode = undefined; });
      }

      backupData.snapshots.push({
        snapshot,
        functions
      });
    }

    return JSON.stringify(backupData, null, 2);
  }

  private async restoreFromSQL(sqlContent: string): Promise<void> {
    // Execute SQL statements
    const statements = sqlContent.split(';').filter(s => s.trim() && !s.trim().startsWith('--'));
    
    for (const statement of statements) {
      try {
        await this.db.exec(statement.trim());
      } catch (error) {
        console.warn(`Failed to execute SQL statement: ${statement.substring(0, 100)}...`, error);
      }
    }
  }

  private async restoreFromJSON(data: any): Promise<void> {
    if (!data.snapshots || !Array.isArray(data.snapshots)) {
      throw new Error('Invalid backup format: missing snapshots array');
    }

    for (const item of data.snapshots) {
      const { snapshot, functions } = item;
      
      try {
        // Insert snapshot
        await this.kysely
          .insertInto('snapshots')
          .values({
            id: snapshot.id,
            created_at: new Date(snapshot.createdAt),
            label: snapshot.label || null,
            git_commit: snapshot.gitCommit || null,
            git_branch: snapshot.gitBranch || null,
            git_tag: snapshot.gitTag || null,
            project_root: snapshot.projectRoot,
            config_hash: snapshot.configHash,
            metadata: snapshot.metadata
          })
          .onConflict('id')
          .doNothing()
          .execute();

        // Save functions
        if (functions && functions.length > 0) {
          await this.saveSnapshotFunctions(snapshot.id, functions);
        }
      } catch (error) {
        console.warn(`Failed to restore snapshot ${snapshot.id}:`, error);
      }
    }
  }

  private async saveSnapshotFunctions(snapshotId: string, functions: FunctionInfo[]): Promise<void> {
    const batchSize = 100;
    
    for (let i = 0; i < functions.length; i += batchSize) {
      const batch = functions.slice(i, i + batchSize);
      await this.insertFunctionsWithConflictHandling(snapshotId, batch);
      await this.insertParametersDirectly(batch);
      await this.insertMetricsDirectly(batch);
    }
  }

  private async insertFunctionsWithConflictHandling(
    snapshotId: string,
    functions: FunctionInfo[]
  ): Promise<void> {
    await this.kysely
      .insertInto('functions')
      .values(functions.map(f => ({
        id: f.id,
        snapshot_id: snapshotId,
        name: f.name,
        display_name: f.displayName,
        signature: f.signature,
        signature_hash: f.signatureHash,
        file_path: f.filePath,
        file_hash: f.fileHash,
        start_line: f.startLine,
        end_line: f.endLine,
        start_column: f.startColumn || 0,
        end_column: f.endColumn || 0,
        ast_hash: f.astHash,
        is_exported: f.isExported,
        is_async: f.isAsync,
        is_generator: f.isGenerator || false,
        is_arrow_function: f.isArrowFunction || false,
        is_method: f.isMethod || false,
        is_constructor: f.isConstructor || false,
        is_static: f.isStatic || false,
        access_modifier: f.accessModifier || null,
        parent_class: f.parentClass || null,
        parent_namespace: f.parentNamespace || null,
        js_doc: f.jsDoc || null,
        source_code: f.sourceCode || null
      })))
      .onConflict('id')
      .doNothing()
      .execute();
  }

  private async insertParametersDirectly(functions: FunctionInfo[]): Promise<void> {
    const paramInserts = functions.flatMap(f => 
      f.parameters.map(p => ({
        function_id: f.id,
        name: p.name,
        type: p.type,
        type_simple: p.typeSimple || '',
        position: p.position,
        is_optional: p.isOptional,
        is_rest: p.isRest || false,
        default_value: p.defaultValue || null,
        description: p.description || null
      }))
    );

    if (paramInserts.length > 0) {
      await this.kysely
        .insertInto('function_parameters')
        .values(paramInserts as any)
        .execute();
    }
  }

  private async insertMetricsDirectly(functions: FunctionInfo[]): Promise<void> {
    const metricsInserts = functions
      .filter(f => f.metrics)
      .map(f => ({
        function_id: f.id,
        lines_of_code: f.metrics!.linesOfCode,
        total_lines: f.metrics!.totalLines || f.metrics!.linesOfCode,
        cyclomatic_complexity: f.metrics!.cyclomaticComplexity,
        cognitive_complexity: f.metrics!.cognitiveComplexity,
        max_nesting_level: f.metrics!.maxNestingLevel,
        parameter_count: f.metrics!.parameterCount,
        return_statement_count: f.metrics!.returnStatementCount || 0,
        branch_count: f.metrics!.branchCount || 0,
        loop_count: f.metrics!.loopCount || 0,
        try_catch_count: f.metrics!.tryCatchCount || 0,
        async_await_count: f.metrics!.asyncAwaitCount || 0,
        callback_count: f.metrics!.callbackCount || 0,
        comment_lines: f.metrics!.commentLines || 0,
        code_to_comment_ratio: f.metrics!.codeToCommentRatio || 0,
        halstead_volume: f.metrics!.halsteadVolume || null,
        halstead_difficulty: f.metrics!.halsteadDifficulty || null,
        maintainability_index: f.metrics!.maintainabilityIndex || null
      }));

    if (metricsInserts.length > 0) {
      await this.kysely
        .insertInto('quality_metrics')
        .values(metricsInserts as any)
        .execute();
    }
  }

  private async getSchemaSQL(): Promise<string> {
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
        metadata JSONB DEFAULT '{}'::jsonb
      );

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
      );

      CREATE TABLE IF NOT EXISTS function_parameters (
        id SERIAL PRIMARY KEY,
        function_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        type_simple TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL,
        is_optional BOOLEAN DEFAULT FALSE,
        is_rest BOOLEAN DEFAULT FALSE,
        default_value TEXT,
        description TEXT,
        FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS quality_metrics (
        function_id TEXT PRIMARY KEY,
        lines_of_code INTEGER NOT NULL DEFAULT 0,
        total_lines INTEGER NOT NULL DEFAULT 0,
        cyclomatic_complexity INTEGER NOT NULL DEFAULT 1,
        cognitive_complexity INTEGER NOT NULL DEFAULT 1,
        max_nesting_level INTEGER NOT NULL DEFAULT 1,
        parameter_count INTEGER NOT NULL DEFAULT 0,
        return_statement_count INTEGER NOT NULL DEFAULT 0,
        branch_count INTEGER NOT NULL DEFAULT 0,
        loop_count INTEGER NOT NULL DEFAULT 0,
        try_catch_count INTEGER NOT NULL DEFAULT 0,
        async_await_count INTEGER NOT NULL DEFAULT 0,
        callback_count INTEGER NOT NULL DEFAULT 0,
        comment_lines INTEGER NOT NULL DEFAULT 0,
        code_to_comment_ratio REAL NOT NULL DEFAULT 0,
        halstead_volume REAL,
        halstead_difficulty REAL,
        maintainability_index REAL,
        FOREIGN KEY (function_id) REFERENCES functions(id) ON DELETE CASCADE
      );
    `;
  }

  private applyFilter(query: any, filter: QueryFilter): any {
    const { field, operator, value } = filter;
    
    switch (operator) {
      case '=':
        return query.where(field, '=', value);
      case '!=':
        return query.where(field, '!=', value);
      case '>':
        return query.where(field, '>', value);
      case '>=':
        return query.where(field, '>=', value);
      case '<':
        return query.where(field, '<', value);
      case '<=':
        return query.where(field, '<=', value);
      case 'LIKE':
        return query.where(field, 'ilike', value);
      case 'IN':
        return query.where(field, 'in', value);
      default:
        return query;
    }
  }

  private mapToFunctionInfo(row: any, parameters: any[] = []): FunctionInfo {
    return {
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
      accessModifier: row.access_modifier || undefined,
      parentClass: row.parent_class || undefined,
      parentNamespace: row.parent_namespace || undefined,
      jsDoc: row.js_doc || undefined,
      sourceCode: row.source_code || undefined,
      parameters: parameters.map(p => ({
        name: p.name,
        type: p.type,
        typeSimple: p.type_simple,
        position: p.position,
        isOptional: p.is_optional,
        isRest: p.is_rest,
        defaultValue: p.default_value || undefined,
        description: p.description || undefined
      })),
      metrics: row.lines_of_code !== null ? {
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
        halsteadVolume: row.halstead_volume,
        halsteadDifficulty: row.halstead_difficulty,
        maintainabilityIndex: row.maintainability_index
      } : undefined
    };
  }

  private analyzeChanges(before: FunctionInfo, after: FunctionInfo): ChangeDetail[] {
    const changes: ChangeDetail[] = [];

    // Check scalar field changes
    this.addScalarFieldChanges(before, after, changes);
    
    // Check metric changes
    this.addMetricChanges(before, after, changes);

    return changes;
  }

  private addScalarFieldChanges(before: FunctionInfo, after: FunctionInfo, changes: ChangeDetail[]): void {
    const fieldChecks = [
      { field: 'signature', oldValue: before.signature, newValue: after.signature, impact: 'high' as const },
      { field: 'accessModifier', oldValue: before.accessModifier || 'public', newValue: after.accessModifier || 'public', impact: 'medium' as const },
      { field: 'isAsync', oldValue: before.isAsync, newValue: after.isAsync, impact: 'high' as const },
      { field: 'isExported', oldValue: before.isExported, newValue: after.isExported, impact: 'high' as const }
    ];

    for (const check of fieldChecks) {
      if (check.oldValue !== check.newValue) {
        changes.push({
          field: check.field,
          oldValue: check.oldValue,
          newValue: check.newValue,
          impact: check.impact
        });
      }
    }
  }

  private addMetricChanges(before: FunctionInfo, after: FunctionInfo, changes: ChangeDetail[]): void {
    if (!before.metrics || !after.metrics) return;

    const metricChecks = [
      {
        field: 'cyclomaticComplexity',
        oldValue: before.metrics.cyclomaticComplexity,
        newValue: after.metrics.cyclomaticComplexity,
        getImpact: (diff: number) => Math.abs(diff) > 2 ? 'high' as const : diff > 0 ? 'medium' as const : 'low' as const
      },
      {
        field: 'linesOfCode',
        oldValue: before.metrics.linesOfCode,
        newValue: after.metrics.linesOfCode,
        getImpact: (diff: number) => Math.abs(diff) > 20 ? 'high' as const : Math.abs(diff) > 5 ? 'medium' as const : 'low' as const
      },
      {
        field: 'parameterCount',
        oldValue: before.metrics.parameterCount,
        newValue: after.metrics.parameterCount,
        getImpact: () => 'medium' as const
      }
    ];

    for (const check of metricChecks) {
      const diff = check.newValue - check.oldValue;
      if (diff !== 0) {
        changes.push({
          field: check.field,
          oldValue: check.oldValue,
          newValue: check.newValue,
          impact: check.getImpact(diff)
        });
      }
    }
  }

  private calculateDiffStatistics(
    added: FunctionInfo[], 
    removed: FunctionInfo[], 
    modified: FunctionChange[],
    fromFunctions: FunctionInfo[],
    toFunctions: FunctionInfo[]
  ): DiffStatistics {
    const totalChanges = added.length + removed.length + modified.length;
    
    // Calculate complexity change
    const fromComplexity = fromFunctions.reduce((sum, f) => sum + (f.metrics?.cyclomaticComplexity || 1), 0);
    const toComplexity = toFunctions.reduce((sum, f) => sum + (f.metrics?.cyclomaticComplexity || 1), 0);
    const complexityChange = toComplexity - fromComplexity;

    // Calculate lines change
    const fromLines = fromFunctions.reduce((sum, f) => sum + (f.metrics?.linesOfCode || 0), 0);
    const toLines = toFunctions.reduce((sum, f) => sum + (f.metrics?.linesOfCode || 0), 0);
    const linesChange = toLines - fromLines;

    return {
      totalChanges,
      addedCount: added.length,
      removedCount: removed.length,
      modifiedCount: modified.length,
      complexityChange,
      linesChange
    };
  }

  private calculateSnapshotMetadata(functions: FunctionInfo[]) {
    const totalFunctions = functions.length;
    const totalFiles = new Set(functions.map(f => f.filePath)).size;
    const exportedFunctions = functions.filter(f => f.isExported).length;
    const asyncFunctions = functions.filter(f => f.isAsync).length;
    
    const complexities = functions.map(f => f.metrics?.cyclomaticComplexity || 1);
    const avgComplexity = complexities.reduce((a, b) => a + b, 0) / totalFunctions;
    const maxComplexity = Math.max(...complexities);
    
    // Complexity distribution
    const complexityDistribution: Record<number, number> = {};
    complexities.forEach(c => {
      complexityDistribution[c] = (complexityDistribution[c] || 0) + 1;
    });
    
    // File extensions
    const fileExtensions: Record<string, number> = {};
    functions.forEach(f => {
      const ext = '.' + f.filePath.split('.').pop();
      fileExtensions[ext] = (fileExtensions[ext] || 0) + 1;
    });

    return {
      totalFunctions,
      totalFiles,
      avgComplexity: Math.round(avgComplexity * 100) / 100,
      maxComplexity,
      exportedFunctions,
      asyncFunctions,
      complexityDistribution,
      fileExtensions
    };
  }

  private async getGitCommit(): Promise<string | null> {
    try {
      const { execSync } = require('child_process');
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  }

  private async getGitBranch(): Promise<string | null> {
    try {
      const { execSync } = require('child_process');
      return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  }

  private async getGitTag(): Promise<string | null> {
    try {
      const { execSync } = require('child_process');
      return execSync('git describe --tags --exact-match HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  }
}

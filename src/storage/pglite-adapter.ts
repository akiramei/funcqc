import { PGlite } from '@electric-sql/pglite';
import { 
  Kysely, 
  DatabaseConnection, 
  CompiledQuery, 
  QueryResult,
  Driver,
  Dialect,
  PostgresQueryCompiler,
  PostgresIntrospector,
  PostgresAdapter
} from 'kysely';
import simpleGit, { SimpleGit } from 'simple-git';
import * as path from 'path';
import { readFileSync, existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { EmbeddingService } from '../services/embedding-service';
import { ANNConfig } from '../services/ann-index';
import {
  FunctionInfo,
  SnapshotInfo,
  StorageAdapter,
  QueryOptions,
  SnapshotMetadata,
  SnapshotDiff,
  FunctionChange,
  ChangeDetail,
  DiffStatistics,
  SnapshotRow,
  FunctionRow,
  ParameterRow,
  MetricsRow,
  ParameterInfo,
  QualityMetrics,
  FunctionDescription,
  NamingEvaluation,
  Lineage,
  LineageKind,
  LineageStatus,
  LineageQuery,
  RefactoringSession,
  RefactoringChangeset,
  RefactoringIntent,
  CallEdge,
  CallEdgeRow,
} from '../types';
import {
  BatchProcessor,
  TransactionalBatchProcessor,
  BatchTransactionProcessor,
} from '../utils/batch-processor';
import { ErrorCode } from '../utils/error-handler';

// PGlite Kysely Dialect Implementation
interface PGliteDialectConfig {
  database: PGlite;
}

class PGliteConnection implements DatabaseConnection {
  readonly #config: PGliteDialectConfig;

  public constructor(config: PGliteDialectConfig) {
    this.#config = config;
  }

  public async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const results = await this.#config.database.query(
      compiledQuery.sql,
      [...compiledQuery.parameters],
    );

    return {
      rows: results.rows as R[],
      ...(results.affectedRows
        ? { numAffectedRows: BigInt(results.affectedRows) }
        : {}),
    };
  }

  public async *streamQuery<R>(
    _compiledQuery: CompiledQuery,
    _chunkSize?: number
  ): AsyncIterableIterator<QueryResult<R>> {
    throw new Error(`PGliteDriver doesn't support streaming.`);
  }
}

class PGliteDriver implements Driver {
  readonly #config: PGliteDialectConfig;

  constructor(config: PGliteDialectConfig) {
    this.#config = config;
  }

  async init(): Promise<void> {
    // PGliteは既に初期化済みなので何もしない
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new PGliteConnection(this.#config);
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('BEGIN'));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('COMMIT'));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('ROLLBACK'));
  }

  async releaseConnection(): Promise<void> {
    // PGliteはコネクションプールを持たないので何もしない
  }

  async destroy(): Promise<void> {
    // PGliteの破棄は外部で管理されるので何もしない
  }
}

class PGliteDialect implements Dialect {
  readonly #config: PGliteDialectConfig;

  constructor(config: PGliteDialectConfig) {
    this.#config = config;
  }

  createDriver(): Driver {
    return new PGliteDriver(this.#config);
  }

  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }

  createAdapter() {
    return new PostgresAdapter();
  }

  createIntrospector(db: Kysely<Database>) {
    return new PostgresIntrospector(db);
  }
}

// Kysely database types
interface CallEdgeTable {
  id: string;
  snapshot_id: string;
  caller_function_id: string;
  callee_function_id: string | null;
  callee_name: string;
  callee_signature: string | null;
  caller_class_name: string | null;
  callee_class_name: string | null;
  call_type: string;
  call_context: string | null;
  line_number: number;
  column_number: number;
  is_async: boolean;
  is_chained: boolean;
  confidence_score: number;
  metadata: object;
  created_at: string;
}

interface InternalCallEdgeTable {
  id: string;
  snapshot_id: string;
  file_path: string;
  caller_function_id: string;
  callee_function_id: string;
  caller_name: string;
  callee_name: string;
  caller_class_name: string | null;
  callee_class_name: string | null;
  line_number: number;
  column_number: number;
  call_type: 'direct' | 'conditional' | 'async' | 'dynamic' | null;
  call_context: string | null;
  confidence_score: number;
  detected_by: string;
  created_at: string;
}

interface Database {
  call_edges: CallEdgeTable;
  internal_call_edges: InternalCallEdgeTable;
  // 他のテーブルは必要に応じて追加
}

import {
  prepareBulkInsertData,
  generateBulkInsertSQL,
  splitIntoBatches,
  calculateOptimalBatchSize,
} from './bulk-insert-utils';

/**
 * Custom error class for database operations with ErrorCode
 */
export class DatabaseError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/**
 * Type guard for checking if global has test tracking properties
 */
function hasTestTrackingProperty(obj: unknown, property: string): obj is Record<string, unknown> {
  return obj !== null && typeof obj === 'object' && property in obj;
}

/**
 * Type guard for test connection tracking functions
 */
function isTestTrackingFunction(value: unknown): value is (connection: { close(): Promise<void> }) => void {
  return typeof value === 'function';
}

/**
 * Database row types for refactoring health engine
 */
interface RefactoringChangesetRow {
  id: string;
  session_id: string;
  operation_type: string;
  intent: string;
  parent_function_id: string | null;
  child_function_ids: string | string[];
  before_snapshot_id: string;
  after_snapshot_id: string;
  health_assessment: string | null;
  improvement_metrics: string | null;
  is_genuine_improvement: boolean | null;
  function_explosion_score: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Clean PGLite storage adapter implementation
 * Focuses on type safety, proper error handling, and clean architecture
 */
export class PGLiteStorageAdapter implements StorageAdapter {
  private db: PGlite;
  private kysely!: Kysely<Database>; // init()で初期化される
  private git: SimpleGit;
  private transactionDepth: number = 0;
  private dbPath: string;
  private originalDbPath: string;
  private logger: { log: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void } | undefined;

  // Static cache to avoid redundant schema checks across instances
  private static schemaCache = new Map<string, boolean>();
  private isInitialized: boolean = false;

  constructor(dbPath: string, logger?: { log: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }) {
    // Validate input path
    this.validateDbPath(dbPath);
    this.logger = logger;

    // Store original path for directory check logic
    this.originalDbPath = dbPath;
    // パスを正規化してキャッシュの一貫性を保証
    this.dbPath = path.resolve(dbPath);
    this.db = new PGlite(dbPath);
    // Kyselyは非同期初期化なので、後でinit()で設定
    this.git = simpleGit();
    
    // Track connection in tests for proper cleanup
    if (typeof global !== 'undefined' && hasTestTrackingProperty(global, '__TEST_TRACK_CONNECTION__')) {
      const testTracker = global.__TEST_TRACK_CONNECTION__;
      if (isTestTrackingFunction(testTracker)) {
        testTracker(this);
      }
    }
  }

  /**
   * Validates the database path to prevent filesystem pollution
   */
  private validateDbPath(dbPath: string): void {
    if (!dbPath || typeof dbPath !== 'string') {
      throw new DatabaseError(
        ErrorCode.DATABASE_NOT_INITIALIZED,
        'Database path must be a non-empty string'
      );
    }

    // Allow PostgreSQL connection strings
    if (dbPath.startsWith('postgres://') || dbPath.startsWith('postgresql://')) {
      return;
    }

    // Prevent Windows drive letters only (which would create invalid directories)
    const isWindowsDriveOnly = /^[A-Za-z]:$/.test(dbPath);
    if (isWindowsDriveOnly) {
      throw new DatabaseError(
        ErrorCode.DATABASE_NOT_INITIALIZED,
        `Invalid database path: '${dbPath}'. Drive letters alone are not valid database paths. Use a full path like 'C:\\path\\to\\database.db'`
      );
    }

    // Prevent paths with leading/trailing whitespace
    if (dbPath.trim() !== dbPath) {
      throw new DatabaseError(
        ErrorCode.DATABASE_NOT_INITIALIZED,
        `Invalid database path: '${dbPath}'. Path cannot have leading or trailing whitespace`
      );
    }

    // Comprehensive Windows path validation when dealing with file paths
    // Only validate if it's not a connection string
    if (!dbPath.includes('://')) {
      this.validateWindowsFilePath(dbPath);
    }

    // Ensure path has a reasonable length
    if (dbPath.length > 260) {
      // Windows MAX_PATH limit
      throw new DatabaseError(
        ErrorCode.DATABASE_NOT_INITIALIZED,
        `Database path too long: ${dbPath.length} characters. Maximum allowed: 260`
      );
    }
  }

  /**
   * Comprehensive Windows file path validation
   * Checks for all Windows-invalid characters and path patterns when on Windows
   */
  private validateWindowsFilePath(filePath: string): void {
    // Only apply Windows validation on Windows platform or for Windows-style paths
    const isWindowsPath = /^[A-Za-z]:[\\\/]/.test(filePath) || process.platform === 'win32';
    
    // Allow Unix-style paths on non-Windows platforms
    if (!isWindowsPath && filePath.startsWith('/')) {
      return; // Unix absolute path is valid
    }
    
    // Allow relative paths with . and .. as they are valid on all platforms
    if (filePath.startsWith('./') || filePath.startsWith('../')) {
      return; // Valid relative paths
    }
    
    // Allow special paths like :memory: for testing purposes (they will fail at filesystem level if problematic)
    if (filePath.startsWith(':')) {
      // Log warning but allow it - the error will manifest during actual filesystem operations
      this.logger?.warn(`Warning: Path '${filePath}' may not be supported on Windows due to colon character`);
      return;
    }
    
    // Windows invalid characters: < > " | ? * and control characters (0-31)
    // Exclude colon from this check as we handle it separately
    const invalidChars = /[<>"|?*\x00-\x1f]/;
    
    // Special handling for drive letters: allow C:\ but not C: alone
    const isDriveWithBackslash = /^[A-Za-z]:[\\\/]/.test(filePath);
    
    // For Windows paths, check colon usage
    if (isWindowsPath && !isDriveWithBackslash && filePath.includes(':')) {
      throw new DatabaseError(
        ErrorCode.DATABASE_NOT_INITIALIZED,
        `Invalid database path: '${filePath}'. Colon (:) is not allowed in Windows file paths except for drive letters (e.g., C:\\path)`
      );
    }
    
    // Check for other invalid characters
    const match = filePath.match(invalidChars);
    if (match) {
      const invalidChar = match[0];
      const charCode = invalidChar.charCodeAt(0);
      const charName = charCode < 32 ? `control character (${charCode})` : `'${invalidChar}'`;
      
      throw new DatabaseError(
        ErrorCode.DATABASE_NOT_INITIALIZED,
        `Invalid database path: '${filePath}'. Contains Windows-invalid character: ${charName}`
      );
    }
    
    // Only check Windows-specific restrictions for Windows paths
    if (isWindowsPath) {
      // Check for reserved Windows names
      const pathParts = filePath.split(/[\\\/]/);
      const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
      
      for (const part of pathParts) {
        if (part && reservedNames.test(part)) {
          throw new DatabaseError(
            ErrorCode.DATABASE_NOT_INITIALIZED,
            `Invalid database path: '${filePath}'. Contains reserved Windows name: '${part}'`
          );
        }
      }
      
      // Check for trailing periods or spaces in path components (Windows restriction)
      for (const part of pathParts) {
        if (part && part !== '.' && part !== '..' && (part.endsWith('.') || part.endsWith(' '))) {
          throw new DatabaseError(
            ErrorCode.DATABASE_NOT_INITIALIZED,
            `Invalid database path: '${filePath}'. Path component '${part}' cannot end with period or space on Windows`
          );
        }
      }
    }
  }

  /**
   * Determines if we should check for database directory existence
   * Handles Windows drive letters (C:) and connection strings
   */
  private shouldCheckDatabaseDirectory(originalPath: string): boolean {
    // Skip check for PostgreSQL-style connection strings
    if (originalPath.startsWith('postgres://') || originalPath.startsWith('postgresql://')) {
      return false;
    }

    // For Windows: Check if it's a valid file path (not just a drive letter)
    // Valid examples: C:\path\to\db, /path/to/db, ./relative/path
    // Invalid examples: C:, D:, etc.
    const isWindowsDriveOnly = /^[A-Za-z]:$/.test(originalPath);
    if (isWindowsDriveOnly) {
      return false;
    }

    return true;
  }

  async init(): Promise<void> {
    try {
      // Check if database path exists (only check for directory-based databases)
      if (this.shouldCheckDatabaseDirectory(this.originalDbPath)) {
        const dbDir = path.dirname(this.dbPath);
        if (!existsSync(dbDir)) {
          throw new DatabaseError(
            ErrorCode.DATABASE_NOT_INITIALIZED,
            'Database directory not found. funcqc needs to be initialized first.',
            new Error(`Database directory does not exist: ${dbDir}`)
          );
        }
      }

      await this.db.waitReady;

      // Initialize Kysely after PGlite is ready
      const dialect = new PGliteDialect({ database: this.db });
      this.kysely = new Kysely<Database>({ dialect });

      // Use cache to avoid redundant schema initialization
      if (!PGLiteStorageAdapter.schemaCache.has(this.dbPath)) {
        // 同期的にキャッシュに追加して競合を防ぐ
        PGLiteStorageAdapter.schemaCache.set(this.dbPath, true);
        try {
          await this.createSchema();
        } catch (error) {
          // エラーが発生した場合はキャッシュから削除
          PGLiteStorageAdapter.schemaCache.delete(this.dbPath);
          throw error;
        }
      }
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw error;
      }

      // Check if it's a database not found error
      if (error instanceof Error && error.message.includes('does not exist')) {
        throw new DatabaseError(
          ErrorCode.DATABASE_NOT_INITIALIZED,
          'Database not found. funcqc needs to be initialized first.',
          error
        );
      }

      throw new DatabaseError(
        ErrorCode.DATABASE_CONNECTION_FAILED,
        `Failed to initialize database: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async close(): Promise<void> {
    // Guard against invalid context or already closed connections
    if (!this || typeof this !== 'object') {
      return; // Invalid context
    }

    // Always untrack connection first to prevent cleanup loops
    if (typeof global !== 'undefined' && hasTestTrackingProperty(global, '__TEST_UNTRACK_CONNECTION__')) {
      const testUntracker = global.__TEST_UNTRACK_CONNECTION__;
      if (isTestTrackingFunction(testUntracker)) {
        testUntracker(this);
      }
    }

    try {
      // Safely check for database property existence
      const db = this.db;
      if (!db) {
        return; // Already closed or never initialized
      }

      // Check if database is valid and has close method
      if (typeof db === 'object' && db !== null && typeof db.close === 'function') {
        // Check if already closed (if the property exists)
        const isClosed = 'closed' in db ? (db as { closed: boolean }).closed : false;
        
        if (!isClosed) {
          await db.close();
        }
      }
    } catch (error) {
      // Silently handle all cleanup errors to prevent test suite disruption
      // Only log non-trivial errors for debugging purposes
      if (error instanceof Error && 
          !error.message.includes('already closed') && 
          !error.message.includes('Cannot read properties') &&
          !error.message.includes('undefined')) {
        console.warn(`Database close warning: ${error.message}`);
      }
    } finally {
      // Clear the reference to prevent further attempts (if context is valid)
      try {
        if (this && typeof this === 'object') {
          // Set db to null to prevent further close attempts
          Object.defineProperty(this, 'db', { value: null, writable: true });
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // ========================================
  // SNAPSHOT OPERATIONS
  // ========================================

  async saveSnapshot(
    functions: FunctionInfo[],
    label?: string,
    comment?: string,
    configHash?: string
  ): Promise<string> {
    const snapshotId = this.generateSnapshotId();

    try {
      // Execute entire snapshot creation in a single transaction
      await this.executeInTransaction(async () => {
        // Create snapshot record
        await this.createSnapshotRecord(
          snapshotId,
          functions,
          configHash || 'unknown',
          label,
          comment
        );

        // Save functions in batch
        await this.saveFunctions(snapshotId, functions);
      });

      return snapshotId;
    } catch (error) {
      throw new Error(
        `Failed to save snapshot: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getSnapshots(options?: QueryOptions): Promise<SnapshotInfo[]> {
    await this.ensureInitialized();
    
    try {
      let sql = 'SELECT * FROM snapshots ORDER BY created_at DESC';
      const params: (string | number)[] = [];

      if (options?.limit) {
        sql += ' LIMIT $' + (params.length + 1);
        params.push(options.limit);
      }

      if (options?.offset) {
        sql += ' OFFSET $' + (params.length + 1);
        params.push(options.offset);
      }

      const result = await this.db.query(sql, params);

      return result.rows.map(row => this.mapRowToSnapshotInfo(row as SnapshotRow));
    } catch (error) {
      throw new Error(
        `Failed to get snapshots: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getSnapshot(id: string): Promise<SnapshotInfo | null> {
    await this.ensureInitialized();
    try {
      const result = await this.db.query('SELECT * FROM snapshots WHERE id = $1', [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToSnapshotInfo(result.rows[0] as SnapshotRow);
    } catch (error) {
      throw new Error(
        `Failed to get snapshot: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async deleteSnapshot(id: string): Promise<boolean> {
    await this.ensureInitialized();
    try {
      const result = await this.db.query('DELETE FROM snapshots WHERE id = $1', [id]);
      return (result as unknown as { changes: number }).changes > 0;
    } catch (error) {
      throw new Error(
        `Failed to delete snapshot: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get the latest snapshot
   */
  async getLatestSnapshot(): Promise<SnapshotInfo | null> {
    try {
      const result = await this.db.query(`
        SELECT * FROM snapshots 
        ORDER BY created_at DESC 
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToSnapshotInfo(result.rows[0] as SnapshotRow);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get latest snapshot: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get the config hash from the most recent snapshot
   * Returns null if no snapshots exist
   */
  async getLastConfigHash(): Promise<string | null> {
    await this.ensureInitialized();
    try {
      const result = await this.db.query(
        'SELECT config_hash FROM snapshots ORDER BY created_at DESC LIMIT 1'
      );

      if (result.rows.length === 0) {
        return null;
      }

      return (result.rows[0] as { config_hash: string }).config_hash;
    } catch (error) {
      throw new Error(
        `Failed to get last config hash: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ========================================
  // FUNCTION OPERATIONS
  // ========================================

  async getFunctions(snapshotId: string, options?: QueryOptions): Promise<FunctionInfo[]> {
    await this.ensureInitialized();
    try {
      let sql = `
        SELECT 
          f.id, f.semantic_id, f.content_id, f.snapshot_id, f.name, f.display_name, 
          f.signature, f.signature_hash, f.file_path, f.file_hash, f.start_line, f.end_line,
          f.start_column, f.end_column, f.ast_hash, f.context_path, f.function_type, 
          f.modifiers, f.nesting_level, f.is_exported, f.is_async, f.is_generator,
          f.is_arrow_function, f.is_method, f.is_constructor, f.is_static, 
          f.access_modifier, f.source_code, f.created_at,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.max_nesting_level, q.parameter_count, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.comment_lines, q.code_to_comment_ratio, q.halstead_volume, q.halstead_difficulty,
          q.maintainability_index
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        WHERE f.snapshot_id = $1
      `;
      const params: (string | number | unknown)[] = [snapshotId];

      // Add filters if provided
      if (options?.filters && options.filters.length > 0) {
        // Create field mapping for proper table aliases
        const fieldMapping = new Map([
          // Functions table fields (f alias)
          ['name', 'f.name'],
          ['file_path', 'f.file_path'],
          ['start_line', 'f.start_line'],
          ['is_exported', 'f.is_exported'],
          ['is_async', 'f.is_async'],
          ['display_name', 'f.display_name'],
          // Quality metrics table fields (q alias)
          ['cyclomatic_complexity', 'q.cyclomatic_complexity'],
          ['cognitive_complexity', 'q.cognitive_complexity'],
          ['lines_of_code', 'q.lines_of_code'],
          ['total_lines', 'q.total_lines'],
          ['parameter_count', 'q.parameter_count'],
          ['max_nesting_level', 'q.max_nesting_level'],
          ['return_statement_count', 'q.return_statement_count'],
          ['branch_count', 'q.branch_count'],
          ['loop_count', 'q.loop_count'],
          ['try_catch_count', 'q.try_catch_count'],
          ['async_await_count', 'q.async_await_count'],
          ['callback_count', 'q.callback_count'],
          ['comment_lines', 'q.comment_lines'],
          ['code_to_comment_ratio', 'q.code_to_comment_ratio'],
          ['halstead_volume', 'q.halstead_volume'],
          ['halstead_difficulty', 'q.halstead_difficulty'],
          ['maintainability_index', 'q.maintainability_index'],
        ]);

        const filterClauses = options.filters.map(filter => {
          if (filter.operator === 'KEYWORD') {
            // Handle keyword search across multiple fields
            params.push(`%${filter.value}%`);
            params.push(`%${filter.value}%`);
            return `(
              f.name ILIKE $${params.length - 1} OR 
              f.source_code ILIKE $${params.length}
            )`;
          } else {
            // Use field mapping to get correct table alias and column name
            const mappedField = fieldMapping.get(filter.field) || `f.${filter.field}`;
            params.push(filter.value);
            return `${mappedField} ${filter.operator} $${params.length}`;
          }
        });
        sql += ' AND ' + filterClauses.join(' AND ');
      }

      // Add sorting with validation and proper field mapping
      const validSortFields = new Map([
        ['name', 'f.name'],
        ['file_path', 'f.file_path'],
        ['start_line', 'f.start_line'],
        ['complexity', 'q.cyclomatic_complexity'],
        ['lines_of_code', 'q.lines_of_code'],
        ['parameter_count', 'q.parameter_count'],
        ['is_exported', 'f.is_exported'],
        ['is_async', 'f.is_async'],
        ['display_name', 'f.display_name'],
      ]);

      // Handle multi-field sorting (e.g., 'file_path,start_line')
      let orderByClause = 'f.start_line'; // default

      if (options?.sort) {
        const sortFields = options.sort.split(',').map(field => field.trim());
        const validOrderByFields: string[] = [];

        for (const field of sortFields) {
          if (validSortFields.has(field)) {
            validOrderByFields.push(validSortFields.get(field)!);
          }
        }

        if (validOrderByFields.length > 0) {
          orderByClause = validOrderByFields.join(', ');
        }
      }

      sql += ` ORDER BY ${orderByClause}`;

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
        result.rows.map(async row => {
          const parameters = await this.getFunctionParameters((row as FunctionRow).id);
          return this.mapRowToFunctionInfo(row as FunctionRow & Partial<MetricsRow>, parameters);
        })
      );

      return functions;
    } catch (error) {
      throw new Error(
        `Failed to get functions: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getFunctionsBySnapshot(snapshotId: string): Promise<FunctionInfo[]> {
    try {
      const result = await this.db.query(
        `
        SELECT 
          f.id, f.semantic_id, f.content_id, f.snapshot_id, f.name, f.display_name, 
          f.signature, f.signature_hash, f.file_path, f.file_hash, f.start_line, f.end_line,
          f.start_column, f.end_column, f.ast_hash, f.context_path, f.function_type, 
          f.modifiers, f.nesting_level, f.is_exported, f.is_async, f.is_generator,
          f.is_arrow_function, f.is_method, f.is_constructor, f.is_static, 
          f.access_modifier, f.source_code, f.created_at,
          qm.lines_of_code, qm.total_lines, qm.cyclomatic_complexity, qm.cognitive_complexity,
          qm.max_nesting_level, qm.parameter_count, qm.return_statement_count, qm.branch_count,
          qm.loop_count, qm.try_catch_count, qm.async_await_count, qm.callback_count,
          qm.comment_lines, qm.code_to_comment_ratio, qm.halstead_volume, qm.halstead_difficulty,
          qm.maintainability_index
        FROM functions f
        LEFT JOIN quality_metrics qm ON f.id = qm.function_id
        WHERE f.snapshot_id = $1
        ORDER BY f.start_line
      `,
        [snapshotId]
      );

      // Get parameters for each function
      const functions = await Promise.all(
        result.rows.map(async row => {
          const parameters = await this.getFunctionParameters((row as FunctionRow).id);
          return this.mapRowToFunctionInfo(row as FunctionRow & Partial<MetricsRow>, parameters);
        })
      );

      return functions;
    } catch (error) {
      throw new Error(
        `Failed to get functions for snapshot: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async queryFunctions(options?: QueryOptions): Promise<FunctionInfo[]> {
    await this.ensureInitialized();
    try {
      // Get the latest snapshot
      const snapshots = await this.getSnapshots({ sort: 'created_at', limit: 1 });
      if (snapshots.length === 0) {
        return [];
      }

      // Use the latest snapshot to get functions
      return await this.getFunctions(snapshots[0].id, options);
    } catch (error) {
      throw new Error(
        `Failed to query functions: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ========================================
  // ANALYSIS OPERATIONS (FUTURE)
  // ========================================

  async diffSnapshots(fromId: string, toId: string): Promise<SnapshotDiff> {
    await this.ensureInitialized();
    try {
      const { fromSnapshot, toSnapshot } = await this.validateAndLoadSnapshots(fromId, toId);
      const { fromFunctions, toFunctions } = await this.loadSnapshotFunctions(fromId, toId);
      const diff = this.calculateSnapshotDifferences(fromFunctions, toFunctions);
      const statistics = this.calculateDiffStatistics(
        fromFunctions,
        toFunctions,
        diff.added,
        diff.removed,
        diff.modified
      );

      return {
        from: fromSnapshot,
        to: toSnapshot,
        ...diff,
        statistics,
      };
    } catch (error) {
      throw new Error(
        `Failed to diff snapshots: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async validateAndLoadSnapshots(fromId: string, toId: string) {
    const fromSnapshot = await this.getSnapshot(fromId);
    const toSnapshot = await this.getSnapshot(toId);

    if (!fromSnapshot || !toSnapshot) {
      throw new Error(`Snapshot not found: ${!fromSnapshot ? fromId : toId}`);
    }

    return { fromSnapshot, toSnapshot };
  }

  private async loadSnapshotFunctions(fromId: string, toId: string) {
    const fromFunctions = await this.getFunctionsBySnapshot(fromId);
    const toFunctions = await this.getFunctionsBySnapshot(toId);
    return { fromFunctions, toFunctions };
  }

  private calculateSnapshotDifferences(fromFunctions: FunctionInfo[], toFunctions: FunctionInfo[]) {
    const fromMap = new Map(fromFunctions.map((f: FunctionInfo) => [f.semanticId, f]));
    const toMap = new Map(toFunctions.map((f: FunctionInfo) => [f.semanticId, f]));

    const added: FunctionInfo[] = [];
    const removed: FunctionInfo[] = [];
    const modified: FunctionChange[] = [];
    const unchanged: FunctionInfo[] = [];

    this.categorizeChangedFunctions(toFunctions, fromMap, added, modified, unchanged);
    this.findRemovedFunctions(fromFunctions, toMap, removed);

    return { added, removed, modified, unchanged };
  }

  private categorizeChangedFunctions(
    toFunctions: FunctionInfo[],
    fromMap: Map<string, FunctionInfo>,
    added: FunctionInfo[],
    modified: FunctionChange[],
    unchanged: FunctionInfo[]
  ) {
    for (const toFunc of toFunctions) {
      const fromFunc = fromMap.get(toFunc.semanticId);

      if (!fromFunc) {
        added.push(toFunc);
      } else if (fromFunc.astHash !== toFunc.astHash) {
        modified.push({
          before: fromFunc,
          after: toFunc,
          changes: this.calculateFunctionChanges(fromFunc, toFunc),
        });
      } else {
        unchanged.push(toFunc);
      }
    }
  }

  private findRemovedFunctions(
    fromFunctions: FunctionInfo[],
    toMap: Map<string, FunctionInfo>,
    removed: FunctionInfo[]
  ) {
    for (const fromFunc of fromFunctions) {
      if (!toMap.has(fromFunc.semanticId)) {
        removed.push(fromFunc);
      }
    }
  }

  private calculateFunctionChanges(fromFunc: FunctionInfo, toFunc: FunctionInfo): ChangeDetail[] {
    const changes: ChangeDetail[] = [];

    // Compare metrics if both have them
    if (fromFunc.metrics && toFunc.metrics) {
      const metricsToCompare = [
        { key: 'cyclomaticComplexity' as const, name: 'cyclomaticComplexity' },
        { key: 'linesOfCode' as const, name: 'linesOfCode' },
        { key: 'cognitiveComplexity' as const, name: 'cognitiveComplexity' },
        { key: 'parameterCount' as const, name: 'parameterCount' },
      ];

      for (const { key, name } of metricsToCompare) {
        const oldValue = fromFunc.metrics[key];
        const newValue = toFunc.metrics[key];

        if (oldValue !== newValue) {
          changes.push({
            field: name,
            oldValue,
            newValue,
            impact: this.calculateChangeImpact(name, oldValue, newValue),
          });
        }
      }
    }

    // Compare basic properties
    const basicPropsToCompare = [
      { key: 'name' as const },
      { key: 'filePath' as const },
      { key: 'startLine' as const },
      { key: 'endLine' as const },
    ];

    for (const { key } of basicPropsToCompare) {
      const oldValue = fromFunc[key];
      const newValue = toFunc[key];

      if (oldValue !== newValue) {
        changes.push({
          field: key,
          oldValue,
          newValue,
          impact: 'low',
        });
      }
    }

    return changes;
  }

  private calculateChangeImpact(
    metric: string,
    oldValue: number,
    newValue: number
  ): 'low' | 'medium' | 'high' {
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

  private calculateDiffStatistics(
    fromFunctions: FunctionInfo[],
    toFunctions: FunctionInfo[],
    added: FunctionInfo[],
    removed: FunctionInfo[],
    modified: FunctionChange[]
  ): DiffStatistics {
    const fromMetrics = this.aggregateMetrics(fromFunctions);
    const toMetrics = this.aggregateMetrics(toFunctions);

    return {
      totalChanges: added.length + removed.length + modified.length,
      addedCount: added.length,
      removedCount: removed.length,
      modifiedCount: modified.length,
      complexityChange: toMetrics.avgComplexity - fromMetrics.avgComplexity,
      linesChange: toMetrics.totalLines - fromMetrics.totalLines,
    };
  }

  private aggregateMetrics(functions: FunctionInfo[]): {
    avgComplexity: number;
    totalLines: number;
  } {
    if (functions.length === 0) {
      return { avgComplexity: 0, totalLines: 0 };
    }

    const totalComplexity = functions.reduce(
      (sum, f) => sum + (f.metrics?.cyclomaticComplexity || 1),
      0
    );
    const totalLines = functions.reduce((sum, f) => sum + (f.metrics?.linesOfCode || 0), 0);

    return {
      avgComplexity: totalComplexity / functions.length,
      totalLines,
    };
  }

  // ========================================
  // FUNCTION DESCRIPTION OPERATIONS
  // ========================================

  async saveFunctionDescription(description: FunctionDescription): Promise<void> {
    try {
      await this.db.query(
        `
        INSERT INTO function_descriptions (
          semantic_id, description, source, created_at, updated_at, created_by, ai_model, confidence_score, validated_for_content_id, needs_review, usage_example, side_effects, error_conditions
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, $10, $11, $12)
        ON CONFLICT (semantic_id) 
        DO UPDATE SET 
          description = EXCLUDED.description,
          source = EXCLUDED.source,
          updated_at = EXCLUDED.updated_at,
          created_by = EXCLUDED.created_by,
          ai_model = EXCLUDED.ai_model,
          confidence_score = EXCLUDED.confidence_score,
          validated_for_content_id = EXCLUDED.validated_for_content_id,
          needs_review = FALSE,
          usage_example = EXCLUDED.usage_example,
          side_effects = EXCLUDED.side_effects,
          error_conditions = EXCLUDED.error_conditions
      `,
        [
          description.semanticId,
          description.description,
          description.source,
          new Date(description.createdAt).toISOString(),
          new Date(description.updatedAt).toISOString(),
          description.createdBy || null,
          description.aiModel || null,
          description.confidenceScore || null,
          description.validatedForContentId || null,
          description.usageExample || null,
          description.sideEffects || null,
          description.errorConditions || null,
        ]
      );
    } catch (error) {
      throw new Error(
        `Failed to save function description: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getFunctionDescription(semanticId: string): Promise<FunctionDescription | null> {
    try {
      const result = await this.db.query(
        'SELECT * FROM function_descriptions WHERE semantic_id = $1',
        [semanticId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as {
        semantic_id: string;
        description: string;
        source: string;
        created_at: string;
        updated_at: string;
        created_by?: string;
        ai_model?: string;
        confidence_score?: number;
        validated_for_content_id?: string;
        usage_example?: string;
        side_effects?: string;
        error_conditions?: string;
      };
      return {
        semanticId: row.semantic_id,
        description: row.description,
        source: row.source as 'human' | 'ai' | 'jsdoc',
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
        ...(row.created_by && { createdBy: row.created_by }),
        ...(row.ai_model && { aiModel: row.ai_model }),
        ...(row.confidence_score !== null && { confidenceScore: row.confidence_score }),
        ...(row.validated_for_content_id && {
          validatedForContentId: row.validated_for_content_id,
        }),
        ...(row.usage_example && { usageExample: row.usage_example }),
        ...(row.side_effects && { sideEffects: row.side_effects }),
        ...(row.error_conditions && { errorConditions: row.error_conditions }),
      };
    } catch (error) {
      throw new Error(
        `Failed to get function description: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getFunctionsNeedingDescriptions(
    snapshotId: string,
    options?: QueryOptions
  ): Promise<FunctionInfo[]> {
    try {
      // Query functions where:
      // 1. No description exists, OR
      // 2. Function content has changed (content_id differs from validated_for_content_id), OR
      // 3. Description needs review flag is set
      let sql = `
        SELECT 
          f.id, f.semantic_id, f.content_id, f.snapshot_id, f.name, f.display_name, 
          f.signature, f.signature_hash, f.file_path, f.file_hash, f.start_line, f.end_line,
          f.start_column, f.end_column, f.ast_hash, f.context_path, f.function_type, 
          f.modifiers, f.nesting_level, f.is_exported, f.is_async, f.is_generator,
          f.is_arrow_function, f.is_method, f.is_constructor, f.is_static, 
          f.access_modifier, f.source_code, f.created_at,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.parameter_count, q.max_nesting_level, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.maintainability_index, q.halstead_volume, q.halstead_difficulty, q.code_to_comment_ratio
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        LEFT JOIN function_descriptions d ON f.semantic_id = d.semantic_id
        WHERE f.snapshot_id = $1 
        AND (
          d.semantic_id IS NULL 
          OR d.needs_review = TRUE
          OR (d.validated_for_content_id IS NULL OR d.validated_for_content_id != f.content_id)
        )
      `;

      const params: (string | number)[] = [snapshotId];

      if (options?.limit) {
        sql += ' LIMIT $' + (params.length + 1);
        params.push(options.limit);
      }

      if (options?.offset) {
        sql += ' OFFSET $' + (params.length + 1);
        params.push(options.offset);
      }

      const result = await this.db.query(sql, params);

      // Get parameters for each function
      const functions = await Promise.all(
        result.rows.map(async row => {
          const parameters = await this.getFunctionParameters((row as FunctionRow).id);
          return this.mapRowToFunctionInfo(row as FunctionRow & Partial<MetricsRow>, parameters);
        })
      );

      return functions;
    } catch (error) {
      throw new Error(
        `Failed to get functions needing descriptions: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async searchFunctionsByDescription(
    keyword: string,
    options?: QueryOptions
  ): Promise<FunctionInfo[]> {
    try {
      // Get the latest snapshot
      const snapshots = await this.getSnapshots({ sort: 'created_at', limit: 1 });
      if (snapshots.length === 0) {
        return [];
      }

      let sql = `
        SELECT 
          f.id,
          f.snapshot_id,
          f.start_line,
          f.end_line,
          f.start_column,
          f.end_column,
          f.created_at,
          f.semantic_id,
          f.name,
          f.display_name,
          f.signature,
          f.file_path,
          f.context_path,
          f.function_type,
          f.modifiers,
          f.nesting_level,
          f.is_exported,
          f.is_async,
          f.is_generator,
          f.is_arrow_function,
          f.is_method,
          f.is_constructor,
          f.is_static,
          f.access_modifier,
          f.content_id,
          f.ast_hash,
          f.source_code,
          f.signature_hash,
          f.file_hash,
          f.file_content_hash,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.max_nesting_level, q.parameter_count, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.comment_lines, q.code_to_comment_ratio, q.halstead_volume, q.halstead_difficulty,
          q.maintainability_index,
          d.description
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        LEFT JOIN function_descriptions d ON f.semantic_id = d.semantic_id
        WHERE f.snapshot_id = $1 AND (
          f.name ILIKE $2 OR 
          f.source_code ILIKE $2 OR
          d.description ILIKE $2
        )
      `;
      const params: (string | number)[] = [snapshots[0].id, `%${keyword}%`];

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
        result.rows.map(async row => {
          const parameters = await this.getFunctionParameters((row as FunctionRow).id);
          return this.mapRowToFunctionInfo(row as FunctionRow & Partial<MetricsRow>, parameters);
        })
      );

      return functions;
    } catch (error) {
      throw new Error(
        `Failed to search functions by description: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getFunctionsWithDescriptions(
    snapshotId: string,
    options?: QueryOptions
  ): Promise<FunctionInfo[]> {
    try {
      let sql = `
        SELECT 
          f.id,
          f.snapshot_id,
          f.start_line,
          f.end_line,
          f.start_column,
          f.end_column,
          f.created_at,
          f.semantic_id,
          f.name,
          f.display_name,
          f.signature,
          f.file_path,
          f.context_path,
          f.function_type,
          f.modifiers,
          f.nesting_level,
          f.is_exported,
          f.is_async,
          f.is_generator,
          f.is_arrow_function,
          f.is_method,
          f.is_constructor,
          f.is_static,
          f.access_modifier,
          f.content_id,
          f.ast_hash,
          f.source_code,
          f.signature_hash,
          f.file_hash,
          f.file_content_hash,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.max_nesting_level, q.parameter_count, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.comment_lines, q.code_to_comment_ratio, q.halstead_volume, q.halstead_difficulty,
          q.maintainability_index,
          d.description, d.source, d.created_at, d.updated_at, d.ai_model
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        LEFT JOIN function_descriptions d ON f.semantic_id = d.semantic_id
        WHERE f.snapshot_id = $1 AND d.description IS NOT NULL
      `;
      const params: (string | number)[] = [snapshotId];

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

      const functions = await Promise.all(
        result.rows.map(async row => {
          const parameters = await this.getFunctionParameters((row as FunctionRow).id);
          return this.mapRowToFunctionInfo(row as FunctionRow & Partial<MetricsRow>, parameters);
        })
      );

      return functions;
    } catch (error) {
      throw new Error(
        `Failed to get functions with descriptions: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getFunctionsWithoutDescriptions(
    snapshotId: string,
    options?: QueryOptions
  ): Promise<FunctionInfo[]> {
    try {
      let sql = `
        SELECT 
          f.id,
          f.snapshot_id,
          f.start_line,
          f.end_line,
          f.start_column,
          f.end_column,
          f.created_at,
          f.semantic_id,
          f.name,
          f.display_name,
          f.signature,
          f.file_path,
          f.context_path,
          f.function_type,
          f.modifiers,
          f.nesting_level,
          f.is_exported,
          f.is_async,
          f.is_generator,
          f.is_arrow_function,
          f.is_method,
          f.is_constructor,
          f.is_static,
          f.access_modifier,
          f.content_id,
          f.ast_hash,
          f.source_code,
          f.signature_hash,
          f.file_hash,
          f.file_content_hash,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.max_nesting_level, q.parameter_count, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.comment_lines, q.code_to_comment_ratio, q.halstead_volume, q.halstead_difficulty,
          q.maintainability_index
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        LEFT JOIN function_descriptions d ON f.semantic_id = d.semantic_id
        WHERE f.snapshot_id = $1 AND d.description IS NULL
      `;
      const params: (string | number)[] = [snapshotId];

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

      const functions = await Promise.all(
        result.rows.map(async row => {
          const parameters = await this.getFunctionParameters((row as FunctionRow).id);
          return this.mapRowToFunctionInfo(row as FunctionRow & Partial<MetricsRow>, parameters);
        })
      );

      return functions;
    } catch (error) {
      throw new Error(
        `Failed to get functions without descriptions: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ========================================
  // EMBEDDING OPERATIONS
  // ========================================

  async saveEmbedding(
    semanticId: string,
    embedding: number[],
    model: string = 'text-embedding-ada-002'
  ): Promise<void> {
    try {
      // Convert array to PostgreSQL array literal
      const embeddingStr = `{${embedding.join(',')}}`;

      await this.db.query(
        `
        INSERT INTO function_embeddings (semantic_id, embedding_model, vector_dimension, embedding)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (semantic_id) 
        DO UPDATE SET 
          embedding_model = EXCLUDED.embedding_model,
          vector_dimension = EXCLUDED.vector_dimension,
          embedding = EXCLUDED.embedding,
          updated_at = CURRENT_TIMESTAMP
      `,
        [semanticId, model, embedding.length, embeddingStr]
      );
    } catch (error) {
      throw new Error(
        `Failed to save embedding: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getEmbedding(semanticId: string): Promise<{ embedding: number[]; model: string } | null> {
    try {
      const result = await this.db.query(
        'SELECT embedding, embedding_model FROM function_embeddings WHERE semantic_id = $1',
        [semanticId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as { embedding: number[]; embedding_model: string };
      return {
        embedding: row.embedding,
        model: row.embedding_model,
      };
    } catch (error) {
      throw new Error(
        `Failed to get embedding: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async searchByEmbedding(
    queryEmbedding: number[],
    threshold: number = 0.8,
    limit: number = 10
  ): Promise<Array<FunctionInfo & { similarity: number }>> {
    try {
      // Get the latest snapshot
      const snapshots = await this.getSnapshots({ sort: 'created_at', limit: 1 });
      if (snapshots.length === 0) {
        return [];
      }

      // Since PGLite doesn't have native vector operations, we need to calculate similarity in application
      // First, get all embeddings
      const embeddings = await this.db.query(
        `
        SELECT 
          f.id,
          f.snapshot_id,
          f.start_line,
          f.end_line,
          f.start_column,
          f.end_column,
          f.created_at,
          f.semantic_id,
          f.name,
          f.display_name,
          f.signature,
          f.file_path,
          f.context_path,
          f.function_type,
          f.modifiers,
          f.nesting_level,
          f.is_exported,
          f.is_async,
          f.is_generator,
          f.is_arrow_function,
          f.is_method,
          f.is_constructor,
          f.is_static,
          f.access_modifier,
          f.content_id,
          f.ast_hash,
          f.source_code,
          f.signature_hash,
          f.file_hash,
          f.file_content_hash, 
          e.embedding,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.max_nesting_level, q.parameter_count, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.comment_lines, q.code_to_comment_ratio, q.halstead_volume, q.halstead_difficulty,
          q.maintainability_index,
          d.description
        FROM functions f
        INNER JOIN function_embeddings e ON f.semantic_id = e.semantic_id
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        LEFT JOIN function_descriptions d ON f.semantic_id = d.semantic_id
        WHERE f.snapshot_id = $1
      `,
        [snapshots[0].id]
      );

      // Calculate similarities and filter
      type EmbeddingSearchRow = FunctionRow &
        Partial<MetricsRow> & {
          embedding: number[];
          description?: string;
        };

      const results: Array<{ row: EmbeddingSearchRow; similarity: number }> = [];

      for (const row of embeddings.rows) {
        const rowData = row as EmbeddingSearchRow;
        const embedding = rowData.embedding;
        const similarity = EmbeddingService.cosineSimilarity(queryEmbedding, embedding);

        if (similarity >= threshold) {
          results.push({ row: rowData, similarity });
        }
      }

      // Sort by similarity descending
      results.sort((a, b) => b.similarity - a.similarity);

      // Take top N results
      const topResults = results.slice(0, limit);

      // Map to FunctionInfo with similarity
      const functions = await Promise.all(
        topResults.map(async ({ row, similarity }) => {
          const parameters = await this.getFunctionParameters(row.id);
          const functionInfo = this.mapRowToFunctionInfo(
            row as FunctionRow & Partial<MetricsRow>,
            parameters
          );
          return { ...functionInfo, similarity };
        })
      );

      return functions;
    } catch (error) {
      throw new Error(
        `Failed to search by embedding: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async bulkSaveEmbeddings(
    embeddings: Array<{ semanticId: string; embedding: number[]; model: string }>
  ): Promise<void> {
    if (embeddings.length === 0) return;

    await this.executeInTransaction(async () => {
      for (const { semanticId, embedding, model } of embeddings) {
        await this.saveEmbedding(semanticId, embedding, model);
      }
    });
  }

  async getFunctionsWithoutEmbeddings(snapshotId: string, limit?: number): Promise<FunctionInfo[]> {
    try {
      let sql = `
        SELECT 
          f.id,
          f.snapshot_id,
          f.start_line,
          f.end_line,
          f.start_column,
          f.end_column,
          f.created_at,
          f.semantic_id,
          f.name,
          f.display_name,
          f.signature,
          f.file_path,
          f.context_path,
          f.function_type,
          f.modifiers,
          f.nesting_level,
          f.is_exported,
          f.is_async,
          f.is_generator,
          f.is_arrow_function,
          f.is_method,
          f.is_constructor,
          f.is_static,
          f.access_modifier,
          f.content_id,
          f.ast_hash,
          f.source_code,
          f.signature_hash,
          f.file_hash,
          f.file_content_hash,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.max_nesting_level, q.parameter_count, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.comment_lines, q.code_to_comment_ratio, q.halstead_volume, q.halstead_difficulty,
          q.maintainability_index,
          d.description
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        LEFT JOIN function_descriptions d ON f.semantic_id = d.semantic_id
        LEFT JOIN function_embeddings e ON f.semantic_id = e.semantic_id
        WHERE f.snapshot_id = $1 
        AND d.description IS NOT NULL
        AND e.semantic_id IS NULL
      `;
      const params: (string | number)[] = [snapshotId];

      if (limit) {
        sql += ' LIMIT $' + (params.length + 1);
        params.push(limit);
      }

      const result = await this.db.query(sql, params);

      const functions = await Promise.all(
        result.rows.map(async row => {
          const parameters = await this.getFunctionParameters((row as FunctionRow).id);
          return this.mapRowToFunctionInfo(row as FunctionRow & Partial<MetricsRow>, parameters);
        })
      );

      return functions;
    } catch (error) {
      throw new Error(
        `Failed to get functions without embeddings: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getFunctionsWithEmbeddings(snapshotId: string, limit?: number): Promise<FunctionInfo[]> {
    try {
      let sql = `
        SELECT 
          f.id,
          f.snapshot_id,
          f.start_line,
          f.end_line,
          f.start_column,
          f.end_column,
          f.created_at,
          f.semantic_id,
          f.name,
          f.display_name,
          f.signature,
          f.file_path,
          f.context_path,
          f.function_type,
          f.modifiers,
          f.nesting_level,
          f.is_exported,
          f.is_async,
          f.is_generator,
          f.is_arrow_function,
          f.is_method,
          f.is_constructor,
          f.is_static,
          f.access_modifier,
          f.content_id,
          f.ast_hash,
          f.source_code,
          f.signature_hash,
          f.file_hash,
          f.file_content_hash,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.max_nesting_level, q.parameter_count, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.comment_lines, q.code_to_comment_ratio, q.halstead_volume, q.halstead_difficulty,
          q.maintainability_index,
          d.description
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        LEFT JOIN function_descriptions d ON f.semantic_id = d.semantic_id
        INNER JOIN function_embeddings e ON f.semantic_id = e.semantic_id
        WHERE f.snapshot_id = $1 
        AND d.description IS NOT NULL
      `;
      const params: (string | number)[] = [snapshotId];

      if (limit) {
        sql += ' LIMIT $' + (params.length + 1);
        params.push(limit);
      }

      const result = await this.db.query(sql, params);

      const functions = await Promise.all(
        result.rows.map(async row => {
          const parameters = await this.getFunctionParameters((row as FunctionRow).id);
          return this.mapRowToFunctionInfo(row as FunctionRow & Partial<MetricsRow>, parameters);
        })
      );

      return functions;
    } catch (error) {
      throw new Error(
        `Failed to get functions with embeddings: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getFunction(functionId: string): Promise<FunctionInfo | null> {
    await this.ensureInitialized();
    try {
      const result = await this.db.query(
        `
        SELECT 
          f.id,
          f.snapshot_id,
          f.start_line,
          f.end_line,
          f.start_column,
          f.end_column,
          f.created_at,
          f.semantic_id,
          f.name,
          f.display_name,
          f.signature,
          f.file_path,
          f.context_path,
          f.function_type,
          f.modifiers,
          f.nesting_level,
          f.is_exported,
          f.is_async,
          f.is_generator,
          f.is_arrow_function,
          f.is_method,
          f.is_constructor,
          f.is_static,
          f.access_modifier,
          f.content_id,
          f.ast_hash,
          f.source_code,
          f.signature_hash,
          f.file_hash,
          f.file_content_hash,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.max_nesting_level, q.parameter_count, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.comment_lines, q.code_to_comment_ratio, q.halstead_volume, q.halstead_difficulty,
          q.maintainability_index,
          d.description
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        LEFT JOIN function_descriptions d ON f.semantic_id = d.semantic_id
        WHERE f.id = $1 OR f.semantic_id = $1
        LIMIT 1
      `,
        [functionId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as FunctionRow & Partial<MetricsRow>;
      const parameters = await this.getFunctionParameters(row.id);
      return this.mapRowToFunctionInfo(row, parameters);
    } catch (error) {
      throw new Error(
        `Failed to get function: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getFunctionsBatch(functionIds: string[]): Promise<Map<string, FunctionInfo>> {
    if (functionIds.length === 0) {
      return new Map();
    }

    try {
      // Use PostgreSQL array for efficient batch query
      const idsArray = this.formatPostgresArrayLiteral(functionIds);

      const result = await this.db.query(
        `
        SELECT 
          f.id,
          f.snapshot_id,
          f.start_line,
          f.end_line,
          f.start_column,
          f.end_column,
          f.created_at,
          f.semantic_id,
          f.name,
          f.display_name,
          f.signature,
          f.file_path,
          f.context_path,
          f.function_type,
          f.modifiers,
          f.nesting_level,
          f.is_exported,
          f.is_async,
          f.is_generator,
          f.is_arrow_function,
          f.is_method,
          f.is_constructor,
          f.is_static,
          f.access_modifier,
          f.content_id,
          f.ast_hash,
          f.source_code,
          f.signature_hash,
          f.file_hash,
          f.file_content_hash,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.max_nesting_level, q.parameter_count, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.comment_lines, q.code_to_comment_ratio, q.halstead_volume, q.halstead_difficulty,
          q.maintainability_index,
          d.description
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        LEFT JOIN function_descriptions d ON f.semantic_id = d.semantic_id
        WHERE f.id = ANY($1::text[]) OR f.semantic_id = ANY($1::text[])
      `,
        [idsArray]
      );

      // Get parameters for all functions in a single batch
      const parameterMap = await this.getFunctionParametersBatch(
        result.rows.map(row => (row as FunctionRow).id)
      );

      const functionMap = new Map<string, FunctionInfo>();

      for (const row of result.rows) {
        const functionRow = row as FunctionRow & Partial<MetricsRow>;
        const parameters = parameterMap.get(functionRow.id) || [];
        const functionInfo = this.mapRowToFunctionInfo(functionRow, parameters);

        // Store by both id and semantic_id for flexible lookup
        functionMap.set(functionRow.id, functionInfo);
        functionMap.set(functionRow.semantic_id, functionInfo);
      }

      return functionMap;
    } catch (error) {
      throw new Error(
        `Failed to get functions batch: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getEmbeddingStats(): Promise<{
    total: number;
    withEmbeddings: number;
    withoutEmbeddings: number;
  }> {
    try {
      const result = await this.db.query(`
        SELECT 
          COUNT(DISTINCT d.semantic_id) as total,
          COUNT(DISTINCT e.semantic_id) as with_embeddings
        FROM function_descriptions d
        LEFT JOIN function_embeddings e ON d.semantic_id = e.semantic_id
      `);

      const stats = result.rows[0] as { total: string; with_embeddings: string };
      const total = parseInt(stats.total);
      const withEmbeddings = parseInt(stats.with_embeddings);

      return {
        total,
        withEmbeddings,
        withoutEmbeddings: total - withEmbeddings,
      };
    } catch (error) {
      throw new Error(
        `Failed to get embedding stats: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ========================================
  // ANN INDEX MANAGEMENT
  // ========================================

  /**
   * Save ANN index metadata and serialized index data
   */
  async saveANNIndex(
    indexId: string,
    config: ANNConfig,
    embeddingModel: string,
    vectorDimension: number,
    vectorCount: number,
    indexData: string,
    buildTimeMs: number,
    accuracyMetrics?: Record<string, unknown>
  ): Promise<void> {
    try {
      // Mark all existing indexes as not current
      await this.db.query('UPDATE ann_index_metadata SET is_current = FALSE');

      // Insert new index metadata
      await this.db.query(
        `
        INSERT INTO ann_index_metadata (
          id, algorithm, config_json, embedding_model, vector_dimension, 
          vector_count, index_data, build_time_ms, accuracy_metrics, is_current
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
        ON CONFLICT (id) DO UPDATE SET
          algorithm = EXCLUDED.algorithm,
          config_json = EXCLUDED.config_json,
          embedding_model = EXCLUDED.embedding_model,
          vector_dimension = EXCLUDED.vector_dimension,
          vector_count = EXCLUDED.vector_count,
          index_data = EXCLUDED.index_data,
          build_time_ms = EXCLUDED.build_time_ms,
          accuracy_metrics = EXCLUDED.accuracy_metrics,
          updated_at = CURRENT_TIMESTAMP,
          is_current = TRUE
      `,
        [
          indexId,
          config.algorithm,
          JSON.stringify(config),
          embeddingModel,
          vectorDimension,
          vectorCount,
          indexData,
          buildTimeMs,
          accuracyMetrics ? JSON.stringify(accuracyMetrics) : null,
        ]
      );
    } catch (error) {
      throw new Error(
        `Failed to save ANN index: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get current ANN index metadata and data
   */
  async getCurrentANNIndex(): Promise<{
    id: string;
    config: ANNConfig;
    embeddingModel: string;
    vectorDimension: number;
    vectorCount: number;
    indexData: string;
    buildTimeMs: number;
    accuracyMetrics?: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  } | null> {
    try {
      const result = await this.db.query(`
        SELECT * FROM ann_index_metadata 
        WHERE is_current = TRUE 
        ORDER BY updated_at DESC 
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0] as {
        id: string;
        algorithm: string;
        config_json: string;
        embedding_model: string;
        vector_dimension: number;
        vector_count: number;
        index_data: string;
        build_time_ms: number;
        accuracy_metrics: string | null;
        created_at: string;
        updated_at: string;
      };

      return {
        id: row.id,
        config: JSON.parse(row.config_json) as ANNConfig,
        embeddingModel: row.embedding_model,
        vectorDimension: row.vector_dimension,
        vectorCount: row.vector_count,
        indexData: row.index_data,
        buildTimeMs: row.build_time_ms,
        accuracyMetrics: row.accuracy_metrics ? JSON.parse(row.accuracy_metrics) : undefined,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      };
    } catch (error) {
      throw new Error(
        `Failed to get current ANN index: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get all ANN index metadata (for history/comparison)
   */
  async getAllANNIndexes(): Promise<
    Array<{
      id: string;
      algorithm: string;
      embeddingModel: string;
      vectorCount: number;
      buildTimeMs: number;
      isCurrent: boolean;
      createdAt: Date;
    }>
  > {
    try {
      const result = await this.db.query(`
        SELECT id, algorithm, embedding_model, vector_count, build_time_ms, is_current, created_at
        FROM ann_index_metadata 
        ORDER BY created_at DESC
      `);

      return result.rows.map((row: unknown) => {
        const typedRow = row as {
          id: string;
          algorithm: string;
          embedding_model: string;
          vector_count: number;
          build_time_ms: number;
          is_current: boolean;
          created_at: string;
        };
        return {
          id: typedRow.id,
          algorithm: typedRow.algorithm,
          embeddingModel: typedRow.embedding_model,
          vectorCount: typedRow.vector_count,
          buildTimeMs: typedRow.build_time_ms,
          isCurrent: typedRow.is_current,
          createdAt: new Date(typedRow.created_at),
        };
      });
    } catch (error) {
      throw new Error(
        `Failed to get ANN indexes: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Delete ANN index by ID
   */
  async deleteANNIndex(indexId: string): Promise<void> {
    try {
      await this.db.query('DELETE FROM ann_index_metadata WHERE id = $1', [indexId]);
    } catch (error) {
      throw new Error(
        `Failed to delete ANN index: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get ANN index statistics
   */
  async getANNIndexStats(): Promise<{
    totalIndexes: number;
    currentIndex: {
      algorithm: string;
      vectorCount: number;
      buildTimeMs: number;
      model: string;
    } | null;
    averageBuildTime: number;
  }> {
    try {
      const [totalResult, currentResult, avgResult] = await Promise.all([
        this.db.query('SELECT COUNT(*) as total FROM ann_index_metadata'),
        this.db.query(`
          SELECT algorithm, vector_count, build_time_ms, embedding_model 
          FROM ann_index_metadata 
          WHERE is_current = TRUE
        `),
        this.db.query('SELECT AVG(build_time_ms) as avg_time FROM ann_index_metadata'),
      ]);

      type CurrentIndexRow = {
        algorithm: string;
        vector_count: string | number;
        build_time_ms: string | number;
        embedding_model: string;
      };

      type TotalRow = { total: string };
      type AvgTimeRow = { avg_time: string | null };

      const currentIndex =
        currentResult.rows.length > 0
          ? (() => {
              const row = currentResult.rows[0] as CurrentIndexRow;
              return {
                algorithm: row.algorithm,
                vectorCount:
                  typeof row.vector_count === 'string'
                    ? parseInt(row.vector_count, 10)
                    : row.vector_count,
                buildTimeMs:
                  typeof row.build_time_ms === 'string'
                    ? parseInt(row.build_time_ms, 10)
                    : row.build_time_ms,
                model: row.embedding_model,
              };
            })()
          : null;

      const totalRow = totalResult.rows[0] as TotalRow;
      const avgRow = avgResult.rows[0] as AvgTimeRow;

      // Parse and validate numeric values with proper fallbacks
      const totalIndexes = totalRow?.total ? parseInt(totalRow.total, 10) : 0;
      const averageBuildTime = avgRow?.avg_time ? parseFloat(avgRow.avg_time) : 0;

      return {
        totalIndexes: isNaN(totalIndexes) ? 0 : totalIndexes,
        currentIndex,
        averageBuildTime: isNaN(averageBuildTime) ? 0 : averageBuildTime,
      };
    } catch (error) {
      throw new Error(
        `Failed to get ANN index stats: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ========================================
  // MAINTENANCE OPERATIONS (FUTURE)
  // ========================================

  // ========================================
  // LINEAGE OPERATIONS
  // ========================================

  async saveLineage(lineage: Lineage): Promise<void> {
    try {
      // Convert arrays to PostgreSQL array literals
      const fromIdsLiteral = this.formatPostgresArrayLiteral(lineage.fromIds);
      const toIdsLiteral = this.formatPostgresArrayLiteral(lineage.toIds);

      await this.db.query(
        `
        INSERT INTO lineages (
          id, from_ids, to_ids, kind, status, confidence, note, git_commit, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
      `,
        [
          lineage.id,
          fromIdsLiteral,
          toIdsLiteral,
          lineage.kind,
          lineage.status,
          lineage.confidence || null,
          lineage.note || null,
          lineage.gitCommit,
          lineage.createdAt.toISOString(),
          lineage.updatedAt?.toISOString() || null,
        ]
      );
    } catch (error) {
      throw new Error(
        `Failed to save lineage: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getLineage(id: string): Promise<Lineage | null> {
    try {
      // First try exact match
      let result = await this.db.query(
        `
        SELECT * FROM lineages WHERE id = $1
      `,
        [id]
      );

      // If no exact match and id is shorter than full UUID, try prefix match
      if (result.rows.length === 0 && id.length < 36) {
        result = await this.db.query(
          `
          SELECT * FROM lineages WHERE id LIKE $1 || '%'
        `,
          [id]
        );

        // Ensure uniqueness for prefix matches
        if (result.rows.length > 1) {
          throw new Error(`Ambiguous lineage ID: '${id}' matches multiple lineages`);
        }
      }

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return this.mapRowToLineage(row);
    } catch (error) {
      throw new Error(
        `Failed to get lineage: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getLineages(query?: LineageQuery): Promise<Lineage[]> {
    try {
      let sql = 'SELECT * FROM lineages WHERE 1=1';
      const params: unknown[] = [];
      let paramIndex = 1;

      if (query?.status) {
        sql += ` AND status = $${paramIndex++}`;
        params.push(query.status);
      }

      if (query?.kind) {
        sql += ` AND kind = $${paramIndex++}`;
        params.push(query.kind);
      }

      if (query?.minConfidence !== undefined) {
        sql += ` AND confidence >= $${paramIndex++}`;
        params.push(query.minConfidence);
      }

      if (query?.gitCommit) {
        sql += ` AND git_commit = $${paramIndex++}`;
        params.push(query.gitCommit);
      }

      if (query?.fromDate) {
        sql += ` AND created_at >= $${paramIndex++}`;
        params.push(query.fromDate.toISOString());
      }

      if (query?.toDate) {
        sql += ` AND created_at <= $${paramIndex++}`;
        params.push(query.toDate.toISOString());
      }

      sql += ' ORDER BY created_at DESC';

      if (query?.limit) {
        sql += ` LIMIT $${paramIndex++}`;
        params.push(query.limit);
      }

      if (query?.offset) {
        sql += ` OFFSET $${paramIndex++}`;
        params.push(query.offset);
      }

      const result = await this.db.query(sql, params);
      return result.rows.map(row => this.mapRowToLineage(row));
    } catch (error) {
      throw new Error(
        `Failed to get lineages: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getLineagesWithFunctionFilter(
    fromFunctionPattern?: string,
    toFunctionPattern?: string,
    query?: LineageQuery
  ): Promise<Lineage[]> {
    try {
      let sql = `
        SELECT DISTINCT l.* FROM lineages l
      `;
      const params: unknown[] = [];
      let paramIndex = 1;

      // Add joins if function name filtering is needed
      if (fromFunctionPattern) {
        sql += `
          JOIN functions f_from ON f_from.id = ANY(string_to_array(trim(both '{}' from l.from_ids), ','))
        `;
      }

      if (toFunctionPattern) {
        sql += `
          JOIN functions f_to ON f_to.id = ANY(string_to_array(trim(both '{}' from l.to_ids), ','))
        `;
      }

      sql += ' WHERE 1=1';

      // Add function name filters
      if (fromFunctionPattern) {
        sql += ` AND LOWER(f_from.name) LIKE $${paramIndex++}`;
        params.push(`%${fromFunctionPattern.toLowerCase()}%`);
      }

      if (toFunctionPattern) {
        sql += ` AND LOWER(f_to.name) LIKE $${paramIndex++}`;
        params.push(`%${toFunctionPattern.toLowerCase()}%`);
      }

      // Add standard lineage filters
      if (query?.status) {
        sql += ` AND l.status = $${paramIndex++}`;
        params.push(query.status);
      }

      if (query?.kind) {
        sql += ` AND l.kind = $${paramIndex++}`;
        params.push(query.kind);
      }

      if (query?.minConfidence !== undefined) {
        sql += ` AND l.confidence >= $${paramIndex++}`;
        params.push(query.minConfidence);
      }

      if (query?.gitCommit) {
        sql += ` AND l.git_commit = $${paramIndex++}`;
        params.push(query.gitCommit);
      }

      if (query?.fromDate) {
        sql += ` AND l.created_at >= $${paramIndex++}`;
        params.push(query.fromDate.toISOString());
      }

      if (query?.toDate) {
        sql += ` AND l.created_at <= $${paramIndex++}`;
        params.push(query.toDate.toISOString());
      }

      sql += ' ORDER BY l.created_at DESC';

      if (query?.limit) {
        sql += ` LIMIT $${paramIndex++}`;
        params.push(query.limit);
      }

      if (query?.offset) {
        sql += ` OFFSET $${paramIndex++}`;
        params.push(query.offset);
      }

      const result = await this.db.query(sql, params);
      return result.rows.map(row => this.mapRowToLineage(row));
    } catch (error) {
      throw new Error(
        `Failed to get lineages with function filter: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async updateLineageStatus(id: string, status: LineageStatus, note?: string): Promise<void> {
    try {
      const updateNote = note !== undefined;
      const sql = updateNote
        ? 'UPDATE lineages SET status = $1, note = $2, updated_at = $3 WHERE id = $4'
        : 'UPDATE lineages SET status = $1, updated_at = $2 WHERE id = $3';

      const params = updateNote
        ? [status, note, new Date().toISOString(), id]
        : [status, new Date().toISOString(), id];

      await this.db.query(sql, params);
    } catch (error) {
      throw new Error(
        `Failed to update lineage status: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private formatPostgresArrayLiteral(ids: string[]): string {
    if (!ids || ids.length === 0) return '{}';
    // PostgreSQL array elements need both backslash and quote escaping
    return `{${ids.map(id => {
      // First escape backslashes, then quotes (critical order for security)
      const escaped = id
        .replace(/\\/g, '\\\\')      // Escape backslashes: \ -> \\
        .replace(/"/g, '\\"');       // Escape quotes: " -> \"
      return `"${escaped}"`;
    }).join(',')}}`;
  }

  async updateLineage(lineage: Lineage): Promise<void> {
    try {
      // Convert arrays to PostgreSQL array literals
      const fromIdsLiteral = this.formatPostgresArrayLiteral(lineage.fromIds);
      const toIdsLiteral = this.formatPostgresArrayLiteral(lineage.toIds);

      await this.db.query(
        `
        UPDATE lineages SET 
          from_ids = $1, 
          to_ids = $2, 
          kind = $3, 
          status = $4, 
          confidence = $5, 
          note = $6, 
          git_commit = $7, 
          updated_at = $8 
        WHERE id = $9
      `,
        [
          fromIdsLiteral,
          toIdsLiteral,
          lineage.kind,
          lineage.status,
          lineage.confidence,
          lineage.note,
          lineage.gitCommit,
          new Date().toISOString(),
          lineage.id,
        ]
      );
    } catch (error) {
      throw new Error(
        `Failed to update lineage: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async deleteLineage(id: string): Promise<boolean> {
    try {
      const result = await this.db.query('DELETE FROM lineages WHERE id = $1', [id]);
      // Type-safe handling of PGLite query result
      const affectedRows = (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
      return affectedRows > 0;
    } catch (error) {
      throw new Error(
        `Failed to delete lineage: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getLineagesByCommit(gitCommit: string): Promise<Lineage[]> {
    try {
      const result = await this.db.query(
        `
        SELECT * FROM lineages WHERE git_commit = $1 ORDER BY created_at DESC
      `,
        [gitCommit]
      );

      return result.rows.map(row => this.mapRowToLineage(row));
    } catch (error) {
      throw new Error(
        `Failed to get lineages by commit: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getFunctionLineageHistory(functionId: string): Promise<Lineage[]> {
    try {
      const result = await this.db.query(
        `
        SELECT * FROM lineages 
        WHERE $1 = ANY(from_ids) OR $1 = ANY(to_ids)
        ORDER BY created_at DESC
      `,
        [functionId]
      );

      return result.rows.map(row => this.mapRowToLineage(row));
    } catch (error) {
      throw new Error(
        `Failed to get function lineage history: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async pruneDraftLineages(olderThanDays: number): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const result = await this.db.query(
        `
        DELETE FROM lineages 
        WHERE status = 'draft' AND created_at < $1
      `,
        [cutoffDate.toISOString()]
      );

      // Type-safe handling of PGLite query result
      const affectedRows = (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
      return affectedRows;
    } catch (error) {
      throw new Error(
        `Failed to prune draft lineages: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private mapRowToLineage(row: unknown): Lineage {
    // Type guard for database row structure
    const isValidLineageRow = (
      obj: unknown
    ): obj is {
      id: string;
      from_ids: string | string[];
      to_ids: string | string[];
      kind: string;
      status: string;
      confidence?: number;
      note?: string;
      git_commit: string;
      created_at: string;
      updated_at?: string;
    } => {
      return (
        typeof obj === 'object' &&
        obj !== null &&
        'id' in obj &&
        'from_ids' in obj &&
        'to_ids' in obj &&
        'kind' in obj &&
        'status' in obj &&
        'git_commit' in obj &&
        'created_at' in obj
      );
    };

    if (!isValidLineageRow(row)) {
      throw new Error('Invalid lineage row structure');
    }

    // Parse PostgreSQL arrays: {value1,value2} -> [value1, value2]
    const parsePostgresArray = (pgArray: string | string[]): string[] => {
      if (!pgArray) return [];

      // If it's already an array, return it
      if (Array.isArray(pgArray)) return pgArray;

      // If it's a string, parse it
      if (typeof pgArray === 'string') {
        if (pgArray === '{}') return [];
        // Remove outer braces and split by comma, handling quoted values
        const inner = pgArray.slice(1, -1);
        if (!inner) return [];
        return inner.split(',').map(item => item.replace(/^"(.*)"$/, '$1'));
      }

      return [];
    };

    return {
      id: row.id,
      fromIds: parsePostgresArray(row.from_ids),
      toIds: parsePostgresArray(row.to_ids),
      kind: row.kind as LineageKind,
      status: row.status as LineageStatus,
      confidence: row.confidence,
      note: row.note,
      gitCommit: row.git_commit,
      createdAt: new Date(row.created_at),
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
    } as Lineage;
  }

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
  // TRANSACTION MANAGEMENT
  // ========================================

  /**
   * Execute operations within a database transaction
   * Provides automatic rollback on errors and commit on success
   */
  async executeInTransaction<T>(operation: () => Promise<T>): Promise<T> {
    // Check for nested transactions
    if (this.transactionDepth > 0) {
      throw new Error(
        'Nested transactions are not supported. Use savepoints if nested transaction behavior is needed.'
      );
    }

    this.transactionDepth++;
    await this.db.query('BEGIN');
    try {
      const result = await operation();
      await this.db.query('COMMIT');
      return result;
    } catch (error) {
      await this.db.query('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }

  /**
   * Begin a database transaction manually
   */
  async beginTransaction(): Promise<void> {
    await this.db.query('BEGIN');
  }

  /**
   * Commit the current transaction
   */
  async commitTransaction(): Promise<void> {
    await this.db.query('COMMIT');
  }

  /**
   * Rollback the current transaction
   */
  async rollbackTransaction(): Promise<void> {
    await this.db.query('ROLLBACK');
  }

  // ========================================
  // FUNCTION HISTORY OPERATIONS
  // ========================================

  /**
   * Get function history across all snapshots efficiently
   * This avoids N+1 queries by fetching all data in a single query
   */
  async getFunctionHistory(
    functionId: string,
    options?: {
      limit?: number;
      includeAbsent?: boolean;
    }
  ): Promise<
    Array<{
      snapshot: SnapshotInfo;
      function: FunctionInfo | null;
      isPresent: boolean;
    }>
  > {
    await this.ensureInitialized();
    const limit = options?.limit || 100;
    const includeAbsent = options?.includeAbsent ?? false;

    try {
      // Get all snapshots ordered by creation time
      const snapshots = await this.getSnapshots({ limit });

      if (snapshots.length === 0) {
        return [];
      }

      // Build query to get function data across all snapshots in one go
      const snapshotIds = snapshots.map(s => s.id);
      const placeholders = snapshotIds.map((_, i) => `$${i + 2}`).join(',');

      const functionsResult = await this.db.query(
        `
        SELECT 
          f.id, f.semantic_id, f.content_id, f.snapshot_id, f.name, f.display_name, 
          f.signature, f.signature_hash, f.file_path, f.file_hash, f.start_line, f.end_line,
          f.start_column, f.end_column, f.ast_hash, f.context_path, f.function_type, 
          f.modifiers, f.nesting_level, f.is_exported, f.is_async, f.is_generator,
          f.is_arrow_function, f.is_method, f.is_constructor, f.is_static, 
          f.access_modifier, f.source_code, f.created_at,
          q.lines_of_code, q.total_lines, q.cyclomatic_complexity, q.cognitive_complexity,
          q.max_nesting_level, q.parameter_count, q.return_statement_count, q.branch_count,
          q.loop_count, q.try_catch_count, q.async_await_count, q.callback_count,
          q.comment_lines, q.code_to_comment_ratio, q.halstead_volume, q.halstead_difficulty,
          q.maintainability_index
        FROM functions f
        LEFT JOIN quality_metrics q ON f.id = q.function_id
        WHERE f.snapshot_id IN (${placeholders})
          AND (f.id = $1 OR f.id LIKE $1 || '%')
      `,
        [functionId, ...snapshotIds]
      );

      // Get all function IDs for batch parameter loading
      const functionIds = functionsResult.rows.map(row => (row as FunctionRow).id);

      // Batch load all parameters to avoid N+1 queries
      const parametersMap = new Map<string, ParameterRow[]>();
      if (functionIds.length > 0) {
        const parametersResult = await this.db.query(
          `SELECT * FROM function_parameters WHERE function_id = ANY($1) ORDER BY position`,
          [functionIds]
        );

        for (const paramRow of parametersResult.rows) {
          const param = paramRow as ParameterRow;
          if (!parametersMap.has(param.function_id)) {
            parametersMap.set(param.function_id, []);
          }
          parametersMap.get(param.function_id)!.push(param);
        }
      }

      // Create a map for quick lookup
      const functionMap = new Map<string, FunctionInfo>();
      for (const row of functionsResult.rows) {
        try {
          const functionRow = row as FunctionRow & Partial<MetricsRow>;
          // Get parameters from preloaded map
          const parameters = parametersMap.get(functionRow.id) || [];
          const func = this.mapRowToFunctionInfo(functionRow, parameters);
          // Use snapshot_id from the row to map functions
          functionMap.set(functionRow.snapshot_id, func);
        } catch (rowError) {
          console.error('Error processing function row:', rowError);
          console.error('Row data:', JSON.stringify(row, null, 2));
          throw rowError;
        }
      }

      // Build history array
      const history = snapshots.map(snapshot => {
        const func = functionMap.get(snapshot.id) || null;
        return {
          snapshot,
          function: func,
          isPresent: !!func,
        };
      });

      // Filter out absent functions if requested
      if (!includeAbsent) {
        return history.filter(h => h.isPresent);
      }

      return history;
    } catch (error) {
      throw new Error(
        `Failed to get function history: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ========================================
  // BULK OPERATIONS
  // ========================================

  /**
   * Bulk delete functions by snapshot ID with transaction support
   */
  async bulkDeleteFunctionsBySnapshot(snapshotId: string): Promise<number> {
    return await this.executeInTransaction(async () => {
      // Delete in reverse dependency order
      await this.db.query(
        'DELETE FROM quality_metrics WHERE function_id IN (SELECT id FROM functions WHERE snapshot_id = $1)',
        [snapshotId]
      );
      await this.db.query(
        'DELETE FROM function_parameters WHERE function_id IN (SELECT id FROM functions WHERE snapshot_id = $1)',
        [snapshotId]
      );
      await this.db.query(
        'DELETE FROM function_descriptions WHERE function_id IN (SELECT id FROM functions WHERE snapshot_id = $1)',
        [snapshotId]
      );

      const result = await this.db.query('DELETE FROM functions WHERE snapshot_id = $1', [
        snapshotId,
      ]);
      return (result as unknown as { changes: number }).changes || 0;
    });
  }

  /**
   * Bulk update quality metrics with transaction support
   */
  async bulkUpdateQualityMetrics(
    updates: Array<{ functionId: string; metrics: QualityMetrics }>
  ): Promise<void> {
    if (updates.length === 0) return;

    const batchSize = BatchProcessor.getOptimalBatchSize(updates.length, 2); // 2KB estimated per metric

    await this.executeInTransaction(async () => {
      const batches = BatchProcessor.batchArray(updates, batchSize);

      for (const batch of batches) {
        for (const { functionId, metrics } of batch) {
          await this.db.query(
            `
            UPDATE quality_metrics SET
              lines_of_code = $2, total_lines = $3, cyclomatic_complexity = $4, cognitive_complexity = $5,
              max_nesting_level = $6, parameter_count = $7, return_statement_count = $8, branch_count = $9,
              loop_count = $10, try_catch_count = $11, async_await_count = $12, callback_count = $13,
              comment_lines = $14, code_to_comment_ratio = $15, halstead_volume = $16, halstead_difficulty = $17,
              maintainability_index = $18
            WHERE function_id = $1
          `,
            [
              functionId,
              metrics.linesOfCode,
              metrics.totalLines,
              metrics.cyclomaticComplexity,
              metrics.cognitiveComplexity,
              metrics.maxNestingLevel,
              metrics.parameterCount,
              metrics.returnStatementCount,
              metrics.branchCount,
              metrics.loopCount,
              metrics.tryCatchCount,
              metrics.asyncAwaitCount,
              metrics.callbackCount,
              metrics.commentLines,
              metrics.codeToCommentRatio,
              metrics.halsteadVolume || null,
              metrics.halsteadDifficulty || null,
              metrics.maintainabilityIndex || null,
            ]
          );
        }
      }
    });
  }


  // ========================================
  // PRIVATE HELPER METHODS
  // ========================================

  /**
   * Ensure database is initialized before any operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.createSchema();
      this.isInitialized = true;
    }
  }

  private async createSchema(): Promise<void> {
    // Initialize database using migration system
    await this.initializeWithMigrations();
  }

  // Legacy methods removed - schema now loaded from database.sql file



  /**
   * Initialize database schema using migration system
   * Replaces the destructive dropOldTablesIfNeeded approach
   */
  private async initializeWithMigrations(): Promise<void> {
    // First, create base schema from database.sql if no tables exist
    const result = await this.db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'snapshots'
    `);
    
    if (result.rows.length === 0) {
      // Create initial schema from database.sql
      await this.createTablesDirectly();
    }
  }


  /**
   * Create tables directly using database.sql
   */
  private async createTablesDirectly(): Promise<void> {
    const schemaPath = new URL('../schemas/database.sql', import.meta.url).pathname;
    
    try {
      // Check if tables already exist
      const result = await this.db.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'snapshots'
      `);
      
      if (result.rows.length > 0) {
        // Database schema already exists - skip creation without logging
        // to avoid stdout contamination in JSON output
        return;
      }
      
      const schemaContent = readFileSync(schemaPath, 'utf-8');
      await this.db.exec(schemaContent);
      // Database schema creation completed - no logging to avoid stdout contamination
    } catch (error) {
      this.logger?.error(`❌ Failed to create database schema: ${error}`);
      throw new Error(`Database schema creation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  private generateSnapshotId(): string {
    return uuidv4();
  }

  private async createSnapshotRecord(
    snapshotId: string,
    functions: FunctionInfo[],
    configHash: string,
    label?: string,
    comment?: string
  ): Promise<void> {
    const metadata = this.calculateSnapshotMetadata(functions);
    // Use current UTC timestamp explicitly
    const nowUTC = new Date().toISOString();

    await this.db.query(
      `
      INSERT INTO snapshots (id, label, comment, git_commit, git_branch, git_tag, project_root, config_hash, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)
    `,
      [
        snapshotId,
        label || null,
        comment || null,
        await this.getGitCommit(),
        await this.getGitBranch(),
        await this.getGitTag(),
        process.cwd(),
        configHash,
        metadata,
        nowUTC,
      ]
    );
  }

  /**
   * Save functions using batch processing and transactions for optimal performance
   */
  private async saveFunctions(snapshotId: string, functions: FunctionInfo[]): Promise<void> {
    if (functions.length === 0) return;

    // Use optimal batch size based on function count and estimated memory usage
    const batchSize = BatchProcessor.calculateFunctionBatchSize(functions);

    // Create transaction processor for functions
    const processor: BatchTransactionProcessor<FunctionInfo> = {
      processBatch: async (batch: FunctionInfo[]) => {
        await this.saveFunctionsBatch(snapshotId, batch);
      },
      onError: async (error: Error, _batch: FunctionInfo[]) => {
        this.logger?.warn(`Failed to save batch of ${_batch.length} functions: ${error.message}`);
      },
      onSuccess: async (_batch: FunctionInfo[]) => {
        // Optional: Log successful batch processing
      },
    };

    // Process all functions in batches with transaction support
    await TransactionalBatchProcessor.processWithTransaction(functions, processor, batchSize);

    // Light verification for development (only for small datasets to prevent performance impact)
    if (process.env['NODE_ENV'] !== 'production' && functions.length < 100) {
      const savedCount = await this.db.query(
        'SELECT COUNT(*) as count FROM functions WHERE snapshot_id = $1',
        [snapshotId]
      );
      const actualFunctionCount = (savedCount.rows[0] as { count: string }).count;

      if (parseInt(actualFunctionCount) !== functions.length) {
        this.logger?.warn(`Function count mismatch: expected ${functions.length}, got ${actualFunctionCount}`);
      }
    }
  }

  /**
   * Save a batch of functions with transaction management
   */
  private async insertFunctionRecord(func: FunctionInfo, snapshotId: string): Promise<void> {
    await this.db.query(
      `
      INSERT INTO functions (
        id, semantic_id, content_id, snapshot_id, name, display_name, signature, signature_hash,
        file_path, file_hash, start_line, end_line, start_column, end_column,
        ast_hash, context_path, function_type, modifiers, nesting_level,
        is_exported, is_async, is_generator, is_arrow_function,
        is_method, is_constructor, is_static, access_modifier,
        source_code
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28
      )
    `,
      [
        func.id,
        func.semanticId,
        func.contentId,
        snapshotId,
        func.name,
        func.displayName,
        func.signature,
        func.signatureHash,
        func.filePath,
        func.fileHash,
        func.startLine,
        func.endLine,
        func.startColumn,
        func.endColumn,
        func.astHash,
        this.formatPostgresArrayLiteral(func.contextPath || []),
        func.functionType || null,
        this.formatPostgresArrayLiteral(func.modifiers || []),
        func.nestingLevel || 0,
        func.isExported,
        func.isAsync,
        func.isGenerator,
        func.isArrowFunction,
        func.isMethod,
        func.isConstructor,
        func.isStatic,
        func.accessModifier || null,
        func.sourceCode || null,
      ]
    );
  }

  private async insertFunctionParameters(func: FunctionInfo): Promise<void> {
    for (const param of func.parameters) {
      await this.db.query(
        `
        INSERT INTO function_parameters (
          function_id, name, type, type_simple, position, is_optional, is_rest, default_value, description
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
        [
          func.id,
          param.name,
          param.type,
          param.typeSimple,
          param.position,
          param.isOptional,
          param.isRest,
          param.defaultValue || null,
          param.description || null,
        ]
      );
    }
  }

  private async insertFunctionMetrics(func: FunctionInfo): Promise<void> {
    if (!func.metrics) {
      return;
    }

    await this.db.query(
      `
      INSERT INTO quality_metrics (
        function_id, lines_of_code, total_lines, cyclomatic_complexity, cognitive_complexity,
        max_nesting_level, parameter_count, return_statement_count, branch_count, loop_count,
        try_catch_count, async_await_count, callback_count, comment_lines, code_to_comment_ratio,
        halstead_volume, halstead_difficulty, maintainability_index
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
      )
    `,
      [
        func.id,
        func.metrics.linesOfCode,
        func.metrics.totalLines,
        func.metrics.cyclomaticComplexity,
        func.metrics.cognitiveComplexity,
        func.metrics.maxNestingLevel,
        func.metrics.parameterCount,
        func.metrics.returnStatementCount,
        func.metrics.branchCount,
        func.metrics.loopCount,
        func.metrics.tryCatchCount,
        func.metrics.asyncAwaitCount,
        func.metrics.callbackCount,
        func.metrics.commentLines,
        func.metrics.codeToCommentRatio,
        func.metrics.halsteadVolume || null,
        func.metrics.halsteadDifficulty || null,
        func.metrics.maintainabilityIndex || null,
      ]
    );
  }

  private async saveSingleFunction(func: FunctionInfo, snapshotId: string): Promise<void> {
    await this.insertFunctionRecord(func, snapshotId);
    await this.insertFunctionParameters(func);
    await this.insertFunctionMetrics(func);
  }

  async saveFunctionsBatch(snapshotId: string, functions: FunctionInfo[]): Promise<void> {
    // Use bulk insert for better performance when batch size is large enough
    if (functions.length >= 10) {
      await this.saveFunctionsBulk(snapshotId, functions);
    } else {
      // Fall back to individual inserts for small batches
      const executeIndividualInserts = async () => {
        for (const func of functions) {
          await this.saveSingleFunction(func, snapshotId);
        }
      };

      // Execute within transaction only if not already in one
      if (this.transactionDepth > 0) {
        // Already in transaction, execute directly
        await executeIndividualInserts();
      } else {
        // Not in transaction, create new one
        await this.executeInTransaction(executeIndividualInserts);
      }
    }
  }

  /**
   * Bulk insert functions for optimal performance
   */
  private async saveFunctionsBulk(snapshotId: string, functions: FunctionInfo[]): Promise<void> {
    const executeBulkInsert = async () => {
      const bulkData = prepareBulkInsertData(functions, snapshotId);

      // Bulk insert functions
      if (bulkData.functions.length > 0) {
        const functionColumns = [
          'id',
          'semantic_id',
          'content_id',
          'snapshot_id',
          'name',
          'display_name',
          'signature',
          'signature_hash',
          'file_path',
          'file_hash',
          'start_line',
          'end_line',
          'start_column',
          'end_column',
          'ast_hash',
          'context_path',
          'function_type',
          'modifiers',
          'nesting_level',
          'is_exported',
          'is_async',
          'is_generator',
          'is_arrow_function',
          'is_method',
          'is_constructor',
          'is_static',
          'access_modifier',
          'source_code',
        ];

        const optimalBatchSize = calculateOptimalBatchSize(functionColumns.length);
        const functionBatches = splitIntoBatches(bulkData.functions, optimalBatchSize);

        for (const batch of functionBatches) {
          const sql = generateBulkInsertSQL('functions', functionColumns, batch.length);
          const flatParams = batch.flat();
          await this.db.query(sql, flatParams);
        }
      }

      // Bulk insert parameters
      if (bulkData.parameters.length > 0) {
        const paramColumns = [
          'function_id',
          'name',
          'type',
          'type_simple',
          'position',
          'is_optional',
          'is_rest',
          'default_value',
          'description',
        ];

        const optimalBatchSize = calculateOptimalBatchSize(paramColumns.length);
        const paramBatches = splitIntoBatches(bulkData.parameters, optimalBatchSize);

        for (const batch of paramBatches) {
          const sql = generateBulkInsertSQL('function_parameters', paramColumns, batch.length);
          const flatParams = batch.flat();
          await this.db.query(sql, flatParams);
        }
      }

      // Bulk insert metrics
      if (bulkData.metrics.length > 0) {
        const metricsColumns = [
          'function_id',
          'lines_of_code',
          'total_lines',
          'cyclomatic_complexity',
          'cognitive_complexity',
          'max_nesting_level',
          'parameter_count',
          'return_statement_count',
          'branch_count',
          'loop_count',
          'try_catch_count',
          'async_await_count',
          'callback_count',
          'comment_lines',
          'code_to_comment_ratio',
          'halstead_volume',
          'halstead_difficulty',
          'maintainability_index',
        ];

        const optimalBatchSize = calculateOptimalBatchSize(metricsColumns.length);
        const metricsBatches = splitIntoBatches(bulkData.metrics, optimalBatchSize);

        for (const batch of metricsBatches) {
          const sql = generateBulkInsertSQL('quality_metrics', metricsColumns, batch.length);
          const flatParams = batch.flat();
          await this.db.query(sql, flatParams);
        }
      }
    };

    // Execute within transaction only if not already in one
    if (this.transactionDepth > 0) {
      // Already in transaction, execute directly
      await executeBulkInsert();
    } else {
      // Not in transaction, create new one
      await this.executeInTransaction(executeBulkInsert);
    }
  }

  private async getFunctionParameters(functionId: string): Promise<ParameterRow[]> {
    const result = await this.db.query(
      'SELECT * FROM function_parameters WHERE function_id = $1 ORDER BY position',
      [functionId]
    );
    return result.rows as ParameterRow[];
  }

  private async getFunctionParametersBatch(
    functionIds: string[]
  ): Promise<Map<string, ParameterRow[]>> {
    if (functionIds.length === 0) {
      return new Map();
    }

    const idsArray = this.formatPostgresArrayLiteral(functionIds);
    const result = await this.db.query(
      'SELECT * FROM function_parameters WHERE function_id = ANY($1::text[]) ORDER BY function_id, position',
      [idsArray]
    );

    const parameterMap = new Map<string, ParameterRow[]>();

    for (const row of result.rows as ParameterRow[]) {
      const functionId = row.function_id;
      if (!parameterMap.has(functionId)) {
        parameterMap.set(functionId, []);
      }
      parameterMap.get(functionId)!.push(row);
    }

    return parameterMap;
  }

  private mapRowToSnapshotInfo(row: SnapshotRow): SnapshotInfo {
    return {
      id: row.id,
      createdAt: new Date(row.created_at).getTime(),
      ...(row.label && { label: row.label }),
      ...(row.comment && { comment: row.comment }),
      ...(row.git_commit && { gitCommit: row.git_commit }),
      ...(row.git_branch && { gitBranch: row.git_branch }),
      ...(row.git_tag && { gitTag: row.git_tag }),
      projectRoot: row.project_root,
      configHash: row.config_hash,
      metadata: row.metadata || {
        totalFunctions: 0,
        totalFiles: 0,
        avgComplexity: 0,
        maxComplexity: 0,
        exportedFunctions: 0,
        asyncFunctions: 0,
        complexityDistribution: {},
        fileExtensions: {}
      },
    };
  }

  private mapRowToFunctionInfo(
    row: FunctionRow &
      Partial<MetricsRow> & {
        description?: string;
        source?: string;
        created_at?: string;
        updated_at?: string;
        ai_model?: string;
      },
    parameters: ParameterRow[]
  ): FunctionInfo {
    const functionInfo = this.createBaseFunctionInfo(row, parameters);
    this.addOptionalProperties(functionInfo, row);
    this.addMetricsIfAvailable(functionInfo, row);
    return functionInfo;
  }

  private createBaseFunctionInfo(row: FunctionRow, parameters: ParameterRow[]): FunctionInfo {
    return {
      id: row.id,
      semanticId: row.semantic_id,
      contentId: row.content_id,
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

      // Enhanced function identification
      ...(row.context_path && Array.isArray(row.context_path) && { contextPath: row.context_path }),
      ...(row.function_type && { functionType: row.function_type }),
      ...(row.modifiers && Array.isArray(row.modifiers) && { modifiers: row.modifiers }),
      ...(row.nesting_level !== undefined && { nestingLevel: row.nesting_level }),

      // Existing function attributes
      isExported: row.is_exported,
      isAsync: row.is_async,
      isGenerator: row.is_generator,
      isArrowFunction: row.is_arrow_function,
      isMethod: row.is_method,
      isConstructor: row.is_constructor,
      isStatic: row.is_static,
      parameters: this.mapParameters(parameters),
    };
  }

  private mapParameters(parameters: ParameterRow[]): ParameterInfo[] {
    return parameters.map(p => ({
      name: p.name,
      type: p.type,
      typeSimple: p.type_simple,
      position: p.position,
      isOptional: p.is_optional,
      isRest: p.is_rest,
      ...(p.default_value && { defaultValue: p.default_value }),
      ...(p.description && { description: p.description }),
    }));
  }

  private addOptionalProperties(
    functionInfo: FunctionInfo,
    row: FunctionRow & {
      description?: string;
      source?: string;
      created_at?: string;
      updated_at?: string;
      ai_model?: string;
    }
  ): void {
    if (row.access_modifier) functionInfo.accessModifier = row.access_modifier;
    // Note: js_doc is now stored in function_documentation table
    if (row.source_code) functionInfo.sourceCode = row.source_code;
    if (row.description) {
      functionInfo.description = row.description;
      // Add description metadata as proper properties on the functionInfo object
      if (row.source) functionInfo.descriptionSource = row.source;
      if (row.created_at) functionInfo.descriptionCreatedAt = row.created_at;
      if (row.updated_at) functionInfo.descriptionUpdatedAt = row.updated_at;
      if (row.ai_model) functionInfo.descriptionAiModel = row.ai_model;
    }
  }

  private addMetricsIfAvailable(functionInfo: FunctionInfo, row: Partial<MetricsRow>): void {
    if (row.lines_of_code === null || row.lines_of_code === undefined) return;

    functionInfo.metrics = {
      linesOfCode: row.lines_of_code ?? 0,
      totalLines: row.total_lines ?? 0,
      cyclomaticComplexity: row.cyclomatic_complexity ?? 1,
      cognitiveComplexity: row.cognitive_complexity ?? 0,
      maxNestingLevel: row.max_nesting_level ?? 0,
      parameterCount: row.parameter_count ?? 0,
      returnStatementCount: row.return_statement_count ?? 0,
      branchCount: row.branch_count ?? 0,
      loopCount: row.loop_count ?? 0,
      tryCatchCount: row.try_catch_count ?? 0,
      asyncAwaitCount: row.async_await_count ?? 0,
      callbackCount: row.callback_count ?? 0,
      commentLines: row.comment_lines ?? 0,
      codeToCommentRatio: row.code_to_comment_ratio ?? 0,
      ...this.getOptionalMetrics(row),
    };
  }

  private getOptionalMetrics(row: Partial<MetricsRow>): Partial<QualityMetrics> {
    return {
      ...(row.halstead_volume !== null &&
        row.halstead_volume !== undefined && { halsteadVolume: row.halstead_volume }),
      ...(row.halstead_difficulty !== null &&
        row.halstead_difficulty !== undefined && { halsteadDifficulty: row.halstead_difficulty }),
      ...(row.maintainability_index !== null &&
        row.maintainability_index !== undefined && {
          maintainabilityIndex: row.maintainability_index,
        }),
    };
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
        fileExtensions: {},
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
      avgComplexity:
        complexities.length > 0
          ? Math.round((complexities.reduce((a, b) => a + b, 0) / complexities.length) * 10) / 10
          : 0,
      maxComplexity: complexities.length > 0 ? Math.max(...complexities) : 0,
      exportedFunctions: functions.filter(f => f.isExported).length,
      asyncFunctions: functions.filter(f => f.isAsync).length,
      complexityDistribution,
      fileExtensions,
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

  // ========================================
  // NAMING EVALUATION OPERATIONS (v1.6 Enhancement)
  // ========================================

  async saveNamingEvaluation(evaluation: NamingEvaluation): Promise<void> {
    try {
      await this.db.query(
        `
        INSERT INTO naming_evaluations (
          function_id, semantic_id, function_name, description_hash, rating,
          evaluated_at, evaluated_by, issues, suggestions, revision_needed,
          ai_model, confidence
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (function_id) DO UPDATE SET
          semantic_id = EXCLUDED.semantic_id,
          function_name = EXCLUDED.function_name,
          description_hash = EXCLUDED.description_hash,
          rating = EXCLUDED.rating,
          evaluated_at = EXCLUDED.evaluated_at,
          evaluated_by = EXCLUDED.evaluated_by,
          issues = EXCLUDED.issues,
          suggestions = EXCLUDED.suggestions,
          revision_needed = EXCLUDED.revision_needed,
          ai_model = EXCLUDED.ai_model,
          confidence = EXCLUDED.confidence,
          updated_at = CURRENT_TIMESTAMP
      `,
        [
          evaluation.functionId,
          evaluation.semanticId,
          evaluation.functionName,
          evaluation.descriptionHash,
          evaluation.rating,
          evaluation.evaluatedAt,
          evaluation.evaluatedBy,
          evaluation.issues || null,
          evaluation.suggestions || null,
          evaluation.revisionNeeded,
          evaluation.aiModel || null,
          evaluation.confidence || null,
        ]
      );
    } catch (error) {
      throw new Error(
        `Failed to save naming evaluation: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getNamingEvaluation(functionId: string): Promise<NamingEvaluation | null> {
    try {
      const queryResult = await this.db.query(
        'SELECT * FROM naming_evaluations WHERE function_id = $1',
        [functionId]
      );

      if (queryResult.rows.length === 0) {
        return null;
      }

      const row = queryResult.rows[0] as {
        function_id: string;
        semantic_id: string;
        function_name: string;
        description_hash: string;
        rating: 1 | 2 | 3;
        evaluated_at: string;
        evaluated_by: 'human' | 'ai' | 'auto';
        issues?: string;
        suggestions?: string;
        revision_needed: boolean;
        ai_model?: string;
        confidence?: number;
      };

      const result: NamingEvaluation = {
        functionId: row.function_id,
        semanticId: row.semantic_id,
        functionName: row.function_name,
        descriptionHash: row.description_hash,
        rating: row.rating,
        evaluatedAt: parseInt(row.evaluated_at),
        evaluatedBy: row.evaluated_by,
        revisionNeeded: row.revision_needed,
      };

      if (row.issues) result.issues = row.issues;
      if (row.suggestions) result.suggestions = row.suggestions;
      if (row.ai_model) result.aiModel = row.ai_model;
      if (row.confidence !== null && row.confidence !== undefined)
        result.confidence = row.confidence;

      return result;
    } catch (error) {
      throw new Error(
        `Failed to get naming evaluation: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getFunctionsNeedingEvaluation(
    snapshotId: string,
    options?: QueryOptions
  ): Promise<Array<{ functionId: string; functionName: string; lastModified: number }>> {
    try {
      let sql = `
        SELECT 
          f.id as function_id,
          f.name as function_name,
          EXTRACT(EPOCH FROM f.created_at) * 1000 as last_modified
        FROM functions f
        LEFT JOIN naming_evaluations ne ON f.id = ne.function_id
        WHERE f.snapshot_id = $1 
        AND (
          ne.function_id IS NULL 
          OR ne.revision_needed = TRUE
        )
        ORDER BY f.created_at DESC
      `;

      const params: (string | number)[] = [snapshotId];

      if (options?.limit) {
        sql += ' LIMIT $' + (params.length + 1);
        params.push(options.limit);
      }

      if (options?.offset) {
        sql += ' OFFSET $' + (params.length + 1);
        params.push(options.offset);
      }

      const result = await this.db.query(sql, params);

      return result.rows.map(row => ({
        functionId: (row as { function_id: string }).function_id,
        functionName: (row as { function_name: string }).function_name,
        lastModified: (row as { last_modified: number }).last_modified,
      }));
    } catch (error) {
      throw new Error(
        `Failed to get functions needing evaluation: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getFunctionsWithEvaluations(
    snapshotId: string,
    options?: QueryOptions
  ): Promise<Array<{ functionId: string; evaluation: NamingEvaluation }>> {
    try {
      let sql = `
        SELECT 
          f.id as function_id,
          ne.*
        FROM functions f
        INNER JOIN naming_evaluations ne ON f.id = ne.function_id
        WHERE f.snapshot_id = $1
        ORDER BY ne.evaluated_at DESC
      `;

      const params: (string | number)[] = [snapshotId];

      if (options?.limit) {
        sql += ' LIMIT $' + (params.length + 1);
        params.push(options.limit);
      }

      if (options?.offset) {
        sql += ' OFFSET $' + (params.length + 1);
        params.push(options.offset);
      }

      const result = await this.db.query(sql, params);

      return result.rows.map(row => {
        const r = row as {
          function_id: string;
          semantic_id: string;
          function_name: string;
          description_hash: string;
          rating: 1 | 2 | 3;
          evaluated_at: string;
          evaluated_by: 'human' | 'ai' | 'auto';
          issues?: string;
          suggestions?: string;
          revision_needed: boolean;
          ai_model?: string;
          confidence?: number;
        };

        const evaluation: NamingEvaluation = {
          functionId: r.function_id,
          semanticId: r.semantic_id,
          functionName: r.function_name,
          descriptionHash: r.description_hash,
          rating: r.rating,
          evaluatedAt: parseInt(r.evaluated_at),
          evaluatedBy: r.evaluated_by,
          revisionNeeded: r.revision_needed,
        };

        if (r.issues) evaluation.issues = r.issues;
        if (r.suggestions) evaluation.suggestions = r.suggestions;
        if (r.ai_model) evaluation.aiModel = r.ai_model;
        if (r.confidence !== null && r.confidence !== undefined)
          evaluation.confidence = r.confidence;

        return {
          functionId: r.function_id,
          evaluation,
        };
      });
    } catch (error) {
      throw new Error(
        `Failed to get functions with evaluations: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async updateEvaluationRevisionStatus(functionId: string, revisionNeeded: boolean): Promise<void> {
    try {
      await this.db.query(
        'UPDATE naming_evaluations SET revision_needed = $1, updated_at = CURRENT_TIMESTAMP WHERE function_id = $2',
        [revisionNeeded, functionId]
      );
    } catch (error) {
      throw new Error(
        `Failed to update evaluation revision status: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async batchSaveEvaluations(evaluations: NamingEvaluation[]): Promise<void> {
    if (evaluations.length === 0) return;

    try {
      await TransactionalBatchProcessor.processWithTransaction(
        evaluations,
        {
          processBatch: async (batch: NamingEvaluation[]) => {
            const values = batch
              .map((_, index) => {
                const offset = index * 12;
                return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12})`;
              })
              .join(', ');

            const params = batch.flatMap((evaluation: NamingEvaluation) => [
              evaluation.functionId,
              evaluation.semanticId,
              evaluation.functionName,
              evaluation.descriptionHash,
              evaluation.rating,
              evaluation.evaluatedAt,
              evaluation.evaluatedBy,
              evaluation.issues || null,
              evaluation.suggestions || null,
              evaluation.revisionNeeded,
              evaluation.aiModel || null,
              evaluation.confidence || null,
            ]);

            await this.db.query(
              `
              INSERT INTO naming_evaluations (
                function_id, semantic_id, function_name, description_hash, rating,
                evaluated_at, evaluated_by, issues, suggestions, revision_needed,
                ai_model, confidence
              ) VALUES ${values}
              ON CONFLICT (function_id) DO UPDATE SET
                semantic_id = EXCLUDED.semantic_id,
                function_name = EXCLUDED.function_name,
                description_hash = EXCLUDED.description_hash,
                rating = EXCLUDED.rating,
                evaluated_at = EXCLUDED.evaluated_at,
                evaluated_by = EXCLUDED.evaluated_by,
                issues = EXCLUDED.issues,
                suggestions = EXCLUDED.suggestions,
                revision_needed = EXCLUDED.revision_needed,
                ai_model = EXCLUDED.ai_model,
                confidence = EXCLUDED.confidence,
                updated_at = CURRENT_TIMESTAMP
            `,
              params
            );
          },
          onError: async (error: Error, _batch: NamingEvaluation[]) => {
            throw error;
          },
          onSuccess: async (_batch: NamingEvaluation[]) => {
            // Success callback
          },
        },
        10 // Process in batches of 10
      );
    } catch (error) {
      throw new Error(
        `Failed to batch save evaluations: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getEvaluationStatistics(snapshotId: string): Promise<{
    total: number;
    withEvaluations: number;
    needingEvaluation: number;
    averageRating: number;
    ratingDistribution: Record<1 | 2 | 3, number>;
  }> {
    try {
      // Get total functions count
      const totalResult = await this.db.query(
        'SELECT COUNT(*) as total FROM functions WHERE snapshot_id = $1',
        [snapshotId]
      );
      const total = Number((totalResult.rows[0] as { total: string | number }).total);

      // Get functions with evaluations
      const evaluationsResult = await this.db.query(
        `
        SELECT 
          COUNT(*) as with_evaluations,
          AVG(ne.rating::numeric) as average_rating,
          SUM(CASE WHEN ne.rating = 1 THEN 1 ELSE 0 END) as rating_1,
          SUM(CASE WHEN ne.rating = 2 THEN 1 ELSE 0 END) as rating_2,
          SUM(CASE WHEN ne.rating = 3 THEN 1 ELSE 0 END) as rating_3
        FROM functions f
        INNER JOIN naming_evaluations ne ON f.id = ne.function_id
        WHERE f.snapshot_id = $1
      `,
        [snapshotId]
      );

      const evalRow = evaluationsResult.rows[0] as {
        with_evaluations: string | number;
        average_rating: string | number;
        rating_1: string | number;
        rating_2: string | number;
        rating_3: string | number;
      };

      // Get functions needing evaluation
      const needingResult = await this.db.query(
        `
        SELECT COUNT(*) as needing_evaluation
        FROM functions f
        LEFT JOIN naming_evaluations ne ON f.id = ne.function_id
        WHERE f.snapshot_id = $1 
        AND (ne.function_id IS NULL OR ne.revision_needed = TRUE)
      `,
        [snapshotId]
      );

      const needingEvaluation = Number(
        (needingResult.rows[0] as { needing_evaluation: string | number }).needing_evaluation
      );

      return {
        total,
        withEvaluations: Number(evalRow.with_evaluations) || 0,
        needingEvaluation,
        averageRating: Number(evalRow.average_rating) || 0,
        ratingDistribution: {
          1: Number(evalRow.rating_1) || 0,
          2: Number(evalRow.rating_2) || 0,
          3: Number(evalRow.rating_3) || 0,
        },
      };
    } catch (error) {
      throw new Error(
        `Failed to get evaluation statistics: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Safely parse JSON with fallback value
   */
  private safeJsonParse<T>(jsonString: string, fallback: T): T {
    try {
      return JSON.parse(jsonString);
    } catch (error) {
      this.logger?.warn(`Failed to parse JSON: ${jsonString} - ${error}`);
      return fallback;
    }
  }

  /**
   * Get all refactoring sessions ordered by creation date
   * Type-safe method to retrieve all RefactoringSession records
   */
  async getAllRefactoringSessions(): Promise<RefactoringSession[]> {
    try {
      const result = await this.db.query(
        'SELECT * FROM refactoring_sessions ORDER BY created_at DESC'
      );

      return result.rows.map(row =>
        this.mapRowToRefactoringSession(
          row as {
            id: string;
            name: string;
            description: string;
            status: 'active' | 'completed' | 'cancelled';
            target_branch: string;
            start_time: string;
            end_time?: string;
            metadata: string;
            created_at: string;
            updated_at: string;
          }
        )
      );
    } catch (error) {
      throw new Error(
        `Failed to get refactoring sessions: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }


  /**
   * Map database row to RefactoringSession type
   * Ensures type safety when converting database results
   */
  private mapRowToRefactoringSession(row: {
    id: string;
    name: string;
    description: string;
    status: 'active' | 'completed' | 'cancelled';
    target_branch: string;
    start_time: string;
    end_time?: string;
    metadata: string;
    created_at: string;
    updated_at: string;
  }): RefactoringSession {
    const session: RefactoringSession = {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      target_branch: row.target_branch,
      start_time: new Date(row.start_time).getTime(),
      metadata: this.safeJsonParse(row.metadata, {}),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };

    if (row.end_time) {
      session.end_time = new Date(row.end_time).getTime();
    }

    return session;
  }


  // ========================================
  // REFACTORING HEALTH ENGINE METHODS
  // ========================================

  /**
   * Save a refactoring changeset
   */
  async saveRefactoringChangeset(changeset: RefactoringChangeset): Promise<void> {
    await this.db.query(`
      INSERT INTO refactoring_changesets (
        id, session_id, operation_type, intent, parent_function_id, child_function_ids,
        before_snapshot_id, after_snapshot_id, health_assessment, improvement_metrics,
        is_genuine_improvement, function_explosion_score, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (id) DO UPDATE SET
        session_id = EXCLUDED.session_id,
        operation_type = EXCLUDED.operation_type,
        intent = EXCLUDED.intent,
        parent_function_id = EXCLUDED.parent_function_id,
        child_function_ids = EXCLUDED.child_function_ids,
        before_snapshot_id = EXCLUDED.before_snapshot_id,
        after_snapshot_id = EXCLUDED.after_snapshot_id,
        health_assessment = EXCLUDED.health_assessment,
        improvement_metrics = EXCLUDED.improvement_metrics,
        is_genuine_improvement = EXCLUDED.is_genuine_improvement,
        function_explosion_score = EXCLUDED.function_explosion_score,
        updated_at = EXCLUDED.updated_at
    `, [
      changeset.id,
      changeset.sessionId,
      changeset.operationType,
      changeset.intent,
      changeset.parentFunctionId || null,
      changeset.childFunctionIds,
      changeset.beforeSnapshotId,
      changeset.afterSnapshotId,
      changeset.healthAssessment ? JSON.stringify(changeset.healthAssessment) : null,
      changeset.improvementMetrics ? JSON.stringify(changeset.improvementMetrics) : null,
      changeset.isGenuineImprovement,
      changeset.functionExplosionScore,
      changeset.createdAt.toISOString(),
      changeset.updatedAt.toISOString(),
    ]);

    // Note: PGLite doesn't return affectedRows directly
    // The operation succeeds if no exception is thrown
  }

  /**
   * Get a refactoring changeset by ID
   */
  async getRefactoringChangeset(id: string): Promise<RefactoringChangeset | null> {
    const result = await this.db.query(`
      SELECT id, session_id, operation_type, parent_function_id, child_function_ids,
             before_snapshot_id, after_snapshot_id, health_assessment, improvement_metrics,
             is_genuine_improvement, function_explosion_score, created_at, updated_at
      FROM refactoring_changesets
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToRefactoringChangeset(result.rows[0] as RefactoringChangesetRow);
  }

  /**
   * Get refactoring changesets by session ID
   */
  async getRefactoringChangesetsBySession(sessionId: string): Promise<RefactoringChangeset[]> {
    const result = await this.db.query(`
      SELECT id, session_id, operation_type, intent, parent_function_id, child_function_ids,
             before_snapshot_id, after_snapshot_id, health_assessment, improvement_metrics,
             is_genuine_improvement, function_explosion_score, created_at, updated_at
      FROM refactoring_changesets
      WHERE session_id = $1
      ORDER BY created_at DESC
    `, [sessionId]);

    return result.rows.map(row => this.mapRowToRefactoringChangeset(row as RefactoringChangesetRow));
  }

  /**
   * Update a refactoring changeset
   */
  async updateRefactoringChangeset(id: string, updates: Partial<RefactoringChangeset>): Promise<void> {
    const setParts: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (updates.healthAssessment !== undefined) {
      setParts.push(`health_assessment = $${paramIndex++}`);
      params.push(updates.healthAssessment ? JSON.stringify(updates.healthAssessment) : null);
    }

    if (updates.improvementMetrics !== undefined) {
      setParts.push(`improvement_metrics = $${paramIndex++}`);
      params.push(updates.improvementMetrics ? JSON.stringify(updates.improvementMetrics) : null);
    }

    if (updates.isGenuineImprovement !== undefined) {
      setParts.push(`is_genuine_improvement = $${paramIndex++}`);
      params.push(updates.isGenuineImprovement);
    }

    if (updates.functionExplosionScore !== undefined) {
      setParts.push(`function_explosion_score = $${paramIndex++}`);
      params.push(updates.functionExplosionScore);
    }

    if (setParts.length === 0) {
      return; // No updates to make
    }

    setParts.push(`updated_at = $${paramIndex++}`);
    params.push(new Date().toISOString());

    params.push(id); // WHERE clause parameter

    await this.db.query(`
      UPDATE refactoring_changesets
      SET ${setParts.join(', ')}
      WHERE id = $${paramIndex}
    `, params);
  }

  /**
   * Get functions by snapshot ID (helper method for RefactoringHealthEngine)
   */
  async getFunctionsBySnapshotId(snapshotId: string): Promise<FunctionInfo[]> {
    return await this.getFunctions(snapshotId);
  }

  /**
   * Get lineages by function ID (helper method for LineageManager)
   */
  async getLineagesByFunctionId(functionId: string): Promise<Lineage[]> {
    const result = await this.db.query(`
      SELECT id, from_ids, to_ids, kind, status, confidence, note, git_commit, created_at, updated_at
      FROM lineages
      WHERE $1 = ANY(from_ids) OR $1 = ANY(to_ids)
      ORDER BY created_at DESC
    `, [functionId]);

    return result.rows.map(row => this.mapRowToLineage(row as Record<string, unknown>));
  }

  /**
   * Update refactoring session
   */
  async updateRefactoringSession(id: string, updates: Partial<RefactoringSession>): Promise<void> {
    const setParts: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (updates.description !== undefined) {
      setParts.push(`description = $${paramIndex++}`);
      params.push(updates.description);
    }

    if (updates.status !== undefined) {
      setParts.push(`status = $${paramIndex++}`);
      params.push(updates.status);
    }

    if (updates.end_time !== undefined) {
      setParts.push(`end_time = $${paramIndex++}`);
      params.push(updates.end_time ? new Date(updates.end_time).toISOString() : null);
    }

    if (updates.metadata !== undefined) {
      setParts.push(`metadata = $${paramIndex++}`);
      params.push(JSON.stringify(updates.metadata));
    }

    if (setParts.length === 0) {
      return; // No updates to make
    }

    setParts.push(`updated_at = $${paramIndex++}`);
    params.push(new Date().toISOString());

    params.push(id); // WHERE clause parameter

    await this.db.query(`
      UPDATE refactoring_sessions
      SET ${setParts.join(', ')}
      WHERE id = $${paramIndex}
    `, params);
  }

  /**
   * Get refactoring sessions
   */
  async getRefactoringSessions(query?: QueryOptions): Promise<RefactoringSession[]> {
    const limit = query?.limit ?? 100;
    const offset = query?.offset ?? 0;

    const result = await this.db.query(`
      SELECT id, name, description, status, target_branch, start_time,
             end_time, metadata, created_at, updated_at
      FROM refactoring_sessions
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    return result.rows.map(row => this.mapRowToRefactoringSession(row as {
      id: string;
      name: string;
      description: string;
      status: 'active' | 'completed' | 'cancelled';
      target_branch: string;
      start_time: string;
      end_time?: string;
      metadata: string;
      created_at: string;
      updated_at: string;
    }));
  }

  /**
   * Map database row to RefactoringChangeset object
   */
  private mapRowToRefactoringChangeset(row: RefactoringChangesetRow): RefactoringChangeset {
    const parsePostgresArray = (pgArray: string | string[]): string[] => {
      if (Array.isArray(pgArray)) return pgArray;
      if (!pgArray || pgArray === '{}') return [];
      // PostgreSQL array format: {item1,item2,item3} or {"item1","item2","item3"}
      return pgArray.slice(1, -1).split(',').map(id => id.replace(/^"(.*)"$/, '$1'));
    };

    const changeset: RefactoringChangeset = {
      id: row.id,
      sessionId: row.session_id,
      operationType: row.operation_type as 'split' | 'extract' | 'merge' | 'rename',
      intent: row.intent as RefactoringIntent,
      childFunctionIds: parsePostgresArray(row.child_function_ids),
      beforeSnapshotId: row.before_snapshot_id,
      afterSnapshotId: row.after_snapshot_id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };

    // Only set optional properties if they have values
    if (row.parent_function_id) {
      changeset.parentFunctionId = row.parent_function_id;
    }
    if (row.health_assessment) {
      changeset.healthAssessment = JSON.parse(row.health_assessment);
    }
    if (row.improvement_metrics) {
      changeset.improvementMetrics = JSON.parse(row.improvement_metrics);
    }
    if (row.is_genuine_improvement !== null) {
      changeset.isGenuineImprovement = row.is_genuine_improvement;
    }
    if (row.function_explosion_score !== null) {
      changeset.functionExplosionScore = row.function_explosion_score;
    }

    return changeset;
  }

  /**
   * Save a refactoring session
   */
  async saveRefactoringSession(session: RefactoringSession): Promise<void> {
    await this.db.query(`
      INSERT INTO refactoring_sessions (
        id, name, description, status, target_branch, start_time,
        end_time, metadata, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        status = EXCLUDED.status,
        target_branch = EXCLUDED.target_branch,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
    `, [
      session.id,
      session.name,
      session.description,
      session.status,
      session.target_branch,
      new Date(session.start_time).toISOString(),
      session.end_time ? new Date(session.end_time).toISOString() : null,
      JSON.stringify(session.metadata || {}),
      session.created_at.toISOString(),
      session.updated_at.toISOString(),
    ]);
  }

  /**
   * Get a refactoring session by ID
   */
  async getRefactoringSession(id: string): Promise<RefactoringSession | null> {
    const result = await this.db.query(`
      SELECT id, name, description, status, target_branch, start_time,
             end_time, metadata, created_at, updated_at
      FROM refactoring_sessions
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToRefactoringSession(result.rows[0] as {
      id: string;
      name: string;
      description: string;
      status: 'active' | 'completed' | 'cancelled';
      target_branch: string;
      start_time: string;
      end_time?: string;
      metadata: string;
      created_at: string;
      updated_at: string;
    });
  }

  // =============================================================================
  // CALL EDGES OPERATIONS
  // =============================================================================

  /**
   * Insert call edges using bulk insert for efficient storage
   */
  async insertCallEdges(edges: CallEdge[], snapshotId: string): Promise<void> {
    if (edges.length === 0) return;

    try {
      // Use bulk insert for better performance when batch size is large enough
      if (edges.length >= 10) {
        await this.insertCallEdgesBulk(edges, snapshotId);
      } else {
        // Fall back to individual inserts for small batches (preserve upsert logic)
        await this.insertCallEdgesIndividual(edges, snapshotId);
      }
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to insert call edges: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Bulk insert call edges for optimal performance
   */
  private async insertCallEdgesBulk(edges: CallEdge[], snapshotId: string): Promise<void> {
    const executeBulkInsert = async () => {
      // Define call_edges table columns in correct order
      const callEdgeColumns = [
        'id',
        'snapshot_id', 
        'caller_function_id',
        'callee_function_id',
        'callee_name',
        'callee_signature',
        'caller_class_name',
        'callee_class_name',
        'call_type',
        'call_context',
        'line_number',
        'column_number',
        'is_async',
        'is_chained',
        'confidence_score',
        'metadata',
        'created_at'
      ];

      // Prepare bulk data
      const callEdgeData = edges.map(edge => [
        edge.id,
        snapshotId,
        edge.callerFunctionId,
        edge.calleeFunctionId || null,
        edge.calleeName,
        edge.calleeSignature || null,
        edge.callerClassName || null,
        edge.calleeClassName || null,
        edge.callType,
        edge.callContext || null,
        edge.lineNumber,
        edge.columnNumber ?? 0,
        edge.isAsync ?? false,
        edge.isChained ?? false,
        edge.confidenceScore ?? 1.0,
        edge.metadata || null,
        edge.createdAt || new Date().toISOString()
      ]);

      // Calculate optimal batch size for call edges (17 columns)
      const optimalBatchSize = calculateOptimalBatchSize(callEdgeColumns.length);
      const batches = splitIntoBatches(callEdgeData, optimalBatchSize);

      // Execute bulk insert with upsert
      for (const batch of batches) {
        const sql = generateBulkInsertSQL('call_edges', callEdgeColumns, batch.length) + `
          ON CONFLICT (id) DO UPDATE SET
            snapshot_id = EXCLUDED.snapshot_id,
            confidence_score = GREATEST(EXCLUDED.confidence_score, call_edges.confidence_score),
            call_type = EXCLUDED.call_type,
            call_context = EXCLUDED.call_context,
            callee_signature = COALESCE(EXCLUDED.callee_signature, call_edges.callee_signature),
            is_async = EXCLUDED.is_async,
            is_chained = EXCLUDED.is_chained,
            metadata = EXCLUDED.metadata
        `;
        
        const flatParams = batch.flat();
        await this.db.query(sql, flatParams);
      }
    };

    // Execute within current transaction context or create new one
    if (this.transactionDepth > 0) {
      await executeBulkInsert();
    } else {
      await this.executeInTransaction(executeBulkInsert);
    }
  }

  /**
   * Individual insert for small batches (preserving complex upsert logic)
   */
  private async insertCallEdgesIndividual(edges: CallEdge[], snapshotId: string): Promise<void> {
    const callEdgeRows = edges.map(edge => ({
      id: edge.id,
      snapshot_id: snapshotId,
      caller_function_id: edge.callerFunctionId,
      callee_function_id: edge.calleeFunctionId || null,
      callee_name: edge.calleeName,
      callee_signature: edge.calleeSignature || null,
      caller_class_name: edge.callerClassName || null,
      callee_class_name: edge.calleeClassName || null,
      call_type: edge.callType,
      call_context: edge.callContext || null,
      line_number: edge.lineNumber,
      column_number: edge.columnNumber,
      is_async: edge.isAsync,
      is_chained: edge.isChained,
      confidence_score: edge.confidenceScore,
      metadata: edge.metadata,
      created_at: edge.createdAt,
    }));

    for (const row of callEdgeRows) {
      await this.kysely
        .insertInto('call_edges')
        .values({
          id: row.id,
          snapshot_id: row.snapshot_id,
          caller_function_id: row.caller_function_id,
          callee_function_id: row.callee_function_id,
          callee_name: row.callee_name,
          callee_signature: row.callee_signature,
          caller_class_name: row.caller_class_name,
          callee_class_name: row.callee_class_name,
          call_type: row.call_type,
          call_context: row.call_context,
          line_number: row.line_number,
          column_number: row.column_number,
          is_async: row.is_async,
          is_chained: row.is_chained,
          confidence_score: row.confidence_score,
          metadata: row.metadata,
          created_at: row.created_at,
        })
        .onConflict((oc) => 
          oc.column('id').doUpdateSet({
            snapshot_id: (eb) => eb.ref('excluded.snapshot_id'),
            confidence_score: (eb) => eb.fn('greatest', [
              eb.ref('excluded.confidence_score'),
              eb.ref('call_edges.confidence_score')
            ]),
            call_type: (eb) => eb.ref('excluded.call_type'),
            call_context: (eb) => eb.ref('excluded.call_context'),
            callee_signature: (eb) => eb.fn('coalesce', [
              eb.ref('excluded.callee_signature'),
              eb.ref('call_edges.callee_signature')
            ]),
            // 複雑な論理演算は一旦シンプルに
            is_async: (eb) => eb.ref('excluded.is_async'),
            is_chained: (eb) => eb.ref('excluded.is_chained'),
            metadata: (eb) => eb.ref('excluded.metadata')
          })
        )
        .execute();
    }
  }

  /**
   * Insert internal call edges using bulk insert for efficient storage
   */
  async insertInternalCallEdges(edges: import('../types').InternalCallEdge[]): Promise<void> {
    if (edges.length === 0) return;

    try {
      // Use bulk insert for better performance when batch size is large enough
      if (edges.length >= 10) {
        await this.insertInternalCallEdgesBulk(edges);
      } else {
        // Fall back to individual inserts for small batches
        await this.insertInternalCallEdgesIndividual(edges);
      }
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to insert internal call edges: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Bulk insert internal call edges for optimal performance
   */
  private async insertInternalCallEdgesBulk(edges: import('../types').InternalCallEdge[]): Promise<void> {
    const executeBulkInsert = async () => {
      // Define internal_call_edges table columns in correct order
      const internalCallEdgeColumns = [
        'id',
        'snapshot_id', 
        'file_path',
        'caller_function_id',
        'callee_function_id',
        'caller_name',
        'callee_name',
        'caller_class_name',
        'callee_class_name',
        'line_number',
        'column_number',
        'call_type',
        'call_context',
        'confidence_score',
        'detected_by',
        'created_at'
      ];

      // Prepare bulk data
      const internalCallEdgeData = edges.map(edge => [
        edge.id,
        edge.snapshotId,
        edge.filePath,
        edge.callerFunctionId,
        edge.calleeFunctionId,
        edge.callerName,
        edge.calleeName,
        edge.callerClassName || null,
        edge.calleeClassName || null,
        edge.lineNumber,
        edge.columnNumber ?? 0,
        edge.callType || 'direct',
        edge.callContext || null,
        edge.confidenceScore ?? 1.0,
        edge.detectedBy || 'ast',
        edge.createdAt || new Date().toISOString()
      ]);

      // Calculate optimal batch size for internal call edges (16 columns)
      const optimalBatchSize = calculateOptimalBatchSize(internalCallEdgeColumns.length);
      const batches = splitIntoBatches(internalCallEdgeData, optimalBatchSize);

      // Execute bulk insert with upsert
      for (const batch of batches) {
        const sql = generateBulkInsertSQL('internal_call_edges', internalCallEdgeColumns, batch.length) + `
          ON CONFLICT (id) DO UPDATE SET
            confidence_score = GREATEST(EXCLUDED.confidence_score, internal_call_edges.confidence_score),
            detected_by = EXCLUDED.detected_by,
            call_type = EXCLUDED.call_type,
            call_context = EXCLUDED.call_context,
            caller_class_name = EXCLUDED.caller_class_name,
            callee_class_name = EXCLUDED.callee_class_name
        `;
        
        const flatParams = batch.flat();
        await this.db.query(sql, flatParams);
      }
    };

    // Execute within current transaction context or create new one
    if (this.transactionDepth > 0) {
      await executeBulkInsert();
    } else {
      await this.executeInTransaction(executeBulkInsert);
    }
  }

  /**
   * Individual insert for small batches (preserving original logic)
   */
  private async insertInternalCallEdgesIndividual(edges: import('../types').InternalCallEdge[]): Promise<void> {
    for (const edge of edges) {
      // Use raw SQL query for internal_call_edges to avoid type issues
      await this.db.query(`
        INSERT INTO internal_call_edges (
          id, snapshot_id, file_path, caller_function_id, callee_function_id,
          caller_name, callee_name, caller_class_name, callee_class_name,
          line_number, column_number, call_type, call_context,
          confidence_score, detected_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (id) DO UPDATE SET
          confidence_score = GREATEST(EXCLUDED.confidence_score, internal_call_edges.confidence_score),
          detected_by = EXCLUDED.detected_by,
          call_type = EXCLUDED.call_type,
          call_context = EXCLUDED.call_context,
          caller_class_name = EXCLUDED.caller_class_name,
          callee_class_name = EXCLUDED.callee_class_name
      `, [
        edge.id,
        edge.snapshotId,
        edge.filePath,
        edge.callerFunctionId,
        edge.calleeFunctionId,
        edge.callerName,
        edge.calleeName,
        edge.callerClassName || null,
        edge.calleeClassName || null,
        edge.lineNumber,
        edge.columnNumber,
        edge.callType || 'direct', // use actual call type from analysis
        edge.callContext || null,
        edge.confidenceScore,
        edge.detectedBy,
        edge.createdAt,
      ]);
    }
  }

  /**
   * Get internal call edges for a specific file and snapshot
   */
  async getInternalCallEdges(filePath: string, snapshotId: string): Promise<import('../types').InternalCallEdge[]> {
    try {
      const result = await this.db.query(`
        SELECT * FROM internal_call_edges 
        WHERE file_path = $1 AND snapshot_id = $2
        ORDER BY line_number
      `, [filePath, snapshotId]);

      return result.rows.map((row: unknown) => {
        const typedRow = row as InternalCallEdgeTable;
        return {
          id: typedRow.id,
          snapshotId: typedRow.snapshot_id,
          filePath: typedRow.file_path,
          callerFunctionId: typedRow.caller_function_id,
          calleeFunctionId: typedRow.callee_function_id,
          callerName: typedRow.caller_name,
          calleeName: typedRow.callee_name,
          ...(typedRow.caller_class_name && { callerClassName: typedRow.caller_class_name }),
          ...(typedRow.callee_class_name && { calleeClassName: typedRow.callee_class_name }),
          lineNumber: typedRow.line_number,
          columnNumber: typedRow.column_number,
          callType: (typedRow.call_type && ['direct', 'conditional', 'async', 'dynamic'].includes(typedRow.call_type)) 
            ? (typedRow.call_type as 'direct' | 'conditional' | 'async' | 'dynamic') 
            : 'direct',
          ...(typedRow.call_context && { callContext: typedRow.call_context }),
          confidenceScore: typedRow.confidence_score,
          detectedBy: typedRow.detected_by as 'ast' | 'ideal_call_graph',
          createdAt: typedRow.created_at,
        };
      });
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get internal call edges: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get all functions called by a specific function within the same file
   */
  async getInternalCalleesByFunction(callerFunctionId: string, snapshotId: string): Promise<string[]> {
    try {
      const result = await this.db.query(`
        SELECT DISTINCT callee_function_id 
        FROM internal_call_edges 
        WHERE caller_function_id = $1 AND snapshot_id = $2
      `, [callerFunctionId, snapshotId]);

      return result.rows.map((row: unknown) => (row as { callee_function_id: string }).callee_function_id);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get internal callees: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check if a function is called within its file (for safe-delete protection)
   */
  async isInternalFunctionCalled(calleeFunctionId: string, snapshotId: string): Promise<boolean> {
    try {
      const result = await this.db.query(`
        SELECT 1 FROM internal_call_edges 
        WHERE callee_function_id = $1 AND snapshot_id = $2 
        LIMIT 1
      `, [calleeFunctionId, snapshotId]);

      return result.rows.length > 0;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to check internal function call: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get call edges for a specific caller function
   */
  async getCallEdgesByCaller(callerFunctionId: string, snapshotId: string): Promise<CallEdge[]> {
    try {
      const result = await this.db.query(`
        SELECT * FROM call_edges 
        WHERE caller_function_id = $1 AND snapshot_id = $2
        ORDER BY line_number
      `, [callerFunctionId, snapshotId]);

      return result.rows.map(row => this.mapRowToCallEdge(row as CallEdgeRow));
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get call edges by caller: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get call edges for a specific callee function
   */
  async getCallEdgesByCallee(calleeFunctionId: string, snapshotId: string): Promise<CallEdge[]> {
    try {
      const result = await this.db.query(`
        SELECT * FROM call_edges 
        WHERE callee_function_id = $1 AND snapshot_id = $2
        ORDER BY line_number
      `, [calleeFunctionId, snapshotId]);

      return result.rows.map(row => this.mapRowToCallEdge(row as CallEdgeRow));
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get call edges by callee: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get all call edges with optional filtering
   */
  async getCallEdges(options: {
    snapshotId?: string;
    callType?: CallEdge['callType'];
    isAsync?: boolean;
    isExternal?: boolean;
    minConfidence?: number;
    limit?: number;
    offset?: number;
  } = {}): Promise<CallEdge[]> {
    try {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      // Always require snapshot_id if provided, or warn if not provided
      if (options.snapshotId) {
        conditions.push(`snapshot_id = $${paramIndex++}`);
        params.push(options.snapshotId);
      }

      if (options.callType) {
        conditions.push(`call_type = $${paramIndex++}`);
        params.push(options.callType);
      }

      if (options.isAsync !== undefined) {
        conditions.push(`is_async = $${paramIndex++}`);
        params.push(options.isAsync);
      }

      if (options.isExternal !== undefined) {
        if (options.isExternal) {
          conditions.push(`callee_function_id IS NULL`);
        } else {
          conditions.push(`callee_function_id IS NOT NULL`);
        }
      }

      if (options.minConfidence !== undefined) {
        conditions.push(`confidence_score >= $${paramIndex++}`);
        params.push(options.minConfidence);
      }

      let sql = `SELECT * FROM call_edges`;
      
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
      }
      
      sql += ` ORDER BY caller_function_id, line_number`;

      if (options.limit) {
        sql += ` LIMIT $${paramIndex++}`;
        params.push(options.limit);
      }

      if (options.offset) {
        sql += ` OFFSET $${paramIndex++}`;
        params.push(options.offset);
      }

      const result = await this.db.query(sql, params);
      return result.rows.map(row => this.mapRowToCallEdge(row as CallEdgeRow));
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get call edges: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get internal call edges for a specific snapshot
   */
  async getInternalCallEdgesBySnapshot(snapshotId: string): Promise<import('../types').InternalCallEdge[]> {
    try {
      const result = await this.db.query(`
        SELECT * FROM internal_call_edges 
        WHERE snapshot_id = $1
        ORDER BY file_path, line_number
      `, [snapshotId]);

      return result.rows.map((row: unknown) => {
        const typedRow = row as InternalCallEdgeTable;
        return {
          id: typedRow.id,
          snapshotId: typedRow.snapshot_id,
          filePath: typedRow.file_path,
          callerFunctionId: typedRow.caller_function_id,
          calleeFunctionId: typedRow.callee_function_id,
          callerName: typedRow.caller_name,
          calleeName: typedRow.callee_name,
          callerClassName: typedRow.caller_class_name || undefined,
          calleeClassName: typedRow.callee_class_name || undefined,
          lineNumber: typedRow.line_number,
          columnNumber: typedRow.column_number,
          callType: (typedRow.call_type && ['direct', 'conditional', 'async', 'dynamic'].includes(typedRow.call_type)) 
            ? (typedRow.call_type as 'direct' | 'conditional' | 'async' | 'dynamic') 
            : 'direct',
          callContext: typedRow.call_context || undefined,
          confidenceScore: typedRow.confidence_score,
          detectedBy: 'ast' as const,
          createdAt: typedRow.created_at,
        };
      });
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get internal call edges for snapshot: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get call edges for a specific snapshot
   */
  async getCallEdgesBySnapshot(snapshotId: string): Promise<CallEdge[]> {
    try {
      const result = await this.db.query(`
        SELECT ce.*
        FROM call_edges ce
        WHERE ce.snapshot_id = $1
        ORDER BY ce.caller_function_id, ce.line_number
      `, [snapshotId]);

      return result.rows.map(row => this.mapRowToCallEdge(row as CallEdgeRow));
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get call edges for snapshot: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Delete call edges by caller function ID
   */
  async deleteCallEdgesByCaller(callerFunctionId: string): Promise<number> {
    try {
      const result = await this.db.query(`
        DELETE FROM call_edges WHERE caller_function_id = $1
      `, [callerFunctionId]);

      const affectedRows = (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
      return affectedRows;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to delete call edges by caller: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Delete call edges by function IDs
   */
  async deleteCallEdges(functionIds: string[]): Promise<void> {
    if (functionIds.length === 0) {
      return;
    }

    try {
      const placeholders = functionIds.map((_, index) => `$${index + 1}`).join(', ');
      const query = `
        DELETE FROM call_edges 
        WHERE caller_function_id IN (${placeholders})
           OR callee_function_id IN (${placeholders})
      `;

      await this.db.query(query, [...functionIds, ...functionIds]);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to delete call edges: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Map database row to CallEdge object
   */
  private mapRowToCallEdge(row: CallEdgeRow): CallEdge {
    return {
      id: row.id,
      callerFunctionId: row.caller_function_id,
      calleeFunctionId: row.callee_function_id || undefined,
      calleeName: row.callee_name,
      calleeSignature: row.callee_signature || undefined,
      callerClassName: row.caller_class_name || undefined,
      calleeClassName: row.callee_class_name || undefined,
      callType: row.call_type,
      callContext: row.call_context || undefined,
      lineNumber: row.line_number,
      columnNumber: row.column_number,
      isAsync: row.is_async,
      isChained: row.is_chained,
      confidenceScore: row.confidence_score,
      metadata: row.metadata,
      createdAt: row.created_at,
    };
  }

  /**
   * Get direct access to the database connection for advanced operations
   * Returns PGlite instance for direct database access
   * @deprecated Use specific query methods instead of direct database access
   */
  getDb(): PGlite {
    return this.db;
  }
}

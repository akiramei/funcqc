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

/**
 * Configuration for PGlite Kysely dialect
 */
export interface PGliteDialectConfig {
  database: PGlite;
}

/**
 * PGlite database connection implementation for Kysely
 */
export class PGliteConnection implements DatabaseConnection {
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
    // This method is intentionally not implemented as PGlite doesn't support streaming
    throw new Error(`PGliteDriver doesn't support streaming.`);
  }
}

/**
 * PGlite driver implementation for Kysely
 */
export class PGliteDriver implements Driver {
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

/**
 * PGlite dialect implementation for Kysely
 * Provides PostgreSQL compatibility through PGlite (WASM PostgreSQL)
 */
export class PGliteDialect implements Dialect {
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

  createIntrospector(db: Kysely<unknown>) {
    return new PostgresIntrospector(db);
  }
}
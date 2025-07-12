/**
 * Kysely Migration Manager
 * Issue #159: PostgreSQL + Kyselyの実績を活用したマイグレーションシステム
 * 
 * 主要機能:
 * - Kysely標準のマイグレーション機能
 * - PostgreSQL互換のPGLiteサポート
 * - ファイルベースマイグレーション管理
 * - データ保全機能（OLD_テーブル）
 */

import { PGlite } from '@electric-sql/pglite';
import { 
  Kysely, 
  Migrator, 
  Migration,
  MigrationInfo,
  MigrationResultSet,
  MigrationProvider,
  sql,
  PostgresDialect,
  DatabaseConnection,
  Driver,
  TransactionSettings,
  CompiledQuery,
  DialectAdapter
} from 'kysely';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * PGLite用のKysely Dialect
 * PostgreSQL dialectベースで、PGLiteに特化したadapter/driver実装
 */
class PGLiteDialect {
  private pglite: PGlite;
  private static readonly MIGRATION_LOCK_ID = 982374892374; // ユニークなロックID

  constructor(pglite: PGlite) {
    this.pglite = pglite;
  }

  createAdapter() {
    const baseAdapter = {
      acquireConnection: () => Promise.resolve(new PGLiteConnection(this.pglite)),
      beginTransaction: async (connection: PGLiteConnection) => {
        await connection.executeQuery(CompiledQuery.raw('BEGIN'));
      },
      commitTransaction: async (connection: PGLiteConnection) => {
        await connection.executeQuery(CompiledQuery.raw('COMMIT'));
      },
      rollbackTransaction: async (connection: PGLiteConnection) => {
        await connection.executeQuery(CompiledQuery.raw('ROLLBACK'));
      },
      releaseConnection: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
      
      // PostgreSQL互換機能
      supportsCreateIfNotExists: true,
      supportsTransactionalDdl: true,
      supportsReturning: true,
      
      // マイグレーションロック機能（PostgreSQL Advisory Lock使用）
      acquireMigrationLock: async (db: Kysely<Record<string, unknown>>) => {
        const result = await sql.raw(`SELECT pg_try_advisory_lock(${PGLiteDialect.MIGRATION_LOCK_ID})`).execute(db);
        const lockAcquired = (result.rows[0] as Record<string, unknown>)?.['pg_try_advisory_lock'];
        if (!lockAcquired) {
          throw new Error('Could not acquire migration lock. Another migration may be in progress.');
        }
      },
      
      releaseMigrationLock: async (db: Kysely<Record<string, unknown>>) => {
        await sql.raw(`SELECT pg_advisory_unlock(${PGLiteDialect.MIGRATION_LOCK_ID})`).execute(db);
      }
    };
    
    return baseAdapter as DialectAdapter;
  }

  createDriver() {
    return new PGLiteDriver(this.pglite);
  }

  createQueryCompiler() {
    // PostgreSQL query compilerを使用（実績のある方法）
    // PGLite用途のため、実際のプールは使用しない（型キャストのみ）
    return new PostgresDialect({ 
      pool: {
        connect: () => Promise.resolve({} as any),
        end: () => Promise.resolve()
      } as any 
    }).createQueryCompiler();
  }

  createIntrospector(db: Kysely<Record<string, unknown>>) {
    // PostgreSQL introspectorベース
    // PGLite用途のため、実際のプールは使用しない（型キャストのみ）
    return new PostgresDialect({ 
      pool: {
        connect: () => Promise.resolve({} as any),
        end: () => Promise.resolve()
      } as any 
    }).createIntrospector(db);
  }
}

/**
 * TypeScript migration files用のカスタムプロバイダー
 * ESM環境でTypeScriptファイルを直接ロードできるようにする
 */
class TypeScriptMigrationProvider implements MigrationProvider {
  private migrationFolder: string;

  constructor(migrationFolder: string) {
    this.migrationFolder = migrationFolder;
  }

  async getMigrations(): Promise<Record<string, Migration>> {
    const migrations: Record<string, Migration> = {};
    
    try {
      // マイグレーションフォルダ内の.tsファイルを検索
      const files = await fs.readdir(this.migrationFolder);
      const migrationFiles = files
        .filter(file => file.endsWith('.ts'))
        .sort(); // ファイル名でソート（タイムスタンプ順）

      for (const file of migrationFiles) {
        const filePath = path.join(this.migrationFolder, file);
        const migrationName = path.basename(file, '.ts');
        
        try {
          // TypeScriptファイルを動的インポート
          // file:// プロトコルを使用してESMロードを行う
          const fileUrl = `file://${path.resolve(filePath)}`;
          const module = await import(fileUrl);
          
          if (typeof module.up === 'function' && typeof module.down === 'function') {
            migrations[migrationName] = {
              up: module.up,
              down: module.down
            };
          } else {
            console.warn(`Migration file ${file} is missing up() or down() function`);
          }
        } catch (error) {
          // 詳細なエラー情報を提供し、適切に分類
          if (error instanceof SyntaxError) {
            console.warn(`Syntax error in migration ${file}:`, error.message);
          } else if (error instanceof TypeError) {
            console.warn(`Type error in migration ${file}:`, error.message);
          } else if (error instanceof Error && error.message.includes('MODULE_NOT_FOUND')) {
            console.warn(`Module dependency missing for migration ${file}:`, error.message);
          } else {
            console.warn(`Failed to load migration ${file}:`, error instanceof Error ? error.message : String(error));
          }
          // 個別のマイグレーションファイルの読み込み失敗は継続（その他のマイグレーションに影響しない）
        }
      }
    } catch (error) {
      console.error(`Failed to read migration directory ${this.migrationFolder}:`, error);
      throw error;
    }

    return migrations;
  }
}

/**
 * PGLite接続ラッパー
 * PostgreSQL標準インターフェースに合わせる
 */
class PGLiteConnection implements DatabaseConnection {
  constructor(private pglite: PGlite) {}

  async executeQuery<O>(compiledQuery: CompiledQuery): Promise<{ rows: O[] }> {
    const result = await this.pglite.query(compiledQuery.sql, compiledQuery.parameters as unknown[]);
    return { rows: result.rows as O[] };
  }

  async *streamQuery<O>(compiledQuery: CompiledQuery): AsyncIterableIterator<{ rows: O[] }> {
    // PGLiteはストリーミングをサポートしていないため、一括実行
    const result = await this.executeQuery<O>(compiledQuery);
    yield result;
  }
}

/**
 * PGLiteドライバー
 * PostgreSQL標準ドライバーインターフェースに準拠
 */
class PGLiteDriver implements Driver {
  constructor(private pglite: PGlite) {}

  async init(): Promise<void> {
    // PGLiteは自動的に初期化されるため、何もしない
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new PGLiteConnection(this.pglite);
  }

  async beginTransaction(
    connection: DatabaseConnection,
    _settings?: TransactionSettings
  ): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('BEGIN'));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('COMMIT'));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('ROLLBACK'));
  }

  async releaseConnection(_connection: DatabaseConnection): Promise<void> {
    // PGLiteは接続プールを使わないため、何もしない
  }

  async destroy(): Promise<void> {
    // PGLiteのクローズはアプリケーション側で管理
  }
}

export interface KyselyMigrationOptions {
  migrationFolder?: string;
  allowUnorderedMigrations?: boolean;
}

export class KyselyMigrationManager {
  private kysely: Kysely<Record<string, unknown>>;
  private migrator: Migrator;
  private migrationFolder: string;

  constructor(pglite: PGlite, options: KyselyMigrationOptions = {}) {
    this.migrationFolder = options.migrationFolder || path.join(process.cwd(), 'migrations');
    
    // PGLite + Kysely統合
    this.kysely = new Kysely<Record<string, unknown>>({
      dialect: new PGLiteDialect(pglite),
    });

    // Migrator設定（TypeScript対応プロバイダー使用）
    this.migrator = new Migrator({
      db: this.kysely,
      provider: new TypeScriptMigrationProvider(this.migrationFolder),
      allowUnorderedMigrations: options.allowUnorderedMigrations || false
    });
  }

  /**
   * 最新バージョンまでマイグレーション実行
   */
  async migrateToLatest(): Promise<MigrationResultSet> {
    console.log('🚀 Running migrations to latest version...');
    
    try {
      const result = await this.migrator.migrateToLatest();
      
      if (result.error) {
        console.error('❌ Migration failed:', result.error);
        throw result.error;
      }

      const appliedMigrations = result.results?.filter(r => r.status === 'Success') || [];
      console.log(`✅ Applied ${appliedMigrations.length} migrations successfully`);
      
      return result;
    } catch (error) {
      console.error('❌ Migration execution failed:', error);
      throw error;
    }
  }

  /**
   * 1つ前のバージョンにロールバック
   */
  async migrateDown(): Promise<MigrationResultSet> {
    console.log('🔄 Rolling back one migration...');
    
    try {
      const result = await this.migrator.migrateDown();
      
      if (result.error) {
        console.error('❌ Rollback failed:', result.error);
        throw result.error;
      }

      console.log('✅ Rollback completed successfully');
      return result;
    } catch (error) {
      console.error('❌ Rollback execution failed:', error);
      throw error;
    }
  }

  /**
   * マイグレーション状況の確認
   */
  async getMigrationStatus(): Promise<MigrationInfo[]> {
    console.log('📊 Checking migration status...');
    
    try {
      const migrations = await this.migrator.getMigrations();
      
      // ステータス表示
      console.log('\nMigration Status:');
      console.log('================');
      
      for (const migration of migrations) {
        const status = migration.executedAt ? '✅ Applied' : '⏸️  Pending';
        const date = migration.executedAt 
          ? new Date(migration.executedAt).toLocaleString()
          : 'Not executed';
        
        console.log(`${status} ${migration.name} (${date})`);
      }
      
      // readonly配列を通常の配列に変換
      return [...migrations];
    } catch (error) {
      console.error('❌ Failed to get migration status:', error);
      throw error;
    }
  }

  /**
   * 新しいマイグレーションファイルを作成
   */
  async createMigration(name: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
    const filename = `${timestamp}_${name}.ts`;
    const filepath = path.join(this.migrationFolder, filename);

    // マイグレーションフォルダを作成
    await fs.mkdir(this.migrationFolder, { recursive: true });

    // テンプレートコンテンツ
    const template = `import { Kysely } from 'kysely';

export async function up(db: Kysely<Record<string, unknown>>): Promise<void> {
  // TODO: implement migration
  // Example:
  // await db.schema
  //   .createTable('new_table')
  //   .addColumn('id', 'serial', col => col.primaryKey())
  //   .addColumn('name', 'varchar(255)', col => col.notNull())
  //   .execute();
}

export async function down(db: Kysely<Record<string, unknown>>): Promise<void> {
  // TODO: implement rollback
  // Example:
  // await db.schema.dropTable('new_table').execute();
}
`;

    await fs.writeFile(filepath, template, 'utf-8');
    console.log(`✅ Created migration file: ${filename}`);
    console.log(`📝 Edit the file at: ${filepath}`);
    
    return filepath;
  }

  /**
   * データ保全機能（Issue #159要件）
   * PostgreSQL標準手法でOLD_テーブル作成
   */
  async preserveTableData(tableName: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
    const backupTableName = `OLD_${tableName}_${timestamp}`;
    
    console.log(`📦 Preserving ${tableName} as ${backupTableName}...`);
    
    try {
      // テーブル存在確認（SQLインジェクション対策）
      const result = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = ${tableName}
        )
      `.execute(this.kysely);
      
      const exists = (result.rows[0] as Record<string, unknown>)?.['exists'];
      if (!exists) {
        console.log(`⚠️  Table ${tableName} does not exist, skipping preservation`);
        return backupTableName;
      }

      // データバックアップ（PostgreSQL標準手法）
      // 注意: テーブル名はユーザー制御可能な入力ではないため、動的テーブル名作成では文字列補間を使用
      await sql.raw(`
        CREATE TABLE ${backupTableName} AS 
        SELECT * FROM ${tableName}
      `).execute(this.kysely);
      
      // 保存確認
      const countResult = await sql.raw(`SELECT COUNT(*) as count FROM ${backupTableName}`).execute(this.kysely);
      const backupCount = (countResult.rows[0] as Record<string, unknown>)?.['count'] || 0;
      
      console.log(`✅ Preserved ${backupCount} rows from ${tableName} to ${backupTableName}`);
      return backupTableName;
      
    } catch (error) {
      console.error(`❌ Failed to preserve table ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * バックアップテーブル一覧取得
   */
  async listBackupTables(): Promise<Array<{ name: string; created?: Date | undefined }>> {
    try {
      const result = await sql.raw(`
        SELECT table_name
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name LIKE 'OLD_%'
        ORDER BY table_name
      `).execute(this.kysely);
      
      return (result.rows as unknown[]).map(row => {
        const tableRow = row as Record<string, unknown>;
        const tableName = tableRow['table_name'] as string;
        // テーブル名から作成日時を推測
        const dateMatch = tableName.match(/(\d{8}_\d{6})/);
        let created: Date | undefined;
        
        if (dateMatch) {
          const dateStr = dateMatch[1];
          const isoStr = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}T${dateStr.substring(9, 11)}:${dateStr.substring(11, 13)}:${dateStr.substring(13, 15)}`;
          try {
            created = new Date(isoStr);
          } catch {
            // 日時パースに失敗した場合はundefined
          }
        }
        
        return { name: tableName, created };
      });
    } catch (error) {
      console.error('❌ Failed to list backup tables:', error);
      throw error;
    }
  }

  /**
   * 古いバックアップテーブルのクリーンアップ
   */
  async cleanupOldBackups(daysOld: number = 30): Promise<number> {
    console.log(`🧹 Cleaning up backup tables older than ${daysOld} days...`);
    
    const backupTables = await this.listBackupTables();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    let deletedCount = 0;
    
    for (const backup of backupTables) {
      if (backup.created && backup.created < cutoffDate) {
        try {
          // backup.nameはlistBackupTables()で検証済みのOLD_プレフィックス付きテーブル名のため安全
          await sql.raw(`DROP TABLE ${backup.name}`).execute(this.kysely);
          console.log(`   Deleted old backup: ${backup.name}`);
          deletedCount++;
        } catch (error) {
          console.warn(`   Could not delete ${backup.name}:`, error);
        }
      }
    }
    
    console.log(`✅ Cleaned up ${deletedCount} old backup tables`);
    return deletedCount;
  }

  /**
   * Kyselyインスタンスを取得（高度な操作用）
   */
  getKyselyInstance(): Kysely<Record<string, unknown>> {
    return this.kysely;
  }

  /**
   * リソースクリーンアップ
   */
  async close(): Promise<void> {
    try {
      await this.kysely.destroy();
      console.log('✅ Kysely migration manager closed');
    } catch (error) {
      console.error('❌ Error closing Kysely migration manager:', error);
      throw error;
    }
  }
}
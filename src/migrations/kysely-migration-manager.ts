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

// PostgreSQL Pool型の最小インターフェース（型キャスト用）
interface MinimalPool {
  connect: () => Promise<unknown>;
  end: () => Promise<void>;
  query: () => Promise<{ rows: unknown[]; fields: unknown[] }>;
  on: () => void;
  removeListener: () => void;
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

// ダミープール実装（PGLite用途のため実際には使用されない）
const createDummyPool = (): MinimalPool => ({
  connect: () => Promise.resolve({} as never),
  end: () => Promise.resolve(),
  query: () => Promise.resolve({ rows: [], fields: [] } as never),
  on: () => void 0,
  removeListener: () => void 0,
  totalCount: 0,
  idleCount: 0,
  waitingCount: 0,
});

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
    return new PostgresDialect({ 
      pool: createDummyPool() as unknown as never
    }).createQueryCompiler();
  }

  createIntrospector(db: Kysely<Record<string, unknown>>) {
    // PostgreSQL introspectorベース
    return new PostgresDialect({ 
      pool: createDummyPool() as unknown as never
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
      // 実行前にペンディングマイグレーションをアーカイブ
      await this.archivePendingMigrations();
      
      const result = await this.migrator.migrateToLatest();
      
      if (result.error) {
        await this.handleMigrationError(result.error);
        throw result.error;
      }

      const appliedMigrations = result.results?.filter(r => r.status === 'Success') || [];
      console.log(`✅ Applied ${appliedMigrations.length} migrations successfully`);
      
      return result;
    } catch (error) {
      await this.handleMigrationError(error);
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
    // テーブル名検証（SQLインジェクション対策）
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new Error(`Invalid table name: ${tableName}`);
    }
    
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
      // テーブル名は事前検証済みで安全な識別子のため、文字列補間を使用
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
   * マイグレーションエラーの詳細ハンドリング
   */
  private async handleMigrationError(error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // "corrupted migrations" エラーの特別処理
    if (errorMessage.includes('corrupted migrations') || errorMessage.includes('missing')) {
      console.log('\n🚨 Migration File Corruption Detected');
      console.log('═══════════════════════════════════════');
      
      // 不足しているマイグレーションファイルを特定
      const missingFiles = await this.detectMissingMigrationFiles();
      
      if (missingFiles.length > 0) {
        console.log('📁 Missing Migration Files:');
        missingFiles.forEach(file => console.log(`   • ${file}`));
        console.log('');
      }
      
      console.log('💡 Recovery Options:');
      console.log('   1. Restore from Git:');
      console.log('      git checkout HEAD -- migrations/');
      console.log('');
      console.log('   2. Run migration health check:');
      console.log('      funcqc migrate doctor');
      console.log('');
      console.log('   3. Auto-restore (if available):');
      console.log('      funcqc migrate restore');
      console.log('');
      console.log('   4. Reset migration history (⚠️  loses history):');
      console.log('      funcqc migrate reset --force');
      console.log('');
    } else {
      console.error('❌ Migration execution failed:', errorMessage);
    }
  }

  /**
   * 不足しているマイグレーションファイルを検出
   */
  private async detectMissingMigrationFiles(): Promise<string[]> {
    try {
      // データベースから実行済みマイグレーション一覧を取得
      const result = await sql.raw(`
        SELECT name FROM __kysely_migration 
        ORDER BY name
      `).execute(this.kysely);
      
      const executedMigrations = (result.rows as unknown[]).map(row => 
        (row as Record<string, unknown>)['name'] as string
      );
      
      // ファイルシステムのマイグレーションファイル一覧を取得
      const files = await fs.readdir(this.migrationFolder);
      const migrationFiles = files
        .filter(file => file.endsWith('.ts'))
        .map(file => file.replace('.ts', ''));
      
      // 実行済みだがファイルが存在しないマイグレーションを特定
      return executedMigrations.filter(name => !migrationFiles.includes(name));
    } catch (error) {
      // テーブルが存在しない場合やその他のエラー
      return [];
    }
  }

  /**
   * マイグレーションシステムの健全性チェック
   */
  async diagnoseMigrationHealth(): Promise<{
    healthy: boolean;
    issues: Array<{
      type: 'missing-files' | 'uncommitted-files' | 'syntax-errors' | 'orphaned-files';
      severity: 'error' | 'warning' | 'info';
      description: string;
      files?: string[];
      solution?: string;
    }>;
  }> {
    console.log('🔍 Running Migration Health Check...');
    console.log('═══════════════════════════════════════');
    
    const issues = [];
    
    try {
      // 1. 不足ファイルチェック
      const missingFiles = await this.detectMissingMigrationFiles();
      if (missingFiles.length > 0) {
        issues.push({
          type: 'missing-files' as const,
          severity: 'error' as const,
          description: `${missingFiles.length} executed migration files are missing`,
          files: missingFiles,
          solution: 'Run: funcqc migrate restore or git checkout HEAD -- migrations/'
        });
      }
      
      // 2. 孤立ファイルチェック（ファイルは存在するが実行されていない古いファイル）
      const orphanedFiles = await this.detectOrphanedMigrationFiles();
      if (orphanedFiles.length > 0) {
        issues.push({
          type: 'orphaned-files' as const,
          severity: 'warning' as const,
          description: `${orphanedFiles.length} migration files exist but were not executed`,
          files: orphanedFiles,
          solution: 'Review and remove unused migration files or run: funcqc migrate up'
        });
      }
      
      // 3. 構文エラーチェック
      const syntaxErrors = await this.detectSyntaxErrors();
      if (syntaxErrors.length > 0) {
        issues.push({
          type: 'syntax-errors' as const,
          severity: 'error' as const,
          description: `${syntaxErrors.length} migration files have syntax errors`,
          files: syntaxErrors,
          solution: 'Fix TypeScript syntax errors in the listed files'
        });
      }
      
      // 4. Git状態チェック（未コミットファイル）
      const uncommittedFiles = await this.detectUncommittedMigrationFiles();
      if (uncommittedFiles.length > 0) {
        issues.push({
          type: 'uncommitted-files' as const,
          severity: 'warning' as const,
          description: `${uncommittedFiles.length} migration files are not committed to Git`,
          files: uncommittedFiles,
          solution: 'Run: git add migrations/ && git commit'
        });
      }
      
    } catch (error) {
      issues.push({
        type: 'syntax-errors' as const,
        severity: 'error' as const,
        description: 'Failed to run health checks',
        solution: 'Check database connectivity and file permissions'
      });
    }
    
    // 結果の表示
    const healthy = issues.filter(issue => issue.severity === 'error').length === 0;
    
    console.log(`\n📊 Health Check Results: ${healthy ? '✅ Healthy' : '❌ Issues Found'}`);
    console.log('═══════════════════════════════════════');
    
    if (issues.length === 0) {
      console.log('✅ No issues detected');
      console.log('🎉 Migration system is healthy');
    } else {
      issues.forEach((issue, index) => {
        const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
        console.log(`\n${icon} Issue ${index + 1}: ${issue.description}`);
        
        if (issue.files && issue.files.length > 0) {
          console.log('   Files affected:');
          issue.files.forEach(file => console.log(`     • ${file}`));
        }
        
        if (issue.solution) {
          console.log(`   💡 Solution: ${issue.solution}`);
        }
      });
    }
    
    return { healthy, issues };
  }

  /**
   * 孤立したマイグレーションファイルを検出
   */
  private async detectOrphanedMigrationFiles(): Promise<string[]> {
    try {
      // ファイルシステムのマイグレーションファイル一覧を取得
      const files = await fs.readdir(this.migrationFolder);
      const migrationFiles = files
        .filter(file => file.endsWith('.ts'))
        .map(file => file.replace('.ts', ''));
      
      // データベースから実行済みマイグレーション一覧を取得
      const result = await sql.raw(`
        SELECT name FROM __kysely_migration 
        ORDER BY name
      `).execute(this.kysely);
      
      const executedMigrations = (result.rows as unknown[]).map(row => 
        (row as Record<string, unknown>)['name'] as string
      );
      
      // ファイルは存在するが実行されていないマイグレーションを特定
      return migrationFiles.filter(name => !executedMigrations.includes(name));
    } catch (error) {
      return [];
    }
  }

  /**
   * 構文エラーのあるマイグレーションファイルを検出
   */
  private async detectSyntaxErrors(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.migrationFolder);
      const migrationFiles = files.filter(file => file.endsWith('.ts'));
      const errorFiles = [];
      
      for (const file of migrationFiles) {
        try {
          const filePath = path.join(this.migrationFolder, file);
          const content = await fs.readFile(filePath, 'utf-8');
          
          // 基本的な構文チェック（up/down関数の存在確認）
          if (!content.includes('export async function up') || !content.includes('export async function down')) {
            errorFiles.push(file);
          }
        } catch (error) {
          errorFiles.push(file);
        }
      }
      
      return errorFiles;
    } catch (error) {
      return [];
    }
  }

  /**
   * 未コミットのマイグレーションファイルを検出
   */
  private async detectUncommittedMigrationFiles(): Promise<string[]> {
    try {
      const { execSync } = await import('child_process');
      const output = execSync('git status --porcelain migrations/', { encoding: 'utf-8' });
      
      return output
        .split('\n')
        .filter(line => line.trim())
        .map(line => line.substring(3)) // Remove status prefix
        .filter(file => file.endsWith('.ts'));
    } catch (error) {
      // Git not available or not in a Git repository
      return [];
    }
  }

  /**
   * マイグレーションファイルをデータベース内にアーカイブ
   */
  private async archiveMigration(name: string, filePath: string): Promise<void> {
    try {
      // マイグレーションアーカイブテーブルが存在しない場合は作成
      await this.ensureMigrationArchiveTable();
      
      const content = await fs.readFile(filePath, 'utf-8');
      const checksum = await this.calculateChecksum(content);
      
      // 既存のアーカイブを確認
      const existing = await sql.raw(`
        SELECT id FROM migration_archive 
        WHERE name = ${name}
      `).execute(this.kysely);
      
      if ((existing.rows as unknown[]).length === 0) {
        // 新規アーカイブ
        await sql.raw(`
          INSERT INTO migration_archive (id, name, content, checksum, archived_at)
          VALUES (${this.generateUUID()}, ${name}, ${content}, ${checksum}, CURRENT_TIMESTAMP)
        `).execute(this.kysely);
      }
    } catch (error) {
      // アーカイブ失敗はログ出力のみ（メイン処理は継続）
      console.log(`⚠️  Failed to archive migration ${name}:`, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * マイグレーションアーカイブテーブルの作成
   */
  private async ensureMigrationArchiveTable(): Promise<void> {
    try {
      await this.kysely.schema
        .createTable('migration_archive')
        .ifNotExists()
        .addColumn('id', 'uuid', col => col.primaryKey())
        .addColumn('name', 'varchar(255)', col => col.notNull().unique())
        .addColumn('content', 'text', col => col.notNull())
        .addColumn('checksum', 'varchar(64)', col => col.notNull())
        .addColumn('archived_at', 'timestamp', col => col.notNull())
        .execute();
    } catch (error) {
      // テーブル作成失敗は無視（既存テーブルの可能性）
    }
  }

  /**
   * チェックサム計算
   */
  private async calculateChecksum(content: string): Promise<string> {
    try {
      const crypto = await import('crypto');
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch (error) {
      // フォールバック: 簡単なハッシュ
      let hash = 0;
      for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // 32bit整数に変換
      }
      return Math.abs(hash).toString(16).padStart(8, '0');
    }
  }

  /**
   * UUID生成
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * マイグレーションファイルの自動復旧
   */
  async restoreMissingMigrations(): Promise<{
    restored: string[];
    failed: string[];
    skipped: string[];
  }> {
    console.log('🔄 Attempting to restore missing migration files...');
    console.log('═══════════════════════════════════════════════');
    
    const result = {
      restored: [] as string[],
      failed: [] as string[],
      skipped: [] as string[]
    };
    
    try {
      // アーカイブテーブルの存在確認
      await this.ensureMigrationArchiveTable();
      
      // 不足しているマイグレーションファイルを特定
      const missingFiles = await this.detectMissingMigrationFiles();
      
      if (missingFiles.length === 0) {
        console.log('✅ No missing migration files detected');
        return result;
      }
      
      console.log(`📁 Found ${missingFiles.length} missing migration files`);
      
      for (const missingFile of missingFiles) {
        try {
          // アーカイブからファイル内容を取得
          const archiveResult = await sql.raw(`
            SELECT content, checksum FROM migration_archive 
            WHERE name = ${missingFile}
          `).execute(this.kysely);
          
          const rows = archiveResult.rows as unknown[];
          if (rows.length === 0) {
            console.log(`❌ No archive found for: ${missingFile}`);
            result.failed.push(missingFile);
            continue;
          }
          
          const archiveRow = rows[0] as Record<string, unknown>;
          const content = archiveRow['content'] as string;
          const originalChecksum = archiveRow['checksum'] as string;
          
          // チェックサム検証
          const calculatedChecksum = await this.calculateChecksum(content);
          if (calculatedChecksum !== originalChecksum) {
            console.log(`❌ Checksum mismatch for: ${missingFile}`);
            result.failed.push(missingFile);
            continue;
          }
          
          // ファイルを復元
          const filePath = path.join(this.migrationFolder, `${missingFile}.ts`);
          
          // ファイルが既に存在する場合はスキップ
          try {
            await fs.access(filePath);
            console.log(`⏭️  File already exists, skipping: ${missingFile}`);
            result.skipped.push(missingFile);
            continue;
          } catch {
            // ファイルが存在しない場合は続行
          }
          
          // ディレクトリが存在しない場合は作成
          await fs.mkdir(this.migrationFolder, { recursive: true });
          
          // ファイル復元
          await fs.writeFile(filePath, content, 'utf-8');
          
          console.log(`✅ Restored: ${missingFile}`);
          result.restored.push(missingFile);
          
        } catch (error) {
          console.log(`❌ Failed to restore ${missingFile}:`, error instanceof Error ? error.message : String(error));
          result.failed.push(missingFile);
        }
      }
      
      // 結果サマリー
      console.log('\n📊 Restoration Summary:');
      console.log('═══════════════════════');
      console.log(`✅ Restored: ${result.restored.length} files`);
      console.log(`⏭️  Skipped: ${result.skipped.length} files`);
      console.log(`❌ Failed: ${result.failed.length} files`);
      
      if (result.restored.length > 0) {
        console.log('\n💡 Restored files:');
        result.restored.forEach(file => console.log(`   • ${file}.ts`));
      }
      
      if (result.failed.length > 0) {
        console.log('\n⚠️  Failed files (consider manual restoration):');
        result.failed.forEach(file => console.log(`   • ${file}.ts`));
      }
      
    } catch (error) {
      console.error('❌ Error during migration restoration:', error instanceof Error ? error.message : String(error));
      throw error;
    }
    
    return result;
  }


  /**
   * ペンディングマイグレーションをアーカイブ
   */
  private async archivePendingMigrations(): Promise<void> {
    try {
      const migrations = await this.migrator.getMigrations();
      const pendingMigrations = migrations.filter(m => !m.executedAt);
      
      for (const migration of pendingMigrations) {
        const filePath = path.join(this.migrationFolder, `${migration.name}.ts`);
        try {
          await fs.access(filePath);
          await this.archiveMigration(migration.name, filePath);
        } catch {
          // ファイルが存在しない場合はスキップ
        }
      }
    } catch (error) {
      // アーカイブ失敗は警告のみ
      console.log('⚠️  Warning: Failed to archive pending migrations');
    }
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
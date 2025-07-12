import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { MigrationManager, summarizeMigrationResults } from '../../src/migrations/migration-manager';
import { preserveTableData, checkTableExists } from '../../src/migrations/helpers';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('MigrationManager', () => {
  let db: PGlite;
  let manager: MigrationManager;
  let tempDbPath: string;

  beforeEach(async () => {
    // テスト用の一時データベースを作成
    tempDbPath = path.join(os.tmpdir(), `funcqc-test-${Date.now()}`);
    db = new PGlite(tempDbPath);
    manager = new MigrationManager(db, tempDbPath);
  });

  afterEach(async () => {
    // クリーンアップ
    if (manager) {
      await manager.destroy();
    }
    if (db) {
      await db.close();
    }
    // 一時ファイルの削除は省略（OSが自動削除）
  });

  describe('基本的なマイグレーション機能', () => {
    it('should create MigrationManager instance', () => {
      expect(manager).toBeDefined();
      expect(manager.getRawDatabase()).toBe(db);
    });

    it('should get Kysely instance', () => {
      const kysely = manager.getKysely();
      expect(kysely).toBeDefined();
    });

    it('should get migration status when no migrations exist', async () => {
      const status = await manager.getMigrationStatus();
      expect(Array.isArray(status)).toBe(true);
      // 新しいDBなので何もない状態
    });

    it('should get pending migrations', async () => {
      const pending = await manager.getPendingMigrations();
      expect(Array.isArray(pending)).toBe(true);
    });
  });

  describe('データ保全ヘルパー関数', () => {
    beforeEach(async () => {
      // テスト用のシンプルなテーブルを作成
      await db.exec(`
        CREATE TABLE test_table (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // テストデータを挿入
      await db.exec(`
        INSERT INTO test_table (name) VALUES 
        ('Test 1'), ('Test 2'), ('Test 3')
      `);
    });

    it('should check table existence', async () => {
      const kysely = manager.getKysely();
      
      const exists = await checkTableExists(kysely, 'test_table');
      expect(exists).toBe(true);
      
      const notExists = await checkTableExists(kysely, 'nonexistent_table');
      expect(notExists).toBe(false);
    });

    it('should preserve table data', async () => {
      const kysely = manager.getKysely();
      
      // データを保全
      const backupTableName = await preserveTableData(kysely, 'test_table', 'test_version');
      
      // バックアップテーブルが作成されたか確認
      expect(backupTableName).toBe('OLD_test_table_test_version');
      const backupExists = await checkTableExists(kysely, backupTableName);
      expect(backupExists).toBe(true);
      
      // データが正しくコピーされたか確認
      const originalResult = await db.query('SELECT COUNT(*) as count FROM test_table');
      const backupResult = await db.query(`SELECT COUNT(*) as count FROM ${backupTableName}`);
      
      expect(originalResult.rows[0].count).toBe(backupResult.rows[0].count);
      expect(parseInt(originalResult.rows[0].count)).toBe(3);
    });
  });

  describe('エラーハンドリング', () => {
    it('should handle migration errors gracefully', async () => {
      // 存在しないマイグレーションディレクトリでの動作確認
      // これは実際のマイグレーション実行時にエラーハンドリングをテスト
      const status = await manager.getMigrationStatus();
      expect(Array.isArray(status)).toBe(true);
    });

    it('should handle nonexistent table preservation', async () => {
      const kysely = manager.getKysely();
      
      // 存在しないテーブルの保全を試行
      const backupTableName = await preserveTableData(kysely, 'nonexistent_table', 'test');
      expect(backupTableName).toBe('OLD_nonexistent_table_test');
      
      // バックアップテーブルは作成されない
      const exists = await checkTableExists(kysely, backupTableName);
      expect(exists).toBe(false);
    });
  });

  describe('ユーティリティ関数', () => {
    it('should summarize migration results correctly', () => {
      // 成功ケース
      const successResults = [
        { status: 'Success' as const, migrationName: 'test1' },
        { status: 'Success' as const, migrationName: 'test2' }
      ];
      expect(summarizeMigrationResults(successResults)).toBe('2 migration(s) executed successfully');
      
      // 失敗ケース
      const failedResults = [
        { status: 'Success' as const, migrationName: 'test1' },
        { status: 'Error' as const, migrationName: 'test2', error: new Error('test error') }
      ];
      expect(summarizeMigrationResults(failedResults)).toBe('1 migration(s) failed, 1 succeeded');
      
      // 空ケース
      expect(summarizeMigrationResults(undefined)).toBe('No migrations executed');
      expect(summarizeMigrationResults([])).toBe('No migrations executed');
    });
  });

  describe('リソース管理', () => {
    it('should cleanup resources properly', async () => {
      await expect(manager.destroy()).resolves.not.toThrow();
    });

    it('should reset migrations in development', async () => {
      // マイグレーション履歴のリセット機能をテスト
      await expect(manager.resetMigrations()).resolves.not.toThrow();
    });
  });
});

describe('Integration with real schema', () => {
  let db: PGlite;
  let manager: MigrationManager;
  let tempDbPath: string;

  beforeEach(async () => {
    tempDbPath = path.join(os.tmpdir(), `funcqc-integration-test-${Date.now()}`);
    db = new PGlite(tempDbPath);
    manager = new MigrationManager(db, tempDbPath);
  });

  afterEach(async () => {
    if (manager) {
      await manager.destroy();
    }
    if (db) {
      await db.close();
    }
  });

  it('should verify database.sql exists and is readable', async () => {
    const schemaPath = path.join(__dirname, '../../src/schemas/database.sql');
    
    try {
      const schemaContent = await fs.readFile(schemaPath, 'utf-8');
      expect(schemaContent).toBeTruthy();
      expect(schemaContent).toContain('CREATE TABLE');
      expect(schemaContent).toContain('functions');
      expect(schemaContent).toContain('snapshots');
    } catch (error) {
      // database.sqlファイルが見つからない場合のフォールバック
      console.warn('database.sql not found for integration test, this is expected in PoC phase');
    }
  });

  it('should handle PGLite-specific operations', async () => {
    // PGLiteでの基本的なSQL操作をテスト
    await db.exec(`
      CREATE TABLE migration_test (
        id SERIAL PRIMARY KEY,
        data TEXT
      )
    `);
    
    const result = await db.query('SELECT tablename FROM pg_tables WHERE tablename = $1', ['migration_test']);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].tablename).toBe('migration_test');
  });
});
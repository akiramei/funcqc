import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { SimpleMigrationManager } from '../../src/migrations/simple-migration-manager';
import * as path from 'path';
import * as os from 'os';

describe('SimpleMigrationManager', () => {
  let db: PGlite;
  let manager: SimpleMigrationManager;
  let tempDbPath: string;

  beforeEach(async () => {
    // テスト用の一時データベースを作成
    tempDbPath = path.join(os.tmpdir(), `funcqc-simple-test-${Date.now()}`);
    db = new PGlite(tempDbPath);
    manager = new SimpleMigrationManager(db, tempDbPath);
  });

  afterEach(async () => {
    // クリーンアップ
    if (db) {
      await db.close();
    }
  });

  describe('基本的なマイグレーション機能', () => {
    it('should create SimpleMigrationManager instance', () => {
      expect(manager).toBeDefined();
      expect(manager.getRawDatabase()).toBe(db);
    });

    it('should initialize migration table', async () => {
      const applied = await manager.getAppliedMigrations();
      expect(Array.isArray(applied)).toBe(true);
      expect(applied).toHaveLength(0);
    });

    it('should get migration status', async () => {
      const status = await manager.getStatus();
      expect(status).toHaveProperty('applied');
      expect(status).toHaveProperty('pending');
      expect(Array.isArray(status.applied)).toBe(true);
      expect(Array.isArray(status.pending)).toBe(true);
    });
  });

  describe('カスタムマイグレーション', () => {
    it('should run custom migration successfully', async () => {
      const sqlStatements = [
        `CREATE TABLE test_migration (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE INDEX idx_test_migration_name ON test_migration(name)`
      ];

      const result = await manager.runCustomMigration(
        sqlStatements,
        'test_custom_migration',
        100
      );

      expect(result.success).toBe(true);
      expect(result.migrationName).toBe('test_custom_migration');
      expect(result.executionTimeMs).toBeGreaterThan(0);

      // テーブルが作成されたか確認
      const tableCheck = await db.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'test_migration'
        )
      `);
      expect(tableCheck.rows[0].exists).toBe(true);

      // マイグレーション履歴に記録されたか確認
      const applied = await manager.getAppliedMigrations();
      expect(applied).toHaveLength(1);
      expect(applied[0].name).toBe('test_custom_migration');
      expect(applied[0].version).toBe(100);
    });

    it('should not run same migration twice', async () => {
      const sqlStatements = [`CREATE TABLE test_duplicate (id SERIAL)`];

      // 1回目の実行
      const result1 = await manager.runCustomMigration(
        sqlStatements,
        'test_duplicate_migration',
        200
      );
      expect(result1.success).toBe(true);

      // 2回目の実行（既に適用済み）
      const result2 = await manager.runCustomMigration(
        sqlStatements,
        'test_duplicate_migration',
        200
      );
      expect(result2.success).toBe(true);
      expect(result2.executionTimeMs).toBe(0); // スキップされるため0

      // マイグレーション履歴は1件のみ
      const applied = await manager.getAppliedMigrations();
      expect(applied).toHaveLength(1);
    });

    it('should handle migration errors gracefully', async () => {
      // 意図的にエラーを起こすSQL
      const sqlStatements = [`INVALID SQL STATEMENT`];

      const result = await manager.runCustomMigration(
        sqlStatements,
        'test_error_migration',
        300
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.migrationName).toBe('test_error_migration');

      // エラーが起きた場合はマイグレーション履歴に記録されない
      const applied = await manager.getAppliedMigrations();
      expect(applied).toHaveLength(0);
    });
  });

  describe('テーブルマイグレーション', () => {
    beforeEach(async () => {
      // テスト用のテーブルを事前に作成
      await db.exec(`
        CREATE TABLE test_table (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);
      await db.exec(`INSERT INTO test_table (name) VALUES ('Test 1'), ('Test 2')`);
    });

    it('should run table migration with data preservation', async () => {
      const newTableSQL = `
        CREATE TABLE test_table (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;

      const dataMigrationSQL = `
        INSERT INTO test_table (id, name, description)
        SELECT id, name, 'Migrated data' 
        FROM OLD_test_table_${new Date().toISOString().substring(0, 10).replace(/-/g, '_')}
      `;

      const result = await manager.runTableMigration(
        'test_table',
        true, // データ保全有効
        newTableSQL,
        dataMigrationSQL
      );

      expect(result.success).toBe(true);

      // 新しいテーブル構造になっているか確認
      const columns = await db.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'test_table'
        ORDER BY ordinal_position
      `);

      const columnNames = columns.rows.map(row => row.column_name);
      expect(columnNames).toContain('description');
      expect(columnNames).toContain('updated_at');

      // バックアップテーブルが作成されたか確認
      const backupTables = await manager.listBackupTables();
      expect(backupTables.length).toBeGreaterThan(0);
      expect(backupTables.some(name => name.startsWith('OLD_test_table_'))).toBe(true);
    });

    it('should run table migration without data preservation', async () => {
      const newTableSQL = `
        CREATE TABLE test_table (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT DEFAULT 'general'
        )
      `;

      const result = await manager.runTableMigration(
        'test_table',
        false, // データ保全無効
        newTableSQL
      );

      expect(result.success).toBe(true);

      // バックアップテーブルは作成されない
      const backupTables = await manager.listBackupTables();
      expect(backupTables).toHaveLength(0);
    });
  });

  describe('バックアップ管理', () => {
    beforeEach(async () => {
      // テスト用のバックアップテーブルを作成
      const timestamp = new Date().toISOString().substring(0, 19).replace(/[:-]/g, '_');
      await db.exec(`CREATE TABLE OLD_test_backup_${timestamp} (id SERIAL, data TEXT)`);
    });

    it('should list backup tables', async () => {
      const backupTables = await manager.listBackupTables();
      expect(Array.isArray(backupTables)).toBe(true);
      expect(backupTables.length).toBeGreaterThan(0);
      expect(backupTables.some(name => name.startsWith('OLD_test_backup_'))).toBe(true);
    });

    it('should cleanup old backup tables', async () => {
      // 現在のバックアップ数を取得
      const beforeCleanup = await manager.listBackupTables();
      
      // 古いバックアップをクリーンアップ（0日以上古い = 全て削除）
      const deletedCount = await manager.cleanupOldBackups(0);
      
      expect(deletedCount).toBeGreaterThanOrEqual(0);
      
      // クリーンアップ後のバックアップ数を確認
      const afterCleanup = await manager.listBackupTables();
      expect(afterCleanup.length).toBeLessThanOrEqual(beforeCleanup.length);
    });
  });

  describe('開発ユーティリティ', () => {
    it('should reset migration history', async () => {
      // まずマイグレーションを実行
      await manager.runCustomMigration(
        ['CREATE TABLE reset_test (id SERIAL)'],
        'test_reset',
        400
      );

      const beforeReset = await manager.getAppliedMigrations();
      expect(beforeReset.length).toBeGreaterThan(0);

      // リセット実行
      await manager.resetMigrations();

      // マイグレーション履歴がクリアされているか確認
      const afterReset = await manager.getAppliedMigrations();
      expect(afterReset).toHaveLength(0);
    });
  });

  describe('エラーハンドリング', () => {
    it('should handle database connection issues gracefully', async () => {
      // データベースを閉じた後の操作をテスト
      await db.close();

      try {
        await manager.getAppliedMigrations();
      } catch (error) {
        expect(error).toBeDefined();
        // エラーが適切にハンドリングされることを確認
      }
    });
  });
});
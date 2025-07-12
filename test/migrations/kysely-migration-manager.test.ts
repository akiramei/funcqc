import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { KyselyMigrationManager } from '../../src/migrations/kysely-migration-manager';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('KyselyMigrationManager', () => {
  let pglite: PGlite;
  let migrationManager: KyselyMigrationManager;
  let tempMigrationDir: string;

  beforeEach(async () => {
    // In-memory PGLite instance for testing
    pglite = new PGlite();
    
    // Temporary migration directory
    tempMigrationDir = path.join(__dirname, 'temp_migrations');
    await fs.mkdir(tempMigrationDir, { recursive: true });
    
    migrationManager = new KyselyMigrationManager(pglite, {
      migrationFolder: tempMigrationDir
    });
  });

  afterEach(async () => {
    await migrationManager.close();
    await pglite.close();
    
    // Clean up temp migration directory
    try {
      await fs.rmdir(tempMigrationDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('基本機能テスト', () => {
    it('should create a new migration file', async () => {
      const migrationPath = await migrationManager.createMigration('test_migration');
      
      expect(migrationPath).toContain('test_migration.ts');
      expect(migrationPath).toContain(tempMigrationDir);
      
      // ファイルが実際に作成されたかチェック
      const content = await fs.readFile(migrationPath, 'utf-8');
      expect(content).toContain('export async function up');
      expect(content).toContain('export async function down');
    });

    it('should get migration status without errors', async () => {
      // 最初は空の状態
      const status = await migrationManager.getMigrationStatus();
      expect(Array.isArray(status)).toBe(true);
    });

    it('should handle empty migration directory', async () => {
      const result = await migrationManager.migrateToLatest();
      expect(result.error).toBeUndefined();
      expect(result.results).toBeDefined();
    });
  });

  describe('データ保全機能テスト', () => {
    beforeEach(async () => {
      // テスト用テーブルを作成
      await pglite.query(`
        CREATE TABLE test_table (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      
      // テストデータを挿入
      await pglite.query(`
        INSERT INTO test_table (name) VALUES 
        ('Test 1'), ('Test 2'), ('Test 3')
      `);
    });

    it('should preserve table data as backup', async () => {
      const backupTableName = await migrationManager.preserveTableData('test_table');
      
      expect(backupTableName).toMatch(/^OLD_test_table_\d+_\d+$/);
      
      // バックアップテーブルが作成されたかチェック
      const result = await pglite.query(`SELECT COUNT(*) as count FROM ${backupTableName}`);
      expect(result.rows[0]).toEqual({ count: 3 });
    });

    it('should list backup tables', async () => {
      // バックアップテーブルを作成
      const backupTableName = await migrationManager.preserveTableData('test_table');
      
      const backupTables = await migrationManager.listBackupTables();
      expect(backupTables.length).toBeGreaterThan(0);
      expect(backupTables.some(table => table.name === backupTableName)).toBe(true);
    });

    it('should handle non-existent table gracefully', async () => {
      const backupTableName = await migrationManager.preserveTableData('non_existent_table');
      expect(backupTableName).toMatch(/^OLD_non_existent_table_/);
    });
  });

  describe('実際のマイグレーション動作テスト', () => {
    beforeEach(async () => {
      // テスト用マイグレーションファイルを作成
      const migrationContent = `
import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('kysely_test_table')
    .addColumn('id', 'serial', col => col.primaryKey())
    .addColumn('name', 'varchar(255)', col => col.notNull())
    .addColumn('created_at', 'timestamp', col => col.defaultTo('now()'))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('kysely_test_table').execute();
}
      `;

      const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
      const filename = `${timestamp}_create_kysely_test_table.ts`;
      const filepath = path.join(tempMigrationDir, filename);
      
      await fs.writeFile(filepath, migrationContent.trim());
    });

    it('should run migration up successfully', async () => {
      const result = await migrationManager.migrateToLatest();
      
      expect(result.error).toBeUndefined();
      expect(result.results).toBeDefined();
      expect(result.results!.length).toBe(1);
      expect(result.results![0].status).toBe('Success');
      
      // テーブルが作成されたかチェック
      const tableResult = await pglite.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'kysely_test_table'
        )
      `);
      expect(tableResult.rows[0]).toEqual({ exists: true });
    });

    it('should show correct migration status after applying', async () => {
      await migrationManager.migrateToLatest();
      
      const status = await migrationManager.getMigrationStatus();
      expect(status.length).toBe(1);
      expect(status[0].executedAt).toBeTruthy();
    });

    it('should rollback migration successfully', async () => {
      // マイグレーション実行
      await migrationManager.migrateToLatest();
      
      // ロールバック実行
      const rollbackResult = await migrationManager.migrateDown();
      expect(rollbackResult.error).toBeUndefined();
      
      // テーブルが削除されたかチェック
      const tableResult = await pglite.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'kysely_test_table'
        )
      `);
      expect(tableResult.rows[0]).toEqual({ exists: false });
    });
  });

  describe('エラーハンドリングテスト', () => {
    it('should handle invalid migration gracefully', async () => {
      // 不正なマイグレーションファイルを作成
      const invalidMigrationContent = `
import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('invalid_table')
    .addColumn('id', 'INVALID_TYPE')  // 無効な型
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('invalid_table').execute();
}
      `;

      const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
      const filename = `${timestamp}_invalid_migration.ts`;
      const filepath = path.join(tempMigrationDir, filename);
      
      await fs.writeFile(filepath, invalidMigrationContent.trim());

      // マイグレーション実行（エラーが発生するはず）
      try {
        await migrationManager.migrateToLatest();
        expect.fail('Migration should have failed');
      } catch (error) {
        expect(error).toBeTruthy();
        expect(error.message).toContain('invalid column data type');
      }
    });
  });

  describe('PostgreSQL互換性テスト', () => {
    it('should support PostgreSQL-specific features', async () => {
      // PostgreSQL特有の機能をテスト（UUID、JSONB等）
      const postgresqlMigrationContent = `
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('postgresql_features_test')
    .addColumn('id', 'serial', col => col.primaryKey())
    .addColumn('uuid_col', 'uuid', col => col.defaultTo(sql\`gen_random_uuid()\`))
    .addColumn('jsonb_col', 'jsonb')
    .addColumn('timestamp_col', 'timestamp', col => col.defaultTo('now()'))
    .execute();
    
  // インデックスも作成
  await db.schema
    .createIndex('idx_postgresql_features_jsonb')
    .on('postgresql_features_test')
    .column('jsonb_col')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('postgresql_features_test').execute();
}
      `;

      const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
      const filename = `${timestamp}_postgresql_features.ts`;
      const filepath = path.join(tempMigrationDir, filename);
      
      await fs.writeFile(filepath, postgresqlMigrationContent.trim());

      // マイグレーション実行
      const result = await migrationManager.migrateToLatest();
      expect(result.error).toBeUndefined();
      
      // テーブルが作成されたかチェック
      const tableResult = await pglite.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'postgresql_features_test'
        )
      `);
      expect(tableResult.rows[0]).toEqual({ exists: true });
    });
  });
});
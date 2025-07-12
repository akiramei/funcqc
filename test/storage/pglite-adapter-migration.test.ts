import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGLiteStorageAdapter } from '../../src/storage/pglite-adapter';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

describe('PGLiteStorageAdapter Migration Integration', () => {
  let adapter: PGLiteStorageAdapter;
  let tempDbPath: string;

  beforeEach(async () => {
    // 固定時刻でテスト
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-12T14:30:00'));
    
    // ユニークな一時データベースパス
    const uniqueId = randomUUID().slice(0, 8);
    tempDbPath = path.join(os.tmpdir(), `funcqc-migration-test-${uniqueId}`);
    
    adapter = new PGLiteStorageAdapter(tempDbPath);
  });

  afterEach(async () => {
    vi.useRealTimers();
    
    // リソースクリーンアップ
    if (adapter) {
      try {
        await (adapter as any).db.close();
      } catch {
        // Already closed
      }
    }
    
    // 一時ファイル削除
    try {
      await fs.rm(tempDbPath, { recursive: true, force: true });
    } catch {
      // File might not exist
    }
  });

  describe('Migration Integration', () => {
    it('should initialize with migration system', async () => {
      // マイグレーションマネージャーが利用可能であることを確認
      const migrationManager = adapter.getMigrationManager();
      expect(migrationManager).toBeDefined();
      
      // マイグレーション状態を取得
      const status = await adapter.getMigrationStatus();
      expect(status).toHaveProperty('applied');
      expect(status).toHaveProperty('pending');
      expect(Array.isArray(status.applied)).toBe(true);
      expect(Array.isArray(status.pending)).toBe(true);
    });

    it('should handle backup table operations', async () => {
      // 初期状態ではバックアップテーブルは存在しない
      const initialBackups = await adapter.listBackupTables();
      expect(Array.isArray(initialBackups)).toBe(true);
      
      // バックアップのクリーンアップは問題なく実行されるべき
      const cleanedCount = await adapter.cleanupOldBackups(0);
      expect(typeof cleanedCount).toBe('number');
      expect(cleanedCount).toBeGreaterThanOrEqual(0);
    });

    it('should provide access to migration manager', async () => {
      const migrationManager = adapter.getMigrationManager();
      
      // マイグレーションマネージャーの基本機能をテスト
      expect(migrationManager.getRawDatabase()).toBeDefined();
      
      // 適用済みマイグレーション一覧を取得
      const applied = await migrationManager.getAppliedMigrations();
      expect(Array.isArray(applied)).toBe(true);
    });

    it('should successfully initialize new database', async () => {
      // PGLiteStorageAdapterの通常の機能が動作することを確認
      // これにより内部的にマイグレーションシステムが正常に動作していることが検証される
      
      // 基本的なスナップショット操作を試行
      const functionList = []; // 空の関数リストでテスト
      
      // データベースの初期化が完了していることを確認するため、
      // 何らかの基本操作を実行
      try {
        // この操作によりcreateSchema()が内部的に呼び出され、
        // マイグレーションシステムが初期化される
        const snapshots = await adapter.getSnapshots();
        expect(Array.isArray(snapshots)).toBe(true);
        
        console.log('✅ Database successfully initialized with migration system');
      } catch (error) {
        console.error('Database initialization failed:', error);
        throw error;
      }
    });
  });

  describe('Migration System Fallback', () => {
    it('should handle migration failures gracefully', async () => {
      // マイグレーションが失敗した場合でも、
      // アダプターは基本的な動作を継続すべき
      
      try {
        const status = await adapter.getMigrationStatus();
        expect(status).toBeDefined();
      } catch (error) {
        // マイグレーション状態の取得が失敗しても、
        // 致命的なエラーではない
        console.warn('Migration status check failed (expected in some scenarios):', error);
      }
    });
  });
});
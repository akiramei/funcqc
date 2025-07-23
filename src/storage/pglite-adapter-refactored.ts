/**
 * Refactored PGLite Storage Adapter
 * 
 * This is the main adapter that delegates to specialized modules
 * while maintaining backward compatibility with the existing interface
 */

import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import simpleGit, { SimpleGit } from 'simple-git';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  FunctionInfo,
  SnapshotInfo,
  StorageAdapter,
  QueryOptions,
  SnapshotDiff,
  LineageQuery,
  Lineage,
  RefactoringSession,
  RefactoringChangeset,
  NamingEvaluation,
  CallEdge,
} from '../types';
import { DatabaseError } from './errors/database-error';
import { ErrorCode } from '../utils/error-handler';
import { StorageContext } from './modules/types';
import { DatabaseCore } from './modules/database-core';
import { SnapshotOperations } from './modules/snapshot-operations';

/**
 * Refactored PGLite storage adapter that uses modular operations
 */
export class PGLiteStorageAdapter implements StorageAdapter {
  private db: PGlite;
  private kysely!: Kysely<any>;
  private git: SimpleGit;
  private dbPath: string;
  private originalDbPath: string;
  private logger: { log: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void } | undefined;
  private isInitialized: boolean = false;

  // Operation modules
  private databaseCore: DatabaseCore;
  private snapshotOps: SnapshotOperations;
  
  // Storage context shared by all modules
  private context: StorageContext;

  constructor(dbPath: string, logger?: { log: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }) {
    this.validateDbPath(dbPath);
    this.logger = logger;
    this.originalDbPath = dbPath;
    this.dbPath = path.resolve(dbPath);
    this.db = new PGlite(dbPath);
    this.git = simpleGit();

    // Create storage context
    this.context = {
      db: this.db,
      kysely: null as any, // Will be initialized in init()
      git: this.git,
      dbPath: this.dbPath,
      logger: this.logger,
    };

    // Initialize operation modules
    this.databaseCore = new DatabaseCore(this.context);
    this.snapshotOps = new SnapshotOperations(this.context);
  }

  /**
   * Initialize the storage adapter
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await this.databaseCore.initialize();
      this.kysely = this.context.kysely;
      this.isInitialized = true;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to initialize storage adapter: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Close the storage adapter
   */
  async close(): Promise<void> {
    await this.databaseCore.close();
  }

  // ========================================
  // SNAPSHOT OPERATIONS (delegated to module)
  // ========================================

  async saveSnapshot(
    functions: FunctionInfo[],
    label?: string,
    comment?: string,
    configHash?: string
  ): Promise<string> {
    await this.ensureInitialized();
    
    // For now, we need to handle the full snapshot save here
    // because it involves both snapshot and function operations
    const snapshotId = await this.snapshotOps.createSnapshot({
      label,
      comment,
      configHash,
    });

    // Save functions will be handled by function operations module (to be created)
    // For now, we'll need to implement this in the main adapter
    await this.saveFunctions(snapshotId, functions);

    return snapshotId;
  }

  async createSnapshot(options: { 
    label?: string; 
    comment?: string; 
    analysisLevel?: string; 
    scope?: string; 
    configHash?: string 
  }): Promise<string> {
    await this.ensureInitialized();
    return this.snapshotOps.createSnapshot(options);
  }

  async updateAnalysisLevel(snapshotId: string, level: 'NONE' | 'BASIC' | 'CALL_GRAPH'): Promise<void> {
    await this.ensureInitialized();
    return this.snapshotOps.updateAnalysisLevel(snapshotId, level);
  }

  async getSnapshots(options?: QueryOptions): Promise<SnapshotInfo[]> {
    await this.ensureInitialized();
    return this.snapshotOps.getSnapshots(options);
  }

  async getSnapshot(id: string): Promise<SnapshotInfo | null> {
    await this.ensureInitialized();
    return this.snapshotOps.getSnapshot(id);
  }

  async deleteSnapshot(id: string): Promise<boolean> {
    await this.ensureInitialized();
    return this.snapshotOps.deleteSnapshot(id);
  }

  async getLatestSnapshot(): Promise<SnapshotInfo | null> {
    await this.ensureInitialized();
    return this.snapshotOps.getLatestSnapshot();
  }

  async getLastConfigHash(): Promise<string | null> {
    await this.ensureInitialized();
    return this.snapshotOps.getLastConfigHash();
  }

  // ========================================
  // FUNCTION OPERATIONS (to be modularized)
  // ========================================

  async getFunctions(snapshotId: string, options?: QueryOptions): Promise<FunctionInfo[]> {
    await this.ensureInitialized();
    // TODO: Delegate to function operations module
    throw new Error('Not implemented in refactored adapter yet');
  }

  async getFunction(id: string): Promise<FunctionInfo | null> {
    await this.ensureInitialized();
    // TODO: Delegate to function operations module
    throw new Error('Not implemented in refactored adapter yet');
  }

  async getFunctionsBySnapshot(snapshotId: string): Promise<FunctionInfo[]> {
    await this.ensureInitialized();
    // TODO: Delegate to function operations module
    throw new Error('Not implemented in refactored adapter yet');
  }

  async saveFunctions(snapshotId: string, functions: FunctionInfo[]): Promise<void> {
    await this.ensureInitialized();
    // TODO: Delegate to function operations module
    throw new Error('Not implemented in refactored adapter yet');
  }

  // ========================================
  // DIFF OPERATIONS (to be modularized)
  // ========================================

  async diffSnapshots(fromId: string, toId: string): Promise<SnapshotDiff> {
    await this.ensureInitialized();
    // TODO: Delegate to diff operations module
    throw new Error('Not implemented in refactored adapter yet');
  }

  // ========================================
  // LINEAGE OPERATIONS (to be modularized)
  // ========================================

  async saveLineage(lineage: Lineage): Promise<string> {
    await this.ensureInitialized();
    // TODO: Delegate to lineage operations module
    throw new Error('Not implemented in refactored adapter yet');
  }

  async getLineage(id: string): Promise<Lineage | null> {
    await this.ensureInitialized();
    // TODO: Delegate to lineage operations module
    throw new Error('Not implemented in refactored adapter yet');
  }

  async queryLineages(query: LineageQuery): Promise<Lineage[]> {
    await this.ensureInitialized();
    // TODO: Delegate to lineage operations module
    throw new Error('Not implemented in refactored adapter yet');
  }

  async updateLineageStatus(id: string, status: 'draft' | 'confirmed' | 'final'): Promise<boolean> {
    await this.ensureInitialized();
    // TODO: Delegate to lineage operations module
    throw new Error('Not implemented in refactored adapter yet');
  }

  async deleteLineage(id: string): Promise<boolean> {
    await this.ensureInitialized();
    // TODO: Delegate to lineage operations module
    throw new Error('Not implemented in refactored adapter yet');
  }

  async getLineagesByCommit(gitCommit: string): Promise<Lineage[]> {
    await this.ensureInitialized();
    // TODO: Delegate to lineage operations module
    throw new Error('Not implemented in refactored adapter yet');
  }

  async getFunctionLineageHistory(functionId: string, limit?: number): Promise<Lineage[]> {
    await this.ensureInitialized();
    // TODO: Delegate to lineage operations module
    throw new Error('Not implemented in refactored adapter yet');
  }

  async pruneOldLineages(daysToKeep: number): Promise<number> {
    await this.ensureInitialized();
    // TODO: Delegate to lineage operations module
    throw new Error('Not implemented in refactored adapter yet');
  }

  // ========================================
  // OTHER OPERATIONS (to be modularized)
  // ========================================

  // ... Additional methods will be implemented as modules are created

  // ========================================
  // PRIVATE HELPER METHODS
  // ========================================

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.init();
    }
  }

  private validateDbPath(dbPath: string): void {
    if (!dbPath || typeof dbPath !== 'string') {
      throw new Error('Database path must be a non-empty string');
    }
  }

  private generateSnapshotId(): string {
    return uuidv4();
  }
}
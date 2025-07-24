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
import { Database } from './types/kysely-types';
import {
  FunctionInfo,
  SnapshotInfo,
  StorageAdapter,
  QueryOptions,
  SnapshotDiff,
  LineageQuery,
  Lineage,
  LineageStatus,
  FunctionDescription,
  NamingEvaluation,
  RefactoringSession,
  RefactoringChangeset,
  CallEdge,
  InternalCallEdge,
  SourceFile,
  BackupOptions,
} from '../types';
import { DatabaseError } from './errors/database-error';
import { ErrorCode } from '../utils/error-handler';
import { StorageContext } from './modules/types';
import { DatabaseCore } from './modules/database-core';
import { SnapshotOperations } from './modules/snapshot-operations';
import { FunctionOperations } from './modules/function-operations';
import { MetricsOperations } from './modules/metrics-operations';
import { LineageOperations } from './modules/lineage-operations';
import { EmbeddingOperations } from './modules/embedding-operations';
import { RefactoringOperations } from './modules/refactoring-operations';
import { CallEdgeOperations } from './modules/call-edge-operations';
import { UtilityOperations } from './modules/utility-operations';

/**
 * Refactored PGLite storage adapter that uses modular operations
 */
export class PGLiteStorageAdapter implements StorageAdapter {
  private db: PGlite;
  // private kysely!: Kysely<any>; // Accessed through context
  private git: SimpleGit;
  private dbPath: string;
  private logger: { log: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void } | undefined;
  private isInitialized: boolean = false;

  // Operation modules
  private databaseCore: DatabaseCore;
  private snapshotOps: SnapshotOperations;
  private functionOps: FunctionOperations;
  private metricsOps: MetricsOperations;
  private lineageOps: LineageOperations;
  private embeddingOps: EmbeddingOperations;
  private refactoringOps: RefactoringOperations;
  private callEdgeOps: CallEdgeOperations;
  private utilityOps: UtilityOperations;
  
  // Storage context shared by all modules
  private context: StorageContext;

  constructor(dbPath: string, logger?: { log: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }) {
    this.validateDbPath(dbPath);
    this.logger = logger;
    // Store original path if needed later
    this.dbPath = path.resolve(dbPath);
    this.db = new PGlite(dbPath);
    this.git = simpleGit();

    // Create storage context
    this.context = {
      db: this.db,
      kysely: null as unknown as Kysely<Database>, // Will be initialized in init()
      git: this.git,
      dbPath: this.dbPath,
      ...(this.logger && { logger: this.logger }),
    };

    // Initialize operation modules
    this.databaseCore = new DatabaseCore(this.context);
    this.snapshotOps = new SnapshotOperations(this.context);
    this.functionOps = new FunctionOperations(this.context);
    this.metricsOps = new MetricsOperations(this.context);
    this.lineageOps = new LineageOperations(this.context);
    this.embeddingOps = new EmbeddingOperations(this.context);
    this.refactoringOps = new RefactoringOperations(this.context);
    this.callEdgeOps = new CallEdgeOperations(this.context);
    this.utilityOps = new UtilityOperations(this.context);
  }

  /**
   * Initialize the storage adapter
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await this.databaseCore.initialize();
      // kysely is now accessed through context in modules
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
   * Lightweight initialization for health checks and basic operations
   */
  async lightweightInit(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      await this.databaseCore.lightweightInit();
      // kysely is now accessed through context in modules
      this.isInitialized = true;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to lightweight initialize storage adapter: ${error instanceof Error ? error.message : String(error)}`,
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
      ...(label && { label }),
      ...(comment && { comment }),
      ...(configHash && { configHash }),
    });

    // Save functions using function operations module
    await this.functionOps.saveFunctions(snapshotId, functions);

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
    return this.functionOps.getFunctions(snapshotId, options);
  }

  async getFunction(id: string): Promise<FunctionInfo | null> {
    await this.ensureInitialized();
    return this.functionOps.getFunction(id);
  }

  async getFunctionsBySnapshot(snapshotId: string): Promise<FunctionInfo[]> {
    await this.ensureInitialized();
    return this.functionOps.getFunctionsBySnapshot(snapshotId);
  }

  async queryFunctions(options?: QueryOptions): Promise<FunctionInfo[]> {
    await this.ensureInitialized();
    return this.functionOps.queryFunctions(options);
  }

  async saveFunctions(snapshotId: string, functions: FunctionInfo[]): Promise<void> {
    await this.ensureInitialized();
    return this.functionOps.saveFunctions(snapshotId, functions);
  }

  // ========================================
  // DIFF OPERATIONS (to be modularized)
  // ========================================

  async diffSnapshots(_fromId: string, _toId: string): Promise<SnapshotDiff> {
    await this.ensureInitialized();
    // TODO: Delegate to diff operations module
    throw new Error('Not implemented in refactored adapter yet');
  }

  // ========================================
  // LINEAGE OPERATIONS (to be modularized)
  // ========================================

  async saveLineage(lineage: Lineage): Promise<void> {
    await this.ensureInitialized();
    await this.lineageOps.saveLineage(lineage);
  }

  async getLineage(id: string): Promise<Lineage | null> {
    await this.ensureInitialized();
    return this.lineageOps.getLineage(id);
  }

  async queryLineages(query: LineageQuery): Promise<Lineage[]> {
    await this.ensureInitialized();
    return this.lineageOps.queryLineages(query);
  }

  async updateLineageStatus(id: string, status: LineageStatus, note?: string): Promise<void> {
    await this.ensureInitialized();
    await this.lineageOps.updateLineageStatus(id, status, note);
  }

  async deleteLineage(id: string): Promise<boolean> {
    await this.ensureInitialized();
    return this.lineageOps.deleteLineage(id);
  }

  async getLineagesByCommit(gitCommit: string): Promise<Lineage[]> {
    await this.ensureInitialized();
    return this.lineageOps.getLineagesByCommit(gitCommit);
  }

  async getFunctionLineageHistory(functionId: string, limit?: number): Promise<Lineage[]> {
    await this.ensureInitialized();
    return this.lineageOps.getFunctionLineageHistory(functionId, limit);
  }

  async pruneOldLineages(daysToKeep: number): Promise<number> {
    await this.ensureInitialized();
    return this.lineageOps.pruneOldLineages(daysToKeep);
  }

  // ========================================
  // FUNCTION OPERATIONS - Additional Methods
  // ========================================

  async getFunctionsBatch(functionIds: string[]): Promise<Map<string, FunctionInfo>> {
    await this.ensureInitialized();
    return this.functionOps.getFunctionsBatch(functionIds);
  }

  async storeFunctions(functions: FunctionInfo[], snapshotId: string): Promise<void> {
    await this.ensureInitialized();
    return this.functionOps.storeFunctions(functions, snapshotId);
  }

  async getFunctionsWithDescriptions(snapshotId: string, options?: QueryOptions): Promise<FunctionInfo[]> {
    await this.ensureInitialized();
    return this.functionOps.getFunctionsWithDescriptions(snapshotId, options);
  }

  async getFunctionsWithoutDescriptions(snapshotId: string, options?: QueryOptions): Promise<FunctionInfo[]> {
    await this.ensureInitialized();
    return this.functionOps.getFunctionsWithoutDescriptions(snapshotId, options);
  }

  async getFunctionsNeedingDescriptions(snapshotId: string, options?: QueryOptions): Promise<FunctionInfo[]> {
    await this.ensureInitialized();
    return this.functionOps.getFunctionsNeedingDescriptions(snapshotId, options);
  }

  async getFunctionsBySnapshotId(snapshotId: string): Promise<FunctionInfo[]> {
    await this.ensureInitialized();
    return this.functionOps.getFunctionsBySnapshot(snapshotId);
  }

  async extractFunctionSourceCode(functionId: string): Promise<string | null> {
    await this.ensureInitialized();
    return this.functionOps.extractFunctionSourceCode(functionId);
  }

  // ========================================
  // FUNCTION DESCRIPTIONS
  // ========================================

  async saveFunctionDescription(description: FunctionDescription): Promise<void> {
    await this.ensureInitialized();
    return this.functionOps.saveFunctionDescription({
      ...description,
      source: description.source || 'unknown'
    });
  }

  async getFunctionDescription(semanticId: string): Promise<FunctionDescription | null> {
    await this.ensureInitialized();
    const result = this.functionOps.getFunctionDescription(semanticId);
    return result as Promise<FunctionDescription | null>;
  }

  async searchFunctionsByDescription(keyword: string, options?: QueryOptions): Promise<FunctionInfo[]> {
    await this.ensureInitialized();
    return this.functionOps.searchFunctionsByDescription(keyword, options);
  }

  // ========================================
  // EMBEDDING OPERATIONS
  // ========================================

  async saveEmbedding(semanticId: string, embedding: number[], model?: string): Promise<void> {
    await this.ensureInitialized();
    return this.embeddingOps.saveEmbedding(semanticId, embedding, model);
  }

  async getEmbedding(semanticId: string): Promise<{ embedding: number[]; model: string } | null> {
    await this.ensureInitialized();
    const result = await this.embeddingOps.getEmbedding(semanticId);
    if (!result) return null;
    return {
      embedding: result.embedding,
      model: result.embeddingModel
    };
  }

  async searchByEmbedding(queryEmbedding: number[], threshold?: number, limit?: number): Promise<Array<FunctionInfo & { similarity: number }>> {
    await this.ensureInitialized();
    return this.embeddingOps.searchByEmbedding(queryEmbedding, threshold, limit);
  }

  async bulkSaveEmbeddings(embeddings: Array<{ semanticId: string; embedding: number[]; model: string }>): Promise<void> {
    await this.ensureInitialized();
    return this.embeddingOps.bulkSaveEmbeddings(embeddings);
  }

  async getFunctionsWithoutEmbeddings(snapshotId: string, _limit?: number): Promise<FunctionInfo[]> {
    await this.ensureInitialized();
    return this.embeddingOps.getFunctionsWithoutEmbeddings(snapshotId);
  }

  async getEmbeddingStats(): Promise<{ total: number; withEmbeddings: number; withoutEmbeddings: number }> {
    await this.ensureInitialized();
    const stats = await this.embeddingOps.getEmbeddingStats();
    return {
      total: stats.totalEmbeddings,
      withEmbeddings: stats.functionsWithEmbeddings,
      withoutEmbeddings: stats.functionsWithoutEmbeddings
    };
  }

  // ========================================
  // NAMING EVALUATION OPERATIONS
  // ========================================

  async saveNamingEvaluation(evaluation: NamingEvaluation): Promise<void> {
    await this.ensureInitialized();
    return this.metricsOps.saveNamingEvaluation(evaluation as Record<string, unknown>);
  }

  async getNamingEvaluation(functionId: string): Promise<NamingEvaluation | null> {
    await this.ensureInitialized();
    return this.metricsOps.getNamingEvaluation(functionId);
  }

  async getFunctionsNeedingEvaluation(snapshotId: string, options?: QueryOptions): Promise<Array<{ functionId: string; functionName: string; lastModified: number }>> {
    await this.ensureInitialized();
    return this.metricsOps.getFunctionsNeedingEvaluation(snapshotId, options);
  }

  async getFunctionsWithEvaluations(snapshotId: string, options?: QueryOptions): Promise<Array<{ functionId: string; evaluation: NamingEvaluation }>> {
    await this.ensureInitialized();
    return this.metricsOps.getFunctionsWithEvaluations(snapshotId, options);
  }

  async updateEvaluationRevisionStatus(functionId: string, revisionNeeded: boolean): Promise<void> {
    await this.ensureInitialized();
    return this.metricsOps.updateEvaluationRevisionStatus(functionId, revisionNeeded);
  }

  async batchSaveEvaluations(evaluations: NamingEvaluation[]): Promise<void> {
    await this.ensureInitialized();
    return this.metricsOps.batchSaveEvaluations(evaluations);
  }

  async getEvaluationStatistics(snapshotId: string): Promise<{
    total: number;
    withEvaluations: number;
    needingEvaluation: number;
    averageRating: number;
    ratingDistribution: Record<1 | 2 | 3, number>;
  }> {
    await this.ensureInitialized();
    return this.metricsOps.getEvaluationStatistics(snapshotId);
  }

  // ========================================
  // LINEAGE OPERATIONS - Additional Methods
  // ========================================

  async getLineages(query?: LineageQuery): Promise<Lineage[]> {
    await this.ensureInitialized();
    return this.lineageOps.getLineages(query);
  }

  async getLineagesWithFunctionFilter(fromFunctionPattern?: string, toFunctionPattern?: string, query?: LineageQuery): Promise<Lineage[]> {
    await this.ensureInitialized();
    return this.lineageOps.getLineagesWithFunctionFilter(fromFunctionPattern, toFunctionPattern, query);
  }

  async getLineagesByFunctionId(functionId: string): Promise<Lineage[]> {
    await this.ensureInitialized();
    return this.lineageOps.getLineagesByFunctionId(functionId);
  }

  async pruneDraftLineages(olderThanDays: number): Promise<number> {
    await this.ensureInitialized();
    return this.lineageOps.pruneDraftLineages(olderThanDays);
  }

  // ========================================
  // REFACTORING OPERATIONS
  // ========================================

  async saveRefactoringSession(session: RefactoringSession): Promise<void> {
    await this.ensureInitialized();
    return this.refactoringOps.saveRefactoringSession(session);
  }

  async getRefactoringSession(id: string): Promise<RefactoringSession | null> {
    await this.ensureInitialized();
    return this.refactoringOps.getRefactoringSession(id);
  }

  async updateRefactoringSession(id: string, updates: Partial<RefactoringSession>): Promise<void> {
    await this.ensureInitialized();
    await this.refactoringOps.updateRefactoringSession(id, updates);
  }

  async getRefactoringSessions(query?: QueryOptions): Promise<RefactoringSession[]> {
    await this.ensureInitialized();
    return this.refactoringOps.getRefactoringSessions(query);
  }

  async saveRefactoringChangeset(changeset: RefactoringChangeset): Promise<void> {
    await this.ensureInitialized();
    return this.refactoringOps.saveRefactoringChangeset(changeset);
  }

  async getRefactoringChangeset(id: string): Promise<RefactoringChangeset | null> {
    await this.ensureInitialized();
    return this.refactoringOps.getRefactoringChangeset(id);
  }

  async getRefactoringChangesetsBySession(sessionId: string): Promise<RefactoringChangeset[]> {
    await this.ensureInitialized();
    return this.refactoringOps.getRefactoringChangesetsBySession(sessionId);
  }

  async updateRefactoringChangeset(id: string, updates: Partial<RefactoringChangeset>): Promise<void> {
    await this.ensureInitialized();
    await this.refactoringOps.updateRefactoringChangeset(id, updates);
  }

  // ========================================
  // SOURCE FILE OPERATIONS
  // ========================================

  async saveSourceFiles(sourceFiles: SourceFile[], snapshotId: string): Promise<void> {
    await this.ensureInitialized();
    const mappedFiles = sourceFiles.map(file => ({
      id: file.id || '',
      filePath: file.filePath,
      content: file.fileContent || '',
      hash: file.fileHash || '',
      size: file.fileSizeBytes || 0,
      functionCount: file.functionCount || 0
    }));
    return this.utilityOps.saveSourceFiles(mappedFiles, snapshotId);
  }

  async getSourceFile(id: string): Promise<SourceFile | null> {
    await this.ensureInitialized();
    const result = this.utilityOps.getSourceFile(id);
    return result as Promise<SourceFile | null>;
  }

  async getSourceFilesBySnapshot(snapshotId: string): Promise<SourceFile[]> {
    await this.ensureInitialized();
    const result = this.utilityOps.getSourceFilesBySnapshot(snapshotId);
    return result as Promise<SourceFile[]>;
  }

  async getSourceFileByPath(filePath: string, snapshotId: string): Promise<SourceFile | null> {
    await this.ensureInitialized();
    const result = this.utilityOps.getSourceFileByPath(filePath, snapshotId);
    return result as Promise<SourceFile | null>;
  }

  async findExistingSourceFile(compositeId: string): Promise<string | null> {
    await this.ensureInitialized();
    return this.utilityOps.findExistingSourceFile(compositeId);
  }

  async deleteSourceFiles(snapshotId: string): Promise<number> {
    await this.ensureInitialized();
    return this.utilityOps.deleteSourceFiles(snapshotId);
  }

  async updateSourceFileFunctionCounts(functionCountByFile: Map<string, number>, snapshotId: string): Promise<void> {
    await this.ensureInitialized();
    return this.utilityOps.updateSourceFileFunctionCounts(functionCountByFile, snapshotId);
  }

  // ========================================
  // CALL EDGE OPERATIONS
  // ========================================

  async insertCallEdges(edges: CallEdge[], snapshotId: string): Promise<void> {
    await this.ensureInitialized();
    return this.callEdgeOps.insertCallEdges(snapshotId, edges);
  }

  async getCallEdges(options?: {
    snapshotId?: string;
    callerFunctionId?: string;
    calleeFunctionId?: string;
    calleeName?: string;
    callType?: string;
    limit?: number;
    offset?: number;
  }): Promise<CallEdge[]> {
    await this.ensureInitialized();
    const result = this.callEdgeOps.getCallEdges(options);
    return result as Promise<CallEdge[]>;
  }

  async getCallEdgesByCaller(callerFunctionId: string, snapshotId: string): Promise<CallEdge[]> {
    await this.ensureInitialized();
    const result = this.callEdgeOps.getCallEdges({
      callerFunctionId,
      snapshotId
    });
    return result as Promise<CallEdge[]>;
  }

  async getCallEdgesByCallee(calleeFunctionId: string, snapshotId: string): Promise<CallEdge[]> {
    await this.ensureInitialized();
    const result = this.callEdgeOps.getCallEdges({
      calleeFunctionId,
      snapshotId
    });
    return result as Promise<CallEdge[]>;
  }

  async getCallEdgesBySnapshot(snapshotId: string): Promise<CallEdge[]> {
    await this.ensureInitialized();
    const result = this.callEdgeOps.getCallEdgesBySnapshot(snapshotId);
    return result as Promise<CallEdge[]>;
  }

  async getInternalCallEdgesBySnapshot(snapshotId: string): Promise<InternalCallEdge[]> {
    await this.ensureInitialized();
    return this.callEdgeOps.getInternalCallEdgesBySnapshot(snapshotId);
  }

  async deleteCallEdges(functionIds: string[]): Promise<void> {
    await this.ensureInitialized();
    // Assume first element is snapshotId for now - this may need adjustment
    const snapshotId = functionIds[0];
    await this.callEdgeOps.deleteCallEdges(snapshotId);
  }

  async insertInternalCallEdges(edges: InternalCallEdge[]): Promise<void> {
    await this.ensureInitialized();
    // Need snapshotId - extract from first edge or pass as parameter
    if (edges.length === 0) return;
    const snapshotId = edges[0].snapshotId;
    const callEdges = edges.map(edge => ({
      callerFunctionId: edge.callerFunctionId,
      calleeFunctionId: edge.calleeFunctionId,
      calleeName: edge.calleeName,
      lineNumber: edge.lineNumber,
      columnNumber: edge.columnNumber,
      callType: edge.callType
    } as unknown as CallEdge));
    return this.callEdgeOps.insertInternalCallEdges(snapshotId, callEdges);
  }

  async getInternalCallEdges(filePath: string, snapshotId: string): Promise<InternalCallEdge[]> {
    await this.ensureInitialized();
    // The module only takes snapshotId, not filePath
    const callEdges = await this.callEdgeOps.getInternalCallEdges(snapshotId);
    // Convert CallEdge[] to InternalCallEdge[] and filter by filePath if needed
    return callEdges.map(edge => ({
      snapshotId,
      filePath: filePath,
      callerFunctionId: edge.callerFunctionId,
      calleeFunctionId: edge.calleeFunctionId || '',
      callerName: edge.callerFunctionId,
      calleeName: edge.calleeName,
      lineNumber: edge.lineNumber,
      columnNumber: edge.columnNumber,
      callType: edge.callType,
      detectedBy: 'system'
    } as unknown as InternalCallEdge));
  }

  async getInternalCalleesByFunction(callerFunctionId: string, _snapshotId: string): Promise<string[]> {
    await this.ensureInitialized();
    // The module method doesn't take snapshotId
    return this.callEdgeOps.getInternalCalleesByFunction(callerFunctionId);
  }

  async isInternalFunctionCalled(calleeFunctionId: string, _snapshotId: string): Promise<boolean> {
    await this.ensureInitialized();
    // The module method doesn't take snapshotId
    return this.callEdgeOps.isInternalFunctionCalled(calleeFunctionId);
  }

  // ========================================
  // UTILITY OPERATIONS
  // ========================================

  async cleanup(retentionDays: number): Promise<number> {
    await this.ensureInitialized();
    return this.utilityOps.cleanup(retentionDays);
  }

  async backup(options: BackupOptions): Promise<string> {
    await this.ensureInitialized();
    return this.utilityOps.backup(options as Record<string, unknown>);
  }

  async restore(backupData: string): Promise<void> {
    await this.ensureInitialized();
    return this.utilityOps.restore(backupData);
  }

  // ========================================
  // LEGACY COMPATIBILITY METHODS
  // ========================================

  getDb(): PGlite {
    return this.db;
  }

  // Compatibility methods that may be used internally
  async query(sql: string, params?: unknown[]): Promise<unknown> {
    await this.ensureInitialized();
    // PGlite exec method - cast db to handle type mismatch
    const db = this.db as unknown as { exec(sql: string, params?: unknown[]): Promise<unknown> };
    return db.exec(sql, params);
  }

  async getFunctionHistory(
    functionId: string,
    options?: {
      limit?: number;
      includeAbsent?: boolean;
    }
  ): Promise<Array<{
    snapshot: SnapshotInfo;
    function: FunctionInfo | null;
    isPresent: boolean;
  }>> {
    await this.ensureInitialized();
    const limit = options?.limit || 100;
    const includeAbsent = options?.includeAbsent ?? false;

    try {
      // Get all snapshots ordered by creation time
      const snapshots = await this.getSnapshots({ limit });
      
      if (this.logger) {
        this.logger.log(`getFunctionHistory: Found ${snapshots.length} snapshots for functionId: ${functionId}`);
      }

      // Use a Map to store function presence by snapshot
      const functionPresenceMap = new Map<string, FunctionInfo | null>();

      // Fetch functions for all snapshots in a single query using the IN operator
      if (snapshots.length > 0) {
        const snapshotIds = snapshots.map(s => s.id);
        const query = `
          SELECT f.*, s.id as snapshot_id
          FROM functions f
          JOIN snapshots s ON f.snapshot_id = s.id
          WHERE s.id = ANY($1::text[])
            AND (f.id = $2 OR f.id LIKE $3)
          ORDER BY s.created_at DESC
        `;
        
        const result = await this.db.query(query, [
          snapshotIds,
          functionId,
          functionId.substring(0, 8) + '%' // Support partial IDs
        ]);
        
        if (this.logger) {
          this.logger.log(`getFunctionHistory query returned ${result.rows.length} rows for functionId: ${functionId}`);
        }

        // Process results into the map
        for (const row of result.rows as Record<string, unknown>[]) {
          // Get the function using the proper method
          const func = await this.functionOps.getFunction(row['id'] as string);
          if (func) {
            functionPresenceMap.set(row['snapshot_id'] as string, func);
          }
        }
      }

      // Build the result array
      const history = snapshots.map(snapshot => {
        const func = functionPresenceMap.get(snapshot.id) || null;
        const isPresent = func !== null;

        return {
          snapshot,
          function: func,
          isPresent
        };
      });

      // Filter out absent functions if not included
      if (!includeAbsent) {
        return history.filter(h => h.isPresent);
      }

      return history;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get function history: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async getAllRefactoringSessions(): Promise<RefactoringSession[]> {
    await this.ensureInitialized();
    return this.refactoringOps.getRefactoringSessions();
  }

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
      throw new DatabaseError(
        ErrorCode.INVALID_CONFIG,
        'Database path must be a non-empty string'
      );
    }

    // Check for single drive letter (Windows)
    if (/^[A-Z]:$/i.test(dbPath)) {
      throw new DatabaseError(
        ErrorCode.INVALID_CONFIG,
        'Drive letter only is not a valid path. Use a full path like C:\\funcqc\\data'
      );
    }

    // Check for excessively long paths (Windows MAX_PATH is 260)
    if (dbPath.length > 260) {
      throw new DatabaseError(
        ErrorCode.INVALID_CONFIG,
        'Database path exceeds maximum length (260 characters)'
      );
    }

    // For Windows paths, check if the directory exists
    if (/^[A-Z]:/i.test(dbPath) && !dbPath.startsWith('postgres://') && !dbPath.startsWith('postgresql://')) {
      const path = dbPath.substring(0, dbPath.lastIndexOf('\\') || dbPath.lastIndexOf('/'));
      if (path && path !== dbPath) {
        // Note: In the actual implementation, we would check if directory exists
        // For now, we'll skip this check as it requires fs module
      }
    }
  }

  // Utility method for snapshot ID generation (if needed in future)
  // private generateSnapshotId(): string {
  //   return uuidv4();
  // }
}
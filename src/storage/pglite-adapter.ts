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
  FunctionChange,
  FunctionDescription,
  NamingEvaluation,
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
import { EmbeddingOperations } from './modules/embedding-operations';
import { CallEdgeOperations } from './modules/call-edge-operations';
import { UtilityOperations } from './modules/utility-operations';
import { SourceContentOperations } from './modules/source-content-operations';

// Type for PGLite transaction object
interface PGTransaction {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

// Re-export DatabaseError for compatibility
export { DatabaseError };

/**
 * Refactored PGLite storage adapter that uses modular operations
 */
export class PGLiteStorageAdapter implements StorageAdapter {
  private db: PGlite;
  // private kysely!: Kysely<any>; // Accessed through context
  private git: SimpleGit;
  private dbPath: string;
  private logger: { log: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void; debug: (msg: string) => void } | undefined;
  private isInitialized: boolean = false;

  // Operation modules
  private databaseCore: DatabaseCore;
  private snapshotOps: SnapshotOperations;
  private functionOps: FunctionOperations;
  private metricsOps: MetricsOperations;
  private embeddingOps: EmbeddingOperations;
  private callEdgeOps: CallEdgeOperations;
  private utilityOps: UtilityOperations;
  private sourceContentOps: SourceContentOperations;
  
  // Storage context shared by all modules
  private context: StorageContext;

  constructor(dbPath: string, logger?: { log: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void; debug: (msg: string) => void }) {
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
    this.embeddingOps = new EmbeddingOperations(this.context);
    this.callEdgeOps = new CallEdgeOperations(this.context);
    this.utilityOps = new UtilityOperations(this.context);
    this.sourceContentOps = new SourceContentOperations(this.context);
  }

  /**
   * Initialize the storage adapter
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await this.databaseCore.initialize();
      // Verify Kysely is initialized
      if (!this.context.kysely) {
        throw new Error('Kysely was not initialized properly by DatabaseCore');
      }
      // Reinitialize modules with the updated context
      this.sourceContentOps = new SourceContentOperations(this.context);
      this.functionOps = new FunctionOperations(this.context);
      this.snapshotOps = new SnapshotOperations(this.context);
      this.metricsOps = new MetricsOperations(this.context);
      this.embeddingOps = new EmbeddingOperations(this.context);
      this.callEdgeOps = new CallEdgeOperations(this.context);
      this.utilityOps = new UtilityOperations(this.context);
      
      this.isInitialized = true;
    } catch (error) {
      if (this.logger) {
        this.logger.error(`Storage initialization failed: ${error instanceof Error ? error.message : String(error)}`);
      }
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
      // Verify Kysely is initialized
      if (!this.context.kysely) {
        throw new Error('Kysely was not initialized properly by DatabaseCore');
      }
      // Reinitialize modules with the updated context
      this.sourceContentOps = new SourceContentOperations(this.context);
      this.functionOps = new FunctionOperations(this.context);
      this.snapshotOps = new SnapshotOperations(this.context);
      this.metricsOps = new MetricsOperations(this.context);
      this.embeddingOps = new EmbeddingOperations(this.context);
      this.callEdgeOps = new CallEdgeOperations(this.context);
      this.utilityOps = new UtilityOperations(this.context);
      
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
    
    // Execute snapshot creation and function saving within a single transaction
    // This ensures atomicity: either both operations succeed or both fail
    return await this.db.transaction(async (trx: PGTransaction) => {
      // 1. Create snapshot within transaction
      const snapshotId = await this.snapshotOps.createSnapshotInTransaction(trx, {
        ...(label && { label }),
        ...(comment && { comment }),
        ...(configHash && { configHash }),
      });

      // 2. Save functions within the same transaction
      await this.functionOps.saveFunctionsInTransaction(trx, snapshotId, functions);

      return snapshotId;
    }) as string;
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

  async diffSnapshots(fromId: string, toId: string): Promise<SnapshotDiff> {
    await this.ensureInitialized();
    
    // Get both snapshots
    const [fromSnapshot, toSnapshot] = await Promise.all([
      this.getSnapshot(fromId),
      this.getSnapshot(toId)
    ]);
    
    if (!fromSnapshot) {
      throw new Error(`Snapshot ${fromId} not found`);
    }
    if (!toSnapshot) {
      throw new Error(`Snapshot ${toId} not found`);
    }

    // Warn if comparing snapshots with different scopes
    if (fromSnapshot.scope !== toSnapshot.scope) {
      console.warn(`⚠️  Warning: Comparing snapshots with different scopes:`);
      console.warn(`   From: ${fromSnapshot.scope} (${fromSnapshot.metadata.totalFunctions} functions)`);
      console.warn(`   To: ${toSnapshot.scope} (${toSnapshot.metadata.totalFunctions} functions)`);
      console.warn(`   This comparison may not be meaningful.`);
    }
    
    // Get functions for both snapshots
    const [fromFunctions, toFunctions] = await Promise.all([
      this.getFunctionsBySnapshot(fromId),
      this.getFunctionsBySnapshot(toId)
    ]);
    
    // Create lookup maps
    const fromFuncMap = new Map(fromFunctions.map(f => [f.semanticId, f]));
    const toFuncMap = new Map(toFunctions.map(f => [f.semanticId, f]));
    
    // Calculate differences
    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];
    
    // Find added functions
    for (const func of toFunctions) {
      if (!fromFuncMap.has(func.semanticId)) {
        added.push(func.semanticId);
      }
    }
    
    // Find removed and modified functions
    for (const func of fromFunctions) {
      const toFunc = toFuncMap.get(func.semanticId);
      if (!toFunc) {
        removed.push(func.semanticId);
      } else if (func.contentId !== toFunc.contentId) {
        modified.push(func.semanticId);
      }
    }
    
    // Create FunctionChange objects for modified functions
    const modifiedChanges: FunctionChange[] = modified.map(semanticId => {
      const before = fromFuncMap.get(semanticId)!;
      const after = toFuncMap.get(semanticId)!;
      return {
        before,
        after,
        changes: [] // Simplified - detailed change detection would go here
      };
    });
    
    // Get actual FunctionInfo arrays for added/removed
    const addedFunctions = added.map(id => toFuncMap.get(id)!).filter(Boolean);
    const removedFunctions = removed.map(id => fromFuncMap.get(id)!).filter(Boolean);
    
    // Find unchanged functions
    const unchanged = fromFunctions.filter(func => 
      toFuncMap.has(func.semanticId) && 
      !modified.includes(func.semanticId)
    );
    
    return {
      from: fromSnapshot,
      to: toSnapshot,
      added: addedFunctions,
      removed: removedFunctions,
      modified: modifiedChanges,
      unchanged,
      statistics: {
        totalChanges: added.length + removed.length + modified.length,
        addedCount: added.length,
        removedCount: removed.length,
        modifiedCount: modified.length,
        complexityChange: 0, // Simplified - would need detailed calculation
        linesChange: 0 // Simplified - would need detailed calculation
      }
    };
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
    return this.sourceContentOps.extractFunctionSourceCode(functionId);
  }

  // ========================================
  // FUNCTION DESCRIPTIONS
  // ========================================

  async saveFunctionDescription(description: FunctionDescription): Promise<void> {
    await this.ensureInitialized();
    return this.functionOps.saveFunctionDescription({
      ...description,
      source: description.source || 'unknown',
      createdAt: description.createdAt ? new Date(description.createdAt) : new Date(),
      updatedAt: description.updatedAt ? new Date(description.updatedAt) : new Date()
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
    return this.metricsOps.saveNamingEvaluation(evaluation as unknown as Record<string, unknown>);
  }

  async getNamingEvaluation(functionId: string): Promise<NamingEvaluation | null> {
    await this.ensureInitialized();
    const result = await this.metricsOps.getNamingEvaluation(functionId);
    return result as unknown as NamingEvaluation | null;
  }

  async getFunctionsNeedingEvaluation(snapshotId: string, options?: QueryOptions): Promise<Array<{ functionId: string; functionName: string; lastModified: number }>> {
    await this.ensureInitialized();
    return this.metricsOps.getFunctionsNeedingEvaluation(snapshotId, options);
  }

  async getFunctionsWithEvaluations(snapshotId: string, options?: QueryOptions): Promise<Array<{ functionId: string; evaluation: NamingEvaluation }>> {
    await this.ensureInitialized();
    const result = await this.metricsOps.getFunctionsWithEvaluations(snapshotId, options);
    return result as unknown as Array<{ functionId: string; evaluation: NamingEvaluation }>;
  }

  async updateEvaluationRevisionStatus(functionId: string, revisionNeeded: boolean): Promise<void> {
    await this.ensureInitialized();
    return this.metricsOps.updateEvaluationRevisionStatus(functionId, revisionNeeded);
  }

  async batchSaveEvaluations(evaluations: NamingEvaluation[]): Promise<void> {
    await this.ensureInitialized();
    const mappedEvaluations = evaluations.map(e => ({
      functionId: e.functionId,
      rating: e.rating,
      issues: Array.isArray(e.issues) ? e.issues : [],
      suggestions: Array.isArray(e.suggestions) ? e.suggestions : [],
      createdAt: new Date(),
      updatedAt: new Date()
    }));
    return this.metricsOps.batchSaveEvaluations(mappedEvaluations);
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
  // SOURCE FILE OPERATIONS
  // ========================================

  async saveSourceFiles(sourceFiles: SourceFile[], snapshotId: string): Promise<Map<string, string>> {
    await this.ensureInitialized();
    
    // TODO: N:1 design implementation - for now use legacy approach
    const mappedFiles = sourceFiles.map(file => ({
      id: file.id || '',
      filePath: file.filePath,
      content: file.fileContent || '',
      hash: file.fileHash || '',
      encoding: file.encoding || 'utf-8',
      size: file.fileSizeBytes || 0,
      lineCount: file.lineCount || 0,
      language: file.language || 'typescript',
      functionCount: file.functionCount || 0,
      exportCount: file.exportCount || 0,
      importCount: file.importCount || 0,
      fileModifiedTime: file.fileModifiedTime || new Date(),
    }));
    return this.sourceContentOps.saveSourceFiles(mappedFiles, snapshotId);
  }

  async getSourceFile(id: string): Promise<SourceFile | null> {
    await this.ensureInitialized();
    const result = this.utilityOps.getSourceFile(id);
    return result as Promise<SourceFile | null>;
  }

  async getSourceFilesBySnapshot(snapshotId: string): Promise<SourceFile[]> {
    await this.ensureInitialized();
    const result = await this.sourceContentOps.getSourceFilesBySnapshot(snapshotId);
    return result as unknown as SourceFile[];
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
    return this.sourceContentOps.updateSourceFileFunctionCounts(functionCountByFile, snapshotId);
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
    const result = await this.callEdgeOps.getCallEdges({
      callerFunctionId,
      snapshotId
    });
    return result.map(edge => ({
      id: edge.id || '',
      callerFunctionId: edge.callerFunctionId,
      calleeFunctionId: edge.calleeFunctionId,
      calleeName: edge.calleeName,
      lineNumber: edge.lineNumber,
      columnNumber: edge.columnNumber,
      callType: edge.callType,
      isAsync: false,
      isChained: false,
      confidenceScore: 1.0,
      metadata: {},
      createdAt: new Date().toISOString()
    } as CallEdge));
  }

  async getCallEdgesByCallee(calleeFunctionId: string, snapshotId: string): Promise<CallEdge[]> {
    await this.ensureInitialized();
    const result = await this.callEdgeOps.getCallEdges({
      calleeFunctionId,
      snapshotId
    });
    return result.map(edge => ({
      id: edge.id || '',
      callerFunctionId: edge.callerFunctionId,
      calleeFunctionId: edge.calleeFunctionId,
      calleeName: edge.calleeName,
      lineNumber: edge.lineNumber,
      columnNumber: edge.columnNumber,
      callType: edge.callType,
      isAsync: false,
      isChained: false,
      confidenceScore: 1.0,
      metadata: {},
      createdAt: new Date().toISOString()
    } as CallEdge));
  }

  async getCallEdgesBySnapshot(snapshotId: string): Promise<CallEdge[]> {
    await this.ensureInitialized();
    const result = await this.callEdgeOps.getCallEdgesBySnapshot(snapshotId);
    return result.map(edge => ({
      id: edge.id || '',
      callerFunctionId: edge.callerFunctionId,
      calleeFunctionId: edge.calleeFunctionId,
      calleeName: edge.calleeName,
      lineNumber: edge.lineNumber,
      columnNumber: edge.columnNumber,
      callType: edge.callType,
      isAsync: edge.isAsync || false,
      isChained: edge.isChained || false,
      confidenceScore: edge.confidenceScore || 1.0,
      metadata: edge.metadata || {},  // Preserve metadata from database
      createdAt: edge.createdAt || new Date().toISOString()
    } as CallEdge));
  }

  async getInternalCallEdgesBySnapshot(snapshotId: string): Promise<InternalCallEdge[]> {
    await this.ensureInitialized();
    const result = await this.callEdgeOps.getInternalCallEdgesBySnapshot(snapshotId);
    return result.map(edge => ({
      id: edge.id || '',
      snapshotId,
      filePath: '',
      callerFunctionId: edge.callerFunctionId,
      calleeFunctionId: edge.calleeFunctionId || '',
      callerName: edge.callerFunctionId,
      calleeName: edge.calleeName,
      lineNumber: edge.lineNumber,
      columnNumber: edge.columnNumber,
      callType: edge.callType as 'direct' | 'conditional' | 'async' | 'dynamic',
      confidenceScore: 1.0,
      detectedBy: 'ast' as const,
      createdAt: new Date().toISOString()
    } as InternalCallEdge));
  }

  async deleteCallEdges(functionIds: string[]): Promise<void> {
    await this.ensureInitialized();
    // For now, we'll assume the first element is the snapshotId
    // In a more complete implementation, we'd need to look up the snapshot for each function
    if (functionIds.length > 0) {
      const snapshotId = functionIds[0]; // This is a simplified approach
      await this.callEdgeOps.deleteCallEdges(snapshotId);
    }
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
      id: edge.id || '',
      snapshotId,
      filePath: filePath,
      callerFunctionId: edge.callerFunctionId,
      calleeFunctionId: edge.calleeFunctionId || '',
      callerName: edge.callerFunctionId,
      calleeName: edge.calleeName,
      lineNumber: edge.lineNumber,
      columnNumber: edge.columnNumber,
      callType: edge.callType as 'direct' | 'conditional' | 'async' | 'dynamic',
      confidenceScore: 1.0,
      detectedBy: 'ast' as const,
      createdAt: new Date().toISOString()
    } as InternalCallEdge));
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
    return this.utilityOps.backup(options as unknown as Record<string, unknown>);
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
    // Use PGlite query method for parameterized queries
    if (params && params.length > 0) {
      return this.db.query(sql, params);
    } else {
      // Use exec for queries without parameters
      return this.db.exec(sql);
    }
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

      // Fetch function history using optimized JOIN query (eliminates N+1 problem)
      if (snapshots.length > 0) {
        const snapshotIds = snapshots.map(s => s.id);
        const query = `
          SELECT 
            s.id AS snapshot_id,
            s.label AS snapshot_label,
            s.created_at AS snapshot_created_at,
            f.id AS function_id,
            f.name,
            f.display_name,
            f.signature,
            f.file_path,
            f.start_line,
            f.end_line,
            f.is_exported,
            f.is_async,
            f.source_code,
            -- Quality metrics with LEFT JOIN
            qm.cyclomatic_complexity,
            qm.cognitive_complexity,
            qm.lines_of_code,
            qm.total_lines,
            -- Indicate presence
            CASE WHEN f.id IS NOT NULL THEN TRUE ELSE FALSE END AS is_present
          FROM snapshots s
          LEFT JOIN functions f ON s.id = f.snapshot_id 
            AND (f.id = $2 OR f.semantic_id = $2 OR f.id LIKE $3)
          LEFT JOIN quality_metrics qm ON f.id = qm.function_id
          WHERE s.id = ANY($1::text[])
          ORDER BY s.created_at DESC
        `;
        
        const result = await this.db.query(query, [
          snapshotIds,
          functionId,
          functionId.substring(0, 8) + '%' // Support partial IDs
        ]);
        
        if (this.logger) {
          this.logger.log(`getFunctionHistory optimized query returned ${result.rows.length} rows for functionId: ${functionId}`);
        }

        // Process results into the map (no additional queries needed!)
        for (const row of result.rows as Record<string, unknown>[]) {
          const snapshotId = row['snapshot_id'] as string;
          
          if (row['function_id']) {
            // Function exists in this snapshot - build FunctionInfo from the row
            const func: FunctionInfo = {
              id: row['function_id'] as string,
              semanticId: '', // Will be populated if needed
              contentId: '', // Will be populated if needed
              name: row['name'] as string,
              displayName: row['display_name'] as string,
              signature: row['signature'] as string,
              signatureHash: '',
              filePath: row['file_path'] as string,
              fileHash: '',
              startLine: row['start_line'] as number,
              endLine: row['end_line'] as number,
              startColumn: 0,
              endColumn: 0,
              positionId: '',
              astHash: '',
              contextPath: [],
              functionType: 'function',
              modifiers: [],
              nestingLevel: 0,
              isExported: row['is_exported'] as boolean,
              isAsync: row['is_async'] as boolean,
              isGenerator: false,
              isArrowFunction: false,
              isMethod: false,
              isConstructor: false,
              isStatic: false,
              sourceCode: row['source_code'] as string,
              parameters: [], // Could be populated with another JOIN if needed
              metrics: {
                cyclomaticComplexity: row['cyclomatic_complexity'] as number || 1,
                cognitiveComplexity: row['cognitive_complexity'] as number || 0,
                linesOfCode: row['lines_of_code'] as number || 0,
                totalLines: row['total_lines'] as number || 0,
                parameterCount: 0,
                maxNestingLevel: 0,
                returnStatementCount: 0,
                branchCount: 0,
                loopCount: 0,
                tryCatchCount: 0,
                asyncAwaitCount: 0,
                callbackCount: 0,
                commentLines: 0,
                codeToCommentRatio: 0,
                halsteadVolume: 0,
                halsteadDifficulty: 0,
                maintainabilityIndex: 0
              }
            };
            functionPresenceMap.set(snapshotId, func);
          } else {
            // Function doesn't exist in this snapshot
            functionPresenceMap.set(snapshotId, null);
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
      const lastSeparator = Math.max(dbPath.lastIndexOf('\\'), dbPath.lastIndexOf('/'));
      if (lastSeparator > 0) {
        const dirPath = dbPath.substring(0, lastSeparator);
        // Note: Directory existence check would be implemented here in a production environment
        // For now, we validate the path format but don't check filesystem access
        // This avoids adding fs dependencies in environments where it might not be available
        if (this.logger) {
          this.logger.log(`Database will be created at: ${dirPath}`);
        }
      }
    }
  }

  // Utility method for snapshot ID generation (if needed in future)
  // private generateSnapshotId(): string {
  //   return uuidv4();
  // }
}
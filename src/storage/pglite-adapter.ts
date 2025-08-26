/**
 * Refactored PGLite Storage Adapter
 * 
 * This is the main adapter that delegates to specialized modules
 * while maintaining backward compatibility with the existing interface
 */

import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { createDefaultGitProvider, GitProvider } from '../utils/git/index.js';
import * as path from 'path';
import * as fs from 'fs';
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
  TypeDefinition,
  TypeRelationship,
  TypeMember,
  MethodOverride,
} from '../types';
import { DatabaseError } from './errors/database-error';
import { ErrorCode } from '../utils/error-handler';
import { StorageContext } from './modules/types';

// Re-export StorageContext for external modules
export type { StorageContext };
import { DatabaseCore } from './modules/database-core';
import { SnapshotOperations } from './modules/snapshot-operations';
import { FunctionOperations } from './modules/function-operations';
import { MetricsOperations } from './modules/metrics-operations';
import { CallEdgeOperations } from './modules/call-edge-operations';
import { UtilityOperations } from './modules/utility-operations';
import { SourceContentOperations } from './modules/source-content-operations';
import { TypeSystemOperations } from './modules/type-system-operations';
import { GracefulShutdown } from '../utils/graceful-shutdown';
import { randomUUID } from 'crypto';

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
  private git: GitProvider;
  private dbPath: string;
  private logger: { log: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void; debug: (msg: string) => void } | undefined;
  private isInitialized: boolean = false;
  private isInitializing: boolean = false;
  private gracefulShutdown: GracefulShutdown;

  // Operation modules
  private databaseCore: DatabaseCore;
  private snapshotOps: SnapshotOperations;
  private functionOps: FunctionOperations;
  private metricsOps: MetricsOperations;
  private callEdgeOps: CallEdgeOperations;
  private utilityOps: UtilityOperations;
  private sourceContentOps: SourceContentOperations;
  private typeSystemOps: TypeSystemOperations;
  
  // Storage context shared by all modules
  private context: StorageContext;

  constructor(dbPath: string, logger?: { log: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void; debug: (msg: string) => void }) {
    this.validateDbPath(dbPath);
    this.logger = logger;
    // Store original path if needed later
    this.dbPath = path.resolve(dbPath);
    
    // Ensure parent directory exists for PGLite
    const parentDir = path.dirname(this.dbPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    
    this.db = new PGlite(dbPath);
    this.git = createDefaultGitProvider();
    this.gracefulShutdown = GracefulShutdown.getInstance();

    // Create storage context
    this.context = {
      db: this.db,
      kysely: null as unknown as Kysely<Database>, // Will be initialized in init()
      git: this.git,
      dbPath: this.dbPath,
      ...(this.logger && { logger: this.logger }),
    };

    // Initialize utility operations first and add to context
    this.utilityOps = new UtilityOperations(this.context);
    this.context.utilityOps = this.utilityOps;
    
    // Initialize other operation modules with context that includes utilityOps
    this.databaseCore = new DatabaseCore(this.context);
    this.snapshotOps = new SnapshotOperations(this.context);
    this.functionOps = new FunctionOperations(this.context);
    this.metricsOps = new MetricsOperations(this.context);
    this.callEdgeOps = new CallEdgeOperations(this.context);
    this.sourceContentOps = new SourceContentOperations(this.context);
    this.typeSystemOps = new TypeSystemOperations(this.context);
  }

  /**
   * Initialize the storage adapter
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;
    if (this.isInitializing) return; // Prevent recursive calls
    
    this.isInitializing = true;
    try {
      await this.databaseCore.initialize();
      // Verify Kysely is initialized
      if (!this.context.kysely) {
        throw new Error('Kysely was not initialized properly by DatabaseCore');
      }
      // Modules are already initialized in constructor with utilityOps in context
      // No need to reinitialize them here
      
      // Register this storage connection for graceful shutdown
      this.gracefulShutdown.registerStorageConnection(this);
      
      this.isInitialized = true;
    } catch (error) {
      this.isInitializing = false;
      if (this.logger) {
        this.logger.error(`Storage initialization failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to initialize storage adapter: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    } finally {
      this.isInitializing = false;
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
      this.utilityOps = new UtilityOperations(this.context);
      this.context.utilityOps = this.utilityOps; // Update context with new utilityOps
      
      this.sourceContentOps = new SourceContentOperations(this.context);
      this.functionOps = new FunctionOperations(this.context);
      this.snapshotOps = new SnapshotOperations(this.context);
      this.metricsOps = new MetricsOperations(this.context);
      this.callEdgeOps = new CallEdgeOperations(this.context);
      this.typeSystemOps = new TypeSystemOperations(this.context);
      
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
    // Unregister from graceful shutdown
    this.gracefulShutdown.unregisterStorageConnection(this);
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
    
    // Generate transaction ID for tracking
    const transactionId = randomUUID();
    const operation = `saveSnapshot(${functions.length} functions)`;
    
    // Execute snapshot creation and function saving within a single transaction
    // This ensures atomicity: either both operations succeed or both fail
    const transactionPromise = this.db.transaction(async (trx: PGTransaction) => {
      // 1. Create snapshot within transaction
      const snapshotId = await this.snapshotOps.createSnapshotInTransaction(trx, {
        ...(label && { label }),
        ...(comment && { comment }),
        ...(configHash && { configHash }),
      });

      // 2. Save functions within the same transaction
      await this.functionOps.saveFunctionsInTransaction(trx, snapshotId, functions);

      return snapshotId;
    }) as Promise<string>;
    
    // Track transaction for graceful shutdown protection
    return this.gracefulShutdown.trackTransaction(transactionId, operation, transactionPromise);
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

  async updateAnalysisLevel(snapshotId: string, level: import('../types').AnalysisLevel): Promise<void> {
    await this.ensureInitialized();
    return this.snapshotOps.updateAnalysisLevel(snapshotId, level);
  }

  /**
   * Update analysis level within a transaction
   */
  async updateAnalysisLevelInTransaction(trx: PGTransaction, snapshotId: string, level: import('../types').AnalysisLevel): Promise<void> {
    return this.snapshotOps.updateAnalysisLevelInTransaction(trx, snapshotId, level);
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


  // New find methods with consistent naming
  async findFunction(functionId: string): Promise<FunctionInfo | null> {
    await this.ensureInitialized();
    return this.functionOps.findFunction(functionId);
  }

  async findFunctionsInSnapshot(snapshotId: string, options?: QueryOptions): Promise<FunctionInfo[]> {
    await this.ensureInitialized();
    return this.functionOps.findFunctionsInSnapshot(snapshotId, options);
  }

  async findFunctions(options?: QueryOptions): Promise<FunctionInfo[]> {
    await this.ensureInitialized();
    return this.functionOps.findFunctions(options);
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
      this.findFunctionsInSnapshot(fromId),
      this.findFunctionsInSnapshot(toId)
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

  /**
   * Save source files within a transaction for atomic operations
   */
  async saveSourceFilesInTransaction(trx: PGTransaction, sourceFiles: SourceFile[], snapshotId: string): Promise<Map<string, string>> {
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
    return this.sourceContentOps.saveSourceFilesInTransaction(trx, mappedFiles, snapshotId);
  }

  async getSourceFile(id: string): Promise<SourceFile | null> {
    await this.ensureInitialized();
    const result = this.utilityOps.getSourceFile(id);
    return result as Promise<SourceFile | null>;
  }

  async getSourceFilesBySnapshot(snapshotId: string): Promise<SourceFile[]> {
    await this.ensureInitialized();
    const result = await this.utilityOps.getSourceFilesBySnapshot(snapshotId);
    return result as unknown as SourceFile[];
  }

  async getSnapshotContentsForAnalysis(snapshotId: string): Promise<Array<{
    filePath: string;
    content: string;
    contentId: string;
    refId: string;
    fileHash: string;
    fileSizeBytes: number;
    lineCount: number;
    encoding: string;
  }>> {
    await this.ensureInitialized();
    return this.sourceContentOps.getSnapshotContentsForAnalysis(snapshotId);
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

  /**
   * Insert call edges within a transaction for atomic operations
   */
  async insertCallEdgesInTransaction(trx: PGTransaction, edges: CallEdge[], snapshotId: string): Promise<void> {
    return this.callEdgeOps.insertCallEdgesInTransaction(trx, snapshotId, edges);
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
    if (edges.length === 0) return;

    // Derive snapshotId from edges and delegate to operations module (JSON bulk insert)
    const snapshotId = edges[0]?.snapshotId;
    if (!snapshotId) {
      throw new DatabaseError(ErrorCode.STORAGE_WRITE_ERROR, 'insertInternalCallEdges: snapshotId missing in edges');
    }

    // Convert InternalCallEdge to CallEdge format for compatibility with call-edge-operations
    const callEdges: CallEdge[] = edges.map(edge => ({
      id: edge.id,
      callerFunctionId: edge.callerFunctionId,
      calleeFunctionId: edge.calleeFunctionId,
      calleeName: edge.calleeName,
      calleeSignature: edge.calleeName, // Use name as signature for internal calls
      callType: edge.callType,
      callContext: edge.callContext || 'normal',
      lineNumber: edge.lineNumber,
      columnNumber: edge.columnNumber,
      isAsync: false, // Internal calls are not async by default
      isChained: false, // Internal calls are not chained by default
      confidenceScore: edge.confidenceScore,
      metadata: { 
        detectedBy: edge.detectedBy,
        filePath: edge.filePath,
        callerName: edge.callerName,
        calleeName: edge.calleeName
      },
      createdAt: edge.createdAt || new Date().toISOString()
    }));

    // Use CallEdgeOperations which performs JSONB bulk insert via jsonb_to_recordset for PGlite compatibility
    await this.callEdgeOps.insertInternalCallEdges(snapshotId, callEdges);
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

  async getInternalCalleesByFunction(callerFunctionId: string, snapshotId: string): Promise<string[]> {
    await this.ensureInitialized();
    return this.callEdgeOps.getInternalCalleesByFunction(callerFunctionId, snapshotId);
  }

  async isInternalFunctionCalled(calleeFunctionId: string, _snapshotId: string): Promise<boolean> {
    await this.ensureInitialized();
    // The module method doesn't take snapshotId
    return this.callEdgeOps.isInternalFunctionCalled(calleeFunctionId);
  }

  // ========================================
  // TRANSACTION OPERATIONS
  // ========================================

  /**
   * Execute a complete scan workflow within a single transaction
   * This ensures atomicity: either all operations succeed or all fail
   */
  async executeScanWorkflowInTransaction(workflow: {
    sourceFiles?: SourceFile[];
    functions?: FunctionInfo[];
    callEdges?: CallEdge[];
    internalCallEdges?: InternalCallEdge[];
    analysisLevel?: 'NONE' | 'BASIC' | 'CALL_GRAPH';
    snapshotOptions: {
      label?: string;
      comment?: string;
      configHash?: string;
      scope?: string;
    };
  }): Promise<{
    snapshotId: string;
    sourceFileIdMap?: Map<string, string>;
  }> {
    await this.ensureInitialized();
    
    // Generate transaction ID for tracking
    const transactionId = randomUUID();
    const operation = `scanWorkflow(${workflow.functions?.length || 0} functions, ${workflow.sourceFiles?.length || 0} files)`;
    
    // Check if shutdown is in progress
    if (this.gracefulShutdown.isShutdownInProgress()) {
      throw new Error('Cannot start new transaction: shutdown in progress');
    }
    
    const transactionPromise = this.db.transaction(async (trx: PGTransaction) => {
      // 1. Create snapshot
      const snapshotId = await this.snapshotOps.createSnapshotInTransaction(trx, workflow.snapshotOptions);
      
      let sourceFileIdMap: Map<string, string> | undefined;
      
      // 2. Save source files if provided
      if (workflow.sourceFiles && workflow.sourceFiles.length > 0) {
        sourceFileIdMap = await this.saveSourceFilesInTransaction(trx, workflow.sourceFiles, snapshotId);
      }
      
      // 3. Save functions if provided
      if (workflow.functions && workflow.functions.length > 0) {
        await this.functionOps.saveFunctionsInTransaction(trx, snapshotId, workflow.functions);
      }
      
      // 4. Save call edges if provided
      if (workflow.callEdges && workflow.callEdges.length > 0) {
        await this.insertCallEdgesInTransaction(trx, workflow.callEdges, snapshotId);
      }
      
      // 5. Save internal call edges if provided
      if (workflow.internalCallEdges && workflow.internalCallEdges.length > 0) {
        await this.insertInternalCallEdgesInTransaction(trx, workflow.internalCallEdges, snapshotId);
      }
      
      // 6. Update analysis level if provided
      if (workflow.analysisLevel) {
        await this.updateAnalysisLevelInTransaction(trx, snapshotId, workflow.analysisLevel);
      }
      
      return { snapshotId, sourceFileIdMap };
    }) as Promise<{ snapshotId: string; sourceFileIdMap?: Map<string, string> }>;
    
    // Track transaction for graceful shutdown protection
    return this.gracefulShutdown.trackTransaction(transactionId, operation, transactionPromise);
  }

  /**
   * Insert internal call edges within a transaction
   */
  async insertInternalCallEdgesInTransaction(trx: PGTransaction, edges: InternalCallEdge[], snapshotId: string): Promise<void> {
    if (edges.length === 0) return;
    
    // Prepare batch insert values
    const values = edges.map(edge => [
      edge.id,
      edge.snapshotId || snapshotId,
      edge.filePath,
      edge.callerFunctionId,
      edge.calleeFunctionId,
      edge.callerName,
      edge.calleeName,
      edge.callerClassName || null,
      edge.calleeClassName || null,
      edge.lineNumber,
      edge.columnNumber,
      edge.callType,
      edge.callContext || null,
      edge.confidenceScore,
      edge.detectedBy,
      edge.createdAt || new Date().toISOString()
    ]);
    
    // Batch insert using unnest for better performance
    const query = `
      INSERT INTO internal_call_edges (
        id, snapshot_id, file_path, caller_function_id, callee_function_id,
        caller_name, callee_name, caller_class_name, callee_class_name,
        line_number, column_number, call_type, call_context, 
        confidence_score, detected_by, created_at
      ) 
      SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
                          $6::text[], $7::text[], $8::text[], $9::text[],
                          $10::int[], $11::int[], $12::text[], $13::text[],
                          $14::float[], $15::text[], $16::timestamptz[])
    `;
    
    await trx.query(query, [
      values.map(v => v[0]),  // ids
      values.map(v => v[1]),  // snapshot_ids
      values.map(v => v[2]),  // file_paths
      values.map(v => v[3]),  // caller_function_ids
      values.map(v => v[4]),  // callee_function_ids
      values.map(v => v[5]),  // caller_names
      values.map(v => v[6]),  // callee_names
      values.map(v => v[7]),  // caller_class_names
      values.map(v => v[8]),  // callee_class_names
      values.map(v => v[9]),  // line_numbers
      values.map(v => v[10]), // column_numbers
      values.map(v => v[11]), // call_types
      values.map(v => v[12]), // call_contexts
      values.map(v => v[13]), // confidence_scores
      values.map(v => v[14]), // detected_by
      values.map(v => v[15])  // created_at
    ]);
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

  // Type system operations
  async saveTypeDefinitions(types: TypeDefinition[]): Promise<void> {
    await this.ensureInitialized();
    return this.typeSystemOps.saveTypeDefinitions(types);
  }

  async saveTypeRelationships(relationships: TypeRelationship[]): Promise<void> {
    await this.ensureInitialized();
    return this.typeSystemOps.saveTypeRelationships(relationships);
  }

  async saveTypeMembers(members: TypeMember[]): Promise<void> {
    await this.ensureInitialized();
    return this.typeSystemOps.saveTypeMembers(members);
  }

  async saveMethodOverrides(overrides: MethodOverride[]): Promise<void> {
    await this.ensureInitialized();
    return this.typeSystemOps.saveMethodOverrides(overrides);
  }

  async saveAllTypeInformation(
    typeInfo: {
      typeDefinitions: TypeDefinition[];
      typeRelationships: TypeRelationship[];
      typeMembers: TypeMember[];
      methodOverrides: MethodOverride[];
    }
  ): Promise<void> {
    await this.ensureInitialized();
    return this.typeSystemOps.saveAllTypeInformation(typeInfo);
  }

  async getTypeDefinitions(snapshotId: string): Promise<TypeDefinition[]> {
    await this.ensureInitialized();
    return this.typeSystemOps.getTypeDefinitions(snapshotId);
  }

  async getTypeRelationships(snapshotId: string): Promise<TypeRelationship[]> {
    await this.ensureInitialized();
    return this.typeSystemOps.getTypeRelationships(snapshotId);
  }

  async getTypeMembers(typeId: string): Promise<TypeMember[]> {
    await this.ensureInitialized();
    return this.typeSystemOps.getTypeMembers(typeId);
  }

  async getMethodOverrides(snapshotId: string): Promise<MethodOverride[]> {
    await this.ensureInitialized();
    return this.typeSystemOps.getMethodOverrides(snapshotId);
  }

  async findTypeByName(name: string, snapshotId: string): Promise<TypeDefinition | null> {
    await this.ensureInitialized();
    return this.typeSystemOps.findTypeByName(name, snapshotId);
  }

  async getImplementingClasses(interfaceId: string): Promise<TypeDefinition[]> {
    await this.ensureInitialized();
    return this.typeSystemOps.getImplementingClasses(interfaceId);
  }

  async getMethodOverridesByFunction(functionId: string): Promise<MethodOverride[]> {
    await this.ensureInitialized();
    return this.typeSystemOps.getMethodOverridesByFunction(functionId);
  }

  // ========================================
  // LEGACY COMPATIBILITY METHODS
  // ========================================

  getDb(): PGlite {
    return this.db;
  }

  // Compatibility methods that may be used internally
  async query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> {
    await this.ensureInitialized();
    // Always use query method for consistency (PGLite handles both parameterized and non-parameterized queries)
    return this.db.query(sql, params || []);
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
      const snapshots = await this.getSnapshots({ limit });
      
      if (this.logger) {
        this.logger.log(`getFunctionHistory: Found ${snapshots.length} snapshots for functionId: ${functionId}`);
      }

      if (snapshots.length === 0) {
        return [];
      }

      const functionPresenceMap = await this.buildFunctionPresenceMap(snapshots, functionId);
      const history = this.buildFunctionHistory(snapshots, functionPresenceMap);

      return includeAbsent ? history : history.filter(h => h.isPresent);
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to get function history: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private async buildFunctionPresenceMap(
    snapshots: SnapshotInfo[],
    functionId: string
  ): Promise<Map<string, FunctionInfo | null>> {
    const snapshotIds = snapshots.map(s => s.id);
    const query = this.buildFunctionHistoryQuery();
    
    const result = await this.db.query(query, [
      snapshotIds,
      functionId,
      functionId.substring(0, 8) + '%' // Support partial IDs
    ]);
    
    if (this.logger) {
      this.logger.log(`getFunctionHistory optimized query returned ${result.rows.length} rows for functionId: ${functionId}`);
    }

    return this.mapQueryResultsToFunctionMap(result.rows as Record<string, unknown>[]);
  }

  private buildFunctionHistoryQuery(): string {
    return `
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
  }

  private mapQueryResultsToFunctionMap(
    rows: Record<string, unknown>[]
  ): Map<string, FunctionInfo | null> {
    const functionPresenceMap = new Map<string, FunctionInfo | null>();

    for (const row of rows) {
      const snapshotId = row['snapshot_id'] as string;
      
      if (row['function_id']) {
        const func = this.buildFunctionInfoFromRow(row);
        functionPresenceMap.set(snapshotId, func);
      } else {
        functionPresenceMap.set(snapshotId, null);
      }
    }

    return functionPresenceMap;
  }

  private buildFunctionInfoFromRow(row: Record<string, unknown>): FunctionInfo {
    return {
      id: row['function_id'] as string,
      snapshotId: row['snapshot_id'] as string || 'unknown',
      semanticId: '',
      contentId: '',
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
      parameters: [],
      metrics: {
        cyclomaticComplexity: row['cyclomatic_complexity'] as number || 1,
        cognitiveComplexity: row['cognitive_complexity'] as number || 0,
        linesOfCode: row['lines_of_code'] as number || 0,
        totalLines: row['total_lines'] as number || 0,
        parameterCount: row['parameter_count'] as number || 0,
        maxNestingLevel: row['max_nesting_level'] as number || 0,
        returnStatementCount: row['return_statement_count'] as number || 0,
        branchCount: row['branch_count'] as number || 0,
        loopCount: row['loop_count'] as number || 0,
        tryCatchCount: row['try_catch_count'] as number || 0,
        asyncAwaitCount: row['async_await_count'] as number || 0,
        callbackCount: row['callback_count'] as number || 0,
        commentLines: row['comment_lines'] as number || 0,
        codeToCommentRatio: row['code_to_comment_ratio'] as number || 0,
        halsteadVolume: row['halstead_volume'] as number || 0,
        halsteadDifficulty: row['halstead_difficulty'] as number || 0,
        maintainabilityIndex: row['maintainability_index'] as number || 0
      }
    };
  }

  private buildFunctionHistory(
    snapshots: SnapshotInfo[],
    functionPresenceMap: Map<string, FunctionInfo | null>
  ): Array<{
    snapshot: SnapshotInfo;
    function: FunctionInfo | null;
    isPresent: boolean;
  }> {
    return snapshots.map(snapshot => {
      const func = functionPresenceMap.get(snapshot.id) || null;
      const isPresent = func !== null;

      return {
        snapshot,
        function: func,
        isPresent
      };
    });
  }


  // ========================================
  // PRIVATE HELPER METHODS
  // ========================================

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      // Prevent recursive initialization
      if (this.isInitializing) {
        throw new DatabaseError(
          ErrorCode.STORAGE_ERROR,
          'Recursive initialization detected'
        );
      }
      await this.init();
    }
  }

  private validateDbPath(dbPath: string): void {
    if (dbPath === null || dbPath === undefined || typeof dbPath !== 'string' || !dbPath.trim()) {
      throw new DatabaseError(
        ErrorCode.INVALID_CONFIG,
        'Database path must be a non-empty string'
      );
    }

    // Check for dangerous root paths
    if (dbPath === '/' || dbPath === '//' || dbPath === '') {
      throw new DatabaseError(
        ErrorCode.INVALID_CONFIG,
        'Root directory is not a valid database path. Use a specific directory like /tmp/funcqc/data'
      );
    }

    // Check for single drive letter (Windows) - only when actually on Windows
    if (process.platform === 'win32' && /^[A-Z]:$/i.test(dbPath)) {
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

  // Coupling analysis operations
  async storeParameterPropertyUsage(
    couplingData: import('../types').ParameterPropertyUsageData[],
    snapshotId: string
  ): Promise<void> {
    await this.ensureInitialized();
    if (couplingData.length === 0) return;
    try {
      await this.db.transaction(async (trx: unknown) => {
        const BATCH = 1000; // パラメータ上限対策
        for (let i = 0; i < couplingData.length; i += BATCH) {
          const slice = couplingData.slice(i, i + BATCH);
          const sql = `
            INSERT INTO parameter_property_usage (
              snapshot_id, function_id, parameter_name, parameter_type_id,
              accessed_property, access_type, access_line, access_context
            )
            SELECT * FROM unnest(
              $1::text[], $2::text[], $3::text[], $4::text[],
              $5::text[], $6::text[], $7::int[],  $8::text[]
            )
          `;
          await (trx as { query: (sql: string, params: unknown[]) => Promise<unknown> }).query(sql, [
            slice.map(() => snapshotId),
            slice.map(v => v.functionId),
            slice.map(v => v.parameterName),
            slice.map(v => v.parameterTypeId),
            slice.map(v => v.accessedProperty),
            slice.map(v => v.accessType),
            slice.map(v => v.accessLine),
            slice.map(v => v.accessContext),
          ]);
        }
      });
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.STORAGE_ERROR,
        `Failed to store parameter property usage data: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  // Utility method for snapshot ID generation (if needed in future)
  // private generateSnapshotId(): string {
  //   return uuidv4();
  // }
}
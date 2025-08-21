/**
 * Source content operations module for N:1 design
 * Handles deduplicated file content storage and references
 */

import { randomUUID } from 'crypto';
import { StorageOperationModule } from './types';
import { BaseStorageOperations } from '../shared/base-storage-operations';
import type { StorageContext } from './types';

// Type for PGLite transaction object
interface PGTransaction {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export class SourceContentOperations extends BaseStorageOperations implements StorageOperationModule {
  constructor(context: StorageContext) {
    super(context);
  }

  /**
   * Validate input and initialize result map
   */
  private validateAndInitialize(sourceFiles: Array<{
    id: string;
    filePath: string;
    content: string;
    hash: string;
    encoding?: string;
    size: number;
    lineCount?: number;
    language?: string;
    functionCount: number;
    exportCount?: number;
    importCount?: number;
    fileModifiedTime?: Date;
    createdAt?: Date;
  }>): { shouldReturn: boolean; resultMap: Map<string, string> } {
    const resultMap = new Map<string, string>();
    
    if (sourceFiles.length === 0) {
      return { shouldReturn: true, resultMap };
    }
    
    return { shouldReturn: false, resultMap };
  }

  /**
   * Generate content ID from hash and size
   */
  private generateContentId(hash: string, size: number): string {
    return `${hash}_${size}`;
  }

  /**
   * Build content values for source_contents table
   */
  private buildContentValues(contentId: string, file: {
    content: string;
    hash: string;
    size: number;
    lineCount?: number;
    language?: string;
    encoding?: string;
    exportCount?: number;
    importCount?: number;
  }): {
    id: string;
    content: string;
    file_hash: string;
    file_size_bytes: number;
    line_count: number;
    language: string;
    encoding: string;
    export_count: number;
    import_count: number;
    created_at: string;
  } {
    return {
      id: contentId,
      content: file.content,
      file_hash: file.hash,
      file_size_bytes: file.size,
      line_count: file.lineCount || 0,
      language: file.language || 'typescript',
      encoding: file.encoding || 'utf-8',
      export_count: file.exportCount || 0,
      import_count: file.importCount || 0,
      created_at: new Date().toISOString()
    };
  }

  /**
   * Insert content using Kysely
   */
  private async insertContentWithKysely(contentId: string, file: {
    content: string;
    hash: string;
    size: number;
    lineCount?: number;
    language?: string;
    encoding?: string;
    exportCount?: number;
    importCount?: number;
  }): Promise<void> {
    if (!this.kysely) {
      throw new Error(`Kysely instance is not initialized. Context: ${JSON.stringify({
        hasDb: !!this.db,
        hasKysely: !!this.kysely,
        contextKeys: Object.keys(this)
      })}`);
    }
    
    const values = this.buildContentValues(contentId, file);
    await this.kysely
      .insertInto('source_contents')
      .values(values)
      .onConflict(oc => oc.columns(['file_hash', 'file_size_bytes']).doNothing())
      .execute();
  }

  /**
   * Insert content using transaction
   */
  private async insertContentWithTransaction(
    trx: PGTransaction,
    contentId: string,
    file: {
      content: string;
      hash: string;
      size: number;
      lineCount?: number;
      language?: string;
      encoding?: string;
      exportCount?: number;
      importCount?: number;
    }
  ): Promise<void> {
    const values = this.buildContentValues(contentId, file);
    await trx.query(
      `INSERT INTO source_contents (
        id, content, file_hash, file_size_bytes, line_count, language, 
        encoding, export_count, import_count, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (file_hash, file_size_bytes) DO NOTHING`,
      [
        values.id,
        values.content,
        values.file_hash,
        values.file_size_bytes,
        values.line_count,
        values.language,
        values.encoding,
        values.export_count,
        values.import_count,
        values.created_at
      ]
    );
  }

  /**
   * Ensure content exists in source_contents table (deduplicated)
   */
  private async ensureContentExists(
    executor: 'kysely' | 'transaction',
    contentId: string,
    file: {
      content: string;
      hash: string;
      size: number;
      lineCount?: number;
      language?: string;
      encoding?: string;
      exportCount?: number;
      importCount?: number;
      filePath: string;
    },
    trx?: PGTransaction
  ): Promise<void> {
    if (executor === 'transaction' && !trx) {
      throw new Error('Transaction executor requires trx parameter');
    }
    
    try {
      if (executor === 'kysely') {
        await this.insertContentWithKysely(contentId, file);
      } else if (executor === 'transaction' && trx) {
        await this.insertContentWithTransaction(trx, contentId, file);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // 重複エラーは期待される動作なのでdebugレベル、その他はwarningレベル
      if (errorMessage.includes('duplicate') || errorMessage.includes('conflict')) {
        this.logger?.debug(`Content already exists for ${file.filePath}: ${contentId}`);
      } else {
        this.logger?.warn(`Unexpected error during content insertion for ${file.filePath}: ${errorMessage}`);
      }
    }
  }

  /**
   * Create file reference in source_file_refs table
   */
  private async createFileReference(
    executor: 'kysely' | 'transaction',
    file: {
      filePath: string;
      functionCount: number;
      fileModifiedTime?: Date;
    },
    contentId: string,
    snapshotId: string,
    trx?: PGTransaction
  ): Promise<string> {
    if (executor === 'transaction' && !trx) {
      throw new Error('Transaction executor requires trx parameter');
    }
    
    const refId = randomUUID();
    
    if (executor === 'kysely') {
      if (!this.kysely) {
        throw new Error('Kysely instance is not initialized');
      }
      
      await this.kysely
        .insertInto('source_file_refs')
        .values({
          id: refId,
          snapshot_id: snapshotId,
          file_path: file.filePath,
          content_id: contentId,
          file_modified_time: file.fileModifiedTime?.toISOString() || null,
          function_count: file.functionCount || 0,
          created_at: new Date().toISOString()
        })
        .execute();
    } else if (executor === 'transaction' && trx) {
      await trx.query(
        `INSERT INTO source_file_refs (
          id, snapshot_id, file_path, content_id, file_modified_time, function_count, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          refId,
          snapshotId,
          file.filePath,
          contentId,
          file.fileModifiedTime?.toISOString() || null,
          file.functionCount || 0,
          new Date().toISOString()
        ]
      );
    }

    return refId;
  }

  /**
   * Common helper for saving source files that works with both Kysely and PGTransaction
   */
  private async saveSourceFilesInternal(
    executor: 'kysely' | 'transaction',
    sourceFiles: Array<{
      id: string;
      filePath: string;
      content: string;
      hash: string;
      encoding?: string;
      size: number;
      lineCount?: number;
      language?: string;
      functionCount: number;
      exportCount?: number;
      importCount?: number;
      fileModifiedTime?: Date;
      createdAt?: Date;
    }>,
    snapshotId: string,
    trx?: PGTransaction
  ): Promise<Map<string, string>> {
    // Step 1: Validate input and initialize
    const { shouldReturn, resultMap } = this.validateAndInitialize(sourceFiles);
    if (shouldReturn) {
      return resultMap;
    }

    // Step 2: Process each file
    for (const file of sourceFiles) {
      // Step 2.1: Generate content ID
      const contentId = this.generateContentId(file.hash, file.size);
      
      // Step 2.2: Ensure content exists (deduplicated)
      await this.ensureContentExists(executor, contentId, file, trx);

      // Step 2.3: Create file reference
      const refId = await this.createFileReference(
        executor,
        file,
        contentId,
        snapshotId,
        trx
      );

      resultMap.set(file.filePath, refId);
    }

    return resultMap;
  }

  /**
   * Save source files using N:1 design
   */
  async saveSourceFiles(sourceFiles: Array<{
    id: string;
    filePath: string;
    content: string;
    hash: string;
    encoding?: string;
    size: number;
    lineCount?: number;
    language?: string;
    functionCount: number;
    exportCount?: number;
    importCount?: number;
    fileModifiedTime?: Date;
    createdAt?: Date;
  }>, snapshotId: string): Promise<Map<string, string>> {
    return this.saveSourceFilesInternal('kysely', sourceFiles, snapshotId);
  }

  /**
   * Save source files within a transaction for atomic operations
   */
  async saveSourceFilesInTransaction(trx: PGTransaction, sourceFiles: Array<{
    id: string;
    filePath: string;
    content: string;
    hash: string;
    encoding?: string;
    size: number;
    lineCount?: number;
    language?: string;
    functionCount: number;
    exportCount?: number;
    importCount?: number;
    fileModifiedTime?: Date;
    createdAt?: Date;
  }>, snapshotId: string): Promise<Map<string, string>> {
    return this.saveSourceFilesInternal('transaction', sourceFiles, snapshotId, trx);
  }

  /**
   * Get source files for a snapshot using N:1 design
   */
  async getSourceFilesBySnapshot(snapshotId: string): Promise<import('../../types').SourceFile[]> {
    const result = await this.kysely
      .selectFrom('source_file_refs')
      .innerJoin('source_contents', 'source_file_refs.content_id', 'source_contents.id')
      .select([
        'source_file_refs.id',
        'source_file_refs.snapshot_id',
        'source_file_refs.file_path',
        'source_file_refs.function_count',
        'source_file_refs.file_modified_time',
        'source_file_refs.created_at as ref_created_at',
        'source_contents.content as file_content',
        'source_contents.file_hash',
        'source_contents.file_size_bytes',
        'source_contents.line_count',
        'source_contents.language',
        'source_contents.encoding',
        'source_contents.export_count',
        'source_contents.import_count'
      ])
      .where('source_file_refs.snapshot_id', '=', snapshotId)
      .orderBy('source_file_refs.file_path')
      .execute();

    return result.map(row => ({
      id: row.id,
      snapshotId: row.snapshot_id,
      filePath: row.file_path,
      fileContent: row.file_content,
      fileHash: row.file_hash,
      encoding: row.encoding,
      fileSizeBytes: row.file_size_bytes,
      lineCount: row.line_count,
      language: row.language,
      functionCount: row.function_count,
      exportCount: row.export_count,
      importCount: row.import_count,
      fileModifiedTime: row.file_modified_time ? new Date(row.file_modified_time) : new Date(),
      createdAt: new Date(row.ref_created_at)
    }));
  }

  /**
   * Update function counts for file references
   */
  async updateSourceFileFunctionCounts(functionCountByFile: Map<string, number>, snapshotId: string): Promise<void> {
    for (const [filePath, count] of functionCountByFile.entries()) {
      await this.kysely
        .updateTable('source_file_refs')
        .set({ function_count: count })
        .where('file_path', '=', filePath)
        .where('snapshot_id', '=', snapshotId)
        .execute();
    }
  }

  /**
   * Extract function source code using N:1 design
   */
  async extractFunctionSourceCode(functionId: string): Promise<string | null> {
    try {
      const result = await this.kysely
        .selectFrom('functions')
        .innerJoin('source_file_refs', 'functions.source_file_ref_id', 'source_file_refs.id')
        .innerJoin('source_contents', 'source_file_refs.content_id', 'source_contents.id')
        .select([
          'functions.start_line',
          'functions.end_line', 
          'functions.start_column',
          'functions.end_column',
          'source_contents.content'
        ])
        .where('functions.id', '=', functionId)
        .executeTakeFirst();

      if (!result) {
        return null;
      }

      // Extract source code from content
      return this.extractSourceFromContent(
        result.content,
        result.start_line,
        result.end_line,
        result.start_column,
        result.end_column
      );
    } catch (error) {
      this.logger?.error(`Failed to extract function source code: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Extract source code from content based on position information
   */
  private extractSourceFromContent(
    content: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number
  ): string {
    const lines = content.split('\n');

    if (startLine < 1 || endLine > lines.length || startLine > endLine) {
      throw new Error(`Invalid line range: ${startLine}-${endLine} (file has ${lines.length} lines)`);
    }

    const startLineIndex = startLine - 1;
    const endLineIndex = endLine - 1;

    if (startColumn === 0 && endColumn === 0) {
      const result: string[] = [];
      for (let i = startLineIndex; i <= endLineIndex; i++) {
        if (i < lines.length) {
          result.push(lines[i]);
        }
      }
      return result.join('\n');
    }

    if (startLineIndex === endLineIndex) {
      const line = lines[startLineIndex];
      const startCol = Math.max(0, startColumn - 1);
      const endCol = endColumn > 0 ? endColumn - 1 : line.length;
      return line.substring(startCol, endCol);
    }

    const result: string[] = [];
    const startCol = Math.max(0, startColumn - 1);
    result.push(lines[startLineIndex].substring(startCol));

    for (let i = startLineIndex + 1; i < endLineIndex; i++) {
      result.push(lines[i]);
    }

    if (endLineIndex < lines.length) {
      const endCol = endColumn > 0 ? endColumn - 1 : lines[endLineIndex].length;
      result.push(lines[endLineIndex].substring(0, endCol));
    }

    return result.join('\n');
  }

  /**
   * Get snapshot contents optimized for virtual project analysis
   * Returns unified data structure for consistent function ID generation
   */
  async getSnapshotContentsForAnalysis(snapshotId: string): Promise<Array<{
    filePath: string;      // Normalized path (stored in DB)
    content: string;       // File content for virtual project
    contentId: string;     // Content ID for deduplication
    refId: string;         // Source file reference ID
  }>> {
    const result = await this.db.query(`
      SELECT 
        sfr.file_path,
        sc.content,
        sc.id as content_id,
        sfr.id as ref_id
      FROM source_file_refs sfr
      INNER JOIN source_contents sc ON sfr.content_id = sc.id
      WHERE sfr.snapshot_id = $1
      ORDER BY sfr.file_path
    `, [snapshotId]);

    return result.rows.map(row => {
      const r = row as {
        file_path: string;
        content: string;
        content_id: string;
        ref_id: string;
      };
      return {
        filePath: r.file_path,
        content: r.content,
        contentId: r.content_id,
        refId: r.ref_id
      };
    });
  }
}
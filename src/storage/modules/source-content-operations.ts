/**
 * Source content operations module for N:1 design
 * Handles deduplicated file content storage and references
 */

import { randomUUID } from 'crypto';
import { StorageContext, StorageOperationModule } from './types';

export class SourceContentOperations implements StorageOperationModule {
  readonly db;
  readonly kysely;
  private logger;

  constructor(context: StorageContext) {
    this.db = context.db;
    this.kysely = context.kysely;
    this.logger = context.logger;
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
    if (sourceFiles.length === 0) return new Map();

    const resultMap = new Map<string, string>();

    for (const file of sourceFiles) {
      // Step 1: Ensure content exists in source_contents (deduplicated)
      const contentId = `${file.hash}_${file.size}`;
      
      try {
        if (!this.kysely) {
          throw new Error(`Kysely instance is not initialized. Context: ${JSON.stringify({
            hasDb: !!this.db,
            hasKysely: !!this.kysely,
            contextKeys: Object.keys(this)
          })}`);
        }
        await this.kysely
          .insertInto('source_contents')
          .values({
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
          })
          .onConflict(oc => oc.columns(['file_hash', 'file_size_bytes']).doNothing())
          .execute();
      } catch {
        // Content already exists, which is fine for deduplication
        this.logger?.warn(`Content already exists for ${file.filePath}: ${contentId}`);
      }

      // Step 2: Create file reference for this snapshot
      const refId = randomUUID();
      
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

      resultMap.set(file.filePath, refId);
      this.logger?.log(`Created file reference: ${file.filePath} -> ${refId}`);
    }

    return resultMap;
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
}
import { TypeClusterOptions, isUuidOrPrefix, escapeLike } from '../../types.types';
import { TypeDefinition } from '../../../../types';
import { VoidCommand } from '../../../../types/command';
import { CommandEnvironment } from '../../../../types/environment';
import { createErrorHandler, ErrorCode, FuncqcError } from '../../../../utils/error-handler';

/**
 * Find type by ID or prefix
 */
async function findTypeById(
  storage: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
  idOrPrefix: string,
  snapshotId: string
): Promise<TypeDefinition | null> {
  // Support partial ID matching (e.g., first 8 characters)
  // Escape wildcards to prevent unintended pattern matching
  const escapedPrefix = escapeLike(idOrPrefix);
  const result = await storage.query(
    `SELECT * FROM type_definitions 
     WHERE snapshot_id = $1 AND id LIKE $2 || '%' ESCAPE '\\'
     ORDER BY id ASC
     LIMIT 1`,
    [snapshotId, escapedPrefix]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const row = result.rows[0] as {
    id: string;
    snapshot_id: string;
    name: string;
    kind: string;
    file_path: string;
    start_line: number;
    end_line: number;
    start_column: number;
    end_column: number;
    is_exported: boolean;
    is_generic: boolean;
    metadata: Record<string, unknown>;
  };
  
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    filePath: row.file_path,
    startLine: row.start_line,
    endLine: row.end_line,
    startColumn: row.start_column,
    endColumn: row.end_column,
    isExported: row.is_exported,
    isGeneric: row.is_generic,
    metadata: row.metadata as Record<string, unknown>
  };
}

/**
 * Execute types cluster command using database
 */
export const executeTypesClusterDB: VoidCommand<TypeClusterOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      const typeNameOrId = (options as { typeName?: string }).typeName || '';
      
      env.commandLogger.info(`🎪 Analyzing property clustering for type: ${typeNameOrId}`);
      
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run scan first to analyze the codebase.');
      }
      const latestSnapshot = snapshots[0];
      
      // Try to find by ID first (if looks like UUID), then by name
      let targetType: TypeDefinition | null = null;
      if (isUuidOrPrefix(typeNameOrId)) {
        // Looks like a UUID or UUID prefix
        targetType = await findTypeById(env.storage, typeNameOrId, latestSnapshot.id);
      }
      if (!targetType) {
        targetType = await env.storage.findTypeByName(typeNameOrId, latestSnapshot.id);
      }
    
      if (!targetType) {
        const funcqcError = errorHandler.createError(
          ErrorCode.NOT_FOUND,
          `Type '${typeNameOrId}' not found (searched by ID and name)`,
          { typeNameOrId }
        );
        throw funcqcError;
      }
      
      // Import and use the clustering analyzer
      const { PropertyClusteringAnalyzer } = await import('../../../../analyzers/type-insights/property-clustering');
      const analyzer = new PropertyClusteringAnalyzer(env.storage);
      
      // Set options if provided
      if (options.similarityThreshold !== undefined) {
        analyzer.setSimilarityThreshold(options.similarityThreshold);
      }
      if (options.minClusterSize !== undefined) {
        analyzer.setMinClusterSize(options.minClusterSize);
      }
      
      const analysis = await analyzer.analyzePropertyClustering(
        targetType.id,
        latestSnapshot.id
      );
      
      if (!analysis) {
        console.log(`⚠️  No clustering analysis available for type ${targetType.name}`);
        return;
      }
      
      if (options.json) {
        console.log(JSON.stringify(analysis, (_key, value) => {
          // Convert Set objects to arrays for JSON serialization
          if (value instanceof Set) {
            return Array.from(value);
          }
          return value;
        }, 2));
      } else {
        console.log(analyzer.formatClusteringAnalysis(analysis));
      }
      
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as FuncqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze property clustering: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };
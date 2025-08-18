import { TypeApiOptions, isUuidOrPrefix, escapeLike } from '../../types.types';
import { TypeDefinition } from '../../../../types';
import { VoidCommand } from '../../../../types/command';
import { CommandEnvironment } from '../../../../types/environment';
import { createErrorHandler, ErrorCode, FuncqcError } from '../../../../utils/error-handler';
import { 
  getMemberCountsForTypes, 
  type MemberCounts
} from '../shared/list-operations';

/**
 * Type API analysis structure
 */
interface TypeApiAnalysis {
  surfaceArea: {
    methods: number;
    properties: number;
    constructors: number;
    indexSignatures: number;
    callSignatures: number;
    total: number;
  };
  complexity: {
    overloadDensity: number;
    apiComplexity: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  };
  recommendations: string[];
}

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
    kind: row.kind as "class" | "interface" | "type_alias" | "enum" | "namespace",
    filePath: row.file_path,
    startLine: row.start_line,
    endLine: row.end_line,
    startColumn: row.start_column,
    endColumn: row.end_column,
    isExported: row.is_exported,
    isGeneric: row.is_generic,
    metadata: row.metadata as Record<string, unknown>
  } as TypeDefinition;
}

/**
 * Analyze type API surface area and complexity
 */
function analyzeTypeApiSurface(_type: TypeDefinition, memberCount: MemberCounts): TypeApiAnalysis {
  const surfaceArea = {
    methods: memberCount.methods,
    properties: memberCount.properties,
    constructors: memberCount.constructors,
    indexSignatures: memberCount.indexSignatures,
    callSignatures: memberCount.callSignatures,
    total: memberCount.total
  };
  
  // 将来の実装用にプレースホルダーを残す
  const overloadDensity = 0.0; // TODO: 実際のオーバーロード分析を実装
  
  // Determine API complexity based on surface area
  let apiComplexity: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' = 'LOW';
  // 業界標準のインターフェース分離原則に基づく閾値
  if (memberCount.total > 40) {  // 非常に大規模なインターフェース
    apiComplexity = 'VERY_HIGH';
  } else if (memberCount.total > 20) {  // 大規模なインターフェース
    apiComplexity = 'HIGH';
  } else if (memberCount.total > 10) {  // 中規模なインターフェース
    apiComplexity = 'MEDIUM';
  }
  
  // Generate recommendations based on analysis
  const recommendations: string[] = [];
  
  if (memberCount.total > 30) {
    recommendations.push('Consider splitting large interface into smaller, focused interfaces');
  }
  
  if (memberCount.methods > 20) {
    recommendations.push('High method count - consider grouping related methods');
  }
  
  if (memberCount.properties > 15) {
    recommendations.push('Many properties - consider using composition or value objects');
  }
  
  if (memberCount.constructors > 3) {
    recommendations.push('Multiple constructors - consider factory methods or builder pattern');
  }
  
  if (memberCount.indexSignatures > 0 && memberCount.callSignatures > 0) {
    recommendations.push('Mixed signatures - consider separate interfaces for different uses');
  }
  
  return {
    surfaceArea,
    complexity: {
      overloadDensity,
      apiComplexity
    },
    recommendations
  };
}

/**
 * Display type API analysis results
 */
function displayTypeApiAnalysis(typeName: string, analysis: TypeApiAnalysis, detailed?: boolean): void {
  console.log(`\n📊 API Analysis for type '${typeName}'\n`);
  
  // Surface area summary
  console.log('🎯 API Surface Area:');
  console.log(`  Methods:      ${analysis.surfaceArea.methods}`);
  console.log(`  Properties:   ${analysis.surfaceArea.properties}`);
  console.log(`  Constructors: ${analysis.surfaceArea.constructors}`);
  console.log(`  Index Sigs:   ${analysis.surfaceArea.indexSignatures}`);
  console.log(`  Call Sigs:    ${analysis.surfaceArea.callSignatures}`);
  console.log(`  Total:        ${analysis.surfaceArea.total}`);
  
  // Complexity assessment
  console.log(`\n📈 Complexity: ${analysis.complexity.apiComplexity}`);
  if (detailed) {
    console.log(`  Overload Density: ${analysis.complexity.overloadDensity.toFixed(2)}`);
  }
  
  // Recommendations
  if (analysis.recommendations.length > 0) {
    console.log('\n💡 Recommendations:');
    analysis.recommendations.forEach((rec, index) => {
      console.log(`  ${index + 1}. ${rec}`);
    });
  }
}

/**
 * Execute types api command using database
 */
export const executeTypesApiDB: VoidCommand<TypeApiOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      const typeNameOrId = (options as { typeName?: string }).typeName || '';
      
      env.commandLogger.info(`📊 Analyzing API design for type: ${typeNameOrId}`);
      
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
      
      // Get type member counts for analysis
      const memberCounts = await getMemberCountsForTypes(env.storage, [targetType], latestSnapshot.id);
      const memberCount = memberCounts.get(targetType.id);
      
      if (!memberCount) {
        console.log(`⚠️  No member information available for type ${targetType.name}`);
        return;
      }
      
      // Analyze API surface area
      const apiAnalysis = analyzeTypeApiSurface(targetType, memberCount);
      
      // Optional optimization analysis
      let optimizationAnalysis = null;
      if (options.optimize) {
        const { ApiOptimizer } = await import('../../../../analyzers/type-insights/api-optimizer');
        const optimizer = new ApiOptimizer(env.storage);
        optimizationAnalysis = await optimizer.analyzeApiOptimization(targetType.id, latestSnapshot.id);
      }
      
      if (options.json) {
        const result = {
          apiAnalysis,
          optimizationAnalysis: optimizationAnalysis ?? null
        };
        console.log(JSON.stringify(result, null, 2));
      } else {
        displayTypeApiAnalysis(targetType.name, apiAnalysis, options.detail);
        
        if (optimizationAnalysis) {
          const { ApiOptimizer } = await import('../../../../analyzers/type-insights/api-optimizer');
          const optimizer = new ApiOptimizer(env.storage);
          console.log(optimizer.formatOptimizationAnalysis(optimizationAnalysis));
        }
      }
      
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as FuncqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze type API: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };
import { TypeInsightsOptions, isUuidOrPrefix, escapeLike } from '../../types.types';
import { TypeDefinition } from '../../../../types';
import { VoidCommand } from '../../../../types/command';
import { CommandEnvironment } from '../../../../types/environment';
import { createErrorHandler, ErrorCode, FuncqcError } from '../../../../utils/error-handler';

/**
 * Types for insights command
 */
interface AnalysisResults {
  coverage?: unknown;
  api?: unknown;
  clustering?: unknown;
  risk?: unknown;
}

interface InsightsReport {
  typeName: string;
  typeId: string;
  timestamp: string;
  analyses: AnalysisResults;
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
 * Format integrated insights report combining all analyses
 */
function formatIntegratedInsightsReport(insights: InsightsReport): string {
  const lines: string[] = [];
  const { typeName, analyses } = insights;
  
  lines.push(`\n🔍 Comprehensive Type Analysis for '${typeName}'\n`);
  lines.push('=' .repeat(60));
  lines.push('');
  
  // Coverage Summary
  if (analyses['coverage'] && !(analyses['coverage'] as { error?: unknown }).error) {
    const coverage = analyses['coverage'] as { 
      hotProperties?: Array<{ property: string; totalCalls: number }>; 
      coldProperties?: Array<{ property: string; totalCalls?: number }>; 
      writeHubs?: Array<{ property: string; writerCount: number }>;
    };
    lines.push('📊 Usage Coverage:');
    if (coverage.hotProperties?.length) {
      const hot = coverage.hotProperties.slice(0, 3).map(p => `${p.property}(${p.totalCalls}c)`).join(', ');
      lines.push(`  Hot: ${hot}`);
    }
    if (coverage.coldProperties?.length) {
      const cold = coverage.coldProperties.slice(0, 3).map(p => p.property).join(', ');
      lines.push(`  Cold: ${cold}`);
    }
    if (coverage.writeHubs?.length) {
      const hubs = coverage.writeHubs.slice(0, 2).map(h => `${h.property}(${h.writerCount}w)`).join(', ');
      lines.push(`  Write Hubs: ${hubs}`);
    }
  } else if (analyses['coverage'] && (analyses['coverage'] as { error?: unknown }).error) {
    lines.push('📊 Usage Coverage: ❌ Analysis failed');
  }
  lines.push('');
  
  // API Analysis Summary
  if (analyses['api'] && !(analyses['api'] as { error?: unknown }).error) {
    const api = analyses['api'] as { 
      surfaceComplexity?: string; 
      designPatterns?: Array<{ pattern: string; confidence: number }>; 
      recommendations?: string[];
    };
    lines.push('🎯 API Design:');
    if (api.surfaceComplexity) {
      lines.push(`  Complexity: ${api.surfaceComplexity}`);
    }
    if (api.designPatterns?.length) {
      const patterns = api.designPatterns.slice(0, 2).map(p => p.pattern).join(', ');
      lines.push(`  Patterns: ${patterns}`);
    }
    if (api.recommendations?.length) {
      const rec = api.recommendations[0];
      lines.push(`  Key Rec: ${rec}`);
    }
  } else if (analyses['api'] && (analyses['api'] as { error?: unknown }).error) {
    lines.push('🎯 API Design: ❌ Analysis failed');
  }
  lines.push('');
  
  // Clustering Summary
  if (analyses['clustering'] && !(analyses['clustering'] as { error?: unknown }).error) {
    const clustering = analyses['clustering'] as { 
      clusters?: Array<{ 
        name: string; 
        properties: Array<{ name: string }> | Set<{ name: string }>; 
        cohesionScore: number; 
      }>; 
      orphanProperties?: Array<{ name: string }>;
    };
    lines.push('🎪 Property Clustering:');
    if (clustering.clusters?.length) {
      const cluster = clustering.clusters[0];
      const propArray = Array.isArray(cluster.properties) ? cluster.properties : Array.from(cluster.properties);
      lines.push(`  Main Cluster: ${cluster.name} (${propArray.length} props, ${cluster.cohesionScore.toFixed(2)})`);
    }
    if (clustering.orphanProperties?.length) {
      lines.push(`  Orphans: ${clustering.orphanProperties.length} properties`);
    }
  } else if (analyses['clustering'] && (analyses['clustering'] as { error?: unknown }).error) {
    lines.push('🎪 Property Clustering: ❌ Analysis failed');
  }
  lines.push('');
  
  // Risk Analysis Summary
  if (analyses['risk'] && !(analyses['risk'] as { error?: unknown }).error) {
    const risk = analyses['risk'] as { 
      overallRisk?: string; 
      criticalDependencies?: Array<{ name: string; impact: string }>; 
      changeImpact?: { affectedTypes: number };
    };
    lines.push('⚠️  Dependency Risk:');
    if (risk.overallRisk) {
      lines.push(`  Risk Level: ${risk.overallRisk}`);
    }
    if (risk.criticalDependencies?.length) {
      const critical = risk.criticalDependencies[0];
      lines.push(`  Critical: ${critical.name} (${critical.impact})`);
    }
    if (risk.changeImpact?.affectedTypes) {
      lines.push(`  Change Impact: ${risk.changeImpact.affectedTypes} types affected`);
    }
  } else if (analyses['risk'] && (analyses['risk'] as { error?: unknown }).error) {
    lines.push('⚠️  Dependency Risk: ❌ Analysis failed');
  }
  
  lines.push('');
  lines.push('💡 Consider running individual commands for detailed analysis');
  lines.push('   types api <name>      - Detailed API analysis');
  lines.push('   types coverage <name> - Usage pattern details');
  lines.push('   types cluster <name>  - Property clustering details');
  lines.push('   types risk <name>     - Dependency risk assessment');
  
  return lines.join('\n');
}

/**
 * Execute types insights command - comprehensive analysis combining all insights
 */
export const executeTypesInsightsDB: VoidCommand<TypeInsightsOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      const typeNameOrId = (options as { typeName?: string }).typeName || '';
      
      env.commandLogger.info(`🔍 Running comprehensive analysis for type: ${typeNameOrId}`);
      
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
      
      // Prepare results container
      const insights: InsightsReport = {
        typeName: targetType.name,
        typeId: targetType.id,
        timestamp: new Date().toISOString(),
        analyses: {}
      };
      
      // Run coverage analysis
      if (options.includeCoverage !== false) {
        try {
          const { CoverageAnalyzer } = await import('../../../../analyzers/type-insights/coverage-analyzer');
          const coverageAnalyzer = new CoverageAnalyzer(env.storage);
          const coverageAnalysis = await coverageAnalyzer.analyzeTypeCoverage(
            targetType.id,
            latestSnapshot.id
          );
          insights.analyses.coverage = coverageAnalysis;
        } catch (error) {
          env.commandLogger.warn(`Coverage analysis failed: ${error instanceof Error ? error.message : String(error)}`);
          insights.analyses.coverage = { error: 'Analysis failed' };
        }
      }
      
      // Run API optimization analysis
      if (options.includeApi !== false) {
        try {
          const { ApiOptimizer } = await import('../../../../analyzers/type-insights/api-optimizer');
          const apiOptimizer = new ApiOptimizer(env.storage);
          const apiAnalysis = await apiOptimizer.analyzeApiOptimization(
            targetType.id,
            latestSnapshot.id
          );
          insights.analyses.api = apiAnalysis;
        } catch (error) {
          env.commandLogger.warn(`API analysis failed: ${error instanceof Error ? error.message : String(error)}`);
          insights.analyses.api = { error: 'Analysis failed' };
        }
      }
      
      // Run clustering analysis
      if (options.includeCluster !== false) {
        try {
          const { PropertyClusteringAnalyzer } = await import('../../../../analyzers/type-insights/property-clustering');
          const clusterAnalyzer = new PropertyClusteringAnalyzer(env.storage);
          const clusterAnalysis = await clusterAnalyzer.analyzePropertyClustering(
            targetType.id,
            latestSnapshot.id
          );
          insights.analyses.clustering = clusterAnalysis;
        } catch (error) {
          env.commandLogger.warn(`Clustering analysis failed: ${error instanceof Error ? error.message : String(error)}`);
          insights.analyses.clustering = { error: 'Analysis failed' };
        }
      }
      
      // Run dependency risk analysis
      if (options.includeRisk !== false) {
        try {
          const { DependencyRiskAnalyzer } = await import('../../../../analyzers/type-insights/dependency-risk');
          const riskAnalyzer = new DependencyRiskAnalyzer(env.storage);
          const riskAnalysis = await riskAnalyzer.analyzeDependencyRisk(
            targetType.id,
            latestSnapshot.id
          );
          insights.analyses.risk = riskAnalysis;
        } catch (error) {
          env.commandLogger.warn(`Risk analysis failed: ${error instanceof Error ? error.message : String(error)}`);
          insights.analyses.risk = { error: 'Analysis failed' };
        }
      }
      
      if (options.json) {
        // Custom JSON serialization to handle Set objects
        console.log(JSON.stringify(insights, (_key, value) => {
          if (value instanceof Set) {
            return Array.from(value);
          }
          return value;
        }, 2));
      } else {
        // Format comprehensive report
        console.log(formatIntegratedInsightsReport(insights));
      }
      
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as FuncqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to run comprehensive analysis: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };
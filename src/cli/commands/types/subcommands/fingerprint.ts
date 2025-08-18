import { TypeFingerprintOptions } from '../../types.types';
import { VoidCommand } from '../../../../types/command';
import { CommandEnvironment } from '../../../../types/environment';
import { createErrorHandler, ErrorCode, FuncqcError } from '../../../../utils/error-handler';

/**
 * Format behavioral fingerprint analysis report
 */
function formatFingerprintReport(
  clusters: Array<{
    clusterId: string;
    functions: string[];
    functionNames: string[];
    commonBehaviors: string[];
    clusterSignature: string[];
    roleDescription: string;
    similarity: number;
    suggestedAction: string;
    impactScore: number;
    confidence: number;
  }>,
  options: {
    includeCallsOut: boolean;
    includeCallsIn: boolean;
    minCallFrequency: number;
    similarityThreshold: number;
    includeInternalCalls: boolean;
    maxFingerprintSize: number;
  }
): string {
  const lines: string[] = [];

  // Header
  lines.push('🔍 Behavioral Fingerprint Analysis');
  lines.push('═'.repeat(50));
  lines.push('');

  // Configuration summary
  lines.push('⚙️  Analysis Configuration:');
  lines.push(`   • Include Outgoing Calls: ${options.includeCallsOut ? 'Yes' : 'No'}`);
  lines.push(`   • Include Incoming Calls: ${options.includeCallsIn ? 'Yes' : 'No'}`);
  lines.push(`   • Min Call Frequency: ${options.minCallFrequency}`);
  lines.push(`   • Similarity Threshold: ${(options.similarityThreshold * 100).toFixed(1)}%`);
  lines.push(`   • Include Internal Calls: ${options.includeInternalCalls ? 'Yes' : 'No'}`);
  lines.push('');

  if (clusters.length === 0) {
    lines.push('ℹ️  No behavioral clusters found with current criteria.');
    lines.push('');
    lines.push('💡 Try adjusting parameters:');
    lines.push('   • Lower --similarity-threshold for broader clustering');
    lines.push('   • Lower --min-call-frequency for more functions');
    lines.push('   • Enable --include-internal-calls for richer patterns');
    return lines.join('\n');
  }

  // Statistics summary
  const totalFunctions = clusters.reduce((sum, cluster) => sum + cluster.functions.length, 0);
  const avgSimilarity = clusters.reduce((sum, cluster) => sum + cluster.similarity, 0) / clusters.length;

  lines.push('📊 Clustering Summary:');
  lines.push(`   • ${clusters.length} behavioral cluster(s) identified`);
  lines.push(`   • ${totalFunctions} functions clustered`);
  lines.push(`   • Average internal similarity: ${(avgSimilarity * 100).toFixed(1)}%`);
  lines.push('');

  // Detailed cluster analysis
  lines.push('🎯 Cluster Analysis:');
  lines.push('─'.repeat(40));

  clusters.forEach((cluster, index) => {
    lines.push('');
    lines.push(`📦 Cluster ${index + 1}: ${cluster.roleDescription}`);
    lines.push(`   ID: ${cluster.clusterId}`);
    lines.push(`   Functions: ${cluster.functions.length} (similarity: ${(cluster.similarity * 100).toFixed(1)}%)`);
    lines.push(`   Impact Score: ${cluster.impactScore} | Confidence: ${(cluster.confidence * 100).toFixed(1)}%`);
    lines.push('');
    
    // Function list
    lines.push('   🔧 Functions in cluster:');
    cluster.functionNames.slice(0, 8).forEach(name => {
      lines.push(`      • ${name}`);
    });
    if (cluster.functionNames.length > 8) {
      lines.push(`      ... and ${cluster.functionNames.length - 8} more`);
    }
    lines.push('');
    
    // Common behaviors
    if (cluster.commonBehaviors.length > 0) {
      lines.push('   🤝 Shared Behaviors:');
      cluster.commonBehaviors.slice(0, 6).forEach(behavior => {
        lines.push(`      • ${behavior}`);
      });
      if (cluster.commonBehaviors.length > 6) {
        lines.push(`      ... and ${cluster.commonBehaviors.length - 6} more`);
      }
      lines.push('');
    }

    // Suggested action
    lines.push(`   💡 ${cluster.suggestedAction}`);
  });

  lines.push('');

  // Impact analysis
  const highImpactClusters = clusters.filter(c => c.impactScore >= 50).length;
  const mediumImpactClusters = clusters.filter(c => c.impactScore >= 25 && c.impactScore < 50).length;

  lines.push('📈 Impact Analysis:');
  if (highImpactClusters > 0) {
    lines.push(`   🔴 ${highImpactClusters} high-impact cluster(s) - immediate refactoring opportunity`);
  }
  if (mediumImpactClusters > 0) {
    lines.push(`   🟡 ${mediumImpactClusters} medium-impact cluster(s) - consider consolidation`);
  }
  
  lines.push('');

  // Next steps
  lines.push('🚀 Next Steps:');
  lines.push('━'.repeat(20));
  lines.push('   1. Start with highest impact clusters');
  lines.push('   2. Extract common interfaces for behavioral patterns');
  lines.push('   3. Consider module consolidation for same-file clusters');
  lines.push('   4. Validate behavioral assumptions through code review');

  return lines.join('\n');
}

/**
 * Execute types fingerprint command using database
 */
export const executeTypesFingerprintDB: VoidCommand<TypeFingerprintOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      env.commandLogger.info('🔍 Analyzing behavioral fingerprints and function clustering...');

      // Get latest snapshot
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run `funcqc scan` first.');
      }
      const latestSnapshot = snapshots[0];

      // Import and configure the analyzer
      const { BehavioralFingerprintAnalyzer } = await import('../../../../analyzers/type-insights/behavioral-fingerprint-analyzer');
      
      // Normalize and validate options
      const normalizeInt = (v: unknown) =>
        typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : NaN;
      const normalizeNum = (v: unknown) =>
        typeof v === 'number' && Number.isFinite(v) ? v : NaN;

      let minCallFrequency = normalizeInt(options.minCallFrequency);
      if (!(minCallFrequency >= 1)) {
        if (options.minCallFrequency !== undefined) {
          env.commandLogger.warn(
            `Invalid --min-call-frequency '${options.minCallFrequency}', falling back to 2.`
          );
        }
        minCallFrequency = 2;
      }

      let similarityThreshold = normalizeNum(options.similarityThreshold);
      if (!(similarityThreshold >= 0 && similarityThreshold <= 1)) {
        if (options.similarityThreshold !== undefined) {
          env.commandLogger.warn(
            `Invalid --similarity-threshold '${options.similarityThreshold}', falling back to 0.7.`
          );
        }
        similarityThreshold = 0.7;
      }

      let maxFingerprintSize = normalizeInt(options.maxFingerprintSize);
      if (!(maxFingerprintSize > 0)) {
        if (options.maxFingerprintSize !== undefined) {
          env.commandLogger.warn(
            `Invalid --max-fingerprint-size '${options.maxFingerprintSize}', falling back to 50.`
          );
        }
        maxFingerprintSize = 50;
      }

      const analyzerOptions = {
        includeCallsOut: options.includeCallsOut ?? true,
        includeCallsIn: options.includeCallsIn ?? true,
        minCallFrequency,
        clusterSimilarityThreshold: similarityThreshold,
        maxFingerprintSize,
        includeInternalCalls: options.includeInternalCalls ?? false
      };

      const analyzer = new BehavioralFingerprintAnalyzer(env.storage, analyzerOptions);

      // Perform analysis
      const clusters = await analyzer.getDetailedResults(latestSnapshot.id);

      // Apply sorting
      let sortedResults = [...clusters];
      const ALLOWED_SORTS = ['similarity', 'impact', 'size'] as const;
      type AllowedSort = typeof ALLOWED_SORTS[number];

      const isValidSort = (sort: unknown): sort is AllowedSort =>
        ALLOWED_SORTS.includes(sort as AllowedSort);

      const sortField: AllowedSort = isValidSort(options.sort) ? options.sort : 'impact';

      if (options.sort && !isValidSort(options.sort)) {
        env.commandLogger.warn(`Invalid --sort '${options.sort}'. Falling back to 'impact'.`);
      }
      const descending = options.desc === true;

      sortedResults.sort((a, b) => {
        let comparison = 0;
        
        switch (sortField) {
          case 'similarity':
            comparison = a.similarity - b.similarity;
            break;
          case 'impact':
            comparison = a.impactScore - b.impactScore;
            break;
          case 'size':
            comparison = a.functions.length - b.functions.length;
            break;
          default:
            comparison = a.impactScore - b.impactScore;
        }

        return descending ? -comparison : comparison;
      });

      // Apply limit
      if (options.limit && options.limit > 0) {
        sortedResults = sortedResults.slice(0, options.limit);
      }

      if (options.json) {
        const jsonOutput = {
          metadata: {
            timestamp: new Date().toISOString(),
            snapshotId: latestSnapshot.id,
            totalClusters: clusters.length,
            displayedClusters: sortedResults.length,
            options: analyzerOptions
          },
          clusters: sortedResults
        };
        console.log(JSON.stringify(jsonOutput, null, 2));
        return;
      }

      // Generate report
      const report = formatFingerprintReport(sortedResults, {
        includeCallsOut: analyzerOptions.includeCallsOut,
        includeCallsIn: analyzerOptions.includeCallsIn,
        minCallFrequency: analyzerOptions.minCallFrequency,
        similarityThreshold: analyzerOptions.clusterSimilarityThreshold,
        includeInternalCalls: analyzerOptions.includeInternalCalls,
        maxFingerprintSize: analyzerOptions.maxFingerprintSize
      });

      console.log(report);

    } catch (error) {
      // Check if it's already a FuncqcError
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as FuncqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze behavioral fingerprints: ${error instanceof Error ? error.message : String(error)}`,
          { command: 'types fingerprint' },
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };
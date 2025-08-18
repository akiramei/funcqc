import { TypeSubsumeOptions } from '../../types.types';
import { VoidCommand } from '../../../../types/command';
import { CommandEnvironment } from '../../../../types/environment';
import { createErrorHandler, ErrorCode } from '../../../../utils/error-handler';

/**
 * Apply sorting and limiting to subsumption results
 */
function applySortingAndLimiting(
  relationships: Array<{
    relationshipType: string;
    sourceTypeId: string;
    sourceTypeName: string;
    targetTypeId: string;
    targetTypeName: string;
    overlapRatio: number;
    commonMembers: string[];
    uniqueToSource: string[];
    uniqueToTarget: string[];
    suggestedAction: string;
    impactScore: number;
    confidence: number;
  }>,
  options: TypeSubsumeOptions
) {
  // Sort results
  const sortField = options.sort || 'impact';
  const descending = options.desc === true;

  const sorted = [...relationships].sort((a, b) => {
    let comparison = 0;
    
    switch (sortField) {
      case 'overlap':
        comparison = a.overlapRatio - b.overlapRatio;
        break;
      case 'impact':
        comparison = a.impactScore - b.impactScore;
        break;
      case 'types':
        comparison = a.sourceTypeName.localeCompare(b.sourceTypeName) ||
                    a.targetTypeName.localeCompare(b.targetTypeName);
        break;
      default:
        comparison = a.impactScore - b.impactScore;
    }
    
    return descending ? -comparison : comparison;
  });

  // Apply limit
  if (typeof options.limit === 'number' && options.limit > 0) {
    return sorted.slice(0, options.limit);
  }
  
  return sorted;
}

/**
 * Format subsumption analysis results as a human-readable report
 */
function formatSubsumptionReport(
  relationships: Array<{
    relationshipType: string;
    sourceTypeName: string;
    targetTypeName: string;
    overlapRatio: number;
    commonMembers: string[];
    uniqueToSource: string[];
    uniqueToTarget: string[];
    suggestedAction: string;
    impactScore: number;
    confidence: number;
  }>,
  options: {
    minOverlapRatio: number;
    showRedundantOnly: boolean;
    considerMethodNames: boolean;
    includePartialMatches: boolean;
  }
): string {
  const lines: string[] = [];

  // Header
  lines.push('🎯 Structural Subsumption Analysis');
  lines.push('═'.repeat(50));
  lines.push('');

  // Configuration summary
  lines.push('⚙️  Analysis Configuration:');
  lines.push(`   • Minimum Overlap Ratio: ${(options.minOverlapRatio * 100).toFixed(1)}%`);
  lines.push(`   • Include Method Names: ${options.considerMethodNames ? 'Yes' : 'No'}`);
  lines.push(`   • Show Partial Matches: ${options.includePartialMatches ? 'Yes' : 'No'}`);
  lines.push(`   • Redundant Only: ${options.showRedundantOnly ? 'Yes' : 'No'}`);
  lines.push('');

  if (relationships.length === 0) {
    lines.push('ℹ️  No subsumption relationships found with current criteria.');
    lines.push('');
    lines.push('💡 Try adjusting parameters:');
    lines.push('   • Lower --min-overlap threshold');
    lines.push('   • Enable --include-partial for more results');
    lines.push('   • Include --consider-methods for broader analysis');
    return lines.join('\n');
  }

  // Statistics summary
  const stats = {
    equivalent: relationships.filter(r => r.relationshipType === 'equivalent').length,
    subset: relationships.filter(r => r.relationshipType === 'subset').length,
    superset: relationships.filter(r => r.relationshipType === 'superset').length,
    partial: relationships.filter(r => r.relationshipType === 'partial_overlap').length
  };

  lines.push('📊 Relationship Summary:');
  lines.push(`   • Equivalent Types: ${stats.equivalent} (🟢 high consolidation potential)`);
  lines.push(`   • Subset Relations: ${stats.subset} (🟡 inheritance opportunities)`);
  lines.push(`   • Superset Relations: ${stats.superset} (🟡 inheritance opportunities)`);
  lines.push(`   • Partial Overlaps: ${stats.partial} (🔵 interface extraction potential)`);
  lines.push('');

  // Individual relationships
  lines.push(`🔗 Relationships (showing ${relationships.length}):`);
  lines.push('━'.repeat(50));
  
  relationships.forEach((rel, index) => {
    const typeIcon = {
      'equivalent': '🟢',
      'subset': '⬇️',
      'superset': '⬆️',
      'partial_overlap': '🔄'
    }[rel.relationshipType] || '❓';
    
    const overlapPercent = (rel.overlapRatio * 100).toFixed(1);
    const confidencePercent = (rel.confidence * 100).toFixed(0);
    
    lines.push(`${index + 1}. ${typeIcon} ${rel.relationshipType.replace('_', ' ').toUpperCase()}`);
    lines.push(`   Types: ${rel.sourceTypeName} ↔ ${rel.targetTypeName}`);
    lines.push(`   Overlap: ${overlapPercent}% (confidence: ${confidencePercent}%)`);
    lines.push(`   Impact Score: ${rel.impactScore}`);
    lines.push('');
    
    // Common members
    if (rel.commonMembers.length > 0) {
      const memberDisplay = rel.commonMembers.length > 5 
        ? rel.commonMembers.slice(0, 5).join(', ') + ` ... (${rel.commonMembers.length - 5} more)`
        : rel.commonMembers.join(', ');
      lines.push(`   🤝 Shared: {${memberDisplay}}`);
    }
    
    // Unique members (only show if not equivalent)
    if (rel.relationshipType !== 'equivalent') {
      if (rel.uniqueToSource.length > 0) {
        const uniqueDisplay = rel.uniqueToSource.length > 3
          ? rel.uniqueToSource.slice(0, 3).join(', ') + ` ... (${rel.uniqueToSource.length - 3} more)`
          : rel.uniqueToSource.join(', ');
        lines.push(`   📍 Only in ${rel.sourceTypeName}: {${uniqueDisplay}}`);
      }
      if (rel.uniqueToTarget.length > 0) {
        const uniqueDisplay = rel.uniqueToTarget.length > 3
          ? rel.uniqueToTarget.slice(0, 3).join(', ') + ` ... (${rel.uniqueToTarget.length - 3} more)`
          : rel.uniqueToTarget.join(', ');
        lines.push(`   📍 Only in ${rel.targetTypeName}: {${uniqueDisplay}}`);
      }
    }
    
    lines.push(`   💡 ${rel.suggestedAction}`);
    lines.push('');
  });

  // Recommendations
  lines.push('📋 General Recommendations:');
  lines.push('━'.repeat(30));
  
  if (stats.equivalent > 0) {
    lines.push(`   🟢 ${stats.equivalent} equivalent type(s) can be merged immediately`);
  }
  
  if (stats.subset + stats.superset > 0) {
    lines.push(`   🟡 ${stats.subset + stats.superset} inheritance relationship(s) can be formalized`);
  }
  
  if (stats.partial > 0) {
    lines.push(`   🔵 ${stats.partial} partial overlap(s) suggest common interface extraction`);
  }
  
  lines.push('');

  // Next steps
  lines.push('🚀 Next Steps:');
  lines.push('━'.repeat(20));
  lines.push('   1. Start with equivalent types (highest impact)');
  lines.push('   2. Establish inheritance hierarchies for subset/superset relations');
  lines.push('   3. Extract common interfaces for partial overlaps');
  lines.push('   4. Update import statements and references after consolidation');

  return lines.join('\n');
}

/**
 * Execute types subsume command using database
 */
export const executeTypesSubsumeDB: VoidCommand<TypeSubsumeOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      env.commandLogger.info('🎯 Analyzing structural subsumption relationships...');

      // Get latest snapshot
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        const funcqcError = errorHandler.createError(
          ErrorCode.NOT_FOUND,
          'No analysis snapshots available. Use `funcqc scan` to analyze your codebase first',
          { command: 'types subsume' } as Record<string, unknown>
        );
        
        env.commandLogger.error(funcqcError.message);
        throw funcqcError;
      }

      const latestSnapshot = snapshots[0];

      // Initialize the structural subsumption analyzer
      const { StructuralSubsumptionAnalyzer } = await import('../../../../analyzers/type-insights/structural-subsumption-analyzer');
      
      // Configure analyzer options
      const analyzerOptions = {
        minOverlapRatio: typeof options.minOverlap === 'number' && 
                        Number.isFinite(options.minOverlap) && 
                        options.minOverlap >= 0 && 
                        options.minOverlap <= 1 
          ? options.minOverlap 
          : 0.7,
        includePartialMatches: options.includePartial !== false, // Default true
        showRedundantOnly: options.showRedundant === true,       // Default false
        considerMethodNames: options.considerMethods === true,   // Default false
        minSupport: 2,        // Always 2 for pairwise relationships
        minConfidence: 0.5,   // Lower threshold for subsumption
        maxPatternSize: 100,  // Allow large patterns
        includeRarePatterns: true
      };

      const analyzer = new StructuralSubsumptionAnalyzer(env.storage, analyzerOptions);

      // Get detailed subsumption results
      const relationships = await analyzer.getDetailedResults(latestSnapshot.id);

      // Apply sorting and limiting
      const sortedResults = applySortingAndLimiting(relationships, options);

      // Output results
      if (options.json) {
        const jsonOutput = {
          metadata: {
            timestamp: new Date().toISOString(),
            snapshotId: latestSnapshot.id,
            totalRelationships: relationships.length,
            displayedRelationships: sortedResults.length,
            options: analyzerOptions
          },
          relationships: sortedResults.map(rel => ({
            sourceType: {
              id: rel.sourceTypeId,
              name: rel.sourceTypeName
            },
            targetType: {
              id: rel.targetTypeId,
              name: rel.targetTypeName
            },
            relationshipType: rel.relationshipType,
            overlapRatio: rel.overlapRatio,
            commonMembers: rel.commonMembers,
            uniqueToSource: rel.uniqueToSource,
            uniqueToTarget: rel.uniqueToTarget,
            suggestedAction: rel.suggestedAction,
            impactScore: rel.impactScore,
            confidence: rel.confidence
          }))
        };
        console.log(JSON.stringify(jsonOutput, null, 2));
      } else {
        const report = formatSubsumptionReport(sortedResults, analyzerOptions);
        console.log(report);
      }

    } catch (error) {
      // Check if error has FuncqcError properties (interface check)
      if (error && typeof error === 'object' && 'code' in error) {
        throw error;
      }
      
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `Failed to analyze structural subsumption: ${error instanceof Error ? error.message : String(error)}`,
        { command: 'types subsume' } as Record<string, unknown>
      );
      
      env.commandLogger.error(funcqcError.message);
      throw funcqcError;
    }
  };
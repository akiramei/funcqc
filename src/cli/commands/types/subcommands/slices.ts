import { TypeSlicesOptions } from '../../types.types';
import { VoidCommand } from '../../../../types/command';
import { CommandEnvironment } from '../../../../types/environment';
import { createErrorHandler, ErrorCode, FuncqcError } from '../../../../utils/error-handler';
import type { PropertySliceReport, PropertySlice } from '../../../../analyzers/type-insights/property-slice-miner';

/**
 * Format property slices analysis report
 */
function formatSlicesReport(report: PropertySliceReport, slices: PropertySlice[], options?: { minSupport?: number; minSliceSize?: number }): string {
  const lines: string[] = [];
  
  lines.push('🍰 Property Slice Analysis');
  lines.push('━'.repeat(50));
  lines.push('');
  
  // Summary
  lines.push(`📊 Summary:`);
  lines.push(`   Total Slices Found: ${report.totalSlices}`);
  lines.push(`   High Value: ${report.highValueSlices.length}`);
  lines.push(`   Medium Value: ${report.mediumValueSlices.length}`);
  lines.push(`   Low Value: ${report.lowValueSlices.length}`);
  lines.push(`   Estimated Code Reduction: ~${report.estimatedCodeReduction} lines`);
  lines.push('');

  if (slices.length === 0) {
    lines.push('❌ No property slices found matching the criteria');
    lines.push('');
    lines.push('💡 Try adjusting parameters:');
    lines.push(`   • Lower --min-support${options ? ` (currently requires ${options.minSupport}+ types)` : ''}`);
    lines.push(`   • Lower --min-slice-size${options ? ` (currently requires ${options.minSliceSize}+ properties)` : ''}`);
    lines.push('   • Include --consider-methods for broader patterns');
    return lines.join('\n');
  }

  // Individual slices
  lines.push(`🎯 Property Slices (showing ${slices.length}):`);
  lines.push('━'.repeat(50));
  
  slices.forEach((slice, index) => {
    const benefit = slice.extractionBenefit;
    const benefitIcon = benefit === 'high' ? '🟢' : benefit === 'medium' ? '🟡' : '🔴';
    
    lines.push(`${index + 1}. ${benefitIcon} ${slice.suggestedVOName}`);
    lines.push(`   Properties: {${slice.properties.join(', ')}}`);
    lines.push(`   Found in: ${slice.support} types`);
    lines.push(`   Benefit: ${benefit.toUpperCase()}`);
    lines.push(`   Impact Score: ${slice.impactScore}`);
    lines.push(`   Est. Duplicate Code: ${slice.duplicateCode} lines`);
    
    if (slice.relatedMethods.length > 0) {
      lines.push(`   Related Methods: {${slice.relatedMethods.join(', ')}}`);
    }
    
    lines.push('');
  });

  // Implementation guidance
  lines.push('💡 Implementation Guidance:');
  lines.push('   1. Create new Value Object types for high-benefit slices');
  lines.push('   2. Generate extraction interfaces and helper functions');
  lines.push('   3. Refactor types to use extracted Value Objects');
  lines.push('   4. Update type definitions to reduce duplication');

  return lines.join('\n');
}

/**
 * Execute types slices command using database
 */
export const executeTypesSlicesDB: VoidCommand<TypeSlicesOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      env.commandLogger.info('🍰 Analyzing property slice patterns across types...');

      // Get latest snapshot (他コマンドと同様の取得方法に統一)
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        const funcqcError = errorHandler.createError(
          ErrorCode.NOT_FOUND,
          'No snapshots found. Run `funcqc scan` first.',
          { command: 'types slices' }
        );
        throw funcqcError;
      }
      const latestSnapshot = snapshots[0];

      // Normalize and validate options
      const allowedBenefits = new Set(['high', 'medium', 'low'] as const);
      const allowedSorts = new Set(['support', 'size', 'impact', 'benefit'] as const);
      const minSupport =
        typeof options.minSupport === 'number' &&
        Number.isFinite(options.minSupport) &&
        Number.isInteger(options.minSupport) &&
        options.minSupport > 0
          ? options.minSupport
          : 3;
      let minSliceSize =
        typeof options.minSliceSize === 'number' &&
        Number.isFinite(options.minSliceSize) &&
        Number.isInteger(options.minSliceSize) &&
        options.minSliceSize > 0
          ? options.minSliceSize
          : 2;
      let maxSliceSize =
        typeof options.maxSliceSize === 'number' &&
        Number.isFinite(options.maxSliceSize) &&
        Number.isInteger(options.maxSliceSize) &&
        options.maxSliceSize > 0
          ? options.maxSliceSize
          : 5;
      if (minSliceSize > maxSliceSize) {
        env.commandLogger.warn(
          `--min-slice-size (${minSliceSize}) > --max-slice-size (${maxSliceSize}). Swapping values.`
        );
        [minSliceSize, maxSliceSize] = [maxSliceSize, minSliceSize];
      }
      const sortField = allowedSorts.has(options.sort ?? 'impact')
        ? (options.sort ?? 'impact')
        : 'impact';
      if (options.sort && sortField !== options.sort) {
        env.commandLogger.warn(`Invalid --sort '${options.sort}'. Falling back to 'impact'.`);
      }
      if (options.benefit && !allowedBenefits.has(options.benefit)) {
        env.commandLogger.warn(`Invalid --benefit '${options.benefit}'. Ignoring filter.`);
      }
      const excludeCommon = options.excludeCommon ?? true;

      // Import and create property slice miner
      const { PropertySliceMiner } = await import(
        '../../../../analyzers/type-insights/property-slice-miner'
      );
      const sliceMiner = new PropertySliceMiner(env.storage, {
        minSupport,
        minSliceSize,
        maxSliceSize,
        considerMethods: options.considerMethods ?? false,
        excludeCommonProperties: excludeCommon
      });

      // Generate analysis report
      const report = await sliceMiner.generateReport(latestSnapshot.id);

      // Filter by benefit level if specified
      let slices = [
        ...report.highValueSlices,
        ...report.mediumValueSlices,
        ...report.lowValueSlices
      ];
      if (options.benefit && allowedBenefits.has(options.benefit)) {
        slices = slices.filter(slice => slice.extractionBenefit === options.benefit);
      }

      // Sort results
      slices.sort((a, b) => {
        let comparison = 0;
        switch (sortField) {
          case 'support':
            comparison = a.support - b.support;
            break;
          case 'size':
            comparison = a.properties.length - b.properties.length;
            break;
          case 'impact':
            comparison = a.impactScore - b.impactScore;
            break;
          case 'benefit': {
            const benefitOrder = { high: 3, medium: 2, low: 1 };
            comparison =
              benefitOrder[a.extractionBenefit] - benefitOrder[b.extractionBenefit];
            break;
          }
          default:
            comparison = a.impactScore - b.impactScore;
        }
        return options.desc ? -comparison : comparison;
      });

      // Apply limit
      if (options.limit && options.limit > 0) {
        slices = slices.slice(0, options.limit);
      }

      if (options.json) {
        // JSON output（例外発生時にもJSON形式で返却）
        const jsonReport = {
          summary: {
            totalSlices: report.totalSlices,
            highValueSlices: report.highValueSlices.length,
            mediumValueSlices: report.mediumValueSlices.length,
            lowValueSlices: report.lowValueSlices.length,
            estimatedCodeReduction: report.estimatedCodeReduction
          },
          slices: slices.map(slice => ({
            name: slice.suggestedVOName,
            properties: slice.properties,
            support: slice.support,
            benefit: slice.extractionBenefit,
            impactScore: slice.impactScore,
            duplicateCode: slice.duplicateCode,
            relatedMethods: slice.relatedMethods
          }))
        };
        console.log(JSON.stringify(jsonReport, null, 2));
      } else {
        const formattedReport = formatSlicesReport(report, slices, { minSupport, minSliceSize });
        console.log(formattedReport);
      }

    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as FuncqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze property slices: ${error instanceof Error ? error.message : String(error)}`,
          { command: 'types slices' },
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };
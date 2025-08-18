import { TypeConvertersOptions } from '../../types.types';
import { VoidCommand } from '../../../../types/command';
import { CommandEnvironment } from '../../../../types/environment';
import { createErrorHandler, ErrorCode } from '../../../../utils/error-handler';

/**
 * Format converter network analysis report
 */
function formatConvertersReport(
  report: {
    nodes: Array<{
      typeName: string;
      typeId: string | null;
      isCanonical: boolean;
      centralityScore: number;
      convertersIn: Array<{
        name: string;
        sourceType: string | null;
        targetType: string | null;
        converterType: 'to' | 'from' | 'parse' | 'convert' | 'transform';
        usageCount: number;
        file: string;
      }>;
      convertersOut: Array<{
        name: string;
        sourceType: string | null;
        targetType: string | null;
        converterType: 'to' | 'from' | 'parse' | 'convert' | 'transform';
        usageCount: number;
        file: string;
      }>;
      totalConverters: number;
    }>;
    converters: Array<{
      functionId: string;
      name: string;
      sourceType: string | null;
      targetType: string | null;
      converterType: 'to' | 'from' | 'parse' | 'convert' | 'transform';
      usageCount: number;
      file: string;
    }>;
    chains: Array<{
      chainId: string;
      sourceType: string;
      targetType: string;
      steps: Array<{
        name: string;
        converterType: 'to' | 'from' | 'parse' | 'convert' | 'transform';
        usageCount: number;
      }>;
      totalUsage: number;
      efficiency: number;
      canOptimize: boolean;
    }>;
    statistics: {
      totalTypes: number;
      totalConverters: number;
      averageConvertersPerType: number;
      canonicalTypes: number;
      redundantTypes: number;
      longestChain: number;
      optimizableChains: number;
    };
    suggestedAction: string;
    impactScore: number;
  },
  options: {
    minConverters: number;
    includeInternalCalls: boolean;
    includeParsers: boolean;
    showChains: boolean;
    canonicalOnly: boolean;
    maxChainLength: number;
  }
): string {
  const lines: string[] = [];

  // Header
  lines.push('🔄 Type Conversion Network Analysis');
  lines.push('═'.repeat(50));
  lines.push('');

  // Configuration summary
  lines.push('⚙️  Analysis Configuration:');
  lines.push(`   • Minimum Converters: ${options.minConverters}`);
  lines.push(`   • Include Internal Calls: ${options.includeInternalCalls ? 'Yes' : 'No'}`);
  lines.push(`   • Include Parsers: ${options.includeParsers ? 'Yes' : 'No'}`);
  lines.push(`   • Show Chains: ${options.showChains ? 'Yes' : 'No'}`);
  lines.push(`   • Canonical Only: ${options.canonicalOnly ? 'Yes' : 'No'}`);
  lines.push('');

  if (report.nodes.length === 0) {
    lines.push('ℹ️  No converter networks found with current criteria.');
    lines.push('');
    lines.push('💡 Try adjusting parameters:');
    lines.push('   • Lower --min-converters for smaller networks');
    lines.push('   • Enable --include-parsers for parse function analysis');
    lines.push('   • Remove --canonical-only to see all types');
    return lines.join('\n');
  }

  // Statistics summary
  lines.push('📊 Network Statistics:');
  lines.push(`   • ${report.statistics.totalTypes} types in conversion networks`);
  lines.push(`   • ${report.statistics.totalConverters} converter functions found`);
  lines.push(`   • ${report.statistics.canonicalTypes} canonical types identified`);
  lines.push(`   • ${report.statistics.redundantTypes} redundant types detected`);
  lines.push(`   • ${report.statistics.averageConvertersPerType.toFixed(1)} avg converters per type`);
  
  if (options.showChains && report.chains.length > 0) {
    lines.push(`   • ${report.chains.length} conversion chains analyzed`);
    lines.push(`   • ${report.statistics.longestChain} steps in longest chain`);
    lines.push(`   • ${report.statistics.optimizableChains} chains can be optimized`);
  }
  lines.push('');

  // Type nodes
  lines.push('🏗️  Type Conversion Nodes:');
  lines.push('━'.repeat(70));
  
  for (const node of report.nodes) {
    const status = node.isCanonical ? '🌟 CANONICAL' : '🔄 REDUNDANT';
    const centralityPercent = (node.centralityScore * 100).toFixed(1);
    
    lines.push(`${status} ${node.typeName} (Centrality: ${centralityPercent}%)`);
    lines.push(`   Converters: ${node.totalConverters} (In: ${node.convertersIn.length}, Out: ${node.convertersOut.length})`);
    
    if (node.convertersIn.length > 0) {
      lines.push('   Incoming Conversions:');
      for (const conv of node.convertersIn.slice(0, 3)) {
        const usage = conv.usageCount > 0 ? ` (${conv.usageCount}x)` : '';
        lines.push(`     • ${conv.name}() [${conv.converterType}]${usage}`);
      }
      if (node.convertersIn.length > 3) {
        lines.push(`     • ... and ${node.convertersIn.length - 3} more`);
      }
    }
    
    if (node.convertersOut.length > 0) {
      lines.push('   Outgoing Conversions:');
      for (const conv of node.convertersOut.slice(0, 3)) {
        const usage = conv.usageCount > 0 ? ` (${conv.usageCount}x)` : '';
        lines.push(`     • ${conv.name}() [${conv.converterType}]${usage}`);
      }
      if (node.convertersOut.length > 3) {
        lines.push(`     • ... and ${node.convertersOut.length - 3} more`);
      }
    }
    
    lines.push('');
  }

  // Conversion chains if requested
  if (options.showChains && report.chains.length > 0) {
    lines.push('🔗 Conversion Chains:');
    lines.push('━'.repeat(50));
    
    for (const chain of report.chains.slice(0, 5)) {
      const efficiency = (chain.efficiency * 100).toFixed(1);
      const optimizable = chain.canOptimize ? ' ⚠️  OPTIMIZABLE' : '';
      
      lines.push(`${chain.sourceType} → ${chain.targetType} (${chain.steps.length} steps, ${efficiency}% efficient)${optimizable}`);
      
      const chainSteps = chain.steps.map(step => 
        `${step.name}()[${step.converterType}]`
      ).join(' → ');
      lines.push(`   ${chainSteps}`);
      
      if (chain.totalUsage > 0) {
        lines.push(`   Total Usage: ${chain.totalUsage}`);
      }
      lines.push('');
    }
    
    if (report.chains.length > 5) {
      lines.push(`   ... and ${report.chains.length - 5} more chains`);
      lines.push('');
    }
  }

  // Recommendations
  lines.push('💡 Recommendations:');
  lines.push('━'.repeat(20));
  lines.push(report.suggestedAction);
  lines.push('');

  lines.push('📋 Action Items:');
  lines.push('━'.repeat(20));
  lines.push('   1. Focus on canonical types for API standardization');
  lines.push('   2. Consider consolidating redundant types');
  
  if (report.statistics.optimizableChains > 0) {
    lines.push('   3. Optimize conversion chains with direct converters');
  }
  
  lines.push('   4. Review high-usage converters for performance optimization');

  return lines.join('\n');
}

/**
 * Execute types converters command using database
 */
export const executeTypesConvertersDB: VoidCommand<TypeConvertersOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      env.commandLogger.info('🔄 Analyzing type conversion networks and canonical types...');

      // Get latest snapshot
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run `funcqc scan` first.');
      }
      const latestSnapshot = snapshots[0];

      // Import and configure the analyzer
      const { ConverterNetworkAnalyzer } = await import('../../../../analyzers/type-insights/converter-network-analyzer');
      
      // Normalize and validate options
      const normalizeInt = (v: unknown) =>
        typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : NaN;

      let minConverters = normalizeInt(options.minConverters);
      if (!(minConverters >= 1)) {
        if (options.minConverters !== undefined) {
          env.commandLogger.warn(
            `Invalid --min-converters '${options.minConverters}', falling back to 2.`
          );
        }
        minConverters = 2;
      }

      let maxChainLength = normalizeInt(options.maxChainLength);
      if (!(maxChainLength >= 1)) {
        if (options.maxChainLength !== undefined) {
          env.commandLogger.warn(
            `Invalid --max-chain-length '${options.maxChainLength}', falling back to 4.`
          );
        }
        maxChainLength = 4;
      }

      let limit: number | undefined = normalizeInt(options.limit);
      if (!(limit >= 1)) {
        limit = undefined;
      }

      // Validate sort field
      type AllowedSort = 'centrality' | 'converters' | 'usage';
      const allowedSorts: AllowedSort[] = ['centrality', 'converters', 'usage'];
      let sort: AllowedSort = 'centrality';
      if (options.sort && allowedSorts.includes(options.sort as AllowedSort)) {
        sort = options.sort as AllowedSort;
      } else if (options.sort) {
        env.commandLogger.warn(
          `Invalid --sort '${options.sort}', falling back to 'centrality'.`
        );
      }

      const analyzerOptions = {
        minConverters,
        includeInternalCalls: options.includeInternalCalls ?? true,
        includeParsers: options.includeParsers ?? true,
        showChains: options.showChains ?? false,
        canonicalOnly: options.canonicalOnly ?? false,
        maxChainLength
      };

      const analyzer = new ConverterNetworkAnalyzer(env.storage, analyzerOptions);

      // Perform analysis
      const reports = await analyzer.analyze(latestSnapshot.id);

      if (reports.length === 0 || !reports[0]) {
        env.commandLogger.info('ℹ️  No converter networks found. Consider adjusting parameters.');
        return;
      }

      const report = reports[0];

      // Apply sorting and limiting to nodes
      let nodes = [...report.nodes];
      
      const desc = options.desc ?? true;
      if (sort === 'centrality') {
        nodes = nodes.sort((a, b) =>
          desc ? b.centralityScore - a.centralityScore : a.centralityScore - b.centralityScore
        );
      } else if (sort === 'converters') {
        nodes = nodes.sort((a, b) =>
          desc ? b.totalConverters - a.totalConverters : a.totalConverters - b.totalConverters
        );
      } else if (sort === 'usage') {
        const getUsage = (node: typeof nodes[0]) =>
          [...node.convertersIn, ...node.convertersOut].reduce(
            (sum, conv) => sum + (conv.usageCount || 0),
            0
          );
        nodes = nodes.sort((a, b) =>
          desc ? getUsage(b) - getUsage(a) : getUsage(a) - getUsage(b)
        );
      }

      if (limit) {
        nodes = nodes.slice(0, limit);
      }

      // Output results
      if (options.json) {
        const jsonReport = {
          ...report,
          nodes,
          metadata: {
            generatedAt: new Date().toISOString(),
            snapshotId: latestSnapshot.id,
            options: analyzerOptions,
            command: 'types converters'
          }
        };
        console.log(JSON.stringify(jsonReport, null, 2));
      } else {
        const formattedReport = formatConvertersReport({
          ...report,
          nodes
        }, analyzerOptions);
        console.log(formattedReport);
      }

    } catch (error) {
      if (error instanceof Error) {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze converter networks: ${error.message}`,
          { command: 'types converters' },
          error
        );
        errorHandler.handleError(funcqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze converter networks: ${String(error)}`,
          { command: 'types converters' }
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };
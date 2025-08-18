import { TypeCochangeOptions } from '../../types.types';
import type { CochangeAnalysisReport } from '../../../../types';
import { VoidCommand } from '../../../../types/command';
import { CommandEnvironment } from '../../../../types/environment';
import { createErrorHandler, ErrorCode, FuncqcError } from '../../../../utils/error-handler';

/**
 * Format co-change analysis report
 */
function formatCochangeReport(report: CochangeAnalysisReport, options: TypeCochangeOptions): string {
  const lines: string[] = [];
  
  lines.push('');
  lines.push('📈 Co-change Analysis Report');
  lines.push('='.repeat(50));

  // オプション正規化（limit は正の整数のみ許可）
  const limit =
    typeof options.limit === 'number' &&
    Number.isFinite(options.limit) &&
    Math.trunc(options.limit) > 0
      ? Math.trunc(options.limit)
      : undefined;
  
  // Statistics
  lines.push('');
  lines.push('📊 Analysis Statistics:');
  lines.push(`   Types analyzed: ${report.statistics.totalTypes}`);
  lines.push(`   Commits analyzed: ${report.statistics.analyzedCommits}`);
  lines.push(`   Time span: ${report.statistics.timeSpan}`);
  lines.push(`   Average changes per type: ${report.statistics.averageChangesPerType.toFixed(1)}`);
  lines.push(`   Most volatile type: ${report.statistics.mostVolatileType}`);
  lines.push(`   Strongest coupling: ${report.statistics.strongestCoupling}`);
  
  // Type changes (sorted by criteria)
  let sortedTypeChanges = [...report.typeChanges];
  if (options.sort === 'changes') {
    // default: ascending
    sortedTypeChanges.sort((a, b) => a.changeCount - b.changeCount);
  } else if (options.sort === 'volatility') {
    sortedTypeChanges.sort((a, b) => a.volatility - b.volatility);
  }
  // apply --desc
  if (options.desc === true) {
    sortedTypeChanges.reverse();
  }
  
  if (limit) {
    sortedTypeChanges = sortedTypeChanges.slice(0, limit);
  }

  if (sortedTypeChanges.length > 0) {
    lines.push('');
    lines.push('🔄 Type Change Patterns:');
    lines.push('');
    
    const maxNameLength = Math.max(...sortedTypeChanges.map(tc => tc.typeName.length), 15);
    lines.push(`${'Type'.padEnd(maxNameLength)} | Changes | Frequency | Volatility | File`);
    lines.push('-'.repeat(maxNameLength + 60));
    
    for (const typeChange of sortedTypeChanges) {
      const vBars = Math.max(0, Math.min(10, Math.floor(typeChange.volatility * 10)));
      const volatilityBar = '█'.repeat(vBars) + '░'.repeat(10 - vBars);
      lines.push(
        `${typeChange.typeName.padEnd(maxNameLength)} | ` +
        `${typeChange.changeCount.toString().padStart(7)} | ` +
        `${typeChange.changeFrequency.toFixed(1).padStart(9)} | ` +
        `${volatilityBar} | ` +
        `${typeChange.filePath}`
      );
    }
  }

  // Co-change relationships  
  let sortedRelations = [...report.cochangeMatrix];
  if (options.sort === 'coupling') {
    // default: ascending
    sortedRelations.sort((a, b) => a.temporalCoupling - b.temporalCoupling);
  }
  // apply --desc
  if (options.desc === true) {
    sortedRelations.reverse();
  }
  
  if (limit) {
    sortedRelations = sortedRelations.slice(0, limit);
  }

  if (sortedRelations.length > 0) {
    lines.push('');
    lines.push('🔗 Co-change Relationships:');
    lines.push('');
    
    const maxTypeLength = Math.max(
      ...sortedRelations.flatMap(r => [r.typeA.length, r.typeB.length]), 
      15
    );
    
    lines.push(`${'Type A'.padEnd(maxTypeLength)} | ${'Type B'.padEnd(maxTypeLength)} | Coupling | Symmetry | Confidence`);
    lines.push('-'.repeat(maxTypeLength * 2 + 40));
    
    for (const relation of sortedRelations) {
      const cBars = Math.max(0, Math.min(10, Math.floor(relation.temporalCoupling * 10)));
      const couplingBar = '█'.repeat(cBars) + '░'.repeat(10 - cBars);
      lines.push(
        `${relation.typeA.padEnd(maxTypeLength)} | ` +
        `${relation.typeB.padEnd(maxTypeLength)} | ` +
        `${couplingBar} | ` +
        `${(relation.symmetry * 100).toFixed(0).padStart(6)}% | ` +
        `${(relation.confidence * 100).toFixed(0).padStart(8)}%`
      );
    }
  }

  // Module suggestions
  if (report.moduleSuggestions.length > 0) {
    lines.push('');
    lines.push('🏗️  Module Suggestions:');
    lines.push('');
    
    for (let i = 0; i < report.moduleSuggestions.length; i++) {
      const suggestion = report.moduleSuggestions[i];
      if (!suggestion) continue;
      
      lines.push(`${i + 1}. ${suggestion.suggestedName}`);
      lines.push(`   Types: ${suggestion.types.join(', ')}`);
      lines.push(`   Cohesion: ${(suggestion.cohesion * 100).toFixed(1)}% | Coupling: ${(suggestion.coupling * 100).toFixed(1)}%`);
      lines.push(`   Migration effort: ${suggestion.migrationEffort}`);
      lines.push(`   Rationale: ${suggestion.rationale}`);
      lines.push(`   Benefits: ${suggestion.benefits.join(', ')}`);
      lines.push('');
    }
  }

  // Suggested actions
  if (report.suggestedAction && report.suggestedAction !== 'No significant co-change patterns detected') {
    lines.push('');
    lines.push('💡 Recommended Actions:');
    lines.push(`   ${report.suggestedAction}`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Execute types cochange command using database
 */
export const executeTypesCochangeDB: VoidCommand<TypeCochangeOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    const { GitCochangeProvider } = await import('../../../../analyzers/type-insights/git-cochange-provider');
    const { CochangeAnalyzer } = await import('../../../../analyzers/type-insights/cochange-analyzer');

    try {
      env.commandLogger.info('📈 Analyzing type co-evolution patterns from Git history...');
      
      // Initialize Git provider
      const gitProvider = new GitCochangeProvider();
      
      // Check Git availability
      const isGitAvailable = await gitProvider.isGitAvailable();
      if (!isGitAvailable) {
        const funcqcError = errorHandler.createError(
          ErrorCode.SYSTEM_REQUIREMENTS_NOT_MET,
          'Git is not available. Co-change analysis requires Git.',
          { command: 'types cochange' }
        );
        errorHandler.handleError(funcqcError);
        return;
      }

      const isGitRepo = await gitProvider.isGitRepository();
      if (!isGitRepo) {
        const funcqcError = errorHandler.createError(
          ErrorCode.SYSTEM_REQUIREMENTS_NOT_MET,
          'Current directory is not a Git repository. Co-change analysis requires Git history.',
          { command: 'types cochange' }
        );
        errorHandler.handleError(funcqcError);
        return;
      }

      // Process exclude-paths option
      let excludePaths: string[];
      if (typeof options.excludePaths === 'string') {
        excludePaths = options.excludePaths
          .split(',')
          .map(p => p.trim())
          .filter(p => p.length > 0);
      } else if (Array.isArray(options.excludePaths)) {
        excludePaths = options.excludePaths
          .map(p => (typeof p === 'string' ? p.trim() : ''))
          .filter(p => p.length > 0);
      } else {
        excludePaths = [];
      }
      // Remove duplicates
      excludePaths = Array.from(new Set(excludePaths));

      // Create analyzer (normalize/validate numeric options)
      const normalizeInt = (v: unknown, min: number, fallback: number) =>
        typeof v === 'number' && Number.isFinite(v) && Math.trunc(v) >= min
          ? Math.trunc(v)
          : fallback;
      const normalizeFloatRange = (v: unknown, min: number, max: number, fallback: number) =>
        typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
          ? v
          : fallback;

      const monthsBack = normalizeInt(options.monthsBack, 1, 6);
      const minChanges = normalizeInt(options.minChanges, 1, 2);
      const cochangeThreshold = normalizeFloatRange(options.cochangeThreshold, 0, 1, 0.3);
      const maxCommits = normalizeInt(options.maxCommits, 1, 1000);
      const showMatrix = options.showMatrix === true;
      const suggestModules = options.suggestModules !== false;

      const analyzer = new CochangeAnalyzer(env.storage, gitProvider, {
        monthsBack,
        minChanges,
        cochangeThreshold,
        showMatrix,
        suggestModules,
        maxCommits,
        excludePaths
      });

      // Resolve latest snapshot for stable type↔file mapping
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        const funcqcError = errorHandler.createError(
          ErrorCode.NOT_FOUND,
          'No snapshots found. Run `funcqc scan` first.',
          { command: 'types cochange' }
        );
        errorHandler.handleError(funcqcError);
        return;
      }
      const latestSnapshot = snapshots[0];

      // Run analysis with explicit snapshot
      const reports = await analyzer.analyze(latestSnapshot.id);
      
      if (reports.length === 0) {
        env.commandLogger.info('No co-change patterns found.');
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(reports, null, 2));
        return;
      }

      // Display results
      for (const report of reports) {
        console.log(formatCochangeReport(report, options));
      }

    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as FuncqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze co-change patterns: ${error instanceof Error ? error.message : String(error)}`,
          { command: 'types cochange' },
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };
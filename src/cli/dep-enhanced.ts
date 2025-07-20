import chalk from 'chalk';
import ora from 'ora';
import { VoidCommand, BaseCommandOptions } from '../types/command';
import { CommandEnvironment } from '../types/environment';
import { createErrorHandler } from '../utils/error-handler';
import { DatabaseError } from '../storage/pglite-adapter';
import { CallEdge, FunctionInfo } from '../types';
import { 
  DependencyAnalysisEngine, 
  DependencyAnalysisOptions,
  AnalysisCandidate,
  CandidateGenerator,
  AnalysisFoundationData
} from '../analyzers/dependency-analysis-engine';
import { ConfidenceCalculator } from '../utils/confidence-calculator';
import { AnalysisFormatter, AnalysisFormattingOptions } from '../utils/analysis-formatter';
import { DependencyMetricsCalculator, DependencyMetrics, DependencyStats, DependencyOptions } from '../analyzers/dependency-metrics';
// Removed unused import
// import { ArchitectureConfigManager } from '../config/architecture-config';
import { ArchitectureValidator } from '../analyzers/architecture-validator';
// Removed unused imports
// import type { ArchitectureViolation } from '../types/architecture';
// import { DotGenerator } from '../visualization/dot-generator';

// Enhanced options with safe-delete patterns
interface DepListOptions extends BaseCommandOptions {
  caller?: string;
  callee?: string;
  file?: string;
  type?: 'direct' | 'async' | 'conditional' | 'external';
  limit?: string;
  sort?: 'caller' | 'callee' | 'file' | 'line' | 'confidence';
  desc?: boolean;
  json?: boolean;
  snapshot?: string;
  // New options from safe-delete patterns
  confidenceThreshold?: string;
  showConfidence?: boolean;
  verbose?: boolean;
  groupBy?: 'file' | 'confidence' | 'impact' | 'none';
  excludeExports?: boolean;
  exclude?: string[];
}

interface DepShowOptions extends BaseCommandOptions {
  direction?: 'in' | 'out' | 'both';
  depth?: string;
  includeExternal?: boolean;
  json?: boolean;
  snapshot?: string;
  // New options from safe-delete patterns
  confidenceThreshold?: string;
  showConfidence?: boolean;
  verbose?: boolean;
  maxItems?: string;
}

interface DepStatsOptions extends BaseCommandOptions {
  sort?: 'fanin' | 'fanout' | 'depth' | 'name' | 'confidence';
  limit?: string;
  showHubs?: boolean;
  showUtility?: boolean;
  showIsolated?: boolean;
  hubThreshold?: string;
  utilityThreshold?: string;
  maxHubFunctions?: string;
  maxUtilityFunctions?: string;
  json?: boolean;
  format?: 'table' | 'json' | 'dot';
  snapshot?: string;
  // New options from safe-delete patterns
  showConfidence?: boolean;
  verbose?: boolean;
  showMetadata?: boolean;
}

interface DepLintOptions extends BaseCommandOptions {
  config?: string;
  format?: 'table' | 'json';
  severity?: 'error' | 'warning' | 'info';
  maxViolations?: string;
  includeMetrics?: boolean;
  fix?: boolean;
  snapshot?: string;
  // New options from safe-delete patterns
  confidenceThreshold?: string;
  showConfidence?: boolean;
  verbose?: boolean;
  groupBy?: 'severity' | 'file' | 'rule' | 'none';
}

/**
 * Dependency list candidate for analysis
 */
class DependencyListCandidate implements AnalysisCandidate {
  constructor(
    public functionInfo: FunctionInfo,
    public confidenceScore: number,
    public analysisReason: string,
    public metadata: Record<string, unknown>,
    public estimatedImpact: 'low' | 'medium' | 'high',
    public callEdge: CallEdge
  ) {}
}

/**
 * Candidate generator for dependency list command
 */
class DependencyListCandidateGenerator implements CandidateGenerator<DependencyListCandidate> {
  constructor(
    private options: DepListOptions,
    private functionMap: Map<string, FunctionInfo>
  ) {}

  async generateCandidates(
    _functions: FunctionInfo[],
    highConfidenceEdges: CallEdge[],
    _foundationData: AnalysisFoundationData,
    _config: DependencyAnalysisOptions
  ): Promise<DependencyListCandidate[]> {
    const candidates: DependencyListCandidate[] = [];

    // Apply filters
    let filteredEdges = this.applyFilters(highConfidenceEdges);

    for (const edge of filteredEdges) {
      const callerFunction = this.functionMap.get(edge.callerFunctionId);
      const calleeFunction = edge.calleeFunctionId ? this.functionMap.get(edge.calleeFunctionId) : undefined;

      if (!callerFunction) continue;

      // Calculate confidence using ConfidenceCalculator
      const confidenceResult = ConfidenceCalculator.calculateCallEdgeConfidence(
        edge,
        edge.calleeCandidates?.length || 1
      );

      // Estimate impact based on function characteristics
      const callersCount = highConfidenceEdges.filter(e => e.calleeFunctionId === edge.calleeFunctionId).length;
      const impact = DependencyAnalysisEngine.estimateImpact(
        calleeFunction || callerFunction,
        callersCount
      );

      const candidate = new DependencyListCandidate(
        callerFunction,
        confidenceResult.finalScore,
        `Call from ${callerFunction.name} to ${edge.calleeName}`,
        {
          callType: edge.callType,
          lineNumber: edge.lineNumber,
          confidenceAdjustments: confidenceResult.adjustments
        },
        impact,
        edge
      );

      candidates.push(candidate);
    }

    return candidates;
  }

  private applyFilters(edges: CallEdge[]): CallEdge[] {
    let filtered = edges;

    if (this.options.caller) {
      const pattern = new RegExp(this.options.caller.replace(/\*/g, '.*'), 'i');
      filtered = filtered.filter(edge => {
        const callerFunction = this.functionMap.get(edge.callerFunctionId);
        return callerFunction && pattern.test(callerFunction.name);
      });
    }

    if (this.options.callee) {
      const pattern = new RegExp(this.options.callee.replace(/\*/g, '.*'), 'i');
      filtered = filtered.filter(edge => pattern.test(edge.calleeName || ''));
    }

    if (this.options.type) {
      filtered = filtered.filter(edge => edge.callType === this.options.type);
    }

    if (this.options.file) {
      const pattern = new RegExp(this.options.file.replace(/\*/g, '.*'), 'i');
      filtered = filtered.filter(edge => {
        const callerFunction = this.functionMap.get(edge.callerFunctionId);
        return callerFunction && pattern.test(callerFunction.filePath);
      });
    }

    return filtered;
  }
}

/**
 * Enhanced list function dependencies with safe-delete patterns
 */
export const depListCommand: VoidCommand<DepListOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = options.verbose ? ora('Analyzing dependencies...').start() : null;

    try {
      const snapshot = await loadSnapshotForDepList(env, options, spinner);
      if (!snapshot) return;

      const { functions, callEdges, functionMap } = await loadDepListData(env, snapshot, spinner);
      if (!callEdges) return;

      const result = await performDepListAnalysis(functions, callEdges, functionMap, options, spinner);
      const formattedResults = processDepListResults(result, options);
      
      outputDepListResults(formattedResults.output, formattedResults.metadata, options);

    } catch (error) {
      handleDepListError(error, spinner, errorHandler);
    }
  };

/**
 * Load snapshot for dep list command
 */
async function loadSnapshotForDepList(
  env: CommandEnvironment, 
  options: DepListOptions, 
  spinner: any
) {
  const snapshot = options.snapshot ? 
    await env.storage.getSnapshot(options.snapshot) :
    await env.storage.getLatestSnapshot();

  if (!snapshot) {
    spinner?.fail(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
    if (!spinner) console.log(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
    return null;
  }

  return snapshot;
}

/**
 * Load data needed for dep list analysis
 */
async function loadDepListData(env: CommandEnvironment, snapshot: any, spinner: any) {
  spinner && (spinner.text = 'Loading functions and call graph...');

  const [functions, callEdges] = await Promise.all([
    env.storage.getFunctionsBySnapshot(snapshot.id),
    env.storage.getCallEdgesBySnapshot(snapshot.id)
  ]);

  if (callEdges.length === 0) {
    spinner?.fail(chalk.yellow('No call graph data found.'));
    if (!spinner) console.log(chalk.yellow('No call graph data found.'));
    return { functions, callEdges: null, functionMap: null };
  }

  const functionMap = new Map(functions.map(f => [f.id, f]));
  return { functions, callEdges, functionMap };
}

/**
 * Perform dependency analysis for dep list
 */
async function performDepListAnalysis(
  functions: any[], 
  callEdges: any[], 
  functionMap: Map<string, any>, 
  options: DepListOptions, 
  spinner: any
) {
  const analysisEngine = new DependencyAnalysisEngine();
  const candidateGenerator = new DependencyListCandidateGenerator(options, functionMap);

  const analysisOptions: Partial<DependencyAnalysisOptions> = {
    confidenceThreshold: parseFloat(options.confidenceThreshold || '0.7'),
    maxItemsPerBatch: parseInt(options.limit || '100'),
    excludeExports: options.excludeExports || false,
    excludePatterns: options.exclude || [],
    verbose: options.verbose || false,
    dryRun: true
  };

  spinner && (spinner.text = 'Performing dependency analysis...');

  const result = await analysisEngine.analyzeDependencies(
    functions,
    callEdges,
    candidateGenerator,
    analysisOptions
  );

  spinner?.succeed('Dependency analysis completed');
  return result;
}

/**
 * Process and format dep list results
 */
function processDepListResults(result: any, options: DepListOptions) {
  const sortedResults = sortDependencyResults(result.analysisResults, options);
  const limit = parseInt(options.limit || '20');
  const limitedResults = sortedResults.slice(0, limit);

  const formattingOptions: Partial<AnalysisFormattingOptions> = {
    format: options.json ? 'json' : 'table',
    verbose: options.verbose || false,
    showConfidence: options.showConfidence !== false,
    showMetadata: options.verbose || false,
    groupBy: options.groupBy || 'file',
    sortBy: mapSortOption(options.sort) || 'confidence',
    sortOrder: options.desc ? 'desc' : 'asc',
    maxItems: limit,
    colors: !options.json
  };

  const formattedOutput = AnalysisFormatter.formatAnalysisResults(
    { ...result, analysisResults: limitedResults },
    'Function Dependencies',
    formattingOptions
  );

  return { output: formattedOutput, metadata: result.metadata };
}

/**
 * Output dep list results
 */
function outputDepListResults(output: any, metadata: any, options: DepListOptions) {
  console.log(output.content);

  if (options.verbose && !options.json) {
    console.log(chalk.dim('\n📊 Performance Stats:'));
    console.log(chalk.dim(`  Total processing time: ${metadata.processingTime.total}ms`));
    console.log(chalk.dim(`  High-confidence edges: ${metadata.highConfidenceEdges}/${metadata.totalEdges}`));
  }
}

/**
 * Handle dep list command errors
 */
function handleDepListError(error: unknown, spinner: any, errorHandler: any) {
  spinner?.fail('Failed to analyze dependencies');
  if (error instanceof DatabaseError) {
    const funcqcError = errorHandler.createError(
      error.code,
      error.message,
      {},
      error.originalError
    );
    errorHandler.handleError(funcqcError);
  } else {
    errorHandler.handleError(error instanceof Error ? error : new Error((error as any).toString()));
  }
}

/**
 * Load snapshot for dep show command
 */
async function loadSnapshotForDepShow(env: CommandEnvironment, options: DepShowOptions, spinner: any) {
  const snapshot = options.snapshot ? 
    await env.storage.getSnapshot(options.snapshot) :
    await env.storage.getLatestSnapshot();

  if (!snapshot) {
    spinner?.fail(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
    if (!spinner) console.log(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
    return null;
  }

  return snapshot;
}

/**
 * Find target function for dep show command
 */
async function findTargetFunctionForDepShow(
  env: CommandEnvironment, 
  snapshot: any, 
  functionRef: string, 
  spinner: any
) {
  spinner && (spinner.text = 'Finding target function...');

  const functions = await env.storage.getFunctionsBySnapshot(snapshot.id);
  const targetFunction = functions.find(f => 
    f.id === functionRef || 
    f.name === functionRef ||
    f.name.includes(functionRef)
  );

  if (!targetFunction) {
    spinner?.fail(chalk.red(`Function "${functionRef}" not found.`));
    if (!spinner) console.log(chalk.red(`Function "${functionRef}" not found.`));
    return null;
  }

  return targetFunction;
}

/**
 * Build dependency tree for dep show command
 */
async function buildDepShowTree(
  env: CommandEnvironment, 
  snapshot: any, 
  targetFunction: any, 
  options: DepShowOptions, 
  spinner: any
) {
  spinner && (spinner.text = 'Loading call graph...');

  const callEdges = await env.storage.getCallEdgesBySnapshot(snapshot.id);
  const confidenceThreshold = parseFloat(options.confidenceThreshold || '0.7');
  const highConfidenceEdges = callEdges.filter(edge => 
    !edge.confidenceScore || edge.confidenceScore >= confidenceThreshold
  );

  spinner && (spinner.text = 'Building dependency tree...');

  const functions = await env.storage.getFunctionsBySnapshot(snapshot.id);
  const maxDepth = parseInt(options.depth || '2');
  const dependencyTree = buildEnhancedDependencyTree(
    targetFunction,
    highConfidenceEdges,
    functions,
    options.direction || 'both',
    maxDepth,
    options.includeExternal || false,
    confidenceThreshold
  );

  spinner?.succeed('Dependency analysis completed');

  return {
    dependencyTree,
    confidenceThreshold,
    maxDepth
  };
}

/**
 * Output dep show results
 */
function outputDepShowResults(targetFunction: any, depTreeData: any, options: DepShowOptions) {
  if (options.json) {
    console.log(JSON.stringify({
      function: {
        id: targetFunction.id,
        name: targetFunction.name,
        filePath: targetFunction.filePath,
        location: `${targetFunction.startLine}-${targetFunction.endLine}`
      },
      dependencies: depTreeData.dependencyTree,
      metadata: {
        confidenceThreshold: depTreeData.confidenceThreshold,
        maxDepth: depTreeData.maxDepth,
        direction: options.direction || 'both',
        includeExternal: options.includeExternal || false
      }
    }, null, 2));
  } else {
    outputEnhancedDependencyTree(targetFunction, depTreeData.dependencyTree, options);
  }
}

/**
 * Handle dep show command errors
 */
function handleDepShowError(error: unknown, spinner: any, errorHandler: any) {
  spinner?.fail('Failed to analyze dependencies');
  errorHandler.handleError(error instanceof Error ? error : new Error((error as any).toString()));
}

/**
 * Enhanced show detailed dependency information with safe-delete patterns
 */
export const depShowCommand = (functionRef: string): VoidCommand<DepShowOptions> => 
  (options) => async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = options.verbose ? ora('Loading dependency information...').start() : null;

    try {
      const snapshot = await loadSnapshotForDepShow(env, options, spinner);
      if (!snapshot) return;

      const targetFunction = await findTargetFunctionForDepShow(env, snapshot, functionRef, spinner);
      if (!targetFunction) return;

      const depTreeData = await buildDepShowTree(env, snapshot, targetFunction, options, spinner);
      outputDepShowResults(targetFunction, depTreeData, options);

    } catch (error) {
      handleDepShowError(error, spinner, errorHandler);
    }
  };

/**
 * Enhanced dependency statistics with confidence analysis
 */
export const depStatsCommand: VoidCommand<DepStatsOptions> = (options) =>
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora('Calculating enhanced dependency metrics...').start();

    try {
      const snapshot = await loadSnapshotForDepStats(env, options, spinner);
      if (!snapshot) return;

      const { functions, callEdges } = await loadDepStatsData(env, snapshot, spinner);
      const { result, metrics, stats } = await calculateDepStatsMetrics(functions, callEdges, options, spinner);
      
      outputDepStatsResults(result, metrics, stats, functions, callEdges, options);

    } catch (error) {
      handleDepStatsError(error, spinner, errorHandler);
    }
  };

/**
 * Load snapshot for dep stats command
 */
async function loadSnapshotForDepStats(env: CommandEnvironment, options: DepStatsOptions, spinner: any) {
  const snapshot = options.snapshot ? 
    await env.storage.getSnapshot(options.snapshot) :
    await env.storage.getLatestSnapshot();

  if (!snapshot) {
    spinner.fail(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
    return null;
  }

  return snapshot;
}

/**
 * Load data for dep stats analysis
 */
async function loadDepStatsData(env: CommandEnvironment, snapshot: any, spinner: any) {
  spinner.text = 'Loading functions and call graph...';

  const [functions, callEdges] = await Promise.all([
    env.storage.getFunctionsBySnapshot(snapshot.id),
    env.storage.getCallEdgesBySnapshot(snapshot.id)
  ]);

  return { functions, callEdges };
}

/**
 * Calculate dependency statistics metrics
 */
async function calculateDepStatsMetrics(
  functions: any[], 
  callEdges: any[], 
  options: DepStatsOptions, 
  spinner: any
) {
  spinner.text = 'Performing enhanced dependency analysis...';

  const analysisEngine = new DependencyAnalysisEngine();
  const statsGenerator = new DependencyStatsCandidateGenerator(functions);

  const result = await analysisEngine.analyzeDependencies(
    functions,
    callEdges,
    statsGenerator,
    { verbose: options.verbose || false }
  );

  spinner.text = 'Calculating dependency metrics...';

  const metricsCalculator = new DependencyMetricsCalculator();
  const metrics = metricsCalculator.calculateMetrics(
    functions,
    callEdges,
    new Set(result.metadata.entryPoints),
    new Set() // TODO: Detect cyclic functions
  );

  const dependencyOptions: DependencyOptions = {
    hubThreshold: parseInt(options.hubThreshold || '5'),
    utilityThreshold: parseInt(options.utilityThreshold || '5'),
    maxHubFunctions: parseInt(options.maxHubFunctions || '10'),
    maxUtilityFunctions: parseInt(options.maxUtilityFunctions || '10')
  };

  const stats = metricsCalculator.generateStats(metrics, dependencyOptions);
  spinner.succeed('Enhanced dependency metrics calculated');

  return { result, metrics, stats };
}

/**
 * Output dep stats results
 */
async function outputDepStatsResults(
  result: any, 
  metrics: any[], 
  stats: any, 
  functions: any[], 
  callEdges: any[], 
  options: DepStatsOptions
) {
  if (options.format === 'dot') {
    await outputEnhancedDepStatsDot(functions, callEdges, metrics, options);
  } else if (options.json || options.format === 'json') {
    outputEnhancedDepStatsJSON(result, metrics, stats, options);
  } else {
    outputEnhancedDepStatsTable(result, metrics, stats, options);
  }
}

/**
 * Handle dep stats command errors
 */
function handleDepStatsError(error: unknown, spinner: any, errorHandler: any) {
  spinner.fail('Failed to calculate dependency metrics');
  errorHandler.handleError(error instanceof Error ? error : new Error((error as any).toString()));
}

/**
 * Enhanced architecture lint with confidence-based validation
 */
export const depLintCommand: VoidCommand<DepLintOptions> = (options) =>
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora('Loading architecture configuration...').start();

    try {
      const archConfig = await loadDepLintConfig(options, spinner);
      if (!archConfig) return;

      const snapshot = await loadSnapshotForDepLint(env, options, spinner);
      if (!snapshot) return;

      const { functions, callEdges } = await loadDepLintData(env, snapshot, spinner);
      const result = await performDepLintAnalysis(functions, callEdges, archConfig, options);
      const violations = processDepLintViolations(result, functions, callEdges, archConfig, options);
      
      outputDepLintResults(violations, result, options);
      handleDepLintExit(violations);

    } catch (error) {
      handleDepLintError(error, spinner, errorHandler);
    }
  };

/**
 * Load architecture configuration for dep lint command
 */
async function loadDepLintConfig(options: DepLintOptions, spinner: any) {
  const { ArchitectureConfigManager } = await import('../config/architecture-config');
  const configManager = new ArchitectureConfigManager();
  const archConfig = configManager.load(options.config);

  if (Object.keys(archConfig.layers).length === 0) {
    spinner.fail(chalk.yellow('No architecture layers defined.'));
    console.log(chalk.dim('\nCreate a .funcqc-arch.yaml configuration file with layer definitions.'));
    return null;
  }

  return archConfig;
}

/**
 * Load snapshot for dep lint command
 */
async function loadSnapshotForDepLint(env: CommandEnvironment, options: DepLintOptions, spinner: any) {
  spinner.text = 'Loading snapshot data...';

  const snapshot = options.snapshot ? 
    await env.storage.getSnapshot(options.snapshot) :
    await env.storage.getLatestSnapshot();

  if (!snapshot) {
    spinner.fail(chalk.yellow('No snapshots found. Run `funcqc scan` first.'));
    return null;
  }

  return snapshot;
}

/**
 * Load data for dep lint analysis
 */
async function loadDepLintData(env: CommandEnvironment, snapshot: any, spinner: any) {
  spinner.text = 'Performing enhanced architecture analysis...';

  const [functions, callEdges] = await Promise.all([
    env.storage.getFunctionsBySnapshot(snapshot.id),
    env.storage.getCallEdgesBySnapshot(snapshot.id)
  ]);

  return { functions, callEdges };
}

/**
 * Perform dep lint analysis
 */
async function performDepLintAnalysis(
  functions: any[], 
  callEdges: any[], 
  archConfig: any, 
  options: DepLintOptions
) {
  const analysisEngine = new DependencyAnalysisEngine();
  const lintGenerator = new ArchitectureLintCandidateGenerator(archConfig);

  const analysisOptions: Partial<DependencyAnalysisOptions> = {
    confidenceThreshold: parseFloat(options.confidenceThreshold || '0.8'),
    verbose: options.verbose || false
  };

  return await analysisEngine.analyzeDependencies(
    functions,
    callEdges,
    lintGenerator,
    analysisOptions
  );
}

/**
 * Process violations for dep lint command
 */
function processDepLintViolations(
  result: any, 
  functions: any[], 
  callEdges: any[], 
  archConfig: any, 
  options: DepLintOptions
) {
  const validator = new ArchitectureValidator(archConfig);
  const confidenceThreshold = parseFloat(options.confidenceThreshold || '0.8');
  const highConfidenceEdges = callEdges.filter(edge => 
    !edge.confidenceScore || edge.confidenceScore >= confidenceThreshold
  );
  const architectureResult = validator.analyzeArchitecture(functions, highConfidenceEdges);

  let violations = architectureResult.violations;
  
  if (options.severity) {
    const severityOrder = { info: 1, warning: 2, error: 3 };
    const minSeverity = severityOrder[options.severity];
    violations = violations.filter(v => severityOrder[v.severity] >= minSeverity);
  }

  if (options.maxViolations) {
    const limit = parseInt(options.maxViolations);
    violations = violations.slice(0, limit);
  }

  return { violations, architectureResult, result };
}

/**
 * Output dep lint results
 */
function outputDepLintResults(violationsData: any, result: any, options: DepLintOptions) {
  const { violations, architectureResult } = violationsData;
  
  const violationCandidates = violations.map((v: any) => ({
    functionInfo: violationsData.result.analysisResults.find((f: any) => f.functionInfo.id === v.source.functionId)?.functionInfo!,
    confidenceScore: 1.0,
    analysisReason: v.message,
    metadata: {
      violation: v,
      layer: v.source.layer,
      targetLayer: v.target.layer
    },
    estimatedImpact: v.severity === 'error' ? 'high' : v.severity === 'warning' ? 'medium' : 'low'
  })) as AnalysisCandidate[];

  const formattingOptions: Partial<AnalysisFormattingOptions> = {
    format: options.format === 'json' ? 'json' : 'table',
    verbose: options.verbose || false,
    showConfidence: options.showConfidence !== false,
    showMetadata: options.includeMetrics || false,
    groupBy: mapGroupByOption(options.groupBy) || 'file',
    colors: options.format !== 'json'
  };

  const formattedOutput = AnalysisFormatter.formatAnalysisResults(
    {
      analysisResults: violationCandidates,
      errors: result.errors,
      warnings: result.warnings,
      metadata: {
        ...result.metadata,
        architectureSummary: architectureResult.summary,
        architectureMetrics: architectureResult.metrics
      }
    },
    'Architecture Lint Report',
    formattingOptions
  );

  console.log(formattedOutput.content);
}

/**
 * Handle exit for dep lint command
 */
function handleDepLintExit(violationsData: any) {
  if (violationsData.violations.some((v: any) => v.severity === 'error')) {
    process.exit(1);
  }
}

/**
 * Handle dep lint command errors
 */
function handleDepLintError(error: unknown, spinner: any, errorHandler: any) {
  spinner.fail('Failed to analyze architecture');
  errorHandler.handleError(error instanceof Error ? error : new Error((error as any).toString()));
}

// Helper classes and functions

/**
 * Map sort option to AnalysisFormattingOptions sort
 */
function mapSortOption(sort?: string): 'name' | 'confidence' | 'impact' | 'file' | undefined {
  switch (sort) {
    case 'caller':
    case 'callee':
      return 'name';
    case 'line':
      return 'file';
    case 'confidence':
      return 'confidence';
    default:
      return undefined;
  }
}

/**
 * Map groupBy option to AnalysisFormattingOptions groupBy
 */
function mapGroupByOption(groupBy?: string): 'file' | 'confidence' | 'impact' | 'none' | undefined {
  switch (groupBy) {
    case 'severity':
      return 'impact'; // Map severity to impact
    case 'rule':
      return 'file'; // Map rule to file
    case 'file':
    case 'confidence':
    case 'impact':
    case 'none':
      return groupBy;
    default:
      return undefined;
  }
}

/**
 * Stats candidate generator
 */
class DependencyStatsCandidateGenerator implements CandidateGenerator<AnalysisCandidate> {
  constructor(private functions: FunctionInfo[]) {}

  async generateCandidates(): Promise<AnalysisCandidate[]> {
    // For stats, we analyze all functions
    return this.functions.map(func => ({
      functionInfo: func,
      confidenceScore: 1.0,
      analysisReason: 'Dependency statistics analysis',
      metadata: {},
      estimatedImpact: 'low' as const
    }));
  }
}

/**
 * Architecture lint candidate generator
 */
class ArchitectureLintCandidateGenerator implements CandidateGenerator<AnalysisCandidate> {
  constructor(archConfig: any) {
    // archConfig is passed in but not used directly in this generator
    void archConfig;
  }

  async generateCandidates(
    functions: FunctionInfo[]
  ): Promise<AnalysisCandidate[]> {
    // For lint, we analyze all functions
    return functions.map(func => ({
      functionInfo: func,
      confidenceScore: 1.0,
      analysisReason: 'Architecture compliance check',
      metadata: {},
      estimatedImpact: 'medium' as const
    }));
  }
}

/**
 * Sort dependency results based on options
 */
function sortDependencyResults(
  results: DependencyListCandidate[],
  options: DepListOptions
): DependencyListCandidate[] {
  const sorted = [...results];
  const sortField = options.sort || 'confidence';

  sorted.sort((a, b) => {
    switch (sortField) {
      case 'caller':
        return a.functionInfo.name.localeCompare(b.functionInfo.name);
      case 'callee':
        return (a.callEdge.calleeName || '').localeCompare(b.callEdge.calleeName || '');
      case 'file':
        return a.functionInfo.filePath.localeCompare(b.functionInfo.filePath);
      case 'line':
        return (a.callEdge.lineNumber || 0) - (b.callEdge.lineNumber || 0);
      case 'confidence':
        return b.confidenceScore - a.confidenceScore;
      default:
        return 0;
    }
  });

  if (options.desc) {
    sorted.reverse();
  }

  return sorted;
}

interface EnhancedDependencyTreeNode {
  id: string;
  name: string;
  depth: number;
  confidenceScore: number;
  impact: 'low' | 'medium' | 'high';
  dependencies: Array<{
    direction: 'in' | 'out';
    edge: CallEdge;
    confidenceScore: number;
    subtree: EnhancedDependencyTreeNode | null;
  }>;
}

/**
 * Build enhanced dependency tree with confidence scores
 */
function buildEnhancedDependencyTree(
  targetFunction: FunctionInfo,
  edges: CallEdge[],
  functions: FunctionInfo[],
  direction: 'in' | 'out' | 'both',
  maxDepth: number,
  includeExternal: boolean,
  confidenceThreshold: number
): EnhancedDependencyTreeNode {
  const visited = new Set<string>();
  const functionMap = new Map(functions.map(f => [f.id, f]));

  function buildTree(
    currentId: string,
    depth: number,
    dir: 'in' | 'out'
  ): EnhancedDependencyTreeNode | null {
    if (depth > maxDepth || visited.has(currentId)) {
      return null;
    }

    visited.add(currentId);

    const currentFunction = functionMap.get(currentId) || targetFunction;
    const callersCount = edges.filter(e => e.calleeFunctionId === currentId).length;
    const impact = DependencyAnalysisEngine.estimateImpact(currentFunction, callersCount);

    const result: EnhancedDependencyTreeNode = {
      id: currentId,
      name: currentFunction.name,
      depth,
      confidenceScore: 1.0,
      impact,
      dependencies: []
    };

    if (dir === 'in' || direction === 'both') {
      const incoming = edges.filter(edge => 
        edge.calleeFunctionId === currentId &&
        (includeExternal || edge.callType !== 'external') &&
        (!edge.confidenceScore || edge.confidenceScore >= confidenceThreshold)
      );

      for (const edge of incoming) {
        const confidenceResult = ConfidenceCalculator.calculateCallEdgeConfidence(edge);
        result.dependencies.push({
          direction: 'in',
          edge,
          confidenceScore: confidenceResult.finalScore,
          subtree: buildTree(edge.callerFunctionId, depth + 1, 'in')
        });
      }
    }

    if (dir === 'out' || direction === 'both') {
      const outgoing = edges.filter(edge => 
        edge.callerFunctionId === currentId &&
        (includeExternal || edge.callType !== 'external') &&
        (!edge.confidenceScore || edge.confidenceScore >= confidenceThreshold)
      );

      for (const edge of outgoing) {
        if (!edge.calleeFunctionId) continue;
        const confidenceResult = ConfidenceCalculator.calculateCallEdgeConfidence(edge);
        result.dependencies.push({
          direction: 'out',
          edge,
          confidenceScore: confidenceResult.finalScore,
          subtree: buildTree(edge.calleeFunctionId, depth + 1, 'out')
        });
      }
    }

    return result;
  }

  return buildTree(targetFunction.id, 0, direction === 'both' ? 'out' : direction) || {
    id: targetFunction.id,
    name: targetFunction.name,
    depth: 0,
    confidenceScore: 1.0,
    impact: 'low',
    dependencies: []
  };
}

/**
 * Output enhanced dependency tree
 */
function outputEnhancedDependencyTree(
  func: FunctionInfo,
  tree: EnhancedDependencyTreeNode,
  options: DepShowOptions
): void {
  console.log(chalk.bold(`\n🔍 Enhanced Dependency Analysis for: ${chalk.cyan(func.name)}`));
  console.log(chalk.gray(`ID: ${func.id}`));
  console.log(chalk.gray(`File: ${func.filePath}:${func.startLine}`));
  console.log(chalk.gray(`Confidence threshold: ${options.confidenceThreshold || '0.7'}`));
  console.log();

  function printTree(
    node: EnhancedDependencyTreeNode | null,
    prefix: string = '',
    isLast: boolean = true
  ): void {
    if (!node) return;

    const connector = isLast ? '└── ' : '├── ';
    const nameColor = node.depth === 0 ? chalk.bold.cyan : 
                      node.impact === 'high' ? chalk.red :
                      node.impact === 'medium' ? chalk.yellow :
                      chalk.green;
    
    let nodeInfo = `${prefix}${connector}${nameColor(node.name)}`;
    
    if (options.showConfidence !== false && node.confidenceScore < 1) {
      nodeInfo += chalk.gray(` [${(node.confidenceScore * 100).toFixed(0)}%]`);
    }
    
    if (options.verbose) {
      nodeInfo += chalk.dim(` (${node.id.substring(0, 8)}, ${node.impact} impact)`);
    }
    
    console.log(nodeInfo);
    
    if (node.dependencies.length > 0) {
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      
      node.dependencies.forEach((dep, index) => {
        const isLastDep = index === node.dependencies.length - 1;
        const arrow = dep.direction === 'in' ? '← ' : '→ ';
        const typeColor = getCallTypeColor(dep.edge.callType || 'direct');
        
        let depInfo = `${newPrefix}${isLastDep ? '└── ' : '├── '}${arrow}${typeColor(dep.edge.callType || 'direct')}`;
        
        if (options.showConfidence !== false) {
          depInfo += chalk.gray(` [${(dep.confidenceScore * 100).toFixed(0)}%]`);
        }
        
        if (options.verbose) {
          depInfo += chalk.dim(` (line ${dep.edge.lineNumber})`);
        }
        
        console.log(depInfo);
        
        if (dep.subtree) {
          printTree(dep.subtree, newPrefix + (isLastDep ? '    ' : '│   '), true);
        }
      });
    }
  }

  printTree(tree);
  console.log();

  // Summary in verbose mode
  if (options.verbose) {
    const totalDeps = countDependencies(tree);
    console.log(chalk.dim('─'.repeat(60)));
    console.log(chalk.dim(`Total dependencies: ${totalDeps}`));
    console.log(chalk.dim(`Max depth: ${options.depth || 2}`));
    console.log(chalk.dim(`Direction: ${options.direction || 'both'}`));
  }
}

/**
 * Get color for call type
 */
function getCallTypeColor(type: string): (text: string) => string {
  switch (type) {
    case 'direct':
      return chalk.green;
    case 'async':
      return chalk.blue;
    case 'conditional':
      return chalk.yellow;
    case 'external':
      return chalk.gray;
    default:
      return chalk.white;
  }
}

/**
 * Count total dependencies in tree
 */
function countDependencies(node: EnhancedDependencyTreeNode): number {
  let count = node.dependencies.length;
  for (const dep of node.dependencies) {
    if (dep.subtree) {
      count += countDependencies(dep.subtree);
    }
  }
  return count;
}

/**
 * Output enhanced stats as JSON
 */
function outputEnhancedDepStatsJSON(
  analysisResult: any,
  metrics: DependencyMetrics[],
  stats: DependencyStats,
  options: DepStatsOptions
): void {
  const output = {
    summary: {
      ...stats,
      analysisMetadata: analysisResult.metadata
    },
    metrics: metrics.slice(0, parseInt(options.limit || '20')),
    confidenceDistribution: ConfidenceCalculator.summarizeConfidenceResults(
      analysisResult.analysisResults.map((r: any) => ({
        finalScore: r.confidenceScore,
        baseScore: 0.9,
        adjustments: [],
        metadata: {}
      }))
    )
  };

  console.log(JSON.stringify(output, null, 2));
}

/**
 * Output enhanced stats as table
 */
function outputEnhancedDepStatsTable(
  analysisResult: any,
  metrics: DependencyMetrics[],
  stats: DependencyStats,
  options: DepStatsOptions
): void {
  // Use AnalysisFormatter for consistent output
  const candidates = metrics.slice(0, parseInt(options.limit || '20')).map(m => ({
    functionInfo: { id: m.functionId, name: m.functionName } as FunctionInfo,
    confidenceScore: 1.0,
    analysisReason: 'Dependency metrics',
    metadata: {
      fanIn: m.fanIn,
      fanOut: m.fanOut,
      depth: m.depthFromEntry,
      cyclic: m.isCyclic
    },
    estimatedImpact: m.fanIn > 10 ? 'high' : m.fanIn > 5 ? 'medium' : 'low'
  })) as AnalysisCandidate[];

  const formattingOptions: Partial<AnalysisFormattingOptions> = {
    format: 'table',
    verbose: options.verbose || false,
    showConfidence: false,
    showMetadata: options.showMetadata || false,
    groupBy: 'none',
    colors: true
  };

  const formattedOutput = AnalysisFormatter.formatAnalysisResults(
    {
      analysisResults: candidates,
      errors: [],
      warnings: [],
      metadata: analysisResult.metadata
    },
    'Dependency Statistics',
    formattingOptions
  );

  // Add custom stats summary
  console.log(chalk.bold('\n📊 Summary Statistics:'));
  console.log(`Total functions: ${chalk.cyan(stats.totalFunctions)}`);
  console.log(`Average fan-in: ${chalk.yellow(stats.avgFanIn.toFixed(1))}`);
  console.log(`Average fan-out: ${chalk.yellow(stats.avgFanOut.toFixed(1))}`);
  console.log(`Hub functions: ${chalk.red(stats.hubFunctions.length)}`);
  console.log(`Utility functions: ${chalk.blue(stats.utilityFunctions.length)}`);
  console.log(`Isolated functions: ${chalk.gray(stats.isolatedFunctions.length)}`);

  console.log(formattedOutput.content);
}

/**
 * Output enhanced DOT format
 */
async function outputEnhancedDepStatsDot(
  functions: FunctionInfo[],
  callEdges: CallEdge[],
  metrics: DependencyMetrics[],
  _options: DepStatsOptions
): Promise<void> {
  // Dynamically import DotGenerator to avoid circular dependency
  const { DotGenerator } = await import('../visualization/dot-generator');
  const dotGenerator = new DotGenerator();
  
  // Filter by confidence
  const confidenceThreshold = 0.7;
  const highConfidenceEdges = callEdges.filter(edge => 
    !edge.confidenceScore || edge.confidenceScore >= confidenceThreshold
  );

  const dotOptions = {
    title: 'Enhanced Dependency Graph',
    rankdir: 'LR' as const,
    nodeShape: 'box' as const,
    includeMetrics: true,
    includeConfidence: true,
    clusterBy: 'file' as const,
    showLabels: true,
    maxLabelLength: 25
  };

  const dotOutput = dotGenerator.generateDependencyGraph(
    functions,
    highConfidenceEdges,
    metrics,
    dotOptions
  );

  console.log(dotOutput);
}
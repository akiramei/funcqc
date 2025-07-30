import ora from 'ora';
import chalk from 'chalk';
import fs from 'fs';
import { SimilarityManager } from '../../similarity/similarity-manager';
import { FunctionInfo, SimilarityResult, ConsensusStrategy } from '../../types';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';
import { BaseCommandOptions } from '../../types/command';
import { ArchitectureConfigManager } from '../../config/architecture-config';
import { LayerAssigner } from '../../analyzers/layer-assigner';
import { ArchitectureConfig, ArchitectureRule } from '../../types/architecture';

export interface SimilarCommandOptions extends BaseCommandOptions {
  threshold?: string;
  json?: boolean;
  jsonl?: boolean; // JSON Lines format
  snapshot?: string;
  minLines?: string;
  crossFile?: boolean;
  detectors?: string;
  consensus?: string;
  output?: string;
  limit?: string;
  archAnalysis?: boolean; // Architecture rule analysis for refactoring guidance
}

interface DetectionConfig {
  threshold: number;
  minLines: number;
  limit: number | undefined;
  enabledDetectors: string[];
  consensusStrategy: ConsensusStrategy | undefined;
  crossFile: boolean;
}

interface ArchitectureAnalysis {
  safe: boolean;
  reason: string;
  severity: 'safe' | 'caution' | 'violation';
  recommendation: string;
  layers: string[];
  ruleViolations: string[];
}

interface AnalyzedSimilarityResult extends SimilarityResult {
  architectureAnalysis?: ArchitectureAnalysis;
}

/**
 * Similar command as a Reader function
 * Uses shared storage from environment to detect similar functions
 */
export const similarCommand: VoidCommand<SimilarCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora();

    try {
      const functions = await loadFunctions(env, options, spinner);
      const detectionConfig = parseDetectionOptions(options);
      let results = await detectSimilarities(functions, detectionConfig, spinner);
      
      // Add architecture analysis if requested
      if (options.archAnalysis) {
        results = await addArchitectureAnalysis(results, spinner);
      }
      
      const limitedResults = applyLimit(results, detectionConfig.limit);

      outputResults(limitedResults, options, env);
      showSummaryIfNeeded(results, limitedResults, options, env);
    } catch (error) {
      spinner.fail();
      if (error instanceof DatabaseError) {
        const funcqcError = errorHandler.createError(
          error.code,
          error.message,
          {},
          error.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze similar functions: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

async function loadFunctions(
  env: CommandEnvironment,
  options: SimilarCommandOptions,
  spinner: ReturnType<typeof ora>
): Promise<FunctionInfo[]> {
  spinner.start('Loading functions...');

  let functions: FunctionInfo[];
  // Similarity analysis requires full function data including sourceCode
  const queryOptions = { includeFullData: true };
  
  if (options.snapshot) {
    functions = await env.storage.findFunctionsInSnapshot(options.snapshot, queryOptions);
  } else {
    const snapshots = await env.storage.getSnapshots({ limit: 1 });
    if (snapshots.length === 0) {
      throw new Error('No snapshots found. Run "funcqc scan" first.');
    }
    functions = await env.storage.findFunctionsInSnapshot(snapshots[0].id, queryOptions);
  }

  spinner.succeed(`Loaded ${functions.length} functions`);
  return functions;
}

function parseDetectionOptions(options: SimilarCommandOptions): DetectionConfig {
  const threshold = options.threshold ? parseFloat(options.threshold) : 0.95;
  const minLines = options.minLines ? parseInt(options.minLines) : 3;
  const limit = options.limit ? parseInt(options.limit) : undefined;
  const enabledDetectors = options.detectors ? options.detectors.split(',') : [];
  const consensusStrategy = options.consensus
    ? parseConsensusStrategy(options.consensus)
    : undefined;
  const crossFile = options.crossFile !== false;

  return {
    threshold,
    minLines,
    limit,
    enabledDetectors,
    consensusStrategy,
    crossFile,
  };
}

async function detectSimilarities(
  functions: FunctionInfo[],
  config: DetectionConfig,
  spinner: ReturnType<typeof ora>
): Promise<SimilarityResult[]> {
  const similarityOptions = {
    threshold: config.threshold,
    minLines: config.minLines,
    crossFile: config.crossFile,
  };
  const similarityManager = new SimilarityManager(undefined, similarityOptions);

  spinner.start('Detecting similar functions...');

  // Add timeout warning for slow operations
  const timeoutWarning = setTimeout(() => {
    spinner.text = 'Still processing... (use higher threshold for faster results)';
  }, 5000);

  const results = await similarityManager.detectSimilarities(
    functions,
    {
      threshold: config.threshold,
      minLines: config.minLines,
      crossFile: config.crossFile,
    },
    config.enabledDetectors,
    config.consensusStrategy
  );

  clearTimeout(timeoutWarning);
  spinner.succeed(`Found ${results.length} groups of similar functions`);
  return results;
}

function applyLimit(results: SimilarityResult[], limit: number | undefined): SimilarityResult[] {
  return limit ? results.slice(0, limit) : results;
}

function outputResults(
  results: SimilarityResult[],
  options: SimilarCommandOptions,
  env: CommandEnvironment
): void {
  if (options.json || options.jsonl) {
    outputJSON(results, options.output, options.jsonl);
  } else {
    displayResults(results, env.commandLogger);
  }
}

function showSummaryIfNeeded(
  allResults: SimilarityResult[],
  displayedResults: SimilarityResult[],
  options: SimilarCommandOptions,
  env: CommandEnvironment
): void {
  if (!options.json && !options.quiet) {
    displaySummary(allResults, displayedResults, env.commandLogger);
  }
}

function parseConsensusStrategy(input: string): ConsensusStrategy {
  const parts = input.split(':');
  const strategy = parts[0];

  switch (strategy) {
    case 'majority':
      return {
        strategy: 'majority',
        threshold: parts[1] ? parseFloat(parts[1]) : 0.5,
      };

    case 'intersection':
      return { strategy: 'intersection' };

    case 'union':
      return { strategy: 'union' };

    case 'weighted': {
      // Parse weighted format: weighted:detector1=0.5,detector2=0.3
      const weightings: Record<string, number> = {};
      if (parts[1]) {
        const weights = parts[1].split(',');
        for (const weight of weights) {
          const [detector, value] = weight.split('=');
          weightings[detector] = parseFloat(value);
        }
      }
      return { strategy: 'weighted', weightings };
    }

    default:
      throw new Error(`Unknown consensus strategy: ${strategy}`);
  }
}

function calculatePriority(result: SimilarityResult): number {
  // Priority based on similarity score and total lines of code
  const totalLines = result.functions.reduce((sum, func) => {
    const lines = func.originalFunction?.metrics?.linesOfCode || 0;
    return sum + lines;
  }, 0);

  return result.similarity * totalLines;
}

function outputJSON(
  results: SimilarityResult[],
  outputPath?: string,
  jsonLines: boolean = false
): void {
  // Add priority and sort by it
  const enrichedResults = results
    .map(result => ({
      ...result,
      priority: calculatePriority(result),
      refactoringImpact: calculateRefactoringImpact(result),
    }))
    .sort((a, b) => b.priority - a.priority);

  if (jsonLines) {
    outputJSONLines(enrichedResults, outputPath);
    return;
  }

  const output = {
    version: '2.0', // Updated version for improved format
    timestamp: new Date().toISOString(),
    totalGroups: results.length,
    groups: enrichedResults.map(result => {
      const analyzedResult = result as AnalyzedSimilarityResult;
      return {
        type: result.type,
        similarity: result.similarity,
        detector: result.detector,
        priority: result.priority,
        refactoringImpact: result.refactoringImpact,
        architectureAnalysis: analyzedResult.architectureAnalysis,
        functions: result.functions.map(func => ({
          id: func.functionId,
          name: func.functionName,
          file: func.filePath,
          lines: {
            start: func.startLine,
            end: func.endLine,
          },
          metrics: func.originalFunction?.metrics,
        })),
        metadata: result.metadata,
      };
    }),
  };

  const jsonString = JSON.stringify(output, null, 2);

  if (outputPath) {
    fs.writeFileSync(outputPath, jsonString);
    console.log(chalk.green(`✓ Saved similarity data to ${outputPath}`));
  } else {
    console.log(jsonString);
  }
}

function calculateRefactoringImpact(result: SimilarityResult): 'high' | 'medium' | 'low' {
  const avgComplexity =
    result.functions.reduce((sum, func) => {
      const complexity = func.originalFunction?.metrics?.cyclomaticComplexity || 0;
      return sum + complexity;
    }, 0) / result.functions.length;

  const totalLines = result.functions.reduce((sum, func) => {
    const lines = func.originalFunction?.metrics?.linesOfCode || 0;
    return sum + lines;
  }, 0);

  if (avgComplexity > 8 && totalLines > 100) return 'high';
  if (avgComplexity > 5 || totalLines > 50) return 'medium';
  return 'low';
}

function outputJSONLines(
  results: Array<SimilarityResult & { priority: number; refactoringImpact: string }>,
  outputPath?: string
): void {
  const lines = results.map(result => {
    const analyzedResult = result as AnalyzedSimilarityResult & { priority: number; refactoringImpact: string };
    return JSON.stringify({
      type: result.type,
      similarity: result.similarity,
      detector: result.detector,
      priority: result.priority,
      refactoringImpact: result.refactoringImpact,
      architectureAnalysis: analyzedResult.architectureAnalysis,
      functions: result.functions.map(func => ({
        id: func.functionId,
        name: func.functionName,
        file: func.filePath,
        lines: {
          start: func.startLine,
          end: func.endLine,
        },
        metrics: func.originalFunction?.metrics,
      })),
      metadata: result.metadata,
    });
  });

  const output = lines.join('\n');

  if (outputPath) {
    fs.writeFileSync(outputPath, output);
    console.log(chalk.green(`✓ Saved similarity data (JSON Lines) to ${outputPath}`));
  } else {
    console.log(output);
  }
}

function displayResults(results: SimilarityResult[], logger: import('../../utils/cli-utils').Logger): void {
  if (results.length === 0) {
    logger.info('No similar functions found with the given criteria.');
    return;
  }

  console.log(chalk.bold('\nSimilar Function Groups:\n'));

  results.forEach((result, index) => {
    const analyzedResult = result as AnalyzedSimilarityResult;
    const detectorInfo = getDetectorInfo(result.detector);
    
    console.log(chalk.yellow(`Group ${index + 1}`) + chalk.gray(` (${detectorInfo.name})`));
    console.log(chalk.cyan(`Similarity: ${(result.similarity * 100).toFixed(1)}%`));
    console.log(chalk.blue(`Algorithm: ${detectorInfo.description}`));

    // Show architecture analysis if available
    if (analyzedResult.architectureAnalysis) {
      displayArchitectureAnalysis(analyzedResult.architectureAnalysis);
    }

    // Explain why they are similar
    const reason = getSimilarityReason(result);
    if (reason) {
      console.log(chalk.gray(`Reason: ${reason}`));
    }

    if (result.metadata?.['groupSize']) {
      console.log(chalk.gray(`Group size: ${result.metadata['groupSize']} functions`));
    }

    console.log(chalk.gray('Functions:'));

    result.functions.forEach((func, i) => {
      const metrics = func.originalFunction?.metrics;
      const complexity = metrics ? `complexity: ${metrics.cyclomaticComplexity}` : '';
      const lines = metrics ? `lines: ${metrics.linesOfCode}` : '';

      console.log(
        `  ${i + 1}. ${chalk.green(func.functionName)} ` +
          chalk.gray(`(${func.filePath}:${func.startLine})`) +
          (complexity || lines
            ? chalk.gray(` - ${[complexity, lines].filter(Boolean).join(', ')}`)
            : '')
      );
    });

    console.log();
  });
}

function displaySummary(
  allResults: SimilarityResult[],
  displayedResults: SimilarityResult[],
  _logger: import('../../utils/cli-utils').Logger
): void {
  const totalFunctions = new Set<string>();
  allResults.forEach(result => {
    result.functions.forEach(func => totalFunctions.add(func.functionId));
  });

  console.log(chalk.bold('\nSummary:'));
  console.log(`  Total similar groups: ${allResults.length}`);
  console.log(`  Total functions involved: ${totalFunctions.size}`);

  if (displayedResults.length < allResults.length) {
    console.log(`  Displayed: ${displayedResults.length} (use --limit to see more)`);
  }

  // Distribution by similarity levels
  const distribution = {
    high: allResults.filter(r => r.similarity >= 0.9).length,
    medium: allResults.filter(r => r.similarity >= 0.7 && r.similarity < 0.9).length,
    low: allResults.filter(r => r.similarity < 0.7).length,
  };

  console.log('\n  Similarity distribution:');
  console.log(`    High (≥90%): ${distribution.high}`);
  console.log(`    Medium (70-90%): ${distribution.medium}`);
  console.log(`    Low (<70%): ${distribution.low}`);

  // Distribution by detector
  const detectorStats = new Map<string, number>();
  allResults.forEach(result => {
    const detectorInfo = getDetectorInfo(result.detector);
    const count = detectorStats.get(detectorInfo.name) || 0;
    detectorStats.set(detectorInfo.name, count + 1);
  });

  if (detectorStats.size > 1) {
    console.log('\n  Detection algorithms used:');
    Array.from(detectorStats.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([detector, count]) => {
        console.log(`    ${detector}: ${count} group${count !== 1 ? 's' : ''}`);
      });
  }
}

function getDetectorInfo(detector: string): { name: string; description: string } {
  switch (detector) {
    case 'advanced-structural':
      return {
        name: 'Advanced AST',
        description: 'AST canonicalization + Merkle hashing + SimHash fingerprinting',
      };
    case 'advanced-structural-fast':
      return {
        name: 'Advanced Fast',
        description: 'Source code hashing (Stage 1 of 2-stage filtering)',
      };
    case 'advanced-structural-hybrid':
      return {
        name: 'Advanced Hybrid',
        description: 'AST canonicalization + SimHash (Stage 2 of 2-stage filtering)',
      };
    case 'hash-duplicate':
      return {
        name: 'Hash-based',
        description: 'Pre-computed hash comparison (AST, semantic, signature)',
      };
    case 'ast-structural':
      return {
        name: 'AST Structural',
        description: 'Traditional AST structure comparison with weighted similarity',
      };
    case 'ann-semantic':
      return {
        name: 'ANN Semantic',
        description: 'Approximate Nearest Neighbor with embedding vectors',
      };
    case 'consensus-majority':
      return {
        name: 'Consensus Majority',
        description: 'Agreement between multiple detection algorithms',
      };
    case 'consensus-intersection':
      return {
        name: 'Consensus Intersection',
        description: 'Functions detected by all enabled algorithms',
      };
    case 'consensus-weighted':
      return {
        name: 'Consensus Weighted',
        description: 'Weighted combination of multiple detection algorithms',
      };
    default:
      return {
        name: detector,
        description: 'Unknown detection algorithm',
      };
  }
}

function getAdvancedStructuralReason(metadata: Record<string, unknown>): string | null {
  const algorithm = metadata['algorithm'] as string;
  const resultType = metadata['resultType'] as string;

  if (algorithm === 'source-code-hash') {
    return 'Identical source code';
  }

  if (algorithm === 'merkle-tree') {
    return 'Identical AST structure (Merkle hash match)';
  }

  if (algorithm === 'simhash-lsh') {
    const hammingDistance = metadata['hammingDistance'] as number;
    return `Near-duplicate code (Hamming distance: ${hammingDistance})`;
  }

  if (algorithm === 'structural-signature') {
    return 'Similar control flow patterns';
  }

  if (resultType) {
    return `${resultType.replace('-', ' ')} detected`;
  }

  return null;
}

function getHashDuplicateReason(metadata: Record<string, unknown>): string | null {
  const hashType = metadata['hashType'] as string;

  switch (hashType) {
    case 'ast-exact':
      return 'Exact AST match - identical code structure';
    case 'semantic-match':
      return 'Same semantic ID - functionally equivalent';
    case 'signature-match':
      return 'Same function signature - identical parameters and return type';
    case 'name-match':
      return 'Same function name - potential duplication';
    default:
      return null;
  }
}

function getAstStructuralReason(metadata: Record<string, unknown>): string {
  if (metadata['astHashMatch']) {
    return 'Exact AST structure match';
  }

  if (metadata['signatureHashMatch']) {
    return 'Matching function signatures with similar implementation';
  }

  return 'Structural similarity in code patterns';
}

function getSimilarityReason(result: SimilarityResult): string | null {
  const metadata = result.metadata;

  if (!metadata) {
    return null;
  }

  if (result.detector.startsWith('advanced-structural')) {
    return getAdvancedStructuralReason(metadata);
  }

  if (result.detector === 'hash-duplicate') {
    return getHashDuplicateReason(metadata);
  }

  if (result.detector === 'ann-semantic') {
    return 'Semantic similarity based on embeddings';
  }

  if (result.detector === 'ast-structural') {
    return getAstStructuralReason(metadata);
  }

  return null;
}

/**
 * Add architecture analysis to similarity results for AI refactoring guidance
 */
async function addArchitectureAnalysis(
  results: SimilarityResult[], 
  spinner: ReturnType<typeof ora>
): Promise<AnalyzedSimilarityResult[]> {
  spinner.start('Analyzing architecture compliance...');
  
  try {
    const archConfig = new ArchitectureConfigManager();
    const config = archConfig.load();
    const layerAssigner = new LayerAssigner(config);
    
    const analyzedResults: AnalyzedSimilarityResult[] = [];
    
    for (const result of results) {
      const analysis = await analyzeGroupArchitecture(result, layerAssigner, config);
      analyzedResults.push({
        ...result,
        architectureAnalysis: analysis
      });
    }
    
    spinner.succeed(`Analyzed ${analyzedResults.length} similarity groups for architecture compliance`);
    return analyzedResults;
    
  } catch {
    spinner.warn('Architecture analysis failed, continuing without it');
    // Return original results if architecture analysis fails
    return results as AnalyzedSimilarityResult[];
  }
}

/**
 * Analyze architecture implications of a similarity group
 */
async function analyzeGroupArchitecture(
  result: SimilarityResult,
  layerAssigner: LayerAssigner,
  config: ArchitectureConfig
): Promise<ArchitectureAnalysis> {
  const functions = result.functions;
  const layers = new Set<string>();
  
  // Determine layer for each function
  for (const func of functions) {
    const layer = layerAssigner.getLayer(func.filePath);
    if (layer) {
      layers.add(layer);
    }
  }
  
  const layerList = Array.from(layers);
  
  // Same layer - generally safe to refactor
  if (layerList.length === 1) {
    return {
      safe: true,
      reason: `All functions are in the same layer (${layerList[0]})`,
      severity: 'safe',
      recommendation: 'Safe to extract common functionality within this layer',
      layers: layerList,
      ruleViolations: []
    };
  }
  
  // Multiple layers - check for rule violations
  const violations = checkArchitectureRules(layerList, config.rules || []);
  
  if (violations.length > 0) {
    return {
      safe: false,
      reason: `Cross-layer refactoring may violate architecture rules`,
      severity: 'violation',
      recommendation: 'Consider keeping functions separate or create interface/contract layer',
      layers: layerList,
      ruleViolations: violations
    };
  }
  
  // Cross-layer but no violations - caution needed
  return {
    safe: false,
    reason: `Functions span multiple layers: ${layerList.join(', ')}`,
    severity: 'caution',
    recommendation: 'Consider architectural implications before refactoring across layers',
    layers: layerList,
    ruleViolations: []
  };
}

/**
 * Check if layer combinations violate architecture rules
 */
function checkArchitectureRules(layers: string[], rules: ArchitectureRule[]): string[] {
  const violations: string[] = [];
  
  for (const rule of rules) {
    if (rule.type !== 'forbid') continue;
    
    const fromLayers = Array.isArray(rule.from) ? rule.from : [rule.from];
    const toLayers = Array.isArray(rule.to) ? rule.to : [rule.to];
    
    for (const fromLayer of layers) {
      for (const toLayer of layers) {
        if (fromLayer !== toLayer) {
          // Check if this combination is forbidden
          if (matchesPattern(fromLayer, fromLayers) && matchesPattern(toLayer, toLayers)) {
            violations.push(`${rule.description || `${fromLayer} → ${toLayer}`}`);
          }
        }
      }
    }
  }
  
  return violations;
}

/**
 * Check if layer matches pattern (supports wildcards)
 */
function matchesPattern(layer: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    if (pattern === '*') return true;
    if (pattern === layer) return true;
    // Simple wildcard support
    if (pattern.endsWith('*')) {
      return layer.startsWith(pattern.slice(0, -1));
    }
    return false;
  });
}

/**
 * Display architecture analysis information
 */
function displayArchitectureAnalysis(analysis: ArchitectureAnalysis): void {
  // Show severity indicator
  let severityIcon: string;
  let severityColor: (text: string) => string;
  
  switch (analysis.severity) {
    case 'safe':
      severityIcon = '✅ SAFE';
      severityColor = chalk.green;
      break;
    case 'caution':
      severityIcon = '⚠️  CAUTION';
      severityColor = chalk.yellow;
      break;
    case 'violation':
      severityIcon = '❌ VIOLATION';
      severityColor = chalk.red;
      break;
  }
  
  console.log(severityColor(`Refactoring: ${severityIcon}`));
  console.log(chalk.gray(`Reason: ${analysis.reason}`));
  
  // Show layers involved
  if (analysis.layers.length > 0) {
    console.log(chalk.gray(`Layers: ${analysis.layers.join(', ')}`));
  }
  
  // Show rule violations if any
  if (analysis.ruleViolations.length > 0) {
    console.log(chalk.red(`Rule violations:`));
    analysis.ruleViolations.forEach(violation => {
      console.log(chalk.red(`  • ${violation}`));
    });
  }
  
  // Show recommendation
  console.log(chalk.blue(`Recommendation: ${analysis.recommendation}`));
}
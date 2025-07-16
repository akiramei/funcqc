import chalk from 'chalk';
import { SearchCommandOptions, FunctionInfo } from '../../types';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';
import { LocalSimilarityService } from '../../services/local-similarity-service';
import { SimilarityManager } from '../../similarity/similarity-manager';
import path from 'path';

/**
 * Search command as a Reader function with keyword argument
 * Uses shared storage from environment
 */
export function searchCommand(keyword: string): VoidCommand<SearchCommandOptions> {
  return (options) => async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      const functions = await performSearch(env, keyword, options);

      if (functions.length === 0) {
        await handleEmptyResults(env, keyword, options);
        return;
      }

      handleSearchResults(functions, keyword, options);
    } catch (error) {
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
          `Failed to execute search command: ${error instanceof Error ? error.message : String(error)}`,
          { keyword, options },
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };
}

/**
 * Perform search based on options
 */
async function performSearch(
  env: CommandEnvironment,
  keyword: string,
  options: SearchCommandOptions
): Promise<FunctionInfo[]> {
  if (options.semantic || options.hybrid) {
    return await performSemanticSearch(env, keyword, options);
  } else {
    return await env.storage.searchFunctionsByDescription(keyword, {
      limit: options.limit ? parseInt(options.limit, 10) : 50,
    });
  }
}

/**
 * Handle empty search results with helpful suggestions
 */
async function handleEmptyResults(
  env: CommandEnvironment,
  keyword: string,
  options: SearchCommandOptions
): Promise<void> {
  env.commandLogger.info(chalk.yellow(`No functions found matching keyword search: "${keyword}"`));

  const stats = await env.storage.getEmbeddingStats();

  if (stats.total === 0) {
    env.commandLogger.info(
      chalk.gray(
        `💡 No function descriptions found. Add descriptions first: ${chalk.cyan('funcqc describe')}`
      )
    );
  } else {
    const searchType = options.semantic ? 'semantic' : options.hybrid ? 'hybrid' : 'keyword';
    env.commandLogger.info(
      chalk.gray(
        `💡 No results for ${searchType} search. Try different keywords or: ${chalk.cyan('funcqc list --name "*pattern*"')}`
      )
    );
    if (options.semantic || options.hybrid) {
      env.commandLogger.info(
        chalk.gray(
          `💡 Local semantic search uses TF-IDF and n-gram matching. Try broader terms or reduce --threshold.`
        )
      );
    }
  }
}

/**
 * Handle search results output
 */
function handleSearchResults(
  functions: FunctionInfo[],
  keyword: string,
  options: SearchCommandOptions
): void {
  if (options.json) {
    console.log(JSON.stringify(functions, null, 2));
    return;
  }

  displaySearchResults(functions, keyword, options);
}

function displaySearchResults(
  functions: FunctionInfo[],
  keyword: string,
  options: SearchCommandOptions
): void {
  const format = options.format || 'table';

  console.log(chalk.blue(`Search results for "${keyword}" (${functions.length} functions found)`));
  console.log('');

  if (format === 'table') {
    displayTable(functions);
  } else if (format === 'friendly') {
    displayFriendly(functions);
  } else {
    // Default to table format
    displayTable(functions);
  }
}

interface FunctionWithSimilarity extends FunctionInfo {
  _similarity?: number;
  _hybridScore?: number;
}

interface FunctionWithSimilarityDetails extends FunctionInfo {
  _similarity?: number;
  _hybridScore?: number;
  _explanation?: string;
  _matchedTerms?: string[];
  _semanticScore?: number;
  _keywordScore?: number;
  _astScore?: number;
}

// Constants for table display
const TABLE_CONSTANTS = {
  SIMILARITY_HEADER_WIDTH: 115,
  STANDARD_HEADER_WIDTH: 105,
  FUNCTION_ID_LENGTH: 8,
  FUNCTION_NAME_WIDTH: 25,
  FILE_LOCATION_WIDTH: 40,
  SIMILARITY_THRESHOLD_HIGH: 0.8,
  SIMILARITY_THRESHOLD_MEDIUM: 0.5,
  SIMILARITY_DECIMAL_PLACES: 3
} as const;

const TABLE_HEADERS = {
  WITH_SIMILARITY: 'ID        Similarity   Complexity   Function                  File:Line                                Exported Async',
  WITHOUT_SIMILARITY: 'ID        Complexity   Function                  File:Line                                Exported Async'
} as const;

function displayTable(functions: FunctionInfo[]): void {
  const hasScores = checkForSimilarityScores(functions);
  
  displayTableHeader(hasScores);
  displayTableRows(functions, hasScores);
}

/**
 * Check if functions have similarity scores
 */
function checkForSimilarityScores(functions: FunctionInfo[]): boolean {
  return functions.some(
    func =>
      (func as FunctionWithSimilarity)._similarity !== undefined ||
      (func as FunctionWithSimilarity)._hybridScore !== undefined
  );
}

/**
 * Display table header based on whether similarity scores are present
 */
function displayTableHeader(hasScores: boolean): void {
  const header = hasScores ? TABLE_HEADERS.WITH_SIMILARITY : TABLE_HEADERS.WITHOUT_SIMILARITY;
  const width = hasScores ? TABLE_CONSTANTS.SIMILARITY_HEADER_WIDTH : TABLE_CONSTANTS.STANDARD_HEADER_WIDTH;
  
  console.log(chalk.bold(header));
  console.log(chalk.gray('─'.repeat(width)));
}

/**
 * Display table rows for each function
 */
function displayTableRows(functions: FunctionInfo[], hasScores: boolean): void {
  functions.forEach(func => {
    const row = createTableRow(func, hasScores);
    console.log(row);
  });
}

/**
 * Create a formatted table row for a function
 */
function createTableRow(func: FunctionInfo, hasScores: boolean): string {
  const basicColumns = createBasicColumns(func);
  const similarityColumn = hasScores ? createSimilarityColumn(func) : '';
  
  return `${basicColumns.functionId} ${similarityColumn}${basicColumns.complexity} ${basicColumns.functionName} ${basicColumns.fileLocation} ${basicColumns.exported}        ${basicColumns.async}`;
}

/**
 * Create basic columns for function display
 */
function createBasicColumns(func: FunctionInfo) {
  const complexity = func.metrics?.cyclomaticComplexity || 1;
  const complexityColor = getComplexityColor(complexity);

  return {
    functionId: formatFunctionId(func.id),
    functionName: formatFunctionName(func.name),
    fileLocation: formatFileLocation(func.filePath, func.startLine),
    exported: formatBooleanColumn(func.isExported, 'green'),
    async: formatBooleanColumn(func.isAsync, 'blue'),
    complexity: complexityColor(complexity.toString()).padEnd(12)
  };
}

/**
 * Format function ID for display
 */
function formatFunctionId(id: string): string {
  return chalk.gray(id.substring(0, TABLE_CONSTANTS.FUNCTION_ID_LENGTH));
}

/**
 * Format function name for display
 */
function formatFunctionName(name: string): string {
  return truncate(name, TABLE_CONSTANTS.FUNCTION_NAME_WIDTH).padEnd(TABLE_CONSTANTS.FUNCTION_NAME_WIDTH);
}

/**
 * Format file location for display
 */
function formatFileLocation(filePath: string, startLine: number): string {
  const location = `${path.basename(filePath)}:${startLine}`;
  return truncate(location, TABLE_CONSTANTS.FILE_LOCATION_WIDTH).padEnd(TABLE_CONSTANTS.FILE_LOCATION_WIDTH);
}

/**
 * Format boolean column for display
 */
function formatBooleanColumn(value: boolean, color: 'green' | 'blue'): string {
  if (value) {
    return color === 'green' ? chalk.green('✓') : chalk.blue('✓');
  }
  return chalk.gray('✗');
}

/**
 * Create similarity column for function with similarity scores
 */
function createSimilarityColumn(func: FunctionInfo): string {
  const funcWithScore = func as FunctionWithSimilarity;
  const similarity = funcWithScore._similarity || funcWithScore._hybridScore || 0;
  
  const similarityColor = getSimilarityColorFromThreshold(similarity);
  const similarityStr = similarity > 0 
    ? similarityColor(similarity.toFixed(TABLE_CONSTANTS.SIMILARITY_DECIMAL_PLACES))
    : chalk.gray('---');
  
  return `${similarityStr.padEnd(12)} `;
}

/**
 * Get color for similarity score based on threshold
 */
function getSimilarityColorFromThreshold(similarity: number) {
  if (similarity > TABLE_CONSTANTS.SIMILARITY_THRESHOLD_HIGH) return chalk.green;
  if (similarity > TABLE_CONSTANTS.SIMILARITY_THRESHOLD_MEDIUM) return chalk.yellow;
  return chalk.gray;
}

function displayFriendly(functions: FunctionInfo[]): void {
  functions.forEach((func, index) => {
    displayFunctionHeader(func, index);
    displayFunctionLocation(func);
    displayMetricsLine(func);
    displaySimilarityDetails(func);
    displayDocumentation(func);
    console.log('');
  });
}

function displayFunctionHeader(func: FunctionInfo, index: number): void {
  console.log(
    `${chalk.bold(`${index + 1}.`)} ${chalk.cyan(func.name)} ${chalk.gray(`[ID: ${func.id.substring(0, 8)}]`)}`
  );
}

function displayFunctionLocation(func: FunctionInfo): void {
  console.log(`   File: ${func.filePath}:${func.startLine}`);
}

function displayMetricsLine(func: FunctionInfo): void {
  const complexity = func.metrics?.cyclomaticComplexity || 1;
  const complexityColor = getComplexityColor(complexity);

  let metricLine = buildBasicMetricsLine(func, complexity, complexityColor);
  metricLine = addSimilarityToMetricLine(metricLine, func);

  console.log(metricLine);
}

function buildBasicMetricsLine(
  func: FunctionInfo,
  complexity: number,
  complexityColor: (text: string) => string
): string {
  return (
    `   Complexity: ${complexityColor(complexity.toString())} | ` +
    `Exported: ${func.isExported ? chalk.green('Yes') : chalk.gray('No')} | ` +
    `Async: ${func.isAsync ? chalk.blue('Yes') : chalk.gray('No')}`
  );
}

function addSimilarityToMetricLine(metricLine: string, func: FunctionInfo): string {
  const funcWithDetails = func as FunctionWithSimilarityDetails;

  if (funcWithDetails._similarity !== undefined) {
    return addSimilarityScore(metricLine, funcWithDetails._similarity);
  }

  if (funcWithDetails._hybridScore !== undefined) {
    return addHybridScore(metricLine, funcWithDetails._hybridScore);
  }

  return metricLine;
}

function addSimilarityScore(metricLine: string, similarity: number): string {
  const similarityColor = getSimilarityColor(similarity);
  return metricLine + ` | Similarity: ${similarityColor(similarity.toFixed(3))}`;
}

function addHybridScore(metricLine: string, hybridScore: number): string {
  const scoreColor = getSimilarityColor(hybridScore);
  return metricLine + ` | Hybrid Score: ${scoreColor(hybridScore.toFixed(3))}`;
}

function displaySimilarityDetails(func: FunctionInfo): void {
  const funcWithDetails = func as FunctionWithSimilarityDetails;

  displaySimilarityBreakdown(funcWithDetails);
  displayMatchedTerms(funcWithDetails);
  displaySimilarityExplanation(funcWithDetails);
}

function displaySimilarityBreakdown(func: FunctionWithSimilarityDetails): void {
  if (func._semanticScore === undefined) return;

  const semanticScore = func._semanticScore;
  const keywordScore = func._keywordScore || 0;
  const astScore = func._astScore || 0;

  console.log(
    `   ${chalk.gray('Breakdown:')} Semantic: ${chalk.cyan(semanticScore.toFixed(3))} | ` +
      `Keyword: ${chalk.blue(keywordScore.toFixed(3))} | AST: ${chalk.magenta(astScore.toFixed(3))}`
  );
}

function displayMatchedTerms(func: FunctionWithSimilarityDetails): void {
  const matchedTerms = func._matchedTerms;
  if (!matchedTerms || matchedTerms.length === 0) return;

  const terms = matchedTerms.slice(0, 5).join(', ');
  console.log(
    `   ${chalk.gray('Matched terms:')} ${chalk.yellow(terms)}${matchedTerms.length > 5 ? '...' : ''}`
  );
}

function displaySimilarityExplanation(func: FunctionWithSimilarityDetails): void {
  if (func._explanation) {
    console.log(`   ${chalk.gray('Metrics:')} ${func._explanation}`);
  }
}

function displayDocumentation(func: FunctionInfo): void {
  if (func.jsDoc) {
    const jsDocPreview = truncate(func.jsDoc.replace(/\n/g, ' '), 80);
    console.log(`   JSDoc: ${chalk.gray(jsDocPreview)}`);
  }

  if (func.description) {
    const descPreview = truncate(func.description, 80);
    console.log(`   Description: ${chalk.gray(descPreview)}`);
  }
}

function getSimilarityColor(score: number): (text: string) => string {
  if (score > 0.8) return chalk.green;
  if (score > 0.5) return chalk.yellow;
  return chalk.gray;
}

function getComplexityColor(complexity: number): (text: string) => string {
  if (complexity >= 10) return chalk.red;
  if (complexity >= 5) return chalk.yellow;
  return chalk.green;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Perform semantic search using local similarity computation
 */
function parseSearchOptions(options: SearchCommandOptions): {
  limit: number;
  threshold: number;
  minSimilarity: number;
} {
  return {
    limit: options.limit ? parseInt(options.limit, 10) : 50,
    threshold: options.threshold ? parseFloat(options.threshold) : 0.3,
    minSimilarity: options.minSimilarity ? parseFloat(options.minSimilarity) : 0.1,
  };
}

async function getFunctionsWithDescriptions(
  env: CommandEnvironment
): Promise<FunctionInfo[]> {
  const snapshots = await env.storage.getSnapshots({ limit: 1 });
  if (snapshots.length === 0) {
    env.commandLogger.info(chalk.yellow('No snapshots found. Run "funcqc scan" first.'));
    return [];
  }

  const allFunctions = await env.storage.getFunctions(snapshots[0].id);
  const functionsWithDescriptions = allFunctions.filter(
    (f: FunctionInfo) => f.description && f.description.trim().length > 0
  );

  if (functionsWithDescriptions.length === 0) {
    env.commandLogger.info(chalk.yellow('No functions with descriptions found for semantic search'));
    return [];
  }

  return functionsWithDescriptions;
}

function createSimilarityService(): LocalSimilarityService {
  return new LocalSimilarityService({
    minDocFreq: 1,
    maxDocFreq: 0.8,
    ngramSize: 2,
    useStemming: true,
  });
}

function prepareDocumentsForIndexing(functions: FunctionInfo[]): Array<{
  id: string;
  text: string;
  metadata: { functionInfo: FunctionInfo; name: string; file: string };
}> {
  return functions.map((func: FunctionInfo) => ({
    id: func.id,
    text: `${func.name} ${func.description || ''} ${func.jsDoc || ''}`,
    metadata: {
      functionInfo: func,
      name: func.name,
      file: func.filePath,
    },
  }));
}

interface AIHints {
  relatedTerms?: string[];
  context?: string;
  weights?: Record<string, number>;
}

interface SimilarityWeights {
  tfidf?: number;
  ngram?: number;
  jaccard?: number;
}

function parseOptionsJson(
  options: SearchCommandOptions,
  env: CommandEnvironment
): {
  aiHints: AIHints | undefined;
  similarityWeights: SimilarityWeights | undefined;
} {
  let aiHints: AIHints | undefined;
  try {
    aiHints = options.aiHints ? JSON.parse(options.aiHints) : undefined;
  } catch (error) {
    env.commandLogger.warn(
      `Invalid AI hints JSON format, ignoring: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let similarityWeights: SimilarityWeights | undefined;
  try {
    similarityWeights = options.similarityWeights
      ? JSON.parse(options.similarityWeights)
      : undefined;
  } catch (error) {
    env.commandLogger.warn(
      `Invalid similarity weights JSON format, using defaults: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return { aiHints, similarityWeights };
}

function outputIntermediateResults(
  keyword: string,
  results: unknown,
  similarityService: LocalSimilarityService,
  threshold: number,
  aiHints: unknown,
  options: SearchCommandOptions
): void {
  if (options.intermediate) {
    const intermediateResults = {
      keyword,
      semanticResults: results,
      metrics: similarityService.getMetrics(),
      threshold,
      aiHints,
      searchType: options.hybrid ? 'hybrid' : 'semantic',
    };
    console.log(JSON.stringify(intermediateResults, null, 2));
  }
}

function convertResultsToFunctions(
  results: Array<{ similarity: number; id: string; explanation?: string; matchedTerms?: string[] }>,
  threshold: number,
  limit: number,
  functionsWithDescriptions: FunctionInfo[],
  options: SearchCommandOptions
): FunctionInfo[] {
  return results
    .filter(result => result.similarity >= threshold)
    .slice(0, limit)
    .map(result => {
      const func = functionsWithDescriptions.find(f => f.id === result.id);
      if (func && options.showSimilarity) {
        return {
          ...func,
          _similarity: result.similarity,
          _explanation: result.explanation,
          _matchedTerms: result.matchedTerms,
        } as FunctionInfo & {
          _similarity: number;
          _explanation: string;
          _matchedTerms: string[];
        };
      }
      return func;
    })
    .filter((func): func is FunctionInfo => func !== undefined);
}

async function performSemanticSearch(
  env: CommandEnvironment,
  keyword: string,
  options: SearchCommandOptions
): Promise<FunctionInfo[]> {
  const { limit, threshold, minSimilarity } = parseSearchOptions(options);

  const functionsWithDescriptions = await getFunctionsWithDescriptions(env);
  if (functionsWithDescriptions.length === 0) {
    return [];
  }

  const similarityService = createSimilarityService();
  const documents = prepareDocumentsForIndexing(functionsWithDescriptions);
  await similarityService.indexDocuments(documents);

  const { aiHints, similarityWeights } = parseOptionsJson(options, env);

  const searchConfig: {
    limit: number;
    minSimilarity: number;
    weights?: SimilarityWeights;
    aiHints?: AIHints;
  } = {
    limit: limit * 2,
    minSimilarity,
  };

  if (similarityWeights) {
    searchConfig.weights = similarityWeights;
  }

  if (aiHints) {
    searchConfig.aiHints = aiHints;
  }

  const results = await similarityService.searchSimilar(keyword, searchConfig);

  outputIntermediateResults(keyword, results, similarityService, threshold, aiHints, options);

  const matchedFunctions = convertResultsToFunctions(
    results,
    threshold,
    limit,
    functionsWithDescriptions,
    options
  );

  if (options.hybrid) {
    return performHybridSearch(env, matchedFunctions, keyword, options);
  }

  return matchedFunctions;
}

// Constants for search configuration
const DEFAULT_HYBRID_WEIGHT = 0.5;
const DEFAULT_SEARCH_LIMIT = 50;
const KEYWORD_SEARCH_MULTIPLIER = 2;
const AST_SIMILARITY_THRESHOLD = 0.7;

/**
 * Perform hybrid search combining semantic, keyword, and AST similarity
 */
async function performHybridSearch(
  env: CommandEnvironment,
  semanticResults: FunctionInfo[],
  keyword: string,
  options: SearchCommandOptions
): Promise<FunctionInfo[]> {
  const hybridWeight = parseHybridWeight(options);
  const limit = parseSearchLimit(options);

  // Get keyword search results
  const keywordResults = await fetchKeywordResults(env, keyword, limit);

  // Get AST similarity results
  const astResults = await fetchAstSimilarityResults(env, options);

  // Merge and rank results
  const mergedResults = mergeHybridResults(
    semanticResults,
    keywordResults,
    astResults,
    hybridWeight,
    options
  );

  return mergedResults.slice(0, limit);
}

/**
 * Parse hybrid weight from options
 */
function parseHybridWeight(options: SearchCommandOptions): number {
  return options.hybridWeight ? parseFloat(options.hybridWeight) : DEFAULT_HYBRID_WEIGHT;
}

/**
 * Parse search limit from options
 */
function parseSearchLimit(options: SearchCommandOptions): number {
  return options.limit ? parseInt(options.limit, 10) : DEFAULT_SEARCH_LIMIT;
}

/**
 * Fetch keyword search results
 */
async function fetchKeywordResults(
  env: CommandEnvironment,
  keyword: string,
  limit: number
): Promise<FunctionInfo[]> {
  return env.storage.searchFunctionsByDescription(keyword, {
    limit: limit * KEYWORD_SEARCH_MULTIPLIER,
  });
}

/**
 * Fetch AST similarity results
 */
async function fetchAstSimilarityResults(
  env: CommandEnvironment,
  options: SearchCommandOptions
): Promise<FunctionInfo[]> {
  // Early return if no context functions
  if (!options.contextFunctions) {
    return [];
  }

  // Get latest snapshot
  const snapshot = await getLatestSnapshot(env);
  if (!snapshot) {
    return [];
  }

  // Get all functions for AST similarity
  const allFunctions = await env.storage.getFunctions(snapshot.id);
  
  // Process AST similarity
  return processAstSimilarity(env, allFunctions, options.contextFunctions);
}

/**
 * Get the latest snapshot or null if none exists
 */
async function getLatestSnapshot(env: CommandEnvironment): Promise<{ id: string } | null> {
  const snapshots = await env.storage.getSnapshots({ limit: 1 });
  
  if (snapshots.length === 0) {
    env.commandLogger.warn('No snapshots found for AST similarity search');
    return null;
  }
  
  return snapshots[0];
}

/**
 * Process AST similarity search
 */
async function processAstSimilarity(
  env: CommandEnvironment,
  allFunctions: FunctionInfo[],
  contextFunctionsStr: string
): Promise<FunctionInfo[]> {
  const contextIds = parseContextFunctionIds(contextFunctionsStr);
  const contextFunctions = filterContextFunctions(allFunctions, contextIds);

  if (contextFunctions.length === 0) {
    return [];
  }

  try {
    return await findSimilarFunctions(allFunctions, env);
  } catch {
    env.commandLogger.warn('AST similarity search failed, using semantic + keyword only');
    return [];
  }
}

/**
 * Parse context function IDs from string
 */
function parseContextFunctionIds(contextFunctionsStr: string): string[] {
  return contextFunctionsStr.split(',').map(id => id.trim());
}

/**
 * Filter functions by context IDs
 */
function filterContextFunctions(allFunctions: FunctionInfo[], contextIds: string[]): FunctionInfo[] {
  return allFunctions.filter((f: FunctionInfo) => contextIds.includes(f.id));
}

/**
 * Find structurally similar functions
 */
async function findSimilarFunctions(
  allFunctions: FunctionInfo[],
  env: CommandEnvironment
): Promise<FunctionInfo[]> {
  const similarityOptions = { threshold: AST_SIMILARITY_THRESHOLD };
  const similarityManager = new SimilarityManager(undefined, env.storage, similarityOptions);
  
  const similarities = await similarityManager.detectSimilarities(
    allFunctions,
    { threshold: AST_SIMILARITY_THRESHOLD },
    ['advanced-structural']
  );

  // Extract unique function IDs from similarity results
  const similarFunctionIds = extractSimilarFunctionIds(similarities);
  
  // Filter functions by similarity IDs
  return allFunctions.filter((f: FunctionInfo) => similarFunctionIds.has(f.id));
}

/**
 * Extract function IDs from similarity results
 */
function extractSimilarFunctionIds(similarities: import('../../types').SimilarityResult[]): Set<string> {
  const similarFunctionIds = new Set<string>();
  
  for (const similarity of similarities) {
    for (const func of similarity.functions) {
      similarFunctionIds.add(func.functionId);
    }
  }
  
  return similarFunctionIds;
}

/**
 * Merge results from different search strategies with weighted scoring
 */
function mergeHybridResults(
  semanticResults: FunctionInfo[],
  keywordResults: FunctionInfo[],
  astResults: FunctionInfo[],
  hybridWeight: number,
  options: SearchCommandOptions
): FunctionInfo[] {
  const scoreMap = new Map<
    string,
    {
      function: FunctionInfo;
      semanticScore: number;
      keywordScore: number;
      astScore: number;
      combinedScore: number;
    }
  >();

  // Weight distribution: semantic vs keyword vs AST
  const semanticWeight = hybridWeight;
  const keywordWeight = (1 - hybridWeight) * 0.7;
  const astWeight = (1 - hybridWeight) * 0.3;

  // Score semantic results
  semanticResults.forEach((func, index) => {
    const funcWithScore = func as FunctionWithSimilarity;
    const similarity = funcWithScore._similarity || 1.0;
    const score = similarity * (1 - index / semanticResults.length);
    scoreMap.set(func.id, {
      function: func,
      semanticScore: score,
      keywordScore: 0,
      astScore: 0,
      combinedScore: score * semanticWeight,
    });
  });

  // Score keyword results
  keywordResults.forEach((func, index) => {
    const score = 1 - index / keywordResults.length;
    const existing = scoreMap.get(func.id);
    if (existing) {
      existing.keywordScore = score;
      existing.combinedScore += score * keywordWeight;
    } else {
      scoreMap.set(func.id, {
        function: func,
        semanticScore: 0,
        keywordScore: score,
        astScore: 0,
        combinedScore: score * keywordWeight,
      });
    }
  });

  // Score AST results
  astResults.forEach((func, index) => {
    const score = 1 - index / astResults.length;
    const existing = scoreMap.get(func.id);
    if (existing) {
      existing.astScore = score;
      existing.combinedScore += score * astWeight;
    } else {
      scoreMap.set(func.id, {
        function: func,
        semanticScore: 0,
        keywordScore: 0,
        astScore: score,
        combinedScore: score * astWeight,
      });
    }
  });

  // Sort by combined score and prepare results
  const rankedResults = Array.from(scoreMap.values())
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .map(entry => {
      const func = entry.function;
      if (options.showSimilarity) {
        return {
          ...func,
          _hybridScore: entry.combinedScore,
          _semanticScore: entry.semanticScore,
          _keywordScore: entry.keywordScore,
          _astScore: entry.astScore,
        } as FunctionInfo & {
          _hybridScore: number;
          _semanticScore: number;
          _keywordScore: number;
          _astScore: number;
        };
      }
      return func;
    });

  return rankedResults;
}
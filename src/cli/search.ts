import chalk from 'chalk';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { ConfigManager } from '../core/config';
import { Logger } from '../utils/cli-utils';
import { createErrorHandler, ErrorCode } from '../utils/error-handler';
import { SearchCommandOptions, FunctionInfo } from '../types';
import { LocalSimilarityService } from '../services/local-similarity-service';
import { SimilarityManager } from '../similarity/similarity-manager';
import path from 'path';

export async function searchCommand(
  keyword: string,
  options: SearchCommandOptions
): Promise<void> {
  const logger = new Logger(options.verbose, options.quiet);
  const errorHandler = createErrorHandler(logger);

  try {
    // Load configuration
    const configManager = new ConfigManager();
    const config = await configManager.load();
    
    // Initialize storage
    const storage = new PGLiteStorageAdapter(config.storage.path || '.funcqc/funcqc.db');
    await storage.init();

    try {
      let functions: FunctionInfo[];
      
      // Determine search strategy based on options
      if (options.semantic || options.hybrid) {
        functions = await performSemanticSearch(storage, keyword, options, logger);
      } else {
        // Perform keyword search
        functions = await storage.searchFunctionsByDescription(keyword, {
          limit: options.limit ? parseInt(options.limit, 10) : 50
        });
      }

      if (functions.length === 0) {
        logger.info(chalk.yellow(`No functions found matching keyword search: "${keyword}"`));
        
        // Check if function descriptions exist
        const configManager = new ConfigManager();
        const statsConfig = await configManager.load();
        const statsStorage = new PGLiteStorageAdapter(statsConfig.storage.path || '.funcqc/funcqc.db');
        await statsStorage.init();
        const stats = await statsStorage.getEmbeddingStats();
        await statsStorage.close();
        
        if (stats.total === 0) {
          logger.info(chalk.gray(`💡 No function descriptions found. Add descriptions first: ${chalk.cyan('funcqc describe')}`));
        } else {
          const searchType = options.semantic ? 'semantic' : options.hybrid ? 'hybrid' : 'keyword';
          logger.info(chalk.gray(`💡 No results for ${searchType} search. Try different keywords or: ${chalk.cyan('funcqc list --name "*pattern*"')}`));
          if (options.semantic || options.hybrid) {
            logger.info(chalk.gray(`💡 Local semantic search uses TF-IDF and n-gram matching. Try broader terms or reduce --threshold.`));
          }
        }
        
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(functions, null, 2));
        return;
      }

      // Display results in formatted output
      displaySearchResults(functions, keyword, logger, options);

    } finally {
      await storage.close();
    }

  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.UNKNOWN_ERROR,
      'Failed to execute search command',
      { keyword, options },
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
    process.exit(1);
  }
}

function displaySearchResults(
  functions: FunctionInfo[],
  keyword: string,
  logger: Logger,
  options: SearchCommandOptions
): void {
  const format = options.format || 'table';

  logger.info(chalk.blue(`Search results for "${keyword}" (${functions.length} functions found)`));
  logger.info('');

  if (format === 'table') {
    displayTable(functions, logger);
  } else if (format === 'friendly') {
    displayFriendly(functions, logger);
  } else {
    // Default to table format
    displayTable(functions, logger);
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

function displayTable(functions: FunctionInfo[], logger: Logger): void {
  // Check if any function has similarity scores
  const hasScores = functions.some(func => (func as FunctionWithSimilarity)._similarity !== undefined || (func as FunctionWithSimilarity)._hybridScore !== undefined);
  
  // Print table header
  if (hasScores) {
    logger.info(chalk.bold('ID        Similarity   Complexity   Function                  File:Line                                Exported Async'));
    logger.info(chalk.gray('─'.repeat(115)));
  } else {
    logger.info(chalk.bold('ID        Complexity   Function                  File:Line                                Exported Async'));
    logger.info(chalk.gray('─'.repeat(105)));
  }

  // Print function rows
  functions.forEach(func => {
    const complexity = func.metrics?.cyclomaticComplexity || 1;
    const complexityColor = getComplexityColor(complexity);
    
    const functionId = chalk.gray(func.id.substring(0, 8));
    const functionName = truncate(func.name, 25).padEnd(25);
    const fileLocation = truncate(`${path.basename(func.filePath)}:${func.startLine}`, 40).padEnd(40);
    const exported = func.isExported ? chalk.green('✓') : chalk.gray('✗');
    const async = func.isAsync ? chalk.blue('✓') : chalk.gray('✗');
    const complexityStr = complexityColor(complexity.toString()).padEnd(12);
    
    // Add similarity score if available
    let row = `${functionId} `;
    
    if (hasScores) {
      const funcWithScore = func as FunctionWithSimilarity;
      const similarity = funcWithScore._similarity || funcWithScore._hybridScore || 0;
      const similarityColor = similarity > 0.8 ? chalk.green : similarity > 0.5 ? chalk.yellow : chalk.gray;
      const similarityStr = similarity > 0 ? similarityColor(similarity.toFixed(3)) : chalk.gray('---');
      row += `${similarityStr.padEnd(12)} `;
    }
    
    row += `${complexityStr} ${functionName} ${fileLocation} ${exported}        ${async}`;
    logger.info(row);
  });
}

function displayFriendly(functions: FunctionInfo[], logger: Logger): void {
  functions.forEach((func, index) => {
    const complexity = func.metrics?.cyclomaticComplexity || 1;
    const complexityColor = getComplexityColor(complexity);
    
    logger.info(`${chalk.bold(`${index + 1}.`)} ${chalk.cyan(func.name)} ${chalk.gray(`[ID: ${func.id.substring(0, 8)}]`)}`);
    logger.info(`   File: ${func.filePath}:${func.startLine}`);
    
    let metricLine = `   Complexity: ${complexityColor(complexity.toString())} | ` +
      `Exported: ${func.isExported ? chalk.green('Yes') : chalk.gray('No')} | ` +
      `Async: ${func.isAsync ? chalk.blue('Yes') : chalk.gray('No')}`;
    
    // Add similarity information if available
    const funcWithDetails = func as FunctionWithSimilarityDetails;
    const similarity = funcWithDetails._similarity;
    const hybridScore = funcWithDetails._hybridScore;
    const explanation = funcWithDetails._explanation;
    const matchedTerms = funcWithDetails._matchedTerms;
    
    if (similarity !== undefined) {
      const similarityColor = similarity > 0.8 ? chalk.green : similarity > 0.5 ? chalk.yellow : chalk.gray;
      metricLine += ` | Similarity: ${similarityColor(similarity.toFixed(3))}`;
    } else if (hybridScore !== undefined) {
      const scoreColor = hybridScore > 0.8 ? chalk.green : hybridScore > 0.5 ? chalk.yellow : chalk.gray;
      metricLine += ` | Hybrid Score: ${scoreColor(hybridScore.toFixed(3))}`;
    }
    
    logger.info(metricLine);
    
    // Show detailed similarity breakdown for hybrid search
    if (funcWithDetails._semanticScore !== undefined) {
      const semanticScore = funcWithDetails._semanticScore;
      const keywordScore = funcWithDetails._keywordScore || 0;
      const astScore = funcWithDetails._astScore || 0;
      
      logger.info(`   ${chalk.gray('Breakdown:')} Semantic: ${chalk.cyan(semanticScore.toFixed(3))} | ` +
        `Keyword: ${chalk.blue(keywordScore.toFixed(3))} | AST: ${chalk.magenta(astScore.toFixed(3))}`);
    }
    
    // Show matched terms for semantic search
    if (matchedTerms && matchedTerms.length > 0) {
      const terms = matchedTerms.slice(0, 5).join(', ');
      logger.info(`   ${chalk.gray('Matched terms:')} ${chalk.yellow(terms)}${matchedTerms.length > 5 ? '...' : ''}`);
    }
    
    // Show similarity explanation
    if (explanation) {
      logger.info(`   ${chalk.gray('Metrics:')} ${explanation}`);
    }
    
    if (func.jsDoc) {
      const jsDocPreview = truncate(func.jsDoc.replace(/\n/g, ' '), 80);
      logger.info(`   JSDoc: ${chalk.gray(jsDocPreview)}`);
    }
    
    if (func.description) {
      const descPreview = truncate(func.description, 80);
      logger.info(`   Description: ${chalk.gray(descPreview)}`);
    }
    
    logger.info('');
  });
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
async function performSemanticSearch(
  storage: PGLiteStorageAdapter,
  keyword: string,
  options: SearchCommandOptions,
  logger: Logger
): Promise<FunctionInfo[]> {
  const limit = options.limit ? parseInt(options.limit, 10) : 50;
  const threshold = options.threshold ? parseFloat(options.threshold) : 0.3;
  const minSimilarity = options.minSimilarity ? parseFloat(options.minSimilarity) : 0.1;

  // Get latest snapshot
  const snapshots = await storage.getSnapshots({ limit: 1 });
  if (snapshots.length === 0) {
    logger.info(chalk.yellow('No snapshots found. Run "funcqc scan" first.'));
    return [];
  }
  
  // Get all functions with descriptions
  const allFunctions = await storage.getFunctions(snapshots[0].id);
  const functionsWithDescriptions = allFunctions.filter((f: FunctionInfo) => 
    f.description && f.description.trim().length > 0
  );

  if (functionsWithDescriptions.length === 0) {
    logger.info(chalk.yellow('No functions with descriptions found for semantic search'));
    return [];
  }

  // Initialize local similarity service
  const similarityService = new LocalSimilarityService({
    minDocFreq: 1,
    maxDocFreq: 0.8,
    ngramSize: 2,
    useStemming: true
  });

  // Prepare documents for indexing
  const documents = functionsWithDescriptions.map((func: FunctionInfo) => ({
    id: func.id,
    text: `${func.name} ${func.description || ''} ${func.jsDoc || ''}`,
    metadata: { 
      functionInfo: func,
      name: func.name,
      file: func.filePath 
    }
  }));

  // Index documents
  await similarityService.indexDocuments(documents);

  // Parse AI hints if provided
  let aiHints;
  try {
    aiHints = options.aiHints ? JSON.parse(options.aiHints) : undefined;
  } catch {
    logger.warn('Invalid AI hints JSON format, ignoring');
  }

  // Parse similarity weights if provided
  let similarityWeights;
  try {
    similarityWeights = options.similarityWeights ? JSON.parse(options.similarityWeights) : undefined;
  } catch {
    logger.warn('Invalid similarity weights JSON format, using defaults');
  }

  // Perform semantic search
  const results = await similarityService.searchSimilar(keyword, {
    limit: limit * 2, // Get more results for potential hybrid merging
    minSimilarity,
    weights: similarityWeights,
    aiHints
  });

  if (options.intermediate) {
    // Output intermediate results for AI analysis
    const intermediateResults = {
      keyword,
      semanticResults: results,
      metrics: similarityService.getMetrics(),
      threshold,
      aiHints,
      searchType: options.hybrid ? 'hybrid' : 'semantic'
    };
    console.log(JSON.stringify(intermediateResults, null, 2));
  }

  // Convert similarity results back to FunctionInfo
  const matchedFunctions = results
    .filter(result => result.similarity >= threshold)
    .slice(0, limit)
    .map(result => {
      const func = functionsWithDescriptions.find(f => f.id === result.id);
      if (func && options.showSimilarity) {
        // Add similarity information to the function
        return {
          ...func,
          _similarity: result.similarity,
          _explanation: result.explanation,
          _matchedTerms: result.matchedTerms
        } as FunctionInfo & {
          _similarity: number;
          _explanation: string;
          _matchedTerms: string[];
        };
      }
      return func;
    })
    .filter((func): func is FunctionInfo => func !== undefined);

  // If hybrid search, merge with AST similarity results
  if (options.hybrid) {
    return performHybridSearch(storage, matchedFunctions, keyword, options, logger);
  }

  return matchedFunctions;
}

/**
 * Perform hybrid search combining semantic, keyword, and AST similarity
 */
async function performHybridSearch(
  storage: PGLiteStorageAdapter,
  semanticResults: FunctionInfo[],
  keyword: string,
  options: SearchCommandOptions,
  logger: Logger
): Promise<FunctionInfo[]> {
  const hybridWeight = options.hybridWeight ? parseFloat(options.hybridWeight) : 0.5;
  const limit = options.limit ? parseInt(options.limit, 10) : 50;

  // Get keyword search results
  const keywordResults = await storage.searchFunctionsByDescription(keyword, {
    limit: limit * 2
  });

  // Get latest snapshot for AST similarity
  const snapshots = await storage.getSnapshots({ limit: 1 });
  if (snapshots.length === 0) {
    logger.warn('No snapshots found for AST similarity search');
    return semanticResults;
  }
  
  // Get all functions for AST similarity
  const allFunctions = await storage.getFunctions(snapshots[0].id);
  
  // Initialize similarity manager for AST analysis
  const similarityManager = new SimilarityManager(undefined, storage);
  
  // Find structurally similar functions if we have context functions
  let astResults: FunctionInfo[] = [];
  if (options.contextFunctions) {
    const contextIds = options.contextFunctions.split(',').map(id => id.trim());
    const contextFunctions = allFunctions.filter((f: FunctionInfo) => contextIds.includes(f.id));
    
    if (contextFunctions.length > 0) {
      try {
        const similarities = await similarityManager.detectSimilarities(
          allFunctions,
          { threshold: 0.7 },
          ['advanced-structural'] // Use advanced detector for better results
        );
        
        // Extract functions from similarity results
        const similarFunctionIds = new Set<string>();
        for (const similarity of similarities) {
          for (const func of similarity.functions) {
            similarFunctionIds.add(func.functionId);
          }
        }
        
        astResults = allFunctions.filter((f: FunctionInfo) => similarFunctionIds.has(f.id));
      } catch {
        logger.warn('AST similarity search failed, using semantic + keyword only');
      }
    }
  }

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
 * Merge results from different search strategies with weighted scoring
 */
function mergeHybridResults(
  semanticResults: FunctionInfo[],
  keywordResults: FunctionInfo[],
  astResults: FunctionInfo[],
  hybridWeight: number,
  options: SearchCommandOptions
): FunctionInfo[] {
  const scoreMap = new Map<string, {
    function: FunctionInfo;
    semanticScore: number;
    keywordScore: number;
    astScore: number;
    combinedScore: number;
  }>();

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
      combinedScore: score * semanticWeight
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
        combinedScore: score * keywordWeight
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
        combinedScore: score * astWeight
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
          _astScore: entry.astScore
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
import chalk from 'chalk';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { ConfigManager } from '../core/config';
import { Logger } from '../utils/cli-utils';
import { createErrorHandler, ErrorCode } from '../utils/error-handler';
import { SearchCommandOptions, FunctionInfo } from '../types';
import { EmbeddingService } from '../services/embedding-service';

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
      let functions: (FunctionInfo & { similarity?: number })[];

      if (options.semantic || options.hybrid) {
        // Semantic search requires API key
        const apiKey = options.apiKey || process.env['OPENAI_API_KEY'];
        if (!apiKey) {
          logger.error(chalk.red('Error: OpenAI API key is required for semantic search'));
          logger.info('Provide it via --api-key option or OPENAI_API_KEY environment variable');
          process.exit(1);
        }

        // Initialize embedding service with ANN support
        const embeddingService = new EmbeddingService({
          apiKey,
          model: options.model || 'text-embedding-3-small',
          enableANN: true // Enable ANN for faster search
        });

        if (options.hybrid) {
          // Hybrid search: combine keyword and semantic results
          functions = await performHybridSearch(
            storage, 
            embeddingService, 
            keyword, 
            options, 
            logger
          );
        } else {
          // Pure semantic search
          functions = await performSemanticSearch(
            storage, 
            embeddingService, 
            keyword, 
            options, 
            logger
          );
        }
      } else {
        // Traditional keyword search
        functions = await storage.searchFunctionsByDescription(keyword, {
          limit: options.limit ? parseInt(options.limit, 10) : 50
        });
      }

      if (functions.length === 0) {
        const searchType = options.semantic ? 'semantic' : options.hybrid ? 'hybrid' : 'keyword';
        logger.info(chalk.yellow(`No functions found matching ${searchType} search: "${keyword}"`));
        
        // Provide helpful suggestions based on search type
        if (options.semantic || options.hybrid) {
          const threshold = parseFloat(options.threshold || '0.8');
          if (threshold > 0.7) {
            logger.info(chalk.gray(`💡 Try lowering the similarity threshold: ${chalk.cyan(`--threshold ${Math.max(threshold - 0.2, 0.5).toFixed(1)}`)}`));
          }
          if (options.semantic) {
            logger.info(chalk.gray(`💡 Try hybrid search for broader results: ${chalk.cyan('--hybrid')}`));
          }
        } else {
          logger.info(chalk.gray(`💡 Try semantic search for concept-based matching: ${chalk.cyan('--semantic')}`));
        }
        
        // Check if embeddings exist
        const configManager = new ConfigManager();
        const statsConfig = await configManager.load();
        const statsStorage = new PGLiteStorageAdapter(statsConfig.storage.path || '.funcqc/funcqc.db');
        await statsStorage.init();
        const stats = await statsStorage.getEmbeddingStats();
        await statsStorage.close();
        
        if (stats.total === 0) {
          logger.info(chalk.gray(`💡 No function descriptions found. Add descriptions first: ${chalk.cyan('funcqc describe')}`));
        } else if (stats.withEmbeddings === 0 && (options.semantic || options.hybrid)) {
          logger.info(chalk.gray(`💡 No embeddings found. Generate embeddings first: ${chalk.cyan('funcqc vectorize')}`));
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

async function performSemanticSearch(
  storage: PGLiteStorageAdapter,
  embeddingService: EmbeddingService,
  keyword: string,
  options: SearchCommandOptions,
  logger: Logger
): Promise<(FunctionInfo & { similarity: number })[]> {
  logger.info(chalk.blue('Generating embedding for search query...'));
  
  // Search by embedding with ANN optimization
  const threshold = options.threshold ? parseFloat(options.threshold) : 0.8;
  const limit = options.limit ? parseInt(options.limit, 10) : 50;
  
  // Validate parsed values
  if (isNaN(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('Threshold must be a number between 0 and 1');
  }
  if (isNaN(limit) || limit <= 0) {
    throw new Error('Limit must be a positive number');
  }
  
  // Check if ANN index is available
  const isANNReady = embeddingService.isANNIndexReady();
  if (isANNReady) {
    logger.info(chalk.blue(`Searching with ANN optimization (threshold: ${threshold})...`));
  } else {
    logger.info(chalk.blue(`ANN index not ready, building index...`));
    
    // Load existing embeddings and build ANN index
    const snapshots = await storage.getSnapshots({ limit: 1 });
    if (snapshots.length > 0) {
      const snapshotId = snapshots[0].id;
      const functionsWithEmbeddings = await storage.getFunctionsWithEmbeddings(snapshotId);
      
      if (functionsWithEmbeddings.length > 0) {
        const embeddingResults = [];
        for (const func of functionsWithEmbeddings) {
          const embedding = await storage.getEmbedding(func.semanticId);
          if (embedding) {
            embeddingResults.push({
              functionId: func.semanticId,
              semanticId: func.semanticId,
              embedding: embedding.embedding,
              model: embedding.model,
              timestamp: Date.now()
            });
          }
        }
        
        if (embeddingResults.length > 0) {
          await embeddingService.buildANNIndex(embeddingResults);
          logger.info(chalk.green(`Built ANN index with ${embeddingResults.length} vectors`));
        }
      }
    }
  }
  
  // Get all existing embeddings for fallback
  const snapshots = await storage.getSnapshots({ limit: 1 });
  const allEmbeddings = [];
  if (snapshots.length > 0) {
    const snapshotId = snapshots[0].id;
    const functionsWithEmbeddings = await storage.getFunctionsWithEmbeddings(snapshotId);
    
    for (const func of functionsWithEmbeddings) {
      const embedding = await storage.getEmbedding(func.semanticId);
      if (embedding) {
        allEmbeddings.push({
          functionId: func.semanticId,
          semanticId: func.semanticId,
          embedding: embedding.embedding,
          model: embedding.model,
          timestamp: Date.now()
        });
      }
    }
  }
  
  // Perform semantic search using ANN or exact search
  const searchResults = await embeddingService.semanticSearch(keyword, allEmbeddings, {
    useANN: true,
    threshold,
    limit,
    approximationLevel: 'balanced'
  });
  
  // Convert search results back to FunctionInfo format
  const results: (FunctionInfo & { similarity: number })[] = [];
  for (const result of searchResults) {
    const func = await storage.getFunction(result.functionId);
    if (func) {
      results.push({
        ...func,
        similarity: result.similarity
      });
    }
  }
  
  // Filter by minimum similarity if specified
  if (options.minSimilarity) {
    const minSim = parseFloat(options.minSimilarity);
    if (isNaN(minSim) || minSim < 0 || minSim > 1) {
      throw new Error('Minimum similarity must be a number between 0 and 1');
    }
    return results.filter(f => f.similarity >= minSim);
  }
  
  return results;
}

async function performHybridSearch(
  storage: PGLiteStorageAdapter,
  embeddingService: EmbeddingService,
  keyword: string,
  options: SearchCommandOptions,
  logger: Logger
): Promise<(FunctionInfo & { similarity?: number })[]> {
  logger.info(chalk.blue('Performing hybrid search (keyword + semantic)...'));
  
  // Get keyword search results
  const keywordResults = await storage.searchFunctionsByDescription(keyword, {
    limit: options.limit ? parseInt(options.limit, 10) * 2 : 100 // Get more for merging
  });
  
  // Get semantic search results
  const semanticResults = await performSemanticSearch(
    storage, 
    embeddingService, 
    keyword, 
    options, 
    logger
  );
  
  // Merge and score results
  const weight = options.hybridWeight ? parseFloat(options.hybridWeight) : 0.5;
  if (options.hybridWeight && (isNaN(weight) || weight < 0 || weight > 1)) {
    throw new Error('Hybrid weight must be a number between 0 and 1');
  }
  const mergedResults = mergeHybridResults(keywordResults, semanticResults, weight);
  
  // Apply limit
  const limit = options.limit ? parseInt(options.limit, 10) : 50;
  return mergedResults.slice(0, limit);
}

function mergeHybridResults(
  keywordResults: FunctionInfo[],
  semanticResults: (FunctionInfo & { similarity: number })[],
  semanticWeight: number
): (FunctionInfo & { similarity?: number })[] {
  const merged = new Map<string, FunctionInfo & { similarity?: number; keywordScore?: number; semanticScore?: number }>();
  
  // Add keyword results with base score
  keywordResults.forEach((func, index) => {
    const keywordScore = keywordResults.length > 0 ? 1 - (index / keywordResults.length) : 1; // Higher for earlier results
    merged.set(func.id, { ...func, keywordScore, similarity: keywordScore * (1 - semanticWeight) });
  });
  
  // Add/merge semantic results
  semanticResults.forEach(func => {
    const existing = merged.get(func.id);
    if (existing) {
      // Combine scores
      const hybridScore = (existing.keywordScore || 0) * (1 - semanticWeight) + func.similarity * semanticWeight;
      existing.similarity = hybridScore;
      existing.semanticScore = func.similarity;
    } else {
      // Pure semantic result
      merged.set(func.id, { ...func, semanticScore: func.similarity, similarity: func.similarity * semanticWeight });
    }
  });
  
  // Sort by hybrid score
  return Array.from(merged.values()).sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
}

function displaySearchResults(
  functions: (FunctionInfo & { similarity?: number })[],
  keyword: string,
  logger: Logger,
  options: SearchCommandOptions
): void {
  const format = options.format || 'table';

  logger.info(chalk.blue(`Search results for "${keyword}" (${functions.length} functions found)`));
  logger.info('');

  if (format === 'table') {
    displayTable(functions, logger, options);
  } else if (format === 'friendly') {
    displayFriendly(functions, logger, options);
  } else {
    // Default to table format
    displayTable(functions, logger, options);
  }
}

function displayTable(functions: (FunctionInfo & { similarity?: number })[], logger: Logger, options: SearchCommandOptions): void {
  // Determine if we should show similarity scores
  const showSimilarity = options.showSimilarity || options.semantic || options.hybrid;
  
  if (showSimilarity) {
    // Print table header with similarity column
    logger.info(chalk.bold('ID        Similarity  Complexity   Function                  File:Line                                Exported Async'));
    logger.info(chalk.gray('─'.repeat(120)));
  } else {
    // Print table header without similarity column
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
    
    if (showSimilarity && typeof func.similarity === 'number') {
      const similarityStr = getSimilarityColor(func.similarity)(func.similarity.toFixed(3)).padEnd(11);
      logger.info(`${functionId} ${similarityStr} ${complexityStr} ${functionName} ${fileLocation} ${exported}        ${async}`);
    } else {
      logger.info(`${functionId} ${complexityStr} ${functionName} ${fileLocation} ${exported}        ${async}`);
    }
  });
}

function displayFriendly(functions: (FunctionInfo & { similarity?: number })[], logger: Logger, options: SearchCommandOptions): void {
  const showSimilarity = options.showSimilarity || options.semantic || options.hybrid;
  
  functions.forEach((func, index) => {
    const complexity = func.metrics?.cyclomaticComplexity || 1;
    const complexityColor = getComplexityColor(complexity);
    
    logger.info(`${chalk.bold(`${index + 1}.`)} ${chalk.cyan(func.name)} ${chalk.gray(`[ID: ${func.id.substring(0, 8)}]`)}`);
    logger.info(`   File: ${func.filePath}:${func.startLine}`);
    
    let metricLine = `   Complexity: ${complexityColor(complexity.toString())} | ` +
      `Exported: ${func.isExported ? chalk.green('Yes') : chalk.gray('No')} | ` +
      `Async: ${func.isAsync ? chalk.blue('Yes') : chalk.gray('No')}`;
    
    if (showSimilarity && typeof func.similarity === 'number') {
      const similarityColor = getSimilarityColor(func.similarity);
      metricLine += ` | Similarity: ${similarityColor(func.similarity.toFixed(3))}`;
    }
    
    logger.info(metricLine);
    
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

function getSimilarityColor(similarity: number): (text: string) => string {
  if (similarity >= 0.9) return chalk.green;
  if (similarity >= 0.7) return chalk.yellow;
  if (similarity >= 0.5) return chalk.cyan;
  return chalk.gray;
}

// Import path module for basename
import path from 'path';

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}
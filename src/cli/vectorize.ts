import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { EmbeddingService } from '../services/embedding-service';
import { FunctionInfo } from '../types';
import { ANNConfig, DEFAULT_ANN_CONFIG } from '../services/ann-index';

export function createVectorizeCommand(): Command {
  return new Command('vectorize')
    .description('Generate and manage embeddings for function descriptions')
    .option('--all', 'vectorize all functions with descriptions')
    .option('--recent', 'vectorize only functions without embeddings')
    .option('--status', 'show vectorization status')
    .option('--rebuild-index', 'rebuild ANN index for faster search')
    .option('--index-algorithm <algorithm>', 'ANN algorithm (hierarchical, lsh, hybrid)', 'hierarchical')
    .option('--index-config <config>', 'JSON config for ANN index (clusters, hash bits, etc.)')
    .option('--benchmark', 'benchmark ANN index performance')
    .option('--index-stats', 'show ANN index statistics')
    .option('--api-key <key>', 'OpenAI API key (or use OPENAI_API_KEY env var)')
    .option('--model <model>', 'embedding model to use', 'text-embedding-3-small')
    .option('--batch-size <size>', 'batch size for processing', '100')
    .option('--limit <n>', 'limit number of functions to process')
    .action(async (options) => {
      const spinner = ora();
      let storage: PGLiteStorageAdapter | null = null;
      
      try {
        // Load configuration and initialize storage
        const configManager = new ConfigManager();
        const config = await configManager.load();
        storage = new PGLiteStorageAdapter(config.storage.path || '.funcqc/funcqc.db');
        await storage.init();
        
        const apiKey = options.apiKey || process.env['OPENAI_API_KEY'];
        
        if (options.status) {
          // Show vectorization status
          spinner.start('Checking vectorization status...');
          const stats = await storage.getEmbeddingStats();
          spinner.stop();
          
          console.log('\n📊 Vectorization Status:');
          console.log(chalk.gray('─'.repeat(40)));
          console.log(`Total functions with descriptions: ${chalk.cyan(stats.total)}`);
          console.log(`Functions with embeddings: ${chalk.green(stats.withEmbeddings)}`);
          console.log(`Functions without embeddings: ${chalk.yellow(stats.withoutEmbeddings)}`);
          
          if (stats.total > 0) {
            const percentage = Math.round((stats.withEmbeddings / stats.total) * 100);
            console.log(`Coverage: ${chalk.bold(percentage + '%')}`);
          }
          
          await storage.close();
          return;
        }

        if (options.indexStats) {
          // Show ANN index statistics
          spinner.start('Checking ANN index status...');
          const indexStats = await storage.getANNIndexStats();
          const allIndexes = await storage.getAllANNIndexes();
          spinner.stop();
          
          console.log('\n🏗️ ANN Index Status:');
          console.log(chalk.gray('─'.repeat(40)));
          console.log(`Total indexes: ${chalk.cyan(indexStats.totalIndexes)}`);
          
          if (indexStats.currentIndex) {
            console.log(`Current algorithm: ${chalk.green(indexStats.currentIndex.algorithm)}`);
            console.log(`Vector count: ${chalk.cyan(indexStats.currentIndex.vectorCount)}`);
            console.log(`Build time: ${chalk.yellow(indexStats.currentIndex.buildTimeMs + 'ms')}`);
            console.log(`Model: ${chalk.gray(indexStats.currentIndex.model)}`);
          } else {
            console.log(chalk.yellow('No current index found'));
          }
          
          if (indexStats.averageBuildTime > 0) {
            console.log(`Average build time: ${chalk.gray(Math.round(indexStats.averageBuildTime) + 'ms')}`);
          }
          
          if (allIndexes.length > 0) {
            console.log('\n📜 Index History:');
            for (const index of allIndexes.slice(0, 5)) { // Show last 5
              const current = index.isCurrent ? chalk.green('●') : chalk.gray('○');
              console.log(`  ${current} ${index.algorithm} (${index.vectorCount} vectors, ${index.buildTimeMs}ms) - ${index.createdAt.toISOString().split('T')[0]}`);
            }
          }
          
          await storage.close();
          return;
        }

        // Handle ANN index operations (some don't require API key)
        if (options.rebuildIndex || options.benchmark) {
          await handleANNIndexOperations(storage, options);
          await storage.close();
          return;
        }
        
        if (!apiKey) {
          console.error(chalk.red('Error: OpenAI API key is required'));
          console.log('Provide it via --api-key option or OPENAI_API_KEY environment variable');
          await storage.close();
          process.exit(1);
        }
        
        // Initialize embedding service
        const embeddingService = new EmbeddingService({
          apiKey,
          model: options.model,
          batchSize: parseInt(options.batchSize, 10)
        });
        
        // Get functions to vectorize
        spinner.start('Finding functions to vectorize...');
        
        const snapshots = await storage.getSnapshots({ limit: 1 });
        if (snapshots.length === 0) {
          spinner.fail('No snapshots found. Run "funcqc scan" first.');
          await storage.close();
          process.exit(1);
        }
        
        const snapshotId = snapshots[0].id;
        let functions: FunctionInfo[];
        
        if (options.all) {
          // Get all functions with descriptions
          functions = await storage.getFunctionsWithDescriptions(
            snapshotId, 
            options.limit ? { limit: parseInt(options.limit, 10) } : undefined
          );
        } else {
          // Get only functions without embeddings (default)
          functions = await storage.getFunctionsWithoutEmbeddings(
            snapshotId,
            options.limit ? parseInt(options.limit, 10) : undefined
          );
        }
        
        spinner.succeed(`Found ${functions.length} functions to vectorize`);
        
        if (functions.length === 0) {
          console.log(chalk.gray('No functions need vectorization.'));
          await storage.close();
          process.exit(0);
        }
        
        // Generate embeddings
        spinner.start('Generating embeddings...');
        
        const embeddings = await embeddingService.generateFunctionEmbeddings(functions);
        
        spinner.succeed(`Generated ${embeddings.length} embeddings`);
        
        // Save embeddings
        spinner.start('Saving embeddings to database...');
        
        await storage.bulkSaveEmbeddings(
          embeddings.map(e => ({
            semanticId: e.semanticId,
            embedding: e.embedding,
            model: e.model
          }))
        );
        
        spinner.succeed('Embeddings saved successfully');
        
        // Show summary
        const modelInfo = embeddingService.getModelInfo();
        console.log('\n✅ Vectorization completed:');
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`Functions processed: ${chalk.green(embeddings.length)}`);
        console.log(`Model used: ${chalk.cyan(modelInfo.model)}`);
        console.log(`Embedding dimension: ${chalk.cyan(modelInfo.dimension.toString())}`);
        
        // Show updated stats
        const updatedStats = await storage.getEmbeddingStats();
        const coveragePercentage = updatedStats.total > 0 
          ? Math.round((updatedStats.withEmbeddings / updatedStats.total) * 100)
          : 0;
        console.log(`\nTotal coverage: ${chalk.bold(coveragePercentage + '%')}`);
        
        await storage.close();
        
      } catch (error) {
        spinner.fail('Vectorization failed');
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
        if (storage) {
          try {
            await storage.close();
          } catch (closeError) {
            console.error(chalk.red('Failed to close storage:'), closeError instanceof Error ? closeError.message : String(closeError));
          }
        }
        process.exit(1);
      }
    })
    .addHelpText('after', `
Examples:
  $ funcqc vectorize --status                    # Check vectorization status
  $ funcqc vectorize --recent                    # Vectorize new functions only
  $ funcqc vectorize --all                       # Re-vectorize all functions
  $ funcqc vectorize --recent --limit 100        # Process only 100 functions
  $ funcqc vectorize --api-key YOUR_KEY          # Use specific API key
  $ funcqc vectorize --model text-embedding-3-large  # Use higher quality model
  $ funcqc vectorize --rebuild-index             # Rebuild ANN index for faster search
  $ funcqc vectorize --index-stats               # Show ANN index statistics
  $ funcqc vectorize --benchmark                 # Benchmark ANN vs exact search

Supported Models:
  text-embedding-3-small    1536 dimensions (default, cost-effective)
  text-embedding-3-large    3072 dimensions (higher quality)
  text-embedding-ada-002    1536 dimensions (legacy)

Environment:
  OPENAI_API_KEY    OpenAI API key for generating embeddings
`);
}

interface VectorizeOptions {
  rebuildIndex?: boolean;
  indexAlgorithm?: string;
  indexConfig?: string;
  benchmark?: boolean;
  [key: string]: unknown;
}

/**
 * Handle ANN index operations
 */
async function handleANNIndexOperations(
  storage: PGLiteStorageAdapter, 
  options: VectorizeOptions
): Promise<void> {
  const ora = (await import('ora')).default;
  const chalk = (await import('chalk')).default;
  const spinner = ora();

  if (options.rebuildIndex) {
    // Parse ANN configuration
    let annConfig: ANNConfig = { ...DEFAULT_ANN_CONFIG };
    
    if (options.indexAlgorithm) {
      annConfig.algorithm = options.indexAlgorithm as 'hierarchical' | 'lsh' | 'hybrid';
    }
    
    if (options.indexConfig) {
      try {
        const customConfig = JSON.parse(options.indexConfig);
        annConfig = { ...annConfig, ...customConfig };
      } catch {
        console.error(chalk.red('Error: Invalid JSON in --index-config'));
        process.exit(1);
      }
    }

    spinner.start('Loading embeddings for index building...');
    
    // Get all embeddings from storage
    const snapshots = await storage.getSnapshots({ limit: 1 });
    if (snapshots.length === 0) {
      spinner.fail('No snapshots found. Run "funcqc scan" first.');
      process.exit(1);
    }

    const embeddingResults: Array<{ semanticId: string; embedding: number[]; model: string }> = [];
    
    // Get all functions with embeddings
    const snapshotId = snapshots[0].id;
    const functionsWithEmbeddings = await storage.getFunctionsWithEmbeddings(snapshotId);
    
    for (const func of functionsWithEmbeddings) {
      const embedding = await storage.getEmbedding(func.semanticId);
      if (embedding) {
        embeddingResults.push({
          semanticId: func.semanticId,
          embedding: embedding.embedding,
          model: embedding.model
        });
      }
    }

    if (embeddingResults.length === 0) {
      spinner.fail('No embeddings found. Run "funcqc vectorize" first.');
      process.exit(1);
    }

    spinner.succeed(`Loaded ${embeddingResults.length} embeddings`);

    // Initialize embedding service with ANN enabled
    const embeddingService = new EmbeddingService({
      enableANN: true,
      annConfig
    });

    spinner.start(`Building ${annConfig.algorithm} ANN index...`);
    const startTime = Date.now();

    // Convert to EmbeddingResult format and build index
    const embeddingResultsFormatted = embeddingResults.map(e => ({
      functionId: e.semanticId, // Use semanticId as functionId for now
      semanticId: e.semanticId,
      embedding: e.embedding,
      model: e.model,
      timestamp: Date.now()
    }));

    await embeddingService.buildANNIndex(embeddingResultsFormatted);
    const buildTime = Date.now() - startTime;

    // Get index statistics and serialize index data
    const indexStats = embeddingService.getIndexStatistics();
    const indexData = JSON.stringify(indexStats); // In real implementation, serialize actual index data

    // Save index to storage
    const indexId = `ann-${Date.now()}-${annConfig.algorithm}`;
    await storage.saveANNIndex(
      indexId,
      annConfig,
      embeddingResults[0].model,
      embeddingResults[0].embedding.length,
      embeddingResults.length,
      indexData,
      buildTime
    );

    spinner.succeed(`ANN index built successfully in ${buildTime}ms`);

    console.log('\n🏗️ Index Details:');
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`Algorithm: ${chalk.cyan(annConfig.algorithm)}`);
    console.log(`Vector count: ${chalk.green(embeddingResults.length.toString())}`);
    console.log(`Build time: ${chalk.yellow(buildTime + 'ms')}`);
    console.log(`Index ID: ${chalk.gray(indexId)}`);

    if (indexStats) {
      console.log('\n📊 Index Statistics:');
      console.log(JSON.stringify(indexStats, null, 2));
    }
  }

  if (options.benchmark) {
    spinner.start('Setting up benchmark...');
    
    // Get embeddings for benchmark
    const snapshots = await storage.getSnapshots({ limit: 1 });
    if (snapshots.length === 0) {
      spinner.fail('No snapshots found. Run "funcqc scan" first.');
      process.exit(1);
    }

    const snapshotId = snapshots[0].id;
    const functionsWithEmbeddings = await storage.getFunctionsWithEmbeddings(snapshotId);
    
    if (functionsWithEmbeddings.length < 10) {
      spinner.fail('Need at least 10 functions with embeddings for meaningful benchmark.');
      process.exit(1);
    }

    // Run benchmark
    spinner.text = 'Running performance benchmark...';
    
    // Sample queries (use first few embeddings as queries)
    const queryCount = Math.min(5, functionsWithEmbeddings.length);
    
    console.log('\n🏁 ANN Search Benchmark:');
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Dataset size: ${chalk.cyan(functionsWithEmbeddings.length)} vectors`);
    console.log(`Query count: ${chalk.cyan(queryCount)} queries`);
    
    // Note: Full benchmark implementation would require actual search timing
    // This is a simplified version showing the structure
    
    spinner.succeed('Benchmark completed');
    console.log('\n📈 Results: Benchmark implementation pending full integration');
  }
}
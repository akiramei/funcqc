import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { EmbeddingService } from '../services/embedding-service';
import { FunctionInfo } from '../types';

export function createVectorizeCommand(): Command {
  return new Command('vectorize')
    .description('Generate and manage embeddings for function descriptions')
    .option('--all', 'vectorize all functions with descriptions')
    .option('--recent', 'vectorize only functions without embeddings')
    .option('--status', 'show vectorization status')
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

Supported Models:
  text-embedding-3-small    1536 dimensions (default, cost-effective)
  text-embedding-3-large    3072 dimensions (higher quality)
  text-embedding-ada-002    1536 dimensions (legacy)

Environment:
  OPENAI_API_KEY    OpenAI API key for generating embeddings
`);
}
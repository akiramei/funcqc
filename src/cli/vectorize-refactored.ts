/**
 * Refactored vectorize command with improved architecture and UX
 * Addresses issues from #68: separation of concerns, validation, and better error handling
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { ConfigManager } from '../core/config';
import { PGLiteStorageAdapter } from '../storage/pglite-adapter';
import { EmbeddingService } from '../services/embedding-service';
import { VectorizeUseCase } from '../use-cases/vectorize-use-case';
import { VectorizeOptionsValidator } from '../use-cases/vectorize-options';
import { ConfirmationHandler } from '../use-cases/confirmation-handler';
import { OutputFormatter } from '../use-cases/output-formatter';

export function createVectorizeCommand(): Command {
  return new Command('vectorize')
    .description('Generate and manage embeddings for function descriptions')
    .option('--all', 'vectorize all functions with descriptions')
    .option('--recent', 'vectorize only functions without embeddings (default)')
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
    .option('--output <format>', 'output format (console, json)', 'console')
    .option('--force', 'skip confirmation prompts')
    .option('--quiet', 'reduce output verbosity')
    .action(async (rawOptions) => {
      const spinner = ora();
      let storage: PGLiteStorageAdapter | null = null;
      
      try {
        // Phase 1: Validate options with comprehensive error reporting
        const validator = new VectorizeOptionsValidator();
        const validation = validator.validate(rawOptions);
        
        if (!validation.success) {
          console.error(chalk.red('❌ Invalid options:'));
          validation.errors?.forEach(error => {
            console.error(chalk.red(`  • ${error}`));
          });
          process.exit(1);
        }
        
        const options = validation.data!;
        
        // Phase 2: Initialize dependencies
        spinner.start('Initializing...');
        const configManager = new ConfigManager();
        const config = await configManager.load();
        storage = new PGLiteStorageAdapter(config.storage.path || '.funcqc/funcqc.db');
        await storage.init();
        
        // Phase 3: Check API key requirement
        const apiKey = options.apiKey || process.env['OPENAI_API_KEY'];
        
        if (validator.requiresApiKey(options) && !apiKey) {
          spinner.fail('OpenAI API key is required for this operation');
          console.log('Provide it via --api-key option or OPENAI_API_KEY environment variable');
          process.exit(1);
        }
        
        // Phase 4: Initialize embedding service if needed
        let embeddingService: EmbeddingService | undefined;
        if (apiKey && validator.requiresApiKey(options)) {
          embeddingService = new EmbeddingService({
            apiKey,
            model: options.model,
            batchSize: options.batchSize
          });
        }
        
        // Phase 5: Handle dangerous operation confirmation
        if (validator.isDangerousOperation(options) && !options.force) {
          const confirmationHandler = new ConfirmationHandler();
          
          // Get function count for cost estimation
          let functionCount = 0;
          try {
            const snapshots = await storage.getSnapshots({ limit: 1 });
            if (snapshots.length > 0) {
              const functions = await storage.getFunctionsWithDescriptions(snapshots[0].id);
              functionCount = options.limit ? Math.min(functions.length, options.limit) : functions.length;
            }
          } catch {
            // Ignore errors, proceed without count
          }
          
          const estimatedCost = confirmationHandler.estimateEmbeddingCost(
            functionCount, 
            options.model
          );
          
          const message = confirmationHandler.createVectorizeConfirmationMessage(
            validator.getOperationDescription(options),
            functionCount,
            estimatedCost
          );
          
          spinner.stop();
          const confirmation = await confirmationHandler.confirm({
            message,
            defaultValue: false
          });
          
          if (!confirmation.confirmed) {
            console.log(chalk.yellow('Operation cancelled by user.'));
            process.exit(0);
          }
        }
        
        // Phase 6: Execute the operation using UseCase
        spinner.start(`Executing ${validator.getOperationDescription(options).toLowerCase()}...`);
        
        const useCase = new VectorizeUseCase({
          storage,
          embeddingService: embeddingService || undefined
        });
        
        const result = await useCase.execute(options);
        spinner.stop();
        
        // Phase 7: Format and display results
        const formatter = new OutputFormatter({
          format: options.output,
          quiet: options.quiet || false,
          color: process.stdout.isTTY // Auto-detect color support
        });
        
        const output = formatter.format(result);
        console.log(output);
        
        // Phase 8: Handle exit code
        if (!result.success) {
          process.exit(1);
        }
        
      } catch (error) {
        spinner.fail('Operation failed');
        
        if (rawOptions.output === 'json') {
          // JSON error output
          const errorOutput = {
            success: false,
            operation: 'unknown',
            timestamp: new Date().toISOString(),
            errors: [error instanceof Error ? error.message : String(error)]
          };
          console.log(JSON.stringify(errorOutput, null, 2));
        } else {
          // Console error output
          console.error(chalk.red('❌ Error:'), error instanceof Error ? error.message : String(error));
        }
        
        process.exit(1);
      } finally {
        // Phase 9: Cleanup
        if (storage) {
          try {
            await storage.close();
          } catch {
            // Ignore cleanup errors
            console.warn(chalk.yellow('Warning: Failed to close storage connection'));
          }
        }
      }
    });
}
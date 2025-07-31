/**
 * Residue Check Command
 * 
 * Detects debug code residue in TypeScript projects
 */

import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { globby } from 'globby';
import { cosmiconfig } from 'cosmiconfig';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { ResidueCheckOptions, ResidueDetectionConfig } from '../../types/debug-residue';
import { DebugResidueDetector } from '../../analyzers/debug-residue-detector';
import { ResidueFormatter } from '../../utils/residue-formatter';
import { createErrorHandler, ErrorCode } from '../../utils/error-handler';

/**
 * Load residue configuration
 */
async function loadResidueConfig(configPath?: string): Promise<Partial<ResidueDetectionConfig>> {
  const explorer = cosmiconfig('funcqc-residue', {
    searchPlaces: [
      '.funcqc-residue.yaml',
      '.funcqc-residue.yml',
      '.funcqc-residue.json',
      '.funcqc-residue.js',
      'funcqc-residue.config.js'
    ]
  });

  try {
    let result;
    if (configPath) {
      result = await explorer.load(configPath);
    } else {
      result = await explorer.search();
    }
    
    return result?.config || {};
  } catch {
    // Return empty config if loading fails
    return {};
  }
}

/**
 * Get TypeScript files to analyze
 */
async function getFilesToAnalyze(targetPath?: string): Promise<string[]> {
  if (targetPath) {
    // Check if it's a single file
    try {
      const stats = await import('fs').then(fs => fs.promises.stat(targetPath));
      if (stats.isFile() && (targetPath.endsWith('.ts') || targetPath.endsWith('.tsx'))) {
        return [path.resolve(targetPath)];
      }
    } catch {
      // If stat fails, continue with directory patterns
    }
    
    // Directory patterns
    const patterns = [
      path.join(targetPath, '**/*.ts'),
      path.join(targetPath, '**/*.tsx')
    ];
    
    const excludePatterns = [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/*.d.ts'
    ];

    return globby(patterns, {
      ignore: excludePatterns,
      absolute: true
    });
  }
  
  // Default patterns for entire project
  const patterns = ['**/*.ts', '**/*.tsx'];
  const excludePatterns = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/*.d.ts'
  ];

  return globby(patterns, {
    ignore: excludePatterns,
    absolute: true
  });
}

/**
 * Residue check command implementation
 */
export const residueCheckCommand: VoidCommand<ResidueCheckOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora();

    try {
      // Start detection
      if (!options.quiet) {
        env.commandLogger.log(chalk.bold('🔍 Checking for debug residue...'));
      }

      // Load configuration
      spinner.start('Loading configuration...');
      const userConfig = await loadResidueConfig(options.config);
      const config: ResidueDetectionConfig = {
        ...userConfig,
        tsconfigPath: userConfig.tsconfigPath || 'tsconfig.json'
      };
      spinner.succeed('Configuration loaded');

      // Get files to analyze
      spinner.start('Finding TypeScript files...');
      const files = await getFilesToAnalyze(options.path);
      
      if (files.length === 0) {
        spinner.fail('No TypeScript files found');
        return;
      }
      
      spinner.succeed(`Found ${files.length} TypeScript files`);

      // Create detector and analyze
      spinner.start('Analyzing code for debug residue...');
      const detector = new DebugResidueDetector(config);
      const includeContext = options.verbose || options.details || options.aiMode || false;
      const result = await detector.analyze(files, includeContext);
      spinner.succeed('Analysis complete');

      // Format and output results
      const formatted = ResidueFormatter.format(result, {
        json: options.json || false,
        aiMode: options.aiMode || false,
        verbose: options.verbose || options.details || false,
        quiet: options.quiet || false
      });

      console.log(formatted);

      // Handle exit code
      if (result.summary.autoRemove > 0) {
        process.exitCode = 1;
      }

      // Show next steps
      if (!options.json && !options.quiet && result.summary.total > 0) {
        console.log(chalk.bold('\nNext steps:'));
        
        if (result.summary.autoRemove > 0) {
          console.log('  • Remove AutoRemove items manually or use --fix (future feature)');
        }
        
        if (result.summary.needsReview > 0) {
          console.log('  • Review NeedsReview items to determine if they are debug-only');
          console.log('  • Consider replacing with proper logging or user notification');
        }
        
        console.log('\n💡 Tips:');
        console.log('  • Use --verbose for detailed context information');
        console.log('  • Use --ai-mode --json for AI-optimized output');
        console.log('  • Configure exemptions in .funcqc-residue.yaml');
      }

    } catch (error) {
      spinner.fail('Detection failed');
      
      const funcqcError = errorHandler.createError(
        ErrorCode.PARSING_FAILED,
        'Failed to detect debug residue',
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
    }
  };

/**
 * Export command options type for CLI registration
 */
export type { ResidueCheckOptions };
import chalk from 'chalk';
import { VoidCommand } from '../../../types/command';
import { CommandEnvironment } from '../../../types/environment';
import { createErrorHandler, ErrorCode } from '../../../utils/error-handler';
import { DetectCommandOptions, DetectSubcommand } from './types';
import { detectIneffectiveSplitsCommand } from './ineffective-splits';

/**
 * Main detect command handler
 */
export const detectCommand = (subcommand: string): VoidCommand<DetectCommandOptions> => 
  (options) => async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      // Validate subcommand
      const validSubcommands: DetectSubcommand[] = ['ineffective-splits'];
      
      if (!validSubcommands.includes(subcommand as DetectSubcommand)) {
        console.log(chalk.red(`Unknown detect subcommand: ${subcommand}`));
        console.log();
        console.log('Available subcommands:');
        console.log('  ineffective-splits    Detect ineffective function splits');
        console.log();
        console.log('Example:');
        console.log('  funcqc detect ineffective-splits');
        return;
      }
      
      // Route to subcommand
      switch (subcommand as DetectSubcommand) {
        case 'ineffective-splits':
          await detectIneffectiveSplitsCommand(options)(env);
          break;
      }
      
    } catch (error) {
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `Detect command failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
    }
  };
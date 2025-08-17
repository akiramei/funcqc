import { TypeHealthOptions } from '../../types.types';
import { VoidCommand } from '../../../../types/command';
import { CommandEnvironment } from '../../../../types/environment';
import { createErrorHandler, ErrorCode, FuncqcError } from '../../../../utils/error-handler';
import { 
  calculateTypeHealthFromDB, 
  displayTypeHealthDB 
} from '../shared/health-operations';

/**
 * Execute types health command using database
 */
export const executeTypesHealthDB: VoidCommand<TypeHealthOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      env.commandLogger.info('🏥 Analyzing type health from database...');
      
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run scan first to analyze the codebase.');
      }
      const latestSnapshot = snapshots[0];
      const types = await env.storage.getTypeDefinitions(latestSnapshot.id);
    
    if (types.length === 0) {
      console.log('No types found. Run scan first to analyze types.');
      return;
    }
    
    // Calculate health metrics
    const healthReport = calculateTypeHealthFromDB(types);
    
    if (options.json) {
      console.log(JSON.stringify(healthReport, null, 2));
    } else {
      displayTypeHealthDB(healthReport, options.verbose);
    }
  } catch (error) {
    // Check if it's already a FuncqcError
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
      errorHandler.handleError(error as FuncqcError);
    } else {
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `Failed to analyze type health: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
    }
  }
};
import { TypeDepsOptions } from '../types.types';
import { VoidCommand } from '../../../types/command';
import { CommandEnvironment } from '../../../types/environment';
import { createErrorHandler, ErrorCode, FuncqcError } from '../../../../utils/error-handler';
import { 
  analyzeDependenciesFromDB, 
  findCircularDependencies, 
  displayCircularDependenciesDB, 
  displayDependenciesDB 
} from '../shared/dependency-operations';

/**
 * Execute types deps command using database
 */
export const executeTypesDepsDB: VoidCommand<TypeDepsOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      // Get typeName from options (passed from action)
      const typeName = (options as { typeName?: string }).typeName || '';
      
      env.commandLogger.info(`🔗 Analyzing dependencies for type: ${typeName}`);
      
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run scan first to analyze the codebase.');
      }
      const latestSnapshot = snapshots[0];
      const targetType = await env.storage.findTypeByName(typeName, latestSnapshot.id);
    
    if (!targetType) {
      const funcqcError = errorHandler.createError(
        ErrorCode.NOT_FOUND,
        `Type '${typeName}' not found`,
        { typeName }
      );
      throw funcqcError;
    }
    
    const relationships = await env.storage.getTypeRelationships(latestSnapshot.id);
    const depth = 
      typeof options.depth === 'number' && Number.isFinite(options.depth) 
        ? options.depth 
        : 3;
    const dependencies = analyzeDependenciesFromDB(
      targetType,
      relationships,
      depth
    );
    
    if (options.circular) {
      const circularDeps = findCircularDependencies(dependencies);
      if (options.json) {
        console.log(JSON.stringify(circularDeps, null, 2));
      } else {
        displayCircularDependenciesDB(circularDeps);
      }
    } else {
      if (options.json) {
        console.log(JSON.stringify(dependencies, null, 2));
      } else {
        displayDependenciesDB(typeName, dependencies);
      }
    }
  } catch (error) {
    // Check if it's already a FuncqcError
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
      errorHandler.handleError(error as FuncqcError);
    } else {
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `Failed to analyze type dependencies: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
    }
  }
};
import { TypeRiskOptions, isUuidOrPrefix } from '../../types.types';
import { TypeDefinition } from '../../../../types';
import { VoidCommand } from '../../../../types/command';
import { CommandEnvironment } from '../../../../types/environment';
import { createErrorHandler, ErrorCode } from '../../../../utils/error-handler';
import type { FuncqcError } from '../../../../types';
import { findTypeById } from '../shared/utils';


/**
 * Execute types risk command using database
 */
export const executeTypesRiskDB: VoidCommand<TypeRiskOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      const typeNameOrId = options.typeName?.trim() ?? '';
      if (!typeNameOrId) {
        const funcqcError = errorHandler.createError(
          ErrorCode.MISSING_ARGUMENT,
          'Type identifier is required. Provide a type name or id (UUID/prefix) via --type.',
          { option: '--type' }
        );
        throw funcqcError;
      }
      
      env.commandLogger.info(`⚠️ Analyzing dependency risk for type: ${typeNameOrId}`);
      
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run scan first to analyze the codebase.');
      }
      const latestSnapshot = snapshots[0];
      
      // Try to find by ID first (if looks like UUID), then by name
      let targetType: TypeDefinition | null = null;
      if (isUuidOrPrefix(typeNameOrId)) {
        // Looks like a UUID or UUID prefix
        targetType = await findTypeById(env.storage, typeNameOrId, latestSnapshot.id);
      }
      if (!targetType) {
        targetType = await env.storage.findTypeByName(typeNameOrId, latestSnapshot.id);
      }
    
      if (!targetType) {
        const funcqcError = errorHandler.createError(
          ErrorCode.NOT_FOUND,
          `Type '${typeNameOrId}' not found (searched by ID and name)`,
          { typeNameOrId }
        );
        throw funcqcError;
      }
      
      // Import and use the risk analyzer
      const { DependencyRiskAnalyzer } = await import('../../../../analyzers/type-insights/dependency-risk');
      const analyzer = new DependencyRiskAnalyzer(env.storage);
      
      const analysis = await analyzer.analyzeDependencyRisk(
        targetType.id,
        latestSnapshot.id
      );
      
      if (!analysis) {
        console.log(`⚠️  No risk analysis available for type ${targetType.name}`);
        return;
      }
      
      if (options.json) {
        console.log(JSON.stringify(analysis, null, 2));
      } else {
        console.log(analyzer.formatDependencyRiskAnalysis(analysis));
      }
      
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as FuncqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze dependency risk: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };
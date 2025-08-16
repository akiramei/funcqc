import { TypeListOptions } from '../types.types';
import { VoidCommand } from '../../../types/command';
import { CommandEnvironment } from '../../../types/environment';
import { createErrorHandler, ErrorCode, FuncqcError } from '../../../../utils/error-handler';
import { 
  getMemberCountsForTypes, 
  sortTypesDB, 
  displayTypesListDB, 
  type MemberCounts,
  type CouplingInfo 
} from '../shared/list-operations';
import { applyTypeFilters } from '../shared/filters';

/**
 * Execute types list command using database
 */
export const executeTypesListDB: VoidCommand<TypeListOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      // Silently load types first - only show messages if initialization needed
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run scan first to analyze the codebase.');
      }
      const latestSnapshot = snapshots[0];
      let types = await env.storage.getTypeDefinitions(latestSnapshot.id);
    
    // If no types found, trigger lazy type system analysis
    if (types.length === 0) {
      const isJsonMode = options.json;
      
      if (!isJsonMode) {
        console.log(`🔍 Type system analysis needed for ${latestSnapshot.id.substring(0, 8)}...`);
      }
      
      // Create a minimal command environment for type analysis
      const { createAppEnvironment, destroyAppEnvironment } = await import('../../../core/environment');
      const appEnv = await createAppEnvironment({
        quiet: Boolean(isJsonMode),
        verbose: false,
      });
      
      try {
        const commandEnv = env;
        
        // Ensure basic analysis is done first
        const metadata = latestSnapshot.metadata as Record<string, unknown>;
        const analysisLevel = (metadata?.['analysisLevel'] as string) || 'NONE';
        
        if (analysisLevel === 'NONE') {
          const { performDeferredBasicAnalysis } = await import('../scan');
          await performDeferredBasicAnalysis(latestSnapshot.id, commandEnv, !isJsonMode);
        }
        
        // Perform type system analysis
        const { performDeferredTypeSystemAnalysis } = await import('../scan');
        const result = await performDeferredTypeSystemAnalysis(latestSnapshot.id, commandEnv, !isJsonMode);
        
        if (!isJsonMode) {
          console.log(`✓ Type system analysis completed (${result.typesAnalyzed} types)`);
        }
        
        // Reload types after analysis (wait for transaction commit)
        if (process.env['DEBUG'] === 'true') {
          env.commandLogger.debug('Waiting for transaction commit...');
        }
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms for commit
        
        // Debug: Check if tables exist at all
        if (process.env['DEBUG'] === 'true') {
          env.commandLogger.debug('Debugging database state...');
          try {
            const tableCheck = await env.storage.query("SELECT table_name FROM information_schema.tables WHERE table_name = 'type_definitions'");
            env.commandLogger.debug(`type_definitions table exists: ${tableCheck.rows.length > 0}`);
            
            if (tableCheck.rows.length > 0) {
              const countCheck = await env.storage.query("SELECT COUNT(*) as count FROM type_definitions");
              env.commandLogger.debug(`Total rows in type_definitions: ${JSON.stringify(countCheck.rows[0])}`);
              
              const snapshotCheck = await env.storage.query("SELECT COUNT(*) as count FROM type_definitions WHERE snapshot_id = $1", [latestSnapshot.id]);
              env.commandLogger.debug(`Rows for snapshot ${latestSnapshot.id}: ${JSON.stringify(snapshotCheck.rows[0])}`);
            } else {
              env.commandLogger.debug('type_definitions table does not exist in database!');
            }
          } catch (error) {
            env.commandLogger.debug(`Debug query failed: ${error}`);
          }
        }
        
        if (process.env['DEBUG'] === 'true') {
          env.commandLogger.debug(`Reloading types from snapshot ${latestSnapshot.id}`);
        }
        types = await env.storage.getTypeDefinitions(latestSnapshot.id);
        if (process.env['DEBUG'] === 'true') {
          env.commandLogger.debug(`Found ${types.length} types after analysis`);
        }
      } finally {
        await destroyAppEnvironment(appEnv);
      }
    }
    
    if (types.length === 0) {
      if (options.json) {
        console.log(JSON.stringify([], null, 2));
      } else {
        console.log('No types found in the codebase.');
      }
      return;
    }
    
    // Get comprehensive member counts for types
    const memberCounts = await getMemberCountsForTypes(env.storage, types, latestSnapshot.id);
    
    // Apply filters (pass member counts for filtering)
    types = await applyTypeFilters(types, options, memberCounts);
    
    // Sort types (pass member counts for sorting)
    types = sortTypesDB(types, options.sort || 'name', options.desc, memberCounts);
    
    // Apply limit
    if (options.limit && options.limit > 0) {
      types = types.slice(0, options.limit);
    }
    
    // Coupling analysis (temporarily disabled due to performance issues)
    const couplingData: Map<string, CouplingInfo> = new Map();
    // TODO: Optimize analyzeCouplingForTypes query performance
    // if (types.length > 0) {
    //   couplingData = await analyzeCouplingForTypes(env.storage, types, latestSnapshot.id);
    // }
    
    // Output results
    if (options.json) {
      const output = types.map(type => {
        const memberCount = memberCounts.get(type.id);
        const functionCount = memberCount ? memberCount.methods + memberCount.constructors : 0;
        return {
          ...type,
          functionCount, // Legacy field for backward compatibility
          memberCounts: memberCount,
          ...(couplingData.has(type.id) && { coupling: couplingData.get(type.id) })
        };
      });
      console.log(JSON.stringify(output, null, 2));
    } else {
      displayTypesListDB(types, couplingData, memberCounts, options.detail, options.showLocation, options.showId);
    }

  } catch (error) {
    // Check if it's already a FuncqcError
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
      errorHandler.handleError(error as FuncqcError);
    } else {
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `Failed to list types: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
    }
  }
};
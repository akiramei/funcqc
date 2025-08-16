import { MeasureCommandOptions, ScanCommandOptions } from '../../types';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { createErrorHandler, ErrorCode } from '../../utils/error-handler';
import { DatabaseError } from '../../storage/pglite-adapter';

/**
 * Measure command - unified scan and analyze functionality
 * Consolidates scan + analyze into a single measurement workflow
 */
export const measureCommand: VoidCommand<MeasureCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      if (!options.quiet) {
        env.commandLogger.log('📊 Starting comprehensive measurement...');
      }

      // Determine measurement level and scope
      const measurementPlan = determineMeasurementPlan(options);
      
      if (!options.quiet) {
        env.commandLogger.log(`🎯 Measurement plan: ${measurementPlan.description}`);
        env.commandLogger.log(`📈 Estimated time: ${measurementPlan.estimatedTime}`);
      }

      // Execute measurement workflow
      await executeMeasurementWorkflow(env, options, measurementPlan);

      if (!options.quiet) {
        env.commandLogger.log('✅ Comprehensive measurement completed successfully!');
        
        if (options.json) {
          await outputMeasurementResults(env, options);
        } else {
          await displayMeasurementSummary(env, options);
        }
      }

    } catch (error) {
      if (error instanceof DatabaseError) {
        const funcqcError = errorHandler.createError(
          error.code,
          error.message,
          {},
          error.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to execute measurement: ${error instanceof Error ? error.message : String(error)}`,
          { options },
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Measurement plan configuration
 */
interface MeasurementPlan {
  level: string;
  description: string;
  estimatedTime: string;
  includesScan: boolean;
  includesCallGraph: boolean;
  includesTypes: boolean;
  includesCoupling: boolean;
  scanOptions: Partial<ScanCommandOptions>; // Options to pass to scan command
  analyzeOptions: { // Options to pass to analyze command
    callGraph?: boolean;
    types?: boolean;
    all?: boolean;
  };
}

/**
 * Determine measurement plan based on options
 */
function determineMeasurementPlan(options: MeasureCommandOptions): MeasurementPlan {
  // Handle level-based configuration
  if (options.level) {
    switch (options.level) {
      case 'quick':
        return {
          level: 'quick',
          description: 'Quick measurement (snapshot only)',
          estimatedTime: '5-10s',
          includesScan: true,
          includesCallGraph: false,
          includesTypes: false,
          includesCoupling: false,
          scanOptions: { quick: true },
          analyzeOptions: {}
        };
      
      case 'basic':
        return {
          level: 'basic',
          description: 'Basic measurement (functions only)',
          estimatedTime: '15-20s',
          includesScan: true,
          includesCallGraph: false,
          includesTypes: false,
          includesCoupling: false,
          scanOptions: { withBasic: true },
          analyzeOptions: {}
        };
      
      case 'standard':
        return {
          level: 'standard',
          description: 'Standard measurement (with call graph)',
          estimatedTime: '30-40s',
          includesScan: true,
          includesCallGraph: true,
          includesTypes: false,
          includesCoupling: false,
          scanOptions: { withGraph: true },
          analyzeOptions: { callGraph: true }
        };
      
      case 'deep':
        return {
          level: 'deep',
          description: 'Deep measurement (with types and coupling)',
          estimatedTime: '40-50s',
          includesScan: true,
          includesCallGraph: true,
          includesTypes: true,
          includesCoupling: true,
          scanOptions: { withTypes: true, withCoupling: true },
          analyzeOptions: { callGraph: true, types: true }
        };
      
      case 'complete':
        return {
          level: 'complete',
          description: 'Complete measurement (all analyses)',
          estimatedTime: '50-60s',
          includesScan: true,
          includesCallGraph: true,
          includesTypes: true,
          includesCoupling: true,
          scanOptions: { full: true },
          analyzeOptions: { all: true }
        };
    }
  }

  // Handle legacy option combinations
  if (options.full) {
    return determineMeasurementPlan({ ...options, level: 'complete' });
  }
  
  if (options.withBasic) {
    return determineMeasurementPlan({ ...options, level: 'basic' });
  }

  // Build custom plan based on specific options
  const includesCallGraph = !!(options.callGraph || options.withGraph);
  const includesTypes = !!(options.types || options.withTypes);
  const includesCoupling = !!(options.coupling || options.withCoupling);

  let estimatedTime = '15-20s';
  let description = 'Custom measurement';
  
  if (includesCallGraph && includesTypes && includesCoupling) {
    estimatedTime = '50-60s';
    description = 'Complete custom measurement';
  } else if (includesCallGraph || includesTypes) {
    estimatedTime = '30-40s';
    description = 'Extended custom measurement';
  }

  return {
    level: 'custom',
    description,
    estimatedTime,
    includesScan: true,
    includesCallGraph,
    includesTypes,
    includesCoupling,
    scanOptions: {
      withBasic: true,
      withGraph: includesCallGraph,
      withTypes: includesTypes,
      withCoupling: includesCoupling
    },
    analyzeOptions: {
      callGraph: includesCallGraph,
      types: includesTypes
    }
  };
}

/**
 * Execute the complete measurement workflow
 */
async function executeMeasurementWorkflow(
  env: CommandEnvironment,
  options: MeasureCommandOptions,
  plan: MeasurementPlan
): Promise<void> {
  // Phase 1: Scan (always included)
  if (plan.includesScan) {
    if (!options.quiet) {
      env.commandLogger.log('📦 Phase 1: Function scanning...');
    }
    
    // Execute integrated scan functionality
    await executeScanPhase(env, options, plan);
  }

  // Phase 2: Additional analyses (if requested)
  if (plan.includesCallGraph || plan.includesTypes) {
    if (!options.quiet) {
      env.commandLogger.log('🔄 Phase 2: Advanced analysis...');
    }
    
    // Execute integrated analyze functionality
    await executeAnalyzePhase(env, options, plan);
  }
}

/**
 * Execute scan functionality (integrated from scan command)
 */
async function executeScanPhase(
  env: CommandEnvironment,
  options: MeasureCommandOptions,
  plan: MeasurementPlan
): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.log(`   📊 Scanning functions (${plan.level} level)...`);
  }
  
  // Convert measure options to scan options
  const scanOptions: ScanCommandOptions = {
    label: options.label,
    comment: options.comment,
    scope: options.scope,
    realtimeGate: options.realtimeGate,
    json: false, // Internal execution, no JSON output
    force: options.force,
    ...plan.scanOptions // Apply level-specific options
  };
  
  try {
    // Import and execute scan command functionality
    const { scanCommand } = await import('./scan');
    await scanCommand(scanOptions)(env);
    
    if (options.verbose) {
      env.commandLogger.log('   ✅ Function scanning completed');
    }
  } catch (error) {
    throw new Error(`Scan phase failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute analyze functionality (integrated from analyze command)
 */
async function executeAnalyzePhase(
  env: CommandEnvironment,
  options: MeasureCommandOptions,
  plan: MeasurementPlan
): Promise<void> {
  const analyses = [];
  if (plan.includesCallGraph) analyses.push('call graph');
  if (plan.includesTypes) analyses.push('type system');
  if (plan.includesCoupling) analyses.push('coupling');

  if (!options.quiet) {
    env.commandLogger.log(`   🔍 Running ${analyses.join(', ')} analysis...`);
  }
  
  // Convert measure options to analyze options
  const analyzeOptions = {
    callGraph: plan.includesCallGraph,
    types: plan.includesTypes,
    all: plan.includesCallGraph && plan.includesTypes,
    json: false, // Internal execution, no JSON output
    verbose: options.verbose || false,
    quiet: options.quiet || false
  };
  
  try {
    // Import and execute analyze command functionality
    const { analyzeCommand } = await import('./analyze');
    await analyzeCommand(analyzeOptions)(env);
    
    if (options.verbose) {
      env.commandLogger.log(`   ✅ ${analyses.join(', ')} analysis completed`);
    }
  } catch (error) {
    throw new Error(`Analysis phase failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Output measurement results in JSON format
 */
async function outputMeasurementResults(
  _env: CommandEnvironment,
  options: MeasureCommandOptions
): Promise<void> {
  // TODO: Implement comprehensive JSON output
  // This should include:
  // - Snapshot information
  // - Function metrics
  // - Analysis results
  // - Quality metrics

  const results = {
    measurement: {
      timestamp: new Date().toISOString(),
      level: options.level || 'custom',
      scope: options.scope || 'all'
    },
    // TODO: Add real measurement data
    placeholder: 'Full JSON output to be implemented with real data'
  };

  console.log(JSON.stringify(results, null, 2));
}

/**
 * Display measurement summary in human-readable format
 */
async function displayMeasurementSummary(
  _env: CommandEnvironment,
  options: MeasureCommandOptions
): Promise<void> {
  console.log();
  console.log('📊 Measurement Summary');
  console.log('--------------------------------------------------');
  console.log(`🎯 Level: ${options.level || 'custom'}`);
  console.log(`📦 Scope: ${options.scope || 'all'}`);
  console.log();
  
  // TODO: Add real measurement statistics
  console.log('📈 Results:');
  console.log('   • Functions analyzed: [to be implemented]');
  console.log('   • Quality metrics: [to be implemented]');
  console.log('   • Analysis time: [to be implemented]');
  console.log();
  
  console.log('💡 Next steps:');
  console.log('   • Run `funcqc inspect` to explore results');
  console.log('   • Run `funcqc health` for quality analysis');
  console.log('   • Run `funcqc list --cc-ge 10` for complex functions');
}
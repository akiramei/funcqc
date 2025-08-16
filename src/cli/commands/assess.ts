import { AssessCommandOptions } from '../../types';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { createErrorHandler, ErrorCode } from '../../utils/error-handler';
import { DatabaseError } from '../../storage/pglite-adapter';

/**
 * Assess command - unified quality assessment functionality
 * Consolidates health, evaluate, and types health into a single assessment workflow
 */
export const assessCommand: VoidCommand<AssessCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      if (!options.quiet) {
        env.commandLogger.log('📊 Starting quality assessment analysis...');
      }

      // Determine assessment type and strategy
      const assessmentPlan = determineAssessmentPlan(options);
      
      if (!options.quiet) {
        env.commandLogger.log(`🎯 Assessment plan: ${assessmentPlan.description}`);
        env.commandLogger.log(`⏱️  Estimated time: ${assessmentPlan.estimatedTime}`);
      }

      // Execute assessment workflow
      await executeAssessmentWorkflow(env, options, assessmentPlan);

      if (!options.quiet) {
        env.commandLogger.log('✅ Quality assessment analysis completed successfully!');
        
        if (options.json) {
          await outputAssessmentResults(env, options);
        } else {
          await displayAssessmentSummary(env, options);
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
          `Failed to execute assessment: ${error instanceof Error ? error.message : String(error)}`,
          { options },
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Assessment plan configuration
 */
interface AssessmentPlan {
  type: string;
  description: string;
  estimatedTime: string;
  includesHealth: boolean;
  includesQuality: boolean;
  includesTypes: boolean;
  detailLevel: 'basic' | 'standard' | 'comprehensive';
}

/**
 * Determine assessment plan based on options
 */
function determineAssessmentPlan(options: AssessCommandOptions): AssessmentPlan {
  // Handle specific type selection
  if (options.type) {
    switch (options.type) {
      case 'health':
        return {
          type: 'health',
          description: 'Project health assessment',
          estimatedTime: '10-20s',
          includesHealth: true,
          includesQuality: false,
          includesTypes: false,
          detailLevel: options.risks || options.trend ? 'comprehensive' : 'standard'
        };
      
      case 'quality':
        return {
          type: 'quality',
          description: 'Code quality evaluation',
          estimatedTime: '15-30s',
          includesHealth: false,
          includesQuality: true,
          includesTypes: false,
          detailLevel: 'standard'
        };
      
      case 'types':
        return {
          type: 'types',
          description: 'Type system health assessment',
          estimatedTime: '20-40s',
          includesHealth: false,
          includesQuality: false,
          includesTypes: true,
          detailLevel: 'standard'
        };
    }
  }

  // Default: comprehensive assessment
  return {
    type: 'comprehensive',
    description: 'Comprehensive quality assessment (all types)',
    estimatedTime: '30-60s',
    includesHealth: true,
    includesQuality: true,
    includesTypes: true,
    detailLevel: 'comprehensive'
  };
}

/**
 * Execute the complete assessment workflow
 */
async function executeAssessmentWorkflow(
  env: CommandEnvironment,
  options: AssessCommandOptions,
  plan: AssessmentPlan
): Promise<void> {
  // Phase 1: Health assessment (if requested)
  if (plan.includesHealth) {
    if (!options.quiet) {
      env.commandLogger.log('🏥 Phase 1: Analyzing project health...');
    }
    
    await executeHealthAssessment(env, options, plan);
  }

  // Phase 2: Quality evaluation (if requested)
  if (plan.includesQuality) {
    if (!options.quiet) {
      env.commandLogger.log('🔍 Phase 2: Evaluating code quality...');
    }
    
    await executeQualityEvaluation(env, options, plan);
  }

  // Phase 3: Type system assessment (if requested)
  if (plan.includesTypes) {
    if (!options.quiet) {
      env.commandLogger.log('🔧 Phase 3: Assessing type system health...');
    }
    
    await executeTypesAssessment(env, options, plan);
  }
}

/**
 * Execute health assessment (integrated from health command)
 */
async function executeHealthAssessment(
  env: CommandEnvironment,
  options: AssessCommandOptions,
  plan: AssessmentPlan
): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.log(`   🩺 Analyzing overall project health...`);
  }
  
  // Convert assess options to health options
  const healthOptions = {
    trend: options.trend || false,
    risks: options.risks || false,
    verbose: plan.detailLevel === 'comprehensive',
    json: false, // Internal execution, no JSON output
    quiet: options.quiet || false
  };
  
  try {
    // Import and execute health command functionality
    const { healthCommand } = await import('./health');
    await healthCommand(healthOptions)(env);
    
    if (options.verbose) {
      env.commandLogger.log('   ✅ Health assessment completed');
    }
  } catch (error) {
    throw new Error(`Health assessment failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute quality evaluation (integrated from evaluate command)
 */
async function executeQualityEvaluation(
  env: CommandEnvironment,
  options: AssessCommandOptions,
  plan: AssessmentPlan
): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.log(`   🔍 Evaluating code quality metrics...`);
  }
  
  // Convert assess options to evaluate options
  const evaluateOptions = {
    json: false, // Internal execution, no JSON output
    verbose: options.verbose || false,
    evaluateAll: true // Evaluate all functions for comprehensive assessment
  };
  
  try {
    // Import and execute evaluate command functionality
    const { evaluateCommand } = await import('./evaluate');
    await evaluateCommand(evaluateOptions)(env);
    
    if (options.verbose) {
      env.commandLogger.log('   ✅ Quality evaluation completed');
    }
  } catch (error) {
    throw new Error(`Quality evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute type system assessment (integrated from types health functionality)
 */
async function executeTypesAssessment(
  env: CommandEnvironment,
  options: AssessCommandOptions,
  plan: AssessmentPlan
): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.log(`   🔧 Assessing type system health...`);
  }
  
  try {
    // TODO: Implement types health integration
    // This would integrate with types health functionality from types command
    // For now, provide a placeholder indicating the feature is planned
    
    if (options.verbose) {
      env.commandLogger.log('   ⚠️  Type system assessment not yet implemented');
      env.commandLogger.log('   💡 Use `funcqc types health` for type system analysis');
    }
  } catch (error) {
    throw new Error(`Type system assessment failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Output assessment results in JSON format
 */
async function outputAssessmentResults(
  _env: CommandEnvironment,
  options: AssessCommandOptions
): Promise<void> {
  // TODO: Implement comprehensive JSON output
  // This should include:
  // - Health metrics and scores
  // - Quality evaluation results
  // - Type system health indicators
  // - Overall assessment grades

  const results = {
    assessment: {
      timestamp: new Date().toISOString(),
      type: options.type || 'comprehensive',
      scope: options.scope || 'all'
    },
    // TODO: Add real assessment data
    placeholder: 'Full JSON output to be implemented with real data'
  };

  console.log(JSON.stringify(results, null, 2));
}

/**
 * Display assessment summary in human-readable format
 */
async function displayAssessmentSummary(
  _env: CommandEnvironment,
  options: AssessCommandOptions
): Promise<void> {
  console.log();
  console.log('📊 Quality Assessment Summary');
  console.log('--------------------------------------------------');
  console.log(`🎯 Type: ${options.type || 'comprehensive'}`);
  console.log(`📦 Scope: ${options.scope || 'all'}`);
  console.log();
  
  // TODO: Add real assessment statistics
  console.log('📈 Results:');
  console.log('   • Health Index: [to be implemented]');
  console.log('   • Quality Score: [to be implemented]');
  console.log('   • Type Coverage: [to be implemented]');
  console.log();
  
  console.log('💡 Next steps:');
  console.log('   • Run `funcqc improve` to find improvement opportunities');
  console.log('   • Run `funcqc assess --type health --risks` for detailed risk analysis');
  console.log('   • Run `funcqc measure` to track changes over time');
}
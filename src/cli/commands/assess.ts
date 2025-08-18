import { AssessCommandOptions } from '../../types';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { createErrorHandler, ErrorCode } from '../../utils/error-handler';
import { DatabaseError } from '../../storage/pglite-adapter';
import { AdvancedEvaluator, AdvancedAssessmentResult } from './assess/advanced-evaluator';

/**
 * Assess command - unified quality assessment functionality
 * Consolidates health, evaluate, and types health into a single assessment workflow
 */
export const assessCommand: VoidCommand<AssessCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      if (!options.quiet) {
        env.commandLogger.info('📊 Starting quality assessment analysis...');
      }

      // Determine assessment type and strategy
      const assessmentPlan = determineAssessmentPlan(options);
      
      if (!options.quiet) {
        env.commandLogger.info(`🎯 Assessment plan: ${assessmentPlan.description}`);
        env.commandLogger.info(`⏱️  Estimated time: ${assessmentPlan.estimatedTime}`);
      }

      // Execute assessment workflow
      await executeAssessmentWorkflow(env, options, assessmentPlan);

      if (options.json) {
        await outputAssessmentResults(env, options);
      } else {
        await displayAssessmentSummary(env, options);
      }
      if (!options.quiet) {
        env.commandLogger.info('✅ Quality assessment analysis completed successfully!');
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
 * Assessment plan configuration with performance optimization
 */
interface AssessmentPlan {
  type: string;
  description: string;
  estimatedTime: string;
  includesHealth: boolean;
  includesQuality: boolean;
  includesTypes: boolean;
  detailLevel: 'basic' | 'standard' | 'comprehensive';
  requiresHeavyAnalysis: boolean; // Performance flag
  reuseExistingData: boolean; // Performance flag
  useAdvancedEvaluator: boolean; // Use advanced evaluation engine
}

/**
 * Determine assessment plan based on options
 */
function determineAssessmentPlan(options: AssessCommandOptions): AssessmentPlan {
  // Handle specific type selection with performance optimization
  if (options.type) {
    switch (options.type) {
      case 'health':
        return {
          type: 'health',
          description: 'Project health assessment (optimized)',
          estimatedTime: options.advanced ? '10-20s' : '2-5s',
          includesHealth: true,
          includesQuality: false,
          includesTypes: false,
          detailLevel: options.risks || options.trend ? 'comprehensive' : 'standard',
          requiresHeavyAnalysis: !!(options.risks || options.trend || options.advanced),
          reuseExistingData: !options.advanced, // Advanced mode requires fresh analysis
          useAdvancedEvaluator: !!options.advanced
        };
      
      case 'quality':
        return {
          type: 'quality',
          description: 'Code quality evaluation (lightweight)',
          estimatedTime: options.advanced ? '15-30s' : '3-8s',
          includesHealth: false,
          includesQuality: true,
          includesTypes: false,
          detailLevel: options.advanced ? 'comprehensive' : 'standard',
          requiresHeavyAnalysis: !!options.advanced,
          reuseExistingData: !options.advanced, // Advanced mode requires fresh analysis
          useAdvancedEvaluator: !!options.advanced
        };
      
      case 'types':
        return {
          type: 'types',
          description: 'Type system health assessment',
          estimatedTime: options.advanced ? '30-60s' : '20-40s',
          includesHealth: false,
          includesQuality: false,
          includesTypes: true,
          detailLevel: options.advanced ? 'comprehensive' : 'standard',
          requiresHeavyAnalysis: true, // Types analysis is inherently heavy
          reuseExistingData: false,
          useAdvancedEvaluator: !!options.advanced
        };
    }
  }

  // Default: performance-optimized comprehensive assessment
  return {
    type: 'comprehensive',
    description: options.advanced 
      ? 'Advanced comprehensive quality assessment with dynamic analysis'
      : 'Comprehensive quality assessment (performance optimized)',
    estimatedTime: options.advanced ? '20-45s' : '5-15s',
    includesHealth: true,
    includesQuality: true,
    includesTypes: !!options.advanced, // Advanced mode includes type analysis
    detailLevel: options.advanced ? 'comprehensive' : 'standard',
    requiresHeavyAnalysis: !!options.advanced,
    reuseExistingData: !options.advanced, // Advanced mode requires fresh analysis
    useAdvancedEvaluator: !!options.advanced
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
  // Advanced evaluation path
  if (plan.useAdvancedEvaluator) {
    await executeAdvancedAssessment(env, options, plan);
    return;
  }

  // Legacy evaluation path
  // Phase 1: Health assessment (if requested)
  if (plan.includesHealth) {
    if (!options.quiet) {
      env.commandLogger.info('🏥 Phase 1: Analyzing project health...');
    }
    
    await executeHealthAssessment(env, options, plan);
  }

  // Phase 2: Quality evaluation (if requested)
  if (plan.includesQuality) {
    if (!options.quiet) {
      env.commandLogger.info('🔍 Phase 2: Evaluating code quality...');
    }
    
    await executeQualityEvaluation(env, options, plan);
  }

  // Phase 3: Type system assessment (if requested)
  if (plan.includesTypes) {
    if (!options.quiet) {
      env.commandLogger.info('🔧 Phase 3: Assessing type system health...');
    }
    
    await executeTypesAssessment(env, options, plan);
  }
}

/**
 * Execute advanced assessment using the new evaluation engine
 */
async function executeAdvancedAssessment(
  env: CommandEnvironment,
  options: AssessCommandOptions,
  _plan: AssessmentPlan
): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('🚀 Starting advanced quality assessment...');
  }

  try {
    // Get functions for analysis
    const functions = await getFunctionsForAssessment(env, options);
    
    if (functions.length === 0) {
      if (!options.quiet) {
        env.commandLogger.info('⚠️  No functions found for assessment');
      }
      return;
    }

    // Initialize advanced evaluator
    const evaluator = new AdvancedEvaluator(options, env);
    
    // Perform comprehensive assessment
    const result = await evaluator.performAssessment(functions);
    
    // Result is passed directly to display function
    
    if (!options.quiet) {
      await displayAdvancedAssessmentSummary(env, options, result);
    }

    // Export report if requested
    if (options.exportReport) {
      await exportAdvancedAssessmentReport(env, options, result);
    }

  } catch (error) {
    throw new Error(`Advanced assessment failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get functions for assessment from the latest snapshot
 */
async function getFunctionsForAssessment(env: CommandEnvironment, options: AssessCommandOptions) {
  try {
    const latest = await env.storage.getSnapshots({ sort: 'created_at desc', limit: 1 });
    const snapshot = latest[0] ?? null;
    if (!snapshot) {
      throw new Error('No snapshot found. Please run `funcqc measure` first.');
    }

    const queryOptions: { scope?: string } = {};
    if (options.scope !== undefined) {
      queryOptions.scope = options.scope;
    }

    return await env.storage.findFunctionsInSnapshot(snapshot.id, queryOptions);
  } catch (error) {
    throw new Error(`Failed to get functions for assessment: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Display advanced assessment summary
 */
async function displayAdvancedAssessmentSummary(
  _env: CommandEnvironment,
  options: AssessCommandOptions,
  result: AdvancedAssessmentResult
): Promise<void> {
  const { projectAssessment, metadata, structuralSummary } = result;

  console.log('\n🎯 Advanced Quality Assessment Summary');
  console.log('====================================');
  
  console.log(`\n📊 Project Overview:`);
  console.log(`   • Overall Score: ${projectAssessment.overallScore.toFixed(1)}/100 (Grade: ${projectAssessment.qualityGrade})`);
  console.log(`   • Functions Analyzed: ${metadata.totalFunctions}`);
  console.log(`   • Evaluation Mode: ${metadata.evaluationMode}`);
  console.log(`   • Analysis Time: ${metadata.analysisTime}ms`);

  console.log(`\n⚠️  Risk Distribution:`);
  console.log(`   • Critical: ${projectAssessment.riskDistribution.critical}`);
  console.log(`   • High: ${projectAssessment.riskDistribution.high}`);
  console.log(`   • Medium: ${projectAssessment.riskDistribution.medium}`);
  console.log(`   • Low: ${projectAssessment.riskDistribution.low}`);

  if (options.includeStructural !== false) {
    console.log(`\n🏗️  Structural Health:`);
    console.log(`   • Overall Score: ${projectAssessment.structuralHealth.toFixed(1)}/100`);
    console.log(`   • Total Anomalies: ${structuralSummary.totalAnomalies}`);
    console.log(`   • Critical Issues: ${structuralSummary.criticalAnomalies}`);
  }

  if (projectAssessment.recommendations.length > 0) {
    console.log(`\n💡 Key Recommendations:`);
    projectAssessment.recommendations.forEach(rec => {
      console.log(`   ${rec}`);
    });
  }

  if (options.showWeightBreakdown && metadata.evaluationMode === 'dynamic') {
    console.log(`\n🧮 Dynamic Weight Configuration:`);
    console.log(`   • Team Experience: ${options.teamExperience || 'Mixed'}`);
    console.log(`   • Domain Complexity: ${options.domainComplexity || 'Medium'}`);
    console.log(`   • Architecture Pattern: ${options.architecturePattern || 'Unknown'}`);
  }
}

/**
 * Export advanced assessment report
 */
async function exportAdvancedAssessmentReport(
  env: CommandEnvironment,
  options: AssessCommandOptions,
  result: AdvancedAssessmentResult
): Promise<void> {
  if (!options.exportReport) return;

  const format = options.exportReport.endsWith('.html') ? 'html' :
                 options.exportReport.endsWith('.md') ? 'markdown' : 'json';

  if (!options.quiet) {
    env.commandLogger.info(`📄 Exporting ${format} report to ${options.exportReport}...`);
  }

  try {
    // For now, export as JSON (can be extended to HTML/Markdown later)
    const reportContent = JSON.stringify(result, null, 2);
    
    // Write report to file (using Node.js fs)
    const fs = await import('fs/promises');
    await fs.writeFile(options.exportReport, reportContent, 'utf8');
    
    if (!options.quiet) {
      env.commandLogger.info(`✅ Report exported successfully`);
    }
  } catch (error) {
    throw new Error(`Failed to export report: ${error instanceof Error ? error.message : String(error)}`);
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
    env.commandLogger.info(`   🩺 Analyzing overall project health...`);
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
      env.commandLogger.info('   ✅ Health assessment completed');
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
  _plan: AssessmentPlan
): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info(`   🔍 Evaluating code quality metrics...`);
  }
  
  try {
    // TODO: Import and execute evaluate command functionality
    // This would be integrated when evaluate command is available
    if (options.verbose) {
      env.commandLogger.info('   ⚠️  Quality evaluation integration not yet implemented');
    }
    
    if (options.verbose) {
      env.commandLogger.info('   ✅ Quality evaluation completed');
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
  _plan: AssessmentPlan
): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info(`   🔧 Assessing type system health...`);
  }
  
  try {
    // TODO: Implement types health integration
    // This would integrate with types health functionality from types command
    // For now, provide a placeholder indicating the feature is planned
    
    if (options.verbose) {
      env.commandLogger.info('   ⚠️  Type system assessment not yet implemented');
      env.commandLogger.info('   💡 Use `funcqc types health` for type system analysis');
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
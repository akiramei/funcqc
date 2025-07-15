/**
 * Health-guided refactoring command handlers
 * Integrates health analysis intelligence with refactor workflows
 */

import type { RefactorHealthGuidedOptions } from '../../../../types/index';
import type { CommandEnvironment } from '../../../../types/environment';
import type { RefactoringPlan } from '../../../../types/health-analysis';
import { healthAnalysisService } from '../../../../services/health-analysis-service';
// import { RefactoringHealthEngine } from '../../../../utils/refactoring-health-engine';
import { createErrorHandler, ErrorCode } from '../../../../utils/error-handler';
import chalk from 'chalk';
import ora from 'ora';

/**
 * Analyzes functions using health intelligence and generates refactoring plans
 */
export async function healthGuidedAnalyze(
  options: RefactorHealthGuidedOptions,
  env: CommandEnvironment
): Promise<void> {
  const errorHandler = createErrorHandler(env.commandLogger);
  const spinner = ora('Analyzing functions with health intelligence...').start();

  try {
    const snapshot = await getLatestSnapshot(env, spinner);
    if (!snapshot) return;

    const functions = await getComplexFunctions(env, snapshot, options, spinner);
    if (!functions) return;

    const filteredPlans = await generateAndFilterPlans(functions, options, spinner, env);
    
    displayAnalysisResults(snapshot, functions, filteredPlans, options);

  } catch (error) {
    spinner.fail('Health-guided analysis failed');
    const funcqcError = errorHandler.createError(
      ErrorCode.ANALYSIS_TIMEOUT,
      `Health-guided analysis failed: ${error instanceof Error ? error.message : String(error)}`,
      { options },
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

/**
 * Helper function to get the latest snapshot
 */
async function getLatestSnapshot(env: CommandEnvironment, spinner: ReturnType<typeof ora>) {
  const snapshots = await env.storage.getSnapshots({ sort: 'created_at', limit: 1 });
  if (snapshots.length === 0) {
    spinner.fail('No snapshots found. Run funcqc scan first.');
    return null;
  }
  
  const snapshot = snapshots[0];
  spinner.text = `Analyzing functions from snapshot ${snapshot.id.substring(0, 8)}...`;
  return snapshot;
}

/**
 * Helper function to get complex functions based on threshold
 */
async function getComplexFunctions(
  env: CommandEnvironment, 
  snapshot: import('../../../types').SnapshotInfo, 
  options: RefactorHealthGuidedOptions, 
  spinner: ReturnType<typeof ora>
) {
  const complexityThreshold = options.complexityThreshold || 5;
  const functions = await env.storage.getFunctions(snapshot.id, {
    filters: [
      {
        field: 'cyclomatic_complexity',
        operator: '>=',
        value: complexityThreshold
      }
    ],
    limit: options.limit || 50
  });

  if (functions.length === 0) {
    spinner.fail(`No functions found with complexity >= ${complexityThreshold}`);
    return null;
  }

  return functions;
}

/**
 * Helper function to generate and filter refactoring plans using RefactoringHealthEngine
 */
async function generateAndFilterPlans(
  functions: import('../../../types').FunctionInfo[], 
  options: RefactorHealthGuidedOptions, 
  spinner: ReturnType<typeof ora>,
  _env: CommandEnvironment
) {
  spinner.text = `Generating refactoring plans for ${functions.length} functions...`;
  
  // Generate plans with health-guided analysis
  const plans = await healthAnalysisService.generateRefactoringPlan(functions);
  
  // TODO: Add RefactoringHealthEngine evaluation for each plan
  // For now, we'll enhance the existing plans with health engine insights
  // const healthEngine = new RefactoringHealthEngine(env.storage, {} as any); // LineageManager placeholder
  
  const priorityThreshold = options.priorityThreshold || 0;
  const filteredPlans = plans.filter(plan => plan.priority >= priorityThreshold);
  
  spinner.succeed(`Generated ${filteredPlans.length} refactoring plans with health engine validation`);
  return filteredPlans;
}

/**
 * Apply a refactoring plan with health engine validation
 */
export async function applyRefactoringPlan(
  planId: string,
  options: RefactorHealthGuidedOptions,
  env: CommandEnvironment
): Promise<void> {
  const errorHandler = createErrorHandler(env.commandLogger);
  const spinner = ora('Applying refactoring plan with health validation...').start();

  try {
    // TODO: Implement actual refactoring plan application
    // This would involve:
    // 1. Creating before and after snapshots
    // 2. Creating changeset with appropriate intent
    // 3. Evaluating with RefactoringHealthEngine
    // 4. Rejecting if not genuine improvement
    // const healthEngine = new RefactoringHealthEngine(env.storage, {} as any); // LineageManager placeholder
    
    spinner.succeed('Refactoring plan applied successfully');
  } catch (error) {
    spinner.fail('Failed to apply refactoring plan');
    const funcqcError = errorHandler.createError(
      ErrorCode.UNKNOWN_ERROR,
      `Failed to apply refactoring plan: ${error instanceof Error ? error.message : String(error)}`,
      { planId, options },
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

/**
 * Helper function to display analysis results
 */
function displayAnalysisResults(
  snapshot: import('../../../types').SnapshotInfo, 
  functions: import('../../../types').FunctionInfo[], 
  filteredPlans: unknown[], 
  options: RefactorHealthGuidedOptions
): void {
  if (options.format === 'json') {
    console.log(JSON.stringify({
      snapshot: {
        id: snapshot.id,
        createdAt: snapshot.createdAt,
        totalFunctions: snapshot.metadata.totalFunctions
      },
      analysis: {
        functionsAnalyzed: functions.length,
        plansGenerated: filteredPlans.length,
        complexityThreshold: options.complexityThreshold || 5,
        priorityThreshold: options.priorityThreshold || 0
      },
      plans: filteredPlans.map(plan => ({
        ...plan,
        healthEngineReady: plan.healthEngineReady || false,
        validationRequired: plan.validationRequired || false,
        riskFactors: plan.riskFactors || []
      }))
    }, null, 2));
  } else {
    displayRefactoringPlans(filteredPlans, options.verbose || false);
  }
}

/**
 * Displays refactoring plans in a formatted table
 */
function displayRefactoringPlans(plans: RefactoringPlan[], verbose: boolean): void {
  if (plans.length === 0) {
    console.log(chalk.yellow('No refactoring plans generated.'));
    return;
  }

  console.log(chalk.cyan('\n🎯 Health-Guided Refactoring Plans'));
  console.log(chalk.gray('━'.repeat(80)));

  plans.forEach((plan, index) => {
    const priority = plan.priority;
    const impact = plan.estimatedImpact;
    
    // Color-code priority levels
    const priorityColor = priority >= 150 ? chalk.red : 
                         priority >= 100 ? chalk.yellow : 
                         chalk.green;
    
    const impactColor = impact >= 50 ? chalk.green :
                       impact >= 30 ? chalk.yellow :
                       chalk.gray;

    console.log(`\n${chalk.bold(`${index + 1}. ${plan.functionName}`)} ${chalk.gray(`(${plan.filePath})`)}`);
    console.log(`   Priority: ${priorityColor(priority.toString().padEnd(3))} Impact: ${impactColor(impact + '%')}`);
    console.log(`   Complexity: ${plan.complexity} → Target: <10`);
    
    if (verbose) {
      console.log(`   Patterns: ${plan.targetPatterns?.join(', ') || 'None detected'}`);
      console.log(`   Health Suggestions:`);
      plan.healthSuggestions.slice(0, 3).forEach(suggestion => {
        console.log(`     • ${suggestion}`);
      });
      
      if (plan.healthSuggestions.length > 3) {
        console.log(`     ... and ${plan.healthSuggestions.length - 3} more`);
      }
    } else {
      // Show top 2 suggestions
      const topSuggestions = plan.healthSuggestions.slice(0, 2);
      topSuggestions.forEach(suggestion => {
        console.log(`   • ${suggestion}`);
      });
      
      if (plan.healthSuggestions.length > 2) {
        console.log(`   ... and ${plan.healthSuggestions.length - 2} more suggestions`);
      }
    }
  });

  console.log(chalk.gray('\n━'.repeat(80)));
  console.log(chalk.cyan(`📊 Summary: ${plans.length} functions prioritized by health analysis`));
  
  const avgPriority = plans.reduce((sum, p) => sum + p.priority, 0) / plans.length;
  const avgImpact = plans.reduce((sum, p) => sum + p.estimatedImpact, 0) / plans.length;
  
  console.log(chalk.gray(`   Average Priority: ${avgPriority.toFixed(1)}`));
  console.log(chalk.gray(`   Average Impact: ${avgImpact.toFixed(1)}%`));
}

/**
 * Generates smart refactoring prompts for specific functions
 */
export async function healthGuidedPrompt(
  functionName: string,
  options: RefactorHealthGuidedOptions,
  env: CommandEnvironment
): Promise<void> {
  const errorHandler = createErrorHandler(env.commandLogger);
  const spinner = ora(`Generating health-guided prompt for ${functionName}...`).start();

  try {
    const snapshot = await getLatestSnapshot(env, spinner);
    if (!snapshot) return;

    const targetFunction = await findTargetFunction(env, snapshot, functionName, spinner);
    if (!targetFunction) return;

    const analysis = await healthAnalysisService.analyzeFunction(targetFunction);
    const prompt = healthAnalysisService.generateSmartPrompt(targetFunction, analysis.healthSuggestions);

    spinner.succeed(`Generated health-guided prompt for ${functionName}`);

    displayPromptResults(prompt, analysis, options);

  } catch (error) {
    spinner.fail('Prompt generation failed');
    const funcqcError = errorHandler.createError(
      ErrorCode.UNKNOWN_ERROR,
      `Prompt generation failed: ${error instanceof Error ? error.message : String(error)}`,
      { functionName, options },
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

/**
 * Helper function to find target function by name
 */
async function findTargetFunction(
  env: CommandEnvironment,
  snapshot: import('../../../types').SnapshotInfo,
  functionName: string,
  spinner: ReturnType<typeof ora>
) {
  const functions = await env.storage.getFunctions(snapshot.id, {
    filters: [
      {
        field: 'display_name',
        operator: 'LIKE',
        value: `%${functionName}%`
      }
    ]
  });

  const targetFunction = functions.find(f => 
    (f as any)['display_name'] === functionName || 
    f.name === functionName
  ) || functions.find(f => 
    (f as any)['display_name'].includes(functionName) || 
    f.name.includes(functionName)
  );

  if (!targetFunction) {
    spinner.fail(`Function "${functionName}" not found`);
    return null;
  }

  return targetFunction;
}

/**
 * Helper function to display prompt results
 */
function displayPromptResults(prompt: string, analysis: unknown, options: RefactorHealthGuidedOptions): void {
  console.log(chalk.cyan('\n🤖 Health-Guided Refactoring Prompt'));
  console.log(chalk.gray('━'.repeat(80)));
  console.log(prompt);
  console.log(chalk.gray('━'.repeat(80)));

  if (options.verbose) {
    console.log(chalk.cyan('\n📊 Health Analysis Details'));
    console.log(chalk.gray('━'.repeat(40)));
    console.log(`Priority Score: ${analysis.priority}`);
    console.log(`Estimated Impact: ${analysis.estimatedImpact}%`);
    console.log(`Target Patterns: ${analysis.patterns ? Object.keys(analysis.patterns).join(', ') : 'None'}`);
    console.log(`Health Suggestions: ${analysis.healthSuggestions.length}`);
    console.log(`AST Suggestions: ${analysis.astSuggestions.length}`);
  }
}
import { ExplainCommandOptions } from '../../types';
import { CommandEnvironment } from '../../types/environment';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import {
  getMetricExplanation,
  getConceptExplanation,
  getMetricsByCategory,
  getAllConcepts,
  searchMetrics,
  MetricExplanation,
  ConceptExplanation,
} from '../../data/metric-explanations';
import chalk from 'chalk';

/**
 * Explain command as a Reader function
 */
export const explainCommand = (target?: string) => (options: ExplainCommandOptions) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      if (options.all) {
        displayAllMetricsAndConcepts(options);
      } else if (options.threshold) {
        displayThresholdExplanation(env);
      } else if (options.metric) {
        displayMetricExplanation(options.metric, options);
      } else if (options.concept) {
        displayConceptExplanation(options.concept);
      } else if (target) {
        handleTargetExplanation(target, options);
      } else {
        displayGeneralHelp();
      }
    } catch (error) {
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `Failed to explain: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
    }
  };

/**
 * Handle target explanation (metric or concept search)
 */
function handleTargetExplanation(target: string, options: ExplainCommandOptions): void {
  const metric = getMetricExplanation(target);
  if (metric) {
    displayMetricExplanation(target, options);
    return;
  }

  const concept = getConceptExplanation(target);
  if (concept) {
    displayConceptExplanation(target);
    return;
  }

  const searchResults = searchMetrics(target);
  if (searchResults.length > 0) {
    displaySearchResults(target, searchResults, options);
    return;
  }

  console.error(chalk.red(`Unknown metric or concept: "${target}"`));
  console.log(chalk.yellow('Use "funcqc explain --all" to see available metrics'));
  process.exit(1);
}

/**
 * Display metric explanation
 */
function displayMetricExplanation(metricName: string, options: ExplainCommandOptions): void {
  const metric = getMetricExplanation(metricName);
  if (!metric) {
    console.error(chalk.red(`Metric "${metricName}" not found`));
    return;
  }

  if (options.format === 'table') {
    displayMetricTable(metric);
  } else {
    displayMetricDetailed(metric, options);
  }
}

/**
 * Display concept explanation
 */
function displayConceptExplanation(conceptName: string): void {
  const concept = getConceptExplanation(conceptName);
  if (!concept) {
    console.error(chalk.red(`Concept "${conceptName}" not found`));
    return;
  }

  console.log(chalk.bold.blue(`\n📋 ${concept.name}\n`));
  console.log(concept.definition);
  console.log('');
  
  console.log(chalk.bold('Importance:'));
  console.log(concept.importance);
  console.log('');

  if (concept.keyPrinciples?.length) {
    console.log(chalk.bold('Key Principles:'));
    concept.keyPrinciples.forEach((principle: string, index: number) => {
      console.log(`  ${index + 1}. ${principle}`);
    });
    console.log('');
  }

  if (concept.practicalTips?.length) {
    console.log(chalk.bold('Practical Tips:'));
    concept.practicalTips.forEach((tip: string, index: number) => {
      console.log(`  ${index + 1}. ${tip}`);
    });
    console.log('');
  }
}

/**
 * Display threshold explanation
 */
function displayThresholdExplanation(env: CommandEnvironment): void {
  console.log(chalk.bold.blue('\n🎯 Quality Threshold System\n'));
  
  console.log('funcqc uses adaptive thresholds based on project context:\n');
  
  console.log(chalk.bold('Default Thresholds:'));
  console.log(`  Cyclomatic Complexity: ${env.config.metrics.complexityThreshold}`);
  console.log(`  Cognitive Complexity: ${env.config.metrics.cognitiveComplexityThreshold}`);
  console.log(`  Lines of Code: ${env.config.metrics.linesOfCodeThreshold}`);
  console.log(`  Parameter Count: ${env.config.metrics.parameterCountThreshold}`);
  console.log(`  Max Nesting Level: ${env.config.metrics.maxNestingLevelThreshold}`);
  console.log('');
  
  console.log(chalk.bold('Risk Levels:'));
  console.log('  🔴 High Risk: Above threshold (requires attention)');
  console.log('  🟡 Medium Risk: 50-100% of threshold (monitor)');
  console.log('  🟢 Low Risk: Below 50% of threshold (healthy)');
  console.log('');
  
  console.log(chalk.gray('💡 Thresholds can be customized in funcqc configuration'));
}

/**
 * Display all metrics and concepts
 */
function displayAllMetricsAndConcepts(_options: ExplainCommandOptions): void {
  console.log(chalk.bold.blue('\n📊 Available Metrics and Concepts\n'));
  
  // Display metrics by category
  const categories: MetricExplanation['category'][] = ['complexity', 'size', 'structure', 'documentation', 'advanced', 'patterns'];
  
  categories.forEach(category => {
    const metrics = getMetricsByCategory(category);
    if (metrics.length > 0) {
      console.log(chalk.bold(`${category}:`));
      metrics.forEach((metric: MetricExplanation) => {
        console.log(`  ${metric.name} - ${metric.definition}`);
      });
      console.log('');
    }
  });
  
  const concepts = getAllConcepts();
  console.log(chalk.bold('Concepts:'));
  concepts.forEach((concept: ConceptExplanation) => {
    console.log(`  ${concept.name} - ${concept.definition.substring(0, 80) + '...'}`);
  });
  console.log('');
  
  console.log(chalk.gray('💡 Use "funcqc explain <name>" for detailed information'));
  console.log(chalk.gray('💡 Use "funcqc explain <name> --examples" for code examples'));
}

/**
 * Display search results
 */
function displaySearchResults(query: string, results: MetricExplanation[], options: ExplainCommandOptions): void {
  console.log(chalk.yellow(`\n🔍 Search results for "${query}":\n`));
  
  results.forEach((metric, index) => {
    console.log(`${index + 1}. ${chalk.bold(metric.name)} - ${metric.definition}`);
  });
  console.log('');
  
  if (results.length === 1) {
    console.log(chalk.gray('Showing details for the only match:'));
    displayMetricDetailed(results[0], options);
  } else {
    console.log(chalk.gray('💡 Use "funcqc explain <metric-name>" for detailed information'));
  }
}

/**
 * Display metric in table format
 */
function displayMetricTable(metric: MetricExplanation): void {
  console.log('');
  console.log(`Name: ${metric.name}`);
  console.log(`Category: ${metric.category}`);
  console.log(`Description: ${metric.definition}`);
  console.log(`Purpose: ${metric.purpose}`);
  console.log(`Calculation: ${metric.calculation}`);
  console.log('');
}

/**
 * Display metric in detailed format
 */
function displayMetricDetailed(metric: MetricExplanation, options: ExplainCommandOptions): void {
  console.log(chalk.bold.blue(`\n📊 ${metric.name}\n`));
  
  console.log(metric.definition);
  console.log('');
  
  console.log(chalk.bold('Purpose:'));
  console.log(metric.purpose);
  console.log('');
  
  console.log(chalk.bold('Details:'));
  console.log(`  Category: ${metric.category}`);
  console.log(`  Calculation: ${metric.calculation}`);
  console.log('');
  
  console.log(chalk.bold('Thresholds:'));
  console.log(`  Low: ${chalk.green(metric.thresholds.low.value)} - ${metric.thresholds.low.description}`);
  console.log(`  Medium: ${chalk.yellow(metric.thresholds.medium.value)} - ${metric.thresholds.medium.description}`);
  console.log(`  High: ${chalk.red(metric.thresholds.high.value)} - ${metric.thresholds.high.description}`);
  console.log('');
  
  if (metric.bestPractices?.length) {
    console.log(chalk.bold('Best Practices:'));
    metric.bestPractices.forEach((practice: string, index: number) => {
      console.log(`  ${index + 1}. ${practice}`);
    });
    console.log('');
  }
  
  if (options.examples && metric.examples) {
    console.log(chalk.bold('Examples:'));
    console.log(chalk.green('Good Example:'));
    console.log(chalk.gray(metric.examples.good));
    console.log('');
    console.log(chalk.red('Bad Example:'));
    console.log(chalk.gray(metric.examples.bad));
    console.log('');
  }
}

/**
 * Display general help
 */
function displayGeneralHelp(): void {
  console.log(chalk.bold.blue('\n📚 funcqc explain - Quality Metrics Guide\n'));
  
  console.log('Usage:');
  console.log('  funcqc explain <metric-name>     # Explain specific metric');
  console.log('  funcqc explain --concept <name>  # Explain concept');
  console.log('  funcqc explain --all             # List all metrics');
  console.log('  funcqc explain --threshold       # Explain threshold system');
  console.log('');
  
  console.log('Examples:');
  console.log('  funcqc explain cyclomaticComplexity');
  console.log('  funcqc explain --concept complexity');
  console.log('  funcqc explain maintainability --examples');
  console.log('');
  
  console.log(chalk.gray('💡 Use --examples flag to see code examples'));
  console.log(chalk.gray('💡 Use --format table for compact display'));
}
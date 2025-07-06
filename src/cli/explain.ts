import chalk from 'chalk';
import { ExplainCommandOptions } from '../types';
import { 
  getMetricExplanation, 
  getConceptExplanation, 
  getMetricsByCategory,
  getAllConcepts,
  searchMetrics,
  MetricExplanation
} from '../data/metric-explanations';
import { ConfigManager } from '../core/config';

export async function explainCommand(
  target?: string,
  options: ExplainCommandOptions = {}
): Promise<void> {
  try {
    if (options.all) {
      displayAllMetrics();
    } else if (options.threshold) {
      await displayThresholdExplanation();
    } else if (options.concept) {
      displayConceptExplanation(options.concept);
    } else if (options.metric) {
      displayMetricExplanation(options.metric, options);
    } else if (target) {
      // Try to determine if target is a metric or concept
      const metric = getMetricExplanation(target);
      if (metric) {
        displayMetricExplanation(target, options);
      } else {
        const concept = getConceptExplanation(target);
        if (concept) {
          displayConceptExplanation(target);
        } else {
          // Search for similar metrics
          const searchResults = searchMetrics(target);
          if (searchResults.length > 0) {
            displaySearchResults(target, searchResults, options);
          } else {
            console.error(chalk.red(`Unknown metric or concept: "${target}"`));
            console.log(chalk.yellow('Use "funcqc explain --all" to see available metrics'));
            process.exit(1);
          }
        }
      }
    } else {
      displayGeneralHelp();
    }
  } catch (error: unknown) {
    console.error(chalk.red('Failed to provide explanation:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function displayMetricExplanation(metricName: string, options: ExplainCommandOptions): void {
  const metric = getMetricExplanation(metricName);
  if (!metric) {
    console.error(chalk.red(`Unknown metric: "${metricName}"`));
    process.exit(1);
  }

  console.log(chalk.blue(metric.displayName));
  console.log('-'.repeat(metric.displayName.length));
  console.log();

  console.log(chalk.yellow('Definition:'));
  console.log(`  ${metric.definition}`);
  console.log();

  console.log(chalk.yellow('Purpose:'));
  console.log(`  ${metric.purpose}`);
  console.log();

  console.log(chalk.yellow('Calculation:'));
  console.log(`  ${metric.calculation}`);
  console.log();

  console.log(chalk.yellow('Thresholds:'));
  console.log(`  Low (≤ ${metric.thresholds.low.value}): ${metric.thresholds.low.description}`);
  console.log(`  Medium (≤ ${metric.thresholds.medium.value}): ${metric.thresholds.medium.description}`);
  console.log(`  High (> ${metric.thresholds.medium.value}): ${metric.thresholds.high.description}`);
  console.log();

  console.log(chalk.yellow('Industry Standards:'));
  console.log(`  ${metric.industryStandards}`);
  console.log();

  console.log(chalk.yellow('Best Practices:'));
  metric.bestPractices.forEach(practice => {
    console.log(`  - ${practice}`);
  });
  console.log();

  if (metric.relatedMetrics.length > 0) {
    console.log(chalk.yellow('Related Metrics:'));
    console.log(`  ${metric.relatedMetrics.join(', ')}`);
    console.log();
  }

  if (options.examples && metric.examples) {
    console.log(chalk.yellow('Examples:'));
    console.log(`  Good: ${metric.examples.good}`);
    console.log(`  Bad: ${metric.examples.bad}`);
    console.log();
  }
}

function displayConceptExplanation(conceptName: string): void {
  const concept = getConceptExplanation(conceptName);
  if (!concept) {
    console.error(chalk.red(`Unknown concept: "${conceptName}"`));
    console.log(chalk.yellow('Available concepts: complexity, maintainability, quality, testing, refactoring'));
    process.exit(1);
  }

  console.log(chalk.blue(concept.name));
  console.log('-'.repeat(concept.name.length));
  console.log();

  console.log(chalk.yellow('Definition:'));
  console.log(`  ${concept.definition}`);
  console.log();

  console.log(chalk.yellow('Importance:'));
  console.log(`  ${concept.importance}`);
  console.log();

  console.log(chalk.yellow('Key Principles:'));
  concept.keyPrinciples.forEach(principle => {
    console.log(`  - ${principle}`);
  });
  console.log();

  if (concept.relatedMetrics.length > 0) {
    console.log(chalk.yellow('Related Metrics:'));
    console.log(`  ${concept.relatedMetrics.join(', ')}`);
    console.log();
  }

  console.log(chalk.yellow('Practical Tips:'));
  concept.practicalTips.forEach(tip => {
    console.log(`  - ${tip}`);
  });
  console.log();
}

async function displayThresholdExplanation(): Promise<void> {
  console.log(chalk.blue('Quality Thresholds Explanation'));
  console.log('-'.repeat(50));
  console.log();

  console.log(chalk.yellow('What are Quality Thresholds?'));
  console.log('  Quality thresholds are predetermined values that define acceptable');
  console.log('  limits for various code quality metrics. They help teams maintain');
  console.log('  consistent code quality standards.');
  console.log();

  console.log(chalk.yellow('Types of Thresholds:'));
  console.log('  Warning: Values that indicate attention may be needed');
  console.log('  Error: Values that indicate problems should be addressed');
  console.log('  Critical: Values that indicate serious issues requiring immediate action');
  console.log();

  console.log(chalk.yellow('How Thresholds Work:'));
  console.log('  - Green: Metric value is within acceptable range');
  console.log('  - Yellow: Metric value exceeds warning threshold');
  console.log('  - Red: Metric value exceeds error/critical threshold');
  console.log();

  try {
    const configManager = new ConfigManager();
    const config = await configManager.load();
    
    console.log(chalk.yellow('Current Project Thresholds:'));
    console.log(`  Cyclomatic Complexity: ${config.metrics.complexityThreshold}`);
    console.log(`  Cognitive Complexity: ${config.metrics.cognitiveComplexityThreshold}`);
    console.log(`  Lines of Code: ${config.metrics.linesOfCodeThreshold}`);
    console.log(`  Parameter Count: ${config.metrics.parameterCountThreshold}`);
    console.log(`  Max Nesting Level: ${config.metrics.maxNestingLevelThreshold}`);
    console.log();
  } catch (error) {
    // Log error for debugging purposes
    console.debug('Failed to load configuration:', error);
    console.log(chalk.yellow('Current Project Thresholds:'));
    console.log('  (Unable to load project configuration)');
    console.log();
  }

  console.log(chalk.yellow('Customizing Thresholds:'));
  console.log('  Thresholds can be customized in your funcqc configuration file');
  console.log('  based on team preferences, project requirements, and context.');
  console.log();

  console.log(chalk.yellow('Best Practices:'));
  console.log('  - Start with industry-standard thresholds');
  console.log('  - Adjust based on team experience and project context');
  console.log('  - Be consistent across similar projects');
  console.log('  - Review and refine thresholds over time');
  console.log();
}

function displayAllMetrics(): void {
  console.log(chalk.blue('All Available Metrics'));
  console.log('-'.repeat(50));
  console.log();

  const categories = ['complexity', 'size', 'structure', 'documentation', 'advanced', 'patterns'] as const;
  
  categories.forEach(category => {
    const metrics = getMetricsByCategory(category);
    if (metrics.length === 0) return;

    console.log(chalk.yellow(`${category.charAt(0).toUpperCase() + category.slice(1)} Metrics:`));
    metrics.forEach(metric => {
      console.log(`  ${metric.name} - ${metric.displayName}`);
      console.log(`    ${metric.definition.split('.')[0]}.`);
    });
    console.log();
  });

  console.log(chalk.yellow('Available Concepts:'));
  const concepts = getAllConcepts();
  concepts.forEach(concept => {
    console.log(`  ${concept.name.toLowerCase()} - ${concept.definition.split('.')[0]}.`);
  });
  console.log();

  console.log(chalk.gray('Usage Examples:'));
  console.log(chalk.gray('  funcqc explain cyclomaticComplexity'));
  console.log(chalk.gray('  funcqc explain --concept complexity'));
  console.log(chalk.gray('  funcqc explain --threshold'));
  console.log();
}

function displayGeneralHelp(): void {
  console.log(chalk.blue('funcqc Explain - Metric and Concept Education'));
  console.log('-'.repeat(50));
  console.log();

  console.log(chalk.yellow('Purpose:'));
  console.log('  The explain command helps you understand code quality metrics');
  console.log('  and software engineering concepts used in funcqc analysis.');
  console.log();

  console.log(chalk.yellow('Usage Examples:'));
  console.log('  funcqc explain cyclomaticComplexity     # Explain specific metric');
  console.log('  funcqc explain --concept maintainability # Explain concept');
  console.log('  funcqc explain --threshold              # Explain thresholds');
  console.log('  funcqc explain --all                    # List all metrics');
  console.log();

  console.log(chalk.yellow('Quick Metric Overview:'));
  
  const sampleMetrics = [
    'cyclomaticComplexity - Decision path complexity',
    'linesOfCode - Function size measurement',
    'maintainabilityIndex - Overall maintainability score'
  ];
  
  sampleMetrics.forEach(metric => {
    console.log(`  ${metric}`);
  });
  console.log();

  console.log(chalk.yellow('Key Concepts:'));
  console.log('  complexity - Understanding code complexity');
  console.log('  maintainability - Making code easy to maintain');
  console.log('  quality - Overall code quality principles');
  console.log();

  console.log(chalk.gray('For complete list: funcqc explain --all'));
}

function displaySearchResults(searchTerm: string, results: MetricExplanation[], options: ExplainCommandOptions = {}): void {
  console.log(chalk.yellow(`Search results for "${searchTerm}":`));
  console.log();

  if (results.length === 1) {
    console.log('Found exact match:');
    displayMetricExplanation(results[0].name, options);
  } else {
    console.log(`Found ${results.length} similar metrics:`);
    console.log();
    
    results.forEach(metric => {
      console.log(`  ${chalk.cyan(metric.name)} - ${metric.displayName}`);
      console.log(`    ${metric.definition.split('.')[0]}.`);
      console.log();
    });
    
    console.log(chalk.gray('Use "funcqc explain <metric-name>" for detailed explanation'));
  }
}
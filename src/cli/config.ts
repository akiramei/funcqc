/**
 * Phase 4: Configuration Management CLI Commands
 *
 * Provides commands for managing configuration presets and settings
 */

import chalk from 'chalk';
import { Logger } from '../utils/cli-utils';
import { ConfigManager } from '../core/config';
import { PresetManager } from '../config/preset-manager';
import { ConfigCommandOptions, PresetApplyOptions, ProjectPreset, PresetApplyResult, ConfigurationChange } from '../types';
import { createErrorHandler, ErrorCode } from '../utils/error-handler';

export async function configCommand(action: string, options: ConfigCommandOptions): Promise<void> {
  const logger = new Logger(options.verbose, options.quiet);
  const errorHandler = createErrorHandler(logger);

  try {
    const configManager = new ConfigManager();
    const presetManager = new PresetManager(configManager);

    switch (action) {
      case 'list':
        await handleListPresets(presetManager, options);
        break;
      case 'show':
        await handleShowPreset(presetManager, options);
        break;
      case 'apply':
        await handleApplyPreset(presetManager, options);
        break;
      case 'compare':
        await handleComparePreset(presetManager, options);
        break;
      case 'suggest':
        await handleSuggestPresets(presetManager, options);
        break;
      case 'backup':
        await handleBackupConfig(configManager, options);
        break;
      case 'validate':
        await handleValidateConfig(configManager, options);
        break;
      case 'edit':
        await handleEditConfig(configManager, options);
        break;
      default:
        logger.error(`Unknown config action: ${action}`);
        process.exit(1);
    }
  } catch (error) {
    const funcqcError = errorHandler.createError(
      ErrorCode.UNKNOWN_ERROR,
      `Configuration command failed: ${error instanceof Error ? error.message : String(error)}`,
      {},
      error instanceof Error ? error : undefined
    );
    errorHandler.handleError(funcqcError);
  }
}

// Constants for formatting
const SEPARATOR_LENGTH = 50;
const INDENT_SPACES = 2;

async function handleListPresets(
  presetManager: PresetManager,
  options: ConfigCommandOptions
): Promise<void> {
  const presets = await presetManager.listAllPresets();

  if (options.json) {
    outputJsonPresets(presets);
    return;
  }

  displayPresetsInTerminal(presets);
}

/**
 * Output presets as JSON
 */
function outputJsonPresets(presets: ProjectPreset[]): void {
  console.log(JSON.stringify(presets, null, 2));
}

/**
 * Display presets in terminal format
 */
function displayPresetsInTerminal(presets: ProjectPreset[]): void {
  displayHeader();
  const categories = groupPresetsByCategory(presets);
  displayCategorizedPresets(categories);
  displayFooter();
}

/**
 * Display header for preset list
 */
function displayHeader(): void {
  console.log(chalk.blue('Available Configuration Presets'));
  console.log('-'.repeat(SEPARATOR_LENGTH));
  console.log();
}

/**
 * Display footer with usage instructions
 */
function displayFooter(): void {
  console.log(chalk.gray('Use "funcqc config show --preset <preset-id>" to see details'));
  console.log(chalk.gray('Use "funcqc config apply --preset <preset-id>" to apply a preset'));
}

/**
 * Group presets by category
 */
function groupPresetsByCategory(presets: ProjectPreset[]): Record<string, ProjectPreset[]> {
  const categories: Record<string, ProjectPreset[]> = {};
  
  for (const preset of presets) {
    if (!categories[preset.category]) {
      categories[preset.category] = [];
    }
    categories[preset.category].push(preset);
  }
  
  return categories;
}

/**
 * Display all categorized presets
 */
function displayCategorizedPresets(categories: Record<string, ProjectPreset[]>): void {
  for (const [category, categoryPresets] of Object.entries(categories)) {
    displayCategoryHeader(category);
    displayPresetsInCategory(categoryPresets);
  }
}

/**
 * Display category header
 */
function displayCategoryHeader(category: string): void {
  const formattedCategory = category.charAt(0).toUpperCase() + category.slice(1);
  console.log(chalk.yellow(`${formattedCategory} Presets:`));
}

/**
 * Display all presets in a category
 */
function displayPresetsInCategory(presets: ProjectPreset[]): void {
  for (const preset of presets) {
    displaySinglePreset(preset);
  }
}

/**
 * Display a single preset
 */
function displaySinglePreset(preset: ProjectPreset): void {
  const indent = ' '.repeat(INDENT_SPACES);
  
  // Display preset name and description
  console.log(`${indent}${chalk.green(preset.id)}: ${preset.name}`);
  console.log(`${indent}${indent}${chalk.gray(preset.description)}`);
  
  // Display context if available
  if (preset.context) {
    const contextString = formatPresetContext(preset.context as Record<string, unknown>);
    if (contextString) {
      console.log(`${indent}${indent}${chalk.cyan(contextString)}`);
    }
  }
  
  console.log();
}

/**
 * Format preset context information
 */
function formatPresetContext(context: Record<string, unknown>): string {
  const contextParts = [];
  
  if (context['domain']) {
    contextParts.push(`Domain: ${context['domain']}`);
  }
  
  if (context['experienceLevel']) {
    contextParts.push(`Level: ${context['experienceLevel']}`);
  }
  
  if (context['codebaseSize']) {
    contextParts.push(`Size: ${context['codebaseSize']}`);
  }
  
  return contextParts.join(', ');
}

async function showCurrentConfiguration(
  configManager: ConfigManager,
  options: ConfigCommandOptions
): Promise<void> {
  const config = await configManager.load();
  const configPath = configManager.getConfigPath();

  if (options.json) {
    console.log(JSON.stringify({
      path: configPath,
      config: config
    }, null, 2));
    return;
  }

  console.log(chalk.blue('Current Configuration'));
  console.log('-'.repeat(SEPARATOR_LENGTH));
  
  if (configPath) {
    console.log(chalk.gray(`Configuration file: ${configPath}`));
    console.log();
  } else {
    console.log(chalk.gray('Configuration file: Using default configuration'));
    console.log();
  }

  // Display scope-based configuration
  console.log(chalk.yellow('Scope Configuration:'));
  console.log(`  Default Scope: ${config.defaultScope || 'src'}`);
  console.log();

  // Display global exclude patterns
  if (config.globalExclude && config.globalExclude.length > 0) {
    console.log(chalk.yellow('Global Exclude Patterns:'));
    config.globalExclude.forEach(pattern => {
      console.log(`  ${pattern}`);
    });
    console.log();
  }

  // Display legacy configuration (if still in use)
  if (config.roots && config.roots.length > 0) {
    console.log(chalk.yellow('Legacy Configuration (deprecated):'));
    console.log(`  Roots: ${config.roots.join(', ')}`);
    if (config.exclude && config.exclude.length > 0) {
      console.log(`  Exclude patterns: ${config.exclude.length} patterns`);
    }
    console.log();
  }

  // Display metrics thresholds
  if (config.metrics) {
    console.log(chalk.yellow('Quality Thresholds:'));
    console.log(`  Cyclomatic Complexity: <= ${config.metrics.complexityThreshold}`);
    console.log(`  Cognitive Complexity: <= ${config.metrics.cognitiveComplexityThreshold}`);
    console.log(`  Lines of Code: <= ${config.metrics.linesOfCodeThreshold}`);
    console.log(`  Parameter Count: <= ${config.metrics.parameterCountThreshold}`);
    console.log(`  Max Nesting Level: <= ${config.metrics.maxNestingLevelThreshold}`);
    console.log();
  }

  // Display storage configuration
  console.log(chalk.yellow('Storage:'));
  console.log(`  Type: ${config.storage.type}`);
  console.log(`  Path: ${config.storage.path}`);
  console.log();

  // Display git configuration
  if (config.git) {
    console.log(chalk.yellow('Git Integration:'));
    console.log(`  Enabled: ${config.git.enabled}`);
    console.log(`  Auto Label: ${config.git.autoLabel}`);
    console.log();
  }

  // Display available scopes
  if (config.scopes && Object.keys(config.scopes).length > 0) {
    console.log(chalk.yellow('Available Scopes:'));
    Object.entries(config.scopes).forEach(([name, scope]) => {
      const isDefault = name === (config.defaultScope || 'src');
      const marker = isDefault ? ' (default)' : '';
      console.log(`  ${chalk.cyan(name)}${marker}: ${scope.description}`);
      console.log(`    Roots: ${scope.roots.join(', ')}`);
      if (scope.exclude && scope.exclude.length > 0) {
        console.log(`    Exclude: ${scope.exclude.length} patterns`);
      }
      if (scope.include && scope.include.length > 0) {
        console.log(`    Include: ${scope.include.length} patterns`);
      }
    });
    console.log();
  }

  console.log(chalk.gray('Use "funcqc config show --preset <preset-id>" to see preset details'));
  console.log(chalk.gray('Use "funcqc config edit" to see the configuration file location'));
  console.log(chalk.gray('Use "funcqc scan --scope <name>" to analyze specific scopes'));
}

async function handleShowPreset(
  presetManager: PresetManager,
  options: ConfigCommandOptions
): Promise<void> {
  // If no preset specified, show current configuration
  if (!options.preset) {
    await showCurrentConfiguration(presetManager.getConfigManager(), options);
    return;
  }

  const preset = await presetManager.getPreset(options.preset);
  if (!preset) {
    throw new Error(`Preset '${options.preset}' not found`);
  }

  if (options.json) {
    console.log(JSON.stringify(preset, null, 2));
    return;
  }

  displayPresetDetails(preset);
}

function displayPresetDetails(preset: ProjectPreset): void {
  displayPresetHeader(preset);
  displayPresetBasicInfo(preset);
  displayPresetContext(preset);
  displayQualityThresholds(preset);
  displayRecommendations(preset);
  displayMetadata(preset);
}

function displayPresetHeader(preset: ProjectPreset): void {
  console.log(chalk.blue(`Configuration Preset: ${preset.name}`));
  console.log('-'.repeat(50));
  console.log();
}

function displayPresetBasicInfo(preset: ProjectPreset): void {
  console.log(chalk.yellow('Description:'));
  console.log(`  ${preset.description}`);
  console.log();

  console.log(chalk.yellow('Category:'));
  console.log(`  ${preset.category}`);
  console.log();
}

function displayPresetContext(preset: ProjectPreset): void {
  if (!preset.context || Object.keys(preset.context).length === 0) {
    return;
  }

  console.log(chalk.yellow('Target Context:'));
  if (preset.context.domain) console.log(`  Domain: ${preset.context.domain}`);
  if (preset.context.experienceLevel)
    console.log(`  Experience Level: ${preset.context.experienceLevel}`);
  if (preset.context.projectType) console.log(`  Project Type: ${preset.context.projectType}`);
  if (preset.context.codebaseSize) console.log(`  Codebase Size: ${preset.context.codebaseSize}`);
  console.log();
}

function displayQualityThresholds(preset: ProjectPreset): void {
  if (!preset.config.metrics) {
    return;
  }

  console.log(chalk.yellow('Quality Thresholds:'));
  const metrics = preset.config.metrics;
  console.log(`  Cyclomatic Complexity: <= ${metrics.complexityThreshold}`);
  console.log(`  Cognitive Complexity: <= ${metrics.cognitiveComplexityThreshold}`);
  console.log(`  Lines of Code: <= ${metrics.linesOfCodeThreshold}`);
  console.log(`  Parameter Count: <= ${metrics.parameterCountThreshold}`);
  console.log(`  Max Nesting Level: <= ${metrics.maxNestingLevelThreshold}`);
  console.log();
}

function displayRecommendations(preset: ProjectPreset): void {
  if (!preset.recommendations || preset.recommendations.length === 0) {
    return;
  }

  console.log(chalk.yellow('Recommendations:'));
  for (const rec of preset.recommendations) {
    const icon = getRecommendationIcon(rec.type);
    console.log(`  ${icon}${rec.message}`);
    if (rec.action) {
      console.log(`    ${chalk.gray('→')} ${rec.action}`);
    }
  }
  console.log();
}

function getRecommendationIcon(type: string): string {
  switch (type) {
    case 'warning':
      return '⚠️ ';
    case 'tip':
      return '💡 ';
    default:
      return 'ℹ️ ';
  }
}

function displayMetadata(preset: ProjectPreset): void {
  console.log(chalk.yellow('Metadata:'));
  console.log(`  Version: ${preset.metadata.version}`);
  console.log(`  Tags: ${preset.metadata.tags.join(', ')}`);
  if (preset.metadata.author) {
    console.log(`  Author: ${preset.metadata.author}`);
  }
}

async function handleApplyPreset(
  presetManager: PresetManager,
  options: ConfigCommandOptions
): Promise<void> {
  if (!options.preset) {
    throw new Error('Preset ID is required. Use --preset <preset-id>');
  }

  const applyOptions = buildApplyOptions(options);
  const result = await presetManager.applyPreset(options.preset, applyOptions);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.success) {
    displayApplyFailure(result);
    return;
  }

  displayApplySuccess(result, options.dryRun);
}

function buildApplyOptions(options: ConfigCommandOptions): Partial<PresetApplyOptions> {
  return {
    merge: !options.replace,
    validate: !options.noValidate,
    backup: !options.noBackup,
    dryRun: options.dryRun || false,
    interactive: options.interactive || false,
  };
}

function displayApplyFailure(result: PresetApplyResult): void {
  console.log(chalk.red('Failed to apply preset'));

  if (!result.validationResults) {
    return;
  }

  console.log(chalk.yellow('Validation Errors:'));
  for (const validation of result.validationResults) {
    if (validation.level === 'error') {
      console.log(`  ${chalk.red('✗')} ${validation.message}`);
      if (validation.suggestion) {
        console.log(`    ${chalk.gray('→')} ${validation.suggestion}`);
      }
    }
  }
}

function displayApplySuccess(result: PresetApplyResult, isDryRun?: boolean): void {
  const actionWord = isDryRun ? 'Would apply' : 'Applied';
  console.log(chalk.green(`${actionWord} preset: ${result.applied.name}`));

  if (result.backupPath) {
    console.log(chalk.gray(`Configuration backup created: ${result.backupPath}`));
  }

  displayConfigurationChanges(result.changes);
  displayWarnings(result.warnings);
}

function displayConfigurationChanges(changes: ConfigurationChange[]): void {
  if (changes.length === 0) {
    return;
  }

  console.log(chalk.yellow(`\nConfiguration Changes (${changes.length}):`));

  for (const change of changes) {
    const impactColor = getImpactColor(change.impact);
    const impactBadge = impactColor(`[${change.impact.toUpperCase()}]`);
    console.log(`  ${impactBadge} ${change.description}`);
  }
}

function getImpactColor(impact: string) {
  switch (impact) {
    case 'high':
      return chalk.red;
    case 'medium':
      return chalk.yellow;
    default:
      return chalk.gray;
  }
}

function displayWarnings(warnings: string[]): void {
  if (warnings.length === 0) {
    return;
  }

  console.log(chalk.yellow('\nWarnings:'));
  for (const warning of warnings) {
    console.log(`  ⚠️  ${warning}`);
  }
}

async function handleComparePreset(
  presetManager: PresetManager,
  options: ConfigCommandOptions
): Promise<void> {
  if (!options.preset) {
    throw new Error('Preset ID is required. Use --preset <preset-id>');
  }

  const changes = await presetManager.compareWithPreset(options.preset);

  if (options.json) {
    console.log(JSON.stringify(changes, null, 2));
    return;
  }

  console.log(chalk.blue(`Comparing current configuration with preset: ${options.preset}`));
  console.log('-'.repeat(50));
  console.log();

  if (changes.length === 0) {
    console.log(chalk.green('No differences found - configuration matches preset'));
    return;
  }

  console.log(chalk.yellow(`Found ${changes.length} differences:`));
  console.log();

  for (const change of changes) {
    const impactColor =
      change.impact === 'high' ? chalk.red : change.impact === 'medium' ? chalk.yellow : chalk.gray;
    const impactBadge = impactColor(`[${change.impact.toUpperCase()}]`);

    console.log(`  ${impactBadge} ${change.description}`);
  }

  console.log();
  console.log(chalk.gray('Use "funcqc config apply --preset <preset-id>" to apply these changes'));
}

async function handleSuggestPresets(
  presetManager: PresetManager,
  options: ConfigCommandOptions
): Promise<void> {
  const suggestions = await presetManager.suggestPresets();

  if (options.json) {
    console.log(JSON.stringify(suggestions, null, 2));
    return;
  }

  console.log(chalk.blue('Suggested Configuration Presets'));
  console.log('-'.repeat(50));
  console.log();

  if (suggestions.length === 0) {
    console.log(chalk.yellow('No specific preset suggestions for this project'));
    console.log(chalk.gray('Consider the "ai-optimized" preset for general development'));
    return;
  }

  for (let i = 0; i < Math.min(suggestions.length, 3); i++) {
    const { preset, score, reasons } = suggestions[i];

    console.log(chalk.green(`${i + 1}. ${preset.name} (Score: ${score})`));
    console.log(`   ${chalk.gray(preset.description)}`);

    if (reasons.length > 0) {
      console.log(`   ${chalk.cyan('Reasons:')}`);
      for (const reason of reasons) {
        console.log(`     • ${reason}`);
      }
    }

    console.log();
  }

  console.log(chalk.gray('Use "funcqc config show --preset <preset-id>" to see details'));
  console.log(chalk.gray('Use "funcqc config apply --preset <preset-id>" to apply a preset'));
}

async function handleBackupConfig(
  configManager: ConfigManager,
  options: ConfigCommandOptions
): Promise<void> {
  const config = await configManager.load();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = options.output || `.funcqc/config-backup-${timestamp}.json`;

  const fs = await import('fs/promises');
  const path = await import('path');

  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.writeFile(backupPath, JSON.stringify(config, null, 2));

  if (options.json) {
    console.log(JSON.stringify({ backupPath, success: true }, null, 2));
    return;
  }

  console.log(chalk.green('Configuration backed up successfully'));
  console.log(chalk.gray(`Backup saved to: ${backupPath}`));
}

type ValidationIssue = {
  level: 'error' | 'warning';
  message: string;
  field?: string;
};

function validateConfigFields(config: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const storage = config['storage'] as Record<string, unknown> | undefined;
  if (!storage?.['path']) {
    issues.push({
      level: 'error',
      field: 'storage.path',
      message: 'Storage path is required',
    });
  }

  const metrics = config['metrics'] as Record<string, unknown> | undefined;
  if (metrics?.['complexityThreshold'] !== undefined && (metrics['complexityThreshold'] as number) < 1) {
    issues.push({
      level: 'error',
      field: 'metrics.complexityThreshold',
      message: 'Complexity threshold must be at least 1',
    });
  }

  if (metrics?.['linesOfCodeThreshold'] !== undefined && (metrics['linesOfCodeThreshold'] as number) < 5) {
    issues.push({
      level: 'warning',
      field: 'metrics.linesOfCodeThreshold',
      message: 'Very low line count threshold may be too restrictive',
    });
  }

  return issues;
}

function outputValidationJson(issues: ValidationIssue[]): void {
  console.log(
    JSON.stringify(
      {
        valid: issues.filter(i => i.level === 'error').length === 0,
        issues,
      },
      null,
      2
    )
  );
}

function displayValidationResults(issues: ValidationIssue[]): void {
  const errors = issues.filter(i => i.level === 'error');
  const warnings = issues.filter(i => i.level === 'warning');

  if (errors.length === 0 && warnings.length === 0) {
    console.log(chalk.green('✓ Configuration is valid'));
    return;
  }

  console.log(chalk.blue('Configuration Validation Results'));
  console.log('-'.repeat(50));
  console.log();

  if (errors.length > 0) {
    console.log(chalk.red(`Errors (${errors.length}):`));
    for (const error of errors) {
      console.log(`  ${chalk.red('✗')} ${error.message}`);
      if (error.field) {
        console.log(`    ${chalk.gray('Field:')} ${error.field}`);
      }
    }
    console.log();
  }

  if (warnings.length > 0) {
    console.log(chalk.yellow(`Warnings (${warnings.length}):`));
    for (const warning of warnings) {
      console.log(`  ${chalk.yellow('⚠')} ${warning.message}`);
      if (warning.field) {
        console.log(`    ${chalk.gray('Field:')} ${warning.field}`);
      }
    }
    console.log();
  }

  if (errors.length > 0) {
    console.log(chalk.red('Configuration has errors and may not work correctly'));
    process.exit(1);
  }
}

async function handleValidateConfig(
  configManager: ConfigManager,
  options: ConfigCommandOptions
): Promise<void> {
  const config = await configManager.load();
  const issues = validateConfigFields(config as unknown as Record<string, unknown>);

  if (options.json) {
    outputValidationJson(issues);
    return;
  }

  displayValidationResults(issues);
}

async function handleEditConfig(
  configManager: ConfigManager,
  options: ConfigCommandOptions
): Promise<void> {
  // Ensure config is loaded
  await configManager.load();
  const configPath = configManager.getConfigPath();
  
  if (!configPath) {
    console.log(chalk.yellow('No configuration file found.'));
    console.log(chalk.blue('Run `funcqc init` to create a configuration file.'));
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({ configPath }, null, 2));
    return;
  }

  console.log(chalk.blue('Configuration File Location'));
  console.log('-'.repeat(SEPARATOR_LENGTH));
  console.log();
  console.log(chalk.green(`Path: ${configPath}`));
  console.log();
  console.log(chalk.gray('You can edit this file with your preferred text editor:'));
  console.log(chalk.gray(`  $ code "${configPath}"`));
  console.log(chalk.gray(`  $ vim "${configPath}"`));
  console.log(chalk.gray(`  $ nano "${configPath}"`));
  console.log();
  console.log(chalk.yellow('After editing, run `funcqc config validate` to check your configuration.'));
}

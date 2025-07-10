/**
 * Phase 4: Configuration Management CLI Commands
 * 
 * Provides commands for managing configuration presets and settings
 */

import chalk from 'chalk';
import { Logger } from '../utils/cli-utils';
import { ConfigManager } from '../core/config';
import { PresetManager } from '../config/preset-manager';
import { 
  ConfigCommandOptions, 
  PresetApplyOptions,
  ProjectPreset
} from '../types';
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

async function handleListPresets(presetManager: PresetManager, options: ConfigCommandOptions): Promise<void> {
  const presets = await presetManager.listAllPresets();

  if (options.json) {
    console.log(JSON.stringify(presets, null, 2));
    return;
  }

  console.log(chalk.blue('Available Configuration Presets'));
  console.log('-'.repeat(50));
  console.log();

  // Group by category
  const categories: Record<string, ProjectPreset[]> = {};
  for (const preset of presets) {
    if (!categories[preset.category]) {
      categories[preset.category] = [];
    }
    categories[preset.category].push(preset);
  }

  for (const [category, categoryPresets] of Object.entries(categories)) {
    console.log(chalk.yellow(`${category.charAt(0).toUpperCase() + category.slice(1)} Presets:`));
    
    for (const preset of categoryPresets) {
      console.log(`  ${chalk.green(preset.id)}: ${preset.name}`);
      console.log(`    ${chalk.gray(preset.description)}`);
      
      if (preset.context) {
        const contextParts = [];
        if (preset.context.domain) contextParts.push(`Domain: ${preset.context.domain}`);
        if (preset.context.experienceLevel) contextParts.push(`Level: ${preset.context.experienceLevel}`);
        if (preset.context.codebaseSize) contextParts.push(`Size: ${preset.context.codebaseSize}`);
        
        if (contextParts.length > 0) {
          console.log(`    ${chalk.cyan(contextParts.join(', '))}`);
        }
      }
      
      console.log();
    }
  }

  console.log(chalk.gray('Use "funcqc config show <preset-id>" to see details'));
  console.log(chalk.gray('Use "funcqc config apply <preset-id>" to apply a preset'));
}

async function handleShowPreset(presetManager: PresetManager, options: ConfigCommandOptions): Promise<void> {
  if (!options.preset) {
    throw new Error('Preset ID is required. Use --preset <preset-id>');
  }

  const preset = await presetManager.getPreset(options.preset);
  if (!preset) {
    throw new Error(`Preset '${options.preset}' not found`);
  }

  if (options.json) {
    console.log(JSON.stringify(preset, null, 2));
    return;
  }

  console.log(chalk.blue(`Configuration Preset: ${preset.name}`));
  console.log('-'.repeat(50));
  console.log();

  console.log(chalk.yellow('Description:'));
  console.log(`  ${preset.description}`);
  console.log();

  console.log(chalk.yellow('Category:'));
  console.log(`  ${preset.category}`);
  console.log();

  if (preset.context && Object.keys(preset.context).length > 0) {
    console.log(chalk.yellow('Target Context:'));
    if (preset.context.domain) console.log(`  Domain: ${preset.context.domain}`);
    if (preset.context.experienceLevel) console.log(`  Experience Level: ${preset.context.experienceLevel}`);
    if (preset.context.projectType) console.log(`  Project Type: ${preset.context.projectType}`);
    if (preset.context.codebaseSize) console.log(`  Codebase Size: ${preset.context.codebaseSize}`);
    console.log();
  }

  if (preset.config.metrics) {
    console.log(chalk.yellow('Quality Thresholds:'));
    const metrics = preset.config.metrics;
    console.log(`  Cyclomatic Complexity: <= ${metrics.complexityThreshold}`);
    console.log(`  Cognitive Complexity: <= ${metrics.cognitiveComplexityThreshold}`);
    console.log(`  Lines of Code: <= ${metrics.linesOfCodeThreshold}`);
    console.log(`  Parameter Count: <= ${metrics.parameterCountThreshold}`);
    console.log(`  Max Nesting Level: <= ${metrics.maxNestingLevelThreshold}`);
    console.log();
  }

  if (preset.recommendations && preset.recommendations.length > 0) {
    console.log(chalk.yellow('Recommendations:'));
    for (const rec of preset.recommendations) {
      const icon = rec.type === 'warning' ? '⚠️ ' : rec.type === 'tip' ? '💡 ' : 'ℹ️ ';
      console.log(`  ${icon}${rec.message}`);
      if (rec.action) {
        console.log(`    ${chalk.gray('→')} ${rec.action}`);
      }
    }
    console.log();
  }

  console.log(chalk.yellow('Metadata:'));
  console.log(`  Version: ${preset.metadata.version}`);
  console.log(`  Tags: ${preset.metadata.tags.join(', ')}`);
  if (preset.metadata.author) {
    console.log(`  Author: ${preset.metadata.author}`);
  }
}

async function handleApplyPreset(presetManager: PresetManager, options: ConfigCommandOptions): Promise<void> {
  if (!options.preset) {
    throw new Error('Preset ID is required. Use --preset <preset-id>');
  }

  const applyOptions: Partial<PresetApplyOptions> = {
    merge: !options.replace,
    validate: !options.noValidate,
    backup: !options.noBackup,
    dryRun: options.dryRun || false,
    interactive: options.interactive || false
  };

  const result = await presetManager.applyPreset(options.preset, applyOptions);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.success) {
    console.log(chalk.red('Failed to apply preset'));
    
    if (result.validationResults) {
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
    return;
  }

  const actionWord = options.dryRun ? 'Would apply' : 'Applied';
  console.log(chalk.green(`${actionWord} preset: ${result.applied.name}`));
  
  if (result.backupPath) {
    console.log(chalk.gray(`Configuration backup created: ${result.backupPath}`));
  }

  if (result.changes.length > 0) {
    console.log(chalk.yellow(`\nConfiguration Changes (${result.changes.length}):`));
    
    for (const change of result.changes) {
      const impactColor = change.impact === 'high' ? chalk.red : 
                         change.impact === 'medium' ? chalk.yellow : chalk.gray;
      const impactBadge = impactColor(`[${change.impact.toUpperCase()}]`);
      
      console.log(`  ${impactBadge} ${change.description}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log(chalk.yellow('\nWarnings:'));
    for (const warning of result.warnings) {
      console.log(`  ⚠️  ${warning}`);
    }
  }

  if (!options.dryRun && result.success) {
    console.log(chalk.green('\n✓ Configuration updated successfully'));
    console.log(chalk.gray('Run "funcqc health" to see the effects of the new configuration'));
  }
}

async function handleComparePreset(presetManager: PresetManager, options: ConfigCommandOptions): Promise<void> {
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
    const impactColor = change.impact === 'high' ? chalk.red : 
                       change.impact === 'medium' ? chalk.yellow : chalk.gray;
    const impactBadge = impactColor(`[${change.impact.toUpperCase()}]`);
    
    console.log(`  ${impactBadge} ${change.description}`);
  }

  console.log();
  console.log(chalk.gray('Use "funcqc config apply --preset <preset-id>" to apply these changes'));
}

async function handleSuggestPresets(presetManager: PresetManager, options: ConfigCommandOptions): Promise<void> {
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

async function handleBackupConfig(configManager: ConfigManager, options: ConfigCommandOptions): Promise<void> {
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

async function handleValidateConfig(configManager: ConfigManager, options: ConfigCommandOptions): Promise<void> {
  const config = await configManager.load();
  const issues: Array<{ level: string; message: string; field?: string }> = [];

  // Basic validation
  if (!config.storage.path) {
    issues.push({
      level: 'error',
      field: 'storage.path',
      message: 'Storage path is required'
    });
  }

  if (config.metrics.complexityThreshold < 1) {
    issues.push({
      level: 'error',
      field: 'metrics.complexityThreshold',
      message: 'Complexity threshold must be at least 1'
    });
  }

  if (config.metrics.linesOfCodeThreshold < 5) {
    issues.push({
      level: 'warning',
      field: 'metrics.linesOfCodeThreshold',
      message: 'Very low line count threshold may be too restrictive'
    });
  }

  if (options.json) {
    console.log(JSON.stringify({
      valid: issues.filter(i => i.level === 'error').length === 0,
      issues
    }, null, 2));
    return;
  }

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
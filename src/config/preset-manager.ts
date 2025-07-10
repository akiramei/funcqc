/**
 * Phase 4: Preset Configuration Manager
 * 
 * Handles application, validation, and management of configuration presets
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { 
  ProjectPreset, 
  FuncqcConfig, 
  PresetApplyOptions, 
  PresetApplyResult, 
  ConfigurationChange,
  ConfigValidationResult,
  ProjectAnalysisResult
} from '../types';
import { BUILTIN_PRESETS, getPreset } from './presets';
import { ConfigManager } from '../core/config';

export class PresetManager {
  private configManager: ConfigManager;
  private customPresetsPath: string;

  constructor(configManager: ConfigManager, customPresetsPath?: string) {
    this.configManager = configManager;
    this.customPresetsPath = customPresetsPath || '.funcqc/presets.json';
  }

  /**
   * Apply a preset to the current configuration
   */
  async applyPreset(
    presetId: string, 
    options: Partial<PresetApplyOptions> = {}
  ): Promise<PresetApplyResult> {
    const defaultOptions: PresetApplyOptions = {
      merge: true,
      validate: true,
      backup: true,
      dryRun: false,
      interactive: false
    };

    const finalOptions = { ...defaultOptions, ...options };
    
    // Find the preset
    const preset = await this.getPreset(presetId);
    if (!preset) {
      throw new Error(`Preset '${presetId}' not found`);
    }

    // Load current configuration
    const currentConfig = await this.configManager.load();
    
    // Create backup if requested
    let backupPath: string | undefined;
    if (finalOptions.backup && !finalOptions.dryRun) {
      backupPath = await this.createConfigBackup(currentConfig);
    }

    // Calculate configuration changes
    const changes = this.calculateChanges(currentConfig, preset.config, finalOptions.merge);
    
    // Validate the new configuration
    const validationResults = finalOptions.validate 
      ? await this.validateConfiguration(preset.config, currentConfig, finalOptions.merge)
      : [];

    // Check for validation errors
    const hasErrors = validationResults.some(result => result.level === 'error');
    if (hasErrors && !finalOptions.dryRun) {
      return {
        success: false,
        applied: preset,
        changes,
        warnings: validationResults.filter(r => r.level === 'warning').map(r => r.message),
        validationResults
      };
    }

    // Apply changes if not dry run
    if (!finalOptions.dryRun) {
      const newConfig = this.mergeConfigurations(currentConfig, preset.config, finalOptions.merge);
      await this.saveConfiguration(newConfig);
    }

    const result: PresetApplyResult = {
      success: true,
      applied: preset,
      changes,
      warnings: validationResults.filter(r => r.level === 'warning').map(r => r.message),
      validationResults
    };

    if (backupPath) {
      result.backupPath = backupPath;
    }

    return result;
  }

  /**
   * Get a preset by ID (from built-in or custom presets)
   */
  async getPreset(presetId: string): Promise<ProjectPreset | undefined> {
    // Check built-in presets first
    const builtinPreset = getPreset(presetId);
    if (builtinPreset) {
      return builtinPreset;
    }

    // Check custom presets
    const customPresets = await this.loadCustomPresets();
    return customPresets.find(preset => preset.id === presetId);
  }

  /**
   * List all available presets
   */
  async listAllPresets(): Promise<ProjectPreset[]> {
    const customPresets = await this.loadCustomPresets();
    return [...BUILTIN_PRESETS, ...customPresets];
  }

  /**
   * Save a custom preset
   */
  async saveCustomPreset(preset: ProjectPreset): Promise<void> {
    const customPresets = await this.loadCustomPresets();
    
    // Remove existing preset with same ID
    const filteredPresets = customPresets.filter(p => p.id !== preset.id);
    
    // Add the new preset
    filteredPresets.push({
      ...preset,
      category: 'custom',
      metadata: {
        ...preset.metadata,
        updated: Date.now()
      }
    });

    await this.saveCustomPresets(filteredPresets);
  }

  /**
   * Delete a custom preset
   */
  async deleteCustomPreset(presetId: string): Promise<boolean> {
    const customPresets = await this.loadCustomPresets();
    const filteredPresets = customPresets.filter(p => p.id !== presetId);
    
    if (filteredPresets.length === customPresets.length) {
      return false; // Preset not found
    }

    await this.saveCustomPresets(filteredPresets);
    return true;
  }

  /**
   * Compare current configuration with a preset
   */
  async compareWithPreset(presetId: string): Promise<ConfigurationChange[]> {
    const preset = await this.getPreset(presetId);
    if (!preset) {
      throw new Error(`Preset '${presetId}' not found`);
    }

    const currentConfig = await this.configManager.load();
    return this.calculateChanges(currentConfig, preset.config, true);
  }

  /**
   * Suggest presets based on current project structure
   */
  async suggestPresets(): Promise<Array<{ preset: ProjectPreset; score: number; reasons: string[] }>> {
    const suggestions: Array<{ preset: ProjectPreset; score: number; reasons: string[] }> = [];
    
    // Analyze current project structure
    const analysis = await this.analyzeProjectStructure();
    
    for (const preset of BUILTIN_PRESETS) {
      const { score, reasons } = this.calculatePresetScore(preset, analysis);
      if (score > 0) {
        suggestions.push({ preset, score, reasons });
      }
    }

    // Sort by score descending
    return suggestions.sort((a, b) => b.score - a.score);
  }

  /**
   * Private methods
   */

  private async loadCustomPresets(): Promise<ProjectPreset[]> {
    try {
      const data = await fs.readFile(this.customPresetsPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  private async saveCustomPresets(presets: ProjectPreset[]): Promise<void> {
    const dir = path.dirname(this.customPresetsPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.customPresetsPath, JSON.stringify(presets, null, 2));
  }

  private async createConfigBackup(config: FuncqcConfig): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `.funcqc/config-backup-${timestamp}.json`;
    
    const dir = path.dirname(backupPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(backupPath, JSON.stringify(config, null, 2));
    
    return backupPath;
  }

  private calculateChanges(
    currentConfig: FuncqcConfig, 
    presetConfig: Partial<FuncqcConfig>, 
    merge: boolean
  ): ConfigurationChange[] {
    const changes: ConfigurationChange[] = [];
    
    // Deep comparison of configuration objects
    this.compareConfigObjects('', currentConfig as unknown as Record<string, unknown>, presetConfig as unknown as Record<string, unknown>, changes, merge);
    
    return changes;
  }

  private compareConfigObjects(
    basePath: string,
    current: Record<string, unknown>,
    preset: Record<string, unknown>,
    changes: ConfigurationChange[],
    merge: boolean
  ): void {
    for (const [key, value] of Object.entries(preset)) {
      const currentPath = basePath ? `${basePath}.${key}` : key;
      const currentValue = current[key];
      
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        if (typeof currentValue === 'object' && currentValue !== null) {
          this.compareConfigObjects(currentPath, currentValue as Record<string, unknown>, value as Record<string, unknown>, changes, merge);
        } else {
          changes.push({
            path: currentPath,
            oldValue: currentValue,
            newValue: value,
            impact: this.assessChangeImpact(currentPath, currentValue, value),
            description: `Set ${currentPath} to new object configuration`
          });
        }
      } else if (currentValue !== value) {
        changes.push({
          path: currentPath,
          oldValue: currentValue,
          newValue: value,
          impact: this.assessChangeImpact(currentPath, currentValue, value),
          description: this.describeChange(currentPath, currentValue, value)
        });
      }
    }
  }

  private assessChangeImpact(path: string, _oldValue: unknown, _newValue: unknown): 'low' | 'medium' | 'high' {
    // Critical configuration paths
    if (path.includes('threshold') || path.includes('complexity')) {
      return 'high';
    }
    
    // Storage and roots changes
    if (path.includes('storage') || path === 'roots') {
      return 'high';
    }
    
    // Exclude patterns and other configurations
    if (path === 'exclude' || path.includes('git')) {
      return 'medium';
    }
    
    return 'low';
  }

  private describeChange(path: string, oldValue: unknown, newValue: unknown): string {
    if (oldValue === undefined) {
      return `Add ${path}: ${JSON.stringify(newValue)}`;
    }
    
    if (newValue === undefined) {
      return `Remove ${path}`;
    }
    
    return `Change ${path} from ${JSON.stringify(oldValue)} to ${JSON.stringify(newValue)}`;
  }

  private async validateConfiguration(
    presetConfig: Partial<FuncqcConfig>,
    currentConfig: FuncqcConfig,
    merge: boolean
  ): Promise<ConfigValidationResult[]> {
    const results: ConfigValidationResult[] = [];
    const mergedConfig = this.mergeConfigurations(currentConfig, presetConfig, merge);
    
    // Validate threshold consistency
    if (mergedConfig.metrics) {
      const metrics = mergedConfig.metrics;
      
      if (metrics.complexityThreshold < 1) {
        results.push({
          valid: false,
          field: 'metrics.complexityThreshold',
          level: 'error',
          message: 'Complexity threshold must be at least 1',
          suggestion: 'Set to a reasonable value like 5-10'
        });
      }
      
      if (metrics.linesOfCodeThreshold < 5) {
        results.push({
          valid: false,
          field: 'metrics.linesOfCodeThreshold',
          level: 'warning',
          message: 'Very low line count threshold may be too restrictive',
          suggestion: 'Consider values between 20-50 for most projects'
        });
      }
    }
    
    // Validate storage configuration
    if (mergedConfig.storage && !mergedConfig.storage.path) {
      results.push({
        valid: false,
        field: 'storage.path',
        level: 'error',
        message: 'Storage path is required',
        suggestion: 'Set storage.path to a valid file path like .funcqc/funcqc.db'
      });
    }
    
    return results;
  }

  private mergeConfigurations(
    current: FuncqcConfig, 
    preset: Partial<FuncqcConfig>, 
    merge: boolean
  ): FuncqcConfig {
    if (!merge) {
      return { ...current, ...preset } as FuncqcConfig;
    }
    
    // Deep merge configurations
    return this.deepMerge(current as unknown as Record<string, unknown>, preset as unknown as Record<string, unknown>) as unknown as FuncqcConfig;
  }

  private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result = { ...target };
    
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.deepMerge((target[key] as Record<string, unknown>) || {}, value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }

  private async saveConfiguration(config: FuncqcConfig): Promise<void> {
    // Save configuration using the config manager's save method
    // This would need to be implemented in ConfigManager
    // For now, we'll create a simple file-based save
    const configPath = '.funcqcrc.json';
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  }

  private async analyzeProjectStructure(): Promise<ProjectAnalysisResult> {
    // Analyze current project to suggest appropriate presets
    const analysis: ProjectAnalysisResult = {
      hasReactComponents: false,
      hasApiRoutes: false,
      isCLITool: false,
      isLibrary: false,
      projectSize: 'medium',
      detectedFrameworks: [],
      detectedDependencies: {
        frontend: [],
        backend: [],
        testing: [],
        cli: []
      }
    };

    try {
      // Check for React/frontend patterns
      const packageJsonPath = 'package.json';
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        
        // Frontend framework detection
        if (deps.react) {
          analysis.hasReactComponents = true;
          analysis.detectedFrameworks.push('React');
          analysis.detectedDependencies.frontend.push('react');
        }
        if (deps.vue) {
          analysis.hasReactComponents = true;
          analysis.detectedFrameworks.push('Vue');
          analysis.detectedDependencies.frontend.push('vue');
        }
        if (deps.angular || deps['@angular/core']) {
          analysis.hasReactComponents = true;
          analysis.detectedFrameworks.push('Angular');
          analysis.detectedDependencies.frontend.push('angular');
        }
        
        // Backend framework detection
        if (deps.express) {
          analysis.hasApiRoutes = true;
          analysis.detectedFrameworks.push('Express');
          analysis.detectedDependencies.backend.push('express');
        }
        if (deps.fastify) {
          analysis.hasApiRoutes = true;
          analysis.detectedFrameworks.push('Fastify');
          analysis.detectedDependencies.backend.push('fastify');
        }
        if (deps.koa) {
          analysis.hasApiRoutes = true;
          analysis.detectedFrameworks.push('Koa');
          analysis.detectedDependencies.backend.push('koa');
        }
        if (deps['@nestjs/core']) {
          analysis.hasApiRoutes = true;
          analysis.detectedFrameworks.push('NestJS');
          analysis.detectedDependencies.backend.push('@nestjs/core');
        }
        
        // CLI tool detection
        if (packageJson.bin || deps.commander || deps.yargs) {
          analysis.isCLITool = true;
          if (deps.commander) analysis.detectedDependencies.cli.push('commander');
          if (deps.yargs) analysis.detectedDependencies.cli.push('yargs');
        }
        
        // Library detection
        if (packageJson.main && !packageJson.private) {
          analysis.isLibrary = true;
        }
        
        // Testing framework detection
        if (deps.jest) analysis.detectedDependencies.testing.push('jest');
        if (deps.vitest) analysis.detectedDependencies.testing.push('vitest');
        if (deps.mocha) analysis.detectedDependencies.testing.push('mocha');
        
        // Project size estimation based on dependencies count
        const depCount = Object.keys(deps).length;
        if (depCount < 10) {
          analysis.projectSize = 'small';
        } else if (depCount > 30) {
          analysis.projectSize = 'large';
        } else {
          analysis.projectSize = 'medium';
        }
      } catch {
        // package.json not found or invalid
      }
    } catch {
      // File system errors
    }

    return analysis;
  }

  private calculatePresetScore(preset: ProjectPreset, analysis: ProjectAnalysisResult): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];

    // Score based on project characteristics
    if (preset.id === 'web-frontend' && analysis.hasReactComponents) {
      score += 80;
      reasons.push('Project appears to be a frontend application');
    }

    if (preset.id === 'api-backend' && analysis.hasApiRoutes) {
      score += 80;
      reasons.push('Project appears to be a backend API');
    }

    if (preset.id === 'cli-tool' && analysis.isCLITool) {
      score += 80;
      reasons.push('Project appears to be a CLI tool');
    }

    if (preset.id === 'library' && analysis.isLibrary) {
      score += 80;
      reasons.push('Project appears to be a library/package');
    }

    // AI-optimized is always a reasonable choice
    if (preset.id === 'ai-optimized') {
      score += 40;
      reasons.push('AI-optimized settings benefit all projects');
    }

    return { score, reasons };
  }
}
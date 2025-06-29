import { cosmiconfigSync } from 'cosmiconfig';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs/promises';
import { InitCommandOptions, FuncqcConfig } from '../types';

const DEFAULT_CONFIG: FuncqcConfig = {
  roots: ['src'],
  exclude: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**', '**/node_modules/**'],
  storage: {
    type: 'pglite',
    path: '.funcqc/funcqc.db'
  },
  metrics: {
    complexityThreshold: 10,           // Cyclomatic Complexity > 10
    cognitiveComplexityThreshold: 15,  // Cognitive Complexity > 15
    linesOfCodeThreshold: 40,          // Lines of Code > 40
    parameterCountThreshold: 4,        // Parameter Count > 4
    maxNestingLevelThreshold: 3        // Nesting Depth > 3
  },
  git: {
    enabled: true,
    autoLabel: true
  }
};

export async function initCommand(options: InitCommandOptions): Promise<void> {
  try {
    if (options.show) {
      await showCurrentConfig();
      return;
    }

    if (options.reset) {
      await resetConfig();
      return;
    }

    await createConfig(options);
  } catch (error) {
    console.error(chalk.red('Failed to initialize funcqc:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function showCurrentConfig(): Promise<void> {
  const explorer = cosmiconfigSync('funcqc');
  const result = explorer.search();

  if (!result) {
    console.log(chalk.yellow('No configuration found.'));
    console.log(chalk.blue('Run `funcqc init` to create a configuration file.'));
    return;
  }

  console.log(chalk.green('Current configuration:'));
  console.log(chalk.gray(`Found at: ${result.filepath}`));
  console.log();
  console.log(JSON.stringify(result.config, null, 2));
}

async function resetConfig(): Promise<void> {
  const configPath = path.join(process.cwd(), '.funcqc.config.js');
  
  if (await fileExists(configPath)) {
    await fs.unlink(configPath);
    console.log(chalk.green('Configuration file removed.'));
  }

  await createConfigFile(DEFAULT_CONFIG);
  console.log(chalk.green('Configuration reset to defaults.'));
}

async function createConfig(options: InitCommandOptions): Promise<void> {
  const config: FuncqcConfig = { ...DEFAULT_CONFIG };

  // Apply command line options
  if (options.root) {
    config.roots = options.root.split(',').map(r => r.trim());
  }

  if (options.exclude) {
    config.exclude = options.exclude.split(',').map(e => e.trim());
  }

  if (options.db) {
    config.storage.path = options.db;
  }

  // Check if configuration already exists
  const explorer = cosmiconfigSync('funcqc');
  const existing = explorer.search();

  if (existing && !options.force) {
    console.log(chalk.yellow('Configuration file already exists.'));
    console.log(chalk.gray(`Found at: ${existing.filepath}`));
    console.log(chalk.blue('Use --reset to recreate or --show to view current config.'));
    return;
  }

  await createConfigFile(config);
  await ensureDataDirectory(config.storage.path!);

  console.log(chalk.green('✓ funcqc initialized successfully!'));
  console.log();
  console.log(chalk.blue('Configuration:'));
  console.log(`  Roots: ${config.roots.join(', ')}`);
  console.log(`  Database: ${config.storage.path}`);
  console.log(`  Exclude: ${config.exclude.length} patterns`);
  console.log();
  console.log(chalk.blue('Next steps:'));
  console.log(chalk.gray('  1. Run `funcqc scan` to analyze your functions'));
  console.log(chalk.gray('  2. Run `funcqc list` to view the results'));
}

async function createConfigFile(config: FuncqcConfig): Promise<void> {
  const configPath = path.join(process.cwd(), '.funcqc.config.js');
  const configContent = generateConfigContent(config);

  await fs.writeFile(configPath, configContent, 'utf8');
}

function generateConfigContent(config: FuncqcConfig): string {
  return `// funcqc configuration
// See https://github.com/yourusername/funcqc for documentation

module.exports = ${JSON.stringify(config, null, 2)};
`;
}

async function ensureDataDirectory(dbPath: string): Promise<void> {
  const dataDir = path.dirname(dbPath);
  
  try {
    await fs.mkdir(dataDir, { recursive: true });
  } catch {
    // Directory might already exist, ignore
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

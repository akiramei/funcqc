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
    path: '.funcqc/funcqc.db',
  },
  metrics: {
    complexityThreshold: 10, // Cyclomatic Complexity > 10
    cognitiveComplexityThreshold: 15, // Cognitive Complexity > 15
    linesOfCodeThreshold: 40, // Lines of Code > 40
    parameterCountThreshold: 4, // Parameter Count > 4
    maxNestingLevelThreshold: 3, // Nesting Depth > 3
  },
  git: {
    enabled: true,
    autoLabel: true,
  },
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
    console.error(
      chalk.red('Failed to initialize funcqc:'),
      error instanceof Error ? error.message : String(error)
    );
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
  // Generate intelligent configuration based on project structure
  const config: FuncqcConfig = await generateIntelligentConfig(options);

  // Apply command line options (override intelligent detection)
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
  
  if (config.scopes) {
    console.log(chalk.blue('Scopes detected:'));
    Object.entries(config.scopes).forEach(([name, scope]: [string, any]) => {
      console.log(`  ${chalk.cyan(name)}: ${scope.description}`);
      console.log(`    Roots: ${scope.roots.join(', ')}`);
    });
  }
  
  console.log();
  console.log(chalk.blue('Next steps:'));
  console.log(chalk.gray('  1. Run `funcqc scan` to analyze your functions'));
  console.log(chalk.gray('  2. Run `funcqc list` to view the results'));
  if (config.scopes) {
    console.log(chalk.gray('  3. Use `funcqc scan --scope <name>` to analyze specific scopes'));
  }
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

/**
 * Generate intelligent configuration based on project structure
 */
async function generateIntelligentConfig(_options: InitCommandOptions): Promise<FuncqcConfig> {
  const config: FuncqcConfig = { ...DEFAULT_CONFIG };
  
  // Detect project structure
  const projectStructure = await detectProjectStructure();
  
  // Generate scopes based on detected structure
  if (projectStructure.hasComplexStructure) {
    config.scopes = await generateScopes(projectStructure);
  }
  
  // Update roots based on detected structure
  if (projectStructure.srcDirs.length > 0) {
    config.roots = projectStructure.srcDirs;
  }
  
  // Enhanced exclude patterns based on detected files
  config.exclude = [
    ...DEFAULT_CONFIG.exclude,
    ...projectStructure.excludePatterns
  ];
  
  return config;
}

/**
 * Detect project directory structure
 */
async function detectProjectStructure() {
  const structure = {
    srcDirs: [] as string[],
    testDirs: [] as string[],
    docsDirs: [] as string[],
    scriptsDirs: [] as string[],
    hasComplexStructure: false,
    excludePatterns: [] as string[]
  };
  
  // Check for common source directories
  const possibleSrcDirs = ['src', 'lib', 'source'];
  for (const dir of possibleSrcDirs) {
    if (await fileExists(dir)) {
      structure.srcDirs.push(dir);
    }
  }
  
  // Check for test directories
  const possibleTestDirs = ['test', 'tests', '__tests__', 'spec'];
  for (const dir of possibleTestDirs) {
    if (await fileExists(dir)) {
      structure.testDirs.push(dir);
    }
  }
  
  // Check for documentation directories
  const possibleDocsDirs = ['docs', 'doc', 'documentation'];
  for (const dir of possibleDocsDirs) {
    if (await fileExists(dir)) {
      structure.docsDirs.push(dir);
    }
  }
  
  // Check for scripts directories
  const possibleScriptsDirs = ['scripts', 'tools', 'bin'];
  for (const dir of possibleScriptsDirs) {
    if (await fileExists(dir)) {
      structure.scriptsDirs.push(dir);
    }
  }
  
  // Determine if this is a complex structure warranting scopes
  structure.hasComplexStructure = 
    structure.testDirs.length > 0 || 
    structure.docsDirs.length > 0 || 
    structure.scriptsDirs.length > 0;
  
  // Add common exclude patterns based on detected structure
  structure.excludePatterns = [
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/.git/**'
  ];
  
  return structure;
}

/**
 * Generate scopes configuration based on project structure
 */
async function generateScopes(structure: any) {
  const scopes: any = {};
  
  // Source code scope
  if (structure.srcDirs.length > 0) {
    scopes.src = {
      roots: structure.srcDirs,
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/__tests__/**'
      ],
      description: 'Production source code'
    };
  }
  
  // Test code scope
  if (structure.testDirs.length > 0) {
    const testRoots = [...structure.testDirs];
    if (structure.srcDirs.includes('src')) {
      testRoots.push('src/__tests__');
    }
    
    scopes.test = {
      roots: testRoots,
      include: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.test.js',
        '**/*.spec.js'
      ],
      exclude: [],
      description: 'Test code files'
    };
  }
  
  // Documentation scope
  if (structure.docsDirs.length > 0) {
    scopes.docs = {
      roots: structure.docsDirs,
      include: ['**/*.ts', '**/*.js'],
      exclude: [],
      description: 'Documentation and examples'
    };
  }
  
  // Scripts scope
  if (structure.scriptsDirs.length > 0) {
    scopes.scripts = {
      roots: structure.scriptsDirs,
      include: ['**/*.ts', '**/*.js'],
      exclude: [],
      description: 'Build scripts and tools'
    };
  }
  
  // All scope (comprehensive view)
  const allRoots = [
    ...structure.srcDirs,
    ...structure.testDirs,
    ...structure.docsDirs,
    ...structure.scriptsDirs
  ].filter((dir, index, arr) => arr.indexOf(dir) === index);
  
  if (allRoots.length > 1) {
    scopes.all = {
      roots: allRoots,
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/coverage/**'
      ],
      description: 'All source, test, and utility code'
    };
  }
  
  return scopes;
}


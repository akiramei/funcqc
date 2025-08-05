import chalk from 'chalk';
import { OptionValues } from 'commander';
import { VoidCommand } from '../../../types/command';
import { CommandEnvironment } from '../../../types/environment';
import { BackupManifest } from '../../../types';
import { ErrorCode, createErrorHandler } from '../../../utils/error-handler';
import { SchemaAnalyzer } from '../../../storage/backup/schema-analyzer';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Database convert command - Convert between backup formats and handle schema migrations
 */
/**
 * Validate input parameters for conversion
 */
async function validateConversionInputs(
  inputPath: string | undefined, 
  outputPath: string | undefined
): Promise<{ inputPath: string; outputPath: string } | null> {
  if (!inputPath) {
    console.log(chalk.red('❌ Input backup path is required'));
    console.log(chalk.gray('💡 Use --input <path> to specify the backup to convert'));
    return null;
  }

  if (!outputPath) {
    console.log(chalk.red('❌ Output path is required'));
    console.log(chalk.gray('💡 Use --output <path> to specify where to save the converted backup'));
    return null;
  }

  // Verify input backup exists
  try {
    await fs.access(inputPath);
  } catch {
    console.log(chalk.red(`❌ Input backup not found: ${inputPath}`));
    return null;
  }

  return { inputPath, outputPath };
}

/**
 * Load and validate source manifest
 */
async function loadSourceManifest(inputPath: string): Promise<BackupManifest> {
  const manifestPath = path.join(inputPath, 'manifest.json');
  try {
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    return JSON.parse(manifestContent) as BackupManifest;
  } catch (error) {
    console.log(chalk.red(`❌ Failed to load source manifest: ${error instanceof Error ? error.message : String(error)}`));
    throw error;
  }
}

/**
 * Display source backup information
 */
function displaySourceInfo(sourceManifest: {
  metadata: { backupFormat: string };
  tables: Record<string, unknown>;
  schemaHash: string;
  createdAt: string;
}, targetFormat: string): void {
  console.log(chalk.cyan('📋 Source Backup Information:'));
  console.log(`  • Format: ${sourceManifest.metadata.backupFormat}`);
  console.log(`  • Tables: ${Object.keys(sourceManifest.tables).length}`);
  console.log(`  • Schema hash: ${sourceManifest.schemaHash}`);
  console.log(`  • Created: ${new Date(sourceManifest.createdAt).toLocaleString()}`);
  console.log(`  • Target format: ${targetFormat}`);
  console.log();
}

/**
 * Check if conversion is needed and handle force flag
 */
function checkConversionNeeded(sourceManifest: {
  metadata: { backupFormat: string };
}, targetFormat: string, force: boolean): boolean {
  if (sourceManifest.metadata.backupFormat === targetFormat) {
    console.log(chalk.yellow(`⚠️  Source is already in ${targetFormat} format`));
    
    if (!force) {
      console.log(chalk.gray('💡 Use --force to proceed with copy/update anyway'));
      return false;
    }
    
    console.log(chalk.blue('🔄 Proceeding with forced conversion...'));
    console.log();
  }
  return true;
}

/**
 * Analyze schema changes
 */
async function analyzeSchemaChanges(
  schemaAnalyzer: SchemaAnalyzer, 
  sourceManifest: { schemaHash: string }, 
  allowSchemaMismatch: boolean
): Promise<{ schemaChanged: boolean; currentSchemaHash: string }> {
  let schemaChanged = false;
  let currentSchemaHash = '';
  
  try {
    const currentSchema = await schemaAnalyzer.analyzeSchema();
    currentSchemaHash = currentSchema.schemaHash;
    schemaChanged = currentSchemaHash !== sourceManifest.schemaHash;
    
    if (schemaChanged) {
      console.log(chalk.yellow('⚠️  Schema version mismatch detected:'));
      console.log(`  • Source schema: ${sourceManifest.schemaHash}`);
      console.log(`  • Current schema: ${currentSchemaHash}`);
      console.log();
      
      if (!allowSchemaMismatch) {
        console.log(chalk.red('❌ Schema mismatch detected. Conversion aborted.'));
        console.log(chalk.gray('💡 Use --allow-schema-mismatch to proceed anyway'));
        console.log(chalk.gray('💡 Consider using --update-schema to update to current schema'));
        throw new Error('Schema mismatch');
      }
      
      console.log(chalk.yellow('⚡ Proceeding with schema mismatch (--allow-schema-mismatch)'));
      console.log();
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Schema mismatch') {
      throw error;
    }
    console.log(chalk.yellow(`⚠️  Could not analyze current schema: ${error instanceof Error ? error.message : String(error)}`));
    console.log(chalk.gray('Proceeding with conversion using original schema...'));
    console.log();
  }
  
  return { schemaChanged, currentSchemaHash };
}

/**
 * Convert data files from source to target format
 */
async function convertDataFiles(
  inputPath: string,
  outputPath: string,
  sourceManifest: {
    tableOrder: string[];
    metadata: { backupFormat: string };
  },
  targetFormat: string
): Promise<{ convertedFiles: number; totalRows: number }> {
  const dataDir = path.join(inputPath, 'data');
  const outputDataDir = path.join(outputPath, 'data');
  await fs.mkdir(outputDataDir, { recursive: true });

  let convertedFiles = 0;
  let totalRows = 0;

  for (const tableName of sourceManifest.tableOrder) {
    try {
      const sourceFile = path.join(dataDir, `${tableName}.${sourceManifest.metadata.backupFormat}`);
      const targetFile = path.join(outputDataDir, `${tableName}.${targetFormat}`);

      // Read source data
      const sourceContent = await fs.readFile(sourceFile, 'utf-8');
      let data;
      
      if (sourceManifest.metadata.backupFormat === 'json') {
        data = JSON.parse(sourceContent);
      } else {
        // For SQL format, this would need SQL parsing
        throw new Error(`SQL to ${targetFormat} conversion not yet implemented`);
      }

      // Write target data
      if (targetFormat === 'json') {
        await fs.writeFile(targetFile, JSON.stringify(data, null, 2));
      } else if (targetFormat === 'sql') {
        // This would need SQL generation
        throw new Error(`${sourceManifest.metadata.backupFormat} to SQL conversion not yet implemented`);
      }

      convertedFiles++;
      totalRows += Array.isArray(data) ? data.length : 0;

    } catch (error) {
      console.log(chalk.yellow(`⚠️  Warning: Failed to convert table ${tableName}: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  return { convertedFiles, totalRows };
}

/**
 * Handle schema file copying/updating
 */
async function handleSchemaFile(
  inputPath: string,
  outputPath: string,
  updateSchema: boolean,
  schemaChanged: boolean
): Promise<void> {
  const sourceSchemaPath = path.join(inputPath, 'database.sql');
  const targetSchemaPath = path.join(outputPath, 'database.sql');
  
  if (updateSchema && schemaChanged) {
    // Copy current schema
    try {
      await fs.copyFile('src/schemas/database.sql', targetSchemaPath);
      console.log(chalk.green('✅ Updated to current schema version'));
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Could not update schema: ${error instanceof Error ? error.message : String(error)}`));
      // Fallback to source schema
      await fs.copyFile(sourceSchemaPath, targetSchemaPath);
    }
  } else {
    // Use source schema
    await fs.copyFile(sourceSchemaPath, targetSchemaPath);
  }
}

/**
 * Create and save updated manifest
 */
async function createUpdatedManifest(
  outputPath: string,
  sourceManifest: BackupManifest,
  targetFormat: string,
  updateSchema: boolean,
  schemaChanged: boolean,
  currentSchemaHash: string,
  inputPath: string
): Promise<void> {
  // Create updated manifest
  const newManifest = {
    ...sourceManifest,
    createdAt: new Date().toISOString(),
    schemaHash: updateSchema && schemaChanged ? currentSchemaHash : sourceManifest.schemaHash,
    metadata: {
      ...sourceManifest.metadata,
      backupFormat: targetFormat,
      funcqcVersion: sourceManifest.metadata.funcqcVersion, // Keep original for traceability
    }
  };

  // Add conversion metadata
  (newManifest as Record<string, unknown>)['conversionInfo'] = {
    convertedFrom: sourceManifest.metadata.backupFormat,
    convertedAt: new Date().toISOString(),
    originalCreatedAt: sourceManifest.createdAt,
    sourcePath: inputPath,
    schemaUpdated: updateSchema && schemaChanged,
  };

  // Save new manifest
  const newManifestPath = path.join(outputPath, 'manifest.json');
  await fs.writeFile(newManifestPath, JSON.stringify(newManifest, null, 2));
}

/**
 * Display conversion results
 */
function displayConversionResults(
  convertedFiles: number,
  totalRows: number,
  sourceFormat: string,
  targetFormat: string,
  updateSchema: boolean,
  schemaChanged: boolean,
  outputPath: string
): void {
  console.log(chalk.green('✅ Backup conversion completed successfully!'));
  console.log();
  console.log(chalk.cyan('📊 Conversion Statistics:'));
  console.log(`  • Files converted: ${convertedFiles}`);
  console.log(`  • Total rows: ${totalRows.toLocaleString()}`);
  console.log(`  • Source format: ${sourceFormat}`);
  console.log(`  • Target format: ${targetFormat}`);
  console.log(`  • Schema updated: ${updateSchema && schemaChanged ? 'Yes' : 'No'}`);
  console.log();
  console.log(chalk.blue('📁 Output Location:'));
  console.log(`  ${outputPath}`);
  console.log();
  console.log(chalk.gray('💡 Use "funcqc db import" to restore the converted backup'));
  console.log(chalk.gray('💡 Use "funcqc db list-backups" to see all available backups'));
}

export const dbConvertCommand: VoidCommand<OptionValues> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      const schemaAnalyzer = new SchemaAnalyzer();
      const targetFormat = options['format'] || 'json';

      // Validate inputs
      const inputs = await validateConversionInputs(options['input'], options['output']);
      if (!inputs) return;

      const { inputPath, outputPath } = inputs;

      console.log(chalk.blue('🔄 Starting backup conversion...'));
      console.log();

      // Load and validate manifest
      const sourceManifest = await loadSourceManifest(inputPath);
      
      // Display source information
      displaySourceInfo(sourceManifest, targetFormat);

      // Check if conversion is needed
      if (!checkConversionNeeded(sourceManifest, targetFormat, options['force'])) {
        return;
      }

      // Create output directory
      await fs.mkdir(outputPath, { recursive: true });

      // Analyze schema changes
      const { schemaChanged, currentSchemaHash } = await analyzeSchemaChanges(
        schemaAnalyzer, 
        sourceManifest, 
        options['allowSchemaMismatch']
      );

      // Convert data files
      const { convertedFiles, totalRows } = await convertDataFiles(
        inputPath, 
        outputPath, 
        sourceManifest, 
        targetFormat
      );

      // Handle schema file
      await handleSchemaFile(inputPath, outputPath, options['updateSchema'], schemaChanged);

      // Create updated manifest
      await createUpdatedManifest(
        outputPath,
        sourceManifest,
        targetFormat,
        options['updateSchema'],
        schemaChanged,
        currentSchemaHash,
        inputPath
      );

      // Display results
      displayConversionResults(
        convertedFiles,
        totalRows,
        sourceManifest.metadata.backupFormat,
        targetFormat,
        options['updateSchema'],
        schemaChanged,
        outputPath
      );

    } catch (error) {
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `Backup conversion failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
      process.exit(1);
    }
  };
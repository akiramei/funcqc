import chalk from 'chalk';
import { FilesCommandOptions } from '../../types';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';
import { formatBytes, formatNumber } from '../../utils/format-utils';

/**
 * Files command to list and display source files in snapshots
 */
export const filesCommand = () => 
  (options: FilesCommandOptions) => 
    async (env: CommandEnvironment): Promise<void> => {
      const errorHandler = createErrorHandler(env.commandLogger);

      try {
        const targetSnapshotId = await getTargetSnapshotId(env, options);
        const sourceFiles = await env.storage.getSourceFilesBySnapshot(targetSnapshotId);
        
        if (sourceFiles.length === 0) {
          console.log(chalk.yellow('No source files found in the specified snapshot.'));
          return;
        }

        if (options.json) {
          outputJSON(sourceFiles);
        } else {
          await outputFriendly(sourceFiles, options);
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
            `Failed to list files: ${error instanceof Error ? error.message : String(error)}`,
            {},
            error instanceof Error ? error : undefined
          );
          errorHandler.handleError(funcqcError);
        }
      }
    };

async function getTargetSnapshotId(
  env: CommandEnvironment, 
  options: FilesCommandOptions
): Promise<string> {
  if (options.snapshot) {
    // Use specific snapshot if provided
    const snapshot = await env.storage.getSnapshot(options.snapshot);
    if (!snapshot) {
      throw new Error(`Snapshot '${options.snapshot}' not found`);
    }
    return snapshot.id;
  }
  
  // Use latest snapshot
  const snapshots = await env.storage.getSnapshots({ sort: 'created_at', limit: 1 });
  if (snapshots.length === 0) {
    throw new Error('No snapshots found. Please run `funcqc scan` first.');
  }
  
  return snapshots[0].id;
}

function outputJSON(sourceFiles: import('../../types').SourceFile[]): void {
  const output = {
    totalFiles: sourceFiles.length,
    files: sourceFiles.map(file => ({
      id: file.id,
      filePath: file.filePath,
      language: file.language,
      fileSizeBytes: file.fileSizeBytes,
      lineCount: file.lineCount,
      functionCount: file.functionCount,
      exportCount: file.exportCount,
      importCount: file.importCount,
      fileHash: file.fileHash,
      encoding: file.encoding,
      fileModifiedTime: file.fileModifiedTime?.toISOString(),
      createdAt: file.createdAt.toISOString(),
    })),
  };
  
  console.log(JSON.stringify(output, null, 2));
}

async function outputFriendly(
  sourceFiles: import('../../types').SourceFile[], 
  options: FilesCommandOptions
): Promise<void> {
  // Apply filters and sorting
  const processedFiles = processFileList(sourceFiles, options);
  
  // Display results
  displayFileResults(sourceFiles, processedFiles, options);
}

/**
 * Apply filters, sorting, and limits to the file list
 */
function processFileList(
  sourceFiles: import('../../types').SourceFile[], 
  options: FilesCommandOptions
): import('../../types').SourceFile[] {
  // Apply filters
  let filteredFiles = applyFileFilters(sourceFiles, options);
  
  // Sort files
  filteredFiles = sortFileList(filteredFiles, options);
  
  // Apply limit
  filteredFiles = applyFileLimit(filteredFiles, options);
  
  return filteredFiles;
}

/**
 * Apply language and path filters to source files
 */
function applyFileFilters(
  sourceFiles: import('../../types').SourceFile[], 
  options: FilesCommandOptions
): import('../../types').SourceFile[] {
  let filteredFiles = sourceFiles;
  
  if (options.language) {
    filteredFiles = filteredFiles.filter(f => 
      f.language.toLowerCase().includes(options.language!.toLowerCase())
    );
  }
  
  if (options.path) {
    filteredFiles = filteredFiles.filter(f => 
      f.filePath.includes(options.path!)
    );
  }
  
  return filteredFiles;
}

/**
 * Sort files by the specified criteria
 */
function sortFileList(
  files: import('../../types').SourceFile[], 
  options: FilesCommandOptions
): import('../../types').SourceFile[] {
  const sortField = options.sort || 'filePath';
  const sortOrder = options.desc ? -1 : 1;
  
  return files.sort((a, b) => {
    const { aVal, bVal } = extractSortValues(a, b, sortField);
    
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return aVal.localeCompare(bVal) * sortOrder;
    } else {
      return ((aVal as number) - (bVal as number)) * sortOrder;
    }
  });
}

/**
 * Extract sort values from two files based on sort field
 */
function extractSortValues(
  a: import('../../types').SourceFile, 
  b: import('../../types').SourceFile, 
  sortField: string
): { aVal: string | number; bVal: string | number } {
  switch (sortField) {
    case 'size':
      return { aVal: a.fileSizeBytes, bVal: b.fileSizeBytes };
    case 'lines':
      return { aVal: a.lineCount, bVal: b.lineCount };
    case 'functions':
      return { aVal: a.functionCount, bVal: b.functionCount };
    case 'language':
      return { aVal: a.language, bVal: b.language };
    case 'modified':
      return { 
        aVal: a.fileModifiedTime?.getTime() || 0, 
        bVal: b.fileModifiedTime?.getTime() || 0 
      };
    default:
      return { aVal: a.filePath, bVal: b.filePath };
  }
}

/**
 * Apply limit to the file list
 */
function applyFileLimit(
  files: import('../../types').SourceFile[], 
  options: FilesCommandOptions
): import('../../types').SourceFile[] {
  const limit = options.limit ? parseInt(options.limit) : undefined;
  return limit ? files.slice(0, limit) : files;
}

/**
 * Display the file results with header, stats, table, and summary
 */
function displayFileResults(
  originalFiles: import('../../types').SourceFile[], 
  processedFiles: import('../../types').SourceFile[], 
  options: FilesCommandOptions
): void {
  // Display header
  console.log(chalk.blue.bold(`\n📁 Source Files (${processedFiles.length}/${originalFiles.length})`));
  console.log('─'.repeat(80));
  
  if (options.stats) {
    displayStats(originalFiles);
    console.log('─'.repeat(80));
  }
  
  // Display files table
  displayFilesTable(processedFiles);
  
  // Display summary
  if (processedFiles.length !== originalFiles.length) {
    console.log(chalk.gray(`\nShowing ${processedFiles.length} of ${originalFiles.length} files`));
  }
}

function displayStats(sourceFiles: import('../../types').SourceFile[]): void {
  const stats = calculateFileStats(sourceFiles);
  
  console.log(chalk.cyan('\n📊 File Statistics:'));
  console.log(`  Total Files: ${stats.totalFiles}`);
  console.log(`  Total Size: ${formatBytes(stats.totalSize)}`);
  console.log(`  Total Lines: ${stats.totalLines.toLocaleString()}`);
  console.log(`  Total Functions: ${stats.totalFunctions}`);
  
  console.log(chalk.cyan('\n📈 Averages:'));
  console.log(`  Avg Size: ${formatBytes(stats.avgSize)}`);
  console.log(`  Avg Lines: ${stats.avgLines.toFixed(1)}`);
  console.log(`  Avg Functions per File: ${stats.avgFunctions.toFixed(1)}`);
  
  console.log(chalk.cyan('\n🏷️  Languages:'));
  Object.entries(stats.languageDistribution)
    .sort(([,a], [,b]) => b - a)
    .forEach(([lang, count]) => {
      const percentage = ((count / stats.totalFiles) * 100).toFixed(1);
      console.log(`  ${lang}: ${count} files (${percentage}%)`);
    });
}

function calculateFileStats(sourceFiles: import('../../types').SourceFile[]) {
  const totalFiles = sourceFiles.length;
  const totalSize = sourceFiles.reduce((sum, f) => sum + f.fileSizeBytes, 0);
  const totalLines = sourceFiles.reduce((sum, f) => sum + f.lineCount, 0);
  const totalFunctions = sourceFiles.reduce((sum, f) => sum + f.functionCount, 0);
  
  const languageDistribution: Record<string, number> = {};
  sourceFiles.forEach(f => {
    languageDistribution[f.language] = (languageDistribution[f.language] || 0) + 1;
  });
  
  return {
    totalFiles,
    totalSize,
    totalLines,
    totalFunctions,
    avgSize: totalSize / totalFiles,
    avgLines: totalLines / totalFiles,
    avgFunctions: totalFunctions / totalFiles,
    languageDistribution,
  };
}

function displayFilesTable(files: import('../../types').SourceFile[]): void {
  // Display files in a formatted table with improved alignment
  const maxPathLength = 50;
  const langWidth = 10;
  const sizeWidth = 10;
  const linesWidth = 7;
  const funcsWidth = 6;
  
  // Header
  console.log(
    chalk.gray(
      'Path'.padEnd(maxPathLength) + ' ' +
      'Lang'.padEnd(langWidth) + ' ' +
      'Size'.padStart(sizeWidth) + ' ' +
      'Lines'.padStart(linesWidth) + ' ' +
      'Funcs'.padStart(funcsWidth)
    )
  );
  
  // Separator
  console.log(
    '─'.repeat(maxPathLength) + ' ' +
    '─'.repeat(langWidth) + ' ' +
    '─'.repeat(sizeWidth) + ' ' +
    '─'.repeat(linesWidth) + ' ' +
    '─'.repeat(funcsWidth)
  );
  
  files.forEach(file => {
    const displayPath = file.filePath.length > maxPathLength 
      ? '...' + file.filePath.slice(-(maxPathLength - 3))
      : file.filePath;
    
    // Size color thresholds (more realistic for code files)
    const sizeColor = file.fileSizeBytes > 100000 ? chalk.red :      // 100KB+ = red
                     file.fileSizeBytes > 50000 ? chalk.yellow :      // 50KB+ = yellow  
                     chalk.white;                                     // <50KB = white
    
    // Lines color thresholds (new - for code maintainability)
    const linesColor = file.lineCount > 2000 ? chalk.red :           // 2000+ lines = red
                      file.lineCount > 1000 ? chalk.yellow :         // 1000+ lines = yellow
                      chalk.white;                                    // <1000 lines = white
    
    // Function count thresholds (more realistic for large files)
    const funcColor = file.functionCount > 50 ? chalk.red :          // 50+ functions = red
                     file.functionCount > 25 ? chalk.yellow :         // 25+ functions = yellow
                     file.functionCount > 10 ? chalk.cyan :           // 10+ functions = cyan
                     chalk.gray;                                      // <10 functions = gray
    
    // Format numbers with proper alignment
    const formattedSize = formatBytes(file.fileSizeBytes);
    const formattedLines = formatNumber(file.lineCount);
    const formattedFuncs = file.functionCount.toString();
    
    console.log(
      displayPath.padEnd(maxPathLength) + ' ' +
      file.language.padEnd(langWidth) + ' ' +
      sizeColor(formattedSize.padStart(sizeWidth)) + ' ' +
      linesColor(formattedLines.padStart(linesWidth)) + ' ' +
      funcColor(formattedFuncs.padStart(funcsWidth))
    );
  });
}
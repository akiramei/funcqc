import chalk from 'chalk';
import { FilesCommandOptions } from '../../types';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';

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
  // Apply filters
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
  
  // Sort files
  const sortField = options.sort || 'filePath';
  const sortOrder = options.desc ? -1 : 1;
  
  filteredFiles.sort((a, b) => {
    let aVal: any, bVal: any;
    
    switch (sortField) {
      case 'size':
        aVal = a.fileSizeBytes;
        bVal = b.fileSizeBytes;
        break;
      case 'lines':
        aVal = a.lineCount;
        bVal = b.lineCount;
        break;
      case 'functions':
        aVal = a.functionCount;
        bVal = b.functionCount;
        break;
      case 'language':
        aVal = a.language;
        bVal = b.language;
        break;
      case 'modified':
        aVal = a.fileModifiedTime?.getTime() || 0;
        bVal = b.fileModifiedTime?.getTime() || 0;
        break;
      default:
        aVal = a.filePath;
        bVal = b.filePath;
    }
    
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return aVal.localeCompare(bVal) * sortOrder;
    } else {
      return (aVal - bVal) * sortOrder;
    }
  });
  
  // Apply limit
  const limit = options.limit ? parseInt(options.limit) : undefined;
  if (limit) {
    filteredFiles = filteredFiles.slice(0, limit);
  }
  
  // Display header
  console.log(chalk.blue.bold(`\n📁 Source Files (${filteredFiles.length}/${sourceFiles.length})`));
  console.log('─'.repeat(80));
  
  if (options.stats) {
    displayStats(sourceFiles);
    console.log('─'.repeat(80));
  }
  
  // Display files table
  displayFilesTable(filteredFiles);
  
  // Display summary
  if (filteredFiles.length !== sourceFiles.length) {
    console.log(chalk.gray(`\nShowing ${filteredFiles.length} of ${sourceFiles.length} files`));
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function displayFilesTable(files: import('../../types').SourceFile[]): void {
  // Display files in a formatted table
  const maxPathLength = 50;
  
  console.log(
    chalk.gray(
      'Path'.padEnd(maxPathLength) + ' ' +
      'Lang'.padEnd(10) + ' ' +
      'Size'.padStart(8) + ' ' +
      'Lines'.padStart(6) + ' ' +
      'Funcs'.padStart(6)
    )
  );
  
  console.log(
    '─'.repeat(maxPathLength) + ' ' +
    '─'.repeat(10) + ' ' +
    '─'.repeat(8) + ' ' +
    '─'.repeat(6) + ' ' +
    '─'.repeat(6)
  );
  
  files.forEach(file => {
    const displayPath = file.filePath.length > maxPathLength 
      ? '...' + file.filePath.slice(-(maxPathLength - 3))
      : file.filePath;
    
    const sizeColor = file.fileSizeBytes > 50000 ? chalk.red : 
                     file.fileSizeBytes > 20000 ? chalk.yellow : chalk.white;
    
    const funcColor = file.functionCount > 20 ? chalk.cyan : 
                     file.functionCount > 10 ? chalk.blue : chalk.gray;
    
    console.log(
      displayPath.padEnd(maxPathLength) + ' ' +
      file.language.padEnd(10) + ' ' +
      sizeColor(formatBytes(file.fileSizeBytes)).padStart(8) + ' ' +
      file.lineCount.toString().padStart(6) + ' ' +
      funcColor(file.functionCount.toString()).padStart(6)
    );
  });
}
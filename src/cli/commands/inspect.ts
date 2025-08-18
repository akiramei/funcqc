import { InspectCommandOptions, FunctionInfo, QueryOptions, SourceFile } from '../../types';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import type { DatabaseErrorLike } from '../../utils/error-handler';

/**
 * Inspect command - unified search and exploration interface
 * Consolidates functionality from list, search, files, and show commands
 */
export const inspectCommand: VoidCommand<InspectCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {

    try {
      switch (options.type) {
        case 'files':
          await inspectFiles(env, options);
          break;
        case 'functions':
        default:
          await inspectFunctions(env, options);
          break;
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        env.commandLogger.error(`Database error during inspect: ${(error as DatabaseErrorLike).message}`);
        throw error;
      }
      throw error;
    }
  };

/**
 * Inspect functions (primary mode - based on list command)
 */
async function inspectFunctions(
  env: CommandEnvironment, 
  options: InspectCommandOptions
): Promise<void> {
  const needsChangeCount = options.changesGe !== undefined;
  
  const queryOptions: QueryOptions = {
    sort: 'file_path,start_line'
  };
  
  if (options.scope) {
    queryOptions.scope = options.scope;
  }
  
  // Add dummy filter to trigger change count inclusion if needed
  if (needsChangeCount) {
    queryOptions.filters = [{ field: 'changes', operator: '>=', value: 0 }];
  }
  
  let functions = await env.storage.findFunctions(queryOptions);

  if (functions.length === 0) {
    console.log('No functions found. Run `funcqc scan` first.');
    return;
  }

  // Apply filters (inherited from list command)
  functions = applyFunctionFilters(functions, options);

  // Apply name-based search if provided
  if (options.name) {
    functions = applyNameSearch(functions, options.name);
  }

  // Apply sorting
  functions = applySorting(functions, options);

  // Apply limit
  const limitedFunctions = applyLimit(functions, options);

  // Output results based on detail level
  if (options.json) {
    outputJSON(limitedFunctions, options);
  } else if (options.detailed) {
    outputDetailed(limitedFunctions, options, env);
  } else {
    outputTable(limitedFunctions, options);
  }
}

/**
 * Inspect files (files command integration)
 */
async function inspectFiles(
  env: CommandEnvironment, 
  options: InspectCommandOptions
): Promise<void> {
  try {
    const targetSnapshotId = await getTargetSnapshotId(env, options);
    const sourceFiles = await env.storage.getSourceFilesBySnapshot(targetSnapshotId);
    
    if (sourceFiles.length === 0) {
      console.log('📁 No source files found. Run `funcqc scan` first.');
      return;
    }

    // Apply filters, sorting, and limit
    let processedFiles = applyFileFilters(sourceFiles, options);
    processedFiles = applyFileSorting(processedFiles, options);
    processedFiles = applyFileLimit(processedFiles, options);

    // Output results
    if (options.json) {
      outputFilesJSON(processedFiles);
    } else {
      outputFilesTable(processedFiles, options);
    }
  } catch (error) {
    console.error(`❌ Failed to inspect files: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Apply function filters (inherited from list command)
 */
function applyFunctionFilters(
  functions: FunctionInfo[], 
  options: InspectCommandOptions
): FunctionInfo[] {
  let filtered = functions;

  // Complexity filter
  if (options.ccGe !== undefined) {
    const threshold = parseInt(options.ccGe.toString(), 10);
    if (!isNaN(threshold)) {
      filtered = filtered.filter(f => f.metrics && f.metrics.cyclomaticComplexity >= threshold);
    }
  }

  // Changes filter - TODO: Get from changes table
  // if (options.changesGe !== undefined) {
  //   filtered = filtered.filter(f => (f.changes || 0) >= options.changesGe!);
  // }

  // File pattern filter
  if (options.file) {
    const filePattern = options.file.toLowerCase();
    filtered = filtered.filter(f => f.filePath.toLowerCase().includes(filePattern));
  }

  return filtered;
}

/**
 * Apply name-based search (simple keyword search from search command)
 */
function applyNameSearch(
  functions: FunctionInfo[], 
  namePattern: string
): FunctionInfo[] {
  const needle = namePattern.toLowerCase();
  return functions.filter(f => {
    const name = f.name?.toLowerCase() || '';
    const disp = f.displayName?.toLowerCase() || '';
    return name.includes(needle) || disp.includes(needle);
  });
}

/**
 * Apply sorting (inherited from list command)
 */
function applySorting(
  functions: FunctionInfo[], 
  options: InspectCommandOptions
): FunctionInfo[] {
  if (!options.sort) {
    return functions;
  }

  const desc = options.desc || false;
  
  return functions.sort((a, b) => {
    let comparison = 0;
    
    switch (options.sort) {
      case 'cc': {
        const complexityA = a.metrics?.cyclomaticComplexity || 1;
        const complexityB = b.metrics?.cyclomaticComplexity || 1;
        comparison = complexityA - complexityB;
        break;
      }
      case 'loc': {
        const locA = a.metrics?.linesOfCode || 0;
        const locB = b.metrics?.linesOfCode || 0;
        comparison = locA - locB;
        break;
      }
      // case 'changes':
      //   comparison = (a.changes || 0) - (b.changes || 0);
      //   break;
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'file':
        comparison = a.filePath.localeCompare(b.filePath);
        break;
      default:
        return 0;
    }
    
    return desc ? -comparison : comparison;
  });
}

/**
 * Apply result limit
 */
function applyLimit(
  functions: FunctionInfo[], 
  options: InspectCommandOptions
): FunctionInfo[] {
  if (!options.limit) {
    return functions;
  }
  
  return functions.slice(0, options.limit);
}

/**
 * Output results as JSON
 */
function outputJSON(
  functions: FunctionInfo[], 
  options: InspectCommandOptions
): void {
  const output = {
    type: options.type || 'functions',
    count: functions.length,
    functions: functions.map(f => ({
      id: f.id,
      name: f.name,
      displayName: f.displayName,
      filePath: f.filePath,
      startLine: f.startLine,
      cyclomaticComplexity: f.metrics?.cyclomaticComplexity || 1,
      linesOfCode: f.metrics?.linesOfCode || 0,
      // changes: f.changes || 0, // TODO: Get from changes table
      isExported: f.isExported,
      functionType: f.functionType
    }))
  };
  
  console.log(JSON.stringify(output, null, 2));
}

/**
 * Output results as formatted table
 */
function outputTable(
  functions: FunctionInfo[], 
  options: InspectCommandOptions
): void {
  if (functions.length === 0) {
    console.log('🔍 No functions match the specified criteria.');
    return;
  }

  console.log(`🔍 Found ${functions.length} function(s):`);
  console.log();

  // Simple table output (can be enhanced later)
  functions.forEach((func, index) => {
    const location = `${func.filePath}:${func.startLine}`;
    const exported = func.isExported ? '📤 exported' : '🔒 internal';
    const type = func.functionType || 'function';
    
    console.log(`${index + 1}. ${func.displayName || func.name}`);
    console.log(`   📁 ${location}`);
    console.log(`   🏷️  ${type}, ${exported}`);
    if (index < functions.length - 1) {
      console.log();
    }
  });

  console.log();
  console.log(`💡 Use --json for machine-readable output`);
  if (options.limit && functions.length === options.limit) {
    console.log(`⚠️  Results limited to ${options.limit}. Use --limit to adjust.`);
  }
}

/**
 * Output detailed function information (like show command)
 */
async function outputDetailed(
  functions: FunctionInfo[], 
  options: InspectCommandOptions,
  _env: CommandEnvironment
): Promise<void> {
  if (functions.length === 0) {
    console.log('🔍 No functions match the specified criteria.');
    return;
  }

  console.log(`🔍 Found ${functions.length} function(s) with detailed information:`);
  console.log();

  for (let i = 0; i < functions.length; i++) {
    const func = functions[i];
    
    // Function header
    console.log(`${i + 1}. ${func.displayName || func.name}`);
    console.log(`   📂 ${func.filePath}:${func.startLine}`);
    
    // Basic metrics
    const complexity = func.metrics?.cyclomaticComplexity || 1;
    const loc = func.metrics?.linesOfCode || 0;
    const complexityColor = getComplexityColor(complexity);
    
    console.log(`   📊 Complexity: ${complexityColor(complexity.toString())}, Lines: ${loc}`);
    
    // Function properties
    const properties = [];
    if (func.isExported) properties.push('📤 exported');
    if (func.isAsync) properties.push('⚡ async');
    if (func.functionType) properties.push(`🏷️ ${func.functionType}`);
    
    if (properties.length > 0) {
      console.log(`   ${properties.join(', ')}`);
    }
    
    // JSDoc if available
    if (func.jsDoc) {
      const jsDocPreview = func.jsDoc.split('\n').slice(0, 3).join('\n').trim();
      console.log(`   📝 JSDoc: ${jsDocPreview}${func.jsDoc.split('\n').length > 3 ? '...' : ''}`);
    }
    
    // Description if available
    if (func.description) {
      console.log(`   📄 Description: ${func.description}`);
    }
    
    // Function signature if available
    if (func.signature) {
      console.log(`   ⚙️  Signature: ${func.signature}`);
    }
    
    if (i < functions.length - 1) {
      console.log();
    }
  }

  console.log();
  console.log(`💡 Use --json for machine-readable output`);
  if (options.limit && functions.length === options.limit) {
    console.log(`⚠️  Results limited to ${options.limit}. Use --limit to adjust.`);
  }
}

/**
 * Get color for complexity display
 */
function getComplexityColor(complexity: number): (text: string) => string {
  if (complexity >= 10) return (text: string) => `\x1b[31m${text}\x1b[0m`; // red
  if (complexity >= 5) return (text: string) => `\x1b[33m${text}\x1b[0m`; // yellow
  return (text: string) => `\x1b[32m${text}\x1b[0m`; // green
}

// ===== Files Inspection Support Functions =====

/**
 * Get target snapshot ID (shared with files command logic)
 */
async function getTargetSnapshotId(
  env: CommandEnvironment, 
  _options: InspectCommandOptions
): Promise<string> {
  // For now, just use latest snapshot
  // TODO: Add snapshot option to InspectCommandOptions if needed
  const snapshots = await env.storage.getSnapshots({ sort: 'created_at', limit: 1 });
  if (snapshots.length === 0) {
    throw new Error('No snapshots found. Please run `funcqc scan` first.');
  }
  
  return snapshots[0].id;
}

/**
 * Apply file filters
 */
function applyFileFilters(
  sourceFiles: SourceFile[], 
  options: InspectCommandOptions
): SourceFile[] {
  let filteredFiles = sourceFiles;
  
  // File path filter (reuse the file option)
  if (options.file) {
    const needle = options.file.toLowerCase();
    filteredFiles = filteredFiles.filter(f => f.filePath.toLowerCase().includes(needle));
  }
  
  return filteredFiles;
}

/**
 * Apply file sorting
 */
function applyFileSorting(
  files: SourceFile[], 
  options: InspectCommandOptions
): SourceFile[] {
  if (!options.sort) {
    return files;
  }

  const desc = options.desc || false;
  
  return files.sort((a, b) => {
    let comparison = 0;
    
    switch (options.sort) {
      case 'lines':
        comparison = a.lineCount - b.lineCount;
        break;
      case 'funcs':
      case 'functions':
        comparison = a.functionCount - b.functionCount;
        break;
      case 'size':
        comparison = a.fileSizeBytes - b.fileSizeBytes;
        break;
      case 'file':
      case 'name':
      default:
        comparison = a.filePath.localeCompare(b.filePath);
        break;
    }
    
    return desc ? -comparison : comparison;
  });
}

/**
 * Apply file limit
 */
function applyFileLimit(
  files: SourceFile[], 
  options: InspectCommandOptions
): SourceFile[] {
  if (!options.limit) {
    return files;
  }
  
  return files.slice(0, options.limit);
}

/**
 * Output files as JSON
 */
function outputFilesJSON(sourceFiles: SourceFile[]): void {
  const output = {
    type: 'files',
    count: sourceFiles.length,
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
    }))
  };
  
  console.log(JSON.stringify(output, null, 2));
}

/**
 * Output files as formatted table
 */
function outputFilesTable(sourceFiles: SourceFile[], options: InspectCommandOptions): void {
  if (sourceFiles.length === 0) {
    console.log('📁 No files match the specified criteria.');
    return;
  }

  // Check for compact/table format request
  if (options.format === 'table' || options.format === 'compact') {
    outputFilesTableCompact(sourceFiles, options);
    return;
  }

  // Default card format
  console.log(`📁 Found ${sourceFiles.length} file(s):`);
  console.log();

  // Simple table output
  sourceFiles.forEach((file, index) => {
    const sizeStr = formatFileSize(file.fileSizeBytes);
    const language = file.language || 'unknown';
    
    console.log(`${index + 1}. ${file.filePath}`);
    console.log(`   📊 ${file.lineCount} lines, ${file.functionCount} functions, ${sizeStr}`);
    console.log(`   🏷️  ${language}, ${file.exportCount} exports, ${file.importCount} imports`);
    if (index < sourceFiles.length - 1) {
      console.log();
    }
  });

  console.log();
  console.log(`💡 Use --json for machine-readable output`);
  console.log(`💡 Use --format=table for compact table view`);
  if (options.limit && sourceFiles.length === options.limit) {
    console.log(`⚠️  Results limited to ${options.limit}. Use --limit to adjust.`);
  }
}

/**
 * Output files as compact table (similar to files command)
 */
function outputFilesTableCompact(sourceFiles: SourceFile[], options: InspectCommandOptions): void {
  console.log(`📁 Source Files (${sourceFiles.length})`);
  console.log('────────────────────────────────────────────────────────────────────────────────');
  
  // Table header
  const maxPathLength = 50;
  const langWidth = 10;
  const sizeWidth = 10;
  const linesWidth = 7;
  const funcsWidth = 6;
  
  console.log(
    'Path'.padEnd(maxPathLength) + ' ' +
    'Lang'.padEnd(langWidth) + ' ' +
    'Size'.padStart(sizeWidth) + ' ' +
    'Lines'.padStart(linesWidth) + ' ' +
    'Funcs'.padStart(funcsWidth)
  );
  
  console.log(
    '─'.repeat(maxPathLength) + ' ' +
    '─'.repeat(langWidth) + ' ' +
    '─'.repeat(sizeWidth) + ' ' +
    '─'.repeat(linesWidth) + ' ' +
    '─'.repeat(funcsWidth)
  );
  
  // Table rows
  sourceFiles.forEach(file => {
    const displayPath = file.filePath.length > maxPathLength 
      ? '...' + file.filePath.slice(-(maxPathLength - 3))
      : file.filePath;
    
    const formattedSize = formatFileSize(file.fileSizeBytes);
    const formattedLines = file.lineCount.toLocaleString();
    const formattedFuncs = file.functionCount.toString();
    
    console.log(
      displayPath.padEnd(maxPathLength) + ' ' +
      file.language.padEnd(langWidth) + ' ' +
      formattedSize.padStart(sizeWidth) + ' ' +
      formattedLines.padStart(linesWidth) + ' ' +
      formattedFuncs.padStart(funcsWidth)
    );
  });

  console.log();
  if (options.limit && sourceFiles.length === options.limit) {
    console.log(`⚠️  Results limited to ${options.limit}. Use --limit to adjust.`);
  }
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
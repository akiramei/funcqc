import { HistoryCommandOptions, FunctionInfo, SnapshotInfo } from '../../types';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { DatabaseError } from '../../storage/pglite-adapter';
import { ErrorCode, createErrorHandler } from '../../utils/error-handler';
import { formatDuration } from '../../utils/file-utils';
import chalk from 'chalk';

/**
 * History command as a Reader function
 */
export const historyCommand: VoidCommand<HistoryCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      if (options.id) {
        // Function tracking mode
        await displayFunctionHistory(options.id, options)(env);
      } else {
        // Standard snapshot history mode
        await displaySnapshotHistory(options)(env);
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
          `Failed to display history: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Display function tracking history - Reader function
 */
const displayFunctionHistory = (functionId: string, options: HistoryCommandOptions) =>
  async (env: CommandEnvironment): Promise<void> => {
    const functions = await env.storage.queryFunctions({});
    
    if (functions.length === 0) {
      throw new Error(`Function with ID '${functionId}' not found.`);
    }

    // Get snapshots and function history
    const snapshots = await env.storage.getSnapshots({
      limit: options.limit ? parseInt(options.limit) : 20,
      // Note: The storage adapter may not support all filter options
    });
    
    // Filter functions by the specified ID
    const filteredFunctions = functions.filter(f => f.id === functionId || f.id.startsWith(functionId));

    if (options.json) {
      outputFunctionHistoryJSON(functionId, filteredFunctions, snapshots);
    } else {
      await outputFunctionHistoryFormatted(functionId, filteredFunctions, snapshots, options, env);
    }
  };

/**
 * Display snapshot history - Reader function
 */
const displaySnapshotHistory = (options: HistoryCommandOptions) =>
  async (env: CommandEnvironment): Promise<void> => {
    const snapshots = await env.storage.getSnapshots({
      limit: options.limit ? parseInt(options.limit) : 20,
      // Note: The storage adapter may not support all filter options
    });

    if (snapshots.length === 0) {
      console.log('No snapshots found.');
      return;
    }

    if (options.json) {
      outputSnapshotHistoryJSON(snapshots);
    } else {
      await outputSnapshotHistoryFormatted(snapshots, options, env);
    }
  };

/**
 * Output function history as JSON
 */
function outputFunctionHistoryJSON(
  functionId: string, 
  functions: FunctionInfo[], 
  snapshots: SnapshotInfo[]
): void {
  const output = {
    function_id: functionId,
    function_name: functions[0]?.name || 'Unknown',
    history: functions.map(f => ({
      snapshot_id: (f as any).snapshotId,
      file_path: f.filePath,
      start_line: f.startLine,
      end_line: f.endLine,
      metrics: f.metrics,
      created_at: (f as any).createdAt,
    })),
    snapshots: snapshots.map(s => ({
      id: s.id,
      timestamp: (s as any).timestamp,
      git_commit: s.gitCommit,
      label: (s as any).label,
      total_functions: (s as any).totalFunctions,
    })),
  };
  
  console.log(JSON.stringify(output, null, 2));
}

/**
 * Output snapshot history as JSON
 */
function outputSnapshotHistoryJSON(snapshots: SnapshotInfo[]): void {
  const output = {
    snapshots: snapshots.map(s => ({
      id: s.id,
      timestamp: (s as any).timestamp,
      git_commit: s.gitCommit,
      git_branch: s.gitBranch,
      git_author: (s as any).gitAuthor,
      label: (s as any).label,
      total_functions: (s as any).totalFunctions,
      total_files: (s as any).totalFiles,
      processing_time: (s as any).processingTime,
    })),
  };
  
  console.log(JSON.stringify(output, null, 2));
}

/**
 * Output formatted function history
 */
async function outputFunctionHistoryFormatted(
  functionId: string,
  functions: FunctionInfo[],
  snapshots: SnapshotInfo[],
  options: HistoryCommandOptions,
  _env: CommandEnvironment
): Promise<void> {
  console.log(chalk.bold.blue(`\n📋 Function History: ${functions[0]?.name || 'Unknown'}\n`));
  console.log(`Function ID: ${functionId}`);
  console.log(`Total appearances: ${functions.length}`);
  console.log('');

  if (options.verbose) {
    // Detailed view with metrics
    console.log(chalk.bold('📊 Evolution Timeline:'));
    console.log('');
    
    functions.forEach((func, index) => {
      const snapshot = snapshots.find(s => s.id === (func as any).snapshotId);
      console.log(`${index + 1}. ${new Date((func as any).createdAt || 0).toLocaleDateString()}`);
      console.log(`   📍 ${func.filePath}:${func.startLine}-${func.endLine}`);
      
      if (func.metrics) {
        console.log(`   📊 CC: ${func.metrics.cyclomaticComplexity}, LOC: ${func.metrics.linesOfCode}`);
      }
      
      if (snapshot) {
        console.log(`   📝 ${snapshot.gitCommit?.substring(0, 8) || 'No commit'} - ${(snapshot as any).label || 'No label'}`);
      }
      console.log('');
    });
  } else {
    // Compact view
    console.log('Recent appearances:');
    functions.slice(0, 5).forEach((func, index) => {
      const date = new Date((func as any).createdAt || 0).toLocaleDateString();
      const shortId = (func as any).snapshotId?.substring(0, 8) || 'Unknown';
      console.log(`  ${index + 1}. ${date} [${shortId}] ${func.filePath}:${func.startLine}`);
    });
    
    if (functions.length > 5) {
      console.log(`  ... and ${functions.length - 5} more`);
    }
  }
}

/**
 * Output formatted snapshot history
 */
async function outputSnapshotHistoryFormatted(
  snapshots: SnapshotInfo[],
  options: HistoryCommandOptions,
  _env: CommandEnvironment
): Promise<void> {
  console.log(chalk.bold.blue('\n📅 Snapshot History\n'));
  
  if (options.verbose) {
    // Detailed view
    snapshots.forEach((snapshot, index) => {
      const date = new Date((snapshot as any).timestamp).toLocaleString();
      const commit = snapshot.gitCommit?.substring(0, 8) || 'No commit';
      const author = (snapshot as any).gitAuthor || 'Unknown';
      const branch = snapshot.gitBranch || 'Unknown';
      const processingTime = (snapshot as any).processingTime ? formatDuration((snapshot as any).processingTime) : 'Unknown';
      
      console.log(`${index + 1}. ${chalk.bold(snapshot.id.substring(0, 8))}`);
      console.log(`   📅 ${date}`);
      console.log(`   🔗 ${commit} on ${branch} by ${author}`);
      console.log(`   📊 ${(snapshot as any).totalFunctions} functions in ${(snapshot as any).totalFiles} files`);
      console.log(`   ⏱️  ${processingTime}`);
      
      if ((snapshot as any).label) {
        console.log(`   🏷️  ${(snapshot as any).label}`);
      }
      console.log('');
    });
  } else {
    // Compact view
    console.log('Recent snapshots:');
    snapshots.forEach((snapshot, index) => {
      const date = new Date((snapshot as any).timestamp).toLocaleDateString();
      const shortId = snapshot.id.substring(0, 8);
      const commit = snapshot.gitCommit?.substring(0, 8) || 'No commit';
      const label = (snapshot as any).label ? ` (${(snapshot as any).label})` : '';
      
      console.log(`  ${index + 1}. ${date} [${shortId}] ${commit} - ${(snapshot as any).totalFunctions} functions${label}`);
    });
  }
  
  console.log('');
  console.log(chalk.gray('💡 Use --verbose for detailed information'));
  console.log(chalk.gray('💡 Use --id <function-id> to track a specific function'));
}
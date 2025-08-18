import chalk from 'chalk';
import ora from 'ora';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { performCallGraphAnalysis } from './scan';
import { createErrorHandler, ErrorCode } from '../../utils/error-handler';
import { AnalysisLevel } from '../../types';

export interface AnalyzeCommandOptions {
  callGraph?: boolean;
  types?: boolean;
  coupling?: boolean;
  all?: boolean;
  json?: boolean;
  verbose?: boolean;
  quiet?: boolean;
}

/**
 * Analyze command: Perform deferred analyses on existing snapshots
 */
export const analyzeCommand: VoidCommand<AnalyzeCommandOptions> = (options) =>
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    const spinner = ora();
    
    try {
      // Get latest snapshot
      const latest = await env.storage.getSnapshots({ sort: 'created_at desc', limit: 1 });
      const snapshot = latest[0] ?? null;
      if (!snapshot) {
        if (options.json) {
          console.log(JSON.stringify({
            success: false,
            error: 'No snapshots found. Run `funcqc scan` first.'
          }, null, 2));
        } else {
          console.log(chalk.red('❌ No snapshots found. Run `funcqc scan` first.'));
        }
        return;
      }
      
      const startTime = performance.now();
      const analysesToRun: string[] = [];
      
      // Determine which analyses to run
      if (options.all) {
        analysesToRun.push('CALL_GRAPH', 'TYPE_SYSTEM');
      } else {
        if (options.callGraph) analysesToRun.push('CALL_GRAPH');
        if (options.types) analysesToRun.push('TYPE_SYSTEM');
      }
      
      if (analysesToRun.length === 0) {
        if (!options.json) {
          console.log(chalk.yellow('⚠️  No analysis specified. Use --call-graph, --types, or --all'));
          console.log();
          console.log('Available analyses:');
          console.log('  --call-graph  Analyze function dependencies');
          console.log('  --types       Analyze TypeScript type system');
          console.log('  --all         Run all analyses');
        }
        return;
      }
      
      if (!options.json) {
        console.log(chalk.cyan(`🔍 Running deferred analyses on snapshot ${snapshot.id}`));
        console.log(chalk.gray(`  Label: ${snapshot.label || 'unlabeled'}`));
        console.log(chalk.gray(`  Created: ${new Date(snapshot.createdAt).toLocaleString()}`));
        console.log();
      }
      
      // Check current analysis level
      const currentLevel = snapshot.analysisLevel || 'NONE';
      if (!options.json) {
        console.log(chalk.gray(`  Current analysis level: ${currentLevel}`));
      }
      
      const resultsInfo: Record<string, unknown> = {
        snapshotId: snapshot.id,
        startLevel: currentLevel
      };
      
      // Run call graph analysis if needed
      if (analysesToRun.includes('CALL_GRAPH')) {
        const hasCallGraph = snapshot.metadata?.callGraphAnalysisCompleted || 
                           currentLevel === 'CALL_GRAPH' || 
                           currentLevel === 'COMPLETE';
        
        if (hasCallGraph) {
          if (!options.json) {
            console.log(chalk.green('✓ Call graph analysis already completed'));
          }
          resultsInfo['callGraphSkipped'] = true;
        } else {
          if (!options.json) {
            console.log(chalk.blue('📊 Performing call graph analysis...'));
          }
          
          const callGraphStartTime = performance.now();
          const result = await performCallGraphAnalysis(snapshot.id, env, spinner);
          const callGraphEndTime = performance.now();
          
          resultsInfo['callGraphEdges'] = result.callEdges.length;
          resultsInfo['internalCallEdges'] = result.internalCallEdges.length;
          resultsInfo['callGraphDuration'] = Math.round(callGraphEndTime - callGraphStartTime);
          
          if (!options.json) {
            const duration = ((callGraphEndTime - callGraphStartTime) / 1000).toFixed(1);
            console.log(chalk.green(`✓ Call graph analysis completed in ${duration}s`));
            console.log(chalk.gray(`  ${result.callEdges.length} call edges found`));
          }
        }
      }
      
      // Run type system analysis if needed
      if (analysesToRun.includes('TYPE_SYSTEM')) {
        const hasTypes = snapshot.metadata?.typeSystemAnalysisCompleted || 
                        currentLevel === 'COMPLETE';
        
        if (hasTypes) {
          if (!options.json) {
            console.log(chalk.green('✓ Type system analysis already completed'));
          }
          resultsInfo['typeSystemSkipped'] = true;
        } else {
          // TODO: Implement type system analysis
          if (!options.json) {
            console.log(chalk.yellow('⚠️  Type system analysis not yet implemented'));
          }
          resultsInfo['typeSystemStatus'] = 'not_implemented';
        }
      }
      
      // Update analysis level
      const newLevel = determineNewAnalysisLevel(currentLevel, analysesToRun);
      if (newLevel !== currentLevel) {
        // Map new levels to storage-compatible levels
        const storageLevel = mapToStorageLevel(newLevel);
        await env.storage.updateAnalysisLevel(snapshot.id, storageLevel);
        resultsInfo['endLevel'] = newLevel;
      } else {
        resultsInfo['endLevel'] = currentLevel;
      }
      
      const endTime = performance.now();
      const totalDuration = Math.round(endTime - startTime);
      resultsInfo['totalDuration'] = totalDuration;
      
      // Output results
      if (options.json) {
        console.log(JSON.stringify({
          success: true,
          ...resultsInfo
        }, null, 2));
      } else {
        console.log();
        const durationSec = (totalDuration / 1000).toFixed(1);
        console.log(chalk.green(`✓ Analysis completed in ${durationSec}s`));
        console.log(chalk.gray(`  New analysis level: ${resultsInfo['endLevel']}`));
        
        console.log();
        console.log(chalk.blue('Next steps:'));
        console.log('  • Run `funcqc health` to see quality assessment');
        console.log('  • Run `funcqc dep show <function>` to analyze dependencies');
        if (!analysesToRun.includes('TYPE_SYSTEM')) {
          console.log('  • Run `funcqc analyze --types` to analyze type system');
        }
      }
      
    } catch (error) {
      const funcqcError = errorHandler.createError(
        ErrorCode.UNKNOWN_ERROR,
        `Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
        error instanceof Error ? error : undefined
      );
      errorHandler.handleError(funcqcError);
    }
  };

/**
 * Map analysis level to storage-compatible level
 */
function mapToStorageLevel(level: AnalysisLevel): 'NONE' | 'BASIC' | 'CALL_GRAPH' {
  switch (level) {
    case 'NONE':
      return 'NONE';
    case 'BASIC':
    case 'COUPLING':
      return 'BASIC';
    case 'CALL_GRAPH':
    case 'TYPE_SYSTEM':
    case 'COMPLETE':
      return 'CALL_GRAPH';
    default:
      return 'BASIC';
  }
}

/**
 * Determine new analysis level after running analyses
 */
function determineNewAnalysisLevel(
  currentLevel: AnalysisLevel | string,
  analysesRun: string[]
): AnalysisLevel {
  // If we have BASIC and ran CALL_GRAPH
  if (analysesRun.includes('CALL_GRAPH') && analysesRun.includes('TYPE_SYSTEM')) {
    return 'COMPLETE';
  }
  
  if (analysesRun.includes('CALL_GRAPH')) {
    if (currentLevel === 'TYPE_SYSTEM' || currentLevel === 'COMPLETE') {
      return 'COMPLETE';
    }
    return 'CALL_GRAPH';
  }
  
  if (analysesRun.includes('TYPE_SYSTEM')) {
    if (currentLevel === 'CALL_GRAPH' || currentLevel === 'COMPLETE') {
      return 'COMPLETE';
    }
    return 'TYPE_SYSTEM' as AnalysisLevel;
  }
  
  return currentLevel as AnalysisLevel;
}
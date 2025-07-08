import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { ConfigManager } from '../../core/config.js';
import { PGLiteStorageAdapter } from '../../storage/pglite-adapter.js';
import { Logger } from '../../utils/cli-utils.js';
import { RefactorDetectOptions, RefactoringPattern, RefactoringOpportunity } from '../../types/index.js';
import { RefactoringAnalyzer } from '../../refactoring/refactoring-analyzer.js';
import { SessionManager } from '../../refactoring/session-manager-simple.js';
import * as prompts from '@inquirer/prompts';

/**
 * Phase 3 Week 2: funcqc refactor detect - Pattern-specific detection with session support
 */
export const refactorDetectCommand = new Command('detect')
  .description('Detect specific refactoring patterns in the codebase')
  .option('-p, --pattern <pattern>', 'Specific pattern to detect (extract-method, split-function, etc.)')
  .option('-f, --file <file>', 'Target file pattern to analyze')
  .option('--complexity-threshold <number>', 'Minimum complexity threshold', '5')
  .option('--size-threshold <number>', 'Minimum size threshold (lines)', '20')
  .option('-s, --session <id>', 'Link results to an existing session')
  .option('--create-session', 'Create a new session for detected opportunities')
  .option('-i, --interactive', 'Interactive mode for reviewing opportunities')
  .option('--limit <number>', 'Maximum number of opportunities to detect', '20')
  .option('--json', 'Output results as JSON')
  .action(async (options: RefactorDetectOptions) => {
    const logger = new Logger();
    const spinner = ora({ color: 'cyan', text: 'Initializing detection...' });
    
    try {
      spinner.start();
      
      const configManager = new ConfigManager();
      const config = await configManager.load();
      
      if (!config.storage.path) {
        throw new Error('Storage path is not configured. Please run "funcqc init" to initialize configuration.');
      }
      
      const storage = new PGLiteStorageAdapter(config.storage.path);
      await storage.init();
      
      const analyzer = new RefactoringAnalyzer(storage);
      const sessionManager = new SessionManager(storage);
      
      spinner.text = 'Detecting refactoring opportunities...';
      
      // Prepare detection options
      const analysisOptions: {
        patterns?: RefactoringPattern[];
        complexityThreshold?: number;
        sizeThreshold?: number;
        includePatterns?: string[];
      } = {};
      
      // Handle pattern selection
      let selectedPattern: RefactoringPattern | undefined;
      if (options.pattern) {
        selectedPattern = parsePattern(options.pattern);
        if (!selectedPattern) {
          spinner.fail();
          console.error(chalk.red(`Invalid pattern: ${options.pattern}`));
          console.log(chalk.yellow('Valid patterns: extract-method, split-function, reduce-parameters, extract-class, inline-function, rename-function'));
          process.exit(1);
        }
        analysisOptions.patterns = [selectedPattern];
      }
      
      // Set thresholds
      analysisOptions.complexityThreshold = parseInt(options.complexityThreshold);
      analysisOptions.sizeThreshold = parseInt(options.sizeThreshold);
      
      if (options.file) {
        analysisOptions.includePatterns = [options.file];
      }
      
      // Perform analysis
      const report = await analyzer.analyzeProject(analysisOptions);
      
      spinner.succeed('Detection complete');
      
      // Filter opportunities based on pattern and limit
      let opportunities = report.opportunities;
      if (selectedPattern) {
        opportunities = opportunities.filter(opp => opp.pattern === selectedPattern);
      }
      
      const limit = parseInt(options.limit);
      if (opportunities.length > limit) {
        opportunities = opportunities.slice(0, limit);
      }
      
      // Handle session management
      let sessionId = options.session;
      
      if (options.createSession && opportunities.length > 0) {
        spinner.start('Creating refactoring session...');
        
        const sessionName = await prompts.input({
          message: 'Session name:',
          default: `Refactor ${selectedPattern || 'multiple patterns'} - ${new Date().toLocaleDateString()}`
        });
        
        const sessionDescription = await prompts.input({
          message: 'Session description:',
          default: `Detected ${opportunities.length} refactoring opportunities`
        });
        
        const session = await sessionManager.createSession(sessionName, sessionDescription);
        sessionId = session.id;
        
        // Link opportunities to session
        const opportunityIds = opportunities.map(opp => opp.id);
        await sessionManager.linkOpportunitiesToSession(sessionId, opportunityIds);
        
        // Add functions to session
        const functionIds = [...new Set(opportunities.map(opp => opp.function_id))];
        await sessionManager.addFunctionsToSession(sessionId, functionIds);
        
        spinner.succeed(`Created session: ${session.name} (${session.id})`);
      }
      
      // Interactive mode
      if (options.interactive && opportunities.length > 0) {
        await runInteractiveDetection(opportunities, sessionManager, sessionId);
      } else {
        // Display results
        if (options.json) {
          console.log(JSON.stringify({
            pattern: selectedPattern,
            opportunitiesFound: opportunities.length,
            sessionId,
            opportunities: opportunities.map(opp => ({
              id: opp.id,
              pattern: opp.pattern,
              severity: opp.severity,
              impactScore: opp.impact_score,
              functionId: opp.function_id,
              description: opp.description,
              metadata: opp.metadata
            }))
          }, null, 2));
        } else {
          displayDetectionResults(opportunities, selectedPattern, sessionId);
        }
      }
      
      await storage.close();
      
    } catch (error) {
      spinner.fail();
      logger.error('Detection failed', error);
      process.exit(1);
    }
  });

/**
 * Interactive detection review
 */
async function runInteractiveDetection(
  opportunities: RefactoringOpportunity[],
  sessionManager: SessionManager,
  sessionId?: string
): Promise<void> {
  console.log(chalk.cyan.bold('\n🔍 Interactive Refactoring Detection\n'));
  console.log(chalk.gray(`Found ${opportunities.length} opportunities to review\n`));
  
  const selectedOpportunities: RefactoringOpportunity[] = [];
  
  for (const [index, opp] of opportunities.entries()) {
    console.log(chalk.blue.bold(`\n[${index + 1}/${opportunities.length}] ${formatPatternName(opp.pattern)}`));
    console.log(chalk.yellow(`Function: ${opp.function_id}`));
    console.log(`Severity: ${getSeverityDisplay(opp.severity)}`);
    console.log(`Impact Score: ${chalk.yellow(opp.impact_score)}`);
    console.log(`Description: ${chalk.gray(opp.description)}`);
    
    if (opp.metadata) {
      console.log('\nDetails:');
      Object.entries(opp.metadata).forEach(([key, value]) => {
        console.log(`  ${key}: ${chalk.gray(String(value))}`);
      });
    }
    
    const action = await prompts.select({
      message: 'What would you like to do?',
      choices: [
        { name: 'Select for refactoring', value: 'select' },
        { name: 'Skip this opportunity', value: 'skip' },
        { name: 'View code context', value: 'view' },
        { name: 'Stop reviewing', value: 'stop' }
      ]
    });
    
    if (action === 'select') {
      selectedOpportunities.push(opp);
      console.log(chalk.green('✓ Selected for refactoring'));
    } else if (action === 'skip') {
      console.log(chalk.gray('→ Skipped'));
    } else if (action === 'view') {
      // TODO: Implement code viewing functionality
      console.log(chalk.yellow('Code viewing not yet implemented'));
      // Re-ask for the same opportunity
      opportunities.splice(index + 1, 0, opp);
    } else if (action === 'stop') {
      break;
    }
  }
  
  // Summary
  console.log(chalk.cyan.bold('\n📊 Selection Summary\n'));
  console.log(`Selected: ${chalk.green(selectedOpportunities.length)} opportunities`);
  console.log(`Skipped: ${chalk.gray(opportunities.length - selectedOpportunities.length)} opportunities`);
  
  if (selectedOpportunities.length > 0 && !sessionId) {
    const createSession = await prompts.confirm({
      message: 'Create a refactoring session for selected opportunities?',
      default: true
    });
    
    if (createSession) {
      const sessionName = await prompts.input({
        message: 'Session name:',
        default: `Interactive Refactoring - ${new Date().toLocaleDateString()}`
      });
      
      const session = await sessionManager.createSession(
        sessionName,
        `Selected ${selectedOpportunities.length} opportunities through interactive detection`
      );
      
      // Link selected opportunities
      const opportunityIds = selectedOpportunities.map(opp => opp.id);
      await sessionManager.linkOpportunitiesToSession(session.id, opportunityIds);
      
      // Add functions
      const functionIds = [...new Set(selectedOpportunities.map(opp => opp.function_id))];
      await sessionManager.addFunctionsToSession(session.id, functionIds);
      
      console.log(chalk.green(`\n✅ Created session: ${session.name} (${session.id})`));
    }
  }
}

/**
 * Display detection results
 */
function displayDetectionResults(
  opportunities: RefactoringOpportunity[],
  pattern?: RefactoringPattern,
  sessionId?: string
): void {
  console.log(chalk.cyan.bold('\n🔍 Refactoring Detection Results\n'));
  
  if (pattern) {
    console.log(chalk.blue.bold(`Pattern: ${formatPatternName(pattern)}`));
  }
  
  console.log(`Opportunities Found: ${chalk.yellow(opportunities.length)}`);
  
  if (sessionId) {
    console.log(`Session ID: ${chalk.green(sessionId)}`);
  }
  
  if (opportunities.length === 0) {
    console.log(chalk.gray('\nNo refactoring opportunities found matching the criteria.'));
    return;
  }
  
  // Group by pattern if not filtering by specific pattern
  if (!pattern) {
    const byPattern = groupOpportunitiesByPattern(opportunities);
    console.log('\nBy Pattern:');
    Object.entries(byPattern).forEach(([p, opps]) => {
      console.log(`  ${formatPatternName(p)}: ${chalk.yellow(opps.length)}`);
    });
  }
  
  // Top opportunities
  console.log(chalk.blue.bold('\n🎯 Top Opportunities:'));
  
  opportunities.slice(0, 10).forEach((opp, index) => {
    const severityDisplay = getSeverityDisplay(opp.severity);
    const patternDisplay = pattern ? '' : `[${formatPatternName(opp.pattern)}] `;
    
    console.log(`\n${index + 1}. ${severityDisplay} ${patternDisplay}(Score: ${chalk.yellow(opp.impact_score)})`);
    console.log(`   Function: ${chalk.gray(opp.function_id)}`);
    console.log(`   ${chalk.gray(opp.description)}`);
    
    if (opp.metadata && Object.keys(opp.metadata).length > 0) {
      const firstKey = Object.keys(opp.metadata)[0];
      console.log(`   ${firstKey}: ${chalk.gray(String(opp.metadata[firstKey]))}`);
    }
  });
  
  if (opportunities.length > 10) {
    console.log(chalk.gray(`\n... and ${opportunities.length - 10} more opportunities`));
  }
  
  // Next steps
  console.log(chalk.blue.bold('\n💡 Next Steps:'));
  console.log('  • Use --interactive flag to review opportunities one by one');
  console.log('  • Use --create-session to track refactoring progress');
  if (!sessionId) {
    console.log('  • Run ' + chalk.cyan('funcqc refactor track create') + ' to start a refactoring session');
  } else {
    console.log('  • Run ' + chalk.cyan(`funcqc refactor track show ${sessionId}`) + ' to view session details');
  }
}

// Helper functions
function parsePattern(pattern: string): RefactoringPattern | undefined {
  const patternMap: Record<string, RefactoringPattern> = {
    'extract-method': RefactoringPattern.ExtractMethod,
    'split-function': RefactoringPattern.SplitFunction,
    'reduce-parameters': RefactoringPattern.ReduceParameters,
    'extract-class': RefactoringPattern.ExtractClass,
    'inline-function': RefactoringPattern.InlineFunction,
    'rename-function': RefactoringPattern.RenameFunction
  };
  
  return patternMap[pattern];
}

function formatPatternName(pattern: string): string {
  const nameMap: Record<string, string> = {
    [RefactoringPattern.ExtractMethod]: 'Extract Method',
    [RefactoringPattern.SplitFunction]: 'Split Function',
    [RefactoringPattern.ReduceParameters]: 'Reduce Parameters',
    [RefactoringPattern.ExtractClass]: 'Extract Class',
    [RefactoringPattern.InlineFunction]: 'Inline Function',
    [RefactoringPattern.RenameFunction]: 'Rename Function'
  };
  
  return nameMap[pattern] || pattern;
}

function getSeverityDisplay(severity: string): string {
  const colorMap: Record<string, (text: string) => string> = {
    critical: chalk.red,
    high: chalk.redBright,
    medium: chalk.yellow,
    low: chalk.green
  };
  
  const color = colorMap[severity] || chalk.gray;
  return color(`[${severity.toUpperCase()}]`);
}

function groupOpportunitiesByPattern(opportunities: RefactoringOpportunity[]): Record<string, RefactoringOpportunity[]> {
  const groups: Record<string, RefactoringOpportunity[]> = {};
  
  for (const opp of opportunities) {
    const pattern = opp.pattern;
    if (!groups[pattern]) {
      groups[pattern] = [];
    }
    groups[pattern].push(opp);
  }
  
  return groups;
}
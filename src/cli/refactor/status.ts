import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { ConfigManager } from '../../core/config.js';
import { PGLiteStorageAdapter } from '../../storage/pglite-adapter.js';
import { Logger } from '../../utils/cli-utils.js';
import { RefactoringAnalyzer } from '../../refactoring/refactoring-analyzer.js';
import { SessionManager } from '../../refactoring/session-manager-simple.js';
import { 
  RefactoringSession, 
  RefactoringOpportunity, 
  RefactorStatusOptions 
} from '../../types/index.js';
import { 
  formatPatternName, 
  getSeverityDisplay, 
  getRiskLevelDisplay,
  getSeverityIcon,
  groupOpportunitiesByPattern 
} from '../../utils/refactoring-utils.js';

/**
 * Phase 3 Week 3: funcqc refactor status - Project health dashboard
 */
export const refactorStatusCommand = new Command('status')
  .description('Display project refactoring status and health dashboard')
  .option('-s, --session <id>', 'Show status for specific session')
  .option('--all-sessions', 'Show status for all sessions')
  .option('--complexity-threshold <number>', 'Complexity threshold for analysis', '5')
  .option('--size-threshold <number>', 'Size threshold for analysis', '20')
  .option('--json', 'Output as JSON')
  .option('--detailed', 'Show detailed information')
  .action(async (options: RefactorStatusOptions) => {
    const logger = new Logger();
    const spinner = ora({ color: 'cyan', text: 'Loading project status...' });
    
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
      
      spinner.text = 'Analyzing project health...';
      
      const statusData = await collectStatusData(analyzer, sessionManager, options);
      
      spinner.succeed('Status analysis complete');
      
      if (options.json) {
        console.log(JSON.stringify(statusData, null, 2));
      } else {
        await displayStatusDashboard(statusData, options);
      }
      
      await storage.close();
      
    } catch (error) {
      spinner.fail();
      logger.error('Status analysis failed', error);
      process.exit(1);
    }
  });

interface StatusData {
  projectHealth: {
    totalFunctions: number;
    analyzedFunctions: number;
    opportunitiesFound: number;
    riskLevel: string;
    priorityAreas: string[];
    qualityScore: number;
  };
  opportunities: RefactoringOpportunity[];
  sessions: RefactoringSession[];
  patterns: Record<string, {
    count: number;
    avgImpact: number;
    severity: Record<string, number>;
  }>;
  trends: {
    recentSessions: number;
    completedRefactorings: number;
    activeRefactorings: number;
  };
}

/**
 * Collect comprehensive status data
 */
async function collectStatusData(
  analyzer: RefactoringAnalyzer,
  sessionManager: SessionManager,
  options: RefactorStatusOptions
): Promise<StatusData> {
  const analysisOptions = {
    complexityThreshold: parseInt(options.complexityThreshold || '5'),
    sizeThreshold: parseInt(options.sizeThreshold || '20')
  };
  
  // Analyze current project state
  const report = await analyzer.analyzeProject(analysisOptions);
  
  // Get session data
  const sessions = await sessionManager.listSessions();
  
  // Calculate quality score (0-100)
  const qualityScore = calculateQualityScore(report.projectSummary, report.opportunities);
  
  // Analyze patterns
  const patterns = analyzePatterns(report.opportunities);
  
  // Calculate trends
  const trends = calculateTrends(sessions);
  
  return {
    projectHealth: {
      totalFunctions: report.projectSummary.totalFunctions,
      analyzedFunctions: report.projectSummary.analyzedFunctions,
      opportunitiesFound: report.opportunities.length,
      riskLevel: report.projectSummary.riskLevel,
      priorityAreas: report.projectSummary.priorityAreas,
      qualityScore
    },
    opportunities: report.opportunities,
    sessions,
    patterns,
    trends
  };
}

/**
 * Calculate overall quality score
 */
function calculateQualityScore(
  projectSummary: { totalFunctions: number; analyzedFunctions: number },
  opportunities: RefactoringOpportunity[]
): number {
  if (projectSummary.totalFunctions === 0) return 100;
  
  const severityWeight = opportunities.reduce((sum, opp) => {
    const weights = { critical: 4, high: 3, medium: 2, low: 1 };
    return sum + (weights[opp.severity as keyof typeof weights] || 1);
  }, 0);
  
  const maxPossibleWeight = projectSummary.totalFunctions * 4;
  const qualityScore = Math.max(0, 100 - (severityWeight / maxPossibleWeight) * 100);
  
  return Math.round(qualityScore);
}

/**
 * Analyze patterns distribution
 */
function analyzePatterns(opportunities: RefactoringOpportunity[]): Record<string, {
  count: number;
  avgImpact: number;
  severity: Record<string, number>;
}> {
  const patterns: Record<string, {
    count: number;
    avgImpact: number;
    severity: Record<string, number>;
  }> = {};
  
  const grouped = groupOpportunitiesByPattern(opportunities);
  
  Object.entries(grouped).forEach(([pattern, patternOpps]) => {
    const avgImpact = patternOpps.reduce((sum, opp) => sum + opp.impact_score, 0) / patternOpps.length;
    const severity: Record<string, number> = {};
    
    patternOpps.forEach(opp => {
      severity[opp.severity] = (severity[opp.severity] || 0) + 1;
    });
    
    patterns[pattern] = {
      count: patternOpps.length,
      avgImpact: Math.round(avgImpact * 10) / 10,
      severity
    };
  });
  
  return patterns;
}

/**
 * Calculate trends from sessions
 */
function calculateTrends(sessions: RefactoringSession[]): {
  recentSessions: number;
  completedRefactorings: number;
  activeRefactorings: number;
} {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  
  const recentSessions = sessions.filter(s => 
    new Date(s.created_at) > oneWeekAgo
  ).length;
  
  const completedRefactorings = sessions.filter(s => 
    s.status === 'completed'
  ).length;
  
  const activeRefactorings = sessions.filter(s => 
    s.status === 'active'
  ).length;
  
  return {
    recentSessions,
    completedRefactorings,
    activeRefactorings
  };
}

/**
 * Display comprehensive status dashboard
 */
async function displayStatusDashboard(
  statusData: StatusData,
  options: RefactorStatusOptions
): Promise<void> {
  displayHeader();
  displayProjectHealth(statusData.projectHealth);
  displayOpportunitiesOverview(statusData.opportunities, statusData.patterns);
  displaySessionsOverview(statusData.sessions, statusData.trends);
  
  if (options.detailed) {
    displayDetailedBreakdown(statusData);
  }
  
  displayRecommendations(statusData);
}

/**
 * Display header
 */
function displayHeader(): void {
  console.log(chalk.cyan.bold('\n📊 Project Refactoring Status Dashboard\n'));
  console.log(chalk.gray(`Generated: ${new Date().toLocaleString()}\n`));
}

/**
 * Display project health metrics
 */
function displayProjectHealth(health: StatusData['projectHealth']): void {
  console.log(chalk.blue.bold('🏥 Project Health'));
  console.log(chalk.blue('─'.repeat(50)));
  
  // Quality score with color coding
  const qualityColor = health.qualityScore >= 80 ? chalk.green : 
                      health.qualityScore >= 60 ? chalk.yellow : chalk.red;
  
  console.log(`Quality Score: ${qualityColor.bold(health.qualityScore + '/100')}`);
  console.log(`Risk Level: ${getRiskLevelDisplay(health.riskLevel)}`);
  console.log(`Total Functions: ${chalk.yellow(health.totalFunctions)}`);
  console.log(`Analyzed Functions: ${chalk.yellow(health.analyzedFunctions)}`);
  console.log(`Opportunities Found: ${chalk.yellow(health.opportunitiesFound)}`);
  
  if (health.priorityAreas.length > 0) {
    console.log(`\nPriority Areas:`);
    health.priorityAreas.slice(0, 3).forEach(area => {
      console.log(`  • ${chalk.gray(area)}`);
    });
  }
}

/**
 * Display opportunities overview
 */
function displayOpportunitiesOverview(
  opportunities: RefactoringOpportunity[],
  patterns: StatusData['patterns']
): void {
  console.log(chalk.blue.bold('\n🎯 Refactoring Opportunities'));
  console.log(chalk.blue('─'.repeat(50)));
  
  if (opportunities.length === 0) {
    console.log(chalk.green('✅ No refactoring opportunities found. Great job!'));
    return;
  }
  
  // Severity distribution
  const severityCount = opportunities.reduce((acc, opp) => {
    acc[opp.severity] = (acc[opp.severity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log('Severity Distribution:');
  ['critical', 'high', 'medium', 'low'].forEach(severity => {
    const count = severityCount[severity] || 0;
    if (count > 0) {
      console.log(`  ${getSeverityIcon(severity)} ${severity.toUpperCase()}: ${chalk.yellow(count)}`);
    }
  });
  
  // Pattern breakdown
  console.log('\nPattern Breakdown:');
  Object.entries(patterns).forEach(([pattern, data]) => {
    console.log(`  ${formatPatternName(pattern)}: ${chalk.yellow(data.count)} (avg impact: ${chalk.cyan(data.avgImpact)})`);
  });
  
  // Top opportunities
  console.log('\nTop Opportunities:');
  opportunities
    .sort((a, b) => b.impact_score - a.impact_score)
    .slice(0, 5)
    .forEach((opp, index) => {
      console.log(`  ${index + 1}. ${getSeverityDisplay(opp.severity)} ${formatPatternName(opp.pattern)} (${chalk.yellow(opp.impact_score)})`);
      console.log(`     ${chalk.gray(opp.function_id)}`);
    });
}

/**
 * Display sessions overview
 */
function displaySessionsOverview(
  sessions: RefactoringSession[],
  trends: StatusData['trends']
): void {
  console.log(chalk.blue.bold('\n📂 Refactoring Sessions'));
  console.log(chalk.blue('─'.repeat(50)));
  
  if (sessions.length === 0) {
    console.log(chalk.gray('No refactoring sessions found.'));
    return;
  }
  
  // Session statistics
  console.log(`Total Sessions: ${chalk.yellow(sessions.length)}`);
  console.log(`Active Sessions: ${chalk.yellow(trends.activeRefactorings)}`);
  console.log(`Completed Sessions: ${chalk.green(trends.completedRefactorings)}`);
  console.log(`Recent Sessions (7 days): ${chalk.cyan(trends.recentSessions)}`);
  
  // Session status distribution
  const statusCount = sessions.reduce((acc, session) => {
    acc[session.status] = (acc[session.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log('\nSession Status:');
  Object.entries(statusCount).forEach(([status, count]) => {
    const statusColor = status === 'completed' ? chalk.green : 
                       status === 'active' ? chalk.yellow : chalk.gray;
    console.log(`  ${statusColor(status.toUpperCase())}: ${chalk.yellow(count)}`);
  });
  
  // Recent sessions
  const recentSessions = sessions
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);
  
  if (recentSessions.length > 0) {
    console.log('\nRecent Sessions:');
    recentSessions.forEach(session => {
      const statusColor = session.status === 'completed' ? chalk.green : 
                         session.status === 'active' ? chalk.yellow : chalk.gray;
      const dateStr = new Date(session.created_at).toLocaleDateString();
      console.log(`  • ${session.name} ${statusColor(`[${session.status}]`)} - ${chalk.gray(dateStr)}`);
    });
  }
}

/**
 * Display detailed breakdown
 */
function displayDetailedBreakdown(statusData: StatusData): void {
  console.log(chalk.blue.bold('\n🔍 Detailed Analysis'));
  console.log(chalk.blue('─'.repeat(50)));
  
  // Function quality distribution
  const { projectHealth, opportunities } = statusData;
  
  if (projectHealth.totalFunctions > 0) {
    const healthyFunctions = projectHealth.totalFunctions - opportunities.length;
    const healthyPercentage = Math.round((healthyFunctions / projectHealth.totalFunctions) * 100);
    
    console.log('Function Quality Distribution:');
    console.log(`  ${chalk.green('Healthy Functions')}: ${chalk.yellow(healthyFunctions)} (${healthyPercentage}%)`);
    console.log(`  ${chalk.red('Functions with Issues')}: ${chalk.yellow(opportunities.length)} (${100 - healthyPercentage}%)`);
  }
  
  // Pattern-specific analysis
  console.log('\nPattern-Specific Analysis:');
  Object.entries(statusData.patterns).forEach(([pattern, data]) => {
    console.log(`\n  ${formatPatternName(pattern)}:`);
    console.log(`    Count: ${chalk.yellow(data.count)}`);
    console.log(`    Average Impact: ${chalk.cyan(data.avgImpact)}`);
    console.log(`    Severity Breakdown:`);
    Object.entries(data.severity).forEach(([severity, count]) => {
      console.log(`      ${getSeverityIcon(severity)} ${severity}: ${chalk.yellow(count)}`);
    });
  });
}

/**
 * Display recommendations
 */
function displayRecommendations(statusData: StatusData): void {
  console.log(chalk.blue.bold('\n💡 Recommendations'));
  console.log(chalk.blue('─'.repeat(50)));
  
  const { projectHealth, opportunities, trends } = statusData;
  
  if (projectHealth.qualityScore >= 80) {
    console.log(chalk.green('✅ Your project has excellent code quality!'));
    console.log('   • Continue maintaining high standards');
    console.log('   • Consider peer code reviews');
    console.log('   • Document refactoring guidelines');
  } else if (projectHealth.qualityScore >= 60) {
    console.log(chalk.yellow('⚠️  Your project has moderate refactoring needs:'));
    console.log('   • Focus on high-severity opportunities first');
    console.log('   • Create refactoring sessions for systematic improvement');
    console.log('   • Consider automated refactoring tools');
  } else {
    console.log(chalk.red('🚨 Your project needs significant refactoring:'));
    console.log('   • Prioritize critical and high-severity issues');
    console.log('   • Break down refactoring into manageable sessions');
    console.log('   • Consider refactoring sprints or dedicated time');
  }
  
  // Actionable next steps
  console.log(chalk.blue.bold('\n🚀 Next Steps:'));
  
  if (opportunities.length > 0) {
    console.log(`   • Run ${chalk.cyan('funcqc refactor interactive')} to start guided refactoring`);
    console.log(`   • Use ${chalk.cyan('funcqc refactor detect')} to focus on specific patterns`);
    console.log(`   • Create sessions with ${chalk.cyan('funcqc refactor track create')}`);
  }
  
  if (trends.activeRefactorings > 0) {
    console.log(`   • Continue working on ${trends.activeRefactorings} active sessions`);
    console.log(`   • Use ${chalk.cyan('funcqc refactor track list')} to see session details`);
  }
  
  if (opportunities.length === 0) {
    console.log(`   • Monitor code quality with regular ${chalk.cyan('funcqc refactor status')} checks`);
    console.log(`   • Set up automated quality gates in CI/CD`);
    console.log(`   • Share refactoring best practices with team`);
  }
  
  console.log(chalk.gray('\nFor more detailed analysis, use --detailed flag\n'));
}
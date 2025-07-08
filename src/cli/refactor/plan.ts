import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
// import * as prompts from '@inquirer/prompts'; // Removed - not currently used
import { ConfigManager } from '../../core/config.js';
import { PGLiteStorageAdapter } from '../../storage/pglite-adapter.js';
import { Logger } from '../../utils/cli-utils.js';
import { RefactoringAnalyzer } from '../../refactoring/refactoring-analyzer.js';
import { SessionManager } from '../../refactoring/session-manager-simple.js';
import { 
  RefactoringOpportunity, 
  RefactoringPattern,
  RefactorPlanOptions
} from '../../types/index.js';
import { 
  formatPatternName, 
  getSeverityIcon,
  getPriorityDisplay,
  groupOpportunitiesByPattern,
  parsePattern 
} from '../../utils/refactoring-utils.js';

/**
 * Phase 3 Week 3: funcqc refactor plan - AI-generated refactoring plans
 */
export const refactorPlanCommand = new Command('plan')
  .description('Generate comprehensive refactoring plan for project improvement')
  .option('-s, --session <id>', 'Generate plan for specific session')
  .option('-p, --pattern <pattern>', 'Focus plan on specific pattern')
  .option('--complexity-threshold <number>', 'Complexity threshold for analysis', '5')
  .option('--size-threshold <number>', 'Size threshold for analysis', '20')
  .option('--output <file>', 'Save plan to file')
  .option('--format <format>', 'Output format (markdown, json)', 'markdown')
  .option('--timeline <weeks>', 'Target timeline in weeks', '4')
  .option('--effort <hours>', 'Available effort per week in hours', '8')
  .action(async (options: RefactorPlanOptions) => {
    const logger = new Logger();
    const spinner = ora({ color: 'cyan', text: 'Generating refactoring plan...' });
    
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
      
      spinner.text = 'Analyzing project and generating plan...';
      
      const plan = await generateRefactoringPlan(analyzer, sessionManager, options);
      
      spinner.succeed('Refactoring plan generated');
      
      if (options.output) {
        await savePlanToFile(plan, options.output, options.format || 'markdown');
        console.log(chalk.green(`📄 Plan saved to: ${options.output}`));
      }
      
      if (options.format === 'json') {
        console.log(JSON.stringify(plan, null, 2));
      } else {
        displayRefactoringPlan(plan);
      }
      
      await storage.close();
      
    } catch (error) {
      spinner.fail();
      logger.error('Plan generation failed', error);
      process.exit(1);
    }
  });

interface RefactoringPlan {
  metadata: {
    generated: string;
    timeline: number;
    effortPerWeek: number;
    totalEffort: number;
    sessionId?: string;
    pattern?: string;
  };
  summary: {
    totalOpportunities: number;
    priorityDistribution: Record<string, number>;
    estimatedImpact: string;
    riskLevel: string;
  };
  phases: RefactoringPhase[];
  recommendations: string[];
  risks: string[];
  successMetrics: string[];
}

interface RefactoringPhase {
  phase: number;
  title: string;
  description: string;
  duration: string;
  effort: number;
  opportunities: RefactoringOpportunity[];
  deliverables: string[];
  dependencies: string[];
  risks: string[];
  successCriteria: string[];
}

/**
 * Generate comprehensive refactoring plan
 */
async function generateRefactoringPlan(
  analyzer: RefactoringAnalyzer,
  sessionManager: SessionManager,
  options: RefactorPlanOptions
): Promise<RefactoringPlan> {
  const analysisOptions: {
    complexityThreshold?: number;
    sizeThreshold?: number;
    patterns?: RefactoringPattern[];
  } = {
    complexityThreshold: parseInt(options.complexityThreshold || '5'),
    sizeThreshold: parseInt(options.sizeThreshold || '20')
  };
  
  if (options.pattern) {
    const pattern = parsePattern(options.pattern);
    if (pattern) {
      analysisOptions.patterns = [pattern];
    }
  }
  
  let opportunities: RefactoringOpportunity[] = [];
  let sessionId: string | undefined;
  
  // Get opportunities from session or fresh analysis
  if (options.session) {
    const sessions = await sessionManager.listSessions();
    const session = sessions.find((s: { id: string }) => s.id === options.session);
    if (session) {
      opportunities = await sessionManager.getSessionOpportunities(session.id);
      sessionId = session.id;
    }
  }
  
  if (opportunities.length === 0) {
    const report = await analyzer.analyzeProject(analysisOptions);
    opportunities = report.opportunities;
  }
  
  const timeline = parseInt(options.timeline || '4');
  const effortPerWeek = parseInt(options.effort || '8');
  
  const metadata: RefactoringPlan['metadata'] = {
    generated: new Date().toISOString(),
    timeline,
    effortPerWeek,
    totalEffort: timeline * effortPerWeek
  };
  
  if (sessionId) {
    metadata.sessionId = sessionId;
  }
  
  if (options.pattern) {
    metadata.pattern = options.pattern;
  }
  
  return {
    metadata,
    summary: generateSummary(opportunities),
    phases: generatePhases(opportunities, timeline, effortPerWeek),
    recommendations: generateRecommendations(opportunities),
    risks: generateRisks(opportunities),
    successMetrics: generateSuccessMetrics(opportunities)
  };
}

/**
 * Generate plan summary
 */
function generateSummary(opportunities: RefactoringOpportunity[]): RefactoringPlan['summary'] {
  const priorityDistribution = opportunities.reduce((acc, opp) => {
    const priority = determinePriority(opp);
    acc[priority] = (acc[priority] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const highSeverityCount = opportunities.filter(opp => 
    opp.severity === 'high' || opp.severity === 'critical'
  ).length;
  
  const estimatedImpact = highSeverityCount > 10 ? 'High' : 
                         highSeverityCount > 5 ? 'Medium' : 'Low';
  
  const riskLevel = opportunities.length > 20 ? 'High' : 
                   opportunities.length > 10 ? 'Medium' : 'Low';
  
  return {
    totalOpportunities: opportunities.length,
    priorityDistribution,
    estimatedImpact,
    riskLevel
  };
}

/**
 * Generate refactoring phases
 */
function generatePhases(
  opportunities: RefactoringOpportunity[],
  timeline: number,
  effortPerWeek: number
): RefactoringPhase[] {
  // Sort opportunities by priority and impact
  const sortedOpportunities = opportunities.sort((a, b) => {
    const priorityA = getPriorityScore(determinePriority(a));
    const priorityB = getPriorityScore(determinePriority(b));
    
    if (priorityA !== priorityB) {
      return priorityB - priorityA; // Higher priority first
    }
    
    return b.impact_score - a.impact_score; // Higher impact first
  });
  
  const phases: RefactoringPhase[] = [];
  const opportunitiesPerPhase = Math.ceil(sortedOpportunities.length / timeline);
  
  for (let i = 0; i < timeline; i++) {
    const phaseOpportunities = sortedOpportunities.slice(
      i * opportunitiesPerPhase,
      (i + 1) * opportunitiesPerPhase
    );
    
    if (phaseOpportunities.length === 0) break;
    
    phases.push(generatePhase(i + 1, phaseOpportunities, effortPerWeek));
  }
  
  return phases;
}

/**
 * Generate individual phase
 */
function generatePhase(
  phaseNumber: number,
  opportunities: RefactoringOpportunity[],
  effortPerWeek: number
): RefactoringPhase {
  const patterns = [...new Set(opportunities.map(opp => opp.pattern))];
  const mainPattern = patterns[0];
  
  const phaseConfig = {
    1: {
      title: 'Critical Issues & Foundation',
      description: 'Address critical refactoring opportunities and establish foundation for future improvements',
      focus: 'critical and high-severity issues'
    },
    2: {
      title: 'Core Refactoring',
      description: 'Implement major structural improvements and reduce technical debt',
      focus: 'medium-severity issues and structural improvements'
    },
    3: {
      title: 'Optimization & Enhancement',
      description: 'Fine-tune implementation and optimize for performance and maintainability',
      focus: 'optimization and enhancement opportunities'
    },
    4: {
      title: 'Polish & Consolidation',
      description: 'Final polish, consolidation, and preparation for next iteration',
      focus: 'remaining issues and consolidation'
    }
  };
  
  const config = phaseConfig[phaseNumber as keyof typeof phaseConfig] || phaseConfig[4];
  
  return {
    phase: phaseNumber,
    title: config.title,
    description: config.description,
    duration: '1 week',
    effort: effortPerWeek,
    opportunities,
    deliverables: generateDeliverables(opportunities, mainPattern),
    dependencies: generateDependencies(phaseNumber, patterns),
    risks: generatePhaseRisks(opportunities),
    successCriteria: generateSuccessCriteria(opportunities)
  };
}

/**
 * Generate deliverables for phase
 */
function generateDeliverables(
  opportunities: RefactoringOpportunity[],
  mainPattern: RefactoringPattern
): string[] {
  const deliverables: string[] = [];
  
  const patternDeliverables: Record<RefactoringPattern, string[]> = {
    [RefactoringPattern.ExtractMethod]: [
      'Extracted methods with clear responsibilities',
      'Reduced function complexity metrics',
      'Improved test coverage for extracted methods'
    ],
    [RefactoringPattern.SplitFunction]: [
      'Split functions with single responsibilities',
      'Improved function readability and maintainability',
      'Updated function documentation'
    ],
    [RefactoringPattern.ReduceParameters]: [
      'Simplified function signatures',
      'Parameter objects or configuration structures',
      'Improved function usability'
    ],
    [RefactoringPattern.ExtractClass]: [
      'New classes with cohesive responsibilities',
      'Improved code organization',
      'Better encapsulation and reusability'
    ],
    [RefactoringPattern.InlineFunction]: [
      'Simplified function hierarchies',
      'Reduced unnecessary abstraction',
      'Improved performance metrics'
    ],
    [RefactoringPattern.RenameFunction]: [
      'Clear and descriptive function names',
      'Updated documentation and comments',
      'Improved code readability'
    ]
  };
  
  deliverables.push(...(patternDeliverables[mainPattern] || [
    'Refactored functions with improved quality',
    'Reduced technical debt metrics',
    'Enhanced code maintainability'
  ]));
  
  deliverables.push(
    `${opportunities.length} refactoring opportunities addressed`,
    'Updated unit tests for modified functions',
    'Code quality metrics improvement',
    'Documentation updates'
  );
  
  return deliverables;
}

/**
 * Generate dependencies for phase
 */
function generateDependencies(phaseNumber: number, patterns: RefactoringPattern[]): string[] {
  const dependencies: string[] = [];
  
  if (phaseNumber === 1) {
    dependencies.push(
      'Project setup and tooling configuration',
      'Backup of current codebase',
      'Test suite validation'
    );
  } else {
    dependencies.push(
      `Completion of Phase ${phaseNumber - 1}`,
      'Previous phase quality validation',
      'Updated test coverage'
    );
  }
  
  if (patterns.includes(RefactoringPattern.ExtractClass)) {
    dependencies.push('Class design review and approval');
  }
  
  if (patterns.includes(RefactoringPattern.ExtractMethod)) {
    dependencies.push('Method naming conventions established');
  }
  
  return dependencies;
}

/**
 * Generate phase-specific risks
 */
function generatePhaseRisks(opportunities: RefactoringOpportunity[]): string[] {
  const risks: string[] = [];
  
  if (opportunities.length > 10) {
    risks.push('High volume of changes may introduce bugs');
  }
  
  const hasHighSeverity = opportunities.some(opp => 
    opp.severity === 'high' || opp.severity === 'critical'
  );
  
  if (hasHighSeverity) {
    risks.push('Complex refactoring may require additional time');
  }
  
  risks.push(
    'Potential integration issues with existing code',
    'Time constraints may limit thorough testing',
    'Team coordination challenges'
  );
  
  return risks;
}

/**
 * Generate success criteria for phase
 */
function generateSuccessCriteria(_opportunities: RefactoringOpportunity[]): string[] {
  return [
    'All phase opportunities successfully addressed',
    'No new high-severity issues introduced',
    'Test suite passes with improved coverage',
    'Code quality metrics show improvement',
    'Documentation updated and validated',
    'Team review and approval completed'
  ];
}

/**
 * Generate overall recommendations
 */
function generateRecommendations(opportunities: RefactoringOpportunity[]): string[] {
  const recommendations: string[] = [];
  
  // Pattern-specific recommendations
  const byPattern = groupOpportunitiesByPattern(opportunities);
  Object.entries(byPattern).forEach(([pattern, patternOpps]) => {
    if (patternOpps.length > 5) {
      recommendations.push(
        `Consider systematic approach to ${formatPatternName(pattern)} refactoring`
      );
    }
  });
  
  // General recommendations
  recommendations.push(
    'Implement refactoring in small, testable increments',
    'Maintain comprehensive test coverage throughout process',
    'Use automated tools where possible to reduce manual effort',
    'Regular code reviews to ensure quality standards',
    'Document refactoring decisions and rationale',
    'Monitor metrics to track improvement progress'
  );
  
  if (opportunities.length > 20) {
    recommendations.push(
      'Consider splitting refactoring into multiple iterations',
      'Prioritize high-impact, low-risk refactoring first'
    );
  }
  
  return recommendations;
}

/**
 * Generate risks
 */
function generateRisks(opportunities: RefactoringOpportunity[]): string[] {
  const risks: string[] = [
    'Refactoring may introduce new bugs if not carefully tested',
    'Large-scale changes may disrupt ongoing development',
    'Team productivity may decrease during refactoring period',
    'External dependencies may complicate refactoring efforts'
  ];
  
  if (opportunities.length > 30) {
    risks.push('High volume of changes increases project complexity');
  }
  
  const hasHighSeverity = opportunities.some(opp => 
    opp.severity === 'high' || opp.severity === 'critical'
  );
  
  if (hasHighSeverity) {
    risks.push('Complex refactoring may require specialized expertise');
  }
  
  return risks;
}

/**
 * Generate success metrics
 */
function generateSuccessMetrics(_opportunities: RefactoringOpportunity[]): string[] {
  return [
    'Reduction in cyclomatic complexity by 30%',
    'Decrease in function length by 25%',
    'Improvement in maintainability index',
    'Zero introduction of new high-severity issues',
    'Test coverage maintained or improved',
    'Code review approval rate above 95%',
    'Team satisfaction with refactored code',
    'Performance metrics remain stable or improve'
  ];
}

/**
 * Determine priority level for opportunity
 */
function determinePriority(opp: RefactoringOpportunity): string {
  if (opp.severity === 'critical') return 'critical';
  if (opp.severity === 'high') return 'high';
  if (opp.impact_score > 8) return 'high';
  if (opp.impact_score > 5) return 'medium';
  return 'low';
}

/**
 * Get priority score for sorting
 */
function getPriorityScore(priority: string): number {
  const scores = { critical: 4, high: 3, medium: 2, low: 1 };
  return scores[priority as keyof typeof scores] || 1;
}

/**
 * Save plan to file
 */
async function savePlanToFile(
  plan: RefactoringPlan,
  outputPath: string,
  format: string
): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');
  
  const dir = path.dirname(outputPath);
  await fs.promises.mkdir(dir, { recursive: true });
  
  let content: string;
  
  if (format === 'json') {
    content = JSON.stringify(plan, null, 2);
  } else {
    content = generateMarkdownPlan(plan);
  }
  
  await fs.promises.writeFile(outputPath, content, 'utf8');
}

/**
 * Generate markdown plan
 */
function generateMarkdownPlan(plan: RefactoringPlan): string {
  const lines: string[] = [];
  
  lines.push('# Refactoring Plan');
  lines.push('');
  lines.push(`Generated: ${new Date(plan.metadata.generated).toLocaleString()}`);
  lines.push(`Timeline: ${plan.metadata.timeline} weeks`);
  lines.push(`Effort: ${plan.metadata.effortPerWeek} hours/week`);
  lines.push('');
  
  // Summary
  lines.push('## 📊 Summary');
  lines.push('');
  lines.push(`- **Total Opportunities**: ${plan.summary.totalOpportunities}`);
  lines.push(`- **Estimated Impact**: ${plan.summary.estimatedImpact}`);
  lines.push(`- **Risk Level**: ${plan.summary.riskLevel}`);
  lines.push('');
  
  if (Object.keys(plan.summary.priorityDistribution).length > 0) {
    lines.push('**Priority Distribution**:');
    Object.entries(plan.summary.priorityDistribution).forEach(([priority, count]) => {
      lines.push(`- ${priority}: ${count}`);
    });
    lines.push('');
  }
  
  // Phases
  lines.push('## 🗓️ Refactoring Phases');
  lines.push('');
  
  plan.phases.forEach(phase => {
    lines.push(`### Phase ${phase.phase}: ${phase.title}`);
    lines.push('');
    lines.push(`**Duration**: ${phase.duration} | **Effort**: ${phase.effort} hours`);
    lines.push('');
    lines.push(`**Description**: ${phase.description}`);
    lines.push('');
    
    if (phase.opportunities.length > 0) {
      lines.push('**Opportunities**:');
      phase.opportunities.forEach(opp => {
        lines.push(`- ${getSeverityIcon(opp.severity)} ${formatPatternName(opp.pattern)} (${opp.function_id})`);
      });
      lines.push('');
    }
    
    if (phase.deliverables.length > 0) {
      lines.push('**Deliverables**:');
      phase.deliverables.forEach(deliverable => {
        lines.push(`- ${deliverable}`);
      });
      lines.push('');
    }
    
    if (phase.dependencies.length > 0) {
      lines.push('**Dependencies**:');
      phase.dependencies.forEach(dependency => {
        lines.push(`- ${dependency}`);
      });
      lines.push('');
    }
    
    if (phase.risks.length > 0) {
      lines.push('**Risks**:');
      phase.risks.forEach(risk => {
        lines.push(`- ${risk}`);
      });
      lines.push('');
    }
    
    if (phase.successCriteria.length > 0) {
      lines.push('**Success Criteria**:');
      phase.successCriteria.forEach(criteria => {
        lines.push(`- ${criteria}`);
      });
      lines.push('');
    }
  });
  
  // Recommendations
  if (plan.recommendations.length > 0) {
    lines.push('## 💡 Recommendations');
    lines.push('');
    plan.recommendations.forEach(rec => {
      lines.push(`- ${rec}`);
    });
    lines.push('');
  }
  
  // Risks
  if (plan.risks.length > 0) {
    lines.push('## ⚠️ Risks');
    lines.push('');
    plan.risks.forEach(risk => {
      lines.push(`- ${risk}`);
    });
    lines.push('');
  }
  
  // Success metrics
  if (plan.successMetrics.length > 0) {
    lines.push('## 📈 Success Metrics');
    lines.push('');
    plan.successMetrics.forEach(metric => {
      lines.push(`- ${metric}`);
    });
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Display refactoring plan
 */
function displayRefactoringPlan(plan: RefactoringPlan): void {
  console.log(chalk.cyan.bold('\n📋 Refactoring Plan\n'));
  
  // Metadata
  console.log(chalk.blue.bold('📊 Plan Overview'));
  console.log(`Generated: ${chalk.gray(new Date(plan.metadata.generated).toLocaleString())}`);
  console.log(`Timeline: ${chalk.yellow(plan.metadata.timeline)} weeks`);
  console.log(`Effort: ${chalk.yellow(plan.metadata.effortPerWeek)} hours/week`);
  console.log(`Total Effort: ${chalk.yellow(plan.metadata.totalEffort)} hours`);
  
  if (plan.metadata.sessionId) {
    console.log(`Session: ${chalk.cyan(plan.metadata.sessionId)}`);
  }
  
  // Summary
  console.log(chalk.blue.bold('\n📊 Summary'));
  console.log(`Total Opportunities: ${chalk.yellow(plan.summary.totalOpportunities)}`);
  console.log(`Estimated Impact: ${chalk.yellow(plan.summary.estimatedImpact)}`);
  console.log(`Risk Level: ${chalk.yellow(plan.summary.riskLevel)}`);
  
  if (Object.keys(plan.summary.priorityDistribution).length > 0) {
    console.log('\nPriority Distribution:');
    Object.entries(plan.summary.priorityDistribution).forEach(([priority, count]) => {
      console.log(`  ${getPriorityDisplay(priority)} ${priority}: ${chalk.yellow(count)}`);
    });
  }
  
  // Phases
  console.log(chalk.blue.bold('\n🗓️ Refactoring Phases'));
  plan.phases.forEach(phase => {
    console.log(`\n${chalk.cyan.bold(`Phase ${phase.phase}: ${phase.title}`)}`);
    console.log(`Duration: ${chalk.yellow(phase.duration)} | Effort: ${chalk.yellow(phase.effort)} hours`);
    console.log(`Description: ${chalk.gray(phase.description)}`);
    
    if (phase.opportunities.length > 0) {
      console.log(`Opportunities: ${chalk.yellow(phase.opportunities.length)}`);
      phase.opportunities.slice(0, 3).forEach(opp => {
        console.log(`  ${getSeverityIcon(opp.severity)} ${formatPatternName(opp.pattern)} (${chalk.gray(opp.function_id)})`);
      });
      if (phase.opportunities.length > 3) {
        console.log(`  ${chalk.gray(`... and ${phase.opportunities.length - 3} more`)}`);
      }
    }
    
    if (phase.deliverables.length > 0) {
      console.log('Key Deliverables:');
      phase.deliverables.slice(0, 2).forEach(deliverable => {
        console.log(`  • ${chalk.gray(deliverable)}`);
      });
      if (phase.deliverables.length > 2) {
        console.log(`  ${chalk.gray(`... and ${phase.deliverables.length - 2} more`)}`);
      }
    }
  });
  
  // Recommendations
  if (plan.recommendations.length > 0) {
    console.log(chalk.blue.bold('\n💡 Key Recommendations'));
    plan.recommendations.slice(0, 5).forEach(rec => {
      console.log(`  • ${chalk.gray(rec)}`);
    });
  }
  
  // Risks
  if (plan.risks.length > 0) {
    console.log(chalk.blue.bold('\n⚠️ Key Risks'));
    plan.risks.slice(0, 3).forEach(risk => {
      console.log(`  • ${chalk.yellow(risk)}`);
    });
  }
  
  // Success metrics
  if (plan.successMetrics.length > 0) {
    console.log(chalk.blue.bold('\n📈 Success Metrics'));
    plan.successMetrics.slice(0, 4).forEach(metric => {
      console.log(`  • ${chalk.green(metric)}`);
    });
  }
  
  console.log(chalk.blue.bold('\n🚀 Next Steps'));
  console.log(`  • Review plan with team`);
  console.log(`  • Create refactoring session: ${chalk.cyan('funcqc refactor track create')}`);
  console.log(`  • Start with Phase 1 implementation`);
  console.log(`  • Monitor progress: ${chalk.cyan('funcqc refactor status')}`);
  
  if (plan.metadata.sessionId) {
    console.log(`  • Continue session: ${chalk.cyan(`funcqc refactor interactive -s ${plan.metadata.sessionId}`)}`);
  }
  
  console.log(chalk.gray('\nHappy refactoring! 🎯\n'));
}
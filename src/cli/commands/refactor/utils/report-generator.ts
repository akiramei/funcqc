/**
 * Report Generation Utilities
 * 
 * Provides functions for generating and displaying refactoring analysis reports
 * in both markdown and console formats.
 */

import chalk from 'chalk';
import { 
  RefactoringReport, 
  RefactoringOpportunity, 
  QualityHotSpot, 
  RefactoringRecommendation, 
  ProjectRefactoringSummary 
} from '../../../../types/index.js';
import { 
  getSeverityDisplaySimple, 
  getRiskLevelDisplay, 
  getPriorityDisplay, 
  getSeverityIcon, 
  formatPatternName,
  groupOpportunitiesByPattern
} from '../../../../utils/refactoring-utils.js';

// ============================================
// MARKDOWN REPORT GENERATION
// ============================================

/**
 * Generate a complete markdown report
 */
export function generateMarkdownReport(report: RefactoringReport, format: string): string {
  const lines: string[] = [];
  
  generateReportHeader(lines);
  generateProjectSummarySection(lines, report.projectSummary);
  generateOpportunitiesSection(lines, report.opportunities, format);
  generateHotSpotsSection(lines, report.hotSpots, format);
  generateRecommendationsSection(lines, report.recommendations);
  
  return lines.join('\n');
}

/**
 * Generate report header
 */
function generateReportHeader(lines: string[]): void {
  lines.push('# Refactoring Analysis Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
}

/**
 * Generate project summary section
 */
function generateProjectSummarySection(lines: string[], summary: ProjectRefactoringSummary): void {
  lines.push('## 📊 Project Summary');
  lines.push('');
  lines.push(`- **Total Functions**: ${summary.totalFunctions}`);
  lines.push(`- **Analyzed Functions**: ${summary.analyzedFunctions}`);
  lines.push(`- **Opportunities Found**: ${summary.opportunitiesFound}`);
  lines.push(`- **Estimated Effort**: ${summary.estimatedEffort} hours`);
  lines.push(`- **Risk Level**: ${summary.riskLevel}`);
  lines.push('');
  
  if (summary.priorityAreas.length > 0) {
    lines.push('**Priority Areas**:');
    summary.priorityAreas.forEach(area => lines.push(`- ${area}`));
    lines.push('');
  }
}

/**
 * Generate opportunities section
 */
function generateOpportunitiesSection(lines: string[], opportunities: RefactoringOpportunity[], format: string): void {
  if (opportunities.length === 0) return;
  
  lines.push('## 🎯 Refactoring Opportunities');
  lines.push('');
  
  const opportunitiesByPattern = groupOpportunitiesByPattern(opportunities);
  
  for (const [pattern, patternOpportunities] of Object.entries(opportunitiesByPattern)) {
    lines.push(`### ${formatPatternName(pattern)}`);
    lines.push('');
    
    patternOpportunities.forEach(opp => {
      lines.push(`- **${getSeverityIcon(opp.severity)} [${opp.severity.toUpperCase()}]** (Score: ${opp.impact_score})`);
      lines.push(`  - Function: \`${opp.function_id}\``);
      if (format === 'detailed' && opp.metadata) {
        Object.entries(opp.metadata).forEach(([key, value]) => {
          lines.push(`  - ${key}: ${value}`);
        });
      }
      lines.push('');
    });
  }
}

/**
 * Generate hot spots section
 */
function generateHotSpotsSection(lines: string[], hotSpots: QualityHotSpot[], format: string): void {
  if (hotSpots.length === 0) return;
  
  lines.push('## 🔥 Quality Hot Spots');
  lines.push('');
  
  hotSpots.slice(0, 10).forEach((hotSpot, index) => {
    lines.push(`### ${index + 1}. ${hotSpot.functionName}`);
    lines.push('');
    lines.push(`- **File**: ${hotSpot.filePath}`);
    lines.push(`- **Complexity**: ${hotSpot.complexity}`);
    lines.push(`- **Risk Score**: ${hotSpot.riskScore}`);
    lines.push('');
    
    if (hotSpot.issues.length > 0) {
      lines.push('**Issues**:');
      hotSpot.issues.forEach(issue => {
        lines.push(`- ${getSeverityIcon(issue.severity)} ${issue.description}`);
        if (format === 'detailed') {
          issue.suggestedActions.forEach(action => {
            lines.push(`  - 💡 ${action}`);
          });
        }
      });
      lines.push('');
    }
  });
}

/**
 * Generate recommendations section
 */
function generateRecommendationsSection(lines: string[], recommendations: RefactoringRecommendation[]): void {
  if (recommendations.length === 0) return;
  
  lines.push('## 💡 Recommendations');
  lines.push('');
  
  recommendations.forEach((rec, index) => {
    lines.push(`### ${index + 1}. ${formatPatternName(rec.pattern)} (${rec.priority.toUpperCase()} Priority)`);
    lines.push('');
    lines.push(`**Reasoning**: ${rec.reasoning}`);
    lines.push(`**Estimated Effort**: ${rec.estimatedEffort} hours`);
    lines.push(`**Expected Benefit**: ${rec.expectedBenefit}`);
    lines.push('');
  });
}

// ============================================
// CONSOLE DISPLAY FUNCTIONS
// ============================================

/**
 * Display complete analysis report in console
 */
export function displayAnalysisReport(
  report: RefactoringReport, 
  format: string, 
  outputPath?: string
): void {
  displayReportHeader();
  displayProjectSummary(report.projectSummary);
  displayTopOpportunities(report.opportunities, format);
  displayQualityHotSpots(report.hotSpots, format);
  displayRecommendations(report.recommendations);
  displayNextSteps(report.projectSummary, outputPath);
  console.log(); // Extra line for spacing
}

/**
 * Display report header
 */
function displayReportHeader(): void {
  console.log(chalk.cyan.bold('\n🔍 Refactoring Analysis Report\n'));
}

/**
 * Display project summary
 */
function displayProjectSummary(summary: ProjectRefactoringSummary): void {
  console.log(chalk.blue.bold('📊 Project Summary'));
  console.log(`   Total Functions: ${chalk.yellow(summary.totalFunctions)}`);
  console.log(`   Analyzed: ${chalk.yellow(summary.analyzedFunctions)}`);
  console.log(`   Opportunities: ${chalk.yellow(summary.opportunitiesFound)}`);
  console.log(`   Estimated Effort: ${chalk.yellow(summary.estimatedEffort)} hours`);
  console.log(`   Risk Level: ${getRiskLevelDisplay(summary.riskLevel)}`);
  
  if (summary.priorityAreas.length > 0) {
    console.log(`\n${chalk.blue.bold('🎯 Priority Areas:')}`);
    summary.priorityAreas.slice(0, 3).forEach(area => {
      console.log(`   • ${chalk.gray(area)}`);
    });
  }
}

/**
 * Display top opportunities
 */
function displayTopOpportunities(opportunities: RefactoringOpportunity[], format: string): void {
  if (opportunities.length === 0) return;
  
  console.log(`\n${chalk.blue.bold('🚨 Top Opportunities:')}`);
  
  const topOpportunities = opportunities
    .sort((a, b) => b.impact_score - a.impact_score)
    .slice(0, format === 'summary' ? 5 : 10);
  
  topOpportunities.forEach((opp, index) => {
    const severityDisplay = getSeverityDisplaySimple(opp.severity);
    const patternDisplay = formatPatternName(opp.pattern);
    console.log(`   ${index + 1}. ${severityDisplay} ${patternDisplay} (Score: ${chalk.yellow(opp.impact_score)})`);
    
    if (format !== 'summary') {
      console.log(`      Function: ${chalk.gray(opp.function_id)}`);
      if (opp.metadata && Object.keys(opp.metadata).length > 0) {
        const firstKey = Object.keys(opp.metadata)[0];
        console.log(`      ${firstKey}: ${chalk.gray(String(opp.metadata[firstKey]))}`);
      }
    }
  });
}

/**
 * Display quality hot spots
 */
function displayQualityHotSpots(hotSpots: QualityHotSpot[], format: string): void {
  if (hotSpots.length === 0) return;
  
  console.log(`\n${chalk.blue.bold('🔥 Quality Hot Spots:')}`);
  
  const topHotSpots = hotSpots.slice(0, format === 'summary' ? 3 : 5);
  topHotSpots.forEach((hotSpot, index) => {
    console.log(`   ${index + 1}. ${chalk.yellow(hotSpot.functionName)} (Risk: ${chalk.red(hotSpot.riskScore)})`);
    console.log(`      ${chalk.gray(hotSpot.filePath)}`);
    console.log(`      Complexity: ${chalk.yellow(hotSpot.complexity)}, Issues: ${chalk.red(hotSpot.issues.length)}`);
  });
}

/**
 * Display recommendations
 */
function displayRecommendations(recommendations: RefactoringRecommendation[]): void {
  if (recommendations.length === 0) return;
  
  console.log(`\n${chalk.blue.bold('💡 Top Recommendations:')}`);
  
  const topRecommendations = recommendations.slice(0, 3);
  topRecommendations.forEach((rec, index) => {
    const priorityDisplay = getPriorityDisplay(rec.priority);
    console.log(`   ${index + 1}. ${priorityDisplay} ${formatPatternName(rec.pattern)}`);
    console.log(`      ${chalk.gray(rec.reasoning)}`);
    console.log(`      Effort: ${chalk.yellow(rec.estimatedEffort)}h, Benefit: ${chalk.green(rec.expectedBenefit)}`);
  });
}

/**
 * Display next steps
 */
function displayNextSteps(summary: ProjectRefactoringSummary, outputPath?: string): void {
  if (summary.opportunitiesFound === 0) {
    console.log(`\n${chalk.green('✅ No major refactoring opportunities found. Code quality looks good!')}`);
  } else {
    console.log(`\n${chalk.blue('💡 Next Steps:')}`);
    console.log(`   • Review high-priority opportunities above`);
    console.log(`   • Run ${chalk.cyan('funcqc refactor detect')} for specific patterns`);
    console.log(`   • Use ${chalk.cyan('funcqc refactor interactive')} for guided refactoring`);
    
    if (outputPath) {
      console.log(`   • See detailed report: ${chalk.cyan(outputPath)}`);
    }
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Calculate total effort from opportunities
 */
export function calculateTotalEffort(opportunities: RefactoringOpportunity[]): number {
  return opportunities.reduce((total, opp) => {
    // Simple effort estimation based on impact score and complexity
    const baseEffort = Math.ceil(opp.impact_score / 10);
    return total + Math.max(1, Math.min(8, baseEffort)); // Between 1-8 hours per opportunity
  }, 0);
}
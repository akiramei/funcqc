import chalk from 'chalk';
import { RefactoringPattern, RefactoringOpportunity } from '../types/index.js';

/**
 * Parse pattern string to RefactoringPattern enum
 */
export function parsePattern(pattern: string): RefactoringPattern | undefined {
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

/**
 * Format pattern enum to human-readable name
 */
export function formatPatternName(pattern: string): string {
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

/**
 * Get colored severity display with brackets (used in detect.ts)
 */
export function getSeverityDisplay(severity: string): string {
  const colorMap: Record<string, (text: string) => string> = {
    critical: chalk.red,
    high: chalk.redBright,
    medium: chalk.yellow,
    low: chalk.green
  };
  
  const color = colorMap[severity] || chalk.gray;
  return color(`[${severity.toUpperCase()}]`);
}

/**
 * Get colored severity display without brackets (used in analyze.ts)
 */
export function getSeverityDisplaySimple(severity: string): string {
  const colorMap: Record<string, (text: string) => string> = {
    critical: chalk.red.bold,
    high: chalk.red,
    medium: chalk.yellow,
    low: chalk.green
  };
  
  const colorFn = colorMap[severity] || chalk.gray;
  return colorFn(severity.toUpperCase());
}

/**
 * Group refactoring opportunities by pattern
 */
export function groupOpportunitiesByPattern(opportunities: RefactoringOpportunity[]): Record<string, RefactoringOpportunity[]> {
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

/**
 * Get risk level display with colors
 */
export function getRiskLevelDisplay(riskLevel: string): string {
  const colorMap: Record<string, (text: string) => string> = {
    high: chalk.red.bold,
    medium: chalk.yellow,
    low: chalk.green
  };
  
  const colorFn = colorMap[riskLevel] || chalk.gray;
  return colorFn(riskLevel.toUpperCase());
}

/**
 * Get priority display with icons
 */
export function getPriorityDisplay(priority: string): string {
  const iconMap: Record<string, string> = {
    high: '🔥',
    medium: '⚠️',
    low: '💡'
  };
  
  return iconMap[priority] || '📌';
}

/**
 * Get severity icon
 */
export function getSeverityIcon(severity: string): string {
  const iconMap: Record<string, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢'
  };
  
  return iconMap[severity] || '⚪';
}
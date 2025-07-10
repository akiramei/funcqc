import chalk from 'chalk';
import { RefactoringPattern, RefactoringOpportunity } from '../types/index.js';

// Type definitions for better type safety
type SeverityLevel = 'low' | 'medium' | 'high' | 'critical';
type PriorityLevel = 'low' | 'medium' | 'high';
type RiskLevel = 'low' | 'medium' | 'high';

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
    'rename-function': RefactoringPattern.RenameFunction,
  };

  return patternMap[pattern];
}

/**
 * Format pattern enum to human-readable name
 */
export function formatPatternName(pattern: RefactoringPattern | string): string {
  const nameMap: Record<RefactoringPattern, string> = {
    [RefactoringPattern.ExtractMethod]: 'Extract Method',
    [RefactoringPattern.SplitFunction]: 'Split Function',
    [RefactoringPattern.ReduceParameters]: 'Reduce Parameters',
    [RefactoringPattern.ExtractClass]: 'Extract Class',
    [RefactoringPattern.InlineFunction]: 'Inline Function',
    [RefactoringPattern.RenameFunction]: 'Rename Function',
  };

  return nameMap[pattern as RefactoringPattern] || pattern;
}

/**
 * Shared severity color mapping
 */
const SEVERITY_COLOR_MAP = {
  critical: { withBrackets: chalk.red, simple: chalk.red.bold },
  high: { withBrackets: chalk.redBright, simple: chalk.red },
  medium: { withBrackets: chalk.yellow, simple: chalk.yellow },
  low: { withBrackets: chalk.green, simple: chalk.green },
} as const;

/**
 * Get colored severity display with brackets (used in detect.ts)
 */
export function getSeverityDisplay(severity: SeverityLevel | string): string {
  const colorFn = SEVERITY_COLOR_MAP[severity as SeverityLevel]?.withBrackets || chalk.gray;
  return colorFn(`[${severity.toUpperCase()}]`);
}

/**
 * Get colored severity display without brackets (used in analyze.ts)
 */
export function getSeverityDisplaySimple(severity: SeverityLevel | string): string {
  const colorFn = SEVERITY_COLOR_MAP[severity as SeverityLevel]?.simple || chalk.gray;
  return colorFn(severity.toUpperCase());
}

/**
 * Group refactoring opportunities by pattern
 */
export function groupOpportunitiesByPattern(
  opportunities: RefactoringOpportunity[]
): Record<string, RefactoringOpportunity[]> {
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
export function getRiskLevelDisplay(riskLevel: RiskLevel | string): string {
  const colorMap: Record<RiskLevel, (text: string) => string> = {
    high: chalk.red.bold,
    medium: chalk.yellow,
    low: chalk.green,
  };

  const colorFn = colorMap[riskLevel as RiskLevel] || chalk.gray;
  return colorFn(riskLevel.toUpperCase());
}

/**
 * Get priority display with icons
 */
export function getPriorityDisplay(priority: PriorityLevel | string): string {
  const iconMap: Record<PriorityLevel, string> = {
    high: '🔥',
    medium: '⚠️',
    low: '💡',
  };

  return iconMap[priority as PriorityLevel] || '📌';
}

/**
 * Get severity icon
 */
export function getSeverityIcon(severity: SeverityLevel | string): string {
  const iconMap: Record<SeverityLevel, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢',
  };

  return iconMap[severity as SeverityLevel] || '⚪';
}

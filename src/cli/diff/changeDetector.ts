import { FunctionChange, FunctionInfo, QualityMetrics } from '../../types/index.js';

export interface ChangeSignificance {
  score: number;          // 0-100 significance score
  reasons: string[];      // Human-readable reasons
  category: 'minor' | 'moderate' | 'major' | 'critical';
  suggestLineage: boolean;
}

export interface ChangeDetectorConfig {
  // Thresholds for determining change significance
  locChangeThreshold: number;       // Default: 0.5 (50% change)
  complexityChangeThreshold: number; // Default: 5 (CC points)
  depthChangeThreshold: number;      // Default: 2 levels
  parameterChangeThreshold: number;  // Default: 2 parameters
  
  // Weights for calculating composite score
  locWeight: number;                 // Default: 0.3
  complexityWeight: number;          // Default: 0.4
  depthWeight: number;               // Default: 0.2
  parameterWeight: number;           // Default: 0.1
  
  // Minimum score to suggest lineage tracking
  minScoreForLineage?: number;        // Default: 50
  
  // Enable/disable specific detectors
  enableRefactoringPatterns?: boolean; // Default: true
  enableFunctionSplitDetection?: boolean; // Default: true
}

export const DEFAULT_CHANGE_DETECTOR_CONFIG: ChangeDetectorConfig = {
  locChangeThreshold: 0.5,
  complexityChangeThreshold: 5,
  depthChangeThreshold: 2,
  parameterChangeThreshold: 2,
  locWeight: 0.3,
  complexityWeight: 0.4,
  depthWeight: 0.2,
  parameterWeight: 0.1,
  minScoreForLineage: 50,
  enableRefactoringPatterns: true,
  enableFunctionSplitDetection: true,
};

export class ChangeSignificanceDetector {
  constructor(
    private readonly config: ChangeDetectorConfig = DEFAULT_CHANGE_DETECTOR_CONFIG
  ) {}

  /**
   * Analyzes a function change and determines its significance
   */
  analyzeChange(change: FunctionChange): ChangeSignificance {
    const reasons: string[] = [];
    let totalScore = 0;
    
    const beforeMetrics = change.before.metrics;
    const afterMetrics = change.after.metrics;
    
    if (!beforeMetrics || !afterMetrics) {
      return {
        score: 0,
        reasons: ['Missing metrics data'],
        category: 'minor',
        suggestLineage: false
      };
    }

    // 1. Lines of Code change analysis
    const locChange = this.calculateLocChange(beforeMetrics, afterMetrics);
    if (locChange.significant) {
      reasons.push(locChange.reason);
      totalScore += locChange.score * this.config.locWeight;
    }

    // 2. Complexity change analysis
    const complexityChange = this.calculateComplexityChange(beforeMetrics, afterMetrics);
    if (complexityChange.significant) {
      reasons.push(complexityChange.reason);
      totalScore += complexityChange.score * this.config.complexityWeight;
    }

    // 3. Nesting depth change analysis
    const depthChange = this.calculateDepthChange(beforeMetrics, afterMetrics);
    if (depthChange.significant) {
      reasons.push(depthChange.reason);
      totalScore += depthChange.score * this.config.depthWeight;
    }

    // 4. Parameter count change analysis
    const paramChange = this.calculateParameterChange(change.before, change.after);
    if (paramChange.significant) {
      reasons.push(paramChange.reason);
      totalScore += paramChange.score * this.config.parameterWeight;
    }

    // 5. Check for refactoring patterns
    const refactoringPattern = this.detectRefactoringPattern(change);
    if (refactoringPattern) {
      reasons.push(refactoringPattern.reason);
      totalScore = Math.max(totalScore, refactoringPattern.score);
    }

    // Determine category based on score
    const category = this.categorizeScore(totalScore);
    
    // Suggest lineage for major/critical changes
    const suggestLineage = category === 'major' || category === 'critical';

    return {
      score: Math.min(100, Math.round(totalScore)),
      reasons,
      category,
      suggestLineage
    };
  }

  /**
   * Analyzes multiple changes and returns only significant ones
   */
  filterSignificantChanges(
    changes: FunctionChange[],
    minScore: number = 50
  ): Array<{ change: FunctionChange; significance: ChangeSignificance }> {
    return changes
      .map(change => ({
        change,
        significance: this.analyzeChange(change)
      }))
      .filter(result => result.significance.score >= minScore)
      .sort((a, b) => b.significance.score - a.significance.score);
  }

  private calculateLocChange(
    before: QualityMetrics,
    after: QualityMetrics
  ): { significant: boolean; score: number; reason: string } {
    const locBefore = before.linesOfCode;
    const locAfter = after.linesOfCode;
    
    if (locBefore === 0) {
      return { significant: false, score: 0, reason: '' };
    }

    const changeRatio = Math.abs(locAfter - locBefore) / locBefore;
    const significant = changeRatio >= this.config.locChangeThreshold;
    
    if (!significant) {
      return { significant: false, score: 0, reason: '' };
    }

    // Score calculation: Higher scores for larger changes
    const score = Math.min(100, changeRatio * 150); // Boost score by 1.5x
    const changeType = locAfter > locBefore ? 'increased' : 'decreased';
    const reason = `Lines of code ${changeType} by ${Math.round(changeRatio * 100)}% (${locBefore} → ${locAfter})`;

    return { significant, score, reason };
  }

  private calculateComplexityChange(
    before: QualityMetrics,
    after: QualityMetrics
  ): { significant: boolean; score: number; reason: string } {
    const ccBefore = before.cyclomaticComplexity;
    const ccAfter = after.cyclomaticComplexity;
    
    const absoluteChange = Math.abs(ccAfter - ccBefore);
    const significant = absoluteChange >= this.config.complexityChangeThreshold;
    
    if (!significant) {
      return { significant: false, score: 0, reason: '' };
    }

    // Higher score for complexity increases
    const score = ccAfter > ccBefore
      ? Math.min(100, absoluteChange * 15) // Increased multiplier
      : Math.min(80, absoluteChange * 12);  // Increased multiplier
      
    const changeType = ccAfter > ccBefore ? 'increased' : 'decreased';
    const reason = `Cyclomatic complexity ${changeType} by ${absoluteChange} (${ccBefore} → ${ccAfter})`;

    return { significant, score, reason };
  }

  private calculateDepthChange(
    before: QualityMetrics,
    after: QualityMetrics
  ): { significant: boolean; score: number; reason: string } {
    const depthBefore = before.maxNestingLevel;
    const depthAfter = after.maxNestingLevel;
    
    const absoluteChange = Math.abs(depthAfter - depthBefore);
    const significant = absoluteChange >= this.config.depthChangeThreshold;
    
    if (!significant) {
      return { significant: false, score: 0, reason: '' };
    }

    const score = Math.min(100, absoluteChange * 30); // Increased multiplier
    const changeType = depthAfter > depthBefore ? 'increased' : 'decreased';
    const reason = `Nesting depth ${changeType} by ${absoluteChange} levels (${depthBefore} → ${depthAfter})`;

    return { significant, score, reason };
  }

  private calculateParameterChange(
    before: FunctionInfo,
    after: FunctionInfo
  ): { significant: boolean; score: number; reason: string } {
    const paramsBefore = before.parameters.length;
    const paramsAfter = after.parameters.length;
    
    const absoluteChange = Math.abs(paramsAfter - paramsBefore);
    const significant = absoluteChange >= this.config.parameterChangeThreshold;
    
    if (!significant) {
      return { significant: false, score: 0, reason: '' };
    }

    const score = Math.min(100, absoluteChange * 35); // Increased multiplier
    const changeType = paramsAfter > paramsBefore ? 'increased' : 'decreased';
    const reason = `Parameter count ${changeType} by ${absoluteChange} (${paramsBefore} → ${paramsAfter})`;

    return { significant, score, reason };
  }

  private detectRefactoringPattern(
    change: FunctionChange
  ): { score: number; reason: string } | null {
    const before = change.before;
    const after = change.after;

    // Pattern 1: Extract Method (function became much smaller)
    if (before.metrics && after.metrics) {
      const locReduction = (before.metrics.linesOfCode - after.metrics.linesOfCode) / before.metrics.linesOfCode;
      if (locReduction > 0.6) {
        return {
          score: 80,
          reason: 'Likely "Extract Method" refactoring (60%+ size reduction)'
        };
      }
    }

    // Pattern 2: Rename with significant changes
    if (before.name !== after.name && after.metrics && before.metrics) {
      const locChange = Math.abs(after.metrics.linesOfCode - before.metrics.linesOfCode) / before.metrics.linesOfCode;
      if (locChange > 0.3) {
        return {
          score: 70,
          reason: `Function renamed and modified (${before.name} → ${after.name})`
        };
      }
    }

    // Pattern 3: Complete rewrite (high cognitive complexity change)
    if (before.metrics && after.metrics && before.metrics.cognitiveComplexity && after.metrics.cognitiveComplexity) {
      const cogChange = Math.abs(after.metrics.cognitiveComplexity - before.metrics.cognitiveComplexity);
      if (cogChange > 10) {
        return {
          score: 90,
          reason: 'Major structural changes detected (cognitive complexity shift)'
        };
      }
    }

    return null;
  }

  private categorizeScore(score: number): 'minor' | 'moderate' | 'major' | 'critical' {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'major';
    if (score >= 30) return 'moderate';
    return 'minor';
  }

  /**
   * Detects functions that were likely split into multiple functions
   */
  detectFunctionSplits(
    removed: FunctionInfo[],
    added: FunctionInfo[]
  ): Array<{
    original: FunctionInfo;
    candidates: FunctionInfo[];
    confidence: number;
  }> {
    const splits: Array<{
      original: FunctionInfo;
      candidates: FunctionInfo[];
      confidence: number;
    }> = [];

    for (const removedFunc of removed) {
      if (!removedFunc.metrics || removedFunc.metrics.linesOfCode < 20) {
        continue; // Skip small functions
      }

      // Find added functions in the same file
      const sameFileAdded = added.filter(f => f.filePath === removedFunc.filePath);
      
      if (sameFileAdded.length < 2) {
        continue; // Need at least 2 new functions for a split
      }

      // Check if the combined size is similar
      const totalAddedLines = sameFileAdded.reduce(
        (sum, f) => sum + (f.metrics?.linesOfCode ?? 0),
        0
      );

      const sizeRatio = totalAddedLines / removedFunc.metrics.linesOfCode;
      
      // If combined size is 70-130% of original, likely a split
      if (sizeRatio >= 0.7 && sizeRatio <= 1.3) {
        // Check for naming patterns
        const nameMatches = sameFileAdded.filter(f => 
          f.name.toLowerCase().includes(removedFunc.name.toLowerCase()) ||
          removedFunc.name.toLowerCase().includes(f.name.toLowerCase())
        );

        const confidence = Math.min(
          0.9,
          0.5 + (nameMatches.length / sameFileAdded.length) * 0.4
        );

        splits.push({
          original: removedFunc,
          candidates: sameFileAdded,
          confidence
        });
      }
    }

    return splits;
  }
}
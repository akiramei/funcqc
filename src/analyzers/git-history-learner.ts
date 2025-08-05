/**
 * Git History-Based Learning System for Debug Residue Detection
 * 
 * Analyzes Git commit history to automatically learn patterns of debug code
 * additions and removals, building a local knowledge base for improved
 * residue detection accuracy with zero user configuration cost.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createGitProvider, GitProvider, GitProviderConfig, GitCommitInfo } from '../utils/git/index.js';

export interface DebugCodePattern {
  id: string;
  pattern: string;
  context: string;
  confidence: number;
  evidence: GitEvidence[];
  createdAt: string;
  lastSeen: string;
}

export interface GitEvidence {
  commitHash: string;
  action: 'added' | 'removed' | 'modified';
  filePath: string;
  lineNumber: number;
  commitMessage: string;
  authorDate: string;
  daysBetweenAddRemove?: number;
}

export interface LearningDatabase {
  patterns: DebugCodePattern[];
  metadata: {
    lastAnalysis: string;
    repoPath: string;
    totalCommitsAnalyzed: number;
    confidenceVersion: string;
  };
}

/**
 * Git History-based learning system for automatic debug pattern recognition
 */
export class GitHistoryLearner {
  private repoPath: string;
  private learningDbPath: string;
  private database: LearningDatabase;
  private verbose: boolean;
  private gitProvider: GitProvider;

  // Debug-related keywords in commit messages
  private static DEBUG_KEYWORDS = [
    'debug', 'log', 'console', 'temp', 'temporary', 'test', 'testing',
    'remove', 'cleanup', 'fix', 'WIP', 'TODO', 'FIXME', 'XXX',
    'investigating', 'quick fix', 'temp fix', 'disable', 'enable'
  ];

  // Patterns that commonly indicate debug code
  private static DEBUG_CODE_PATTERNS = [
    /console\.(log|debug|info|warn|error)\s*\(/,
    /debugger\s*;/,
    /print\s*\(/,
    /logger\.(debug|trace)\s*\(/,
    /System\.out\.println\s*\(/,
    /printf\s*\(/,
    /alert\s*\(/
  ];

  constructor(repoPath: string = process.cwd(), options: { verbose?: boolean } = {}) {
    this.repoPath = repoPath;
    this.learningDbPath = path.join(repoPath, '.funcqc', 'debug-learning.json');
    this.verbose = options.verbose ?? (process.env['FUNCQC_VERBOSE'] === 'true');
    this.database = this.loadDatabase();
    
    const gitConfig: GitProviderConfig = {
      cwd: repoPath,
      verbose: this.verbose
    };
    this.gitProvider = createGitProvider({ 
      ...gitConfig,
      provider: 'native' // Use native provider for history analysis
    });
  }

  /**
   * Log message with verbosity control
   */
  private log(message: string): void {
    if (this.verbose) {
      console.log(message);
    }
  }

  /**
   * Analyze Git history to learn debug code patterns
   */
  async analyzeHistory(options: {
    monthsBack?: number;
    maxCommits?: number;
    excludePaths?: string[];
  } = {}): Promise<void> {
    const { monthsBack = 6, maxCommits = 1000, excludePaths = [] } = options;

    this.log('🔍 Analyzing Git history for debug patterns...');
    
    try {
      // Get relevant commits
      const commits = await this.getRelevantCommits(monthsBack, maxCommits);
      this.log(`📊 Found ${commits.length} potentially relevant commits`);

      let patternsLearned = 0;
      
      for (const commit of commits) {
        const patterns = await this.analyzeCommit(commit, excludePaths);
        patternsLearned += patterns.length;
        
        for (const pattern of patterns) {
          this.addOrUpdatePattern(pattern);
        }
      }

      // Update metadata
      this.database.metadata.lastAnalysis = new Date().toISOString();
      this.database.metadata.totalCommitsAnalyzed = commits.length;
      
      await this.saveDatabase();
      
      this.log(`✅ Learning complete: ${patternsLearned} patterns learned from ${commits.length} commits`);
      this.log(`📝 Total patterns in database: ${this.database.patterns.length}`);
      
    } catch (error) {
      console.error('❌ Failed to analyze Git history:', error instanceof Error ? error.message : error);
      throw error;
    }
  }

  /**
   * Get commits that likely contain debug-related changes
   */
  private async getRelevantCommits(monthsBack: number, maxCommits: number): Promise<GitCommitInfo[]> {
    try {
      const historyResult = await this.gitProvider.getHistory({
        monthsBack,
        maxCommits
      });

      // Filter commits that contain debug-related keywords
      const keywordPattern = new RegExp(
        GitHistoryLearner.DEBUG_KEYWORDS
          .map(keyword => keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('|'),
        'i'
      );

      return historyResult.commits.filter(commit => 
        keywordPattern.test(commit.message)
      );
      
    } catch {
      console.warn('⚠️ Could not analyze Git history - not in a Git repository or no matching commits');
      return [];
    }
  }

  /**
   * Analyze a single commit for debug patterns
   */
  private async analyzeCommit(commit: GitCommitInfo, excludePaths: string[]): Promise<DebugCodePattern[]> {
    const patterns: DebugCodePattern[] = [];

    try {
      // Get detailed diff using GitProvider
      const detailDiff = await this.gitProvider.getCommitDiff(commit.hash);

      // Extract patterns from diff
      const extractedPatterns = this.extractPatternsFromDiff(
        detailDiff, 
        commit, 
        excludePaths
      );
      
      patterns.push(...extractedPatterns);
      
    } catch {
      // Skip commits that can't be analyzed
    }

    return patterns;
  }

  /**
   * Extract debug patterns from Git diff
   */
  private extractPatternsFromDiff(
    diff: string, 
    commit: GitCommitInfo, 
    excludePaths: string[]
  ): DebugCodePattern[] {
    const patterns: DebugCodePattern[] = [];
    const lines = diff.split('\n');
    let currentFile = '';
    let lineNumber = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Track current file
      if (line.startsWith('diff --git')) {
        // Handle quoted paths with spaces
        const match = line.match(/diff --git a\/(.+?) b\/(.+?)$/);
        if (match) {
          currentFile = match[2].replace(/^"(.+)"$/, '$1');
        }
      }

      // Track line numbers
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -\d+,?\d* \+(\d+),?\d* @@/);
        if (match) {
          lineNumber = parseInt(match[1]) - 1;
        }
      }

      // Look for added/removed debug code
      if ((line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---')) {
        const action = line.startsWith('+') ? 'added' : 'removed';
        const codeContent = line.substring(1).trim();
        
        // Check if this matches debug patterns
        for (const pattern of GitHistoryLearner.DEBUG_CODE_PATTERNS) {
          if (pattern.test(codeContent)) {
            // Skip excluded paths
            if (excludePaths.some(exclude => currentFile.includes(exclude))) {
              continue;
            }

            const confidence = this.calculateConfidence(
              codeContent, 
              commit.message, 
              action,
              currentFile
            );

            const debugPattern: DebugCodePattern = {
              id: `${commit.hash}-${currentFile}-${lineNumber}`,
              pattern: codeContent,
              context: currentFile,
              confidence,
              evidence: [{
                commitHash: commit.hash,
                action,
                filePath: currentFile,
                lineNumber,
                commitMessage: commit.message,
                authorDate: commit.date
              }],
              createdAt: new Date().toISOString(),
              lastSeen: commit.date
            };

            patterns.push(debugPattern);
          }
        }
        
        lineNumber++;
      }
    }

    return patterns;
  }

  /**
   * Calculate confidence score for a debug pattern
   */
  private calculateConfidence(
    code: string, 
    commitMessage: string, 
    action: 'added' | 'removed',
    _filePath: string
  ): number {
    let confidence = 0.5; // Base confidence

    // Boost confidence for removal actions
    if (action === 'removed') {
      confidence += 0.3;
    }

    // Boost confidence for debug-related commit messages
    const lowerMessage = commitMessage.toLowerCase();
    const debugKeywords = GitHistoryLearner.DEBUG_KEYWORDS;
    const foundKeywords = debugKeywords.filter(keyword => 
      lowerMessage.includes(keyword.toLowerCase())
    );
    confidence += foundKeywords.length * 0.1;

    // Boost confidence for explicit debug patterns
    if (/console\.(debug|log)/.test(code)) confidence += 0.2;
    if (/debugger/.test(code)) confidence += 0.3;
    if (code.includes('DEBUG:') || code.includes('TODO:')) confidence += 0.2;

    // Note: filePath-based confidence adjustments can be added here if needed

    return Math.max(0.1, Math.min(1.0, confidence));
  }

  /**
   * Add or update a pattern in the database
   */
  private addOrUpdatePattern(newPattern: DebugCodePattern): void {
    const existingIndex = this.database.patterns.findIndex(p => 
      p.pattern === newPattern.pattern && p.context === newPattern.context
    );

    if (existingIndex >= 0) {
      // Update existing pattern
      const existing = this.database.patterns[existingIndex];
      existing.evidence.push(...newPattern.evidence);
      existing.confidence = (existing.confidence + newPattern.confidence) / 2;
      existing.lastSeen = newPattern.lastSeen;
    } else {
      // Add new pattern
      this.database.patterns.push(newPattern);
    }
  }

  /**
   * Get confidence score for a given piece of code
   */
  getConfidenceScore(code: string, _filePath: string): number {
    const matchingPatterns = this.database.patterns.filter(pattern => {
      // Exact match
      if (pattern.pattern === code.trim()) return true;
      
      // Pattern-based match
      try {
        const regex = new RegExp(pattern.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        return regex.test(code);
      } catch {
        return false;
      }
    });

    if (matchingPatterns.length === 0) return 0;

    // Return highest confidence from matching patterns
    return Math.max(...matchingPatterns.map(p => p.confidence));
  }

  /**
   * Get all learned patterns for debugging
   */
  getLearnedPatterns(): DebugCodePattern[] {
    return [...this.database.patterns];
  }

  /**
   * Load learning database from disk
   */
  private loadDatabase(): LearningDatabase {
    try {
      if (fs.existsSync(this.learningDbPath)) {
        const data = fs.readFileSync(this.learningDbPath, 'utf8');
        return JSON.parse(data);
      }
    } catch {
      console.warn('⚠️ Could not load learning database, starting fresh');
    }

    return {
      patterns: [],
      metadata: {
        lastAnalysis: '',
        repoPath: this.repoPath,
        totalCommitsAnalyzed: 0,
        confidenceVersion: '1.0.0'
      }
    };
  }

  /**
   * Save learning database to disk
   */
  private async saveDatabase(): Promise<void> {
    const dir = path.dirname(this.learningDbPath);
    
    // Ensure directory exists
    try {
      await fs.promises.mkdir(dir, { recursive: true });
    } catch {
      // Directory might already exist
    }

    await fs.promises.writeFile(
      this.learningDbPath,
      JSON.stringify(this.database, null, 2),
      'utf8'
    );
  }

}


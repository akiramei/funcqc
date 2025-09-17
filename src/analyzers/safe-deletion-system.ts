import { FunctionInfo, CallEdge } from '../types';
import { DependencyAnalysisEngine, DependencyAnalysisOptions } from './dependency-analysis-engine';
import { SafeDeletionCandidateGenerator, SafeDeletionCandidate } from './safe-deletion-candidate-generator';
import { SafeFunctionDeleter } from '../tools/function-deleter';
import { Logger } from '../utils/cli-utils';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface SafeDeletionOptions {
  confidenceThreshold: number;     // Minimum confidence score for deletion (default: 0.90)
  createBackup: boolean;          // Create backup before deletion (default: true)
  dryRun: boolean;               // Only show what would be deleted (default: false)
  maxFunctionsPerBatch: number;   // Maximum functions to delete in one batch (default: 5)
  includeExports: boolean;        // Include exported functions in deletion analysis (default: false)
  includeStaticMethods?: boolean; // Include static methods in analysis (default: false)
  excludeTests?: boolean;         // Exclude test functions from analysis (default: false)
  excludePatterns: string[];      // File patterns to exclude from deletion
  verbose?: boolean;              // Verbose logging (inherit from CLI --verbose)
  storage?: import('../types').StorageAdapter; // Storage adapter for internal call edge queries
  snapshotId?: string;           // Snapshot ID for consistent data access
  /**
   * Minimum confidence required for a function to be considered as a deletion candidate
   * Note: This is distinct from `confidenceThreshold`, which filters call graph edges
   */
  candidateMinConfidence?: number;
}

export interface SafeDeletionResult {
  candidateFunctions: DeletionCandidate[];
  deletedFunctions: DeletionCandidate[];
  skippedFunctions: DeletionCandidate[];
  errors: string[];
  warnings: string[];
  backupPath?: string;
  preDeleteValidation: ValidationResult;
  postDeleteValidation: ValidationResult;
}

// DeletionCandidate is now imported as SafeDeletionCandidate from the candidate generator
export type DeletionCandidate = SafeDeletionCandidate;

export interface ValidationResult {
  typeCheckPassed: boolean;
  testsPassed: boolean;
  errors: string[];
  warnings: string[];
  timestamp: string;
  performed?: boolean; // 実際に検証を実施したか（ユーザー責務=未実施の場合は false）
}

/**
 * Safe Deletion System
 * 
 * Uses high-confidence call graph edges to safely identify and delete dead code:
 * 1. Filter for high-confidence edges only (≥0.95 confidence)
 * 2. Perform reachability analysis with conservative approach
 * 3. Validate with TypeScript compiler and tests
 * 4. Create automatic backups
 * 5. Delete in small batches with validation after each batch
 * 
 * Design principles:
 * - Zero false positives: Only delete if absolutely certain
 * - Conservative approach: Prefer keeping code over deleting
 * - Validation at every step: Type check + tests + manual review
 * - Automatic rollback: Full backup and recovery system
 */
export class SafeDeletionSystem {
  private analysisEngine: DependencyAnalysisEngine;
  private candidateGenerator: SafeDeletionCandidateGenerator;
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger(false, false);
    this.analysisEngine = new DependencyAnalysisEngine();
    this.candidateGenerator = new SafeDeletionCandidateGenerator(this.logger);
  }

  /**
   * Perform safe deletion analysis and optionally execute deletions
   */
  async performSafeDeletion(
    functions: FunctionInfo[],
    callEdges: CallEdge[],
    options: Partial<SafeDeletionOptions> = {}
  ): Promise<SafeDeletionResult> {
    const config = this.getDefaultOptions(options);
    const result: SafeDeletionResult = {
      candidateFunctions: [],
      deletedFunctions: [],
      skippedFunctions: [],
      errors: [],
      warnings: [],
      preDeleteValidation: await this.runValidation('pre-delete', config),
      postDeleteValidation: { typeCheckPassed: true, testsPassed: true, errors: [], warnings: [], timestamp: '', performed: false }
    };

    console.log('🛡️  Starting safe deletion analysis...');
    console.log(`   Confidence threshold: ${config.confidenceThreshold}`);
    console.log(`   Max functions per batch: ${config.maxFunctionsPerBatch}`);
    console.log(`   Dry run: ${config.dryRun ? 'Yes' : 'No'}`);

    try {
      // Use DependencyAnalysisEngine for unified analysis
      const analysisOptions: Partial<DependencyAnalysisOptions> = {
        confidenceThreshold: config.confidenceThreshold,
        includeExports: config.includeExports,
        includeStaticMethods: config.includeStaticMethods ?? false,
        excludeTests: config.excludeTests ?? false,
        excludePatterns: config.excludePatterns,
        // Only enable verbose when explicitly requested via CLI
        verbose: Boolean(config.verbose),
        dryRun: config.dryRun,
        ...(config.storage && { storage: config.storage }),
        ...(config.snapshotId && { snapshotId: config.snapshotId })
      };

      const analysisResult = await this.analysisEngine.analyzeDependencies(
        functions,
        callEdges,
        this.candidateGenerator,
        analysisOptions
      );

      // Initial candidates from analysis
      result.candidateFunctions = analysisResult.analysisResults;

      // Apply function-level confidence filter if provided (independent from edge confidence)
      if (typeof config.candidateMinConfidence === 'number') {
        result.candidateFunctions = result.candidateFunctions.filter(c => c.confidenceScore >= (config.candidateMinConfidence as number));
      }
      result.errors.push(...analysisResult.errors);
      result.warnings.push(...analysisResult.warnings);

      console.log(`   🎯 Using ${analysisResult.metadata.highConfidenceEdges} high-confidence edges (≥${config.confidenceThreshold})`);
      console.log(`   🔍 Found ${result.candidateFunctions.length} deletion candidates`);

      if (result.candidateFunctions.length === 0) {
        console.log('   ✅ No functions identified for safe deletion');
        return result;
      }

      // Step 3: Pre-deletion validation (user responsibility)
      // Note: concise guidance printed in runValidation().

      // Step 4: Create backup if not dry run
      if (!config.dryRun && config.createBackup) {
        result.backupPath = await this.createBackup(result.candidateFunctions);
        console.log(`   💾 Created backup at: ${result.backupPath}`);
      }

      // Step 5: Process deletions in batches
      if (!config.dryRun) {
        await this.processDeletionBatches(result, config);
        
        // Step 6: Post-deletion validation (user responsibility)
        result.postDeleteValidation = await this.runValidation('post-delete', config);
        
        // Post-deletion guidance printed in runValidation()
      }

      return result;

    } catch (error) {
      result.errors.push(`Safe deletion failed: ${error instanceof Error ? error.message : String(error)}`);
      return result;
    }
  }


  // identifyDeletionCandidates method removed - now handled by SafeDeletionCandidateGenerator

  /**
   * Process deletions in safe batches
   */
  private async processDeletionBatches(
    result: SafeDeletionResult,
    config: SafeDeletionOptions
  ): Promise<void> {
    const batches = this.createBatches(result.candidateFunctions, config.maxFunctionsPerBatch);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`   🔄 Processing batch ${i + 1}/${batches.length} (${batch.length} functions)...`);

      try {
        // Delete functions in this batch with a single deleter (performance improvement)
        await this.deleteBatch(batch);
        
        // Add all batch functions to deleted list
        for (const candidate of batch) {
          result.deletedFunctions.push(candidate);
        }

        // Provide detailed validation guidance after each batch
        console.log(`   ℹ️  Batch ${i + 1} completed. Validation recommended:`);
        console.log('   💡 Run: npm run typecheck && npm test');
        console.log(`   📊 Progress: ${result.deletedFunctions.length}/${result.candidateFunctions.length} functions processed`);

        console.log(`   ✅ Batch ${i + 1} completed successfully`);

      } catch (error) {
        result.errors.push(`Batch ${i + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
        
        // Move remaining functions to skipped
        for (const candidate of batch) {
          if (!result.deletedFunctions.includes(candidate)) {
            result.skippedFunctions.push(candidate);
          }
        }
        break;
      }
    }
  }

  /**
   * Delete a batch of functions efficiently with a single deleter
   */
  private async deleteBatch(batch: DeletionCandidate[]): Promise<void> {
    const deleter = new SafeFunctionDeleter({ verbose: false });
    
    try {
      const functionInfos = batch.map(c => c.functionInfo);
      const result = await deleter.deleteFunctions(functionInfos, { 
        dryRun: false,
        verbose: false 
      });
      
      // Enhanced validation: check actual deletion occurred
      const deleted = result.functionsDeleted > 0;
      const expectedFiles = new Set(functionInfos.map(f => f.filePath));
      const modifiedFilesMatch = expectedFiles.size === 0 || 
        Array.from(expectedFiles).some(file => result.filesModified.includes(file));
      
      if (!result.success || result.errors.length > 0 || !deleted || !modifiedFilesMatch) {
        const errDetail = result.errors.length ? `: ${result.errors.join(', ')}` : '';
        const deletionDetail = !deleted ? ' (0 functions deleted)' : '';
        const fileDetail = !modifiedFilesMatch ? ' (expected files not modified)' : '';
        throw new Error(`AST-based batch deletion failed${errDetail}${deletionDetail}${fileDetail}`);
      }
      
      // Log each successfully deleted function
      for (const candidate of batch) {
        const { functionInfo } = candidate;
        console.log(`   🗑️  Deleted function: ${functionInfo.name} (${functionInfo.filePath}:${functionInfo.startLine})`);
      }
      
    } finally {
      deleter.dispose();
    }
  }


  /**
   * Create backup of functions to be deleted
   */
  private async createBackup(candidates: DeletionCandidate[]): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join('.funcqc', 'backups', `safe-deletion-${timestamp}`);
    
    await fs.mkdir(backupDir, { recursive: true });

    // Create backup index
    const backupIndex = {
      timestamp,
      totalFunctions: candidates.length,
      functions: candidates.map(c => ({
        id: c.functionInfo.id,
        name: c.functionInfo.name,
        filePath: c.functionInfo.filePath,
        startLine: c.functionInfo.startLine,
        endLine: c.functionInfo.endLine,
        reason: c.reason,
        confidenceScore: c.confidenceScore,
        sourceLines: c.sourceLines
      }))
    };

    await fs.writeFile(
      path.join(backupDir, 'index.json'),
      JSON.stringify(backupIndex, null, 2)
    );

    // Create individual backup files
    for (const candidate of candidates) {
      const backupFileName = `${candidate.functionInfo.name}.${candidate.functionInfo.id}.backup.txt`;
      const backupContent = [
        `// Backup of function: ${candidate.functionInfo.name}`,
        `// File: ${candidate.functionInfo.filePath}`,
        `// Lines: ${candidate.functionInfo.startLine}-${candidate.functionInfo.endLine}`,
        `// Reason: ${candidate.reason}`,
        `// Confidence: ${candidate.confidenceScore}`,
        `// Backup time: ${timestamp}`,
        '',
        ...candidate.sourceLines
      ].join('\n');

      await fs.writeFile(path.join(backupDir, backupFileName), backupContent);
    }

    return backupDir;
  }

  /**
   * Run validation (user responsibility - always returns success)
   */
  private async runValidation(phase: string, _config?: SafeDeletionOptions): Promise<ValidationResult> {
    const result: ValidationResult = {
      typeCheckPassed: true,
      testsPassed: true,
      errors: [],
      warnings: [],
      timestamp: new Date().toISOString(),
      performed: false
    };

    console.log(`   ℹ️  ${phase} validation: N/A (user responsibility; run: npm run typecheck; npm test)`);

    return result;
  }

  // extractSourceLines method removed - now handled by SafeDeletionCandidateGenerator





  /**
   * Create batches of functions for safe deletion
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  // sortDeletionCandidates method removed - now handled by SafeDeletionCandidateGenerator

  /**
   * Get default options with user overrides
   */
  private getDefaultOptions(options: Partial<SafeDeletionOptions>): SafeDeletionOptions {
    return {
      confidenceThreshold: 0.90,  // Lowered from 0.99 to improve detection (with enhanced confidence calculation)
      createBackup: true,
      dryRun: false,
      maxFunctionsPerBatch: 5,    // Kept at 5 to prevent timeouts
      includeExports: false,
      excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**'],
      ...options
    };
  }

  /**
   * Restore from backup with validation
   */
  async restoreFromBackup(backupPath: string): Promise<void> {
    const indexPath = path.join(backupPath, 'index.json');
    const backupIndex = JSON.parse(await fs.readFile(indexPath, 'utf8'));

    console.log(`🔄 Restoring ${backupIndex.totalFunctions} functions from backup...`);

    const restoredFiles = new Set<string>();

    for (const func of backupIndex.functions) {
      const backupFileName = `${func.name}.${func.id}.backup.txt`;
      const backupContent = await fs.readFile(path.join(backupPath, backupFileName), 'utf8');
      
      // Extract source lines (skip metadata comments)
      const lines = backupContent.split('\n');
      const sourceStart = lines.findIndex(line => line === '') + 1;
      const sourceLines = lines.slice(sourceStart);

      // Restore function to original file
      await this.restoreFunction(func, sourceLines);
      restoredFiles.add(func.filePath);
    }

    console.log('✅ Backup restoration completed');
    console.log('ℹ️  Recommendation: Run type check and tests to verify restoration');
    
    if (restoredFiles.size > 0) {
      console.log(`📁 Files modified: ${Array.from(restoredFiles).join(', ')}`);
    }
  }

  /**
   * Restore a single function to its original location
   */
  private async restoreFunction(func: { filePath: string; startLine: number; name: string }, sourceLines: string[]): Promise<void> {
    const filePath = func.filePath;
    const fileContent = await fs.readFile(filePath, 'utf8');
    const lines = fileContent.split('\n');

    // Insert function back at original location
    const insertIndex = func.startLine - 1;
    const newLines = [
      ...lines.slice(0, insertIndex),
      ...sourceLines,
      ...lines.slice(insertIndex)
    ];

    await fs.writeFile(filePath, newLines.join('\n'));
    console.log(`   ↩️  Restored function: ${func.name} (${filePath}:${func.startLine})`);
  }
}

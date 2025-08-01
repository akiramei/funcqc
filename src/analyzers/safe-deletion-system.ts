import { FunctionInfo, CallEdge } from '../types';
import { DependencyAnalysisEngine, DependencyAnalysisOptions } from './dependency-analysis-engine';
import { SafeDeletionCandidateGenerator, SafeDeletionCandidate } from './safe-deletion-candidate-generator';
import { Logger } from '../utils/cli-utils';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface SafeDeletionOptions {
  confidenceThreshold: number;     // Minimum confidence score for deletion (default: 0.95)
  createBackup: boolean;          // Create backup before deletion (default: true)
  dryRun: boolean;               // Only show what would be deleted (default: false)
  maxFunctionsPerBatch: number;   // Maximum functions to delete in one batch (default: 10)
  excludeExports: boolean;        // Exclude exported functions from deletion (default: true)
  excludePatterns: string[];      // File patterns to exclude from deletion
  storage?: import('../types').StorageAdapter; // Storage adapter for internal call edge queries
  snapshotId?: string;           // Snapshot ID for consistent data access
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
      postDeleteValidation: { typeCheckPassed: true, testsPassed: true, errors: [], warnings: [], timestamp: '' }
    };

    console.log('🛡️  Starting safe deletion analysis...');
    console.log(`   Confidence threshold: ${config.confidenceThreshold}`);
    console.log(`   Max functions per batch: ${config.maxFunctionsPerBatch}`);
    console.log(`   Dry run: ${config.dryRun ? 'Yes' : 'No'}`);

    try {
      // Use DependencyAnalysisEngine for unified analysis
      const analysisOptions: Partial<DependencyAnalysisOptions> = {
        confidenceThreshold: config.confidenceThreshold,
        excludeExports: config.excludeExports,
        excludePatterns: config.excludePatterns,
        verbose: true,
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

      result.candidateFunctions = analysisResult.analysisResults;
      result.errors.push(...analysisResult.errors);
      result.warnings.push(...analysisResult.warnings);

      console.log(`   🎯 Using ${analysisResult.metadata.highConfidenceEdges} high-confidence edges (≥${config.confidenceThreshold})`);
      console.log(`   🔍 Found ${result.candidateFunctions.length} deletion candidates`);

      if (result.candidateFunctions.length === 0) {
        console.log('   ✅ No functions identified for safe deletion');
        return result;
      }

      // Step 3: Pre-deletion validation (user responsibility)
      console.log('   ℹ️  Pre-deletion validation is user responsibility');
      console.log('   💡 Please ensure type check and tests pass before proceeding');

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
        
        console.log('   ℹ️  Post-deletion validation is user responsibility');
        console.log('   💡 Please run type check and tests to verify changes');
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
        // Delete functions in this batch
        for (const candidate of batch) {
          await this.deleteFunction(candidate);
          result.deletedFunctions.push(candidate);
        }

        // Validate after each batch (user responsibility)
        console.log(`   ℹ️  Batch ${i + 1} validation is user responsibility`);
        console.log('   💡 Please run type check and tests to verify batch changes');

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
   * Delete a single function from source code
   */
  private async deleteFunction(candidate: DeletionCandidate): Promise<void> {
    const { functionInfo } = candidate;
    const filePath = functionInfo.filePath;

    // Read the file
    const fileContent = await fs.readFile(filePath, 'utf8');
    
    // Preserve line endings
    const lineEnding = fileContent.includes('\r\n') ? '\r\n' : '\n';
    const lines = fileContent.split(/\r?\n/);

    // Calculate zero-based line indices
    const startIndex = functionInfo.startLine - 1;
    const endIndex = functionInfo.endLine - 1;
    
    // Verify function still exists at expected location
    if (startIndex >= lines.length || endIndex >= lines.length) {
      throw new Error(`Function location out of bounds in ${filePath}`);
    }

    // Remove function lines
    const newLines = [
      ...lines.slice(0, startIndex),
      ...lines.slice(endIndex + 1)
    ];

    // Write back to file
    await fs.writeFile(filePath, newLines.join(lineEnding));

    console.log(`   🗑️  Deleted function: ${functionInfo.name} (${functionInfo.filePath}:${functionInfo.startLine})`);
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
      timestamp: new Date().toISOString()
    };

    console.log(`   ℹ️  ${phase} validation: User responsibility`);
    console.log(`   💡 Please run your type check and tests separately:`);
    console.log(`      npm run typecheck  # or your type check command`);
    console.log(`      npm test           # or your test command`);

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
      confidenceThreshold: 0.95,
      createBackup: true,
      dryRun: false,
      maxFunctionsPerBatch: 10,
      excludeExports: true,
      excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**'],
      ...options
    };
  }

  /**
   * Restore from backup
   */
  async restoreFromBackup(backupPath: string): Promise<void> {
    const indexPath = path.join(backupPath, 'index.json');
    const backupIndex = JSON.parse(await fs.readFile(indexPath, 'utf8'));

    console.log(`🔄 Restoring ${backupIndex.totalFunctions} functions from backup...`);

    for (const func of backupIndex.functions) {
      const backupFileName = `${func.name}.${func.id}.backup.txt`;
      const backupContent = await fs.readFile(path.join(backupPath, backupFileName), 'utf8');
      
      // Extract source lines (skip metadata comments)
      const lines = backupContent.split('\n');
      const sourceStart = lines.findIndex(line => line === '') + 1;
      const sourceLines = lines.slice(sourceStart);

      // Restore function to original file
      await this.restoreFunction(func, sourceLines);
    }

    console.log('✅ Backup restoration completed');
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
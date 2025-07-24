#!/usr/bin/env tsx

/**
 * Script to safely delete modularized functions from pglite-adapter.ts
 * Uses SafeFunctionDeleter and funcqc database to identify extracted functions
 */

import { deleteFunctionsSafely } from '../src/tools/function-deleter';
import { PGLiteStorageAdapter } from '../src/storage/pglite-adapter';
import { DatabaseCore } from '../src/storage/modules/database-core';
import { PGlite } from '@electric-sql/pglite';
import chalk from 'chalk';

// Function patterns that have been modularized
const MODULARIZED_PATTERNS = [
  // Snapshot operations (moved to snapshot-operations.ts)
  '*snapshot*',
  'generateSnapshotId',
  'createSnapshotRecord',
  'mapRowToSnapshotInfo',
  'calculateSnapshotMetadata',
  
  // Embedding operations (moved to embedding-operations.ts)
  '*embedding*',
  'searchByEmbedding',
  
  // Refactoring operations (moved to refactoring-operations.ts)
  '*refactor*',
  'mapRowToRefactoringSession',
  'mapRowToRefactoringChangeset',
  
  // Call edge operations (moved to call-edge-operations.ts)
  'insertCallEdges*',
  'insertInternalCallEdges*',
  'getCallEdges*',
  'getInternalCallEdges*',
  'isInternalFunctionCalled',
  'getInternalCalleesByFunction',
  
  // Utility operations (moved to utility-operations.ts)
  'extractSourceFromContent',
  'normalizeFilePath',
  'generateId',
  'parseJsonSafely',
  'isValidSnapshotId',
  'isValidFunctionId',
  
  // Metrics operations (moved to metrics-operations.ts)
  'getMetrics*',
  'saveMetrics*',
  'updateMetrics*',
  'deleteMetrics*',
  
  // Lineage operations (moved to lineage-operations.ts)
  '*lineage*',
  'mapRowToLineage',
  
  // Function operations (moved to function-operations.ts)
  'getFunctions*',
  'saveFunctions*',
  'getFunction',
  'bulkInsertParameters',
  'bulkInsertMetrics',
  'insertFunctionRecord',
  'insertFunctionParameters',
  'insertFunctionMetrics',
  'getFunctionParameters',
  'mapRowToFunctionInfo',
  'buildFunctionQuery',
  'buildFilterClause',
  'buildOrderByClause',
];

async function main() {
  console.log(chalk.blue('🚀 Starting modularized function cleanup...'));
  
  try {
    // Initialize database connection to get function info
    const adapter = new PGLiteStorageAdapter('./data/funcqc.db');
    await adapter.init();
    
    // Get all functions from the original file
    const functions = await adapter.getFunctions('latest', {
      filters: [
        { field: 'file_path', operator: '=', value: 'src/storage/pglite-adapter.ts' }
      ]
    });
    
    if (functions.length === 0) {
      console.log(chalk.yellow('⚠️ No functions found in pglite-adapter.ts'));
      return;
    }
    
    console.log(chalk.green(`📊 Found ${functions.length} functions in pglite-adapter.ts`));
    
    // Filter functions that match modularized patterns
    const functionsToDelete = functions.filter(func => {
      return MODULARIZED_PATTERNS.some(pattern => {
        if (pattern.includes('*')) {
          const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
          return regex.test(func.name);
        }
        return func.name === pattern;
      });
    });
    
    console.log(chalk.cyan(`🎯 Identified ${functionsToDelete.length} functions for deletion:`));
    
    // Group by category for better visibility
    const categories = {
      snapshot: functionsToDelete.filter(f => /snapshot/i.test(f.name)),
      embedding: functionsToDelete.filter(f => /embedding/i.test(f.name)),
      refactoring: functionsToDelete.filter(f => /refactor/i.test(f.name)),
      callEdge: functionsToDelete.filter(f => /call.*edge|internal.*call/i.test(f.name)),
      utility: functionsToDelete.filter(f => /extract|normalize|generate|parse|valid/i.test(f.name)),
      metrics: functionsToDelete.filter(f => /metrics/i.test(f.name)),
      lineage: functionsToDelete.filter(f => /lineage/i.test(f.name)),
      function: functionsToDelete.filter(f => /^(get|save|bulk|insert|map).*function/i.test(f.name)),
    };
    
    for (const [category, categoryFunctions] of Object.entries(categories)) {
      if (categoryFunctions.length > 0) {
        console.log(chalk.magenta(`  📦 ${category}: ${categoryFunctions.length} functions`));
        categoryFunctions.forEach(f => {
          console.log(chalk.gray(`    - ${f.name} (${f.startLine}:${f.startColumn})`));
        });
      }
    }
    
    // Confirm deletion
    console.log(chalk.yellow('\n⚠️ This will permanently modify the source file.'));
    console.log(chalk.yellow('   A backup will be created automatically.'));
    
    // Proceed with deletion
    console.log(chalk.blue('\n🛠️ Starting safe deletion process...'));
    
    const result = await deleteFunctionsSafely(functionsToDelete, {
      dryRun: false,        // Actually delete
      backupFiles: true,    // Create backup
      verbose: true,        // Show detailed output
      skipJsDoc: false,     // Also remove JSDoc comments
    });
    
    // Report results
    console.log(chalk.green(`\n✅ Deletion completed successfully!`));
    console.log(chalk.cyan(`📊 Summary:`));
    console.log(chalk.white(`  - Functions deleted: ${result.functionsDeleted}`));
    console.log(chalk.white(`  - Files modified: ${result.filesModified.length}`));
    
    if (result.filesModified.length > 0) {
      console.log(chalk.gray(`  - Modified files:`));
      result.filesModified.forEach(file => {
        console.log(chalk.gray(`    * ${file}`));
      });
    }
    
    if (result.warnings.length > 0) {
      console.log(chalk.yellow(`  - Warnings: ${result.warnings.length}`));
      result.warnings.forEach(warning => {
        console.log(chalk.yellow(`    ⚠ ${warning}`));
      });
    }
    
    if (result.errors.length > 0) {
      console.log(chalk.red(`  - Errors: ${result.errors.length}`));
      result.errors.forEach(error => {
        console.log(chalk.red(`    ❌ ${error}`));
      });
    }
    
    // Verify remaining function count
    console.log(chalk.blue('\n🔍 Verifying remaining functions...'));
    
    // We need to scan again to get updated function count
    console.log(chalk.gray('💡 Tip: Run `npm run dev scan` to update the database with changes'));
    console.log(chalk.green('🎉 Phase 2 modularization cleanup completed!'));
    
    await adapter.close();
    
  } catch (error) {
    console.error(chalk.red('❌ Cleanup failed:'), error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}
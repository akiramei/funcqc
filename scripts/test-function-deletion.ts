#!/usr/bin/env tsx

/**
 * Test script for SafeFunctionDeleter with embedding functions
 * Safe test run before full cleanup
 */

import { deleteFunctionsSafely } from '../src/tools/function-deleter';
import chalk from 'chalk';

// Test with specific embedding functions (from our funcqc analysis)
const EMBEDDING_FUNCTIONS_TO_DELETE = [
  {
    id: '5c47e201-a567-46f9-97c0-cf78529cfbc0',
    name: 'saveEmbedding',
    filePath: 'src/storage/pglite-adapter.ts',
    startLine: 1541,
    endLine: 1568,
    startColumn: 0,
    endColumn: 0,
  },
  {
    id: 'a7bc4538-f9f1-478b-af23-b88d445ce7fe',
    name: 'getEmbedding',
    filePath: 'src/storage/pglite-adapter.ts',
    startLine: 1575,
    endLine: 1591,
    startColumn: 0,
    endColumn: 0,
  },
  {
    id: 'b6991aad-d632-4a29-b607-36c42aa58682',
    name: 'getEmbeddingStats',
    filePath: 'src/storage/pglite-adapter.ts',
    startLine: 1853,
    endLine: 1891,
    startColumn: 0,
    endColumn: 0,
  },
];

async function testDeletion() {
  console.log(chalk.blue('🧪 Testing SafeFunctionDeleter with embedding functions...'));
  
  try {
    // First, run in dry-run mode
    console.log(chalk.yellow('\n🔍 Step 1: Dry run (no actual changes)'));
    
    const dryRunResult = await deleteFunctionsSafely(EMBEDDING_FUNCTIONS_TO_DELETE as any, {
      dryRun: true,
      verbose: true,
      backupFiles: false,
    });
    
    console.log(chalk.cyan(`\n📊 Dry run results:`));
    console.log(chalk.white(`  - Success: ${dryRunResult.success}`));
    console.log(chalk.white(`  - Functions found: ${dryRunResult.functionsDeleted}`));
    console.log(chalk.white(`  - Files to modify: ${dryRunResult.filesModified.length}`));
    
    if (dryRunResult.errors.length > 0) {
      console.log(chalk.red(`  - Errors: ${dryRunResult.errors.join(', ')}`));
      return;
    }
    
    if (dryRunResult.warnings.length > 0) {
      console.log(chalk.yellow(`  - Warnings: ${dryRunResult.warnings.join(', ')}`));
    }
    
    // If dry run successful, proceed with actual deletion
    if (dryRunResult.success) {
      console.log(chalk.green('\n✅ Dry run successful! Proceeding with actual deletion...'));
      
      const actualResult = await deleteFunctionsSafely(EMBEDDING_FUNCTIONS_TO_DELETE as any, {
        dryRun: false,
        verbose: true,
        backupFiles: true,
        skipJsDoc: false,
      });
      
      console.log(chalk.green(`\n🎉 Actual deletion completed!`));
      console.log(chalk.cyan(`📊 Final results:`));
      console.log(chalk.white(`  - Success: ${actualResult.success}`));
      console.log(chalk.white(`  - Functions deleted: ${actualResult.functionsDeleted}`));
      console.log(chalk.white(`  - Files modified: ${actualResult.filesModified.length}`));
      
      if (actualResult.filesModified.length > 0) {
        console.log(chalk.gray(`  - Modified files:`));
        actualResult.filesModified.forEach(file => {
          console.log(chalk.gray(`    * ${file}`));
        });
      }
      
      if (actualResult.errors.length > 0) {
        console.log(chalk.red(`  - Errors: ${actualResult.errors.length}`));
        actualResult.errors.forEach(error => {
          console.log(chalk.red(`    ❌ ${error}`));
        });
      }
      
      console.log(chalk.blue('\n💡 Next steps:'));
      console.log(chalk.gray('  1. Check the modified file: src/storage/pglite-adapter.ts'));
      console.log(chalk.gray('  2. Verify backup was created'));
      console.log(chalk.gray('  3. Run tests to ensure functionality'));
      console.log(chalk.gray('  4. Run: npm run dev scan (to update database)'));
      
    } else {
      console.log(chalk.red('\n❌ Dry run failed. Not proceeding with deletion.'));
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Test deletion failed:'), error);
    process.exit(1);
  }
}

// Run the test
testDeletion().catch(console.error);
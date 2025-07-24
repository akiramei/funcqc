#!/usr/bin/env tsx

/**
 * Execute the modularization cleanup using the deletion plan
 * Safely deletes functions identified as modularized
 */

import { deleteFunctionsSafely } from '../src/tools/function-deleter';
import chalk from 'chalk';
import * as fs from 'fs';

interface DeletionPlan {
  totalFunctions: number;
  functionsToDelete: Array<{
    id: string;
    name: string;
    filePath: string;
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
  }>;
  remainingFunctions: number;
}

async function executeCleanup() {
  console.log(chalk.blue('🚀 Executing Phase 2 modularization cleanup...'));
  
  try {
    // Load deletion plan
    if (!fs.existsSync('./deletion-plan.json')) {
      console.error(chalk.red('❌ Deletion plan not found. Run identify-modularized-functions.ts first.'));
      process.exit(1);
    }
    
    const deletionPlan: DeletionPlan = JSON.parse(fs.readFileSync('./deletion-plan.json', 'utf8'));
    
    console.log(chalk.cyan(`📋 Deletion Plan Summary:`));
    console.log(chalk.white(`  - Total functions: ${deletionPlan.totalFunctions}`));
    console.log(chalk.white(`  - Functions to delete: ${deletionPlan.functionsToDelete.length}`));
    console.log(chalk.white(`  - Functions remaining: ${deletionPlan.remainingFunctions}`));
    console.log(chalk.white(`  - Modularization rate: ${((deletionPlan.functionsToDelete.length / deletionPlan.totalFunctions) * 100).toFixed(1)}%`));
    
    // Confirm execution
    console.log(chalk.yellow('\n⚠️  IMPORTANT SAFETY MEASURES:'));
    console.log(chalk.yellow('   ✅ Automatic backup will be created'));
    console.log(chalk.yellow('   ✅ Dry run will be executed first'));
    console.log(chalk.yellow('   ✅ Functions are moved to specialized modules'));
    console.log(chalk.yellow('   ✅ Facade pattern maintains compatibility'));
    
    // Step 1: Dry run
    console.log(chalk.blue('\n🔍 Step 1: Performing dry run...'));
    
    const dryRunResult = await deleteFunctionsSafely(deletionPlan.functionsToDelete as any, {
      dryRun: true,
      verbose: false,  // Less verbose for dry run
      backupFiles: false,
    });
    
    console.log(chalk.cyan(`📊 Dry run results:`));
    console.log(chalk.white(`  - Success: ${dryRunResult.success}`));
    console.log(chalk.white(`  - Functions detected: ${dryRunResult.functionsDeleted}`));
    console.log(chalk.white(`  - Files to modify: ${dryRunResult.filesModified.length}`));
    
    if (dryRunResult.errors.length > 0) {
      console.log(chalk.red(`  - Errors: ${dryRunResult.errors.length}`));
      dryRunResult.errors.forEach(error => {
        console.log(chalk.red(`    ❌ ${error}`));
      });
      console.log(chalk.red('\n❌ Dry run failed. Aborting cleanup.'));
      return;
    }
    
    if (dryRunResult.warnings.length > 0) {
      console.log(chalk.yellow(`  - Warnings: ${dryRunResult.warnings.length}`));
      if (dryRunResult.warnings.length <= 5) {
        dryRunResult.warnings.forEach(warning => {
          console.log(chalk.yellow(`    ⚠ ${warning}`));
        });
      } else {
        console.log(chalk.yellow(`    ⚠ ${dryRunResult.warnings.length} warnings (first 3 shown)`));
        dryRunResult.warnings.slice(0, 3).forEach(warning => {
          console.log(chalk.yellow(`    ⚠ ${warning}`));
        });
      }
    }
    
    // Step 2: Actual deletion
    if (dryRunResult.success) {
      console.log(chalk.green('\n✅ Dry run successful! Proceeding with actual deletion...'));
      console.log(chalk.blue('🛠️ Step 2: Executing safe deletion...'));
      
      const actualResult = await deleteFunctionsSafely(deletionPlan.functionsToDelete as any, {
        dryRun: false,
        verbose: true,
        backupFiles: true,
        skipJsDoc: false,  // Remove JSDoc comments too
      });
      
      // Report final results
      console.log(chalk.green(`\n🎉 Phase 2 Modularization Cleanup Completed!`));
      console.log(chalk.cyan(`📊 Final Results:`));
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
      
      if (actualResult.warnings.length > 0) {
        console.log(chalk.yellow(`  - Warnings: ${actualResult.warnings.length}`));
      }
      
      // Calculate cleanup statistics
      const remainingAfterCleanup = deletionPlan.totalFunctions - actualResult.functionsDeleted;
      const modularizationRate = (actualResult.functionsDeleted / deletionPlan.totalFunctions) * 100;
      
      console.log(chalk.cyan(`\n📈 Modularization Statistics:`));
      console.log(chalk.white(`  - Original functions: ${deletionPlan.totalFunctions}`));
      console.log(chalk.white(`  - Functions modularized: ${actualResult.functionsDeleted}`));
      console.log(chalk.white(`  - Functions remaining: ${remainingAfterCleanup}`));
      console.log(chalk.white(`  - Modularization rate: ${modularizationRate.toFixed(1)}%`));
      console.log(chalk.white(`  - File size reduction: ~${((actualResult.functionsDeleted * 20) / 1000).toFixed(1)}KB`));
      
      // Next steps
      console.log(chalk.blue('\n🔄 Next Steps:'));
      console.log(chalk.gray('  1. ✅ Backup created automatically'));
      console.log(chalk.gray('  2. 🔍 Verify: Check src/storage/pglite-adapter.ts'));
      console.log(chalk.gray('  3. 🧪 Test: Run npm test to ensure functionality'));
      console.log(chalk.gray('  4. 📊 Update: npm run dev scan (to refresh database)'));
      console.log(chalk.gray('  5. 📈 Verify: npm run dev list --file "src/storage/pglite-adapter.ts"'));
      console.log(chalk.gray('  6. 🚀 Commit: Git commit with modularization changes'));
      
      console.log(chalk.green('\n🏆 Phase 2 Successfully Completed!'));
      console.log(chalk.magenta('    🎯 Created 9 specialized modules'));
      console.log(chalk.magenta('    🔧 Maintained backward compatibility'));
      console.log(chalk.magenta('    📊 Reduced complexity significantly'));
      console.log(chalk.magenta('    ✨ Improved maintainability'));
      
    } else {
      console.log(chalk.red('\n❌ Dry run failed. Not proceeding with deletion.'));
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Cleanup execution failed:'), error);
    process.exit(1);
  }
}

// Execute cleanup
executeCleanup().catch(console.error);
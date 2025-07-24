#!/usr/bin/env tsx

/**
 * Script to identify functions that have been modularized
 * Uses funcqc database to get accurate function information
 */

import { execSync } from 'child_process';
import chalk from 'chalk';

// Patterns for functions that have been moved to modules
const MODULARIZED_PATTERNS = [
  // Snapshot operations
  { pattern: /.*snapshot.*/i, module: 'snapshot-operations' },
  { pattern: /^generateSnapshotId$/i, module: 'snapshot-operations' },
  { pattern: /^createSnapshotRecord$/i, module: 'snapshot-operations' },
  { pattern: /^mapRowToSnapshotInfo$/i, module: 'snapshot-operations' },
  { pattern: /^calculateSnapshotMetadata$/i, module: 'snapshot-operations' },
  
  // Embedding operations
  { pattern: /.*embedding.*/i, module: 'embedding-operations' },
  { pattern: /^searchByEmbedding$/i, module: 'embedding-operations' },
  
  // Refactoring operations
  { pattern: /.*refactor.*/i, module: 'refactoring-operations' },
  { pattern: /^mapRowToRefactoringSession$/i, module: 'refactoring-operations' },
  { pattern: /^mapRowToRefactoringChangeset$/i, module: 'refactoring-operations' },
  
  // Call edge operations
  { pattern: /^insertCallEdges/i, module: 'call-edge-operations' },
  { pattern: /^insertInternalCallEdges/i, module: 'call-edge-operations' },
  { pattern: /.*CallEdges.*/i, module: 'call-edge-operations' },
  { pattern: /.*InternalCall.*/i, module: 'call-edge-operations' },
  { pattern: /^isInternalFunctionCalled$/i, module: 'call-edge-operations' },
  
  // Utility operations
  { pattern: /^extractSourceFromContent$/i, module: 'utility-operations' },
  { pattern: /^normalizeFilePath$/i, module: 'utility-operations' },
  { pattern: /^parseJsonSafely$/i, module: 'utility-operations' },
  { pattern: /^isValid.*Id$/i, module: 'utility-operations' },
  
  // Lineage operations
  { pattern: /.*lineage.*/i, module: 'lineage-operations' },
  { pattern: /^mapRowToLineage$/i, module: 'lineage-operations' },
  
  // Function operations (be more specific to avoid false positives)
  { pattern: /^getFunctions$/i, module: 'function-operations' },
  { pattern: /^saveFunctions$/i, module: 'function-operations' },
  { pattern: /^getFunction$/i, module: 'function-operations' },
  { pattern: /^getFunctionsBySnapshot$/i, module: 'function-operations' },
  { pattern: /^bulkInsert(Parameters|Metrics)$/i, module: 'function-operations' },
  { pattern: /^insertFunction(Record|Parameters|Metrics)$/i, module: 'function-operations' },
  { pattern: /^getFunctionParameters$/i, module: 'function-operations' },
  { pattern: /^mapRowToFunctionInfo$/i, module: 'function-operations' },
  { pattern: /^build(Function|Filter|OrderBy).*$/i, module: 'function-operations' },
];

async function identifyModularizedFunctions() {
  console.log(chalk.blue('🔍 Identifying modularized functions in pglite-adapter.ts...'));
  
  try {
    // Get all functions from pglite-adapter.ts using funcqc
    const output = execSync(
      'npm run --silent dev -- list --file "src/storage/pglite-adapter.ts" --json',
      { encoding: 'utf8' }
    );
    
    const data = JSON.parse(output);
    const functions = data.functions;
    
    console.log(chalk.green(`📊 Found ${functions.length} total functions in pglite-adapter.ts`));
    
    // Categorize functions by module
    const categorizedFunctions = new Map<string, any[]>();
    const unmodularizedFunctions: any[] = [];
    
    for (const func of functions) {
      let matched = false;
      
      for (const { pattern, module } of MODULARIZED_PATTERNS) {
        if (pattern.test(func.name)) {
          if (!categorizedFunctions.has(module)) {
            categorizedFunctions.set(module, []);
          }
          categorizedFunctions.get(module)!.push(func);
          matched = true;
          break;
        }
      }
      
      if (!matched) {
        unmodularizedFunctions.push(func);
      }
    }
    
    // Display results
    console.log(chalk.cyan('\n📦 Functions to be deleted (by module):'));
    
    let totalToDelete = 0;
    for (const [module, moduleFunctions] of categorizedFunctions.entries()) {
      if (moduleFunctions.length > 0) {
        console.log(chalk.magenta(`\n  🗂️  ${module} (${moduleFunctions.length} functions):`));
        moduleFunctions.forEach(func => {
          console.log(chalk.gray(`    - ${func.name} (line ${func.startLine})`));
          totalToDelete++;
        });
      }
    }
    
    console.log(chalk.yellow(`\n📋 Functions remaining (not modularized): ${unmodularizedFunctions.length}`));
    if (unmodularizedFunctions.length <= 20) {
      unmodularizedFunctions.forEach(func => {
        console.log(chalk.gray(`  - ${func.name} (line ${func.startLine})`));
      });
    } else {
      console.log(chalk.gray(`  (${unmodularizedFunctions.length} functions - use 'funcqc list' for full list)`));
    }
    
    console.log(chalk.cyan(`\n📊 Summary:`));
    console.log(chalk.white(`  - Total functions: ${functions.length}`));
    console.log(chalk.white(`  - To be deleted: ${totalToDelete}`));
    console.log(chalk.white(`  - Remaining: ${unmodularizedFunctions.length}`));
    console.log(chalk.white(`  - Modularization: ${((totalToDelete / functions.length) * 100).toFixed(1)}%`));
    
    // Generate deletion script
    console.log(chalk.blue('\n🛠️ Preparing for deletion...'));
    
    const functionsToDelete: any[] = [];
    categorizedFunctions.forEach(moduleFunctions => {
      functionsToDelete.push(...moduleFunctions);
    });
    
    // Save deletion data to file for the cleanup script
    const fs = await import('fs');
    const deletionData = {
      totalFunctions: functions.length,
      functionsToDelete: functionsToDelete.map(func => ({
        id: func.id,
        name: func.name,
        filePath: func.filePath,
        startLine: func.startLine,
        endLine: func.endLine,
        startColumn: func.startColumn || 0,
        endColumn: func.endColumn || 0,
      })),
      remainingFunctions: unmodularizedFunctions.length,
    };
    
    fs.writeFileSync('./deletion-plan.json', JSON.stringify(deletionData, null, 2));
    console.log(chalk.green('💾 Deletion plan saved to: deletion-plan.json'));
    
    return deletionData;
    
  } catch (error) {
    console.error(chalk.red('❌ Failed to identify functions:'), error);
    process.exit(1);
  }
}

// Run the identification
identifyModularizedFunctions().catch(console.error);
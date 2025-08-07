import chalk from 'chalk';
import { CrossReference, EnrichedFunctionInfo, EnrichedTypeInfo, ValidationResult } from '../../../analyzers/type-function-linker';

/**
 * Integrated display utilities for showing types and functions together
 */
export class IntegratedDisplayUtils {

  /**
   * Display function with its type context information
   */
  static displayFunctionWithTypeContext(enrichedFunction: EnrichedFunctionInfo): void {
    console.log(chalk.cyan(`\n📋 Function: ${enrichedFunction.name}`));
    console.log(chalk.gray(`   File: ${enrichedFunction.filePath}:${enrichedFunction.startLine}`));
    
    // Basic function info (note: complexity metrics would need to be fetched separately)
    console.log(`   Signature: ${enrichedFunction.signature.substring(0, 50)}${enrichedFunction.signature.length > 50 ? '...' : ''}`);
    console.log(`   Lines: ${enrichedFunction.endLine - enrichedFunction.startLine + 1}`);
    
    // Type context information
    if (enrichedFunction.typeContext) {
      const ctx = enrichedFunction.typeContext;
      console.log(chalk.blue(`\n   🧩 Type Context:`));
      console.log(`      Type: ${ctx.typeName} (${ctx.memberKind})`);
      console.log(`      Kind: ${ctx.isClassMethod ? 'Class Method' : ctx.isInterfaceMethod ? 'Interface Method' : 'Unknown'}`);
      if (ctx.accessModifier) {
        console.log(`      Access: ${ctx.accessModifier}`);
      }
    } else {
      console.log(chalk.gray(`   🧩 Type Context: Not associated with any type`));
    }
  }

  /**
   * Display type with its function implementation health
   */
  static displayTypeWithFunctionHealth(enrichedType: EnrichedTypeInfo): void {
    console.log(chalk.cyan(`\n🧩 Type: ${enrichedType.name}`));
    console.log(chalk.gray(`   File: ${enrichedType.filePath}:${enrichedType.startLine}`));
    console.log(`   Kind: ${enrichedType.kind}`);
    console.log(`   Exported: ${enrichedType.isExported ? 'Yes' : 'No'}`);
    
    // Method quality information
    if (enrichedType.methodQuality) {
      const quality = enrichedType.methodQuality;
      console.log(chalk.blue(`\n   📊 Method Quality:`));
      console.log(`      Total Methods: ${quality.totalMethods}`);
      console.log(`      Linked Methods: ${quality.linkedMethods}`);
      
      if (quality.averageComplexity !== undefined) {
        console.log(`      Average Complexity: ${this.formatComplexity(quality.averageComplexity)}`);
      }
      
      if (quality.highRiskMethods.length > 0) {
        console.log(chalk.yellow(`      ⚠️  High Risk Methods: ${quality.highRiskMethods.length}`));
        for (const riskMethod of quality.highRiskMethods.slice(0, 3)) { // Show top 3
          console.log(chalk.red(`         • ${riskMethod.functionName}: ${riskMethod.riskFactors.join(', ')}`));
        }
        if (quality.highRiskMethods.length > 3) {
          console.log(chalk.gray(`         ... and ${quality.highRiskMethods.length - 3} more`));
        }
      }
    } else if (enrichedType.kind === 'class' || enrichedType.kind === 'interface') {
      console.log(chalk.gray(`   📊 Method Quality: No methods found`));
    }
  }

  /**
   * Generate cross-reference table showing type-function relationships
   */
  static generateCrossReferenceTable(crossRefs: CrossReference[]): void {
    if (crossRefs.length === 0) {
      console.log(chalk.gray('No cross-references found between types and functions.'));
      return;
    }

    console.log(chalk.cyan('\n🔗 Type-Function Cross References:'));
    console.log();

    // Group by type for better readability
    const refsByType = new Map<string, CrossReference[]>();
    for (const ref of crossRefs) {
      if (!refsByType.has(ref.typeName)) {
        refsByType.set(ref.typeName, []);
      }
      refsByType.get(ref.typeName)!.push(ref);
    }

    for (const [typeName, refs] of refsByType) {
      console.log(chalk.blue(`📋 ${typeName}:`));
      
      for (const ref of refs) {
        const statusIcon = this.getLinkageStatusIcon(ref.linkageStatus);
        const statusColor = this.getLinkageStatusColor(ref.linkageStatus);
        
        console.log(`   ${statusColor(statusIcon)} ${ref.functionName} (${ref.memberKind})`);
        
        if (ref.linkageStatus === 'linked' && ref.functionId) {
          console.log(chalk.gray(`      → Function ID: ${ref.functionId.substring(0, 8)}...`));
        }
      }
      console.log();
    }
  }

  /**
   * Display validation results for type-function linkage
   */
  static displayValidationResults(results: ValidationResult[]): void {
    if (results.length === 0) {
      console.log(chalk.gray('No validation results available.'));
      return;
    }

    console.log(chalk.cyan('\n✅ Type-Function Linkage Validation:'));
    console.log();

    // Sort by linkage score (worst first)
    const sortedResults = results.sort((a, b) => a.linkageScore - b.linkageScore);

    for (const result of sortedResults) {
      const scoreColor = result.linkageScore >= 0.8 ? chalk.green : 
                        result.linkageScore >= 0.6 ? chalk.yellow : chalk.red;
      
      console.log(`${scoreColor('■')} ${result.typeName} - Linkage: ${this.formatPercentage(result.linkageScore)}`);
      
      if (result.issues.length > 0) {
        for (const issue of result.issues) {
          const issueIcon = this.getIssueIcon(issue.severity);
          const issueColor = this.getIssueColor(issue.severity);
          console.log(`   ${issueColor(issueIcon)} ${issue.message}`);
        }
      }
      console.log();
    }
  }

  /**
   * Display integrated overview combining types and functions
   */
  static displayIntegratedOverview(
    types: EnrichedTypeInfo[], 
    functions: EnrichedFunctionInfo[],
    crossRefs: CrossReference[]
  ): void {
    console.log(chalk.cyan.bold('\n🎯 Integrated Type-Function Overview'));
    console.log('='.repeat(50));

    // Summary statistics
    const totalTypes = types.length;
    const totalFunctions = functions.length;
    const linkedFunctions = functions.filter(f => f.typeContext).length;
    const orphanedFunctions = totalFunctions - linkedFunctions;
    
    const typesWithMethods = types.filter(t => t.methodQuality && t.methodQuality.totalMethods > 0).length;
    
    console.log(chalk.blue('\n📊 Summary:'));
    console.log(`   Types: ${totalTypes} (${typesWithMethods} with methods)`);
    console.log(`   Functions: ${totalFunctions}`);
    console.log(`   Linked Functions: ${linkedFunctions} (${this.formatPercentage(
      totalFunctions > 0 ? linkedFunctions / totalFunctions : 0
    )})`);
    console.log(`   Standalone Functions: ${orphanedFunctions}`);
    console.log(`   Cross References: ${crossRefs.length}`);

    // Quality distribution
    if (types.some(t => t.methodQuality)) {
      console.log(chalk.blue('\n🎯 Quality Distribution:'));
      
      const highRiskTypes = types.filter(t => 
        t.methodQuality && t.methodQuality.highRiskMethods.length > 0
      ).length;
      
      console.log(`   Types with High-Risk Methods: ${highRiskTypes}`);
      
      if (highRiskTypes > 0) {
        console.log(chalk.yellow('   ⚠️  Consider refactoring high-risk methods for better maintainability'));
      }
    }

    // Integration health
    const linkageRate = crossRefs.filter(ref => ref.linkageStatus === 'linked').length / Math.max(crossRefs.length, 1);
    console.log(chalk.blue('\n🔗 Integration Health:'));
    console.log(`   Linkage Rate: ${this.formatPercentage(linkageRate)}`);
    
    if (linkageRate < 0.8) {
      console.log(chalk.yellow('   ⚠️  Low linkage rate detected - some type declarations may lack implementations'));
    } else {
      console.log(chalk.green('   ✅ Good integration between types and functions'));
    }
  }

  // Helper methods for formatting
  private static formatComplexity(complexity: number | undefined): string {
    if (complexity === undefined) return 'N/A';
    
    if (complexity <= 5) return chalk.green(complexity.toString());
    if (complexity <= 10) return chalk.yellow(complexity.toString());
    return chalk.red(complexity.toString());
  }

  private static formatPercentage(ratio: number): string {
    const percentage = Math.round(ratio * 100);
    if (percentage >= 80) return chalk.green(`${percentage}%`);
    if (percentage >= 60) return chalk.yellow(`${percentage}%`);
    return chalk.red(`${percentage}%`);
  }

  private static getLinkageStatusIcon(status: string): string {
    switch (status) {
      case 'linked': return '✅';
      case 'orphaned_type': return '❓';
      case 'orphaned_function': return '🔍';
      default: return '❔';
    }
  }

  private static getLinkageStatusColor(status: string): typeof chalk.green {
    switch (status) {
      case 'linked': return chalk.green;
      case 'orphaned_type': return chalk.yellow;
      case 'orphaned_function': return chalk.red;
      default: return chalk.gray;
    }
  }

  private static getIssueIcon(severity: string): string {
    switch (severity) {
      case 'error': return '❌';
      case 'warning': return '⚠️';
      case 'info': return 'ℹ️';
      default: return '📝';
    }
  }

  private static getIssueColor(severity: string): typeof chalk.red {
    switch (severity) {
      case 'error': return chalk.red;
      case 'warning': return chalk.yellow;
      case 'info': return chalk.blue;
      default: return chalk.gray;
    }
  }
}
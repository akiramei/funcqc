import chalk from 'chalk';
import { 
  TypeUsageAnalysis, 
  FunctionUsageGroup,
  CouplingAnalysis 
} from '../../../analyzers/type-function-linker';

/**
 * Display utilities for type usage analysis (information-oriented, non-prescriptive)
 */
export class UsageAnalysisDisplay {

  /**
   * Display type usage pattern analysis
   */
  static displayTypeUsageAnalysis(analysis: TypeUsageAnalysis): void {
    console.log(chalk.cyan.bold(`\n📊 Usage Pattern Analysis: ${analysis.typeName}`));
    console.log('='.repeat(50));

    this.displayPropertyAccessPatterns(analysis.propertyAccessPatterns);
    this.displayFunctionGroups(analysis.functionGroups);
    this.displayAccessContexts(analysis.accessContexts);
  }

  /**
   * Display property access patterns without recommendations
   */
  private static displayPropertyAccessPatterns(patterns: TypeUsageAnalysis['propertyAccessPatterns']): void {
    console.log(chalk.blue('\n🔗 Property Access Patterns:'));
    console.log('-'.repeat(30));

    if (patterns.alwaysTogether.length > 0) {
      console.log('\nAlways used together (>90% correlation):');
      for (const group of patterns.alwaysTogether.slice(0, 5)) {
        console.log(`  • {${group.properties.join(', ')}} - ${group.occurrences} times (${group.percentage.toFixed(1)}%)`);
      }
    }

    if (patterns.neverTogether.length > 0) {
      console.log('\nRarely used together (<10% correlation):');
      for (const group of patterns.neverTogether.slice(0, 5)) {
        console.log(`  • {${group.properties.join(', ')}} - ${group.occurrences} times (${group.percentage.toFixed(1)}%)`);
      }
    }

    console.log('\nUsage frequency:');
    for (const freq of patterns.frequency.slice(0, 10)) {
      const bar = this.createUsageBar(freq.percentage);
      console.log(`  ${freq.property.padEnd(20)} ${bar} ${freq.usageCount}/${freq.totalFunctions} functions (${freq.percentage.toFixed(1)}%)`);
    }

    if (patterns.correlations.length > 0) {
      console.log('\nTop correlations:');
      for (const corr of patterns.correlations.slice(0, 5)) {
        const strength = this.getCorrelationStrength(corr.correlation);
        console.log(`  ${corr.property1} ↔ ${corr.property2}: ${strength} (${(corr.correlation * 100).toFixed(1)}% correlation)`);
      }
    }
  }

  /**
   * Display function groupings by usage patterns
   */
  private static displayFunctionGroups(groups: { byUsagePattern: FunctionUsageGroup[] }): void {
    if (groups.byUsagePattern.length === 0) return;

    console.log(chalk.blue('\n👥 Function Groups by Usage Pattern:'));
    console.log('-'.repeat(35));

    for (const group of groups.byUsagePattern.slice(0, 5)) {
      console.log(`\n${group.groupName} (${group.functions.length} functions):`);
      for (const func of group.functions.slice(0, 3)) {
        const filePath = func.filePath.replace(process.cwd(), '');
        console.log(`  • ${func.name} (${filePath})`);
      }
      if (group.functions.length > 3) {
        console.log(chalk.gray(`    ... and ${group.functions.length - 3} more`));
      }
    }
  }

  /**
   * Display access contexts without judgment
   */
  private static displayAccessContexts(contexts: TypeUsageAnalysis['accessContexts']): void {
    console.log(chalk.blue('\n📈 Access Pattern Distribution:'));
    console.log('-'.repeat(30));

    const total = contexts.readOnly + contexts.modified + contexts.passedThrough;
    if (total > 0) {
      console.log(`Read-only access:    ${contexts.readOnly} times (${((contexts.readOnly / total) * 100).toFixed(1)}%)`);
      console.log(`Modified:            ${contexts.modified} times (${((contexts.modified / total) * 100).toFixed(1)}%)`);
      console.log(`Passed through:      ${contexts.passedThrough} times (${((contexts.passedThrough / total) * 100).toFixed(1)}%)`);
    }

    if (contexts.unused.length > 0) {
      console.log(`\nUnused properties:   ${contexts.unused.length}`);
      if (contexts.unused.length <= 5) {
        console.log(`  ${contexts.unused.join(', ')}`);
      } else {
        console.log(`  ${contexts.unused.slice(0, 5).join(', ')}, ... and ${contexts.unused.length - 5} more`);
      }
    }
  }

  /**
   * Display coupling analysis (factual, non-prescriptive)
   */
  static displayCouplingAnalysis(analyses: CouplingAnalysis[]): void {
    if (analyses.length === 0) return;

    console.log(chalk.cyan.bold('\n🔗 Coupling Analysis'));
    console.log('='.repeat(30));

    for (const analysis of analyses.slice(0, 10)) {
      if (analysis.overCoupledParameters.length === 0) continue;

      console.log(chalk.yellow(`\n📋 Function: ${analysis.functionName}`));
      
      for (const param of analysis.overCoupledParameters) {
        console.log(`\n  Parameter: ${param.parameterName} (${param.typeName})`);
        console.log(`  Total properties: ${param.totalProperties}`);
        console.log(`  Used properties: ${param.usedProperties.length} (${(param.usageRatio * 100).toFixed(1)}%)`);
        
        if (param.usedProperties.length <= 5) {
          console.log(`    Used: ${param.usedProperties.join(', ')}`);
        } else {
          console.log(`    Used: ${param.usedProperties.slice(0, 5).join(', ')}, ... and ${param.usedProperties.length - 5} more`);
        }

        if (param.unusedProperties.length <= 5) {
          console.log(chalk.gray(`    Unused: ${param.unusedProperties.join(', ')}`));
        } else {
          console.log(chalk.gray(`    Unused: ${param.unusedProperties.slice(0, 5).join(', ')}, ... and ${param.unusedProperties.length - 5} more`));
        }
      }
    }
  }

  /**
   * Create a visual usage bar
   */
  private static createUsageBar(percentage: number): string {
    const barLength = 20;
    const filledLength = Math.round((percentage / 100) * barLength);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
    
    if (percentage >= 80) return chalk.green(bar);
    if (percentage >= 50) return chalk.yellow(bar);
    return chalk.red(bar);
  }

  /**
   * Get correlation strength description
   */
  private static getCorrelationStrength(correlation: number): string {
    if (correlation >= 0.9) return chalk.green('Very Strong');
    if (correlation >= 0.7) return chalk.yellow('Strong');
    if (correlation >= 0.5) return chalk.yellow('Moderate');
    if (correlation >= 0.3) return chalk.gray('Weak');
    return chalk.gray('Very Weak');
  }

  /**
   * Generate usage matrix for a type
   */
  static displayUsageMatrix(
    typeName: string,
    properties: string[],
    functions: string[],
    usageMatrix: boolean[][]
  ): void {
    console.log(chalk.cyan.bold(`\n📊 Usage Matrix: ${typeName}`));
    console.log('='.repeat(Math.max(50, typeName.length + 20)));

    // Header
    const maxFuncNameLength = Math.max(...functions.map(f => f.length));
    const header = ' '.repeat(maxFuncNameLength + 2) + '│ ' + 
      properties.map(p => p.substring(0, 3).padEnd(3)).join(' │ ') + ' │';
    console.log(header);
    
    // Separator
    const separator = '─'.repeat(maxFuncNameLength + 2) + '┼' + 
      properties.map(() => '────').join('┼') + '┤';
    console.log(separator);

    // Rows
    for (let i = 0; i < functions.length && i < 20; i++) {
      const funcName = functions[i].padEnd(maxFuncNameLength);
      const row = funcName + ' │ ' +
        properties.map((_, j) => {
          const used = usageMatrix[i] && usageMatrix[i][j];
          return (used ? chalk.green(' ✓ ') : chalk.gray(' · ')).padEnd(3);
        }).join(' │ ') + ' │';
      console.log(row);
    }

    if (functions.length > 20) {
      console.log(chalk.gray(`... and ${functions.length - 20} more functions`));
    }

    // Summary
    console.log('\nObservations:');
    const propertyUsage = properties.map((prop, j) => {
      const usageCount = usageMatrix.filter(row => row && row[j]).length;
      return { prop, count: usageCount, percentage: (usageCount / functions.length) * 100 };
    });

    const mostUsed = propertyUsage.sort((a, b) => b.count - a.count)[0];
    const leastUsed = propertyUsage.sort((a, b) => a.count - b.count)[0];

    if (mostUsed) {
      console.log(`• Most used property: ${mostUsed.prop} (${mostUsed.count}/${functions.length} functions, ${mostUsed.percentage.toFixed(1)}%)`);
    }
    if (leastUsed && leastUsed.count < mostUsed.count) {
      console.log(`• Least used property: ${leastUsed.prop} (${leastUsed.count}/${functions.length} functions, ${leastUsed.percentage.toFixed(1)}%)`);
    }

    // Export suggestion
    console.log(chalk.blue('\nData export: ') + chalk.gray('Use --json flag to export raw data for further analysis'));
  }
}
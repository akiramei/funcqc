import { TypeDefinition } from '../../../analyzers/type-analyzer';
import { TypeDependency, CircularDependency } from '../../../analyzers/type-dependency-analyzer';
import { TypeQualityScore, TypeHealthReport } from '../../../analyzers/type-metrics-calculator';

/**
 * Sort types based on specified criteria
 */
export function sortTypes(types: TypeDefinition[], sortBy: string, desc?: boolean): TypeDefinition[] {
  const sorted = [...types].sort((a, b) => {
    let comparison = 0;
    
    switch (sortBy) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'fields': {
        const aFields = (a.metadata['propertyCount'] as number || 0) + (a.metadata['methodCount'] as number || 0);
        const bFields = (b.metadata['propertyCount'] as number || 0) + (b.metadata['methodCount'] as number || 0);
        comparison = aFields - bFields;
        break;
      }
      case 'complexity': {
        // Basic complexity heuristic
        const aComplexity = a.genericParameters.length + (a.typeText?.length || 0) / 100;
        const bComplexity = b.genericParameters.length + (b.typeText?.length || 0) / 100;
        comparison = aComplexity - bComplexity;
        break;
      }
      default:
        comparison = a.name.localeCompare(b.name);
    }
    
    return desc ? -comparison : comparison;
  });
  
  return sorted;
}

/**
 * Display types list in formatted output
 */
export function displayTypesList(types: TypeDefinition[], verbose?: boolean): void {
  if (!types || types.length === 0) {
    console.log('📭 No types found matching the criteria');
    return;
  }

  
  if (verbose === true) {
    displayTypesListVerbose(types);
  } else {
    displayTypesListTable(types);
  }
}

/**
 * Display types in table format (default)
 */
function displayTypesListTable(types: TypeDefinition[]): void {
  console.log(`\n📋 Found ${types.length} types:\n`);
  
  // Table header
  console.log('ID       Name                         Kind        Exp  LOC Pro Met File                         Line');
  console.log('──────── ──────────────────────────── ─────────── ─── ──── ─── ─── ──────────────────────────── ────');
  
  for (const type of types) {
    const id = shortenId(type.id);
    const name = padOrTruncate(type.name, 28);
    const kind = padOrTruncate(getKindText(type.kind), 11);
    const exportIcon = type.isExported ? '🌐' : '🔒';
    const loc = calculateLOC(type);
    const locStr = loc.toString().padStart(4);
    
    // Safe access to metadata properties
    const metadata = type.metadata || {};
    const props = ((metadata['propertyCount'] as number) ?? 0).toString().padStart(3);
    const methods = ((metadata['methodCount'] as number) ?? 0).toString().padStart(3);
    
    const file = shortenFilePath(type.filePath, 28);
    const line = type.startLine.toString().padStart(4);
    
    console.log(`${id} ${name} ${kind} ${exportIcon} ${locStr} ${props} ${methods} ${file} ${line}`);
  }
  
  console.log('');
}

/**
 * Display types in verbose format (original multi-line format)
 */
function displayTypesListVerbose(types: TypeDefinition[]): void {
  console.log(`\n📋 Found ${types.length} types:\n`);
  
  for (const type of types) {
    const kindIcon = getKindIcon(type.kind);
    const exportStatus = type.isExported ? '🌐' : '🔒';
    const genericStatus = type.isGeneric && type.genericParameters.length > 0 
      ? `<${type.genericParameters.join(', ')}>` 
      : '';
    
    console.log(`${kindIcon} ${exportStatus} ${type.name}${genericStatus}`);
    console.log(`   📁 ${type.filePath}:${type.startLine}`);
    console.log(`   🆔 ${type.id}`);
    
    // Safe access to metadata properties
    const metadata = type.metadata || {};
    const props = (metadata['propertyCount'] as number) ?? 0;
    const methods = (metadata['methodCount'] as number) ?? 0;
    
    if (props > 0 || methods > 0) {
      console.log(`   📊 ${props} properties, ${methods} methods`);
    }
    
    console.log('');
  }
}

/**
 * Shorten ID for display (first 8 characters)
 */
function shortenId(id: string): string {
  return id.substring(0, 8);
}

/**
 * Calculate Lines of Code for a type
 */
function calculateLOC(type: TypeDefinition): number {
  return type.endLine - type.startLine + 1;
}

/**
 * Get text representation of type kind
 */
function getKindText(kind: string): string {
  switch (kind) {
    case 'interface': return 'interface';
    case 'class': return 'class';
    case 'type_alias': return 'type';
    case 'enum': return 'enum';
    case 'namespace': return 'namespace';
    default: return kind;
  }
}

/**
 * Pad or truncate string to specified length
 */
function padOrTruncate(str: string, length: number): string {
  if (str.length > length) {
    return str.substring(0, length - 3) + '...';
  }
  return str.padEnd(length);
}

/**
 * Shorten file path for display
 */
function shortenFilePath(filePath: string, maxLength: number): string {
  // Remove common prefix and shorten
  const relativePath = filePath.replace(process.cwd() + '/', '');
  const srcPath = relativePath.replace(/^src\//, '');
  
  if (srcPath.length <= maxLength) {
    return srcPath.padEnd(maxLength);
  }
  
  // Shorten by keeping directory structure readable
  const parts = srcPath.split('/');
  if (parts.length > 1) {
    const fileName = parts[parts.length - 1];
    const dirParts = parts.slice(0, -1);
    
    // Try to fit as much as possible
    let shortened = fileName;
    for (let i = dirParts.length - 1; i >= 0; i--) {
      const candidate = dirParts[i] + '/' + shortened;
      if (candidate.length <= maxLength - 3) {
        shortened = candidate;
      } else {
        shortened = '...' + shortened;
        break;
      }
    }
    return shortened.padEnd(maxLength);
  }
  
  return (srcPath.substring(0, maxLength - 3) + '...').padEnd(maxLength);
}

/**
 * Display health report
 */
export function displayHealthReport(
  healthReport: TypeHealthReport,
  typeScores: TypeQualityScore[],
  verbose?: boolean,
  typeDefinitions?: TypeDefinition[],
  previousHealth?: Partial<TypeHealthReport & { date?: string; timestamp?: string }> | null,
  showLegend?: boolean
): void {
  // Show diff information if previous data exists
  const diffInfo = calculateDifference(healthReport, previousHealth || null);
  const diffText = diffInfo ? ` (${diffInfo.text} vs ${diffInfo.date})` : '';
  
  console.log(`\n🏥 Type Health Report${diffText}\n`);
  
  // Calculate component scores breakdown
  const componentScores = calculateComponentScores(typeScores);
  
  console.log(`📊 Overall Health .............. ${healthReport.overallHealth}/100`);
  if (componentScores.count > 0) {
    console.log(`┣╸ Complexity .................. ${componentScores.complexity}/100 ${getDirectionLabel(componentScores.complexity)} (p95=${componentScores.complexityP95}, worst=${componentScores.complexityWorst})`);
    console.log(`┣╸ Maintainability ............. ${componentScores.maintainability}/100 ${getDirectionLabel(componentScores.maintainability)}`);
    console.log(`┣╸ Design / CK-WMC ............. ${componentScores.design}/100 ${getDirectionLabel(componentScores.design)}`);
    console.log(`┗╸ Dependencies (Σ cycles=${healthReport.circularDependencies.length}) .. ${componentScores.dependency}/100 ${getDirectionLabel(componentScores.dependency)}`);
    
    // Show penalty breakdown for Dependencies if score is below 80
    if (componentScores.dependency < 80) {
      const penalties = analyzeDependencyPenalties(typeScores, healthReport);
      if (penalties.length > 0) {
        penalties.forEach(penalty => {
          console.log(`     • ${penalty}`);
        });
      }
    }
  }
  console.log(`📦 Total Types: ${healthReport.totalTypes}`);
  
  console.log(`\n🚨 Risk Distribution:`);
  const riskDiffs = calculateRiskDifference(healthReport.riskDistribution, previousHealth?.riskDistribution);
  console.log(`   🟢 Low Risk: ${healthReport.riskDistribution.low}${riskDiffs.low}`);
  console.log(`   🟡 Medium Risk: ${healthReport.riskDistribution.medium}${riskDiffs.medium}`);
  console.log(`   🟠 High Risk: ${healthReport.riskDistribution.high}${riskDiffs.high}`);
  console.log(`   🔴 Critical Risk: ${healthReport.riskDistribution.critical}${riskDiffs.critical}`);

  // Circular Dependencies - show top 3 with details
  if (healthReport.circularDependencies.length > 0) {
    console.log(`\n🔄 Example Circular Dependencies (${healthReport.circularDependencies.length} total):`);
    healthReport.circularDependencies.slice(0, 3).forEach((cycle, index) => {
      const severityIcon = cycle.severity === 'error' ? '🔴' : '🟡';
      console.log(`   ${index + 1}. ${severityIcon} ${cycle.typeNames.join(' → ')}`);
      if (cycle.typeNames.length > 2) {
        console.log(`      • ${cycle.typeNames.length} types in cycle`);
      }
    });
    
    if (healthReport.circularDependencies.length > 3) {
      console.log(`   ... and ${healthReport.circularDependencies.length - 3} more`);
      console.log(`   💡 Use \`types deps <typeName> --circular\` to investigate specific cycles`);
    }
  }

  // High Risk Types - show all high and critical risk types with type names and locations
  const highRiskTypes = typeScores.filter(score => 
    score.riskLevel === 'high' || score.riskLevel === 'critical'
  );
  
  if (highRiskTypes.length > 0) {
    console.log(`\n🔍 High-Risk Types (${highRiskTypes.length} total):`);
    highRiskTypes
      .sort((a, b) => b.riskScore - a.riskScore) // Sort by risk score descending (highest risk first)
      .forEach((score, index) => {
        const riskIcon = getRiskIcon(score.riskLevel);
        // Find the type definition to get file location
        const typeInfo = typeDefinitions?.find(t => t.name === score.typeName);
        const location = typeInfo ? ` (${shortenFilePath(typeInfo.filePath, 30)}:${typeInfo.startLine})` : '';
        
        console.log(`   ${index + 1}. ${riskIcon} ${score.typeName}${location} risk ${score.riskScore}/100`);
        
        // Show top 2 issues for this type
        if (score.issues.length > 0) {
          score.issues.slice(0, 2).forEach(issue => {
            const issueIcon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : '💡';
            console.log(`      • ${issueIcon} ${issue.message}`);
          });
        }
      });
  }

  const topIssues = healthReport.topIssues;
  if (topIssues.length > 0 && !highRiskTypes.length) {
    console.log(`\n⚠️  Top Issues:`);
    topIssues.slice(0, 5).forEach((issue, index: number) => {
      const severityIcon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : '💡';
      console.log(`   ${index + 1}. ${severityIcon} ${issue.message}`);
      if (issue.suggestion) {
        console.log(`      💡 ${issue.suggestion}`);
      }
    });
  }

  // Next Actions with specific CLI examples
  const recommendations = healthReport.recommendations;
  if (recommendations.length > 0 || highRiskTypes.length > 0) {
    console.log(`\n💡 Next Actions`);
    
    if (highRiskTypes.length > 0) {
      console.log(`  • \`types list --risk high --detail\` で詳細確認`);
      const firstHighRisk = highRiskTypes[0];
      console.log(`  • \`types deps ${firstHighRisk.typeName} --circular\` で依存サイクルを調査`);
      console.log(`  • 分割候補: ${highRiskTypes.slice(0, 3).map(t => t.typeName).join(', ')}`);
    }
    
    if (healthReport.circularDependencies.length > 0) {
      const firstCycle = healthReport.circularDependencies[0];
      if (firstCycle.typeNames.length > 0) {
        console.log(`  • \`types deps ${firstCycle.typeNames[0]} --depth 2\` で循環依存の詳細分析`);
      }
    }
    
    const missingDocsCount = typeScores.filter(s => 
      s.issues.some(issue => issue.message.includes('documentation') || issue.message.includes('JSDoc'))
    ).length;
    if (missingDocsCount > 0) {
      console.log(`  • JSDoc 追加候補: ${missingDocsCount} 未記載型（\`--missing-docs\`）`);
    }
    
    // Original recommendations
    if (recommendations.length > 0) {
      recommendations.forEach((rec: string) => {
        console.log(`  • ${rec}`);
      });
    }
  }

  // Thresholds information
  const thresholds = healthReport.thresholds;
  console.log(`\n使用閾値: ${thresholds.name || 'default'} (maxField=${thresholds.maxFieldCount}, maxDepth=${thresholds.maxNestingDepth}, ...) — \`--thresholds <path>\` で変更可`);
  
  // Show legend if requested
  if (showLegend) {
    displayLegend();
  }

  if (verbose && typeScores.length > 0) {
    console.log(`\n📋 Individual Type Scores:`);
    typeScores
      .sort((a, b) => a.overallScore - b.overallScore)
      .slice(0, 10)
      .forEach(score => {
        const riskIcon = getRiskIcon(score.riskLevel);
        console.log(`   ${riskIcon} ${score.typeName}: ${score.overallScore}/100`);
      });
  }
}

/**
 * Display circular dependencies
 */
export function displayCircularDependencies(circularDeps: CircularDependency[]): void {
  if (circularDeps.length === 0) {
    console.log('✅ No circular dependencies found');
    return;
  }

  console.log(`\n🔄 Found ${circularDeps.length} circular dependencies:\n`);
  
  circularDeps.forEach((cycle, index) => {
    const severityIcon = cycle.severity === 'error' ? '🔴' : '🟡';
    console.log(`${index + 1}. ${severityIcon} ${cycle.typeNames.join(' → ')}`);
  });
}

/**
 * Display type dependencies
 */
export function displayTypeDependencies(
  typeName: string,
  dependencies: TypeDependency[],
  _allTypes: TypeDefinition[]
): void {
  console.log(`\n🔗 Dependencies for type: ${typeName}\n`);
  
  if (dependencies.length === 0) {
    console.log('📭 No dependencies found');
    return;
  }

  dependencies.forEach((dep, index) => {
    const kindIcon = getDepKindIcon(dep.dependencyKind);
    console.log(`${index + 1}. ${kindIcon} ${dep.dependencyKind}: ${dep.targetTypeName}`);
    console.log(`   📁 ${dep.filePath}${dep.lineNumber ? `:${dep.lineNumber}` : ''}`);
  });
}

/**
 * Get icon for type kind
 */
export function getKindIcon(kind: string): string {
  switch (kind) {
    case 'interface': return '📐';
    case 'class': return '🏗️';
    case 'type_alias': return '🔗';
    case 'enum': return '📋';
    case 'namespace': return '📦';
    default: return '❓';
  }
}

/**
 * Get icon for risk level
 */
export function getRiskIcon(riskLevel: string): string {
  switch (riskLevel) {
    case 'low': return '🟢';
    case 'medium': return '🟡';
    case 'high': return '🟠';
    case 'critical': return '🔴';
    default: return '❓';
  }
}

/**
 * Get direction label for score (higher scores are better for health metrics)
 */
function getDirectionLabel(score: number): string {
  if (score >= 90) return '(↑ excellent)';
  if (score >= 70) return '(↑ good)';
  if (score >= 50) return '(→ fair)';
  if (score >= 30) return '(↓ needs work)';
  return '(↓ critical)';
}

/**
 * Analyze dependency penalties to explain low dependency scores
 */
function analyzeDependencyPenalties(typeScores: TypeQualityScore[], healthReport: TypeHealthReport): string[] {
  const penalties: string[] = [];
  
  // Check for common dependency issues
  const highCouplingTypes = typeScores.filter(s => 
    s.ckMetrics && s.ckMetrics.CBO > 10
  );
  if (highCouplingTypes.length > 0) {
    penalties.push(`High coupling: ${highCouplingTypes.length} types with >10 dependencies`);
  }
  
  // Check for circular dependencies
  if (healthReport.circularDependencies.length > 0) {
    penalties.push(`Circular dependencies: ${healthReport.circularDependencies.length} cycles detected`);
  }
  
  // Check for deeply nested types
  const deepTypes = typeScores.filter(s => 
    s.issues.some(issue => issue.message.includes('nesting depth'))
  );
  if (deepTypes.length > 0) {
    penalties.push(`Deep nesting: ${deepTypes.length} types exceed depth threshold`);
  }
  
  // Check for overly complex inheritance
  const complexInheritanceTypes = typeScores.filter(s =>
    s.ckMetrics && s.ckMetrics.DIT > 3
  );
  if (complexInheritanceTypes.length > 0) {
    penalties.push(`Deep inheritance: ${complexInheritanceTypes.length} types with >3 levels`);
  }
  
  return penalties;
}

/**
 * Calculate difference from previous health report
 */
function calculateDifference(current: TypeHealthReport, previous: Partial<TypeHealthReport & { date?: string; timestamp?: string }> | null): {
  text: string;
  date: string;
} | null {
  if (!previous || previous.overallHealth === undefined) return null;
  
  const diff = current.overallHealth - previous.overallHealth;
  const sign = diff > 0 ? '+' : '';
  const text = diff !== 0 ? `${sign}${diff} pts` : 'no change';
  const date = (previous as { date?: string; timestamp?: string }).date || 
              (previous as { date?: string; timestamp?: string }).timestamp?.split('T')[0] || 
              'previous';
  
  return { text, date };
}

/**
 * Calculate risk distribution differences
 */
function calculateRiskDifference(
  current: TypeHealthReport['riskDistribution'], 
  previous?: TypeHealthReport['riskDistribution']
): {
  low: string;
  medium: string;
  high: string;
  critical: string;
} {
  const diffs = { low: '', medium: '', high: '', critical: '' };
  
  if (!previous) return diffs;
  
  const keys = ['low', 'medium', 'high', 'critical'] as const;
  for (const key of keys) {
    const diff = current[key] - previous[key];
    if (diff !== 0) {
      const sign = diff > 0 ? '+' : '';
      diffs[key] = ` (${sign}${diff})`;
    }
  }
  
  return diffs;
}

/**
 * Calculate component scores breakdown
 */
function calculateComponentScores(typeScores: TypeQualityScore[]): {
  count: number;
  complexity: number;
  complexityP95: number;
  complexityWorst: number;
  maintainability: number;
  design: number;
  dependency: number;
} {
  if (typeScores.length === 0) {
    return {
      count: 0,
      complexity: 0,
      complexityP95: 0,
      complexityWorst: 0,
      maintainability: 0,
      design: 0,
      dependency: 0
    };
  }

  const complexityScores = typeScores.map(s => s.complexityScore).sort((a, b) => b - a);
  const maintainabilityScores = typeScores.map(s => s.maintainabilityScore);
  const designScores = typeScores.map(s => s.designScore);
  const ckScores = typeScores.map(s => s.ckScore);

  // Calculate percentiles and averages
  const p95Index = Math.floor(complexityScores.length * 0.05); // Top 5% (worst scores)
  const complexityP95 = complexityScores[p95Index] || complexityScores[0];
  const complexityWorst = complexityScores[0];

  return {
    count: typeScores.length,
    complexity: Math.round(complexityScores.reduce((a, b) => a + b, 0) / complexityScores.length),
    complexityP95,
    complexityWorst,
    maintainability: Math.round(maintainabilityScores.reduce((a, b) => a + b, 0) / maintainabilityScores.length),
    design: Math.round(designScores.reduce((a, b) => a + b, 0) / designScores.length),
    dependency: Math.round(ckScores.reduce((a, b) => a + b, 0) / ckScores.length)
  };
}

/**
 * Display legend for score ranges and risk levels
 */
function displayLegend(): void {
  console.log(`\n📖 Legend:`);
  console.log(`   Health Scores (0-100, higher = better):`);
  console.log(`   🟢 71-100: Low Risk       (↑ excellent/good)`);
  console.log(`   🟡 51-70:  Medium Risk    (→ fair)`);
  console.log(`   🟠 31-50:  High Risk      (↓ needs work)`);
  console.log(`   🔴 0-30:   Critical Risk  (↓ critical)`);
  console.log(`   `);
  console.log(`   Risk Scores (0-100, higher = worse):`);
  console.log(`   Risk Score = 100 - Health Score`);
  console.log(`   `);
  console.log(`   Score Direction Indicators:`);
  console.log(`   ↑ = Higher scores are better (health metrics)`);
  console.log(`   ↓ = Lower scores indicate problems`);
  console.log(`   → = Neutral/fair performance`);
}

/**
 * Get icon for dependency kind
 */
export function getDepKindIcon(kind: string): string {
  switch (kind) {
    case 'extends': return '⬆️';
    case 'implements': return '🔌';
    case 'property': return '📝';
    case 'parameter': return '📥';
    case 'return': return '📤';
    case 'union_member': return '🔀';
    case 'intersection_member': return '🔗';
    default: return '🔗';
  }
}
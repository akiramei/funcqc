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
  console.log('ID       Name                         Kind        Exp LOC Props Methods File                          Line');
  console.log('──────── ──────────────────────────── ─────────── ─── ─── ───── ─────── ───────────────────────────── ────');
  
  for (const type of types) {
    const id = shortenId(type.id);
    const name = padOrTruncate(type.name, 28);
    const kind = padOrTruncate(getKindText(type.kind), 11);
    const exportIcon = type.isExported ? '🌐' : '🔒';
    const loc = calculateLOC(type);
    const locStr = loc.toString().padStart(3);
    
    // Safe access to metadata properties
    const metadata = type.metadata || {};
    const props = ((metadata['propertyCount'] as number) ?? 0).toString().padStart(5);
    const methods = ((metadata['methodCount'] as number) ?? 0).toString().padStart(7);
    
    const file = shortenFilePath(type.filePath, 29);
    const line = type.startLine.toString().padStart(4);
    
    console.log(`${id} ${name} ${kind} ${exportIcon}   ${locStr} ${props} ${methods} ${file} ${line}`);
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
  const relativePath = filePath.replace('/mnt/c/Users/akira/source/repos/funcqc/', '');
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
  verbose?: boolean
): void {
  console.log(`\n🏥 Type Health Report\n`);
  console.log(`📊 Overall Health: ${healthReport.overallHealth}/100`);
  console.log(`📦 Total Types: ${healthReport.totalTypes}`);
  
  console.log(`\n🚨 Risk Distribution:`);
  console.log(`   🟢 Low Risk: ${healthReport.riskDistribution.low}`);
  console.log(`   🟡 Medium Risk: ${healthReport.riskDistribution.medium}`);
  console.log(`   🟠 High Risk: ${healthReport.riskDistribution.high}`);
  console.log(`   🔴 Critical Risk: ${healthReport.riskDistribution.critical}`);

  if (healthReport.circularDependencies.length > 0) {
    console.log(`\n🔄 Circular Dependencies: ${healthReport.circularDependencies.length}`);
  }

  const topIssues = healthReport.topIssues;
  if (topIssues.length > 0) {
    console.log(`\n⚠️  Top Issues:`);
    topIssues.slice(0, 5).forEach((issue, index: number) => {
      const severityIcon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : '💡';
      console.log(`   ${index + 1}. ${severityIcon} ${issue.message}`);
      if (issue.suggestion) {
        console.log(`      💡 ${issue.suggestion}`);
      }
    });
  }

  const recommendations = healthReport.recommendations;
  if (recommendations.length > 0) {
    console.log(`\n💡 Recommendations:`);
    recommendations.forEach((rec: string, index: number) => {
      console.log(`   ${index + 1}. ${rec}`);
    });
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
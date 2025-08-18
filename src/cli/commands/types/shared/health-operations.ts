import { TypeDefinition } from '../../../../types';
import { getHealthIcon, getTypeKindIcon } from './formatters';

/**
 * Type health report structure
 */
export interface TypeHealthReport {
  totalTypes: number;
  typeDistribution: Record<string, number>;
  complexityStats: {
    averageMembers: number;
    maxMembers: number;
    typesWithManyMembers: number;
  };
  couplingStats: {
    highCouplingTypes: number;
    averageUsageRatio: number;
  };
  overallHealth: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
}

/**
 * Calculate type health from database
 */
export function calculateTypeHealthFromDB(
  types: TypeDefinition[]
): TypeHealthReport {
  const totalTypes = types.length;
  
  // Type distribution
  const typeDistribution: Record<string, number> = {};
  for (const type of types) {
    typeDistribution[type.kind] = (typeDistribution[type.kind] || 0) + 1;
  }
  
  // Complexity stats (simplified)
  const complexityStats = {
    averageMembers: 0, // Would need to query type_members
    maxMembers: 0,
    typesWithManyMembers: 0
  };
  
  // Coupling stats (simplified)
  const couplingStats = {
    highCouplingTypes: 0,
    averageUsageRatio: 0
  };
  
  // Overall health assessment
  let overallHealth: TypeHealthReport['overallHealth'] = 'GOOD';
  if (totalTypes < 10) overallHealth = 'POOR';
  else if (totalTypes < 50) overallHealth = 'FAIR';
  else if (totalTypes > 200) overallHealth = 'EXCELLENT';
  
  return {
    totalTypes,
    typeDistribution,
    complexityStats,
    couplingStats,
    overallHealth
  };
}

/**
 * Display type health report in database format
 */
export function displayTypeHealthDB(report: TypeHealthReport, verbose?: boolean): void {
  console.log(`\n🏥 Type Health Report:\n`);
  console.log(`Overall Health: ${getHealthIcon(report.overallHealth)} ${report.overallHealth}`);
  console.log(`Total Types: ${report.totalTypes}`);
  
  console.log(`\nType Distribution:`);
  for (const [kind, count] of Object.entries(report.typeDistribution)) {
    const percentage = ((count / report.totalTypes) * 100).toFixed(1);
    console.log(`  ${getTypeKindIcon(kind)} ${kind}: ${count} (${percentage}%)`);
  }
  
  if (verbose) {
    console.log(`\nComplexity Statistics:`);
    console.log(`  Average Members: ${report.complexityStats.averageMembers}`);
    console.log(`  Max Members: ${report.complexityStats.maxMembers}`);
    console.log(`  Complex Types: ${report.complexityStats.typesWithManyMembers}`);
    
    console.log(`\nCoupling Statistics:`);
    console.log(`  High Coupling Types: ${report.couplingStats.highCouplingTypes}`);
    console.log(`  Average Usage Ratio: ${(report.couplingStats.averageUsageRatio * 100).toFixed(1)}%`);
  }
}


/**
 * Dependency Risk Analyzer
 * 
 * Analyzes type dependency patterns and change risk to identify
 * types that pose high risk due to coupling and volatility.
 */

import type { 
  StorageQueryInterface, 
  TypeDefinitionRow, 
  TypeRelationshipRow,
  SnapshotRow,
  CountRow,
  FunctionInfoRow 
} from './types.js';

export interface TypeDependencyInfo {
  typeId: string;
  typeName: string;
  fanIn: number;          // How many types depend on this type
  fanOut: number;         // How many types this type depends on
  dependents: string[];   // Types that depend on this type
  dependencies: string[]; // Types this type depends on
}

export interface ChurnInfo {
  changes90d: number;
  changes30d: number;
  avgDaysBetween: number;
  lastChangeDate: string;
  changeVelocity: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
}

export interface RiskFactors {
  centralityScore: number;  // PageRank-like centrality (0-1)
  volatilityScore: number;  // Based on change frequency (0-1)
  couplingScore: number;    // Based on fan-in/fan-out (0-1)
  overallRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface DependencyRiskAnalysis {
  typeId: string;
  typeName: string;
  dependencyInfo: TypeDependencyInfo;
  churn: ChurnInfo;
  riskFactors: RiskFactors;
  impactRadius: number;     // Estimated number of types affected by changes
  recommendations: string[];
}

export class DependencyRiskAnalyzer {
  private storage: StorageQueryInterface;

  constructor(storage: StorageQueryInterface) {
    this.storage = storage;
  }

  /**
   * Analyze dependency risk for a specific type
   */
  async analyzeDependencyRisk(
    typeId: string,
    snapshotId: string
  ): Promise<DependencyRiskAnalysis | null> {
    // Get type definition
    const typeResult = await this.storage.query(
      `SELECT * FROM type_definitions WHERE id = $1 AND snapshot_id = $2`,
      [typeId, snapshotId]
    );

    if (typeResult.rows.length === 0) {
      return null;
    }

    const type = typeResult.rows[0] as TypeDefinitionRow;

    // Analyze dependencies
    const dependencyInfo = await this.analyzeDependencies(typeId, snapshotId);

    // Analyze churn (change frequency)
    const churn = await this.analyzeChurn(type.name, typeId, snapshotId);

    // Calculate risk factors
    const riskFactors = this.calculateRiskFactors(dependencyInfo, churn);

    // Estimate impact radius
    const impactRadius = await this.calculateImpactRadius(typeId, snapshotId);

    // Generate recommendations
    const recommendations = this.generateRiskRecommendations(
      dependencyInfo,
      churn,
      riskFactors,
      impactRadius
    );

    return {
      typeId,
      typeName: type.name,
      dependencyInfo,
      churn,
      riskFactors,
      impactRadius,
      recommendations
    };
  }

  private async analyzeDependencies(typeId: string, snapshotId: string): Promise<TypeDependencyInfo> {
    // Get outgoing dependencies (types this type depends on)
    const outgoingResult = await this.storage.query(`
      SELECT DISTINCT tr.target_name, tr.target_type_id
      FROM type_relationships tr
      WHERE tr.source_type_id = $1 
        AND tr.snapshot_id = $2
        AND tr.relationship_kind IN ('extends', 'implements', 'references')
    `, [typeId, snapshotId]);

    const dependencies = outgoingResult.rows
      .map((row) => (row as TypeRelationshipRow).target_name)
      .filter(Boolean) as string[];

    // Get incoming dependencies (types that depend on this type)
    const incomingResult = await this.storage.query(`
      SELECT DISTINCT td.name, tr.source_type_id
      FROM type_relationships tr
      JOIN type_definitions td ON tr.source_type_id = td.id
      WHERE tr.target_type_id = $1 
        AND tr.snapshot_id = $2
        AND tr.relationship_kind IN ('extends', 'implements', 'references')
    `, [typeId, snapshotId]);

    interface NameRow {
      name: string;
    }
    
    const dependents = incomingResult.rows
      .map((row) => (row as NameRow).name)
      .filter(Boolean) as string[];

    // Also check for property usage dependencies
    const usageResult = await this.storage.query(`
      SELECT DISTINCT f.display_name as function_name, f.file_path
      FROM parameter_property_usage ppu
      JOIN functions f ON ppu.function_id = f.id
      WHERE ppu.parameter_type_id = $1 
        AND ppu.snapshot_id = $2
      ORDER BY f.file_path, f.display_name
    `, [typeId, snapshotId]);

    // Extract unique file-level dependencies
    const usageDependents = new Set<string>();
    for (const row of usageResult.rows) {
      const rowData = row as FunctionInfoRow;
      // Extract a simple identifier from file path
      const fileName = rowData.file_path.split('/').pop()?.replace(/\.(ts|js)$/, '') || rowData.file_path;
      usageDependents.add(fileName);
    }

    const allDependents = [...new Set([...dependents, ...Array.from(usageDependents)])];

    const typeNameResult = await this.storage.query(
      `SELECT name FROM type_definitions WHERE id = $1`,
      [typeId]
    );
    const typeName = (typeNameResult.rows[0] as NameRow | undefined)?.name || 'unknown';

    return {
      typeId,
      typeName,
      fanIn: allDependents.length,
      fanOut: dependencies.length,
      dependents: allDependents,
      dependencies
    };
  }

  private async analyzeChurn(typeName: string, _typeId: string, _snapshotId: string): Promise<ChurnInfo> {
    // Try to get change history from snapshots
    // This is a simplified implementation - in a real scenario, you'd integrate with Git
    const snapshotsResult = await this.storage.query(`
      SELECT s.created_at, s.label
      FROM snapshots s
      JOIN type_definitions td ON s.id = td.snapshot_id
      WHERE td.name = $1
      ORDER BY s.created_at DESC
      LIMIT 10
    `, [typeName]);

    const snapshots = snapshotsResult.rows as SnapshotRow[];
    const changes90d = Math.min(snapshots.length, 5); // Simplified approximation
    const changes30d = Math.min(snapshots.length, 2);
    
    let avgDaysBetween = 30; // Default assumption
    let changeVelocity: ChurnInfo['changeVelocity'] = 'LOW';
    
    if (snapshots.length >= 2) {
      const latest = new Date(snapshots[0].created_at);
      const oldest = new Date(snapshots[Math.min(snapshots.length - 1, 4)].created_at);
      const daysDiff = Math.max(1, Math.floor((latest.getTime() - oldest.getTime()) / (1000 * 60 * 60 * 24)));
      avgDaysBetween = Math.floor(daysDiff / Math.max(1, snapshots.length - 1));
    }

    // Determine change velocity
    if (avgDaysBetween < 7) {
      changeVelocity = 'VERY_HIGH';
    } else if (avgDaysBetween < 30) {
      changeVelocity = 'HIGH';
    } else if (avgDaysBetween < 90) {
      changeVelocity = 'MEDIUM';
    }

    return {
      changes90d,
      changes30d,
      avgDaysBetween,
      lastChangeDate: snapshots.length > 0 ? snapshots[0].created_at : '',
      changeVelocity
    };
  }

  private calculateRiskFactors(dependencyInfo: TypeDependencyInfo, churn: ChurnInfo): RiskFactors {
    // Calculate centrality score (based on fan-in)
    const centralityScore = Math.min(1, dependencyInfo.fanIn / 20); // Normalize to 0-1

    // Calculate volatility score (based on change frequency)
    let volatilityScore = 0;
    switch (churn.changeVelocity) {
      case 'VERY_HIGH': volatilityScore = 1.0; break;
      case 'HIGH': volatilityScore = 0.75; break;
      case 'MEDIUM': volatilityScore = 0.5; break;
      case 'LOW': volatilityScore = 0.25; break;
    }

    // Calculate coupling score (based on total fan-in + fan-out)
    const totalConnections = dependencyInfo.fanIn + dependencyInfo.fanOut;
    const couplingScore = Math.min(1, totalConnections / 30);

    // Calculate overall risk
    const riskScore = centralityScore * 0.4 + volatilityScore * 0.35 + couplingScore * 0.25;
    
    let overallRisk: RiskFactors['overallRisk'] = 'LOW';
    if (riskScore >= 0.8) {
      overallRisk = 'CRITICAL';
    } else if (riskScore >= 0.6) {
      overallRisk = 'HIGH';
    } else if (riskScore >= 0.4) {
      overallRisk = 'MEDIUM';
    }

    return {
      centralityScore,
      volatilityScore,
      couplingScore,
      overallRisk
    };
  }

  private async calculateImpactRadius(typeId: string, snapshotId: string): Promise<number> {
    // Calculate the potential impact radius if this type changes
    
    // Direct dependents
    const directResult = await this.storage.query(`
      SELECT COUNT(DISTINCT source_type_id) as direct_count
      FROM type_relationships
      WHERE target_type_id = $1 AND snapshot_id = $2
    `, [typeId, snapshotId]);
    
    const directImpact = parseInt((directResult.rows[0] as CountRow)?.direct_count || '0');

    // Usage-based dependents (functions using this type)
    const usageResult = await this.storage.query(`
      SELECT COUNT(DISTINCT function_id) as usage_count
      FROM parameter_property_usage
      WHERE parameter_type_id = $1 AND snapshot_id = $2
    `, [typeId, snapshotId]);
    
    const usageImpact = parseInt((usageResult.rows[0] as CountRow)?.usage_count || '0');

    // Estimate transitive impact (simplified: assume 2-level propagation)
    const transitiveMultiplier = directImpact > 5 ? 1.5 : 1.2;
    
    return Math.round((directImpact + usageImpact * 0.1) * transitiveMultiplier);
  }

  private generateRiskRecommendations(
    dependencyInfo: TypeDependencyInfo,
    churn: ChurnInfo,
    riskFactors: RiskFactors,
    impactRadius: number
  ): string[] {
    const recommendations: string[] = [];

    if (riskFactors.overallRisk === 'CRITICAL') {
      recommendations.push('🚨 CRITICAL: High-risk central type - urgent stabilization needed');
    }

    if (riskFactors.centralityScore > 0.7) {
      recommendations.push('Add facade layer to isolate dependents from changes');
    }

    if (riskFactors.volatilityScore > 0.7) {
      recommendations.push(`High change frequency (avg ${churn.avgDaysBetween} days) - consider API freeze`);
    }

    if (dependencyInfo.fanIn > 15) {
      recommendations.push(`${dependencyInfo.fanIn} dependents - break into smaller interfaces`);
    }

    if (dependencyInfo.fanOut > 10) {
      recommendations.push('High outgoing dependencies - consider dependency inversion');
    }

    if (impactRadius > 20) {
      recommendations.push(`Changes affect ~${impactRadius} components - implement adapter pattern`);
    }

    if (churn.changeVelocity === 'VERY_HIGH' && dependencyInfo.fanIn > 5) {
      recommendations.push('Volatile central type - add versioning or compatibility layer');
    }

    if (recommendations.length === 0) {
      recommendations.push('Low risk - current dependency pattern is manageable');
    }

    return recommendations;
  }

  /**
   * Format dependency risk analysis for display
   */
  formatDependencyRiskAnalysis(analysis: DependencyRiskAnalysis): string {
    const lines: string[] = [];
    
    lines.push(`\n⚠️  Dependency Risk Analysis for '${analysis.typeName}'\n`);
    
    // Risk overview
    const riskIcon = this.getRiskIcon(analysis.riskFactors.overallRisk);
    lines.push(`${riskIcon} Overall Risk: ${analysis.riskFactors.overallRisk}`);
    lines.push('');

    // Dependencies
    lines.push('🔗 Dependency Information:');
    lines.push(`  Fan-in: ${analysis.dependencyInfo.fanIn} types depend on this`);
    lines.push(`  Fan-out: ${analysis.dependencyInfo.fanOut} types this depends on`);
    lines.push(`  Impact Radius: ~${analysis.impactRadius} components affected by changes`);
    lines.push('');

    // Churn information
    lines.push('📈 Change Pattern:');
    lines.push(`  Recent Changes: ${analysis.churn.changes30d} (30d), ${analysis.churn.changes90d} (90d)`);
    lines.push(`  Change Velocity: ${analysis.churn.changeVelocity}`);
    lines.push(`  Avg Days Between: ${analysis.churn.avgDaysBetween}`);
    lines.push('');

    // Risk breakdown
    lines.push('📊 Risk Factors:');
    lines.push(`  Centrality: ${Math.round(analysis.riskFactors.centralityScore * 100)}% (fan-in based)`);
    lines.push(`  Volatility: ${Math.round(analysis.riskFactors.volatilityScore * 100)}% (change frequency)`);
    lines.push(`  Coupling: ${Math.round(analysis.riskFactors.couplingScore * 100)}% (total connections)`);
    lines.push('');

    // Top dependents
    if (analysis.dependencyInfo.dependents.length > 0) {
      lines.push('👥 Key Dependents:');
      const topDependents = analysis.dependencyInfo.dependents.slice(0, 5);
      topDependents.forEach(dependent => {
        lines.push(`  • ${dependent}`);
      });
      if (analysis.dependencyInfo.dependents.length > 5) {
        lines.push(`  ...and ${analysis.dependencyInfo.dependents.length - 5} more`);
      }
      lines.push('');
    }

    // Recommendations
    if (analysis.recommendations.length > 0) {
      lines.push('💡 Risk Mitigation:');
      analysis.recommendations.forEach((rec, index) => {
        lines.push(`  ${index + 1}. ${rec}`);
      });
      lines.push('');
    }

    return lines.join('\n');
  }

  private getRiskIcon(risk: RiskFactors['overallRisk']): string {
    switch (risk) {
      case 'CRITICAL': return '🚨';
      case 'HIGH': return '⚠️';
      case 'MEDIUM': return '⚡';
      case 'LOW': return '✅';
      default: return '❓';
    }
  }
}
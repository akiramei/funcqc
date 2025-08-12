/**
 * API Optimizer
 * 
 * Analyzes type API surface area to identify unused overloads,
 * unused setters, readonly candidates, and other optimization opportunities.
 */

import type { 
  StorageQueryInterface, 
  TypeDefinitionRow, 
  TypeMemberRow,
  CallEdgeRow,
  PropertyUsageRow 
} from './types.js';

export interface UnusedOverload {
  methodName: string;
  signature: string;
  callCount: number;
  memberId: string;
}

export interface UnusedSetter {
  propertyName: string;
  getterUsage: number;
  setterUsage: number;
  memberId: string;
}

export interface ReadonlyCandidate {
  propertyName: string;
  readCount: number;
  writeCount: number;
  reason: string;
}

export interface ApiOptimizationAnalysis {
  typeId: string;
  typeName: string;
  surfaceArea: {
    methods: number;
    properties: number;
    constructors: number;
    overloads: number;
    accessors: number;
  };
  unusedOverloads: UnusedOverload[];
  unusedSetters: UnusedSetter[];
  readonlyCandidates: ReadonlyCandidate[];
  excessiveMethods: boolean;
  recommendations: string[];
}

export class ApiOptimizer {
  private storage: StorageQueryInterface;

  constructor(storage: StorageQueryInterface) {
    this.storage = storage;
  }

  /**
   * Analyze API optimization opportunities
   */
  async analyzeApiOptimization(
    typeId: string,
    snapshotId: string
  ): Promise<ApiOptimizationAnalysis | null> {
    // Get type definition
    const typeResult = await this.storage.query(
      `SELECT * FROM type_definitions WHERE id = $1 AND snapshot_id = $2`,
      [typeId, snapshotId]
    );

    if (typeResult.rows.length === 0) {
      return null;
    }

    const type = typeResult.rows[0] as TypeDefinitionRow;

    // Get all type members
    const membersResult = await this.storage.query(`
      SELECT * FROM type_members 
      WHERE type_id = $1 AND snapshot_id = $2
      ORDER BY member_kind, name
    `, [typeId, snapshotId]);

    const members = membersResult.rows as TypeMemberRow[];

    // Calculate surface area
    const surfaceArea = this.calculateSurfaceArea(members);

    // Analyze unused overloads
    const unusedOverloads = await this.findUnusedOverloads(members, snapshotId);

    // Analyze unused setters
    const unusedSetters = await this.findUnusedSetters(members, typeId, snapshotId);

    // Find readonly candidates
    const readonlyCandidates = await this.findReadonlyCandidates(members, typeId, snapshotId);

    // Check for excessive methods (> 20)
    const excessiveMethods = surfaceArea.methods > 20;

    // Generate recommendations
    const recommendations = this.generateOptimizationRecommendations(
      unusedOverloads,
      unusedSetters,
      readonlyCandidates,
      excessiveMethods,
      surfaceArea
    );

    return {
      typeId,
      typeName: type.name,
      surfaceArea,
      unusedOverloads,
      unusedSetters,
      readonlyCandidates,
      excessiveMethods,
      recommendations
    };
  }

  private calculateSurfaceArea(members: TypeMemberRow[]): ApiOptimizationAnalysis['surfaceArea'] {
    const counts = {
      methods: 0,
      properties: 0,
      constructors: 0,
      overloads: 0,
      accessors: 0
    };

    const methodNames = new Map<string, number>();

    for (const member of members) {
      switch (member.member_kind) {
        case 'method': {
          counts.methods++;
          const count = methodNames.get(member.name) || 0;
          methodNames.set(member.name, count + 1);
          if (count > 0) {
            counts.overloads++;
          }
          break;
        }
        case 'property':
          counts.properties++;
          break;
        case 'constructor':
          counts.constructors++;
          break;
        case 'getter':
        case 'setter':
          counts.accessors++;
          break;
      }
    }

    return counts;
  }

  private async findUnusedOverloads(members: TypeMemberRow[], snapshotId: string): Promise<UnusedOverload[]> {
    const methodMembers = members.filter(m => m.member_kind === 'method');
    const unusedOverloads: UnusedOverload[] = [];

    // Group methods by name to identify overloads
    const methodGroups = new Map<string, TypeMemberRow[]>();
    for (const method of methodMembers) {
      if (!methodGroups.has(method.name)) {
        methodGroups.set(method.name, []);
      }
      methodGroups.get(method.name)!.push(method);
    }

    // Check each overload group
    for (const [methodName, overloads] of methodGroups) {
      if (overloads.length <= 1) continue; // No overloads

      // Check usage for each overload
      for (const overload of overloads) {
        if (!overload.function_id) continue;

        const callResult = await this.storage.query(`
          SELECT COUNT(*) as call_count
          FROM call_edges
          WHERE callee_function_id = $1 AND snapshot_id = $2
        `, [overload.function_id, snapshotId]);

        const callCount = parseInt((callResult.rows[0] as CallEdgeRow)?.call_count?.toString() || '0');
        
        if (callCount === 0) {
          unusedOverloads.push({
            methodName,
            signature: overload.type_text || 'unknown signature',
            callCount,
            memberId: overload.id
          });
        }
      }
    }

    return unusedOverloads;
  }

  private async findUnusedSetters(
    members: TypeMemberRow[], 
    typeId: string, 
    snapshotId: string
  ): Promise<UnusedSetter[]> {
    const unusedSetters: UnusedSetter[] = [];
    
    // Group getters and setters by property name
    const accessors = new Map<string, { getter?: TypeMemberRow; setter?: TypeMemberRow }>();
    
    for (const member of members) {
      if (member.member_kind === 'getter' || member.member_kind === 'setter') {
        if (!accessors.has(member.name)) {
          accessors.set(member.name, {});
        }
        const accessor = accessors.get(member.name)!;
        if (member.member_kind === 'getter') {
          accessor.getter = member;
        } else if (member.member_kind === 'setter') {
          accessor.setter = member;
        }
      }
    }

    // Check usage patterns for each accessor pair
    for (const [propName, { setter }] of accessors) {
      if (!setter) continue; // No setter to analyze

      // Check property usage from parameter_property_usage
      const usageResult = await this.storage.query(`
        SELECT 
          access_type,
          COUNT(*) as usage_count
        FROM parameter_property_usage 
        WHERE parameter_type_id = $1 
          AND snapshot_id = $2 
          AND accessed_property = $3
        GROUP BY access_type
      `, [typeId, snapshotId, propName]);

      let getterUsage = 0;
      let setterUsage = 0;

      for (const row of usageResult.rows) {
        const rowData = row as PropertyUsageRow;
        const count = parseInt(rowData.usage_count.toString());
        if (rowData.access_type === 'read') {
          getterUsage += count;
        } else if (rowData.access_type === 'write' || rowData.access_type === 'modify') {
          setterUsage += count;
        }
      }

      if (setterUsage === 0 && getterUsage > 0) {
        unusedSetters.push({
          propertyName: propName,
          getterUsage,
          setterUsage,
          memberId: setter.id
        });
      }
    }

    return unusedSetters;
  }

  private async findReadonlyCandidates(
    members: TypeMemberRow[],
    typeId: string,
    snapshotId: string
  ): Promise<ReadonlyCandidate[]> {
    const candidates: ReadonlyCandidate[] = [];
    const properties = members.filter(m => m.member_kind === 'property');

    for (const prop of properties) {
      // Skip if already readonly
      if (prop.is_readonly) continue;

      // Check usage pattern
      const usageResult = await this.storage.query(`
        SELECT 
          access_type,
          COUNT(*) as usage_count
        FROM parameter_property_usage 
        WHERE parameter_type_id = $1 
          AND snapshot_id = $2 
          AND accessed_property = $3
        GROUP BY access_type
      `, [typeId, snapshotId, prop.name]);

      let readCount = 0;
      let writeCount = 0;

      for (const row of usageResult.rows) {
        const rowData = row as PropertyUsageRow;
        const count = parseInt(rowData.usage_count.toString());
        if (rowData.access_type === 'read') {
          readCount += count;
        } else if (rowData.access_type === 'write' || rowData.access_type === 'modify') {
          writeCount += count;
        }
      }

      if (writeCount === 0 && readCount > 0) {
        candidates.push({
          propertyName: prop.name,
          readCount,
          writeCount,
          reason: `Read ${readCount} times, never written`
        });
      } else if (writeCount === 1 && readCount > 5) {
        // Possibly initialized once, then only read
        candidates.push({
          propertyName: prop.name,
          readCount,
          writeCount,
          reason: `Mostly read-only (${readCount}r/${writeCount}w) - consider readonly after init`
        });
      }
    }

    return candidates.sort((a, b) => b.readCount - a.readCount);
  }

  private generateOptimizationRecommendations(
    unusedOverloads: UnusedOverload[],
    unusedSetters: UnusedSetter[],
    readonlyCandidates: ReadonlyCandidate[],
    excessiveMethods: boolean,
    surfaceArea: ApiOptimizationAnalysis['surfaceArea']
  ): string[] {
    const recommendations: string[] = [];

    if (unusedOverloads.length > 0) {
      recommendations.push(
        `Remove unused overloads: ${unusedOverloads.slice(0, 3).map(o => `${o.methodName}()`).join(', ')}`
      );
    }

    if (unusedSetters.length > 0) {
      recommendations.push(
        `Remove unused setters: ${unusedSetters.slice(0, 3).map(s => s.propertyName).join(', ')}`
      );
    }

    if (readonlyCandidates.length > 0) {
      recommendations.push(
        `Make readonly: ${readonlyCandidates.slice(0, 3).map(r => r.propertyName).join(', ')}`
      );
    }

    if (excessiveMethods) {
      recommendations.push(
        `Consider splitting: ${surfaceArea.methods} methods exceed recommended limit (20)`
      );
    }

    if (surfaceArea.overloads > surfaceArea.methods * 0.5) {
      recommendations.push(
        'High overload density - consider consolidating with optional parameters'
      );
    }

    return recommendations;
  }

  /**
   * Format API optimization analysis for display
   */
  formatOptimizationAnalysis(analysis: ApiOptimizationAnalysis): string {
    const lines: string[] = [];
    
    lines.push(`\n🎯 API Optimization for type '${analysis.typeName}'\n`);
    
    // Surface area
    lines.push('📊 API Surface Area:');
    lines.push(`  Methods: ${analysis.surfaceArea.methods} (${analysis.surfaceArea.overloads} overloads)`);
    lines.push(`  Properties: ${analysis.surfaceArea.properties}`);
    lines.push(`  Constructors: ${analysis.surfaceArea.constructors}`);
    lines.push(`  Accessors: ${analysis.surfaceArea.accessors}`);
    lines.push('');

    // Unused overloads
    if (analysis.unusedOverloads.length > 0) {
      lines.push('🚫 Unused Overloads:');
      for (const overload of analysis.unusedOverloads.slice(0, 5)) {
        lines.push(`  ${overload.methodName}: ${overload.signature} (0 calls)`);
      }
      lines.push('');
    }

    // Unused setters
    if (analysis.unusedSetters.length > 0) {
      lines.push('🔒 Unused Setters:');
      for (const setter of analysis.unusedSetters.slice(0, 5)) {
        lines.push(`  ${setter.propertyName}: ${setter.getterUsage} reads, 0 writes`);
      }
      lines.push('');
    }

    // Readonly candidates
    if (analysis.readonlyCandidates.length > 0) {
      lines.push('📖 Readonly Candidates:');
      for (const candidate of analysis.readonlyCandidates.slice(0, 5)) {
        lines.push(`  ${candidate.propertyName}: ${candidate.reason}`);
      }
      lines.push('');
    }

    // Excessive methods warning
    if (analysis.excessiveMethods) {
      lines.push('⚠️  Large API Surface: Consider splitting into smaller interfaces');
      lines.push('');
    }

    // Recommendations
    if (analysis.recommendations.length > 0) {
      lines.push('💡 Optimization Opportunities:');
      analysis.recommendations.forEach((rec, index) => {
        lines.push(`  ${index + 1}. ${rec}`);
      });
      lines.push('');
    }

    return lines.join('\n');
  }
}
/**
 * Property Coverage Analyzer
 * 
 * Analyzes property usage patterns for types to identify hot properties,
 * unused properties, write hubs, and optimization opportunities.
 */

import type { 
  StorageQueryInterface, 
  PropertyUsageRow, 
  TypeDefinitionRow, 
  PropertyNameRow 
} from './types.js';

export interface PropertyUsageStats {
  property: string;
  totalCalls: number;
  readerCount: number;
  writerCount: number;
  modifierCount: number;
  passCount: number;
  callerFunctions: Set<string>;
  writerFunctions: Set<string>;
  isWriteHub: boolean;
}

export interface TypeCoverageAnalysis {
  typeId: string;
  typeName: string;
  totalProperties: number;
  usedProperties: number;
  hotProperties: PropertyUsageStats[];
  coldProperties: string[];
  writeHubs: PropertyUsageStats[];
  readOnlyCandidates: PropertyUsageStats[];
  recommendations: string[];
}

export interface CoverageAnalysisOptions {
  hotThreshold?: number;
  writeHubThreshold?: number;
  includePrivateProperties?: boolean;
}

export class CoverageAnalyzer {
  private storage: StorageQueryInterface;

  constructor(storage: StorageQueryInterface) {
    this.storage = storage;
  }

  /**
   * Analyze property coverage for a specific type
   */
  async analyzeTypeCoverage(
    typeId: string,
    snapshotId: string,
    options: CoverageAnalysisOptions = {}
  ): Promise<TypeCoverageAnalysis | null> {
    const {
      hotThreshold = 5,
      writeHubThreshold = 3,
      includePrivateProperties = false
    } = options;

    // Get type definition
    const typeResult = await this.storage.query(
      `SELECT * FROM type_definitions WHERE id = $1 AND snapshot_id = $2`,
      [typeId, snapshotId]
    );

    if (typeResult.rows.length === 0) {
      return null;
    }

    const type = typeResult.rows[0] as TypeDefinitionRow;

    // Get all properties for this type
    let propertyQuery = `
      SELECT name FROM type_members 
      WHERE type_id = $1 AND snapshot_id = $2 
      AND member_kind IN ('property', 'getter', 'setter')
    `;
    const propertyParams = [typeId, snapshotId];

    if (!includePrivateProperties) {
      propertyQuery += ` AND (access_modifier IS NULL OR access_modifier != 'private')`;
    }

    const propertiesResult = await this.storage.query(propertyQuery, propertyParams);
    const allProperties = new Set(propertiesResult.rows.map((row) => (row as PropertyNameRow).name));

    // Get property usage statistics
    const usageResult = await this.storage.query(`
      SELECT 
        accessed_property,
        access_type,
        function_id,
        COUNT(*) as usage_count
      FROM parameter_property_usage 
      WHERE parameter_type_id = $1 AND snapshot_id = $2
      GROUP BY accessed_property, access_type, function_id
      ORDER BY accessed_property, access_type
    `, [typeId, snapshotId]);

    // Process usage data
    const propertyUsageMap = new Map<string, PropertyUsageStats>();
    const usedProperties = new Set<string>();

    for (const row of usageResult.rows) {
      const { accessed_property, access_type, function_id, usage_count } = row as PropertyUsageRow;
      usedProperties.add(accessed_property);

      if (!propertyUsageMap.has(accessed_property)) {
        propertyUsageMap.set(accessed_property, {
          property: accessed_property,
          totalCalls: 0,
          readerCount: 0,
          writerCount: 0,
          modifierCount: 0,
          passCount: 0,
          callerFunctions: new Set(),
          writerFunctions: new Set(),
          isWriteHub: false
        });
      }

      const stats = propertyUsageMap.get(accessed_property)!;
      stats.totalCalls += usage_count;
      stats.callerFunctions.add(function_id);

      switch (access_type) {
        case 'read':
          stats.readerCount += usage_count;
          break;
        case 'write':
          stats.writerCount += usage_count;
          stats.writerFunctions.add(function_id);
          break;
        case 'modify':
          stats.modifierCount += usage_count;
          stats.writerFunctions.add(function_id);
          break;
        case 'pass':
          stats.passCount += usage_count;
          break;
      }
    }

    // Identify patterns
    const usageStats = Array.from(propertyUsageMap.values());
    const hotProperties = usageStats
      .filter(stats => stats.totalCalls >= hotThreshold)
      .sort((a, b) => b.totalCalls - a.totalCalls);

    const coldProperties = Array.from(allProperties)
      .filter(prop => !usedProperties.has(prop as string));

    const writeHubs = usageStats
      .filter(stats => stats.writerFunctions.size >= writeHubThreshold)
      .map(stats => ({ ...stats, isWriteHub: true }))
      .sort((a, b) => b.writerFunctions.size - a.writerFunctions.size);

    const readOnlyCandidates = usageStats
      .filter(stats => stats.writerCount === 0 && stats.readerCount > 0)
      .sort((a, b) => b.readerCount - a.readerCount);

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      coldProperties as string[],
      writeHubs,
      readOnlyCandidates,
      hotProperties
    );

    return {
      typeId,
      typeName: type.name,
      totalProperties: allProperties.size,
      usedProperties: usedProperties.size,
      hotProperties,
      coldProperties: coldProperties as string[],
      writeHubs,
      readOnlyCandidates,
      recommendations
    };
  }

  private generateRecommendations(
    coldProperties: string[],
    writeHubs: PropertyUsageStats[],
    readOnlyCandidates: PropertyUsageStats[],
    hotProperties: PropertyUsageStats[]
  ): string[] {
    const recommendations: string[] = [];

    if (coldProperties.length > 0) {
      recommendations.push(
        `Remove unused properties: ${coldProperties.slice(0, 3).join(', ')}${
          coldProperties.length > 3 ? ` (+${coldProperties.length - 3} more)` : ''
        }`
      );
    }

    if (writeHubs.length > 0) {
      recommendations.push(
        `Consider centralizing writes for: ${writeHubs.slice(0, 2).map(h => h.property).join(', ')}`
      );
    }

    if (readOnlyCandidates.length > 0) {
      recommendations.push(
        `Make readonly: ${readOnlyCandidates.slice(0, 3).map(r => r.property).join(', ')}`
      );
    }

    if (hotProperties.length > 5) {
      const dominant = hotProperties.slice(0, 2);
      recommendations.push(
        `Hot properties dominate usage: consider splitting around ${dominant.map(h => h.property).join(', ')}`
      );
    }

    return recommendations;
  }

  /**
   * Format coverage analysis for display
   */
  formatCoverageAnalysis(analysis: TypeCoverageAnalysis): string {
    const lines: string[] = [];
    
    lines.push(`\n🔥 Coverage Analysis for type '${analysis.typeName}'\n`);
    
    // Usage summary
    lines.push(`📊 Usage Summary:`);
    lines.push(`  Total Properties: ${analysis.totalProperties}`);
    lines.push(`  Used Properties:  ${analysis.usedProperties} (${Math.round(analysis.usedProperties/analysis.totalProperties*100)}%)`);
    lines.push('');

    // Hot properties
    if (analysis.hotProperties.length > 0) {
      lines.push('🔥 Hot Properties:');
      for (const prop of analysis.hotProperties.slice(0, 5)) {
        const readers = prop.totalCalls - prop.writerCount - prop.modifierCount;
        const writers = prop.writerFunctions.size;
        lines.push(`  ${prop.property}: ${prop.totalCalls} calls (${readers}r, ${writers}w)`);
      }
      lines.push('');
    }

    // Cold properties
    if (analysis.coldProperties.length > 0) {
      lines.push('❄️  Cold Properties (unused):');
      lines.push(`  ${analysis.coldProperties.slice(0, 5).join(', ')}`);
      if (analysis.coldProperties.length > 5) {
        lines.push(`  ...and ${analysis.coldProperties.length - 5} more`);
      }
      lines.push('');
    }

    // Write hubs
    if (analysis.writeHubs.length > 0) {
      lines.push('📝 Write Hubs:');
      for (const hub of analysis.writeHubs.slice(0, 3)) {
        lines.push(`  ${hub.property}: ${hub.writerFunctions.size} writers, ${hub.readerCount} readers`);
      }
      lines.push('');
    }

    // Readonly candidates
    if (analysis.readOnlyCandidates.length > 0) {
      lines.push('🔒 Readonly Candidates:');
      for (const candidate of analysis.readOnlyCandidates.slice(0, 5)) {
        lines.push(`  ${candidate.property}: ${candidate.readerCount} reads, 0 writes`);
      }
      lines.push('');
    }

    // Recommendations
    if (analysis.recommendations.length > 0) {
      lines.push('💡 Recommendations:');
      analysis.recommendations.forEach((rec, index) => {
        lines.push(`  ${index + 1}. ${rec}`);
      });
      lines.push('');
    }

    return lines.join('\n');
  }
}
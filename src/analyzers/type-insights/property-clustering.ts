/**
 * Property Clustering Analyzer
 * 
 * Analyzes property co-occurrence patterns to identify natural clusters
 * within types, suggesting potential Value Object refactoring opportunities.
 */

import type { 
  StorageQueryInterface, 
  TypeDefinitionRow, 
  PropertyNameRow 
} from './types.js';

export interface PropertyCluster {
  id: string;
  properties: string[];
  similarity: number;
  suggestedName: string;
  functions: Set<string>;
  cooccurrenceCount: number;
  totalFunctions: number;
  cohesion: number; // How tightly related the properties are
}

export interface PropertyCooccurrence {
  propertyA: string;
  propertyB: string;
  cooccurrenceCount: number;
  totalOccurrencesA: number;
  totalOccurrencesB: number;
  jaccardSimilarity: number;
}

export interface ClusteringAnalysis {
  typeId: string;
  typeName: string;
  totalProperties: number;
  clusters: PropertyCluster[];
  isolatedProperties: string[];
  clusterabilityScore: number; // 0-1, how well the type can be clustered
  recommendations: string[];
}

export class PropertyClusteringAnalyzer {
  private storage: StorageQueryInterface;
  private similarityThreshold = 0.7;
  private minClusterSize = 2;
  private maxClusters = 5;

  constructor(storage: StorageQueryInterface) {
    this.storage = storage;
  }

  /**
   * Set similarity threshold for clustering
   */
  setSimilarityThreshold(threshold: number): void {
    // 0〜1にクランプ
    if (!Number.isFinite(threshold)) threshold = 0.7;
    this.similarityThreshold = Math.max(0, Math.min(1, threshold));
  }

  /**
   * Set minimum cluster size
   */
  setMinClusterSize(size: number): void {
    // 1以上を保証
    if (!Number.isFinite(size)) size = 2;
    this.minClusterSize = Math.max(1, Math.floor(size));
  }

  /**
   * Analyze property clustering for a type
   */
  async analyzePropertyClustering(
    typeId: string,
    snapshotId: string
  ): Promise<ClusteringAnalysis | null> {
    // Get type definition
    const typeResult = await this.storage.query(
      `SELECT * FROM type_definitions WHERE id = $1 AND snapshot_id = $2`,
      [typeId, snapshotId]
    );

    if (typeResult.rows.length === 0) {
      return null;
    }

    const type = typeResult.rows[0] as TypeDefinitionRow;

    // Get property co-occurrence matrix
    const cooccurrences = await this.buildCooccurrenceMatrix(typeId, snapshotId);
    
    if (cooccurrences.length === 0) {
      return {
        typeId,
        typeName: type.name,
        totalProperties: 0,
        clusters: [],
        isolatedProperties: [],
        clusterabilityScore: 0,
        recommendations: ['No property usage data available for clustering']
      };
    }

    // Perform clustering
    const clusters = await this.performClustering(cooccurrences, typeId, snapshotId);

    // Find isolated properties
    const clusteredProperties = new Set<string>();
    clusters.forEach(cluster => cluster.properties.forEach(prop => clusteredProperties.add(prop)));
    
    const allProperties = await this.getAllTypeProperties(typeId, snapshotId);
    const isolatedProperties = allProperties.filter(prop => !clusteredProperties.has(prop));

    // Calculate clusterability score
    const clusterabilityScore = this.calculateClusterabilityScore(clusters, isolatedProperties.length, allProperties.length);

    // Generate recommendations
    const recommendations = this.generateClusteringRecommendations(clusters, isolatedProperties, clusterabilityScore);

    return {
      typeId,
      typeName: type.name,
      totalProperties: allProperties.length,
      clusters,
      isolatedProperties,
      clusterabilityScore,
      recommendations
    };
  }

  private async buildCooccurrenceMatrix(typeId: string, snapshotId: string): Promise<PropertyCooccurrence[]> {
    // Get all property usage pairs within the same function
    const result = await this.storage.query(`
      WITH property_pairs AS (
        SELECT DISTINCT
          p1.accessed_property as prop_a,
          p2.accessed_property as prop_b,
          p1.function_id
        FROM parameter_property_usage p1
        JOIN parameter_property_usage p2 ON p1.function_id = p2.function_id
        WHERE p1.parameter_type_id = $1 
          AND p2.parameter_type_id = $1
          AND p1.snapshot_id = $2
          AND p2.snapshot_id = $2
          AND p1.accessed_property < p2.accessed_property
      ),
      property_totals AS (
        SELECT 
          accessed_property,
          COUNT(DISTINCT function_id) as total_functions
        FROM parameter_property_usage
        WHERE parameter_type_id = $1 AND snapshot_id = $2
        GROUP BY accessed_property
      )
      SELECT 
        pp.prop_a,
        pp.prop_b,
        COUNT(*) as cooccurrence_count,
        pt1.total_functions as total_a,
        pt2.total_functions as total_b
      FROM property_pairs pp
      JOIN property_totals pt1 ON pp.prop_a = pt1.accessed_property
      JOIN property_totals pt2 ON pp.prop_b = pt2.accessed_property
      GROUP BY pp.prop_a, pp.prop_b, pt1.total_functions, pt2.total_functions
      HAVING COUNT(*) >= 2
      ORDER BY cooccurrence_count DESC
    `, [typeId, snapshotId]);

    interface CooccurrenceRow {
      prop_a: string;
      prop_b: string;
      cooccurrence_count: number;
      total_a: number;
      total_b: number;
    }

    return result.rows.map((row) => {
      const rowData = row as CooccurrenceRow;
      const union = rowData.total_a + rowData.total_b - rowData.cooccurrence_count;
      return {
        propertyA: rowData.prop_a,
        propertyB: rowData.prop_b,
        cooccurrenceCount: parseInt(rowData.cooccurrence_count.toString()),
        totalOccurrencesA: parseInt(rowData.total_a.toString()),
        totalOccurrencesB: parseInt(rowData.total_b.toString()),
        jaccardSimilarity: union > 0 ? rowData.cooccurrence_count / union : 0
      };
    });
  }

  private async performClustering(
    cooccurrences: PropertyCooccurrence[],
    typeId: string,
    snapshotId: string
  ): Promise<PropertyCluster[]> {
    // Build similarity graph
    const similarPairs = cooccurrences.filter(c => c.jaccardSimilarity >= this.similarityThreshold);
    
    // Chinese Whispers clustering algorithm (simplified)
    const propertyToCluster = new Map<string, string>();
    const clusters = new Map<string, Set<string>>();

    // Initialize each property as its own cluster
    for (const cooccurrence of cooccurrences) {
      if (!propertyToCluster.has(cooccurrence.propertyA)) {
        const clusterId = `cluster_${cooccurrence.propertyA}`;
        propertyToCluster.set(cooccurrence.propertyA, clusterId);
        clusters.set(clusterId, new Set([cooccurrence.propertyA]));
      }
      if (!propertyToCluster.has(cooccurrence.propertyB)) {
        const clusterId = `cluster_${cooccurrence.propertyB}`;
        propertyToCluster.set(cooccurrence.propertyB, clusterId);
        clusters.set(clusterId, new Set([cooccurrence.propertyB]));
      }
    }

    // Merge highly similar properties
    for (const pair of similarPairs) {
      const clusterA = propertyToCluster.get(pair.propertyA);
      const clusterB = propertyToCluster.get(pair.propertyB);
      
      if (clusterA && clusterB && clusterA !== clusterB) {
        // Merge smaller cluster into larger one
        const setA = clusters.get(clusterA)!;
        const setB = clusters.get(clusterB)!;
        
        if (setA.size >= setB.size) {
          // Merge B into A
          setB.forEach(prop => {
            setA.add(prop);
            propertyToCluster.set(prop, clusterA);
          });
          clusters.delete(clusterB);
        } else {
          // Merge A into B
          setA.forEach(prop => {
            setB.add(prop);
            propertyToCluster.set(prop, clusterB);
          });
          clusters.delete(clusterA);
        }
      }
    }

    // Convert to PropertyCluster objects
    const result: PropertyCluster[] = [];
    let clusterIndex = 0;

    for (const [_clusterId, properties] of clusters) {
      if (properties.size >= this.minClusterSize) {
        const clusterProps = Array.from(properties);
        const functions = await this.getClusterFunctions(clusterProps, typeId, snapshotId);
        
        result.push({
          id: `cluster_${clusterIndex++}`,
          properties: clusterProps,
          similarity: this.calculateClusterSimilarity(clusterProps, cooccurrences),
          suggestedName: this.generateClusterName(clusterProps),
          functions,
          cooccurrenceCount: this.getClusterCooccurrenceCount(clusterProps, cooccurrences),
          totalFunctions: functions.size,
          cohesion: this.calculateClusterCohesion(clusterProps, cooccurrences)
        });
      }
    }

    return result.sort((a, b) => b.similarity - a.similarity).slice(0, this.maxClusters);
  }

  private async getAllTypeProperties(typeId: string, snapshotId: string): Promise<string[]> {
    const result = await this.storage.query(`
      SELECT DISTINCT accessed_property
      FROM parameter_property_usage
      WHERE parameter_type_id = $1 AND snapshot_id = $2
      ORDER BY accessed_property
    `, [typeId, snapshotId]);
    
    return result.rows
      .map((row) => (row as PropertyNameRow).accessed_property)
      .filter((prop): prop is string => prop != null);
  }

  private async getClusterFunctions(
    properties: string[],
    typeId: string,
    snapshotId: string
  ): Promise<Set<string>> {
    if (properties.length === 0) return new Set();

    const placeholders = properties.map((_, i) => `$${i + 3}`).join(',');
    const result = await this.storage.query(`
      SELECT DISTINCT function_id
      FROM parameter_property_usage
      WHERE parameter_type_id = $1 
        AND snapshot_id = $2 
        AND accessed_property IN (${placeholders})
    `, [typeId, snapshotId, ...properties]);

    interface FunctionIdRow {
      function_id: string;
    }
    
    return new Set(result.rows.map((row) => (row as FunctionIdRow).function_id));
  }

  private calculateClusterSimilarity(properties: string[], cooccurrences: PropertyCooccurrence[]): number {
    if (properties.length < 2) return 0;

    let totalSimilarity = 0;
    let pairCount = 0;

    for (let i = 0; i < properties.length; i++) {
      for (let j = i + 1; j < properties.length; j++) {
        const propA = properties[i];
        const propB = properties[j];
        
        const cooccurrence = cooccurrences.find(c => 
          (c.propertyA === propA && c.propertyB === propB) ||
          (c.propertyA === propB && c.propertyB === propA)
        );
        
        if (cooccurrence) {
          totalSimilarity += cooccurrence.jaccardSimilarity;
          pairCount++;
        }
      }
    }

    return pairCount > 0 ? totalSimilarity / pairCount : 0;
  }

  private generateClusterName(properties: string[]): string {
    // Simple heuristic for generating meaningful cluster names
    const commonPrefixes = this.findCommonPrefix(properties);
    if (commonPrefixes.length >= 1) {
      return commonPrefixes[0].charAt(0).toUpperCase() + commonPrefixes[0].slice(1) + 'Slice';
    }

    // Domain-specific name generation
    if (properties.some(p => ['price', 'cost', 'amount', 'currency'].includes(p.toLowerCase()))) {
      return 'MoneySlice';
    }
    if (properties.some(p => ['start', 'end', 'time', 'date'].includes(p.toLowerCase()))) {
      return 'TimeSlice';
    }
    if (properties.some(p => ['x', 'y', 'z', 'width', 'height'].includes(p.toLowerCase()))) {
      return 'GeometrySlice';
    }

    return `${properties[0].charAt(0).toUpperCase()}${properties[0].slice(1)}Slice`;
  }

  private findCommonPrefix(properties: string[]): string[] {
    const prefixes = new Map<string, number>();
    
    for (const prop of properties) {
      for (let i = 2; i <= Math.min(prop.length, 6); i++) {
        const prefix = prop.substring(0, i);
        prefixes.set(prefix, (prefixes.get(prefix) || 0) + 1);
      }
    }

    return Array.from(prefixes.entries())
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([prefix]) => prefix);
  }

  private getClusterCooccurrenceCount(properties: string[], cooccurrences: PropertyCooccurrence[]): number {
    let totalCount = 0;
    for (const cooccurrence of cooccurrences) {
      if (properties.includes(cooccurrence.propertyA) && properties.includes(cooccurrence.propertyB)) {
        totalCount += cooccurrence.cooccurrenceCount;
      }
    }
    return totalCount;
  }

  private calculateClusterCohesion(properties: string[], cooccurrences: PropertyCooccurrence[]): number {
    if (properties.length < 2) return 0;
    
    const maxPossiblePairs = (properties.length * (properties.length - 1)) / 2;
    let actualPairs = 0;
    
    for (const cooccurrence of cooccurrences) {
      if (properties.includes(cooccurrence.propertyA) && properties.includes(cooccurrence.propertyB)) {
        actualPairs++;
      }
    }
    
    return actualPairs / maxPossiblePairs;
  }

  private calculateClusterabilityScore(clusters: PropertyCluster[], _isolatedCount: number, totalProperties: number): number {
    if (totalProperties === 0) return 0;
    
    const clusteredProperties = clusters.reduce((sum, cluster) => sum + cluster.properties.length, 0);
    const clusteringRatio = clusteredProperties / totalProperties;
    
    // Bonus for having well-formed clusters
    const avgClusterQuality = clusters.length > 0 ? 
      clusters.reduce((sum, c) => sum + c.similarity, 0) / clusters.length : 0;
    
    return Math.min(1, clusteringRatio * 0.7 + avgClusterQuality * 0.3);
  }

  private generateClusteringRecommendations(
    clusters: PropertyCluster[],
    isolatedProperties: string[],
    clusterabilityScore: number
  ): string[] {
    const recommendations: string[] = [];

    if (clusterabilityScore < 0.3) {
      recommendations.push('Low clustering potential - type may already be well-structured');
      return recommendations;
    }

    if (clusters.length >= 2) {
      const topClusters = clusters.slice(0, 2);
      recommendations.push(
        `Consider splitting into ${topClusters.map(c => c.suggestedName).join(' + ')}`
      );
    }

    for (const cluster of clusters.slice(0, 3)) {
      if (cluster.similarity > 0.8) {
        recommendations.push(
          `Extract ${cluster.suggestedName}: {${cluster.properties.join(', ')}} (${Math.round(cluster.similarity * 100)}% similarity)`
        );
      }
    }

    if (isolatedProperties.length > 0 && isolatedProperties.length < 4) {
      recommendations.push(
        `Isolated properties: ${isolatedProperties.join(', ')} - consider removal or grouping`
      );
    }

    return recommendations;
  }

  /**
   * Format clustering analysis for display
   */
  formatClusteringAnalysis(analysis: ClusteringAnalysis): string {
    const lines: string[] = [];
    
    lines.push(`\n🎯 Property Clustering Analysis for '${analysis.typeName}'\n`);
    
    // Overview
    lines.push('📊 Overview:');
    lines.push(`  Total Properties: ${analysis.totalProperties}`);
    lines.push(`  Clusters Found: ${analysis.clusters.length}`);
    lines.push(`  Isolated Properties: ${analysis.isolatedProperties.length}`);
    lines.push(`  Clusterability Score: ${Math.round(analysis.clusterabilityScore * 100)}%`);
    lines.push('');

    // Clusters
    if (analysis.clusters.length > 0) {
      lines.push('🎪 Property Clusters:');
      for (const cluster of analysis.clusters) {
        lines.push(`  ${cluster.suggestedName}: {${cluster.properties.join(', ')}} (${Math.round(cluster.similarity * 100)}% similarity)`);
        lines.push(`    Used together in ${cluster.totalFunctions} functions`);
      }
      lines.push('');
    }

    // Isolated properties
    if (analysis.isolatedProperties.length > 0) {
      lines.push('🏝️  Isolated Properties:');
      lines.push(`  ${analysis.isolatedProperties.join(', ')}`);
      lines.push('');
    }

    // Recommendations
    if (analysis.recommendations.length > 0) {
      lines.push('💡 Refactoring Recommendations:');
      analysis.recommendations.forEach((rec, index) => {
        lines.push(`  ${index + 1}. ${rec}`);
      });
      lines.push('');
    }

    return lines.join('\n');
  }
}
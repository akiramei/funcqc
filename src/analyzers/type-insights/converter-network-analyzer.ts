/**
 * Converter Network Analysis
 * 
 * Analyzes type conversion patterns in the codebase to identify:
 * - Converter functions (toX, fromY, parseZ, convertA)
 * - Type conversion graphs and networks
 * - Canonical types vs redundant types
 * - Conversion chains and optimization opportunities
 */

import { CrossTypeAnalyzer, CrossTypeAnalysisOptions, CrossTypePattern } from './cross-type-analyzer';
import type { StorageQueryInterface } from './types';

export interface ConverterNetworkOptions extends CrossTypeAnalysisOptions {
  minConverters: number;           // Minimum converters to form a network
  includeInternalCalls: boolean;   // Include internal function calls
  includeParsers: boolean;         // Include parse functions as converters
  showChains: boolean;            // Show conversion chains
  canonicalOnly: boolean;         // Show only canonical types
  maxChainLength: number;         // Maximum conversion chain length
}

export interface ConverterFunction {
  functionId: string;
  name: string;
  sourceType: string | null;      // Input type (from parameter)
  targetType: string | null;      // Output type (return type)
  converterType: 'to' | 'from' | 'parse' | 'convert' | 'transform';
  usageCount: number;             // How often this converter is used
  file: string;
  line: number;
}

export interface TypeNode {
  typeName: string;
  typeId: string | null;
  isCanonical: boolean;           // Is this the canonical/primary type?
  centralityScore: number;        // Network centrality score
  convertersIn: ConverterFunction[];   // Functions converting TO this type
  convertersOut: ConverterFunction[];  // Functions converting FROM this type
  totalConverters: number;
}

export interface ConversionChain {
  chainId: string;
  sourceType: string;
  targetType: string;
  steps: ConverterFunction[];
  totalUsage: number;
  efficiency: number;             // 1/steps.length
  canOptimize: boolean;           // Can be shortened with direct converter
}

export interface ConverterNetworkReport extends CrossTypePattern {
  nodes: TypeNode[];
  converters: ConverterFunction[];
  chains: ConversionChain[];
  statistics: {
    totalTypes: number;
    totalConverters: number;
    averageConvertersPerType: number;
    canonicalTypes: number;
    redundantTypes: number;
    longestChain: number;
    optimizableChains: number;
  };
}

export class ConverterNetworkAnalyzer extends CrossTypeAnalyzer {
  private converterOptions: ConverterNetworkOptions;

  constructor(
    storage: StorageQueryInterface,
    options: Partial<ConverterNetworkOptions> = {}
  ) {
    super(storage, options);
    
    this.converterOptions = {
      ...this.options,
      minConverters: options.minConverters ?? 2,
      includeInternalCalls: options.includeInternalCalls ?? true,
      includeParsers: options.includeParsers ?? true,
      showChains: options.showChains ?? false,
      canonicalOnly: options.canonicalOnly ?? false,
      maxChainLength: options.maxChainLength ?? 4,
      ...options
    };
  }

  /**
   * Main analysis method
   */
  async analyze(snapshotId?: string): Promise<ConverterNetworkReport[]> {
    try {
      // Load converter functions from database
      const converters = await this.loadConverterFunctions(snapshotId);
      
      if (converters.length === 0) {
        return [];
      }

      // Build type nodes and network graph
      const nodes = await this.buildTypeNodes(converters, snapshotId);
      
      // Analyze centrality and canonicality
      this.calculateCentralityScores(nodes);
      
      // Find conversion chains
      const chains = this.findConversionChains(nodes);
      
      // Generate report
      const report: ConverterNetworkReport = {
        id: 'converter-network',
        pattern: ['converter-functions'],
        support: converters.length,
        confidence: 1.0,
        lift: 1.0,
        types: nodes.map(n => n.typeId ?? n.typeName),
        suggestedAction: this.generateSuggestedActions(nodes, chains),
        impactScore: this.calculateImpactScore(nodes, chains),
        nodes: this.converterOptions.canonicalOnly ? 
          nodes.filter(n => n.isCanonical) : nodes,
        converters,
        chains: this.converterOptions.showChains ? chains : [],
        statistics: {
          totalTypes: nodes.length,
          totalConverters: converters.length,
          averageConvertersPerType: nodes.length > 0 ? converters.length / nodes.length : 0,
          canonicalTypes: nodes.filter(n => n.isCanonical).length,
          redundantTypes: nodes.filter(n => !n.isCanonical).length,
          longestChain: chains.length > 0 ? Math.max(...chains.map(c => c.steps.length)) : 0,
          optimizableChains: chains.filter(c => c.canOptimize).length
        }
      };

      return [report];
    } catch (error) {
      throw new Error(`Failed to analyze converter networks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load converter functions from the database
   */
  private async loadConverterFunctions(snapshotId?: string): Promise<ConverterFunction[]> {
    const baseQuery = `SELECT 
           f.id as function_id, 
           f.name, 
           f.return_type,
           f.file_path,
           f.line_number,
           COALESCE(ce.usage_count, 0) as usage_count
         FROM functions f
         LEFT JOIN (
           SELECT target_function_id, COUNT(*) as usage_count
           FROM call_edges ${snapshotId ? 'WHERE snapshot_id = $1' : ''}
           GROUP BY target_function_id
         ) ce ON f.id = ce.target_function_id
         WHERE ${snapshotId ? 'f.snapshot_id = $1 AND ' : ''}
           (
             f.name LIKE 'to%' OR 
             f.name LIKE 'from%' OR 
             f.name LIKE 'parse%' OR 
             f.name LIKE 'convert%' OR 
             f.name LIKE 'transform%'
           );`;
    const query = baseQuery;

    const result = await this.storage.query(query, snapshotId ? [snapshotId] : []);
    const converters: ConverterFunction[] = [];

    for (const row of result.rows) {
      const r = row as Record<string, unknown>;
      const functionName = r['name'] as string;
      
      // Determine converter type and extract type information
      const converterType = this.determineConverterType(functionName);
      if (!converterType) continue;

      // Skip if parsers are excluded
      if (converterType === 'parse' && !this.converterOptions.includeParsers) {
        continue;
      }

      // Get parameter types for source type detection
      const sourceType = await this.getSourceType(r['function_id'] as string, snapshotId);
      const targetType = this.extractTargetType(functionName, r['return_type'] as string);

      converters.push({
        functionId: r['function_id'] as string,
        name: functionName,
        sourceType,
        targetType,
        converterType,
        usageCount: Number(r['usage_count']) || 0,
        file: r['file_path'] as string,
        line: Number(r['line_number']) || 0
      });
    }

    return converters;
  }

  /**
   * Determine the type of converter based on function name
   */
  private determineConverterType(name: string): ConverterFunction['converterType'] | null {
    if (/^to[A-Z]/.test(name)) return 'to';
    if (/^from[A-Z]/.test(name)) return 'from';
    if (/^parse[A-Z]/.test(name)) return 'parse';
    if (/^convert/.test(name)) return 'convert';
    if (/^transform/.test(name)) return 'transform';
    return null;
  }

  /**
   * Extract target type from function name and return type
   */
  private extractTargetType(name: string, returnType: string): string | null {
    // Try to extract from function name first
    if (/^to([A-Z][a-zA-Z0-9]*)/.test(name)) {
      const match = name.match(/^to([A-Z][a-zA-Z0-9]*)/);
      return match?.[1] ?? null;
    }
    
    if (/^parse([A-Z][a-zA-Z0-9]*)/.test(name)) {
      const match = name.match(/^parse([A-Z][a-zA-Z0-9]*)/);
      return match?.[1] ?? null;
    }

    // Fallback to return type if available
    if (returnType && returnType !== 'void' && returnType !== 'any') {
      // Clean up complex types
      const cleanType = returnType.replace(/\s*\|\s*null\s*|\s*\|\s*undefined\s*/g, '')
                                  .replace(/^Promise<(.+)>$/, '$1')
                                  .trim();
      return cleanType || null;
    }

    return null;
  }

  /**
   * Get source type from function parameters
   */
  private async getSourceType(functionId: string, snapshotId?: string): Promise<string | null> {
    const query = snapshotId
      ? `SELECT type, type_simple FROM function_parameters 
         WHERE function_id = $1 AND snapshot_id = $2 
         ORDER BY position LIMIT 1`
      : `SELECT type, type_simple FROM function_parameters 
         WHERE function_id = $1 
         ORDER BY position LIMIT 1`;

    try {
      const result = await this.storage.query(
        query, 
        snapshotId ? [functionId, snapshotId] : [functionId]
      );

      if (result.rows.length > 0) {
        const r = result.rows[0] as Record<string, unknown>;
        const type = r['type'] as string;
        const typeSimple = r['type_simple'] as string;
        
        // Prefer detailed type, fallback to simple type
        return type && type !== 'any' ? type : (typeSimple || null);
      }
    } catch {
      // Ignore parameter lookup errors
    }

    return null;
  }

  /**
   * Build type nodes from converter functions
   */
  private async buildTypeNodes(converters: ConverterFunction[], snapshotId?: string): Promise<TypeNode[]> {
    const nodeMap = new Map<string, TypeNode>();

    // Create nodes for all types mentioned in converters
    for (const converter of converters) {
      // Process source type
      if (converter.sourceType) {
        if (!nodeMap.has(converter.sourceType)) {
          nodeMap.set(converter.sourceType, {
            typeName: converter.sourceType,
            typeId: await this.findTypeId(converter.sourceType, snapshotId),
            isCanonical: false, // Will be determined later
            centralityScore: 0,
            convertersIn: [],
            convertersOut: [],
            totalConverters: 0
          });
        }
        nodeMap.get(converter.sourceType)?.convertersOut.push(converter);
      }

      // Process target type
      if (converter.targetType) {
        if (!nodeMap.has(converter.targetType)) {
          nodeMap.set(converter.targetType, {
            typeName: converter.targetType,
            typeId: await this.findTypeId(converter.targetType, snapshotId),
            isCanonical: false, // Will be determined later
            centralityScore: 0,
            convertersIn: [],
            convertersOut: [],
            totalConverters: 0
          });
        }
        nodeMap.get(converter.targetType)?.convertersIn.push(converter);
      }
    }

    // Calculate total converters for each node
    for (const node of nodeMap.values()) {
      node.totalConverters = node.convertersIn.length + node.convertersOut.length;
    }

    // Filter nodes that meet minimum converter requirement
    const filteredNodes = Array.from(nodeMap.values())
      .filter(node => node.totalConverters >= this.converterOptions.minConverters);

    return filteredNodes;
  }

  /**
   * Find type ID for a type name
   */
  private async findTypeId(typeName: string, snapshotId?: string): Promise<string | null> {
    const query = snapshotId
      ? `SELECT id FROM type_definitions WHERE name = $1 AND snapshot_id = $2 LIMIT 1`
      : `SELECT id FROM type_definitions WHERE name = $1 LIMIT 1`;

    try {
      const result = await this.storage.query(
        query, 
        snapshotId ? [typeName, snapshotId] : [typeName]
      );
      
      if (result.rows.length > 0) {
        const r = result.rows[0] as Record<string, unknown>;
        return r['id'] as string;
      }
    } catch {
      // Ignore type ID lookup errors
    }

    return null;
  }

  /**
   * Calculate centrality scores and determine canonical types
   */
  private calculateCentralityScores(nodes: TypeNode[]): void {
    // Calculate weighted centrality based on converter usage
    for (const node of nodes) {
      const inWeight = node.convertersIn.reduce((sum, conv) => sum + (conv.usageCount || 1), 0);
      const outWeight = node.convertersOut.reduce((sum, conv) => sum + (conv.usageCount || 1), 0);
      
      // Centrality = total usage + converter count bonus
      node.centralityScore = inWeight + outWeight + (node.totalConverters * 2);
    }

    // Normalize centrality scores
    const maxCentrality = Math.max(...nodes.map(n => n.centralityScore));
    if (maxCentrality > 0) {
      for (const node of nodes) {
        node.centralityScore = node.centralityScore / maxCentrality;
      }
    }

    // Determine canonical types (top 50% by centrality)
    const sortedNodes = [...nodes].sort((a, b) => b.centralityScore - a.centralityScore);
    const canonicalThreshold = Math.max(0.5, sortedNodes.length > 0 ? sortedNodes[Math.floor(sortedNodes.length / 2)]?.centralityScore ?? 0 : 0);
    
    for (const node of nodes) {
      node.isCanonical = node.centralityScore >= canonicalThreshold;
    }
  }

  /**
   * Find conversion chains between types
   */
  private findConversionChains(nodes: TypeNode[]): ConversionChain[] {
    const chains: ConversionChain[] = [];
    
    // For each pair of types, try to find conversion paths
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const sourceNode = nodes[i];
        const targetNode = nodes[j];
        
        if (!sourceNode || !targetNode) continue;

        // Try to find path from source to target
        const pathForward = this.findConversionPath(
          sourceNode.typeName, 
          targetNode.typeName, 
          nodes, 
          new Set()
        );
        
        if (pathForward && pathForward.length > 1) {
          chains.push({
            chainId: `${sourceNode.typeName}-to-${targetNode.typeName}`,
            sourceType: sourceNode.typeName,
            targetType: targetNode.typeName,
            steps: pathForward,
            totalUsage: pathForward.reduce((sum, conv) => sum + (conv.usageCount || 1), 0),
            efficiency: 1 / pathForward.length,
            canOptimize: pathForward.length > 1 && this.hasDirectConverter(sourceNode.typeName, targetNode.typeName, nodes)
          });
        }

        // Try reverse direction
        const pathReverse = this.findConversionPath(
          targetNode.typeName, 
          sourceNode.typeName, 
          nodes, 
          new Set()
        );
        
        if (pathReverse && pathReverse.length > 1) {
          chains.push({
            chainId: `${targetNode.typeName}-to-${sourceNode.typeName}`,
            sourceType: targetNode.typeName,
            targetType: sourceNode.typeName,
            steps: pathReverse,
            totalUsage: pathReverse.reduce((sum, conv) => sum + (conv.usageCount || 1), 0),
            efficiency: 1 / pathReverse.length,
            canOptimize: pathReverse.length > 1 && this.hasDirectConverter(targetNode.typeName, sourceNode.typeName, nodes)
          });
        }
      }
    }

    return chains.filter(chain => chain.steps.length <= this.converterOptions.maxChainLength)
                 .sort((a, b) => b.totalUsage - a.totalUsage);
  }

  /**
   * Find conversion path between two types using BFS
   */
  private findConversionPath(
    sourceType: string, 
    targetType: string, 
    nodes: TypeNode[], 
    visited: Set<string>,
    currentPath: ConverterFunction[] = []
  ): ConverterFunction[] | null {
    if (visited.has(sourceType) || currentPath.length >= this.converterOptions.maxChainLength) {
      return null;
    }

    const sourceNode = nodes.find(n => n.typeName === sourceType);
    if (!sourceNode) return null;

    visited.add(sourceType);

    // Check for direct conversion
    for (const converter of sourceNode.convertersOut) {
      if (converter.targetType === targetType) {
        return [...currentPath, converter];
      }
    }

    // Try indirect paths
    for (const converter of sourceNode.convertersOut) {
      if (converter.targetType && !visited.has(converter.targetType)) {
        const subPath = this.findConversionPath(
          converter.targetType, 
          targetType, 
          nodes, 
          new Set(visited),
          [...currentPath, converter]
        );
        if (subPath) {
          return subPath;
        }
      }
    }

    return null;
  }

  /**
   * Check if there's a direct converter between two types
   */
  private hasDirectConverter(sourceType: string, targetType: string, nodes: TypeNode[]): boolean {
    const sourceNode = nodes.find(n => n.typeName === sourceType);
    if (!sourceNode) return false;

    return sourceNode.convertersOut.some(conv => conv.targetType === targetType);
  }

  /**
   * Generate suggested actions based on analysis
   */
  private generateSuggestedActions(nodes: TypeNode[], chains: ConversionChain[]): string {
    const suggestions: string[] = [];

    // Canonical type suggestions
    const canonicalTypes = nodes.filter(n => n.isCanonical);
    const redundantTypes = nodes.filter(n => !n.isCanonical);

    if (redundantTypes.length > 0) {
      suggestions.push(`Consider consolidating ${redundantTypes.length} redundant types into ${canonicalTypes.length} canonical types`);
    }

    // Chain optimization suggestions
    const optimizableChains = chains.filter(c => c.canOptimize);
    if (optimizableChains.length > 0) {
      suggestions.push(`${optimizableChains.length} conversion chains can be optimized with direct converters`);
    }

    // High-usage converter suggestions
    const highUsageConverters = nodes.flatMap(n => [...n.convertersIn, ...n.convertersOut])
      .filter(c => c.usageCount > 10)
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 3);

    if (highUsageConverters.length > 0) {
      suggestions.push(`Focus optimization on high-usage converters: ${highUsageConverters.map(c => c.name).join(', ')}`);
    }

    return suggestions.length > 0 ? suggestions.join('; ') : 'No specific optimization opportunities identified';
  }

  /**
   * Calculate impact score for the analysis
   */
  private calculateImpactScore(nodes: TypeNode[], chains: ConversionChain[]): number {
    let score = 0;

    // Base score from number of types and converters
    score += nodes.length * 2;
    score += nodes.reduce((sum, n) => sum + n.totalConverters, 0);

    // Bonus for optimization opportunities
    score += chains.filter(c => c.canOptimize).length * 5;

    // Bonus for high centrality differences (indicates consolidation opportunities)
    const centralityScores = nodes.map(n => n.centralityScore).sort((a, b) => b - a);
    if (centralityScores.length > 1) {
      const centralitySpread = centralityScores[0] - centralityScores[centralityScores.length - 1];
      score += Math.floor(centralitySpread * 20);
    }

    return Math.min(score, 100);
  }

  /**
   * Get configuration specific to converter analysis
   */
  getConverterConfiguration(): ConverterNetworkOptions {
    return { ...this.converterOptions };
  }
}
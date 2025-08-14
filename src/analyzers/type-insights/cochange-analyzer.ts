/**
 * Co-change Analysis
 * 
 * Analyzes co-evolution patterns of types by examining Git history to identify:
 * - Types that frequently change together (temporal coupling)
 * - Hidden dependencies between modules
 * - Optimal module boundaries based on change patterns
 * - Impact prediction for type modifications
 */

import { CrossTypeAnalyzer, CrossTypeAnalysisOptions, CrossTypePattern } from './cross-type-analyzer';
import type { StorageQueryInterface } from './types';

export interface CochangeAnalysisOptions extends CrossTypeAnalysisOptions {
  monthsBack: number;             // How far back to analyze (default: 6 months)
  minChanges: number;             // Minimum changes to consider a type (default: 2)
  cochangeThreshold: number;      // Threshold for co-change significance (0-1, default: 0.3)
  showMatrix: boolean;            // Show co-change matrix (default: false)
  suggestModules: boolean;        // Suggest module reorganization (default: true)
  maxCommits: number;             // Maximum commits to analyze (default: 1000)
  excludePaths: string[];         // Paths to exclude from analysis (default: [])
}

export interface TypeChangeInfo {
  typeId: string;
  typeName: string;
  filePath: string;
  changeCount: number;            // Total number of changes in period
  firstChange: Date;              // First change in analysis period
  lastChange: Date;               // Last change in analysis period
  changeFrequency: number;        // Changes per month
  volatility: number;             // Measure of change intensity (0-1)
}

export interface CochangeRelation {
  typeA: string;                  // First type name
  typeB: string;                  // Second type name
  cochangeFrequency: number;      // How often they changed together
  temporalCoupling: number;       // Strength of temporal coupling (0-1)
  symmetry: number;               // Bidirectional change symmetry (0-1)
  confidence: number;             // Statistical confidence of the relationship
  impactScore: number;            // Impact of breaking this coupling
}

export interface ModuleSuggestion {
  suggestedName: string;          // Suggested module name
  types: string[];                // Types that should be grouped
  cohesion: number;               // Internal cohesion score (0-1)
  coupling: number;               // External coupling score (0-1)
  rationale: string;              // Why these types should be grouped
  migrationEffort: 'low' | 'medium' | 'high'; // Estimated effort to implement
  benefits: string[];             // Expected benefits of this grouping
}

export interface CochangeAnalysisReport extends CrossTypePattern {
  typeChanges: TypeChangeInfo[];
  cochangeMatrix: CochangeRelation[];
  moduleSuggestions: ModuleSuggestion[];
  statistics: {
    totalTypes: number;
    analyzedCommits: number;
    timeSpan: string;
    averageChangesPerType: number;
    mostVolatileType: string;
    strongestCoupling: string;
    suggestedModuleCount: number;
  };
}

export interface GitCommitInfo {
  hash: string;
  date: Date;
  changedFiles: string[];
  message: string;
}

export interface GitProvider {
  getCommitHistory(options: {
    monthsBack: number;
    maxCommits: number;
    excludePaths: string[];
  }): Promise<GitCommitInfo[]>;
}

export class CochangeAnalyzer extends CrossTypeAnalyzer {
  private cochangeOptions: CochangeAnalysisOptions;
  private gitProvider: GitProvider | undefined;

  constructor(
    storage: StorageQueryInterface,
    gitProvider?: GitProvider,
    options: Partial<CochangeAnalysisOptions> = {}
  ) {
    super(storage, options);
    
    this.gitProvider = gitProvider;
    this.cochangeOptions = {
      ...this.options,
      monthsBack: options.monthsBack ?? 6,
      minChanges: options.minChanges ?? 2,
      cochangeThreshold: options.cochangeThreshold ?? 0.3,
      showMatrix: options.showMatrix ?? false,
      suggestModules: options.suggestModules ?? true,
      maxCommits: options.maxCommits ?? 1000,
      excludePaths: options.excludePaths ?? []
    };
  }

  /**
   * Main analysis method
   */
  async analyze(snapshotId?: string): Promise<CochangeAnalysisReport[]> {
    try {
      if (!this.gitProvider) {
        return [{
          id: 'cochange-analysis',
          pattern: ['git-history-required'],
          support: 0,
          confidence: 0,
          lift: 0,
          types: [],
          suggestedAction: 'Git provider required for co-change analysis',
          impactScore: 0,
          typeChanges: [],
          cochangeMatrix: [],
          moduleSuggestions: [],
          statistics: {
            totalTypes: 0,
            analyzedCommits: 0,
            timeSpan: '0 months',
            averageChangesPerType: 0,
            mostVolatileType: 'N/A',
            strongestCoupling: 'N/A',
            suggestedModuleCount: 0
          }
        }];
      }

      // Load type information and map to files
      const typeFileMap = await this.loadTypeFileMapping(snapshotId);
      
      if (typeFileMap.size === 0) {
        return [];
      }

      // Get Git commit history
      const commits = await this.gitProvider.getCommitHistory({
        monthsBack: this.cochangeOptions.monthsBack,
        maxCommits: this.cochangeOptions.maxCommits,
        excludePaths: this.cochangeOptions.excludePaths
      });

      // Analyze type changes
      const typeChanges = this.analyzeTypeChanges(commits, typeFileMap);
      
      // Calculate co-change relationships
      const cochangeMatrix = this.calculateCochangeMatrix(commits, typeFileMap, typeChanges);
      
      // Generate module suggestions
      const moduleSuggestions = this.cochangeOptions.suggestModules 
        ? this.generateModuleSuggestions(cochangeMatrix, typeChanges)
        : [];

      // Generate report
      const report: CochangeAnalysisReport = {
        id: 'cochange-analysis',
        pattern: ['temporal-coupling'],
        support: typeChanges.length,
        confidence: this.calculateOverallConfidence(cochangeMatrix),
        lift: 1.0,
        types: typeChanges.map(tc => tc.typeId),
        suggestedAction: this.generateSuggestedActions(cochangeMatrix, moduleSuggestions),
        impactScore: this.calculateImpactScore(typeChanges, cochangeMatrix),
        typeChanges: typeChanges.filter(tc => tc.changeCount >= this.cochangeOptions.minChanges),
        cochangeMatrix: this.cochangeOptions.showMatrix ? cochangeMatrix : 
          cochangeMatrix.filter(rel => rel.temporalCoupling >= this.cochangeOptions.cochangeThreshold),
        moduleSuggestions,
        statistics: {
          totalTypes: typeChanges.length,
          analyzedCommits: commits.length,
          timeSpan: `${this.cochangeOptions.monthsBack} months`,
          averageChangesPerType: typeChanges.length > 0 ? 
            typeChanges.reduce((sum, tc) => sum + tc.changeCount, 0) / typeChanges.length : 0,
          mostVolatileType: this.findMostVolatileType(typeChanges),
          strongestCoupling: this.findStrongestCoupling(cochangeMatrix),
          suggestedModuleCount: moduleSuggestions.length
        }
      };

      return [report];
    } catch (error) {
      throw new Error(`Failed to analyze co-change patterns: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Normalize file paths to handle various path formats consistently
   */
  private normalizePath(p: string): string {
    // 1) バックスラッシュ → スラッシュ
    // 2) 先頭の ./ を除去
    // 3) 先頭の /virtualsrc/ または virtualsrc/、/virtualsrc/src/ → src/
    // 4) 先頭のスラッシュを除去（/src/... → src/...）
    let np = (p ?? '').replace(/\\/g, '/');
    np = np.replace(/^\.\//, '');
    np = np.replace(/^\/?virtualsrc\/(?:src\/)?/, 'src/');
    np = np.replace(/^\/+/, '');
    return np;
  }

  /**
   * Load mapping of types to file paths
   */
  private async loadTypeFileMapping(snapshotId?: string): Promise<Map<string, { typeId: string; typeName: string }[]>> {
    const query = snapshotId
      ? `SELECT id, name, file_path FROM type_definitions WHERE snapshot_id = $1`
      : `SELECT id, name, file_path FROM type_definitions`;

    const result = await this.storage.query(query, snapshotId ? [snapshotId] : []);
    const typeFileMap = new Map<string, { typeId: string; typeName: string }[]>();

    for (const row of result.rows) {
      const r = row as Record<string, unknown>;
      const filePath = r['file_path'] as string;
      const typeId = r['id'] as string;
      const typeName = r['name'] as string;
      
      // Normalize file path for comparison with Git data
      const normalizedPath = this.normalizePath(filePath);
      
      // Support multiple type definitions per file
      if (!typeFileMap.has(normalizedPath)) {
        typeFileMap.set(normalizedPath, []);
      }
      typeFileMap.get(normalizedPath)?.push({ typeId, typeName });
    }

    return typeFileMap;
  }

  /**
   * Analyze type changes from commit history
   */
  private analyzeTypeChanges(
    commits: GitCommitInfo[], 
    typeFileMap: Map<string, { typeId: string; typeName: string }[]>
  ): TypeChangeInfo[] {
    const typeChanges = new Map<string, {
      changeCount: number;
      changeDates: Date[];
      filePath: string;
    }>();

    // Count changes for each type
    for (const commit of commits) {
      const normalizedChangedFiles = Array.from(
        new Set(commit.changedFiles.map(p => this.normalizePath(p)))
      );
      for (const normalizedPath of normalizedChangedFiles) {
        const typeInfos = typeFileMap.get(normalizedPath);
        
        if (typeInfos) {
          // Handle multiple type definitions per file
          for (const typeInfo of typeInfos) {
            if (!typeChanges.has(typeInfo.typeId)) {
              typeChanges.set(typeInfo.typeId, {
                changeCount: 0,
                changeDates: [],
                filePath: normalizedPath
              });
            }
            
            const changeInfo = typeChanges.get(typeInfo.typeId);
            if (changeInfo) {
              changeInfo.changeCount++;
              changeInfo.changeDates.push(commit.date);
            }
          }
        }
      }
    }

    // Convert to TypeChangeInfo array
    const result: TypeChangeInfo[] = [];
    const analysisEndDate = new Date();
    const analysisStartDate = new Date();
    analysisStartDate.setMonth(analysisStartDate.getMonth() - this.cochangeOptions.monthsBack);
    const monthsInPeriod = this.cochangeOptions.monthsBack;

    for (const [typeId, changeData] of typeChanges) {
      // Find type info from the nested arrays
      let typeInfo: { typeId: string; typeName: string } | undefined;
      for (const typeInfos of typeFileMap.values()) {
        typeInfo = typeInfos.find(t => t.typeId === typeId);
        if (typeInfo) break;
      }
      if (!typeInfo) continue;

      const sortedDates = changeData.changeDates.sort((a, b) => a.getTime() - b.getTime());
      
      result.push({
        typeId,
        typeName: typeInfo.typeName,
        filePath: changeData.filePath,
        changeCount: changeData.changeCount,
        firstChange: sortedDates[0] ?? analysisStartDate,
        lastChange: sortedDates[sortedDates.length - 1] ?? analysisEndDate,
        changeFrequency: changeData.changeCount / monthsInPeriod,
        volatility: Math.min(changeData.changeCount / (monthsInPeriod * 2), 1.0) // Normalize based on period
      });
    }

    return result.sort((a, b) => b.changeCount - a.changeCount);
  }

  /**
   * Calculate co-change matrix
   */
  private calculateCochangeMatrix(
    commits: GitCommitInfo[],
    typeFileMap: Map<string, { typeId: string; typeName: string }[]>,
    typeChanges: TypeChangeInfo[]
  ): CochangeRelation[] {
    const cochangeMap = new Map<string, number>();
    const totalChangesMap = new Map<string, number>();

    // Initialize change counts
    for (const typeChange of typeChanges) {
      totalChangesMap.set(typeChange.typeId, typeChange.changeCount);
    }

    // Count co-changes
    for (const commit of commits) {
      const changedTypes: string[] = [];
      const normalizedChangedFiles = Array.from(
        new Set(commit.changedFiles.map(p => this.normalizePath(p)))
      );
      for (const normalizedPath of normalizedChangedFiles) {
        const typeInfos = typeFileMap.get(normalizedPath);
        if (typeInfos) {
          // Handle multiple type definitions per file
          for (const typeInfo of typeInfos) {
            changedTypes.push(typeInfo.typeId);
          }
        }
      }

      // Count pairs that changed together
      for (let i = 0; i < changedTypes.length; i++) {
        for (let j = i + 1; j < changedTypes.length; j++) {
          const typeA = changedTypes[i];
          const typeB = changedTypes[j];
          
          if (typeA && typeB && typeA !== typeB) {
            const pairKey = [typeA, typeB].sort().join('|');
            cochangeMap.set(pairKey, (cochangeMap.get(pairKey) ?? 0) + 1);
          }
        }
      }
    }

    // Calculate relationships
    const relations: CochangeRelation[] = [];
    
    for (const [pairKey, cochangeCount] of cochangeMap) {
      const [typeAId, typeBId] = pairKey.split('|');
      if (!typeAId || !typeBId) continue;

      const typeAInfo = typeChanges.find(tc => tc.typeId === typeAId);
      const typeBInfo = typeChanges.find(tc => tc.typeId === typeBId);
      
      if (!typeAInfo || !typeBInfo) continue;

      const totalChangesA = totalChangesMap.get(typeAId) ?? 0;
      const totalChangesB = totalChangesMap.get(typeBId) ?? 0;

      if (totalChangesA === 0 || totalChangesB === 0) continue;

      // Use harmonic mean for better representation of temporal coupling
      const couplingA = cochangeCount / totalChangesA;
      const couplingB = cochangeCount / totalChangesB;
      const temporalCoupling = 2 * (couplingA * couplingB) / (couplingA + couplingB);

      const symmetry = 1 - Math.abs(
        (cochangeCount / totalChangesA) - (cochangeCount / totalChangesB)
      );

      const confidence = cochangeCount / Math.min(totalChangesA, totalChangesB);

      relations.push({
        typeA: typeAInfo.typeName,
        typeB: typeBInfo.typeName,
        cochangeFrequency: cochangeCount,
        temporalCoupling,
        symmetry,
        confidence,
        impactScore: temporalCoupling * (totalChangesA + totalChangesB) / 2
      });
    }

    return relations.sort((a, b) => b.temporalCoupling - a.temporalCoupling);
  }

  /**
   * Generate module suggestions based on co-change patterns
   */
  private generateModuleSuggestions(
    cochangeMatrix: CochangeRelation[],
    _typeChanges: TypeChangeInfo[]
  ): ModuleSuggestion[] {
    const suggestions: ModuleSuggestion[] = [];
    const highCouplingThreshold = 0.6;
    const processedTypes = new Set<string>();

    // Group highly coupled types
    for (const relation of cochangeMatrix) {
      if (relation.temporalCoupling >= highCouplingThreshold) {
        if (!processedTypes.has(relation.typeA) && !processedTypes.has(relation.typeB)) {
          // Find all related types for this cluster
          const cluster = this.findTypeCluster(relation.typeA, cochangeMatrix, highCouplingThreshold);
          
          if (cluster.length >= 2) {
            const avgCoupling = cluster.reduce((sum, type) => {
              const relatedRelations = cochangeMatrix.filter(r => 
                (r.typeA === type || r.typeB === type) && 
                (cluster.includes(r.typeA) || cluster.includes(r.typeB))
              );
              return sum + relatedRelations.reduce((s, r) => s + r.temporalCoupling, 0) / relatedRelations.length;
            }, 0) / cluster.length;

            suggestions.push({
              suggestedName: this.generateModuleName(cluster),
              types: cluster,
              cohesion: avgCoupling,
              coupling: this.calculateExternalCoupling(cluster, cochangeMatrix),
              rationale: `Types frequently change together (avg coupling: ${(avgCoupling * 100).toFixed(1)}%)`,
              migrationEffort: cluster.length <= 3 ? 'low' : cluster.length <= 6 ? 'medium' : 'high',
              benefits: [
                'Reduced change propagation',
                'Improved maintainability',
                'Better encapsulation of related functionality'
              ]
            });

            cluster.forEach(type => processedTypes.add(type));
          }
        }
      }
    }

    return suggestions.sort((a, b) => b.cohesion - a.cohesion);
  }

  /**
   * Find a cluster of types based on coupling threshold
   */
  private findTypeCluster(
    seedType: string, 
    cochangeMatrix: CochangeRelation[], 
    threshold: number
  ): string[] {
    const cluster = new Set<string>([seedType]);
    const toProcess = [seedType];

    while (toProcess.length > 0) {
      const currentType = toProcess.pop();
      if (!currentType) break;

      const relatedRelations = cochangeMatrix.filter(r => 
        (r.typeA === currentType || r.typeB === currentType) && 
        r.temporalCoupling >= threshold
      );

      for (const relation of relatedRelations) {
        const otherType = relation.typeA === currentType ? relation.typeB : relation.typeA;
        if (!cluster.has(otherType)) {
          cluster.add(otherType);
          toProcess.push(otherType);
        }
      }
    }

    return Array.from(cluster);
  }

  /**
   * Generate a meaningful module name based on type names
   */
  private generateModuleName(types: string[]): string {
    // Simple heuristic: find common prefixes or suffixes
    if (types.length === 0) return 'unnamed-module';
    
    // Look for common patterns
    const commonWords = this.extractCommonWords(types);
    if (commonWords.length > 0) {
      return commonWords.join('-').toLowerCase() + '-module';
    }

    // Fallback to first type name
    return (types[0]?.toLowerCase() ?? 'unnamed') + '-group';
  }

  /**
   * Extract common words from type names
   */
  private extractCommonWords(types: string[]): string[] {
    if (types.length === 0) return [];
    
    // Split camelCase/PascalCase words
    const wordSets = types.map(type => 
      type.replace(/([A-Z])/g, ' $1').trim().split(/\s+/).filter(w => w.length > 1)
    );

    if (wordSets.length === 0) return [];

    // Find words present in most type names
    const wordCounts = new Map<string, number>();
    
    for (const words of wordSets) {
      const uniqueWords = new Set(words.map(w => w.toLowerCase()));
      for (const word of uniqueWords) {
        wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
      }
    }

    const threshold = Math.ceil(types.length / 2);
    return Array.from(wordCounts.entries())
      .filter(([, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([word]) => word);
  }

  /**
   * Calculate external coupling for a type cluster
   */
  private calculateExternalCoupling(cluster: string[], cochangeMatrix: CochangeRelation[]): number {
    const externalRelations = cochangeMatrix.filter(r => {
      const aInCluster = cluster.includes(r.typeA);
      const bInCluster = cluster.includes(r.typeB);
      return aInCluster !== bInCluster; // One in cluster, one outside
    });

    if (externalRelations.length === 0) return 0;

    return externalRelations.reduce((sum, r) => sum + r.temporalCoupling, 0) / externalRelations.length;
  }

  /**
   * Calculate overall confidence of the analysis
   */
  private calculateOverallConfidence(cochangeMatrix: CochangeRelation[]): number {
    if (cochangeMatrix.length === 0) return 0;
    
    return cochangeMatrix.reduce((sum, rel) => sum + rel.confidence, 0) / cochangeMatrix.length;
  }

  /**
   * Find the most volatile type
   */
  private findMostVolatileType(typeChanges: TypeChangeInfo[]): string {
    if (typeChanges.length === 0) return 'N/A';
    
    const mostVolatile = typeChanges.reduce((max, current) => 
      current.volatility > max.volatility ? current : max
    );
    
    return mostVolatile.typeName;
  }

  /**
   * Find the strongest coupling relationship
   */
  private findStrongestCoupling(cochangeMatrix: CochangeRelation[]): string {
    if (cochangeMatrix.length === 0) return 'N/A';
    
    const strongest = cochangeMatrix.reduce((max, current) => 
      current.temporalCoupling > max.temporalCoupling ? current : max
    );
    
    return `${strongest.typeA} ↔ ${strongest.typeB}`;
  }

  /**
   * Generate suggested actions based on analysis
   */
  private generateSuggestedActions(
    cochangeMatrix: CochangeRelation[], 
    moduleSuggestions: ModuleSuggestion[]
  ): string {
    const suggestions: string[] = [];

    if (moduleSuggestions.length > 0) {
      suggestions.push(`Consider grouping ${moduleSuggestions.length} sets of highly coupled types into modules`);
    }

    const highCouplingCount = cochangeMatrix.filter(r => r.temporalCoupling > 0.7).length;
    if (highCouplingCount > 0) {
      suggestions.push(`${highCouplingCount} type pairs show very strong temporal coupling`);
    }

    const lowCohesionModules = moduleSuggestions.filter(s => s.cohesion < 0.3).length;
    if (lowCohesionModules > 0) {
      suggestions.push(`Review ${lowCohesionModules} suggested modules with low internal cohesion`);
    }

    return suggestions.length > 0 ? suggestions.join('; ') : 'No significant co-change patterns detected';
  }

  /**
   * Calculate impact score for the analysis
   */
  private calculateImpactScore(typeChanges: TypeChangeInfo[], cochangeMatrix: CochangeRelation[]): number {
    let score = 0;

    // Base score from number of analyzed types
    score += Math.min(typeChanges.length * 2, 50);

    // Bonus for high volatility types
    const highVolatilityTypes = typeChanges.filter(tc => tc.volatility > 0.5).length;
    score += highVolatilityTypes * 5;

    // Bonus for strong couplings
    const strongCouplings = cochangeMatrix.filter(r => r.temporalCoupling > 0.6).length;
    score += strongCouplings * 3;

    return Math.min(score, 100);
  }

  /**
   * Get configuration specific to co-change analysis
   */
  getCochangeConfiguration(): CochangeAnalysisOptions {
    return { ...this.cochangeOptions };
  }
}
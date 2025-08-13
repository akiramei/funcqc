/**
 * Property Slice Miner
 * 
 * Discovers frequent property patterns (slices) across types using the Apriori algorithm.
 * These patterns suggest opportunities for Value Object extraction and code consolidation.
 */

import { CrossTypeAnalyzer, CrossTypePattern, TypePropertyInfo } from './cross-type-analyzer.js';
import type { StorageQueryInterface } from './types.js';

export interface PropertySlice extends CrossTypePattern {
  properties: string[];
  suggestedVOName: string;
  extractionBenefit: 'high' | 'medium' | 'low';
  relatedMethods: string[];
  duplicateCode: number; // Estimated lines of duplicate code eliminated
}

export interface SliceMinerOptions {
  minSliceSize: number;        // Minimum properties per slice
  maxSliceSize: number;        // Maximum properties per slice  
  minSupport: number;          // Minimum types containing slice
  considerMethods: boolean;    // Include methods in pattern mining
  excludeCommonProperties: boolean; // Exclude common props like 'id', 'name'
}

export interface PropertySliceReport {
  totalSlices: number;
  highValueSlices: PropertySlice[];
  mediumValueSlices: PropertySlice[];
  lowValueSlices: PropertySlice[];
  estimatedCodeReduction: number;
  recommendations: string[];
}

export class PropertySliceMiner extends CrossTypeAnalyzer {
  private sliceOptions: SliceMinerOptions;
  private commonProperties = new Set(['id', 'name', 'type', 'kind', 'status', 'createdAt', 'updatedAt']);

  constructor(
    storage: StorageQueryInterface,
    options: Partial<SliceMinerOptions> = {}
  ) {
    super(storage, {
      minSupport: options.minSupport ?? 3,
      minConfidence: 0.8,
      maxPatternSize: options.maxSliceSize ?? 5
    });

    this.sliceOptions = {
      minSliceSize: options.minSliceSize ?? 2,
      maxSliceSize: options.maxSliceSize ?? 5,
      minSupport: options.minSupport ?? 3,
      considerMethods: options.considerMethods ?? false,
      excludeCommonProperties: options.excludeCommonProperties ?? true,
      ...options
    };
  }

  /**
   * Main analysis method - discovers property slices
   */
  async analyze(snapshotId?: string): Promise<PropertySlice[]> {
    const types = await this.loadTypeInformation(snapshotId);
    const filteredTypes = this.filterTypesForAnalysis(types);
    
    if (filteredTypes.length < this.sliceOptions.minSupport) {
      return [];
    }

    // For large datasets, use a more efficient approach
    if (filteredTypes.length > 100) {
      return this.analyzeEfficiently(filteredTypes);
    }

    // Generate candidate itemsets using Apriori algorithm
    const frequentItemsets = await this.findFrequentItemsets(filteredTypes);
    
    // Convert itemsets to property slices with additional metadata
    const slices = this.convertToPropertySlices(frequentItemsets, filteredTypes);
    
    // Enhance slices with extraction recommendations
    return this.enhanceSlicesWithRecommendations(slices, filteredTypes);
  }

  /**
   * Efficient analysis for large datasets using frequency counting
   */
  private analyzeEfficiently(types: TypePropertyInfo[]): PropertySlice[] {
    // Count property frequencies and co-occurrences
    const propertyCount = new Map<string, number>();
    const cooccurrenceCount = new Map<string, number>();

    // First pass: count individual properties
    for (const type of types) {
      let items = [...type.properties];
      
      if (this.sliceOptions.considerMethods) {
        items = [...items, ...type.methods.map(m => `method:${m}`)];
      }
      
      if (this.sliceOptions.excludeCommonProperties) {
        items = items.filter(item => !this.commonProperties.has(item));
      }
      
      // Count individual items
      for (const item of items) {
        propertyCount.set(item, (propertyCount.get(item) || 0) + 1);
      }
      
      // Count pairs (2-itemsets only for efficiency)
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const pair = [items[i], items[j]].sort().join(',');
          cooccurrenceCount.set(pair, (cooccurrenceCount.get(pair) || 0) + 1);
        }
      }
    }

    // Generate slices from frequent pairs
    const slices: PropertySlice[] = [];
    let sliceIndex = 0;

    for (const [pairStr, count] of cooccurrenceCount.entries()) {
      if (count >= this.sliceOptions.minSupport) {
        const properties = pairStr.split(',').filter(item => !item.startsWith('method:'));
        const methods = pairStr.split(',')
          .filter(item => item.startsWith('method:'))
          .map(item => item.replace('method:', ''));

        if (properties.length >= this.sliceOptions.minSliceSize) {
          const containingTypes = types
            .filter(type => {
              const typeItems = new Set([...type.properties, ...type.methods.map(m => `method:${m}`)]);
              return pairStr.split(',').every(item => typeItems.has(item));
            })
            .map(type => type.typeId);

          const slice: PropertySlice = {
            id: `slice_${sliceIndex++}`,
            pattern: pairStr.split(','),
            properties,
            relatedMethods: methods,
            support: count,
            confidence: 1.0,
            lift: 1.0,
            types: containingTypes,
            suggestedAction: 'Extract as Value Object',
            suggestedVOName: this.generateVOName(properties),
            extractionBenefit: this.calculateExtractionBenefitFast(count, properties.length, types.length),
            impactScore: count * properties.length,
            duplicateCode: count * properties.length * 2
          };

          slices.push(slice);
        }
      }
    }

    return slices.sort((a, b) => b.impactScore - a.impactScore);
  }

  /**
   * Fast extraction benefit calculation
   */
  private calculateExtractionBenefitFast(
    support: number, 
    propertyCount: number, 
    totalTypes: number
  ): 'high' | 'medium' | 'low' {
    const supportRatio = support / totalTypes;
    const score = supportRatio * 10 + propertyCount;
    
    if (score >= 8) return 'high';
    if (score >= 4) return 'medium';
    return 'low';
  }

  /**
   * Generate comprehensive analysis report
   */
  async generateReport(snapshotId?: string): Promise<PropertySliceReport> {
    const slices = await this.analyze(snapshotId);
    
    const highValueSlices = slices.filter(s => s.extractionBenefit === 'high');
    const mediumValueSlices = slices.filter(s => s.extractionBenefit === 'medium');
    const lowValueSlices = slices.filter(s => s.extractionBenefit === 'low');

    const estimatedCodeReduction = slices.reduce((total, slice) => 
      total + slice.duplicateCode, 0
    );

    return {
      totalSlices: slices.length,
      highValueSlices,
      mediumValueSlices,
      lowValueSlices,
      estimatedCodeReduction,
      recommendations: this.generateRecommendations(slices)
    };
  }

  /**
   * Filter types suitable for slice analysis
   */
  private filterTypesForAnalysis(types: TypePropertyInfo[]): TypePropertyInfo[] {
    return types.filter(type => {
      // Include only types with sufficient properties
      if (type.properties.length < this.sliceOptions.minSliceSize) return false;
      
      // Exclude utility/enum types
      if (type.typeName.toLowerCase().includes('enum')) return false;
      if (type.typeName.toLowerCase().includes('util')) return false;
      
      return true;
    });
  }

  /**
   * Implement Apriori algorithm for frequent itemset mining
   */
  private async findFrequentItemsets(types: TypePropertyInfo[]): Promise<string[][]> {
    // Build transaction database (each type is a transaction)
    const transactions = types.map(type => {
      let items = [...type.properties];
      
      if (this.sliceOptions.considerMethods) {
        items = [...items, ...type.methods.map(m => `method:${m}`)];
      }
      
      if (this.sliceOptions.excludeCommonProperties) {
        items = items.filter(item => !this.commonProperties.has(item));
      }
      
      return items;
    });

    const frequentItemsets: string[][] = [];
    
    // Generate 1-itemsets
    const singleItems = this.generateFrequentSingleItems(transactions);
    if (singleItems.length === 0) return frequentItemsets;
    
    frequentItemsets.push(...singleItems.map(item => [item]));
    
    // Generate k-itemsets for k = 2, 3, ..., maxSliceSize
    let currentItemsets = singleItems.map(item => [item]);
    
    for (let k = 2; k <= this.sliceOptions.maxSliceSize; k++) {
      const candidates = this.generateCandidates(currentItemsets);
      const frequentCandidates = this.pruneBySupport(candidates, transactions);
      
      if (frequentCandidates.length === 0) break;
      
      frequentItemsets.push(...frequentCandidates);
      currentItemsets = frequentCandidates;
    }

    // Filter by size requirements
    return frequentItemsets.filter(itemset => 
      itemset.length >= this.sliceOptions.minSliceSize && 
      itemset.length <= this.sliceOptions.maxSliceSize
    );
  }

  /**
   * Generate frequent single items
   */
  private generateFrequentSingleItems(transactions: string[][]): string[] {
    const itemCounts = new Map<string, number>();
    
    // Count item frequencies
    for (const transaction of transactions) {
      for (const item of transaction) {
        itemCounts.set(item, (itemCounts.get(item) || 0) + 1);
      }
    }

    // Return items that meet minimum support
    return Array.from(itemCounts.entries())
      .filter(([_, count]) => count >= this.sliceOptions.minSupport)
      .map(([item, _]) => item);
  }

  /**
   * Generate candidate itemsets from frequent (k-1)-itemsets
   */
  private generateCandidates(frequentItemsets: string[][]): string[][] {
    const candidates: string[][] = [];
    
    for (let i = 0; i < frequentItemsets.length; i++) {
      for (let j = i + 1; j < frequentItemsets.length; j++) {
        const itemset1 = frequentItemsets[i];
        const itemset2 = frequentItemsets[j];
        
        // Join itemsets if they differ by only one item
        if (this.canJoin(itemset1, itemset2)) {
          const candidate = this.joinItemsets(itemset1, itemset2);
          if (candidate && !this.isDuplicate(candidate, candidates)) {
            candidates.push(candidate);
          }
        }
      }
    }
    
    return candidates;
  }

  /**
   * Check if two itemsets can be joined
   */
  private canJoin(itemset1: string[], itemset2: string[]): boolean {
    if (itemset1.length !== itemset2.length) return false;
    
    // Sort both itemsets for comparison
    const sorted1 = [...itemset1].sort();
    const sorted2 = [...itemset2].sort();
    
    // Check if they differ by exactly one item
    let diffCount = 0;
    for (let i = 0; i < sorted1.length; i++) {
      if (sorted1[i] !== sorted2[i]) {
        diffCount++;
        if (diffCount > 1) return false;
      }
    }
    
    return diffCount === 1;
  }

  /**
   * Join two itemsets
   */
  private joinItemsets(itemset1: string[], itemset2: string[]): string[] | null {
    const combined = new Set([...itemset1, ...itemset2]);
    return Array.from(combined).sort();
  }

  /**
   * Check for duplicate candidates
   */
  private isDuplicate(candidate: string[], existingCandidates: string[][]): boolean {
    const candidateStr = candidate.sort().join(',');
    return existingCandidates.some(existing => 
      existing.sort().join(',') === candidateStr
    );
  }

  /**
   * Prune candidates by minimum support threshold
   */
  private pruneBySupport(candidates: string[][], transactions: string[][]): string[][] {
    return candidates.filter(candidate => {
      const support = this.calculateItemsetSupport(candidate, transactions);
      return support >= this.sliceOptions.minSupport;
    });
  }

  /**
   * Calculate support for a specific itemset
   */
  private calculateItemsetSupport(itemset: string[], transactions: string[][]): number {
    let supportCount = 0;
    
    for (const transaction of transactions) {
      if (itemset.every(item => transaction.includes(item))) {
        supportCount++;
      }
    }
    
    return supportCount;
  }

  /**
   * Convert frequent itemsets to property slices
   */
  private convertToPropertySlices(
    itemsets: string[][], 
    types: TypePropertyInfo[]
  ): PropertySlice[] {
    return itemsets.map((itemset, index) => {
      const properties = itemset.filter(item => !item.startsWith('method:'));
      const methods = itemset
        .filter(item => item.startsWith('method:'))
        .map(item => item.replace('method:', ''));
      
      const support = this.calculateItemsetSupport(itemset, 
        types.map(t => [...t.properties, ...t.methods.map(m => `method:${m}`)])
      );
      
      const containingTypes = types
        .filter(type => {
          const typeItems = [...type.properties, ...type.methods.map(m => `method:${m}`)];
          return itemset.every(item => typeItems.includes(item));
        })
        .map(type => type.typeId);

      return {
        id: `slice_${index}`,
        pattern: itemset,
        properties,
        relatedMethods: methods,
        support,
        confidence: 1.0, // Will be calculated later if needed
        lift: 1.0,      // Will be calculated later if needed
        types: containingTypes,
        suggestedAction: `Extract as Value Object`,
        suggestedVOName: this.generateVOName(properties),
        extractionBenefit: 'medium' as const,
        impactScore: support * properties.length,
        duplicateCode: support * properties.length * 2 // Rough estimate
      };
    });
  }

  /**
   * Enhance slices with detailed recommendations
   */
  private enhanceSlicesWithRecommendations(
    slices: PropertySlice[], 
    types: TypePropertyInfo[]
  ): PropertySlice[] {
    return slices.map(slice => {
      // Calculate extraction benefit
      slice.extractionBenefit = this.calculateExtractionBenefit(slice, types);
      
      // Refine duplicate code estimation
      slice.duplicateCode = this.estimateDuplicateCode(slice, types);
      
      // Update impact score
      slice.impactScore = this.calculateImpactScore(slice);
      
      return slice;
    });
  }

  /**
   * Calculate extraction benefit level
   */
  private calculateExtractionBenefit(
    slice: PropertySlice, 
    types: TypePropertyInfo[]
  ): 'high' | 'medium' | 'low' {
    const supportRatio = slice.support / types.length;
    const sizeScore = slice.properties.length;
    const methodsScore = slice.relatedMethods.length;
    
    const totalScore = supportRatio * 10 + sizeScore + methodsScore;
    
    if (totalScore >= 8) return 'high';
    if (totalScore >= 5) return 'medium';
    return 'low';
  }

  /**
   * Estimate duplicate code elimination
   */
  private estimateDuplicateCode(slice: PropertySlice, _types: TypePropertyInfo[]): number {
    // Rough estimation: properties + methods + type definitions
    const propertyLines = slice.properties.length * 1.5; // Each property ~1.5 lines
    const methodLines = slice.relatedMethods.length * 3; // Each method signature ~3 lines
    const instanceLines = propertyLines + methodLines;
    
    return Math.round(instanceLines * slice.support);
  }

  /**
   * Calculate overall impact score
   */
  private calculateImpactScore(slice: PropertySlice): number {
    const supportWeight = slice.support * 2;
    const sizeWeight = slice.properties.length;
    const benefitWeight = slice.extractionBenefit === 'high' ? 3 : 
                         slice.extractionBenefit === 'medium' ? 2 : 1;
    
    return supportWeight + sizeWeight + benefitWeight;
  }

  /**
   * Generate suggested Value Object name
   */
  private generateVOName(properties: string[]): string {
    // Common naming patterns
    const patterns = [
      { props: ['amount', 'currency'], name: 'Money' },
      { props: ['start', 'end'], name: 'DateRange' },
      { props: ['x', 'y'], name: 'Point' },
      { props: ['width', 'height'], name: 'Dimensions' },
      { props: ['street', 'city', 'state', 'zip'], name: 'Address' },
      { props: ['firstName', 'lastName'], name: 'PersonName' },
      { props: ['lat', 'lng'], name: 'Coordinates' },
      { props: ['email', 'phone'], name: 'ContactInfo' }
    ];

    // Find matching pattern
    for (const pattern of patterns) {
      if (pattern.props.every(prop => properties.includes(prop))) {
        return pattern.name;
      }
    }

    // Generate name from properties
    if (properties.length <= 2) {
      return properties.map(p => this.capitalize(p)).join('');
    }

    // Use most descriptive property + "Info"
    const mainProp = properties.find(p => !this.commonProperties.has(p)) || properties[0];
    return this.capitalize(mainProp) + 'Info';
  }

  /**
   * Generate actionable recommendations
   */
  private generateRecommendations(slices: PropertySlice[]): string[] {
    const recommendations: string[] = [];
    
    const highValueSlices = slices.filter(s => s.extractionBenefit === 'high');
    if (highValueSlices.length > 0) {
      recommendations.push(
        `🎯 High Priority: Extract ${highValueSlices.length} Value Objects for immediate benefit`
      );
    }

    const totalCodeReduction = slices.reduce((total, slice) => total + slice.duplicateCode, 0);
    if (totalCodeReduction > 100) {
      recommendations.push(
        `📉 Code Reduction: Potential elimination of ~${totalCodeReduction} lines of duplicate code`
      );
    }

    const frequentSlices = slices.filter(s => s.support >= 5);
    if (frequentSlices.length > 0) {
      recommendations.push(
        `🔄 Most Used: Focus on ${frequentSlices.length} patterns used in 5+ types`
      );
    }

    return recommendations;
  }

  /**
   * Utility function to capitalize strings
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
import { TypeDefinition, TypeMetrics } from './type-analyzer';
import { TypeDependency, TypeUsageInfo, CircularDependency } from './type-dependency-analyzer';
import { CKMetricsCalculator, CKMetrics } from './ck-metrics';
import { Project } from 'ts-morph';

export interface TypeQualityScore {
  typeId: string;
  typeName: string;
  overallScore: number; // 0-100 scale (health score - higher is better)
  riskScore: number; // 0-100 scale (risk score - higher is worse, = 100 - overallScore)
  complexityScore: number;
  maintainabilityScore: number;
  reusabilityScore: number;
  designScore: number;
  ckScore: number; // New CK metrics score
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  issues: TypeQualityIssue[];
  ckMetrics?: CKMetrics | undefined; // Include CK metrics for detailed analysis
}

export interface TypeQualityIssue {
  severity: 'info' | 'warning' | 'error';
  category: 'complexity' | 'maintainability' | 'design' | 'performance';
  message: string;
  suggestion?: string;
  lineNumber?: number;
}

export interface TypeHealthReport {
  overallHealth: number;
  totalTypes: number;
  riskDistribution: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  topIssues: TypeQualityIssue[];
  circularDependencies: CircularDependency[];
  recommendations: string[];
  thresholds: TypeThresholds & { name?: string };
}

export interface TypeThresholds {
  maxFieldCount: number;
  maxNestingDepth: number;
  maxGenericParameters: number;
  maxUnionMembers: number;
  maxIntersectionMembers: number;
  maxLiteralTypes: number;
  minUsageForReusability: number;
}

/**
 * Calculates quality metrics and scores for TypeScript types
 */
export class TypeMetricsCalculator {
  private defaultThresholds: TypeThresholds = {
    maxFieldCount: 15,
    maxNestingDepth: 4,
    maxGenericParameters: 5,
    maxUnionMembers: 8,
    maxIntersectionMembers: 5,
    maxLiteralTypes: 10,
    minUsageForReusability: 3
  };

  private thresholds: TypeThresholds & { name?: string };
  private ckCalculator: CKMetricsCalculator | null = null;

  constructor(thresholds: Partial<TypeThresholds> & { name?: string } = {}, project?: Project) {
    this.thresholds = { ...this.defaultThresholds, ...thresholds };
    if (project) {
      this.ckCalculator = new CKMetricsCalculator(project);
    }
  }

  /**
   * Set type definitions for CK metrics calculation
   */
  setTypeDefinitions(typeDefinitions: TypeDefinition[]): void {
    if (this.ckCalculator) {
      this.ckCalculator.setTypeDefinitions(typeDefinitions);
    }
  }

  /**
   * Calculate quality score for a single type including CK metrics
   */
  calculateTypeQuality(
    typeDefinition: TypeDefinition,
    typeMetrics: TypeMetrics,
    usageInfo?: TypeUsageInfo,
    dependencies?: TypeDependency[]
  ): TypeQualityScore {
    const issues: TypeQualityIssue[] = [];

    // Calculate individual scores
    const complexityScore = this.calculateComplexityScore(typeMetrics, issues);
    const maintainabilityScore = this.calculateMaintainabilityScore(typeDefinition, typeMetrics, issues);
    const reusabilityScore = this.calculateReusabilityScore(typeDefinition, usageInfo, issues);
    const designScore = this.calculateDesignScore(typeDefinition, typeMetrics, dependencies, issues);
    
    // Calculate CK metrics score
    const ckMetrics = this.ckCalculator?.calculateCKMetrics(typeDefinition.name);
    const ckScore = this.calculateCKScore(ckMetrics, issues);

    // Calculate overall score with updated weights to include CK metrics
    // Adjusted weights: Complexity 25%, Maintainability 20%, Reusability 15%, Design 20%, CK 20%
    const overallScore = Math.round(
      complexityScore * 0.25 +
      maintainabilityScore * 0.20 +
      reusabilityScore * 0.15 +
      designScore * 0.20 +
      ckScore * 0.20
    );

    // Calculate risk score (inverted health score for intuitive risk understanding)
    const riskScore = 100 - overallScore;
    
    // Determine risk level based purely on risk score for consistency
    const riskLevel = this.determineRiskLevel(riskScore);

    return {
      typeId: typeDefinition.id,
      typeName: typeDefinition.name,
      overallScore,
      riskScore,
      complexityScore,
      maintainabilityScore,
      reusabilityScore,
      designScore,
      ckScore,
      riskLevel,
      issues,
      ckMetrics: ckMetrics || undefined
    };
  }

  /**
   * Generate a comprehensive health report for all types
   */
  generateHealthReport(
    typeScores: TypeQualityScore[],
    circularDependencies: CircularDependency[]
  ): TypeHealthReport {
    const totalTypes = typeScores.length;
    const overallHealth = totalTypes > 0 
      ? Math.round(typeScores.reduce((sum, score) => sum + score.overallScore, 0) / totalTypes)
      : 100;

    // Calculate risk distribution
    const riskDistribution = {
      low: typeScores.filter(s => s.riskLevel === 'low').length,
      medium: typeScores.filter(s => s.riskLevel === 'medium').length,
      high: typeScores.filter(s => s.riskLevel === 'high').length,
      critical: typeScores.filter(s => s.riskLevel === 'critical').length
    };

    // Collect top issues
    const allIssues = typeScores.flatMap(score => 
      score.issues.map(issue => ({ ...issue, typeName: score.typeName }))
    );
    const topIssues = allIssues
      .sort((a, b) => this.getIssuePriority(b) - this.getIssuePriority(a))
      .slice(0, 10);

    // Generate recommendations
    const recommendations = this.generateRecommendations(typeScores, circularDependencies);

    return {
      overallHealth,
      totalTypes,
      riskDistribution,
      topIssues,
      circularDependencies,
      recommendations,
      thresholds: this.thresholds
    };
  }

  /**
   * Calculate complexity score (0-100, higher is better)
   */
  private calculateComplexityScore(typeMetrics: TypeMetrics, issues: TypeQualityIssue[]): number {
    let score = 100;
    const thresholds = this.thresholds as TypeThresholds;

    // Field count penalty
    if (typeMetrics.fieldCount > thresholds.maxFieldCount) {
      const penalty = Math.min(30, (typeMetrics.fieldCount - thresholds.maxFieldCount) * 3);
      score -= penalty;
      issues.push({
        severity: typeMetrics.fieldCount > thresholds.maxFieldCount * 1.5 ? 'error' : 'warning',
        category: 'complexity',
        message: `Type has ${typeMetrics.fieldCount} fields (threshold: ${thresholds.maxFieldCount})`,
        suggestion: 'Consider breaking this type into smaller, more focused types'
      });
    }

    // Nesting depth penalty
    if (typeMetrics.nestingDepth > thresholds.maxNestingDepth) {
      const penalty = Math.min(25, (typeMetrics.nestingDepth - thresholds.maxNestingDepth) * 8);
      score -= penalty;
      issues.push({
        severity: typeMetrics.nestingDepth > thresholds.maxNestingDepth * 1.5 ? 'error' : 'warning',
        category: 'complexity',
        message: `Type has nesting depth of ${typeMetrics.nestingDepth} (threshold: ${thresholds.maxNestingDepth})`,
        suggestion: 'Consider flattening nested structures or using intermediate types'
      });
    }

    // Generic parameters penalty
    if (typeMetrics.genericParameterCount > thresholds.maxGenericParameters) {
      const penalty = Math.min(20, (typeMetrics.genericParameterCount - thresholds.maxGenericParameters) * 5);
      score -= penalty;
      issues.push({
        severity: 'warning',
        category: 'complexity',
        message: `Type has ${typeMetrics.genericParameterCount} generic parameters (threshold: ${thresholds.maxGenericParameters})`,
        suggestion: 'Consider reducing generic parameters or using conditional types'
      });
    }

    // Union members penalty
    if (typeMetrics.unionMemberCount > thresholds.maxUnionMembers) {
      const penalty = Math.min(15, (typeMetrics.unionMemberCount - thresholds.maxUnionMembers) * 2);
      score -= penalty;
      issues.push({
        severity: 'warning',
        category: 'complexity',
        message: `Union type has ${typeMetrics.unionMemberCount} members (threshold: ${thresholds.maxUnionMembers})`,
        suggestion: 'Consider using discriminated unions or breaking into smaller unions'
      });
    }

    return Math.max(0, score);
  }

  /**
   * Calculate maintainability score (0-100, higher is better)
   */
  private calculateMaintainabilityScore(
    typeDefinition: TypeDefinition,
    typeMetrics: TypeMetrics,
    issues: TypeQualityIssue[]
  ): number {
    let score = 100;

    // Documentation score
    if (!typeDefinition.jsdoc) {
      score -= 20;
      issues.push({
        severity: 'info',
        category: 'maintainability',
        message: 'Type lacks documentation',
        suggestion: 'Add JSDoc comments to explain the purpose and usage of this type'
      });
    }

    // Naming quality (basic heuristic)
    const nameQuality = this.assessNamingQuality(typeDefinition.name);
    if (nameQuality < 0.7) {
      score -= 15;
      issues.push({
        severity: 'info',
        category: 'maintainability',
        message: 'Type name could be more descriptive',
        suggestion: 'Consider using a more descriptive name that clearly indicates the type\'s purpose'
      });
    }

    // Excessive literal types
    if (typeMetrics.literalTypeCount > this.thresholds.maxLiteralTypes) {
      score -= 10;
      issues.push({
        severity: 'warning',
        category: 'maintainability',
        message: `Type contains ${typeMetrics.literalTypeCount} literal values (threshold: ${this.thresholds.maxLiteralTypes})`,
        suggestion: 'Consider using enums or constants for better maintainability'
      });
    }

    return Math.max(0, score);
  }

  /**
   * Calculate reusability score (0-100, higher is better)
   */
  private calculateReusabilityScore(
    typeDefinition: TypeDefinition,
    usageInfo?: TypeUsageInfo,
    issues?: TypeQualityIssue[]
  ): number {
    let score = 50; // Neutral starting point

    if (!usageInfo) {
      return score;
    }

    // Usage frequency bonus
    if (usageInfo.usageCount >= this.thresholds.minUsageForReusability) {
      score += Math.min(30, usageInfo.usageCount * 5);
    } else if (usageInfo.usageCount === 0) {
      score = 20;
      issues?.push({
        severity: 'warning',
        category: 'design',
        message: 'Type is never used',
        suggestion: 'Consider removing unused types or making them internal if they are meant for future use'
      });
    }

    // Export status bonus (exported types are more reusable)
    if (typeDefinition.isExported) {
      score += 20;
    }

    // File usage diversity bonus
    if (usageInfo.usedInFiles.length > 1) {
      score += Math.min(20, usageInfo.usedInFiles.length * 5);
    }

    return Math.min(100, score);
  }

  /**
   * Calculate design score (0-100, higher is better)
   */
  private calculateDesignScore(
    typeDefinition: TypeDefinition,
    typeMetrics: TypeMetrics,
    dependencies?: TypeDependency[],
    issues?: TypeQualityIssue[]
  ): number {
    let score = 100;

    // Generic usage appropriateness
    if (typeDefinition.isGeneric && typeMetrics.genericParameterCount > 0) {
      if (typeMetrics.genericParameterCount === 1) {
        score += 5; // Bonus for simple generics
      }
    }

    // Discriminated union bonus
    if (typeMetrics.discriminantCaseCount > 0) {
      score += 10; // Bonus for well-designed discriminated unions
    }

    // Excessive intersection types penalty
    if (typeMetrics.intersectionMemberCount > this.thresholds.maxIntersectionMembers) {
      score -= 15;
      issues?.push({
        severity: 'warning',
        category: 'design',
        message: `Type uses ${typeMetrics.intersectionMemberCount} intersection types (threshold: ${this.thresholds.maxIntersectionMembers})`,
        suggestion: 'Consider using inheritance or composition instead of complex intersections'
      });
    }

    // Dependency analysis
    if (dependencies) {
      const dependencyCount = dependencies.length;
      if (dependencyCount > 10) {
        score -= Math.min(20, (dependencyCount - 10) * 2);
        issues?.push({
          severity: 'warning',
          category: 'design',
          message: `Type has ${dependencyCount} dependencies`,
          suggestion: 'Consider reducing dependencies for better modularity'
        });
      }
    }

    return Math.max(0, score);
  }

  /**
   * Determine risk level based on risk score (0-100, higher = worse)
   * This provides intuitive risk assessment where high numbers mean high risk
   */
  private determineRiskLevel(riskScore: number): TypeQualityScore['riskLevel'] {
    if (riskScore >= 70) return 'critical';  // health score 0-30
    if (riskScore >= 50) return 'high';      // health score 31-50  
    if (riskScore >= 30) return 'medium';    // health score 51-70
    return 'low';                            // health score 71-100
  }

  /**
   * Get issue priority for sorting
   */
  private getIssuePriority(issue: TypeQualityIssue): number {
    const severityWeight = {
      error: 100,
      warning: 50,
      info: 10
    };
    
    const categoryWeight = {
      complexity: 4,
      maintainability: 3,
      design: 2,
      performance: 1
    };

    return severityWeight[issue.severity] + categoryWeight[issue.category];
  }

  /**
   * Generate recommendations based on analysis results
   */
  private generateRecommendations(
    typeScores: TypeQualityScore[],
    circularDependencies: CircularDependency[]
  ): string[] {
    const recommendations: string[] = [];

    // High-risk types
    const highRiskTypes = typeScores.filter(s => s.riskLevel === 'high' || s.riskLevel === 'critical');
    if (highRiskTypes.length > 0) {
      recommendations.push(
        `Focus on improving ${highRiskTypes.length} high-risk types: ${highRiskTypes.slice(0, 3).map(t => t.typeName).join(', ')}${highRiskTypes.length > 3 ? '...' : ''}`
      );
    }

    // Circular dependencies
    if (circularDependencies.length > 0) {
      recommendations.push(
        `Resolve ${circularDependencies.length} circular dependencies to improve maintainability`
      );
    }

    // Complex types
    const complexTypes = typeScores.filter(s => s.complexityScore < 60);
    if (complexTypes.length > 0) {
      recommendations.push(
        `Consider breaking down ${complexTypes.length} overly complex types into smaller, focused types`
      );
    }

    // Unused types
    const unusedTypes = typeScores.filter(s => s.reusabilityScore < 30);
    if (unusedTypes.length > 0) {
      recommendations.push(
        `Review ${unusedTypes.length} underutilized types - consider removal or better integration`
      );
    }

    // Documentation improvements
    const undocumentedTypes = typeScores.filter(s => 
      s.issues.some(i => i.message.includes('lacks documentation'))
    );
    if (undocumentedTypes.length > 0) {
      recommendations.push(
        `Add documentation to ${undocumentedTypes.length} types to improve maintainability`
      );
    }

    return recommendations;
  }

  /**
   * Calculate CK metrics score (0-100, higher is better)
   */
  private calculateCKScore(ckMetrics?: CKMetrics, issues?: TypeQualityIssue[]): number {
    if (!ckMetrics) {
      return 70; // Neutral score if CK metrics not available
    }

    let score = 100;

    // DIT penalty: Deep inheritance is problematic
    if (ckMetrics.DIT > 5) {
      const penalty = Math.min(20, (ckMetrics.DIT - 5) * 4);
      score -= penalty;
      issues?.push({
        severity: ckMetrics.DIT > 8 ? 'error' : 'warning',
        category: 'design',
        message: `Deep inheritance tree (DIT: ${ckMetrics.DIT})`,
        suggestion: 'Consider composition over inheritance or flattening the hierarchy'
      });
    }

    // LCOM penalty: High lack of cohesion is bad
    if (ckMetrics.LCOM > 10) {
      const penalty = Math.min(15, ckMetrics.LCOM * 0.5);
      score -= penalty;
      issues?.push({
        severity: ckMetrics.LCOM > 20 ? 'error' : 'warning',
        category: 'design',
        message: `Low cohesion detected (LCOM: ${ckMetrics.LCOM})`,
        suggestion: 'Consider splitting class into more cohesive components'
      });
    }

    // CBO penalty: High coupling is problematic
    if (ckMetrics.CBO > 10) {
      const penalty = Math.min(15, (ckMetrics.CBO - 10) * 1.5);
      score -= penalty;
      issues?.push({
        severity: ckMetrics.CBO > 15 ? 'error' : 'warning',
        category: 'design',
        message: `High coupling (CBO: ${ckMetrics.CBO})`,
        suggestion: 'Reduce dependencies to improve modularity'
      });
    }

    // RFC penalty: Large response set indicates complexity
    if (ckMetrics.RFC > 20) {
      const penalty = Math.min(10, (ckMetrics.RFC - 20) * 0.5);
      score -= penalty;
      issues?.push({
        severity: 'warning',
        category: 'complexity',
        message: `Large response set (RFC: ${ckMetrics.RFC})`,
        suggestion: 'Consider breaking down into smaller, more focused classes'
      });
    }

    // WMC penalty: High weighted methods count
    if (ckMetrics.WMC > 15) {
      const penalty = Math.min(10, (ckMetrics.WMC - 15) * 0.8);
      score -= penalty;
      issues?.push({
        severity: 'warning',
        category: 'complexity',
        message: `High method complexity (WMC: ${ckMetrics.WMC})`,
        suggestion: 'Consider reducing method complexity or splitting methods'
      });
    }

    // NOC bonus/penalty: Some children are good, too many indicate design issues
    if (ckMetrics.NOC > 10) {
      score -= Math.min(10, (ckMetrics.NOC - 10) * 1);
      issues?.push({
        severity: 'warning',
        category: 'design',
        message: `Too many child classes (NOC: ${ckMetrics.NOC})`,
        suggestion: 'Review inheritance hierarchy design'
      });
    } else if (ckMetrics.NOC > 0 && ckMetrics.NOC <= 5) {
      score += 5; // Small bonus for reasonable inheritance
    }

    return Math.max(0, score);
  }

  /**
   * Assess naming quality (simple heuristic)
   */
  private assessNamingQuality(name: string): number {
    let score = 0.5;

    // Length appropriateness
    if (name.length >= 3 && name.length <= 30) score += 0.2;
    
    // Descriptiveness (contains multiple words or meaningful parts)
    if (/[A-Z][a-z]/.test(name) || name.includes('_')) score += 0.2;
    
    // Avoids generic names
    if (!/^(Data|Info|Item|Object|Type|Thing)$/i.test(name)) score += 0.1;

    return Math.min(1.0, score);
  }
}
import { TypeDefinition, TypeMetrics } from './type-analyzer';
import { TypeDependency, TypeUsageInfo, CircularDependency } from './type-dependency-analyzer';

export interface TypeQualityScore {
  typeId: string;
  typeName: string;
  overallScore: number; // 0-100 scale
  complexityScore: number;
  maintainabilityScore: number;
  reusabilityScore: number;
  designScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  issues: TypeQualityIssue[];
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

  constructor(private thresholds: Partial<TypeThresholds> = {}) {
    this.thresholds = { ...this.defaultThresholds, ...thresholds };
  }

  /**
   * Calculate quality score for a single type
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

    // Calculate overall score (weighted average)
    const overallScore = Math.round(
      complexityScore * 0.3 +
      maintainabilityScore * 0.25 +
      reusabilityScore * 0.20 +
      designScore * 0.25
    );

    // Determine risk level
    const riskLevel = this.determineRiskLevel(overallScore, issues);

    return {
      typeId: typeDefinition.id,
      typeName: typeDefinition.name,
      overallScore,
      complexityScore,
      maintainabilityScore,
      reusabilityScore,
      designScore,
      riskLevel,
      issues
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
      recommendations
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
    if (typeMetrics.literalTypeCount > this.thresholds.maxLiteralTypes!) {
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
    if (usageInfo.usageCount >= this.thresholds.minUsageForReusability!) {
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
    if (typeMetrics.intersectionMemberCount > this.thresholds.maxIntersectionMembers!) {
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
   * Determine risk level based on score and issues
   */
  private determineRiskLevel(score: number, issues: TypeQualityIssue[]): TypeQualityScore['riskLevel'] {
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;

    if (score < 30 || errorCount >= 3) return 'critical';
    if (score < 50 || errorCount >= 1 || warningCount >= 5) return 'high';
    if (score < 70 || warningCount >= 3) return 'medium';
    return 'low';
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
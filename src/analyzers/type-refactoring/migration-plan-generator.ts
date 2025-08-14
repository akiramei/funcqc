/**
 * Migration Plan Generator
 * 
 * Generates detailed, step-by-step migration plans for type replacements
 * considering dependency graphs, risk levels, and rollback strategies.
 */

import type { StorageQueryInterface } from '../type-insights/types';
import type { TypeReplacementPlan, TypeUsageInfo } from './type-replacement-advisor';
import type { TypeCompatibilityResult } from './type-compatibility-checker';

export interface MigrationPhase {
  id: string;
  name: string;
  description: string;
  order: number;
  estimatedDuration: string;      // e.g., "2-4 hours", "1-2 days"
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  prerequisites: string[];
  steps: MigrationStep[];
  validationCriteria: string[];
  rollbackTriggers: string[];
  dependencies: string[];         // IDs of phases that must complete first
}

export interface MigrationStep {
  id: string;
  description: string;
  type: 'manual' | 'automated' | 'verification';
  command?: string;               // CLI command if automated
  expectedOutput?: string;        // Expected result description  
  timeEstimate: string;          // e.g., "15 minutes", "1 hour"
  criticalPath: boolean;          // Is this step on the critical path?
  rollbackAction?: string;        // How to undo this step
}

export interface MigrationStrategy {
  approach: 'big_bang' | 'phased' | 'feature_flag' | 'parallel_run';
  rationale: string;
  phases: MigrationPhase[];
  totalEstimatedTime: string;
  criticalPathTime: string;
  riskMitigation: string[];
  successMetrics: string[];
  rollbackStrategy: RollbackStrategy;
}

export interface RollbackStrategy {
  type: 'git_revert' | 'feature_flag' | 'blue_green' | 'manual_steps';
  triggerConditions: string[];
  automatedSteps: string[];
  manualSteps: string[];
  estimatedRollbackTime: string;
  dataRecoveryRequired: boolean;
}

export interface DependencyNode {
  typeName: string;
  filePath: string;
  dependents: string[];           // Types that depend on this one
  dependencies: string[];         // Types this one depends on
  depth: number;                  // Depth in dependency tree
  priority: number;               // Migration priority (lower = higher priority)
}

export class MigrationPlanGenerator {
  private storage: StorageQueryInterface;

  constructor(storage: StorageQueryInterface) {
    this.storage = storage;
  }

  /**
   * Generate comprehensive migration strategy
   */
  async generateMigrationStrategy(
    replacementPlan: TypeReplacementPlan,
    additionalContext?: {
      teamSize?: number;
      deploymentFrequency?: 'daily' | 'weekly' | 'monthly';
      riskTolerance?: 'conservative' | 'moderate' | 'aggressive';
      maintenanceWindow?: string;
    }
  ): Promise<MigrationStrategy> {
    try {
      // Analyze dependency graph
      const dependencyGraph = await this.analyzeDependencyGraph(replacementPlan);
      
      // Determine optimal approach
      const approach = this.selectMigrationApproach(replacementPlan, dependencyGraph, additionalContext);
      
      // Generate phases based on approach
      const phases = await this.generateMigrationPhases(replacementPlan, dependencyGraph, approach);
      
      // Calculate time estimates
      const timeEstimates = this.calculateTimeEstimates(phases);
      
      // Generate risk mitigation strategies
      const riskMitigation = this.generateRiskMitigation(replacementPlan, phases);
      
      // Create rollback strategy
      const rollbackStrategy = this.createRollbackStrategy(replacementPlan, phases);
      
      // Define success metrics
      const successMetrics = this.generateSuccessMetrics(replacementPlan);

      return {
        approach,
        rationale: this.generateApproachRationale(approach, replacementPlan, dependencyGraph),
        phases,
        totalEstimatedTime: timeEstimates.total,
        criticalPathTime: timeEstimates.criticalPath,
        riskMitigation,
        successMetrics,
        rollbackStrategy
      };
    } catch (error) {
      throw new Error(`Migration strategy generation failed: ${
        error instanceof Error ? error.message : String(error)
      }`);
    }
  }

  /**
   * Analyze dependency relationships between types
   */
  private async analyzeDependencyGraph(
    replacementPlan: TypeReplacementPlan
  ): Promise<Map<string, DependencyNode>> {
    const graph = new Map<string, DependencyNode>();

    // Get type dependencies from database
    const query = `
      SELECT DISTINCT
        td1.name as source_type,
        td1.file_path as source_file,
        td2.name as dependent_type,
        td2.file_path as dependent_file
      FROM type_definitions td1
      JOIN type_dependencies dep ON td1.id = dep.source_type_id
      JOIN type_definitions td2 ON dep.dependent_type_id = td2.id
      WHERE td1.name = $1 OR td2.name = $1
    `;

    try {
      const result = await this.storage.query(query, [replacementPlan.sourceType]);
      
      // Initialize source type node
      if (!graph.has(replacementPlan.sourceType)) {
        graph.set(replacementPlan.sourceType, {
          typeName: replacementPlan.sourceType,
          filePath: replacementPlan.affectedUsages[0]?.filePath ?? '',
          dependents: [],
          dependencies: [],
          depth: 0,
          priority: 1
        });
      }

      // Process dependency relationships
      for (const row of result.rows) {
        const data = row as any;
        const sourceType = data.source_type;
        const dependentType = data.dependent_type;

        // Add nodes if they don't exist
        if (!graph.has(sourceType)) {
          graph.set(sourceType, {
            typeName: sourceType,
            filePath: data.source_file,
            dependents: [],
            dependencies: [],
            depth: 0,
            priority: 2
          });
        }

        if (!graph.has(dependentType)) {
          graph.set(dependentType, {
            typeName: dependentType,
            filePath: data.dependent_file,
            dependents: [],
            dependencies: [],
            depth: 0,
            priority: 2
          });
        }

        // Add dependency relationships
        const sourceNode = graph.get(sourceType);
        const dependentNode = graph.get(dependentType);
        
        if (sourceNode && dependentNode) {
          sourceNode.dependents.push(dependentType);
          dependentNode.dependencies.push(sourceType);
        }
      }

      // Calculate depths and priorities
      this.calculateNodeDepthsAndPriorities(graph);

    } catch (error) {
      console.warn('Failed to analyze type dependencies, using simplified graph:', error);
      
      // Fallback: create simple graph with just the source type
      graph.set(replacementPlan.sourceType, {
        typeName: replacementPlan.sourceType,
        filePath: replacementPlan.affectedUsages[0]?.filePath ?? '',
        dependents: [],
        dependencies: [],
        depth: 0,
        priority: 1
      });
    }

    return graph;
  }

  /**
   * Calculate depth and priority for dependency nodes
   */
  private calculateNodeDepthsAndPriorities(graph: Map<string, DependencyNode>): void {
    const visited = new Set<string>();
    
    // Calculate depths using DFS
    const calculateDepth = (nodeName: string, currentDepth: number): number => {
      if (visited.has(nodeName)) {
        return currentDepth; // Avoid cycles
      }
      
      visited.add(nodeName);
      const node = graph.get(nodeName);
      if (!node) return currentDepth;
      
      let maxChildDepth = currentDepth;
      for (const dep of node.dependencies) {
        const childDepth = calculateDepth(dep, currentDepth + 1);
        maxChildDepth = Math.max(maxChildDepth, childDepth);
      }
      
      node.depth = maxChildDepth;
      node.priority = maxChildDepth + node.dependents.length; // Higher depth + more dependents = higher priority
      
      return maxChildDepth;
    };

    // Calculate depths for all nodes
    for (const [nodeName] of graph) {
      if (!visited.has(nodeName)) {
        calculateDepth(nodeName, 0);
      }
    }
  }

  /**
   * Select optimal migration approach
   */
  private selectMigrationApproach(
    replacementPlan: TypeReplacementPlan,
    dependencyGraph: Map<string, DependencyNode>,
    context?: any
  ): MigrationStrategy['approach'] {
    const usageCount = replacementPlan.affectedUsages.length;
    const hasBreakingChanges = !replacementPlan.compatibilityResult.isCompatible;
    const complexityLevel = replacementPlan.estimatedEffort;
    const dependencyCount = dependencyGraph.size;

    // Conservative approach for high-risk scenarios
    if (hasBreakingChanges && (usageCount > 20 || dependencyCount > 5)) {
      return 'phased';
    }

    // Feature flag approach for large codebases with moderate risk
    if (usageCount > 50 || complexityLevel === 'very_high') {
      return 'feature_flag';
    }

    // Parallel run for critical systems with strict rollback requirements
    if (context?.riskTolerance === 'conservative' && hasBreakingChanges) {
      return 'parallel_run';
    }

    // Big bang for simple, compatible changes
    if (replacementPlan.compatibilityResult.isCompatible && usageCount < 10) {
      return 'big_bang';
    }

    // Default to phased approach
    return 'phased';
  }

  /**
   * Generate migration phases based on approach
   */
  private async generateMigrationPhases(
    replacementPlan: TypeReplacementPlan,
    dependencyGraph: Map<string, DependencyNode>,
    approach: MigrationStrategy['approach']
  ): Promise<MigrationPhase[]> {
    switch (approach) {
      case 'big_bang':
        return this.generateBigBangPhases(replacementPlan);
      
      case 'phased':
        return this.generatePhasedMigration(replacementPlan, dependencyGraph);
      
      case 'feature_flag':
        return this.generateFeatureFlagMigration(replacementPlan);
      
      case 'parallel_run':
        return this.generateParallelRunMigration(replacementPlan);
      
      default:
        return this.generatePhasedMigration(replacementPlan, dependencyGraph);
    }
  }

  /**
   * Generate big bang migration phases
   */
  private generateBigBangPhases(replacementPlan: TypeReplacementPlan): MigrationPhase[] {
    const phases: MigrationPhase[] = [];

    // Phase 1: Preparation
    phases.push({
      id: 'prep',
      name: 'Preparation',
      description: 'Prepare for type replacement',
      order: 1,
      estimatedDuration: '30-60 minutes',
      riskLevel: 'low',
      prerequisites: ['Clean git state', 'Full test suite passing'],
      dependencies: [],
      steps: [
        {
          id: 'backup',
          description: 'Create backup branch',
          type: 'automated',
          command: 'git checkout -b backup-before-type-replacement',
          timeEstimate: '2 minutes',
          criticalPath: false
        },
        {
          id: 'baseline',
          description: 'Run baseline tests',
          type: 'automated',
          command: 'npm test',
          expectedOutput: 'All tests passing',
          timeEstimate: '10-30 minutes',
          criticalPath: true
        }
      ],
      validationCriteria: ['Backup branch created', 'All tests passing'],
      rollbackTriggers: ['Test failures']
    });

    // Phase 2: Execute replacement
    phases.push({
      id: 'replace',
      name: 'Type Replacement',
      description: 'Execute type replacement across all usage sites',
      order: 2,
      estimatedDuration: '1-3 hours',
      riskLevel: replacementPlan.compatibilityResult.isCompatible ? 'low' : 'medium',
      prerequisites: ['Preparation phase completed'],
      dependencies: ['prep'],
      steps: this.generateReplacementSteps(replacementPlan),
      validationCriteria: ['TypeScript compilation successful', 'No lint errors'],
      rollbackTriggers: ['Compilation errors', 'Critical test failures']
    });

    // Phase 3: Validation
    phases.push({
      id: 'validate',
      name: 'Validation',
      description: 'Comprehensive validation of changes',
      order: 3,
      estimatedDuration: '30-90 minutes',
      riskLevel: 'medium',
      prerequisites: ['Type replacement completed'],
      dependencies: ['replace'],
      steps: [
        {
          id: 'compile',
          description: 'Verify TypeScript compilation',
          type: 'automated',
          command: 'tsc --noEmit',
          timeEstimate: '2-5 minutes',
          criticalPath: true
        },
        {
          id: 'test',
          description: 'Run full test suite',
          type: 'automated',
          command: 'npm test',
          timeEstimate: '10-30 minutes',
          criticalPath: true
        },
        {
          id: 'lint',
          description: 'Run linter',
          type: 'automated',
          command: 'npm run lint',
          timeEstimate: '1-3 minutes',
          criticalPath: false
        }
      ],
      validationCriteria: ['All tests pass', 'No compilation errors', 'No lint errors'],
      rollbackTriggers: ['Any validation failure']
    });

    return phases;
  }

  /**
   * Generate phased migration phases
   */
  private generatePhasedMigration(
    replacementPlan: TypeReplacementPlan,
    dependencyGraph: Map<string, DependencyNode>
  ): MigrationPhase[] {
    const phases: MigrationPhase[] = [];

    // Sort nodes by priority (dependencies first)
    const sortedNodes = Array.from(dependencyGraph.values())
      .sort((a, b) => a.priority - b.priority);

    // Group usages by file for batching
    const usagesByFile = this.groupUsagesByFile(replacementPlan.affectedUsages);
    const fileGroups = this.createFileGroups(usagesByFile, sortedNodes);

    // Preparation phase
    phases.push(this.createPreparationPhase());

    // Create migration phases for each file group
    fileGroups.forEach((group, index) => {
      phases.push({
        id: `migrate-${index + 1}`,
        name: `Migration Batch ${index + 1}`,
        description: `Migrate types in ${group.files.join(', ')}`,
        order: index + 2,
        estimatedDuration: this.estimateBatchDuration(group.usages.length),
        riskLevel: this.assessBatchRisk(group.usages, replacementPlan.compatibilityResult),
        prerequisites: index === 0 ? ['Preparation completed'] : [`Migration Batch ${index} completed`],
        dependencies: index === 0 ? ['prep'] : [`migrate-${index}`],
        steps: this.generateBatchSteps(group, replacementPlan),
        validationCriteria: ['Batch compiles successfully', 'Affected tests pass'],
        rollbackTriggers: ['Compilation errors', 'Test failures in affected areas']
      });
    });

    // Final validation phase
    phases.push(this.createFinalValidationPhase(phases.length + 1));

    return phases;
  }

  /**
   * Generate feature flag migration phases
   */
  private generateFeatureFlagMigration(replacementPlan: TypeReplacementPlan): MigrationPhase[] {
    // Implementation for feature flag approach
    // This would involve creating parallel type definitions and gradually switching usage
    return this.generatePhasedMigration(replacementPlan, new Map());
  }

  /**
   * Generate parallel run migration phases
   */
  private generateParallelRunMigration(replacementPlan: TypeReplacementPlan): MigrationPhase[] {
    // Implementation for parallel run approach
    // This would involve running both old and new types simultaneously
    return this.generatePhasedMigration(replacementPlan, new Map());
  }

  /**
   * Generate replacement steps for a migration phase
   */
  private generateReplacementSteps(replacementPlan: TypeReplacementPlan): MigrationStep[] {
    const steps: MigrationStep[] = [];

    // Type definition replacement
    steps.push({
      id: 'update-type-def',
      description: `Replace type definition from ${replacementPlan.sourceType} to ${replacementPlan.targetType}`,
      type: 'manual',
      timeEstimate: '5-15 minutes',
      criticalPath: true,
      rollbackAction: `Revert type definition to ${replacementPlan.sourceType}`
    });

    // Codemod execution
    if (replacementPlan.codemodActions.length > 0) {
      steps.push({
        id: 'run-codemod',
        description: `Execute ${replacementPlan.codemodActions.length} codemod actions`,
        type: 'automated',
        command: 'funcqc type-replace --generate-codemod --execute',
        timeEstimate: this.estimateCodemodTime(replacementPlan.codemodActions.length),
        criticalPath: true,
        rollbackAction: 'Revert codemod changes'
      });
    }

    // Manual updates for non-automated changes
    const manualUpdates = replacementPlan.affectedUsages.length - replacementPlan.codemodActions.length;
    if (manualUpdates > 0) {
      steps.push({
        id: 'manual-updates',
        description: `Manually update ${manualUpdates} usage sites`,
        type: 'manual',
        timeEstimate: this.estimateManualUpdateTime(manualUpdates),
        criticalPath: true,
        rollbackAction: 'Revert manual changes'
      });
    }

    return steps;
  }

  /**
   * Group usages by file
   */
  private groupUsagesByFile(usages: TypeUsageInfo[]): Map<string, TypeUsageInfo[]> {
    const groups = new Map<string, TypeUsageInfo[]>();
    
    for (const usage of usages) {
      const existing = groups.get(usage.filePath) ?? [];
      existing.push(usage);
      groups.set(usage.filePath, existing);
    }
    
    return groups;
  }

  /**
   * Create file groups for batched migration
   */
  private createFileGroups(
    usagesByFile: Map<string, TypeUsageInfo[]>,
    _sortedNodes: DependencyNode[]
  ): Array<{ files: string[]; usages: TypeUsageInfo[] }> {
    const groups: Array<{ files: string[]; usages: TypeUsageInfo[] }> = [];
    const maxFilesPerBatch = 5;
    const maxUsagesPerBatch = 20;

    let currentGroup: { files: string[]; usages: TypeUsageInfo[] } = {
      files: [],
      usages: []
    };

    for (const [filePath, usages] of usagesByFile) {
      // Check if adding this file would exceed batch limits
      if (currentGroup.files.length >= maxFilesPerBatch || 
          currentGroup.usages.length + usages.length > maxUsagesPerBatch) {
        // Start new batch if current one has content
        if (currentGroup.files.length > 0) {
          groups.push(currentGroup);
          currentGroup = { files: [], usages: [] };
        }
      }

      currentGroup.files.push(filePath);
      currentGroup.usages.push(...usages);
    }

    // Add final group if it has content
    if (currentGroup.files.length > 0) {
      groups.push(currentGroup);
    }

    return groups.length > 0 ? groups : [{ files: [], usages: [] }];
  }

  /**
   * Create preparation phase
   */
  private createPreparationPhase(): MigrationPhase {
    return {
      id: 'prep',
      name: 'Preparation',
      description: 'Prepare for phased type migration',
      order: 1,
      estimatedDuration: '45-90 minutes',
      riskLevel: 'low',
      prerequisites: ['Clean git state', 'All tests passing', 'Team coordination complete'],
      dependencies: [],
      steps: [
        {
          id: 'branch',
          description: 'Create migration branch',
          type: 'automated',
          command: 'git checkout -b type-migration-phased',
          timeEstimate: '1 minute',
          criticalPath: false
        },
        {
          id: 'baseline',
          description: 'Establish baseline metrics',
          type: 'automated',
          command: 'npm test && npm run lint',
          timeEstimate: '30-60 minutes',
          criticalPath: true
        },
        {
          id: 'plan-review',
          description: 'Review migration plan with team',
          type: 'manual',
          timeEstimate: '15-30 minutes',
          criticalPath: false
        }
      ],
      validationCriteria: ['Migration branch created', 'Baseline tests pass', 'Plan approved'],
      rollbackTriggers: ['Baseline test failures']
    };
  }

  /**
   * Create final validation phase
   */
  private createFinalValidationPhase(order: number): MigrationPhase {
    return {
      id: 'final-validation',
      name: 'Final Validation',
      description: 'Comprehensive validation of completed migration',
      order,
      estimatedDuration: '60-120 minutes',
      riskLevel: 'medium',
      prerequisites: ['All migration batches completed'],
      dependencies: [], // Will be set based on previous phases
      steps: [
        {
          id: 'full-compile',
          description: 'Full TypeScript compilation check',
          type: 'automated',
          command: 'tsc --noEmit',
          timeEstimate: '5-15 minutes',
          criticalPath: true
        },
        {
          id: 'full-test',
          description: 'Complete test suite execution',
          type: 'automated',
          command: 'npm test',
          timeEstimate: '30-60 minutes',
          criticalPath: true
        },
        {
          id: 'integration-test',
          description: 'Run integration tests',
          type: 'automated',
          command: 'npm run test:integration',
          timeEstimate: '15-30 minutes',
          criticalPath: true
        },
        {
          id: 'performance-check',
          description: 'Verify no performance regressions',
          type: 'manual',
          timeEstimate: '10-15 minutes',
          criticalPath: false
        }
      ],
      validationCriteria: [
        'All TypeScript compilation successful',
        'All tests pass',
        'No performance regressions detected',
        'Code review approved'
      ],
      rollbackTriggers: ['Any critical validation failure']
    };
  }

  /**
   * Generate batch-specific migration steps
   */
  private generateBatchSteps(
    group: { files: string[]; usages: TypeUsageInfo[] },
    _replacementPlan: TypeReplacementPlan
  ): MigrationStep[] {
    const steps: MigrationStep[] = [];

    steps.push({
      id: 'batch-backup',
      description: `Backup files: ${group.files.join(', ')}`,
      type: 'automated',
      command: `git add ${group.files.join(' ')}`,
      timeEstimate: '1 minute',
      criticalPath: false
    });

    steps.push({
      id: 'batch-replace',
      description: `Replace ${group.usages.length} type usages in ${group.files.length} files`,
      type: 'automated',
      timeEstimate: this.estimateBatchReplacementTime(group.usages.length),
      criticalPath: true
    });

    steps.push({
      id: 'batch-compile',
      description: 'Verify batch compiles',
      type: 'automated',
      command: 'tsc --noEmit',
      timeEstimate: '2-5 minutes',
      criticalPath: true
    });

    steps.push({
      id: 'batch-test',
      description: 'Run affected tests',
      type: 'automated',
      command: `npm test -- ${group.files.map(f => `--testPathPattern=${f}`).join(' ')}`,
      timeEstimate: '5-15 minutes',
      criticalPath: true
    });

    return steps;
  }

  /**
   * Calculate time estimates for phases
   */
  private calculateTimeEstimates(phases: MigrationPhase[]): { total: string; criticalPath: string } {
    let totalMinutes = 0;
    let criticalPathMinutes = 0;

    for (const phase of phases) {
      const phaseDuration = this.parseTimeEstimate(phase.estimatedDuration);
      totalMinutes += phaseDuration.max;

      const criticalSteps = phase.steps.filter(s => s.criticalPath);
      const criticalDuration = criticalSteps.reduce((sum, step) => {
        return sum + this.parseTimeEstimate(step.timeEstimate).max;
      }, 0);
      
      criticalPathMinutes += criticalDuration;
    }

    return {
      total: this.formatDuration(totalMinutes),
      criticalPath: this.formatDuration(criticalPathMinutes)
    };
  }

  /**
   * Parse time estimate string to minutes
   */
  private parseTimeEstimate(estimate: string): { min: number; max: number } {
    // Simple parsing of estimates like "30-60 minutes", "1-2 hours"
    const hourMatch = estimate.match(/(\d+)(?:-(\d+))?\s*hours?/);
    const minuteMatch = estimate.match(/(\d+)(?:-(\d+))?\s*minutes?/);

    if (hourMatch) {
      const min = parseInt(hourMatch[1], 10) * 60;
      const max = hourMatch[2] ? parseInt(hourMatch[2], 10) * 60 : min;
      return { min, max };
    } else if (minuteMatch) {
      const min = parseInt(minuteMatch[1], 10);
      const max = minuteMatch[2] ? parseInt(minuteMatch[2], 10) : min;
      return { min, max };
    }

    return { min: 30, max: 30 }; // Default fallback
  }

  /**
   * Format duration in minutes to readable string
   */
  private formatDuration(minutes: number): string {
    if (minutes < 60) {
      return `${minutes} minutes`;
    } else if (minutes < 480) { // Less than 8 hours
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return mins > 0 ? `${hours}h ${mins}m` : `${hours} hours`;
    } else {
      const days = Math.floor(minutes / 480); // 8-hour work days
      const remainingHours = Math.floor((minutes % 480) / 60);
      return remainingHours > 0 ? `${days} days, ${remainingHours} hours` : `${days} days`;
    }
  }

  /**
   * Generate risk mitigation strategies
   */
  private generateRiskMitigation(
    replacementPlan: TypeReplacementPlan,
    _phases: MigrationPhase[]
  ): string[] {
    const strategies: string[] = [];

    strategies.push('Create backup branch before starting migration');
    strategies.push('Run comprehensive test suite before and after each phase');

    if (!replacementPlan.compatibilityResult.isCompatible) {
      strategies.push('Address all compatibility issues before proceeding');
      strategies.push('Have team member review changes before each phase');
    }

    if (replacementPlan.affectedUsages.length > 10) {
      strategies.push('Implement automated testing for all affected functions');
      strategies.push('Use feature flags if possible to enable gradual rollout');
    }

    strategies.push('Monitor application metrics closely during and after migration');
    strategies.push('Have dedicated time for rollback if issues are discovered');
    strategies.push('Document all changes and decisions for future reference');

    return strategies;
  }

  /**
   * Create rollback strategy
   */
  private createRollbackStrategy(
    replacementPlan: TypeReplacementPlan,
    phases: MigrationPhase[]
  ): RollbackStrategy {
    const hasBreakingChanges = !replacementPlan.compatibilityResult.isCompatible;
    const isComplex = phases.length > 3;

    return {
      type: isComplex ? 'manual_steps' : 'git_revert',
      triggerConditions: [
        'Critical test failures',
        'Production incidents related to type changes',
        'Performance degradation > 20%',
        'Compilation errors that cannot be quickly resolved'
      ],
      automatedSteps: [
        'Stop deployment pipeline',
        'Revert to backup branch',
        'Run verification tests'
      ],
      manualSteps: [
        'Assess impact and root cause',
        'Notify affected team members',
        'Review rollback safety',
        'Execute rollback plan',
        'Verify system stability',
        'Update incident log'
      ],
      estimatedRollbackTime: hasBreakingChanges ? '2-4 hours' : '30-60 minutes',
      dataRecoveryRequired: false
    };
  }

  /**
   * Generate success metrics
   */
  private generateSuccessMetrics(replacementPlan: TypeReplacementPlan): string[] {
    const metrics: string[] = [];

    metrics.push('All TypeScript compilation errors resolved');
    metrics.push('All existing tests continue to pass');
    metrics.push('No runtime errors introduced');
    
    if (replacementPlan.affectedUsages.length > 5) {
      metrics.push('All affected functions maintain expected behavior');
    }

    metrics.push('Code review approval obtained');
    metrics.push('No performance regressions detected');
    metrics.push('Team documentation updated');

    return metrics;
  }

  /**
   * Generate approach rationale
   */
  private generateApproachRationale(
    approach: MigrationStrategy['approach'],
    replacementPlan: TypeReplacementPlan,
    dependencyGraph: Map<string, DependencyNode>
  ): string {
    const usageCount = replacementPlan.affectedUsages.length;
    const hasBreaking = !replacementPlan.compatibilityResult.isCompatible;
    const complexity = replacementPlan.estimatedEffort;

    switch (approach) {
      case 'big_bang':
        return `Big bang approach selected due to: compatible types (${replacementPlan.compatibilityResult.compatibilityType}), low usage count (${usageCount}), and ${complexity} complexity level. This allows for quick, atomic replacement with minimal coordination overhead.`;

      case 'phased':
        return `Phased approach selected due to: ${hasBreaking ? 'breaking changes' : 'high usage count'} (${usageCount} usages), ${dependencyGraph.size} type dependencies, and ${complexity} complexity. This approach minimizes risk through incremental validation.`;

      case 'feature_flag':
        return `Feature flag approach selected due to: very high complexity (${complexity}), extensive usage (${usageCount}), and need for gradual rollout capability. This allows for safe experimentation and quick rollback.`;

      case 'parallel_run':
        return `Parallel run approach selected due to: critical system impact, ${hasBreaking ? 'breaking changes' : 'high risk tolerance requirements'}, and need for comprehensive validation before switching.`;

      default:
        return `Selected approach based on analysis of usage patterns, compatibility, and risk factors.`;
    }
  }

  // Helper methods for time estimation
  private estimateBatchDuration(usageCount: number): string {
    const minutes = Math.max(30, usageCount * 5);
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  private assessBatchRisk(
    _usages: TypeUsageInfo[],
    compatibilityResult: TypeCompatibilityResult
  ): MigrationPhase['riskLevel'] {
    if (!compatibilityResult.isCompatible) return 'high';
    if (compatibilityResult.migrationComplexity === 'breaking') return 'critical';
    if (compatibilityResult.migrationComplexity === 'complex') return 'medium';
    return 'low';
  }

  private estimateCodemodTime(actionCount: number): string {
    const minutes = Math.max(5, actionCount * 2);
    return `${minutes} minutes`;
  }

  private estimateManualUpdateTime(updateCount: number): string {
    const minutes = Math.max(10, updateCount * 8);
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  private estimateBatchReplacementTime(usageCount: number): string {
    const minutes = Math.max(10, usageCount * 3);
    return `${minutes} minutes`;
  }
}
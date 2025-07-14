import {
  LineageManager,
  RefactoringOperation,
  FunctionLineage,
  ChangesetMetrics,
  FunctionInfo,
  StorageAdapter,
  Lineage,
  LineageStatus,
  RefactoringChangeset,
} from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';
import { ErrorHandler, ErrorCode, createErrorHandler } from './error-handler.js';
import { Logger } from './cli-utils.js';


/**
 * LineageManagerImpl
 * 
 * Manages function lineage tracking and relationship analysis for refactoring operations.
 * This class is responsible for:
 * - Tracking function evolution through refactoring operations
 * - Managing parent-child relationships between functions
 * - Calculating changeset metrics for improved assessment
 * - Integrating with the existing lineages table
 */
class LineageManagerImpl implements LineageManager {
  private readonly errorHandler: ErrorHandler;
  private readonly logger: Logger;

  constructor(private storage: StorageAdapter, logger?: Logger) {
    this.logger = logger || new Logger(false, false);
    this.errorHandler = createErrorHandler(this.logger);
  }

  /**
   * Track a refactoring operation and create appropriate lineage records
   */
  async trackRefactoringOperation(operation: RefactoringOperation): Promise<void> {
    // Validate operation
    if (!operation.parentFunction) {
      throw new Error('Parent function is required for refactoring operation tracking');
    }

    if (!operation.childFunctions || operation.childFunctions.length === 0) {
      throw new Error('At least one child function is required for refactoring operation tracking');
    }

    // Create lineage record based on operation type
    const lineage: Lineage = {
      id: uuidv4(),
      fromIds: [operation.parentFunction],
      toIds: operation.childFunctions,
      kind: this.mapOperationTypeToLineageKind(operation.type),
      status: 'draft' as LineageStatus,
      confidence: this.calculateOperationConfidence(operation),
      note: `${operation.type} operation tracked by LineageManager for session ${operation.context.sessionId}`,
      gitCommit: '', // Will be updated when operation is committed
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Save lineage record
    await this.storage.saveLineage(lineage);

    // Update refactoring changeset if session exists
    await this.updateChangesetWithLineage(operation, lineage.id);
  }

  /**
   * Get related functions for a given function ID
   */
  async getRelatedFunctions(functionId: string): Promise<FunctionLineage> {
    // Get lineages where this function appears as either source or target
    const sourceLineages = await this.storage.getLineagesWithFunctionFilter(functionId);
    const targetLineages = await this.storage.getLineagesWithFunctionFilter(undefined, functionId);

    const parentFunctions: string[] = [];
    const childFunctions: string[] = [];
    const relatedFunctions: string[] = [];

    // Process source lineages (where functionId is the parent)
    for (const lineage of sourceLineages) {
      if (lineage.fromIds.includes(functionId)) {
        childFunctions.push(...lineage.toIds);
        relatedFunctions.push(...lineage.toIds);
      }
    }

    // Process target lineages (where functionId is a child)
    for (const lineage of targetLineages) {
      if (lineage.toIds.includes(functionId)) {
        parentFunctions.push(...lineage.fromIds);
        relatedFunctions.push(...lineage.fromIds);
      }
    }

    // Remove duplicates and self-references
    return {
      functionId,
      parentFunctions: Array.from(new Set(parentFunctions)).filter(id => id !== functionId),
      childFunctions: Array.from(new Set(childFunctions)).filter(id => id !== functionId),
      relatedFunctions: Array.from(new Set(relatedFunctions)).filter(id => id !== functionId),
      lineageType: 'split', // Default to split, should be determined by analysis
      createdAt: new Date()
    };
  }

  /**
   * Calculate metrics for a changeset of functions
   */
  async calculateChangesetMetrics(functions: FunctionInfo[]): Promise<ChangesetMetrics> {
    if (functions.length === 0) {
      return {
        totalComplexity: 0,
        totalLinesOfCode: 0,
        averageComplexity: 0,
        highRiskCount: 0,
        functionCount: 0,
        riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 }
      };
    }

    // Calculate basic metrics
    const functionsWithMetrics = functions.filter(f => f.metrics);
    const totalComplexity = functionsWithMetrics.reduce((sum, f) => sum + (f.metrics?.cyclomaticComplexity || 0), 0);
    const totalLinesOfCode = functionsWithMetrics.reduce((sum, f) => sum + (f.metrics?.linesOfCode || 0), 0);

    // Calculate risk distribution based on cyclomatic complexity
    const riskDistribution = {
      low: functionsWithMetrics.filter(f => (f.metrics?.cyclomaticComplexity || 0) <= 5).length,
      medium: functionsWithMetrics.filter(f => {
        const cc = f.metrics?.cyclomaticComplexity || 0;
        return cc > 5 && cc <= 10;
      }).length,
      high: functionsWithMetrics.filter(f => {
        const cc = f.metrics?.cyclomaticComplexity || 0;
        return cc > 10 && cc <= 20;
      }).length,
      critical: functionsWithMetrics.filter(f => (f.metrics?.cyclomaticComplexity || 0) > 20).length
    };

    // High risk count includes both high and critical
    const highRiskCount = riskDistribution.high + riskDistribution.critical;

    return {
      totalComplexity,
      totalLinesOfCode,
      averageComplexity: functionsWithMetrics.length > 0 ? totalComplexity / functionsWithMetrics.length : 0,
      highRiskCount,
      functionCount: functions.length,
      riskDistribution
    };
  }

  /**
   * Map refactoring operation type to lineage kind
   */
  private mapOperationTypeToLineageKind(operationType: string): 'rename' | 'signature-change' | 'inline' | 'split' {
    switch (operationType) {
      case 'split':
        return 'split';
      case 'extract':
        return 'split'; // Extract is a type of split operation
      case 'merge':
        return 'inline'; // Merge is a type of inline operation
      case 'rename':
        return 'rename';
      default:
        return 'signature-change'; // Default fallback
    }
  }

  /**
   * Calculate confidence score for an operation based on various factors
   */
  private calculateOperationConfidence(operation: RefactoringOperation): number {
    let confidence = 0.8; // Base confidence

    // Adjust based on operation type
    switch (operation.type) {
      case 'split':
      case 'extract':
        confidence = 0.9; // High confidence for split/extract operations
        break;
      case 'merge':
        confidence = 0.7; // Lower confidence for merge operations
        break;
      case 'rename':
        confidence = 0.95; // Very high confidence for renames
        break;
      default:
        confidence = 0.6; // Lower confidence for unknown operations
    }

    // Adjust based on number of child functions
    if (operation.childFunctions.length > 5) {
      confidence -= 0.1; // Reduce confidence for operations with many children
    }

    return Math.max(0.1, Math.min(1.0, confidence));
  }

  /**
   * Update the refactoring changeset with lineage information
   */
  private async updateChangesetWithLineage(operation: RefactoringOperation, _lineageId: string): Promise<void> {
    const operationName = 'updateChangesetWithLineage';
    
    try {
      // Try to find an existing changeset for this session that might be related
      const changesets = await this.storage.getRefactoringChangesetsBySession(operation.context.sessionId);
      
      // For now, we'll create a new changeset record if none exists
      // In a more sophisticated implementation, we might try to find and update existing ones
      
      if (changesets.length === 0) {
        // Create a placeholder changeset that can be updated later when snapshots are available
        const changeset: RefactoringChangeset = {
          id: uuidv4(),
          sessionId: operation.context.sessionId,
          operationType: operation.type as 'split' | 'extract' | 'merge' | 'rename',
          parentFunctionId: operation.parentFunction,
          childFunctionIds: operation.childFunctions,
          beforeSnapshotId: '', // Will be updated when snapshots are available
          afterSnapshotId: '', // Will be updated when snapshots are available
          healthAssessment: {
            totalFunctions: 0,
            totalComplexity: 0,
            riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
            averageRiskScore: 0,
            highRiskFunctions: [],
            overallGrade: 'F',
            overallScore: 0,
            qualityBreakdown: {
              complexity: { grade: 'F', score: 0 },
              maintainability: { grade: 'F', score: 0 },
              size: { grade: 'F', score: 0 }
            }
          },
          improvementMetrics: {
            complexityReduction: 0,
            riskImprovement: 0,
            maintainabilityGain: 0,
            functionExplosionScore: 0,
            overallGrade: 'F',
            isGenuine: false
          },
          isGenuineImprovement: false,
          functionExplosionScore: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        await this.storage.saveRefactoringChangeset(changeset);
      }
    } catch (error) {
      await this.handleChangesetError(error, operationName, operation);
    }
  }

  /**
   * Detect potential parent-child relationships automatically
   * This is a basic implementation that can be enhanced with more sophisticated detection
   */
  async detectRelationships(
    candidateParent: FunctionInfo,
    candidateChildren: FunctionInfo[]
  ): Promise<{ confidence: number; relationships: Array<{ parentId: string; childId: string }> }> {
    // Input validation
    if (!candidateParent || typeof candidateParent !== 'object' || !candidateParent.id || !candidateParent.name) {
      return {
        confidence: 0,
        relationships: []
      };
    }

    if (!Array.isArray(candidateChildren) || candidateChildren.length === 0) {
      return {
        confidence: 0,
        relationships: []
      };
    }

    // Validate that all children are valid FunctionInfo objects
    const validChildren = candidateChildren.filter(child => 
      child && typeof child === 'object' && child.id && child.name
    );

    if (validChildren.length === 0) {
      return {
        confidence: 0,
        relationships: []
      };
    }

    const relationships: Array<{ parentId: string; childId: string }> = [];
    let totalConfidence = 0;

    for (const child of validChildren) {
      const relationship = await this.analyzeRelationship(candidateParent, child);
      if (relationship.confidence > 0.5) {
        relationships.push({
          parentId: candidateParent.id,
          childId: child.id
        });
        totalConfidence += relationship.confidence;
      }
    }

    const averageConfidence = relationships.length > 0 ? totalConfidence / relationships.length : 0;

    return {
      confidence: averageConfidence,
      relationships
    };
  }

  /**
   * Analyze the relationship between two functions
   */
  private async analyzeRelationship(
    parent: FunctionInfo,
    child: FunctionInfo
  ): Promise<{ confidence: number; reasons: string[] }> {
    const reasons: string[] = [];
    let confidence = 0;

    // Check if they're in the same file
    if (parent.filePath === child.filePath) {
      confidence += 0.3;
      reasons.push('Same file location');
    }

    // Check name similarity
    if (child.name.includes(parent.name) || parent.name.includes(child.name)) {
      confidence += 0.2;
      reasons.push('Name similarity');
    }

    // Check if child function has lower complexity (suggesting extraction)
    if (parent.metrics && child.metrics) {
      if (child.metrics.cyclomaticComplexity < parent.metrics.cyclomaticComplexity) {
        confidence += 0.2;
        reasons.push('Lower complexity in child function');
      }

      // Check if child function is significantly smaller
      if (child.metrics.linesOfCode < parent.metrics.linesOfCode * 0.5) {
        confidence += 0.1;
        reasons.push('Child function is smaller');
      }
    }

    // Note: Temporal proximity check would require function creation timestamps
    // which are not currently available in FunctionInfo
    // This could be added in the future by tracking function creation in snapshots

    return { confidence: Math.min(1.0, confidence), reasons };
  }

  /**
   * Enhanced error handling for changeset operations with specific strategies per error type
   */
  private async handleChangesetError(
    error: unknown, 
    operationName: string, 
    operation: RefactoringOperation
  ): Promise<void> {
    const errorDetails = {
      sessionId: operation.context.sessionId,
      operationType: operation.type,
      parentFunction: operation.parentFunction,
      childFunctions: operation.childFunctions
    };

    // Classify the error and determine appropriate handling strategy
    const { errorCode, severity, recoverable } = this.classifyError(error);

    switch (severity) {
      case 'critical': {
        // Critical errors must fail the operation to prevent data corruption
        const criticalError = this.errorHandler.createError(
          errorCode,
          `Critical error in ${operationName}: operation failed to maintain data integrity`,
          errorDetails,
          error instanceof Error ? error : new Error(String(error))
        );
        throw criticalError;
      }

      case 'high': {
        // High severity errors should be retried with exponential backoff
        try {
          await this.errorHandler.withRetry(
            () => this.retryChangesetOperation(operation),
            `${operationName} retry`,
            errorCode
          );
          this.logger.info(`Successfully recovered from ${operationName} error after retry`);
        } catch (retryError) {
          // If retry fails, log detailed error and throw to notify calling code
          this.logger.error(
            `Failed to recover from ${operationName} error after retries`,
            { originalError: error, retryError, ...errorDetails }
          );
          // Throw to ensure calling code is notified of the failure
          const highSeverityError = this.errorHandler.createError(
            errorCode,
            `High severity error in ${operationName}: retry attempts failed`,
            errorDetails,
            retryError instanceof Error ? retryError : new Error(String(retryError))
          );
          throw highSeverityError;
        }
        break;
      }

      case 'medium': {
        // Medium severity errors are logged with warnings and suggestions
        this.logger.warn(
          `Recoverable error in ${operationName}: changeset update failed but operation continues`,
          errorDetails
        );
        
        if (recoverable) {
          this.logger.info('💡 This error is recoverable. Consider running the operation again after checking system resources.');
        }
        break;
      }

      case 'low': {
        // Low severity errors are logged for monitoring but don't interrupt operation
        this.logger.info(
          `Minor issue in ${operationName}: changeset metadata may be incomplete`,
          { error: error instanceof Error ? error.message : String(error), ...errorDetails }
        );
        break;
      }
    }
  }

  /**
   * Classify errors by type and determine handling strategy
   */
  private classifyError(error: unknown): {
    errorCode: ErrorCode;
    severity: 'critical' | 'high' | 'medium' | 'low';
    recoverable: boolean;
  } {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : 'Unknown';

    // Database connection/corruption errors are critical
    if (errorMessage.includes('database') && (
        errorMessage.includes('corrupt') || 
        errorMessage.includes('connection') ||
        errorMessage.includes('locked')
      )) {
      return {
        errorCode: ErrorCode.DATABASE_CORRUPTION,
        severity: 'critical',
        recoverable: false
      };
    }

    // Storage write errors are high severity
    if (errorMessage.includes('write') || 
        errorMessage.includes('save') || 
        errorMessage.includes('insert') ||
        errorMessage.includes('ENOSPC') ||
        errorMessage.includes('EACCES')) {
      return {
        errorCode: ErrorCode.STORAGE_WRITE_ERROR,
        severity: 'high',
        recoverable: true
      };
    }

    // Permission errors are high severity but potentially recoverable
    if (errorMessage.includes('permission') || 
        errorMessage.includes('EPERM') ||
        errorMessage.includes('access denied')) {
      return {
        errorCode: ErrorCode.FILE_PERMISSION_DENIED,
        severity: 'high',
        recoverable: true
      };
    }

    // Memory/resource errors are medium severity
    if (errorMessage.includes('memory') || 
        errorMessage.includes('ENOMEM') ||
        errorMessage.includes('resource')) {
      return {
        errorCode: ErrorCode.INSUFFICIENT_MEMORY,
        severity: 'medium',
        recoverable: true
      };
    }

    // Timeout errors are medium severity
    if (errorMessage.includes('timeout') || 
        errorMessage.includes('ETIMEDOUT') ||
        errorName.includes('Timeout')) {
      return {
        errorCode: ErrorCode.ANALYSIS_TIMEOUT,
        severity: 'medium',
        recoverable: true
      };
    }

    // Validation errors are typically low severity for changeset operations
    if (errorMessage.includes('validation') || 
        errorMessage.includes('invalid') ||
        errorMessage.includes('constraint')) {
      return {
        errorCode: ErrorCode.STORAGE_ERROR,
        severity: 'low',
        recoverable: true
      };
    }

    // Network errors (if any external services are used)
    if (errorMessage.includes('network') || 
        errorMessage.includes('ENOTFOUND') ||
        errorMessage.includes('ECONNREFUSED')) {
      return {
        errorCode: ErrorCode.STORAGE_ERROR,
        severity: 'medium',
        recoverable: true
      };
    }

    // Default to unknown error with medium severity
    return {
      errorCode: ErrorCode.UNKNOWN_ERROR,
      severity: 'medium',
      recoverable: false
    };
  }

  /**
   * Retry the changeset operation with simplified payload
   */
  private async retryChangesetOperation(operation: RefactoringOperation): Promise<void> {
    // Simplified retry - just create the basic changeset without complex metrics
    const changesets = await this.storage.getRefactoringChangesetsBySession(operation.context.sessionId);
    
    if (changesets.length === 0) {
      const minimalChangeset: RefactoringChangeset = {
        id: uuidv4(),
        sessionId: operation.context.sessionId,
        operationType: operation.type as 'split' | 'extract' | 'merge' | 'rename',
        parentFunctionId: operation.parentFunction,
        childFunctionIds: operation.childFunctions,
        beforeSnapshotId: '',
        afterSnapshotId: '',
        // Minimal default values to avoid complex calculations during retry
        healthAssessment: {
          totalFunctions: 0,
          totalComplexity: 0,
          riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
          averageRiskScore: 0,
          highRiskFunctions: [],
          overallGrade: 'F',
          overallScore: 0,
          qualityBreakdown: {
            complexity: { grade: 'F', score: 0 },
            maintainability: { grade: 'F', score: 0 },
            size: { grade: 'F', score: 0 }
          }
        },
        improvementMetrics: {
          complexityReduction: 0,
          riskImprovement: 0,
          maintainabilityGain: 0,
          functionExplosionScore: 0,
          overallGrade: 'F',
          isGenuine: false
        },
        isGenuineImprovement: false,
        functionExplosionScore: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await this.storage.saveRefactoringChangeset(minimalChangeset);
    }
  }
}

// Export the implementation
export { LineageManagerImpl };

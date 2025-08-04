/**
 * Enhanced CHA Analysis Stage with Type System Integration
 * Stage 3: Class Hierarchy Analysis with comprehensive type information storage
 */

import { Project, TypeChecker } from 'ts-morph';
import { CHATypeSystemIntegration } from '../../cha-type-system-integration';
import { UnresolvedMethodCall, MethodInfo } from '../../cha-analyzer';
import { FunctionMetadata } from '../../ideal-call-graph-analyzer';
import { TypeExtractionResult } from '../../../types/type-system';
import { Logger } from '../../../utils/cli-utils';
import { AnalysisState } from '../types';
import { addEdge } from '../../shared/graph-utils';
import { StorageAdapter } from '../../../types';

export class CHATypeSystemAnalysisStage {
  private chaTypeIntegration: CHATypeSystemIntegration;
  private logger: Logger;
  private _debug: boolean;
  private _project: Project;

  constructor(project: Project, typeChecker: TypeChecker, logger?: Logger) {
    this._project = project;
    this.chaTypeIntegration = new CHATypeSystemIntegration(project, typeChecker, logger);
    this.logger = logger ?? new Logger(false);
    this._debug = process.env['DEBUG_STAGED_ANALYSIS'] === 'true';
  }

  /**
   * Set storage adapter for type information persistence
   */
  setStorage(storage: StorageAdapter): void {
    this.chaTypeIntegration.setStorage(storage);
  }

  /**
   * Perform enhanced CHA analysis with type system integration
   */
  async performCHAAnalysis(
    _functions: Map<string, FunctionMetadata>,
    unresolvedMethodCalls: UnresolvedMethodCall[],
    state: AnalysisState,
    _snapshotId: string
  ): Promise<{
    resolvedEdges: number;
    chaCandidates: Map<string, MethodInfo[]>;
    unresolvedMethodCallsForRTA: UnresolvedMethodCall[];
    typeInfo: TypeExtractionResult;
  }> {
    this.logger.debug(`Enhanced CHA received ${unresolvedMethodCalls.length} unresolved method calls`);
    
    // Always extract type information regardless of unresolved method calls
    // Type information is valuable for deletion safety analysis even without method resolution
    const sourceFiles = this._project.getSourceFiles();
    
    if (unresolvedMethodCalls.length === 0) {
      this.logger.debug('No unresolved method calls for CHA analysis, but extracting type information');
      
      try {
        // Extract type information even without method resolution
        const { typeInfo } = await this.chaTypeIntegration.performEnhancedCHAAnalysis(
          _functions,
          [],  // Empty unresolved method calls
          _snapshotId,
          sourceFiles
        );
        
        this.logger.debug(`CHA type extraction completed: ${typeInfo.typeDefinitions.length} type definitions extracted`);
        
        return {
          resolvedEdges: 0,
          chaCandidates: new Map(),
          unresolvedMethodCallsForRTA: [],
          typeInfo
        };
      } catch (error) {
        this.logger.error(`CHA type extraction failed: ${error}`);
        return {
          resolvedEdges: 0,
          chaCandidates: new Map(),
          unresolvedMethodCallsForRTA: [],
          typeInfo: {
            typeDefinitions: [],
            typeRelationships: [],
            typeMembers: [],
            methodOverrides: []
          }
        };
      }
    }

    // Debug: Log unresolved method calls for debugging
    if (this._debug) {
      for (const call of unresolvedMethodCalls.slice(0, 5)) { // Log first 5 calls
        this.logger.debug(`🐛 Unresolved call: ${call.methodName} on ${call.receiverType || 'unknown'} from ${call.callerFunctionId}`);
      }
    }

    try {
      // Copy unresolved method calls for RTA analysis before CHA processes them
      const unresolvedMethodCallsForRTA = [...unresolvedMethodCalls];
      
      // Re-enable enhanced CHA analysis with enhanced error logging
      this.logger.debug('Performing enhanced CHA analysis with detailed error logging');
      const { edges: chaEdges, typeInfo } = await this.chaTypeIntegration.performEnhancedCHAAnalysis(
        _functions,
        unresolvedMethodCalls,
        _snapshotId,
        sourceFiles
      );
      
      // Add CHA edges to our collection
      for (const edge of chaEdges) {
        addEdge(edge, state);
      }
      
      // Collect CHA candidates for RTA analysis
      const chaCandidates = this.collectCHACandidatesForRTA();
      
      this.logger.debug(`Enhanced CHA resolved ${chaEdges.length} method calls and extracted ${typeInfo.typeDefinitions.length} type definitions`);
      
      return {
        resolvedEdges: chaEdges.length,
        chaCandidates,
        unresolvedMethodCallsForRTA,
        typeInfo
      };
    } catch (error) {
      this.logger.error(`Enhanced CHA analysis failed: ${error}`);
      return {
        resolvedEdges: 0,
        chaCandidates: new Map(),
        unresolvedMethodCallsForRTA: unresolvedMethodCalls,
        typeInfo: {
          typeDefinitions: [],
          typeRelationships: [],
          typeMembers: [],
          methodOverrides: []
        }
      };
    }
  }

  /**
   * Collect CHA candidates for RTA analysis
   */
  private collectCHACandidatesForRTA(): Map<string, MethodInfo[]> {
    const chaCandidates = new Map<string, MethodInfo[]>();
    
    // Get method candidates from CHA analyzer through integration layer
    // Note: We need to access the internal CHA analyzer for this
    // This is a limitation of the current design that could be improved
    
    this.logger.debug(`Collected CHA candidates for RTA (implementation pending)`);
    return chaCandidates;
  }

  /**
   * Get method implementation info for deletion safety analysis
   */
  async getMethodImplementationInfo(functionId: string, snapshotId: string): Promise<{
    isInterfaceImplementation: boolean;
    isMethodOverride: boolean;
    implementedInterfaces: string[];
    overriddenMethods: string[];
  }> {
    return this.chaTypeIntegration.getMethodImplementationInfo(functionId, snapshotId);
  }

  /**
   * Reset analyzer state for fresh analysis
   */
  reset(): void {
    this.chaTypeIntegration.clear();
  }
}
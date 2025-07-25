/**
 * Abstract base class for framework callback analyzers
 */

import { Logger } from '../../utils/cli-utils';
import { 
  CallbackRegistration, 
  CallbackTrigger, 
  VirtualCallEdge, 
  CallbackAnalysisResult,
  AnalysisContext
} from './types';

/**
 * Abstract base class for analyzing callback registration patterns in specific frameworks
 */
export abstract class FrameworkCallbackAnalyzer {
  protected logger: Logger;
  protected frameworkName: string;
  protected debug: boolean;

  constructor(frameworkName: string, logger?: Logger) {
    this.frameworkName = frameworkName;
    this.logger = logger ?? new Logger(false);
    this.debug = process.env['DEBUG_CALLBACK_ANALYSIS'] === 'true' || 
                 process.env[`DEBUG_${frameworkName.toUpperCase()}_ANALYSIS`] === 'true';
  }

  /**
   * Get the name of this framework analyzer
   */
  getFrameworkName(): string {
    return this.frameworkName;
  }

  /**
   * Check if this analyzer can handle the given source file
   * Override this method to implement framework-specific detection logic
   */
  abstract canAnalyze(context: AnalysisContext): boolean;

  /**
   * Analyze a source file for callback registration patterns
   */
  async analyze(context: AnalysisContext): Promise<CallbackAnalysisResult> {
    const filePath = context.sourceFile.getFilePath();
    const canAnalyze = this.canAnalyze(context);
    const enabled = context.frameworkConfig.enabled;
    
    // Debug: Always log analyze method calls for CLI files
    if (filePath.includes('cli.ts')) {
      console.log(`🔍 [${this.frameworkName}] analyze(${filePath}): enabled=${enabled}, canAnalyze=${canAnalyze}`);
    }
    
    if (!enabled || !canAnalyze) {
      if (filePath.includes('cli.ts')) {
        console.log(`🔍 [${this.frameworkName}] Returning empty result for ${filePath}: enabled=${enabled}, canAnalyze=${canAnalyze}`);
      }
      return this.createEmptyResult();
    }

    console.log(`🔍 [${this.frameworkName}] Starting analysis for ${filePath}`);

    if (this.debug) {
      this.logger.debug(`[${this.frameworkName}] Starting analysis for ${context.sourceFile.getFilePath()}`);
    }

    try {
      const registrations = await this.detectCallbackRegistrations(context);
      const triggers = await this.detectCallbackTriggers(context, registrations);
      const virtualEdges = await this.generateVirtualEdges(context, registrations, triggers);

      const result: CallbackAnalysisResult = {
        registrations,
        triggers,
        virtualEdges,
        registrationCount: registrations.length,
        virtualEdgeCount: virtualEdges.length
      };

      if (this.debug) {
        this.logger.debug(`[${this.frameworkName}] Found ${registrations.length} registrations, ${virtualEdges.length} virtual edges`);
      }

      return result;
    } catch (error) {
      this.logger.warn(`[${this.frameworkName}] Analysis failed: ${error instanceof Error ? error.message : String(error)}`);
      return this.createEmptyResult();
    }
  }

  /**
   * Detect callback registration patterns in the source file
   * Must be implemented by concrete framework analyzers
   */
  protected abstract detectCallbackRegistrations(context: AnalysisContext): Promise<CallbackRegistration[]>;

  /**
   * Detect callback trigger patterns in the source file
   * Must be implemented by concrete framework analyzers
   */
  protected abstract detectCallbackTriggers(
    context: AnalysisContext, 
    registrations: CallbackRegistration[]
  ): Promise<CallbackTrigger[]>;

  /**
   * Generate virtual call edges from callback registrations and triggers
   * Can be overridden by concrete analyzers for framework-specific logic
   */
  protected async generateVirtualEdges(
    context: AnalysisContext,
    registrations: CallbackRegistration[],
    triggers: CallbackTrigger[]
  ): Promise<VirtualCallEdge[]> {
    const edges: VirtualCallEdge[] = [];
    const filePath = context.sourceFile.getFilePath();

    console.log(`🔍 [${this.frameworkName}] generateVirtualEdges(${filePath}): ${registrations.length} registrations, ${triggers.length} triggers`);

    for (const trigger of triggers) {
      console.log(`🔍 [${this.frameworkName}] Processing trigger ${trigger.triggerMethod} with ${trigger.registrations.length} related registrations`);
      
      for (const registration of trigger.registrations) {
        if (registration.callbackFunctionId) {
          console.log(`🔍 [${this.frameworkName}] Creating virtual edge: ${trigger.triggerFunctionId} -> ${registration.callbackFunctionId}`);
          const edge = this.createVirtualEdge(trigger, registration, context);
          if (edge) {
            edges.push(edge);
          }
        } else {
          // For anonymous/inline callback functions, create a virtual function ID
          console.log(`🔍 [${this.frameworkName}] Creating virtual edge for anonymous callback: ${registration.callbackFunctionName || 'anonymous'}`);
          const virtualCallbackId = `anonymous_${registration.registrationMethod}_${registration.lineNumber}_${Date.now()}`;
          const virtualRegistration = {
            ...registration,
            callbackFunctionId: virtualCallbackId,
            callbackFunctionName: registration.callbackFunctionName || `<anonymous-${registration.registrationMethod}>`
          };
          
          const edge = this.createVirtualEdge(trigger, virtualRegistration, context);
          if (edge) {
            console.log(`🔍 [${this.frameworkName}] Created virtual edge for anonymous callback: ${trigger.triggerFunctionId} -> ${virtualCallbackId}`);
            edges.push(edge);
          }
        }
      }
    }

    console.log(`🔍 [${this.frameworkName}] generateVirtualEdges(${filePath}): ${edges.length} virtual edges created`);
    return edges;
  }

  /**
   * Create a virtual call edge from a trigger to a registered callback
   */
  protected createVirtualEdge(
    trigger: CallbackTrigger,
    registration: CallbackRegistration,
    _context: AnalysisContext
  ): VirtualCallEdge | null {
    if (!registration.callbackFunctionId) {
      return null;
    }

    const edgeId = this.generateVirtualEdgeId(trigger, registration);

    return {
      id: edgeId,
      callerFunctionId: trigger.triggerFunctionId,
      calleeFunctionId: registration.callbackFunctionId,
      calleeName: registration.callbackFunctionName || 'unknown',
      calleeSignature: registration.callbackFunctionName ? `${registration.callbackFunctionName}()` : 'unknown()',
      callType: 'virtual',
      virtualType: 'callback_registration',
      framework: this.frameworkName,
      registration,
      callContext: 'callback',
      lineNumber: trigger.lineNumber,
      columnNumber: trigger.columnNumber,
      isAsync: false, // Framework-specific analyzers can override this
      isChained: false,
      confidenceScore: registration.confidence,
      resolutionLevel: 'callback_registration' as const,
      resolutionSource: `${this.frameworkName}_callback`,
      runtimeConfirmed: false,
      candidates: [],
      analysisMetadata: {
        timestamp: Date.now(),
        analysisVersion: '1.0.0',
        sourceHash: ''
      },
      metadata: {
        framework: this.frameworkName,
        registrationMethod: registration.registrationMethod,
        triggerMethod: registration.triggerMethod,
        ...registration.metadata
      },
      createdAt: new Date().toISOString()
    } as VirtualCallEdge;
  }

  /**
   * Generate a unique ID for a virtual edge
   */
  protected generateVirtualEdgeId(trigger: CallbackTrigger, registration: CallbackRegistration): string {
    const components = [
      'virtual',
      this.frameworkName,
      trigger.triggerFunctionId.substring(0, 8),
      registration.callbackFunctionId?.substring(0, 8) || 'unknown',
      registration.registrationMethod,
      registration.lineNumber
    ];
    
    return components.join('_');
  }

  /**
   * Get the confidence score for a registration method
   */
  protected getConfidenceScore(registrationMethod: string, context: AnalysisContext): number {
    const defaultConfidence = context.frameworkConfig.defaultConfidence ?? 0.8;
    
    // Framework-specific confidence adjustments can be implemented in subclasses
    const knownMethods = context.frameworkConfig.registrationMethods;
    if (knownMethods.includes(registrationMethod)) {
      return Math.min(defaultConfidence + 0.1, 0.95);
    }
    
    return defaultConfidence;
  }

  /**
   * Create an empty analysis result
   */
  protected createEmptyResult(): CallbackAnalysisResult {
    return {
      registrations: [],
      triggers: [],
      virtualEdges: [],
      registrationCount: 0,
      virtualEdgeCount: 0
    };
  }

  /**
   * Helper method to find the containing function for a given line number
   */
  protected findContainingFunction(
    lineNumber: number, 
    fileFunctions: unknown[]
  ): unknown | null {
    for (const func of fileFunctions) {
      const f = func as { startLine: number; endLine: number };
      if (lineNumber >= f.startLine && lineNumber <= f.endLine) {
        return func;
      }
    }
    return null;
  }

  /**
   * Helper method to check if a function name matches any in the functions map
   */
  protected findFunctionByName(
    functionName: string, 
    allFunctions: Map<string, unknown>
  ): unknown | null {
    for (const func of allFunctions.values()) {
      const f = func as { name: string; displayName?: string; signature?: string };
      if (f.name === functionName || 
          f.displayName === functionName ||
          (f.signature && f.signature.includes(functionName))) {
        return func;
      }
    }
    return null;
  }
}
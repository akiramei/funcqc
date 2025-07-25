/**
 * Callback Registration Analysis Stage
 * Orchestrates framework-specific callback analyzers to detect and track callback registrations
 */

import { SourceFile } from 'ts-morph';
import { Logger } from '../../utils/cli-utils';
import { FunctionMetadata, IdealCallEdge } from '../ideal-call-graph-analyzer';
import { AnalysisState } from '../staged-analysis/types';
import { CallbackConfigManager } from '../../config/callback-config';
import { FrameworkCallbackAnalyzer } from './framework-analyzer';
import { CommanderCallbackAnalyzer } from './analyzers/commander-analyzer';
import { 
  CallbackAnalysisResult, 
  VirtualCallEdge, 
  AnalysisContext, 
  CallbackAnalysisConfig 
} from './types';

/**
 * Result of callback registration analysis for the entire project
 */
export interface CallbackRegistrationResult {
  /** All virtual call edges generated */
  virtualEdges: VirtualCallEdge[];
  /** Total number of callback registrations found */
  totalRegistrations: number;
  /** Total number of virtual edges created */
  totalVirtualEdges: number;
  /** Results broken down by framework */
  frameworkResults: Map<string, CallbackAnalysisResult>;
  /** Analysis statistics */
  statistics: {
    analyzedFiles: number;
    enabledFrameworks: string[];
    analysisTime: number;
  };
}

/**
 * Main stage for callback registration analysis
 */
export class CallbackRegistrationAnalysisStage {
  private logger: Logger;
  private debug: boolean;
  private configManager: CallbackConfigManager;
  private analyzers: Map<string, FrameworkCallbackAnalyzer>;

  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger(false);
    this.debug = process.env['DEBUG_CALLBACK_REGISTRATION'] === 'true';
    this.configManager = new CallbackConfigManager();
    this.analyzers = new Map();
    
    // Always log initialization to debug this issue
    this.logger.debug(`[CallbackRegistration] Initializing (debug=${this.debug}, env=${process.env['DEBUG_CALLBACK_REGISTRATION']})`);
    
    this.initializeAnalyzers();
  }

  /**
   * Initialize available framework analyzers
   */
  private initializeAnalyzers(): void {
    // Register built-in analyzers
    this.registerAnalyzer(new CommanderCallbackAnalyzer(this.logger));
    
    // TODO: Add other framework analyzers as they're implemented
    // this.registerAnalyzer(new ExpressCallbackAnalyzer(this.logger));
    // this.registerAnalyzer(new ReactCallbackAnalyzer(this.logger));
  }

  /**
   * Register a framework analyzer
   */
  registerAnalyzer(analyzer: FrameworkCallbackAnalyzer): void {
    this.analyzers.set(analyzer.getFrameworkName(), analyzer);
    
    if (this.debug) {
      this.logger.debug(`[CallbackRegistration] Registered analyzer: ${analyzer.getFrameworkName()}`);
    }
  }

  /**
   * Analyze callback registrations across all source files
   */
  async analyzeProject(
    sourceFiles: SourceFile[],
    functions: Map<string, FunctionMetadata>,
    state: AnalysisState,
    configPath?: string
  ): Promise<CallbackRegistrationResult> {
    const startTime = performance.now();
    
    // Load configuration
    const config = this.configManager.load(configPath);
    
    // Always log configuration loading
    this.logger.debug(`[CallbackRegistration] Config loaded: enabled=${config.enabled}, frameworks=${Object.keys(config.frameworks).join(',')}`);
    
    if (!config.enabled) {
      this.logger.debug('[CallbackRegistration] Analysis disabled in configuration');
      return this.createEmptyResult(0, []);
    }

    const enabledFrameworks = this.getEnabledFrameworks(config);
    if (enabledFrameworks.length === 0) {
      if (this.debug) {
        this.logger.debug('[CallbackRegistration] No frameworks enabled');
      }
      return this.createEmptyResult(0, enabledFrameworks);
    }

    if (this.debug) {
      this.logger.debug(`[CallbackRegistration] Starting analysis with frameworks: ${enabledFrameworks.join(', ')}`);
    }

    // Analyze each source file
    const frameworkResults = new Map<string, CallbackAnalysisResult>();
    const allVirtualEdges: VirtualCallEdge[] = [];
    let analyzedFiles = 0;

    for (const sourceFile of sourceFiles) {
      const fileResults = await this.analyzeSourceFile(sourceFile, functions, state, config);
      
      // Debug: Always log which files are being analyzed
      const filePath = sourceFile.getFilePath();
      this.logger.debug(`[CallbackRegistration] Analyzed ${filePath}: ${fileResults.size} frameworks detected`);
      
      if (fileResults.size > 0) {
        analyzedFiles++;
        
        // Merge results from all frameworks for this file
        for (const [framework, result] of fileResults) {
          const existingResult = frameworkResults.get(framework);
          if (existingResult) {
            // Merge with existing results
            existingResult.registrations.push(...result.registrations);
            existingResult.triggers.push(...result.triggers);
            existingResult.virtualEdges.push(...result.virtualEdges);
            existingResult.registrationCount += result.registrationCount;
            existingResult.virtualEdgeCount += result.virtualEdgeCount;
          } else {
            frameworkResults.set(framework, result);
          }
          
          allVirtualEdges.push(...result.virtualEdges);
        }
      }
    }

    const endTime = performance.now();
    const totalRegistrations = Array.from(frameworkResults.values())
      .reduce((sum, result) => sum + result.registrationCount, 0);

    const result: CallbackRegistrationResult = {
      virtualEdges: allVirtualEdges,
      totalRegistrations,
      totalVirtualEdges: allVirtualEdges.length,
      frameworkResults,
      statistics: {
        analyzedFiles,
        enabledFrameworks,
        analysisTime: (endTime - startTime) / 1000
      }
    };

    if (this.debug) {
      this.logger.debug(`[CallbackRegistration] Analysis complete: ${totalRegistrations} registrations, ${allVirtualEdges.length} virtual edges`);
    }

    return result;
  }

  /**
   * Analyze a single source file with all enabled framework analyzers
   */
  private async analyzeSourceFile(
    sourceFile: SourceFile,
    functions: Map<string, FunctionMetadata>,
    state: AnalysisState,
    config: CallbackAnalysisConfig
  ): Promise<Map<string, CallbackAnalysisResult>> {
    const results = new Map<string, CallbackAnalysisResult>();
    const filePath = sourceFile.getFilePath();
    const fileFunctions = state.fileToFunctionsMap.get(filePath) || [];

    if (fileFunctions.length === 0) {
      return results;
    }

    // Try each enabled framework analyzer
    for (const [frameworkName, analyzer] of this.analyzers) {
      const frameworkConfig = config.frameworks[frameworkName];
      
      if (!frameworkConfig?.enabled) {
        this.logger.debug(`[CallbackRegistration] Framework ${frameworkName} disabled, skipping ${filePath}`);
        continue;
      }

      try {
        const context: AnalysisContext = {
          sourceFile,
          fileFunctions,
          allFunctions: functions,
          frameworkConfig,
          globalOptions: config.options
        };

        // Check if analyzer can handle this file
        const canAnalyze = analyzer.canAnalyze(context);
        this.logger.debug(`[CallbackRegistration] ${frameworkName}.canAnalyze(${filePath}): ${canAnalyze}`);
        
        if (!canAnalyze) {
          continue;
        }

        const result = await analyzer.analyze(context);
        
        // Always log analysis results for debugging
        this.logger.debug(`[${frameworkName}] ${filePath}: ${result.registrationCount} registrations, ${result.virtualEdgeCount} virtual edges`);
        
        if (result.registrationCount > 0 || result.virtualEdgeCount > 0) {
          results.set(frameworkName, result);
        }
      } catch (error) {
        this.logger.warn(`[CallbackRegistration] Error analyzing ${filePath} with ${frameworkName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return results;
  }

  /**
   * Convert virtual edges to ideal call edges for integration with the main analysis pipeline
   */
  convertVirtualEdgesToIdealEdges(virtualEdges: VirtualCallEdge[]): IdealCallEdge[] {
    return virtualEdges.map(edge => ({
      id: edge.id,
      callerFunctionId: edge.callerFunctionId,
      calleeFunctionId: edge.calleeFunctionId,
      calleeName: edge.calleeName,
      calleeSignature: edge.calleeSignature,
      callerClassName: edge.callerClassName,
      calleeClassName: edge.calleeClassName,
      callType: 'virtual', // Virtual callback edge type
      callContext: edge.callContext,
      lineNumber: edge.lineNumber,
      columnNumber: edge.columnNumber,
      isAsync: edge.isAsync,
      isChained: edge.isChained,
      confidenceScore: edge.confidenceScore,
      resolutionLevel: edge.resolutionLevel,
      resolutionSource: edge.resolutionSource,
      runtimeConfirmed: edge.runtimeConfirmed,
      candidates: edge.candidates,
      analysisMetadata: edge.analysisMetadata,
      metadata: {
        ...edge.metadata,
        virtualType: edge.virtualType,
        framework: edge.framework,
        registration: edge.registration
      },
      createdAt: edge.createdAt
    } as IdealCallEdge));
  }

  /**
   * Get list of enabled frameworks from configuration
   */
  private getEnabledFrameworks(config: CallbackAnalysisConfig): string[] {
    const enabled: string[] = [];
    
    for (const [frameworkName, frameworkConfig] of Object.entries(config.frameworks)) {
      if (frameworkConfig.enabled && this.analyzers.has(frameworkName)) {
        enabled.push(frameworkName);
      }
    }
    
    return enabled;
  }

  /**
   * Create an empty result for when analysis is disabled or no frameworks are enabled
   */
  private createEmptyResult(analyzedFiles: number, enabledFrameworks: string[]): CallbackRegistrationResult {
    return {
      virtualEdges: [],
      totalRegistrations: 0,
      totalVirtualEdges: 0,
      frameworkResults: new Map(),
      statistics: {
        analyzedFiles,
        enabledFrameworks,
        analysisTime: 0
      }
    };
  }

  /**
   * Get configuration manager (for testing or external use)
   */
  getConfigManager(): CallbackConfigManager {
    return this.configManager;
  }

  /**
   * Get registered analyzers (for testing or external use)
   */
  getAnalyzers(): Map<string, FrameworkCallbackAnalyzer> {
    return this.analyzers;
  }
}
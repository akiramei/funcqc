/**
 * External Call Analysis Stage
 * Detects and tracks external function calls (console.log, process.exit, npm packages, etc.)
 */

import { CallExpression, Node, SourceFile } from 'ts-morph';
import { IdealCallEdge, FunctionMetadata, ResolutionLevel } from '../../ideal-call-graph-analyzer';
import { Logger } from '../../../utils/cli-utils';
import { generateCallSiteEdgeId } from '../../../utils/edge-id-generator';
import { AnalysisState } from '../types';

export interface ExternalCallInfo {
  callerFunctionId: string;
  calleeName: string;
  callType: 'global' | 'property' | 'import' | 'builtin';
  lineNumber: number;
  columnNumber: number;
  confidence: number;
  namespace?: string; // e.g., 'console', 'process', 'chalk'
}

export class ExternalCallAnalysisStage {
  private logger: Logger;
  private debug: boolean;

  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger(false);
    this.debug = process.env['DEBUG_EXTERNAL_ANALYSIS'] === 'true';
  }

  /**
   * Analyze external function calls in a source file
   */
  async analyzeFile(
    sourceFile: SourceFile,
    fileFunctions: FunctionMetadata[],
    functions: Map<string, FunctionMetadata>,
    _state: AnalysisState
  ): Promise<{ externalEdges: IdealCallEdge[], externalCallsCount: number }> {
    const filePath = sourceFile.getFilePath();
    const externalEdges: IdealCallEdge[] = [];
    let externalCallsCount = 0;

    if (fileFunctions.length === 0) {
      return { externalEdges: [], externalCallsCount: 0 };
    }

    if (this.debug) {
      this.logger.debug(`[ExternalAnalysis] Starting analysis for ${filePath} with ${fileFunctions.length} functions`);
    }

    // Collect all call expressions in the file
    const callExpressions: CallExpression[] = [];
    sourceFile.forEachDescendant((node: Node) => {
      if (Node.isCallExpression(node)) {
        callExpressions.push(node);
      }
    });

    // Analyze each call expression
    for (const callExpression of callExpressions) {
      const callerFunction = this.findContainingFunction(callExpression, fileFunctions);
      if (!callerFunction) {
        continue;
      }

      const externalCallInfo = this.detectExternalCall(callExpression, callerFunction, functions);
      if (externalCallInfo) {
        const edge = this.createExternalCallEdge(externalCallInfo);
        if (edge) {
          externalEdges.push(edge);
          externalCallsCount++;
          
          if (this.debug) {
            this.logger.debug(`[ExternalCall] ${callerFunction.name} -> ${externalCallInfo.calleeName} (${externalCallInfo.callType})`);
          }
        }
      }
    }

    if (this.debug) {
      this.logger.debug(`[ExternalAnalysis] Found ${externalCallsCount} external calls in ${filePath}`);
    }

    return { externalEdges, externalCallsCount };
  }

  /**
   * Detect if a call expression is calling an external function
   */
  private detectExternalCall(
    callExpression: CallExpression,
    callerFunction: FunctionMetadata,
    functions: Map<string, FunctionMetadata>
  ): ExternalCallInfo | null {
    const expression = callExpression.getExpression();
    const lineNumber = callExpression.getStartLineNumber();
    const columnNumber = callExpression.getStart();

    // Get the call text for analysis (available for future use)
    // const callText = expression.getText();
    
    // Check for property access calls (e.g., console.log, process.exit)
    if (Node.isPropertyAccessExpression(expression)) {
      const object = expression.getExpression().getText();
      const property = expression.getName();
      const calleeName = `${object}.${property}`;

      // Check if this is not an internal function
      if (!this.isInternalFunction(calleeName, functions)) {
        return {
          callerFunctionId: callerFunction.id,
          calleeName,
          callType: this.getExternalCallType(object, property),
          lineNumber,
          columnNumber,
          confidence: this.getConfidenceScore(object, property),
          namespace: object
        };
      }
    }

    // Check for direct function calls (e.g., require(), setTimeout())
    if (Node.isIdentifier(expression)) {
      const functionName = expression.getText();
      
      // Check if this is not an internal function and is a known global
      if (!this.isInternalFunction(functionName, functions) && this.isKnownGlobal(functionName)) {
        return {
          callerFunctionId: callerFunction.id,
          calleeName: functionName,
          callType: 'global',
          lineNumber,
          columnNumber,
          confidence: this.getGlobalConfidenceScore(functionName)
        };
      }
    }

    // Check for element access calls (e.g., obj['method']())
    if (Node.isElementAccessExpression(expression)) {
      const object = expression.getExpression().getText();
      const propertyExpression = expression.getArgumentExpression();
      
      if (Node.isStringLiteral(propertyExpression)) {
        const _property = propertyExpression.getLiteralValue();
        const calleeName = `${object}["${_property}"]`;
        
        if (!this.isInternalFunction(calleeName, functions)) {
          return {
            callerFunctionId: callerFunction.id,
            calleeName,
            callType: 'property',
            lineNumber,
            columnNumber,
            confidence: 0.7, // Lower confidence for dynamic property access
            namespace: object
          };
        }
      }
    }

    return null;
  }

  /**
   * Check if a function name corresponds to an internal function
   */
  private isInternalFunction(functionName: string, functions: Map<string, FunctionMetadata>): boolean {
    // Check exact matches and method signatures
    for (const func of functions.values()) {
      if (func.name === functionName || 
          functionName.includes(func.name) ||
          func.signature?.includes(functionName)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Determine the type of external call
   */
  private getExternalCallType(object: string, _property: string): 'global' | 'property' | 'import' | 'builtin' {
    // Built-in Node.js globals
    if (['console', 'process', 'Buffer', 'global', '__dirname', '__filename'].includes(object)) {
      return 'builtin';
    }

    // Common global objects
    if (['window', 'document', 'navigator', 'location'].includes(object)) {
      return 'global';
    }

    // Likely imported modules (heuristic based)
    if (object.length > 2 && /^[a-z]/.test(object)) {
      return 'import';
    }

    return 'property';
  }

  /**
   * Check if a function name is a known global function
   */
  private isKnownGlobal(functionName: string): boolean {
    const knownGlobals = [
      // Node.js globals
      'require', 'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate',
      // JavaScript built-ins
      'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent',
      // Common functions that might be global
      'eval', 'alert', 'confirm', 'prompt'
    ];
    
    return knownGlobals.includes(functionName);
  }

  /**
   * Get confidence score for external calls
   */
  private getConfidenceScore(object: string, property: string): number {
    // High confidence for well-known APIs
    if (object === 'console' && ['log', 'error', 'warn', 'info', 'debug'].includes(property)) {
      return 0.95;
    }
    
    if (object === 'process' && ['exit', 'argv', 'env', 'cwd'].includes(property)) {
      return 0.95;
    }

    // Medium confidence for Node.js built-ins
    if (['console', 'process', 'Buffer'].includes(object)) {
      return 0.85;
    }

    // Lower confidence for other external calls
    return 0.7;
  }

  /**
   * Get confidence score for global function calls
   */
  private getGlobalConfidenceScore(functionName: string): number {
    // High confidence for common Node.js globals
    if (['require', 'setTimeout', 'setInterval'].includes(functionName)) {
      return 0.9;
    }

    // Medium confidence for other globals
    return 0.75;
  }

  /**
   * Create an IdealCallEdge for an external function call
   */
  private createExternalCallEdge(externalCallInfo: ExternalCallInfo): IdealCallEdge {
    return {
      id: generateCallSiteEdgeId(
        externalCallInfo.callerFunctionId, 
        `external:${externalCallInfo.calleeName}`,
        externalCallInfo.lineNumber,
        externalCallInfo.columnNumber
      ),
      callerFunctionId: externalCallInfo.callerFunctionId,
      calleeFunctionId: undefined, // External functions have no internal ID
      calleeName: externalCallInfo.calleeName,
      calleeSignature: `${externalCallInfo.calleeName}()`,
      callType: 'external',
      callContext: 'normal',
      lineNumber: externalCallInfo.lineNumber,
      columnNumber: externalCallInfo.columnNumber,
      isAsync: false, // Cannot determine for external calls
      isChained: false,
      confidenceScore: externalCallInfo.confidence,
      resolutionLevel: ResolutionLevel.EXTERNAL_DETECTED,
      resolutionSource: 'external_analysis',
      runtimeConfirmed: false,
      candidates: [],
      analysisMetadata: {
        timestamp: Date.now(),
        analysisVersion: '1.0.0',
        sourceHash: ''
      },
      metadata: {
        namespace: externalCallInfo.namespace,
        callType: externalCallInfo.callType,
        external: true
      },
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Find the function containing a given node
   */
  private findContainingFunction(node: Node, fileFunctions: FunctionMetadata[]): FunctionMetadata | null {
    const lineNumber = node.getStartLineNumber();
    
    for (const func of fileFunctions) {
      if (lineNumber >= func.startLine && lineNumber <= func.endLine) {
        return func;
      }
    }
    
    return null;
  }
}
/**
 * Types for callback registration framework analysis
 */

import { SourceFile } from 'ts-morph';
import { FunctionMetadata, IdealCallEdge } from '../ideal-call-graph-analyzer';

/**
 * Information about a detected callback registration
 */
export interface CallbackRegistration {
  /** ID of the function that registers the callback */
  registrarFunctionId: string;
  /** The callback function that gets registered */
  callbackFunctionId: string;
  /** Name of the callback function (if identifiable) */
  callbackFunctionName?: string;
  /** The method used to register the callback (e.g., 'action', 'get', 'use') */
  registrationMethod: string;
  /** The trigger method that will invoke callbacks (e.g., 'parseAsync', 'listen') */
  triggerMethod: string;
  /** Line number where registration occurs */
  lineNumber: number;
  /** Column number where registration occurs */
  columnNumber: number;
  /** Confidence score for this detection */
  confidence: number;
  /** Framework-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Information about a callback trigger (the function that calls registered callbacks)
 */
export interface CallbackTrigger {
  /** ID of the function that triggers callbacks */
  triggerFunctionId: string;
  /** Name of the trigger function */
  triggerFunctionName: string;
  /** The method name that triggers callbacks */
  triggerMethod: string;
  /** Line number where trigger occurs */
  lineNumber: number;
  /** Column number where trigger occurs */
  columnNumber: number;
  /** Associated registrations that this trigger will invoke */
  registrations: CallbackRegistration[];
}

/**
 * Virtual call edge representing callback invocation
 */
export interface VirtualCallEdge extends Omit<IdealCallEdge, 'id' | 'callType'> {
  /** Unique identifier for this virtual edge */
  id: string;
  /** Always 'virtual' for callback edges */
  callType: 'virtual';
  /** Type of virtual edge */
  virtualType: 'callback_registration';
  /** Framework that generated this edge */
  framework: string;
  /** Original registration information */
  registration: CallbackRegistration;
}

/**
 * Result of framework callback analysis
 */
export interface CallbackAnalysisResult {
  /** Detected callback registrations */
  registrations: CallbackRegistration[];
  /** Detected callback triggers */
  triggers: CallbackTrigger[];
  /** Generated virtual call edges */
  virtualEdges: VirtualCallEdge[];
  /** Total count of callback registrations found */
  registrationCount: number;
  /** Total count of virtual edges created */
  virtualEdgeCount: number;
}

/**
 * Configuration for a specific framework analyzer
 */
export interface FrameworkConfig {
  /** Whether this framework analyzer is enabled */
  enabled: boolean;
  /** Methods that trigger callback execution */
  triggerMethods: string[];
  /** Methods that register callbacks */
  registrationMethods: string[];
  /** Confidence score to assign to detected callbacks */
  defaultConfidence?: number;
  /** Framework-specific options */
  options?: Record<string, unknown>;
}

/**
 * Overall configuration for callback analysis
 */
export interface CallbackAnalysisConfig {
  /** Whether callback analysis is enabled globally */
  enabled: boolean;
  /** Framework-specific configurations */
  frameworks: Record<string, FrameworkConfig>;
  /** Global options */
  options?: {
    /** Maximum depth for callback chain analysis */
    maxDepth?: number;
    /** Whether to include low-confidence detections */
    includeLowConfidence?: boolean;
    /** Minimum confidence threshold */
    minConfidence?: number;
  };
}

/**
 * Context passed to framework analyzers
 */
export interface AnalysisContext {
  /** Source file being analyzed */
  sourceFile: SourceFile;
  /** Functions in the current file */
  fileFunctions: FunctionMetadata[];
  /** All functions in the project */
  allFunctions: Map<string, FunctionMetadata>;
  /** Framework configuration */
  frameworkConfig: FrameworkConfig;
  /** Global analysis options */
  globalOptions?: CallbackAnalysisConfig['options'];
}
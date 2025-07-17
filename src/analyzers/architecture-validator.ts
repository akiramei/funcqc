import { minimatch } from 'minimatch';
import { Project } from 'ts-morph';
import path from 'path';
import {
  ArchitectureConfig,
  ArchitectureRule,
  ArchitectureViolation,
  ArchitectureAnalysisResult,
  LayerAssignment,
} from '../types/architecture';
import { FunctionInfo, CallEdge } from '../types';
import { LayerAssigner } from './layer-assigner';

interface ImportDependency {
  fromFilePath: string;
  toFilePath: string;
  importType: 'relative' | 'absolute' | 'external';
  lineNumber: number;
}

/**
 * Validates architecture rules and detects violations
 */
export class ArchitectureValidator {
  private config: ArchitectureConfig;
  private layerAssigner: LayerAssigner;
  private project: Project;

  constructor(config: ArchitectureConfig) {
    this.config = config;
    this.layerAssigner = new LayerAssigner(config);
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      skipLoadingLibFiles: true,
    });
  }

  /**
   * Analyze architecture compliance for a set of functions and call edges
   */
  analyzeArchitecture(
    functions: FunctionInfo[],
    callEdges: CallEdge[]
  ): ArchitectureAnalysisResult {
    // Assign layers to functions
    const layerAssignments = this.layerAssigner.assignLayers(functions);
    const assignmentMap = this.createAssignmentMap(layerAssignments, functions);

    // Analyze import dependencies
    const importDependencies = this.analyzeImportDependencies(functions);

    // Detect violations (both call and import dependencies)
    const violations = this.detectViolations(functions, callEdges, assignmentMap, importDependencies);

    // Calculate metrics
    const metrics = this.calculateArchitectureMetrics(layerAssignments, callEdges, assignmentMap, importDependencies);

    // Generate summary
    const summary = this.generateSummary(functions, layerAssignments, violations);

    return {
      summary,
      layerAssignments,
      violations,
      metrics,
    };
  }

  /**
   * Analyze import dependencies between files
   */
  private analyzeImportDependencies(functions: FunctionInfo[]): ImportDependency[] {
    const dependencies: ImportDependency[] = [];
    const processedFiles = new Set<string>();

    for (const func of functions) {
      if (processedFiles.has(func.filePath)) {
        continue;
      }
      processedFiles.add(func.filePath);

      try {
        const sourceFile = this.project.addSourceFileAtPath(func.filePath);
        const importDeclarations = sourceFile.getImportDeclarations();

        for (const importDecl of importDeclarations) {
          const moduleSpecifier = importDecl.getModuleSpecifierValue();
          if (!moduleSpecifier) continue;

          const resolvedPath = this.resolveImportPath(func.filePath, moduleSpecifier);
          if (!resolvedPath) continue;

          const importType = this.getImportType(moduleSpecifier);
          
          dependencies.push({
            fromFilePath: func.filePath,
            toFilePath: resolvedPath,
            importType,
            lineNumber: importDecl.getStartLineNumber(),
          });
        }
      } catch (error) {
        // Skip files that can't be parsed
        console.warn(`Warning: Could not analyze imports for ${func.filePath}: ${error}`);
      }
    }

    return dependencies;
  }

  /**
   * Resolve import path to absolute file path
   */
  private resolveImportPath(fromFilePath: string, importPath: string): string | null {
    if (importPath.startsWith('.')) {
      // Relative import
      const fromDir = path.dirname(fromFilePath);
      const resolved = path.resolve(fromDir, importPath);
      
      // Add .ts extension if missing
      if (!resolved.endsWith('.ts') && !resolved.endsWith('.tsx') && !resolved.endsWith('.js')) {
        return resolved + '.ts';
      }
      return resolved;
    } else if (!importPath.includes('/') || importPath.startsWith('@')) {
      // External package
      return null; // We don't track external dependencies for architecture linting
    } else {
      // Absolute import within project
      return importPath;
    }
  }

  /**
   * Determine import type
   */
  private getImportType(importPath: string): 'relative' | 'absolute' | 'external' {
    if (importPath.startsWith('.')) {
      return 'relative';
    } else if (!importPath.includes('/') || importPath.startsWith('@')) {
      return 'external';
    } else {
      return 'absolute';
    }
  }

  /**
   * Detect architecture rule violations
   */
  private detectViolations(
    functions: FunctionInfo[],
    callEdges: CallEdge[],
    assignmentMap: Map<string, LayerAssignment>,
    importDependencies: ImportDependency[]
  ): ArchitectureViolation[] {
    const violations: ArchitectureViolation[] = [];
    const functionMap = new Map(functions.map(f => [f.id, f]));

    for (const edge of callEdges) {
      const callerAssignment = assignmentMap.get(edge.callerFunctionId);
      const calleeAssignment = assignmentMap.get(edge.calleeFunctionId || '');

      // Skip if either function is not assigned to a layer
      if (!callerAssignment || !calleeAssignment) {
        if (this.config.settings?.strictMode && (!callerAssignment || !calleeAssignment)) {
          // In strict mode, create violations for unassigned functions
          const violation = this.createUnassignedViolation(edge, functionMap, callerAssignment, calleeAssignment);
          if (violation) {
            violations.push(violation);
          }
        }
        continue;
      }

      // Skip same-layer calls if allowed
      if (callerAssignment.layer === calleeAssignment.layer && this.config.settings?.allowSameLayer) {
        continue;
      }

      // Skip external dependencies if configured
      if (this.config.settings?.ignoreExternal && this.isExternalDependency(edge, functionMap)) {
        continue;
      }

      // Check each rule for violations
      for (const rule of this.config.rules) {
        const violation = this.checkRuleViolation(
          rule,
          edge,
          callerAssignment,
          calleeAssignment,
          functionMap
        );
        if (violation) {
          violations.push(violation);
        }
      }
    }

    // Check import dependencies for violations
    const layerAssignmentsByPath = this.createLayerAssignmentsByPath(functions, assignmentMap);
    
    for (const importDep of importDependencies) {
      if (importDep.importType === 'external') {
        continue; // Skip external dependencies
      }

      const fromLayer = layerAssignmentsByPath.get(this.normalizePath(importDep.fromFilePath));
      const toLayer = layerAssignmentsByPath.get(this.normalizePath(importDep.toFilePath));

      if (!fromLayer || !toLayer) {
        continue; // Skip if either file is not assigned to a layer
      }

      // Skip same-layer dependencies if allowed
      if (fromLayer === toLayer && this.config.settings?.allowSameLayer) {
        continue;
      }

      // Check each rule for violations
      for (const rule of this.config.rules) {
        const violation = this.checkImportRuleViolation(
          rule,
          importDep,
          fromLayer,
          toLayer
        );
        if (violation) {
          violations.push(violation);
        }
      }
    }

    return violations;
  }

  /**
   * Create a map from file path to layer name
   */
  private createLayerAssignmentsByPath(
    functions: FunctionInfo[],
    assignmentMap: Map<string, LayerAssignment>
  ): Map<string, string> {
    const map = new Map<string, string>();
    
    for (const func of functions) {
      const assignment = assignmentMap.get(func.id);
      if (assignment) {
        map.set(this.normalizePath(func.filePath), assignment.layer);
      }
    }
    
    return map;
  }

  /**
   * Check if a specific rule is violated by an import dependency
   */
  private checkImportRuleViolation(
    rule: ArchitectureRule,
    importDep: ImportDependency,
    fromLayer: string,
    toLayer: string
  ): ArchitectureViolation | null {
    const fromMatches = this.matchesPattern(fromLayer, rule.from);
    const toMatches = this.matchesPattern(toLayer, rule.to);

    let isViolation = false;

    if (rule.type === 'forbid' && fromMatches && toMatches) {
      isViolation = true;
    } else if (rule.type === 'allow') {
      // For allow rules, violation occurs when the dependency is NOT allowed
      return null; // Skip for now, focus on forbid rules
    }

    if (!isViolation) {
      return null;
    }

    return {
      id: this.generateImportViolationId(importDep, rule),
      rule,
      source: {
        functionId: '', // No specific function for import violations
        functionName: '',
        filePath: importDep.fromFilePath,
        layer: fromLayer,
      },
      target: {
        functionId: '', // No specific function for import violations
        functionName: '',
        filePath: importDep.toFilePath,
        layer: toLayer,
      },
      severity: rule.severity || this.config.settings?.defaultSeverity || 'error',
      message: this.generateViolationMessage(rule, fromLayer, toLayer),
      context: {
        callType: 'import',
        lineNumber: importDep.lineNumber,
        importType: importDep.importType,
      },
    };
  }

  /**
   * Generate a unique violation ID for import dependencies
   */
  private generateImportViolationId(importDep: ImportDependency, rule: ArchitectureRule): string {
    const ruleId = `${rule.type}-${Array.isArray(rule.from) ? rule.from.join(',') : rule.from}-${Array.isArray(rule.to) ? rule.to.join(',') : rule.to}`;
    const fromPath = this.normalizePath(importDep.fromFilePath).replace(/[^a-zA-Z0-9]/g, '-');
    const toPath = this.normalizePath(importDep.toFilePath).replace(/[^a-zA-Z0-9]/g, '-');
    return `import-${ruleId}-${fromPath}-${toPath}`;
  }

  /**
   * Check if a specific rule is violated by a call edge
   */
  private checkRuleViolation(
    rule: ArchitectureRule,
    edge: CallEdge,
    callerAssignment: LayerAssignment,
    calleeAssignment: LayerAssignment,
    functionMap: Map<string, FunctionInfo>
  ): ArchitectureViolation | null {
    const callerMatches = this.matchesPattern(callerAssignment.layer, rule.from);
    const calleeMatches = this.matchesPattern(calleeAssignment.layer, rule.to);

    let isViolation = false;

    if (rule.type === 'forbid' && callerMatches && calleeMatches) {
      isViolation = true;
    } else if (rule.type === 'allow') {
      // For allow rules, violation occurs when the call is NOT allowed
      // This requires checking if there are any forbid rules that would apply
      // and this allow rule doesn't override them
      // For now, we'll focus on forbid rules as they are more common
      return null;
    }

    if (!isViolation) {
      return null;
    }

    const caller = functionMap.get(edge.callerFunctionId);
    const callee = functionMap.get(edge.calleeFunctionId || '');

    if (!caller || !callee) {
      return null;
    }

    return {
      id: this.generateViolationId(edge, rule),
      rule,
      source: {
        functionId: caller.id,
        functionName: caller.name,
        filePath: caller.filePath,
        layer: callerAssignment.layer,
      },
      target: {
        functionId: callee.id,
        functionName: callee.name,
        filePath: callee.filePath,
        layer: calleeAssignment.layer,
      },
      severity: rule.severity || this.config.settings?.defaultSeverity || 'error',
      message: this.generateViolationMessage(rule, callerAssignment.layer, calleeAssignment.layer),
      context: {
        callType: edge.callType,
        lineNumber: edge.lineNumber,
        ...(edge.callContext && { callContext: edge.callContext }),
      },
    };
  }

  /**
   * Create violation for unassigned functions in strict mode
   */
  private createUnassignedViolation(
    edge: CallEdge,
    functionMap: Map<string, FunctionInfo>,
    callerAssignment: LayerAssignment | undefined,
    calleeAssignment: LayerAssignment | undefined
  ): ArchitectureViolation | null {
    const caller = functionMap.get(edge.callerFunctionId);
    const callee = functionMap.get(edge.calleeFunctionId || '');

    if (!caller || !callee) {
      return null;
    }

    const unassignedFunction = !callerAssignment ? caller : callee;
    const unassignedRole = !callerAssignment ? 'caller' : 'callee';

    return {
      id: `unassigned-${unassignedFunction.id}-${Date.now()}`,
      rule: {
        type: 'forbid',
        from: '__unassigned__',
        to: '*',
        description: 'Function not assigned to any layer',
        severity: 'warning',
      },
      source: {
        functionId: caller.id,
        functionName: caller.name,
        filePath: caller.filePath,
        layer: callerAssignment?.layer || '__unassigned__',
      },
      target: {
        functionId: callee.id,
        functionName: callee.name,
        filePath: callee.filePath,
        layer: calleeAssignment?.layer || '__unassigned__',
      },
      severity: 'warning',
      message: `${unassignedRole.charAt(0).toUpperCase() + unassignedRole.slice(1)} function '${unassignedFunction.name}' is not assigned to any layer`,
    };
  }

  /**
   * Check if a layer matches a pattern (supports wildcards)
   */
  private matchesPattern(layer: string, pattern: string | string[]): boolean {
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    
    for (const p of patterns) {
      if (p === '*' || p === layer) {
        return true;
      }
      
      // Use minimatch for wildcard support
      if (minimatch(layer, p)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check if a call edge represents an external dependency
   */
  private isExternalDependency(edge: CallEdge, functionMap: Map<string, FunctionInfo>): boolean {
    const callee = functionMap.get(edge.calleeFunctionId || '');
    
    // Consider it external if the callee is not in our function map
    // or if the file path indicates it's from node_modules
    return !callee || callee.filePath.includes('node_modules');
  }

  /**
   * Generate a unique violation ID
   */
  private generateViolationId(edge: CallEdge, rule: ArchitectureRule): string {
    const ruleId = `${rule.type}-${Array.isArray(rule.from) ? rule.from.join(',') : rule.from}-${Array.isArray(rule.to) ? rule.to.join(',') : rule.to}`;
    return `${ruleId}-${edge.callerFunctionId}-${edge.calleeFunctionId || 'unknown'}`;
  }

  /**
   * Generate human-readable violation message
   */
  private generateViolationMessage(rule: ArchitectureRule, fromLayer: string, toLayer: string): string {
    if (rule.description) {
      return `${rule.description}: ${fromLayer} -> ${toLayer}`;
    }
    
    const action = rule.type === 'forbid' ? 'is forbidden' : 'is not allowed';
    return `Dependency from '${fromLayer}' to '${toLayer}' ${action}`;
  }

  /**
   * Create a map of function ID to layer assignment
   */
  private createAssignmentMap(
    assignments: LayerAssignment[],
    functions: FunctionInfo[]
  ): Map<string, LayerAssignment> {
    const map = new Map<string, LayerAssignment>();
    
    // Create a map from file path to assignment
    const pathToAssignment = new Map<string, LayerAssignment>();
    for (const assignment of assignments) {
      pathToAssignment.set(assignment.path, assignment);
    }
    
    // Map function IDs to assignments based on their file paths
    for (const func of functions) {
      const normalizedPath = this.normalizePath(func.filePath);
      const assignment = pathToAssignment.get(normalizedPath);
      if (assignment) {
        map.set(func.id, assignment);
      }
    }
    
    return map;
  }

  /**
   * Normalize file path for consistent matching
   */
  private normalizePath(filePath: string): string {
    // Convert to forward slashes and remove leading ./
    let normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
    
    // Handle absolute paths - convert to relative from project root
    if (normalized.includes('/src/')) {
      const srcIndex = normalized.lastIndexOf('/src/');
      normalized = normalized.substring(srcIndex + 1); // Keep 'src/' prefix
    }
    
    return normalized;
  }

  /**
   * Calculate architecture metrics
   */
  private calculateArchitectureMetrics(
    layerAssignments: LayerAssignment[],
    callEdges: CallEdge[],
    assignmentMap: Map<string, LayerAssignment>,
    importDependencies: ImportDependency[]
  ): ArchitectureAnalysisResult['metrics'] {
    const layerCoupling: Record<string, Record<string, number>> = {};
    const layerCohesion: Record<string, number> = {};
    let maxDepth = 0;

    // Initialize coupling matrix
    const layers = Array.from(new Set(layerAssignments.map(a => a.layer)));
    for (const layer of layers) {
      layerCoupling[layer] = {};
      for (const targetLayer of layers) {
        layerCoupling[layer][targetLayer] = 0;
      }
    }

    // Calculate coupling from call edges
    for (const edge of callEdges) {
      const callerAssignment = assignmentMap.get(edge.callerFunctionId);
      const calleeAssignment = assignmentMap.get(edge.calleeFunctionId || '');
      
      if (callerAssignment && calleeAssignment && edge.calleeFunctionId) {
        const fromLayer = callerAssignment.layer;
        const toLayer = calleeAssignment.layer;
        
        if (layerCoupling[fromLayer] && layerCoupling[fromLayer][toLayer] !== undefined) {
          layerCoupling[fromLayer][toLayer]++;
        }
      }
    }

    // Calculate coupling from import dependencies
    const processedImports = new Set<string>();
    for (const importDep of importDependencies) {
      if (importDep.importType === 'external') {
        continue; // Skip external dependencies
      }

      // Avoid double counting the same import
      const importKey = `${importDep.fromFilePath}->${importDep.toFilePath}`;
      if (processedImports.has(importKey)) {
        continue;
      }
      processedImports.add(importKey);

      // Find layers for the file paths involved in the import
      for (const assignment of layerAssignments) {
        if (this.normalizePath(assignment.path) === this.normalizePath(importDep.fromFilePath)) {
          const fromLayer = assignment.layer;
          
          for (const toAssignment of layerAssignments) {
            if (this.normalizePath(toAssignment.path) === this.normalizePath(importDep.toFilePath)) {
              const toLayer = toAssignment.layer;
              
              if (layerCoupling[fromLayer] && layerCoupling[fromLayer][toLayer] !== undefined) {
                layerCoupling[fromLayer][toLayer]++;
              }
              break;
            }
          }
          break;
        }
      }
    }

    // Calculate cohesion (ratio of internal to external calls)
    for (const layer of layers) {
      const internalCalls = layerCoupling[layer][layer] || 0;
      const externalCalls = Object.entries(layerCoupling[layer])
        .filter(([targetLayer]) => targetLayer !== layer)
        .reduce((sum, [, count]) => sum + count, 0);
      
      const totalCalls = internalCalls + externalCalls;
      layerCohesion[layer] = totalCalls > 0 ? internalCalls / totalCalls : 1;
    }

    // Calculate dependency depth (simplified - would need graph traversal for exact calculation)
    maxDepth = layers.length; // Conservative estimate

    return {
      layerCoupling,
      layerCohesion,
      dependencyDepth: maxDepth,
    };
  }

  /**
   * Generate summary statistics
   */
  private generateSummary(
    functions: FunctionInfo[],
    layerAssignments: LayerAssignment[],
    violations: ArchitectureViolation[]
  ): ArchitectureAnalysisResult['summary'] {
    const assignmentStats = this.layerAssigner.getAssignmentStats(layerAssignments);
    
    const violationCounts = violations.reduce(
      (counts, violation) => {
        counts[violation.severity]++;
        return counts;
      },
      { error: 0, warning: 0, info: 0 }
    );

    return {
      totalFunctions: functions.length,
      totalLayers: Object.keys(this.config.layers).length,
      totalRules: this.config.rules.length,
      violations: violations.length,
      errorViolations: violationCounts.error,
      warningViolations: violationCounts.warning,
      infoViolations: violationCounts.info,
      layerCoverage: assignmentStats.assignedFunctions / assignmentStats.totalFunctions,
    };
  }
}
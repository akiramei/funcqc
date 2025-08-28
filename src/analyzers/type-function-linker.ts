import { 
  Project, 
  SourceFile, 
  Node, 
  ClassDeclaration, 
  InterfaceDeclaration,
  MethodDeclaration,
  ConstructorDeclaration,
  GetAccessorDeclaration,
  SetAccessorDeclaration,
  PropertyDeclaration,
  MethodSignature,
  PropertySignature,
  PropertyAccessExpression,
  TypeChecker,
  TypeAliasDeclaration,
  Symbol as TSSymbol,
  SyntaxKind
} from 'ts-morph';
import { TypeDefinition } from './type-analyzer';
import { FunctionMetadata } from './ideal-call-graph-analyzer';
import { QualityMetrics } from '../types';
import { OnePassASTVisitor, CouplingDataMap } from './shared/one-pass-visitor';

/**
 * Member kinds for type analysis
 */
export const MemberKind = {
  Method: 'method',
  Constructor: 'constructor', 
  Getter: 'getter',
  Setter: 'setter',
  Property: 'property'
} as const;

export type MemberKind = typeof MemberKind[keyof typeof MemberKind];

/**
 * Linkage status for cross-references
 */
export const LinkageStatus = {
  Linked: 'linked',
  OrphanedType: 'orphaned_type',
  OrphanedFunction: 'orphaned_function'
} as const;

export type LinkageStatus = typeof LinkageStatus[keyof typeof LinkageStatus];

/**
 * Type usage pattern analysis results
 */
export interface TypeUsageAnalysis {
  typeName: string;
  totalMembers: number;
  propertyAccessPatterns: {
    alwaysTogether: PropertyGroup[];
    neverTogether: PropertyGroup[];
    frequency: PropertyFrequency[];
    correlations: PropertyCorrelation[];
  };
  functionGroups: {
    byUsagePattern: FunctionUsageGroup[];
  };
  accessContexts: {
    readOnly: number;
    modified: number;
    passedThrough: number;
    unused: string[];
  };
}

export interface PropertyGroup {
  properties: string[];
  occurrences: number;
  percentage: number;
}

export interface PropertyFrequency {
  property: string;
  usageCount: number;
  totalFunctions: number;
  percentage: number;
}

export interface PropertyCorrelation {
  property1: string;
  property2: string;
  correlation: number; // 0-1, where 1 means always used together
  cooccurrences: number;
}

export interface FunctionUsageGroup {
  groupName: string;
  properties: string[];
  functions: {
    name: string;
    filePath: string;
    line: number;
  }[];
}

export interface CouplingAnalysis {
  functionName: string;
  overCoupledParameters: {
    parameterName: string;
    typeName: string;
    totalProperties: number;
    usedProperties: string[];
    unusedProperties: string[];
    usageRatio: number;
    severity: 'low' | 'medium' | 'high';
  }[];
  bucketBrigadeIndicators: {
    parameter: string;
    passedWithoutUse: boolean;
    chainLength: number;
  }[];
}

// Helper interfaces for usage analysis
interface PropertyUsageInfo {
  functionName: string;
  filePath: string;
  line: number;
  accessType: 'read' | 'write' | 'modify' | 'pass';
  coAccessedWith: string[];
}

export interface TypeFunctionLinkerOptions {
  /**
   * Risk thresholds for identifying high-risk methods
   */
  riskThresholds?: {
    signatureLengthWarning?: number;
    signatureLengthCritical?: number;
    nameLengthWarning?: number;
    nameLengthCritical?: number;
    cyclomaticComplexityWarning?: number;
    cyclomaticComplexityCritical?: number;
    maintainabilityIndexWarning?: number;
    maintainabilityIndexCritical?: number;
    linesOfCodeWarning?: number;
    linesOfCodeCritical?: number;
  };
}

export interface CrossReference {
  typeId: string;
  typeName: string;
  functionId: string;
  functionName: string;
  memberKind: MemberKind;
  linkageStatus: LinkageStatus;
  filePath: string;
  lineNumber: number;
}

export interface ValidationResult {
  typeId: string;
  typeName: string;
  issues: ValidationIssue[];
  linkageScore: number; // 0-1, higher is better
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  functionId?: string;
  functionName?: string;
  memberName?: string;
}

export interface EnrichedFunctionInfo extends FunctionMetadata {
  typeContext?: {
    typeId: string;
    typeName: string;
    memberKind: string;
    isClassMethod: boolean;
    isInterfaceMethod: boolean;
    accessModifier?: 'public' | 'protected' | 'private';
  };
}

export interface EnrichedTypeInfo extends TypeDefinition {
  methodQuality?: {
    totalMethods: number;
    linkedMethods: number;
    averageComplexity?: number | undefined;
    averageQualityScore?: number | undefined;
    highRiskMethods: Array<{
      functionId: string;
      functionName: string;
      riskFactors: string[];
    }>;
  };
}

/**
 * TypeFunctionLinker - Links types and functions for integrated analysis
 * 
 * This class bridges the gap between type analysis and function analysis by:
 * - Linking type member definitions to actual function implementations
 * - Validating that declared methods have corresponding implementations
 * - Enriching function data with type context information
 * - Enriching type data with implementation quality metrics
 */
export class TypeFunctionLinker {
  private static readonly DEFAULT_RISK_THRESHOLDS = {
    SIGNATURE_LENGTH_WARNING: 100,
    SIGNATURE_LENGTH_CRITICAL: 150,
    NAME_LENGTH_WARNING: 30,
    NAME_LENGTH_CRITICAL: 40,
    CYCLOMATIC_COMPLEXITY_WARNING: 10,
    CYCLOMATIC_COMPLEXITY_CRITICAL: 15,
    MAINTAINABILITY_INDEX_WARNING: 30,
    MAINTAINABILITY_INDEX_CRITICAL: 20,
    LINES_OF_CODE_WARNING: 50,
    LINES_OF_CODE_CRITICAL: 100,
  };

  private project: Project;
  private sourceFileNodeCache = new Map<string, Map<string, Node[]>>();
  private metricsProvider: { getMetricsBatch: (functionIds: string[]) => Promise<Map<string, QualityMetrics>> } | undefined;
  private readonly riskThresholds: typeof TypeFunctionLinker.DEFAULT_RISK_THRESHOLDS;

  constructor(
    project: Project, 
    options?: TypeFunctionLinkerOptions & {
      metricsProvider?: { getMetricsBatch: (functionIds: string[]) => Promise<Map<string, QualityMetrics>> } | undefined;
    }
  ) {
    this.project = project;
    this.metricsProvider = options?.metricsProvider;
    
    // Merge default thresholds with user-provided thresholds
    this.riskThresholds = {
      SIGNATURE_LENGTH_WARNING: options?.riskThresholds?.signatureLengthWarning ?? TypeFunctionLinker.DEFAULT_RISK_THRESHOLDS.SIGNATURE_LENGTH_WARNING,
      SIGNATURE_LENGTH_CRITICAL: options?.riskThresholds?.signatureLengthCritical ?? TypeFunctionLinker.DEFAULT_RISK_THRESHOLDS.SIGNATURE_LENGTH_CRITICAL,
      NAME_LENGTH_WARNING: options?.riskThresholds?.nameLengthWarning ?? TypeFunctionLinker.DEFAULT_RISK_THRESHOLDS.NAME_LENGTH_WARNING,
      NAME_LENGTH_CRITICAL: options?.riskThresholds?.nameLengthCritical ?? TypeFunctionLinker.DEFAULT_RISK_THRESHOLDS.NAME_LENGTH_CRITICAL,
      CYCLOMATIC_COMPLEXITY_WARNING: options?.riskThresholds?.cyclomaticComplexityWarning ?? TypeFunctionLinker.DEFAULT_RISK_THRESHOLDS.CYCLOMATIC_COMPLEXITY_WARNING,
      CYCLOMATIC_COMPLEXITY_CRITICAL: options?.riskThresholds?.cyclomaticComplexityCritical ?? TypeFunctionLinker.DEFAULT_RISK_THRESHOLDS.CYCLOMATIC_COMPLEXITY_CRITICAL,
      MAINTAINABILITY_INDEX_WARNING: options?.riskThresholds?.maintainabilityIndexWarning ?? TypeFunctionLinker.DEFAULT_RISK_THRESHOLDS.MAINTAINABILITY_INDEX_WARNING,
      MAINTAINABILITY_INDEX_CRITICAL: options?.riskThresholds?.maintainabilityIndexCritical ?? TypeFunctionLinker.DEFAULT_RISK_THRESHOLDS.MAINTAINABILITY_INDEX_CRITICAL,
      LINES_OF_CODE_WARNING: options?.riskThresholds?.linesOfCodeWarning ?? TypeFunctionLinker.DEFAULT_RISK_THRESHOLDS.LINES_OF_CODE_WARNING,
      LINES_OF_CODE_CRITICAL: options?.riskThresholds?.linesOfCodeCritical ?? TypeFunctionLinker.DEFAULT_RISK_THRESHOLDS.LINES_OF_CODE_CRITICAL,
    };
  }

  /**
   * Get nodes of specific kinds from source file with caching
   */
  private getCachedNodesOfKind(sourceFile: SourceFile, cacheKey: string, syntaxKinds: SyntaxKind[]): Node[] {
    const filePath = require('../utils/path-normalizer').toUnifiedProjectPath(sourceFile.getFilePath());
    
    if (!this.sourceFileNodeCache.has(filePath)) {
      this.sourceFileNodeCache.set(filePath, new Map());
    }
    
    const fileCache = this.sourceFileNodeCache.get(filePath)!;
    
    if (!fileCache.has(cacheKey)) {
      const nodes: Node[] = [];
      for (const kind of syntaxKinds) {
        nodes.push(...sourceFile.getDescendantsOfKind(kind));
      }
      fileCache.set(cacheKey, nodes);
    }
    
    return fileCache.get(cacheKey)!;
  }


  /**
   * Create cross-references between types and functions
   */
  linkTypesAndFunctions(
    types: TypeDefinition[], 
    functions: FunctionMetadata[]
  ): CrossReference[] {
    const crossReferences: CrossReference[] = [];
    const functionsBySignature = this.createFunctionSignatureMap(functions);
    
    for (const type of types) {
      if (type.kind === 'class' || type.kind === 'interface') {
        const typeRefs = this.linkTypeToFunctions(type, functionsBySignature);
        crossReferences.push(...typeRefs);
      }
    }
    
    return crossReferences;
  }

  /**
   * Validate that type method declarations have corresponding function implementations
   */
  validateTypeMethodLinks(types: TypeDefinition[], functions: FunctionMetadata[]): ValidationResult[] {
    const results: ValidationResult[] = [];
    const crossRefs = this.linkTypesAndFunctions(types, functions);
    
    // Group cross-references by type
    const refsByType = new Map<string, CrossReference[]>();
    for (const ref of crossRefs) {
      if (!refsByType.has(ref.typeId)) {
        refsByType.set(ref.typeId, []);
      }
      refsByType.get(ref.typeId)!.push(ref);
    }
    
    for (const type of types) {
      const typeRefs = refsByType.get(type.id) || [];
      const validation = this.validateSingleType(type, typeRefs);
      results.push(validation);
    }
    
    return results;
  }

  /**
   * Enrich function metadata with type context information
   */
  enrichFunctionWithTypeInfo(
    functionMeta: FunctionMetadata, 
    types: TypeDefinition[]
  ): EnrichedFunctionInfo {
    const enriched: EnrichedFunctionInfo = { ...functionMeta };
    
    // Find the type that contains this function (if any)
    const containingType = this.findContainingType(functionMeta, types);
    
    if (containingType) {
      const accessModifier = this.extractAccessModifier(functionMeta);
      enriched.typeContext = {
        typeId: containingType.id,
        typeName: containingType.name,
        memberKind: this.determineMemberKind(functionMeta),
        isClassMethod: containingType.kind === 'class',
        isInterfaceMethod: containingType.kind === 'interface',
        ...(accessModifier && { accessModifier })
      };
    }
    
    return enriched;
  }

  /**
   * Enrich type definition with function implementation quality metrics
   */
  async enrichTypeWithFunctionInfo(
    type: TypeDefinition, 
    functions: FunctionMetadata[]
  ): Promise<EnrichedTypeInfo> {
    const enriched: EnrichedTypeInfo = { ...type };
    
    if (type.kind === 'class' || type.kind === 'interface') {
      const typeMethods = this.findMethodsForType(type, functions);
      enriched.methodQuality = await this.calculateMethodQuality(typeMethods);
    }
    
    return enriched;
  }

  /**
   * Create a map of function signatures for efficient lookup
   */
  private createFunctionSignatureMap(functions: FunctionMetadata[]): Map<string, FunctionMetadata[]> {
    const map = new Map<string, FunctionMetadata[]>();
    
    for (const func of functions) {
      const signature = this.createFunctionSignature(func);
      if (!map.has(signature)) {
        map.set(signature, []);
      }
      map.get(signature)!.push(func);
    }
    
    return map;
  }

  /**
   * Link a single type to its corresponding functions
   */
  private linkTypeToFunctions(
    type: TypeDefinition, 
    functionsBySignature: Map<string, FunctionMetadata[]>
  ): CrossReference[] {
    const crossRefs: CrossReference[] = [];
    
    // For now, use a simple heuristic: match by name and file path
    // In a real implementation, this would use proper AST analysis
    const typeMembers = this.extractTypeMembersFromDefinition(type);
    
    for (const member of typeMembers) {
      const matchingFunctions = this.findMatchingFunctions(
        member, 
        type, 
        functionsBySignature
      );
      
      if (matchingFunctions.length > 0) {
        for (const func of matchingFunctions) {
          crossRefs.push({
            typeId: type.id,
            typeName: type.name,
            functionId: func.id,
            functionName: func.name,
            memberKind: member.kind,
            linkageStatus: LinkageStatus.Linked,
            filePath: type.filePath,
            lineNumber: member.lineNumber
          });
        }
      } else {
        // Orphaned type member (no implementation found)
        crossRefs.push({
          typeId: type.id,
          typeName: type.name,
          functionId: '',
          functionName: member.name,
          memberKind: member.kind,
          linkageStatus: LinkageStatus.OrphanedType,
          filePath: type.filePath,
          lineNumber: member.lineNumber
        });
      }
    }
    
    return crossRefs;
  }

  /**
   * Validate a single type's method links
   */
  private validateSingleType(type: TypeDefinition, crossRefs: CrossReference[]): ValidationResult {
    const issues: ValidationIssue[] = [];
    let linkedCount = 0;
    let totalCount = 0;
    
    for (const ref of crossRefs) {
      totalCount++;
      
      if (ref.linkageStatus === LinkageStatus.Linked) {
        linkedCount++;
      } else if (ref.linkageStatus === LinkageStatus.OrphanedType) {
        issues.push({
          severity: type.kind === 'interface' ? 'info' : 'warning',
          message: `Method '${ref.functionName}' declared but no implementation found`,
          memberName: ref.functionName
        });
      }
    }
    
    const linkageScore = totalCount > 0 ? linkedCount / totalCount : 1;
    
    return {
      typeId: type.id,
      typeName: type.name,
      issues,
      linkageScore
    };
  }

  /**
   * Find the type that contains a given function
   */
  private findContainingType(
    functionMeta: FunctionMetadata, 
    types: TypeDefinition[]
  ): TypeDefinition | undefined {
    // Simple heuristic: check if function is within the line range of any type
    for (const type of types) {
      if (type.filePath === functionMeta.filePath &&
          functionMeta.startLine >= type.startLine &&
          functionMeta.endLine <= type.endLine) {
        return type;
      }
    }
    return undefined;
  }

  /**
   * Determine the member kind of a function
   */
  private determineMemberKind(functionMeta: FunctionMetadata): MemberKind {
    try {
      const sourceFile = this.project.getSourceFile(functionMeta.filePath);
      if (!sourceFile) return MemberKind.Method;
      const node = this.findFunctionNodeByMetadata(sourceFile, functionMeta);
      if (!node) return functionMeta.name === 'constructor' ? MemberKind.Constructor : MemberKind.Method;
      if (Node.isConstructorDeclaration(node)) return MemberKind.Constructor;
      if (Node.isGetAccessorDeclaration(node)) return MemberKind.Getter;
      if (Node.isSetAccessorDeclaration(node)) return MemberKind.Setter;
      return MemberKind.Method;
    } catch {
      return MemberKind.Method;
    }
  }

  /**
   * Extract access modifier from function metadata using AST analysis
   */
  private extractAccessModifier(functionMeta: FunctionMetadata): 'public' | 'protected' | 'private' | undefined {
    try {
      const sourceFile = this.project.getSourceFile(functionMeta.filePath);
      if (!sourceFile) {
        return undefined;
      }

      // Find the function node using symbol-based matching
      const functionNode = this.findFunctionNodeByMetadata(sourceFile, functionMeta);
      if (!functionNode) {
        return undefined;
      }

      return this.getAccessModifier(functionNode);
    } catch {
      return undefined;
    }
  }

  /**
   * Find function node by metadata using symbol-based matching (robust to line shifts)
   */
  private findFunctionNodeByMetadata(sourceFile: SourceFile, functionMeta: FunctionMetadata): Node | undefined {
    const functionNodes = this.getCachedNodesOfKind(
      sourceFile,
      'functions',
      [
        SyntaxKind.MethodDeclaration,
        SyntaxKind.Constructor,
        SyntaxKind.GetAccessor,
        SyntaxKind.SetAccessor,
        SyntaxKind.FunctionDeclaration,
        SyntaxKind.FunctionExpression,
        SyntaxKind.ArrowFunction,
        SyntaxKind.PropertyDeclaration
      ]
    );
    
    for (const node of functionNodes) {
      // Primary matching: Symbol-based comparison
      const symbol = node.getSymbol();
      if (symbol) {
        const fullyQualifiedName = symbol.getFullyQualifiedName();
        if (fullyQualifiedName && this.matchesFunctionMetadata(fullyQualifiedName, functionMeta)) {
          return node;
        }
      }
      
      // Fallback: Name and approximate line range matching (with tolerance for decorators/overloads)
      if (this.matchesByNameAndLocation(node, functionMeta)) {
        return node;
      }
    }
    
    return undefined;
  }

  /**
   * Check if fully qualified name matches function metadata
   */
  private matchesFunctionMetadata(fullyQualifiedName: string, functionMeta: FunctionMetadata): boolean {
    // Extract function name from FQN (handle cases like "ClassName.methodName")
    const parts = fullyQualifiedName.split('.');
    const fqnFunctionName = parts[parts.length - 1];
    
    return fqnFunctionName === functionMeta.name;
  }

  /**
   * Fallback matching by name and approximate location (with line tolerance)
   */
  private matchesByNameAndLocation(node: Node, functionMeta: FunctionMetadata): boolean {
    const LINE_TOLERANCE = 5; // Allow 5 lines difference for decorators/comments
    
    const startLine = node.getStartLineNumber();
    const endLine = node.getEndLineNumber();
    
    // Get node name if available
    let nodeName = '';
    try {
      // Use type guards to safely get node name
      if (Node.isMethodDeclaration(node) || Node.isGetAccessorDeclaration(node) ||
          Node.isSetAccessorDeclaration(node) || Node.isPropertyDeclaration(node) ||
          Node.isFunctionDeclaration(node)) {
        nodeName = node.getName() || '';
      } else if (Node.isConstructorDeclaration(node)) {
        nodeName = 'constructor';
      }
    } catch {
      // Skip if getName() is not available
    }
    
    const nameMatches = nodeName === functionMeta.name || 
                       (functionMeta.name === 'constructor' && node instanceof ConstructorDeclaration);
    
    const lineApproximatelyMatches = 
      Math.abs(startLine - functionMeta.startLine) <= LINE_TOLERANCE &&
      Math.abs(endLine - functionMeta.endLine) <= LINE_TOLERANCE;
    
    return nameMatches && lineApproximatelyMatches;
  }

  /**
   * Find all methods that belong to a given type
   */
  private findMethodsForType(type: TypeDefinition, functions: FunctionMetadata[]): FunctionMetadata[] {
    return functions.filter(func => {
      return type.filePath === func.filePath &&
             func.startLine >= type.startLine &&
             func.endLine <= type.endLine;
    });
  }

  /**
   * Calculate method quality metrics for a type with actual DB complexity data
   */
  private async calculateMethodQuality(methods: FunctionMetadata[]) {
    if (methods.length === 0) {
      return this.createEmptyMethodQuality();
    }

    const metricsData = await this.fetchMetricsData(methods);
    const { averageComplexity, averageMaintainabilityIndex } = this.calculateAverageMetrics(metricsData);
    const highRiskMethods = this.identifyHighRiskMethods(methods, metricsData);

    return {
      totalMethods: methods.length,
      linkedMethods: methods.length, // All found methods are considered linked
      averageComplexity,
      averageQualityScore: averageMaintainabilityIndex,
      highRiskMethods
    };
  }

  /**
   * Create empty method quality object
   */
  private createEmptyMethodQuality() {
    return {
      totalMethods: 0,
      linkedMethods: 0,
      averageComplexity: undefined,
      averageQualityScore: undefined,
      highRiskMethods: []
    };
  }

  /**
   * Fetch metrics data from database if provider is available
   */
  private async fetchMetricsData(methods: FunctionMetadata[]): Promise<Map<string, QualityMetrics> | undefined> {
    if (!this.metricsProvider) {
      return undefined;
    }

    try {
      const functionIds = methods.map(m => m.id);
      return await this.metricsProvider.getMetricsBatch(functionIds);
    } catch (error) {
      console.warn(`Failed to fetch complexity metrics: ${error}`);
      return undefined;
    }
  }

  /**
   * Calculate average complexity and maintainability metrics
   */
  private calculateAverageMetrics(metricsData?: Map<string, QualityMetrics>) {
    let averageComplexity: number | undefined = undefined;
    let averageMaintainabilityIndex: number | undefined = undefined;

    if (metricsData && metricsData.size > 0) {
      const complexities: number[] = [];
      const maintainabilityIndexes: number[] = [];
      
      for (const metrics of metricsData.values()) {
        if (metrics.cyclomaticComplexity !== undefined) {
          complexities.push(metrics.cyclomaticComplexity);
        }
        if (metrics.maintainabilityIndex !== undefined) {
          maintainabilityIndexes.push(metrics.maintainabilityIndex);
        }
      }
      
      if (complexities.length > 0) {
        averageComplexity = complexities.reduce((a, b) => a + b, 0) / complexities.length;
      }
      if (maintainabilityIndexes.length > 0) {
        averageMaintainabilityIndex = maintainabilityIndexes.reduce((a, b) => a + b, 0) / maintainabilityIndexes.length;
      }
    }

    return { averageComplexity, averageMaintainabilityIndex };
  }

  /**
   * Identify high-risk methods based on metrics or heuristics
   */
  private identifyHighRiskMethods(
    methods: FunctionMetadata[], 
    metricsData?: Map<string, QualityMetrics>
  ) {
    return methods
      .filter(method => this.isHighRiskMethod(method, metricsData))
      .map(method => this.createHighRiskMethodInfo(method, metricsData));
  }

  /**
   * Check if a method is considered high-risk
   */
  private isHighRiskMethod(
    method: FunctionMetadata, 
    metricsData?: Map<string, QualityMetrics>
  ): boolean {
    const metrics = metricsData?.get(method.id);
    if (metrics) {
      return (metrics.cyclomaticComplexity !== undefined && metrics.cyclomaticComplexity >= this.riskThresholds.CYCLOMATIC_COMPLEXITY_WARNING) ||
             (metrics.maintainabilityIndex !== undefined && metrics.maintainabilityIndex <= this.riskThresholds.MAINTAINABILITY_INDEX_WARNING) ||
             (metrics.linesOfCode !== undefined && metrics.linesOfCode >= this.riskThresholds.LINES_OF_CODE_WARNING);
    }
    
    // Fallback heuristics when no DB data available
    return method.signature.length > this.riskThresholds.SIGNATURE_LENGTH_WARNING ||
           method.name.length > this.riskThresholds.NAME_LENGTH_WARNING;
  }

  /**
   * Create high-risk method information with detailed risk factors
   */
  private createHighRiskMethodInfo(
    method: FunctionMetadata, 
    metricsData?: Map<string, QualityMetrics>
  ) {
    const metrics = metricsData?.get(method.id);
    const riskFactors: string[] = [];
    
    if (metrics) {
      this.addMetricsBasedRiskFactors(metrics, riskFactors);
    } else {
      this.addHeuristicBasedRiskFactors(method, riskFactors);
    }
    
    return {
      functionId: method.id,
      functionName: method.name,
      riskFactors
    };
  }

  /**
   * Add risk factors based on actual metrics data
   */
  private addMetricsBasedRiskFactors(metrics: QualityMetrics, riskFactors: string[]): void {
    if (metrics.cyclomaticComplexity !== undefined && metrics.cyclomaticComplexity >= this.riskThresholds.CYCLOMATIC_COMPLEXITY_CRITICAL) {
      riskFactors.push(`High Complexity (${metrics.cyclomaticComplexity})`);
    } else if (metrics.cyclomaticComplexity !== undefined && metrics.cyclomaticComplexity >= this.riskThresholds.CYCLOMATIC_COMPLEXITY_WARNING) {
      riskFactors.push(`Moderate Complexity (${metrics.cyclomaticComplexity})`);
    }
    
    if (metrics.maintainabilityIndex !== undefined && metrics.maintainabilityIndex <= this.riskThresholds.MAINTAINABILITY_INDEX_CRITICAL) {
      riskFactors.push(`Very Low Maintainability (${metrics.maintainabilityIndex})`);
    } else if (metrics.maintainabilityIndex !== undefined && metrics.maintainabilityIndex <= this.riskThresholds.MAINTAINABILITY_INDEX_WARNING) {
      riskFactors.push(`Low Maintainability (${metrics.maintainabilityIndex})`);
    }
    
    if (metrics.linesOfCode !== undefined && metrics.linesOfCode >= this.riskThresholds.LINES_OF_CODE_CRITICAL) {
      riskFactors.push(`Very Long Function (${metrics.linesOfCode} LOC)`);
    } else if (metrics.linesOfCode !== undefined && metrics.linesOfCode >= this.riskThresholds.LINES_OF_CODE_WARNING) {
      riskFactors.push(`Long Function (${metrics.linesOfCode} LOC)`);
    }
  }

  /**
   * Add risk factors based on heuristics when metrics are not available
   */
  private addHeuristicBasedRiskFactors(method: FunctionMetadata, riskFactors: string[]): void {
    if (method.signature.length > this.riskThresholds.SIGNATURE_LENGTH_CRITICAL) {
      riskFactors.push('Long Signature');
    }
    if (method.name.length > this.riskThresholds.NAME_LENGTH_CRITICAL) {
      riskFactors.push('Long Name');
    }
    if (method.signature.includes('Promise<')) {
      riskFactors.push('Async Complexity');
    }
  }

  /**
   * Analyze type usage patterns to provide insights for refactoring
   * Enhanced with optimized 1-pass AST traversal for better performance
   */
  analyzeTypeUsagePatterns(type: TypeDefinition, functions: FunctionMetadata[]): TypeUsageAnalysis {
    // For interface/type alias analysis, check ALL functions that might use this type
    // For class analysis, focus on methods within the class
    const relevantFunctions = type.kind === 'class' 
      ? this.findMethodsForType(type, functions)
      : functions; // Check all functions for interface/type alias usage
    
    // Use optimized 1-pass AST traversal instead of individual analysis
    const allUsages = this.collectPropertyUsagesOptimized(type, relevantFunctions);
    
    return {
      typeName: type.name,
      totalMembers: this.getTypeMembers(type).length,
      propertyAccessPatterns: this.analyzePropertyPatterns(allUsages),
      functionGroups: this.groupFunctionsByUsage(allUsages),
      accessContexts: this.analyzeAccessContexts(allUsages)
    };
  }

  /**
   * Optimized property usage collection using 1-pass AST traversal
   */
  private collectPropertyUsagesOptimized(
    type: TypeDefinition,
    functions: FunctionMetadata[]
  ): Map<string, PropertyUsageInfo[]> {
    const usageMap = new Map<string, PropertyUsageInfo[]>();
    const typeMembers = this.getTypeMembers(type);
    const memberNames = new Set(typeMembers.map(m => m.name));
    
    // Initialize usage map for all type members
    for (const member of typeMembers) {
      if (member.kind === MemberKind.Property) {
        usageMap.set(member.name, []);
      }
    }
    
    // Group functions by file for efficient processing
    const functionsByFile = new Map<string, FunctionMetadata[]>();
    for (const func of functions) {
      if (!functionsByFile.has(func.filePath)) {
        functionsByFile.set(func.filePath, []);
      }
      functionsByFile.get(func.filePath)!.push(func);
    }
    
    // Process each file once with 1-pass traversal
    for (const [filePath, fileFunctions] of functionsByFile) {
      this.analyzeSingleFileOptimized(filePath, fileFunctions, type, memberNames, usageMap);
    }
    
    return usageMap;
  }
  
  /**
   * Analyze a single file using 1-pass AST traversal
   */
  private analyzeSingleFileOptimized(
    filePath: string,
    functions: FunctionMetadata[],
    type: TypeDefinition,
    memberNames: Set<string>,
    usageMap: Map<string, PropertyUsageInfo[]>
  ): void {
    try {
      const sourceFile = this.project.getSourceFile(filePath);
      if (!sourceFile) return;
      
      const checker = this.project.getTypeChecker();
      const targetTypeSymbol = this.getTypeSymbol(type, sourceFile, checker);
      
      // Create function range map for efficient lookup
      const functionRanges = new Map<string, FunctionMetadata>();
      for (const func of functions) {
        for (let line = func.startLine; line <= func.endLine; line++) {
          functionRanges.set(`${line}`, func);
        }
      }
      
      // Single AST traversal to collect all property accesses
      const allPropertyAccesses: Array<{
        propertyName: string;
        accessType: 'read' | 'write' | 'modify' | 'pass';
        line: number;
        containingFunction: FunctionMetadata | undefined;
        node: Node;
      }> = [];
      
      sourceFile.forEachDescendant((node) => {
        if (node.asKind(SyntaxKind.PropertyAccessExpression)) {
          const propAccess = node.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
          const propertyName = propAccess.getName();
          
          if (memberNames.has(propertyName)) {
            const line = propAccess.getStartLineNumber();
            const containingFunction = functionRanges.get(`${line}`);
            
            if (containingFunction) {
              // Check if this property belongs to our target type using optimized approach
              if (this.belongsToTargetTypeOptimized(propAccess, targetTypeSymbol, checker)) {
                allPropertyAccesses.push({
                  propertyName,
                  accessType: this.classifyAccess(propAccess, 0),
                  line,
                  containingFunction,
                  node: propAccess
                });
              }
            }
          }
        }
      });
      
      // Process collected accesses and build co-access patterns
      const functionCoAccesses = new Map<string, Set<string>>();
      
      for (const access of allPropertyAccesses) {
        const funcKey = `${access.containingFunction!.name}:${access.containingFunction!.filePath}`;
        if (!functionCoAccesses.has(funcKey)) {
          functionCoAccesses.set(funcKey, new Set());
        }
        functionCoAccesses.get(funcKey)!.add(access.propertyName);
        
        // Add to usage map
        if (!usageMap.has(access.propertyName)) {
          usageMap.set(access.propertyName, []);
        }
        
        const coAccessedWith = Array.from(functionCoAccesses.get(funcKey)!)
          .filter(prop => prop !== access.propertyName);
        
        usageMap.get(access.propertyName)!.push({
          functionName: access.containingFunction!.name,
          filePath: access.containingFunction!.filePath,
          line: access.line,
          accessType: access.accessType,
          coAccessedWith
        });
      }
      
    } catch (error) {
      console.warn(`Failed to analyze file ${filePath}: ${error}`);
    }
  }
  
  /**
   * Optimized type checking for property access
   */
  private belongsToTargetTypeOptimized(
    propAccess: PropertyAccessExpression,
    targetTypeSymbol: TSSymbol | undefined,
    checker: TypeChecker
  ): boolean {
    try {
      if (!targetTypeSymbol || !checker) {
        return true; // Fallback to name-based matching
      }
      
      const expression = propAccess.getExpression();
      const exprType = expression.getType();
      
      if (exprType) {
        // Quick symbol comparison
        const exprSymbol = exprType.getSymbol() ?? exprType.getApparentType()?.getSymbol();
        if (exprSymbol === targetTypeSymbol) {
          return true;
        }
        
        // Check for type compatibility
        if (targetTypeSymbol) {
          const declarations = targetTypeSymbol.getDeclarations();
          if (declarations && declarations.length > 0) {
            const targetType = checker.getTypeAtLocation(declarations[0]);
            if (targetType && checker.isTypeAssignableTo(exprType, targetType)) {
              return true;
            }
          }
        }
      }
      
      return false;
    } catch {
      return true; // Fallback to name-based matching
    }
  }

  /**
   * Analyze coupling issues in function parameters
   */
  analyzeCouplingIssues(func: FunctionMetadata): CouplingAnalysis {
    const overCoupledParams = this.detectOverCoupledParameters(func);
    const bucketBrigade = this.detectBucketBrigade(func);
    
    return {
      functionName: func.name,
      overCoupledParameters: overCoupledParams,
      bucketBrigadeIndicators: bucketBrigade
    };
  }


  /**
   * Analyze property access patterns
   */
  private analyzePropertyPatterns(
    usageMap: Map<string, PropertyUsageInfo[]>
  ): TypeUsageAnalysis['propertyAccessPatterns'] {
    const correlations = this.calculatePropertyCorrelations(usageMap);
    const frequency = this.calculatePropertyFrequency(usageMap);
    
    const alwaysTogether = this.findAlwaysTogetherGroups(correlations, 0.9);
    const neverTogether = this.findNeverTogetherGroups(correlations, 0.1);
    
    return {
      alwaysTogether,
      neverTogether,
      frequency,
      correlations
    };
  }

  /**
   * Group functions by their property usage patterns
   */
  private groupFunctionsByUsage(
    usageMap: Map<string, PropertyUsageInfo[]>
  ): { byUsagePattern: FunctionUsageGroup[] } {
    const functionUsageSignatures = new Map<string, string[]>();
    const SEP = "^_"; // unlikely to appear in paths
    const functionFirstLine = new Map<string, number>();

    // Create usage signatures for each function
    const allFunctions = new Set<string>();
    for (const usages of usageMap.values()) {
      for (const usage of usages) {
        const funcKey = `${usage.functionName}${SEP}${usage.filePath}`;
        if (!functionUsageSignatures.has(funcKey)) {
          functionUsageSignatures.set(funcKey, []);
        }
        allFunctions.add(funcKey);
      }
    }

    // Collect properties used by each function
    for (const [property, usages] of usageMap) {
      for (const usage of usages) {
        const funcKey = `${usage.functionName}${SEP}${usage.filePath}`;
        const signature = functionUsageSignatures.get(funcKey)!;
        if (!signature.includes(property)) {
          signature.push(property);
        }
        const prev = functionFirstLine.get(funcKey);
        functionFirstLine.set(
          funcKey,
          prev === undefined ? usage.line : Math.min(prev, usage.line)
        );
      }
    }

    // Group functions by similar usage patterns
    const groups = new Map<string, FunctionUsageGroup>();

    for (const [funcKey, properties] of functionUsageSignatures) {
      const sortedProps = properties.sort();
      const signature = sortedProps.join(',');

      if (!groups.has(signature)) {
        groups.set(signature, {
          groupName: `Group using {${sortedProps.join(', ')}}`,
          properties: sortedProps,
          functions: []
        });
      }

      const [funcName, filePath] = funcKey.split(SEP);
      groups.get(signature)!.functions.push({
        name: funcName,
        filePath,
        line: functionFirstLine.get(funcKey) ?? 0
      });
    }
    
    return {
      byUsagePattern: Array.from(groups.values())
        .filter(group => group.functions.length > 1)
        .sort((a, b) => b.functions.length - a.functions.length)
    };
  }

  /**
   * Analyze access contexts (read-only, modified, passed through)
   */
  private analyzeAccessContexts(
    usageMap: Map<string, PropertyUsageInfo[]>
  ): TypeUsageAnalysis['accessContexts'] {
    let readOnly = 0;
    let modified = 0;
    let passedThrough = 0;
    const unused: string[] = [];
    
    for (const [property, usages] of usageMap) {
      if (usages.length === 0) {
        unused.push(property);
        continue;
      }
      
      for (const usage of usages) {
        switch (usage.accessType) {
          case 'read':
            readOnly++;
            break;
          case 'write':
          case 'modify':
            modified++;
            break;
          case 'pass':
            passedThrough++;
            break;
        }
      }
    }
    
    return {
      readOnly,
      modified,
      passedThrough,
      unused
    };
  }

  /**
   * Get type members using ts-morph AST analysis
   */
  private getTypeMembers(type: TypeDefinition): { name: string; kind: MemberKind }[] {
    try {
      const detailed = this.extractTypeMembersFromDefinition(type);
      // Deduplicate by name
      const map = new Map<string, { name: string; kind: MemberKind }>();
      for (const m of detailed) {
        map.set(m.name, { name: m.name, kind: m.kind });
      }
      return Array.from(map.values());
    } catch (error) {
      console.warn(`Failed to extract members for type ${type.name}: ${error}`);
      return [];
    }
  }

  // analyzePropertyAccesses method replaced by optimized 1-pass traversal

  // getFunctionParameters method removed - no longer needed with optimized approach

  /**
   * Get type symbol for target type
   */
  private getTypeSymbol(type: TypeDefinition, sourceFile: SourceFile, _checker: TypeChecker): TSSymbol | undefined {
    try {
      // Find type declaration in source file
      const typeNode = this.findTypeDeclaration(type, sourceFile);
      if (typeNode) {
        const symbol = typeNode.getSymbol?.();
        if (symbol) {
          return symbol;
        }
      }
      
      // Fallback: try to get symbol by name
      const typeSymbols = sourceFile.getExportedDeclarations();
      const targetSymbol = typeSymbols?.get?.(type.name)?.[0]?.getSymbol?.();
      return targetSymbol;
    } catch {
      return undefined;
    }
  }

  /**
   * Find type declaration node in source file
   */
  private findTypeDeclaration(type: TypeDefinition, sourceFile: SourceFile): Node | undefined {
    let foundNode: Node | undefined = undefined;
    
    try {
      sourceFile.forEachDescendant((node: Node) => {
        if (foundNode) return; // Early exit if found
        
        if (Node.isInterfaceDeclaration(node) || 
            Node.isClassDeclaration(node) ||
            Node.isTypeAliasDeclaration(node)) {
          const name = 'getName' in node && typeof node.getName === 'function' 
            ? node.getName() : undefined;
          if (name === type.name) {
            foundNode = node;
          }
        }
      });
    } catch {
      // Return undefined if search fails
    }
    
    return foundNode;
  }

  // Old type compatibility methods replaced by optimized 1-pass implementation

  /**
   * Classify property access type based on AST context with comprehensive edge case handling
   * @param propAccess The property access node to classify
   * @param depth Current recursion depth to prevent stack overflow
   */
  private classifyAccess(propAccess: Node, depth = 0): 'read' | 'write' | 'modify' | 'pass' {
    const parent = propAccess.getParent();
    
    if (!parent) return 'read';

    // Handle increment/decrement operations (++, --)
    if (parent.asKind(SyntaxKind.PrefixUnaryExpression)) {
      const prefixExpr = parent.asKindOrThrow(SyntaxKind.PrefixUnaryExpression);
      const operatorKind = prefixExpr.getOperatorToken();
      if (operatorKind === SyntaxKind.PlusPlusToken || operatorKind === SyntaxKind.MinusMinusToken) {
        return 'modify';
      }
    }
    
    if (parent.asKind(SyntaxKind.PostfixUnaryExpression)) {
      const postfixExpr = parent.asKindOrThrow(SyntaxKind.PostfixUnaryExpression);
      const operatorKind = postfixExpr.getOperatorToken();
      if (operatorKind === SyntaxKind.PlusPlusToken || operatorKind === SyntaxKind.MinusMinusToken) {
        return 'modify';
      }
    }

    // Handle delete operations
    if (parent.asKind(SyntaxKind.DeleteExpression)) {
      return 'write';
    }

    // Check if it's a write access (assignment) - improved logic for nested property access
    if (parent.asKind(SyntaxKind.BinaryExpression)) {
      const binExpr = parent.asKindOrThrow(SyntaxKind.BinaryExpression);
      const opKind = binExpr.getOperatorToken().getKind();
      
      // Direct assignment
      if (opKind === SyntaxKind.EqualsToken && binExpr.getLeft() === propAccess) {
        return 'write';
      }
      
      // Compound assignment operations
      const compoundOps = [
        SyntaxKind.PlusEqualsToken, SyntaxKind.MinusEqualsToken, 
        SyntaxKind.AsteriskEqualsToken, SyntaxKind.SlashEqualsToken,
        SyntaxKind.PercentEqualsToken, SyntaxKind.AmpersandEqualsToken,
        SyntaxKind.BarEqualsToken, SyntaxKind.CaretEqualsToken,
        SyntaxKind.LessThanLessThanEqualsToken, SyntaxKind.GreaterThanGreaterThanEqualsToken,
        SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken
      ];
      
      if (compoundOps.includes(opKind) && binExpr.getLeft() === propAccess) {
        return 'modify';
      }
    }

    // Handle method calls - distinguish between regular calls and mutator methods
    if (parent.asKind(SyntaxKind.CallExpression)) {
      const callExpr = parent.asKindOrThrow(SyntaxKind.CallExpression);
      
      // If this property access is the function being called
      if (callExpr.getExpression() === propAccess) {
        // Check if it's a known mutator method
        const propertyName = this.getPropertyName(propAccess);
        const mutatorMethods = new Set([
          'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse',
          'fill', 'copyWithin', 'set', 'add', 'delete', 'clear', 'append'
        ]);
        
        if (propertyName && mutatorMethods.has(propertyName)) {
          return 'modify';
        }
        return 'read'; // Regular method call
      }
      
      // If this property access is passed as an argument
      if (callExpr.getArguments().some(arg => arg === propAccess)) {
        return 'pass';
      }
    }

    // Handle spread operations in function calls (...obj.prop)
    if (parent.asKind(SyntaxKind.SpreadElement)) {
      const spreadParent = parent.getParent();
      if (spreadParent?.asKind(SyntaxKind.CallExpression)) {
        return 'pass';
      }
    }

    // Handle object literal shorthand ({prop} where prop is obj.prop)
    if (parent.asKind(SyntaxKind.ShorthandPropertyAssignment)) {
      return 'pass';
    }

    // Handle element access (obj['prop'])
    if (parent.asKind(SyntaxKind.ElementAccessExpression)) {
      // Prevent infinite recursion with depth limit
      if (depth >= 10) {
        return 'read'; // Fallback to safe default for deep nesting
      }
      // Recursively classify the element access
      return this.classifyAccess(parent, depth + 1);
    }

    // Handle nested property access where a mutator method is called on the property
    if (parent.asKind(SyntaxKind.PropertyAccessExpression)) {
      const outer = parent.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
      const grand = outer.getParent();
      if (grand?.asKind(SyntaxKind.CallExpression)) {
        const callExpr = grand.asKindOrThrow(SyntaxKind.CallExpression);
        if (callExpr.getExpression() === parent) {
          const methodName = outer.getName();
          const mutatorMethods = new Set([
            'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse',
            'fill', 'copyWithin', 'set', 'add', 'delete', 'clear', 'append'
          ]);
          if (mutatorMethods.has(methodName)) {
            return 'modify';
          }
        }
      }
    }

    // Default to read access
    return 'read';
  }

  /**
   * Extract property name from PropertyAccessExpression
   */
  private getPropertyName(propAccess: Node): string | undefined {
    try {
      if (propAccess.asKind(SyntaxKind.PropertyAccessExpression)) {
        const expr = propAccess.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
        return expr.getName();
      }
    } catch {
      // Ignore errors and return undefined
    }
    return undefined;
  }

  /**
   * Calculate correlation between properties
   */
  private calculatePropertyCorrelations(
    usageMap: Map<string, PropertyUsageInfo[]>
  ): PropertyCorrelation[] {
    const SEP = "^_";
    const properties = Array.from(usageMap.keys());
    const correlations: PropertyCorrelation[] = [];
    
    for (let i = 0; i < properties.length; i++) {
      for (let j = i + 1; j < properties.length; j++) {
        const prop1 = properties[i];
        const prop2 = properties[j];
        
        const usage1Functions = new Set(
          usageMap.get(prop1)?.map(u => `${u.functionName}${SEP}${u.filePath}`) || []
        );
        const usage2Functions = new Set(
          usageMap.get(prop2)?.map(u => `${u.functionName}${SEP}${u.filePath}`) || []
        );
        
        const intersection = new Set(
          [...usage1Functions].filter(f => usage2Functions.has(f))
        );
        const union = new Set([...usage1Functions, ...usage2Functions]);
        
        const correlation = union.size > 0 ? intersection.size / union.size : 0;
        
        if (correlation > 0) {
          correlations.push({
            property1: prop1,
            property2: prop2,
            correlation,
            cooccurrences: intersection.size
          });
        }
      }
    }
    
    return correlations.sort((a, b) => b.correlation - a.correlation);
  }

  /**
   * Calculate property usage frequency
   */
  private calculatePropertyFrequency(
    usageMap: Map<string, PropertyUsageInfo[]>
  ): PropertyFrequency[] {
    const totalFunctions = new Set(
      Array.from(usageMap.values())
        .flat()
        .map(u => `${u.functionName}:${u.filePath}`)
    ).size;
    
    return Array.from(usageMap.entries())
      .map(([property, usages]) => {
        const uniqueFunctions = new Set(
          usages.map(u => `${u.functionName}:${u.filePath}`)
        ).size;
        
        return {
          property,
          usageCount: uniqueFunctions,
          totalFunctions,
          percentage: totalFunctions > 0 ? uniqueFunctions / totalFunctions * 100 : 0
        };
      })
      .sort((a, b) => b.usageCount - a.usageCount);
  }

  /**
   * Find properties that are always used together
   */
  private findAlwaysTogetherGroups(
    correlations: PropertyCorrelation[], 
    threshold: number
  ): PropertyGroup[] {
    return correlations
      .filter(c => c.correlation >= threshold)
      .map(c => ({
        properties: [c.property1, c.property2],
        occurrences: c.cooccurrences,
        percentage: c.correlation * 100
      }));
  }

  /**
   * Find properties that are never used together
   */
  private findNeverTogetherGroups(
    correlations: PropertyCorrelation[], 
    threshold: number
  ): PropertyGroup[] {
    return correlations
      .filter(c => c.correlation <= threshold)
      .map(c => ({
        properties: [c.property1, c.property2],
        occurrences: c.cooccurrences,
        percentage: c.correlation * 100
      }));
  }

  /**
   * Detect over-coupled parameters in a function
   */
  private detectOverCoupledParameters(func: FunctionMetadata) {
    try {
      const sourceFile = this.project.getSourceFile(func.filePath);
      if (!sourceFile) {
        return [];
      }

      const couplingData = this.analyzeFunctionCoupling(sourceFile, func);
      const analyses = couplingData.overCoupling.get(func.id) || [];

      return analyses.map(analysis => ({
        parameterName: analysis.parameterName,
        typeName: 'unknown', // Could be enhanced with actual type name
        totalProperties: analysis.totalProperties,
        usedProperties: analysis.usedProperties,
        unusedProperties: [], // Could be calculated from totalProperties - usedProperties
        usageRatio: analysis.usageRatio,
        severity: analysis.severity.toLowerCase() as 'low' | 'medium' | 'high'
      }));
    } catch (error) {
      console.warn(`Failed to analyze coupling for function ${func.name}: ${error}`);
      return [];
    }
  }

  /**
   * Detect bucket brigade patterns
   */
  private detectBucketBrigade(func: FunctionMetadata) {
    try {
      const sourceFile = this.project.getSourceFile(func.filePath);
      if (!sourceFile) {
        return [];
      }

      const couplingData = this.analyzeFunctionCoupling(sourceFile, func);
      const bucketBrigadeData = couplingData.bucketBrigade.get(func.id);
      
      if (!bucketBrigadeData) {
        return [];
      }

      const indicators: {
        parameter: string;
        passedWithoutUse: boolean;
        chainLength: number;
      }[] = [];

      for (const [parameter, calleeIds] of bucketBrigadeData) {
        // Check if parameter is passed without direct property access
        const paramUsage = couplingData.parameterUsage.get(func.id)?.get(parameter);
        const passedWithoutUse = !paramUsage || paramUsage.size === 0;
        
        indicators.push({
          parameter,
          passedWithoutUse,
          chainLength: calleeIds.size
        });
      }

      return indicators.filter(indicator => 
        indicator.passedWithoutUse && indicator.chainLength > 0
      );
    } catch (error) {
      console.warn(`Failed to analyze bucket brigade for function ${func.name}: ${error}`);
      return [];
    }
  }

  /**
   * Create a function signature for matching using symbol-based approach
   */
  private createFunctionSignature(func: FunctionMetadata): string {
    try {
      const sourceFile = this.project.getSourceFile(func.filePath);
      if (!sourceFile) {
        // Fallback to simple signature
        return `${func.name}:${func.filePath}:${func.startLine}`;
      }

      const functionNode = this.findFunctionNodeByMetadata(sourceFile, func);
      if (!functionNode) {
        // Fallback to simple signature
        return `${func.name}:${func.filePath}:${func.startLine}`;
      }

      // Get fully qualified name using TypeScript's symbol system
      const symbol = functionNode.getSymbol();
      if (symbol) {
        const fullyQualifiedName = symbol.getFullyQualifiedName();
        if (fullyQualifiedName) {
          return fullyQualifiedName;
        }
      }

      // Enhanced fallback: include parent class/interface name if available
      const parent = functionNode.getParent();
      let parentName = '';
      
      if (parent) {
        try {
          if (Node.isClassDeclaration(parent) || Node.isInterfaceDeclaration(parent)) {
            parentName = parent.getName() || '';
          }
        } catch {
          // Skip if getName() is not available or fails
        }
      }

      const signature = parentName 
        ? `${parentName}.${func.name}:${func.filePath}:${func.startLine}`
        : `${func.name}:${func.filePath}:${func.startLine}`;
        
      return signature;
    } catch {
      // Ultimate fallback
      return `${func.name}:${func.filePath}:${func.startLine}`;
    }
  }

  /**
   * Extract type members using AST-based analysis with ts-morph
   * This replaces the previous regex-based approach with accurate TypeScript parsing
   */
  private extractTypeMembersFromDefinition(type: TypeDefinition): Array<{
    name: string;
    kind: MemberKind;
    lineNumber: number;
    isStatic?: boolean;
    isAsync?: boolean;
    accessModifier?: 'public' | 'protected' | 'private';
  }> {
    const members: Array<{
      name: string;
      kind: MemberKind;
      lineNumber: number;
      isStatic?: boolean;
      isAsync?: boolean;
      accessModifier?: 'public' | 'protected' | 'private';
    }> = [];

    try {
      // Get the source file from the project
      const sourceFile = this.project.getSourceFile(type.filePath);
      if (!sourceFile) {
        return members;
      }

      // Find the class or interface declaration
      const typeDeclaration = this.findTypeDeclarationAtPosition(sourceFile, type.startLine);
      if (!typeDeclaration) {
        return members;
      }

      // Extract members based on declaration type
      if (typeDeclaration instanceof ClassDeclaration) {
        this.extractClassMembers(typeDeclaration, members);
      } else if (typeDeclaration instanceof InterfaceDeclaration) {
        this.extractInterfaceMembers(typeDeclaration, members);
      } else if (Node.isTypeAliasDeclaration(typeDeclaration)) {
        const typeNode = typeDeclaration.getTypeNode();
        if (typeNode?.asKind(SyntaxKind.TypeLiteral)) {
          const typeLiteral = typeNode.asKindOrThrow(SyntaxKind.TypeLiteral);
          for (const m of typeLiteral.getMembers()) {
            if (Node.isPropertySignature(m)) {
              members.push({ name: m.getName(), kind: MemberKind.Property, lineNumber: m.getStartLineNumber() });
            } else if (Node.isMethodSignature(m)) {
              members.push({ name: m.getName(), kind: MemberKind.Method, lineNumber: m.getStartLineNumber() });
            }
          }
        }
      }

    } catch (error) {
      // Fallback: if AST parsing fails, return empty array
      console.warn(`Failed to extract members for type ${type.name}: ${error}`);
    }

    return members;
  }

  /**
   * Find type declaration at a specific line position
   */
  private findTypeDeclarationAtPosition(
    sourceFile: SourceFile,
    targetLine: number
  ): ClassDeclaration | InterfaceDeclaration | TypeAliasDeclaration | undefined {
    const typeNodes = this.getCachedNodesOfKind(
      sourceFile, 
      'types', 
      [SyntaxKind.ClassDeclaration, SyntaxKind.InterfaceDeclaration, SyntaxKind.TypeAliasDeclaration]
    );
    
    for (const node of typeNodes) {
      const startLine = node.getStartLineNumber();
      const endLine = node.getEndLineNumber();
      
      // Check if this type declaration contains our target line
      if (startLine <= targetLine && targetLine <= endLine) {
        return node as ClassDeclaration | InterfaceDeclaration | TypeAliasDeclaration;
      }
    }
    
    return undefined;
  }

  /**
   * Extract members from class declaration
   */
  private extractClassMembers(classDeclaration: ClassDeclaration, members: Array<{
    name: string;
    kind: MemberKind;
    lineNumber: number;
    isStatic?: boolean;
    isAsync?: boolean;
    accessModifier?: 'public' | 'protected' | 'private';
  }>): void {
    // Get all class members
    const classMembers = classDeclaration.getMembers();
    
    for (const member of classMembers) {
      const memberInfo = this.extractMemberInfo(member);
      if (memberInfo) {
        members.push(memberInfo);
      }
    }
  }

  /**
   * Extract members from interface declaration
   */
  private extractInterfaceMembers(interfaceDeclaration: InterfaceDeclaration, members: Array<{
    name: string;
    kind: MemberKind;
    lineNumber: number;
    isStatic?: boolean;
    isAsync?: boolean;
    accessModifier?: 'public' | 'protected' | 'private';
  }>): void {
    // Get all interface members
    const interfaceMembers = interfaceDeclaration.getMembers();
    
    for (const member of interfaceMembers) {
      const memberInfo = this.extractMemberInfo(member);
      if (memberInfo) {
        members.push(memberInfo);
      }
    }
  }

  /**
   * Extract information from a class or interface member
   */
  private extractMemberInfo(member: Node): {
    name: string;
    kind: MemberKind;
    lineNumber: number;
    isStatic?: boolean;
    isAsync?: boolean;
    accessModifier?: 'public' | 'protected' | 'private';
  } | null {
    try {
      let memberName = '';
      let memberKind: MemberKind = MemberKind.Method;
      let isStatic = false;
      let isAsync = false;
      let accessModifier: 'public' | 'protected' | 'private' | undefined = undefined;

      // Extract common properties
      const lineNumber = member.getStartLineNumber();

      if (member instanceof MethodDeclaration) {
        memberName = member.getName();
        memberKind = MemberKind.Method;
        isStatic = !!member.getStaticKeyword();
        isAsync = !!member.getAsyncKeyword();
        accessModifier = this.getAccessModifier(member);
      } else if (member instanceof ConstructorDeclaration) {
        memberName = 'constructor';
        memberKind = MemberKind.Constructor;
        accessModifier = this.getAccessModifier(member);
      } else if (member instanceof GetAccessorDeclaration) {
        memberName = member.getName();
        memberKind = MemberKind.Getter;
        isStatic = !!member.getStaticKeyword();
        accessModifier = this.getAccessModifier(member);
      } else if (member instanceof SetAccessorDeclaration) {
        memberName = member.getName();
        memberKind = MemberKind.Setter;
        isStatic = !!member.getStaticKeyword();
        accessModifier = this.getAccessModifier(member);
      } else if (member instanceof PropertyDeclaration) {
        memberName = member.getName();
        memberKind = MemberKind.Property;
        isStatic = !!member.getStaticKeyword();
        accessModifier = this.getAccessModifier(member);
      } else if (member instanceof MethodSignature) {
        memberName = member.getName();
        memberKind = MemberKind.Method;
      } else if (member instanceof PropertySignature) {
        memberName = member.getName();
        memberKind = MemberKind.Property;
      } else {
        // Skip unsupported member types
        return null;
      }

      if (!memberName) {
        return null;
      }

      return {
        name: memberName,
        kind: memberKind,
        lineNumber,
        ...(isStatic && { isStatic }),
        ...(isAsync && { isAsync }),
        ...(accessModifier && { accessModifier })
      };

    } catch (error) {
      console.warn(`Failed to extract member info: ${error}`);
      return null;
    }
  }

  /**
   * Extract access modifier from a member (only for class members)
   */
  private getAccessModifier(
    member: MethodDeclaration | ConstructorDeclaration | GetAccessorDeclaration | 
           SetAccessorDeclaration | PropertyDeclaration | Node
  ): 'public' | 'protected' | 'private' | undefined {
    try {
      // Only apply access modifiers to class members, not top-level functions
      if (Node.isFunctionDeclaration(member) || Node.isFunctionExpression(member) || Node.isArrowFunction(member)) {
        return undefined; // Top-level functions don't have access modifiers
      }
      
      // Check if this is actually a class member
      const parent = member.getParent();
      if (!Node.isClassDeclaration(parent)) {
        return undefined; // Interface members and top-level functions don't have access modifiers
      }

      // Check for access modifiers using proper type guards
      if (Node.isMethodDeclaration(member) || Node.isConstructorDeclaration(member) ||
          Node.isGetAccessorDeclaration(member) || Node.isSetAccessorDeclaration(member) ||
          Node.isPropertyDeclaration(member)) {
        if (member.hasModifier(SyntaxKind.PrivateKeyword)) {
          return 'private';
        }
        if (member.hasModifier(SyntaxKind.ProtectedKeyword)) {
          return 'protected';
        }
        if (member.hasModifier(SyntaxKind.PublicKeyword)) {
          return 'public';
        }
      }
      
      // Default is public for class members in TypeScript
      return 'public';
    } catch {
      return undefined;
    }
  }

  /**
   * Find functions that match a type member using improved matching logic
   */
  private findMatchingFunctions(
    member: { 
      name: string; 
      kind: MemberKind; 
      lineNumber: number;
      isStatic?: boolean;
      isAsync?: boolean;
      accessModifier?: 'public' | 'protected' | 'private';
    },
    type: TypeDefinition,
    functionsBySignature: Map<string, FunctionMetadata[]>
  ): FunctionMetadata[] {
    const matches: FunctionMetadata[] = [];

    // Skip properties for function matching (they don't have implementations)
    if (member.kind === MemberKind.Property) {
      return matches;
    }

    try {
      // First, try symbol-based matching
      const symbolMatches = this.findBySymbolMatch(member, type, functionsBySignature);
      if (symbolMatches.length > 0) {
        return symbolMatches;
      }

      // Then, try simple name matching within the same file and type scope
      const simpleMatches: FunctionMetadata[] = [];
      for (const funcs of functionsBySignature.values()) {
        for (const func of funcs) {
          if (func.filePath === type.filePath && 
              func.name === member.name &&
              this.isFunctionWithinTypeScope(func, type)) {
            simpleMatches.push(func);
          }
        }
      }
      
      return simpleMatches;
    } catch (error) {
      console.warn(`Error matching functions for member ${member.name}: ${error}`);
      return matches;
    }
  }

  /**
   * Find functions using symbol-based matching
   */
  private findBySymbolMatch(
    member: { 
      name: string; 
      kind: MemberKind;
      lineNumber: number;
    },
    type: TypeDefinition,
    functionsBySignature: Map<string, FunctionMetadata[]>
  ): FunctionMetadata[] {
    try {
      const sourceFile = this.project.getSourceFile(type.filePath);
      if (!sourceFile) {
        return [];
      }

      // Get the type declaration
      const typeDeclaration = this.findTypeDeclarationAtPosition(sourceFile, type.startLine);
      if (!typeDeclaration) {
        return [];
      }

      // Find the member declaration within the type
      const memberDeclaration = this.findMemberInType(typeDeclaration, member.name, member.kind);
      if (!memberDeclaration) {
        return [];
      }

      // Get symbol for the member
      const symbol = memberDeclaration.getSymbol();
      if (!symbol) {
        return [];
      }

      const fullyQualifiedName = symbol.getFullyQualifiedName();
      if (!fullyQualifiedName) {
        return [];
      }

      // Look for function with matching fully qualified name
      return functionsBySignature.get(fullyQualifiedName) || [];
    } catch {
      return [];
    }
  }

  /**
   * Find a specific member declaration within a type declaration
   */
  private findMemberInType(
    typeDeclaration: ClassDeclaration | InterfaceDeclaration | TypeAliasDeclaration,
    memberName: string,
    memberKind: MemberKind
  ): Node | undefined {
    try {
      // Handle TypeAliasDeclaration separately as it doesn't have getMembers()
      if (Node.isTypeAliasDeclaration(typeDeclaration)) {
        const typeNode = typeDeclaration.getTypeNode();
        if (typeNode?.asKind(SyntaxKind.TypeLiteral)) {
          const typeLiteral = typeNode.asKindOrThrow(SyntaxKind.TypeLiteral);
          const members = typeLiteral.getMembers();
          
          for (const member of members) {
            let matchesKind = false;
            let matchesName = false;

            // Check if the member kind matches (for type aliases, only properties and method signatures)
            switch (memberKind) {
              case MemberKind.Method:
                matchesKind = Node.isMethodSignature(member);
                matchesName = matchesKind && Node.isMethodSignature(member) && member.getName() === memberName;
                break;
              case MemberKind.Property:
                matchesKind = Node.isPropertySignature(member);
                matchesName = matchesKind && Node.isPropertySignature(member) && member.getName() === memberName;
                break;
              default:
                // TypeAlias doesn't support constructors, getters, setters
                break;
            }

            if (matchesKind && matchesName) {
              return member;
            }
          }
        }
        return undefined;
      }
      
      // Handle ClassDeclaration and InterfaceDeclaration
      const members = typeDeclaration.getMembers();
      
      for (const member of members) {
        let matchesKind = false;
        let matchesName = false;

        // Check if the member kind matches
        switch (memberKind) {
          case MemberKind.Method:
            matchesKind = member instanceof MethodDeclaration || member instanceof MethodSignature;
            matchesName = 'getName' in member && member.getName() === memberName;
            break;
          case MemberKind.Constructor:
            matchesKind = member instanceof ConstructorDeclaration;
            matchesName = true; // Constructors don't have names in the traditional sense
            break;
          case MemberKind.Getter:
            matchesKind = member instanceof GetAccessorDeclaration;
            matchesName = 'getName' in member && member.getName() === memberName;
            break;
          case MemberKind.Setter:
            matchesKind = member instanceof SetAccessorDeclaration;
            matchesName = 'getName' in member && member.getName() === memberName;
            break;
          case MemberKind.Property:
            matchesKind = member instanceof PropertyDeclaration || member instanceof PropertySignature;
            matchesName = 'getName' in member && member.getName() === memberName;
            break;
        }

        if (matchesKind && matchesName) {
          return member;
        }
      }
    } catch {
      // Fall back to undefined
    }
    
    return undefined;
  }

  /**
   * Check if a function is within the scope of a given type
   */
  private isFunctionWithinTypeScope(func: FunctionMetadata, type: TypeDefinition): boolean {
    return func.filePath === type.filePath &&
           func.startLine >= type.startLine &&
           func.endLine <= type.endLine;
  }

  /**
   * Analyze function coupling using OnePassASTVisitor
   */
  private analyzeFunctionCoupling(sourceFile: SourceFile, _func: FunctionMetadata): CouplingDataMap {
    const checker = this.project.getTypeChecker();
    const visitor = new OnePassASTVisitor();
    const context = visitor.scanFile(sourceFile, checker);
    
    // Note: OnePassASTVisitor now uses FunctionIdGenerator for consistent ID generation,
    // ensuring ID compatibility with FunctionMetadata.id from the database
    return context.couplingData;
  }
}

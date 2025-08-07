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
  SyntaxKind
} from 'ts-morph';
import { TypeDefinition } from './type-analyzer';
import { FunctionMetadata } from './ideal-call-graph-analyzer';
import { QualityMetrics } from '../types';

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
    const filePath = sourceFile.getFilePath();
    
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
  private determineMemberKind(functionMeta: FunctionMetadata): string {
    // This would need proper AST analysis in a real implementation
    if (functionMeta.name === 'constructor') return MemberKind.Constructor;
    if (functionMeta.name.startsWith('get ')) return MemberKind.Getter;
    if (functionMeta.name.startsWith('set ')) return MemberKind.Setter;
    return MemberKind.Method;
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
        SyntaxKind.ArrowFunction
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
  private findTypeDeclarationAtPosition(sourceFile: SourceFile, targetLine: number): ClassDeclaration | InterfaceDeclaration | undefined {
    const typeNodes = this.getCachedNodesOfKind(
      sourceFile, 
      'types', 
      [SyntaxKind.ClassDeclaration, SyntaxKind.InterfaceDeclaration]
    );
    
    for (const node of typeNodes) {
      const startLine = node.getStartLineNumber();
      const endLine = node.getEndLineNumber();
      
      // Check if this type declaration contains our target line
      if (startLine <= targetLine && targetLine <= endLine) {
        return node as ClassDeclaration | InterfaceDeclaration;
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

      // Second, try enhanced name-based matching with parent context
      const enhancedSignature = `${type.name}.${member.name}:${type.filePath}`;
      const enhancedMatches = functionsBySignature.get(enhancedSignature);
      if (enhancedMatches && enhancedMatches.length > 0) {
        return enhancedMatches.filter(func => this.isFunctionWithinTypeScope(func, type));
      }

      // Third, try simple name matching within the same file and type scope
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
    typeDeclaration: ClassDeclaration | InterfaceDeclaration,
    memberName: string,
    memberKind: MemberKind
  ): Node | undefined {
    try {
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
}
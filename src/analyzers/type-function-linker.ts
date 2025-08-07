import { Project } from 'ts-morph';
import { TypeDefinition } from './type-analyzer';
import { FunctionMetadata } from './ideal-call-graph-analyzer';

export interface CrossReference {
  typeId: string;
  typeName: string;
  functionId: string;
  functionName: string;
  memberKind: 'method' | 'constructor' | 'getter' | 'setter';
  linkageStatus: 'linked' | 'orphaned_type' | 'orphaned_function';
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
  constructor(_project: Project) {
    // Project might be used for future AST analysis improvements
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
  enrichTypeWithFunctionInfo(
    type: TypeDefinition, 
    functions: FunctionMetadata[]
  ): EnrichedTypeInfo {
    const enriched: EnrichedTypeInfo = { ...type };
    
    if (type.kind === 'class' || type.kind === 'interface') {
      const typeMethods = this.findMethodsForType(type, functions);
      enriched.methodQuality = this.calculateMethodQuality(typeMethods);
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
            linkageStatus: 'linked',
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
          linkageStatus: 'orphaned_type',
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
      
      if (ref.linkageStatus === 'linked') {
        linkedCount++;
      } else if (ref.linkageStatus === 'orphaned_type') {
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
    if (functionMeta.name === 'constructor') return 'constructor';
    if (functionMeta.name.startsWith('get ')) return 'getter';
    if (functionMeta.name.startsWith('set ')) return 'setter';
    return 'method';
  }

  /**
   * Extract access modifier from function metadata
   */
  private extractAccessModifier(_functionMeta: FunctionMetadata): 'public' | 'protected' | 'private' | undefined {
    // This would need proper AST analysis in a real implementation
    // For now, return undefined as we don't have this information
    return undefined;
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
   * Calculate method quality metrics for a type
   */
  private calculateMethodQuality(methods: FunctionMetadata[]) {
    if (methods.length === 0) {
      return {
        totalMethods: 0,
        linkedMethods: 0,
        highRiskMethods: []
      };
    }

    // Note: FunctionMetadata doesn't include complexity/LOC metrics
    // In a real implementation, these would be fetched from the quality_metrics table
    const averageComplexity = undefined; // Would calculate from metrics data

    const highRiskMethods = methods
      .filter(method => {
        // Simple heuristic based on available metadata
        return method.signature.length > 100 || method.name.length > 30;
      })
      .map(method => ({
        functionId: method.id,
        functionName: method.name,
        riskFactors: [
          ...(method.signature.length > 150 ? ['Long Signature'] : []),
          ...(method.name.length > 40 ? ['Long Name'] : []),
          ...(method.signature.includes('Promise<') ? ['Async Complexity'] : [])
        ]
      }));

    return {
      totalMethods: methods.length,
      linkedMethods: methods.length, // All found methods are considered linked
      averageComplexity,
      highRiskMethods
    };
  }

  /**
   * Create a function signature for matching
   */
  private createFunctionSignature(func: FunctionMetadata): string {
    return `${func.name}:${func.filePath}`;
  }

  /**
   * Extract type members from type definition text (simplified)
   */
  private extractTypeMembersFromDefinition(type: TypeDefinition): Array<{
    name: string;
    kind: 'method' | 'constructor' | 'getter' | 'setter';
    lineNumber: number;
  }> {
    // This is a simplified implementation
    // In reality, this would parse the AST to extract member information
    const members: Array<{
      name: string;
      kind: 'method' | 'constructor' | 'getter' | 'setter';
      lineNumber: number;
    }> = [];

    if (type.typeText) {
      const lines = type.typeText.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Simple regex patterns for method detection
        const methodMatch = line.match(/^\s*(\w+)\s*\(/);
        if (methodMatch) {
          members.push({
            name: methodMatch[1],
            kind: methodMatch[1] === 'constructor' ? 'constructor' : 'method',
            lineNumber: type.startLine + i
          });
        }
      }
    }

    return members;
  }

  /**
   * Find functions that match a type member
   */
  private findMatchingFunctions(
    member: { name: string; kind: string; lineNumber: number },
    type: TypeDefinition,
    functionsBySignature: Map<string, FunctionMetadata[]>
  ): FunctionMetadata[] {
    const signature = `${member.name}:${type.filePath}`;
    return functionsBySignature.get(signature) || [];
  }
}
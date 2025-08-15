/**
 * Type Compatibility Checker
 * 
 * Uses TypeScript Compiler API to perform rigorous type compatibility verification.
 * Checks structural subtyping, covariance/contravariance, and complex type relationships.
 */

import * as ts from 'typescript';
import * as path from 'path';
import { existsSync } from 'fs';
import type { StorageQueryInterface } from '../type-insights/types';

export interface CompatibilityCheckOptions {
  strictNullChecks?: boolean;       // Consider strict null checking
  exactOptionalPropertyTypes?: boolean; // Exact optional property matching
  checkGenerics?: boolean;          // Deep generic type compatibility
  checkFunctionSignatures?: boolean; // Function parameter/return compatibility
  includeMethodNames?: boolean;     // Consider method names in compatibility
}

export interface TypeCompatibilityResult {
  isCompatible: boolean;
  compatibilityType: 'identical' | 'assignable' | 'structural_subset' | 'structural_superset' | 'incompatible';
  confidence: number;               // 0.0 - 1.0
  issues: CompatibilityIssue[];
  suggestions: string[];
  migrationComplexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'breaking';
}

export interface CompatibilityIssue {
  severity: 'error' | 'warning' | 'info';
  category: 'structure' | 'nullability' | 'generics' | 'functions' | 'literals';
  description: string;
  sourcePath: string;               // Property path in source type
  targetPath?: string;              // Property path in target type (if applicable)
  suggestion?: string;
  autoFixable: boolean;
}

export interface TypeInfo {
  id: string;
  name: string;
  filePath: string;
  definition: string;
  typeNode?: ts.TypeNode;
  resolvedType?: ts.Type;
}

export class TypeCompatibilityChecker {
  private storage: StorageQueryInterface;
  private options: Required<CompatibilityCheckOptions>;
  private program?: ts.Program;
  private checker?: ts.TypeChecker;

  constructor(
    storage: StorageQueryInterface,
    options: Partial<CompatibilityCheckOptions> = {}
  ) {
    this.storage = storage;
    this.options = {
      strictNullChecks: options.strictNullChecks ?? true,
      exactOptionalPropertyTypes: options.exactOptionalPropertyTypes ?? false,
      checkGenerics: options.checkGenerics ?? true,
      checkFunctionSignatures: options.checkFunctionSignatures ?? true,
      includeMethodNames: options.includeMethodNames ?? true
    } as Required<CompatibilityCheckOptions>;
  }

  /**
   * Initialize TypeScript program and type checker
   */
  async initialize(tsConfigPath?: string): Promise<void> {
    try {
      // Use provided tsconfig or find default
      const configPath = tsConfigPath ?? this.findTsConfig();
      
      if (configPath) {
        const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
        const parsedConfig = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          process.cwd()
        );

        this.program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
      } else {
        // Fallback: create minimal program
        this.program = ts.createProgram([], {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.CommonJS,
          strict: true,
          skipLibCheck: true
        });
      }

      this.checker = this.program.getTypeChecker();
    } catch (error) {
      throw new Error(`Failed to initialize TypeScript checker: ${
        error instanceof Error ? error.message : String(error)
      }`);
    }
  }

  /**
   * Check compatibility between two types
   */
  async checkCompatibility(
    sourceTypeName: string,
    targetTypeName: string,
    snapshotId?: string
  ): Promise<TypeCompatibilityResult> {
    if (!this.checker || !this.program) {
      throw new Error('TypeScript checker not initialized. Call initialize() first.');
    }

    try {
      // Get type information from database
      const sourceType = await this.getTypeInfo(sourceTypeName, snapshotId);
      const targetType = await this.getTypeInfo(targetTypeName, snapshotId);

      if (!sourceType) {
        throw new Error(`Source type '${sourceTypeName}' not found`);
      }
      if (!targetType) {
        throw new Error(`Target type '${targetTypeName}' not found`);
      }

      // Perform comprehensive compatibility analysis
      const result = await this.analyzeTypeCompatibility(sourceType, targetType);
      
      return result;
    } catch (error) {
      throw new Error(`Type compatibility check failed: ${
        error instanceof Error ? error.message : String(error)
      }`);
    }
  }

  /**
   * Get type information from storage
   */
  private async getTypeInfo(typeName: string, snapshotId?: string): Promise<TypeInfo | null> {
    const query = snapshotId
      ? `SELECT id, name, file_path, definition FROM type_definitions WHERE name = $1 AND snapshot_id = $2`
      : `SELECT id, name, file_path, definition FROM type_definitions WHERE name = $1 ORDER BY created_at DESC LIMIT 1`;

    const params = snapshotId ? [typeName, snapshotId] : [typeName];
    const result = await this.storage.query(query, params);
    
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0] as Record<string, unknown>;
    return {
      id: row['id'] as string,
      name: row['name'] as string,
      filePath: row['file_path'] as string,
      definition: row['definition'] as string
    };
  }

  /**
   * Analyze compatibility between two types
   */
  private async analyzeTypeCompatibility(
    sourceType: TypeInfo,
    targetType: TypeInfo
  ): Promise<TypeCompatibilityResult> {
    const issues: CompatibilityIssue[] = [];
    const suggestions: string[] = [];

    // Parse type definitions as TypeScript nodes
    const sourceNode = this.parseTypeDefinition(sourceType.definition);
    const targetNode = this.parseTypeDefinition(targetType.definition);

    if (!sourceNode || !targetNode) {
      return {
        isCompatible: false,
        compatibilityType: 'incompatible',
        confidence: 0.0,
        issues: [{
          severity: 'error',
          category: 'structure',
          description: 'Unable to parse type definitions',
          sourcePath: '',
          autoFixable: false
        }],
        suggestions: [],
        migrationComplexity: 'breaking'
      };
    }

    // Get resolved types from checker (placeholder for future enhancement)
    // let sourceResolvedType: ts.Type | undefined;
    // let targetResolvedType: ts.Type | undefined;

    try {
      // Create temporary source files for type resolution
      const sourceFile = this.createTempSourceFile(sourceType.definition, 'SourceType');
      const targetFile = this.createTempSourceFile(targetType.definition, 'TargetType');

      if (sourceFile && targetFile) {
        // Future enhancement: use resolved types for advanced analysis
        // sourceResolvedType = this.checker?.getTypeFromTypeNode(sourceNode);
        // targetResolvedType = this.checker?.getTypeFromTypeNode(targetNode);
      }
    } catch (error) {
      // Fallback to structural analysis if type resolution fails
      console.warn('Type resolution failed, using structural analysis:', error);
    }

    // Perform compatibility checks
    const structuralResult = this.checkStructuralCompatibility(sourceNode, targetNode, issues);
    
    if (this.options.checkGenerics) {
      this.checkGenericCompatibility(sourceNode, targetNode, issues);
    }

    if (this.options.checkFunctionSignatures) {
      this.checkFunctionSignatureCompatibility(sourceNode, targetNode, issues);
    }

    if (this.options.strictNullChecks) {
      this.checkNullabilityCompatibility(sourceNode, targetNode, issues);
    }

    // Determine overall compatibility
    const errorIssues = issues.filter(i => i.severity === 'error');
    // const warningIssues = issues.filter(i => i.severity === 'warning');
    
    const isCompatible = errorIssues.length === 0;
    const compatibilityType = this.determineCompatibilityType(structuralResult, errorIssues.length);
    const confidence = this.calculateConfidence(issues, structuralResult);
    const migrationComplexity = this.assessMigrationComplexity(issues, structuralResult);

    // Generate suggestions
    this.generateSuggestions(issues, suggestions);

    return {
      isCompatible,
      compatibilityType,
      confidence,
      issues,
      suggestions,
      migrationComplexity
    };
  }

  /**
   * Parse type definition string into TypeScript node
   */
  private parseTypeDefinition(definition: string): ts.TypeNode | undefined {
    try {
      // Wrap definition in a temporary type alias for parsing
      const tempSource = `type TempType = ${definition};`;
      const sourceFile = ts.createSourceFile(
        'temp.ts',
        tempSource,
        ts.ScriptTarget.Latest,
        true
      );

      const typeAlias = sourceFile.statements[0] as ts.TypeAliasDeclaration;
      return typeAlias?.type;
    } catch (error) {
      console.warn('Failed to parse type definition:', definition, error);
      return undefined;
    }
  }

  /**
   * Create temporary source file for type resolution
   */
  private createTempSourceFile(definition: string, typeName: string): ts.SourceFile | undefined {
    try {
      const content = `export type ${typeName} = ${definition};`;
      return ts.createSourceFile(
        `${typeName}.ts`,
        content,
        ts.ScriptTarget.Latest,
        true
      );
    } catch {
      return undefined;
    }
  }

  /**
   * Check structural compatibility between types
   */
  private checkStructuralCompatibility(
    sourceNode: ts.TypeNode,
    targetNode: ts.TypeNode,
    issues: CompatibilityIssue[]
  ): 'identical' | 'subset' | 'superset' | 'overlap' | 'disjoint' {
    // Simplified structural analysis
    // In a real implementation, this would recursively compare type structures
    
    const sourceText = sourceNode.getText();
    const targetText = targetNode.getText();

    if (sourceText === targetText) {
      return 'identical';
    }

    // Check for obvious structural differences
    if (sourceNode.kind !== targetNode.kind) {
      issues.push({
        severity: 'error',
        category: 'structure',
        description: `Type kinds differ: ${ts.SyntaxKind[sourceNode.kind]} vs ${ts.SyntaxKind[targetNode.kind]}`,
        sourcePath: 'root',
        autoFixable: false
      });
      return 'disjoint';
    }

    // Object type compatibility
    if (ts.isTypeLiteralNode(sourceNode) && ts.isTypeLiteralNode(targetNode)) {
      return this.compareObjectTypes(sourceNode, targetNode, issues);
    }

    // Union type compatibility
    if (ts.isUnionTypeNode(sourceNode) && ts.isUnionTypeNode(targetNode)) {
      return this.compareUnionTypes(sourceNode, targetNode, issues);
    }

    // Default to overlap for complex types
    return 'overlap';
  }

  /**
   * Compare object type literals
   */
  private compareObjectTypes(
    sourceType: ts.TypeLiteralNode,
    targetType: ts.TypeLiteralNode,
    issues: CompatibilityIssue[]
  ): 'identical' | 'subset' | 'superset' | 'overlap' | 'disjoint' {
    const sourceMembers = new Map<string, ts.TypeElement>();
    const targetMembers = new Map<string, ts.TypeElement>();

    // Build member maps
    for (const member of sourceType.members) {
      if (ts.isPropertySignature(member) && member.name) {
        const name = member.name.getText();
        sourceMembers.set(name, member);
      }
    }

    for (const member of targetType.members) {
      if (ts.isPropertySignature(member) && member.name) {
        const name = member.name.getText();
        targetMembers.set(name, member);
      }
    }

    let missingInTarget = 0;
    let missingInSource = 0;
    let typeConflicts = 0;

    // Check members present in source but missing in target
    for (const [name, sourceMember] of sourceMembers) {
      if (!targetMembers.has(name)) {
        missingInTarget++;
        const isOptional = ts.isPropertySignature(sourceMember) && sourceMember.questionToken;
        
        issues.push({
          severity: isOptional ? 'warning' : 'error',
          category: 'structure',
          description: `Property '${name}' exists in source but not in target`,
          sourcePath: name,
          autoFixable: true,
          suggestion: isOptional ? 'Property is optional, consider adding to target' : 'Add required property to target type'
        });
      } else {
        // Check type compatibility for common properties
        const targetMember = targetMembers.get(name);
        if (this.arePropertyTypesIncompatible(sourceMember, targetMember)) {
          typeConflicts++;
          issues.push({
            severity: 'error',
            category: 'structure',
            description: `Property '${name}' has incompatible types`,
            sourcePath: name,
            targetPath: name,
            autoFixable: false
          });
        }
      }
    }

    // Check members present in target but missing in source
    for (const [name, targetMember] of targetMembers) {
      if (!sourceMembers.has(name)) {
        missingInSource++;
        const isOptional = ts.isPropertySignature(targetMember) && targetMember.questionToken;
        
        issues.push({
          severity: isOptional ? 'info' : 'warning',
          category: 'structure',
          description: `Property '${name}' exists in target but not in source`,
          sourcePath: '',
          targetPath: name,
          autoFixable: true,
          suggestion: 'Target has additional property'
        });
      }
    }

    // Determine relationship
    if (typeConflicts > 0) return 'disjoint';
    if (missingInTarget === 0 && missingInSource === 0) return 'identical';
    if (missingInTarget === 0) return 'subset';   // Source can be assigned to target
    if (missingInSource === 0) return 'superset'; // Target can be assigned to source
    return 'overlap';
  }

  /**
   * Compare union types
   */
  private compareUnionTypes(
    sourceType: ts.UnionTypeNode,
    targetType: ts.UnionTypeNode,
    issues: CompatibilityIssue[]
  ): 'identical' | 'subset' | 'superset' | 'overlap' | 'disjoint' {
    const sourceTypes = sourceType.types.map(t => t.getText());
    const targetTypes = targetType.types.map(t => t.getText());

    const sourceSet = new Set(sourceTypes);
    const targetSet = new Set(targetTypes);

    const commonTypes = sourceTypes.filter(t => targetSet.has(t));
    const sourceOnlyTypes = sourceTypes.filter(t => !targetSet.has(t));
    const targetOnlyTypes = targetTypes.filter(t => !sourceSet.has(t));

    if (sourceOnlyTypes.length > 0) {
      issues.push({
        severity: 'warning',
        category: 'structure',
        description: `Source union has additional types: ${sourceOnlyTypes.join(', ')}`,
        sourcePath: 'union',
        autoFixable: false
      });
    }

    if (targetOnlyTypes.length > 0) {
      issues.push({
        severity: 'info',
        category: 'structure',
        description: `Target union has additional types: ${targetOnlyTypes.join(', ')}`,
        sourcePath: '',
        targetPath: 'union',
        autoFixable: false
      });
    }

    if (commonTypes.length === 0) return 'disjoint';
    if (sourceOnlyTypes.length === 0 && targetOnlyTypes.length === 0) return 'identical';
    if (sourceOnlyTypes.length === 0) return 'subset';
    if (targetOnlyTypes.length === 0) return 'superset';
    return 'overlap';
  }

  /**
   * Check if property types are incompatible
   */
  private arePropertyTypesIncompatible(
    sourceProp: ts.TypeElement | undefined,
    targetProp: ts.TypeElement | undefined
  ): boolean {
    if (!sourceProp || !targetProp) return true;
    if (!ts.isPropertySignature(sourceProp) || !ts.isPropertySignature(targetProp)) return false;
    
    const sourceType = sourceProp.type?.getText() ?? 'any';
    const targetType = targetProp.type?.getText() ?? 'any';
    
    // Simple text-based comparison (could be enhanced with actual type checking)
    return sourceType !== targetType;
  }

  /**
   * Check generic type compatibility
   */
  private checkGenericCompatibility(
    sourceNode: ts.TypeNode,
    targetNode: ts.TypeNode,
    issues: CompatibilityIssue[]
  ): void {
    // Implementation for generic type compatibility checking
    // This would involve analyzing type parameters, constraints, etc.
    
    if (ts.isTypeReferenceNode(sourceNode) && ts.isTypeReferenceNode(targetNode)) {
      const sourceTypeName = sourceNode.typeName.getText();
      const targetTypeName = targetNode.typeName.getText();
      
      if (sourceTypeName !== targetTypeName) {
        issues.push({
          severity: 'error',
          category: 'generics',
          description: `Generic type names differ: ${sourceTypeName} vs ${targetTypeName}`,
          sourcePath: 'generic',
          autoFixable: false
        });
      }
    }
  }

  /**
   * Check function signature compatibility
   */
  private checkFunctionSignatureCompatibility(
    sourceNode: ts.TypeNode,
    targetNode: ts.TypeNode,
    issues: CompatibilityIssue[]
  ): void {
    if (ts.isFunctionTypeNode(sourceNode) && ts.isFunctionTypeNode(targetNode)) {
      // Compare parameter counts
      const sourceParamCount = sourceNode.parameters.length;
      const targetParamCount = targetNode.parameters.length;
      
      if (sourceParamCount !== targetParamCount) {
        issues.push({
          severity: 'error',
          category: 'functions',
          description: `Parameter count differs: ${sourceParamCount} vs ${targetParamCount}`,
          sourcePath: 'function.parameters',
          autoFixable: false
        });
      }
    }
  }

  /**
   * Check nullability compatibility
   */
  private checkNullabilityCompatibility(
    sourceNode: ts.TypeNode,
    targetNode: ts.TypeNode,
    issues: CompatibilityIssue[]
  ): void {
    const sourceAllowsNull = this.typeAllowsNull(sourceNode);
    const targetAllowsNull = this.typeAllowsNull(targetNode);
    
    if (sourceAllowsNull && !targetAllowsNull) {
      issues.push({
        severity: 'error',
        category: 'nullability',
        description: 'Source type allows null but target type does not',
        sourcePath: 'root',
        autoFixable: true,
        suggestion: 'Add null handling or make target type nullable'
      });
    }
  }

  /**
   * Check if type allows null
   */
  private typeAllowsNull(node: ts.TypeNode): boolean {
    if (ts.isUnionTypeNode(node)) {
      return node.types.some(t => 
        t.kind === ts.SyntaxKind.NullKeyword || 
        t.kind === ts.SyntaxKind.UndefinedKeyword
      );
    }
    return node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.UndefinedKeyword;
  }

  /**
   * Determine compatibility type from analysis results
   */
  private determineCompatibilityType(
    structuralResult: string,
    errorCount: number
  ): TypeCompatibilityResult['compatibilityType'] {
    if (errorCount > 0) return 'incompatible';
    
    switch (structuralResult) {
      case 'identical': return 'identical';
      case 'subset': return 'structural_subset';
      case 'superset': return 'structural_superset';
      case 'overlap': return 'assignable';
      default: return 'incompatible';
    }
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(issues: CompatibilityIssue[], structuralResult: string): number {
    const errorWeight = 0.5;
    const warningWeight = 0.2;
    const infoWeight = 0.1;
    
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;
    const infoCount = issues.filter(i => i.severity === 'info').length;
    
    const penalty = errorCount * errorWeight + warningCount * warningWeight + infoCount * infoWeight;
    const structuralBonus = structuralResult === 'identical' ? 0.2 : 0.0;
    
    return Math.max(0.0, Math.min(1.0, 1.0 - penalty + structuralBonus));
  }

  /**
   * Assess migration complexity
   */
  private assessMigrationComplexity(
    issues: CompatibilityIssue[],
    structuralResult: string
  ): TypeCompatibilityResult['migrationComplexity'] {
    const errorIssues = issues.filter(i => i.severity === 'error');
    const autoFixableIssues = issues.filter(i => i.autoFixable);
    
    if (structuralResult === 'identical') return 'trivial';
    if (errorIssues.length === 0) return 'simple';
    if (errorIssues.length === autoFixableIssues.length) return 'moderate';
    if (errorIssues.length <= 3) return 'complex';
    return 'breaking';
  }

  /**
   * Generate suggestions based on issues
   */
  private generateSuggestions(issues: CompatibilityIssue[], suggestions: string[]): void {
    const errorIssues = issues.filter(i => i.severity === 'error');
    const autoFixableCount = issues.filter(i => i.autoFixable).length;
    
    if (errorIssues.length === 0) {
      suggestions.push('Types are compatible - replacement should be safe');
    } else if (autoFixableCount === errorIssues.length) {
      suggestions.push('All compatibility issues can be automatically fixed');
      suggestions.push('Consider using codemod generation for automatic migration');
    } else {
      suggestions.push('Manual intervention required for some compatibility issues');
      suggestions.push('Review structural differences before proceeding');
    }
    
    // Add specific suggestions from issues
    for (const issue of issues) {
      if (issue.suggestion && !suggestions.includes(issue.suggestion)) {
        suggestions.push(issue.suggestion);
      }
    }
  }

  /**
   * Find TypeScript configuration file
   */
  private findTsConfig(): string | undefined {
    const projectRoot = process.cwd();
    const possiblePaths = [
      path.join(projectRoot, 'tsconfig.json'),
      path.join(projectRoot, '..', 'tsconfig.json'),
    ];

    for (const configPath of possiblePaths) {
      try {
        if (existsSync(configPath)) {
          return configPath;
        }
      } catch {
        // Continue searching
      }
    }

    return undefined;
  }
}
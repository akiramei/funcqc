import {
  Project,
  Node,
  InterfaceDeclaration,
  TypeAliasDeclaration,
  ClassDeclaration,
  EnumDeclaration,
  ModuleDeclaration,
  TypeNode
} from 'ts-morph';
import { v4 as uuidv4 } from 'uuid';

export interface TypeDefinition {
  id: string;
  snapshotId: string;
  name: string;
  kind: 'class' | 'interface' | 'type_alias' | 'enum' | 'namespace';
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  
  // Type-specific attributes
  isAbstract: boolean;
  isExported: boolean;
  isDefaultExport: boolean;
  isGeneric: boolean;
  genericParameters: string[];
  
  // Type content
  typeText: string;
  resolvedType?: unknown;
  
  // Metadata
  modifiers: string[];
  jsdoc: string | undefined;
  metadata: Record<string, unknown>;
}

export interface TypeMetrics {
  fieldCount: number;
  nestingDepth: number;
  genericParameterCount: number;
  unionMemberCount: number;
  intersectionMemberCount: number;
  literalTypeCount: number;
  discriminantCaseCount: number;
}

/**
 * Analyzes TypeScript type definitions and extracts structural information
 */
export class TypeAnalyzer {
  constructor(private project: Project) {}

  /**
   * Analyze a TypeScript file to extract type definitions
   */
  analyzeFile(filePath: string, snapshotId: string): TypeDefinition[] {
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) {
      throw new Error(`Source file not found: ${filePath}`);
    }

    const typeDefinitions: TypeDefinition[] = [];

    // Extract interfaces
    sourceFile.getInterfaces().forEach(interfaceDecl => {
      typeDefinitions.push(this.extractInterfaceDefinition(interfaceDecl, snapshotId, filePath));
    });

    // Extract type aliases
    sourceFile.getTypeAliases().forEach(typeAlias => {
      typeDefinitions.push(this.extractTypeAliasDefinition(typeAlias, snapshotId, filePath));
    });

    // Extract classes
    sourceFile.getClasses().forEach(classDecl => {
      typeDefinitions.push(this.extractClassDefinition(classDecl, snapshotId, filePath));
    });

    // Extract enums
    sourceFile.getEnums().forEach(enumDecl => {
      typeDefinitions.push(this.extractEnumDefinition(enumDecl, snapshotId, filePath));
    });

    // Extract modules/namespaces
    sourceFile.getModules().forEach(moduleDecl => {
      typeDefinitions.push(this.extractNamespaceDefinition(moduleDecl, snapshotId, filePath));
    });

    return typeDefinitions;
  }

  /**
   * Calculate metrics for a type definition
   */
  calculateTypeMetrics(typeDefinition: TypeDefinition): TypeMetrics {
    // Implementation will depend on the specific type kind
    switch (typeDefinition.kind) {
      case 'interface':
        return this.calculateInterfaceMetrics(typeDefinition);
      case 'class':
        return this.calculateClassMetrics(typeDefinition);
      case 'type_alias':
        return this.calculateTypeAliasMetrics(typeDefinition);
      case 'enum':
        return this.calculateEnumMetrics(typeDefinition);
      case 'namespace':
        return this.calculateNamespaceMetrics(typeDefinition);
      default:
        return this.getDefaultMetrics();
    }
  }

  /**
   * Extract interface definition information
   */
  private extractInterfaceDefinition(
    interfaceDecl: InterfaceDeclaration, 
    snapshotId: string, 
    filePath: string
  ): TypeDefinition {
    const name = interfaceDecl.getName();
    const typeParameters = interfaceDecl.getTypeParameters();
    
    return {
      id: uuidv4(),
      snapshotId,
      name,
      kind: 'interface',
      filePath,
      startLine: interfaceDecl.getStartLineNumber(),
      endLine: interfaceDecl.getEndLineNumber(),
      startColumn: interfaceDecl.getStart() - interfaceDecl.getStartLinePos(),
      endColumn: interfaceDecl.getEnd() - interfaceDecl.getStartLinePos(),
      
      isAbstract: false, // Interfaces are inherently abstract
      isExported: interfaceDecl.hasExportKeyword(),
      isDefaultExport: interfaceDecl.hasDefaultKeyword(),
      isGeneric: typeParameters.length > 0,
      genericParameters: typeParameters.map(tp => tp.getName()),
      
      typeText: interfaceDecl.getText(),
      
      modifiers: this.extractModifiers(interfaceDecl),
      jsdoc: this.extractJSDoc(interfaceDecl),
      metadata: {
        propertyCount: interfaceDecl.getProperties().length,
        methodCount: interfaceDecl.getMethods().length,
        extendsCount: interfaceDecl.getExtends().length
      }
    };
  }

  /**
   * Extract type alias definition information
   */
  private extractTypeAliasDefinition(
    typeAlias: TypeAliasDeclaration, 
    snapshotId: string, 
    filePath: string
  ): TypeDefinition {
    const name = typeAlias.getName();
    const typeParameters = typeAlias.getTypeParameters();
    
    return {
      id: uuidv4(),
      snapshotId,
      name,
      kind: 'type_alias',
      filePath,
      startLine: typeAlias.getStartLineNumber(),
      endLine: typeAlias.getEndLineNumber(),
      startColumn: typeAlias.getStart() - typeAlias.getStartLinePos(),
      endColumn: typeAlias.getEnd() - typeAlias.getStartLinePos(),
      
      isAbstract: false,
      isExported: typeAlias.hasExportKeyword(),
      isDefaultExport: typeAlias.hasDefaultKeyword(),
      isGeneric: typeParameters.length > 0,
      genericParameters: typeParameters.map(tp => tp.getName()),
      
      typeText: typeAlias.getText(),
      resolvedType: this.analyzeTypeNode(typeAlias.getTypeNodeOrThrow()),
      
      modifiers: this.extractModifiers(typeAlias),
      jsdoc: this.extractJSDoc(typeAlias),
      metadata: {
        typeNodeKind: typeAlias.getTypeNodeOrThrow().getKindName()
      }
    };
  }

  /**
   * Extract class definition information
   */
  private extractClassDefinition(
    classDecl: ClassDeclaration, 
    snapshotId: string, 
    filePath: string
  ): TypeDefinition {
    const name = classDecl.getName() || 'Anonymous';
    const typeParameters = classDecl.getTypeParameters();
    
    return {
      id: uuidv4(),
      snapshotId,
      name,
      kind: 'class',
      filePath,
      startLine: classDecl.getStartLineNumber(),
      endLine: classDecl.getEndLineNumber(),
      startColumn: classDecl.getStart() - classDecl.getStartLinePos(),
      endColumn: classDecl.getEnd() - classDecl.getStartLinePos(),
      
      isAbstract: !!classDecl.getAbstractKeyword(),
      isExported: classDecl.hasExportKeyword(),
      isDefaultExport: classDecl.hasDefaultKeyword(),
      isGeneric: typeParameters.length > 0,
      genericParameters: typeParameters.map(tp => tp.getName()),
      
      typeText: classDecl.getText(),
      
      modifiers: this.extractModifiers(classDecl),
      jsdoc: this.extractJSDoc(classDecl),
      metadata: {
        propertyCount: classDecl.getProperties().length,
        methodCount: classDecl.getMethods().length,
        constructorCount: classDecl.getConstructors().length,
        extendsClause: classDecl.getExtends()?.getText(),
        implementsCount: classDecl.getImplements().length
      }
    };
  }

  /**
   * Extract enum definition information
   */
  private extractEnumDefinition(
    enumDecl: EnumDeclaration, 
    snapshotId: string, 
    filePath: string
  ): TypeDefinition {
    const name = enumDecl.getName();
    
    return {
      id: uuidv4(),
      snapshotId,
      name,
      kind: 'enum',
      filePath,
      startLine: enumDecl.getStartLineNumber(),
      endLine: enumDecl.getEndLineNumber(),
      startColumn: enumDecl.getStart() - enumDecl.getStartLinePos(),
      endColumn: enumDecl.getEnd() - enumDecl.getStartLinePos(),
      
      isAbstract: false,
      isExported: enumDecl.hasExportKeyword(),
      isDefaultExport: enumDecl.hasDefaultKeyword(),
      isGeneric: false, // Enums cannot be generic
      genericParameters: [],
      
      typeText: enumDecl.getText(),
      
      modifiers: this.extractModifiers(enumDecl),
      jsdoc: this.extractJSDoc(enumDecl),
      metadata: {
        memberCount: enumDecl.getMembers().length,
        isConst: !!enumDecl.getConstKeyword()
      }
    };
  }

  /**
   * Extract namespace/module definition information
   */
  private extractNamespaceDefinition(
    moduleDecl: ModuleDeclaration, 
    snapshotId: string, 
    filePath: string
  ): TypeDefinition {
    const name = moduleDecl.getName();
    
    return {
      id: uuidv4(),
      snapshotId,
      name,
      kind: 'namespace',
      filePath,
      startLine: moduleDecl.getStartLineNumber(),
      endLine: moduleDecl.getEndLineNumber(),
      startColumn: moduleDecl.getStart() - moduleDecl.getStartLinePos(),
      endColumn: moduleDecl.getEnd() - moduleDecl.getStartLinePos(),
      
      isAbstract: false,
      isExported: moduleDecl.hasExportKeyword(),
      isDefaultExport: moduleDecl.hasDefaultKeyword(),
      isGeneric: false, // Namespaces cannot be generic
      genericParameters: [],
      
      typeText: moduleDecl.getText(),
      
      modifiers: this.extractModifiers(moduleDecl),
      jsdoc: this.extractJSDoc(moduleDecl),
      metadata: {
        moduleKeyword: moduleDecl.hasModuleKeyword()
      }
    };
  }

  /**
   * Analyze type node structure for metrics calculation
   */
  private analyzeTypeNode(typeNode: TypeNode): Record<string, unknown> {
    return {
      kind: typeNode.getKindName(),
      text: typeNode.getText(),
      // Additional analysis can be added here
    };
  }

  /**
   * Extract modifiers from a declaration
   */
  private extractModifiers(node: Node): string[] {
    const modifiers: string[] = [];
    
    if (Node.isModifierable(node)) {
      node.getModifiers().forEach(modifier => {
        modifiers.push(modifier.getText());
      });
    }
    
    return modifiers;
  }

  /**
   * Extract JSDoc comments from a declaration
   */
  private extractJSDoc(node: Node): string | undefined {
    // Simple JSDoc extraction approach for ts-morph compatibility
    const text = node.getFullText();
    const jsDocMatch = text.match(/\/\*\*[\s\S]*?\*\//);
    return jsDocMatch ? jsDocMatch[0] : undefined;
  }

  /**
   * Calculate metrics for interface types
   */
  private calculateInterfaceMetrics(typeDefinition: TypeDefinition): TypeMetrics {
    // Basic implementation - can be enhanced with actual AST analysis
    const metadata = typeDefinition.metadata as Record<string, unknown>;
    return {
      fieldCount: ((metadata['propertyCount'] as number) || 0) + ((metadata['methodCount'] as number) || 0),
      nestingDepth: this.calculateNestingDepth(typeDefinition.typeText),
      genericParameterCount: typeDefinition.genericParameters.length,
      unionMemberCount: 0, // Interfaces don't have unions directly
      intersectionMemberCount: (metadata['extendsCount'] as number) || 0,
      literalTypeCount: this.countLiteralTypes(typeDefinition.typeText),
      discriminantCaseCount: 0 // Would need deeper analysis
    };
  }

  /**
   * Calculate metrics for class types
   */
  private calculateClassMetrics(typeDefinition: TypeDefinition): TypeMetrics {
    const metadata = typeDefinition.metadata as Record<string, unknown>;
    return {
      fieldCount: ((metadata['propertyCount'] as number) || 0) + ((metadata['methodCount'] as number) || 0),
      nestingDepth: this.calculateNestingDepth(typeDefinition.typeText),
      genericParameterCount: typeDefinition.genericParameters.length,
      unionMemberCount: 0, // Classes don't have unions directly
      intersectionMemberCount: (metadata['implementsCount'] as number) || 0,
      literalTypeCount: this.countLiteralTypes(typeDefinition.typeText),
      discriminantCaseCount: 0
    };
  }

  /**
   * Calculate metrics for type alias types
   */
  private calculateTypeAliasMetrics(typeDefinition: TypeDefinition): TypeMetrics {
    return {
      fieldCount: 0, // Type aliases don't have fields directly
      nestingDepth: this.calculateNestingDepth(typeDefinition.typeText),
      genericParameterCount: typeDefinition.genericParameters.length,
      unionMemberCount: this.countUnionMembers(typeDefinition.typeText),
      intersectionMemberCount: this.countIntersectionMembers(typeDefinition.typeText),
      literalTypeCount: this.countLiteralTypes(typeDefinition.typeText),
      discriminantCaseCount: this.countDiscriminantCases(typeDefinition.typeText)
    };
  }

  /**
   * Calculate metrics for enum types
   */
  private calculateEnumMetrics(typeDefinition: TypeDefinition): TypeMetrics {
    const metadata = typeDefinition.metadata as Record<string, unknown>;
    return {
      fieldCount: (metadata['memberCount'] as number) || 0,
      nestingDepth: 1, // Enums are flat
      genericParameterCount: 0, // Enums cannot be generic
      unionMemberCount: (metadata['memberCount'] as number) || 0, // Each enum member is like a union case
      intersectionMemberCount: 0,
      literalTypeCount: (metadata['memberCount'] as number) || 0, // Each member is a literal
      discriminantCaseCount: (metadata['memberCount'] as number) || 0
    };
  }

  /**
   * Calculate metrics for namespace types
   */
  private calculateNamespaceMetrics(typeDefinition: TypeDefinition): TypeMetrics {
    return {
      fieldCount: 0, // Namespaces contain various declarations
      nestingDepth: this.calculateNestingDepth(typeDefinition.typeText),
      genericParameterCount: 0, // Namespaces cannot be generic
      unionMemberCount: 0,
      intersectionMemberCount: 0,
      literalTypeCount: 0,
      discriminantCaseCount: 0
    };
  }

  /**
   * Get default metrics for unknown type kinds
   */
  private getDefaultMetrics(): TypeMetrics {
    return {
      fieldCount: 0,
      nestingDepth: 0,
      genericParameterCount: 0,
      unionMemberCount: 0,
      intersectionMemberCount: 0,
      literalTypeCount: 0,
      discriminantCaseCount: 0
    };
  }

  /**
   * Calculate nesting depth in type text (simple heuristic)
   */
  private calculateNestingDepth(typeText: string): number {
    let maxDepth = 0;
    let currentDepth = 0;
    
    for (const char of typeText) {
      if (char === '<' || char === '{' || char === '[') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (char === '>' || char === '}' || char === ']') {
        currentDepth--;
      }
    }
    
    return maxDepth;
  }

  /**
   * Count union members (simple heuristic)
   */
  private countUnionMembers(typeText: string): number {
    // Simple count of | operators (may not be fully accurate)
    const matches = typeText.match(/\s*\|\s*/g);
    return matches ? matches.length + 1 : 0;
  }

  /**
   * Count intersection members (simple heuristic)
   */
  private countIntersectionMembers(typeText: string): number {
    // Simple count of & operators (may not be fully accurate)
    const matches = typeText.match(/\s*&\s*/g);
    return matches ? matches.length + 1 : 0;
  }

  /**
   * Count literal types (simple heuristic)
   */
  private countLiteralTypes(typeText: string): number {
    // Count string and number literals
    const stringLiterals = typeText.match(/['"`][^'"`]*['"`]/g) || [];
    const numberLiterals = typeText.match(/\b\d+(\.\d+)?\b/g) || [];
    return stringLiterals.length + numberLiterals.length;
  }

  /**
   * Count discriminant cases (simple heuristic)
   */
  private countDiscriminantCases(typeText: string): number {
    // This is a very simplified approach - would need AST analysis for accuracy
    const discriminantPattern = /\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*:\s*['"`][^'"`]*['"`]/g;
    const matches = typeText.match(discriminantPattern);
    return matches ? matches.length : 0;
  }
}
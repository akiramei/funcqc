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
import { ASTTypeMetrics } from './ast-type-metrics';

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
  resolvedType?: string | { kind: string; text: string; [key: string]: unknown };
  
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
 * Analyzes TypeScript type definitions and extracts structural information.
 * Provides comprehensive type analysis including metrics calculation and dependency tracking.
 * 
 * @example
 * ```ts
 * const analyzer = new TypeAnalyzer(project);
 * const types = analyzer.analyzeFile('src/types.ts', snapshotId);
 * const metrics = analyzer.calculateTypeMetrics(types[0]);
 * ```
 */
export class TypeAnalyzer {
  private astMetrics: ASTTypeMetrics;

  constructor(private project: Project) {
    this.astMetrics = new ASTTypeMetrics(project);
  }

  /**
   * Analyze a TypeScript file to extract type definitions.
   * 
   * @param filePath - Absolute path to the TypeScript file to analyze
   * @param snapshotId - Unique identifier for the analysis snapshot
   * @returns Array of type definitions found in the file
   * @throws {Error} When the source file cannot be found or loaded
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
   * Calculate comprehensive metrics for a type definition using AST-based analysis.
   * This replaces the previous string-based parsing with proper TypeScript AST traversal.
   * 
   * @param typeDefinition - The type definition to analyze
   * @returns Calculated metrics including field count, nesting depth, etc.
   */
  calculateTypeMetrics(typeDefinition: TypeDefinition): TypeMetrics {
    try {
      // Use AST-based analysis for accurate metrics calculation
      return this.astMetrics.calculateMetrics(typeDefinition);
    } catch {
      // Fallback to default metrics if AST analysis fails
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
      resolvedType: this.analyzeTypeNode(typeAlias.getTypeNodeOrThrow()) as string | { kind: string; text: string; [key: string]: unknown },
      
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
   * Get default metrics for fallback cases
   * Note: The old string-based metric calculation methods have been replaced
   * by AST-based analysis in ASTTypeMetrics class for better accuracy.
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
}
import {
  Project,
  Node,
  InterfaceDeclaration,
  TypeAliasDeclaration,
  ClassDeclaration,
  TypeNode,
  MethodSignature,
  MethodDeclaration
} from 'ts-morph';
import { v4 as uuidv4 } from 'uuid';
import { TypeDefinition } from './type-analyzer';
import { TypeSCCAnalyzer } from './type-scc-analyzer';

export interface TypeDependency {
  id: string;
  snapshotId: string;
  sourceTypeId: string;
  targetTypeId?: string;
  targetTypeName: string;
  dependencyKind: 'extends' | 'implements' | 'property' | 'parameter' | 'return' | 'generic_constraint' | 'union_member' | 'intersection_member';
  filePath: string;
  lineNumber?: number;
  metadata: Record<string, unknown>;
}

export interface TypeUsageInfo {
  typeId: string;
  usageCount: number;
  usedInFiles: string[];
  usedByTypes: string[];
  dependencyChain: string[];
}

export interface CircularDependency {
  typeIds: string[];
  typeNames: string[];
  dependencyPath: TypeDependency[];
  severity: 'warning' | 'error';
}

/**
 * Analyzes dependencies between TypeScript types
 */
export class TypeDependencyAnalyzer {
  private typeDefinitions: Map<string, TypeDefinition> = new Map();
  private typeDefinitionsById: Map<string, TypeDefinition> = new Map();

  constructor(private project: Project) {}

  /**
   * Set the type definitions context for dependency analysis
   */
  setTypeDefinitions(typeDefinitions: TypeDefinition[]): void {
    this.typeDefinitions.clear();
    this.typeDefinitionsById.clear();
    typeDefinitions.forEach(typeDef => {
      this.typeDefinitions.set(typeDef.name, typeDef);
      this.typeDefinitionsById.set(typeDef.id, typeDef);
    });
  }

  /**
   * Analyze type dependencies in a source file
   */
  analyzeDependencies(filePath: string, snapshotId: string): TypeDependency[] {
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) {
      throw new Error(`Source file not found: ${filePath}`);
    }

    const dependencies: TypeDependency[] = [];

    // Analyze interfaces
    sourceFile.getInterfaces().forEach(interfaceDecl => {
      dependencies.push(...this.analyzeInterfaceDependencies(interfaceDecl, snapshotId, filePath));
    });

    // Analyze type aliases
    sourceFile.getTypeAliases().forEach(typeAlias => {
      dependencies.push(...this.analyzeTypeAliasDependencies(typeAlias, snapshotId, filePath));
    });

    // Analyze classes
    sourceFile.getClasses().forEach(classDecl => {
      dependencies.push(...this.analyzeClassDependencies(classDecl, snapshotId, filePath));
    });

    return dependencies;
  }

  /**
   * Detect circular dependencies among types using Tarjan's algorithm
   */
  detectCircularDependencies(dependencies: TypeDependency[]): CircularDependency[] {
    // Filter and enhance dependencies with targetTypeId
    const enhancedDependencies: TypeDependency[] = [];
    
    for (const dep of dependencies) {
      const targetTypeId = dep.targetTypeId || this.getTypeIdFromName(dep.targetTypeName);
      if (targetTypeId) {
        enhancedDependencies.push({
          ...dep,
          targetTypeId
        });
      }
    }

    // Use Tarjan's algorithm via TypeSCCAnalyzer
    const sccAnalyzer = new TypeSCCAnalyzer();
    
    // Build type name mapping for better display
    const typeNameMapping = new Map<string, string>();
    for (const [name, typeDef] of this.typeDefinitions) {
      typeNameMapping.set(typeDef.id, name);
    }
    
    const sccResult = sccAnalyzer.findStronglyConnectedComponents(
      enhancedDependencies,
      typeNameMapping
    );

    return sccResult.circularDependencies;
  }

  /**
   * Calculate usage information for each type
   */
  calculateTypeUsage(dependencies: TypeDependency[]): Map<string, TypeUsageInfo> {
    const usageMap = new Map<string, TypeUsageInfo>();

    // Initialize usage info for all types
    this.typeDefinitions.forEach((typeDef, _typeName) => {
      usageMap.set(typeDef.id, {
        typeId: typeDef.id,
        usageCount: 0,
        usedInFiles: [],
        usedByTypes: [],
        dependencyChain: []
      });
    });

    // Count dependencies (incoming edges = usage count)
    dependencies.forEach(dep => {
      const targetTypeDef = this.typeDefinitions.get(dep.targetTypeName);
      
      if (targetTypeDef && usageMap.has(targetTypeDef.id)) {
        const usage = usageMap.get(targetTypeDef.id)!;
        usage.usageCount++;
        
        if (!usage.usedInFiles.includes(dep.filePath)) {
          usage.usedInFiles.push(dep.filePath);
        }
        
        if (!usage.usedByTypes.includes(dep.sourceTypeId)) {
          usage.usedByTypes.push(dep.sourceTypeId);
        }
      }
    });

    return usageMap;
  }

  /**
   * Analyze interface dependencies
   */
  private analyzeInterfaceDependencies(
    interfaceDecl: InterfaceDeclaration,
    snapshotId: string,
    filePath: string
  ): TypeDependency[] {
    const dependencies: TypeDependency[] = [];
    const sourceName = interfaceDecl.getName();
    const sourceTypeDef = this.typeDefinitions.get(sourceName);
    
    if (!sourceTypeDef) return dependencies;

    // Extends dependencies
    interfaceDecl.getExtends().forEach(extendsClause => {
      const targetTypeName = this.extractTypeNameFromNode(extendsClause.getExpression());
      dependencies.push({
        id: uuidv4(),
        snapshotId,
        sourceTypeId: sourceTypeDef.id,
        targetTypeName,
        dependencyKind: 'extends',
        filePath,
        lineNumber: extendsClause.getStartLineNumber(),
        metadata: { clause: extendsClause.getText() }
      });
    });

    // Property type dependencies
    interfaceDecl.getProperties().forEach(prop => {
      const typeNode = prop.getTypeNode();
      if (typeNode) {
        const propDependencies = this.extractTypeNamesFromTypeNode(typeNode);
        propDependencies.forEach(targetTypeName => {
          dependencies.push({
            id: uuidv4(),
            snapshotId,
            sourceTypeId: sourceTypeDef.id,
            targetTypeName,
            dependencyKind: 'property',
            filePath,
            lineNumber: prop.getStartLineNumber(),
            metadata: { 
              propertyName: prop.getName(),
              propertyType: typeNode.getText() 
            }
          });
        });
      }
    });

    // Method dependencies
    interfaceDecl.getMethods().forEach(method => {
      dependencies.push(...this.analyzeMethodDependencies(
        method, sourceTypeDef.id, snapshotId, filePath
      ));
    });

    return dependencies;
  }

  /**
   * Analyze type alias dependencies
   */
  private analyzeTypeAliasDependencies(
    typeAlias: TypeAliasDeclaration,
    snapshotId: string,
    filePath: string
  ): TypeDependency[] {
    const dependencies: TypeDependency[] = [];
    const sourceName = typeAlias.getName();
    const sourceTypeDef = this.typeDefinitions.get(sourceName);
    
    if (!sourceTypeDef) return dependencies;

    const typeNode = typeAlias.getTypeNode();
    if (typeNode) {
      const dependentTypes = this.extractTypeNamesFromTypeNode(typeNode);

      dependentTypes.forEach(targetTypeName => {
        const dependencyKind = this.determineDependencyKind(typeNode, targetTypeName);
        
        dependencies.push({
          id: uuidv4(),
          snapshotId,
          sourceTypeId: sourceTypeDef.id,
          targetTypeName,
          dependencyKind,
          filePath,
          lineNumber: typeNode.getStartLineNumber(),
          metadata: { 
            typeText: typeNode.getText(),
            typeKind: typeNode.getKindName()
          }
        });
      });
    }

    return dependencies;
  }

  /**
   * Analyze class dependencies
   */
  private analyzeClassDependencies(
    classDecl: ClassDeclaration,
    snapshotId: string,
    filePath: string
  ): TypeDependency[] {
    const dependencies: TypeDependency[] = [];
    const sourceName = classDecl.getName();
    if (!sourceName) return dependencies;
    
    const sourceTypeDef = this.typeDefinitions.get(sourceName);
    if (!sourceTypeDef) return dependencies;

    // Extends dependencies
    const extendsClause = classDecl.getExtends();
    if (extendsClause) {
      const targetTypeName = this.extractTypeNameFromNode(extendsClause.getExpression());
      dependencies.push({
        id: uuidv4(),
        snapshotId,
        sourceTypeId: sourceTypeDef.id,
        targetTypeName,
        dependencyKind: 'extends',
        filePath,
        lineNumber: extendsClause.getStartLineNumber(),
        metadata: { clause: extendsClause.getText() }
      });
    }

    // Implements dependencies
    classDecl.getImplements().forEach(implementsClause => {
      const targetTypeName = this.extractTypeNameFromNode(implementsClause.getExpression());
      dependencies.push({
        id: uuidv4(),
        snapshotId,
        sourceTypeId: sourceTypeDef.id,
        targetTypeName,
        dependencyKind: 'implements',
        filePath,
        lineNumber: implementsClause.getStartLineNumber(),
        metadata: { clause: implementsClause.getText() }
      });
    });

    // Property dependencies
    classDecl.getProperties().forEach(prop => {
      const typeNode = prop.getTypeNode();
      if (typeNode) {
        const propDependencies = this.extractTypeNamesFromTypeNode(typeNode);
        propDependencies.forEach(targetTypeName => {
          dependencies.push({
            id: uuidv4(),
            snapshotId,
            sourceTypeId: sourceTypeDef.id,
            targetTypeName,
            dependencyKind: 'property',
            filePath,
            lineNumber: prop.getStartLineNumber(),
            metadata: {
              propertyName: prop.getName(),
              propertyType: typeNode.getText()
            }
          });
        });
      }
    });

    // Method dependencies
    classDecl.getMethods().forEach(method => {
      dependencies.push(...this.analyzeMethodDependencies(
        method, sourceTypeDef.id, snapshotId, filePath
      ));
    });

    return dependencies;
  }

  /**
   * Analyze method dependencies (parameters and return type)
   */
  private analyzeMethodDependencies(
    method: MethodSignature | MethodDeclaration,
    sourceTypeId: string,
    snapshotId: string,
    filePath: string
  ): TypeDependency[] {
    const dependencies: TypeDependency[] = [];

    // Parameter dependencies
    method.getParameters().forEach(param => {
      const typeNode = param.getTypeNode();
      if (typeNode) {
        const paramTypes = this.extractTypeNamesFromTypeNode(typeNode);
        paramTypes.forEach(targetTypeName => {
          dependencies.push({
            id: uuidv4(),
            snapshotId,
            sourceTypeId,
            targetTypeName,
            dependencyKind: 'parameter',
            filePath,
            lineNumber: param.getStartLineNumber(),
            metadata: {
              methodName: method.getName?.() || 'anonymous',
              parameterName: param.getName(),
              parameterType: typeNode.getText()
            }
          });
        });
      }
    });

    // Return type dependencies
    const returnTypeNode = method.getReturnTypeNode();
    if (returnTypeNode) {
      const returnTypes = this.extractTypeNamesFromTypeNode(returnTypeNode);
      returnTypes.forEach(targetTypeName => {
        dependencies.push({
          id: uuidv4(),
          snapshotId,
          sourceTypeId,
          targetTypeName,
          dependencyKind: 'return',
          filePath,
          lineNumber: returnTypeNode.getStartLineNumber(),
          metadata: {
            methodName: method.getName?.() || 'anonymous',
            returnType: returnTypeNode.getText()
          }
        });
      });
    }

    return dependencies;
  }

  /**
   * Extract type names from a type node
   */
  private extractTypeNamesFromTypeNode(typeNode: TypeNode | undefined): string[] {
    if (!typeNode) return [];

    const typeNames = new Set<string>();

    // Extract direct type reference
    if (Node.isTypeReference(typeNode)) {
      typeNames.add(typeNode.getTypeName().getText());
    }

    // Recursively extract type names from descendants
    typeNode.forEachDescendant((node) => {
      if (Node.isTypeReference(node)) {
        const typeName = node.getTypeName().getText();
        if (this.typeDefinitions.has(typeName)) {
          typeNames.add(typeName);
        }
      }
    });

    return Array.from(typeNames);
  }

  /**
   * Extract type name from a Node (used for extends/implements clauses)
   */
  private extractTypeNameFromNode(node: Node): string {
    if (Node.isIdentifier(node)) {
      return node.getText();
    } else if (Node.isPropertyAccessExpression(node)) {
      // Handle qualified names like Module.Type
      return node.getText();
    } else {
      return node.getText();
    }
  }

  /**
   * Determine the kind of dependency based on context
   */
  private determineDependencyKind(
    typeNode: TypeNode, 
    _targetTypeName: string
  ): TypeDependency['dependencyKind'] {
    if (Node.isUnionTypeNode(typeNode)) {
      return 'union_member';
    } else if (Node.isIntersectionTypeNode(typeNode)) {
      return 'intersection_member';
    } else {
      return 'property';
    }
  }

  /**
   * Calculate condensation graph (DAG of type SCCs)
   */
  calculateCondensationGraph(dependencies: TypeDependency[]): {
    nodes: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    edges: Array<{ from: string; to: string; count: number }>;
  } {
    // Filter and enhance dependencies with targetTypeId
    const enhancedDependencies: TypeDependency[] = [];
    
    for (const dep of dependencies) {
      const targetTypeId = dep.targetTypeId || this.getTypeIdFromName(dep.targetTypeName);
      if (targetTypeId) {
        enhancedDependencies.push({
          ...dep,
          targetTypeId
        });
      }
    }

    const sccAnalyzer = new TypeSCCAnalyzer();
    return sccAnalyzer.calculateCondensationGraph(enhancedDependencies);
  }

  /**
   * Get type ID from type name (helper method)
   */
  private getTypeIdFromName(typeName: string): string | undefined {
    const typeDef = this.typeDefinitions.get(typeName);
    return typeDef?.id;
  }
}
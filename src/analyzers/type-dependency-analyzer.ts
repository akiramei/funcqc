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

  constructor(private project: Project) {}

  /**
   * Set the type definitions context for dependency analysis
   */
  setTypeDefinitions(typeDefinitions: TypeDefinition[]): void {
    this.typeDefinitions.clear();
    typeDefinitions.forEach(typeDef => {
      this.typeDefinitions.set(typeDef.name, typeDef);
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
   * Detect circular dependencies among types
   */
  detectCircularDependencies(dependencies: TypeDependency[]): CircularDependency[] {
    const dependencyGraph = this.buildDependencyGraph(dependencies);
    const circularDependencies: CircularDependency[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    for (const typeId of dependencyGraph.keys()) {
      if (!visited.has(typeId)) {
        const cycle = this.findCycleInDependencyGraph(
          typeId, 
          dependencyGraph, 
          visited, 
          recursionStack, 
          [],
          dependencies
        );
        if (cycle) {
          circularDependencies.push(cycle);
        }
      }
    }

    return circularDependencies;
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
      const targetTypeDef = Array.from(this.typeDefinitions.values())
        .find(def => def.name === dep.targetTypeName);
      
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

    const typeNames: string[] = [];

    // Simple implementation - can be enhanced for complex type structures
    const typeText = typeNode.getText();
    
    // Extract type references
    if (Node.isTypeReference(typeNode)) {
      typeNames.push(typeNode.getTypeName().getText());
    }

    // For union types, intersection types, etc., we'd need more sophisticated parsing
    // This is a simplified version that looks for basic type references
    const typeReferencePattern = /\b[A-Z][a-zA-Z0-9_]*\b/g;
    const matches = typeText.match(typeReferencePattern);
    if (matches) {
      matches.forEach(match => {
        if (!typeNames.includes(match) && this.typeDefinitions.has(match)) {
          typeNames.push(match);
        }
      });
    }

    return typeNames;
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
    const typeText = typeNode.getText();
    
    if (typeText.includes(' | ')) {
      return 'union_member';
    } else if (typeText.includes(' & ')) {
      return 'intersection_member';
    } else {
      return 'property'; // Default for type aliases
    }
  }

  /**
   * Build a dependency graph for circular dependency detection
   */
  private buildDependencyGraph(dependencies: TypeDependency[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    dependencies.forEach(dep => {
      if (!graph.has(dep.sourceTypeId)) {
        graph.set(dep.sourceTypeId, []);
      }
      
      const targetTypeDef = Array.from(this.typeDefinitions.values())
        .find(def => def.name === dep.targetTypeName);
      
      if (targetTypeDef) {
        graph.get(dep.sourceTypeId)!.push(targetTypeDef.id);
      }
    });

    return graph;
  }

  /**
   * Find cycles in the dependency graph using DFS
   */
  private findCycleInDependencyGraph(
    typeId: string,
    graph: Map<string, string[]>,
    visited: Set<string>,
    recursionStack: Set<string>,
    currentPath: string[],
    allDependencies: TypeDependency[]
  ): CircularDependency | null {
    visited.add(typeId);
    recursionStack.add(typeId);
    currentPath.push(typeId);

    const neighbors = graph.get(typeId) || [];
    for (const neighborId of neighbors) {
      if (!visited.has(neighborId)) {
        const cycle = this.findCycleInDependencyGraph(
          neighborId, graph, visited, recursionStack, currentPath, allDependencies
        );
        if (cycle) return cycle;
      } else if (recursionStack.has(neighborId)) {
        // Found a cycle
        const cycleStartIndex = currentPath.indexOf(neighborId);
        const cycleTypeIds = currentPath.slice(cycleStartIndex);
        cycleTypeIds.push(neighborId); // Complete the cycle

        const cycleTypeNames = cycleTypeIds.map(id => {
          const typeDef = Array.from(this.typeDefinitions.values())
            .find(def => def.id === id);
          return typeDef?.name || 'Unknown';
        });

        const dependencyPath = this.findDependencyPath(cycleTypeIds, allDependencies);

        return {
          typeIds: cycleTypeIds,
          typeNames: cycleTypeNames,
          dependencyPath,
          severity: cycleTypeIds.length > 3 ? 'error' : 'warning'
        };
      }
    }

    currentPath.pop();
    recursionStack.delete(typeId);
    return null;
  }

  /**
   * Find the dependency path for a cycle
   */
  private findDependencyPath(cycleTypeIds: string[], allDependencies: TypeDependency[]): TypeDependency[] {
    const path: TypeDependency[] = [];
    
    for (let i = 0; i < cycleTypeIds.length - 1; i++) {
      const sourceId = cycleTypeIds[i];
      const targetId = cycleTypeIds[i + 1];
      
      const dependency = allDependencies.find(dep => 
        dep.sourceTypeId === sourceId && 
        this.getTypeIdFromName(dep.targetTypeName) === targetId
      );
      
      if (dependency) {
        path.push(dependency);
      }
    }
    
    return path;
  }

  /**
   * Get type ID from type name (helper method)
   */
  private getTypeIdFromName(typeName: string): string | undefined {
    const typeDef = this.typeDefinitions.get(typeName);
    return typeDef?.id;
  }
}
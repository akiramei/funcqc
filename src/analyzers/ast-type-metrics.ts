import {
  Project,
  Node,
  InterfaceDeclaration,
  TypeAliasDeclaration,
  ClassDeclaration,
  EnumDeclaration,
  TypeNode,
  SyntaxKind
} from 'ts-morph';
import { TypeDefinition, TypeMetrics } from './type-analyzer';

/**
 * AST-based type metrics calculator that replaces string-based parsing
 * with proper TypeScript AST analysis for accurate metric calculation.
 * 
 * This addresses the mathematical expert's feedback about string-based
 * union/intersection counting being prone to errors.
 */
export class ASTTypeMetrics {
  private memoizedAnalysis = new WeakMap<any, any>(); // eslint-disable-line @typescript-eslint/no-explicit-any

  constructor(private project: Project) {}

  /**
   * Calculate comprehensive AST-based metrics for a type definition
   */
  calculateMetrics(typeDefinition: TypeDefinition): TypeMetrics {
    const sourceFile = this.project.getSourceFile(typeDefinition.filePath);
    if (!sourceFile) {
      return this.getDefaultMetrics();
    }

    // Find the actual AST node for this type definition
    const typeNode = this.findTypeNode(sourceFile, typeDefinition);
    if (!typeNode) {
      return this.getDefaultMetrics();
    }

    return this.calculateASTMetrics(typeNode, typeDefinition);
  }

  /**
   * Find the TypeScript AST node corresponding to a type definition
   */
  private findTypeNode(sourceFile: any, typeDefinition: TypeDefinition): Node | undefined { // eslint-disable-line @typescript-eslint/no-explicit-any
    const targetLine = typeDefinition.startLine;
    
    switch (typeDefinition.kind) {
      case 'interface':
        return sourceFile.getInterfaces().find((node: InterfaceDeclaration) => 
          node.getStartLineNumber() === targetLine && node.getName() === typeDefinition.name
        );
      
      case 'type_alias':
        return sourceFile.getTypeAliases().find((node: TypeAliasDeclaration) => 
          node.getStartLineNumber() === targetLine && node.getName() === typeDefinition.name
        );
      
      case 'class':
        return sourceFile.getClasses().find((node: ClassDeclaration) => 
          node.getStartLineNumber() === targetLine && node.getName() === typeDefinition.name
        );
      
      case 'enum':
        return sourceFile.getEnums().find((node: EnumDeclaration) => 
          node.getStartLineNumber() === targetLine && node.getName() === typeDefinition.name
        );
      
      default:
        return undefined;
    }
  }

  /**
   * Calculate metrics using proper AST traversal
   */
  private calculateASTMetrics(node: Node, typeDefinition: TypeDefinition): TypeMetrics {
    switch (typeDefinition.kind) {
      case 'interface':
        return this.calculateInterfaceMetrics(node as InterfaceDeclaration);
      
      case 'type_alias':
        return this.calculateTypeAliasMetrics(node as TypeAliasDeclaration);
      
      case 'class':
        return this.calculateClassMetrics(node as ClassDeclaration);
      
      case 'enum':
        return this.calculateEnumMetrics(node as EnumDeclaration);
      
      default:
        return this.getDefaultMetrics();
    }
  }

  /**
   * Calculate interface metrics using AST analysis
   */
  private calculateInterfaceMetrics(interfaceDecl: InterfaceDeclaration): TypeMetrics {
    const properties = interfaceDecl.getProperties();
    const methods = interfaceDecl.getMethods();
    
    let maxNestingDepth = 1; // Interface itself is depth 1
    let unionMemberCount = 0;
    let intersectionMemberCount = 0;
    let literalTypeCount = 0;
    let discriminantCaseCount = 0;

    // Analyze each property type
    for (const prop of properties) {
      const typeNode = prop.getTypeNode();
      if (typeNode) {
        const typeMetrics = this.analyzeTypeNode(typeNode);
        maxNestingDepth = Math.max(maxNestingDepth, typeMetrics.nestingDepth + 1);
        unionMemberCount += typeMetrics.unionMemberCount;
        intersectionMemberCount += typeMetrics.intersectionMemberCount;
        literalTypeCount += typeMetrics.literalTypeCount;
        discriminantCaseCount += typeMetrics.discriminantCaseCount;
      }
    }

    // Analyze method signatures
    for (const method of methods) {
      const parameters = method.getParameters();
      const returnType = method.getReturnTypeNode();
      
      // Analyze parameter types
      for (const param of parameters) {
        const paramType = param.getTypeNode();
        if (paramType) {
          const typeMetrics = this.analyzeTypeNode(paramType);
          maxNestingDepth = Math.max(maxNestingDepth, typeMetrics.nestingDepth + 1);
          unionMemberCount += typeMetrics.unionMemberCount;
          intersectionMemberCount += typeMetrics.intersectionMemberCount;
          literalTypeCount += typeMetrics.literalTypeCount;
        }
      }
      
      // Analyze return type
      if (returnType) {
        const typeMetrics = this.analyzeTypeNode(returnType);
        maxNestingDepth = Math.max(maxNestingDepth, typeMetrics.nestingDepth + 1);
        unionMemberCount += typeMetrics.unionMemberCount;
        intersectionMemberCount += typeMetrics.intersectionMemberCount;
        literalTypeCount += typeMetrics.literalTypeCount;
      }
    }

    return {
      fieldCount: properties.length,
      nestingDepth: maxNestingDepth,
      genericParameterCount: interfaceDecl.getTypeParameters().length,
      unionMemberCount,
      intersectionMemberCount,
      literalTypeCount,
      discriminantCaseCount
    };
  }

  /**
   * Calculate type alias metrics using AST analysis
   */
  private calculateTypeAliasMetrics(typeAlias: TypeAliasDeclaration): TypeMetrics {
    const typeNode = typeAlias.getTypeNode();
    if (!typeNode) {
      return this.getDefaultMetrics();
    }

    const typeMetrics = this.analyzeTypeNode(typeNode);
    
    return {
      fieldCount: 0, // Type aliases don't have fields directly
      nestingDepth: typeMetrics.nestingDepth,
      genericParameterCount: typeAlias.getTypeParameters().length,
      unionMemberCount: typeMetrics.unionMemberCount,
      intersectionMemberCount: typeMetrics.intersectionMemberCount,
      literalTypeCount: typeMetrics.literalTypeCount,
      discriminantCaseCount: typeMetrics.discriminantCaseCount
    };
  }

  /**
   * Calculate class metrics using AST analysis
   */
  private calculateClassMetrics(classDecl: ClassDeclaration): TypeMetrics {
    const properties = classDecl.getProperties();
    const methods = classDecl.getMethods();
    
    let maxNestingDepth = 1;
    let unionMemberCount = 0;
    let intersectionMemberCount = 0;
    let literalTypeCount = 0;
    let discriminantCaseCount = 0;

    // Analyze property types
    for (const prop of properties) {
      const typeNode = prop.getTypeNode();
      if (typeNode) {
        const typeMetrics = this.analyzeTypeNode(typeNode);
        maxNestingDepth = Math.max(maxNestingDepth, typeMetrics.nestingDepth + 1);
        unionMemberCount += typeMetrics.unionMemberCount;
        intersectionMemberCount += typeMetrics.intersectionMemberCount;
        literalTypeCount += typeMetrics.literalTypeCount;
        discriminantCaseCount += typeMetrics.discriminantCaseCount;
      }
    }

    // Analyze method signatures (similar to interface)
    for (const method of methods) {
      const parameters = method.getParameters();
      const returnType = method.getReturnTypeNode();
      
      for (const param of parameters) {
        const paramType = param.getTypeNode();
        if (paramType) {
          const typeMetrics = this.analyzeTypeNode(paramType);
          maxNestingDepth = Math.max(maxNestingDepth, typeMetrics.nestingDepth + 1);
          unionMemberCount += typeMetrics.unionMemberCount;
          intersectionMemberCount += typeMetrics.intersectionMemberCount;
          literalTypeCount += typeMetrics.literalTypeCount;
        }
      }
      
      if (returnType) {
        const typeMetrics = this.analyzeTypeNode(returnType);
        maxNestingDepth = Math.max(maxNestingDepth, typeMetrics.nestingDepth + 1);
        unionMemberCount += typeMetrics.unionMemberCount;
        intersectionMemberCount += typeMetrics.intersectionMemberCount;
        literalTypeCount += typeMetrics.literalTypeCount;
      }
    }

    return {
      fieldCount: properties.length,
      nestingDepth: maxNestingDepth,
      genericParameterCount: classDecl.getTypeParameters().length,
      unionMemberCount,
      intersectionMemberCount,
      literalTypeCount,
      discriminantCaseCount
    };
  }

  /**
   * Calculate enum metrics using AST analysis
   */
  private calculateEnumMetrics(enumDecl: EnumDeclaration): TypeMetrics {
    const members = enumDecl.getMembers();
    
    return {
      fieldCount: members.length,
      nestingDepth: 1, // Enums are flat
      genericParameterCount: 0, // Enums cannot be generic
      unionMemberCount: members.length, // Each enum member is like a union case
      intersectionMemberCount: 0,
      literalTypeCount: members.length, // Each member is a literal
      discriminantCaseCount: members.length
    };
  }

  /**
   * Analyze a TypeNode recursively to extract metrics with memoization
   * This is the core AST-based analysis that replaces string parsing
   */
  private analyzeTypeNode(typeNode: TypeNode, visited = new Set<TypeNode>()): {
    nestingDepth: number;
    unionMemberCount: number;
    intersectionMemberCount: number;
    literalTypeCount: number;
    discriminantCaseCount: number;
  } {
    // Prevent infinite recursion and stack overflow
    if (visited.has(typeNode)) {
      return {
        nestingDepth: 0,
        unionMemberCount: 0,
        intersectionMemberCount: 0,
        literalTypeCount: 0,
        discriminantCaseCount: 0
      };
    }

    // Check memoization cache
    const cached = this.memoizedAnalysis.get(typeNode);
    if (cached) {
      return cached;
    }

    // Add to visited set to prevent cycles
    visited.add(typeNode);
    const result = {
      nestingDepth: 1,
      unionMemberCount: 0,
      intersectionMemberCount: 0,
      literalTypeCount: 0,
      discriminantCaseCount: 0
    };

    // Handle different type node kinds using proper AST analysis
    switch (typeNode.getKind()) {
      case SyntaxKind.UnionType: {
        const unionTypes = Node.isUnionTypeNode(typeNode) ? typeNode.getTypeNodes() : [];
        result.unionMemberCount = unionTypes.length;
        
        // Recursively analyze union members
        for (const unionMember of unionTypes) {
          const childMetrics = this.analyzeTypeNode(unionMember, visited);
          result.nestingDepth = Math.max(result.nestingDepth, childMetrics.nestingDepth + 1);
          result.intersectionMemberCount += childMetrics.intersectionMemberCount;
          result.literalTypeCount += childMetrics.literalTypeCount;
          result.discriminantCaseCount += childMetrics.discriminantCaseCount;
        }
        break;
      }

      case SyntaxKind.IntersectionType: {
        const intersectionTypes = Node.isIntersectionTypeNode(typeNode) ? typeNode.getTypeNodes() : [];
        result.intersectionMemberCount = intersectionTypes.length;
        
        // Recursively analyze intersection members
        for (const intersectionMember of intersectionTypes) {
          const childMetrics = this.analyzeTypeNode(intersectionMember, visited);
          result.nestingDepth = Math.max(result.nestingDepth, childMetrics.nestingDepth + 1);
          result.unionMemberCount += childMetrics.unionMemberCount;
          result.literalTypeCount += childMetrics.literalTypeCount;
          result.discriminantCaseCount += childMetrics.discriminantCaseCount;
        }
        break;
      }

      case SyntaxKind.LiteralType:
        result.literalTypeCount = 1;
        break;

      case SyntaxKind.StringLiteral:
      case SyntaxKind.NumericLiteral:
      case SyntaxKind.TrueKeyword:
      case SyntaxKind.FalseKeyword:
        result.literalTypeCount = 1;
        break;

      case SyntaxKind.TypeLiteral:
        // Object type literal: { prop: type }
        if (Node.isTypeLiteral(typeNode)) {
          const properties = typeNode.getMembers();
          result.nestingDepth = 1;
          
          // Analyze each property type recursively
          for (const prop of properties) {
            if (Node.isPropertySignature(prop)) {
              const propType = prop.getTypeNode();
              if (propType) {
                const childMetrics = this.analyzeTypeNode(propType, visited);
                result.nestingDepth = Math.max(result.nestingDepth, childMetrics.nestingDepth + 1);
                result.unionMemberCount += childMetrics.unionMemberCount;
                result.intersectionMemberCount += childMetrics.intersectionMemberCount;
                result.literalTypeCount += childMetrics.literalTypeCount;
                result.discriminantCaseCount += childMetrics.discriminantCaseCount;
              }
            }
          }
          
          // Check for discriminated union patterns
          result.discriminantCaseCount += this.detectDiscriminatedUnion(properties);
        }
        break;

      case SyntaxKind.ArrayType:
        if (Node.isArrayTypeNode(typeNode)) {
          const elementType = typeNode.getElementTypeNode();
          const childMetrics = this.analyzeTypeNode(elementType, visited);
          result.nestingDepth = childMetrics.nestingDepth + 1;
          result.unionMemberCount += childMetrics.unionMemberCount;
          result.intersectionMemberCount += childMetrics.intersectionMemberCount;
          result.literalTypeCount += childMetrics.literalTypeCount;
          result.discriminantCaseCount += childMetrics.discriminantCaseCount;
        }
        break;

      case SyntaxKind.TupleType:
        if (Node.isTupleTypeNode(typeNode)) {
          const elements = typeNode.getElements();
          for (const element of elements) {
            const childMetrics = this.analyzeTypeNode(element, visited);
            result.nestingDepth = Math.max(result.nestingDepth, childMetrics.nestingDepth + 1);
            result.unionMemberCount += childMetrics.unionMemberCount;
            result.intersectionMemberCount += childMetrics.intersectionMemberCount;
            result.literalTypeCount += childMetrics.literalTypeCount;
            result.discriminantCaseCount += childMetrics.discriminantCaseCount;
          }
        }
        break;

      case SyntaxKind.ParenthesizedType:
        if (Node.isParenthesizedTypeNode(typeNode)) {
          const innerType = typeNode.getTypeNode();
          const childMetrics = this.analyzeTypeNode(innerType, visited);
          // Parentheses don't add nesting depth
          result.nestingDepth = childMetrics.nestingDepth;
          result.unionMemberCount += childMetrics.unionMemberCount;
          result.intersectionMemberCount += childMetrics.intersectionMemberCount;
          result.literalTypeCount += childMetrics.literalTypeCount;
          result.discriminantCaseCount += childMetrics.discriminantCaseCount;
        }
        break;

      default:
        // For other node types (TypeReference, etc.), keep default values
        break;
    }

    // Cache the result for memoization
    this.memoizedAnalysis.set(typeNode, result);
    
    // Remove from visited set to allow for proper traversal in other contexts
    visited.delete(typeNode);

    return result;
  }

  /**
   * Detect discriminated union patterns in type literal properties
   */
  private detectDiscriminatedUnion(properties: Node[]): number {
    // Look for properties with literal type values that could be discriminants
    let discriminantCount = 0;
    
    for (const prop of properties) {
      if (Node.isPropertySignature(prop)) {
        const typeNode = prop.getTypeNode();
        if (typeNode && this.isLiteralTypeNode(typeNode)) {
          discriminantCount++;
        }
      }
    }
    
    return discriminantCount;
  }

  /**
   * Check if a TypeNode represents a literal type
   */
  private isLiteralTypeNode(typeNode: TypeNode): boolean {
    const kind = typeNode.getKind();
    return kind === SyntaxKind.LiteralType ||
           kind === SyntaxKind.StringLiteral ||
           kind === SyntaxKind.NumericLiteral ||
           kind === SyntaxKind.TrueKeyword ||
           kind === SyntaxKind.FalseKeyword;
  }

  /**
   * Get default metrics
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
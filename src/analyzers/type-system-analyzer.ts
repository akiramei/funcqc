import {
  Project,
  SourceFile,
  ClassDeclaration,
  InterfaceDeclaration,
  TypeAliasDeclaration,
  EnumDeclaration,
  ModuleDeclaration,
  Node,
  PropertySignature,
  MethodSignature,
  PropertyDeclaration,
  MethodDeclaration,
  GetAccessorDeclaration,
  SetAccessorDeclaration,
  ConstructorDeclaration,
  SyntaxKind,
  JSDocableNode,
  TypeParameteredNode,
} from 'ts-morph';
import { v4 as uuidv4 } from 'uuid';
import {
  TypeDefinition,
  TypeMember,
  MethodOverride,
  TypeExtractionResult,
  GenericParameter,
} from '../types/type-system';
import { Logger } from '../utils/cli-utils';
import { PathNormalizer } from '../utils/path-normalizer';

/**
 * Type System Analyzer
 * Extracts complete type information from TypeScript source files
 */
export class TypeSystemAnalyzer {
  private typeIdMap: Map<string, string> = new Map(); // type full name -> UUID

  constructor(private project: Project, private logger: Logger = new Logger(false, false)) {
  }

  /**
   * Extract all type information from the project
   */
  async extractTypeInformation(snapshotId: string, sourceFiles: SourceFile[]): Promise<TypeExtractionResult> {
    const result: TypeExtractionResult = {
      typeDefinitions: [],
      typeRelationships: [],
      typeMembers: [],
      methodOverrides: [],
    };

    // First pass: collect all type definitions
    for (const sourceFile of sourceFiles) {
      await this.extractTypeDefinitionsFromFile(sourceFile, snapshotId, result);
    }

    // Second pass: extract relationships and members
    for (const sourceFile of sourceFiles) {
      await this.extractRelationshipsAndMembers(sourceFile, snapshotId, result);
    }

    // Third pass: detect method overrides
    await this.detectMethodOverrides(result, snapshotId);

    return result;
  }

  /**
   * Extract type definitions from a source file
   */
  private async extractTypeDefinitionsFromFile(
    sourceFile: SourceFile,
    snapshotId: string,
    result: TypeExtractionResult
  ): Promise<void> {
    const filePath = PathNormalizer.normalize(sourceFile.getFilePath());

    // Extract classes
    const classes = sourceFile.getClasses();
    for (const classDecl of classes) {
      const typeDef = this.extractClassDefinition(classDecl, filePath, snapshotId);
      if (typeDef) {
        result.typeDefinitions.push(typeDef);
        this.typeIdMap.set(this.getTypeFullName(typeDef), typeDef.id);
      }
    }

    // Extract interfaces
    const interfaces = sourceFile.getInterfaces();
    for (const interfaceDecl of interfaces) {
      const typeDef = this.extractInterfaceDefinition(interfaceDecl, filePath, snapshotId);
      if (typeDef) {
        result.typeDefinitions.push(typeDef);
        this.typeIdMap.set(this.getTypeFullName(typeDef), typeDef.id);
      }
    }

    // Extract type aliases
    const typeAliases = sourceFile.getTypeAliases();
    for (const typeAlias of typeAliases) {
      const typeDef = this.extractTypeAliasDefinition(typeAlias, filePath, snapshotId);
      if (typeDef) {
        result.typeDefinitions.push(typeDef);
        this.typeIdMap.set(this.getTypeFullName(typeDef), typeDef.id);
      }
    }

    // Extract enums
    const enums = sourceFile.getEnums();
    for (const enumDecl of enums) {
      const typeDef = this.extractEnumDefinition(enumDecl, filePath, snapshotId);
      if (typeDef) {
        result.typeDefinitions.push(typeDef);
        this.typeIdMap.set(this.getTypeFullName(typeDef), typeDef.id);
      }
    }

    // Extract namespaces
    const namespaces = sourceFile.getModules();
    for (const namespace of namespaces) {
      const typeDef = this.extractNamespaceDefinition(namespace, filePath, snapshotId);
      if (typeDef) {
        result.typeDefinitions.push(typeDef);
        this.typeIdMap.set(this.getTypeFullName(typeDef), typeDef.id);
      }
    }
  }

  /**
   * Extract class definition
   */
  private extractClassDefinition(
    classDecl: ClassDeclaration,
    filePath: string,
    snapshotId: string
  ): TypeDefinition | null {
    const name = classDecl.getName();
    if (!name) return null;

    return {
      id: uuidv4(),
      snapshotId,
      name,
      kind: 'class',
      filePath,
      startLine: classDecl.getStartLineNumber(),
      endLine: classDecl.getEndLineNumber(),
      startColumn: classDecl.getStart(),
      endColumn: classDecl.getEnd(),
      isAbstract: classDecl.isAbstract(),
      isExported: classDecl.isExported(),
      isDefaultExport: classDecl.isDefaultExport(),
      isGeneric: classDecl.getTypeParameters().length > 0,
      genericParameters: this.extractGenericParameters(classDecl),
      typeText: classDecl.getText(),
      modifiers: this.extractModifiers(classDecl),
      jsdoc: this.extractJSDoc(classDecl) || undefined,
      metadata: {},
    };
  }

  /**
   * Extract interface definition
   */
  private extractInterfaceDefinition(
    interfaceDecl: InterfaceDeclaration,
    filePath: string,
    snapshotId: string
  ): TypeDefinition {
    return {
      id: uuidv4(),
      snapshotId,
      name: interfaceDecl.getName(),
      kind: 'interface',
      filePath,
      startLine: interfaceDecl.getStartLineNumber(),
      endLine: interfaceDecl.getEndLineNumber(),
      startColumn: interfaceDecl.getStart(),
      endColumn: interfaceDecl.getEnd(),
      isAbstract: false,
      isExported: interfaceDecl.isExported(),
      isDefaultExport: interfaceDecl.isDefaultExport(),
      isGeneric: interfaceDecl.getTypeParameters().length > 0,
      genericParameters: this.extractGenericParameters(interfaceDecl),
      typeText: interfaceDecl.getText(),
      modifiers: this.extractModifiers(interfaceDecl),
      jsdoc: this.extractJSDoc(interfaceDecl),
      metadata: {},
    };
  }

  /**
   * Extract type alias definition
   */
  private extractTypeAliasDefinition(
    typeAlias: TypeAliasDeclaration,
    filePath: string,
    snapshotId: string
  ): TypeDefinition {
    return {
      id: uuidv4(),
      snapshotId,
      name: typeAlias.getName(),
      kind: 'type_alias',
      filePath,
      startLine: typeAlias.getStartLineNumber(),
      endLine: typeAlias.getEndLineNumber(),
      startColumn: typeAlias.getStart(),
      endColumn: typeAlias.getEnd(),
      isAbstract: false,
      isExported: typeAlias.isExported(),
      isDefaultExport: typeAlias.isDefaultExport(),
      isGeneric: typeAlias.getTypeParameters().length > 0,
      genericParameters: this.extractGenericParameters(typeAlias),
      typeText: typeAlias.getTypeNode()?.getText(),
      resolvedType: this.resolveTypeStructure(typeAlias.getTypeNode()),
      modifiers: this.extractModifiers(typeAlias),
      jsdoc: this.extractJSDoc(typeAlias),
      metadata: {},
    };
  }

  /**
   * Extract enum definition
   */
  private extractEnumDefinition(
    enumDecl: EnumDeclaration,
    filePath: string,
    snapshotId: string
  ): TypeDefinition {
    return {
      id: uuidv4(),
      snapshotId,
      name: enumDecl.getName(),
      kind: 'enum',
      filePath,
      startLine: enumDecl.getStartLineNumber(),
      endLine: enumDecl.getEndLineNumber(),
      startColumn: enumDecl.getStart(),
      endColumn: enumDecl.getEnd(),
      isAbstract: false,
      isExported: enumDecl.isExported(),
      isDefaultExport: enumDecl.isDefaultExport(),
      isGeneric: false,
      genericParameters: [],
      typeText: enumDecl.getText(),
      modifiers: this.extractModifiers(enumDecl),
      jsdoc: this.extractJSDoc(enumDecl),
      metadata: {
        members: enumDecl.getMembers().map(m => ({
          name: m.getName(),
          value: m.getValue(),
        })),
      },
    };
  }

  /**
   * Extract namespace definition
   */
  private extractNamespaceDefinition(
    namespace: ModuleDeclaration,
    filePath: string,
    snapshotId: string
  ): TypeDefinition | null {
    const name = namespace.getName();
    if (!name) return null;

    return {
      id: uuidv4(),
      snapshotId,
      name,
      kind: 'namespace',
      filePath,
      startLine: namespace.getStartLineNumber(),
      endLine: namespace.getEndLineNumber(),
      startColumn: namespace.getStart(),
      endColumn: namespace.getEnd(),
      isAbstract: false,
      isExported: namespace.isExported(),
      isDefaultExport: namespace.isDefaultExport(),
      isGeneric: false,
      genericParameters: [],
      typeText: namespace.getText(),
      modifiers: this.extractModifiers(namespace),
      jsdoc: this.extractJSDoc(namespace),
      metadata: {},
    };
  }

  /**
   * Extract relationships and members in second pass
   */
  private async extractRelationshipsAndMembers(
    sourceFile: SourceFile,
    snapshotId: string,
    result: TypeExtractionResult
  ): Promise<void> {
    // Process classes
    const classes = sourceFile.getClasses();
    for (const classDecl of classes) {
      await this.extractClassRelationshipsAndMembers(classDecl, snapshotId, result);
    }

    // Process interfaces
    const interfaces = sourceFile.getInterfaces();
    for (const interfaceDecl of interfaces) {
      await this.extractInterfaceRelationshipsAndMembers(interfaceDecl, snapshotId, result);
    }

    // Process type aliases
    const typeAliases = sourceFile.getTypeAliases();
    for (const typeAlias of typeAliases) {
      await this.extractTypeAliasRelationships(typeAlias, snapshotId, result);
    }
  }

  /**
   * Extract class relationships and members
   */
  private async extractClassRelationshipsAndMembers(
    classDecl: ClassDeclaration,
    snapshotId: string,
    result: TypeExtractionResult
  ): Promise<void> {
    const className = classDecl.getName();
    if (!className) return;

    const classId = this.getTypeId(classDecl);
    if (!classId) return;

    // Extract extends relationship
    const extendsExpr = classDecl.getExtends();
    if (extendsExpr) {
      const parentName = extendsExpr.getExpression().getText();
      result.typeRelationships.push({
        id: uuidv4(),
        snapshotId,
        sourceTypeId: classId,
        targetTypeId: this.resolveTypeId(parentName),
        targetName: parentName,
        relationshipKind: 'extends',
        position: 0,
        isArray: false,
        isOptional: false,
        genericArguments: this.extractGenericArguments(extendsExpr),
        confidenceScore: 1.0,
        metadata: {},
      });
    }

    // Extract implements relationships
    const implementsExprs = classDecl.getImplements();
    implementsExprs.forEach((impl, index) => {
      const interfaceName = impl.getExpression().getText();
      result.typeRelationships.push({
        id: uuidv4(),
        snapshotId,
        sourceTypeId: classId,
        targetTypeId: this.resolveTypeId(interfaceName),
        targetName: interfaceName,
        relationshipKind: 'implements',
        position: index,
        isArray: false,
        isOptional: false,
        genericArguments: this.extractGenericArguments(impl),
        confidenceScore: 1.0,
        metadata: {},
      });
    });

    // Extract members
    await this.extractClassMembers(classDecl, classId, snapshotId, result);
  }

  /**
   * Extract class members
   */
  private async extractClassMembers(
    classDecl: ClassDeclaration,
    classId: string,
    snapshotId: string,
    result: TypeExtractionResult
  ): Promise<void> {
    // Properties
    const properties = classDecl.getProperties();
    for (const prop of properties) {
      const member = this.extractPropertyMember(prop, classId, snapshotId);
      if (member) {
        result.typeMembers.push(member);
      }
    }

    // Methods
    const methods = classDecl.getMethods();
    for (const method of methods) {
      const member = this.extractMethodMember(method, classId, snapshotId, 'method');
      if (member) {
        result.typeMembers.push(member);
      }
    }

    // Getters
    const getters = classDecl.getGetAccessors();
    for (const getter of getters) {
      const member = this.extractAccessorMember(getter, classId, snapshotId, 'getter');
      if (member) {
        result.typeMembers.push(member);
      }
    }

    // Setters
    const setters = classDecl.getSetAccessors();
    for (const setter of setters) {
      const member = this.extractAccessorMember(setter, classId, snapshotId, 'setter');
      if (member) {
        result.typeMembers.push(member);
      }
    }

    // Constructors
    const constructors = classDecl.getConstructors();
    for (const ctor of constructors) {
      const member = this.extractConstructorMember(ctor, classId, snapshotId);
      if (member) {
        result.typeMembers.push(member);
      }
    }
  }

  /**
   * Extract interface relationships and members
   */
  private async extractInterfaceRelationshipsAndMembers(
    interfaceDecl: InterfaceDeclaration,
    snapshotId: string,
    result: TypeExtractionResult
  ): Promise<void> {
    const interfaceId = this.getTypeId(interfaceDecl);
    if (!interfaceId) return;

    // Extract extends relationships
    const extendsExprs = interfaceDecl.getExtends();
    extendsExprs.forEach((ext, index) => {
      const parentName = ext.getExpression().getText();
      result.typeRelationships.push({
        id: uuidv4(),
        snapshotId,
        sourceTypeId: interfaceId,
        targetTypeId: this.resolveTypeId(parentName),
        targetName: parentName,
        relationshipKind: 'extends',
        position: index,
        isArray: false,
        isOptional: false,
        genericArguments: this.extractGenericArguments(ext),
        confidenceScore: 1.0,
        metadata: {},
      });
    });

    // Extract members
    await this.extractInterfaceMembers(interfaceDecl, interfaceId, snapshotId, result);
  }

  /**
   * Extract interface members
   */
  private async extractInterfaceMembers(
    interfaceDecl: InterfaceDeclaration,
    interfaceId: string,
    snapshotId: string,
    result: TypeExtractionResult
  ): Promise<void> {
    // Property signatures
    const properties = interfaceDecl.getProperties();
    for (const prop of properties) {
      const member = this.extractPropertySignatureMember(prop, interfaceId, snapshotId);
      if (member) {
        result.typeMembers.push(member);
      }
    }

    // Method signatures
    const methods = interfaceDecl.getMethods();
    for (const method of methods) {
      const member = this.extractMethodSignatureMember(method, interfaceId, snapshotId);
      if (member) {
        result.typeMembers.push(member);
      }
    }

    // Call signatures
    const callSignatures = interfaceDecl.getCallSignatures();
    for (const callSig of callSignatures) {
      const member: TypeMember = {
        id: uuidv4(),
        snapshotId,
        typeId: interfaceId,
        name: '()',
        memberKind: 'call_signature',
        typeText: callSig.getText(),
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: true,
        startLine: callSig.getStartLineNumber(),
        endLine: callSig.getEndLineNumber(),
        startColumn: callSig.getStartLinePos(),
        endColumn: callSig.getEndLinePos(),
        metadata: {},
      };
      result.typeMembers.push(member);
    }

    // Index signatures
    const indexSignatures = interfaceDecl.getIndexSignatures();
    for (const indexSig of indexSignatures) {
      const member: TypeMember = {
        id: uuidv4(),
        snapshotId,
        typeId: interfaceId,
        name: `[${indexSig.getKeyName()}]`,
        memberKind: 'index_signature',
        typeText: indexSig.getReturnTypeNode()?.getText(),
        isOptional: false,
        isReadonly: indexSig.isReadonly(),
        isStatic: false,
        isAbstract: true,
        startLine: indexSig.getStartLineNumber(),
        endLine: indexSig.getEndLineNumber(),
        startColumn: indexSig.getStartLinePos(),
        endColumn: indexSig.getEndLinePos(),
        metadata: {},
      };
      result.typeMembers.push(member);
    }
  }

  /**
   * Extract type alias relationships
   */
  private async extractTypeAliasRelationships(
    typeAlias: TypeAliasDeclaration,
    snapshotId: string,
    result: TypeExtractionResult
  ): Promise<void> {
    const typeAliasId = this.getTypeId(typeAlias);
    if (!typeAliasId) return;

    const typeNode = typeAlias.getTypeNode();
    if (!typeNode) return;

    // Handle union types
    if (Node.isUnionTypeNode(typeNode)) {
      const unionTypes = typeNode.getTypeNodes();
      unionTypes.forEach((unionType, index) => {
        const typeName = unionType.getText();
        result.typeRelationships.push({
          id: uuidv4(),
          snapshotId,
          sourceTypeId: typeAliasId,
          targetTypeId: this.resolveTypeId(typeName),
          targetName: typeName,
          relationshipKind: 'union',
          position: index,
          isArray: false,
          isOptional: false,
          genericArguments: [],
          confidenceScore: 1.0,
          metadata: {},
        });
      });
    }
    
    // Handle intersection types
    else if (Node.isIntersectionTypeNode(typeNode)) {
      const intersectionTypes = typeNode.getTypeNodes();
      intersectionTypes.forEach((intersectionType, index) => {
        const typeName = intersectionType.getText();
        result.typeRelationships.push({
          id: uuidv4(),
          snapshotId,
          sourceTypeId: typeAliasId,
          targetTypeId: this.resolveTypeId(typeName),
          targetName: typeName,
          relationshipKind: 'intersection',
          position: index,
          isArray: false,
          isOptional: false,
          genericArguments: [],
          confidenceScore: 1.0,
          metadata: {},
        });
      });
    }
    
    // Handle reference types
    else {
      const typeName = typeNode.getText();
      result.typeRelationships.push({
        id: uuidv4(),
        snapshotId,
        sourceTypeId: typeAliasId,
        targetTypeId: this.resolveTypeId(typeName),
        targetName: typeName,
        relationshipKind: 'references',
        position: 0,
        isArray: Node.isArrayTypeNode(typeNode),
        isOptional: false,
        genericArguments: [],
        confidenceScore: 1.0,
        metadata: {},
      });
    }
  }

  /**
   * Detect method overrides
   */
  private async detectMethodOverrides(
    result: TypeExtractionResult,
    snapshotId: string
  ): Promise<void> {
    // Group methods by name
    const methodsByName = new Map<string, TypeMember[]>();
    for (const member of result.typeMembers) {
      if (member.memberKind === 'method' || member.memberKind === 'constructor') {
        const methods = methodsByName.get(member.name) || [];
        methods.push(member);
        methodsByName.set(member.name, methods);
      }
    }

    // Check for overrides based on inheritance relationships
    for (const relationship of result.typeRelationships) {
      if (relationship.relationshipKind === 'extends' || relationship.relationshipKind === 'implements') {
        const sourceMethods = result.typeMembers.filter(
          m => m.typeId === relationship.sourceTypeId && 
               (m.memberKind === 'method' || m.memberKind === 'constructor')
        );
        
        const targetMethods = result.typeMembers.filter(
          m => m.typeId === relationship.targetTypeId && 
               (m.memberKind === 'method' || m.memberKind === 'constructor')
        );

        for (const sourceMethod of sourceMethods) {
          const targetMethod = targetMethods.find(m => m.name === sourceMethod.name);
          if (targetMethod) {
            const override: MethodOverride = {
              id: uuidv4(),
              snapshotId,
              methodMemberId: sourceMethod.id,
              sourceTypeId: relationship.sourceTypeId,
              targetMemberId: targetMethod.id,
              targetTypeId: relationship.targetTypeId,
              overrideKind: relationship.relationshipKind === 'extends' ? 'override' : 
                            targetMethod.isAbstract ? 'abstract_implement' : 'implement',
              isCompatible: true, // TODO: Implement type compatibility check
              compatibilityErrors: [],
              confidenceScore: 1.0,
              metadata: {},
            };
            result.methodOverrides.push(override);
          }
        }
      }
    }
  }

  // Helper methods

  private extractGenericParameters(node: TypeParameteredNode): GenericParameter[] {
    return node.getTypeParameters().map(param => ({
      name: param.getName(),
      constraint: param.getConstraint()?.getText(),
      default: param.getDefault()?.getText(),
    }));
  }

  private extractModifiers(node: Node): string[] {
    const modifiers: string[] = [];
    
    if (Node.isExportableNode(node) && node.isExported()) {
      modifiers.push('export');
    }
    
    if (Node.isModifieredNode(node)) {
      if (node.hasModifier(SyntaxKind.AbstractKeyword)) modifiers.push('abstract');
      if (node.hasModifier(SyntaxKind.StaticKeyword)) modifiers.push('static');
      if (node.hasModifier(SyntaxKind.ReadonlyKeyword)) modifiers.push('readonly');
      if (node.hasModifier(SyntaxKind.AsyncKeyword)) modifiers.push('async');
      if (node.hasModifier(SyntaxKind.ConstKeyword)) modifiers.push('const');
      if (node.hasModifier(SyntaxKind.DeclareKeyword)) modifiers.push('declare');
    }
    
    return modifiers;
  }

  private extractJSDoc(node: JSDocableNode): string | undefined {
    const jsDocs = node.getJsDocs();
    if (jsDocs.length > 0) {
      return jsDocs.map(doc => doc.getText()).join('\n');
    }
    return undefined;
  }

  private extractGenericArguments(node: Node): string[] {
    // TODO: Implement generic argument extraction
    return [];
  }

  private resolveTypeStructure(typeNode: Node | undefined): any {
    if (!typeNode) return null;
    
    // TODO: Implement complete type structure resolution
    return {
      kind: typeNode.getKindName(),
      text: typeNode.getText(),
    };
  }

  private getTypeFullName(typeDef: TypeDefinition): string {
    return `${typeDef.filePath}#${typeDef.name}`;
  }

  private getTypeId(node: ClassDeclaration | InterfaceDeclaration | TypeAliasDeclaration): string | undefined {
    const name = node.getName();
    if (!name) return undefined;
    
    const filePath = PathNormalizer.normalize(node.getSourceFile().getFilePath());
    const fullName = `${filePath}#${name}`;
    return this.typeIdMap.get(fullName);
  }

  private resolveTypeId(typeName: string): string | undefined {
    // TODO: Implement proper type resolution
    // For now, return undefined for external types
    return undefined;
  }

  private extractPropertyMember(
    prop: PropertyDeclaration,
    classId: string,
    snapshotId: string
  ): TypeMember | null {
    const name = prop.getName();
    if (!name) return null;

    return {
      id: uuidv4(),
      snapshotId,
      typeId: classId,
      name,
      memberKind: 'property',
      typeText: prop.getTypeNode()?.getText(),
      isOptional: prop.hasQuestionToken(),
      isReadonly: prop.isReadonly(),
      isStatic: prop.isStatic(),
      isAbstract: prop.isAbstract(),
      accessModifier: this.getAccessModifier(prop),
      startLine: prop.getStartLineNumber(),
      endLine: prop.getEndLineNumber(),
      startColumn: prop.getStartLinePos(),
      endColumn: prop.getEndLinePos(),
      jsdoc: this.extractJSDoc(prop),
      metadata: {},
    };
  }

  private extractMethodMember(
    method: MethodDeclaration,
    classId: string,
    snapshotId: string,
    kind: 'method'
  ): TypeMember {
    return {
      id: uuidv4(),
      snapshotId,
      typeId: classId,
      name: method.getName(),
      memberKind: kind,
      typeText: method.getReturnTypeNode()?.getText(),
      isOptional: false,
      isReadonly: false,
      isStatic: method.isStatic(),
      isAbstract: method.isAbstract(),
      accessModifier: this.getAccessModifier(method),
      startLine: method.getStartLineNumber(),
      endLine: method.getEndLineNumber(),
      startColumn: method.getStartLinePos(),
      endColumn: method.getEndLinePos(),
      jsdoc: this.extractJSDoc(method),
      metadata: {
        parameters: method.getParameters().map(p => ({
          name: p.getName(),
          type: p.getTypeNode()?.getText(),
          optional: p.hasQuestionToken(),
        })),
      },
    };
  }

  private extractAccessorMember(
    accessor: GetAccessorDeclaration | SetAccessorDeclaration,
    classId: string,
    snapshotId: string,
    kind: 'getter' | 'setter'
  ): TypeMember {
    return {
      id: uuidv4(),
      snapshotId,
      typeId: classId,
      name: accessor.getName(),
      memberKind: kind,
      typeText: Node.isGetAccessorDeclaration(accessor) ? 
        accessor.getReturnTypeNode()?.getText() : 
        accessor.getParameters()[0]?.getTypeNode()?.getText(),
      isOptional: false,
      isReadonly: kind === 'getter',
      isStatic: accessor.isStatic(),
      isAbstract: accessor.isAbstract(),
      accessModifier: this.getAccessModifier(accessor),
      startLine: accessor.getStartLineNumber(),
      endLine: accessor.getEndLineNumber(),
      startColumn: accessor.getStartLinePos(),
      endColumn: accessor.getEndLinePos(),
      jsdoc: this.extractJSDoc(accessor),
      metadata: {},
    };
  }

  private extractConstructorMember(
    ctor: ConstructorDeclaration,
    classId: string,
    snapshotId: string
  ): TypeMember {
    return {
      id: uuidv4(),
      snapshotId,
      typeId: classId,
      name: 'constructor',
      memberKind: 'constructor',
      typeText: undefined,
      isOptional: false,
      isReadonly: false,
      isStatic: false,
      isAbstract: false,
      accessModifier: this.getAccessModifier(ctor),
      startLine: ctor.getStartLineNumber(),
      endLine: ctor.getEndLineNumber(),
      startColumn: ctor.getStartLinePos(),
      endColumn: ctor.getEndLinePos(),
      jsdoc: this.extractJSDoc(ctor),
      metadata: {
        parameters: ctor.getParameters().map(p => ({
          name: p.getName(),
          type: p.getTypeNode()?.getText(),
          optional: p.hasQuestionToken(),
        })),
      },
    };
  }

  private extractPropertySignatureMember(
    prop: PropertySignature,
    interfaceId: string,
    snapshotId: string
  ): TypeMember {
    return {
      id: uuidv4(),
      snapshotId,
      typeId: interfaceId,
      name: prop.getName(),
      memberKind: 'property',
      typeText: prop.getTypeNode()?.getText(),
      isOptional: prop.hasQuestionToken(),
      isReadonly: prop.isReadonly(),
      isStatic: false,
      isAbstract: true,
      startLine: prop.getStartLineNumber(),
      endLine: prop.getEndLineNumber(),
      startColumn: prop.getStartLinePos(),
      endColumn: prop.getEndLinePos(),
      jsdoc: this.extractJSDoc(prop),
      metadata: {},
    };
  }

  private extractMethodSignatureMember(
    method: MethodSignature,
    interfaceId: string,
    snapshotId: string
  ): TypeMember {
    return {
      id: uuidv4(),
      snapshotId,
      typeId: interfaceId,
      name: method.getName(),
      memberKind: 'method',
      typeText: method.getReturnTypeNode()?.getText(),
      isOptional: method.hasQuestionToken(),
      isReadonly: false,
      isStatic: false,
      isAbstract: true,
      startLine: method.getStartLineNumber(),
      endLine: method.getEndLineNumber(),
      startColumn: method.getStartLinePos(),
      endColumn: method.getEndLinePos(),
      jsdoc: this.extractJSDoc(method),
      metadata: {
        parameters: method.getParameters().map(p => ({
          name: p.getName(),
          type: p.getTypeNode()?.getText(),
          optional: p.hasQuestionToken(),
        })),
      },
    };
  }

  private getAccessModifier(
    node: MethodDeclaration | PropertyDeclaration | GetAccessorDeclaration | SetAccessorDeclaration | ConstructorDeclaration
  ): 'public' | 'protected' | 'private' | undefined {
    if (node.hasModifier(SyntaxKind.PrivateKeyword)) return 'private';
    if (node.hasModifier(SyntaxKind.ProtectedKeyword)) return 'protected';
    if (node.hasModifier(SyntaxKind.PublicKeyword)) return 'public';
    return undefined;
  }
}
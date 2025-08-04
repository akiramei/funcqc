import { Project, SourceFile, ClassDeclaration, InterfaceDeclaration, TypeAliasDeclaration, EnumDeclaration, ModuleDeclaration } from 'ts-morph';
import { TypeExtractionResult, TypeDefinition, TypeRelationship, TypeMember, MethodOverride } from '../types/type-system';
import { Logger } from '../utils/cli-utils';
import { PathNormalizer } from '../utils/path-normalizer';
import { simpleHash } from '../utils/hash-utils';

/**
 * TypeSystemAnalyzer - Extracts comprehensive type information from TypeScript code
 * 
 * This analyzer extracts:
 * - Type definitions (classes, interfaces, type aliases, enums, namespaces)
 * - Type relationships (extends, implements, etc.)
 * - Type members (properties, methods, etc.)
 * - Method overrides and implementations
 */
export class TypeSystemAnalyzer {
  private logger: Logger;

  constructor(_project: Project, logger: Logger = new Logger(false, false)) {
    this.logger = logger;
  }

  /**
   * Extract comprehensive type information from source files
   */
  async extractTypeInformation(snapshotId: string, sourceFiles: SourceFile[]): Promise<TypeExtractionResult> {
    this.logger.debug(`Extracting type information from ${sourceFiles.length} files for snapshot ${snapshotId}`);
    
    const typeDefinitions: TypeDefinition[] = [];
    const typeRelationships: TypeRelationship[] = [];
    const typeMembers: TypeMember[] = [];
    const methodOverrides: MethodOverride[] = [];

    // Track all extracted types for relationship resolution
    const typeMap = new Map<string, TypeDefinition>();
    // Keep track of source files by file path for member extraction
    const sourceFileMap = new Map<string, SourceFile>();
    for (const sourceFile of sourceFiles) {
      const normalizedPath = PathNormalizer.normalize(sourceFile.getFilePath());
      sourceFileMap.set(normalizedPath, sourceFile);
    }

    // Phase 1: Extract all type definitions
    for (const sourceFile of sourceFiles) {
      const filePath = PathNormalizer.normalize(sourceFile.getFilePath());
      
      // Extract classes
      const classes = sourceFile.getClasses();
      for (const classDecl of classes) {
        const typeDef = this.extractClassDefinition(classDecl, snapshotId, filePath);
        if (typeDef) {
          typeDefinitions.push(typeDef);
          typeMap.set(typeDef.name, typeDef);
        }
      }

      // Extract interfaces
      const interfaces = sourceFile.getInterfaces();
      for (const interfaceDecl of interfaces) {
        const typeDef = this.extractInterfaceDefinition(interfaceDecl, snapshotId, filePath);
        if (typeDef) {
          typeDefinitions.push(typeDef);
          typeMap.set(typeDef.name, typeDef);
        }
      }

      // Extract type aliases
      const typeAliases = sourceFile.getTypeAliases();
      for (const typeAlias of typeAliases) {
        const typeDef = this.extractTypeAliasDefinition(typeAlias, snapshotId, filePath);
        if (typeDef) {
          typeDefinitions.push(typeDef);
          typeMap.set(typeDef.name, typeDef);
        }
      }

      // Extract enums
      const enums = sourceFile.getEnums();
      for (const enumDecl of enums) {
        const typeDef = this.extractEnumDefinition(enumDecl, snapshotId, filePath);
        if (typeDef) {
          typeDefinitions.push(typeDef);
          typeMap.set(typeDef.name, typeDef);
        }
      }

      // Extract namespaces/modules
      const modules = sourceFile.getModules();
      for (const moduleDecl of modules) {
        const typeDef = this.extractModuleDefinition(moduleDecl, snapshotId, filePath);
        if (typeDef) {
          typeDefinitions.push(typeDef);
          typeMap.set(typeDef.name, typeDef);
        }
      }
    }

    // Phase 2: Extract type relationships
    for (const sourceFile of sourceFiles) {
      const classes = sourceFile.getClasses();
      for (const classDecl of classes) {
        const relationships = this.extractClassRelationships(classDecl, snapshotId, typeMap);
        typeRelationships.push(...relationships);
      }

      const interfaces = sourceFile.getInterfaces();
      for (const interfaceDecl of interfaces) {
        const relationships = this.extractInterfaceRelationships(interfaceDecl, snapshotId, typeMap);
        typeRelationships.push(...relationships);
      }
    }

    // Phase 3: Extract type members
    for (const typeDef of typeDefinitions) {
      if (typeDef.kind === 'class' || typeDef.kind === 'interface') {
        const members = await this.extractTypeMembers(typeDef, snapshotId, sourceFileMap);
        typeMembers.push(...members);
      }
    }

    // Phase 4: Extract method overrides
    for (const typeDef of typeDefinitions) {
      if (typeDef.kind === 'class') {
        const overrides = await this.extractMethodOverrides(typeDef, snapshotId, typeMap, typeMembers);
        methodOverrides.push(...overrides);
      }
    }

    this.logger.debug(`Extracted: ${typeDefinitions.length} types, ${typeRelationships.length} relationships, ${typeMembers.length} members, ${methodOverrides.length} overrides`);

    return {
      typeDefinitions,
      typeRelationships,
      typeMembers,
      methodOverrides
    };
  }

  /**
   * Extract class definition
   */
  private extractClassDefinition(classDecl: ClassDeclaration, snapshotId: string, filePath: string): TypeDefinition | undefined {
    const name = classDecl.getName();
    if (!name) return undefined;

    const id = `type_${simpleHash(`${filePath}:${name}:${classDecl.getStartLineNumber()}`)}`;

    return {
      id,
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
      genericParameters: classDecl.getTypeParameters().map(tp => ({
        name: tp.getName(),
        constraint: tp.getConstraint()?.getText() || null,
        default: tp.getDefault()?.getText() || null
      })),
      typeText: null,
      resolvedType: null,
      modifiers: classDecl.getModifiers().map(m => m.getText()),
      jsdoc: classDecl.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
      metadata: {}
    };
  }

  /**
   * Extract interface definition
   */
  private extractInterfaceDefinition(interfaceDecl: InterfaceDeclaration, snapshotId: string, filePath: string): TypeDefinition | undefined {
    const name = interfaceDecl.getName();
    if (!name) return undefined;

    const id = `type_${simpleHash(`${filePath}:${name}:${interfaceDecl.getStartLineNumber()}`)}`;

    return {
      id,
      snapshotId,
      name,
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
      genericParameters: interfaceDecl.getTypeParameters().map(tp => ({
        name: tp.getName(),
        constraint: tp.getConstraint()?.getText() || null,
        default: tp.getDefault()?.getText() || null
      })),
      typeText: null,
      resolvedType: null,
      modifiers: interfaceDecl.getModifiers().map(m => m.getText()),
      jsdoc: interfaceDecl.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
      metadata: {}
    };
  }

  /**
   * Extract type alias definition
   */
  private extractTypeAliasDefinition(typeAlias: TypeAliasDeclaration, snapshotId: string, filePath: string): TypeDefinition | undefined {
    const name = typeAlias.getName();
    if (!name) return undefined;

    const id = `type_${simpleHash(`${filePath}:${name}:${typeAlias.getStartLineNumber()}`)}`;

    return {
      id,
      snapshotId,
      name,
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
      genericParameters: typeAlias.getTypeParameters().map(tp => ({
        name: tp.getName(),
        constraint: tp.getConstraint()?.getText() || null,
        default: tp.getDefault()?.getText() || null
      })),
      typeText: typeAlias.getTypeNode()?.getText() || null,
      resolvedType: null,
      modifiers: typeAlias.getModifiers().map(m => m.getText()),
      jsdoc: typeAlias.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
      metadata: {}
    };
  }

  /**
   * Extract enum definition
   */
  private extractEnumDefinition(enumDecl: EnumDeclaration, snapshotId: string, filePath: string): TypeDefinition | undefined {
    const name = enumDecl.getName();
    if (!name) return undefined;

    const id = `type_${simpleHash(`${filePath}:${name}:${enumDecl.getStartLineNumber()}`)}`;

    return {
      id,
      snapshotId,
      name,
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
      typeText: null,
      resolvedType: null,
      modifiers: enumDecl.getModifiers().map(m => m.getText()),
      jsdoc: enumDecl.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
      metadata: {
        members: enumDecl.getMembers().map(member => ({
          name: member.getName(),
          value: member.getValue()
        }))
      }
    };
  }

  /**
   * Extract module/namespace definition
   */
  private extractModuleDefinition(moduleDecl: ModuleDeclaration, snapshotId: string, filePath: string): TypeDefinition | undefined {
    const name = moduleDecl.getName();
    if (!name) return undefined;

    const id = `type_${simpleHash(`${filePath}:${name}:${moduleDecl.getStartLineNumber()}`)}`;

    return {
      id,
      snapshotId,
      name,
      kind: 'namespace',
      filePath,
      startLine: moduleDecl.getStartLineNumber(),
      endLine: moduleDecl.getEndLineNumber(),
      startColumn: moduleDecl.getStart(),
      endColumn: moduleDecl.getEnd(),
      isAbstract: false,
      isExported: moduleDecl.isExported(),
      isDefaultExport: moduleDecl.isDefaultExport(),
      isGeneric: false,
      genericParameters: [],
      typeText: null,
      resolvedType: null,
      modifiers: moduleDecl.getModifiers().map(m => m.getText()),
      jsdoc: moduleDecl.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
      metadata: {}
    };
  }

  /**
   * Extract class relationships (extends, implements)
   */
  private extractClassRelationships(classDecl: ClassDeclaration, snapshotId: string, typeMap: Map<string, TypeDefinition>): TypeRelationship[] {
    const relationships: TypeRelationship[] = [];
    const className = classDecl.getName();
    if (!className) return relationships;

    const sourceType = typeMap.get(className);
    if (!sourceType) return relationships;

    // Extract extends relationship
    const extendsClause = classDecl.getExtends();
    if (extendsClause) {
      const targetName = extendsClause.getExpression().getText();
      const targetType = typeMap.get(targetName);
      
      relationships.push({
        id: `rel_${simpleHash(`${sourceType.id}:extends:${targetName}`)}`,
        snapshotId,
        sourceTypeId: sourceType.id,
        targetTypeId: targetType?.id || null,
        targetName,
        relationshipKind: 'extends',
        position: 0,
        isArray: false,
        isOptional: false,
        genericArguments: [],
        confidenceScore: targetType ? 1.0 : 0.8,
        metadata: {}
      });
    }

    // Extract implements relationships
    const implementsClauses = classDecl.getImplements();
    implementsClauses.forEach((implementsClause, index) => {
      const targetName = implementsClause.getExpression().getText();
      const targetType = typeMap.get(targetName);
      
      relationships.push({
        id: `rel_${simpleHash(`${sourceType.id}:implements:${targetName}:${index}`)}`,
        snapshotId,
        sourceTypeId: sourceType.id,
        targetTypeId: targetType?.id || null,
        targetName,
        relationshipKind: 'implements',
        position: index,
        isArray: false,
        isOptional: false,
        genericArguments: [],
        confidenceScore: targetType ? 1.0 : 0.8,
        metadata: {}
      });
    });

    return relationships;
  }

  /**
   * Extract interface relationships (extends)
   */
  private extractInterfaceRelationships(interfaceDecl: InterfaceDeclaration, snapshotId: string, typeMap: Map<string, TypeDefinition>): TypeRelationship[] {
    const relationships: TypeRelationship[] = [];
    const interfaceName = interfaceDecl.getName();
    if (!interfaceName) return relationships;

    const sourceType = typeMap.get(interfaceName);
    if (!sourceType) return relationships;

    // Extract extends relationships
    const extendsClause = interfaceDecl.getExtends();
    extendsClause.forEach((extend, index) => {
      const targetName = extend.getExpression().getText();
      const targetType = typeMap.get(targetName);
      
      relationships.push({
        id: `rel_${simpleHash(`${sourceType.id}:extends:${targetName}:${index}`)}`,
        snapshotId,
        sourceTypeId: sourceType.id,
        targetTypeId: targetType?.id || null,
        targetName,
        relationshipKind: 'extends',
        position: index,
        isArray: false,
        isOptional: false,
        genericArguments: [],
        confidenceScore: targetType ? 1.0 : 0.8,
        metadata: {}
      });
    });

    return relationships;
  }

  /**
   * Extract type members (methods, properties, etc.)
   */
  private async extractTypeMembers(typeDef: TypeDefinition, snapshotId: string, sourceFileMap: Map<string, SourceFile>): Promise<TypeMember[]> {
    const members: TypeMember[] = [];
    
    // Use the existing source file instead of re-parsing
    const sourceFile = sourceFileMap.get(typeDef.filePath);
    if (!sourceFile) {
      this.logger.warn(`Source file not found for type ${typeDef.name} at ${typeDef.filePath}`);
      return members;
    }
    
    if (typeDef.kind === 'class') {
      const classDecl = sourceFile.getClasses().find(c => 
        c.getName() === typeDef.name && 
        c.getStartLineNumber() === typeDef.startLine
      );
      
      if (classDecl) {
        members.push(...this.extractClassMembers(classDecl, typeDef.id, snapshotId));
      }
    } else if (typeDef.kind === 'interface') {
      const interfaceDecl = sourceFile.getInterfaces().find(i => 
        i.getName() === typeDef.name && 
        i.getStartLineNumber() === typeDef.startLine
      );
      
      if (interfaceDecl) {
        members.push(...this.extractInterfaceMembers(interfaceDecl, typeDef.id, snapshotId));
      }
    }
    
    return members;
  }

  /**
   * Extract members from a class declaration
   */
  private extractClassMembers(classDecl: ClassDeclaration, typeId: string, snapshotId: string): TypeMember[] {
    const members: TypeMember[] = [];
    
    // Extract properties
    for (const property of classDecl.getProperties()) {
      const id = `member_${simpleHash(`${typeId}:${property.getName()}:${property.getStartLineNumber()}`)}`;
      members.push({
        id,
        snapshotId,
        typeId,
        name: property.getName(),
        memberKind: 'property',
        typeText: this.safeGetTypeText(property.getType()),
        isOptional: property.hasQuestionToken(),
        isReadonly: property.isReadonly(),
        isStatic: property.isStatic(),
        isAbstract: property.isAbstract(),
        accessModifier: this.getAccessModifier(property),
        startLine: property.getStartLineNumber(),
        endLine: property.getEndLineNumber(),
        startColumn: property.getStart(),
        endColumn: property.getEnd(),
        functionId: null,
        jsdoc: property.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
        metadata: {}
      });
    }
    
    // Extract methods
    for (const method of classDecl.getMethods()) {
      const id = `member_${simpleHash(`${typeId}:${method.getName()}:${method.getStartLineNumber()}`)}`;
      // TODO: Link to actual function ID from database - for now set to null
      const functionId = null;
      
      members.push({
        id,
        snapshotId,
        typeId,
        name: method.getName(),
        memberKind: 'method',
        typeText: this.safeGetTypeText(method.getReturnType()),
        isOptional: false,
        isReadonly: false,
        isStatic: method.isStatic(),
        isAbstract: method.isAbstract(),
        accessModifier: this.getAccessModifier(method),
        startLine: method.getStartLineNumber(),
        endLine: method.getEndLineNumber(),
        startColumn: method.getStart(),
        endColumn: method.getEnd(),
        functionId,
        jsdoc: method.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
        metadata: {
          isAsync: method.isAsync(),
          isGenerator: method.isGenerator(),
          parameters: method.getParameters().map(p => ({
            name: p.getName(),
            type: this.safeGetTypeText(p.getType()),
            isOptional: p.isOptional()
          }))
        }
      });
    }
    
    // Extract getters/setters
    for (const accessor of classDecl.getGetAccessors()) {
      const id = `member_${simpleHash(`${typeId}:get_${accessor.getName()}:${accessor.getStartLineNumber()}`)}`;
      members.push({
        id,
        snapshotId,
        typeId,
        name: accessor.getName(),
        memberKind: 'getter',
        typeText: this.safeGetTypeText(accessor.getReturnType()),
        isOptional: false,
        isReadonly: true,
        isStatic: accessor.isStatic(),
        isAbstract: accessor.isAbstract(),
        accessModifier: this.getAccessModifier(accessor),
        startLine: accessor.getStartLineNumber(),
        endLine: accessor.getEndLineNumber(),
        startColumn: accessor.getStart(),
        endColumn: accessor.getEnd(),
        functionId: null,
        jsdoc: accessor.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
        metadata: {}
      });
    }
    
    for (const accessor of classDecl.getSetAccessors()) {
      const id = `member_${simpleHash(`${typeId}:set_${accessor.getName()}:${accessor.getStartLineNumber()}`)}`;
      members.push({
        id,
        snapshotId,
        typeId,
        name: accessor.getName(),
        memberKind: 'setter',
        typeText: 'void',
        isOptional: false,
        isReadonly: false,
        isStatic: accessor.isStatic(),
        isAbstract: accessor.isAbstract(),
        accessModifier: this.getAccessModifier(accessor),
        startLine: accessor.getStartLineNumber(),
        endLine: accessor.getEndLineNumber(),
        startColumn: accessor.getStart(),
        endColumn: accessor.getEnd(),
        functionId: null,
        jsdoc: accessor.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
        metadata: {}
      });
    }
    
    // Extract constructor
    const constructors = classDecl.getConstructors();
    for (const constructor of constructors) {
      const id = `member_${simpleHash(`${typeId}:constructor:${constructor.getStartLineNumber()}`)}`;
      members.push({
        id,
        snapshotId,
        typeId,
        name: 'constructor',
        memberKind: 'constructor',
        typeText: classDecl.getName() || 'unknown',
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: false,
        accessModifier: this.getAccessModifier(constructor),
        startLine: constructor.getStartLineNumber(),
        endLine: constructor.getEndLineNumber(),
        startColumn: constructor.getStart(),
        endColumn: constructor.getEnd(),
        functionId: null,
        jsdoc: constructor.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
        metadata: {
          parameters: constructor.getParameters().map(p => ({
            name: p.getName(),
            type: this.safeGetTypeText(p.getType()),
            isOptional: p.isOptional()
          }))
        }
      });
    }
    
    return members;
  }

  /**
   * Extract members from an interface declaration
   */
  private extractInterfaceMembers(interfaceDecl: InterfaceDeclaration, typeId: string, snapshotId: string): TypeMember[] {
    const members: TypeMember[] = [];
    
    // Extract properties
    for (const property of interfaceDecl.getProperties()) {
      const id = `member_${simpleHash(`${typeId}:${property.getName()}:${property.getStartLineNumber()}`)}`;
      members.push({
        id,
        snapshotId,
        typeId,
        name: property.getName(),
        memberKind: 'property',
        typeText: this.safeGetTypeText(property.getType()),
        isOptional: property.hasQuestionToken(),
        isReadonly: property.isReadonly(),
        isStatic: false,
        isAbstract: false,
        accessModifier: null,
        startLine: property.getStartLineNumber(),
        endLine: property.getEndLineNumber(),
        startColumn: property.getStart(),
        endColumn: property.getEnd(),
        functionId: null,
        jsdoc: property.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
        metadata: {}
      });
    }
    
    // Extract methods
    for (const method of interfaceDecl.getMethods()) {
      const id = `member_${simpleHash(`${typeId}:${method.getName()}:${method.getStartLineNumber()}`)}`;
      members.push({
        id,
        snapshotId,
        typeId,
        name: method.getName(),
        memberKind: 'method',
        typeText: this.safeGetTypeText(method.getReturnType()),
        isOptional: method.hasQuestionToken(),
        isReadonly: false,
        isStatic: false,
        isAbstract: true, // Interface methods are always abstract
        accessModifier: null,
        startLine: method.getStartLineNumber(),
        endLine: method.getEndLineNumber(),
        startColumn: method.getStart(),
        endColumn: method.getEnd(),
        functionId: null,
        jsdoc: method.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
        metadata: {
          parameters: method.getParameters().map(p => ({
            name: p.getName(),
            type: this.safeGetTypeText(p.getType()),
            isOptional: p.isOptional()
          }))
        }
      });
    }
    
    // Extract getters/setters
    for (const accessor of interfaceDecl.getGetAccessors()) {
      const id = `member_${simpleHash(`${typeId}:get_${accessor.getName()}:${accessor.getStartLineNumber()}`)}`;
      members.push({
        id,
        snapshotId,
        typeId,
        name: accessor.getName(),
        memberKind: 'getter',
        typeText: this.safeGetTypeText(accessor.getReturnType()),
        isOptional: false,
        isReadonly: true,
        isStatic: false,
        isAbstract: true,
        accessModifier: null,
        startLine: accessor.getStartLineNumber(),
        endLine: accessor.getEndLineNumber(),
        startColumn: accessor.getStart(),
        endColumn: accessor.getEnd(),
        functionId: null,
        jsdoc: accessor.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
        metadata: {}
      });
    }
    
    for (const accessor of interfaceDecl.getSetAccessors()) {
      const id = `member_${simpleHash(`${typeId}:set_${accessor.getName()}:${accessor.getStartLineNumber()}`)}`;
      members.push({
        id,
        snapshotId,
        typeId,
        name: accessor.getName(),
        memberKind: 'setter',
        typeText: 'void',
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: true,
        accessModifier: null,
        startLine: accessor.getStartLineNumber(),
        endLine: accessor.getEndLineNumber(),
        startColumn: accessor.getStart(),
        endColumn: accessor.getEnd(),
        functionId: null,
        jsdoc: accessor.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
        metadata: {}
      });
    }
    
    // Extract index signatures
    for (const indexSig of interfaceDecl.getIndexSignatures()) {
      const id = `member_${simpleHash(`${typeId}:index:${indexSig.getStartLineNumber()}`)}`;
      members.push({
        id,
        snapshotId,
        typeId,
        name: '[index]',
        memberKind: 'index_signature',
        typeText: indexSig.getReturnType().getText(),
        isOptional: false,
        isReadonly: indexSig.isReadonly(),
        isStatic: false,
        isAbstract: true,
        accessModifier: null,
        startLine: indexSig.getStartLineNumber(),
        endLine: indexSig.getEndLineNumber(),
        startColumn: indexSig.getStart(),
        endColumn: indexSig.getEnd(),
        functionId: null,
        jsdoc: indexSig.getJsDocs().map(jsdoc => jsdoc.getText()).join('\n') || null,
        metadata: {
          keyType: this.safeGetTypeText(indexSig.getKeyType())
        }
      });
    }
    
    // Extract call signatures
    for (const callSig of interfaceDecl.getCallSignatures()) {
      const id = `member_${simpleHash(`${typeId}:call:${callSig.getStartLineNumber()}`)}`;
      members.push({
        id,
        snapshotId,
        typeId,
        name: '[call]',
        memberKind: 'call_signature',
        typeText: callSig.getReturnType().getText(),
        isOptional: false,
        isReadonly: false,
        isStatic: false,
        isAbstract: true,
        accessModifier: null,
        startLine: callSig.getStartLineNumber(),
        endLine: callSig.getEndLineNumber(),
        startColumn: callSig.getStart(),
        endColumn: callSig.getEnd(),
        functionId: null,
        jsdoc: callSig.getJsDocs().map(jsdoc => jsdoc.getText()).join('\n') || null,
        metadata: {
          parameters: callSig.getParameters().map(p => ({
            name: p.getName(),
            type: this.safeGetTypeText(p.getType()),
            isOptional: p.isOptional()
          }))
        }
      });
    }
    
    return members;
  }

  /**
   * Get access modifier from a class member
   */
  private getAccessModifier(member: any): 'public' | 'protected' | 'private' | null {
    if ('getScope' in member) {
      const scope = member.getScope();
      if (scope === 'public') return 'public';
      if (scope === 'protected') return 'protected';
      if (scope === 'private') return 'private';
    }
    return null;
  }

  /**
   * Safely extract type text, handling potential issues with special characters
   */
  private safeGetTypeText(type: any): string {
    try {
      const typeText = type.getText();
      // Sanitize potentially problematic characters
      return typeText
        .replace(/\x00/g, '') // Remove null bytes
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
        .substring(0, 1000); // Limit length to prevent oversized data
    } catch (error) {
      this.logger.warn('Failed to get type text:', error);
      return 'unknown';
    }
  }

  /**
   * Safely extract text from node, handling potential issues
   */
  private safeGetText(node: any): string {
    try {
      const text = node.getText();
      return text
        .replace(/\x00/g, '') // Remove null bytes
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
        .substring(0, 2000); // Limit length
    } catch (error) {
      this.logger.warn('Failed to get node text:', error);
      return '';
    }
  }

  /**
   * Extract method overrides and implementations
   */
  private async extractMethodOverrides(
    _typeDef: TypeDefinition, 
    _snapshotId: string, 
    _typeMap: Map<string, TypeDefinition>,
    _typeMembers: TypeMember[]
  ): Promise<MethodOverride[]> {
    // This is a placeholder - in a full implementation, we would analyze
    // method signatures and match them against parent/interface methods
    // For now, return empty array to avoid breaking changes
    return [];
  }
}
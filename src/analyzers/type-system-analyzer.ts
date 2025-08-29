import { Project, SourceFile, ClassDeclaration, InterfaceDeclaration, TypeAliasDeclaration, EnumDeclaration, ModuleDeclaration } from 'ts-morph';
import { TypeExtractionResult, TypeDefinition, TypeRelationship, TypeMember, MethodOverride } from '../types/type-system';
import { StorageAdapter } from '../types';
import { Logger } from '../utils/cli-utils';
import { toUnifiedProjectPath } from '../utils/path-normalizer';
import { generateDeterministicTypeId } from '../utils/type-id-generator.js';
import { randomUUID } from 'crypto';

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
  private storage: StorageAdapter | null = null;

  constructor(_project: Project, logger: Logger = new Logger(false, false)) {
    this.logger = logger;
  }

  /**
   * Set storage adapter for function ID lookup
   */
  setStorage(storage: StorageAdapter): void {
    this.storage = storage;
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
      const unifiedPath = toUnifiedProjectPath(sourceFile.getFilePath());
      sourceFileMap.set(unifiedPath, sourceFile);
    }

    // Phase 1: Extract all type definitions
    for (const sourceFile of sourceFiles) {
      const filePath = toUnifiedProjectPath(sourceFile.getFilePath());
      
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

    const id = generateDeterministicTypeId(
      filePath,
      name,
      'class',
      classDecl.getStartLineNumber(),
      this.getColumnPosition(classDecl),
      snapshotId
    );

    return {
      id,
      snapshotId,
      name,
      kind: 'class',
      filePath,
      startLine: classDecl.getStartLineNumber(),
      endLine: classDecl.getEndLineNumber(),
      startColumn: this.getColumnPosition(classDecl),
      endColumn: this.getColumnPosition(classDecl, true),
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

    const id = generateDeterministicTypeId(
      filePath,
      name,
      'interface',
      interfaceDecl.getStartLineNumber(),
      this.getColumnPosition(interfaceDecl),
      snapshotId
    );

    return {
      id,
      snapshotId,
      name,
      kind: 'interface',
      filePath,
      startLine: interfaceDecl.getStartLineNumber(),
      endLine: interfaceDecl.getEndLineNumber(),
      startColumn: this.getColumnPosition(interfaceDecl),
      endColumn: this.getColumnPosition(interfaceDecl, true),
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

    const id = generateDeterministicTypeId(
      filePath,
      name,
      'type_alias',
      typeAlias.getStartLineNumber(),
      this.getColumnPosition(typeAlias),
      snapshotId
    );

    return {
      id,
      snapshotId,
      name,
      kind: 'type_alias',
      filePath,
      startLine: typeAlias.getStartLineNumber(),
      endLine: typeAlias.getEndLineNumber(),
      startColumn: this.getColumnPosition(typeAlias),
      endColumn: this.getColumnPosition(typeAlias, true),
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

    const id = generateDeterministicTypeId(
      filePath,
      name,
      'enum',
      enumDecl.getStartLineNumber(),
      this.getColumnPosition(enumDecl),
      snapshotId
    );

    return {
      id,
      snapshotId,
      name,
      kind: 'enum',
      filePath,
      startLine: enumDecl.getStartLineNumber(),
      endLine: enumDecl.getEndLineNumber(),
      startColumn: this.getColumnPosition(enumDecl),
      endColumn: this.getColumnPosition(enumDecl, true),
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

    const id = generateDeterministicTypeId(
      filePath,
      name,
      'namespace',
      moduleDecl.getStartLineNumber(),
      this.getColumnPosition(moduleDecl),
      snapshotId
    );

    return {
      id,
      snapshotId,
      name,
      kind: 'namespace',
      filePath,
      startLine: moduleDecl.getStartLineNumber(),
      endLine: moduleDecl.getEndLineNumber(),
      startColumn: this.getColumnPosition(moduleDecl),
      endColumn: this.getColumnPosition(moduleDecl, true),
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
        id: randomUUID(),
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
        id: randomUUID(),
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
        id: randomUUID(),
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

    // Build a cache of functions for this file to enable function ID lookup
    const functionCache = await this.buildFunctionCache(typeDef.filePath, snapshotId);
    
    if (typeDef.kind === 'class') {
      const classDecl = sourceFile.getClasses().find(c => 
        c.getName() === typeDef.name && 
        c.getStartLineNumber() === typeDef.startLine
      );
      
      if (classDecl) {
        members.push(...this.extractClassMembers(classDecl, typeDef.id, snapshotId, functionCache, typeDef.filePath));
      }
    } else if (typeDef.kind === 'interface') {
      const interfaceDecl = sourceFile.getInterfaces().find(i => 
        i.getName() === typeDef.name && 
        i.getStartLineNumber() === typeDef.startLine
      );
      
      if (interfaceDecl) {
        members.push(...this.extractInterfaceMembers(interfaceDecl, typeDef.id, snapshotId, functionCache, typeDef.filePath));
      }
    }
    
    return members;
  }

  /**
   * Extract members from a class declaration
   */
  private extractClassMembers(
    classDecl: ClassDeclaration, 
    typeId: string, 
    snapshotId: string,
    functionCache: Map<string, string>,
    _filePath: string
  ): TypeMember[] {
    const members: TypeMember[] = [];
    
    // Extract properties
    for (const property of classDecl.getProperties()) {
      const id = randomUUID();
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
        startColumn: this.getColumnPosition(property),
        endColumn: this.getColumnPosition(property, true),
        functionId: null,
        jsdoc: property.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
        metadata: {}
      });
    }
    
    // Extract methods
    for (const method of classDecl.getMethods()) {
      const id = randomUUID();
      const methodName = method.getName();
      const startLine = method.getStartLineNumber();
      const endLine = method.getEndLineNumber();
      
      // Look up function ID from cache
      const functionId = this.lookupFunctionId(functionCache, methodName, startLine, endLine);
      
      members.push({
        id,
        snapshotId,
        typeId,
        name: methodName,
        memberKind: 'method',
        typeText: this.safeGetTypeText(method.getReturnType()),
        isOptional: false,
        isReadonly: false,
        isStatic: method.isStatic(),
        isAbstract: method.isAbstract(),
        accessModifier: this.getAccessModifier(method),
        startLine,
        endLine,
        startColumn: this.getColumnPosition(method),
        endColumn: this.getColumnPosition(method, true),
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
      const id = randomUUID();
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
        startColumn: this.getColumnPosition(accessor),
        endColumn: this.getColumnPosition(accessor, true),
        functionId: null,
        jsdoc: accessor.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
        metadata: {}
      });
    }
    
    for (const accessor of classDecl.getSetAccessors()) {
      const id = randomUUID();
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
        startColumn: this.getColumnPosition(accessor),
        endColumn: this.getColumnPosition(accessor, true),
        functionId: null,
        jsdoc: accessor.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
        metadata: {}
      });
    }
    
    // Extract constructor
    const constructors = classDecl.getConstructors();
    for (const ctor of constructors) {
      const id = randomUUID();
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
        accessModifier: this.getAccessModifier(ctor),
        startLine: ctor.getStartLineNumber(),
        endLine: ctor.getEndLineNumber(),
        startColumn: this.getColumnPosition(ctor),
        endColumn: this.getColumnPosition(ctor, true),
        functionId: null,
        jsdoc: ctor.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
        metadata: {
          parameters: ctor.getParameters().map(p => ({
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
  private extractInterfaceMembers(
    interfaceDecl: InterfaceDeclaration, 
    typeId: string, 
    snapshotId: string,
    functionCache: Map<string, string>,
    _filePath: string
  ): TypeMember[] {
    const members: TypeMember[] = [];
    
    // Extract properties
    for (const property of interfaceDecl.getProperties()) {
      const id = randomUUID();
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
        startColumn: this.getColumnPosition(property),
        endColumn: this.getColumnPosition(property, true),
        functionId: null,
        jsdoc: property.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
        metadata: {}
      });
    }
    
    // Extract methods
    for (const method of interfaceDecl.getMethods()) {
      const id = randomUUID();
      const methodName = method.getName();
      const startLine = method.getStartLineNumber();
      const endLine = method.getEndLineNumber();
      
      // Look up function ID from cache (though interfaces typically don't have implementations)
      const functionId = this.lookupFunctionId(functionCache, methodName, startLine, endLine);
      
      members.push({
        id,
        snapshotId,
        typeId,
        name: methodName,
        memberKind: 'method',
        typeText: this.safeGetTypeText(method.getReturnType()),
        isOptional: method.hasQuestionToken(),
        isReadonly: false,
        isStatic: false,
        isAbstract: true, // Interface methods are always abstract
        accessModifier: null,
        startLine,
        endLine,
        startColumn: this.getColumnPosition(method),
        endColumn: this.getColumnPosition(method, true),
        functionId,
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
      const id = randomUUID();
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
        startColumn: this.getColumnPosition(accessor),
        endColumn: this.getColumnPosition(accessor, true),
        functionId: null,
        jsdoc: accessor.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
        metadata: {}
      });
    }
    
    for (const accessor of interfaceDecl.getSetAccessors()) {
      const id = randomUUID();
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
        startColumn: this.getColumnPosition(accessor),
        endColumn: this.getColumnPosition(accessor, true),
        functionId: null,
        jsdoc: accessor.getJsDocs().map(jsdoc => this.safeGetText(jsdoc)).join('\n') || null,
        metadata: {}
      });
    }
    
    // Extract index signatures
    for (const indexSig of interfaceDecl.getIndexSignatures()) {
      const id = randomUUID();
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
        startColumn: this.getColumnPosition(indexSig),
        endColumn: this.getColumnPosition(indexSig, true),
        functionId: null,
        jsdoc: indexSig.getJsDocs().map(jsdoc => jsdoc.getText()).join('\n') || null,
        metadata: {
          keyType: this.safeGetTypeText(indexSig.getKeyType())
        }
      });
    }
    
    // Extract call signatures
    for (const callSig of interfaceDecl.getCallSignatures()) {
      const id = randomUUID();
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
        startColumn: this.getColumnPosition(callSig),
        endColumn: this.getColumnPosition(callSig, true),
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
   * Get column position from node position
   */
  private getColumnPosition(node: { getStart(): number; getEnd(): number; getSourceFile(): { getLineAndColumnAtPos(pos: number): { line: number; column: number } } }, isEnd: boolean = false): number {
    const pos = isEnd ? node.getEnd() : node.getStart();
    const sourceFile = node.getSourceFile();
    const lineAndChar = sourceFile.getLineAndColumnAtPos(pos);
    return lineAndChar.column;
  }

  /**
   * Get access modifier from a class member
   */
  private getAccessModifier(member: unknown): 'public' | 'protected' | 'private' | null {
    if (member && typeof member === 'object' && 'getScope' in member) {
      const scope = (member as { getScope: () => string }).getScope();
      if (scope === 'public') return 'public';
      if (scope === 'protected') return 'protected';
      if (scope === 'private') return 'private';
    }
    return null;
  }

  /**
   * Safely extract type text, handling potential issues with special characters
   */
  private safeGetTypeText(type: { getText: () => string }): string {
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
  private safeGetText(node: { getText: () => string }): string {
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
   * Build a cache of functions for a given file to enable efficient function ID lookup
   */
  private async buildFunctionCache(filePath: string, snapshotId: string): Promise<Map<string, string>> {
    const cache = new Map<string, string>();
    
    if (!this.storage) {
      this.logger.warn('Storage not available for function ID lookup');
      return cache;
    }
    
    try {
      // Use unified project path format
      const physicalPath = filePath;
      
      // Query database for functions in this file
      const result = await this.storage.query(
        'SELECT id, name, start_line, end_line FROM functions WHERE snapshot_id = $1 AND file_path = $2 AND is_method = true',
        [snapshotId, physicalPath]
      );
      
      // Build cache with key: `${methodName}-${startLine}-${endLine}`, value: function ID
      for (const row of result.rows) {
        const typedRow = row as { id: string; name: string; start_line: number; end_line: number };
        const key = `${typedRow.name}-${typedRow.start_line}-${typedRow.end_line}`;
        cache.set(key, typedRow.id);
      }
      
      this.logger.debug(`Built function cache for ${filePath} (physical: ${physicalPath}): ${cache.size} methods found`);
    } catch (error) {
      this.logger.warn(`Failed to build function cache for ${filePath}:`, error);
    }
    
    return cache;
  }

  /**
   * Lookup function ID for a method by name and position
   */
  private lookupFunctionId(
    functionCache: Map<string, string>, 
    methodName: string, 
    startLine: number, 
    endLine: number
  ): string | null {
    const key = `${methodName}-${startLine}-${endLine}`;
    return functionCache.get(key) || null;
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

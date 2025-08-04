import { Kysely } from 'kysely';
import { 
  TypeDefinition, 
  TypeRelationship, 
  TypeMember, 
  MethodOverride 
} from '../../types/type-system';
import { DatabaseError } from '../errors/database-error';
import { ErrorCode } from '../../utils/error-handler';
import { Logger } from '../../utils/cli-utils';

/**
 * Type system database operations
 */
export class TypeSystemOperations {
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger(false, false);
  }

  /**
   * Save type definitions to database
   */
  async saveTypeDefinitions(
    db: Kysely<any>,
    types: TypeDefinition[]
  ): Promise<void> {
    if (types.length === 0) return;

    try {
      const records = types.map(type => ({
        id: type.id,
        snapshot_id: type.snapshotId,
        name: type.name,
        kind: type.kind,
        file_path: type.filePath,
        start_line: type.startLine,
        end_line: type.endLine,
        start_column: type.startColumn,
        end_column: type.endColumn,
        is_abstract: type.isAbstract,
        is_exported: type.isExported,
        is_default_export: type.isDefaultExport,
        is_generic: type.isGeneric,
        generic_parameters: JSON.stringify(type.genericParameters),
        type_text: type.typeText,
        resolved_type: type.resolvedType ? JSON.stringify(type.resolvedType) : null,
        modifiers: type.modifiers,
        jsdoc: type.jsdoc,
        metadata: JSON.stringify(type.metadata),
      }));

      await db
        .insertInto('type_definitions')
        .values(records)
        .execute();

      this.logger.debug(`Saved ${types.length} type definitions`);
    } catch (error) {
      throw new DatabaseError(ErrorCode.STORAGE_ERROR, 'Failed to save type definitions', error);
    }
  }

  /**
   * Save type relationships to database
   */
  async saveTypeRelationships(
    db: Kysely<any>,
    relationships: TypeRelationship[]
  ): Promise<void> {
    if (relationships.length === 0) return;

    try {
      const records = relationships.map(rel => ({
        id: rel.id,
        snapshot_id: rel.snapshotId,
        source_type_id: rel.sourceTypeId,
        target_type_id: rel.targetTypeId,
        target_name: rel.targetName,
        relationship_kind: rel.relationshipKind,
        position: rel.position,
        is_array: rel.isArray,
        is_optional: rel.isOptional,
        generic_arguments: JSON.stringify(rel.genericArguments),
        confidence_score: rel.confidenceScore,
        metadata: JSON.stringify(rel.metadata),
      }));

      await db
        .insertInto('type_relationships')
        .values(records)
        .execute();

      this.logger.debug(`Saved ${relationships.length} type relationships`);
    } catch (error) {
      throw new DatabaseError(ErrorCode.STORAGE_ERROR, 'Failed to save type relationships', error);
    }
  }

  /**
   * Save type members to database
   */
  async saveTypeMembers(
    db: Kysely<any>,
    members: TypeMember[]
  ): Promise<void> {
    if (members.length === 0) return;

    try {
      const records = members.map(member => ({
        id: member.id,
        snapshot_id: member.snapshotId,
        type_id: member.typeId,
        name: member.name,
        member_kind: member.memberKind,
        type_text: member.typeText,
        is_optional: member.isOptional,
        is_readonly: member.isReadonly,
        is_static: member.isStatic,
        is_abstract: member.isAbstract,
        access_modifier: member.accessModifier,
        start_line: member.startLine,
        end_line: member.endLine,
        start_column: member.startColumn,
        end_column: member.endColumn,
        function_id: member.functionId,
        jsdoc: member.jsdoc,
        metadata: JSON.stringify(member.metadata),
      }));

      await db
        .insertInto('type_members')
        .values(records)
        .execute();

      this.logger.debug(`Saved ${members.length} type members`);
    } catch (error) {
      throw new DatabaseError(ErrorCode.STORAGE_ERROR, 'Failed to save type members', error);
    }
  }

  /**
   * Save method overrides to database
   */
  async saveMethodOverrides(
    db: Kysely<any>,
    overrides: MethodOverride[]
  ): Promise<void> {
    if (overrides.length === 0) return;

    try {
      const records = overrides.map(override => ({
        id: override.id,
        snapshot_id: override.snapshotId,
        method_member_id: override.methodMemberId,
        source_type_id: override.sourceTypeId,
        target_member_id: override.targetMemberId,
        target_type_id: override.targetTypeId,
        override_kind: override.overrideKind,
        is_compatible: override.isCompatible,
        compatibility_errors: JSON.stringify(override.compatibilityErrors),
        confidence_score: override.confidenceScore,
        metadata: JSON.stringify(override.metadata),
      }));

      await db
        .insertInto('method_overrides')
        .values(records)
        .execute();

      this.logger.debug(`Saved ${overrides.length} method overrides`);
    } catch (error) {
      throw new DatabaseError(ErrorCode.STORAGE_ERROR, 'Failed to save method overrides', error);
    }
  }

  /**
   * Get type definitions by snapshot
   */
  async getTypeDefinitions(
    db: Kysely<any>,
    snapshotId: string
  ): Promise<TypeDefinition[]> {
    try {
      const results = await db
        .selectFrom('type_definitions')
        .selectAll()
        .where('snapshot_id', '=', snapshotId)
        .execute();

      return results.map(row => ({
        id: row.id,
        snapshotId: row.snapshot_id,
        name: row.name,
        kind: row.kind,
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        startColumn: row.start_column,
        endColumn: row.end_column,
        isAbstract: row.is_abstract,
        isExported: row.is_exported,
        isDefaultExport: row.is_default_export,
        isGeneric: row.is_generic,
        genericParameters: JSON.parse(row.generic_parameters || '[]'),
        typeText: row.type_text,
        resolvedType: row.resolved_type ? JSON.parse(row.resolved_type) : undefined,
        modifiers: row.modifiers || [],
        jsdoc: row.jsdoc,
        metadata: JSON.parse(row.metadata || '{}'),
      }));
    } catch (error) {
      throw new DatabaseError(ErrorCode.STORAGE_ERROR, 'Failed to get type definitions', error);
    }
  }

  /**
   * Get type relationships by snapshot
   */
  async getTypeRelationships(
    db: Kysely<any>,
    snapshotId: string
  ): Promise<TypeRelationship[]> {
    try {
      const results = await db
        .selectFrom('type_relationships')
        .selectAll()
        .where('snapshot_id', '=', snapshotId)
        .execute();

      return results.map(row => ({
        id: row.id,
        snapshotId: row.snapshot_id,
        sourceTypeId: row.source_type_id,
        targetTypeId: row.target_type_id,
        targetName: row.target_name,
        relationshipKind: row.relationship_kind,
        position: row.position,
        isArray: row.is_array,
        isOptional: row.is_optional,
        genericArguments: JSON.parse(row.generic_arguments || '[]'),
        confidenceScore: row.confidence_score,
        metadata: JSON.parse(row.metadata || '{}'),
      }));
    } catch (error) {
      throw new DatabaseError(ErrorCode.STORAGE_ERROR, 'Failed to get type relationships', error);
    }
  }

  /**
   * Get type members by type ID
   */
  async getTypeMembers(
    db: Kysely<any>,
    typeId: string
  ): Promise<TypeMember[]> {
    try {
      const results = await db
        .selectFrom('type_members')
        .selectAll()
        .where('type_id', '=', typeId)
        .execute();

      return results.map(row => ({
        id: row.id,
        snapshotId: row.snapshot_id,
        typeId: row.type_id,
        name: row.name,
        memberKind: row.member_kind,
        typeText: row.type_text,
        isOptional: row.is_optional,
        isReadonly: row.is_readonly,
        isStatic: row.is_static,
        isAbstract: row.is_abstract,
        accessModifier: row.access_modifier,
        startLine: row.start_line,
        endLine: row.end_line,
        startColumn: row.start_column,
        endColumn: row.end_column,
        functionId: row.function_id,
        jsdoc: row.jsdoc,
        metadata: JSON.parse(row.metadata || '{}'),
      }));
    } catch (error) {
      throw new DatabaseError(ErrorCode.STORAGE_ERROR, 'Failed to get type members', error);
    }
  }

  /**
   * Get method overrides by snapshot
   */
  async getMethodOverrides(
    db: Kysely<any>,
    snapshotId: string
  ): Promise<MethodOverride[]> {
    try {
      const results = await db
        .selectFrom('method_overrides')
        .selectAll()
        .where('snapshot_id', '=', snapshotId)
        .execute();

      return results.map(row => ({
        id: row.id,
        snapshotId: row.snapshot_id,
        methodMemberId: row.method_member_id,
        sourceTypeId: row.source_type_id,
        targetMemberId: row.target_member_id,
        targetTypeId: row.target_type_id,
        overrideKind: row.override_kind,
        isCompatible: row.is_compatible,
        compatibilityErrors: JSON.parse(row.compatibility_errors || '[]'),
        confidenceScore: row.confidence_score,
        metadata: JSON.parse(row.metadata || '{}'),
      }));
    } catch (error) {
      throw new DatabaseError(ErrorCode.STORAGE_ERROR, 'Failed to get method overrides', error);
    }
  }

  /**
   * Find type by name
   */
  async findTypeByName(
    db: Kysely<any>,
    name: string,
    snapshotId: string
  ): Promise<TypeDefinition | null> {
    try {
      const result = await db
        .selectFrom('type_definitions')
        .selectAll()
        .where('name', '=', name)
        .where('snapshot_id', '=', snapshotId)
        .executeTakeFirst();

      if (!result) return null;

      return {
        id: result.id,
        snapshotId: result.snapshot_id,
        name: result.name,
        kind: result.kind,
        filePath: result.file_path,
        startLine: result.start_line,
        endLine: result.end_line,
        startColumn: result.start_column,
        endColumn: result.end_column,
        isAbstract: result.is_abstract,
        isExported: result.is_exported,
        isDefaultExport: result.is_default_export,
        isGeneric: result.is_generic,
        genericParameters: JSON.parse(result.generic_parameters || '[]'),
        typeText: result.type_text,
        resolvedType: result.resolved_type ? JSON.parse(result.resolved_type) : undefined,
        modifiers: result.modifiers || [],
        jsdoc: result.jsdoc,
        metadata: JSON.parse(result.metadata || '{}'),
      };
    } catch (error) {
      throw new DatabaseError(ErrorCode.STORAGE_ERROR, 'Failed to find type by name', error);
    }
  }

  /**
   * Get implementing classes for an interface
   */
  async getImplementingClasses(
    db: Kysely<any>,
    interfaceId: string
  ): Promise<TypeDefinition[]> {
    try {
      const relationships = await db
        .selectFrom('type_relationships')
        .select(['source_type_id'])
        .where('target_type_id', '=', interfaceId)
        .where('relationship_kind', '=', 'implements')
        .execute();

      if (relationships.length === 0) return [];

      const typeIds = relationships.map(r => r.source_type_id);
      
      const results = await db
        .selectFrom('type_definitions')
        .selectAll()
        .where('id', 'in', typeIds)
        .where('kind', '=', 'class')
        .execute();

      return results.map(row => ({
        id: row.id,
        snapshotId: row.snapshot_id,
        name: row.name,
        kind: row.kind,
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        startColumn: row.start_column,
        endColumn: row.end_column,
        isAbstract: row.is_abstract,
        isExported: row.is_exported,
        isDefaultExport: row.is_default_export,
        isGeneric: row.is_generic,
        genericParameters: JSON.parse(row.generic_parameters || '[]'),
        typeText: row.type_text,
        resolvedType: row.resolved_type ? JSON.parse(row.resolved_type) : undefined,
        modifiers: row.modifiers || [],
        jsdoc: row.jsdoc,
        metadata: JSON.parse(row.metadata || '{}'),
      }));
    } catch (error) {
      throw new DatabaseError(ErrorCode.STORAGE_ERROR, 'Failed to get implementing classes', error);
    }
  }

  /**
   * Get method overrides by function ID
   */
  async getMethodOverridesByFunction(
    db: Kysely<any>,
    functionId: string
  ): Promise<MethodOverride[]> {
    try {
      // First find type members linked to this function
      const members = await db
        .selectFrom('type_members')
        .select(['id'])
        .where('function_id', '=', functionId)
        .execute();

      if (members.length === 0) return [];

      const memberIds = members.map(m => m.id);

      // Then find overrides for these members
      const results = await db
        .selectFrom('method_overrides')
        .selectAll()
        .where('method_member_id', 'in', memberIds)
        .execute();

      return results.map(row => ({
        id: row.id,
        snapshotId: row.snapshot_id,
        methodMemberId: row.method_member_id,
        sourceTypeId: row.source_type_id,
        targetMemberId: row.target_member_id,
        targetTypeId: row.target_type_id,
        overrideKind: row.override_kind,
        isCompatible: row.is_compatible,
        compatibilityErrors: JSON.parse(row.compatibility_errors || '[]'),
        confidenceScore: row.confidence_score,
        metadata: JSON.parse(row.metadata || '{}'),
      }));
    } catch (error) {
      throw new DatabaseError(ErrorCode.STORAGE_ERROR, 'Failed to get method overrides by function', error);
    }
  }
}
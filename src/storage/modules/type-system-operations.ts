import { 
  TypeDefinition, 
  TypeRelationship, 
  TypeMember, 
  MethodOverride 
} from '../../types/type-system';
import { DatabaseError } from '../errors/database-error';
import { ErrorCode } from '../../utils/error-handler';
import { StorageContext } from './types';
import { 
  executeUnnestBulkInsert
} from '../bulk-insert-utils';

interface PGTransaction {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * Type System Database Operations
 * Complete implementation for managing type information in the database
 */
export class TypeSystemOperations {
  private context: StorageContext;

  constructor(context: StorageContext) {
    this.context = context;
  }

  get kysely() {
    return this.context.kysely;
  }


  /**
   * Safely parse JSON string with error handling
   */
  private safeJsonParse<T>(value: unknown, fallback: T): T {
    // Delegate to the utility operations for consistent handling
    return this.context.utilityOps?.parseJsonSafely(value, fallback) ?? fallback;
  }

  /**
   * Save type definitions within a transaction
   */
  async saveTypeDefinitionsInTransaction(
    trx: PGTransaction,
    types: TypeDefinition[]
  ): Promise<void> {
    if (types.length === 0) {
      this.context.logger?.debug('No type definitions to save');
      return;
    }

    try {
      const insertData = types.map(type => {
        const data = {
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
          generic_parameters: JSON.stringify(type.genericParameters || []),
          type_text: type.typeText || null,
          resolved_type: type.resolvedType ? JSON.stringify(type.resolvedType) : null,
          modifiers: JSON.stringify(type.modifiers || []),
          jsdoc: type.jsdoc || null,
          metadata: JSON.stringify(type.metadata || {})
        };
        
        // Skip detailed validation for performance
        
        return data;
      });

      // Database will handle constraint enforcement with ON CONFLICT

      // Use the same bulk insert pattern as FunctionOperations
      const columns = ['id', 'snapshot_id', 'name', 'kind', 'file_path', 'start_line', 'end_line', 'start_column', 'end_column',
                      'is_abstract', 'is_exported', 'is_default_export', 'is_generic', 'generic_parameters', 'type_text', 
                      'resolved_type', 'modifiers', 'jsdoc', 'metadata'];
      
      // Use ON CONFLICT to handle duplicates gracefully
      const values = insertData.map(row => 
        columns.map(col => (row as Record<string, unknown>)[col])
      );
      
      await this.executeBulkInsertInTransaction(
        trx, 
        'type_definitions', 
        columns, 
        values,
        { idempotent: true }
      );
    } catch (error) {
      console.error(`❌ Failed to save type definitions:`, error instanceof Error ? error.message : String(error));
      throw new DatabaseError(
        ErrorCode.UNKNOWN_ERROR,
        `Failed to save type definitions in transaction: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Save type definitions to database (non-transactional wrapper)
   */
  async saveTypeDefinitions(
    types: TypeDefinition[]
  ): Promise<void> {
    if (types.length === 0) {
      this.context.logger?.debug('No type definitions to save');
      return;
    }

    try {
      await this.context.db.transaction(async (trx: PGTransaction) => {
        await this.saveTypeDefinitionsInTransaction(trx, types);
      });
    } catch (error) {
      console.error(`❌ Failed to save type definitions:`, error);
      console.error(`❌ Error details:`, {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw new DatabaseError(
        ErrorCode.UNKNOWN_ERROR,
        `Failed to save type definitions: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Save type relationships within a transaction
   */
  async saveTypeRelationshipsInTransaction(
    trx: PGTransaction,
    relationships: TypeRelationship[]
  ): Promise<void> {
    if (relationships.length === 0) {
      this.context.logger?.debug('No type relationships to save');
      return;
    }

    try {
      const insertData = relationships.map(rel => ({
        id: rel.id,
        snapshot_id: rel.snapshotId,
        source_type_id: rel.sourceTypeId,
        target_type_id: rel.targetTypeId || null,
        target_name: rel.targetName,
        relationship_kind: rel.relationshipKind,
        position: rel.position,
        is_array: rel.isArray,
        is_optional: rel.isOptional,
        generic_arguments: JSON.stringify(rel.genericArguments || []),
        confidence_score: rel.confidenceScore,
        metadata: JSON.stringify(rel.metadata || {})
      }));

      const columns = ['id', 'snapshot_id', 'source_type_id', 'target_type_id', 'target_name', 'relationship_kind',
                      'position', 'is_array', 'is_optional', 'generic_arguments', 'confidence_score', 'metadata'];
      
      await this.executeBulkInsertInTransaction(trx, 'type_relationships', columns, insertData.map(row => 
        columns.map(col => (row as Record<string, unknown>)[col])
      ), { idempotent: true });
    } catch (error) {
      console.error(`❌ Database error during type relationships save:`, error);
      throw new DatabaseError(
        ErrorCode.UNKNOWN_ERROR,
        'Failed to save type relationships in transaction',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Save type relationships to database (non-transactional wrapper)
   */
  async saveTypeRelationships(
    relationships: TypeRelationship[]
  ): Promise<void> {
    if (relationships.length === 0) {
      this.context.logger?.debug('No type relationships to save');
      return;
    }

    try {
      await this.context.db.transaction(async (trx: PGTransaction) => {
        await this.saveTypeRelationshipsInTransaction(trx, relationships);
      });
    } catch (error) {
      console.error(`❌ Failed to save type relationships:`, error);
      console.error(`❌ Error details:`, {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        relationshipsCount: relationships.length
      });
      throw new DatabaseError(
        ErrorCode.UNKNOWN_ERROR,
        'Failed to save type relationships',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Save type members within a transaction
   */
  async saveTypeMembersInTransaction(
    trx: PGTransaction,
    members: TypeMember[]
  ): Promise<void> {
    if (members.length === 0) {
      this.context.logger?.debug('No type members to save');
      return;
    }

    try {
      const insertData = members.map(member => ({
        id: member.id,
        snapshot_id: member.snapshotId,
        type_id: member.typeId,
        name: member.name,
        member_kind: member.memberKind,
        type_text: member.typeText || null,
        is_optional: member.isOptional,
        is_readonly: member.isReadonly,
        is_static: member.isStatic,
        is_abstract: member.isAbstract,
        access_modifier: member.accessModifier || null,
        start_line: member.startLine,
        end_line: member.endLine,
        start_column: member.startColumn,
        end_column: member.endColumn,
        function_id: member.functionId || null,
        jsdoc: member.jsdoc || null,
        metadata: JSON.stringify(member.metadata || {})
      }));

      const columns = ['id', 'snapshot_id', 'type_id', 'name', 'member_kind', 'type_text', 'is_optional', 'is_readonly',
                      'is_static', 'is_abstract', 'access_modifier', 'start_line', 'end_line', 'start_column', 
                      'end_column', 'function_id', 'jsdoc', 'metadata'];
      
      await this.executeBulkInsertInTransaction(trx, 'type_members', columns, insertData.map(row => 
        columns.map(col => (row as Record<string, unknown>)[col])
      ), { idempotent: true });
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.UNKNOWN_ERROR,
        'Failed to save type members in transaction',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Save type members to database (non-transactional wrapper)
   */
  async saveTypeMembers(
    members: TypeMember[]
  ): Promise<void> {
    if (members.length === 0) {
      this.context.logger?.debug('No type members to save');
      return;
    }

    try {
      await this.context.db.transaction(async (trx: PGTransaction) => {
        await this.saveTypeMembersInTransaction(trx, members);
      });
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.UNKNOWN_ERROR,
        'Failed to save type members',
        error instanceof Error ? error : undefined
      );
    }
  }


  /**
   * Save method overrides within a transaction
   */
  async saveMethodOverridesInTransaction(
    trx: PGTransaction,
    overrides: MethodOverride[]
  ): Promise<void> {
    if (overrides.length === 0) {
      this.context.logger?.debug('No method overrides to save');
      return;
    }

    try {
      const insertData = overrides.map(override => ({
        id: override.id,
        snapshot_id: override.snapshotId,
        method_member_id: override.methodMemberId,
        source_type_id: override.sourceTypeId,
        target_member_id: override.targetMemberId || null,
        target_type_id: override.targetTypeId || null,
        override_kind: override.overrideKind,
        is_compatible: override.isCompatible,
        compatibility_errors: JSON.stringify(override.compatibilityErrors || []),
        confidence_score: override.confidenceScore,
        metadata: JSON.stringify(override.metadata || {})
      }));

      const columns = ['id', 'snapshot_id', 'method_member_id', 'source_type_id', 'target_member_id', 'target_type_id',
                      'override_kind', 'is_compatible', 'compatibility_errors', 'confidence_score', 'metadata'];
      
      await this.executeBulkInsertInTransaction(trx, 'method_overrides', columns, insertData.map(row => 
        columns.map(col => (row as Record<string, unknown>)[col])
      ), { idempotent: true });
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.UNKNOWN_ERROR,
        'Failed to save method overrides in transaction',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Save method overrides to database (non-transactional wrapper)
   */
  async saveMethodOverrides(
    overrides: MethodOverride[]
  ): Promise<void> {
    if (overrides.length === 0) {
      this.context.logger?.debug('No method overrides to save');
      return;
    }

    try {
      await this.context.db.transaction(async (trx: PGTransaction) => {
        await this.saveMethodOverridesInTransaction(trx, overrides);
      });
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.UNKNOWN_ERROR,
        'Failed to save method overrides',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Execute bulk insert within a transaction with UNNEST for optimal PGLite performance
   */
  private async executeBulkInsertInTransaction(
    trx: PGTransaction,
    tableName: string,
    columns: string[],
    data: unknown[][],
    options?: { idempotent?: boolean }
  ): Promise<void> {
    if (data.length === 0) return;
    
    // Use UNNEST-based bulk insert for better PGLite performance
    await executeUnnestBulkInsert(
      (sql, params) => trx.query(sql, params),
      tableName,
      columns,
      data,
      options?.idempotent ? { idempotent: options.idempotent } : {}
    );
  }

  /**
   * Save all type information within a single transaction (following FunctionOperations pattern)
   */
  async saveAllTypeInformationInTransaction(
    trx: PGTransaction,
    typeInfo: {
      typeDefinitions: TypeDefinition[];
      typeRelationships: TypeRelationship[];
      typeMembers: TypeMember[];
      methodOverrides: MethodOverride[];
    }
  ): Promise<void> {
    try {
      // Save type definitions (must be first - other tables reference these)
      await this.saveTypeDefinitionsInTransaction(trx, typeInfo.typeDefinitions);
      
      // Save type relationships (references type_definitions)
      await this.saveTypeRelationshipsInTransaction(trx, typeInfo.typeRelationships);
      
      // Save type members (references type_definitions and functions)
      await this.saveTypeMembersInTransaction(trx, typeInfo.typeMembers);
      
      // Save method overrides (references type_members and type_definitions)
      await this.saveMethodOverridesInTransaction(trx, typeInfo.methodOverrides);
    } catch (error) {
      throw error; // Let transaction handle rollback
    }
  }

  /**
   * Save all type information (master method that follows FunctionOperations pattern)
   */
  async saveAllTypeInformation(
    typeInfo: {
      typeDefinitions: TypeDefinition[];
      typeRelationships: TypeRelationship[];
      typeMembers: TypeMember[];
      methodOverrides: MethodOverride[];
    }
  ): Promise<void> {
    try {
      await this.context.db.transaction(async (trx: PGTransaction) => {
        await this.saveAllTypeInformationInTransaction(trx, typeInfo);
      });
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.UNKNOWN_ERROR,
        `Failed to save all type information: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get type definitions by snapshot
   */
  async getTypeDefinitions(
    snapshotId: string
  ): Promise<TypeDefinition[]> {
    try {
      // Removed debug console logs to reduce noise during normal usage
      const rows = await this.kysely
        .selectFrom('type_definitions')
        .selectAll()
        .where('snapshot_id', '=', snapshotId)
        .execute();

      const typeDefinitions: TypeDefinition[] = rows.map(row => ({
        id: String(row.id),
        snapshotId: String(row.snapshot_id),
        name: String(row.name),
        kind: String(row.kind) as TypeDefinition['kind'],
        filePath: String(row.file_path),
        startLine: Number(row.start_line),
        endLine: Number(row.end_line),
        startColumn: Number(row.start_column),
        endColumn: Number(row.end_column),
        isAbstract: Boolean(row.is_abstract),
        isExported: Boolean(row.is_exported),
        isDefaultExport: Boolean(row.is_default_export),
        isGeneric: Boolean(row.is_generic),
        genericParameters: this.safeJsonParse(row.generic_parameters, []),
        typeText: row.type_text ? String(row.type_text) : null,
        resolvedType: this.safeJsonParse(row.resolved_type, null),
        modifiers: this.safeJsonParse(row.modifiers, []),
        jsdoc: row.jsdoc ? String(row.jsdoc) : null,
        metadata: this.safeJsonParse(row.metadata, {})
      }));

      return typeDefinitions;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.UNKNOWN_ERROR,
        'Failed to get type definitions',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get type relationships by snapshot
   */
  async getTypeRelationships(
    snapshotId: string
  ): Promise<TypeRelationship[]> {
    try {
      const rows = await this.kysely
        .selectFrom('type_relationships')
        .selectAll()
        .where('snapshot_id', '=', snapshotId)
        .execute();

      const relationships: TypeRelationship[] = rows.map(row => ({
        id: String(row.id),
        snapshotId: String(row.snapshot_id),
        sourceTypeId: String(row.source_type_id),
        targetTypeId: row.target_type_id ? String(row.target_type_id) : null,
        targetName: String(row.target_name),
        relationshipKind: String(row.relationship_kind) as TypeRelationship['relationshipKind'],
        position: Number(row.position),
        isArray: Boolean(row.is_array),
        isOptional: Boolean(row.is_optional),
        genericArguments: this.safeJsonParse(row.generic_arguments, []),
        confidenceScore: Number(row.confidence_score),
        metadata: this.safeJsonParse(row.metadata, {})
      }));

      return relationships;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.UNKNOWN_ERROR,
        'Failed to get type relationships',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get type members by type ID
   */
  async getTypeMembers(
    typeId: string
  ): Promise<TypeMember[]> {
    try {
      const rows = await this.kysely
        .selectFrom('type_members')
        .selectAll()
        .where('type_id', '=', typeId)
        .execute();

      const members: TypeMember[] = rows.map(row => ({
        id: String(row.id),
        snapshotId: String(row.snapshot_id),
        typeId: String(row.type_id),
        name: String(row.name),
        memberKind: String(row.member_kind) as TypeMember['memberKind'],
        typeText: row.type_text ? String(row.type_text) : null,
        isOptional: Boolean(row.is_optional),
        isReadonly: Boolean(row.is_readonly),
        isStatic: Boolean(row.is_static),
        isAbstract: Boolean(row.is_abstract),
        accessModifier: row.access_modifier ? String(row.access_modifier) as TypeMember['accessModifier'] : null,
        startLine: Number(row.start_line),
        endLine: Number(row.end_line),
        startColumn: Number(row.start_column),
        endColumn: Number(row.end_column),
        functionId: row.function_id ? String(row.function_id) : null,
        jsdoc: row.jsdoc ? String(row.jsdoc) : null,
        metadata: this.safeJsonParse(row.metadata, {})
      }));

      return members;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.UNKNOWN_ERROR,
        'Failed to get type members',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get method overrides by snapshot
   */
  async getMethodOverrides(
    snapshotId: string
  ): Promise<MethodOverride[]> {
    try {
      const rows = await this.kysely
        .selectFrom('method_overrides')
        .selectAll()
        .where('snapshot_id', '=', snapshotId)
        .execute();

      const overrides: MethodOverride[] = rows.map(row => ({
        id: String(row.id),
        snapshotId: String(row.snapshot_id),
        methodMemberId: String(row.method_member_id),
        sourceTypeId: String(row.source_type_id),
        targetMemberId: row.target_member_id ? String(row.target_member_id) : null,
        targetTypeId: row.target_type_id ? String(row.target_type_id) : null,
        overrideKind: String(row.override_kind) as MethodOverride['overrideKind'],
        isCompatible: Boolean(row.is_compatible),
        compatibilityErrors: this.safeJsonParse(row.compatibility_errors, []),
        confidenceScore: Number(row.confidence_score),
        metadata: this.safeJsonParse(row.metadata, {})
      }));

      return overrides;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.UNKNOWN_ERROR,
        'Failed to get method overrides',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Find type by name
   */
  async findTypeByName(
    name: string,
    snapshotId: string
  ): Promise<TypeDefinition | null> {
    try {
      const row = await this.kysely
        .selectFrom('type_definitions')
        .selectAll()
        .where('name', '=', name)
        .where('snapshot_id', '=', snapshotId)
        .executeTakeFirst();

      if (!row) {
        return null;
      }

      const typeDefinition: TypeDefinition = {
        id: String(row.id),
        snapshotId: String(row.snapshot_id),
        name: String(row.name),
        kind: String(row.kind) as TypeDefinition['kind'],
        filePath: String(row.file_path),
        startLine: Number(row.start_line),
        endLine: Number(row.end_line),
        startColumn: Number(row.start_column),
        endColumn: Number(row.end_column),
        isAbstract: Boolean(row.is_abstract),
        isExported: Boolean(row.is_exported),
        isDefaultExport: Boolean(row.is_default_export),
        isGeneric: Boolean(row.is_generic),
        genericParameters: this.safeJsonParse(row.generic_parameters, []),
        typeText: row.type_text ? String(row.type_text) : null,
        resolvedType: this.safeJsonParse(row.resolved_type, null),
        modifiers: this.safeJsonParse(row.modifiers, []),
        jsdoc: row.jsdoc ? String(row.jsdoc) : null,
        metadata: this.safeJsonParse(row.metadata, {})
      };

      return typeDefinition;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.UNKNOWN_ERROR,
        'Failed to find type by name',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get implementing classes for an interface
   */
  async getImplementingClasses(
    interfaceId: string
  ): Promise<TypeDefinition[]> {
    try {
      const rows = await this.kysely
        .selectFrom('type_definitions')
        .innerJoin('type_relationships', 'type_definitions.id', 'type_relationships.source_type_id')
        .selectAll('type_definitions')
        .where('type_relationships.target_type_id', '=', interfaceId)
        .where('type_relationships.relationship_kind', '=', 'implements')
        .where('type_definitions.kind', '=', 'class')
        .execute();

      const classes: TypeDefinition[] = rows.map(row => ({
        id: String(row.id),
        snapshotId: String(row.snapshot_id),
        name: String(row.name),
        kind: String(row.kind) as TypeDefinition['kind'],
        filePath: String(row.file_path),
        startLine: Number(row.start_line),
        endLine: Number(row.end_line),
        startColumn: Number(row.start_column),
        endColumn: Number(row.end_column),
        isAbstract: Boolean(row.is_abstract),
        isExported: Boolean(row.is_exported),
        isDefaultExport: Boolean(row.is_default_export),
        isGeneric: Boolean(row.is_generic),
        genericParameters: this.safeJsonParse(row.generic_parameters, []),
        typeText: row.type_text ? String(row.type_text) : null,
        resolvedType: this.safeJsonParse(row.resolved_type, null),
        modifiers: this.safeJsonParse(row.modifiers, []),
        jsdoc: row.jsdoc ? String(row.jsdoc) : null,
        metadata: this.safeJsonParse(row.metadata, {})
      }));

      return classes;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.UNKNOWN_ERROR,
        'Failed to get implementing classes',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get method overrides by function ID
   */
  async getMethodOverridesByFunction(
    functionId: string
  ): Promise<MethodOverride[]> {
    try {
      const rows = await this.kysely
        .selectFrom('method_overrides')
        .innerJoin('type_members', 'method_overrides.method_member_id', 'type_members.id')
        .selectAll('method_overrides')
        .where('type_members.function_id', '=', functionId)
        .execute();

      const overrides: MethodOverride[] = rows.map(row => ({
        id: String(row.id),
        snapshotId: String(row.snapshot_id),
        methodMemberId: String(row.method_member_id),
        sourceTypeId: String(row.source_type_id),
        targetMemberId: row.target_member_id ? String(row.target_member_id) : null,
        targetTypeId: row.target_type_id ? String(row.target_type_id) : null,
        overrideKind: String(row.override_kind) as MethodOverride['overrideKind'],
        isCompatible: Boolean(row.is_compatible),
        compatibilityErrors: this.safeJsonParse(row.compatibility_errors, []),
        confidenceScore: Number(row.confidence_score),
        metadata: this.safeJsonParse(row.metadata, {})
      }));

      return overrides;
    } catch (error) {
      throw new DatabaseError(
        ErrorCode.UNKNOWN_ERROR,
        'Failed to get method overrides by function',
        error instanceof Error ? error : undefined
      );
    }
  }

}
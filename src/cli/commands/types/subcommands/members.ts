import { TypeMembersOptions, isUuidOrPrefix } from '../../types.types';
import { TypeDefinition } from '../../../../types';
import { VoidCommand } from '../../../../types/command';
import { CommandEnvironment } from '../../../../types/environment';
import { createErrorHandler, ErrorCode, FuncqcError } from '../../../../utils/error-handler';
import { getMemberKindIcon, getAccessModifierIcon } from '../shared/formatters';
import { findTypeById } from '../shared/utils';

/**
 * Type member detail structure
 */
interface TypeMemberDetail {
  id: string;
  name: string;
  memberKind: string;
  typeText: string | null;
  isOptional: boolean;
  isReadonly: boolean;
  isStatic: boolean;
  isAbstract: boolean;
  accessModifier: string | null;
  startLine: number;
  endLine: number;
  functionId: string | null;
  jsdoc: string | null;
}


/**
 * Get detailed type member information with filtering
 */
async function getTypeMembersDetailed(
  storage: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
  typeId: string,
  snapshotId: string,
  options: TypeMembersOptions
): Promise<TypeMemberDetail[]> {
  let whereClause = 'WHERE tm.type_id = $1 AND tm.snapshot_id = $2';
  const params: unknown[] = [typeId, snapshotId];
  
  if (options.kind) {
    whereClause += ` AND tm.member_kind = $${params.length + 1}`;
    params.push(options.kind);
  }
  
  if (options.accessModifier) {
    whereClause += ` AND tm.access_modifier = $${params.length + 1}`;
    params.push(options.accessModifier);
  }
  
  const result = await storage.query(`
    SELECT 
      tm.id,
      tm.name,
      tm.member_kind,
      tm.type_text,
      tm.is_optional,
      tm.is_readonly,
      tm.is_static,
      tm.is_abstract,
      tm.access_modifier,
      tm.start_line,
      tm.end_line,
      tm.function_id,
      tm.jsdoc
    FROM type_members tm
    ${whereClause}
    ORDER BY tm.member_kind, tm.name
  `, params);
  
  return result.rows.map((row: unknown) => {
    const typedRow = row as {
      id: string;
      name: string;
      member_kind: string;
      type_text: string | null;
      is_optional: boolean;
      is_readonly: boolean;
      is_static: boolean;
      is_abstract: boolean;
      access_modifier: string | null;
      start_line: number;
      end_line: number;
      function_id: string | null;
      jsdoc: string | null;
    };
    
    return {
      id: typedRow.id,
      name: typedRow.name,
      memberKind: typedRow.member_kind,
      typeText: typedRow.type_text,
      isOptional: typedRow.is_optional,
      isReadonly: typedRow.is_readonly,
      isStatic: typedRow.is_static,
      isAbstract: typedRow.is_abstract,
      accessModifier: typedRow.access_modifier,
      startLine: typedRow.start_line,
      endLine: typedRow.end_line,
      functionId: typedRow.function_id,
      jsdoc: typedRow.jsdoc
    };
  });
}

/**
 * Display type members analysis results
 */
function displayTypeMembersAnalysis(typeName: string, members: TypeMemberDetail[], detailed?: boolean): void {
  console.log(`\n👥 Members for type '${typeName}' (${members.length} members)\n`);
  
  // Group by member kind for better organization
  const membersByKind = members.reduce((acc, member) => {
    if (!acc[member.memberKind]) acc[member.memberKind] = [];
    acc[member.memberKind].push(member);
    return acc;
  }, {} as Record<string, TypeMemberDetail[]>);
  
  // Display by kind
  const kindOrder = ['constructor', 'property', 'getter', 'setter', 'method', 'index_signature', 'call_signature'];
  
  for (const kind of kindOrder) {
    const kindMembers = membersByKind[kind];
    if (!kindMembers || kindMembers.length === 0) continue;
    
    const kindIcon = getMemberKindIcon(kind);
    console.log(`${kindIcon} ${kind.toUpperCase()}S (${kindMembers.length}):`);
    
    // Ensure kindMembers is an array
    const membersArray = Array.isArray(kindMembers) ? kindMembers : [kindMembers];
    
    for (const member of membersArray) {
      const accessIcon = getAccessModifierIcon(member.accessModifier);
      const flags = [];
      if (member.isStatic) flags.push('static');
      if (member.isReadonly) flags.push('readonly');
      if (member.isOptional) flags.push('optional');
      if (member.isAbstract) flags.push('abstract');
      
      const flagsStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
      const typeStr = member.typeText ? `: ${member.typeText}` : '';
      
      console.log(`  ${accessIcon} ${member.name}${typeStr}${flagsStr}`);
      
      if (detailed && member.jsdoc) {
        const jsdocLines = member.jsdoc.split('\n').map(line => `    ${line.trim()}`).join('\n');
        console.log(`    📝 ${jsdocLines}`);
      }
    }
    console.log();
  }
}

/**
 * Execute types members command using database
 */
export const executeTypesMembersDB: VoidCommand<TypeMembersOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      const typeNameOrId = (options as { typeName?: string }).typeName || '';
      if (!typeNameOrId) {
        const funcqcError = errorHandler.createError(
          ErrorCode.MISSING_ARGUMENT,
          'Type identifier is required. Usage: funcqc types members <typeName> or funcqc types --action=members --type-name=<typeName>',
          { argument: 'typeName' }
        );
        throw funcqcError;
      }
      
      env.commandLogger.info(`👥 Analyzing members for type: ${typeNameOrId}`);
      
      const snapshots = await env.storage.getSnapshots({ limit: 1 });
      if (snapshots.length === 0) {
        throw new Error('No snapshots found. Run scan first to analyze the codebase.');
      }
      const latestSnapshot = snapshots[0];
      
      // Try to find by ID first (if looks like UUID), then by name
      let targetType: TypeDefinition | null = null;
      if (isUuidOrPrefix(typeNameOrId)) {
        // Looks like a UUID or UUID prefix
        targetType = await findTypeById(env.storage, typeNameOrId, latestSnapshot.id);
      }
      if (!targetType) {
        targetType = await env.storage.findTypeByName(typeNameOrId, latestSnapshot.id);
      }
    
      if (!targetType) {
        const funcqcError = errorHandler.createError(
          ErrorCode.NOT_FOUND,
          `Type '${typeNameOrId}' not found (searched by ID and name)`,
          { typeNameOrId }
        );
        throw funcqcError;
      }
      
      // Get detailed member information
      const members = await getTypeMembersDetailed(env.storage, targetType.id, latestSnapshot.id, options);
      
      if (members.length === 0) {
        console.log(`⚠️  No members found for type ${targetType.name}`);
        return;
      }
      
      if (options.json) {
        console.log(JSON.stringify(members, null, 2));
      } else {
        displayTypeMembersAnalysis(targetType.name, members, options.detail);
      }
      
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as FuncqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze type members: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };
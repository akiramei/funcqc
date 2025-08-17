import { TypeCoverageOptions, isUuidOrPrefix, escapeLike } from '../../types.types';
import { TypeDefinition } from '../../../../types';
import { VoidCommand } from '../../../../types/command';
import { CommandEnvironment } from '../../../../types/environment';
import { createErrorHandler, ErrorCode, FuncqcError } from '../../../../utils/error-handler';

/**
 * Find type by ID or prefix
 */
async function findTypeById(
  storage: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
  idOrPrefix: string,
  snapshotId: string
): Promise<TypeDefinition | null> {
  // Support partial ID matching (e.g., first 8 characters)
  // Escape wildcards to prevent unintended pattern matching
  const escapedPrefix = escapeLike(idOrPrefix);
  const result = await storage.query(
    `SELECT * FROM type_definitions 
     WHERE snapshot_id = $1 AND id LIKE $2 || '%' ESCAPE '\\'
     ORDER BY id ASC
     LIMIT 1`,
    [snapshotId, escapedPrefix]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const row = result.rows[0] as {
    id: string;
    snapshot_id: string;
    name: string;
    kind: string;
    file_path: string;
    start_line: number;
    end_line: number;
    start_column: number;
    end_column: number;
    is_exported: boolean;
    is_generic: boolean;
    metadata: Record<string, unknown>;
  };
  
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    filePath: row.file_path,
    startLine: row.start_line,
    endLine: row.end_line,
    startColumn: row.start_column,
    endColumn: row.end_column,
    isExported: row.is_exported,
    isGeneric: row.is_generic,
    metadata: row.metadata as Record<string, unknown>
  };
}

/**
 * Type member detail for coverage analysis
 */
interface TypeMemberInfo {
  id: string;
  name: string;
  memberKind: string;
  isOptional: boolean;
  functionId: string | null;
  jsdoc: string | null;
}

/**
 * Type coverage analysis results
 */
interface TypeCoverageResults {
  typeName: string;
  typeKind: string;
  totalMembers: number;
  documentedMembers: number;
  implementedMembers: number;
  coverage: {
    documentation: number; // percentage
    implementation: number; // percentage
  };
  analysis: {
    missingDocumentation: string[];
    missingImplementation: string[];
  };
}

/**
 * Get type members for coverage analysis
 */
async function getTypeMembersForCoverage(
  storage: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
  typeId: string,
  snapshotId: string
): Promise<TypeMemberInfo[]> {
  const result = await storage.query(`
    SELECT 
      id,
      name,
      member_kind,
      is_optional,
      function_id,
      jsdoc
    FROM type_members
    WHERE type_id = $1 AND snapshot_id = $2
    ORDER BY member_kind, name
  `, [typeId, snapshotId]);
  
  return result.rows.map((row: unknown) => {
    const typedRow = row as {
      id: string;
      name: string;
      member_kind: string;
      is_optional: boolean;
      function_id: string | null;
      jsdoc: string | null;
    };
    
    return {
      id: typedRow.id,
      name: typedRow.name,
      memberKind: typedRow.member_kind,
      isOptional: typedRow.is_optional,
      functionId: typedRow.function_id,
      jsdoc: typedRow.jsdoc
    };
  });
}

/**
 * Analyze type coverage
 */
function analyzeTypeCoverage(type: TypeDefinition, members: TypeMemberInfo[]): TypeCoverageResults {
  const totalMembers = members.length;
  
  // Calculate documentation coverage
  const documentedMembers = members.filter(member => 
    member.jsdoc && member.jsdoc.trim().length > 0
  ).length;
  
  // Calculate implementation coverage (methods with function_id)
  const implementedMembers = members.filter(member => 
    member.functionId !== null || member.memberKind !== 'method'
  ).length;
  
  const documentationCoverage = totalMembers > 0 ? (documentedMembers / totalMembers) * 100 : 100;
  const implementationCoverage = totalMembers > 0 ? (implementedMembers / totalMembers) * 100 : 100;
  
  // Find missing documentation and implementation
  const missingDocumentation = members
    .filter(member => !member.jsdoc || member.jsdoc.trim().length === 0)
    .map(member => member.name);
    
  const missingImplementation = members
    .filter(member => member.memberKind === 'method' && member.functionId === null)
    .map(member => member.name);
  
  return {
    typeName: type.name,
    typeKind: type.kind,
    totalMembers,
    documentedMembers,
    implementedMembers,
    coverage: {
      documentation: Math.round(documentationCoverage * 100) / 100,
      implementation: Math.round(implementationCoverage * 100) / 100
    },
    analysis: {
      missingDocumentation,
      missingImplementation
    }
  };
}

/**
 * Display type coverage analysis results
 */
function displayTypeCoverageResults(results: TypeCoverageResults, detailed?: boolean): void {
  console.log(`\n📊 Coverage Analysis for ${results.typeKind} '${results.typeName}'\n`);
  
  // Summary statistics
  console.log('📈 Coverage Summary:');
  console.log(`  Total Members:    ${results.totalMembers}`);
  console.log(`  Documented:       ${results.documentedMembers}/${results.totalMembers} (${results.coverage.documentation}%)`);
  console.log(`  Implemented:      ${results.implementedMembers}/${results.totalMembers} (${results.coverage.implementation}%)`);
  
  // Documentation analysis
  if (results.analysis.missingDocumentation.length > 0) {
    console.log(`\n📝 Missing Documentation (${results.analysis.missingDocumentation.length} items):`);
    if (detailed) {
      results.analysis.missingDocumentation.forEach(name => {
        console.log(`  • ${name}`);
      });
    } else {
      console.log(`  ${results.analysis.missingDocumentation.slice(0, 3).join(', ')}${results.analysis.missingDocumentation.length > 3 ? ', ...' : ''}`);
    }
  }
  
  // Implementation analysis
  if (results.analysis.missingImplementation.length > 0) {
    console.log(`\n⚙️  Missing Implementation (${results.analysis.missingImplementation.length} items):`);
    if (detailed) {
      results.analysis.missingImplementation.forEach(name => {
        console.log(`  • ${name}`);
      });
    } else {
      console.log(`  ${results.analysis.missingImplementation.slice(0, 3).join(', ')}${results.analysis.missingImplementation.length > 3 ? ', ...' : ''}`);
    }
  }
  
  // Overall assessment
  console.log('\n🎯 Assessment:');
  if (results.coverage.documentation >= 80 && results.coverage.implementation >= 90) {
    console.log('  ✅ Excellent coverage - well documented and implemented');
  } else if (results.coverage.documentation >= 60 && results.coverage.implementation >= 80) {
    console.log('  ⚠️  Good coverage - some improvements possible');
  } else {
    console.log('  ❌ Poor coverage - significant improvements needed');
  }
}

/**
 * Execute types coverage command using database
 */
export const executeTypesCoverageDB: VoidCommand<TypeCoverageOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);
    
    try {
      const typeNameOrId = (options as { typeName?: string }).typeName || '';
      
      env.commandLogger.info(`📊 Analyzing coverage for type: ${typeNameOrId}`);
      
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
      
      // Get type members for coverage analysis
      const members = await getTypeMembersForCoverage(env.storage, targetType.id, latestSnapshot.id);
      
      // Analyze coverage
      const coverageResults = analyzeTypeCoverage(targetType, members);
      
      if (options.json) {
        console.log(JSON.stringify(coverageResults, null, 2));
      } else {
        displayTypeCoverageResults(coverageResults, options.detail);
      }
      
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        errorHandler.handleError(error as FuncqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Failed to analyze type coverage: ${error instanceof Error ? error.message : String(error)}`,
          {},
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };
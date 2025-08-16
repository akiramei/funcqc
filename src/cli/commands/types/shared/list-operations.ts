import { TypeDefinition } from '../../../../types';
import { getTypeKindIcon, getTypeKindText } from './formatters';

/**
 * Member count data for each type
 */
export interface MemberCounts {
  properties: number;
  methods: number;
  constructors: number;
  indexSignatures: number;
  callSignatures: number;
  total: number;
}

/**
 * Coupling information for a type
 */
export interface CouplingInfo {
  totalFunctions: number;
  averageUsageRatio: number;
}

/**
 * Get comprehensive member counts for types using type_members table
 */
export async function getMemberCountsForTypes(
  storage: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
  _types: TypeDefinition[],
  snapshotId: string
): Promise<Map<string, MemberCounts>> {
  const memberCounts = new Map<string, MemberCounts>();
  
  try {
    // Query type_members table to count all member types
    // Note: getter/setter are aggregated with properties (same name = 1 property)
    const result = await storage.query(`
      SELECT 
        tm.type_id,
        -- Properties: count distinct names to aggregate getter/setter
        COUNT(DISTINCT tm.name) FILTER (WHERE tm.member_kind IN ('property', 'getter', 'setter')) as props,
        -- Methods: count actual methods
        COUNT(*) FILTER (WHERE tm.member_kind = 'method') as methods,
        -- Constructors
        COUNT(*) FILTER (WHERE tm.member_kind = 'constructor') as ctors,
        -- Index signatures
        COUNT(*) FILTER (WHERE tm.member_kind = 'index_signature') as index_sigs,
        -- Call signatures  
        COUNT(*) FILTER (WHERE tm.member_kind = 'call_signature') as call_sigs
      FROM type_members tm
      WHERE tm.snapshot_id = $1
      GROUP BY tm.type_id
    `, [snapshotId]);
    
    if (result.rows.length === 0) {
      // No type member data available - this is normal for snapshots without type system analysis
      // The enhanced display will show '-' for zero values which is the expected behavior
    }
    
    result.rows.forEach((row: unknown) => {
      const typedRow = row as { 
        type_id: string; 
        props: string;
        methods: string;
        ctors: string;
        index_sigs: string;
        call_sigs: string;
      };
      
      const props = parseInt(typedRow.props, 10) || 0;
      const methods = parseInt(typedRow.methods, 10) || 0;
      const ctors = parseInt(typedRow.ctors, 10) || 0;
      const indexSigs = parseInt(typedRow.index_sigs, 10) || 0;
      const callSigs = parseInt(typedRow.call_sigs, 10) || 0;
      
      memberCounts.set(typedRow.type_id, {
        properties: props,
        methods,
        constructors: ctors,
        indexSignatures: indexSigs,
        callSignatures: callSigs,
        total: props + methods + ctors + indexSigs + callSigs
      });
    });
  } catch (error) {
    console.warn(`Warning: Failed to get member counts: ${error}`);
  }
  
  return memberCounts;
}

/**
 * Sort types by field
 */
export function sortTypesDB(
  types: TypeDefinition[], 
  sortField: string, 
  desc?: boolean, 
  memberCounts?: Map<string, MemberCounts>
): TypeDefinition[] {
  const validSortOptions = ['name', 'kind', 'file', 'functions', 'props', 'methods', 'ctors', 'total', 'members'] as const;
  if (!validSortOptions.includes(sortField as typeof validSortOptions[number])) {
    throw new Error(`Invalid sort option: ${sortField}. Valid options are: ${validSortOptions.join(', ')}`);
  }
  
  const sorted = [...types].sort((a, b) => {
    let result: number;
    
    switch (sortField) {
      case 'name':
        result = a.name.localeCompare(b.name);
        break;
      case 'kind': {
        // Sort by kind priority: class > interface > type_alias > enum > namespace
        const kindPriority = { class: 5, interface: 4, type_alias: 3, enum: 2, namespace: 1 };
        const aPriority = kindPriority[a.kind as keyof typeof kindPriority] || 0;
        const bPriority = kindPriority[b.kind as keyof typeof kindPriority] || 0;
        result = aPriority - bPriority;
        if (result === 0) {
          result = a.name.localeCompare(b.name); // Secondary sort by name
        }
        break;
      }
      case 'file': {
        result = a.filePath.localeCompare(b.filePath);
        if (result === 0) {
          result = a.startLine - b.startLine; // Secondary sort by line
        }
        break;
      }
      case 'props': {
        const aCount = memberCounts?.get(a.id)?.properties || 0;
        const bCount = memberCounts?.get(b.id)?.properties || 0;
        result = aCount - bCount;
        if (result === 0) {
          result = a.name.localeCompare(b.name); // Secondary sort by name
        }
        break;
      }
      case 'methods': {
        const aCount = memberCounts?.get(a.id)?.methods || 0;
        const bCount = memberCounts?.get(b.id)?.methods || 0;
        result = aCount - bCount;
        if (result === 0) {
          result = a.name.localeCompare(b.name); // Secondary sort by name
        }
        break;
      }
      case 'ctors': {
        const aCount = memberCounts?.get(a.id)?.constructors || 0;
        const bCount = memberCounts?.get(b.id)?.constructors || 0;
        result = aCount - bCount;
        if (result === 0) {
          result = a.name.localeCompare(b.name); // Secondary sort by name
        }
        break;
      }
      case 'total': {
        const aCount = memberCounts?.get(a.id)?.total || 0;
        const bCount = memberCounts?.get(b.id)?.total || 0;
        result = aCount - bCount;
        if (result === 0) {
          result = a.name.localeCompare(b.name); // Secondary sort by name
        }
        break;
      }
      case 'functions': {
        // Legacy: methods + constructors for backward compatibility
        const aMethodsCount = memberCounts?.get(a.id)?.methods || 0;
        const aCtorsCount = memberCounts?.get(a.id)?.constructors || 0;
        const aCount = aMethodsCount + aCtorsCount;
        
        const bMethodsCount = memberCounts?.get(b.id)?.methods || 0;
        const bCtorsCount = memberCounts?.get(b.id)?.constructors || 0;
        const bCount = bMethodsCount + bCtorsCount;
        
        result = aCount - bCount;
        if (result === 0) {
          result = a.name.localeCompare(b.name); // Secondary sort by name
        }
        break;
      }
      case 'members': {
        // Alias for total
        const aCount = memberCounts?.get(a.id)?.total || 0;
        const bCount = memberCounts?.get(b.id)?.total || 0;
        result = aCount - bCount;
        if (result === 0) {
          result = a.name.localeCompare(b.name); // Secondary sort by name
        }
        break;
      }
      default:
        result = a.name.localeCompare(b.name);
    }
    
    return desc ? -result : result;
  });
  
  return sorted;
}

/**
 * Display types list in database format
 */
export function displayTypesListDB(
  types: TypeDefinition[],
  couplingData: Map<string, CouplingInfo>,
  memberCounts: Map<string, MemberCounts>,
  detailed?: boolean,
  showLocation?: boolean,
  showId?: boolean
): void {
  console.log(`\n📋 Found ${types.length} types:\n`);
  
  if (!detailed && types.length > 0) {
    // Table header for non-detailed output - emoji-free layout
    if (showId && showLocation) {
      console.log(`ID       KIND EXP NAME                         PROPS METHS CTORS IDX CALL TOTAL FILE                     LINE`);
      console.log(`-------- ---- --- ----------------------------- ----- ----- ----- --- ---- ----- ----------------------- ----`);
    } else if (showId) {
      console.log(`ID       KIND EXP NAME                         PROPS METHS CTORS IDX CALL TOTAL`);
      console.log(`-------- ---- --- ----------------------------- ----- ----- ----- --- ---- -----`);
    } else if (showLocation) {
      console.log(`KIND EXP NAME                         PROPS METHS CTORS IDX CALL TOTAL FILE                     LINE`);
      console.log(`---- --- ----------------------------- ----- ----- ----- --- ---- ----- ----------------------- ----`);
    } else {
      console.log(`KIND EXP NAME                         PROPS METHS CTORS IDX CALL TOTAL`);
      console.log(`---- --- ----------------------------- ----- ----- ----- --- ---- -----`);
    }
  }
  
  for (const type of types) {
    if (detailed) {
      // Detailed view with emojis (single-type display)
      const kindIcon = getTypeKindIcon(type.kind);
      const exportIcon = type.isExported ? 'EXP' : '   ';
      const genericIcon = type.isGeneric ? '<T>' : '   ';
      
      console.log(`${kindIcon} ${exportIcon} ${type.name} ${genericIcon}`);
      console.log(`   📁 ${type.filePath}:${type.startLine}`);
      console.log(`   🏷️  ${type.kind}`);
      
      const memberCount = memberCounts.get(type.id) || {
        properties: 0,
        methods: 0,
        constructors: 0,
        indexSignatures: 0,
        callSignatures: 0,
        total: 0
      };
      const functionCount = memberCount.methods + memberCount.constructors;
      console.log(`   🔢 Functions: ${functionCount} (${memberCount.methods} methods, ${memberCount.constructors} ctors)`);
      console.log(`   🔢 Members: ${memberCount.properties} props, ${memberCount.total} total`);
      
      if (couplingData.has(type.id)) {
        const coupling = couplingData.get(type.id)!;
        console.log(`   🔗 Coupling: ${coupling.totalFunctions} functions, avg usage: ${(coupling.averageUsageRatio * 100).toFixed(1)}%`);
      }
      
      console.log();
    } else {
      // Tabular view without emojis - consistent character width
      const memberCount = memberCounts.get(type.id) || {
        properties: 0,
        methods: 0,
        constructors: 0,
        indexSignatures: 0,
        callSignatures: 0,
        total: 0
      };
      
      // Use text abbreviations instead of emojis for consistent alignment
      const kindText = getTypeKindText(type.kind);
      const exportText = type.isExported ? 'EXP' : '   ';
      const nameDisplay = type.name.length > 29 ? type.name.substring(0, 26) + '...' : type.name;
      const idDisplay = type.id.substring(0, 8); // Show first 8 chars of ID
      
      // Display counts, using '-' for zero values
      const propsDisplay = memberCount.properties > 0 ? memberCount.properties.toString() : '-';
      const methsDisplay = memberCount.methods > 0 ? memberCount.methods.toString() : '-';
      const ctorsDisplay = memberCount.constructors > 0 ? memberCount.constructors.toString() : '-';
      const idxDisplay = memberCount.indexSignatures > 0 ? memberCount.indexSignatures.toString() : '-';
      const callDisplay = memberCount.callSignatures > 0 ? memberCount.callSignatures.toString() : '-';
      const totalDisplay = memberCount.total > 0 ? memberCount.total.toString() : '-';
      
      if (showId && showLocation) {
        const fileName = type.filePath.split('/').pop() || type.filePath;
        const fileDisplay = fileName.length > 23 ? fileName.substring(0, 20) + '...' : fileName;
        const lineDisplay = type.startLine.toString();
        
        console.log(
          `${idDisplay} ` +
          `${kindText.padEnd(4)} ` +
          `${exportText} ` +
          `${nameDisplay.padEnd(29)} ` +
          `${propsDisplay.padStart(5)} ` +
          `${methsDisplay.padStart(5)} ` +
          `${ctorsDisplay.padStart(5)} ` +
          `${idxDisplay.padStart(3)} ` +
          `${callDisplay.padStart(4)} ` +
          `${totalDisplay.padStart(5)} ` +
          `${fileDisplay.padEnd(23)} ` +
          `${lineDisplay.padStart(4)}`
        );
      } else if (showId) {
        console.log(
          `${idDisplay} ` +
          `${kindText.padEnd(4)} ` +
          `${exportText} ` +
          `${nameDisplay.padEnd(29)} ` +
          `${propsDisplay.padStart(5)} ` +
          `${methsDisplay.padStart(5)} ` +
          `${ctorsDisplay.padStart(5)} ` +
          `${idxDisplay.padStart(3)} ` +
          `${callDisplay.padStart(4)} ` +
          `${totalDisplay.padStart(5)}`
        );
      } else if (showLocation) {
        const fileName = type.filePath.split('/').pop() || type.filePath;
        const fileDisplay = fileName.length > 23 ? fileName.substring(0, 20) + '...' : fileName;
        const lineDisplay = type.startLine.toString();
        
        console.log(
          `${kindText.padEnd(4)} ` +
          `${exportText} ` +
          `${nameDisplay.padEnd(29)} ` +
          `${propsDisplay.padStart(5)} ` +
          `${methsDisplay.padStart(5)} ` +
          `${ctorsDisplay.padStart(5)} ` +
          `${idxDisplay.padStart(3)} ` +
          `${callDisplay.padStart(4)} ` +
          `${totalDisplay.padStart(5)} ` +
          `${fileDisplay.padEnd(23)} ` +
          `${lineDisplay.padStart(4)}`
        );
      } else {
        console.log(
          `${kindText.padEnd(4)} ` +
          `${exportText} ` +
          `${nameDisplay.padEnd(29)} ` +
          `${propsDisplay.padStart(5)} ` +
          `${methsDisplay.padStart(5)} ` +
          `${ctorsDisplay.padStart(5)} ` +
          `${idxDisplay.padStart(3)} ` +
          `${callDisplay.padStart(4)} ` +
          `${totalDisplay.padStart(5)}`
        );
      }
    }
  }
  
  if (!detailed && types.length === 0) {
    console.log('No types found matching the criteria.');
  }
}
import { TypeDefinition } from '../../../../types';
import { TypeListOptions } from '../../types.types';

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
 * Parse and validate count value
 */
function parseCountValue(value: string | undefined, fieldName: string): number {
  if (value === undefined) return NaN;
  const target = Number(value);
  if (!Number.isFinite(target) || !Number.isInteger(target) || target < 0) {
    throw new Error(`Invalid count value for ${fieldName}: ${value}. Must be a non-negative integer.`);
  }
  return target;
}

/**
 * Apply basic type filters (kind, exported, generic, file, name)
 */
export function applyBasicFilters(types: TypeDefinition[], options: TypeListOptions): TypeDefinition[] {
  let filteredTypes = types;
  
  // Kind filter
  if (options.kind) {
    const validKinds = ['interface', 'class', 'type_alias', 'enum', 'namespace'] as const;
    if (!validKinds.includes(options.kind as typeof validKinds[number])) {
      throw new Error(`Invalid kind: ${options.kind}. Valid options are: ${validKinds.join(', ')}`);
    }
    filteredTypes = filteredTypes.filter(t => t.kind === options.kind);
  }
  
  // Exported filter
  if (options.exported) {
    filteredTypes = filteredTypes.filter(t => t.isExported);
  }
  
  // Generic filter
  if (options.generic) {
    filteredTypes = filteredTypes.filter(t => t.isGeneric);
  }
  
  // File filter
  if (options.file) {
    const filePath = options.file;
    filteredTypes = filteredTypes.filter(t => t.filePath.includes(filePath));
  }
  
  // Name filter
  if (options.name) {
    const pattern = options.name.toLowerCase();
    filteredTypes = filteredTypes.filter(t => t.name.toLowerCase().includes(pattern));
  }
  
  return filteredTypes;
}

/**
 * Apply property count filters
 */
export function applyPropertyFilters(
  types: TypeDefinition[], 
  options: TypeListOptions, 
  memberCounts: Map<string, MemberCounts>
): TypeDefinition[] {
  let filteredTypes = types;
  
  const propEq = parseCountValue(options.propEq, '--prop-eq');
  if (!isNaN(propEq)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.properties || 0) === propEq);
  }
  
  const propGe = parseCountValue(options.propGe, '--prop-ge');
  if (!isNaN(propGe)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.properties || 0) >= propGe);
  }
  
  const propLe = parseCountValue(options.propLe, '--prop-le');
  if (!isNaN(propLe)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.properties || 0) <= propLe);
  }
  
  const propGt = parseCountValue(options.propGt, '--prop-gt');
  if (!isNaN(propGt)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.properties || 0) > propGt);
  }
  
  const propLt = parseCountValue(options.propLt, '--prop-lt');
  if (!isNaN(propLt)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.properties || 0) < propLt);
  }
  
  return filteredTypes;
}

/**
 * Apply method count filters
 */
export function applyMethodFilters(
  types: TypeDefinition[], 
  options: TypeListOptions, 
  memberCounts: Map<string, MemberCounts>
): TypeDefinition[] {
  let filteredTypes = types;
  
  const methEq = parseCountValue(options.methEq, '--meth-eq');
  if (!isNaN(methEq)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.methods || 0) === methEq);
  }
  
  const methGe = parseCountValue(options.methGe, '--meth-ge');
  if (!isNaN(methGe)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.methods || 0) >= methGe);
  }
  
  const methLe = parseCountValue(options.methLe, '--meth-le');
  if (!isNaN(methLe)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.methods || 0) <= methLe);
  }
  
  const methGt = parseCountValue(options.methGt, '--meth-gt');
  if (!isNaN(methGt)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.methods || 0) > methGt);
  }
  
  const methLt = parseCountValue(options.methLt, '--meth-lt');
  if (!isNaN(methLt)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.methods || 0) < methLt);
  }
  
  return filteredTypes;
}

/**
 * Apply total member count filters
 */
export function applyTotalFilters(
  types: TypeDefinition[], 
  options: TypeListOptions, 
  memberCounts: Map<string, MemberCounts>
): TypeDefinition[] {
  let filteredTypes = types;
  
  const totalEq = parseCountValue(options.totalEq, '--total-eq');
  if (!isNaN(totalEq)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.total || 0) === totalEq);
  }
  
  const totalGe = parseCountValue(options.totalGe, '--total-ge');
  if (!isNaN(totalGe)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.total || 0) >= totalGe);
  }
  
  const totalLe = parseCountValue(options.totalLe, '--total-le');
  if (!isNaN(totalLe)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.total || 0) <= totalLe);
  }
  
  const totalGt = parseCountValue(options.totalGt, '--total-gt');
  if (!isNaN(totalGt)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.total || 0) > totalGt);
  }
  
  const totalLt = parseCountValue(options.totalLt, '--total-lt');
  if (!isNaN(totalLt)) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.total || 0) < totalLt);
  }
  
  return filteredTypes;
}

/**
 * Apply legacy function count filters (methods + constructors for backward compatibility)
 */
export function applyFunctionFilters(
  types: TypeDefinition[], 
  options: TypeListOptions, 
  memberCounts: Map<string, MemberCounts>
): TypeDefinition[] {
  let filteredTypes = types;
  
  const fnEq = parseCountValue(options.fnEq, '--fn-eq');
  if (!isNaN(fnEq)) {
    filteredTypes = filteredTypes.filter(t => {
      const memberCount = memberCounts.get(t.id);
      const functionCount = (memberCount?.methods || 0) + (memberCount?.constructors || 0);
      return functionCount === fnEq;
    });
  }
  
  const fnGe = parseCountValue(options.fnGe, '--fn-ge');
  if (!isNaN(fnGe)) {
    filteredTypes = filteredTypes.filter(t => {
      const memberCount = memberCounts.get(t.id);
      const functionCount = (memberCount?.methods || 0) + (memberCount?.constructors || 0);
      return functionCount >= fnGe;
    });
  }
  
  const fnLe = parseCountValue(options.fnLe, '--fn-le');
  if (!isNaN(fnLe)) {
    filteredTypes = filteredTypes.filter(t => {
      const memberCount = memberCounts.get(t.id);
      const functionCount = (memberCount?.methods || 0) + (memberCount?.constructors || 0);
      return functionCount <= fnLe;
    });
  }
  
  const fnGt = parseCountValue(options.fnGt, '--fn-gt');
  if (!isNaN(fnGt)) {
    filteredTypes = filteredTypes.filter(t => {
      const memberCount = memberCounts.get(t.id);
      const functionCount = (memberCount?.methods || 0) + (memberCount?.constructors || 0);
      return functionCount > fnGt;
    });
  }
  
  const fnLt = parseCountValue(options.fnLt, '--fn-lt');
  if (!isNaN(fnLt)) {
    filteredTypes = filteredTypes.filter(t => {
      const memberCount = memberCounts.get(t.id);
      const functionCount = (memberCount?.methods || 0) + (memberCount?.constructors || 0);
      return functionCount < fnLt;
    });
  }
  
  return filteredTypes;
}

/**
 * Apply special filters (has index signatures, has call signatures)
 */
export function applySpecialFilters(
  types: TypeDefinition[], 
  options: TypeListOptions, 
  memberCounts: Map<string, MemberCounts>
): TypeDefinition[] {
  let filteredTypes = types;
  
  if (options.hasIndex) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.indexSignatures || 0) > 0);
  }
  
  if (options.hasCall) {
    filteredTypes = filteredTypes.filter(t => (memberCounts.get(t.id)?.callSignatures || 0) > 0);
  }
  
  return filteredTypes;
}

/**
 * Apply all type filters (unified interface)
 */
export function applyTypeFilters(
  types: TypeDefinition[],
  options: TypeListOptions,
  memberCounts: Map<string, MemberCounts>
): TypeDefinition[] {
  let filteredTypes = types;
  
  // Apply filters in logical order
  filteredTypes = applyBasicFilters(filteredTypes, options);
  filteredTypes = applyPropertyFilters(filteredTypes, options, memberCounts);
  filteredTypes = applyMethodFilters(filteredTypes, options, memberCounts);
  filteredTypes = applyTotalFilters(filteredTypes, options, memberCounts);
  filteredTypes = applyFunctionFilters(filteredTypes, options, memberCounts);
  filteredTypes = applySpecialFilters(filteredTypes, options, memberCounts);
  
  return filteredTypes;
}
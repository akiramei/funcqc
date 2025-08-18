/**
 * Common formatting utilities for types commands
 */

/**
 * Get icon for type kind
 */
export function getTypeKindIcon(kind: string): string {
  switch (kind) {
    case 'interface': return '🔗';
    case 'class': return '🏗️';
    case 'type_alias': return '🏷️';
    case 'enum': return '🔢';
    case 'namespace': return '📦';
    default: return '❓';
  }
}

/**
 * Get text representation for type kind
 */
export function getTypeKindText(kind: string): string {
  switch (kind) {
    case 'interface': return 'INTF';
    case 'class': return 'CLSS';
    case 'type_alias': return 'TYPE';
    case 'enum': return 'ENUM';
    case 'namespace': return 'NSPC';
    default: return 'UNKN';
  }
}

/**
 * Get icon for health status
 */
export function getHealthIcon(health: string): string {
  switch (health) {
    case 'EXCELLENT': return '🌟';
    case 'GOOD': return '✅';
    case 'FAIR': return '⚠️';
    case 'POOR': return '❌';
    default: return '❓';
  }
}

/**
 * Get icon for risk level
 */
export function getRiskIcon(risk: string): string {
  switch (risk) {
    case 'VERY_LOW': return '🟢';
    case 'LOW': return '🟡';
    case 'MEDIUM': return '🟠';
    case 'HIGH': return '🔴';
    case 'VERY_HIGH': return '💀';
    default: return '❓';
  }
}

/**
 * Get icon for member kind
 */
export function getMemberKindIcon(kind: string): string {
  switch (kind) {
    case 'property': return '📄';
    case 'method': return '⚙️';
    case 'constructor': return '🏗️';
    case 'accessor': return '🔧';
    case 'getter': return '🔎';
    case 'setter': return '✍️';
    case 'index_signature': return '🔤';
    case 'call_signature': return '📞';
    default: return '❓';
  }
}

/**
 * Get icon for access modifier
 */
export function getAccessModifierIcon(modifier: string | null): string {
  switch (modifier) {
    case 'public': return '🌐';
    case 'private': return '🔒';
    case 'protected': return '🛡️';
    default: return '📂'; // no modifier (default public in TypeScript)
  }
}
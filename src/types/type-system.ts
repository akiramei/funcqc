/**
 * Type system definitions for funcqc
 * These types mirror the database schema for type information storage
 */

export interface TypeDefinition {
  id: string;
  snapshotId: string;
  name: string;
  kind: 'class' | 'interface' | 'type_alias' | 'enum' | 'namespace';
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  
  // Type-specific attributes
  isAbstract: boolean;
  isExported: boolean;
  isDefaultExport: boolean;
  isGeneric: boolean;
  genericParameters: GenericParameter[];
  
  // Type content
  typeText: string | null;
  resolvedType: Record<string, unknown> | null; // JSON structure for type aliases
  
  // Metadata
  modifiers: string[];
  jsdoc: string | null;
  metadata: Record<string, unknown>;
}

export interface GenericParameter {
  name: string;
  constraint: string | null;
  default: string | null;
}

export interface TypeRelationship {
  id: string;
  snapshotId: string;
  sourceTypeId: string;
  targetTypeId: string | null;
  targetName: string;
  relationshipKind: 
    | 'extends'
    | 'implements'
    | 'union'
    | 'intersection'
    | 'generic_constraint'
    | 'type_parameter'
    | 'references';
  
  // Relationship metadata
  position: number;
  isArray: boolean;
  isOptional: boolean;
  genericArguments: string[];
  confidenceScore: number;
  metadata: Record<string, unknown>;
}

export interface TypeMember {
  id: string;
  snapshotId: string;
  typeId: string;
  name: string;
  memberKind: 
    | 'property'
    | 'method'
    | 'getter'
    | 'setter'
    | 'constructor'
    | 'index_signature'
    | 'call_signature';
  
  // Member details
  typeText: string | null;
  isOptional: boolean;
  isReadonly: boolean;
  isStatic: boolean;
  isAbstract: boolean;
  accessModifier: 'public' | 'protected' | 'private' | null;
  
  // Position info
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  
  // Function linkage
  functionId: string | null;
  
  // Metadata
  jsdoc: string | null;
  metadata: Record<string, unknown>;
}

export interface MethodOverride {
  id: string;
  snapshotId: string;
  methodMemberId: string;
  sourceTypeId: string;
  targetMemberId: string | null;
  targetTypeId: string | null;
  overrideKind: 
    | 'override'
    | 'implement'
    | 'abstract_implement'
    | 'signature_implement';
  
  // Override validation
  isCompatible: boolean;
  compatibilityErrors: string[];
  confidenceScore: number;
  metadata: Record<string, unknown>;
}

/**
 * Type extraction result containing all type information
 */
export interface TypeExtractionResult {
  typeDefinitions: TypeDefinition[];
  typeRelationships: TypeRelationship[];
  typeMembers: TypeMember[];
  methodOverrides: MethodOverride[];
}
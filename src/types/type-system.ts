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
  typeText?: string;
  resolvedType?: any; // JSON structure for type aliases
  
  // Metadata
  modifiers: string[];
  jsdoc?: string;
  metadata: Record<string, any>;
}

export interface GenericParameter {
  name: string;
  constraint?: string;
  default?: string;
}

export interface TypeRelationship {
  id: string;
  snapshotId: string;
  sourceTypeId: string;
  targetTypeId?: string;
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
  metadata: Record<string, any>;
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
  typeText?: string;
  isOptional: boolean;
  isReadonly: boolean;
  isStatic: boolean;
  isAbstract: boolean;
  accessModifier?: 'public' | 'protected' | 'private';
  
  // Position info
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  
  // Function linkage
  functionId?: string;
  
  // Metadata
  jsdoc?: string;
  metadata: Record<string, any>;
}

export interface MethodOverride {
  id: string;
  snapshotId: string;
  methodMemberId: string;
  sourceTypeId: string;
  targetMemberId?: string;
  targetTypeId?: string;
  overrideKind: 
    | 'override'
    | 'implement'
    | 'abstract_implement'
    | 'signature_implement';
  
  // Override validation
  isCompatible: boolean;
  compatibilityErrors: string[];
  confidenceScore: number;
  metadata: Record<string, any>;
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
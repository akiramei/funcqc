/**
 * Value Object Extractor
 * 
 * Identifies property clusters that should be extracted into Value Objects
 * to improve type safety, encapsulation, and code maintainability.
 */

import type { StorageQueryInterface } from '../type-insights/types';
import { PropertyCooccurrenceAnalyzer, type ValueObjectCandidate, type PropertyCooccurrenceOptions } from './property-cooccurrence';

export interface ValueObjectExtractionPlan {
  valueObject: ValueObjectDefinition;
  extractionActions: ExtractionAction[];
  generatedArtifacts: VOArtifacts;
  migrationPlan: VOMigrationPlan;
  impactAssessment: VOImpactAssessment;
}

export interface ValueObjectDefinition {
  name: string;
  properties: VOProperty[];
  invariants: Invariant[];
  methods: VOMethod[];
  constructors: VOConstructor[];
  sourceTypes: string[];           // Types this VO was extracted from
  usageFrequency: number;
  domainContext: string;           // Business domain this VO belongs to
}

export interface VOProperty {
  name: string;
  type: string;
  isReadonly: boolean;
  description: string;
  validation?: VOValidationRule;
}

export interface VOValidationRule {
  type: 'range' | 'format' | 'custom' | 'required' | 'length';
  rule: string;                    // Expression or regex
  errorMessage: string;
}

export interface Invariant {
  name: string;
  expression: string;              // TypeScript expression
  description: string;
  category: 'business_rule' | 'data_consistency' | 'boundary' | 'format';
  severity: 'error' | 'warning';
}

export interface VOMethod {
  name: string;
  returnType: string;
  parameters: VOMethodParameter[];
  body: string;                    // Method implementation
  description: string;
  category: 'accessor' | 'computation' | 'validation' | 'formatting' | 'comparison';
}

export interface VOMethodParameter {
  name: string;
  type: string;
  isOptional: boolean;
}

export interface VOConstructor {
  type: 'from_object' | 'from_primitives' | 'from_string' | 'smart_constructor';
  name: string;
  parameters: VOMethodParameter[];
  implementation: string;
  validation: boolean;             // Whether this constructor validates invariants
}

export interface ExtractionAction {
  actionType: 'create_vo_definition' | 'replace_property_group' | 'update_function_signature' | 'add_vo_usage';
  sourceLocation: {
    typeName?: string;
    functionName?: string;
    filePath: string;
    propertyNames: string[];
  };
  targetVO: string;
  transformation: CodeTransformation;
  riskLevel: 'low' | 'medium' | 'high';
  automationPossible: boolean;
}

export interface CodeTransformation {
  type: 'property_replacement' | 'parameter_grouping' | 'return_type_change' | 'field_access_update';
  originalCode: string;
  transformedCode: string;
  preservesSemantics: boolean;
  requiresAdditionalChanges: string[];
}

export interface VOArtifacts {
  typeDefinition: string;          // TypeScript interface/class
  constructorFunctions: string[];   // Factory functions
  validationFunctions: string[];   // Invariant checking functions
  utilityFunctions: string[];      // Helper methods (equals, toString, etc.)
  testTemplates: string[];         // Generated test templates
  documentationTemplate: string;   // JSDoc documentation
}

export interface VOMigrationPlan {
  strategy: 'incremental' | 'big_bang' | 'adapter_pattern';
  phases: VOMigrationPhase[];
  rollbackStrategy: string[];
  estimatedEffort: string;
  criticalPath: string[];
}

export interface VOMigrationPhase {
  phaseNumber: number;
  name: string;
  description: string;
  tasks: VOTask[];
  deliverables: string[];
  estimatedDuration: string;
  dependencies: number[];
  riskLevel: 'low' | 'medium' | 'high';
}

export interface VOTask {
  taskId: string;
  description: string;
  type: 'code_generation' | 'refactoring' | 'testing' | 'validation';
  automatable: boolean;
  estimatedEffort: string;
}

export interface VOImpactAssessment {
  typesAffected: number;
  functionsAffected: number;
  filesAffected: string[];
  benefits: VOBenefit[];
  risks: VORisk[];
  qualityImprovements: QualityImprovement[];
  maintenanceImpact: MaintenanceImpact;
}

export interface VOBenefit {
  category: 'type_safety' | 'encapsulation' | 'reusability' | 'validation' | 'testing';
  description: string;
  quantitativeImpact?: number;     // Percentage improvement
  measurementMethod: string;
}

export interface VORisk {
  category: 'breaking_change' | 'performance' | 'complexity' | 'adoption';
  description: string;
  likelihood: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  mitigation: string;
}

export interface QualityImprovement {
  metric: 'type_coverage' | 'cyclomatic_complexity' | 'coupling' | 'cohesion';
  currentValue: number;
  expectedValue: number;
  improvementPercentage: number;
}

export interface MaintenanceImpact {
  changeLocalization: number;      // 0-1, how well changes are localized
  testingComplexity: 'reduced' | 'unchanged' | 'increased';
  documentationQuality: 'improved' | 'unchanged' | 'requires_attention';
  onboardingImpact: 'positive' | 'neutral' | 'negative';
}

export interface ValueObjectExtractionOptions extends PropertyCooccurrenceOptions {
  minCohesionScore: number;        // Minimum cohesion for VO candidate
  includeComputedMethods: boolean; // Generate computed methods
  generateSmartConstructors: boolean; // Create validation constructors
  inferInvariants: boolean;        // Try to infer business rules
  preserveOriginalTypes: boolean;  // Keep original types during transition
}

export interface VOExtractionResult {
  candidates: ValueObjectExtractionPlan[];
  extractionOpportunities: ExtractionOpportunity[];
  domainAnalysis: DomainAnalysis;
  generatedCode: GeneratedVOCode[];
  migrationGuide: string;
}

export interface ExtractionOpportunity {
  id: string;
  propertyGroup: string[];
  affectedTypes: string[];
  benefitScore: number;            // 0-1, overall benefit
  extractionComplexity: 'low' | 'medium' | 'high';
  domainSignificance: 'high' | 'medium' | 'low';
  recommendationReason: string;
  prerequisites: string[];
}

export interface DomainAnalysis {
  identifiedDomains: DomainContext[];
  crossCuttingConcerns: string[];
  valueObjectPatterns: VOPattern[];
}

export interface DomainContext {
  name: string;
  types: string[];
  valueObjects: string[];
  businessRules: string[];
  commonOperations: string[];
}

export interface VOPattern {
  name: string;
  description: string;
  examples: string[];
  applicability: string;
}

export interface GeneratedVOCode {
  voName: string;
  fileName: string;
  content: string;
  category: 'type_definition' | 'constructors' | 'validators' | 'utilities' | 'tests';
}

export class ValueObjectExtractor {
  private storage: StorageQueryInterface;
  private options: Required<ValueObjectExtractionOptions>;
  private cooccurrenceAnalyzer: PropertyCooccurrenceAnalyzer;

  constructor(
    storage: StorageQueryInterface,
    options: Partial<ValueObjectExtractionOptions> = {}
  ) {
    this.storage = storage;
    this.options = {
      ...this.getDefaultOptions(),
      ...options
    } as Required<ValueObjectExtractionOptions>;

    this.cooccurrenceAnalyzer = new PropertyCooccurrenceAnalyzer(storage, this.options);
  }

  private getDefaultOptions(): Required<ValueObjectExtractionOptions> {
    return {
      minSupport: 3,
      minConfidence: 0.7,
      maxPatternSize: 4,
      includeOptionalProperties: false,
      excludeCommonProperties: ['id', 'createdAt', 'updatedAt', 'version'],
      minCohesionScore: 0.6,
      includeComputedMethods: true,
      generateSmartConstructors: true,
      inferInvariants: true,
      preserveOriginalTypes: true
    };
  }

  /**
   * Analyze types and extract Value Object candidates
   */
  async extract(snapshotId?: string): Promise<VOExtractionResult> {
    // Analyze property co-occurrence patterns
    const cooccurrenceResult = await this.cooccurrenceAnalyzer.analyze(snapshotId);

    // Filter candidates based on cohesion and other criteria
    const qualifiedCandidates = this.filterValueObjectCandidates(
      cooccurrenceResult.valueObjectCandidates
    );

    // Generate extraction plans for each candidate
    const extractionPlans = await this.generateExtractionPlans(
      qualifiedCandidates,
      snapshotId
    );

    // Identify additional extraction opportunities
    const extractionOpportunities = this.identifyExtractionOpportunities(
      cooccurrenceResult.patterns,
      cooccurrenceResult.propertyStats
    );

    // Analyze domain contexts
    const domainAnalysis = this.analyzeDomainContexts(
      qualifiedCandidates,
      cooccurrenceResult.patterns
    );

    // Generate code for all Value Objects
    const generatedCode = this.generateAllVOCode(extractionPlans);

    // Create migration guide
    const migrationGuide = this.createMigrationGuide(extractionPlans);

    return {
      candidates: extractionPlans,
      extractionOpportunities,
      domainAnalysis,
      generatedCode,
      migrationGuide
    };
  }

  /**
   * Filter VO candidates based on quality criteria
   */
  private filterValueObjectCandidates(candidates: ValueObjectCandidate[]): ValueObjectCandidate[] {
    return candidates.filter(candidate => {
      // Must meet minimum cohesion score
      if (candidate.cohesionScore < this.options.minCohesionScore) return false;

      // Must have reasonable property count (2-5 properties)
      if (candidate.propertyGroup.length < 2 || candidate.propertyGroup.length > 5) return false;

      // Must be used in multiple places
      if (candidate.usageSites < this.options.minSupport) return false;

      // Should not be just common CRUD properties
      const excludedSet = new Set(this.options.excludeCommonProperties);
      const significantProps = candidate.propertyGroup.filter(prop => !excludedSet.has(prop));
      if (significantProps.length === 0) return false;

      return true;
    });
  }

  /**
   * Generate extraction plans for qualified candidates
   */
  private async generateExtractionPlans(
    candidates: ValueObjectCandidate[],
    snapshotId?: string
  ): Promise<ValueObjectExtractionPlan[]> {
    const plans: ValueObjectExtractionPlan[] = [];

    for (const candidate of candidates) {
      try {
        const plan = await this.createExtractionPlan(candidate, snapshotId);
        if (plan) {
          plans.push(plan);
        }
      } catch (error) {
        console.warn(`Failed to create extraction plan for ${candidate.groupName}:`, error);
      }
    }

    return plans.sort((a, b) => 
      b.impactAssessment.benefits.length - a.impactAssessment.benefits.length
    );
  }

  /**
   * Create extraction plan for a specific VO candidate
   */
  private async createExtractionPlan(
    candidate: ValueObjectCandidate,
    snapshotId?: string
  ): Promise<ValueObjectExtractionPlan | null> {
    // Create Value Object definition
    const valueObject = await this.createValueObjectDefinition(candidate, snapshotId);

    // Generate extraction actions
    const extractionActions = await this.generateExtractionActions(candidate, valueObject, snapshotId);

    // Generate artifacts
    const generatedArtifacts = this.generateVOArtifacts(valueObject);

    // Create migration plan
    const migrationPlan = this.createVOMigrationPlan(candidate, extractionActions);

    // Assess impact
    const impactAssessment = await this.assessVOImpact(candidate, extractionActions, snapshotId);

    return {
      valueObject,
      extractionActions,
      generatedArtifacts,
      migrationPlan,
      impactAssessment
    };
  }

  /**
   * Create Value Object definition from candidate
   */
  private async createValueObjectDefinition(
    candidate: ValueObjectCandidate,
    snapshotId?: string
  ): Promise<ValueObjectDefinition> {
    // Analyze property types from database
    const propertyDetails = await this.analyzePropertyDetails(candidate.propertyGroup, snapshotId);

    // Create VO properties
    const properties = this.createVOProperties(propertyDetails);

    // Infer invariants
    const invariants = this.options.inferInvariants 
      ? this.inferValueObjectInvariants(candidate, propertyDetails)
      : [];

    // Generate methods
    const methods = this.options.includeComputedMethods
      ? this.generateVOMethods(candidate, properties)
      : [];

    // Generate constructors
    const constructors = this.options.generateSmartConstructors
      ? this.generateVOConstructors(candidate, properties, invariants)
      : [];

    // Determine domain context
    const domainContext = this.inferDomainContext(candidate);

    return {
      name: candidate.groupName,
      properties,
      invariants,
      methods,
      constructors,
      sourceTypes: candidate.types,
      usageFrequency: candidate.usageSites,
      domainContext
    };
  }

  /**
   * Analyze property details from database
   */
  private async analyzePropertyDetails(
    properties: string[],
    snapshotId?: string
  ): Promise<Map<string, PropertyDetail[]>> {
    const query = snapshotId
      ? `SELECT tm.member_name, tm.member_type, tm.is_optional, td.name as type_name, td.file_path
         FROM type_members tm
         JOIN type_definitions td ON tm.type_id = td.id
         WHERE tm.member_name = ANY($1) AND td.snapshot_id = $2 AND tm.member_kind = 'property'`
      : `SELECT tm.member_name, tm.member_type, tm.is_optional, td.name as type_name, td.file_path
         FROM type_members tm
         JOIN type_definitions td ON tm.type_id = td.id
         WHERE tm.member_name = ANY($1) AND tm.member_kind = 'property'`;

    const params = snapshotId ? [properties, snapshotId] : [properties];
    const result = await this.storage.query(query, params);

    const propertyDetailsMap = new Map<string, PropertyDetail[]>();

    for (const row of result.rows) {
      const rowData = row as Record<string, unknown>;
      const propertyName = rowData['member_name'] as string;

      if (!propertyDetailsMap.has(propertyName)) {
        propertyDetailsMap.set(propertyName, []);
      }

      propertyDetailsMap.get(propertyName)!.push({
        name: propertyName,
        type: rowData['member_type'] as string,
        isOptional: rowData['is_optional'] as boolean,
        typeName: rowData['type_name'] as string,
        filePath: rowData['file_path'] as string
      });
    }

    return propertyDetailsMap;
  }

  /**
   * Create VO properties from property details
   */
  private createVOProperties(propertyDetails: Map<string, PropertyDetail[]>): VOProperty[] {
    const properties: VOProperty[] = [];

    for (const [propertyName, details] of propertyDetails) {
      // Find the most common type across all usages
      const typeFrequency = new Map<string, number>();
      for (const detail of details) {
        const count = typeFrequency.get(detail.type) || 0;
        typeFrequency.set(detail.type, count + 1);
      }

      const mostCommonType = Array.from(typeFrequency.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

      // Create validation rule if applicable
      const validation = this.inferValidationRule(propertyName, mostCommonType);

      properties.push({
        name: propertyName,
        type: mostCommonType,
        isReadonly: true, // VOs should typically be immutable
        description: this.generatePropertyDescription(propertyName, mostCommonType),
        ...(validation && { validation })
      });
    }

    return properties;
  }

  /**
   * Infer validation rule for property
   */
  private inferValidationRule(propertyName: string, type: string): VOValidationRule | undefined {
    // Common validation patterns
    if (propertyName.includes('email')) {
      return {
        type: 'format',
        rule: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
        errorMessage: 'Invalid email format'
      };
    }

    if (propertyName.includes('amount') || propertyName.includes('price')) {
      return {
        type: 'range',
        rule: 'value >= 0',
        errorMessage: 'Amount must be non-negative'
      };
    }

    if (propertyName.includes('count') || propertyName.includes('quantity')) {
      return {
        type: 'range',
        rule: 'value >= 0 && Number.isInteger(value)',
        errorMessage: 'Count must be a non-negative integer'
      };
    }

    if (type === 'string' && (propertyName.includes('id') || propertyName.includes('code'))) {
      return {
        type: 'length',
        rule: 'value.length > 0',
        errorMessage: 'ID cannot be empty'
      };
    }

    return undefined;
  }

  /**
   * Generate property description
   */
  private generatePropertyDescription(propertyName: string, type: string): string {
    // Simple heuristic-based description generation
    const descriptions: Record<string, string> = {
      amount: 'The monetary amount',
      currency: 'The currency code (e.g., USD, EUR)',
      start: 'The start timestamp',
      end: 'The end timestamp',
      lat: 'The latitude coordinate',
      lng: 'The longitude coordinate',
      width: 'The width dimension',
      height: 'The height dimension',
      email: 'The email address',
      phone: 'The phone number',
      count: 'The count or quantity',
      name: 'The name identifier'
    };

    return descriptions[propertyName.toLowerCase()] || 
           `The ${propertyName} of type ${type}`;
  }

  /**
   * Infer invariants for Value Object
   */
  private inferValueObjectInvariants(
    candidate: ValueObjectCandidate,
    _propertyDetails: Map<string, PropertyDetail[]>
  ): Invariant[] {
    const invariants: Invariant[] = [];

    const properties = candidate.propertyGroup;

    // Temporal invariants
    if (properties.includes('start') && properties.includes('end')) {
      invariants.push({
        name: 'temporal_order',
        expression: 'this.start <= this.end',
        description: 'Start time must be before or equal to end time',
        category: 'business_rule',
        severity: 'error'
      });
    }

    // Spatial invariants
    if (properties.includes('lat') && properties.includes('lng')) {
      invariants.push({
        name: 'valid_latitude',
        expression: 'this.lat >= -90 && this.lat <= 90',
        description: 'Latitude must be between -90 and 90 degrees',
        category: 'boundary',
        severity: 'error'
      });
      invariants.push({
        name: 'valid_longitude',
        expression: 'this.lng >= -180 && this.lng <= 180',
        description: 'Longitude must be between -180 and 180 degrees',
        category: 'boundary',
        severity: 'error'
      });
    }

    // Dimensional invariants
    if (properties.includes('width') && properties.includes('height')) {
      invariants.push({
        name: 'positive_dimensions',
        expression: 'this.width > 0 && this.height > 0',
        description: 'Dimensions must be positive values',
        category: 'boundary',
        severity: 'error'
      });
    }

    // Monetary invariants
    if (properties.includes('amount') && properties.includes('currency')) {
      invariants.push({
        name: 'non_negative_amount',
        expression: 'this.amount >= 0',
        description: 'Amount must be non-negative',
        category: 'business_rule',
        severity: 'error'
      });
      invariants.push({
        name: 'valid_currency',
        expression: 'this.currency.length === 3',
        description: 'Currency must be a 3-letter ISO code',
        category: 'format',
        severity: 'error'
      });
    }

    return invariants;
  }

  /**
   * Generate methods for Value Object
   */
  private generateVOMethods(candidate: ValueObjectCandidate, properties: VOProperty[]): VOMethod[] {
    const methods: VOMethod[] = [];

    // Always generate equals method
    methods.push({
      name: 'equals',
      returnType: 'boolean',
      parameters: [{ name: 'other', type: candidate.groupName, isOptional: false }],
      body: this.generateEqualsMethod(properties),
      description: 'Check equality with another instance',
      category: 'comparison'
    });

    // Always generate toString method
    methods.push({
      name: 'toString',
      returnType: 'string',
      parameters: [],
      body: this.generateToStringMethod(properties),
      description: 'Convert to string representation',
      category: 'formatting'
    });

    // Generate domain-specific methods
    const domainMethods = this.generateDomainSpecificMethods(candidate, properties);
    methods.push(...domainMethods);

    return methods;
  }

  /**
   * Generate equals method implementation
   */
  private generateEqualsMethod(properties: VOProperty[]): string {
    const comparisons = properties.map(prop => 
      `this.${prop.name} === other.${prop.name}`
    ).join(' && ');

    return `return ${comparisons};`;
  }

  /**
   * Generate toString method implementation
   */
  private generateToStringMethod(properties: VOProperty[]): string {
    const propertyStrings = properties.map(prop =>
      `${prop.name}: \${this.${prop.name}}`
    ).join(', ');

    return `return \`ValueObject(${propertyStrings})\`;`;
  }

  /**
   * Generate domain-specific methods
   */
  private generateDomainSpecificMethods(
    candidate: ValueObjectCandidate,
    properties: VOProperty[]
  ): VOMethod[] {
    const methods: VOMethod[] = [];
    const propertyNames = properties.map(p => p.name);

    // Temporal methods
    if (propertyNames.includes('start') && propertyNames.includes('end')) {
      methods.push({
        name: 'getDuration',
        returnType: 'number',
        parameters: [],
        body: 'return this.end - this.start;',
        description: 'Calculate duration in milliseconds',
        category: 'computation'
      });

      methods.push({
        name: 'contains',
        returnType: 'boolean',
        parameters: [{ name: 'timestamp', type: 'number', isOptional: false }],
        body: 'return timestamp >= this.start && timestamp <= this.end;',
        description: 'Check if timestamp is within this time range',
        category: 'computation'
      });
    }

    // Spatial methods
    if (propertyNames.includes('lat') && propertyNames.includes('lng')) {
      methods.push({
        name: 'distanceTo',
        returnType: 'number',
        parameters: [{ name: 'other', type: candidate.groupName, isOptional: false }],
        body: this.generateDistanceCalculation(),
        description: 'Calculate distance to another coordinate in kilometers',
        category: 'computation'
      });
    }

    // Dimensional methods
    if (propertyNames.includes('width') && propertyNames.includes('height')) {
      methods.push({
        name: 'getArea',
        returnType: 'number',
        parameters: [],
        body: 'return this.width * this.height;',
        description: 'Calculate area',
        category: 'computation'
      });

      methods.push({
        name: 'getAspectRatio',
        returnType: 'number',
        parameters: [],
        body: 'return this.width / this.height;',
        description: 'Calculate aspect ratio',
        category: 'computation'
      });
    }

    return methods;
  }

  /**
   * Generate distance calculation (Haversine formula)
   */
  private generateDistanceCalculation(): string {
    return `
const R = 6371; // Earth's radius in kilometers
const dLat = (other.lat - this.lat) * Math.PI / 180;
const dLng = (other.lng - this.lng) * Math.PI / 180;
const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(this.lat * Math.PI / 180) * Math.cos(other.lat * Math.PI / 180) *
          Math.sin(dLng/2) * Math.sin(dLng/2);
const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
return R * c;`;
  }

  /**
   * Generate constructors for Value Object
   */
  private generateVOConstructors(
    candidate: ValueObjectCandidate,
    properties: VOProperty[],
    invariants: Invariant[]
  ): VOConstructor[] {
    const constructors: VOConstructor[] = [];

    // Basic constructor from primitives
    constructors.push({
      type: 'from_primitives',
      name: 'create',
      parameters: properties.map(prop => ({
        name: prop.name,
        type: prop.type,
        isOptional: false
      })),
      implementation: this.generateBasicConstructor(candidate, properties, invariants),
      validation: invariants.length > 0
    });

    // Smart constructor with validation
    if (invariants.length > 0) {
      constructors.push({
        type: 'smart_constructor',
        name: 'createSafe',
        parameters: properties.map(prop => ({
          name: prop.name,
          type: prop.type,
          isOptional: false
        })),
        implementation: this.generateSmartConstructor(candidate, properties, invariants),
        validation: true
      });
    }

    // String constructor for common patterns
    if (this.shouldGenerateStringConstructor(properties)) {
      constructors.push({
        type: 'from_string',
        name: 'fromString',
        parameters: [{ name: 'input', type: 'string', isOptional: false }],
        implementation: this.generateStringConstructor(candidate, properties),
        validation: true
      });
    }

    return constructors;
  }

  /**
   * Generate basic constructor implementation
   */
  private generateBasicConstructor(
    _candidate: ValueObjectCandidate,
    properties: VOProperty[],
    invariants: Invariant[]
  ): string {
    const assignments = properties.map(prop => 
      `  this.${prop.name} = ${prop.name};`
    ).join('\n');

    const validations = invariants.length > 0 
      ? '\n  this.validate();' 
      : '';

    return `constructor(${properties.map(p => `${p.name}: ${p.type}`).join(', ')}) {
${assignments}${validations}
}`;
  }

  /**
   * Generate smart constructor implementation
   */
  private generateSmartConstructor(
    candidate: ValueObjectCandidate,
    properties: VOProperty[],
    invariants: Invariant[]
  ): string {
    const validations = invariants.map(inv =>
      `  if (!(${inv.expression.replace(/this\./g, '')})) {
    throw new Error('${inv.description}');
  }`
    ).join('\n');

    const basicCall = properties.map(p => p.name).join(', ');

    return `static createSafe(${properties.map(p => `${p.name}: ${p.type}`).join(', ')}): ${candidate.groupName} {
${validations}
  return new ${candidate.groupName}(${basicCall});
}`;
  }

  /**
   * Check if string constructor should be generated
   */
  private shouldGenerateStringConstructor(properties: VOProperty[]): boolean {
    // Generate string constructor for certain patterns
    const propertyNames = properties.map(p => p.name);
    
    return (
      (propertyNames.includes('lat') && propertyNames.includes('lng')) ||
      (propertyNames.includes('amount') && propertyNames.includes('currency')) ||
      properties.length <= 3 // Simple VOs can often be parsed from strings
    );
  }

  /**
   * Generate string constructor implementation
   */
  private generateStringConstructor(
    candidate: ValueObjectCandidate,
    properties: VOProperty[]
  ): string {
    const propertyNames = properties.map(p => p.name);

    // Coordinate pattern
    if (propertyNames.includes('lat') && propertyNames.includes('lng')) {
      return `static fromString(input: string): ${candidate.groupName} {
  const parts = input.split(',').map(s => parseFloat(s.trim()));
  if (parts.length !== 2 || parts.some(isNaN)) {
    throw new Error('Invalid coordinate format. Expected: "lat,lng"');
  }
  return new ${candidate.groupName}(parts[0], parts[1]);
}`;
    }

    // Money pattern
    if (propertyNames.includes('amount') && propertyNames.includes('currency')) {
      return `static fromString(input: string): ${candidate.groupName} {
  const match = input.match(/^([0-9.]+)\\s*([A-Z]{3})$/);
  if (!match) {
    throw new Error('Invalid money format. Expected: "123.45 USD"');
  }
  return new ${candidate.groupName}(parseFloat(match[1]), match[2]);
}`;
    }

    // Generic pattern - comma-separated values
    return `static fromString(input: string): ${candidate.groupName} {
  const parts = input.split(',').map(s => s.trim());
  if (parts.length !== ${properties.length}) {
    throw new Error('Invalid format. Expected ${properties.length} comma-separated values');
  }
  return new ${candidate.groupName}(${properties.map((_, i) => 
    properties[i].type === 'number' ? `parseFloat(parts[${i}])` : `parts[${i}]`
  ).join(', ')});
}`;
  }

  /**
   * Infer domain context for VO
   */
  private inferDomainContext(candidate: ValueObjectCandidate): string {
    const properties = candidate.propertyGroup;

    // Domain patterns
    if (properties.some(p => ['amount', 'currency', 'price'].includes(p))) {
      return 'Finance';
    }
    if (properties.some(p => ['lat', 'lng', 'coordinate'].includes(p))) {
      return 'Geography';
    }
    if (properties.some(p => ['start', 'end', 'duration'].includes(p))) {
      return 'Temporal';
    }
    if (properties.some(p => ['width', 'height', 'dimension'].includes(p))) {
      return 'Geometry';
    }
    if (properties.some(p => ['email', 'phone', 'contact'].includes(p))) {
      return 'Contact';
    }

    return 'General';
  }

  /**
   * Generate extraction actions
   */
  private async generateExtractionActions(
    candidate: ValueObjectCandidate,
    valueObject: ValueObjectDefinition,
    snapshotId?: string
  ): Promise<ExtractionAction[]> {
    const actions: ExtractionAction[] = [];

    // Create VO definition action
    actions.push({
      actionType: 'create_vo_definition',
      sourceLocation: {
        filePath: `src/value-objects/${valueObject.name}.ts`,
        propertyNames: candidate.propertyGroup
      },
      targetVO: valueObject.name,
      transformation: {
        type: 'property_replacement',
        originalCode: '',
        transformedCode: this.generateVOFileContent(valueObject),
        preservesSemantics: true,
        requiresAdditionalChanges: []
      },
      riskLevel: 'low',
      automationPossible: true
    });

    // Generate actions for each type that uses this property group
    for (const typeName of candidate.types) {
      const replaceAction = await this.generateReplaceAction(
        typeName,
        candidate,
        valueObject,
        snapshotId
      );
      if (replaceAction) {
        actions.push(replaceAction);
      }
    }

    return actions;
  }

  /**
   * Generate replacement action for a specific type
   */
  private async generateReplaceAction(
    typeName: string,
    candidate: ValueObjectCandidate,
    valueObject: ValueObjectDefinition,
    snapshotId?: string
  ): Promise<ExtractionAction | null> {
    try {
      // Get type definition
      const typeInfo = await this.getTypeDefinition(typeName, snapshotId);
      if (!typeInfo) return null;

      return {
        actionType: 'replace_property_group',
        sourceLocation: {
          typeName,
          filePath: typeInfo.file_path,
          propertyNames: candidate.propertyGroup
        },
        targetVO: valueObject.name,
        transformation: {
          type: 'property_replacement',
          originalCode: this.generateOriginalPropertiesCode(candidate.propertyGroup),
          transformedCode: `${candidate.propertyGroup[0]}: ${valueObject.name};`,
          preservesSemantics: true,
          requiresAdditionalChanges: [
            'Update imports',
            'Update constructor calls',
            'Update property access'
          ]
        },
        riskLevel: 'medium',
        automationPossible: true
      };
    } catch (error) {
      console.warn(`Failed to generate replace action for ${typeName}:`, error);
      return null;
    }
  }

  /**
   * Get type definition from database
   */
  private async getTypeDefinition(typeName: string, snapshotId?: string): Promise<any> {
    const query = snapshotId
      ? `SELECT * FROM type_definitions WHERE name = $1 AND snapshot_id = $2`
      : `SELECT * FROM type_definitions WHERE name = $1 ORDER BY created_at DESC LIMIT 1`;

    const params = snapshotId ? [typeName, snapshotId] : [typeName];
    const result = await this.storage.query(query, params);

    return result.rows[0] || null;
  }

  /**
   * Generate original properties code
   */
  private generateOriginalPropertiesCode(properties: string[]): string {
    return properties.map(prop => `${prop}: string; // placeholder type`).join('\n  ');
  }

  /**
   * Generate VO file content
   */
  private generateVOFileContent(vo: ValueObjectDefinition): string {
    const propertyDefs = vo.properties.map(prop =>
      `readonly ${prop.name}: ${prop.type};`
    ).join('\n  ');

    const constructorParams = vo.properties.map(prop =>
      `${prop.name}: ${prop.type}`
    ).join(', ');

    const constructorAssignments = vo.properties.map(prop =>
      `this.${prop.name} = ${prop.name};`
    ).join('\n    ');

    const methods = vo.methods.map(method =>
      `${method.name}(${method.parameters.map(p => `${p.name}: ${p.type}`).join(', ')}): ${method.returnType} {
    ${method.body}
  }`
    ).join('\n\n  ');

    return `/**
 * ${vo.name} Value Object
 * Domain: ${vo.domainContext}
 */
export class ${vo.name} {
  ${propertyDefs}

  constructor(${constructorParams}) {
    ${constructorAssignments}
    ${vo.invariants.length > 0 ? 'this.validate();' : ''}
  }

  ${methods}

  ${vo.invariants.length > 0 ? this.generateValidateMethod(vo.invariants) : ''}
}`;
  }

  /**
   * Generate validate method
   */
  private generateValidateMethod(invariants: Invariant[]): string {
    const validations = invariants.map(inv =>
      `if (!(${inv.expression})) {
      throw new Error('${inv.description}');
    }`
    ).join('\n    ');

    return `private validate(): void {
    ${validations}
  }`;
  }

  /**
   * Generate VO artifacts
   */
  private generateVOArtifacts(vo: ValueObjectDefinition): VOArtifacts {
    return {
      typeDefinition: this.generateVOFileContent(vo),
      constructorFunctions: vo.constructors.map(ctor => ctor.implementation),
      validationFunctions: vo.invariants.map(inv => this.generateValidationFunction(inv)),
      utilityFunctions: this.generateUtilityFunctions(vo),
      testTemplates: this.generateTestTemplates(vo),
      documentationTemplate: this.generateDocumentation(vo)
    };
  }

  /**
   * Generate validation function for invariant
   */
  private generateValidationFunction(invariant: Invariant): string {
    return `export function validate${invariant.name}(vo: any): boolean {
  return ${invariant.expression.replace(/this\./g, 'vo.')};
}`;
  }

  /**
   * Generate utility functions
   */
  private generateUtilityFunctions(vo: ValueObjectDefinition): string[] {
    return [
      `// Equality comparison
export function equals${vo.name}(a: ${vo.name}, b: ${vo.name}): boolean {
  return a.equals(b);
}`,
      
      `// Hash function
export function hash${vo.name}(vo: ${vo.name}): string {
  return vo.toString();
}`
    ];
  }

  /**
   * Generate test templates
   */
  private generateTestTemplates(vo: ValueObjectDefinition): string[] {
    return [
      this.generateUnitTestTemplate(vo),
      this.generateInvariantTestTemplate(vo),
      this.generateMethodTestTemplate(vo)
    ];
  }

  /**
   * Generate unit test template
   */
  private generateUnitTestTemplate(vo: ValueObjectDefinition): string {
    const sampleValues = vo.properties.map(prop =>
      this.generateSampleValue(prop)
    ).join(', ');

    return `describe('${vo.name}', () => {
  describe('construction', () => {
    it('should create valid instance', () => {
      const vo = new ${vo.name}(${sampleValues});
      expect(vo).toBeDefined();
      ${vo.properties.map(prop =>
        `expect(vo.${prop.name}).toBe(${this.generateSampleValue(prop)});`
      ).join('\n      ')}
    });
  });
});`;
  }

  /**
   * Generate sample value for property
   */
  private generateSampleValue(prop: VOProperty): string {
    switch (prop.type) {
      case 'string': return `'sample_${prop.name}'`;
      case 'number': return '42';
      case 'boolean': return 'true';
      default: return `'${prop.name}_value'`;
    }
  }

  /**
   * Generate invariant test template
   */
  private generateInvariantTestTemplate(vo: ValueObjectDefinition): string {
    if (vo.invariants.length === 0) return '';

    const invariantTests = vo.invariants.map(inv => `
    it('should enforce ${inv.name}', () => {
      // Test valid case
      // expect(() => new ${vo.name}(validValues)).not.toThrow();
      
      // Test invalid case
      // expect(() => new ${vo.name}(invalidValues)).toThrow('${inv.description}');
    });`).join('');

    return `  describe('invariants', () => {${invariantTests}
  });`;
  }

  /**
   * Generate method test template
   */
  private generateMethodTestTemplate(vo: ValueObjectDefinition): string {
    if (vo.methods.length === 0) return '';

    const methodTests = vo.methods.map(method => `
    it('should ${method.description.toLowerCase()}', () => {
      const vo = new ${vo.name}(${vo.properties.map(() => 'sampleValue').join(', ')});
      const result = vo.${method.name}(${method.parameters.map(() => 'param').join(', ')});
      expect(result).toBeDefined();
    });`).join('');

    return `  describe('methods', () => {${methodTests}
  });`;
  }

  /**
   * Generate documentation
   */
  private generateDocumentation(vo: ValueObjectDefinition): string {
    return `# ${vo.name} Value Object

## Overview
${vo.name} is a Value Object in the ${vo.domainContext} domain.

## Properties
${vo.properties.map(prop => `- **${prop.name}**: ${prop.type} - ${prop.description}`).join('\n')}

## Invariants
${vo.invariants.map(inv => `- **${inv.name}**: ${inv.description}`).join('\n')}

## Methods
${vo.methods.map(method => `- **${method.name}**: ${method.description}`).join('\n')}

## Usage
\`\`\`typescript
const vo = new ${vo.name}(${vo.properties.map(p => `${this.generateSampleValue(p)}`).join(', ')});
\`\`\`
`;
  }

  /**
   * Create migration plan
   */
  private createVOMigrationPlan(
    candidate: ValueObjectCandidate,
    _actions: ExtractionAction[]
  ): VOMigrationPlan {
    const phases: VOMigrationPhase[] = [
      {
        phaseNumber: 1,
        name: 'Value Object Creation',
        description: 'Create the Value Object definition and supporting code',
        tasks: [
          {
            taskId: 'create_vo_def',
            description: 'Generate Value Object class definition',
            type: 'code_generation',
            automatable: true,
            estimatedEffort: '2 hours'
          },
          {
            taskId: 'create_tests',
            description: 'Create unit tests for Value Object',
            type: 'testing',
            automatable: true,
            estimatedEffort: '3 hours'
          }
        ],
        deliverables: ['VO class file', 'Unit test file', 'Documentation'],
        estimatedDuration: '1 day',
        dependencies: [],
        riskLevel: 'low'
      },
      {
        phaseNumber: 2,
        name: 'Type Integration',
        description: 'Replace property groups with Value Object in existing types',
        tasks: [
          {
            taskId: 'update_types',
            description: 'Update type definitions to use Value Object',
            type: 'refactoring',
            automatable: true,
            estimatedEffort: `${candidate.types.length} hours`
          },
          {
            taskId: 'update_functions',
            description: 'Update functions that use affected types',
            type: 'refactoring',
            automatable: false,
            estimatedEffort: `${candidate.usageSites * 0.5} hours`
          }
        ],
        deliverables: ['Updated type definitions', 'Updated function signatures'],
        estimatedDuration: '2-3 days',
        dependencies: [1],
        riskLevel: 'medium'
      },
      {
        phaseNumber: 3,
        name: 'Validation and Cleanup',
        description: 'Validate changes and perform cleanup',
        tasks: [
          {
            taskId: 'integration_tests',
            description: 'Run integration tests',
            type: 'testing',
            automatable: true,
            estimatedEffort: '2 hours'
          },
          {
            taskId: 'cleanup',
            description: 'Remove unused code and update documentation',
            type: 'refactoring',
            automatable: false,
            estimatedEffort: '2 hours'
          }
        ],
        deliverables: ['Test results', 'Updated documentation'],
        estimatedDuration: '1 day',
        dependencies: [2],
        riskLevel: 'low'
      }
    ];

    return {
      strategy: candidate.extractionComplexity === 'low' ? 'big_bang' : 'incremental',
      phases,
      rollbackStrategy: [
        'Revert type definition changes',
        'Restore original property definitions',
        'Remove Value Object files'
      ],
      estimatedEffort: `${phases.reduce((sum, phase) => {
        const days = parseInt(phase.estimatedDuration);
        return sum + days;
      }, 0)}-${phases.length * 2} days`,
      criticalPath: ['create_vo_def', 'update_types', 'integration_tests']
    };
  }

  /**
   * Assess VO impact
   */
  private async assessVOImpact(
    candidate: ValueObjectCandidate,
    actions: ExtractionAction[],
    snapshotId?: string
  ): Promise<VOImpactAssessment> {
    const typesAffected = candidate.types.length;
    const functionsAffected = await this.countAffectedFunctions(candidate, snapshotId);
    const filesAffected = await this.getAffectedFiles(candidate, snapshotId);

    const benefits = this.generateVOBenefits(candidate);
    const risks = this.generateVORisks(candidate, actions);
    const qualityImprovements = this.generateQualityImprovements(candidate);
    const maintenanceImpact = this.assessMaintenanceImpact(candidate);

    return {
      typesAffected,
      functionsAffected,
      filesAffected,
      benefits,
      risks,
      qualityImprovements,
      maintenanceImpact
    };
  }

  /**
   * Count affected functions
   */
  private async countAffectedFunctions(candidate: ValueObjectCandidate, _snapshotId?: string): Promise<number> {
    // Simplified - would query actual function usage
    return candidate.usageSites * 2; // Estimate
  }

  /**
   * Get affected files
   */
  private async getAffectedFiles(candidate: ValueObjectCandidate, _snapshotId?: string): Promise<string[]> {
    // Simplified - would query actual file paths
    return candidate.types.map(type => `src/types/${type}.ts`);
  }

  /**
   * Generate VO benefits
   */
  private generateVOBenefits(candidate: ValueObjectCandidate): VOBenefit[] {
    return [
      {
        category: 'type_safety',
        description: 'Improved type safety through encapsulation',
        quantitativeImpact: 25,
        measurementMethod: 'Type error reduction percentage'
      },
      {
        category: 'encapsulation',
        description: 'Better data encapsulation and invariant enforcement',
        quantitativeImpact: 30,
        measurementMethod: 'Number of invariants enforced'
      },
      {
        category: 'reusability',
        description: 'Increased code reusability through standardized VO',
        quantitativeImpact: candidate.usageSites * 10,
        measurementMethod: 'Usage site count improvement'
      }
    ];
  }

  /**
   * Generate VO risks
   */
  private generateVORisks(candidate: ValueObjectCandidate, _actions: ExtractionAction[]): VORisk[] {
    const risks: VORisk[] = [];

    if (candidate.extractionComplexity === 'high') {
      risks.push({
        category: 'complexity',
        description: 'High extraction complexity may lead to implementation errors',
        likelihood: 'medium',
        impact: 'medium',
        mitigation: 'Thorough testing and code review'
      });
    }

    if (candidate.usageSites > 20) {
      risks.push({
        category: 'breaking_change',
        description: 'Large number of usage sites increases breaking change risk',
        likelihood: 'high',
        impact: 'medium',
        mitigation: 'Gradual migration strategy with adapter pattern'
      });
    }

    return risks;
  }

  /**
   * Generate quality improvements
   */
  private generateQualityImprovements(candidate: ValueObjectCandidate): QualityImprovement[] {
    return [
      {
        metric: 'cohesion',
        currentValue: 0.5,
        expectedValue: candidate.cohesionScore,
        improvementPercentage: (candidate.cohesionScore - 0.5) * 100
      }
    ];
  }

  /**
   * Assess maintenance impact
   */
  private assessMaintenanceImpact(candidate: ValueObjectCandidate): MaintenanceImpact {
    return {
      changeLocalization: candidate.cohesionScore,
      testingComplexity: candidate.extractionComplexity === 'low' ? 'reduced' : 'unchanged',
      documentationQuality: 'improved',
      onboardingImpact: 'positive'
    };
  }

  // Additional helper methods would be implemented here...

  /**
   * Identify extraction opportunities
   */
  private identifyExtractionOpportunities(
    _patterns: any[],
    _propertyStats: any[]
  ): ExtractionOpportunity[] {
    // Implementation for identifying additional opportunities
    return [];
  }

  /**
   * Analyze domain contexts
   */
  private analyzeDomainContexts(
    _candidates: ValueObjectCandidate[],
    _patterns: any[]
  ): DomainAnalysis {
    // Implementation for domain analysis
    return {
      identifiedDomains: [],
      crossCuttingConcerns: [],
      valueObjectPatterns: []
    };
  }

  /**
   * Generate all VO code
   */
  private generateAllVOCode(plans: ValueObjectExtractionPlan[]): GeneratedVOCode[] {
    return plans.flatMap(plan => [
      {
        voName: plan.valueObject.name,
        fileName: `${plan.valueObject.name}.ts`,
        content: plan.generatedArtifacts.typeDefinition,
        category: 'type_definition'
      }
    ]);
  }

  /**
   * Create migration guide
   */
  private createMigrationGuide(plans: ValueObjectExtractionPlan[]): string {
    return `# Value Object Extraction Migration Guide

## Overview
This guide covers the extraction of ${plans.length} Value Objects from existing types.

## Migration Steps
${plans.map((plan, i) => `
### ${i + 1}. ${plan.valueObject.name}
- **Domain**: ${plan.valueObject.domainContext}
- **Properties**: ${plan.valueObject.properties.map(p => p.name).join(', ')}
- **Affected Types**: ${plan.valueObject.sourceTypes.join(', ')}
- **Strategy**: ${plan.migrationPlan.strategy}
`).join('')}

## Post-Migration Checklist
- [ ] All tests pass
- [ ] Type compilation successful
- [ ] Integration tests updated
- [ ] Documentation updated
`;
  }
}

// Helper interfaces
interface PropertyDetail {
  name: string;
  type: string;
  isOptional: boolean;
  typeName: string;
  filePath: string;
}
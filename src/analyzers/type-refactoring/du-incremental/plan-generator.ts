/**
 * DU Plan Generator - Phase 2 Implementation
 * 
 * Converts DU detection results into actionable transformation plans.
 * Implements B1-B3: Type Generation, Implementation Steps, Validation.
 */

import type { StorageQueryInterface } from '../../type-insights/types';
import type {
  DUPlan,
  DUTransformationPlan,
  TypeGenerationPlan,
  ImplementationStep,
  CompatibilityInfo,
  EffortEstimate
} from './types';

/**
 * Options for plan generation
 */
export interface PlanGenerationOptions {
  // Type generation preferences
  includeSmartConstructors: boolean;
  includeTypeGuards: boolean;
  includeMigrationHelpers: boolean;
  
  // Implementation preferences
  generateDetailedSteps: boolean;
  includeAutomation: boolean;
  
  // Output preferences
  includeExamples: boolean;
  includeDocumentation: boolean;
  
  // Risk tolerance
  riskTolerance: 'conservative' | 'balanced' | 'aggressive';
}

/**
 * Default plan generation options
 */
const DEFAULT_OPTIONS: PlanGenerationOptions = {
  includeSmartConstructors: true,
  includeTypeGuards: true,
  includeMigrationHelpers: true,
  generateDetailedSteps: true,
  includeAutomation: false, // Conservative default
  includeExamples: true,
  includeDocumentation: true,
  riskTolerance: 'balanced'
};

/**
 * DU Plan Generator - Converts detection results to transformation plans
 */
export class DUPlanGenerator {
  private options: PlanGenerationOptions;

  constructor(_storage: StorageQueryInterface, options: Partial<PlanGenerationOptions> = {}) {
    // Note: storage parameter reserved for future phases (reference analysis)
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Generate a transformation plan from a DU detection result
   */
  async generatePlan(duPlan: DUPlan): Promise<DUTransformationPlan> {
    // B1: Type Generation
    const typeGeneration = await this.generateTypeGeneration(duPlan);
    
    // B2: Implementation Steps  
    const implementationSteps = await this.generateImplementationSteps(duPlan, typeGeneration);
    
    // B3: Compatibility & Validation
    const compatibilityInfo = await this.generateCompatibilityInfo(duPlan);
    
    // Effort estimation
    const estimatedEffort = this.estimateEffort(duPlan, implementationSteps);

    const transformationPlan: DUTransformationPlan = {
      // Base DU plan
      ...duPlan,
      
      // Phase 2 extensions
      typeGeneration,
      implementationSteps,
      compatibilityInfo,
      
      // Metadata
      planVersion: '2.0.0',
      generatedAt: new Date().toISOString(),
      estimatedEffort
    };

    return transformationPlan;
  }

  /**
   * Generate multiple plans from detection results
   */
  async generatePlans(duPlans: DUPlan[]): Promise<DUTransformationPlan[]> {
    const plans: DUTransformationPlan[] = [];
    
    for (const duPlan of duPlans) {
      try {
        const plan = await this.generatePlan(duPlan);
        plans.push(plan);
      } catch (error) {
        console.warn(`Failed to generate plan for ${duPlan.typeName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    return plans;
  }

  // =============================================================================
  // B1: Type Generation
  // =============================================================================

  /**
   * B1: Generate TypeScript type definitions and helpers
   */
  private async generateTypeGeneration(duPlan: DUPlan): Promise<TypeGenerationPlan> {
    // Start with basic union type generation
    const unionType = this.generateUnionType(duPlan);
    
    const typeGeneration: TypeGenerationPlan = {
      unionType,
      smartConstructors: this.options.includeSmartConstructors ? this.generateSmartConstructors(unionType) : [],
      typeGuards: this.options.includeTypeGuards ? this.generateTypeGuards(unionType) : [],
      migrationTypes: [], // Will be implemented later
      conversionFunctions: [], // Will be implemented later
      compilationTest: this.generateCompilationTest(unionType),
      exampleUsage: this.generateExampleUsage(unionType)
    };

    return typeGeneration;
  }

  /**
   * Generate the main discriminated union type definition
   */
  private generateUnionType(duPlan: DUPlan): import('./types').GeneratedUnionType {
    const variants: import('./types').GeneratedVariant[] = duPlan.variants.map((variant, index) => ({
      name: this.generateVariantName(duPlan.typeName, variant.tag, index),
      discriminantValue: variant.tag,
      properties: [...new Set(variant.required)].map(propName => ({
        name: propName,
        type: this.inferPropertyType(propName, duPlan.discriminant, variant.tag),
        isRequired: true,
        isInherited: false,
        documentation: `Property for ${variant.tag} variant`
      })),
      typeDefinition: this.generateVariantTypeDefinition(duPlan.typeName, variant, index, duPlan.discriminant),
      documentation: `Variant for ${duPlan.discriminant} = ${variant.tag}`
    }));

    const unionTypeDefinition = this.generateUnionTypeDefinition(duPlan, variants);

    return {
      typeName: duPlan.typeName,
      discriminantProperty: duPlan.discriminant,
      variants,
      typeDefinition: unionTypeDefinition
    };
  }

  /**
   * Generate variant name from type name and tag
   */
  private generateVariantName(_typeName: string, tag: string | number | boolean, index: number): string {
    if (typeof tag === 'string') {
      return this.sanitizeIdentifier(tag);
    }
    if (typeof tag === 'boolean') {
      return tag ? 'True' : 'False';
    }
    // Numeric or other - use index
    return `Variant${index + 1}`;
  }

  /**
   * Sanitize identifier for TypeScript compatibility
   */
  private sanitizeIdentifier(value: string): string {
    // Handle reserved words
    const reservedWords = new Set([
      'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
      'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
      'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null',
      'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
      'var', 'void', 'while', 'with', 'abstract', 'any', 'as', 'async', 'await',
      'boolean', 'constructor', 'declare', 'get', 'implements', 'interface',
      'is', 'keyof', 'let', 'module', 'namespace', 'never', 'number', 'object',
      'of', 'readonly', 'require', 'set', 'string', 'symbol', 'type', 'undefined',
      'unique', 'unknown', 'from', 'global', 'bigint'
    ]);

    // Start with the original value
    let identifier = value;

    // Replace non-alphanumeric characters with appropriate substitutions
    identifier = identifier
      .replace(/[-_]/g, ' ')  // Replace hyphens and underscores with spaces
      .replace(/[^a-zA-Z0-9\s]/g, '') // Remove other special characters
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');

    // Handle empty or starts with number
    if (!identifier || /^\d/.test(identifier)) {
      identifier = `Variant${identifier}`;
    }

    // Handle reserved words
    if (reservedWords.has(identifier.toLowerCase())) {
      identifier = `${identifier}Value`;
    }

    return identifier;
  }

  /**
   * Infer TypeScript type for a property
   */
  private inferPropertyType(
    propName: string,
    discriminantPropName: string,
    discriminantValue: string | number | boolean
  ): string {
    // Simple type inference - can be enhanced later
    if (propName === discriminantPropName) {
      return typeof discriminantValue === 'string'
        ? `'${discriminantValue}'`
        : String(discriminantValue);
    }
    if (propName === 'success' || propName.startsWith('is') || propName.endsWith('ed')) {
      return 'boolean';
    }
    if (propName.includes('count') || propName.includes('index') || propName.includes('id')) {
      return 'number';
    }
    return 'string'; // Default fallback
  }

  /**
   * Generate TypeScript interface for a single variant
   */
  private generateVariantTypeDefinition(
    typeName: string, 
    variant: import('./types').DUVariant, 
    index: number,
    discriminant: string
  ): string {
    const variantName = this.generateVariantName(typeName, variant.tag, index);
    
    const properties = [...new Set(variant.required)].map(propName => {
      const type = this.inferPropertyType(propName, discriminant, variant.tag);
      return `  ${propName}: ${type};`;
    }).join('\n');

    return `export interface ${variantName}${typeName} {
${properties}
}`;
  }

  /**
   * Generate the complete union type definition
   */
  private generateUnionTypeDefinition(duPlan: DUPlan, variants: import('./types').GeneratedVariant[]): string {
    const variantTypes = variants.map(v => `${v.name}${duPlan.typeName}`).join(' | ');
    
    return `export type ${duPlan.typeName} = ${variantTypes};`;
  }

  /**
   * Generate compilation test TypeScript code
   */
  private generateCompilationTest(unionType: import('./types').GeneratedUnionType): string {
    const testCode = `// Compilation test for ${unionType.typeName}
${unionType.typeDefinition}

// Test discriminated union behavior
function handle${unionType.typeName}(item: ${unionType.typeName}): string {
  switch (item.${unionType.discriminantProperty}) {
${unionType.variants.map(v => 
  `    case ${typeof v.discriminantValue === 'string' ? `'${v.discriminantValue}'` : v.discriminantValue}:
      return 'Handled ${v.name}';`
).join('\n')}
    default:
      const _exhaustive: never = item;
      return _exhaustive;
  }
}`;

    return testCode;
  }

  /**
   * Generate usage examples
   */
  private generateExampleUsage(unionType: import('./types').GeneratedUnionType): string[] {
    return unionType.variants.map(variant => {
      const props = variant.properties.map(p => 
        `${p.name}: ${this.generateExampleValue(p.type)}`
      ).join(', ');
      
      return `const example${variant.name}: ${unionType.typeName} = { ${props} };`;
    });
  }

  /**
   * Generate example value for a TypeScript type
   */
  private generateExampleValue(type: string): string {
    if (type === 'boolean') return 'true';
    if (type === 'number') return '42';
    if (type.startsWith("'") && type.endsWith("'")) return type; // String literal
    return "'example'"; // Default string
  }

  /**
   * Generate smart constructor functions for each variant
   */
  private generateSmartConstructors(unionType: import('./types').GeneratedUnionType): import('./types').SmartConstructor[] {
    return unionType.variants.map(variant => {
      const functionName = `create${variant.name}${unionType.typeName}`;
      
      // Create parameters (exclude discriminant property as it's set automatically)
      const parameters: import('./types').ConstructorParameter[] = variant.properties
        .filter(prop => prop.name !== unionType.discriminantProperty)
        .map(prop => ({
          name: prop.name,
          type: prop.type,
          isOptional: !prop.isRequired,
          documentation: prop.documentation || `Parameter for ${prop.name}`
        }));

      // Generate function implementation
      const paramList = parameters.map(p => `${p.name}${p.isOptional ? '?' : ''}: ${p.type}`).join(', ');
      const propAssignments = [
        `${unionType.discriminantProperty}: ${typeof variant.discriminantValue === 'string' ? `'${variant.discriminantValue}'` : variant.discriminantValue}`,
        ...parameters.map(p => `${p.name}`)
      ].join(',\n    ');

      const implementation = `function ${functionName}(${paramList}): ${unionType.typeName} {
  return {
    ${propAssignments}
  };
}`;

      return {
        functionName,
        variantName: variant.name,
        parameters,
        returnType: unionType.typeName,
        implementation,
        documentation: `Creates a ${variant.name} variant of ${unionType.typeName}`
      };
    });
  }

  /**
   * Generate type guard functions for each variant
   */
  private generateTypeGuards(unionType: import('./types').GeneratedUnionType): import('./types').TypeGuard[] {
    return unionType.variants.map(variant => {
      const functionName = `is${variant.name}${unionType.typeName}`;
      const returnType = `obj is ${variant.name}${unionType.typeName}`;
      
      const discriminantCheck = typeof variant.discriminantValue === 'string' 
        ? `obj.${unionType.discriminantProperty} === '${variant.discriminantValue}'`
        : `obj.${unionType.discriminantProperty} === ${variant.discriminantValue}`;

      const implementation = `function ${functionName}(obj: ${unionType.typeName}): ${returnType} {
  return ${discriminantCheck};
}`;

      return {
        functionName,
        variantName: variant.name,
        implementation,
        returnType,
        documentation: `Type guard to check if ${unionType.typeName} is a ${variant.name} variant`
      };
    });
  }

  // =============================================================================
  // B2: Implementation Steps
  // =============================================================================

  /**
   * B2: Generate step-by-step implementation instructions
   */
  private async generateImplementationSteps(
    duPlan: DUPlan, 
    typeGeneration: TypeGenerationPlan
  ): Promise<ImplementationStep[]> {
    const steps: ImplementationStep[] = [];

    // Step 1: Preparation
    steps.push({
      stepNumber: 1,
      title: 'Prepare for DU transformation',
      description: `Prepare workspace and backup current ${duPlan.typeName} implementation`,
      category: 'preparation',
      actions: [
        {
          type: 'run-command',
          description: 'Create backup of current implementation',
          target: 'git stash push -m "Before DU transformation"',
          automated: true
        },
        {
          type: 'create-file',
          description: 'Create transformation log file',
          target: `du-transformation-${duPlan.typeName.toLowerCase()}.md`,
          content: this.generateTransformationLog(duPlan),
          automated: true
        }
      ],
      successCriteria: [
        'Git stash created successfully',
        'Transformation log file exists'
      ],
      dependsOn: [],
      estimatedTime: '5 minutes',
      riskLevel: 'low'
    });

    // Step 2: Create type definitions
    steps.push({
      stepNumber: 2,
      title: 'Define discriminated union types',
      description: `Create TypeScript type definitions for ${duPlan.typeName}`,
      category: 'type-definition',
      actions: [
        {
          type: 'create-file',
          description: 'Create type definition file',
          target: `types/${duPlan.typeName.toLowerCase()}.types.ts`,
          content: this.generateTypeDefinitionFile(typeGeneration),
          automated: false
        },
        {
          type: 'run-command',
          description: 'Verify TypeScript compilation',
          target: 'npx tsc --noEmit',
          automated: true
        }
      ],
      successCriteria: [
        'Type definition file created',
        'TypeScript compilation succeeds',
        'No type errors reported'
      ],
      dependsOn: [1],
      estimatedTime: '15 minutes',
      riskLevel: 'low'
    });

    // Step 3: Create helper functions
    if (typeGeneration.smartConstructors.length > 0 || typeGeneration.typeGuards.length > 0) {
      steps.push({
        stepNumber: 3,
        title: 'Create helper functions',
        description: 'Add smart constructors and type guards',
        category: 'type-definition',
        actions: [
          {
            type: 'create-file',
            description: 'Create helper functions file',
            target: `utils/${duPlan.typeName.toLowerCase()}.utils.ts`,
            content: this.generateHelperFunctionsFile(typeGeneration),
            automated: false
          },
          {
            type: 'run-command',
            description: 'Test helper functions',
            target: 'npm test -- ' + duPlan.typeName.toLowerCase(),
            automated: true
          }
        ],
        successCriteria: [
          'Helper functions file created',
          'All helper function tests pass'
        ],
        dependsOn: [2],
        estimatedTime: '10 minutes',
        riskLevel: 'low'
      });
    }

    // Step 4: Migration validation
    steps.push({
      stepNumber: steps.length + 1,
      title: 'Validate transformation',
      description: 'Run comprehensive validation of the transformation',
      category: 'validation',
      actions: [
        {
          type: 'run-command',
          description: 'Run type checking',
          target: 'npx tsc --noEmit',
          automated: true
        },
        {
          type: 'run-command',
          description: 'Run linting',
          target: 'npm run lint',
          automated: true
        },
        {
          type: 'manual-check',
          description: 'Review generated code for correctness',
          automated: false
        }
      ],
      successCriteria: [
        'Type checking passes',
        'Linting passes',
        'Manual review completed'
      ],
      dependsOn: [2, 3].filter(n => n <= steps.length),
      estimatedTime: '10 minutes',
      riskLevel: 'medium'
    });

    return steps;
  }

  /**
   * Generate transformation log content
   */
  private generateTransformationLog(duPlan: DUPlan): string {
    return `# DU Transformation Log: ${duPlan.typeName}

## Transformation Details
- **Type**: ${duPlan.typeName}
- **Discriminant**: ${duPlan.discriminant}
- **Variants**: ${duPlan.variants.length}
- **Risk Level**: ${duPlan.risk}
- **Started**: ${new Date().toISOString()}

## Variants
${duPlan.variants.map(v => `- \`${v.tag}\`: ${v.required.join(', ')}`).join('\n')}

## Progress Tracking
- [ ] Preparation completed
- [ ] Type definitions created
- [ ] Helper functions implemented
- [ ] Validation passed
- [ ] Transformation completed

## Notes
(Add notes and observations during transformation)
`;
  }

  /**
   * Generate type definition file content
   */
  private generateTypeDefinitionFile(typeGeneration: TypeGenerationPlan): string {
    const unionType = typeGeneration.unionType;
    
    let content = `/**
 * Discriminated Union Type Definitions
 * Generated by funcqc DU transformation
 */

`;

    // Add variant interfaces
    unionType.variants.forEach(variant => {
      content += `${variant.typeDefinition}\n\n`;
    });

    // Add main union type
    content += `${unionType.typeDefinition}\n\n`;

    // Add exports
    content += `export type { ${unionType.typeName} };\n`;
    unionType.variants.forEach(variant => {
      content += `export type { ${variant.name}${unionType.typeName} };\n`;
    });

    return content;
  }

  /**
   * Generate helper functions file content
   */
  private generateHelperFunctionsFile(typeGeneration: TypeGenerationPlan): string {
    // Build type imports (union + variants)
    const unionTypeName = typeGeneration.unionType.typeName;
    const variantTypeNames = typeGeneration.unionType.variants.map(v => `${v.name}${unionTypeName}`).join(', ');
    
    let content = `/**
 * Helper Functions for ${unionTypeName}
 * Generated by funcqc DU transformation
 */

import type { ${unionTypeName}${variantTypeNames ? `, ${variantTypeNames}` : ''} } from '../types/${unionTypeName.toLowerCase()}.types';

`;

    // Add smart constructors
    if (typeGeneration.smartConstructors.length > 0) {
      content += '// Smart Constructors\n';
      typeGeneration.smartConstructors.forEach(smartConstructor => {
        content += `${smartConstructor.implementation}\n\n`;
      });
    }

    // Add type guards
    if (typeGeneration.typeGuards.length > 0) {
      content += '// Type Guards\n';
      typeGeneration.typeGuards.forEach(guard => {
        content += `${guard.implementation}\n\n`;
      });
    }

    return content;
  }

  // =============================================================================
  // B3: Compatibility & Validation
  // =============================================================================

  /**
   * B3: Analyze compatibility and generate validation requirements
   */
  private async generateCompatibilityInfo(duPlan: DUPlan): Promise<CompatibilityInfo> {
    const breakingChanges = this.analyzeBreakingChanges(duPlan);
    const risks = this.assessTransformationRisks(duPlan);
    const validationRules = this.generateValidationRules(duPlan);
    const testRequirements = this.generateTestRequirements(duPlan);

    return {
      breakingChanges,
      migrationRequired: breakingChanges.length > 0,
      extensibilityOptions: [
        'Add new variants by extending the discriminated union',
        'Implement additional helper functions as needed',
        'Create specialized type guards for complex cases'
      ],
      futureConsiderations: [
        'Consider using branded types for additional type safety',
        'Evaluate opportunities for exhaustive pattern matching',
        'Plan for potential variant deprecation strategies'
      ],
      validationRules,
      testRequirements,
      risks,
      mitigations: risks.map(risk => risk.mitigation)
    };
  }

  /**
   * Analyze potential breaking changes
   */
  private analyzeBreakingChanges(duPlan: DUPlan): import('./types').BreakingChange[] {
    const changes: import('./types').BreakingChange[] = [];

    // Property access patterns may change
    changes.push({
      area: 'property-access',
      description: `Direct property access to ${duPlan.typeName} may require type guards`,
      impact: 'medium',
      mitigation: 'Use type guards before accessing variant-specific properties',
      affectedFiles: [`**/*${duPlan.typeName}*`] // Pattern for potentially affected files
    });

    // Type signature changes
    if (duPlan.variants.length > 2) {
      changes.push({
        area: 'type-signature',
        description: 'Complex union type may require explicit type annotations',
        impact: 'low',
        mitigation: 'Add explicit type annotations where TypeScript inference fails',
        affectedFiles: ['**/*.ts', '**/*.tsx']
      });
    }

    // Function signature impact
    if (duPlan.refs && duPlan.refs.callsites > 10) {
      changes.push({
        area: 'function-signature',
        description: 'Functions accepting/returning this type may need updates',
        impact: 'high',
        mitigation: 'Update function signatures to use the new union type',
        affectedFiles: [`**/*${duPlan.typeName.toLowerCase()}*`]
      });
    }

    return changes;
  }

  /**
   * Assess transformation risks
   */
  private assessTransformationRisks(duPlan: DUPlan): import('./types').RiskAssessment[] {
    const risks: import('./types').RiskAssessment[] = [];

    // Complexity risk
    if (duPlan.variants.length > 4) {
      risks.push({
        risk: 'High complexity may lead to maintainability issues',
        probability: 'medium',
        impact: 'medium',
        mitigation: 'Document variant usage patterns and provide clear examples'
      });
    }

    // Reference count risk
    if (duPlan.refs && duPlan.refs.files > 5) {
      risks.push({
        risk: 'Wide usage may cause extensive changes across codebase',
        probability: 'high',
        impact: 'high',
        mitigation: 'Plan phased migration and maintain backward compatibility where possible'
      });
    }

    // Type safety risk
    if (duPlan.coverage.rate < 0.95) {
      risks.push({
        risk: 'Incomplete coverage may lead to runtime errors',
        probability: 'medium',
        impact: 'high',
        mitigation: 'Add comprehensive runtime validation and fallback handling'
      });
    }

    // Performance risk
    if (duPlan.refs && duPlan.refs.callsites > 50) {
      risks.push({
        risk: 'Frequent type checks may impact performance',
        probability: 'low',
        impact: 'low',
        mitigation: 'Optimize type guards and consider caching strategies if needed'
      });
    }

    return risks;
  }

  /**
   * Generate validation rules
   */
  private generateValidationRules(duPlan: DUPlan): import('./types').ValidationRule[] {
    const rules: import('./types').ValidationRule[] = [];

    // TypeScript compilation rule
    rules.push({
      rule: 'TypeScript compilation must succeed',
      description: 'All TypeScript files must compile without errors',
      automated: true,
      command: 'npx tsc --noEmit'
    });

    // Type guard coverage rule
    rules.push({
      rule: 'All variants must have type guards',
      description: `Each of the ${duPlan.variants.length} variants must have a corresponding type guard function`,
      automated: false
    });

    // Exhaustive checking rule
    rules.push({
      rule: 'Switch statements must be exhaustive',
      description: 'All switch statements on discriminant property must handle all variants',
      automated: false
    });

    // Runtime validation rule
    if (duPlan.coverage.rate < 1.0) {
      rules.push({
        rule: 'Runtime validation for incomplete coverage',
        description: 'Add runtime checks for cases not covered by static analysis',
        automated: false
      });
    }

    return rules;
  }

  /**
   * Generate test requirements
   */
  private generateTestRequirements(duPlan: DUPlan): import('./types').TestRequirement[] {
    const requirements: import('./types').TestRequirement[] = [];

    // Unit tests for type guards
    requirements.push({
      type: 'unit',
      description: 'Test all type guard functions with valid and invalid inputs',
      priority: 'critical',
      implementation: `describe('${duPlan.typeName} type guards', () => {
${duPlan.variants.map(v => `  test('is${typeof v.tag === 'string' ? v.tag.charAt(0).toUpperCase() + v.tag.slice(1) : v.tag}${duPlan.typeName}', () => { /* test implementation */ });`).join('\n')}
});`
    });

    // Unit tests for smart constructors
    requirements.push({
      type: 'unit',
      description: 'Test all smart constructor functions',
      priority: 'critical',
      implementation: `describe('${duPlan.typeName} constructors', () => {
${duPlan.variants.map(v => `  test('create${typeof v.tag === 'string' ? v.tag.charAt(0).toUpperCase() + v.tag.slice(1) : v.tag}${duPlan.typeName}', () => { /* test implementation */ });`).join('\n')}
});`
    });

    // Integration tests
    if (duPlan.refs && duPlan.refs.callsites > 5) {
      requirements.push({
        type: 'integration',
        description: 'Test integration with existing code that uses this type',
        priority: 'important'
      });
    }

    // Compilation tests
    requirements.push({
      type: 'compilation',
      description: 'Verify TypeScript compilation succeeds with new types',
      priority: 'critical',
      implementation: 'Automated via CI/CD TypeScript build step'
    });

    return requirements;
  }

  // =============================================================================
  // Utilities
  // =============================================================================

  /**
   * Estimate effort required for transformation
   */
  private estimateEffort(duPlan: DUPlan, _steps: ImplementationStep[]): EffortEstimate {
    // Simple estimation logic - will be refined later
    const variantCount = duPlan.variants.length;
    const riskMultiplier = duPlan.risk === 'high' ? 2 : duPlan.risk === 'medium' ? 1.5 : 1;
    const baseTime = 30; // 30 minutes base
    
    const estimatedMinutes = Math.round(baseTime * variantCount * riskMultiplier);
    const hours = Math.floor(estimatedMinutes / 60);
    const minutes = estimatedMinutes % 60;
    
    const totalTime = hours > 0 
      ? `${hours}h ${minutes}m` 
      : `${minutes}m`;

    return {
      totalTime,
      complexity: variantCount <= 2 ? 'simple' : variantCount <= 4 ? 'moderate' : 'complex',
      skillLevel: duPlan.risk === 'high' ? 'senior' : 'mid',
      breakdown: {
        planning: '20%',
        implementation: '50%',
        testing: '20%',
        review: '10%'
      }
    };
  }

  /**
   * Get plan generation statistics
   */
  getGenerationStats(): { 
    plansGenerated: number;
    avgGenerationTime: number;
    successRate: number;
  } {
    // Placeholder for statistics tracking
    return {
      plansGenerated: 0,
      avgGenerationTime: 0,
      successRate: 100
    };
  }
}
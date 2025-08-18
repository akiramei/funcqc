import { RefactorCommandOptions } from '../../types';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { createErrorHandler, ErrorCode, DatabaseErrorLike } from '../../utils/error-handler';

/**
 * Filter out undefined properties from an object
 */
function filterUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

/**
 * Refactor command - unified code transformation and refactoring interface
 * Consolidates functionality from refactor-guard, extract-vo, discriminate, canonicalize, type-replace
 */
export const refactorCommand: VoidCommand<RefactorCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      if (!options.quiet) {
        env.commandLogger.info('🔧 Starting refactoring analysis...');
      }

      switch (options.action) {
        case 'guard':
          await executeGuard(env, options);
          break;
        case 'extract-vo':
          await executeExtractVO(env, options);
          break;
        case 'discriminate':
          await executeDiscriminate(env, options);
          break;
        case 'canonicalize':
          await executeCanonicalize(env, options);
          break;
        case 'type-replace':
          await executeTypeReplace(env, options);
          break;
        default:
          await executeOverview(env, options);
          break;
      }

      if (!options.quiet) {
        env.commandLogger.info('✅ Refactoring analysis completed!');
      }

    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        const dbErr = error as DatabaseErrorLike;
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          dbErr.message,
          { dbCode: dbErr.code },
          dbErr.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Refactoring analysis failed: ${error instanceof Error ? error.message : String(error)}`,
          { options },
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Execute refactor guard analysis (refactor-guard integration)
 */
async function executeGuard(env: CommandEnvironment, options: RefactorCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('🛡️ Analyzing refactoring safety and guardrails...');
  }

  try {
    // Import and execute refactor guard functionality
    const { refactorGuardCommand } = await import('./refactor-guard');
    const guardOptions = filterUndefined({
      type: options.type,
      operation: options.operation,
      snapshot: options.snapshot,
      'include-tests': options.includeTests,
      'include-behavioral': options.includeBehavioral,
      'include-cochange': options.includeCochange,
      'risk-threshold': options.riskThreshold,
      format: options.format,
      output: options.output,
      'pr-template': options.prTemplate,
      verbose: options.verbose,
      quiet: options.quiet
    });
    await refactorGuardCommand(guardOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Refactor guard analysis completed');
    }
  } catch (error) {
    throw new Error(`Refactor guard analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute value object extraction (extract-vo integration)
 */
async function executeExtractVO(env: CommandEnvironment, options: RefactorCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('🧩 Analyzing value object extraction opportunities...');
  }

  try {
    // Import and execute extract VO functionality
    const { extractVOCommand } = await import('./extract-vo');
    const voOptions = filterUndefined({
      snapshot: options.snapshot,
      'min-support': options.minSupport,
      'min-confidence': options.minConfidence,
      'min-cohesion': options.minCohesion,
      'include-computed': options.includeComputed,
      'generate-constructors': options.generateConstructors,
      'infer-invariants': options.inferInvariants,
      'preserve-original': options.preserveOriginal,
      format: options.format,
      output: options.output,
      'output-code': options.outputCode,
      'dry-run': options.dryRun,
      'max-candidates': options.maxCandidates,
      'show-opportunities': options.showOpportunities,
      'show-generated': options.showGenerated,
      'domain-filter': options.domainFilter,
      'complexity-filter': options.complexityFilter,
      verbose: options.verbose,
      quiet: options.quiet
    });
    await extractVOCommand(voOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Value object extraction completed');
    }
  } catch (error) {
    throw new Error(`Value object extraction failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute discriminated union analysis (discriminate integration)
 */
async function executeDiscriminate(env: CommandEnvironment, options: RefactorCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('🎯 Analyzing discriminated union opportunities...');
  }

  try {
    // Import and execute discriminate functionality
    const { executeDiscriminate } = await import('./discriminate');
    // Build discriminate options with proper typing
    const discriminateOptions: Record<string, unknown> = {};
    
    // Add defined properties only
    if (options.verbose !== undefined) discriminateOptions['verbose'] = options.verbose;
    if (options.json !== undefined) discriminateOptions['json'] = options.json;
    if (options.snapshot !== undefined) discriminateOptions['snapshot-id'] = options.snapshot;
    if (options.targetTypes !== undefined) discriminateOptions['target-types'] = options.targetTypes;
    if (options.minCoverage !== undefined) discriminateOptions['min-coverage'] = options.minCoverage;
    if (options.minConfidence !== undefined) discriminateOptions['min-confidence'] = options.minConfidence;
    if (options.maxCases !== undefined) discriminateOptions['max-cases'] = options.maxCases;
    if (options.includeBooleans !== undefined) discriminateOptions['include-booleans'] = options.includeBooleans;
    if (options.includeEnums !== undefined) discriminateOptions['include-enums'] = options.includeEnums;
    if (options.allowBreaking !== undefined) discriminateOptions['allow-breaking'] = options.allowBreaking;
    if (options.dryRun !== undefined) discriminateOptions['dry-run'] = options.dryRun;
    if (options.transform !== undefined) discriminateOptions['transform'] = options.transform;
    if (options.format !== undefined) discriminateOptions['output'] = options.format;
    await executeDiscriminate(discriminateOptions);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Discriminated union analysis completed');
    }
  } catch (error) {
    throw new Error(`Discriminated union analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute DTO canonicalization (canonicalize integration)
 */
async function executeCanonicalize(env: CommandEnvironment, options: RefactorCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('🔄 Analyzing DTO canonicalization opportunities...');
  }

  try {
    // Import and execute canonicalize functionality
    const { canonicalizeCommand } = await import('./canonicalize');
    const canonicalizeOptions = filterUndefined({
      snapshot: options.snapshot,
      'min-support': options.minSupport,
      'min-confidence': options.minConfidence,
      'include-behavioral': options.canonicalizeBehavioral,
      'generate-codemod': options.generateCodemod,
      'require-minimal-impact': options.requireMinimalImpact,
      'preserve-optionality': options.preserveOptionality,
      format: options.format,
      output: options.output,
      'dry-run': options.dryRun,
      'max-candidates': options.maxCandidates,
      'show-opportunities': options.showOpportunities,
      'show-artifacts': options.showArtifacts,
      verbose: options.verbose,
      quiet: options.quiet
    });
    await canonicalizeCommand(canonicalizeOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ DTO canonicalization completed');
    }
  } catch (error) {
    throw new Error(`DTO canonicalization failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute type replacement analysis (type-replace integration)
 */
async function executeTypeReplace(env: CommandEnvironment, options: RefactorCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('🔄 Analyzing type replacement safety...');
  }

  try {
    // Import and execute type replace functionality
    const { typeReplaceCommand } = await import('./type-replace');
    const typeReplaceOptions = filterUndefined({
      from: options.from,
      to: options.to,
      snapshot: options.snapshot,
      'check-only': options.checkOnly,
      'generate-codemod': options.generateCodemod,
      'migration-plan': options.migrationPlan,
      'ts-config': options.tsConfig,
      'allow-unsafe': options.allowUnsafe,
      'risk-threshold': options.riskThreshold,
      format: options.format,
      output: options.output,
      'dry-run': options.dryRun,
      'include-cochange': options.includeCochange,
      'team-size': options.teamSize,
      'risk-tolerance': options.riskTolerance,
      verbose: options.verbose,
      quiet: options.quiet
    });
    await typeReplaceCommand(typeReplaceOptions)(env);
    
    if (!options.quiet) {
      env.commandLogger.info('✅ Type replacement analysis completed');
    }
  } catch (error) {
    throw new Error(`Type replacement analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute refactoring overview (default action)
 */
async function executeOverview(env: CommandEnvironment, options: RefactorCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.info('📊 Displaying refactoring capabilities overview...');
  }

  const overview = {
    title: 'Code Refactoring & Transformation Analysis',
    availableActions: [
      'guard         - Refactoring safety analysis and guardrails',
      'extract-vo    - Value object extraction from property clusters',  
      'discriminate  - Discriminated union analysis and transformation',
      'canonicalize  - DTO canonicalization and consolidation',
      'type-replace  - Safe type replacement with migration planning'
    ],
    examples: [
      'funcqc refactor --action=guard --type="MyInterface" --operation=split',
      'funcqc refactor --action=extract-vo --min-cohesion=0.7 --show-opportunities',
      'funcqc refactor --action=discriminate --target-types="User,Order" --transform',
      'funcqc refactor --action=canonicalize --generate-codemod --dry-run',
      'funcqc refactor --action=type-replace --from="OldType" --to="NewType" --check-only'
    ],
    capabilities: {
      'Refactor Guard': [
        'Safety analysis for type refactoring operations',
        'Impact assessment and risk evaluation',
        'Automated test template generation',
        'Co-change analysis integration',
        'PR summary and checklist generation'
      ],
      'Value Object Extraction': [
        'Property co-occurrence pattern analysis',
        'Domain-driven design value object identification',
        'Smart constructor and invariant generation',
        'Migration plan with complexity assessment',
        'Generated code artifacts and templates'
      ],
      'Discriminated Unions': [
        'Mutual exclusion pattern detection',
        'Type-safe union case analysis',
        'Automatic discriminant property identification',
        'Breaking change analysis and planning',
        'Code transformation with safety checks'
      ],
      'DTO Canonicalization': [
        'Redundant type detection and consolidation',
        'Type relationship analysis (subset/superset)',
        'Behavioral equivalence checking',
        'View type and mapper generation',
        'Migration strategy planning'
      ],
      'Type Replacement': [
        'Compatibility analysis and validation',
        'Usage site impact assessment',
        'Automated codemod generation',
        'Migration plan with rollback strategy',
        'TypeScript integration and validation'
      ]
    }
  };

  if (options.json) {
    console.log(JSON.stringify(overview, null, 2));
  } else {
    console.log(`\n🔧 ${overview.title}\n`);
    console.log('📋 Available Actions:');
    overview.availableActions.forEach(action => {
      console.log(`   • ${action}`);
    });
    
    console.log('\n💡 Usage Examples:');
    overview.examples.forEach(example => {
      console.log(`   ${example}`);
    });
    
    console.log('\n🚀 Capabilities:');
    Object.entries(overview.capabilities).forEach(([category, items]) => {
      console.log(`\n   ${category}:`);
      items.forEach(item => {
        console.log(`     • ${item}`);
      });
    });
    
    console.log('\n🎯 Quick Start:');
    console.log('   • --action=guard --type=<TypeName>     # Analyze refactoring safety');
    console.log('   • --action=extract-vo --show-opportunities  # Find value object candidates');
    console.log('   • --action=discriminate --transform    # Apply discriminated union transformations');
    console.log('   • --action=canonicalize --dry-run     # Preview DTO consolidation');
    console.log('   • --action=type-replace --check-only  # Validate type replacement compatibility');
  }
  
  if (!options.quiet) {
    env.commandLogger.info('✅ Refactoring overview completed');
  }
}
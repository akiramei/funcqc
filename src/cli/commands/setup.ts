import { SetupCommandOptions, ConfigCommandOptions } from '../../types';
import { VoidCommand } from '../../types/command';
import { CommandEnvironment } from '../../types/environment';
import { createErrorHandler, ErrorCode } from '../../utils/error-handler';
import { DatabaseError } from '../../storage/pglite-adapter';

/**
 * Setup command - unified initialization and configuration interface
 * Consolidates functionality from init and config commands
 */
export const setupCommand: VoidCommand<SetupCommandOptions> = (options) => 
  async (env: CommandEnvironment): Promise<void> => {
    const errorHandler = createErrorHandler(env.commandLogger);

    try {
      if (!options.quiet) {
        env.commandLogger.log('🛠️  Starting setup process...');
      }

      switch (options.action) {
        case 'init':
          await executeInit(env, options);
          break;
        case 'config':
          await executeConfig(env, options);
          break;
        case 'check':
          await executeCheck(env, options);
          break;
        default:
          // Default: interactive setup
          await executeInteractiveSetup(env, options);
          break;
      }

      if (!options.quiet) {
        env.commandLogger.log('✅ Setup completed successfully!');
      }

    } catch (error) {
      if (error instanceof DatabaseError) {
        const funcqcError = errorHandler.createError(
          error.code,
          error.message,
          {},
          error.originalError
        );
        errorHandler.handleError(funcqcError);
      } else {
        const funcqcError = errorHandler.createError(
          ErrorCode.UNKNOWN_ERROR,
          `Setup failed: ${error instanceof Error ? error.message : String(error)}`,
          { options },
          error instanceof Error ? error : undefined
        );
        errorHandler.handleError(funcqcError);
      }
    }
  };

/**
 * Execute initialization (init command integration)
 */
async function executeInit(env: CommandEnvironment, options: SetupCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.log('🔧 Initializing funcqc project...');
  }

  try {
    // Import and execute init command functionality
    const { initCommand } = await import('../init');
    await initCommand({
      force: options.force || false,
      verbose: options.verbose || false,
      quiet: options.quiet || false
    });
    
    if (!options.quiet) {
      env.commandLogger.log('✅ Project initialization completed');
    }
  } catch (error) {
    throw new Error(`Initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute configuration (config command integration)
 */
async function executeConfig(env: CommandEnvironment, options: SetupCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.log('⚙️  Managing configuration...');
  }

  try {
    // Import and execute config command functionality
    const { configCommand } = await import('../config');
    const configOptions: ConfigCommandOptions = {
      show: options.show || false,
      reset: options.reset || false,
      verbose: options.verbose || false,
      quiet: options.quiet || false
    };
    
    if (options.set !== undefined) configOptions.set = options.set;
    if (options.get !== undefined) configOptions.get = options.get;
    
    await configCommand('show', configOptions);
    
    if (!options.quiet) {
      env.commandLogger.log('✅ Configuration management completed');
    }
  } catch (error) {
    throw new Error(`Configuration failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute setup check
 */
async function executeCheck(env: CommandEnvironment, options: SetupCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.log('🔍 Checking setup status...');
  }

  const checks = [];
  
  // Check database
  try {
    const snapshots = await env.storage.getSnapshots({ limit: 1 });
    checks.push({
      name: 'Database',
      status: 'ok',
      message: `${snapshots.length > 0 ? 'Initialized with data' : 'Initialized but empty'}`
    });
  } catch (error) {
    checks.push({
      name: 'Database',
      status: 'error',
      message: `Not accessible: ${error instanceof Error ? error.message : String(error)}`
    });
  }

  // Check configuration
  try {
    // Check if config is accessible
    void env.config;
    checks.push({
      name: 'Configuration',
      status: 'ok',
      message: `Loaded from default location`
    });
  } catch (error) {
    checks.push({
      name: 'Configuration',
      status: 'error',
      message: `Cannot load config: ${error instanceof Error ? error.message : String(error)}`
    });
  }

  // Output results
  if (options.json) {
    console.log(JSON.stringify({
      setup: {
        timestamp: new Date().toISOString(),
        checks: checks,
        overall: checks.every(c => c.status === 'ok') ? 'ok' : 'error'
      }
    }, null, 2));
  } else {
    console.log('\n🔍 Setup Status Check:');
    console.log('──────────────────────');
    
    checks.forEach(check => {
      const icon = check.status === 'ok' ? '✅' : '❌';
      console.log(`${icon} ${check.name}: ${check.message}`);
    });
    
    const overall = checks.every(c => c.status === 'ok');
    console.log(`\n📊 Overall: ${overall ? '✅ Ready' : '❌ Issues found'}`);
    
    if (!overall) {
      console.log('\n💡 Run `funcqc setup --action=init` to fix initialization issues');
      console.log('💡 Run `funcqc setup --action=config` to manage configuration');
    }
  }
}

/**
 * Execute interactive setup
 */
async function executeInteractiveSetup(env: CommandEnvironment, options: SetupCommandOptions): Promise<void> {
  if (!options.quiet) {
    env.commandLogger.log('🚀 Starting interactive setup...');
  }

  // First, check current status
  let needsInit = false;
  try {
    await env.storage.getSnapshots({ limit: 1 });
  } catch {
    needsInit = true;
  }

  if (needsInit) {
    if (!options.quiet) {
      env.commandLogger.log('📋 No existing setup detected, initializing...');
    }
    await executeInit(env, options);
  } else {
    if (!options.quiet) {
      env.commandLogger.log('📋 Existing setup detected');
    }
  }

  // Then run a check to show status
  await executeCheck(env, options);
  
  if (!options.quiet) {
    console.log('\n🎯 Next steps:');
    console.log('   • Run `funcqc scan` to create your first snapshot');
    console.log('   • Run `funcqc inspect` to explore your codebase');
    console.log('   • Run `funcqc assess` for quality analysis');
  }
}
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { Logger } from './cli-utils';
import { createDefaultGitProvider } from './git/index.js';

export interface SystemRequirement {
  name: string;
  check: () => boolean;
  errorMessage: string;
  required: boolean;
}

export interface SystemCheckResult {
  passed: boolean;
  requirements: {
    name: string;
    passed: boolean;
    required: boolean;
    errorMessage?: string;
  }[];
}

export class SystemChecker {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  private checkNodeVersion(): boolean {
    try {
      const version = process.version;
      const major = parseInt(version.slice(1).split('.')[0]);
      return major >= 18;
    } catch {
      return false;
    }
  }

  private checkGitAvailable(): boolean {
    try {
      // GitProvider作成が成功すればGitが利用可能と仮定
      createDefaultGitProvider();
      return true;
    } catch {
      return false;
    }
  }

  private checkTypescriptProject(): boolean {
    return existsSync('tsconfig.json') || existsSync('jsconfig.json');
  }

  private checkFileSystemAccess(): boolean {
    try {
      // Try to write and read a temporary file
      const tempFile = '.funcqc-temp-check';
      writeFileSync(tempFile, 'test');
      const readable = existsSync(tempFile);
      unlinkSync(tempFile);
      return readable;
    } catch {
      return false;
    }
  }

  private checkMemoryAvailable(): boolean {
    try {
      const memUsage = process.memoryUsage();
      // Check if memory pressure is high (>90% heap usage)
      const heapUsageRatio = memUsage.heapUsed / memUsage.heapTotal;

      // Only warn if heap usage is extremely high AND total heap is small
      const isHighPressure = heapUsageRatio > 0.9;
      const isSmallHeap = memUsage.heapTotal < 20 * 1024 * 1024; // 20MB

      return !(isHighPressure && isSmallHeap);
    } catch {
      return true; // Default to no warning if check fails
    }
  }

  private checkWritePermissions(): boolean {
    try {
      // Check if we can write to current directory
      const testFile = '.funcqc-write-test';
      writeFileSync(testFile, 'test');
      unlinkSync(testFile);
      return true;
    } catch {
      return false;
    }
  }

  private getRequirements(): SystemRequirement[] {
    return [
      {
        name: 'Node.js Version',
        check: () => this.checkNodeVersion(),
        errorMessage: 'Node.js 18.0.0 or higher is required. Current version: ' + process.version,
        required: true,
      },
      {
        name: 'Git Availability',
        check: () => this.checkGitAvailable(),
        errorMessage: 'Git is not available in PATH. Git integration features will be disabled.',
        required: false,
      },
      {
        name: 'TypeScript Project',
        check: () => this.checkTypescriptProject(),
        errorMessage:
          'No tsconfig.json or jsconfig.json found. Are you in a TypeScript/JavaScript project?',
        required: true,
      },
      {
        name: 'Memory Available',
        check: () => this.checkMemoryAvailable(),
        errorMessage:
          'High memory pressure detected. Consider using --quick option or increasing Node.js memory limit.',
        required: false,
      },
      {
        name: 'Write Permissions',
        check: () => this.checkWritePermissions(),
        errorMessage: 'Cannot write to current directory. Check file permissions.',
        required: true,
      },
    ];
  }

  checkSystem(): SystemCheckResult {
    const requirements = this.getRequirements();
    const results = requirements.map(req => {
      try {
        const passed = req.check();
        const result: Record<string, unknown> = {
          name: req.name,
          passed,
          required: req.required,
        };
        if (!passed && req.errorMessage) {
          result['errorMessage'] = req.errorMessage;
        }
        return result;
      } catch (error) {
        const result: Record<string, unknown> = {
          name: req.name,
          passed: false,
          required: req.required,
        };
        if (req.errorMessage) {
          result['errorMessage'] =
            req.errorMessage +
            ` (Error: ${error instanceof Error ? error.message : 'Unknown error'})`;
        }
        return result;
      }
    });

    const requiredPassed = results.every(r => !r['required'] || r['passed']);

    return {
      passed: requiredPassed,
      requirements: results as {
        name: string;
        passed: boolean;
        required: boolean;
        errorMessage?: string;
      }[],
    };
  }

  /**
   * Lightweight system check for read-only commands
   * Only checks essential requirements like Node.js version and filesystem access
   */
  basicSystemCheck(): boolean {
    // Only check Node.js version for read-only commands
    const nodeVersionOk = this.checkNodeVersion();
    const fileSystemOk = this.checkFileSystemAccess();

    if (!nodeVersionOk || !fileSystemOk) {
      if (this.logger.isVerbose) {
        this.logger.error('Basic system check failed');
      }
      return false;
    }

    return true;
  }

  reportSystemCheck(): boolean {
    // Only show "checking" message in verbose mode
    if (this.logger.isVerbose) {
      this.logger.info('🔍 Checking system requirements...');
    }

    const result = this.checkSystem();

    // Show results based on verbosity level
    if (this.logger.isVerbose) {
      // Verbose mode: show all details
      result.requirements.forEach(req => {
        if (req.passed) {
          this.logger.info(`✅ ${req.name}: OK`);
        } else if (req.required) {
          this.logger.error(`❌ ${req.name}: ${req.errorMessage}`);
        } else {
          this.logger.warn(`⚠️  ${req.name}: ${req.errorMessage}`);
        }
      });

      if (result.passed) {
        this.logger.info('✅ System check passed!');
      } else {
        this.logger.error('❌ System check failed. Please resolve the required issues above.');
      }
    } else {
      // Non-verbose mode: only show failures
      result.requirements.forEach(req => {
        if (!req.passed) {
          if (req.required) {
            this.logger.error(`${req.name}: ${req.errorMessage}`);
          } else {
            this.logger.warn(`${req.name}: ${req.errorMessage}`);
          }
        }
      });

      // Only show failure message if there were required failures
      if (!result.passed) {
        this.logger.error('System check failed. Please resolve the required issues above.');
      }
    }

    return result.passed;
  }
}

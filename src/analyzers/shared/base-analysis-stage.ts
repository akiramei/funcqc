import { Logger } from '../../utils/cli-utils';

/**
 * Base class for analysis stages with common initialization
 */
export abstract class BaseAnalysisStage {
  protected readonly logger: Logger;
  protected readonly debug: boolean;

  constructor(logger?: Logger, debugEnvVar?: string) {
    this.logger = logger ?? new Logger(false);
    this.debug = process.env[debugEnvVar ?? 'DEBUG_ANALYSIS'] === 'true';
  }
}
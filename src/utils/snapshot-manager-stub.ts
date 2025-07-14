/**
 * Temporary stub for SnapshotManager
 * 
 * This is a simplified version for Phase 3 implementation.
 * The full SnapshotManager will be implemented in a future phase.
 */

import {
  FuncqcConfig,
  StorageAdapter,
  RefactoringSession,
  RefactoringOperation,
} from '../types/index.js';
import { Logger } from './cli-utils.js';

export interface AutomaticSnapshotConfig {
  enabled: boolean;
  beforeRefactoring: boolean;
  afterRefactoring: boolean;
}

export const DefaultAutomaticSnapshotConfig: AutomaticSnapshotConfig = {
  enabled: false, // Disabled for now
  beforeRefactoring: false,
  afterRefactoring: false,
};

export class SnapshotManager {
  private readonly logger: Logger;

  constructor(
    _storage: StorageAdapter,
    _funcqcConfig: FuncqcConfig,
    _config: Partial<AutomaticSnapshotConfig> = {},
    logger?: Logger
  ) {
    this.logger = logger || new Logger(false, false);
    // Configuration stored but not used in stub
  }

  async createBeforeSnapshot(
    session: RefactoringSession,
    _operation?: RefactoringOperation
  ): Promise<null> {
    this.logger.info(`Snapshot creation temporarily disabled for session ${session.id}`);
    return null;
  }

  async createAfterSnapshot(
    session: RefactoringSession,
    _beforeSnapshotId?: string,
    _operation?: RefactoringOperation
  ): Promise<null> {
    this.logger.info(`Snapshot creation temporarily disabled for session ${session.id}`);
    return null;
  }
}
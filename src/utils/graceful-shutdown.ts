/**
 * Graceful shutdown handler for protecting database transactions
 * Ensures proper cleanup when CTRL-C or other termination signals are received
 */

export interface TransactionTracker {
  id: string;
  operation: string;
  startTime: number;
  promise: Promise<unknown>;
}

export class GracefulShutdown {
  private static instance: GracefulShutdown;
  private isShuttingDown = false;
  private shutdownTimeout = 30000; // 30 seconds for database operations
  private cleanupHandlers = new Map<string, () => Promise<void>>();
  private activeTransactions = new Map<string, TransactionTracker>();
  private storageConnections = new Set<{ close: () => Promise<void> }>();

  static getInstance(): GracefulShutdown {
    if (!GracefulShutdown.instance) {
      GracefulShutdown.instance = new GracefulShutdown();
    }
    return GracefulShutdown.instance;
  }

  private constructor() {
    this.setupSignalHandlers();
  }

  private setupSignalHandlers() {
    // CTRL-C (SIGINT)
    process.on('SIGINT', this.handleShutdown.bind(this));
    
    // Process termination (SIGTERM)
    process.on('SIGTERM', this.handleShutdown.bind(this));
    
    // Quit signal (SIGQUIT)
    process.on('SIGQUIT', this.handleShutdown.bind(this));

    // Uncaught exceptions - emergency cleanup
    process.on('uncaughtException', (error) => {
      console.error('💥 Uncaught exception:', error);
      this.emergencyShutdown();
    });

    // Unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('💥 Unhandled rejection at:', promise, 'reason:', reason);
      this.emergencyShutdown();
    });
  }

  /**
   * Register a storage connection for cleanup
   */
  registerStorageConnection(storage: { close: () => Promise<void> }) {
    this.storageConnections.add(storage);
  }

  /**
   * Unregister a storage connection
   */
  unregisterStorageConnection(storage: { close: () => Promise<void> }) {
    this.storageConnections.delete(storage);
  }

  /**
   * Register a cleanup handler
   */
  addCleanupHandler(name: string, handler: () => Promise<void>) {
    this.cleanupHandlers.set(name, handler);
  }

  /**
   * Remove a cleanup handler
   */
  removeCleanupHandler(name: string) {
    this.cleanupHandlers.delete(name);
  }

  /**
   * Track an active transaction
   */
  trackTransaction<T>(id: string, operation: string, promise: Promise<T>): Promise<T> {
    const tracker: TransactionTracker = {
      id,
      operation,
      startTime: Date.now(),
      promise
    };

    this.activeTransactions.set(id, tracker);
    
    // Auto-remove when transaction completes
    promise.finally(() => {
      this.activeTransactions.delete(id);
    });

    return promise;
  }

  /**
   * Get status of active transactions
   */
  getTransactionStatus(): { count: number; operations: string[] } {
    return {
      count: this.activeTransactions.size,
      operations: Array.from(this.activeTransactions.values()).map(t => 
        `${t.operation} (${Date.now() - t.startTime}ms)`
      )
    };
  }

  private async handleShutdown() {
    if (this.isShuttingDown) {
      console.log('\n🚨 Force shutdown requested...');
      await this.forceShutdown();
      return;
    }

    this.isShuttingDown = true;
    console.log('\n🛑 Graceful shutdown initiated...');

    // Set timeout for emergency shutdown
    const emergencyTimeout = setTimeout(() => {
      console.log('⏰ Shutdown timeout reached. Emergency shutdown...');
      this.emergencyShutdown();
    }, this.shutdownTimeout);

    try {
      await this.performGracefulShutdown();
      clearTimeout(emergencyTimeout);
      console.log('✅ Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during graceful shutdown:', error);
      clearTimeout(emergencyTimeout);
      this.emergencyShutdown();
    }
  }

  private async performGracefulShutdown() {
    // Step 1: Wait for active transactions to complete
    await this.waitForTransactions();

    // Step 2: Execute cleanup handlers
    await this.executeCleanupHandlers();

    // Step 3: Close storage connections
    await this.closeStorageConnections();
  }

  private async waitForTransactions() {
    if (this.activeTransactions.size === 0) {
      console.log('📊 No active transactions to wait for');
      return;
    }

    console.log(`⏳ Waiting for ${this.activeTransactions.size} active transaction(s) to complete...`);
    
    // Show transaction details
    for (const [id, tracker] of this.activeTransactions) {
      const duration = Date.now() - tracker.startTime;
      console.log(`   📝 ${tracker.operation} (${id.substring(0, 8)}...) - ${duration}ms`);
    }

    const transactionPromises = Array.from(this.activeTransactions.values()).map(
      async (tracker) => {
        try {
          await tracker.promise;
          console.log(`✅ Transaction completed: ${tracker.operation}`);
        } catch (error) {
          console.log(`❌ Transaction failed: ${tracker.operation} - ${error}`);
          // Don't throw - we want to continue cleanup even if transactions fail
        }
      }
    );

    // Wait for all transactions with a reasonable timeout
    const transactionTimeout = Math.min(this.shutdownTimeout - 5000, 25000);
    try {
      await Promise.race([
        Promise.all(transactionPromises),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Transaction timeout')), transactionTimeout)
        )
      ]);
      console.log('✅ All transactions completed');
    } catch (error) {
      console.log(`⚠️ Some transactions did not complete in time: ${error}`);
      // Continue with cleanup anyway
    }
  }

  private async executeCleanupHandlers() {
    if (this.cleanupHandlers.size === 0) {
      return;
    }

    console.log(`🧹 Executing ${this.cleanupHandlers.size} cleanup handler(s)...`);

    const cleanupPromises = Array.from(this.cleanupHandlers.entries()).map(
      async ([name, handler]) => {
        try {
          console.log(`   🧹 Cleaning up: ${name}`);
          await handler();
          console.log(`   ✅ ${name} cleanup completed`);
        } catch (error) {
          console.error(`   ❌ ${name} cleanup failed:`, error);
        }
      }
    );

    await Promise.all(cleanupPromises);
    console.log('✅ All cleanup handlers executed');
  }

  private async closeStorageConnections() {
    if (this.storageConnections.size === 0) {
      return;
    }

    console.log(`🔌 Closing ${this.storageConnections.size} storage connection(s)...`);

    const closePromises = Array.from(this.storageConnections).map(
      async (storage) => {
        try {
          await storage.close();
          console.log('   ✅ Storage connection closed');
        } catch (error) {
          console.error('   ❌ Failed to close storage connection:', error);
        }
      }
    );

    await Promise.all(closePromises);
    console.log('✅ All storage connections closed');
  }

  private async forceShutdown() {
    console.log('🚨 Force shutdown: Terminating active transactions immediately...');
    
    if (this.activeTransactions.size > 0) {
      console.log(`⚠️ ${this.activeTransactions.size} transaction(s) will be terminated:`);
      for (const [, tracker] of this.activeTransactions) {
        const duration = Date.now() - tracker.startTime;
        console.log(`   💥 Terminating: ${tracker.operation} (${duration}ms)`);
      }
    }

    // Try to close storage connections quickly
    try {
      await Promise.race([
        this.closeStorageConnections(),
        new Promise(resolve => setTimeout(resolve, 2000)) // 2 second timeout
      ]);
    } catch (error) {
      console.error('❌ Error during force shutdown:', error);
    }

    // Don't exit during tests - let the test runner handle process lifecycle
    if (this.isTestEnvironment()) {
      console.log('🧪 Test environment detected: Skipping process.exit()');
      return;
    }

    process.exit(1);
  }

  private emergencyShutdown() {
    console.log('💥 Emergency shutdown: Immediate termination');
    
    if (this.activeTransactions.size > 0) {
      console.log(`💥 Emergency: ${this.activeTransactions.size} transaction(s) terminated unexpectedly`);
      console.log('⚠️ Database may be in inconsistent state - check transaction logs');
    }

    // Don't exit during tests - let the test runner handle process lifecycle
    if (this.isTestEnvironment()) {
      console.log('🧪 Test environment detected: Skipping process.exit()');
      return;
    }

    process.exit(1);
  }

  /**
   * Check if shutdown is in progress
   */
  isShutdownInProgress(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Get shutdown status for monitoring
   */
  getStatus() {
    return {
      isShuttingDown: this.isShuttingDown,
      activeTransactions: this.getTransactionStatus(),
      cleanupHandlers: this.cleanupHandlers.size,
      storageConnections: this.storageConnections.size
    };
  }

  /**
   * Check if running in test environment
   */
  private isTestEnvironment(): boolean {
    return process.env['NODE_ENV'] === 'test' || 
           process.env['VITEST'] === 'true' ||
           !!process.env['JEST_WORKER_ID'] ||
           typeof (globalThis as unknown as { __vitest_runner__?: unknown }).__vitest_runner__ !== 'undefined';
  }
}
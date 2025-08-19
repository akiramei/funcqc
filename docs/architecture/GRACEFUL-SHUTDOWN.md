# Graceful Shutdown and Transaction Protection

## Overview

This implementation provides comprehensive protection for database transactions during application shutdown, ensuring data integrity when users press CTRL-C or the process receives termination signals.

## Problem Solved

Previously, when a user pressed CTRL-C during a database operation, the process would terminate immediately, potentially leaving the database in an inconsistent state:

- Partial transactions could be committed
- Database connections might not be properly closed
- Critical cleanup operations could be skipped
- Data corruption could occur in multi-table operations

## Solution Architecture

### 1. GracefulShutdown Class (`src/utils/graceful-shutdown.ts`)

A singleton class that manages graceful shutdown across the entire application:

```typescript
const gracefulShutdown = GracefulShutdown.getInstance();

// Register storage connections for cleanup
gracefulShutdown.registerStorageConnection(storageAdapter);

// Track active transactions
gracefulShutdown.trackTransaction(transactionId, operation, promise);

// Add custom cleanup handlers
gracefulShutdown.addCleanupHandler('temp-files', async () => {
  await cleanupTempFiles();
});
```

### 2. Signal Handling

Captures and handles multiple termination signals:

- **SIGINT** (CTRL-C): Most common user interruption
- **SIGTERM**: Process termination signal
- **SIGQUIT**: Quit signal
- **uncaughtException**: Emergency cleanup for unexpected errors
- **unhandledRejection**: Promise rejection cleanup

### 3. Transaction Tracking

All database transactions are automatically tracked:

```typescript
// Automatically tracked in PGLiteStorageAdapter
const result = await adapter.executeScanWorkflowInTransaction({
  sourceFiles: [...],
  functions: [...],
  analysisLevel: 'BASIC',
  snapshotOptions: { ... }
});

// Transaction is automatically registered and protected
```

### 4. Protected Operations

The following operations are now protected:

- `saveSnapshot()` - Creating snapshots with functions
- `executeScanWorkflowInTransaction()` - Complete scan workflows
- `insertInternalCallEdges()` - Bulk edge insertions
- All custom transactions using the storage adapter

## Implementation Details

### Shutdown Flow

1. **Signal Detection**: Process receives termination signal
2. **Transaction Wait**: Wait for active transactions to complete (up to 30 seconds)
3. **Cleanup Execution**: Run all registered cleanup handlers in parallel
4. **Storage Close**: Close all registered storage connections
5. **Graceful Exit**: Exit with code 0 on success

### Force Shutdown

If user presses CTRL-C twice or shutdown takes too long:

1. **Immediate Termination**: Skip waiting for transactions
2. **Quick Cleanup**: Attempt rapid storage connection closure (2 second timeout)
3. **Force Exit**: Exit with code 1

### Emergency Shutdown

For unexpected errors (uncaught exceptions):

1. **Log Error**: Display error information
2. **Warn User**: Indicate potential database inconsistency
3. **Immediate Exit**: Exit with code 1

## Usage Examples

### Basic Usage (Automatic)

```typescript
// In CLI commands - automatically handled
import { GracefulShutdown } from '../utils/graceful-shutdown';

// Graceful shutdown is automatically initialized in cli.ts
// Storage connections are automatically registered
// Transactions are automatically tracked
```

### Custom Cleanup

```typescript
const gracefulShutdown = GracefulShutdown.getInstance();

// Add custom cleanup for temporary resources
gracefulShutdown.addCleanupHandler('temp-cache', async () => {
  await redis.flushall();
  await redis.disconnect();
});

// Remove cleanup when no longer needed
gracefulShutdown.removeCleanupHandler('temp-cache');
```

### Manual Transaction Tracking

```typescript
const transactionId = randomUUID();
const operation = 'customOperation';

const promise = performLongRunningOperation();

// Track the transaction for graceful shutdown protection
return gracefulShutdown.trackTransaction(transactionId, operation, promise);
```

## Benefits

### 1. Data Integrity

- **Atomic Operations**: Transactions complete or rollback entirely
- **No Partial States**: Database remains consistent even during interruption
- **Proper Cleanup**: All resources are released correctly

### 2. User Experience

- **Clear Feedback**: Users see what's happening during shutdown
- **Predictable Behavior**: Consistent shutdown process across all commands
- **Force Option**: Users can force quit if needed (double CTRL-C)

### 3. Reliability

- **Timeout Protection**: Prevents infinite hangs during shutdown
- **Error Handling**: Graceful handling of cleanup failures
- **Resource Management**: Prevents resource leaks

### 4. Monitoring

- **Transaction Status**: View active transactions during shutdown
- **Progress Feedback**: Real-time updates on cleanup progress
- **Debug Information**: Detailed logging for troubleshooting

## Configuration

### Timeouts

```typescript
// Default timeout is 30 seconds, can be customized
private shutdownTimeout = 30000; // milliseconds
```

### Monitoring

```typescript
// Get current status
const status = gracefulShutdown.getStatus();
console.log('Active transactions:', status.activeTransactions.count);
console.log('Cleanup handlers:', status.cleanupHandlers);
console.log('Storage connections:', status.storageConnections);
```

## Testing

### Automated Tests

```bash
# Run graceful shutdown tests
npm test -- test/graceful-shutdown

# Run transaction integrity tests  
npm test -- test/transaction-integrity
```

### Manual Testing

```bash
# Start a long-running operation and press CTRL-C
npm run dev scan --label test-shutdown

# During scan execution, press CTRL-C to test graceful shutdown
# Press CTRL-C twice to test force shutdown
```

## Integration Points

### CLI Integration

- Automatically initialized in `src/cli.ts`
- All commands benefit from protection
- No additional setup required

### Storage Integration

- Automatically integrated in `PGLiteStorageAdapter`
- All transactions are tracked
- Storage connections are managed

### Custom Commands

For custom commands requiring protection:

```typescript
import { GracefulShutdown } from '../utils/graceful-shutdown';

export async function customCommand(options: any) {
  const gracefulShutdown = GracefulShutdown.getInstance();
  
  // Add any custom cleanup needed
  gracefulShutdown.addCleanupHandler('custom-cleanup', async () => {
    // Custom cleanup logic
  });
  
  // Your command logic here
  // Transactions are automatically protected
}
```

## Error Scenarios

### Transaction Timeout

```
⏳ Waiting for 2 active transaction(s) to complete...
   📝 scanWorkflow(150 functions, 25 files) (12345abc...) - 5000ms
   📝 insertCallEdges(45 edges) (67890def...) - 3000ms
⚠️ Some transactions did not complete in time: Transaction timeout
✅ All cleanup handlers executed
```

### Force Shutdown

```
🛑 Graceful shutdown initiated...
⏳ Waiting for 1 active transaction(s) to complete...
🚨 Force shutdown requested...
⚠️ 1 transaction(s) will be terminated:
   💥 Terminating: scanWorkflow(100 functions, 15 files) (8000ms)
```

### Emergency Shutdown

```
💥 Uncaught exception: Error: Database connection lost
💥 Emergency shutdown: Immediate termination
💥 Emergency: 1 transaction(s) terminated unexpectedly
⚠️ Database may be in inconsistent state - check transaction logs
```

## Best Practices

### 1. Always Use Transactions

```typescript
// Good - uses protected transaction
await adapter.executeScanWorkflowInTransaction({...});

// Avoid - multiple separate operations
await adapter.createSnapshot({...});
await adapter.saveFunctions([...]);
await adapter.insertCallEdges([...]);
```

### 2. Register Resources

```typescript
// Register any resources that need cleanup
gracefulShutdown.addCleanupHandler('custom-resource', async () => {
  await resource.cleanup();
});
```

### 3. Handle Long Operations

```typescript
// For operations that might take a long time
const operation = 'longAnalysis';
const promise = performAnalysis();

// Track for graceful shutdown
return gracefulShutdown.trackTransaction(uuid(), operation, promise);
```

### 4. Test Interruption

```typescript
// Always test your commands with CTRL-C during execution
// Ensure data remains consistent after interruption
```

## Future Enhancements

### 1. Progress Reporting

- Show percentage completion during shutdown
- Estimate remaining time for transactions

### 2. Configurable Timeouts

- Per-operation timeout configuration
- Dynamic timeout adjustment based on operation type

### 3. Distributed Transactions

- Support for transactions across multiple databases
- Coordination with external services

### 4. Metrics Collection

- Track shutdown frequency and duration
- Monitor transaction completion rates
- Alert on abnormal shutdown patterns

## Conclusion

The graceful shutdown implementation ensures that funcqc maintains data integrity even when interrupted by user actions or system signals. This provides a robust foundation for reliable database operations and a better user experience.
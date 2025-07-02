# Timeout Behavior in funcqc

## Current Timeout Situations

### 1. Test Timeouts (Environment Variables)
- `ANN_BUILD_TIME_LIMIT`: Maximum time for building ANN index in tests
- `ANN_SEARCH_TIME_LIMIT`: Maximum time for ANN search in tests
- **Impact**: Only affects test pass/fail, not actual functionality

### 2. CLI Command Timeouts
Currently, there's no built-in timeout mechanism in the CLI commands. If operations take too long:
- User must manually interrupt (Ctrl+C)
- No partial results are saved
- Operation state is lost

## What Happens When Timeout Occurs

### Without Graceful Handling (Current)
```bash
$ funcqc similar --threshold 0.7
# After 30+ seconds...
# User presses Ctrl+C
^C
# Process terminated, no results shown
```

### With Graceful Handling (Proposed)
```bash
$ funcqc similar --threshold 0.7 --timeout 10s
Using detector: hash-duplicate
✔ Found 9 groups using hash detection (3s)

Using detector: ast-structural
⚠ Operation timed out after 10s
✔ Processed 234/561 functions before timeout

Partial Results:
[Shows results found so far]

💡 Tip: Use a higher threshold (≥0.85) for faster results
💡 Tip: Use "funcqc vectorize" to enable faster semantic search
```

## Recommended Timeout Strategies

### 1. For Similar Command
```typescript
// Proposed implementation
const DETECTOR_TIMEOUTS = {
  'hash-duplicate': 5000,      // 5 seconds (should be instant)
  'ann-semantic': 10000,       // 10 seconds
  'ast-structural': 30000      // 30 seconds (O(n²) algorithm)
};
```

### 2. For Vectorize Command
```typescript
// Batch processing with progress
const EMBEDDING_TIMEOUT = 300000;  // 5 minutes total
const BATCH_TIMEOUT = 30000;       // 30 seconds per batch
```

### 3. For Scan Command
```typescript
// File processing timeout
const FILE_TIMEOUT = 5000;         // 5 seconds per file
const TOTAL_TIMEOUT = 600000;      // 10 minutes total
```

## Best Practices

### 1. Always Show Partial Results
When a timeout occurs, show what was completed:
- Number of items processed
- Partial results found
- Estimated remaining time

### 2. Provide Clear Next Steps
After timeout, suggest:
- Using different parameters (higher threshold)
- Enabling faster algorithms (vectorize for ANN)
- Breaking work into smaller chunks

### 3. Save Progress When Possible
For long operations:
- Save intermediate results to database
- Allow resuming from last checkpoint
- Show progress percentage

## Implementation Priority

1. **High Priority**: Similar command with O(n²) algorithm
2. **Medium Priority**: Vectorize command for large datasets
3. **Low Priority**: Other commands that typically complete quickly

## User Configuration

Allow users to configure timeouts:
```javascript
// .funcqcrc
{
  "timeouts": {
    "similar": 30000,
    "vectorize": 300000,
    "scan": 600000
  }
}
```

Or via CLI:
```bash
funcqc similar --timeout 60s
funcqc vectorize --timeout 10m
```
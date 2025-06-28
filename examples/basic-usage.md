# funcqc Basic Usage Examples

## Getting Started

### 1. Initialize funcqc in your project

```bash
# Initialize with default settings
npx tsx src/cli.ts init

# Initialize with custom settings
npx tsx src/cli.ts init --root src,lib --exclude "**/*.test.ts" --db .funcqc/quality.db
```

This creates a `.funcqc.config.js` file in your project root.

### 2. Scan your code

```bash
# Basic scan
npx tsx src/cli.ts scan

# Scan with label
npx tsx src/cli.ts scan --label "initial-scan"

# Dry run (analyze but don't save)
npx tsx src/cli.ts scan --dry-run

# Scan specific paths
npx tsx src/cli.ts scan src lib
```

### 3. View your functions

```bash
# List all functions
npx tsx src/cli.ts list

# Filter by name pattern
npx tsx src/cli.ts list "fetch*"

# Filter by complexity
npx tsx src/cli.ts list --complexity ">5"

# Show only exported functions
npx tsx src/cli.ts list --exported

# Show only async functions
npx tsx src/cli.ts list --async

# Combine filters
npx tsx src/cli.ts list "get*" --file "src/api/*" --complexity ">3"

# Output as JSON
npx tsx src/cli.ts list --json

# Custom fields and sorting
npx tsx src/cli.ts list --fields "name,file,complexity,lines" --sort "complexity:desc"
```

### 4. Check project status

```bash
# Basic status
npx tsx src/cli.ts status

# Detailed status
npx tsx src/cli.ts status --verbose
```

### 5. View history

```bash
# Show recent snapshots
npx tsx src/cli.ts history

# Detailed history
npx tsx src/cli.ts history --verbose

# Filter by date
npx tsx src/cli.ts history --since "2024-01-01"

# Filter by branch
npx tsx src/cli.ts history --branch "main"

# Limit results
npx tsx src/cli.ts history --limit 10
```

### 6. Compare snapshots

```bash
# Compare two snapshots by ID
npx tsx src/cli.ts diff abc123 def456

# Compare by label
npx tsx src/cli.ts diff "before-refactor" "after-refactor"

# Compare latest with previous
npx tsx src/cli.ts diff HEAD~1 HEAD

# Show summary only
npx tsx src/cli.ts diff abc123 def456 --summary

# Filter by function name
npx tsx src/cli.ts diff abc123 def456 --function "fetchUser"

# Filter by file
npx tsx src/cli.ts diff abc123 def456 --file "src/api"

# Output as JSON
npx tsx src/cli.ts diff abc123 def456 --json
```

## Common Workflows

### 1. Daily Quality Check

```bash
# Create a daily snapshot
npx tsx src/cli.ts scan --label "daily-$(date +%Y%m%d)"

# Check for high complexity functions
npx tsx src/cli.ts list --complexity ">10" --sort "complexity:desc"

# View recent changes
npx tsx src/cli.ts history --limit 5
```

### 2. Before/After Refactoring

```bash
# Before refactoring
npx tsx src/cli.ts scan --label "before-refactor"

# ... do your refactoring ...

# After refactoring
npx tsx src/cli.ts scan --label "after-refactor"

# Compare results
npx tsx src/cli.ts diff before-refactor after-refactor

# Check if complexity improved
npx tsx src/cli.ts diff before-refactor after-refactor --metric cyclomaticComplexity
```

### 3. Code Review Preparation

```bash
# Scan current branch
npx tsx src/cli.ts scan --label "feature-branch"

# Compare with main branch (assuming you have a main snapshot)
npx tsx src/cli.ts diff main-baseline feature-branch

# Show only high-impact changes
npx tsx src/cli.ts diff main-baseline feature-branch --threshold 2

# Generate JSON report
npx tsx src/cli.ts diff main-baseline feature-branch --json > quality-report.json
```

### 4. Find Technical Debt

```bash
# Find complex functions
npx tsx src/cli.ts list --complexity ">15"

# Find long functions
npx tsx src/cli.ts list --lines ">100"

# Find functions with many parameters
npx tsx src/cli.ts list --params ">5"

# Combine criteria for worst offenders
npx tsx src/cli.ts list --complexity ">10" --lines ">50" --params ">4"
```

## Configuration Examples

### Basic Configuration (.funcqc.config.js)

```javascript
module.exports = {
  roots: ['src'],
  exclude: [
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/node_modules/**',
    '**/dist/**'
  ],
  storage: {
    type: 'pglite',
    path: '.funcqc/funcqc.db'
  },
  metrics: {
    complexityThreshold: 10,
    linesOfCodeThreshold: 50,
    parameterCountThreshold: 5
  },
  git: {
    enabled: true,
    autoLabel: true
  }
};
```

### Advanced Configuration

```javascript
module.exports = {
  roots: ['src', 'lib'],
  include: ['**/*.ts', '**/*.tsx'],
  exclude: [
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/__tests__/**',
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**'
  ],
  storage: {
    type: 'pglite',
    path: '.funcqc/funcqc.db'
  },
  metrics: {
    complexityThreshold: 8,
    linesOfCodeThreshold: 40,
    parameterCountThreshold: 4
  },
  git: {
    enabled: true,
    autoLabel: true
  }
};
```

## Tips and Best Practices

1. **Regular Scanning**: Set up regular scans (daily/weekly) to track quality trends
2. **Meaningful Labels**: Use descriptive labels for important snapshots
3. **Complexity Targets**: Set reasonable complexity thresholds for your team
4. **Code Review Integration**: Use diff reports in code review process
5. **Trend Analysis**: Use history to identify quality trends over time
6. **Refactoring Validation**: Always compare before/after refactoring
7. **CI Integration**: Consider running scans in your CI pipeline

## Sample Output

### List Command
```
┌──────────┬─────────────────┬───────┬────────────┐
│ Name     │ File            │ Lines │ Complexity │
├──────────┼─────────────────┼───────┼────────────┤
│ fetchUser│ src/api.ts      │ 25    │ 4          │
│ validate │ src/utils.ts    │ 12    │ 2          │
└──────────┴─────────────────┴───────┴────────────┘

Total: 2 functions, Avg Complexity: 3.0
```

### Diff Command
```
🔍 Function Differences

From: before-refactor (2 hours ago)
To: after-refactor (just now)

📊 Diff Summary

Changes:
  + 1 functions added
  - 0 functions removed
  ~ 2 functions modified
  = 15 functions unchanged

Complexity: 📉 -5
Lines: ✂️ -23
```
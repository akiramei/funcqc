# funcqc inspect

🔍 Unified function and file inspection command that consolidates list, search, files, and show functionality.

## Usage

```bash
funcqc inspect [options] [pattern]
```

## Description

The `inspect` command provides comprehensive inspection capabilities for functions and files in your codebase. It replaces the legacy `list`, `search`, `files`, and `show` commands with a unified, powerful interface for exploring your code quality data.

## Options

### Basic Options
- `--type <type>` - Inspection type: `functions`, `files`, `detailed`
- `--detailed` - Show detailed information (equivalent to legacy `show`)
- `-j, --json` - Output results as JSON
- `--verbose` - Include additional metadata
- `--quiet` - Minimal output

### Filtering Options
- `--name <pattern>` - Filter by function/file name pattern
- `--file <path>` - Filter by specific file path
- `--cc-ge <number>` - Cyclomatic complexity >= threshold
- `--cc-le <number>` - Cyclomatic complexity <= threshold
- `--risk-ge <number>` - Risk score >= threshold
- `--lines-ge <number>` - Lines of code >= threshold
- `--params-ge <number>` - Parameter count >= threshold

### Display Options
- `--limit <number>` - Limit number of results
- `--sort <field>` - Sort by field (cc, risk, lines, name)
- `--desc` - Sort in descending order
- `--columns <fields>` - Specify output columns
- `--format <format>` - Output format (table, json, csv)

### Scope Options
- `--snapshot <id>` - Use specific snapshot
- `--scope <name>` - Analysis scope filter

## Inspection Types

### `functions` - Function Inspection (Default)
Inspect individual functions and their metrics.

```bash
# List all functions
funcqc inspect

# High complexity functions
funcqc inspect --cc-ge 10

# Functions in specific file
funcqc inspect --file src/utils/parser.ts
```

### `files` - File-level Inspection
Inspect files and their aggregate metrics.

```bash
# List all files
funcqc inspect --type files

# Largest files by line count
funcqc inspect --type files --sort lines --desc --limit 10

# Files with many functions
funcqc inspect --type files --sort funcs --desc
```

### `detailed` - Detailed Function Information
Show comprehensive information about specific functions.

```bash
# Detailed view of specific function
funcqc inspect --detailed --name "parseConfig"

# Detailed view by function ID
funcqc inspect --detailed --id "func-abc123"
```

## Common Usage Patterns

### Quality Review Workflows

```bash
# Find problematic functions
funcqc inspect --cc-ge 15 --sort cc --desc --limit 20

# High-risk functions
funcqc inspect --risk-ge 100 --sort risk --desc

# Large functions that might need splitting
funcqc inspect --lines-ge 100 --sort lines --desc
```

### Code Navigation

```bash
# Search functions by name
funcqc inspect --name "*parser*"

# Functions in specific module
funcqc inspect --file "src/parsers/*"

# All exported functions
funcqc inspect --name "export*"
```

### File Analysis

```bash
# Largest files in project
funcqc inspect --type files --sort lines --desc --limit 10

# Files with most complex functions
funcqc inspect --type files --sort complexity --desc

# Test file analysis
funcqc inspect --type files --file "**/*.test.ts"
```

## Filtering Examples

### Complexity-based Filtering

```bash
# High complexity functions
funcqc inspect --cc-ge 20

# Medium complexity range
funcqc inspect --cc-ge 10 --cc-le 20

# Low complexity (simple functions)
funcqc inspect --cc-le 5
```

### Risk-based Filtering

```bash
# High-risk functions requiring attention
funcqc inspect --risk-ge 50 --sort risk --desc

# Medium-risk functions
funcqc inspect --risk-ge 20 --risk-le 50
```

### Size-based Filtering

```bash
# Large functions
funcqc inspect --lines-ge 50

# Functions with many parameters
funcqc inspect --params-ge 5

# Complex functions with many parameters
funcqc inspect --cc-ge 10 --params-ge 4
```

## Output Customization

### Table Format

```bash
# Default table output
funcqc inspect --cc-ge 10

# Custom columns
funcqc inspect --columns name,cc,risk,lines --sort cc --desc

# Wide format with all details
funcqc inspect --verbose --columns all
```

### JSON Output

```bash
# JSON for programmatic use
funcqc inspect --cc-ge 15 --json

# Pipe to jq for processing
funcqc inspect --risk-ge 50 --json | jq '.[] | {name: .name, risk: .risk}'
```

### CSV Export

```bash
# CSV for spreadsheet analysis
funcqc inspect --cc-ge 10 --format csv > high-complexity.csv

# Custom CSV columns
funcqc inspect --format csv --columns name,file,cc,risk --sort cc --desc
```

## Pattern Matching

### Name Patterns

```bash
# Functions starting with "get"
funcqc inspect --name "get*"

# Functions containing "config"
funcqc inspect --name "*config*"

# Utility functions
funcqc inspect --name "*util*" --name "*helper*"
```

### File Patterns

```bash
# All TypeScript files
funcqc inspect --file "**/*.ts"

# Exclude test files
funcqc inspect --file "src/**/*.ts" --file "!**/*.test.ts"

# Specific directory
funcqc inspect --file "src/components/**"
```

## Detailed Inspection

### Function Details

```bash
# Comprehensive function information
funcqc inspect --detailed --name "complexFunction"
```

**Detailed output includes:**
- Full function signature
- Complexity breakdown
- Risk factors
- Dependencies and dependents
- Change history
- Code location
- Quality recommendations

### Comparative Analysis

```bash
# Compare functions with similar names
funcqc inspect --detailed --name "*parser*" --sort cc --desc

# Detailed view of high-risk functions
funcqc inspect --detailed --risk-ge 100
```

## Integration Examples

### Git Hooks

```bash
# Pre-commit: Check for high complexity
#!/bin/bash
HIGH_CC=$(funcqc inspect --cc-ge 20 --quiet --format json | jq length)
if [ "$HIGH_CC" -gt 0 ]; then
  echo "Warning: $HIGH_CC high-complexity functions found"
  funcqc inspect --cc-ge 20 --columns name,file,cc
fi
```

### Code Review

```bash
# Review functions changed in current branch
CHANGED_FILES=$(git diff --name-only main...HEAD | grep '\.ts$')
for file in $CHANGED_FILES; do
  echo "=== $file ==="
  funcqc inspect --file "$file" --cc-ge 10
done
```

### Quality Dashboards

```bash
# Generate quality metrics for dashboard
funcqc inspect --json | jq '{
  total: length,
  highComplexity: [.[] | select(.cyclomaticComplexity >= 15)] | length,
  highRisk: [.[] | select(.risk >= 50)] | length
}'
```

## Performance Tips

### Large Codebases

```bash
# Use limits for large results
funcqc inspect --cc-ge 10 --limit 50

# Focus on specific areas
funcqc inspect --file "src/core/**" --cc-ge 15

# Use specific snapshots
funcqc inspect --snapshot latest --risk-ge 50
```

### Efficient Queries

```bash
# Combine filters efficiently
funcqc inspect --cc-ge 15 --risk-ge 50  # Both conditions

# Use appropriate sorting
funcqc inspect --sort cc --desc --limit 10  # Top 10 complex
```

## Error Handling

### Common Issues

**No results found:**
```bash
# Check if measurement exists
funcqc measure --history

# Verify filters
funcqc inspect --verbose  # See applied filters
```

**Large result sets:**
```bash
# Use pagination
funcqc inspect --limit 100 --sort name

# Add more specific filters
funcqc inspect --file "src/**" --cc-ge 10
```

## See Also

- [measure](measure.md) - Create data for inspection
- [assess](assess.md) - Quality assessment based on inspection results
- [improve](improve.md) - Find improvement opportunities for inspected functions
- [Migration Guide](../migration-guide.md) - Upgrading from `list`, `search`, `files`, `show` commands
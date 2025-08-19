# funcqc dependencies

🔗 Unified dependency analysis command that consolidates all dep subcommands into comprehensive relationship analysis.

## Usage

```bash
funcqc dependencies [options] [target]
```

## Description

The `dependencies` command provides comprehensive analysis of function dependencies, call relationships, and architectural structure. It replaces all legacy `dep` subcommands (`list`, `show`, `stats`, `lint`, `dead`, `cycles`) with a unified interface for dependency analysis.

## Options

### Basic Options
- `--action <action>` - Analysis action: `list`, `show`, `stats`, `lint`, `dead`, `cycles`
- `-j, --json` - Output results as JSON
- `--verbose` - Include detailed analysis information
- `--quiet` - Minimal output

### Filtering Options
- `--depth <number>` - Analysis depth (default: 3)
- `--include-external` - Include external dependencies
- `--exclude-tests` - Exclude test files
- `--scope <name>` - Limit to specific scope
- `--type <type>` - Dependency type: `direct`, `indirect`, `circular`

### Display Options
- `--format <format>` - Output format: `tree`, `list`, `graph`, `json`
- `--show-paths` - Show dependency paths
- `--show-metrics` - Include dependency metrics
- `--show-hubs` - Highlight hub functions
- `--limit <number>` - Limit number of results

### Analysis Options
- `--confidence <level>` - Analysis confidence: `low`, `medium`, `high`
- `--min-impact <score>` - Minimum impact score for inclusion
- `--max-violations <count>` - Maximum violations before failure

## Dependency Actions

### `list` - List Dependencies
Show dependency relationships for functions or files.

```bash
# List dependencies for all functions
funcqc dependencies --action list

# Dependencies for specific function
funcqc dependencies --action list parseConfig

# Include external dependencies
funcqc dependencies --action list --include-external

# Limit depth
funcqc dependencies --action list --depth 2
```

### `show` - Show Detailed Dependencies
Detailed dependency analysis for specific targets.

```bash
# Show detailed dependencies for function
funcqc dependencies --action show analyzeFile

# Include dependency paths
funcqc dependencies --action show analyzeFile --show-paths

# Show both dependencies and dependents
funcqc dependencies --action show analyzeFile --verbose
```

### `stats` - Dependency Statistics
Generate statistics about dependency patterns.

```bash
# Overall dependency statistics
funcqc dependencies --action stats

# Show hub functions (highly connected)
funcqc dependencies --action stats --show-hubs

# Include external dependency stats
funcqc dependencies --action stats --include-external
```

### `lint` - Dependency Linting
Identify dependency-related issues and violations.

```bash
# Check for dependency issues
funcqc dependencies --action lint

# Fail on violations
funcqc dependencies --action lint --max-violations 0

# Detailed violation analysis
funcqc dependencies --action lint --verbose
```

### `dead` - Dead Code Detection
Find potentially unused functions and dependencies.

```bash
# Find dead code
funcqc dependencies --action dead

# High confidence only
funcqc dependencies --action dead --confidence high

# Include impact analysis
funcqc dependencies --action dead --show-metrics
```

### `cycles` - Circular Dependency Detection
Detect and analyze circular dependencies.

```bash
# Find circular dependencies
funcqc dependencies --action cycles

# Show cycle paths
funcqc dependencies --action cycles --show-paths

# Detailed cycle analysis
funcqc dependencies --action cycles --verbose
```

## Dependency Analysis

### Function Dependencies

```bash
# Direct dependencies only
funcqc dependencies --action show parseConfig --depth 1

# Deep dependency tree
funcqc dependencies --action show parseConfig --depth 5 --format tree

# Dependencies with metrics
funcqc dependencies --action show parseConfig --show-metrics
```

### File-level Dependencies

```bash
# File dependencies
funcqc dependencies --action list --scope file src/parser.ts

# Cross-file dependencies
funcqc dependencies --action show --include-external src/parser.ts
```

### Module Dependencies

```bash
# Module-level analysis
funcqc dependencies --action stats --scope module

# External module dependencies
funcqc dependencies --action list --include-external --type direct
```

## Output Formats

### Tree Format

```bash
funcqc dependencies --action show parseConfig --format tree
```
```
parseConfig
├── validateConfig (direct)
│   ├── checkRequired (direct)
│   └── validateType (direct)
├── loadDefaults (direct)
└── mergeConfig (direct)
    └── deepMerge (direct)
```

### List Format

```bash
funcqc dependencies --action list --format list
```
```
Function Dependencies:
- parseConfig → validateConfig (direct, impact: 85)
- parseConfig → loadDefaults (direct, impact: 45)
- validateConfig → checkRequired (direct, impact: 30)
```

### Graph Format

```bash
funcqc dependencies --action show parseConfig --format graph --show-paths
```
Generates DOT format output suitable for visualization tools.

### JSON Format

```bash
funcqc dependencies --action show parseConfig --json
```
```json
{
  "target": "parseConfig",
  "dependencies": [
    {
      "name": "validateConfig",
      "type": "direct",
      "impact": 85,
      "path": ["parseConfig", "validateConfig"]
    }
  ],
  "metrics": {
    "totalDependencies": 12,
    "directDependencies": 3,
    "maxDepth": 4
  }
}
```

## Statistics and Metrics

### Hub Analysis

```bash
# Find highly connected functions (hubs)
funcqc dependencies --action stats --show-hubs --verbose
```

**Hub Metrics:**
- **Fan-in**: Number of functions that depend on this function
- **Fan-out**: Number of functions this function depends on
- **Centrality**: Importance in the dependency graph
- **Impact Score**: Potential change impact

### Dependency Patterns

```bash
# Analyze dependency patterns
funcqc dependencies --action stats --show-metrics
```

**Pattern Analysis:**
- Average dependency depth
- Circular dependency count
- External dependency ratio
- Coupling distribution

### Quality Metrics

```bash
# Quality-focused statistics
funcqc dependencies --action lint --show-metrics
```

**Quality Indicators:**
- Cyclic complexity
- Coupling strength
- Cohesion measures
- Architectural violations

## Circular Dependency Detection

### Finding Cycles

```bash
# Basic cycle detection
funcqc dependencies --action cycles

# Show all paths in cycles
funcqc dependencies --action cycles --show-paths --verbose

# High-confidence cycles only
funcqc dependencies --action cycles --confidence high
```

### Cycle Analysis

```bash
# Detailed cycle analysis with metrics
funcqc dependencies --action cycles --show-metrics --json
```

**Cycle Information:**
- Cycle length and complexity
- Functions involved in cycles
- Breaking recommendations
- Impact assessment

### Cycle Resolution

```bash
# Generate cycle breaking recommendations
funcqc dependencies --action cycles --verbose --format report
```

## Dead Code Detection

### Detection Strategies

```bash
# Conservative detection (high confidence)
funcqc dependencies --action dead --confidence high

# Comprehensive detection
funcqc dependencies --action dead --confidence medium --include-external

# Aggressive detection (includes potential dead code)
funcqc dependencies --action dead --confidence low
```

### Dead Code Types

- **Unreferenced functions**: No incoming dependencies
- **Orphaned modules**: No external references
- **Unused exports**: Exported but not imported
- **Test-only code**: Only used in tests

### Impact Analysis

```bash
# Dead code with impact analysis
funcqc dependencies --action dead --show-metrics --verbose
```

## Dependency Linting

### Common Violations

```bash
# Standard dependency linting
funcqc dependencies --action lint
```

**Detected Issues:**
- Circular dependencies
- Excessive coupling
- Missing dependencies
- Architectural violations
- Cross-layer dependencies

### Custom Rules

```bash
# Strict architectural rules
funcqc dependencies --action lint --max-violations 0

# Focus on specific patterns
funcqc dependencies --action lint --type circular --verbose
```

## Integration Examples

### Code Review

```bash
#!/bin/bash
# Pre-commit dependency check
echo "Checking for new circular dependencies..."
CYCLES=$(funcqc dependencies --action cycles --quiet --json | jq length)
if [ "$CYCLES" -gt 0 ]; then
  echo "❌ Circular dependencies detected:"
  funcqc dependencies --action cycles --show-paths
  exit 1
fi

echo "Checking for dead code..."
funcqc dependencies --action dead --confidence high
```

### CI/CD Pipeline

```yaml
- name: Dependency Analysis
  run: |
    # Check for architectural violations
    funcqc dependencies --action lint --max-violations 5
    
    # Report hub functions
    funcqc dependencies --action stats --show-hubs --json > hubs.json
    
    # Check for excessive coupling
    MAX_FANIN=$(jq '.hubs | map(.fanIn) | max' hubs.json)
    if [ "$MAX_FANIN" -gt 50 ]; then
      echo "Excessive coupling detected: $MAX_FANIN"
      exit 1
    fi
```

### Architecture Review

```bash
# Generate comprehensive dependency report
funcqc dependencies --action stats --verbose --format report > dependency-report.html
funcqc dependencies --action cycles --show-paths --format graph > cycles.dot
funcqc dependencies --action lint --verbose > violations.txt
```

## Advanced Analysis

### Impact Analysis

```bash
# Analyze change impact
funcqc dependencies --action show criticalFunction --show-metrics --depth 5

# Find functions with high impact
funcqc dependencies --action stats --min-impact 80 --show-hubs
```

### Architectural Analysis

```bash
# Layer compliance checking
funcqc dependencies --action lint --scope architecture

# Cross-module dependency analysis
funcqc dependencies --action stats --include-external --show-metrics
```

### Refactoring Support

```bash
# Find refactoring candidates
funcqc dependencies --action dead --confidence medium
funcqc dependencies --action cycles --show-paths
funcqc dependencies --action stats --show-hubs --min-impact 90
```

## Performance Optimization

### Large Codebases

```bash
# Limit analysis scope
funcqc dependencies --action stats --scope src/core

# Use appropriate depth limits
funcqc dependencies --action show function --depth 3

# Focus on specific areas
funcqc dependencies --action lint --exclude-tests
```

### Efficient Queries

```bash
# Target specific analysis
funcqc dependencies --action cycles --confidence high
funcqc dependencies --action dead --confidence high --limit 20
```

## Troubleshooting

### Common Issues

**Long analysis times:**
```bash
# Reduce scope
funcqc dependencies --action stats --scope core --depth 3

# Use higher confidence levels
funcqc dependencies --action dead --confidence high
```

**Too many violations:**
```bash
# Focus on critical issues
funcqc dependencies --action lint --confidence high

# Increase violation threshold temporarily
funcqc dependencies --action lint --max-violations 20
```

**Memory issues with large graphs:**
```bash
# Limit depth and scope
funcqc dependencies --action show function --depth 2 --scope file
```

## See Also

- [assess](assess.md) - Quality assessment including dependency health
- [improve](improve.md) - Act on dependency analysis findings
- [refactor](refactor.md) - Dependency-aware refactoring analysis
- [Migration Guide](../migration-guide.md) - Upgrading from `dep` subcommands
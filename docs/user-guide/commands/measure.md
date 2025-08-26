# funcqc measure

> 注意: 本コマンドは統合コマンド構想の一部であり、現行CLIには未実装です。現行の測定・分析は `funcqc scan`（`--with-basic`/`--full`/`--with-types` 等）をご利用ください。

📊 Unified measurement command that consolidates scanning and analysis functionality into a comprehensive project measurement system.

## Usage

```bash
funcqc measure [options]
```

## Description

The `measure` command is the foundation of funcqc analysis. It scans your TypeScript codebase, analyzes functions, tracks changes, and builds a comprehensive understanding of your project's quality metrics. This command replaces the legacy `scan` and `analyze` commands.

## Options

### Basic Options
- `--label <text>` - Label for this measurement snapshot
- `--comment <text>` - Comment for measurement configuration changes
- `--scope <name>` - Measurement scope (src, test, all, or custom scope)
- `-j, --json` - Output measurement results as JSON
- `--verbose` - Detailed progress output
- `--quiet` - Minimal output

### Measurement Levels
- `--level <level>` - Measurement depth: `quick`, `basic`, `standard`, `deep`, `complete`
- `--full` - Alias for `--level complete`
- `--with-basic` - Alias for `--level basic`

### Analysis Types
- `--call-graph` - Include call graph analysis
- `--types` - Include TypeScript type system analysis  
- `--coupling` - Include coupling analysis
- `--with-graph` - Alias for `--call-graph`
- `--with-types` - Alias for `--types`
- `--with-coupling` - Alias for `--coupling`

### Processing Options
- `--realtime-gate` - Enable real-time quality gate
- `--async` - Run heavy analyses in background
- `--force` - Force measurement even if snapshot exists
- `--history` - Display snapshot history instead of creating new measurements

## Measurement Levels

### `quick` - Fast Development Check
**Duration**: ~10-30 seconds  
**Use case**: Pre-commit checks, rapid feedback

```bash
funcqc measure --level quick
```

**Includes**:
- Basic function metrics (CC, LOC, parameters)
- Simple complexity scoring
- Essential quality indicators

### `basic` - Standard Development
**Duration**: ~1-3 minutes  
**Use case**: Regular development workflow

```bash
funcqc measure --level basic
```

**Includes**:
- All quick analysis
- Function relationships
- Basic dependency tracking
- Risk assessment

### `standard` - Comprehensive Analysis (Default)
**Duration**: ~3-10 minutes  
**Use case**: Quality reviews, team reports

```bash
funcqc measure --level standard
```

**Includes**:
- All basic analysis
- Advanced complexity metrics
- Dependency graph construction
- Similarity detection
- Change impact analysis

### `deep` - Detailed Investigation
**Duration**: ~10-30 minutes  
**Use case**: Architecture reviews, major refactoring

```bash
funcqc measure --level deep
```

**Includes**:
- All standard analysis
- Type system analysis
- Coupling measurements
- Advanced similarity detection
- Dead code detection

### `complete` - Exhaustive Analysis
**Duration**: ~30+ minutes  
**Use case**: Major releases, comprehensive audits

```bash
funcqc measure --level complete
```

**Includes**:
- All available analyses
- Maximum precision similarity
- Comprehensive type tracking
- Full dependency resolution
- Historical trend analysis

## Common Usage Patterns

### Development Workflow

```bash
# Daily development - quick feedback
funcqc measure --level quick --label daily-$(date +%Y%m%d)

# Pre-commit check
funcqc measure --level basic --realtime-gate

# Weekly quality review
funcqc measure --level standard --label weekly-review
```

### CI/CD Integration

```bash
# CI pipeline - fast feedback
funcqc measure --level basic --json --quiet

# Release preparation
funcqc measure --level deep --label release-candidate

# Quality gate with exit codes
funcqc measure --level standard --realtime-gate
```

### Specialized Analysis

```bash
# Focus on TypeScript types
funcqc measure --level standard --types

# Analyze function relationships
funcqc measure --level deep --call-graph

# Full coupling analysis
funcqc measure --level deep --coupling
```

## Scoping Options

### Built-in Scopes
```bash
# Analyze only src/ directory
funcqc measure --scope src

# Include test files
funcqc measure --scope test

# Analyze everything
funcqc measure --scope all
```

### Custom Scopes
Configure custom scopes in `.funcqcrc`:
```json
{
  "scopes": {
    "core": ["src/core", "src/lib"],
    "features": ["src/features", "src/components"],
    "infrastructure": ["src/utils", "src/types"]
  }
}
```

```bash
# Use custom scope
funcqc measure --scope core
```

## Background Processing

For large codebases, use background processing:

```bash
# Start measurement in background
funcqc measure --level deep --async --label background-analysis

# Monitor progress
funcqc manage --action history

# Check if complete
funcqc assess --type health
```

## Output and Reporting

### Console Output

```bash
# Detailed progress
funcqc measure --level standard --verbose

# Minimal output for scripts
funcqc measure --level basic --quiet

# JSON for automation
funcqc measure --level standard --json
```

### Snapshot Labeling

```bash
# Meaningful labels for tracking
funcqc measure --label feature/user-auth --comment "Before auth refactor"
funcqc measure --label feature/user-auth-after --comment "After auth refactor"

# Compare later
funcqc manage --action diff --from feature/user-auth --to feature/user-auth-after
```

## Performance Optimization

### For Large Codebases
```bash
# Use appropriate level for size
funcqc measure --level basic    # <1000 functions
funcqc measure --level standard # <5000 functions
funcqc measure --level deep     # <10000 functions

# Use background processing
funcqc measure --level deep --async
```

### For CI/CD
```bash
# Fast CI check
funcqc measure --level quick --realtime-gate --quiet

# Cached measurement (skip if recent)
funcqc measure --level basic --force=false
```

## Integration Examples

### Package.json Scripts

```json
{
  "scripts": {
    "quality:quick": "funcqc measure --level quick",
    "quality:check": "funcqc measure --level standard --realtime-gate",
    "quality:deep": "funcqc measure --level deep --label deep-analysis",
    "quality:ci": "funcqc measure --level basic --json --quiet"
  }
}
```

### GitHub Actions

```yaml
- name: Quality Measurement
  run: |
    funcqc measure --level standard --label ci-${{ github.sha }}
    funcqc assess --type health --json > quality-report.json
```

## Error Handling

### Common Issues

**Large codebase timeouts:**
```bash
# Use async processing
funcqc measure --level deep --async

# Or reduce scope
funcqc measure --scope src --level standard
```

**Memory issues:**
```bash
# Use lighter analysis
funcqc measure --level basic

# Or process in parts
funcqc measure --scope core --level deep
funcqc measure --scope features --level deep
```

### Quality Gates

```bash
# Fail CI if quality drops
funcqc measure --level standard --realtime-gate
echo "Exit code: $?"  # 0 = passed, 1 = failed quality gate
```

## Historical Tracking

```bash
# View measurement history
funcqc measure --history

# Create baseline measurement
funcqc measure --level standard --label baseline

# Track progress over time
funcqc measure --level standard --label milestone-1
funcqc measure --level standard --label milestone-2

# Compare measurements
funcqc manage --action diff --from baseline --to milestone-2
```

## See Also

- [assess](assess.md) - Quality assessment of measurement results
- [inspect](inspect.md) - Detailed inspection of measured functions
- [manage](manage.md) - Managing measurement snapshots and history
- [setup](setup.md) - Configuring default measurement settings

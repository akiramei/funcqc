# funcqc improve

> 注意: 本コマンドは統合コマンド構想の一部であり、現行CLIには未実装です。現行の改善系は `funcqc similar`（重複/類似検出）や `funcqc dep` サブコマンド（`dead`/`delete`/`cycles`/`lint` 等）をご利用ください。

🔧 Unified code improvement command that consolidates similar, safe-delete, and refactor-guard functionality.

## Usage

```bash
funcqc improve [options]
```

## Description

The `improve` command identifies opportunities for code improvement including duplicate detection, dead code removal, and refactoring safety analysis. It replaces the legacy `similar`, `safe-delete`, and `refactor-guard` commands with a unified interface for code enhancement.

## Options

### Basic Options
- `--type <type>` - Improvement type: `duplicates`, `dead-code`, `refactor-safety`
- `-j, --json` - Output results as JSON
- `--verbose` - Include detailed analysis and recommendations
- `--quiet` - Minimal output

### Analysis Options
- `--min-lines <number>` - Minimum lines for similarity detection (default: 5)
- `--similarity-threshold <number>` - Similarity threshold 0.0-1.0 (default: 0.95)
- `--confidence <level>` - Analysis confidence: `low`, `medium`, `high`
- `--detectors <list>` - Comma-separated list of detectors to use

### Processing Options
- `--dry-run` - Show what would be changed without making changes
- `--auto-fix` - Automatically apply safe improvements
- `--interactive` - Interactive improvement mode
- `--scope <name>` - Limit analysis to specific scope

### Output Options
- `--format <format>` - Output format: `summary`, `detailed`, `report`
- `--export <path>` - Export improvement plan to file
- `--group-by <field>` - Group results by field (file, type, similarity)

## Improvement Types

### `duplicates` - Duplicate Code Detection
Find and consolidate similar/duplicate code patterns.

```bash
# Basic duplicate detection
funcqc improve --type duplicates

# Adjust sensitivity
funcqc improve --type duplicates --min-lines 10 --similarity-threshold 0.85

# Focus on high-confidence duplicates
funcqc improve --type duplicates --confidence high
```

**Detection Methods:**
- **AST-based similarity**: Structural code comparison
- **Hash-based detection**: Exact duplicate identification
- **Semantic analysis**: Functionally equivalent code
- **Pattern matching**: Common code patterns

### `dead-code` - Dead Code Detection and Removal
Identify and safely remove unused code.

```bash
# Dead code analysis
funcqc improve --type dead-code

# High-confidence dead code only
funcqc improve --type dead-code --confidence high

# Safe removal (dry-run first)
funcqc improve --type dead-code --dry-run
funcqc improve --type dead-code --auto-fix
```

**Detection Includes:**
- Unused functions and variables
- Unreachable code paths
- Unused imports and dependencies
- Dead configuration options

### `refactor-safety` - Refactoring Safety Analysis
Analyze refactoring risks and generate safety recommendations.

```bash
# Refactoring safety assessment
funcqc improve --type refactor-safety

# Focus on specific functions
funcqc improve --type refactor-safety --scope high-risk-functions

# Generate safety report
funcqc improve --type refactor-safety --format report --export safety-analysis.html
```

**Safety Analysis:**
- Change impact assessment
- Dependency risk evaluation
- Test coverage analysis
- Breaking change detection

## Duplicate Detection

### Similarity Algorithms

```bash
# High precision (fewer false positives)
funcqc improve --type duplicates --similarity-threshold 0.95

# Medium precision (balanced)
funcqc improve --type duplicates --similarity-threshold 0.85

# High recall (more candidates)
funcqc improve --type duplicates --similarity-threshold 0.75
```

### Size Filtering

```bash
# Small duplicates (5+ lines)
funcqc improve --type duplicates --min-lines 5

# Medium duplicates (15+ lines)
funcqc improve --type duplicates --min-lines 15

# Large duplicates (50+ lines)
funcqc improve --type duplicates --min-lines 50
```

### Detector Selection

```bash
# Use specific detectors
funcqc improve --type duplicates --detectors hash-duplicate,ast-similar

# Available detectors:
# - hash-duplicate: Exact text matches
# - ast-similar: Structural similarity
# - semantic-equivalent: Functional equivalence
# - pattern-based: Common patterns
```

## Dead Code Detection

### Confidence Levels

```bash
# Conservative (high confidence only)
funcqc improve --type dead-code --confidence high

# Balanced approach
funcqc improve --type dead-code --confidence medium

# Aggressive (include uncertain cases)
funcqc improve --type dead-code --confidence low
```

### Safe Removal Workflow

```bash
# 1. Analyze dead code
funcqc improve --type dead-code --confidence high --verbose

# 2. Review findings
funcqc improve --type dead-code --dry-run --format detailed

# 3. Apply safe removals
funcqc improve --type dead-code --auto-fix --confidence high

# 4. Verify changes
npm test  # Run your test suite
```

## Refactoring Safety

### Risk Assessment

```bash
# Overall refactoring safety
funcqc improve --type refactor-safety

# Focus on high-risk functions
funcqc improve --type refactor-safety --scope high-complexity

# Detailed safety report
funcqc improve --type refactor-safety --verbose --format report
```

### Safety Metrics

- **Change Impact Score**: How many other functions affected
- **Test Coverage**: Existing test protection
- **Dependency Risk**: External dependency complications
- **API Stability**: Public interface considerations

## Output Formats

### Summary Format (Default)

```bash
funcqc improve --type duplicates
```
```
Duplicate Code Analysis Results:
├── 12 duplicate groups found
├── 45 functions affected
├── Potential savings: 234 lines
└── Estimated effort: 2.5 hours

Recommendations:
1. Consolidate utility functions (8 duplicates)
2. Extract common validation logic (4 duplicates)
```

### Detailed Format

```bash
funcqc improve --type duplicates --format detailed
```
Includes specific code locations, similarity scores, and consolidation suggestions.

### JSON Format

```bash
funcqc improve --type duplicates --json
```
```json
{
  "analysis": "duplicates",
  "groups": [
    {
      "id": "group-001",
      "similarity": 0.96,
      "functions": [...],
      "recommendation": "extract-utility",
      "effort": "low"
    }
  ],
  "summary": {
    "totalGroups": 12,
    "functionsAffected": 45,
    "potentialSavings": 234
  }
}
```

## Interactive Mode

### Step-by-step Improvement

```bash
# Interactive duplicate resolution
funcqc improve --type duplicates --interactive
```

Interactive mode provides:
- Visual code comparison
- Consolidation strategy options
- Impact assessment for each change
- Selective application of improvements

### Guided Workflow

```
1. Review duplicate group
2. Choose consolidation strategy:
   a) Extract to utility function
   b) Use existing implementation
   c) Skip this group
3. Preview changes
4. Apply or reject
5. Continue to next group
```

## Integration Examples

### Pre-commit Hooks

```bash
#!/bin/bash
# Pre-commit duplicate detection
DUPLICATES=$(funcqc improve --type duplicates --quiet --json | jq '.summary.totalGroups')
if [ "$DUPLICATES" -gt 5 ]; then
  echo "Warning: $DUPLICATES duplicate groups found"
  funcqc improve --type duplicates --format summary
fi
```

### Code Review Integration

```bash
# Generate improvement suggestions for PR
funcqc improve --type duplicates --format report --export pr-improvements.html

# Check for new dead code
funcqc improve --type dead-code --confidence high --format summary
```

### Refactoring Workflow

```bash
# 1. Safety assessment before refactoring
funcqc improve --type refactor-safety --verbose > safety-analysis.txt

# 2. Clean up dead code first
funcqc improve --type dead-code --confidence high --auto-fix

# 3. Consolidate duplicates
funcqc improve --type duplicates --interactive

# 4. Re-assess safety
funcqc improve --type refactor-safety --format summary
```

## Advanced Usage

### Custom Improvement Pipelines

```bash
# Complete improvement pipeline
funcqc improve --type dead-code --confidence high --auto-fix && \
funcqc improve --type duplicates --min-lines 10 --interactive && \
funcqc improve --type refactor-safety --format report
```

### Scope-specific Analysis

```bash
# Focus on specific directories
funcqc improve --type duplicates --scope src/utils

# Analyze test code separately
funcqc improve --type dead-code --scope test --confidence medium
```

### Integration with CI/CD

```yaml
# GitHub Actions workflow
- name: Code Improvement Analysis
  run: |
    funcqc improve --type duplicates --json > duplicates.json
    funcqc improve --type dead-code --confidence high --json > dead-code.json
    
    # Fail if too many issues
    DUPLICATES=$(jq '.summary.totalGroups' duplicates.json)
    if [ "$DUPLICATES" -gt 10 ]; then
      echo "Too many duplicates: $DUPLICATES"
      exit 1
    fi
```

## Best Practices

### Gradual Improvement

```bash
# Start conservative
funcqc improve --type dead-code --confidence high --auto-fix

# Progress to duplicates
funcqc improve --type duplicates --min-lines 20 --confidence high

# Advanced consolidation
funcqc improve --type duplicates --min-lines 10 --interactive
```

### Safety-first Approach

```bash
# Always dry-run first
funcqc improve --type dead-code --dry-run

# Use version control
git add -A && git commit -m "Before improvement"
funcqc improve --type dead-code --auto-fix
git add -A && git commit -m "After dead code removal"

# Test after changes
npm test
```

## Troubleshooting

### Common Issues

**False positive duplicates:**
```bash
# Increase similarity threshold
funcqc improve --type duplicates --similarity-threshold 0.95

# Increase minimum lines
funcqc improve --type duplicates --min-lines 15
```

**Aggressive dead code detection:**
```bash
# Use higher confidence
funcqc improve --type dead-code --confidence high

# Review before applying
funcqc improve --type dead-code --dry-run --verbose
```

**Performance issues:**
```bash
# Limit scope
funcqc improve --type duplicates --scope src/core

# Use lighter analysis
funcqc improve --type duplicates --detectors hash-duplicate
```

## See Also

- [assess](assess.md) - Quality assessment to identify improvement opportunities
- [inspect](inspect.md) - Detailed analysis of functions needing improvement
- [refactor](refactor.md) - Advanced refactoring analysis and transformations
- [Migration Guide](../migration-guide.md) - Upgrading from `similar`, `safe-delete`, `refactor-guard` commands

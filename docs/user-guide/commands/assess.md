# funcqc assess

📊 Unified quality assessment command that consolidates health, evaluate, and type health functionality.

## Usage

```bash
funcqc assess [options]
```

## Description

The `assess` command provides comprehensive quality assessment of your codebase. It analyzes measurement data to generate health scores, quality ratings, and actionable recommendations. This command replaces the legacy `health`, `evaluate`, and type-related assessment commands.

## Options

### Basic Options
- `--type <type>` - Assessment type: `health`, `quality`, `types`, `advanced`
- `-j, --json` - Output assessment results as JSON
- `--verbose` - Include detailed analysis and recommendations
- `--quiet` - Minimal output, scores only

### Assessment Modes
- `--mode <mode>` - Assessment mode: `static`, `dynamic`, `contextual`
- `--baseline <snapshot>` - Compare against baseline snapshot
- `--trend` - Include trend analysis

### Quality Thresholds
- `--min-health <score>` - Minimum health score threshold (0-100)
- `--max-risk <score>` - Maximum acceptable risk score
- `--team-experience <level>` - Team experience: `Junior`, `Mid`, `Senior`
- `--domain-complexity <level>` - Domain complexity: `Low`, `Medium`, `High`

### Scope Options
- `--scope <scope>` - Limit assessment to specific scope (file, module, directory)

### Output Options
- `--format <format>` - Output format: `summary`, `detailed`, `report`
- `--export <path>` - Export assessment to file
- `--template <name>` - Use assessment template

## Assessment Types

### `health` - Overall Project Health (Default)
Comprehensive health assessment of the entire codebase.

```bash
# Basic health check
funcqc assess --type health

# Detailed health analysis
funcqc assess --type health --verbose

# Health with trend analysis
funcqc assess --type health --trend --baseline main
```

**Health Report Includes:**
- Overall Health Index (0-100)
- Component Scores (Code Size, Maintainability, Complexity)
- Structural Risk Assessment
- High-risk Function Analysis
- Improvement Recommendations

### `quality` - Function Quality Assessment
Detailed quality evaluation of individual functions.

```bash
# Quality assessment
funcqc assess --type quality

# Advanced quality with team context
funcqc assess --type advanced --team-experience Senior

# Quality trends over time
funcqc assess --type quality --trend
```

**Quality Assessment Includes:**
- Function quality distribution
- Naming quality analysis
- Complexity quality ratings
- Maintainability scores
- Technical debt indicators

### `types` - TypeScript Quality Assessment
Specialized assessment for TypeScript type system usage.

```bash
# TypeScript type quality
funcqc assess --type types

# Advanced type analysis
funcqc assess --type advanced --verbose
```

**Type Assessment Includes:**
- Type safety coverage
- Type complexity analysis
- Interface design quality
- Type coupling assessment
- TypeScript best practices compliance

### `advanced` - Comprehensive Multi-dimensional Assessment
Combines all assessment types with advanced algorithms.

```bash
# Complete advanced assessment
funcqc assess --type advanced

# Dynamic assessment with context
funcqc assess --type advanced --mode dynamic --team-experience Senior
```

## Assessment Modes

### `static` - Static Code Analysis (Default)
Pure code-based assessment without runtime context.

```bash
funcqc assess --mode static --type health
```

### `dynamic` - Context-aware Assessment
Assessment considering team experience and domain complexity.

```bash
# Adjust thresholds for senior team
funcqc assess --mode dynamic --team-experience Senior

# Account for complex domain
funcqc assess --mode dynamic --domain-complexity High
```

### `contextual` - Project-specific Assessment
Assessment tailored to project characteristics and history.

```bash
# Contextual assessment with baseline
funcqc assess --mode contextual --baseline main --trend
```

## Quality Scoring

### Health Index (0-100)

| Score Range | Category | Description |
|-------------|----------|-------------|
| 90-100 | Excellent | Exceptional code quality |
| 80-89 | Good | Solid quality, minor improvements |
| 70-79 | Fair | Acceptable, some issues to address |
| 60-69 | Poor | Significant quality problems |
| 0-59 | Critical | Urgent attention required |

### Component Scores

- **Code Size**: Function and file size appropriateness
- **Maintainability**: Ease of modification and understanding
- **Complexity**: Cyclomatic and cognitive complexity
- **Structure**: Architecture and dependency health

## Common Usage Patterns

### Development Workflow

```bash
# Daily health check
funcqc assess --type health --quiet

# Weekly detailed review
funcqc assess --type health --verbose --export weekly-health.json

# Pre-release assessment
funcqc assess --type advanced --mode dynamic --team-experience Senior
```

### CI/CD Integration

```bash
# CI health gate
funcqc assess --type health --min-health 70 --quiet
if [ $? -ne 0 ]; then
  echo "Health check failed"
  exit 1
fi

# Quality trending
funcqc assess --type health --trend --baseline main --json > health-trend.json
```

### Code Review

```bash
# Compare feature branch health
funcqc assess --type health --baseline main --verbose

# Quality impact analysis
funcqc assess --type quality --trend --format report
```

## Advanced Assessment Features

### Trend Analysis

```bash
# Health trends over time
funcqc assess --type health --trend --baseline main

# Quality improvement tracking
funcqc assess --type quality --trend --format detailed
```

### Team-aware Assessment

```bash
# Adjust for junior team
funcqc assess --mode dynamic --team-experience Junior --domain-complexity High

# Senior team with complex domain
funcqc assess --mode dynamic --team-experience Senior --domain-complexity High
```

### Comparative Assessment

```bash
# Compare against specific baseline
funcqc assess --type health --baseline release-1.0 --verbose

# Multi-snapshot comparison
funcqc assess --type health --baseline main --trend --format report
```

## Output Formats

### Summary Format (Default)

```bash
funcqc assess --type health
```
```text
Overall Health Index: 72/100 (Fair)
├── Code Size: 85/100 (Good)
├── Maintainability: 68/100 (Poor)
├── Complexity: 75/100 (Fair)
└── Structure: 60/100 (Poor)

High-Risk Functions: 12
Recommended Actions: 3
```

### Detailed Format

```bash
funcqc assess --type health --format detailed
```
Includes breakdown of all metrics, risk factors, and specific recommendations.

### Report Format

```bash
funcqc assess --type health --format report --export health-report.html
```
Generates comprehensive HTML report with charts and detailed analysis.

### JSON Format

```bash
funcqc assess --type health --json
```
```json
{
  "overallHealth": 72,
  "components": {
    "codeSize": 85,
    "maintainability": 68,
    "complexity": 75,
    "structure": 60
  },
  "riskFactors": [],
  "recommendations": []
}
```

## Quality Gates

### Exit Codes

```bash
# Health-based quality gate
funcqc assess --type health --min-health 70
echo $?  # 0 = passed, 1 = failed

# Risk-based quality gate
funcqc assess --type health --max-risk 50 --quiet
```

### Threshold Configuration

```bash
# Custom thresholds for different environments
funcqc assess --type health --min-health 60  # Development
funcqc assess --type health --min-health 80  # Production
```

## Integration Examples

### Package.json Scripts

```json
{
  "scripts": {
    "quality:check": "funcqc assess --type health --min-health 70",
    "quality:report": "funcqc assess --type health --verbose --format report",
    "quality:trend": "funcqc assess --type health --trend --baseline main",
    "quality:ci": "funcqc assess --type health --quiet --json"
  }
}
```

### GitHub Actions

```yaml
- name: Quality Assessment
  run: |
    funcqc assess --type health --min-health 70 --json > assessment.json
    
    # Upload assessment results
    echo "HEALTH_SCORE=$(jq -r '.overallHealth' assessment.json)" >> $GITHUB_ENV

- name: Comment PR with Health
  if: github.event_name == 'pull_request'
  run: |
    HEALTH=$(jq -r '.overallHealth' assessment.json)
    gh pr comment --body "Health Score: $HEALTH/100"
```

### Quality Monitoring

```bash
# Daily health monitoring
#!/bin/bash
DATE=$(date +%Y-%m-%d)
funcqc assess --type health --json > "health-$DATE.json"

# Trend analysis
funcqc assess --type health --trend --format report --export "trend-report-$DATE.html"
```

## Troubleshooting

### Common Issues

**Low health scores:**
```bash
# Get detailed breakdown
funcqc assess --type health --verbose

# Identify specific problems
funcqc inspect --risk-ge 50 --sort risk --desc
```

**No trend data:**
```bash
# Ensure baseline exists
funcqc measure --history

# Create baseline
funcqc measure --label baseline
```

### Performance Issues

```bash
# Use lighter assessment for large codebases
funcqc assess --type health --mode static

# Focus on specific areas
funcqc assess --type health --scope src
```

## Recommendations Interpretation

### Structural Improvements
- **High Coupling**: Functions with excessive dependencies
- **Large Files**: Files that should be split
- **Complex Functions**: Functions needing simplification

### Quality Improvements
- **Naming Quality**: Unclear or inconsistent naming
- **Parameter Count**: Functions with too many parameters
- **Cognitive Load**: Functions that are hard to understand

### Technical Debt
- **Dead Code**: Unused functions and imports
- **Duplicate Code**: Similar functions that could be consolidated
- **Type Issues**: TypeScript usage improvements

## See Also

- [measure](measure.md) - Generate data for assessment
- [inspect](inspect.md) - Detailed investigation of assessment findings
- [improve](improve.md) - Act on assessment recommendations
- [Migration Guide](../migration-guide.md) - Upgrading from `health`, `evaluate` commands
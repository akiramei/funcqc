# funcqc refactor

> 注意: 本コマンドは統合コマンド構想の一部であり、現行CLIには未実装です。リファクタリング支援は現状、依存分析（`funcqc dep cycles` / `funcqc dep stats`）やデッドコード検出（`funcqc dep dead`）等を併用してください。

🔧 Unified code transformation and refactoring analysis command for safe and intelligent code restructuring.

## Usage

```bash
funcqc refactor [options] [target]
```

## Description

The `refactor` command provides comprehensive refactoring analysis and transformation capabilities. It combines safety analysis, impact assessment, and automated code transformations to support intelligent refactoring decisions. This command consolidates various refactoring-related functionality into a unified interface.

## Options

### Basic Options
- `--action <action>` - Refactoring action: `guard`, `analyze`, `transform`, `suggest`, `validate`
- `-j, --json` - Output results as JSON
- `--verbose` - Include detailed analysis and recommendations
- `--quiet` - Minimal output
- `--dry-run` - Show what would be changed without making changes

### Analysis Options
- `--type <type>` - Refactoring type: `extract`, `inline`, `move`, `rename`, `split`
- `--target <target>` - Specific function or file to analyze
- `--scope <scope>` - Analysis scope (function, file, module, project)
- `--confidence <level>` - Confidence level: `low`, `medium`, `high`

### Safety Options
- `--impact-analysis` - Include change impact analysis
- `--dependency-check` - Check dependency safety
- `--test-coverage` - Verify test coverage
- `--breaking-changes` - Detect potential breaking changes

### Transformation Options
- `--auto-apply` - Automatically apply safe transformations
- `--interactive` - Interactive refactoring mode
- `--preserve-behavior` - Ensure behavior preservation
- `--validate-syntax` - Validate syntax after changes

## Refactoring Actions

### `guard` - Refactoring Safety Analysis
Analyze the safety and risks of potential refactoring operations.

```bash
# Safety analysis for function
funcqc refactor --action guard --target parseConfig

# Comprehensive safety assessment
funcqc refactor --action guard --impact-analysis --test-coverage

# Project-wide safety analysis
funcqc refactor --action guard --scope project --verbose
```

**Safety Analysis Includes:**
- Change impact assessment
- Dependency risk evaluation
- Test coverage analysis
- Breaking change detection
- Complexity implications

### `analyze` - Refactoring Opportunity Analysis
Identify refactoring opportunities and provide recommendations.

```bash
# Find refactoring opportunities
funcqc refactor --action analyze

# Focus on specific refactoring types
funcqc refactor --action analyze --type extract --type split

# High-confidence opportunities only
funcqc refactor --action analyze --confidence high
```

**Analysis Types:**
- Function extraction opportunities
- Code duplication consolidation
- Complex function splitting
- Dead code removal
- Architectural improvements

### `suggest` - Intelligent Refactoring Suggestions
Generate specific refactoring suggestions with implementation guidance.

```bash
# Get refactoring suggestions
funcqc refactor --action suggest --target complexFunction

# Suggestions with implementation details
funcqc refactor --action suggest --verbose --interactive

# Prioritized suggestions
funcqc refactor --action suggest --confidence high --impact-analysis
```

### `transform` - Automated Code Transformations
Apply automated refactoring transformations.

```bash
# Safe automated transformations
funcqc refactor --action transform --confidence high --auto-apply

# Interactive transformation mode
funcqc refactor --action transform --interactive

# Dry-run to preview changes
funcqc refactor --action transform --dry-run --verbose
```

### `validate` - Refactoring Validation
Validate completed refactoring operations.

```bash
# Validate recent changes
funcqc refactor --action validate

# Comprehensive validation
funcqc refactor --action validate --test-coverage --dependency-check

# Behavior preservation check
funcqc refactor --action validate --preserve-behavior
```

## Refactoring Types

### `extract` - Function Extraction
Identify and extract reusable function components.

```bash
# Find extraction opportunities
funcqc refactor --action analyze --type extract

# Extract specific code blocks
funcqc refactor --action transform --type extract --target complexFunction --interactive
```

**Extraction Candidates:**
- Repeated code patterns
- Complex nested logic
- Independent code blocks
- Utility operations

### `inline` - Function Inlining
Identify functions suitable for inlining.

```bash
# Find inlining opportunities
funcqc refactor --action analyze --type inline --confidence high

# Safe inlining
funcqc refactor --action transform --type inline --auto-apply
```

**Inlining Candidates:**
- Simple wrapper functions
- Single-use functions
- Trivial operations
- Performance bottlenecks

### `move` - Code Movement
Analyze and suggest code movement for better organization.

```bash
# Find movement opportunities
funcqc refactor --action analyze --type move

# Suggest better file organization
funcqc refactor --action suggest --type move --scope file
```

### `rename` - Intelligent Renaming
Suggest better names and safe renaming operations.

```bash
# Naming improvement suggestions
funcqc refactor --action suggest --type rename

# Safe renaming with impact analysis
funcqc refactor --action transform --type rename --impact-analysis
```

### `split` - Function Splitting
Identify overly complex functions for splitting.

```bash
# Find splitting opportunities
funcqc refactor --action analyze --type split

# Interactive function splitting
funcqc refactor --action transform --type split --interactive
```

## Safety Analysis

### Impact Assessment

```bash
# Comprehensive impact analysis
funcqc refactor --action guard --target criticalFunction --impact-analysis --verbose
```

**Impact Factors:**
- **Direct dependents**: Functions that directly call the target
- **Indirect dependents**: Functions affected through dependency chain
- **External interfaces**: Public APIs and exports
- **Test coverage**: Existing test protection
- **Runtime behavior**: Potential runtime changes

### Risk Evaluation

```bash
# Risk-focused safety analysis
funcqc refactor --action guard --breaking-changes --dependency-check
```

**Risk Categories:**
- **High Risk**: Public API changes, complex dependencies
- **Medium Risk**: Internal changes with broad impact
- **Low Risk**: Isolated changes with good test coverage

### Change Validation

```bash
# Validate refactoring safety
funcqc refactor --action validate --preserve-behavior --test-coverage
```

## Interactive Refactoring

### Guided Workflow

```bash
# Start interactive refactoring session
funcqc refactor --action transform --interactive
```

**Interactive Steps:**
1. **Analysis**: Review refactoring opportunities
2. **Selection**: Choose specific refactoring operations
3. **Preview**: See proposed changes
4. **Validation**: Check safety and impact
5. **Application**: Apply selected changes
6. **Verification**: Validate results

### Step-by-step Transformation

```bash
# Interactive function extraction
funcqc refactor --action transform --type extract --target largeFunction --interactive
```

**Extraction Workflow:**
1. Identify extraction candidates
2. Preview extracted function
3. Choose function name and parameters
4. Review impact on original function
5. Apply extraction
6. Validate syntax and behavior

## Advanced Refactoring

### Architectural Refactoring

```bash
# Analyze architectural improvements
funcqc refactor --action analyze --scope project --type move

# Suggest module reorganization
funcqc refactor --action suggest --type move --scope module --verbose
```

### Performance-driven Refactoring

```bash
# Find performance improvement opportunities
funcqc refactor --action analyze --type inline --type extract --confidence medium

# Focus on hot paths
funcqc refactor --action suggest --target performanceCriticalFunction --verbose
```

### Quality-driven Refactoring

```bash
# Focus on quality improvements
funcqc refactor --action analyze --confidence high

# Target high-complexity functions
funcqc refactor --action suggest --type split --confidence high
```

## Integration Examples

### Pre-refactoring Analysis

```bash
#!/bin/bash
# Before starting refactoring
echo "Analyzing refactoring safety..."
funcqc refactor --action guard --target $TARGET_FUNCTION --impact-analysis

echo "Finding refactoring opportunities..."
funcqc refactor --action analyze --type extract --type split --confidence high

echo "Generating suggestions..."
funcqc refactor --action suggest --target $TARGET_FUNCTION --verbose
```

### Code Review Integration

```bash
# Generate refactoring report for PR
funcqc refactor --action analyze --json > refactoring-opportunities.json
funcqc refactor --action guard --impact-analysis --verbose > safety-analysis.txt

# Check if changes introduced refactoring opportunities
funcqc refactor --action validate --preserve-behavior
```

### CI/CD Integration

```yaml
- name: Refactoring Analysis
  run: |
    # Check for new refactoring opportunities
    funcqc refactor --action analyze --confidence high --json > opportunities.json
    
    # Validate recent changes
    funcqc refactor --action validate --breaking-changes
    
    # Generate suggestions for complex functions
    COMPLEX_FUNCTIONS=$(funcqc inspect --cc-ge 15 --json | jq -r '.[].name')
    for func in $COMPLEX_FUNCTIONS; do
      funcqc refactor --action suggest --target "$func" --quiet
    done
```

### Automated Refactoring Pipeline

```bash
# Safe automated refactoring
funcqc refactor --action transform --confidence high --auto-apply --type inline

# Validate changes
npm test
if [ $? -eq 0 ]; then
  echo "Automated refactoring successful"
  git add -A && git commit -m "Automated safe refactoring"
else
  echo "Tests failed, reverting changes"
  git checkout .
fi
```

## Output Formats

### Safety Report

```bash
funcqc refactor --action guard --target parseConfig --verbose
```
```
Refactoring Safety Analysis: parseConfig
├── Risk Level: Medium
├── Impact Score: 65/100
├── Direct Dependents: 8 functions
├── Indirect Dependents: 23 functions
├── Test Coverage: 85%
├── Breaking Changes: None detected
└── Recommendations:
    ├── Add unit tests for edge cases
    ├── Consider deprecation for public changes
    └── Monitor performance impact
```

### Opportunity Analysis

```bash
funcqc refactor --action analyze --json
```
```json
{
  "opportunities": [
    {
      "type": "extract",
      "target": "processData",
      "confidence": "high",
      "effort": "low",
      "benefit": "medium",
      "description": "Extract validation logic to reusable function",
      "codeBlock": {
        "start": 45,
        "end": 62,
        "extractable": true
      }
    }
  ],
  "summary": {
    "totalOpportunities": 12,
    "highConfidence": 4,
    "estimatedEffort": "2-3 hours"
  }
}
```

### Transformation Preview

```bash
funcqc refactor --action transform --type extract --dry-run --verbose
```
Shows before/after code comparison with detailed change explanation.

## Best Practices

### Safe Refactoring Workflow

```bash
# 1. Analyze opportunities
funcqc refactor --action analyze --confidence high

# 2. Safety analysis
funcqc refactor --action guard --impact-analysis --test-coverage

# 3. Create feature branch
git checkout -b refactor/improve-parser

# 4. Apply transformations incrementally
funcqc refactor --action transform --interactive

# 5. Validate each step
npm test && npm run lint

# 6. Final validation
funcqc refactor --action validate --preserve-behavior
```

### Quality-first Approach

```bash
# Focus on quality improvements
funcqc assess --type health --verbose  # Identify quality issues
funcqc refactor --action analyze --confidence high  # Find solutions
funcqc refactor --action transform --interactive  # Apply changes
funcqc assess --type health --verbose  # Verify improvements
```

## Troubleshooting

### Common Issues

**High-risk refactoring detected:**
```bash
# Get detailed risk analysis
funcqc refactor --action guard --target riskytarget --verbose

# Start with safer alternatives
funcqc refactor --action suggest --confidence high
```

**Complex refactoring scenarios:**
```bash
# Break down into smaller steps
funcqc refactor --action analyze --scope function --type extract

# Use interactive mode for guidance
funcqc refactor --action transform --interactive
```

**Validation failures:**
```bash
# Check specific validation aspects
funcqc refactor --action validate --breaking-changes --verbose

# Ensure test coverage before refactoring
funcqc assess --type health --verbose
```

## See Also

- [improve](improve.md) - Code improvement opportunities that may benefit from refactoring
- [dependencies](dependencies.md) - Dependency analysis for refactoring safety
- [assess](assess.md) - Quality assessment to guide refactoring priorities
- [inspect](inspect.md) - Detailed function analysis for refactoring planning

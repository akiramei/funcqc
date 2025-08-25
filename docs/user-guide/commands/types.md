# funcqc types

🧩 Unified TypeScript type analysis and design intelligence for comprehensive type system quality assessment.

## Usage

```bash
funcqc types [options]
```

## Description

The `types` command provides comprehensive TypeScript type system analysis, including type quality assessment, design intelligence, and advanced type transformations. It consolidates various type-related analysis capabilities into a unified interface for TypeScript-specific quality management.

## Options

### Basic Options
- `--action <action>` - Type analysis action: `health`, `list`, `analyze`, `transform`, `validate`
- `-j, --json` - Output results as JSON
- `--verbose` - Include detailed type information
- `--quiet` - Minimal output

### Filtering Options
- `--kind <kind>` - Type kind: `interface`, `type`, `class`, `enum`, `function`
- `--scope <scope>` - Analysis scope (file, module, project)
- `--complexity <level>` - Complexity filter: `low`, `medium`, `high`
- `--usage <usage>` - Usage filter: `exported`, `internal`, `unused`

### Analysis Options
- `--include-generics` - Include generic type analysis
- `--include-utilities` - Include utility type usage
- `--include-mapped` - Include mapped type analysis
- `--design-patterns` - Analyze type design patterns
- `--confidence <level>` - Analysis/transform confidence: `low`, `medium`, `high`

### Quality Options
- `--safety-check` - Type safety analysis
- `--consistency-check` - Type naming and design consistency
- `--performance-check` - Type compilation performance impact
- `--best-practices` - TypeScript best practices compliance

### Transformation Options
- `--type <type>` - Transformation type: `consolidate`, `simplify`, `modernize`, `optimize`
- `--interactive` - Interactive transformation mode
- `--dry-run` - Show what would be changed without making changes

## Type Analysis Actions

### `health` - TypeScript Type System Health
Comprehensive health assessment of your TypeScript type usage.

```bash
# Basic type health check
funcqc types --action health

# Detailed health analysis
funcqc types --action health --verbose --safety-check

# Type health with performance analysis
funcqc types --action health --performance-check --best-practices
```

**Health Assessment Includes:**
- Type safety coverage
- Type complexity distribution
- Consistency and naming quality
- Performance implications
- Best practices compliance

### `list` - Type Inventory
List and categorize types in your codebase.

```bash
# List all types
funcqc types --action list

# List specific type kinds
funcqc types --action list --kind interface --kind type

# List complex types
funcqc types --action list --complexity high

# List unused types
funcqc types --action list --usage unused
```

### `analyze` - Deep Type Analysis
Detailed analysis of type design and usage patterns.

```bash
# Comprehensive type analysis
funcqc types --action analyze --include-generics --design-patterns

# Focus on specific types
funcqc types --action analyze --kind interface --consistency-check

# Performance-focused analysis
funcqc types --action analyze --performance-check --verbose
```

### `transform` - Type Transformations
Automated type improvements and transformations.

```bash
# Safe type transformations
funcqc types --action transform --confidence high

# Interactive type optimization
funcqc types --action transform --interactive

# Specific transformation types
funcqc types --action transform --type consolidate --type simplify
```

### `validate` - Type Validation
Validate type design and implementation quality.

```bash
# Validate type safety
funcqc types --action validate --safety-check

# Validate design consistency
funcqc types --action validate --consistency-check --best-practices

# Comprehensive type validation
funcqc types --action validate --verbose --include-generics
```

## Type Categories

### `interface` - Interface Analysis
Analyze TypeScript interfaces for design quality.

```bash
# Interface health analysis
funcqc types --action health --kind interface

# Interface design patterns
funcqc types --action analyze --kind interface --design-patterns

# Interface consolidation opportunities
funcqc types --action transform --kind interface --type consolidate
```

**Interface Analysis:**
- Property design consistency
- Extension patterns
- Generic usage
- Naming conventions
- Cohesion and coupling

### `type` - Type Alias Analysis
Analyze type aliases and their usage patterns.

```bash
# Type alias complexity
funcqc types --action list --kind type --complexity high

# Union/intersection type analysis
funcqc types --action analyze --kind type --include-utilities

# Type alias simplification
funcqc types --action transform --kind type --type simplify
```

### `class` - Class Type Analysis
Analyze TypeScript class designs and patterns.

```bash
# Class design analysis
funcqc types --action analyze --kind class --design-patterns

# Class type safety
funcqc types --action validate --kind class --safety-check
```

### `enum` - Enum Analysis
Analyze enum usage and design patterns.

```bash
# Enum health check
funcqc types --action health --kind enum

# Enum to union type opportunities
funcqc types --action transform --kind enum --type modernize
```

### `function` - Function Type Analysis
Analyze function signatures and type definitions.

```bash
# Function type complexity
funcqc types --action list --kind function --complexity high

# Function signature optimization
funcqc types --action transform --kind function --type optimize
```

## Type Quality Metrics

### Type Safety Assessment

```bash
# Comprehensive type safety analysis
funcqc types --action health --safety-check --verbose
```

**Safety Metrics:**
- `any` usage frequency
- Type assertion patterns
- Strict mode compliance
- Null safety coverage
- Generic constraint adequacy

### Type Complexity Analysis

```bash
# Type complexity distribution
funcqc types --action analyze --complexity high --verbose
```

**Complexity Factors:**
- Generic parameter count
- Union/intersection size
- Nesting depth
- Conditional type usage
- Mapped type complexity

### Design Quality Assessment

```bash
# Type design quality analysis
funcqc types --action analyze --design-patterns --consistency-check
```

**Design Quality:**
- Naming consistency
- Structural cohesion
- Interface segregation
- Generic reusability
- Pattern adherence

## Advanced Type Analysis

### Generic Type Analysis

```bash
# Generic type usage patterns
funcqc types --action analyze --include-generics --verbose

# Generic type optimization
funcqc types --action transform --include-generics --type optimize
```

**Generic Analysis:**
- Constraint effectiveness
- Variance analysis
- Reusability patterns
- Performance implications

### Utility Type Usage

```bash
# Utility type analysis
funcqc types --action analyze --include-utilities

# Utility type optimization opportunities
funcqc types --action transform --include-utilities --type modernize
```

**Utility Type Patterns:**
- Pick/Omit usage
- Partial/Required patterns
- Record type usage
- Template literal types

### Mapped Type Analysis

```bash
# Mapped type complexity
funcqc types --action analyze --include-mapped --complexity high

# Mapped type simplification
funcqc types --action transform --include-mapped --type simplify
```

## Type Transformations

### Consolidation
Identify and consolidate duplicate or similar types.

```bash
# Find consolidation opportunities
funcqc types --action transform --type consolidate --dry-run

# Apply safe consolidation
funcqc types --action transform --type consolidate --confidence high
```

### Simplification
Simplify overly complex type definitions.

```bash
# Find simplification opportunities
funcqc types --action analyze --complexity high

# Apply type simplification
funcqc types --action transform --type simplify --interactive
```

### Modernization
Update type definitions to use modern TypeScript features.

```bash
# Modernize enum to union types
funcqc types --action transform --kind enum --type modernize

# Update to utility types
funcqc types --action transform --type modernize --include-utilities
```

## Output Formats

### Health Report

```bash
funcqc types --action health --verbose
```
```
TypeScript Type System Health: 78/100 (Good)
├── Type Safety: 85/100 (Good)
│   ├── any usage: 2% (Good)
│   ├── Type assertions: 5% (Good)
│   └── Strict compliance: 95% (Excellent)
├── Design Quality: 72/100 (Fair)
│   ├── Naming consistency: 80% (Good)
│   ├── Interface cohesion: 70% (Fair)
│   └── Generic reusability: 65% (Fair)
├── Complexity: 75/100 (Fair)
│   ├── Average complexity: Medium
│   ├── High complexity types: 8
│   └── Deep nesting: 3 types
└── Performance: 82/100 (Good)
    ├── Compilation impact: Low
    └── Bundle size impact: Medium
```

### Type Inventory

```bash
funcqc types --action list --json
```
```json
{
  "types": [
    {
      "name": "UserConfig",
      "kind": "interface",
      "complexity": "medium",
      "usage": "exported",
      "file": "src/types/config.ts",
      "properties": 12,
      "generics": 1,
      "extends": ["BaseConfig"]
    }
  ],
  "summary": {
    "totalTypes": 156,
    "interfaces": 67,
    "typeAliases": 45,
    "classes": 28,
    "enums": 16,
    "highComplexity": 8,
    "unused": 12
  }
}
```

### Analysis Report

```bash
funcqc types --action analyze --design-patterns --verbose
```
Detailed analysis including design pattern usage, anti-patterns, and improvement recommendations.

## Best Practices Integration

### TypeScript Best Practices Check

```bash
# Comprehensive best practices analysis
funcqc types --action validate --best-practices --verbose
```

**Best Practices Checked:**
- Prefer interfaces over types for object shapes
- Use readonly for immutable data
- Avoid function overloads when possible
- Use union types over enums
- Proper generic constraints
- Consistent naming conventions

### Code Quality Integration

```bash
# Type quality as part of overall quality
funcqc health --verbose  # Overall health
funcqc types health --verbose  # Type-specific health

# Improvement opportunities
funcqc similar  # Duplicate/near-duplicate functions
```

## Integration Examples

### Development Workflow

```bash
# Daily type health check
funcqc types --action health --quiet

# Pre-commit type validation
funcqc types --action validate --safety-check --best-practices

# Weekly type analysis
funcqc types --action analyze --design-patterns --verbose > type-analysis.txt
```

### CI/CD Integration

```yaml
- name: TypeScript Type Quality
  run: |
    # Type health check with thresholds
    TYPE_HEALTH=$(funcqc types --action health --json | jq '.overallHealth')
    if [ "$TYPE_HEALTH" -lt 70 ]; then
      echo "Type health below threshold: $TYPE_HEALTH"
      funcqc types --action health --verbose
      exit 1
    fi
    
    # Check for type safety issues
    funcqc types --action validate --safety-check --json > type-safety.json
    ANY_USAGE=$(jq '.metrics.anyUsage' type-safety.json)
    if [ "$ANY_USAGE" -gt 5 ]; then
      echo "Excessive 'any' usage: $ANY_USAGE%"
      exit 1
    fi
```

### Refactoring Integration

```bash
# Before major refactoring
funcqc types --action health --verbose > before-refactor-types.txt

# Type-safe refactoring validation
funcqc types --action validate --safety-check

# After refactoring comparison
funcqc types --action health --verbose > after-refactor-types.txt
diff before-refactor-types.txt after-refactor-types.txt
```

## Performance Considerations

### Large Codebases

```bash
# Focus analysis on specific areas
funcqc types --action health --scope module src/core

# Limit complexity analysis
funcqc types --action list --complexity high --limit 20

# Use incremental analysis
funcqc types --action analyze --scope file src/types/api.ts
```

### Type Compilation Performance

```bash
# Identify performance-heavy types
funcqc types --action analyze --performance-check --complexity high

# Optimize compilation performance
funcqc types --action transform --type optimize --performance-check
```

## Troubleshooting

### Common Issues

**High type complexity:**
```bash
# Identify complex types
funcqc types --action list --complexity high --verbose

# Get simplification suggestions
funcqc types --action transform --type simplify --dry-run
```

**Type safety issues:**
```bash
# Detailed safety analysis
funcqc types --action validate --safety-check --verbose

# Focus on 'any' usage
funcqc types --action analyze --safety-check | grep -i "any"
```

**Performance issues:**
```bash
# Type compilation performance analysis
funcqc types --action analyze --performance-check --verbose

# Optimize heavy types
funcqc types --action transform --type optimize --confidence high
```

## Migration and Modernization

### TypeScript Version Upgrades

```bash
# Check compatibility with newer TypeScript features
funcqc types --action analyze --include-utilities --design-patterns

# Modernize type definitions
funcqc types --action transform --type modernize --dry-run
```

### Legacy Code Type Improvements

```bash
# Identify legacy type patterns
funcqc types --action analyze --best-practices --verbose

# Gradual type safety improvements
funcqc types --action transform --safety-check --confidence high
```

## See Also

- [assess](assess.md) - Overall quality assessment including type quality
- [refactor](refactor.md) - Type-aware refactoring operations
- [inspect](inspect.md) - Function-level analysis including type information
- [improve](improve.md) - Code improvement including type-related enhancements

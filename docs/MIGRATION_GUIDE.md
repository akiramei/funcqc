# funcqc v2.0 Migration Guide

## 🚀 Overview

funcqc v2.0 introduces a revolutionary command consolidation that reduces 45 commands to 9 unified commands, making it 80% easier to learn and use while maintaining all functionality.

## 📊 What's Changed

### Before: 45 Fragmented Commands
- Complex learning curve (weeks to months)
- Inconsistent interfaces
- Duplicate functionality across commands
- Unclear workflow patterns

### After: 9 Unified Commands
- Streamlined learning (hours to days)
- Consistent, action-based interfaces
- Clear quality management workflow
- Enhanced functionality with new features

## 🎯 New Command Structure

### Tier 1: Core Quality Management Workflow
```bash
funcqc inspect   # 🔍 Function and file inspection (list, search, files, show)
funcqc measure   # 📊 Project measurement (scan, analyze, health metrics)
funcqc assess    # 📊 Quality assessment (health, evaluate, types health)
funcqc improve   # 🔧 Code improvement (similar, refactor-guard, safe-delete)
```

### Tier 2: Specialized Analysis
```bash
funcqc dependencies  # 🔗 Dependency analysis (all dep* commands)
funcqc types         # 🧩 TypeScript analysis (all types commands)
funcqc refactor      # 🔧 Code transformation (all refactoring commands)
```

### Tier 3: Management & Support
```bash
funcqc setup    # 🛠️ Configuration (init, config)
funcqc manage   # 📊 Data management (db, diff, export, history)
```

## 📋 Complete Migration Table

| Old Command | New Command | Migration Example | Notes |
|-------------|-------------|-------------------|-------|
| **Basic Functions** | | |
| `funcqc list` | `funcqc inspect` | `funcqc list --cc-ge 10` → `funcqc inspect --cc-ge 10` | Default action |
| `funcqc list --cc-ge N` | `funcqc inspect --cc-ge N` | `funcqc list --cc-ge 15` → `funcqc inspect --cc-ge 15` | Complexity filter |
| `funcqc search "keyword"` | `funcqc inspect --name "*keyword*"` | `funcqc search "auth"` → `funcqc inspect --name "*auth*"` | Pattern matching |
| `funcqc files` | `funcqc inspect --type files` | `funcqc files --stats` → `funcqc inspect --type files --stats` | File analysis |
| `funcqc show <name>` | `funcqc inspect --name <name> --detailed` | `funcqc show myFunc` → `funcqc inspect --name myFunc --detailed` | Detailed view |
| **Measurement & Analysis** | | |
| `funcqc scan` | `funcqc measure` | `funcqc scan --label test` → `funcqc measure --label test` | Default level |
| `funcqc scan --with-types` | `funcqc measure --types` | `funcqc scan --with-types` → `funcqc measure --types` | Include types |
| `funcqc analyze` | `funcqc measure --level deep` | `funcqc analyze` → `funcqc measure --level deep` | Deep analysis |
| **Quality Assessment** | | |
| `funcqc health` | `funcqc assess --type health` | `funcqc health --verbose` → `funcqc assess --type health --verbose` | Health metrics |
| `funcqc health --risks` | `funcqc assess --type health --risks` | `funcqc health --risks` → `funcqc assess --type health --risks` | Risk analysis |
| `funcqc evaluate` | `funcqc assess --type quality` | `funcqc evaluate` → `funcqc assess --type quality` | Quality eval |
| **Code Improvement** | | |
| `funcqc similar` | `funcqc improve --type duplicates` | `funcqc similar` → `funcqc improve --type duplicates` | Find duplicates |
| `funcqc refactor-guard` | `funcqc improve --type safety` | `funcqc refactor-guard MyType` → `funcqc improve --type safety` | Safety analysis |
| `funcqc safe-delete` | `funcqc improve --type dead-code` | `funcqc safe-delete` → `funcqc improve --type dead-code` | Dead code |
| **Dependencies** | | |
| `funcqc dep list` | `funcqc dependencies --action list` | `funcqc dep list --caller MyClass` → `funcqc dependencies --action list --caller MyClass` | List deps |
| `funcqc dep show` | `funcqc dependencies --action show` | `funcqc dep show MyFunc` → `funcqc dependencies --action show MyFunc` | Show details |
| `funcqc dep stats` | `funcqc dependencies --action stats` | `funcqc dep stats --show-hubs` → `funcqc dependencies --action stats --show-hubs` | Statistics |
| `funcqc dep lint` | `funcqc dependencies --action lint` | `funcqc dep lint` → `funcqc dependencies --action lint` | Architecture lint |
| `funcqc dep dead` | `funcqc dependencies --action dead` | `funcqc dep dead` → `funcqc dependencies --action dead` | Dead code |
| `funcqc dep cycles` | `funcqc dependencies --action cycles` | `funcqc dep cycles` → `funcqc dependencies --action cycles` | Circular deps |
| **TypeScript Analysis** | | |
| `funcqc types list` | `funcqc types --action list` | `funcqc types list --kind interface` → `funcqc types --action list --kind interface` | List types |
| `funcqc types health` | `funcqc types --action health` | `funcqc types health` → `funcqc types --action health` | Type health |
| `funcqc types deps` | `funcqc types --action deps` | `funcqc types deps MyType` → `funcqc types --action deps MyType` | Type deps |
| `funcqc types api` | `funcqc types --action api` | `funcqc types api MyInterface` → `funcqc types --action api MyInterface` | API analysis |
| **Refactoring** | | |
| `funcqc refactor-guard` | `funcqc refactor --action guard` | `funcqc refactor-guard --type MyType` → `funcqc refactor --action guard --type MyType` | Safety guard |
| `funcqc extract-vo` | `funcqc refactor --action extract-vo` | `funcqc extract-vo` → `funcqc refactor --action extract-vo` | Extract VOs |
| `funcqc discriminate` | `funcqc refactor --action discriminate` | `funcqc discriminate` → `funcqc refactor --action discriminate` | Discriminated unions |
| `funcqc canonicalize` | `funcqc refactor --action canonicalize` | `funcqc canonicalize` → `funcqc refactor --action canonicalize` | Canonicalize DTOs |
| `funcqc type-replace` | `funcqc refactor --action type-replace` | `funcqc type-replace --from A --to B` → `funcqc refactor --action type-replace --from A --to B` | Replace types |
| **Management** | | |
| `funcqc init` | `funcqc setup --action init` | `funcqc init` → `funcqc setup --action init` | Initialize |
| `funcqc config` | `funcqc setup --action config` | `funcqc config --show` → `funcqc setup --action config --show` | Configuration |
| `funcqc db` | `funcqc manage --action db` | `funcqc db --table snapshots` → `funcqc manage --action db --table snapshots` | Database ops |
| `funcqc history` | `funcqc manage --action history` | `funcqc history` → `funcqc manage --action history` | History |
| `funcqc diff` | `funcqc manage --action diff` | `funcqc diff A B` → `funcqc manage --action diff --from A --to B` | Compare |

## 🔄 Common Migration Patterns

### Pattern 1: Simple Command Replacement
```bash
# Before
funcqc list --cc-ge 10

# After
funcqc inspect --cc-ge 10
```

### Pattern 2: Action-Based Commands
```bash
# Before
funcqc dep stats --show-hubs

# After
funcqc dependencies --action stats --show-hubs
```

### Pattern 3: Type Specification
```bash
# Before
funcqc files --stats

# After
funcqc inspect --type files --stats
```

### Pattern 4: Enhanced Workflows
```bash
# Before (Multiple commands)
funcqc scan
funcqc health --verbose
funcqc similar

# After (Unified workflow)
funcqc measure --level standard
funcqc assess --type health --verbose
funcqc improve --type duplicates
```

## 🎯 New Workflow Examples

### Basic Quality Check
```bash
# Quick project overview
funcqc measure --level quick
funcqc assess --type health
funcqc inspect --cc-ge 10 --limit 10
```

### Comprehensive Analysis
```bash
# Full analysis workflow
funcqc measure --level complete
funcqc assess --advanced --mode dynamic
funcqc improve --type duplicates
funcqc dependencies --action cycles
```

### Advanced Quality Assessment
```bash
# Dynamic quality evaluation
funcqc assess --advanced \
  --mode dynamic \
  --team-experience Senior \
  --domain-complexity High \
  --architecture-pattern Microservices \
  --export-report quality-report.json
```

## 🚨 Breaking Changes

### Removed Commands
These commands have been removed entirely:
- `funcqc describe` → Use `funcqc inspect --detailed`
- Commands with very low usage

### Changed Option Names
- `--with-types` → `--types`
- `--show-all` → `--verbose`
- Some filter options have been standardized

### New Required Actions
- `funcqc dependencies` requires `--action` parameter
- `funcqc types` requires `--action` parameter
- `funcqc refactor` requires `--action` parameter

## 🔄 Migration Scripts

### Automated Migration Helper
```bash
# Check which old commands you use
grep -r "funcqc " . --include="*.sh" --include="*.json" --include="*.yml"

# Common replacements (add to your .bashrc or scripts)
alias funcqc-list='funcqc inspect'
alias funcqc-search='funcqc inspect --name'
alias funcqc-files='funcqc inspect --type files'
alias funcqc-health='funcqc assess --type health'
```

### Gradual Migration Strategy

#### Week 1: Basic Commands
- Replace `list`, `search`, `files`, `show` with `inspect`
- Update scripts and CI/CD pipelines

#### Week 2: Analysis Commands  
- Replace `scan`, `analyze` with `measure`
- Replace `health`, `evaluate` with `assess`

#### Week 3: Advanced Commands
- Migrate `dep*` commands to `dependencies`
- Migrate `types*` commands to `types`
- Update refactoring workflows

## 💡 Tips for Smooth Migration

### 1. Start with Most-Used Commands
Focus on the commands you use most frequently:
```bash
# Find your most-used commands
history | grep funcqc | sort | uniq -c | sort -nr
```

### 2. Use Help Commands
Every unified command has comprehensive help:
```bash
funcqc inspect --help
funcqc assess --help
funcqc dependencies --help
```

### 3. Leverage New Features
Take advantage of enhanced functionality:
```bash
# New: Format options
funcqc inspect --format table

# New: Advanced assessment
funcqc assess --advanced --mode dynamic

# New: Comprehensive exports
funcqc assess --advanced --export-report report.json
```

### 4. Update CI/CD Pipelines
```yaml
# Before
script:
  - funcqc scan
  - funcqc health --verbose
  - funcqc similar

# After
script:
  - funcqc measure --level standard
  - funcqc assess --type health --verbose
  - funcqc improve --type duplicates
```

## 🆘 Getting Help

### Command-Specific Help
```bash
funcqc <command> --help  # Detailed help for any command
funcqc --help            # Overall help
```

### Migration Questions
- Check deprecation warnings for guidance
- Use `--verbose` for detailed output
- Report issues at: https://github.com/anthropics/funcqc/issues

### Common Issues

#### "Command not found" errors
```bash
# If you see this error with old commands:
funcqc list
# Error: command 'list' not found

# Solution: Use the new unified command
funcqc inspect
```

#### Missing options
```bash
# If an option doesn't exist in the new command:
funcqc inspect --old-option
# Error: unknown option '--old-option'

# Solution: Check help for equivalent option
funcqc inspect --help
```

## 🎉 Benefits After Migration

### For Users
- **80% reduction** in commands to learn
- **Consistent** command interfaces
- **Enhanced** functionality
- **Improved** performance
- **Better** error messages

### For Teams
- **Faster** onboarding for new team members
- **Standardized** quality workflows
- **Reduced** maintenance overhead
- **Improved** CI/CD integration

### For Projects
- **Comprehensive** quality analysis
- **Advanced** assessment capabilities
- **Better** architectural insights
- **Automated** improvement suggestions

## 🚀 What's Next

After completing migration:
1. Explore new advanced features
2. Set up automated quality workflows
3. Integrate with CI/CD pipelines
4. Share best practices with your team

---

**Welcome to funcqc v2.0 - A simpler, more powerful code quality platform!**
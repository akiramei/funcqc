# Migration Guide: funcqc v1.x → v2.0

This guide helps you migrate from the legacy 45+ command structure to the new unified 9-command system in funcqc v2.0.

## 🎯 Migration Overview

funcqc v2.0 consolidates functionality into 9 intuitive commands while maintaining backward compatibility during the transition period.

## 📋 Command Mapping Table

### Core Commands

| Legacy Command | New Command | Example Migration |
|----------------|-------------|-------------------|
| `funcqc scan` | `funcqc measure` | `scan --label main` → `measure --label main` |
| `funcqc list` | `funcqc inspect` | `list --cc-ge 10` → `inspect --cc-ge 10` |
| `funcqc show` | `funcqc inspect --detailed` | `show --id abc123` → `inspect --id abc123 --detailed` |
| `funcqc health` | `funcqc assess --type health` | `health --verbose` → `assess --type health --verbose` |
| `funcqc similar` | `funcqc improve --type duplicates` | `similar` → `improve --type duplicates` |

### File and Search Commands

| Legacy Command | New Command | Example Migration |
|----------------|-------------|-------------------|
| `funcqc files` | `funcqc inspect --type files` | `files --limit 10` → `inspect --type files --limit 10` |
| `funcqc search` | `funcqc inspect --name` | `search keyword` → `inspect --name keyword` |
| `funcqc describe` | `funcqc inspect --detailed` | `describe func-id` → `inspect --id func-id --detailed` |

### Analysis Commands

| Legacy Command | New Command | Example Migration |
|----------------|-------------|-------------------|
| `funcqc evaluate` | `funcqc assess --type quality` | `evaluate` → `assess --type quality` |
| `funcqc safe-delete` | `funcqc improve --type dead-code` | `safe-delete` → `improve --type dead-code` |
| `funcqc refactor-guard` | `funcqc refactor --action guard` | `refactor-guard` → `refactor --action guard` |

### Data Management Commands

| Legacy Command | New Command | Example Migration |
|----------------|-------------|-------------------|
| `funcqc history` | `funcqc manage --action history` | `history --limit 10` → `manage --action history --limit 10` |
| `funcqc diff` | `funcqc manage --action diff` | `diff A B` → `manage --action diff --from A --to B` |
| `funcqc db` | `funcqc manage --action db` | `db --table funcs` → `manage --action db --table funcs` |

### Dependency Commands

| Legacy Command | New Command | Example Migration |
|----------------|-------------|-------------------|
| `funcqc dep list` | `funcqc dependencies --action list` | `dep list --depth 2` → `dependencies --action list --depth 2` |
| `funcqc dep show` | `funcqc dependencies --action show` | `dep show func` → `dependencies --action show func` |
| `funcqc dep stats` | `funcqc dependencies --action stats` | `dep stats` → `dependencies --action stats` |
| `funcqc dep lint` | `funcqc dependencies --action lint` | `dep lint` → `dependencies --action lint` |
| `funcqc dep dead` | `funcqc dependencies --action dead` | `dep dead` → `dependencies --action dead` |
| `funcqc dep cycles` | `funcqc dependencies --action cycles` | `dep cycles` → `dependencies --action cycles` |

### TypeScript Commands

| Legacy Command | New Command | Example Migration |
|----------------|-------------|-------------------|
| `funcqc types health` | `funcqc types --action health` | `types health` → `types --action health` |
| `funcqc types list` | `funcqc types --action list` | `types list --kind interface` → `types --action list --kind interface` |

## 🔄 Step-by-Step Migration

### 1. Update Your Scripts

**Before (v1.x):**
```bash
#!/bin/bash
funcqc scan --label main
funcqc health --verbose
funcqc list --cc-ge 15
funcqc similar
```

**After (v2.0):**
```bash
#!/bin/bash
funcqc measure --label main
funcqc assess --type health --verbose
funcqc inspect --cc-ge 15
funcqc improve --type duplicates
```

### 2. Update CI/CD Pipelines

**Before (v1.x):**
```yaml
- name: Quality Check
  run: |
    funcqc scan
    funcqc health --json > health.json
    funcqc safe-delete --dry-run
```

**After (v2.0):**
```yaml
- name: Quality Check
  run: |
    funcqc measure
    funcqc assess --type health --json > health.json
    funcqc improve --type dead-code --dry-run
```

### 3. Update Configuration Files

Most configuration remains compatible, but you may want to update command references in:
- `.funcqcrc` files
- Package.json scripts
- Documentation

## ⚡ Transition Strategy

### Phase 1: Immediate (Backward Compatible)
- Legacy commands still work with deprecation warnings
- Start using new commands for new scripts
- Update documentation references

### Phase 2: Gradual Migration
- Replace legacy commands in existing scripts
- Update CI/CD pipelines
- Train team on new command structure

### Phase 3: Full Migration
- Remove all legacy command usage
- Benefit from improved performance and consistency

## 🎯 Key Benefits After Migration

### Simplified Learning
- **Before**: 45+ commands to learn
- **After**: 9 intuitive commands

### Consistent Interface
- **Before**: Inconsistent option naming across commands
- **After**: Unified options and patterns

### Natural Workflow
- **Before**: Scattered commands for related tasks
- **After**: Logical flow: measure → assess → improve → manage

### Better Performance
- **Before**: Repeated initialization across commands
- **After**: Optimized unified processing

## 🔍 Command Equivalence Examples

### Quality Assessment Workflow

**Before (v1.x):**
```bash
funcqc scan --label current
funcqc health --verbose
funcqc list --risk-ge 10
funcqc similar --min-lines 5
funcqc safe-delete --dry-run
```

**After (v2.0):**
```bash
funcqc measure --label current
funcqc assess --type health --verbose
funcqc inspect --risk-ge 10
funcqc improve --type duplicates --min-lines 5
funcqc improve --type dead-code --dry-run
```

### Dependency Analysis Workflow

**Before (v1.x):**
```bash
funcqc dep stats --show-hubs
funcqc dep cycles
funcqc dep dead --confidence high
```

**After (v2.0):**
```bash
funcqc dependencies --action stats --show-hubs
funcqc dependencies --action cycles
funcqc dependencies --action dead --confidence high
```

## 🚨 Breaking Changes

### Removed Commands
These legacy commands have been completely removed:
- Various lineage-related commands (no longer supported)
- Some experimental commands that were never stable

### Changed Defaults
- Some default values have been optimized for better performance
- Output formats are more consistent across commands

### Option Renaming
- Some option names have been standardized for consistency
- Check command help (`--help`) for current option names

## 💡 Tips for Smooth Migration

1. **Use `--help`**: All new commands have comprehensive help
2. **Test in Development**: Validate new commands before production use
3. **Update Documentation**: Keep your team's documentation current
4. **Leverage Aliases**: Create shell aliases for frequently used command combinations

## 🔧 Troubleshooting

### Common Issues

**Q: Legacy command not found**
A: Update to latest funcqc version and check the mapping table above

**Q: Different output format**
A: New commands have improved, more consistent output. Update parsing scripts accordingly

**Q: Performance differences**
A: New commands are generally faster due to optimized processing

**Q: Missing options**
A: Some rarely-used options were consolidated. Check `--help` for available options

### Getting Help

- Check this migration guide
- Use `funcqc [command] --help` for detailed command information
- Refer to the [Command Reference](commands/) for comprehensive documentation
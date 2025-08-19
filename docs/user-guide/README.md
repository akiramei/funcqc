# funcqc User Guide

Welcome to funcqc v2.0 - a revolutionary TypeScript quality management platform that consolidates 45+ commands into 9 intuitive unified commands.

## 🚀 Quick Start

### Installation

```bash
npm install -g funcqc
```

### Basic Workflow

```bash
# 1. Initialize funcqc in your project
funcqc setup --action init

# 2. Measure your project
funcqc measure --level standard

# 3. Assess quality
funcqc assess --type health --verbose

# 4. Inspect problematic functions
funcqc inspect --cc-ge 10 --limit 10

# 5. Find improvement opportunities
funcqc improve --type duplicates
```

## 📊 The 9 Unified Commands

### Tier 1: Core Quality Management Workflow

| Command | Purpose | Quick Example |
|---------|---------|---------------|
| [`setup`](commands/setup.md) | 🛠️ Configuration | `funcqc setup --action init` |
| [`measure`](commands/measure.md) | 📊 Project measurement | `funcqc measure --level standard` |
| [`inspect`](commands/inspect.md) | 🔍 Function/file inspection | `funcqc inspect --cc-ge 10` |
| [`assess`](commands/assess.md) | 📊 Quality assessment | `funcqc assess --type health` |

### Tier 2: Code Improvement

| Command | Purpose | Quick Example |
|---------|---------|---------------|
| [`improve`](commands/improve.md) | 🔧 Code improvement | `funcqc improve --type duplicates` |
| [`manage`](commands/manage.md) | 📊 Data management | `funcqc manage --action diff` |

### Tier 3: Specialized Analysis

| Command | Purpose | Quick Example |
|---------|---------|---------------|
| [`dependencies`](commands/dependencies.md) | 🔗 Dependency analysis | `funcqc dependencies --action cycles` |
| [`refactor`](commands/refactor.md) | 🔧 Refactoring analysis | `funcqc refactor --action guard` |
| [`types`](commands/types.md) | 🧩 TypeScript analysis | `funcqc types --action health` |

## 💡 Common Workflows

### Development Quality Check

```bash
# Quick quality assessment
funcqc measure --level quick
funcqc assess --type health

# Find immediate improvement opportunities
funcqc improve --type duplicates
funcqc improve --type dead-code
```

### Pre-commit Quality Gate

```bash
# Comprehensive analysis
funcqc measure --level standard
funcqc assess --advanced
funcqc dependencies --action cycles
```

### Code Review Preparation

```bash
# Generate comparison between commits
funcqc manage --action diff --from HEAD~1 --to HEAD

# Identify refactoring safety
funcqc refactor --action guard

# Check for type issues
funcqc types --action health
```

### Large-scale Refactoring

```bash
# Deep analysis for refactoring planning
funcqc measure --level complete
funcqc assess --advanced --mode dynamic
funcqc dependencies --action stats --show-hubs
```

## 🎯 Key Benefits of v2.0

- **80% Simpler**: Learning time reduced from weeks to hours
- **Unified Experience**: Consistent command interface across all operations
- **Natural Flow**: measure → assess → improve → manage workflow
- **High Performance**: Optimized processing engine
- **Zero Configuration**: Get started immediately with sensible defaults

## 📚 Next Steps

1. **[Command Reference](commands/)** - Detailed documentation for each command
2. **[Migration Guide](migration-guide.md)** - Upgrade from older versions
3. **[Cheat Sheet](cheatsheet.md)** - Quick reference for common tasks
4. **[GitHub Actions](github-actions-integration.md)** - CI/CD integration

## 🔄 Migration from v1.x

If you're upgrading from an older version, see our [Migration Guide](migration-guide.md) for command mapping and upgrade instructions.

## 💬 Support

- Documentation issues: Check this guide and command references
- Bug reports: Use the project's issue tracker
- Feature requests: Submit via the project repository
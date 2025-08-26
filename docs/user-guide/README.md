# funcqc User Guide

> 注意: 本ガイドの一部は v2.0 の「統合コマンド」（setup/measure/inspect/assess/improve 等）の構想に基づく記述を含みます。現行CLIでは未実装のため、下記マッピングに従って現行コマンドをご利用ください。

現行コマンドへの対応表（抜粋）:
- setup → `init`
- measure → `scan`
- assess → `health`
- inspect → `list` / `show` / `files`
- improve → `similar` または `dep` サブコマンド（`dead`/`delete`/`cycles`/`lint` 等）
- search → `experimental search`
- safe-delete → `dep delete`
- dead → `dep dead`

## 🚀 Quick Start

### Installation

```bash
npm install -g funcqc
```

### Basic Workflow

```bash
# 1. Initialize funcqc in your project
funcqc init

# 2. Measure your project
funcqc scan --with-basic

# 3. Assess quality
funcqc health --verbose

# 4. Inspect problematic functions
funcqc list --cc-ge 10 --limit 10

# 5. Find improvement opportunities
funcqc similar
```

## 📊 The 9 Unified Commands

### Tier 1: Core Quality Management Workflow

| Command | Purpose | Quick Example |
|---------|---------|---------------|
| [`init`](../README.md) | 🛠️ Configuration | `funcqc init` |
| `scan` | 📊 Project measurement | `funcqc scan --with-basic` |
| `list`/`show`/`files` | 🔍 Function/file inspection | `funcqc list --cc-ge 10` |
| `health` | 📊 Quality assessment | `funcqc health` |

### Tier 2: Code Improvement

| Command | Purpose | Quick Example |
|---------|---------|---------------|
| `similar` | 🔧 Code improvement | `funcqc similar` |
| `diff`/`db`/`history` | 📊 Data management | `funcqc diff HEAD~1 HEAD` |

### Tier 3: Specialized Analysis

| Command | Purpose | Quick Example |
|---------|---------|---------------|
| `dep` | 🔗 Dependency analysis | `funcqc dep cycles` |
| `experimental` | 🔧 Experimental features | `funcqc experimental evaluate` |
| `types` | 🧩 TypeScript analysis | `funcqc types health` |

## 💡 Common Workflows

### Development Quality Check

```bash
# Quick quality assessment
funcqc scan --with-basic
funcqc health

# Find immediate improvement opportunities
funcqc similar
funcqc dep dead --format table
```

### Pre-commit Quality Gate

```bash
# Comprehensive analysis
funcqc scan --full
funcqc health --verbose
funcqc dep cycles
```

### Code Review Preparation

```bash
# Generate comparison between commits
funcqc diff HEAD~1 HEAD

# Identify refactoring safety（未実装: refactor/guard）
# 代替: 循環やデッドコードの網羅
funcqc dep cycles
funcqc dep dead

# Check for type issues
funcqc types health
```

### Large-scale Refactoring

```bash
# Deep analysis for refactoring planning
funcqc scan --full
funcqc health --verbose
funcqc dep stats --show-hubs
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

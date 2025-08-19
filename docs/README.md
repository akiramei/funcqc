# funcqc Documentation

Welcome to the funcqc documentation. This documentation is organized into distinct sections for different audiences and purposes.

## 📁 Documentation Structure

### 👤 User Documentation
**`user-guide/`** - Documentation for end users of funcqc

- **[Getting Started](user-guide/README.md)** - Quick start guide and basic concepts
- **[Command Reference](user-guide/commands/)** - Detailed guides for each command
  - [`setup`](user-guide/commands/setup.md) - Initial configuration
  - [`measure`](user-guide/commands/measure.md) - Project measurement and analysis
  - [`inspect`](user-guide/commands/inspect.md) - Function and file inspection
  - [`assess`](user-guide/commands/assess.md) - Quality assessment
  - [`improve`](user-guide/commands/improve.md) - Code improvement suggestions
  - [`manage`](user-guide/commands/manage.md) - Data management
  - [`dependencies`](user-guide/commands/dependencies.md) - Dependency analysis
  - [`refactor`](user-guide/commands/refactor.md) - Refactoring analysis
  - [`types`](user-guide/commands/types.md) - TypeScript type analysis
- **[Migration Guide](user-guide/migration-guide.md)** - Migrating from older command structure
- **[Cheat Sheet](user-guide/cheatsheet.md)** - Quick reference for common tasks
- **[GitHub Actions](user-guide/github-actions-integration.md)** - CI/CD integration

### 🏗️ Architecture Documentation
**`architecture/`** - Technical design and architecture documentation

- **[Database Schema](architecture/data-model.md)** - Database structure and relationships
- **[Function Identity Design](architecture/function-identity-design.md)** - How functions are identified and tracked
- **[Technical Details](architecture/technical-details.md)** - Implementation details
- **[Environment Variables](architecture/environment-variables.md)** - Configuration reference
- **[Similarity Detection](architecture/similarity-detection.md)** - Algorithm details
- **[DOT Visualization](architecture/dot-format-visualization.md)** - Graph output format
- **[Architecture Migration](architecture/ARCHITECTURE_MIGRATION_GUIDE.md)** - Internal architecture changes
- **[Graceful Shutdown](architecture/GRACEFUL-SHUTDOWN.md)** - Process termination handling
- **[Transaction Integrity](architecture/TRANSACTION-INTEGRITY.md)** - Data consistency guarantees

### 🔬 Development Workspace
**`workspace/`** - Temporary documents, research, and development work

- **`evaluation/`** - Performance evaluation project documents
- **`dogfooding/`** - Self-analysis and improvement experiments
- **`issues/`** - Problem investigation and resolution documents
- **Other temporary files** - Implementation plans, migration notes, etc.

⚠️ **Note:** Documents in `workspace/` are working documents and may be outdated, incomplete, or superseded by newer implementations.

## 🎯 funcqc v2.0 Command Overview

funcqc v2.0 consolidates 45+ legacy commands into 9 intuitive unified commands:

| Command | Purpose | Legacy Commands Replaced |
|---------|---------|-------------------------|
| `setup` | Initial configuration | init, config |
| `measure` | Project measurement | scan, analyze |
| `inspect` | Function/file inspection | list, search, files, show |
| `assess` | Quality assessment | health, evaluate |
| `improve` | Code improvement | similar, safe-delete, refactor-guard |
| `manage` | Data management | db, diff, export, import, history |
| `dependencies` | Dependency analysis | dep * (all subcommands) |
| `refactor` | Refactoring analysis | Various refactoring tools |
| `types` | TypeScript analysis | types * (all subcommands) |

## 🚀 Quick Start

```bash
# Initialize funcqc
funcqc setup --action init

# Measure your project
funcqc measure --level standard

# Assess quality
funcqc assess --type health --verbose

# Inspect high-complexity functions
funcqc inspect --cc-ge 10

# Find improvement opportunities
funcqc improve --type duplicates
```

For detailed instructions, see the [User Guide](user-guide/README.md).

## 📄 Version Information

This documentation reflects funcqc v2.0 with the unified command structure. For migration from older versions, see the [Migration Guide](user-guide/migration-guide.md).
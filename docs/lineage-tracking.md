# Function Lineage Tracking

## Overview

Function lineage tracking in funcqc provides comprehensive traceability for function modifications, enabling developers to understand how functions evolve across code changes. This feature automatically detects function relationships including renames, signature changes, splits, merges, and other transformations.

## Key Features

### 🔄 Automatic Lineage Detection
- **Rename Detection**: Tracks functions renamed across commits
- **Signature Changes**: Monitors parameter and return type modifications  
- **Function Splits**: Detects when large functions are divided into smaller ones
- **Function Merges**: Identifies when multiple functions are combined
- **Inline Detection**: Tracks functions that are inlined into their callers

### 📊 Comprehensive Analysis
- **Similarity Scoring**: Advanced AST-based similarity detection (0.0-1.0 confidence)
- **Multi-dimensional Metrics**: Name, signature, structure, and content analysis
- **Git Integration**: Links lineage records to specific commits and branches
- **Historical Tracking**: Maintains complete evolution history

### 🛠️ CLI Commands
- `funcqc diff --lineage`: Generate lineage between snapshots
- `funcqc lineage list`: Browse and filter lineage records
- `funcqc lineage show`: View detailed lineage information
- `funcqc lineage review`: Approve or reject draft lineages

### 🤖 GitHub Actions Integration
- **Automated Detection**: Runs on every pull request
- **PR Comments**: Detailed lineage analysis in PR comments
- **Validation Workflows**: Ensures lineage data integrity
- **Artifact Generation**: Exports lineage data in multiple formats

## Use Cases

### Refactoring Traceability
```bash
# Track function changes during refactoring
funcqc diff main feature/refactor --lineage

# Review pending lineage decisions
funcqc lineage list --status draft --limit 10

# Approve verified lineages
funcqc lineage review approve <lineage-id>
```

### Code Review Enhancement
- Automatic lineage detection in PR workflows
- Clear visualization of function evolution
- Impact analysis for function modifications

### Technical Debt Management
- Track function complexity evolution
- Identify frequently modified functions
- Monitor refactoring effectiveness

### Compliance and Auditing
- Complete function change history
- Traceability for regulated environments
- Change impact documentation

## Architecture

### Database Schema

> **📋 Database Schema**: Complete table definitions for lineage tracking are documented in [data-model.md](./data-model.md#lineage-tracking-system)

### Analysis Pipeline
1. **Function Extraction**: Parse source and target snapshots
2. **Similarity Calculation**: Multi-dimensional comparison algorithms
3. **Lineage Generation**: Create draft lineage records
4. **Confidence Scoring**: Apply weighted similarity metrics
5. **Human Review**: Manual approval/rejection workflow

### Integration Points
- **Git Hooks**: Automatic snapshot creation on commits
- **CI/CD Pipeline**: Lineage validation in continuous integration
- **IDE Extensions**: Real-time lineage information (future)
- **Documentation Tools**: Function evolution documentation

## Getting Started

### Prerequisites
- funcqc v0.1.0 or later
- Git repository with commit history
- Node.js 18+ for GitHub Actions integration

### Quick Start
```bash
# Initialize funcqc in your project
funcqc init

# Create initial snapshot
funcqc scan --label "baseline"

# Make some function changes, then analyze
git commit -am "refactor: rename getUserData to fetchUserProfile"
funcqc scan --label "after-rename"

# Generate lineage analysis
funcqc diff baseline after-rename --lineage

# Review detected lineages
funcqc lineage list --status draft
```

### GitHub Actions Setup
Add the lineage workflows to your repository:
- `.github/workflows/lineage-analysis.yml` - PR analysis
- `.github/workflows/lineage-management.yml` - Maintenance workflows

See [GitHub Actions Integration Guide](./github-actions-lineage.md) for detailed setup.

## Best Practices

### Lineage Hygiene
- **Regular Review**: Process draft lineages within 1-2 weeks
- **Clear Commits**: Use descriptive commit messages for better context
- **Batch Approvals**: Review related lineages together for consistency

### Workflow Integration
- **Pre-commit Analysis**: Run lineage detection before pushing
- **PR Review Process**: Include lineage analysis in code reviews
- **Release Documentation**: Export lineage reports for release notes

### Performance Optimization
- **Snapshot Management**: Clean up old snapshots periodically
- **Selective Analysis**: Use file filters for large repositories
- **Parallel Processing**: Enable concurrent analysis for performance

## Configuration

### Similarity Thresholds
```json
{
  "lineage": {
    "similarity": {
      "rename_threshold": 0.8,
      "signature_threshold": 0.7,
      "split_threshold": 0.6,
      "merge_threshold": 0.6
    },
    "max_candidates": 50,
    "enable_cross_file": true
  }
}
```

### GitHub Actions Variables
- `LINEAGE_AUTO_APPROVE`: Auto-approve high-confidence lineages
- `LINEAGE_COMMENT_THRESHOLD`: Minimum confidence for PR comments
- `LINEAGE_CLEANUP_DAYS`: Days to retain draft lineages

## Troubleshooting

### Common Issues

**High False Positive Rate**
- Reduce similarity thresholds in configuration
- Increase minimum confidence for auto-detection
- Review and reject incorrect lineages to improve learning

**Missing Lineages**
- Check that both snapshots contain the expected functions
- Verify similarity thresholds aren't too restrictive
- Enable cross-file analysis for moved functions

**Performance Issues**
- Reduce `max_candidates` in configuration
- Use file filters to limit analysis scope
- Consider disabling cross-file analysis for large codebases

See [Troubleshooting Guide](./lineage-troubleshooting.md) for detailed solutions.

## API Reference

See [CLI Commands Reference](./lineage-cli-commands.md) for complete command documentation.

## Roadmap

### Planned Features
- **IDE Integration**: VS Code extension for real-time lineage
- **Advanced Visualizations**: Interactive lineage graphs
- **Machine Learning**: Improved similarity detection algorithms
- **Team Collaboration**: Shared lineage review workflows
- **Semantic Analysis**: Natural language processing for function descriptions

### Contributing

Lineage tracking is an evolving feature. Contributions are welcome:
- Algorithm improvements for similarity detection
- New lineage types and analysis patterns
- Performance optimizations
- Documentation and examples

See the main [Contributing Guide](../CONTRIBUTING.md) for development setup.
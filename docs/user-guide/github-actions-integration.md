# GitHub Actions Integration for Function Lineage

This document describes the GitHub Actions workflows that provide automated function lineage detection and management for funcqc.

## Overview

The GitHub Actions integration provides three main workflows:

1. **Lineage Analysis** - Automated lineage detection on pull requests
2. **Lineage Management** - Scheduled and on-demand lineage maintenance
3. **CI Integration** - Lineage system validation in the main CI pipeline

## Workflows

### 1. Lineage Analysis (`lineage-analysis.yml`)

**Trigger:** Pull requests to `main` or `develop` branches

**Purpose:** Automatically detect function lineages between the base branch and PR changes.

**Features:**
- Compares function changes between base and PR branches
- Generates detailed lineage reports with confidence scores
- Posts analysis results as PR comments
- Uploads analysis artifacts for further review
- Updates existing comments on subsequent pushes

**Output Example:**
```markdown
# 🔄 Function Lineage Analysis Report

**PR:** #123 - Refactor authentication system
**Base:** `abc123def`
**Head:** `def456ghi`

## 📊 Summary

| Change Type | Count |
|-------------|-------|
| 🏷️ Rename | 2 |
| ✏️ Signature Change | 1 |
| 🔄 Split | 0 |
| 📎 Inline | 1 |
| **Total** | **4** |

## 🔍 Detected Changes

### RENAME: authenticateUser → validateUserCredentials

- **Confidence:** 95%
- **From:** src/auth/login.ts:45
- **To:** src/auth/validation.ts:12
- **Note:** Function renamed and moved to dedicated validation module
```

### 2. Lineage Management (`lineage-management.yml`)

**Triggers:**
- Manual dispatch with action selection
- Scheduled weekly cleanup (Sundays at 2 AM UTC)

**Actions Available:**
- `validate-all` - Validate all lineage records for consistency
- `cleanup-drafts` - Remove old draft lineages (configurable age)
- `export-report` - Generate comprehensive lineage exports
- `health-check` - System health assessment

**Features:**
- Database integrity validation
- Automated cleanup of stale draft records
- Health monitoring and reporting
- Issue creation for validation failures
- Multi-format exports (JSON, CSV, text)

### 3. CI Integration (Updated `ci.yml`)

**Trigger:** Pushes to main branch

**Purpose:** Validate lineage system functionality in production.

**Features:**
- Ensures lineage commands work correctly
- Validates database schema and connectivity
- Runs after successful test completion
- Lightweight validation suitable for CI/CD

## Setup Requirements

### Repository Permissions

The workflows require the following permissions:

```yaml
permissions:
  contents: read        # Read repository content
  pull-requests: write  # Comment on PRs
  issues: write        # Create issues for validation failures
```

### Environment Setup

No additional secrets or environment variables are required. The workflows use:

- Node.js 18+ (workflows use 20 for consistency)
- Temporary databases for analysis
- Built-in GitHub tokens for API access

## Configuration

### Customizing Analysis Behavior

You can customize the lineage analysis by modifying the workflow files:

**Detection Sensitivity:**
```yaml
# In lineage-analysis.yml, modify the diff command
npm run dev -- diff base pr --lineage --threshold 0.8 --json
```

**Comment Format:**
Edit the report generation section in `lineage-analysis.yml` to customize the markdown output.

**Cleanup Schedule:**
```yaml
# In lineage-management.yml, modify the cron schedule
schedule:
  - cron: '0 2 * * 0'  # Weekly on Sundays at 2 AM UTC
```

### Branch Protection

Consider adding lineage analysis as a required check:

1. Go to Repository Settings → Branches
2. Add a branch protection rule to the `main` branch
3. Require status checks: `lineage-detection`

## Usage Examples

### Manual Lineage Management

Trigger manual lineage operations:

1. Go to the Actions tab in your repository
2. Select "Lineage Management" workflow
3. Click "Run workflow"
4. Choose action and parameters
5. Monitor execution and review artifacts

### Reviewing PR Lineages

When a PR is opened:

1. The lineage analysis runs automatically
2. Results appear as a comment on the PR
3. Review the detected changes for accuracy
4. Use the analysis to understand refactoring impact
5. Approve/reject lineages using CLI tools if needed

### Troubleshooting Analysis Issues

If lineage analysis fails:

1. Check the workflow logs in the Actions tab
2. Verify funcqc configuration is correct
3. Ensure the repository has sufficient history (fetch-depth: 0)
4. Review any error messages in the artifacts

## Integration with funcqc CLI

The GitHub Actions complement the CLI tools:

**Workflow-Generated Data:**
```bash
# Review lineages detected by CI
funcqc lineage list --status draft

# Approve lineages from PR analysis
funcqc lineage review abc123 --approve

# Export lineages for external analysis
funcqc lineage list --json > lineages.json
```

**Local Development:**
```bash
# Test lineage detection locally before PR
funcqc diff HEAD~1 HEAD --lineage

# Preview what CI will detect
funcqc scan --label local-test
funcqc diff main local-test --lineage
```

## Performance Considerations

### Workflow Optimization

- **Conditional Execution:** Lineage analysis only runs on non-draft PRs
- **Incremental Analysis:** Only analyzes changes between base and head
- **Artifact Retention:** 30 days for analysis results, 90 days for management reports
- **Parallel Execution:** Independent of main CI pipeline

### Resource Usage

- **Analysis Time:** Typically 2–5 minutes depending on changes
- **Storage:** Minimal - only metadata and analysis results
- **API Calls:** Conservative rate limiting for PR comments

## Security Considerations

### Data Protection

- **No Sensitive Data:** Only function metadata is analyzed
- **Temporary Storage:** Databases are ephemeral and cleaned up
- **Limited Permissions:** Workflows use minimal required permissions

### Access Control

- **Pull Request Comments:** Visible to repository collaborators
- **Workflow Artifacts:** Accessible to repository members
- **Issue Creation:** Limited to validation failures

## Best Practices

### Code Review Integration

1. **Review Lineage Comments:** Check accuracy of detected changes
2. **Validate High-Confidence Changes:** Confirm renames and refactoring
3. **Question Low-Confidence Detections:** Investigate uncertain matches
4. **Use as Documentation:** Lineage reports document refactoring history

### Maintenance

1. **Regular Health Checks:** Use manual health-check action monthly
2. **Draft Cleanup:** Let automatic cleanup handle old drafts
3. **Export Backups:** Periodically export lineage data for archival
4. **Monitor Issues:** Address validation failures promptly

### Development Workflow

1. **Local Testing:** Test lineage detection before pushing
2. **Incremental Changes:** Keep PRs focused for better analysis
3. **Clear Commit Messages:** Help explain lineage context
4. **Review Artifacts:** Check uploaded analysis files for detailed insights

## Troubleshooting

### Common Issues

**No Lineages Detected:**
- Verify changes modify existing functions (not just additions)
- Check if changes exceed detection thresholds
- Ensure base and head branches have function scans

**Analysis Failures:**
- Check Node.js version compatibility (requires 18+)
- Verify repository has sufficient Git history
- Review workflow logs for specific error messages

**Permission Errors:**
- Confirm repository permissions for Actions
- Check if workflow permissions are correctly configured
- Verify GitHub token has necessary scopes

### Getting Help

1. **Review Workflow Logs:** Detailed execution information
2. **Check Artifacts:** Download analysis files for debugging
3. **Local Reproduction:** Run equivalent CLI commands locally
4. **Issue Tracking:** Use validation issues for systematic problems

## Future Enhancements

Planned improvements for the GitHub Actions integration:

- **Smart Conflict Detection:** Identify conflicting lineage changes
- **Quality Gate Integration:** Block merges with unreviewed lineages
- **Metrics Dashboard:** Aggregate lineage statistics over time
- **Custom Webhooks:** Integration with external systems
- **Advanced Filtering:** Configurable analysis scope and sensitivity
# Lineage Troubleshooting Guide

## Overview

This guide covers common issues, debugging techniques, and solutions for funcqc lineage tracking. Use this reference to quickly resolve problems and optimize your lineage workflow.

---

## Quick Diagnosis

### Health Check Commands

Start with these commands to assess system health:

```bash
# Basic system status
funcqc --version
funcqc status

# Database connectivity
funcqc lineage list --limit 1

# Recent lineage activity
funcqc lineage list --since "1 day ago"

# Check for draft lineages
funcqc lineage list --status draft --limit 5
```

### Common Symptoms

| Symptom | Likely Cause | Quick Fix |
|---------|--------------|-----------|
| No lineages detected | High thresholds, no changes | Lower `--min-confidence` |
| Too many false positives | Low thresholds | Increase similarity thresholds |
| Slow performance | Large codebase, cross-file analysis | Use `--file` filters |
| Database errors | Corruption, permission issues | Check `.funcqc/` directory |
| Missing lineages | Functions not in snapshots | Verify snapshot creation |

---

## Installation and Setup Issues

### Database Initialization Problems

#### Issue: `.funcqc` directory not found
```bash
funcqc lineage list
# Error: Database not initialized
```

**Solution:**
```bash
# Initialize funcqc
funcqc init

# Create initial snapshot
funcqc scan --label "baseline"

# Verify database creation
ls -la .funcqc/
```

#### Issue: Permission denied on `.funcqc` directory
```bash
funcqc scan
# Error: EACCES: permission denied, open '.funcqc/database.db'
```

**Solution:**
```bash
# Fix permissions
chmod -R 755 .funcqc/

# Or recreate with correct permissions
rm -rf .funcqc
funcqc init
```

#### Issue: Database corruption
```bash
funcqc lineage list
# Error: database disk image is malformed
```

**Solution:**
```bash
# Backup existing data
cp -r .funcqc .funcqc.corrupted

# Re-initialize database
rm -rf .funcqc
funcqc init

# Re-scan from scratch
funcqc scan --label "recovery"
```

---

## Lineage Detection Issues

### No Lineages Detected

#### Issue: `funcqc diff --lineage` returns empty results

**Diagnosis:**
```bash
# Check if snapshots exist
funcqc history

# Verify functions in snapshots
funcqc list --snapshot snapshot1 --limit 5
funcqc list --snapshot snapshot2 --limit 5

# Check with lower confidence threshold
funcqc diff snapshot1 snapshot2 --lineage --min-confidence 0.1
```

**Common Causes:**

1. **No actual function changes**
   ```bash
   # Verify there are function modifications
   git diff snapshot1..snapshot2 -- "*.ts" "*.js"
   ```

2. **Confidence threshold too high**
   ```bash
   # Try with lower threshold
   funcqc diff base head --lineage --min-confidence 0.5
   ```

3. **Functions not in both snapshots**
   ```bash
   # Check function overlap
   funcqc diff snapshot1 snapshot2 --functions-only
   ```

**Solutions:**
```bash
# Lower confidence threshold
funcqc diff base head --lineage --min-confidence 0.6

# Enable cross-file analysis
funcqc diff base head --lineage --cross-file

# Check specific file patterns
funcqc diff base head --lineage --file "src/**/*.ts"
```

### Too Many False Positives

#### Issue: Lineage detection finds unrelated functions

**Diagnosis:**
```bash
# Review low-confidence lineages
funcqc lineage list --confidence "<0.8" --limit 10

# Check specific false positive
funcqc lineage show <lineage-id> --show-metadata
```

**Solutions:**
```bash
# Increase confidence threshold
funcqc diff base head --lineage --min-confidence 0.8

# Reject false positives to improve future detection
funcqc lineage review reject <lineage-id> --reason "Unrelated functions"

# Disable cross-file analysis if causing issues
funcqc diff base head --lineage --no-cross-file
```

### Missing Expected Lineages

#### Issue: Known function renames not detected

**Diagnosis:**
```bash
# Verify functions exist in both snapshots
funcqc show --name "oldFunctionName" --snapshot base
funcqc show --name "newFunctionName" --snapshot head

# Check with very low threshold
funcqc diff base head --lineage --min-confidence 0.1 --max-candidates 100
```

**Common Causes:**

1. **Significant function changes**
   - Large content modifications reduce similarity
   - Structural changes affect AST matching

2. **Name similarity too low**
   - Completely different names get low name scores
   - Combined with other changes, falls below threshold

3. **Analysis limitations**
   - Cross-file moves not detected (if disabled)
   - Functions filtered out by file patterns

**Solutions:**
```bash
# Enable cross-file analysis
funcqc diff base head --lineage --cross-file

# Increase candidate pool
funcqc diff base head --lineage --max-candidates 100

# Manual lineage creation (if needed)
funcqc lineage create rename \
  --from func_old_123 \
  --to func_new_456 \
  --confidence 0.9 \
  --note "Manual verification"
```

---

## Performance Issues

### Slow Lineage Analysis

#### Issue: `funcqc diff --lineage` takes too long

**Diagnosis:**
```bash
# Time the analysis
time funcqc diff base head --lineage

# Check repository size
find . -name "*.ts" -o -name "*.js" | wc -l

# Monitor resource usage
top -p $(pgrep funcqc)
```

**Solutions:**

1. **Limit analysis scope**
   ```bash
   # Analyze specific directories
   funcqc diff base head --lineage --file "src/core/**/*.ts"
   
   # Skip large directories
   funcqc diff base head --lineage --file "!**/node_modules/**"
   ```

2. **Reduce analysis complexity**
   ```bash
   # Disable cross-file analysis
   funcqc diff base head --lineage --no-cross-file
   
   # Reduce candidate pool
   funcqc diff base head --lineage --max-candidates 25
   
   # Increase confidence threshold
   funcqc diff base head --lineage --min-confidence 0.8
   ```

3. **Optimize environment**
   ```bash
   # Use faster storage (SSD)
   # Increase available memory
   # Close other applications
   ```

### Memory Issues

#### Issue: Out of memory during analysis

```bash
funcqc diff base head --lineage
# Error: JavaScript heap out of memory
```

**Solutions:**
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=8192"
funcqc diff base head --lineage

# Process in smaller chunks
funcqc diff base head --lineage --file "src/components/**"
funcqc diff base head --lineage --file "src/utils/**"

# Reduce analysis scope
funcqc diff base head --lineage --max-candidates 20 --no-cross-file
```

---

## GitHub Actions Issues

### Workflow Failures

#### Issue: Lineage analysis workflow fails

**Diagnosis:**
```bash
# Check workflow logs in GitHub Actions
# Look for specific error messages
```

**Common Errors:**

1. **Permission errors**
   ```yaml
   # Fix: Add required permissions
   permissions:
     contents: read
     pull-requests: write
     actions: write
   ```

2. **Database initialization**
   ```yaml
   # Fix: Ensure proper setup
   - name: Setup funcqc database
     run: |
       mkdir -p .funcqc
       echo "Initializing lineage database"
   ```

3. **Memory/timeout issues**
   ```yaml
   # Fix: Add resource limits
   - name: Generate lineage analysis
     timeout-minutes: 15
     run: |
       export NODE_OPTIONS="--max-old-space-size=4096"
       funcqc diff base pr --lineage --max-candidates 25
   ```

### PR Comment Issues

#### Issue: Lineage analysis comments not appearing

**Diagnosis:**
```bash
# Check workflow permissions
# Verify PR is from same repository (not fork)
# Check for comment update logic issues
```

**Solutions:**
```yaml
# Ensure proper permissions
permissions:
  pull-requests: write

# Handle fork PRs differently
- name: Comment on PR
  if: github.event.pull_request.head.repo.full_name == github.repository
  uses: actions/github-script@v7
```

#### Issue: Artifact upload failures

```
Error: Resource not accessible by integration
```

**Solution:**
```yaml
# Add actions permission
permissions:
  actions: write

# Or make upload conditional
- name: Upload artifacts
  if: github.event.pull_request.head.repo.full_name == github.repository
  uses: actions/upload-artifact@v4
```

---

## Data Quality Issues

### Invalid Lineage Records

#### Issue: Corrupted lineage metadata

**Diagnosis:**
```sql
-- Check for invalid JSON
SELECT id, metadata 
FROM lineages 
WHERE NOT json_valid(metadata) OR metadata IS NULL;

-- Check for invalid arrays
SELECT id, from_ids, to_ids
FROM lineages 
WHERE NOT json_valid(from_ids) OR NOT json_valid(to_ids);
```

**Solutions:**
```bash
# Clean up invalid records
funcqc lineage clean --fix-json --dry-run
funcqc lineage clean --fix-json

# Remove completely corrupted records
funcqc lineage clean --remove-invalid
```

### Orphaned References

#### Issue: Lineages reference non-existent functions

**Diagnosis:**
```sql
-- Find orphaned lineages
SELECT l.id, l.from_ids, l.to_ids
FROM lineages l
WHERE NOT EXISTS (
    SELECT 1 FROM functions f 
    WHERE f.id = ANY(SELECT json_array_elements_text(l.from_ids::json))
);
```

**Solutions:**
```bash
# Clean up orphaned references
funcqc lineage clean --fix-orphans

# Remove orphaned lineages
funcqc lineage clean --remove-orphans --dry-run
funcqc lineage clean --remove-orphans
```

---

## Configuration Issues

### Incorrect Similarity Thresholds

#### Issue: Poor detection quality

**Symptoms:**
- Too many false positives
- Missing obvious lineages
- Inconsistent results

**Solution - Tune Thresholds:**
```json
// .funcqcrc
{
  "lineage": {
    "similarity_thresholds": {
      "rename": 0.85,           // Increase for fewer false positives
      "signature_change": 0.75, // Adjust based on your codebase
      "split": 0.65,           // Lower for better split detection
      "merge": 0.65,           // Lower for better merge detection
      "inline": 0.8            // Higher for precise inline detection
    }
  }
}
```

**Threshold Tuning Guide:**

| Issue | Adjustment | Effect |
|-------|------------|---------|
| Too many false renames | Increase `rename` to 0.9+ | Stricter name matching |
| Missing signature changes | Decrease `signature_change` to 0.6 | More sensitive to param changes |
| Split not detected | Decrease `split` to 0.5 | Finds more function divisions |
| Performance issues | Increase all thresholds | Fewer candidates processed |

### File Filtering Problems

#### Issue: Functions not analyzed due to filters

**Diagnosis:**
```bash
# Check current file patterns
funcqc config show

# Test without filters
funcqc diff base head --lineage --file "**/*"

# Verify specific files included
funcqc diff base head --lineage --file "src/problematic-file.ts" --json
```

**Solutions:**
```bash
# Expand file patterns
funcqc diff base head --lineage --file "src/**/*.{ts,tsx,js,jsx}"

# Remove restrictive patterns
funcqc diff base head --lineage --file "!**/test/**" --file "!**/spec/**"

# Check pattern syntax
funcqc diff base head --lineage --file "src/**/!(*.test).ts"
```

---

## Debugging Techniques

### Verbose Logging

```bash
# Enable debug logging
export DEBUG="funcqc:lineage*"
funcqc diff base head --lineage

# Full verbose output
export FUNCQC_LOG_LEVEL="debug"
funcqc diff base head --lineage --json > debug-output.json
```

### Step-by-step Analysis

```bash
# 1. Verify snapshots
funcqc history

# 2. Check function extraction
funcqc list --snapshot base --limit 5 --json
funcqc list --snapshot head --limit 5 --json

# 3. Test similarity detection
funcqc similarity --from func_123 --to func_456 --verbose

# 4. Trace lineage generation
funcqc diff base head --lineage --trace --json
```

### Database Inspection

```bash
# Direct database queries
funcqc db query "SELECT COUNT(*) FROM lineages"
funcqc db query "SELECT kind, COUNT(*) FROM lineages GROUP BY kind"

# Export for analysis
funcqc lineage list --json > lineages-export.json
jq '.lineages[] | select(.confidence < 0.7)' lineages-export.json

# Schema validation
funcqc db validate
```

---

## Recovery Procedures

### Complete System Reset

When all else fails:

```bash
# 1. Backup current state
cp -r .funcqc .funcqc.backup.$(date +%Y%m%d)

# 2. Export existing lineages
funcqc lineage list --json > lineages-backup.json

# 3. Clean reset
rm -rf .funcqc
funcqc init

# 4. Re-scan project
funcqc scan --label "recovery-baseline"
git log --oneline -10 | while read commit message; do
  git checkout $commit
  funcqc scan --label "recovery-$commit"
done
git checkout main

# 5. Re-import approved lineages
jq '.lineages[] | select(.status == "approved")' lineages-backup.json | \
  funcqc lineage import
```

### Selective Recovery

For targeted issues:

```bash
# Remove problematic lineages
funcqc lineage list --confidence "<0.5" --json | \
  jq -r '.lineages[].id' | \
  xargs -I {} funcqc lineage review reject {} --reason "Low confidence recovery"

# Re-analyze specific commits
funcqc diff problematic-base problematic-head --lineage --min-confidence 0.8

# Fix specific function tracking
funcqc show --name "problematicFunction" --all-snapshots
```

---

## Performance Optimization

### Database Optimization

```bash
# Vacuum and analyze database
funcqc db vacuum
funcqc db analyze

# Rebuild indexes
funcqc db reindex

# Check database statistics
funcqc db stats
```

### Configuration Tuning

```json
// .funcqcrc - Performance optimized
{
  "lineage": {
    "analysis": {
      "max_candidates": 25,        // Reduce for speed
      "enable_cross_file": false,  // Disable for large repos
      "timeout_seconds": 60,       // Set reasonable timeout
      "parallel_workers": 4        // Adjust for CPU cores
    },
    "similarity_thresholds": {
      "rename": 0.8,              // Higher = faster
      "signature_change": 0.75,
      "split": 0.7,
      "merge": 0.7,
      "inline": 0.8
    }
  }
}
```

### System Optimization

```bash
# Use faster storage for .funcqc
# Ensure adequate RAM (8GB+ for large repos)
# Use SSD storage
# Close unnecessary applications

# Monitor resource usage
funcqc diff base head --lineage --profile > performance.log
```

---

## Getting Help

### Information to Gather

When reporting issues, include:

```bash
# System information
funcqc --version
node --version
git --version
uname -a

# Repository information
git log --oneline -5
find . -name "*.ts" -o -name "*.js" | wc -l
du -sh .funcqc/

# Error reproduction
funcqc diff base head --lineage --json > error-output.json
```

### Community Resources

- **GitHub Issues**: [funcqc/issues](https://github.com/your-org/funcqc/issues)
- **Discussions**: [funcqc/discussions](https://github.com/your-org/funcqc/discussions)
- **Documentation**: [docs/](../README.md)

### Professional Support

For enterprise support:
- Priority issue resolution
- Custom configuration assistance
- Performance tuning consultation
- Training and best practices

Contact: support@funcqc.dev

---

## Preventive Measures

### Regular Maintenance

```bash
# Weekly maintenance script
#!/bin/bash
set -e

echo "Starting funcqc maintenance..."

# Clean old drafts
funcqc lineage clean --older-than 30d --status draft

# Vacuum database
funcqc db vacuum

# Generate health report
funcqc lineage health > maintenance-report.txt

# Check for issues
if funcqc lineage validate --quiet; then
  echo "✅ All validations passed"
else
  echo "❌ Validation issues detected - see maintenance-report.txt"
fi
```

### Monitoring Setup

```bash
# Add to CI/CD pipeline
- name: Lineage System Health Check
  run: |
    DRAFT_COUNT=$(funcqc lineage list --status draft --json | jq '.total')
    if [ "$DRAFT_COUNT" -gt 50 ]; then
      echo "::warning::High number of draft lineages: $DRAFT_COUNT"
    fi
    
    funcqc lineage validate || exit 1
```

### Best Practices Checklist

- [ ] Regular review of draft lineages (weekly)
- [ ] Monitor confidence thresholds and adjust as needed
- [ ] Keep funcqc updated to latest version
- [ ] Backup `.funcqc/` directory regularly
- [ ] Use appropriate file filters for large repositories
- [ ] Train team on lineage review process
- [ ] Set up automated health monitoring
- [ ] Document custom configuration decisions

---

This troubleshooting guide covers the most common issues. For complex problems or custom scenarios, consult the [Advanced Configuration Guide](./advanced-lineage-configuration.md) or contact support.
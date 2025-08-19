# funcqc manage

📊 Unified data management command that consolidates database, diff, export, import, and history functionality.

## Usage

```bash
funcqc manage [options]
```

## Description

The `manage` command provides comprehensive data management capabilities for funcqc snapshots and analysis data. It handles snapshot comparison, data export/import, database operations, and historical analysis. This command consolidates the legacy `db`, `diff`, `export`, `import`, and `history` commands.

## Options

### Basic Options
- `--action <action>` - Management action: `history`, `diff`, `db`, `export`, `import`, `cleanup`
- `-j, --json` - Output results as JSON
- `--verbose` - Include detailed information
- `--quiet` - Minimal output

### Diff Options
- `--from <snapshot>` - Source snapshot for comparison
- `--to <snapshot>` - Target snapshot for comparison
- `--insights` - Include change insights and recommendations
- `--similarity-threshold <number>` - Threshold for moved/renamed function detection
- `--scope <scope>` - Limit comparison scope (directory, module, file)
- `--format <format>` - Diff output format: `table`, `json`, `report`

### Database Options
- `--table <name>` - Database table name
- `--where <condition>` - SQL WHERE condition
- `--limit <number>` - Limit number of results
- `--offset <number>` - Offset for pagination
- `--columns <fields>` - Specify columns to show
- `--count` - Show count instead of data
- `--list` - List available tables

### Export/Import Options
- `--format <format>` - Export format: `json`, `csv`, `sqlite`
- `--output <path>` - Output file path
- `--input <path>` - Input file path for import
- `--compress` - Compress exported data
- `--table <name>` - Table to export/import (when applicable)

## Management Actions

### `history` - Snapshot History
View and manage snapshot history.

```bash
# View recent snapshots
funcqc manage --action history

# Detailed history with metrics
funcqc manage --action history --verbose

# JSON output for automation
funcqc manage --action history --json
```

**History Information:**
- Snapshot timestamps and labels
- Measurement levels and scope
- Quality metrics evolution
- Storage size and duration

### `diff` - Snapshot Comparison
Compare snapshots to analyze changes over time.

```bash
# Compare two snapshots
funcqc manage --action diff --from main --to feature-branch

# Include change insights
funcqc manage --action diff --from HEAD~1 --to HEAD --insights

# Custom similarity threshold for move detection
funcqc manage --action diff --from baseline --to current --similarity-threshold 0.8
```

**Diff Analysis:**
- Added, modified, removed functions
- Function moves and renames
- Quality metric changes
- Risk assessment changes

### `db` - Database Operations
Direct database access and management.

```bash
# List all tables
funcqc manage --action db --list

# Query specific table
funcqc manage --action db --table functions --limit 10

# Filter with conditions
funcqc manage --action db --table functions --where "cyclomaticComplexity > 10"

# Count records
funcqc manage --action db --table snapshots --count
```

### `export` - Data Export
Export funcqc data for external analysis.

```bash
# Export all data
funcqc manage --action export --format json --output funcqc-data.json

# Export specific snapshot
funcqc manage --action export --from main --format csv --output main-snapshot.csv

# Compressed export
funcqc manage --action export --format sqlite --output data.sqlite --compress
```

### `import` - Data Import
Import funcqc data from external sources.

```bash
# Import snapshot data
funcqc manage --action import --input backup.json --format json

# Import from SQLite
funcqc manage --action import --input archive.sqlite --format sqlite
```

### `cleanup` - Data Cleanup
Clean up old snapshots and optimize storage.

```bash
# Remove old snapshots (keep last 10)
funcqc manage --action cleanup --limit 10

# Clean up orphaned data
funcqc manage --action cleanup --verbose
```

## Snapshot Comparison

### Basic Comparison

```bash
# Compare with previous commit
funcqc manage --action diff --from HEAD~1 --to HEAD

# Compare branches
funcqc manage --action diff --from main --to feature/new-api

# Compare labeled snapshots
funcqc manage --action diff --from release-1.0 --to release-2.0
```

### Advanced Comparison with Insights

```bash
# Get detailed change analysis
funcqc manage --action diff --from main --to current --insights --verbose
```

**Insights Include:**
- Function complexity trends
- Risk factor changes  
- Structural improvements/degradations
- Refactoring opportunities
- Quality impact assessment

### Move Detection

```bash
# Sensitive move detection (high threshold)
funcqc manage --action diff --from A --to B --similarity-threshold 0.95

# Relaxed move detection (catch more renames)
funcqc manage --action diff --from A --to B --similarity-threshold 0.8
```

## Database Queries

### Common Table Queries

```bash
# View all snapshots
funcqc manage --action db --table snapshots --columns id,label,created_at

# High complexity functions
funcqc manage --action db --table functions --where "cyclomaticComplexity >= 20" --limit 20

# Recent function changes
funcqc manage --action db --table function_changes --limit 10

# Type information
funcqc manage --action db --table types --where "kind = 'interface'" --limit 10
```

### Advanced Queries

```bash
# Functions by file
funcqc manage --action db --table functions --where "filePath LIKE '%parser%'" --columns name,filePath,cyclomaticComplexity

# Quality trends
funcqc manage --action db --table snapshots --columns label,healthIndex,created_at --limit 20

# Dependencies analysis
funcqc manage --action db --table dependencies --where "dependencyType = 'direct'" --count
```

## Data Export Formats

### JSON Export

```bash
# Complete data export
funcqc manage --action export --format json --output complete-data.json

# Snapshot-specific export
funcqc manage --action export --from main --format json --output main-data.json
```

**JSON Structure:**
```json
{
  "metadata": {
    "exportDate": "2024-01-15T10:30:00Z",
    "version": "2.0.0",
    "snapshot": "main"
  },
  "functions": [...],
  "files": [...],
  "dependencies": [...],
  "metrics": {...}
}
```

### CSV Export

```bash
# Functions as CSV
funcqc manage --action export --format csv --output functions.csv --table functions

# Custom columns
funcqc manage --action export --format csv --columns name,file,cc,risk --output summary.csv
```

### SQLite Export

```bash
# Full database export
funcqc manage --action export --format sqlite --output funcqc-backup.sqlite

# Compressed backup
funcqc manage --action export --format sqlite --output backup.sqlite.gz --compress
```

## Historical Analysis

### Trend Analysis

```bash
# Quality trends over time
funcqc manage --action history --verbose --json | \
  jq '.snapshots[] | {label: .label, health: .healthIndex, date: .createdAt}'

# Function count evolution
funcqc manage --action db --table snapshots --columns label,functionCount,created_at
```

### Regression Detection

```bash
# Find quality regressions
for snapshot in $(funcqc manage --action history --json | jq -r '.snapshots[].id'); do
  echo "=== $snapshot ==="
  funcqc manage --action diff --from baseline --to $snapshot --insights | grep -i "degraded"
done
```

### Release Analysis

```bash
# Compare releases
funcqc manage --action diff --from release-1.0 --to release-2.0 --insights --format report
```

## Automation Examples

### Backup Automation

```bash
#!/bin/bash
# Daily backup script
DATE=$(date +%Y%m%d)
funcqc manage --action export --format sqlite --output "backup-$DATE.sqlite" --compress

# Clean old backups (keep last 30 days)
find . -name "backup-*.sqlite" -mtime +30 -delete
```

### Quality Monitoring

```bash
#!/bin/bash
# Monitor quality trends
CURRENT_HEALTH=$(funcqc assess --type health --json | jq '.overallHealth')
BASELINE_HEALTH=$(funcqc manage --action db --table snapshots --where "label='baseline'" --json | jq '.rows[0].healthIndex')

if [ "$CURRENT_HEALTH" -lt "$BASELINE_HEALTH" ]; then
  echo "Quality regression detected: $CURRENT_HEALTH < $BASELINE_HEALTH"
  funcqc manage --action diff --from baseline --to HEAD --insights
fi
```

### CI/CD Integration

```yaml
# GitHub Actions workflow
- name: Quality Comparison
  run: |
    # Compare with main branch
    funcqc manage --action diff --from main --to HEAD --json > diff-report.json
    
    # Export current state
    funcqc manage --action export --format json --output current-snapshot.json
    
    # Upload artifacts
    gh release upload ${{ github.ref_name }} diff-report.json current-snapshot.json
```

## Data Management Best Practices

### Regular Maintenance

```bash
# Weekly cleanup (keep last 50 snapshots)
funcqc manage --action cleanup --limit 50

# Monthly full backup
funcqc manage --action export --format sqlite --output monthly-backup.sqlite --compress
```

### Storage Optimization

```bash
# Check storage usage
funcqc manage --action db --table snapshots --columns id,label,storageSize

# Clean up large old snapshots
funcqc manage --action cleanup --verbose
```

### Migration and Archival

```bash
# Archive old project data
funcqc manage --action export --format sqlite --output archive-2023.sqlite
funcqc manage --action cleanup --limit 10

# Restore archived data when needed
funcqc manage --action import --input archive-2023.sqlite
```

## Performance Considerations

### Large Datasets

```bash
# Use pagination for large queries
funcqc manage --action db --table functions --limit 1000 --offset 0

# Export in chunks
funcqc manage --action export --table functions --limit 5000 --format json
```

### Efficient Comparisons

```bash
# Compare specific scopes only
funcqc manage --action diff --from A --to B --scope src

# Use appropriate similarity thresholds
funcqc manage --action diff --from A --to B --similarity-threshold 0.9
```

## Troubleshooting

### Common Issues

**Large diff operations:**
```bash
# Reduce scope
funcqc manage --action diff --from A --to B --scope core

# Increase similarity threshold
funcqc manage --action diff --from A --to B --similarity-threshold 0.95
```

**Database queries timing out:**
```bash
# Use limits
funcqc manage --action db --table functions --limit 1000

# Add specific conditions
funcqc manage --action db --table functions --where "filePath LIKE 'src/%'" --limit 100
```

**Export/import failures:**
```bash
# Check format compatibility
funcqc manage --action export --format json --verbose

# Validate data before import
funcqc manage --action import --input data.json --verbose --dry-run
```

## See Also

- [measure](measure.md) - Create snapshots for management
- [assess](assess.md) - Quality assessment of managed data
- [inspect](inspect.md) - Detailed analysis of managed functions
- [Migration Guide](../migration-guide.md) - Upgrading from `db`, `diff`, `history` commands
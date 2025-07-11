# Lineage Database Operations and Maintenance

## Overview

This document covers the operational aspects of funcqc's lineage tracking system, including database operations, migration processes, and maintenance procedures.

> **📋 Database Schema Reference**: For complete database table definitions and schema details, see [data-model.md](./data-model.md)

## Database Architecture

### Technology Stack
- **Database Engine**: PGLite (embedded PostgreSQL)
- **Query Builder**: Kysely with full type safety
- **Migrations**: Automatic schema versioning
- **Storage**: Single-file database in `.funcqc/` directory

### Key Design Principles
1. **Zero Configuration**: Works out-of-the-box without external dependencies
2. **Type Safety**: Full TypeScript integration with Kysely
3. **Performance**: Optimized indexes and query patterns
4. **Extensibility**: Schema designed for future enhancements
5. **Data Integrity**: Foreign key constraints and validation

---

## Database Operations

> **📋 Schema Details**: Complete table definitions including lineage tables, indexes, and constraints are documented in [data-model.md](./data-model.md#lineage追跡システム)

### Lineage System Overview

The lineage tracking system captures function evolution through:
- **lineage**: Core table storing function relationships and transformations
- **refactoring_sessions**: Organized refactoring workflow management  
- **session_functions**: Function tracking within refactoring sessions
- **refactoring_opportunities**: Automated detection of improvement opportunities

---

## Migration System

### Automatic Migrations

The database schema evolves automatically using a migration system:

```typescript
// Migration structure
interface Migration {
  version: number;
  description: string;
  up: (db: Database) => Promise<void>;
  down: (db: Database) => Promise<void>;
}

// Example migration
const migration_001: Migration = {
  version: 1,
  description: 'Create lineages table',
  up: async (db) => {
    await db.schema
      .createTable('lineages')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('kind', 'text', (col) => col.notNull())
      // ... other columns
      .execute();
  },
  down: async (db) => {
    await db.schema.dropTable('lineages').execute();
  }
};
```

### Migration History

Migration state is tracked in the database:

```sql
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TEXT DEFAULT CURRENT_TIMESTAMP,
    checksum TEXT NOT NULL
);
```

### Current Migration List

| Version | Description | Status |
|---------|-------------|--------|
| 001 | Create lineages table | ✅ Applied |
| 002 | Add lineage indexes | ✅ Applied |
| 003 | Add metadata column | ✅ Applied |
| 004 | Optimize GIN indexes | ✅ Applied |

---

## Database Operations

### Common Queries

#### Find Lineages by Function
```sql
-- Find all lineages involving a specific function
SELECT * FROM lineages 
WHERE from_ids::jsonb ? 'func_12345' 
   OR to_ids::jsonb ? 'func_12345';

-- Using Kysely (TypeScript)
const lineages = await db
  .selectFrom('lineages')
  .selectAll()
  .where(sql`from_ids::jsonb ? ${functionId}`)
  .orWhere(sql`to_ids::jsonb ? ${functionId}`)
  .execute();
```

#### Draft Lineages for Review
```sql
-- Get draft lineages ordered by confidence
SELECT id, kind, confidence, 
       json_extract(from_ids, '$[0]') as from_func,
       json_extract(to_ids, '$[0]') as to_func
FROM lineages 
WHERE status = 'draft'
ORDER BY confidence DESC
LIMIT 20;
```

#### Lineage Statistics
```sql
-- Summary statistics by type and status
SELECT 
    kind,
    status,
    COUNT(*) as count,
    AVG(confidence) as avg_confidence,
    MIN(confidence) as min_confidence,
    MAX(confidence) as max_confidence
FROM lineages
GROUP BY kind, status
ORDER BY kind, status;
```

### Performance Optimizations

#### Query Plan Analysis
```sql
-- Analyze query performance
EXPLAIN QUERY PLAN
SELECT * FROM lineages 
WHERE status = 'draft' 
  AND confidence > 0.8
ORDER BY created_at DESC;
```

#### Index Usage Monitoring
```sql
-- Check index usage
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan as index_scans,
    idx_tup_read as tuples_read
FROM pg_stat_user_indexes 
WHERE tablename = 'lineages'
ORDER BY idx_scan DESC;
```

---

## Maintenance Procedures

### Database Health Checks

#### Data Integrity Validation
```sql
-- Check for orphaned lineage records
SELECT COUNT(*) as orphaned_lineages
FROM lineages l
WHERE NOT EXISTS (
    SELECT 1 FROM functions f 
    WHERE f.id = ANY(SELECT json_array_elements_text(l.from_ids::json))
);

-- Validate JSON structure
SELECT id, 'from_ids' as field 
FROM lineages 
WHERE NOT json_valid(from_ids)
UNION ALL
SELECT id, 'to_ids' as field 
FROM lineages 
WHERE NOT json_valid(to_ids);
```

#### Performance Monitoring
```typescript
// Database statistics collection
const stats = await db
  .selectFrom('lineages')
  .select([
    sql`COUNT(*)`.as('total_lineages'),
    sql`COUNT(CASE WHEN status = 'draft' THEN 1 END)`.as('draft_count'),
    sql`COUNT(CASE WHEN status = 'approved' THEN 1 END)`.as('approved_count'),
    sql`AVG(confidence)`.as('avg_confidence'),
    sql`COUNT(DISTINCT kind)`.as('unique_kinds')
  ])
  .executeTakeFirst();
```

### Cleanup Operations

#### Remove Old Draft Lineages
```sql
-- Delete drafts older than 30 days
DELETE FROM lineages 
WHERE status = 'draft' 
  AND datetime(created_at) < datetime('now', '-30 days');
```

#### Archive Approved Lineages
```typescript
// Archive old approved lineages to separate table
await db.transaction().execute(async (trx) => {
  // Create archive table if not exists
  await trx.schema
    .createTable('lineages_archive')
    .ifNotExists()
    .as(trx.selectFrom('lineages').selectAll().where('id', '=', 'dummy'))
    .execute();
    
  // Move old approved lineages
  const oldLineages = await trx
    .selectFrom('lineages')
    .selectAll()
    .where('status', '=', 'approved')
    .where(sql`datetime(created_at) < datetime('now', '-90 days')`)
    .execute();
    
  if (oldLineages.length > 0) {
    await trx.insertInto('lineages_archive').values(oldLineages).execute();
    await trx
      .deleteFrom('lineages')
      .where('id', 'in', oldLineages.map(l => l.id))
      .execute();
  }
});
```

### Backup and Recovery

#### Database Backup
```bash
# Create backup of .funcqc directory
tar -czf funcqc-backup-$(date +%Y%m%d).tar.gz .funcqc/

# Export lineages as JSON
funcqc lineage list --json > lineages-backup-$(date +%Y%m%d).json
```

#### Recovery Procedures
```bash
# Restore from backup
tar -xzf funcqc-backup-20240315.tar.gz

# Verify database integrity
funcqc lineage list --limit 1

# Re-import if needed
funcqc lineage import lineages-backup-20240315.json
```

---

## Schema Evolution

### Upcoming Changes

#### Version 005: Enhanced Metadata
```sql
-- Add reviewer tracking
ALTER TABLE lineages ADD COLUMN reviewer_id TEXT;
ALTER TABLE lineages ADD COLUMN review_notes TEXT;

-- Add confidence history
CREATE TABLE lineage_confidence_history (
    id SERIAL PRIMARY KEY,
    lineage_id TEXT REFERENCES lineages(id),
    old_confidence REAL,
    new_confidence REAL,
    changed_by TEXT,
    changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    reason TEXT
);
```

#### Version 006: Performance Improvements
```sql
-- Partition large tables by date
CREATE TABLE lineages_2024_q1 PARTITION OF lineages
FOR VALUES FROM ('2024-01-01') TO ('2024-04-01');

-- Add materialized views for common aggregations
CREATE MATERIALIZED VIEW lineage_stats AS
SELECT 
    kind,
    status,
    COUNT(*) as count,
    AVG(confidence) as avg_confidence
FROM lineages
GROUP BY kind, status;
```

### Migration Best Practices

#### Development Process
1. **Test Migrations**: Always test on copy of production data
2. **Backup First**: Create backup before running migrations
3. **Version Control**: Track all schema changes in git
4. **Rollback Plan**: Ensure down migrations work correctly

#### Production Deployment
```bash
# Pre-migration checklist
funcqc --version                    # Verify version
cp -r .funcqc .funcqc.backup       # Create backup
funcqc lineage list --limit 1      # Verify connectivity

# Run migration (automatic)
funcqc scan --label migration-test # Triggers migration if needed

# Post-migration verification
funcqc lineage list --status draft # Verify data intact
```

---

## Troubleshooting

### Common Issues

#### Database Corruption
```bash
# Symptoms: SQLite errors, crashes on startup
# Solution: Restore from backup
rm -rf .funcqc/database.db
tar -xzf funcqc-backup-latest.tar.gz

# Alternative: Re-initialize and re-scan
rm -rf .funcqc
funcqc init
funcqc scan --label recovery
```

#### Performance Degradation
```sql
-- Check table sizes
SELECT 
    'lineages' as table_name,
    COUNT(*) as row_count,
    pg_size_pretty(pg_total_relation_size('lineages')) as size
FROM lineages;

-- Rebuild indexes if needed
REINDEX TABLE lineages;

-- Update statistics
ANALYZE lineages;
```

#### Data Inconsistencies
```sql
-- Find and fix invalid JSON
UPDATE lineages 
SET from_ids = '[]' 
WHERE NOT json_valid(from_ids);

-- Remove orphaned references
DELETE FROM lineages 
WHERE NOT EXISTS (
    SELECT 1 FROM functions f 
    WHERE f.id = ANY(SELECT json_array_elements_text(from_ids::json))
);
```

### Diagnostic Queries

#### Health Check Summary
```sql
SELECT 
    'Total Lineages' as metric,
    COUNT(*)::text as value
FROM lineages
UNION ALL
SELECT 
    'Draft Lineages',
    COUNT(*)::text
FROM lineages WHERE status = 'draft'
UNION ALL
SELECT 
    'Average Confidence',
    ROUND(AVG(confidence), 3)::text
FROM lineages
UNION ALL
SELECT 
    'Database Size',
    pg_size_pretty(pg_database_size(current_database()))
ORDER BY metric;
```

---

## API Integration

### TypeScript Interfaces

```typescript
// Core lineage interface
interface Lineage {
  id: string;
  kind: LineageKind;
  confidence: number;
  status: LineageStatus;
  from_ids: string[];
  to_ids: string[];
  git_commit?: string;
  note?: string;
  created_at: string;
  updated_at: string;
  metadata?: LineageMetadata;
}

// Metadata structure
interface LineageMetadata {
  similarity_scores: {
    name: number;
    signature: number;
    structure: number;
    content: number;
  };
  analysis: {
    algorithm_version: string;
    analysis_time_ms: number;
    total_candidates: number;
    cross_file: boolean;
  };
  review?: {
    reviewer: string;
    review_time: string;
    confidence_override?: number;
  };
}
```

### Database Service Layer

```typescript
// Lineage repository pattern
class LineageRepository {
  constructor(private db: Database) {}

  async create(lineage: NewLineage): Promise<Lineage> {
    return await this.db
      .insertInto('lineages')
      .values({
        ...lineage,
        id: generateLineageId(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findByStatus(status: LineageStatus): Promise<Lineage[]> {
    return await this.db
      .selectFrom('lineages')
      .selectAll()
      .where('status', '=', status)
      .orderBy('created_at', 'desc')
      .execute();
  }

  async updateStatus(id: string, status: LineageStatus, note?: string): Promise<void> {
    await this.db
      .updateTable('lineages')
      .set({
        status,
        note,
        updated_at: new Date().toISOString()
      })
      .where('id', '=', id)
      .execute();
  }
}
```

---

## Future Enhancements

### Planned Features

1. **Distributed Lineage**: Support for multi-repository lineage tracking
2. **Advanced Analytics**: Machine learning for improved similarity detection
3. **Real-time Sync**: Live lineage updates during development
4. **Visual Lineage**: Graph-based lineage visualization
5. **Team Collaboration**: Shared lineage review workflows

### Schema Roadmap

- **Q2 2024**: Enhanced metadata and reviewer tracking
- **Q3 2024**: Performance optimizations and partitioning  
- **Q4 2024**: Multi-repository support and federation
- **Q1 2025**: Advanced analytics and ML integration

For implementation details and contribution guidelines, see the [Database Development Guide](./database-development.md).
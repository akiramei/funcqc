# Lineage Database Schema and Migration

## Overview

The funcqc lineage tracking system uses an embedded PostgreSQL database (PGLite) with a comprehensive schema designed for performance, data integrity, and extensibility. This document covers the complete database structure, migration processes, and maintenance procedures.

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

## Core Schema

### Lineages Table

The central table storing function lineage relationships:

```sql
CREATE TABLE lineages (
    id TEXT PRIMARY KEY,                    -- Unique lineage identifier (lin_xxxxxxxx)
    kind TEXT NOT NULL,                     -- Lineage type: rename, signature-change, split, merge, inline
    confidence REAL NOT NULL,               -- Similarity confidence (0.0-1.0)
    status TEXT DEFAULT 'draft',            -- Review status: draft, approved, rejected
    from_ids TEXT NOT NULL,                 -- JSON array of source function IDs
    to_ids TEXT NOT NULL,                   -- JSON array of target function IDs
    git_commit TEXT,                        -- Git commit hash where lineage was detected
    note TEXT,                              -- Optional human-readable note
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,  -- Creation timestamp (ISO 8601)
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,  -- Last update timestamp
    metadata TEXT                           -- JSON metadata for similarity scores and analysis details
);
```

#### Field Details

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | TEXT | Unique identifier with `lin_` prefix | `lin_a1b2c3d4` |
| `kind` | TEXT | Lineage type (see [Types](#lineage-types)) | `rename` |
| `confidence` | REAL | Similarity score 0.0-1.0 | `0.85` |
| `status` | TEXT | Review status (see [Status Values](#status-values)) | `draft` |
| `from_ids` | TEXT | JSON array of source function IDs | `["func_12345"]` |
| `to_ids` | TEXT | JSON array of target function IDs | `["func_67890"]` |
| `git_commit` | TEXT | Git commit hash | `abc123def456` |
| `note` | TEXT | Optional description | `Manual verification confirmed` |
| `created_at` | TEXT | ISO 8601 timestamp | `2024-03-15T10:30:00.000Z` |
| `updated_at` | TEXT | ISO 8601 timestamp | `2024-03-15T14:22:00.000Z` |
| `metadata` | TEXT | JSON analysis details | See [Metadata Schema](#metadata-schema) |

#### Lineage Types

| Type | Description | from_ids:to_ids | Example |
|------|-------------|-----------------|---------|
| `rename` | Function renamed, content unchanged | 1:1 | `getUserData` → `fetchUserProfile` |
| `signature-change` | Parameters or return type modified | 1:1 | `process(data)` → `process(data, options)` |
| `split` | Large function divided into smaller ones | 1:N | `handleRequest` → `validateRequest` + `processRequest` |
| `merge` | Multiple functions combined | N:1 | `validateUser` + `checkPermissions` → `authenticateUser` |
| `inline` | Function inlined into caller | 1:1 | `calculateTotal` → inlined into `processOrder` |

#### Status Values

| Status | Description | Usage |
|--------|-------------|-------|
| `draft` | Initial detection, needs review | Default for automated detection |
| `approved` | Verified correct lineage | After manual review or high confidence |
| `rejected` | Incorrect lineage, false positive | After manual review |

#### Metadata Schema

The `metadata` field contains JSON with similarity analysis details:

```json
{
  "similarity_scores": {
    "name": 0.3,           // Function name similarity
    "signature": 1.0,      // Parameter/return type similarity  
    "structure": 0.98,     // AST structure similarity
    "content": 0.97        // Function body similarity
  },
  "analysis": {
    "algorithm_version": "1.0",
    "analysis_time_ms": 145,
    "total_candidates": 12,
    "cross_file": false
  },
  "review": {
    "reviewer": "automated",
    "review_time": "2024-03-15T14:22:00.000Z",
    "confidence_override": null
  }
}
```

### Database Indexes

Optimized indexes for common query patterns:

```sql
-- Primary access patterns
CREATE INDEX idx_lineages_status ON lineages(status);
CREATE INDEX idx_lineages_kind ON lineages(kind);
CREATE INDEX idx_lineages_confidence ON lineages(confidence);
CREATE INDEX idx_lineages_created_at ON lineages(created_at);
CREATE INDEX idx_lineages_git_commit ON lineages(git_commit);

-- Composite indexes for complex queries
CREATE INDEX idx_lineages_status_kind ON lineages(status, kind);
CREATE INDEX idx_lineages_status_confidence ON lineages(status, confidence);
CREATE INDEX idx_lineages_kind_confidence ON lineages(kind, confidence);

-- JSON field indexes (PostgreSQL GIN)
CREATE INDEX idx_lineages_from_ids ON lineages USING GIN ((from_ids::jsonb));
CREATE INDEX idx_lineages_to_ids ON lineages USING GIN ((to_ids::jsonb));
CREATE INDEX idx_lineages_metadata ON lineages USING GIN ((metadata::jsonb));
```

---

## Integration with Core Schema

The lineage system integrates with funcqc's existing database schema:

### Functions Table Reference

Lineage records reference functions via the core `functions` table:

```sql
-- Core functions table (existing)
CREATE TABLE functions (
    id TEXT PRIMARY KEY,              -- Referenced by lineages.from_ids/to_ids
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    -- ... other function fields
);

-- Example lineage relationship
-- lineages.from_ids: ["func_getUserData_123"]
-- lineages.to_ids:   ["func_fetchUserProfile_456"]
```

### Snapshots Integration

Lineage detection occurs between snapshots:

```sql
-- Snapshots table (existing)
CREATE TABLE snapshots (
    id TEXT PRIMARY KEY,
    label TEXT,
    git_commit TEXT,
    created_at TEXT,
    -- ... other snapshot fields
);

-- Lineage generation process
-- 1. Compare functions between snapshot A and snapshot B
-- 2. Generate lineage records with git_commit from snapshot B
-- 3. Store lineage records referencing function IDs from both snapshots
```

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
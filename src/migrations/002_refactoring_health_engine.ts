import { Kysely, sql } from 'kysely';

/**
 * Migration 002: Refactoring Health Engine Integration
 * 
 * This migration adds the refactoring_changesets table and extends the
 * refactoring_sessions table to support health engine integration for
 * true refactoring improvement measurement.
 * 
 * Features added:
 * - refactoring_changesets table for tracking change operations
 * - Additional columns in refactoring_sessions for health baselines
 * - Trigger for auto-updating refactoring_changesets timestamps
 * 
 * Related issue: #183
 */

export async function up(db: Kysely<Record<string, unknown>>): Promise<void> {
  console.log('📋 Adding refactoring health engine integration...');

  try {
    // Step 1: Add new columns to refactoring_sessions table
    console.log('   Adding columns to refactoring_sessions...');
    await sql`
      ALTER TABLE refactoring_sessions 
      ADD COLUMN IF NOT EXISTS health_baseline JSONB DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS final_assessment JSONB DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS improvement_verified BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS total_complexity_before INTEGER,
      ADD COLUMN IF NOT EXISTS total_complexity_after INTEGER,
      ADD COLUMN IF NOT EXISTS genuine_improvement_score REAL
    `.execute(db);

    // Step 2: Create refactoring_changesets table
    console.log('   Creating refactoring_changesets table...');
    await sql`
      CREATE TABLE IF NOT EXISTS refactoring_changesets (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        operation_type TEXT NOT NULL CHECK (operation_type IN ('split', 'extract', 'merge', 'rename')),
        parent_function_id TEXT,
        child_function_ids TEXT[],
        before_snapshot_id TEXT NOT NULL,
        after_snapshot_id TEXT NOT NULL,
        health_assessment JSONB DEFAULT '{}',
        improvement_metrics JSONB DEFAULT '{}',
        is_genuine_improvement BOOLEAN,
        function_explosion_score REAL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES refactoring_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_function_id) REFERENCES functions(id) ON DELETE SET NULL,
        FOREIGN KEY (before_snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE,
        FOREIGN KEY (after_snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
      )
    `.execute(db);

    // Step 3: Create indexes for refactoring_changesets
    console.log('   Creating indexes for refactoring_changesets...');
    await sql`CREATE INDEX IF NOT EXISTS idx_changesets_session ON refactoring_changesets(session_id)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_changesets_parent ON refactoring_changesets(parent_function_id)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_changesets_operation ON refactoring_changesets(operation_type)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_changesets_genuine ON refactoring_changesets(is_genuine_improvement)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_changesets_created_at ON refactoring_changesets(created_at)`.execute(db);

    // Step 4: Add trigger for refactoring_changesets updated_at column
    console.log('   Adding trigger for refactoring_changesets...');
    await sql`
      CREATE TRIGGER IF NOT EXISTS update_refactoring_changesets_updated_at 
      BEFORE UPDATE ON refactoring_changesets
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
    `.execute(db);

    console.log('✅ Refactoring health engine integration added successfully');
    
    // Step 5: Validate the migration
    await validateMigration(db);
    
  } catch (error) {
    console.error('❌ Failed to add refactoring health engine integration:', error);
    throw error;
  }
}

export async function down(db: Kysely<Record<string, unknown>>): Promise<void> {
  console.log('🗑️  Removing refactoring health engine integration...');

  try {
    // Step 1: Drop trigger first
    await sql`DROP TRIGGER IF EXISTS update_refactoring_changesets_updated_at ON refactoring_changesets`.execute(db);
    
    // Step 2: Drop refactoring_changesets table
    await sql`DROP TABLE IF EXISTS refactoring_changesets CASCADE`.execute(db);
    
    // Step 3: Remove added columns from refactoring_sessions
    await sql`
      ALTER TABLE refactoring_sessions 
      DROP COLUMN IF EXISTS health_baseline,
      DROP COLUMN IF EXISTS final_assessment,
      DROP COLUMN IF EXISTS improvement_verified,
      DROP COLUMN IF EXISTS total_complexity_before,
      DROP COLUMN IF EXISTS total_complexity_after,
      DROP COLUMN IF EXISTS genuine_improvement_score
    `.execute(db);
    
    console.log('✅ Refactoring health engine integration removed successfully');
    
  } catch (error) {
    console.error('❌ Failed to remove refactoring health engine integration:', error);
    throw error;
  }
}

/**
 * Validate the migration by checking table existence and structure
 */
async function validateMigration(db: Kysely<Record<string, unknown>>): Promise<void> {
  console.log('🔍 Validating refactoring health engine migration...');

  // Check if refactoring_changesets table exists
  const tableExists = await sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'refactoring_changesets'
    )
  `.execute(db);
  
  const exists = (tableExists.rows[0] as Record<string, unknown>)?.['exists'];
  if (!exists) {
    throw new Error('refactoring_changesets table was not created');
  }

  // Check if required columns exist in refactoring_sessions
  const columnsExist = await sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'refactoring_sessions' 
    AND column_name IN ('health_baseline', 'final_assessment', 'improvement_verified', 'genuine_improvement_score')
  `.execute(db);

  if (columnsExist.rows.length !== 4) {
    throw new Error('Not all required columns were added to refactoring_sessions');
  }

  // Check if indexes exist
  const indexesExist = await sql`
    SELECT indexname 
    FROM pg_indexes 
    WHERE indexname IN ('idx_changesets_session', 'idx_changesets_parent', 'idx_changesets_operation')
  `.execute(db);

  if (indexesExist.rows.length < 3) {
    console.warn('⚠️  Some indexes may not have been created properly');
  }

  console.log('✅ Migration validation completed successfully');
}
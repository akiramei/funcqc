/**
 * Migration: Source File Deduplication
 * 
 * Transforms the source_files table from a snapshot-dependent design
 * to a proper N:1 relationship with content deduplication.
 * 
 * Changes:
 * 1. Creates source_contents table for deduplicated content
 * 2. Creates source_file_refs table for snapshot-specific references
 * 3. Migrates data from source_files to the new structure
 * 4. Updates functions table to reference content directly
 */

import { Kysely, Migration, sql } from 'kysely';

// Migration-specific database schema (partial)
interface MigrationDatabase {
  source_contents: {
    id: string;
    content: string;
    file_hash: string;
    file_size_bytes: number;
    line_count: number;
    language: string;
    encoding: string;
    export_count: number;
    import_count: number;
    created_at: string;
  };
  source_file_refs: {
    id: string;
    snapshot_id: string;
    file_path: string;
    content_id: string;
    file_modified_time: string | null;
    function_count: number;
    created_at: string;
  };
  source_files: {
    id: string;
    snapshot_id: string;
    file_path: string;
    file_content: string;
    file_hash: string;
    encoding: string;
    file_size_bytes: number;
    line_count: number;
    language: string;
    function_count: number;
    export_count: number;
    import_count: number;
    file_modified_time: string;
    created_at: string;
  };
  source_files_old: {
    id: string;
    snapshot_id: string;
    file_path: string;
    file_content: string;
    file_hash: string;
    encoding: string;
    file_size_bytes: number;
    line_count: number;
    language: string;
    function_count: number;
    export_count: number;
    import_count: number;
    file_modified_time: string;
    created_at: string;
  };
  functions: {
    id: string;
    source_file_id: string | null;
    source_file_ref_id: string | null;
  };
}

export const migration002SourceFileDeduplication: Migration = {
  async up(db: Kysely<MigrationDatabase>): Promise<void> {
  // Step 1: Create source_contents table
  await db.schema
    .createTable('source_contents')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('file_hash', 'text', (col) => col.notNull())
    .addColumn('file_size_bytes', 'integer', (col) => col.notNull())
    .addColumn('line_count', 'integer', (col) => col.notNull())
    .addColumn('language', 'text', (col) => col.notNull())
    .addColumn('encoding', 'text', (col) => col.defaultTo('utf-8'))
    .addColumn('export_count', 'integer', (col) => col.defaultTo(0))
    .addColumn('import_count', 'integer', (col) => col.defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  // Create indexes
  await db.schema.createIndex('idx_source_contents_file_hash')
    .on('source_contents')
    .column('file_hash')
    .execute();

  await db.schema.createIndex('idx_source_contents_language')
    .on('source_contents')
    .column('language')
    .execute();

  // Add unique constraint
  await sql`ALTER TABLE source_contents ADD CONSTRAINT unique_content_hash_size 
    UNIQUE (file_hash, file_size_bytes)`.execute(db);

  // Step 2: Create source_file_refs table
  await db.schema
    .createTable('source_file_refs')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('snapshot_id', 'text', (col) => col.notNull())
    .addColumn('file_path', 'text', (col) => col.notNull())
    .addColumn('content_id', 'text', (col) => col.notNull())
    .addColumn('file_modified_time', 'timestamptz')
    .addColumn('function_count', 'integer', (col) => col.defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  // Add foreign keys
  await sql`ALTER TABLE source_file_refs 
    ADD CONSTRAINT fk_source_file_refs_snapshot 
    FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE`.execute(db);

  await sql`ALTER TABLE source_file_refs 
    ADD CONSTRAINT fk_source_file_refs_content 
    FOREIGN KEY (content_id) REFERENCES source_contents(id) ON DELETE RESTRICT`.execute(db);

  // Add unique constraint
  await sql`ALTER TABLE source_file_refs 
    ADD CONSTRAINT unique_snapshot_path 
    UNIQUE (snapshot_id, file_path)`.execute(db);

  // Create indexes
  await db.schema.createIndex('idx_source_file_refs_snapshot_id')
    .on('source_file_refs')
    .column('snapshot_id')
    .execute();

  await db.schema.createIndex('idx_source_file_refs_file_path')
    .on('source_file_refs')
    .column('file_path')
    .execute();

  await db.schema.createIndex('idx_source_file_refs_content_id')
    .on('source_file_refs')
    .column('content_id')
    .execute();

  // Step 3: Migrate data from source_files
  // First, insert unique content into source_contents
  await sql`
    INSERT INTO source_contents (
      id, content, file_hash, file_size_bytes, line_count, 
      language, encoding, export_count, import_count, created_at
    )
    SELECT DISTINCT ON (file_hash, file_size_bytes)
      file_hash || '_' || file_size_bytes as id,
      file_content as content,
      file_hash,
      file_size_bytes,
      line_count,
      language,
      encoding,
      export_count,
      import_count,
      MIN(created_at) as created_at
    FROM source_files
    GROUP BY file_hash, file_size_bytes, file_content, line_count, 
             language, encoding, export_count, import_count
  `.execute(db);

  // Then, create references in source_file_refs
  await sql`
    INSERT INTO source_file_refs (
      id, snapshot_id, file_path, content_id, 
      file_modified_time, function_count, created_at
    )
    SELECT 
      gen_random_uuid()::text as id,
      snapshot_id,
      file_path,
      file_hash || '_' || file_size_bytes as content_id,
      file_modified_time,
      function_count,
      created_at
    FROM source_files
  `.execute(db);

  // Step 4: Add content_id to functions table
  await db.schema.alterTable('functions')
    .addColumn('content_id', 'text')
    .execute();

  // Update functions to reference content directly
  await sql`
    UPDATE functions f
    SET content_id = sf.file_hash || '_' || sf.file_size_bytes
    FROM source_files sf
    WHERE f.source_file_id = sf.id
  `.execute(db);

  // Add foreign key constraint
  await sql`ALTER TABLE functions 
    ADD CONSTRAINT fk_functions_content 
    FOREIGN KEY (content_id) REFERENCES source_contents(id) ON DELETE SET NULL`.execute(db);

  // Create index
  await db.schema.createIndex('idx_functions_content_id')
    .on('functions')
    .column('content_id')
    .execute();

    // Step 5: Rename old table (don't drop yet for safety)
    await sql`ALTER TABLE source_files RENAME TO source_files_old`.execute(db);
    
    // Drop old indexes to avoid name conflicts
    await sql`DROP INDEX IF EXISTS idx_source_files_snapshot_id`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_source_files_file_path`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_source_files_file_hash`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_source_files_language`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_source_files_snapshot_path`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_source_files_hash_size`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_source_files_function_count`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_source_files_created_at`.execute(db);
  },

  async down(db: Kysely<MigrationDatabase>): Promise<void> {
    // This is a complex migration, so we'll just restore the old table
    // and drop the new ones
    
    // Restore source_files table
    await sql`ALTER TABLE source_files_old RENAME TO source_files`.execute(db);
    
    // Recreate indexes
    await db.schema.createIndex('idx_source_files_snapshot_id')
      .on('source_files')
      .column('snapshot_id')
      .execute();
      
    await db.schema.createIndex('idx_source_files_file_path')
      .on('source_files')
      .column('file_path')
      .execute();
      
    // ... (other indexes)
    
    // Remove content_id from functions
    await sql`ALTER TABLE functions DROP CONSTRAINT IF EXISTS fk_functions_content`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_functions_content_id`.execute(db);
    await db.schema.alterTable('functions')
      .dropColumn('content_id')
      .execute();
    
    // Drop new tables
    await db.schema.dropTable('source_file_refs').execute();
    await db.schema.dropTable('source_contents').execute();
  }
};
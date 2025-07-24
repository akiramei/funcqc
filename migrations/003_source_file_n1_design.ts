import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  console.log('🚀 Starting N:1 source file design migration...');
  
  try {
    // Step 1: Create source_contents table for deduplicated content
    console.log('📦 Creating source_contents table...');
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

    // Create indexes for source_contents
    await db.schema.createIndex('idx_source_contents_file_hash')
      .on('source_contents')
      .column('file_hash')
      .execute();

    await db.schema.createIndex('idx_source_contents_language')
      .on('source_contents')
      .column('language')
      .execute();

    // Step 2: Create source_file_refs table for snapshot references
    console.log('📋 Creating source_file_refs table...');
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

    // Create indexes for source_file_refs
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

    // Step 3: Add content_id to functions table (if not exists)
    console.log('🔗 Adding content_id to functions table...');
    try {
      await db.schema.alterTable('functions')
        .addColumn('content_id', 'text')
        .execute();
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        console.log('  ➡️ content_id column already exists, skipping...');
      } else {
        throw error;
      }
    }

    // Create index on functions.content_id (if not exists)
    try {
      await db.schema.createIndex('idx_functions_content_id')
        .on('functions')
        .column('content_id')
        .execute();
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        console.log('  ➡️ content_id index already exists, skipping...');
      } else {
        throw error;
      }
    }

    // Step 4: Migrate existing data
    console.log('📊 Migrating existing data...');
    
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
        'ref_' || substr(md5(random()::text), 1, 8) as id,
        snapshot_id,
        file_path,
        file_hash || '_' || file_size_bytes as content_id,
        file_modified_time,
        function_count,
        created_at
      FROM source_files
    `.execute(db);

    // Update functions to reference content directly
    await sql`
      UPDATE functions f
      SET content_id = sf.file_hash || '_' || sf.file_size_bytes
      FROM source_files sf
      WHERE f.source_file_id = sf.id
    `.execute(db);

    // Step 5: Add foreign key constraints
    console.log('🔐 Adding foreign key constraints...');
    
    // Add foreign keys for source_file_refs
    await sql`
      ALTER TABLE source_file_refs 
      ADD CONSTRAINT fk_source_file_refs_snapshot 
      FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
    `.execute(db);

    await sql`
      ALTER TABLE source_file_refs 
      ADD CONSTRAINT fk_source_file_refs_content 
      FOREIGN KEY (content_id) REFERENCES source_contents(id) ON DELETE RESTRICT
    `.execute(db);

    // Add foreign key for functions
    await sql`
      ALTER TABLE functions 
      ADD CONSTRAINT fk_functions_content 
      FOREIGN KEY (content_id) REFERENCES source_contents(id) ON DELETE SET NULL
    `.execute(db);

    // Step 6: Add unique constraints
    await sql`
      ALTER TABLE source_contents 
      ADD CONSTRAINT unique_content_hash_size 
      UNIQUE (file_hash, file_size_bytes)
    `.execute(db);

    await sql`
      ALTER TABLE source_file_refs 
      ADD CONSTRAINT unique_snapshot_path 
      UNIQUE (snapshot_id, file_path)
    `.execute(db);

    // Step 7: Rename old table for safety
    console.log('🗃️ Backing up original source_files table...');
    await sql`ALTER TABLE source_files RENAME TO source_files_backup`.execute(db);
    
    console.log('✅ N:1 source file design migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  console.log('🔄 Rolling back N:1 source file design migration...');
  
  try {
    // Restore source_files table
    await sql`ALTER TABLE source_files_backup RENAME TO source_files`.execute(db);
    
    // Remove content_id from functions
    await sql`ALTER TABLE functions DROP CONSTRAINT IF EXISTS fk_functions_content`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_functions_content_id`.execute(db);
    await db.schema.alterTable('functions')
      .dropColumn('content_id')
      .execute();
    
    // Drop new tables
    await db.schema.dropTable('source_file_refs').execute();
    await db.schema.dropTable('source_contents').execute();
    
    console.log('✅ N:1 source file design migration rolled back successfully!');
    
  } catch (error) {
    console.error('❌ Rollback failed:', error);
    throw error;
  }
}
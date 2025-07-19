import { Kysely } from 'kysely';

export async function up(db: Kysely<Record<string, unknown>>): Promise<void> {
  // Add snapshot_id column to call_edges table for proper snapshot isolation
  await db.schema
    .alterTable('call_edges')
    .addColumn('snapshot_id', 'text', (col) => col.notNull())
    .execute();

  // Add foreign key constraint to snapshots table
  await db.schema
    .alterTable('call_edges')
    .addForeignKeyConstraint('call_edges_snapshot_id_fkey', ['snapshot_id'], 'snapshots', ['id'])
    .onDelete('cascade')
    .execute();

  // Create index for performance
  await db.schema
    .createIndex('idx_call_edges_snapshot')
    .on('call_edges')
    .column('snapshot_id')
    .execute();

  // Create composite indexes that include snapshot_id for efficient queries
  await db.schema
    .createIndex('idx_call_edges_snapshot_caller')
    .on('call_edges')
    .columns(['snapshot_id', 'caller_function_id'])
    .execute();

  await db.schema
    .createIndex('idx_call_edges_snapshot_callee')
    .on('call_edges')
    .columns(['snapshot_id', 'callee_function_id'])
    .execute();
}

export async function down(db: Kysely<Record<string, unknown>>): Promise<void> {
  // Drop indexes first
  await db.schema.dropIndex('idx_call_edges_snapshot_callee').execute();
  await db.schema.dropIndex('idx_call_edges_snapshot_caller').execute();
  await db.schema.dropIndex('idx_call_edges_snapshot').execute();

  // Drop foreign key constraint
  await db.schema
    .alterTable('call_edges')
    .dropConstraint('call_edges_snapshot_id_fkey')
    .execute();

  // Drop the snapshot_id column
  await db.schema
    .alterTable('call_edges')
    .dropColumn('snapshot_id')
    .execute();
}

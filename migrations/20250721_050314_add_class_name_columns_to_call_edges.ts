import { Kysely } from 'kysely';

export async function up(db: Kysely<Record<string, unknown>>): Promise<void> {
  // Add caller_class_name and callee_class_name columns to call_edges table
  await db.schema
    .alterTable('call_edges')
    .addColumn('caller_class_name', 'text')
    .execute();

  await db.schema
    .alterTable('call_edges')
    .addColumn('callee_class_name', 'text')
    .execute();

  // Add caller_class_name and callee_class_name columns to internal_call_edges table
  await db.schema
    .alterTable('internal_call_edges')
    .addColumn('caller_class_name', 'text')
    .execute();

  await db.schema
    .alterTable('internal_call_edges')
    .addColumn('callee_class_name', 'text')
    .execute();
}

export async function down(db: Kysely<Record<string, unknown>>): Promise<void> {
  // Drop class name columns from internal_call_edges table
  await db.schema
    .alterTable('internal_call_edges')
    .dropColumn('callee_class_name')
    .execute();

  await db.schema
    .alterTable('internal_call_edges')
    .dropColumn('caller_class_name')
    .execute();

  // Drop class name columns from call_edges table
  await db.schema
    .alterTable('call_edges')
    .dropColumn('callee_class_name')
    .execute();

  await db.schema
    .alterTable('call_edges')
    .dropColumn('caller_class_name')
    .execute();
}

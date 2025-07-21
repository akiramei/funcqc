import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  console.log('🔄 Adding class context columns to call edges tables...');
  
  // Helper function to check if column exists
  const columnExists = async (tableName: string, columnName: string): Promise<boolean> => {
    try {
      const result = await sql.raw(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = '${tableName}' AND column_name = '${columnName}'
        )
      `).execute(db);
      return !!(result.rows[0] as Record<string, unknown>)?.['exists'];
    } catch {
      return false;
    }
  };

  // Add class context columns to call_edges table if they don't exist
  if (!(await columnExists('call_edges', 'caller_class_name'))) {
    await db.schema
      .alterTable('call_edges')
      .addColumn('caller_class_name', 'text')
      .execute();
    console.log('   Added caller_class_name to call_edges');
  }

  if (!(await columnExists('call_edges', 'callee_class_name'))) {
    await db.schema
      .alterTable('call_edges')
      .addColumn('callee_class_name', 'text')
      .execute();
    console.log('   Added callee_class_name to call_edges');
  }

  // Add class context and call_type columns to internal_call_edges table if they don't exist
  if (!(await columnExists('internal_call_edges', 'caller_class_name'))) {
    await db.schema
      .alterTable('internal_call_edges')
      .addColumn('caller_class_name', 'text')
      .execute();
    console.log('   Added caller_class_name to internal_call_edges');
  }

  if (!(await columnExists('internal_call_edges', 'callee_class_name'))) {
    await db.schema
      .alterTable('internal_call_edges')
      .addColumn('callee_class_name', 'text')
      .execute();
    console.log('   Added callee_class_name to internal_call_edges');
  }

  if (!(await columnExists('internal_call_edges', 'call_type'))) {
    await db.schema
      .alterTable('internal_call_edges')
      .addColumn('call_type', 'text', (col) => col.notNull().defaultTo('direct'))
      .execute();
    console.log('   Added call_type to internal_call_edges');
  }

  console.log('✅ Class context columns migration completed');
}

export async function down(db: Kysely<any>): Promise<void> {
  // Remove class context columns from call_edges table
  await db.schema
    .alterTable('call_edges')
    .dropColumn('caller_class_name')
    .dropColumn('callee_class_name')
    .execute();

  // Remove class context and call_type columns from internal_call_edges table
  await db.schema
    .alterTable('internal_call_edges')
    .dropColumn('caller_class_name')
    .dropColumn('callee_class_name')
    .dropColumn('call_type')
    .execute();
}
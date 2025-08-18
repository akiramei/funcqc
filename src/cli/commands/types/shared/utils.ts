import { TypeDefinition } from '../../../../types';
import { escapeLike } from '../../types.types';

/**
 * Find a type definition by ID or partial ID match
 * Supports partial ID matching (e.g., first 8 characters)
 */
export async function findTypeById(
  storage: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
  idOrPrefix: string,
  snapshotId: string
): Promise<TypeDefinition | null> {
  // Support partial ID matching (e.g., first 8 characters)
  // Escape wildcards to prevent unintended pattern matching
  const escapedPrefix = escapeLike(idOrPrefix);
  const result = await storage.query(
    `SELECT * FROM type_definitions 
     WHERE snapshot_id = $1 AND id LIKE $2 || '%' ESCAPE '\\'
     ORDER BY id ASC
     LIMIT 1`,
    [snapshotId, escapedPrefix]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0] as TypeDefinition;
}
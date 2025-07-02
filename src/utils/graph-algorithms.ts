/**
 * Graph Algorithm Utilities - Independent implementations of graph algorithms
 * for similarity detection and group merging operations
 */
export class GraphAlgorithms {
  /**
   * Find connected components in a graph where nodes are group indices
   * and edges represent shared functions between groups
   */
  static findConnectedComponents<T>(
    startIndex: number,
    items: T[],
    getConnections: (index: number, items: T[]) => number[]
  ): number[] {
    const connected = new Set<number>();
    const queue = [startIndex];
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (connected.has(current)) continue;
      
      connected.add(current);
      
      // Find all items connected to current item
      const relatedIndices = getConnections(current, items);
      relatedIndices.forEach(index => {
        if (!connected.has(index)) {
          queue.push(index);
        }
      });
    }
    
    return Array.from(connected);
  }

  /**
   * Build a mapping from items to group indices
   */
  static buildItemToGroupsMapping<T>(
    items: T[],
    getItemsFromGroup: (group: T) => string[]
  ): Map<string, number[]> {
    const itemToGroups = new Map<string, number[]>();
    
    items.forEach((item, index) => {
      const itemIds = getItemsFromGroup(item);
      itemIds.forEach(itemId => {
        if (!itemToGroups.has(itemId)) {
          itemToGroups.set(itemId, []);
        }
        itemToGroups.get(itemId)!.push(index);
      });
    });
    
    return itemToGroups;
  }
}
/**
 * ClearCoordinator manages the clearing of various caches and modules
 * to avoid circular dependencies between clear methods
 */

export interface ClearHandler {
  name: string;
  handler: () => void | Promise<void>;
  dependencies?: string[];
}

export class ClearCoordinator {
  private handlers = new Map<string, ClearHandler>();
  private clearOrder: string[] = [];
  
  /**
   * Register a clear handler with optional dependencies
   */
  register(handler: ClearHandler): void {
    this.handlers.set(handler.name, handler);
    this.recalculateOrder();
  }
  
  /**
   * Unregister a clear handler
   */
  unregister(name: string): void {
    this.handlers.delete(name);
    this.recalculateOrder();
  }
  
  /**
   * Clear all registered modules in dependency order
   */
  async clearAll(): Promise<void> {
    for (const name of this.clearOrder) {
      const handler = this.handlers.get(name);
      if (handler) {
        await handler.handler();
      }
    }
  }
  
  /**
   * Clear a specific module and its dependencies
   */
  async clear(name: string, visited: Set<string> = new Set()): Promise<void> {
    if (visited.has(name)) {
      throw new Error(`Circular dependency detected involving '${name}'`);
    }

    const handler = this.handlers.get(name);
    if (!handler) {
      throw new Error(`Clear handler '${name}' not found`);
    }

    visited.add(name);

    // Clear dependencies first
    if (handler.dependencies) {
      for (const dep of handler.dependencies) {
        if (this.handlers.has(dep)) {
          await this.clear(dep, visited);
        }
      }
    }

    // Clear the module itself
    await handler.handler();
  }
  
  /**
   * Get the calculated clear order
   */
  getClearOrder(): string[] {
    return [...this.clearOrder];
  }
  
  /**
   * Recalculate the clear order based on dependencies
   */
  private recalculateOrder(): void {
    const visited = new Set<string>();
    const result: string[] = [];
    
    const visit = (name: string): void => {
      if (visited.has(name)) return;
      visited.add(name);
      
      const handler = this.handlers.get(name);
      if (!handler) return;
      
      // Visit dependencies first
      if (handler.dependencies) {
        for (const dep of handler.dependencies) {
          if (this.handlers.has(dep)) {
            visit(dep);
          }
        }
      }
      
      result.push(name);
    };
    
    // Visit all handlers
    for (const name of this.handlers.keys()) {
      visit(name);
    }
    
    this.clearOrder = result;
  }
}

// Singleton instance
let coordinatorInstance: ClearCoordinator | null = null;

/**
 * Get the singleton ClearCoordinator instance
 */
export function getClearCoordinator(): ClearCoordinator {
  if (!coordinatorInstance) {
    coordinatorInstance = new ClearCoordinator();
  }
  return coordinatorInstance;
}

/**
 * Reset the coordinator (mainly for testing)
 */
export function resetClearCoordinator(): void {
  coordinatorInstance = null;
}
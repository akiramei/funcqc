/**
 * Health command - refactored entry point
 * 
 * This file replaces the original monolithic health.ts (1815 lines)
 * with a modular architecture for better maintainability.
 */

// Re-export the main health command from the new modular structure
export { healthCommand } from './health/index';
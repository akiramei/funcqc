/**
 * Constants for the Staged Analysis Engine
 */

/**
 * Confidence scores for different resolution levels
 */
export const CONFIDENCE_SCORES = {
  // Perfect confidence - same file, definite resolution
  LOCAL_EXACT: 1.0,
  LOCAL_EXACT_OPTIONAL: 0.95,
  
  // High confidence - TypeChecker verified imports
  IMPORT_EXACT: 0.95,
  IMPORT_EXACT_OPTIONAL: 0.90,
  
  // Medium confidence - CHA analysis
  CHA_BASE: 0.8,
  CHA_ABSTRACT_BONUS: 0.1,
  CHA_CLASS_BONUS: 0.05,
  
  // High confidence - RTA analysis with instance filtering
  RTA_BASE: 0.9,
  
  // Perfect confidence - Runtime verified
  RUNTIME_CONFIRMED: 1.0,
  
  // Optional call penalties
  OPTIONAL_LOCAL_PENALTY: 0.05,  // 1.0 -> 0.95
  OPTIONAL_IMPORT_PENALTY: 0.05, // 0.95 -> 0.90
  OPTIONAL_GENERIC_PENALTY: 0.10 // 0.95 -> 0.85
} as const;

/**
 * Node.js built-in modules that should be excluded from analysis
 */
export const NODE_BUILTIN_MODULES = new Set<string>([
  'crypto', 'fs', 'path', 'os', 'util', 'http', 'https', 'url', 'querystring',
  'stream', 'buffer', 'events', 'child_process', 'cluster', 'dgram', 'dns',
  'net', 'tls', 'readline', 'repl', 'string_decoder', 'timers', 'tty',
  'vm', 'zlib', 'assert', 'constants', 'module', 'process', 'v8',
  'worker_threads', 'perf_hooks', 'async_hooks', 'inspector', 'punycode'
]);

/**
 * Resolution levels for type safety and consistency
 */
export const RESOLUTION_LEVELS = {
  LOCAL_EXACT: 'local_exact',
  IMPORT_EXACT: 'import_exact', 
  CHA_RESOLVED: 'cha_resolved',
  RTA_RESOLVED: 'rta_resolved',
  RUNTIME_CONFIRMED: 'runtime_confirmed'
} as const;

/**
 * Resolution sources for detailed tracking
 */
export const RESOLUTION_SOURCES = {
  LOCAL_EXACT: 'local_exact',
  LOCAL_EXACT_OPTIONAL: 'local_exact_optional',
  TYPECHECKER_IMPORT: 'typechecker_import',
  TYPECHECKER_IMPORT_OPTIONAL: 'typechecker_import_optional',
  CHA_ANALYSIS: 'cha_analysis',
  RTA_ANALYSIS: 'rta_analysis',
  RUNTIME_VERIFIED: 'runtime_verified'
} as const;
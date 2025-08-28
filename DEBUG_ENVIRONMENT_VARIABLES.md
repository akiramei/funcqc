# Debug Environment Variables

This document describes the debug environment variables available in funcqc for investigation and troubleshooting purposes.

## Available Debug Variables

### Core Analysis Debug Variables

#### `FUNCQC_DEBUG_PAGERANK=true`
Enables detailed logging of PageRank algorithm execution:
- Graph statistics (functions, edges)
- Algorithm configuration (damping factor, tolerance, max iterations)
- Convergence progress (every 10 iterations + first 5)
- Final convergence status
- Uniform distribution fallback decisions

**Usage:**
```bash
FUNCQC_DEBUG_PAGERANK=true npm run dev -- health --verbose
```

#### `FUNCQC_DEBUG_ENTRY_POINTS=true`
Enables detailed logging of entry point detection:
- Detection strategy used (name pattern, exported zero fan-in, command handler)
- Functions added at each priority level
- Fallback method usage
- Final count of detected entry points

**Usage:**
```bash
FUNCQC_DEBUG_ENTRY_POINTS=true npm run dev -- health --verbose
```

#### `FUNCQC_DEBUG_SCC=true`
Enables logging of Strongly Connected Components analysis:
- Analysis initiation with function/edge counts
- SCC results (total components, largest component size, recursive functions)

**Usage:**
```bash
FUNCQC_DEBUG_SCC=true npm run dev -- health --verbose
```

#### `FUNCQC_DEBUG_CALL_GRAPH=true`
Enables detailed logging of call graph construction:
- Input statistics (edges, functions)
- Edge processing results (valid edges, external edges, self-loops filtered)

**Usage:**
```bash
FUNCQC_DEBUG_CALL_GRAPH=true npm run dev -- health --verbose
```

### Database Debug Variables

#### `DEBUG_DB=true`
Enables detailed logging of database operations:
- Query execution details
- Parameter binding
- Short ID expansion in WHERE clauses
- Result row counts

⚠️ **Security Notice:**
- This logging may include sensitive data (credentials, tokens, PII). Avoid enabling in production.
- Prefer masking/redacting parameter values (e.g., show length or hash) in logs.
- Ensure logs are stored securely and rotated with appropriate retention policies.

**Usage:**
```bash
DEBUG_DB=true npm run dev -- db --table functions --where "id='a1b2c3d4'" --limit 5
```

### Feature Control Variables

#### `FUNCQC_ENABLE_LAYER_PAGERANK=true`
Forces layer-based PageRank analysis even for large projects:
- Overrides automatic size-based disabling
- Enables cross-layer architectural analysis

**Usage:**
```bash
FUNCQC_ENABLE_LAYER_PAGERANK=true npm run dev -- health --verbose
```

#### `FUNCQC_EXCLUDE_INTRA_FILE_CALLS=false`
Disables filtering of intra-file calls for PageRank analysis:
- Includes all call edges (default excludes intra-file calls)
- Useful for debugging call graph completeness

**Usage:**
```bash
FUNCQC_EXCLUDE_INTRA_FILE_CALLS=false npm run dev -- health --verbose
```

## Combined Usage

Multiple debug variables can be combined for comprehensive investigation:

```bash
FUNCQC_DEBUG_PAGERANK=true \
FUNCQC_DEBUG_ENTRY_POINTS=true \
FUNCQC_DEBUG_SCC=true \
FUNCQC_DEBUG_CALL_GRAPH=true \
npm run dev -- health --verbose
```

## Performance Impact

⚠️ **Warning**: Debug variables significantly increase output verbosity and may impact performance. Use them selectively for targeted investigation.

## Investigation Use Cases

### PageRank Issues
- Functions incorrectly getting 100% centrality
- Convergence problems
- Uniform distribution fallback behavior

### Entry Point Detection Problems  
- Missing or incorrect entry points
- Too many/too few entry points detected
- Fallback method usage

### Call Graph Construction Issues
- Missing edges
- Incorrect edge filtering
- Self-loop handling

### Database Query Problems
- Short ID resolution failures
- WHERE clause parsing issues
- Parameter binding problems
#### `FUNCQC_DEBUG_PATHS=true`
Enables diagnostics when first-pass call graph yields zero edges:
- Prints function count, file count and related hints to ease investigation

**Usage:**
```bash
FUNCQC_DEBUG_PATHS=true npm run dev -- scan --full
```

#### `FUNCQC_ENABLE_DB_FUNCTIONS_FALLBACK=1`
Enables a one-time fallback on call graph if first pass yields zero edges:
- Re-reads functions from DB and retries call graph analysis
- Disabled by default to avoid masking design issues

**Usage:**
```bash
FUNCQC_ENABLE_DB_FUNCTIONS_FALLBACK=1 npm run dev -- scan --full
```

### Performance Overrides

#### `FUNCQC_MAX_SOURCE_FILES_IN_MEMORY`
Caps number of source files kept in memory for shared project.

#### `FUNCQC_MAX_WORKERS` / `FUNCQC_MIN_WORKERS`
Upper/lower bounds for worker count.

#### `FUNCQC_FILES_PER_WORKER`
Overrides files-per-worker distribution.

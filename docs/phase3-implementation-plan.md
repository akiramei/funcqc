# Phase 3: Analysis Features Implementation Plan

## Overview
Phase 3 focuses on adding analytical capabilities on top of the call graph infrastructure established in Phases 1 and 2.

## 1. Dead Code Detection

### Objectives
- Identify functions that are never called (dead code)
- Distinguish between truly dead code and entry points
- Provide actionable insights for code cleanup

### Implementation Steps

#### 1.1 Entry Point Detection
```typescript
interface EntryPoint {
  functionId: string;
  reason: 'exported' | 'main' | 'test' | 'config' | 'callback';
}
```

Entry points include:
- Exported functions (`export function`, `export default`)
- Main entry files (index.ts, cli.ts)
- Test functions (files matching test patterns)
- Configuration callbacks
- Event handlers and callbacks

#### 1.2 Reachability Analysis
```typescript
class ReachabilityAnalyzer {
  analyzeReachability(
    allFunctions: FunctionInfo[],
    callEdges: CallEdge[],
    entryPoints: EntryPoint[]
  ): {
    reachable: Set<string>;
    unreachable: Set<string>;
  };
}
```

Algorithm:
1. Start with entry points
2. Traverse call graph using BFS/DFS
3. Mark all reachable functions
4. Remaining functions are dead code

#### 1.3 CLI Command: `funcqc dead`
```bash
funcqc dead [options]
  --exclude-tests     Exclude test files from dead code analysis
  --exclude-exports   Consider all exports as dead code
  --format json|table Format output
  --threshold <n>     Minimum function size to report
```

### 2. Dependency Analysis Metrics

#### 2.1 New Metrics
```typescript
interface DependencyMetrics {
  fanIn: number;          // Number of functions calling this function
  fanOut: number;         // Number of functions this function calls
  depthFromEntry: number; // Shortest path from any entry point
  maxCallChain: number;   // Longest call chain through this function
  isCyclic: boolean;      // Part of a circular dependency
}
```

#### 2.2 Storage Schema Update
```sql
-- Add to quality_metrics table or create new dependency_metrics table
ALTER TABLE quality_metrics ADD COLUMN fan_in INTEGER DEFAULT 0;
ALTER TABLE quality_metrics ADD COLUMN fan_out INTEGER DEFAULT 0;
ALTER TABLE quality_metrics ADD COLUMN depth_from_entry INTEGER DEFAULT -1;
ALTER TABLE quality_metrics ADD COLUMN max_call_chain INTEGER DEFAULT 0;
ALTER TABLE quality_metrics ADD COLUMN is_cyclic BOOLEAN DEFAULT FALSE;
```

#### 2.3 Integration with Existing Commands
- Extend `funcqc list` to show dependency metrics
- Add dependency metrics to `funcqc show`
- Include in quality score calculation

### 3. Circular Dependency Detection

#### 3.1 Algorithm
```typescript
class CircularDependencyDetector {
  detectCycles(callEdges: CallEdge[]): Cycle[] {
    // Tarjan's strongly connected components algorithm
    // or DFS with visited tracking
  }
}

interface Cycle {
  functions: string[];
  edges: CallEdge[];
}
```

#### 3.2 CLI Command: `funcqc cycles`
```bash
funcqc cycles [options]
  --min-size <n>   Minimum cycle size to report (default: 2)
  --format json|table|dot  Output format
```

## Implementation Priority

1. **Week 1**: Dead code detection core
   - Entry point detection
   - Reachability analysis
   - Basic CLI command

2. **Week 2**: Dependency metrics
   - Calculate fan-in/fan-out
   - Update storage schema
   - Integrate with existing commands

3. **Week 3**: Advanced features
   - Circular dependency detection
   - Call chain analysis
   - Performance optimization

## Testing Strategy

1. Unit tests for each analyzer
2. Integration tests with real codebases
3. Performance tests with large projects (10k+ functions)
4. Edge cases:
   - Recursive functions
   - Mutual recursion
   - Dynamic calls
   - External library calls

## Success Metrics

- Dead code detection accuracy > 95%
- Performance impact < 10% on scan time
- Zero false positives for exported functions
- Circular dependency detection catches all cycles

## Migration Considerations

- Database migration for new metrics
- Backward compatibility for existing data
- Optional features (can be disabled)
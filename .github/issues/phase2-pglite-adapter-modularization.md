# Phase 2: PGLiteStorageAdapter Modularization Plan

## Overview
The `pglite-adapter.ts` file has grown to 5,707 lines with 148 functions, making it difficult to maintain and test. This issue tracks the modularization effort to break it down into focused, manageable modules.

## Current Structure Analysis

### File Statistics
- **Total Lines**: 5,707
- **Total Functions**: 148
- **Cyclomatic Complexity**: Various (up to 6)
- **Dependencies**: 36 imports

### Functional Groups Identified
1. **Snapshot Operations** (~270 lines)
2. **Function Operations** (~445 lines)
3. **Quality Metrics Operations** (~218 lines)
4. **Lineage Operations** (~493 lines)
5. **Embedding Operations** (~780 lines)
6. **Refactoring Operations** (~327 lines)
7. **Call Edge Operations** (~637 lines)
8. **Source File Operations** (~260 lines)
9. **Naming Evaluation Operations** (~458 lines)
10. **Helper Methods & Core** (~1,600+ lines)

## Proposed Module Structure

```
src/storage/
├── pglite-adapter.ts              # Main adapter (facade pattern)
├── modules/
│   ├── types.ts                   # Shared types and interfaces
│   ├── database-core.ts           # Core DB operations & transactions
│   ├── snapshot-operations.ts     # Snapshot CRUD (✅ Created)
│   ├── function-operations.ts     # Function CRUD & queries
│   ├── metrics-operations.ts      # Quality metrics management
│   ├── lineage-operations.ts      # Function lineage tracking
│   ├── embedding-operations.ts    # Vector embeddings & similarity
│   ├── refactoring-operations.ts  # Refactoring session management
│   ├── call-edge-operations.ts    # Call graph operations
│   ├── source-file-operations.ts  # Source file management
│   └── naming-evaluation-ops.ts   # Naming quality operations
```

## Implementation Strategy

### Phase 2.1: Foundation (Current)
- [x] Create module directory structure
- [x] Define shared types and interfaces
- [x] Create database-core module
- [x] Create snapshot-operations module
- [ ] Set up test infrastructure for modules

### Phase 2.2: Core Operations
- [ ] Extract function-operations module
- [ ] Extract metrics-operations module
- [ ] Create integration tests
- [ ] Update main adapter to use modules

### Phase 2.3: Advanced Features
- [ ] Extract lineage-operations module
- [ ] Extract embedding-operations module
- [ ] Extract refactoring-operations module
- [ ] Maintain backward compatibility

### Phase 2.4: Final Migration
- [ ] Extract call-edge-operations module
- [ ] Extract source-file-operations module
- [ ] Extract naming-evaluation-operations module
- [ ] Remove duplicated code from main adapter
- [ ] Performance benchmarking

## Technical Considerations

### 1. Backward Compatibility
- Main `PGLiteStorageAdapter` must maintain same public API
- Use facade pattern to delegate to modules
- Gradual migration to avoid breaking changes

### 2. Transaction Management
- Centralize transaction handling in database-core
- Ensure ACID properties across module boundaries
- Handle nested transactions properly

### 3. Testing Strategy
- Unit tests for each module
- Integration tests for module interactions
- End-to-end tests for complete workflows
- Performance regression tests

### 4. Performance Optimization
- Maintain or improve current performance
- Use bulk operations where appropriate
- Optimize query patterns

## Success Criteria

1. **Code Organization**
   - Each module < 500 lines
   - Clear separation of concerns
   - No circular dependencies

2. **Maintainability**
   - Improved testability (unit test coverage > 80%)
   - Reduced cyclomatic complexity
   - Better error handling

3. **Performance**
   - No performance regression
   - Faster test execution
   - Reduced memory footprint

4. **Developer Experience**
   - Easier to understand and modify
   - Clear module boundaries
   - Comprehensive documentation

## Risks and Mitigation

1. **Risk**: Breaking existing functionality
   - **Mitigation**: Comprehensive test suite before refactoring
   - **Mitigation**: Feature flags for gradual rollout

2. **Risk**: Performance degradation
   - **Mitigation**: Benchmark before and after
   - **Mitigation**: Profile critical paths

3. **Risk**: Increased complexity
   - **Mitigation**: Clear module interfaces
   - **Mitigation**: Extensive documentation

## Timeline Estimate

- Phase 2.1: 1 day (partially complete)
- Phase 2.2: 2-3 days
- Phase 2.3: 2-3 days
- Phase 2.4: 2 days
- Testing & Documentation: 2 days

**Total**: 9-11 days

## Related Issues

- #226: Large files requiring refactoring
- #227: Semantic diff implementation (depends on refactored storage)

## Notes

This is a significant refactoring effort that requires careful planning and execution. The modularization should be done incrementally with proper testing at each step to ensure system stability.
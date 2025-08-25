# Issue: Dead Code Detection Accuracy Improvements Implementation

**Issue ID**: DCD-002  
**Severity**: High  
**Status**: In Progress  
**Created**: 2024-12-17  
**Related**: [DCD-001: Dead Code Detection Accuracy Problems](./dead-code-detection-accuracy.md)  
**Component**: Dead Code Analysis Implementation

## 🎯 Implementation Objective

Based on the comprehensive investigation in DCD-001, implement systematic improvements to dead code detection accuracy to reduce false positive rate from ~67% to <1%.

## 📋 Implementation Plan

### 🚀 Phase 1: Cross-File Call Graph Resolution (HIGH PRIORITY - REVISED)
**Goal**: Enable cross-file function call tracking to rescue functions like `QualityCalculator.calculate`  
**Target**: Reduce false positive rate from 67% to <5%  
**Estimated Effort**: 2-3 days

**Root Cause**: CallGraphAnalyzer only resolves function calls within the same file, missing all cross-file dependencies.

**Implementation Tasks**:
- [ ] Create global function registry during initial analysis phase
- [ ] Enhance CallGraphAnalyzer to accept global function map
- [ ] Implement import statement analysis for call resolution
- [ ] Add method signature matching (e.g., `object.method` pattern)
- [ ] Add regression tests for cross-file call detection
- [ ] Validate with known false positive cases

**Success Criteria**:
- `QualityCalculator.calculate` correctly linked to its callers across files
- Cross-file CallEdges have proper `calleeFunctionId` values
- False positive rate reduction demonstrated

### 🔧 Phase 2: Same-File Call Detection (MEDIUM PRIORITY)
**Goal**: Rescue internal helper functions (e.g., `findMinimumHash`)  
**Target**: Reduce false positive rate from <5% to <2%  
**Estimated Effort**: 2-3 days

**Implementation Tasks**:
- [ ] Add AST analysis for intra-file function calls
- [ ] Generate `CallEdge` data for same-file function calls
- [ ] Enhance call graph building with internal calls
- [ ] Add tests for internal function dependencies
- [ ] Validate with helper function scenarios

### 🚀 Phase 3: Module Resolution Enhancement (LOW PRIORITY)
**Goal**: Complete cross-file dependency tracking (e.g., `fileExists`)  
**Target**: Reduce false positive rate from <2% to <1%  
**Estimated Effort**: 3-4 days

**Implementation Tasks**:
- [ ] Enhance import/export analysis accuracy
- [ ] Add re-export pattern support (`export * from`)
- [ ] Implement dynamic import tracking
- [ ] Add comprehensive module resolution tests
- [ ] Performance optimization for large codebases

## 🔧 Technical Implementation Details

### Phase 1: Cross-File Call Resolution
```typescript
// Current problem - local function map only
async analyzeFileWithCallGraph(filePath: string) {
  const functions = await this.analyzeFile(filePath);
  const functionMap = new Map(); // ❌ Only current file!
  for (const func of functions) {
    functionMap.set(func.id, { /* ... */ });
  }
  callEdges = await this.callGraphAnalyzer.analyzeFile(filePath, functionMap);
}

// Proposed solution - global function registry
interface GlobalFunctionRegistry {
  // Map of functionId -> { filePath, className?, name, signature }
  functions: Map<string, FunctionRegistryEntry>;
  // Map of filePath -> imported symbols and their sources
  imports: Map<string, ImportInfo[]>;
}

// Phase 1a: Build global registry during scan
async performFullAnalysis(files: string[]) {
  const globalRegistry = await buildGlobalFunctionRegistry(files);
  // ...
}

// Phase 1b: Enhanced call resolution
private resolveCalleeFunction(
  call: DetectedCall,
  currentFilePath: string,
  globalRegistry: GlobalFunctionRegistry
): string | undefined {
  // 1. Check local file first (existing logic)
  // 2. Check imports in current file
  // 3. Use import info to find target file
  // 4. Match function in target file by name/signature
}
```

### Phase 2: Call Graph Enhancement
```typescript
// Enhanced call graph building
buildCallGraph(functions: FunctionInfo[], callEdges: CallEdge[]) {
  // 1. Process explicit call edges from TypeScript analysis
  const graph = new Map<string, Set<string>>();
  
  // 2. Add same-file internal calls
  this.addIntraFileCallEdges(functions, graph);
  
  // 3. Add test file -> source file dependencies
  this.addTestFileDependencies(functions, graph);
  
  // 4. Add import/export relationships
  this.addModuleDependencies(functions, graph);
  
  return graph;
}
```

## 📊 Success Metrics

### Accuracy Targets
| Phase | False Positive Rate | Key Improvements |
|-------|-------------------|------------------|
| Current | ~67% | Baseline from DCD-001 investigation |
| Phase 1 | <5% | Test file entry points correctly detected |
| Phase 2 | <2% | Same-file function calls tracked |
| Phase 3 | <1% | Complete module dependency tracking |

### Validation Functions
These known false positive cases must be resolved:
- `QualityCalculator.calculate` (used in 9+ test files)
- `fileExists` (used in show.ts, init.ts, etc.)
- `findMinimumHash` (used within same file)

## 🧪 Testing Strategy

### Regression Test Suite
```typescript
describe('Dead Code Detection Accuracy - DCD-002', () => {
  describe('Phase 1: Entry Point Detection', () => {
    it('should not mark test-dependent functions as dead', () => {
      const deadCode = analyzeDeadCode();
      expect(deadCode.find(f => f.name === 'calculate')).toBeUndefined();
    });
    
    it('should recognize various test file patterns', () => {
      const testFiles = [
        'src/test/unit.test.ts',
        'src/__tests__/integration.spec.js',
        'tests/e2e/workflow.test.tsx'
      ];
      testFiles.forEach(file => {
        expect(isTestFile(file)).toBe(true);
      });
    });
  });
  
  describe('Phase 2: Same-file Call Detection', () => {
    it('should not mark internally-called functions as dead', () => {
      const deadCode = analyzeDeadCode();
      expect(deadCode.find(f => f.name === 'findMinimumHash')).toBeUndefined();
    });
  });
  
  describe('Phase 3: Module Resolution', () => {
    it('should not mark imported utility functions as dead', () => {
      const deadCode = analyzeDeadCode();
      expect(deadCode.find(f => f.name === 'fileExists')).toBeUndefined();
    });
  });
});
```

### E2E Validation Workflow
```bash
# Before each phase implementation
npm run dev scan
npm run dev -- dep dead --format json > before-phase.json

# After implementation
npm run dev scan
npm run dev -- dep dead --format json > after-phase.json

# Compare false positive reduction
npm run dev -- dep dead --validate-accuracy
```

## 📈 Implementation Branches

### Branch Strategy
- **Main Branch**: `feature/dcd-002-accuracy-improvements`
- **Phase Branches**:
  - `feature/dcd-002-phase1-entry-points`
  - `feature/dcd-002-phase2-call-detection`
  - `feature/dcd-002-phase3-module-resolution`

### PR Workflow
1. Each phase completed in separate branch
2. PR created with accuracy improvement metrics
3. Regression test results included in PR
4. Code review focusing on edge cases and performance
5. Merge to main branch after validation

## 🔄 Rollback Strategy

### Safety Measures
- All changes maintain backward compatibility
- Original detection logic preserved as fallback
- Feature flags for new detection methods
- Comprehensive test coverage before merge

### Rollback Triggers
- False positive rate increases instead of decreases
- Performance degradation >20%
- Breaking changes to existing APIs
- Test suite failures

## 📚 Documentation Updates

### Files to Update
- `docs/dead-code-analysis.md` - Technical documentation
- `README.md` - Updated accuracy information
- `CHANGELOG.md` - Version history
- `docs/api-reference.md` - API changes if any

### User Communication
- Release notes highlighting accuracy improvements
- Migration guide if API changes
- Performance impact documentation
- Known limitations after improvements

## 🎯 Future Enhancements

### Configuration Options
```typescript
interface DeadCodeDetectionConfig {
  entryPointPatterns?: string[];
  testFilePatterns?: string[];
  ignorePatterns?: string[];
  accuracyMode?: 'strict' | 'balanced' | 'permissive';
  moduleResolution?: boolean;
}
```

### Advanced Features
- Custom entry point detection rules
- Confidence scoring for dead code detection
- Interactive false positive reporting
- Machine learning based pattern recognition

## 🔗 References

- **Investigation Issue**: [DCD-001](./dead-code-detection-accuracy.md)
- **Original Investigation Branch**: `feature/dead-code-cleanup-safe`
- **Technical Documentation**: `docs/architecture/dead-code-analysis.md`
- **Test Strategy**: `docs/testing/regression-testing.md`

---

**Last Updated**: 2024-12-17  
**Next Review**: After Phase 1 completion  
**Assignee**: Development Team  
**Reviewer**: Architecture Team

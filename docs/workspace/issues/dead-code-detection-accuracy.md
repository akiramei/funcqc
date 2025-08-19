# Issue: Dead Code Detection Accuracy Problems

**Issue ID**: DCD-001  
**Severity**: High  
**Status**: Identified - Needs Fix  
**Created**: 2024-12-17  
**Component**: Dead Code Analysis (`src/analyzers/entry-point-detector.ts`, `src/analyzers/reachability-analyzer.ts`)

## 🚨 Problem Summary

The dead code detection system incorrectly identifies actively used functions as dead code, leading to potential deletion of critical functions when using `funcqc clean`. This creates a false impression that the deletion tool is flawed, when the actual issue is in the detection accuracy.

## 🔍 Investigation Results

### False Positives Identified

| Function | File | Detection Result | Actual Usage | Impact |
|----------|------|------------------|--------------|--------|
| `calculate` | `src/metrics/quality-calculator.ts` | `no-callers` | Used in 9+ test files + analysis-worker.ts | **CRITICAL** |
| `fileExists` | `src/utils/file-utils.ts` | `no-callers` | Used in show.ts, init.ts, etc. | **HIGH** |
| `findMinimumHash` | `src/utils/hash-winnowing-utility.ts` | `unreachable` | Used within same file | **MEDIUM** |

### Evidence

**QualityCalculator.calculate usage**:
```bash
$ grep -r "\.calculate(" src/ test/
test/halstead-metrics.test.ts:41:    const metrics = await calculator.calculate(functionInfo);
src/workers/analysis-worker.ts:40:      func.metrics = await qualityCalculator.calculate(func);
# ... 8+ more occurrences
```

**fileExists usage**:
```bash
$ grep -r "fileExists" src/
src/cli/commands/show.ts:3:import { calculateFileHash, fileExists } from '../../utils/file-utils';
src/cli/commands/show.ts:207:  if (await fileExists(func.filePath)) {
# ... multiple more occurrences
```

## 🎯 Root Causes

### 1. ~~Entry Point Detection Issues~~ (Investigation showed this is NOT the issue)
- ~~**Test file recognition failure**: Functions called from test files are not recognized as entry points~~
- ~~**Location**: `src/analyzers/entry-point-detector.ts`~~
- ~~**Problem**: `isTestFile()` logic may be insufficient~~
- **UPDATE**: Entry point detection is working correctly. The issue is in call graph analysis.

### 2. Call Graph Analysis Problems (PRIMARY ISSUE)
- **Cross-file call detection failure**: CallGraphAnalyzer only resolves function calls within the same file
- **Design flaw**: Each file is analyzed independently with only local function map
- **Location**: `src/analyzers/call-graph-analyzer.ts` line 331-389 (createCallEdge method)
- **Evidence**: `functionMap` parameter only contains functions from current file being analyzed

### 3. Module Resolution Issues
- **No global function registry**: No mechanism to map function calls to functions in other files
- **Method name ambiguity**: `calculate` method name alone cannot identify `QualityCalculator.calculate`
- **Import tracking missing**: Import statements are not used to resolve cross-file dependencies

## 🛠️ Technical Details

### Current Detection Flow
```
1. TypeScriptAnalyzer.analyzeFileWithCallGraph() - Analyzes each file independently
   ↓
2. CallGraphAnalyzer.analyzeFile(filePath, localFunctionMap) - Only has access to current file's functions
   ↓
3. createCallEdge() - Tries to resolve callee function ID from local map only
   ↓
4. Returns CallEdges with many calleeFunctionId = undefined (cross-file calls)
   ↓
5. ReachabilityAnalyzer sees no callers for functions called from other files
```

### Problematic Code
```typescript
// In CallGraphAnalyzer.createCallEdge() - line 331-358
private createCallEdge(
  call: DetectedCall,
  functionMap: Map<string, { id: string; name: string }> // ❌ Only contains current file's functions!
): CallEdge {
  // Try to find the callee function in the same file
  let calleeFunctionId: string | undefined;
  
  for (const [id, info] of functionMap.entries()) {
    if (info.name === call.calleeName) {
      calleeFunctionId = id; // ❌ Will be undefined for cross-file calls
      break;
    }
  }
  // ...
}

// In TypeScriptAnalyzer.analyzeFileWithCallGraph() - line 1067-1075
const functionMap = new Map(); // ❌ Only includes functions from current file
for (const func of functions) {
  functionMap.set(func.id, { /* ... */ });
}
callEdges = await this.callGraphAnalyzer.analyzeFile(filePath, functionMap);
```

## 🧪 Reproduction Steps

1. Run dead code analysis:
   ```bash
   npm run dev -- dead --format json --threshold 5
   ```

2. Check for false positives:
   ```bash
   # Check QualityCalculator.calculate
   npm run --silent dev -- dead --format json | jq -r '.deadCode[] | select(.functionName == "calculate")'
   
   # Verify it's actually used
   grep -r "\.calculate(" src/ test/
   ```

3. Observe mismatch between detection and actual usage

## 🚫 Impact Assessment

### What Happens Without Fix
- **Silent function deletion**: Critical functions deleted during `funcqc clean`
- **Build failures**: TypeScript compilation errors after deletion
- **Test failures**: Missing functions break test execution
- **Developer confusion**: Tool appears unreliable

### Affected Commands
- `funcqc dead` - Reports false positives
- `funcqc clean` - Deletes active functions
- Any automation relying on dead code detection

## 🎯 Solution Requirements

### Must Fix
1. **Test file entry point detection**: Properly recognize all test patterns
2. **Same-file call analysis**: Detect internal function calls
3. **Import/export resolution**: Complete module dependency tracking

### Should Fix
1. **Dynamic import handling**: Support for dynamic imports
2. **Re-export analysis**: Handle complex export patterns
3. **Type vs value imports**: Proper distinction

### Could Fix
1. **Configuration options**: Allow custom entry point patterns
2. **Incremental analysis**: Only analyze changed files
3. **Confidence scoring**: Provide confidence levels for dead code detection

## 🔧 Suggested Implementation

### Phase 1: Entry Point Detection
```typescript
// Improve test file detection
isTestFile(filePath: string): boolean {
  const testPatterns = [
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
    /\/__tests__\//,
    /\/test\//,
    // Add more patterns
  ];
  return testPatterns.some(pattern => pattern.test(filePath));
}
```

### Phase 2: Call Graph Enhancement
```typescript
// Enhanced call graph building
buildCallGraph(functions, callEdges) {
  // 1. Process explicit call edges from TypeScript analysis
  // 2. Add same-file internal calls
  // 3. Add test file -> source file dependencies
  // 4. Add import/export relationships
}
```

### Phase 3: Validation System
```typescript
// Add validation to catch false positives
validateDeadCodeDetection(deadFunctions) {
  for (const func of deadFunctions) {
    const actualUsage = findActualUsage(func);
    if (actualUsage.length > 0) {
      console.warn(`Potential false positive: ${func.name}`);
    }
  }
}
```

## 🧪 Testing Strategy

### Validation Tests
1. **Known active functions**: Test that used functions are not marked as dead
2. **Test file dependencies**: Verify test → source dependencies are tracked
3. **Same-file calls**: Verify internal calls are detected
4. **Complex imports**: Test various import/export patterns

### Regression Tests
```typescript
describe('Dead Code Detection Accuracy', () => {
  it('should not mark QualityCalculator.calculate as dead', () => {
    const deadCode = analyzeDeadCode();
    expect(deadCode.find(f => f.name === 'calculate')).toBeUndefined();
  });
  
  it('should detect test file dependencies', () => {
    // Verify functions used in tests are not dead
  });
});
```

## 📊 Success Criteria

### Accuracy Metrics
- **False positive rate**: < 1% for production codebases
- **False negative rate**: < 5% (missing some dead code is acceptable)
- **Test coverage**: All test files properly recognized as entry points

### Performance Requirements
- **Analysis time**: < 10% increase from current implementation
- **Memory usage**: < 20% increase from current implementation

## 🚨 Workarounds

### Until Fixed
1. **Manual verification**: Always verify detected dead code manually
2. **Selective deletion**: Use `--limit` with small numbers
3. **Dry run first**: Always use `--dry-run` before actual deletion
4. **Backup strategy**: Ensure `--backup` is enabled

### Safe Usage Pattern
```bash
# Safe approach until fixed
npm run dev -- dead --format json > dead-analysis.json
# Manual review of dead-analysis.json
npm run dev -- clean --dry-run --limit 5
# Verify the 5 functions are truly dead
npm run dev -- clean --limit 5 --backup
npm run typecheck && npm test
```

## 📋 Related Issues

- **Dependency**: Call graph analysis improvements
- **Related**: TypeScript import resolution
- **Upstream**: ts-morph API limitations

## 👥 Assignment

**Priority**: High  
**Estimated Effort**: 2-3 days  
**Skills Required**: TypeScript AST analysis, Graph algorithms  
**Reviewer**: Architecture team  

## 🔗 References

- **Investigation branch**: `feature/dead-code-cleanup-safe`
- **Test files with evidence**: `test/halstead-metrics.test.ts`
- **Affected source files**: `src/analyzers/entry-point-detector.ts`, `src/analyzers/reachability-analyzer.ts`
- **Documentation**: This file serves as the primary documentation

---

**Last Updated**: 2024-12-17  
**Next Review**: After implementation  
**Status**: Ready for development
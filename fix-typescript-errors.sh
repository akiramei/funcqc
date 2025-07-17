#!/bin/bash

# Fix TypeScript errors in the risk analysis implementation

echo "Fixing TypeScript errors..."

# Fix exported vs isExported
sed -i 's/func\.exported/func.isExported/g' src/analyzers/risk-detector.ts

# Fix maxNestingDepth vs maxNestingLevel
sed -i 's/maxNestingDepth/maxNestingLevel/g' src/analyzers/risk-detector.ts src/analyzers/comprehensive-risk-scorer.ts

# Fix unused parameters by prefixing with underscore
sed -i 's/functionMap: Map<string, FunctionInfo>/_functionMap: Map<string, FunctionInfo>/g' src/analyzers/risk-detector.ts
sed -i 's/metricsMap: Map<string, DependencyMetrics>/_metricsMap: Map<string, DependencyMetrics>/g' src/analyzers/risk-detector.ts
sed -i 's/callEdgesByFunction: Map<string, CallEdge\[\]>/_callEdgesByFunction: Map<string, CallEdge[]>/g' src/analyzers/risk-detector.ts
sed -i 's/filePath, fileFunctions/_filePath, fileFunctions/g' src/analyzers/risk-detector.ts

echo "TypeScript error fixes applied."
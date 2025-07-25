# Architecture Configuration Migration Guide

## Overview

The `.funcqc-arch.yaml` configuration has been significantly enhanced based on expert feedback to implement a more robust and comprehensive architectural governance system.

## Key Changes

### 1. **From Forbid-Only to Allow-Based Rules**
- **Before**: Minimal forbid rules (3 rules) with implicit permissions
- **After**: Explicit allow rules with `strictMode: true`
- **Impact**: Much stricter architectural enforcement

### 2. **Comprehensive Layer Coverage**
- **Before**: 5 layers covering basic structure
- **After**: 9 layers covering complete codebase

#### New Layer Structure:
```yaml
cli:           # Entry points (src/cli.ts, src/cli/**)
orchestration: # Use case coordination (src/use-cases/**)
analysis:      # Analysis engines (src/analyzers/**, src/similarity/**)
domain:        # Core business logic (src/core/**, src/metrics/**, src/refactoring/**)
services:      # External integrations (src/services/**, src/workers/**)
storage:       # Data persistence (src/storage/**, src/migrations/**)
infrastructure: # Config & schemas (src/config/**, src/schemas/**, src/data/**)
utils:         # Pure utilities (src/utils/**, src/tools/**, src/visualization/**)
types:         # Type definitions (src/types/**)
```

### 3. **Clear Dependency Flow**
```
cli → orchestration → analysis/domain → services → storage → infrastructure → utils → types
```

### 4. **Strict Mode Enforcement**
- `strictMode: true` - Only explicitly allowed dependencies are permitted
- `defaultSeverity: error` - All violations are treated as errors

## Current Violations

### ❌ **ERROR: services → cli dependency**
**File**: `src/services/health-analysis-service.ts:20`
**Issue**: Services layer importing from CLI commands
```typescript
import { 
  generateEnhancedSuggestions,
  analyzeSourceCodeForSuggestions
} from '../cli/commands/health';
```

## Migration Strategy

### **Step 1: Extract Shared Logic**
Move the shared functions from CLI commands to appropriate layers:

#### **Option A: Move to Domain Layer**
```typescript
// Create: src/domain/health-analysis-logic.ts
export function generateEnhancedSuggestions(data: HealthData) { ... }
export function analyzeSourceCodeForSuggestions(code: string) { ... }
```

#### **Option B: Move to Utils Layer**
```typescript
// Create: src/utils/health-analysis-utils.ts
export function generateEnhancedSuggestions(data: HealthData) { ... }
export function analyzeSourceCodeForSuggestions(code: string) { ... }
```

### **Step 2: Update Imports**
```typescript
// In src/services/health-analysis-service.ts
import { 
  generateEnhancedSuggestions,
  analyzeSourceCodeForSuggestions
} from '../domain/health-analysis-logic'; // or '../utils/health-analysis-utils'

// In src/cli/commands/health.ts
import { 
  generateEnhancedSuggestions,
  analyzeSourceCodeForSuggestions
} from '../../domain/health-analysis-logic'; // or '../../utils/health-analysis-utils'
```

### **Step 3: Validate Architecture**
```bash
npm run dev -- dep lint
```

## Architectural Benefits

### **1. Dependency Inversion**
- Services no longer depend on CLI implementations
- Shared logic is properly abstracted
- Easier testing and maintainability

### **2. Clear Separation of Concerns**
- CLI handles user interface and command parsing
- Services handle business logic integration
- Domain/Utils contain reusable logic

### **3. Prevented Anti-Patterns**
- No circular dependencies
- No upward dependencies (lower layers depending on higher layers)
- Clear data flow through the application

## Validation Commands

### **Check Architecture Compliance**
```bash
# Full architecture lint
npm run dev -- dep lint

# View dependency statistics
npm run dev -- dep stats

# Show specific function dependencies
npm run dev -- dep show "functionName"
```

### **Expected Output After Migration**
```
🏗️  Architecture Lint Report

Total functions: 2512
Total layers: 9
Total rules: 11
Layer coverage: 100.0%

📊 Violation Summary:
  ● Error violations: 0

✅ All architecture rules are satisfied!
```

## Best Practices

### **1. Layer Assignment Guidelines**
- **CLI**: Only command parsing and user interaction
- **Orchestration**: Complex workflow coordination
- **Analysis**: Specialized algorithms and engines
- **Domain**: Core business logic and rules
- **Services**: External system integrations
- **Storage**: Data persistence operations
- **Infrastructure**: Configuration and static resources
- **Utils**: Pure, reusable utility functions
- **Types**: Type definitions only

### **2. Dependency Guidelines**
- Always import from same level or lower levels
- Never import from CLI in lower layers
- Prefer composition over inheritance
- Keep types layer completely independent

### **3. Testing Considerations**
- Mock external dependencies at service boundaries
- Test domain logic independently of CLI
- Validate architecture rules in CI/CD pipeline

## Continuous Compliance

### **Pre-commit Hook**
Add to `.husky/pre-commit`:
```bash
npm run dev -- dep lint
```

### **CI/CD Integration**
Add to GitHub Actions:
```yaml
- name: Validate Architecture
  run: npm run dev -- dep lint
```

## Troubleshooting

### **Common Issues**
1. **Unknown layer warnings**: Ensure all source directories are mapped to layers
2. **False positives**: Check for correct file path patterns in layer definitions
3. **Performance issues**: Architecture analysis runs during dependency scanning

### **Getting Help**
```bash
# View architecture configuration
cat .funcqc-arch.yaml

# Check layer assignments
npm run dev -- dep stats

# Debug specific violations
npm run dev -- dep show "violatingFunction"
```
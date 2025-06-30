# Redesign function identification and database schema for robust version management

## 🚨 Problem Statement

### Current Issues
- **Duplicate Key Errors**: `duplicate key value violates unique constraint "functions_pkey"` occurs when scanning 500+ functions
- **ID Collision Risk**: MD5-based function IDs with truncated signature hashes create collision vulnerabilities
- **Inadequate Function Tracking**: No proper version management for function changes across snapshots
- **Complex Function Identification**: Insufficient support for arrow functions, class methods, and local functions

### Root Cause Analysis
```typescript
// Current problematic ID generation
private generateFunctionId(filePath: string, name: string, signatureHash: string): string {
    const components = [filePath, name, signatureHash.substring(0, 8)]; // ⚠️ Truncation increases collision risk
    return crypto.createHash('md5').update(components.join('|')).digest('hex'); // ⚠️ MD5 is collision-prone
}
```

**Problems**:
1. **MD5 Collisions**: Cryptographically weak, prone to collisions with large datasets
2. **Hash Truncation**: `signatureHash.substring(0, 8)` reduces entropy to 32 bits (~4 billion combinations)
3. **No Logical Grouping**: Functions across versions cannot be tracked as the same logical entity
4. **Incomplete Function Coverage**: Missing support for anonymous arrows, local functions, nested methods

## 🎯 Proposed Solution

### 1. Comprehensive Function Identification System

#### Function Type Coverage
- **Regular Functions**: `function myFunc(params): ReturnType`
- **Class Methods**: `class MyClass { method(params): ReturnType }`
- **Arrow Functions**: `const handler = (params) => result` (including anonymous)
- **Local Functions**: Functions defined inside other functions
- **Nested Functions**: Multi-level function hierarchies

#### Identification Strategy
```typescript
interface FunctionContext {
  filePath: string;
  name: string;                    // Can be null for anonymous functions
  signature: string;
  contextPath: string[];           // Hierarchical context ["Class", "method"]
  modifiers: string[];             // ["static", "private", "async"]
  position: { line: number; column: number };
  functionType: 'function' | 'method' | 'arrow' | 'local';
}

function generateLogicalId(context: FunctionContext): string {
  const components = [
    context.filePath,
    ...context.contextPath,
    context.signature,
    ...context.modifiers.sort(),
    `${context.position.line}:${context.position.column}` // Final collision avoidance
  ];
  
  return sha256(components.join('|')); // SHA-256 for collision resistance
}
```

#### Context Path Examples
```typescript
// Class method
class Calculator {
  add(a: number, b: number): number { ... }
}
// contextPath: ["Calculator", "add"]
// modifiers: ["public", "instance"]

// Static method
class Utils {
  static validate(input: string): boolean { ... }
}
// contextPath: ["Utils", "validate"]
// modifiers: ["public", "static"]

// Local function
function processData(data: Data[]): Result {
  function validateItem(item: Data): boolean { ... }
}
// contextPath: ["processData", "validateItem"]
// modifiers: ["local"]

// Anonymous arrow function
const handlers = [
  (event: Event) => console.log('handler1')
];
// contextPath: ["handlers", "[0]", "<anonymous>"]
// position-based identification
```

### 2. Database Schema Redesign

#### Version Management Structure
```sql
-- Project version master
project_versions (
  version INTEGER PRIMARY KEY,              -- Auto-incrementing version number
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  git_commit TEXT,
  git_branch TEXT,
  label TEXT,                              -- User-defined label
  total_functions INTEGER,
  summary TEXT
);

-- Functions master (logical entities)
functions (
  logical_id TEXT PRIMARY KEY,             -- SHA-256 based unique identifier
  name TEXT,                               -- Can be NULL for anonymous
  display_name TEXT NOT NULL,              -- Human-readable name
  full_context_path TEXT NOT NULL,         -- Complete hierarchical path
  signature TEXT NOT NULL,
  file_path TEXT NOT NULL,
  
  -- Classification
  function_type TEXT NOT NULL,             -- "method", "function", "arrow", "local"
  modifiers TEXT[],                        -- ["static", "private", "async"]
  parent_class TEXT,                       -- For class methods
  parent_function TEXT,                    -- For local functions
  nesting_level INTEGER DEFAULT 0,         -- Nesting depth
  
  -- Position info
  start_line INTEGER NOT NULL,
  start_column INTEGER NOT NULL,
  
  -- Version tracking
  first_seen_version INTEGER NOT NULL,
  last_seen_version INTEGER NOT NULL,
  
  FOREIGN KEY (first_seen_version) REFERENCES project_versions(version),
  FOREIGN KEY (last_seen_version) REFERENCES project_versions(version)
);

-- Version details (which functions exist in each version)
version_functions (
  version INTEGER,
  logical_id TEXT,
  action TEXT CHECK (action IN ('added', 'modified', 'removed')),
  PRIMARY KEY (version, logical_id),
  FOREIGN KEY (version) REFERENCES project_versions(version),
  FOREIGN KEY (logical_id) REFERENCES functions(logical_id)
);

-- Version-specific function data
function_details (
  logical_id TEXT,
  version INTEGER,
  physical_id UUID NOT NULL,               -- UUID for this specific version
  source_code TEXT,
  ast_hash TEXT,
  file_hash TEXT,
  PRIMARY KEY (logical_id, version),
  FOREIGN KEY (logical_id) REFERENCES functions(logical_id),
  FOREIGN KEY (version) REFERENCES project_versions(version)
);

-- Version-specific metrics
quality_metrics (
  logical_id TEXT,
  version INTEGER,
  lines_of_code INTEGER NOT NULL,
  cyclomatic_complexity INTEGER NOT NULL,
  cognitive_complexity INTEGER NOT NULL,
  -- ... other metrics
  PRIMARY KEY (logical_id, version),
  FOREIGN KEY (logical_id, version) REFERENCES function_details(logical_id, version)
);

-- Persistent function descriptions
function_descriptions (
  logical_id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  created_version INTEGER NOT NULL,
  updated_version INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (logical_id) REFERENCES functions(logical_id),
  FOREIGN KEY (created_version) REFERENCES project_versions(version),
  FOREIGN KEY (updated_version) REFERENCES project_versions(version)
);
```

### 3. Data Relationship Strategy

#### Version-Specific Data (Tied to Physical ID)
- `quality_metrics`: Each function version has its own metrics
- `function_parameters`: Parameters for each specific version
- `function_details`: Version-specific source code and AST data

#### Persistent Data (Tied to Logical ID)
- `function_descriptions`: User-added descriptions persist across versions
- `function` master record: Basic function identity information

#### Query Patterns
```sql
-- Get current functions (latest version)
SELECT f.*, fd.*, qm.*
FROM functions f
JOIN function_details fd ON f.logical_id = fd.logical_id
JOIN quality_metrics qm ON fd.logical_id = qm.logical_id AND fd.version = qm.version
WHERE fd.version = (SELECT MAX(version) FROM project_versions)
AND f.logical_id IN (
  SELECT logical_id FROM version_functions 
  WHERE version = fd.version AND action != 'removed'
);

-- Get function history
SELECT v.version, v.created_at, qm.cyclomatic_complexity, vf.action
FROM project_versions v
JOIN version_functions vf ON v.version = vf.version
LEFT JOIN quality_metrics qm ON vf.logical_id = qm.logical_id AND v.version = qm.version
WHERE vf.logical_id = ?
ORDER BY v.version;
```

## 📋 Implementation Plan

### Phase 1: Core Infrastructure (Priority: Critical)
- [ ] Implement UUID-based physical IDs using `crypto.randomUUID()`
- [ ] Create SHA-256 based logical ID generation
- [ ] Design and implement new database schema
- [ ] Create version management system

### Phase 2: Function Identification (Priority: High)
- [ ] Implement context path extraction for all function types
- [ ] Add support for anonymous arrow functions
- [ ] Implement class method identification with modifiers
- [ ] Add local function detection and nesting support
- [ ] Create hierarchical display name generation

### Phase 3: Data Migration and Queries (Priority: Medium)
- [ ] Implement new data insertion logic
- [ ] Update all query methods for new schema
- [ ] Create function history tracking
- [ ] Implement current/historical function views

### Phase 4: Advanced Features (Priority: Low)
- [ ] Function change detection and diff algorithms
- [ ] Quality trend analysis across versions
- [ ] Refactoring detection (function moves/renames)
- [ ] Advanced function grouping options

## 🧪 Acceptance Criteria

### Functional Requirements
- [ ] **Zero Duplicate Key Errors**: System must handle 1000+ functions without ID collisions
- [ ] **Complete Function Coverage**: All TypeScript function types properly identified
- [ ] **Version Tracking**: Functions tracked across all versions with complete history
- [ ] **Persistent Descriptions**: User-added descriptions survive function changes
- [ ] **Performance**: No degradation in scan/query performance

### Technical Requirements
- [ ] **UUID Uniqueness**: All physical IDs are true UUIDs (crypto.randomUUID())
- [ ] **SHA-256 Logical IDs**: All logical IDs use SHA-256 for collision resistance
- [ ] **Position-based Disambiguation**: Anonymous functions distinguished by file position
- [ ] **Hierarchical Context**: All functions have proper context paths
- [ ] **Database Integrity**: All foreign key constraints properly enforced

### Test Coverage
- [ ] **Large Dataset Test**: Successfully process 1000+ function project
- [ ] **Function Type Coverage**: Tests for all function types (regular, method, arrow, local)
- [ ] **Version Management**: Tests for add/modify/remove scenarios
- [ ] **History Tracking**: Verify function change tracking across versions
- [ ] **Performance Benchmarks**: Maintain sub-second scan times for typical projects

## 🚨 Breaking Changes

This is a **breaking change** that requires:
- Complete database schema replacement
- Incompatibility with existing .funcqc databases
- New function identification algorithm
- Updated CLI commands and output formats

**Migration Strategy**: Since funcqc is pre-release, existing databases will be reset rather than migrated.

## 🔗 Related Issues

- Fixes #35 (Performance optimization)
- Addresses duplicate key constraint violations
- Enables proper function versioning and history tracking

## 📊 Success Metrics

- [ ] Zero duplicate key errors in production usage
- [ ] 100% function identification accuracy across all TypeScript patterns
- [ ] Complete function history tracking across versions
- [ ] Maintainable codebase with clear separation of concerns
- [ ] Performance parity or improvement over current implementation

---

**Priority**: High
**Effort**: Large (6-8 hours estimated)
**Impact**: Fixes critical reliability issues and enables advanced version tracking
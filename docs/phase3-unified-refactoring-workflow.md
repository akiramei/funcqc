# Phase 3: Unified Refactoring Workflow - Design Document

## 🎯 Overview

Phase 3 introduces a comprehensive refactoring workflow that integrates analysis, detection, tracking, and guidance into a unified `funcqc refactor` command suite. Building on Phase 1's Git integration and Phase 2's smart change detection, this creates a complete refactoring companion.

## 🚀 Phase 3 Goals

### Primary Objectives
- **Unified Interface**: Single command suite for all refactoring activities
- **Git Integration**: Seamless integration with Git workflows
- **Interactive Guidance**: Step-by-step refactoring assistance
- **Opportunity Discovery**: Automated refactoring opportunity identification

### Success Criteria
- **90%+ workflow coverage** for common refactoring scenarios
- **<30 seconds** for comprehensive project analysis
- **5+ refactoring types** supported with guided workflows
- **Git integration** for all tracking and history operations

## 📋 Command Architecture

### 1. `funcqc refactor analyze`
**Purpose**: Comprehensive project analysis for refactoring opportunities

```bash
# Basic project analysis
funcqc refactor analyze

# Focus on specific areas
funcqc refactor analyze --complexity-threshold 15 --size-threshold 50

# Git-based analysis
funcqc refactor analyze --since HEAD~10 --compare-with main

# Export results
funcqc refactor analyze --output refactor-plan.json --format detailed
```

**Features**:
- **Quality Hot Spots**: Identify functions most needing refactoring
- **Duplication Detection**: Find code duplication candidates
- **Complexity Analysis**: Highlight overly complex functions
- **Dependency Analysis**: Detect tight coupling and separation opportunities
- **Historical Trends**: Analyze quality degradation over time

### 2. `funcqc refactor detect`
**Purpose**: Detect specific refactoring opportunities

```bash
# Detect all opportunities
funcqc refactor detect

# Specific patterns
funcqc refactor detect --patterns extract-method,split-function,reduce-parameters

# File-specific detection
funcqc refactor detect --file "src/services/*.ts"

# Severity filtering
funcqc refactor detect --severity high --min-impact 70
```

**Detection Categories**:
- **Extract Method**: Large functions with separable logic blocks
- **Split Function**: Functions handling multiple responsibilities
- **Reduce Parameters**: Functions with excessive parameter lists
- **Extract Class**: Related functions that should be grouped
- **Inline Function**: Trivial functions that add complexity
- **Rename Function**: Functions with unclear or misleading names

### 3. `funcqc refactor track`
**Purpose**: Git-integrated refactoring tracking and lineage management

```bash
# Start tracking a refactoring session
funcqc refactor track --start --description "Extract authentication logic"

# Track specific functions
funcqc refactor track --functions "handleLogin,validateUser" --session current

# Complete session with automatic lineage
funcqc refactor track --complete --auto-lineage

# Review tracking history
funcqc refactor track --history --format timeline
```

**Tracking Features**:
- **Session Management**: Start, pause, resume, complete refactoring sessions
- **Automatic Lineage**: Detect and save function lineage automatically
- **Progress Tracking**: Monitor refactoring progress against plan
- **Git Integration**: Tag commits, create branches, merge tracking
- **Rollback Support**: Undo refactoring steps with preserved history

### 4. `funcqc refactor interactive`
**Purpose**: Guided refactoring workflow with step-by-step assistance

```bash
# Start interactive mode
funcqc refactor interactive

# Guided specific refactoring
funcqc refactor interactive --pattern extract-method --function calculateTotal

# AI-assisted mode
funcqc refactor interactive --ai-assistance --model gpt-4

# Custom workflow
funcqc refactor interactive --workflow custom-extract.yaml
```

**Interactive Features**:
- **Step-by-Step Guidance**: Walk through refactoring procedures
- **Code Suggestions**: Propose specific code changes
- **Validation**: Verify refactoring correctness at each step
- **Undo/Redo**: Safe experimentation with rollback capability
- **Learning Mode**: Educational explanations for refactoring decisions

## 🏗️ Technical Architecture

### Command Structure
```
funcqc refactor
├── analyze    # Project-wide analysis
├── detect     # Pattern-specific detection  
├── track      # Session and lineage management
└── interactive # Guided workflows
```

### Core Components

#### 1. RefactoringAnalyzer
```typescript
interface RefactoringAnalyzer {
  analyzeProject(options: AnalysisOptions): Promise<RefactoringReport>;
  detectOpportunities(patterns: RefactoringPattern[]): Promise<Opportunity[]>;
  assessImpact(opportunity: Opportunity): Promise<ImpactAssessment>;
  generatePlan(opportunities: Opportunity[]): Promise<RefactoringPlan>;
}
```

#### 2. RefactoringTracker
```typescript
interface RefactoringTracker {
  startSession(description: string): Promise<SessionId>;
  trackFunction(functionId: string, sessionId: SessionId): Promise<void>;
  completeSession(sessionId: SessionId, autoLineage: boolean): Promise<void>;
  getSessionHistory(filters: SessionFilters): Promise<Session[]>;
}
```

#### 3. InteractiveGuide
```typescript
interface InteractiveGuide {
  startWorkflow(pattern: RefactoringPattern): Promise<WorkflowSession>;
  nextStep(session: WorkflowSession): Promise<GuidanceStep>;
  validateStep(step: GuidanceStep, userAction: UserAction): Promise<ValidationResult>;
  completeWorkflow(session: WorkflowSession): Promise<CompletionResult>;
}
```

#### 4. RefactoringPatterns
```typescript
enum RefactoringPattern {
  ExtractMethod = 'extract-method',
  SplitFunction = 'split-function',
  ReduceParameters = 'reduce-parameters',
  ExtractClass = 'extract-class',
  InlineFunction = 'inline-function',
  RenameFunction = 'rename-function'
}
```

### Database Schema Extensions

> **📋 Database Schema**: Complete table definitions for refactoring workflow tables (`refactoring_sessions`, `session_functions`, `refactoring_opportunities`) are documented in [data-model.md](./data-model.md#リファクタリングワークフロー管理)

## 🔄 Workflow Integration

### Git Integration Flow

```bash
# 1. Start refactoring session
funcqc refactor track --start --description "Extract user validation"

# 2. Analyze current state
funcqc refactor analyze --baseline current

# 3. Create refactoring branch
git checkout -b refactor/extract-user-validation

# 4. Detect opportunities
funcqc refactor detect --patterns extract-method --file "src/auth/user.ts"

# 5. Interactive refactoring
funcqc refactor interactive --pattern extract-method --function validateUser

# 6. Track changes
funcqc refactor track --functions "validateUser,validateEmail,validatePhone"

# 7. Complete session
funcqc refactor track --complete --auto-lineage

# 8. Create PR with refactoring metadata
gh pr create --title "refactor: Extract user validation logic"
```

### AI-Assisted Workflow

```bash
# AI-powered opportunity detection
funcqc refactor detect --ai-assistance --model gpt-4

# AI-guided interactive refactoring
funcqc refactor interactive --ai-assistance --explain-decisions

# AI-generated refactoring plans
funcqc refactor analyze --ai-planning --output ai-refactor-plan.md
```

## 📊 Analysis Capabilities

### 1. Quality Hot Spots
- **Complexity Concentration**: Areas with high cognitive complexity
- **Change Frequency**: Files/functions changing frequently
- **Bug Correlation**: Code areas with high bug density
- **Performance Bottlenecks**: Functions with performance issues

### 2. Refactoring Impact Assessment
- **Risk Analysis**: Potential issues from refactoring
- **Benefit Quantification**: Expected quality improvements
- **Effort Estimation**: Time and complexity estimates
- **Dependency Impact**: Effects on dependent code

### 3. Pattern-Specific Detection

#### Extract Method Detection
```typescript
interface ExtractMethodOpportunity {
  function: FunctionInfo;
  extractableBlocks: CodeBlock[];
  complexityReduction: number;
  suggestedNames: string[];
  extractionDifficulty: 'easy' | 'medium' | 'hard';
}
```

#### Function Split Detection
```typescript
interface SplitFunctionOpportunity {
  function: FunctionInfo;
  responsibilities: Responsibility[];
  splitStrategies: SplitStrategy[];
  cohesionMetrics: CohesionAnalysis;
}
```

## 🎯 Interactive Workflow Examples

### Extract Method Workflow

```
📋 Extract Method: calculateOrderTotal

Step 1/5: Identify extraction candidate
  ✓ Found 15-line block handling tax calculation
  ✓ Block has clear input/output boundary
  
Step 2/5: Analyze dependencies
  ✓ Uses 3 local variables: subtotal, taxRate, location
  ✓ Returns single value: taxAmount
  
Step 3/5: Suggest extraction
  📝 Proposed function: calculateTax(subtotal, taxRate, location)
  📍 Insert location: After line 45
  
Step 4/5: Preview changes
  [Show diff with extracted function]
  
Step 5/5: Execute extraction
  ✅ Function extracted successfully
  ✅ Original function updated
  ✅ Tests still passing
```

### Split Function Workflow

```
📋 Split Function: processUserRegistration

Analysis: Function handles 3 distinct responsibilities
  1. Input validation (lines 10-25)
  2. Database operations (lines 26-45) 
  3. Email notification (lines 46-60)

Suggested split:
  → validateRegistrationInput()
  → saveUserToDatabase()  
  → sendWelcomeEmail()

Proceed with split? [y/N]
```

## 🔧 Configuration

### Refactoring Thresholds
```json
{
  "refactoring": {
    "thresholds": {
      "extractMethodLines": 15,
      "extractMethodComplexity": 8,
      "splitFunctionResponsibilities": 3,
      "maxParameters": 4,
      "maxFunctionLength": 50
    },
    "patterns": {
      "extractMethod": { "enabled": true, "aggressiveness": "medium" },
      "splitFunction": { "enabled": true, "aggressiveness": "conservative" },
      "reduceParameters": { "enabled": true, "aggressiveness": "high" }
    },
    "ai": {
      "enabled": false,
      "model": "gpt-4",
      "explainDecisions": true
    }
  }
}
```

### Session Configuration
```json
{
  "sessions": {
    "autoSave": true,
    "autoLineage": true,
    "gitIntegration": true,
    "trackingInterval": 300,
    "maxConcurrentSessions": 1
  }
}
```

## 📈 Performance Considerations

### Analysis Performance
- **Incremental Analysis**: Only analyze changed functions
- **Caching Strategy**: Cache analysis results with invalidation
- **Parallel Processing**: Analyze multiple files concurrently
- **Early Termination**: Skip analysis if no opportunities found

### Interactive Performance
- **Response Time**: <200ms for interactive steps
- **Preview Generation**: <500ms for code previews
- **Validation Speed**: <100ms for step validation
- **Undo Performance**: <50ms for rollback operations

## 🧪 Testing Strategy

### Unit Testing
- **Pattern Detection**: Test each refactoring pattern separately
- **Interactive Steps**: Mock user interactions for workflow testing
- **Git Integration**: Test branch creation, tracking, and merging
- **Configuration**: Test all configuration combinations

### Integration Testing
- **End-to-End Workflows**: Complete refactoring sessions
- **Git Scenarios**: Multiple branch strategies
- **Large Projects**: Performance testing with real codebases
- **Error Recovery**: Testing failure and recovery scenarios

### Acceptance Testing
- **Real Refactoring**: Use on actual funcqc codebase
- **User Scenarios**: Test common developer workflows
- **Quality Validation**: Ensure refactoring improves quality metrics
- **Performance Benchmarks**: Meet response time requirements

## 🗺️ Implementation Roadmap

### Week 1: Foundation
- [ ] Design and implement core interfaces
- [ ] Create `RefactoringAnalyzer` with basic analysis
- [ ] Add database schema for sessions and opportunities
- [ ] Implement `funcqc refactor analyze` command

### Week 2: Detection & Tracking
- [ ] Implement pattern-specific detectors
- [ ] Create `RefactoringTracker` with Git integration
- [ ] Add `funcqc refactor detect` and `funcqc refactor track` commands
- [ ] Build session management system

### Week 3: Interactive & Polish
- [ ] Implement `InteractiveGuide` with step-by-step workflows
- [ ] Add `funcqc refactor interactive` command
- [ ] Create comprehensive test suite
- [ ] Performance optimization and documentation

## 🚀 Success Metrics

### Functionality
- ✅ **90%+ workflow coverage** for refactoring scenarios
- ✅ **5+ refactoring patterns** with guided workflows
- ✅ **Complete Git integration** for tracking
- ✅ **Interactive guidance** with step validation

### Performance
- ✅ **<30 seconds** for project analysis
- ✅ **<200ms** for interactive responses
- ✅ **<500ms** for code previews
- ✅ **<100ms** for validation steps

### Quality
- ✅ **100% test coverage** for new components
- ✅ **Zero High Risk functions** added
- ✅ **Maintain A grade** project quality
- ✅ **Comprehensive documentation**

## 🔗 Integration Points

### Phase 1 Integration
- **Git Snapshots**: Use auto-snapshot for baseline tracking
- **Git References**: Support all Phase 1 git reference formats
- **Worktree Safety**: Use Phase 1's safe parallel analysis

### Phase 2 Integration
- **Change Detection**: Use smart detection for tracking
- **Pattern Recognition**: Extend Phase 2 patterns
- **Configuration**: Build on Phase 2 config system

### Future Phases
- **Phase 4 Polish**: Enhanced UX and smart defaults
- **AI Integration**: LLM-powered assistance
- **Visualization**: Graphical refactoring workflows

This comprehensive Phase 3 implementation will transform funcqc into a complete refactoring platform, providing developers with intelligent guidance and automation for improving code quality.
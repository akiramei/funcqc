# Similar Code Detection

funcqc provides advanced AST-based similar code detection to help identify duplicate or near-duplicate functions in your codebase. This feature exports objective similarity data that can be used by external tools for visualization and refactoring suggestions.

## 🚀 Version 2.0 Improvements

Based on expert review feedback, version 2.0 includes significant enhancements:

- **True AST Canonicalization**: Replaced text-based normalization with proper AST parsing and canonicalization using ts-morph
- **Configurable Similarity Weights**: Customizable weights for different similarity factors (AST structure, signature, metrics, etc.)
- **Enhanced JSON Output**: Structured line ranges, priority scoring, and refactoring impact assessment
- **JSON Lines Format**: Efficient streaming format for large datasets
- **Improved Accuracy**: Better detection of structurally similar code regardless of variable names or formatting

## Quick Start

```bash
# Detect similar functions with default settings (80% similarity threshold)
funcqc similar

# Output as JSON for external tool integration
funcqc similar --json > similarity.json

# Use JSON Lines format for large datasets (streaming-friendly)
funcqc similar --jsonl > similarity.jsonl

# Adjust similarity threshold (0-1 scale)
funcqc similar --threshold 0.9

# Limit analysis to functions with at least 10 lines
funcqc similar --min-lines 10

# Get priority-sorted results with refactoring impact assessment
funcqc similar --json | jq '.groups | sort_by(-.priority)'
```

## Command Options

- `--threshold <value>` - Similarity threshold (0-1), default: 0.8
- `--json` - Output results as JSON
- `--jsonl` - Output as JSON Lines (streaming format for large datasets)
- `--snapshot <id>` - Analyze specific snapshot (default: latest)
- `--min-lines <num>` - Minimum lines of code to consider, default: 5
- `--no-cross-file` - Only detect similarities within same file
- `--detectors <list>` - Comma-separated list of detectors to use
- `--consensus <strategy>` - Consensus strategy for multiple detectors
- `--output <file>` - Save JSON output to file
- `--limit <num>` - Limit number of results displayed

## Similarity Detection Algorithm

The AST-based detector analyzes functions using multiple factors:

1. **AST Structure (40% weight)** - Normalized code structure comparison
2. **Function Signature (20% weight)** - Parameter count, async/generator status
3. **Metrics Similarity (20% weight)** - Complexity, lines of code, nesting
4. **Parameters (10% weight)** - Parameter types and patterns
5. **Return Type (10% weight)** - Return type similarity

## JSON Output Format

The JSON output is designed for easy integration with external tools:

```json
{
  "version": "2.0",
  "timestamp": "2024-01-01T12:00:00Z",
  "totalGroups": 3,
  "groups": [
    {
      "type": "structural",
      "similarity": 0.92,
      "detector": "ast-structural",
      "priority": 27.6,
      "refactoringImpact": "medium",
      "functions": [
        {
          "id": "abc123...",
          "name": "processUserData",
          "file": "src/users/processor.ts",
          "lines": {
            "start": 15,
            "end": 45
          },
          "metrics": {
            "cyclomaticComplexity": 5,
            "linesOfCode": 30
          }
        },
        {
          "id": "def456...",
          "name": "handleUserInfo",
          "file": "src/handlers/user.ts",
          "lines": {
            "start": 22,
            "end": 52
          },
          "metrics": {
            "cyclomaticComplexity": 6,
            "linesOfCode": 31
          }
        }
      ],
      "metadata": {
        "astHashMatch": false,
        "signatureHashMatch": false,
        "complexityDiff": 1,
        "linesDiff": 1
      }
    }
  ]
}
```

## Integration Examples

### 1. Visualization with External Tools

```bash
# Generate similarity data
funcqc similar --json --threshold 0.8 > similarity.json

# Use with a visualization tool (example)
similarity-graph similarity.json --output similarity-graph.html

# Or pipe directly
funcqc similar --json | jq '.groups[]' | similarity-visualizer
```

### 2. AI-Powered Refactoring Suggestions

```bash
# Export similarity data for AI analysis
funcqc similar --json --min-lines 20 > duplicates.json

# Use with AI refactoring assistant (example)
ai-refactor-assistant analyze duplicates.json --suggest-refactoring

# Or integrate with your LLM tool
funcqc similar --json | llm-refactor "Suggest refactoring for these duplicates"
```

### 3. CI/CD Integration

```yaml
# GitHub Actions example
- name: Detect code duplication
  run: |
    funcqc scan
    funcqc similar --json --threshold 0.85 > similarity-report.json
    
- name: Check duplication threshold
  run: |
    DUPLICATE_COUNT=$(jq '.totalGroups' similarity-report.json)
    if [ $DUPLICATE_COUNT -gt 10 ]; then
      echo "Too many duplicate functions detected: $DUPLICATE_COUNT"
      exit 1
    fi
```

### 4. Custom Analysis Scripts

```javascript
// analyze-duplicates.js
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('similarity.json'));

// Find high-complexity duplicates
const highComplexityDuplicates = data.groups.filter(group => {
  return group.functions.some(f => 
    f.metrics.cyclomaticComplexity > 10
  );
});

console.log(`Found ${highComplexityDuplicates.length} high-complexity duplicate groups`);

// Generate refactoring priorities
highComplexityDuplicates.forEach(group => {
  const totalComplexity = group.functions.reduce(
    (sum, f) => sum + f.metrics.cyclomaticComplexity, 0
  );
  console.log(`Priority: ${totalComplexity} - Files: ${
    group.functions.map(f => f.file).join(', ')
  }`);
});
```

### 5. Integration with Code Review Tools

```bash
# Generate PR-specific similarity report
funcqc similar --json --snapshot latest > current-similarity.json
funcqc similar --json --snapshot main > main-similarity.json

# Compare for new duplications
diff-similarity main-similarity.json current-similarity.json \
  --format markdown > similarity-changes.md

# Post to PR comment
gh pr comment --body-file similarity-changes.md
```

## Consensus Strategies

When using multiple similarity detectors (future feature), you can apply consensus strategies:

- `majority[:threshold]` - Require detection by majority of detectors
- `intersection` - Only report similarities found by all detectors
- `union` - Report all similarities from any detector
- `weighted:detector1=0.7,detector2=0.3` - Weighted averaging

Example:
```bash
funcqc similar --detectors ast,semantic --consensus majority:0.6
```

## Best Practices

1. **Start with default threshold** - 0.8 (80%) is a good starting point
2. **Filter small functions** - Use `--min-lines` to focus on significant duplicates
3. **Regular monitoring** - Run similarity detection as part of CI/CD
4. **Focus on high-complexity duplicates** - These provide the most refactoring value
5. **Use JSON output** - Enables powerful external tool integration

## Ecosystem Tools

The JSON output format is designed to work with various external tools:

- **Visualization**: D3.js-based graph visualizers, code relationship mappers
- **Analysis**: AI-powered refactoring tools, code quality dashboards
- **Automation**: CI/CD duplicate detection, automated refactoring bots
- **Reporting**: Code quality reports, technical debt tracking

## Performance Considerations

- Analysis time scales with O(n²) for n functions
- Use `--snapshot` to analyze specific versions
- For large codebases (>1000 functions), expect 1-2 minutes
- Memory usage is proportional to codebase size

## Future Enhancements

- Additional similarity detectors (semantic, behavioral)
- Machine learning-based similarity detection
- Cross-language similarity detection
- Real-time similarity detection in IDEs
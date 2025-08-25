# DOT Format Visualization

funcqc now supports DOT format output for visualizing code structure and analysis results. The DOT format can be used with GraphViz tools to generate visual graphs.

## Supported Commands

### 1. Dependency Analysis Visualization

```bash
# Generate dependency graph in DOT format
funcqc dep stats --format dot > dependency-graph.dot

# Visualize with GraphViz
dot -Tpng dependency-graph.dot -o dependency-graph.png
```

Options:
- `--show-hubs`: Include hub functions (high fan-in)
- `--show-utility`: Include utility functions (high fan-out)
- `--show-isolated`: Include isolated functions
- `--limit <num>`: Limit number of functions displayed

### 2. Cycle Analysis Visualization

```bash
# 重要な循環依存の可視化（DOT）
funcqc dep cycles --format dot > cycles.dot

# レイヤーを跨ぐ重要な循環のみ
funcqc dep cycles --format dot --cross-layer-only > cross-layer-cycles.dot

# 複雑度の高い循環のみ
funcqc dep cycles --format dot --min-complexity 6 > complex-cycles.dot
```

Options:
- `--min-complexity <num>`: 循環の複雑度（関数数）の下限
- `--cross-layer-only`: レイヤー跨ぎの循環のみ表示
- `--cross-module-only`: モジュール跨ぎの循環のみ表示
- `--include-all`: 旧互換（再帰や明確チェーンも含む）

### 3. Dead Code Visualization

```bash
# Generate dead code graph in DOT format
funcqc dep dead --format dot > dead-code.dot

# Exclude test functions
funcqc dep dead --exclude-tests --format dot > dead-code-no-tests.dot
```

Options:
- `--exclude-tests`: Exclude test functions from analysis
- `--exclude-exports`: Exclude exported functions from entry points
- `--exclude-small`: Exclude small functions from results
- `--threshold <num>`: Minimum function size to report

## Graph Features

### Node Coloring
- **Dependency graphs**: Color based on fan-in/fan-out metrics
  - Orange: Hub functions (high fan-in)
  - Light green: Utility functions (high fan-out)
  - Light gray: Isolated functions
- **Risk graphs**: Color based on risk level
  - Red: Critical risk
  - Orange: High risk
  - Yellow: Medium risk
  - Light green: Low risk
- **Dead code graphs**: 
  - Light coral: Dead/unreachable code
  - Light blue: Live code

### Clustering
Nodes are automatically grouped by:
- File path (default for most graphs)
- Risk level (for risk analysis)
- Live vs. dead code (for dead code analysis)

### Tooltips
Hover information includes:
- Function metrics (fan-in, fan-out, complexity)
- Risk scores and patterns
- Call relationships

## Visualization Tools

The generated DOT files can be visualized using:

1. **GraphViz** (command line):
   ```bash
   dot -Tpng graph.dot -o graph.png
   dot -Tsvg graph.dot -o graph.svg
   ```

2. **Online viewers**:
   - [GraphViz Online](https://dreampuf.github.io/GraphvizOnline/)
   - [Edotor](https://edotor.net/)

3. **VS Code extensions**:
   - GraphViz Preview
   - Graphviz Interactive Preview

## Example Workflow

```bash
# 1. Generate comprehensive dependency analysis
funcqc dep stats --format dot --show-hubs --show-utility > deps.dot

# 2. Identify critical cycles
funcqc dep cycles --format dot --cross-layer-only --limit 20 > high-impact-cycles.dot

# 3. Find dead code
funcqc dep dead --format dot --exclude-tests > dead-code.dot

# 4. Convert all to PNG
for f in *.dot; do dot -Tpng "$f" -o "${f%.dot}.png"; done
```

## Integration with CI/CD

The DOT format output can be integrated into CI/CD pipelines for automatic visualization generation:

```yaml
# GitHub Actions example
- name: Generate visualizations
  run: |
    funcqc dep stats --format dot > artifacts/dependencies.dot
    funcqc dep cycles --format dot --cross-layer-only > artifacts/high-impact-cycles.dot
    funcqc dep dead --format dot > artifacts/dead-code.dot
    
- name: Convert to images
  run: |
    sudo apt-get install -y graphviz
    for f in artifacts/*.dot; do
      dot -Tpng "$f" -o "${f%.dot}.png"
    done
    
- name: Upload artifacts
  uses: actions/upload-artifact@v3
  with:
    name: code-visualizations
    path: artifacts/*.png
```

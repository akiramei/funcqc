import { FunctionInfo, SimilarityDetector, SimilarityOptions, SimilarityResult, SimilarFunction, SimilarityWeights } from '../types';
import { ASTCanonicalizer, calculateASTSimilarity } from './ast-canonicalizer';
import { Project } from 'ts-morph';

export class ASTSimilarityDetector implements SimilarityDetector {
  name = 'ast-structural';
  version = '2.0.0'; // Updated for AST canonicalization
  supportedLanguages = ['typescript', 'javascript'];
  
  private canonicalizer = new ASTCanonicalizer();
  private project: Project;
  private weights: Required<SimilarityWeights>;

  constructor(weights?: SimilarityWeights) {
    // Set default weights, allow override
    this.weights = {
      astStructure: weights?.astStructure ?? 0.4,
      signature: weights?.signature ?? 0.2,
      metrics: weights?.metrics ?? 0.2,
      parameters: weights?.parameters ?? 0.1,
      returnType: weights?.returnType ?? 0.1
    };
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      skipLoadingLibFiles: true,
      compilerOptions: {
        isolatedModules: true,
        skipLibCheck: true,
        noResolve: true,
        noLib: true,
        target: 99, // ESNext
        jsx: 4 // Preserve
      }
    });
  }

  async detect(functions: FunctionInfo[], options: SimilarityOptions = {}): Promise<SimilarityResult[]> {
    const threshold = options.threshold || 0.8;
    const minLines = options.minLines || 5;
    const crossFile = options.crossFile !== false;

    const results: SimilarityResult[] = [];
    const processedPairs = new Set<string>();

    for (let i = 0; i < functions.length; i++) {
      for (let j = i + 1; j < functions.length; j++) {
        const func1 = functions[i];
        const func2 = functions[j];

        // Skip if functions are too small
        if (func1.metrics && func1.metrics.linesOfCode < minLines) continue;
        if (func2.metrics && func2.metrics.linesOfCode < minLines) continue;

        // Skip cross-file comparisons if disabled
        if (!crossFile && func1.filePath !== func2.filePath) continue;

        // Skip if already processed
        const pairKey = this.getPairKey(func1.id, func2.id);
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);

        const similarity = this.calculateSimilarity(func1, func2);
        
        if (similarity >= threshold) {
          results.push({
            type: 'structural',
            similarity,
            functions: [
              this.createSimilarFunction(func1),
              this.createSimilarFunction(func2)
            ],
            detector: this.name,
            metadata: {
              astHashMatch: func1.astHash === func2.astHash,
              signatureHashMatch: func1.signatureHash === func2.signatureHash,
              complexityDiff: Math.abs((func1.metrics?.cyclomaticComplexity || 0) - (func2.metrics?.cyclomaticComplexity || 0)),
              linesDiff: Math.abs((func1.metrics?.linesOfCode || 0) - (func2.metrics?.linesOfCode || 0))
            }
          });
        }
      }
    }

    // Group similar functions together
    return this.groupSimilarFunctions(results);
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  private calculateSimilarity(func1: FunctionInfo, func2: FunctionInfo): number {
    // Quick exact match check
    if (func1.astHash === func2.astHash) {
      return 1.0;
    }

    // Calculate structural similarity based on multiple factors
    const factors: Array<{ weight: number; score: number }> = [];

    // AST structure similarity (using true AST canonicalization)
    if (func1.sourceCode && func2.sourceCode) {
      const astScore = this.calculateASTStructureSimilarity(func1.sourceCode, func2.sourceCode);
      factors.push({ weight: this.weights.astStructure, score: astScore });
    }

    // Signature similarity
    const signatureScore = this.calculateSignatureSimilarity(func1, func2);
    factors.push({ weight: this.weights.signature, score: signatureScore });

    // Metrics similarity
    if (func1.metrics && func2.metrics) {
      const metricsScore = this.calculateMetricsSimilarity(func1.metrics, func2.metrics);
      factors.push({ weight: this.weights.metrics, score: metricsScore });
    }

    // Parameter similarity
    const paramScore = this.calculateParameterSimilarity(func1.parameters, func2.parameters);
    factors.push({ weight: this.weights.parameters, score: paramScore });

    // Return type similarity
    const returnScore = this.calculateReturnTypeSimilarity(func1.returnType, func2.returnType);
    factors.push({ weight: this.weights.returnType, score: returnScore });

    // Calculate weighted average
    const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
    const weightedSum = factors.reduce((sum, f) => sum + f.weight * f.score, 0);
    
    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  private calculateASTStructureSimilarity(code1: string, code2: string): number {
    try {
      // Create temporary source files for AST parsing
      const sourceFile1 = this.project.createSourceFile('temp1.ts', code1, { overwrite: true });
      const sourceFile2 = this.project.createSourceFile('temp2.ts', code2, { overwrite: true });

      // Canonicalize both code snippets using true AST analysis
      const canonical1 = this.canonicalizer.canonicalizeSourceCode(code1, sourceFile1);
      const canonical2 = this.canonicalizer.canonicalizeSourceCode(code2, sourceFile2);

      // Clean up temporary files
      this.project.removeSourceFile(sourceFile1);
      this.project.removeSourceFile(sourceFile2);

      // Calculate similarity using canonicalized AST representations
      return calculateASTSimilarity(canonical1, canonical2);
    } catch {
      // Fallback to text-based comparison if AST parsing fails
      return this.calculateTextBasedSimilarity(code1, code2);
    }
  }

  private calculateTextBasedSimilarity(code1: string, code2: string): number {
    // Fallback: Use the original text-based normalization
    const normalized1 = this.normalizeCode(code1);
    const normalized2 = this.normalizeCode(code2);

    const distance = this.levenshteinDistance(normalized1, normalized2);
    const maxLength = Math.max(normalized1.length, normalized2.length);
    
    return maxLength > 0 ? 1 - (distance / maxLength) : 0;
  }

  private normalizeCode(code: string): string {
    return code
      // Remove comments
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Remove string contents but keep quotes
      .replace(/"[^"]*"/g, '""')
      .replace(/'[^']*'/g, "''")
      .replace(/`[^`]*`/g, '``')
      // Normalize variable names to generic placeholders
      .replace(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g, (match) => {
        // Keep keywords and common types
        const keywords = ['function', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 
                         'return', 'async', 'await', 'class', 'extends', 'implements',
                         'string', 'number', 'boolean', 'void', 'any', 'unknown'];
        return keywords.includes(match) ? match : 'VAR';
      })
      .trim();
  }

  private calculateSignatureSimilarity(func1: FunctionInfo, func2: FunctionInfo): number {
    // Compare function attributes
    let score = 0;
    let factors = 0;

    if (func1.isAsync === func2.isAsync) { score += 1; }
    factors++;

    if (func1.isGenerator === func2.isGenerator) { score += 1; }
    factors++;

    if (func1.isArrowFunction === func2.isArrowFunction) { score += 1; }
    factors++;

    if (func1.parameters.length === func2.parameters.length) { score += 1; }
    factors++;

    return factors > 0 ? score / factors : 0;
  }

  private calculateMetricsSimilarity(metrics1: any, metrics2: any): number {
    const metricKeys = [
      'cyclomaticComplexity',
      'cognitiveComplexity',
      'linesOfCode',
      'maxNestingLevel',
      'branchCount',
      'loopCount'
    ];

    let totalDiff = 0;
    let count = 0;

    for (const key of metricKeys) {
      if (key in metrics1 && key in metrics2) {
        const val1 = metrics1[key];
        const val2 = metrics2[key];
        const maxVal = Math.max(val1, val2);
        
        if (maxVal > 0) {
          const diff = Math.abs(val1 - val2) / maxVal;
          totalDiff += 1 - diff;
          count++;
        }
      }
    }

    return count > 0 ? totalDiff / count : 0;
  }

  private calculateParameterSimilarity(params1: any[], params2: any[]): number {
    if (params1.length !== params2.length) {
      const maxLen = Math.max(params1.length, params2.length);
      return maxLen > 0 ? 1 - Math.abs(params1.length - params2.length) / maxLen : 1;
    }

    let matches = 0;
    for (let i = 0; i < params1.length; i++) {
      if (params1[i].typeSimple === params2[i].typeSimple) {
        matches++;
      }
    }

    return params1.length > 0 ? matches / params1.length : 1;
  }

  private calculateReturnTypeSimilarity(ret1: any, ret2: any): number {
    if (!ret1 && !ret2) return 1;
    if (!ret1 || !ret2) return 0;
    
    return ret1.typeSimple === ret2.typeSimple ? 1 : 0;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,
            dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + 1
          );
        }
      }
    }

    return dp[m][n];
  }

  private getPairKey(id1: string, id2: string): string {
    return [id1, id2].sort().join('|');
  }

  private createSimilarFunction(func: FunctionInfo): SimilarFunction {
    return {
      functionId: func.id,
      functionName: func.displayName,
      filePath: func.filePath,
      startLine: func.startLine,
      endLine: func.endLine,
      originalFunction: func
    };
  }

  private groupSimilarFunctions(results: SimilarityResult[]): SimilarityResult[] {
    // Create groups of similar functions
    const groups: Map<string, Set<string>> = new Map();
    const functionGroups: Map<string, SimilarFunction> = new Map();

    // Build adjacency list
    for (const result of results) {
      const [func1, func2] = result.functions;
      
      if (!groups.has(func1.functionId)) {
        groups.set(func1.functionId, new Set());
      }
      if (!groups.has(func2.functionId)) {
        groups.set(func2.functionId, new Set());
      }
      
      groups.get(func1.functionId)!.add(func2.functionId);
      groups.get(func2.functionId)!.add(func1.functionId);

      // Store function details
      functionGroups.set(func1.functionId, func1);
      functionGroups.set(func2.functionId, func2);
    }

    // Find connected components
    const visited = new Set<string>();
    const groupedResults: SimilarityResult[] = [];

    for (const [funcId] of groups) {
      if (visited.has(funcId)) continue;

      const component = new Set<string>();
      const queue = [funcId];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;

        visited.add(current);
        component.add(current);

        for (const neighbor of groups.get(current) || []) {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
        }
      }

      if (component.size > 1) {
        const functions = Array.from(component)
          .map(id => functionGroups.get(id)!)
          .filter(f => f !== undefined);

        // Calculate average similarity for the group
        let totalSimilarity = 0;
        let count = 0;

        for (const result of results) {
          const ids = result.functions.map(f => f.functionId);
          if (ids.every(id => component.has(id))) {
            totalSimilarity += result.similarity;
            count++;
          }
        }

        // Find the first result to preserve its metadata
        const firstResult = results.find(result => {
          const ids = result.functions.map(f => f.functionId);
          return ids.every(id => component.has(id));
        });

        groupedResults.push({
          type: 'structural',
          similarity: count > 0 ? totalSimilarity / count : 0,
          functions,
          detector: this.name,
          metadata: {
            ...firstResult?.metadata,
            groupSize: component.size,
            averageSimilarity: count > 0 ? totalSimilarity / count : 0
          }
        });
      }
    }

    return groupedResults;
  }
}
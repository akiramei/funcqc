import { FunctionInfo, SimilarityDetector, SimilarityOptions, SimilarityResult, SimilarFunction } from '../types';

/**
 * Hash-based similarity detector for ultra-fast duplicate detection
 * Uses pre-computed hashes to achieve O(n) performance instead of O(n²)
 */
export class HashSimilarityDetector implements SimilarityDetector {
  name = 'hash-duplicate';
  version = '1.0.0';
  supportedLanguages = ['typescript', 'javascript'];

  async isAvailable(): Promise<boolean> {
    return true; // Always available
  }

  async detect(functions: FunctionInfo[], options: SimilarityOptions = {}): Promise<SimilarityResult[]> {
    const config = this.parseDetectionOptions(options);
    const validFunctions = this.filterValidFunctions(functions, config);
    
    // Group functions by hash for O(n) performance
    const results = this.detectHashSimilarities(validFunctions, config);
    
    return this.groupSimilarFunctions(results);
  }

  private parseDetectionOptions(options: SimilarityOptions) {
    return {
      threshold: options.threshold || 0.95,
      minLines: options.minLines || 5,
      crossFile: options.crossFile !== false
    };
  }

  private filterValidFunctions(functions: FunctionInfo[], config: { minLines: number }): FunctionInfo[] {
    return functions.filter(func => 
      !func.metrics || func.metrics.linesOfCode >= config.minLines
    );
  }

  private detectHashSimilarities(
    functions: FunctionInfo[], 
    config: { threshold: number; crossFile: boolean }
  ): SimilarityResult[] {
    const results: SimilarityResult[] = [];
    
    // Group by AST hash for exact matches (similarity = 1.0)
    if (config.threshold <= 1.0) {
      const astHashGroups = this.groupByHash(functions, 'astHash', config.crossFile);
      // Debug: log group sizes
      if (astHashGroups.size > 0) {
        const largestGroup = Math.max(...Array.from(astHashGroups.values()).map(g => g.length));
        if (largestGroup > 10) {
          console.warn(`Warning: Unusually large AST hash group found (${largestGroup} functions). This may indicate missing hash values.`);
        }
      }
      results.push(...this.createHashResults(astHashGroups, 1.0, 'ast-exact'));
    }

    // Group by semantic ID hash for near-exact matches (similarity = 0.95)
    if (config.threshold <= 0.95) {
      const semanticHashGroups = this.groupByHash(functions, 'semanticId', config.crossFile);
      results.push(...this.createHashResults(semanticHashGroups, 0.95, 'semantic-match'));
    }

    // Group by signature hash for structural similarity (similarity = 0.9)
    if (config.threshold <= 0.9) {
      const signatureHashGroups = this.groupByHash(functions, 'signatureHash', config.crossFile);
      results.push(...this.createHashResults(signatureHashGroups, 0.9, 'signature-match'));
    }

    // Group by function name for name-based similarity (similarity = 0.85)
    if (config.threshold <= 0.85) {
      const nameHashGroups = this.groupByHash(functions, 'name', config.crossFile);
      results.push(...this.createHashResults(nameHashGroups, 0.85, 'name-match'));
    }

    return results.filter(result => result.similarity >= config.threshold);
  }

  private groupByHash(
    functions: FunctionInfo[], 
    hashField: keyof FunctionInfo, 
    crossFile: boolean
  ): Map<string, FunctionInfo[]> {
    const groups = new Map<string, FunctionInfo[]>();
    let skippedCount = 0;

    for (const func of functions) {
      const hash = func[hashField] as string;
      if (!hash || hash === 'undefined' || hash === '') {
        skippedCount++;
        continue;
      }

      if (!groups.has(hash)) {
        groups.set(hash, []);
      }
      groups.get(hash)!.push(func);
    }

    // Filter groups with multiple functions
    const filteredGroups = new Map<string, FunctionInfo[]>();
    for (const [hash, groupFunctions] of groups) {
      if (groupFunctions.length >= 2) {
        // Apply cross-file filter if needed
        if (!crossFile) {
          // Group by file within the hash group
          const fileGroups = new Map<string, FunctionInfo[]>();
          for (const func of groupFunctions) {
            if (!fileGroups.has(func.filePath)) {
              fileGroups.set(func.filePath, []);
            }
            fileGroups.get(func.filePath)!.push(func);
          }
          
          // Only keep file groups with multiple functions
          let hasValidGroup = false;
          for (const [, fileFunctions] of fileGroups) {
            if (fileFunctions.length >= 2) {
              filteredGroups.set(`${hash}-${fileFunctions[0].filePath}`, fileFunctions);
              hasValidGroup = true;
            }
          }
          
          if (!hasValidGroup && crossFile) {
            filteredGroups.set(hash, groupFunctions);
          }
        } else {
          filteredGroups.set(hash, groupFunctions);
        }
      }
    }

    if (skippedCount > 0 && hashField === 'astHash') {
      console.warn(`Warning: ${skippedCount} functions have no AST hash. Run "funcqc scan" to regenerate hashes.`);
    }
    
    return filteredGroups;
  }

  private createHashResults(
    hashGroups: Map<string, FunctionInfo[]>, 
    similarity: number,
    hashType: string
  ): SimilarityResult[] {
    const results: SimilarityResult[] = [];

    for (const [hash, groupFunctions] of hashGroups) {
      if (groupFunctions.length >= 2) {
        // Create pairwise results for all combinations in the group
        for (let i = 0; i < groupFunctions.length; i++) {
          for (let j = i + 1; j < groupFunctions.length; j++) {
            results.push(this.createSimilarityResult(
              groupFunctions[i], 
              groupFunctions[j], 
              similarity,
              hashType,
              hash
            ));
          }
        }
      }
    }

    return results;
  }

  private createSimilarityResult(
    func1: FunctionInfo, 
    func2: FunctionInfo, 
    similarity: number,
    hashType: string,
    hash: string
  ): SimilarityResult {
    return {
      type: 'structural',
      similarity,
      functions: [
        this.createSimilarFunction(func1),
        this.createSimilarFunction(func2)
      ],
      detector: this.name,
      metadata: {
        hashType,
        hash,
        exactMatch: similarity === 1.0,
        complexityDiff: Math.abs((func1.metrics?.cyclomaticComplexity || 0) - (func2.metrics?.cyclomaticComplexity || 0)),
        linesDiff: Math.abs((func1.metrics?.linesOfCode || 0) - (func2.metrics?.linesOfCode || 0))
      }
    };
  }

  private createSimilarFunction(func: FunctionInfo): SimilarFunction {
    return {
      functionId: func.id,
      functionName: func.name,
      filePath: func.filePath,
      startLine: func.startLine,
      endLine: func.endLine,
      originalFunction: func
    };
  }

  private groupSimilarFunctions(results: SimilarityResult[]): SimilarityResult[] {
    // Group by hash to create multi-function groups
    const hashGroups = new Map<string, SimilarityResult[]>();

    for (const result of results) {
      const resultHash = result.metadata?.['hash'] as string;
      if (resultHash) {
        if (!hashGroups.has(resultHash)) {
          hashGroups.set(resultHash, []);
        }
        hashGroups.get(resultHash)!.push(result);
      }
    }

    const groupedResults: SimilarityResult[] = [];

    for (const [, groupResults] of hashGroups) {
      if (groupResults.length >= 1) {
        // Collect all unique functions from the hash group
        const allFunctions = new Map<string, SimilarFunction>();
        
        for (const result of groupResults) {
          for (const func of result.functions) {
            allFunctions.set(func.functionId, func);
          }
        }

        if (allFunctions.size >= 2) {
          // Create a single group result
          const bestResult = groupResults[0];
          groupedResults.push({
            ...bestResult,
            functions: Array.from(allFunctions.values()),
            metadata: {
              ...bestResult.metadata,
              groupSize: allFunctions.size,
              totalPairs: groupResults.length
            }
          });
        }
      }
    }

    // Sort by similarity (descending) and then by group size
    return groupedResults.sort((a, b) => {
      if (b.similarity !== a.similarity) {
        return b.similarity - a.similarity;
      }
      return ((b.metadata?.['groupSize'] as number) || 0) - ((a.metadata?.['groupSize'] as number) || 0);
    });
  }
}
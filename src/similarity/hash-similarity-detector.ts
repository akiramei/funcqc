import {
  FunctionInfo,
  SimilarityDetector,
  SimilarityOptions,
  SimilarityResult,
  SimilarFunction,
} from '../types';
import { ASTSimilarityDetector } from './ast-similarity-detector';

/**
 * Hash-based similarity detector for ultra-fast duplicate detection
 * Uses pre-computed hashes to achieve O(n) performance instead of O(n²)
 */
export class HashSimilarityDetector implements SimilarityDetector {
  name = 'hash-duplicate';
  version = '1.0.0';
  supportedLanguages = ['typescript', 'javascript'];
  
  private astDetector: ASTSimilarityDetector | null = null;
  private hybridMode: boolean = false;

  async isAvailable(): Promise<boolean> {
    return true; // Always available
  }

  async detect(
    functions: FunctionInfo[],
    options: SimilarityOptions = {}
  ): Promise<SimilarityResult[]> {
    const config = this.parseDetectionOptions(options);
    const validFunctions = this.filterValidFunctions(functions, config);

    // Enable hybrid mode for better accuracy (default: enabled)
    this.hybridMode = (options as any).astVerification !== false;
    if (this.hybridMode && !this.astDetector) {
      this.astDetector = new ASTSimilarityDetector();
    }

    // Group functions by hash for O(n) performance
    const hashResults = this.detectHashSimilarities(validFunctions, config);
    
    // Apply AST verification if hybrid mode is enabled
    if (this.hybridMode && this.astDetector) {
      console.log(`🔍 Hash found ${hashResults.length} groups, verifying with AST...`);
      return await this.verifyWithAST(hashResults, config);
    }

    return this.groupSimilarFunctions(hashResults);
  }

  private parseDetectionOptions(options: SimilarityOptions) {
    return {
      threshold: options.threshold || 0.95,
      minLines: options.minLines || 3,
      crossFile: options.crossFile !== false,
    };
  }

  private filterValidFunctions(
    functions: FunctionInfo[],
    config: { minLines: number }
  ): FunctionInfo[] {
    // Skip filtering if minLines is 0 or negative (i.e., DB filtering was already applied)
    if (config.minLines <= 0) {
      return functions;
    }
    
    return functions.filter(func => {
      // If no metrics available, include the function (conservative approach)
      if (!func.metrics) return true;
      
      // If metrics exist but linesOfCode is undefined, include the function
      if (func.metrics.linesOfCode === undefined) return true;
      
      // Otherwise, apply the filter
      return func.metrics.linesOfCode >= config.minLines;
    });
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
          console.warn(
            `Warning: Unusually large AST hash group found (${largestGroup} functions). This may indicate missing hash values.`
          );
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
      console.warn(
        `Warning: ${skippedCount} functions have no AST hash. Run "funcqc scan" to regenerate hashes.`
      );
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
            results.push(
              this.createSimilarityResult(
                groupFunctions[i],
                groupFunctions[j],
                similarity,
                hashType,
                hash
              )
            );
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
      functions: [this.createSimilarFunction(func1), this.createSimilarFunction(func2)],
      detector: this.name,
      metadata: {
        hashType,
        hash,
        exactMatch: similarity === 1.0,
        complexityDiff: Math.abs(
          (func1.metrics?.cyclomaticComplexity || 0) - (func2.metrics?.cyclomaticComplexity || 0)
        ),
        linesDiff: Math.abs((func1.metrics?.linesOfCode || 0) - (func2.metrics?.linesOfCode || 0)),
      },
    };
  }

  private createSimilarFunction(func: FunctionInfo): SimilarFunction {
    return {
      functionId: func.id,
      functionName: func.name,
      filePath: func.filePath,
      startLine: func.startLine,
      endLine: func.endLine,
      originalFunction: func,
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
              totalPairs: groupResults.length,
            },
          });
        }
      }
    }

    // Sort by similarity (descending) and then by group size
    return groupedResults.sort((a, b) => {
      if (b.similarity !== a.similarity) {
        return b.similarity - a.similarity;
      }
      return (
        ((b.metadata?.['groupSize'] as number) || 0) - ((a.metadata?.['groupSize'] as number) || 0)
      );
    });
  }

  // Constants for minimum information thresholds
  private static readonly MIN_SOURCE_CHARS = 50;   // 小さすぎる関数は比較しない
  private static readonly MIN_TOKENS = 8;          // トークン数が少なすぎる場合も除外

  /**
   * Check if source code has enough information for reliable comparison
   */
  private hasMinimumInformation(sourceCode: string): boolean {
    if (sourceCode.length < HashSimilarityDetector.MIN_SOURCE_CHARS) {
      return false;
    }
    
    // Simple tokenization check
    const tokens = sourceCode.split(/\b/).filter(t => /\w+/.test(t));
    return tokens.length >= HashSimilarityDetector.MIN_TOKENS;
  }

  /**
   * Apply safety valve to prevent false 1.0 similarities
   */
  private applySafetyValve(similarity: number, astResult: any): number {
    // 1.0 should only be allowed for structural digest equality
    const hasStructuralDigestEqual = astResult.metadata?.structuralDigestEqual === true;
    
    if (similarity >= 1.0 && !hasStructuralDigestEqual) {
      // Cap at 0.99 unless we have confirmed structural digest equality
      return 0.99;
    }
    
    return similarity;
  }

  /**
   * Verify hash results with AST analysis for better accuracy
   */
  private async verifyWithAST(
    hashResults: SimilarityResult[],
    config: { threshold: number }
  ): Promise<SimilarityResult[]> {
    const verifiedResults: SimilarityResult[] = [];
    const startTime = Date.now();
    let totalComparisons = 0;
    let skippedDueToMinInfo = 0;

    for (const hashResult of hashResults) {
      const functions = hashResult.functions;
      
      if (functions.length < 2) continue;
      
      // Convert SimilarFunction to FunctionInfo for AST detector
      const functionInfos = functions.map(sf => ({
        id: sf.functionId,
        name: sf.functionName,
        filePath: sf.filePath,
        startLine: sf.startLine,
        sourceCode: sf.originalFunction?.sourceCode || '',
        metrics: sf.originalFunction?.metrics || {}
      })) as FunctionInfo[];

      // Perform pairwise AST comparison within the group
      for (let i = 0; i < functionInfos.length; i++) {
        for (let j = i + 1; j < functionInfos.length; j++) {
          totalComparisons++;
          
          const funcA = functionInfos[i];
          const funcB = functionInfos[j];
          
          // Pre-filter: Check minimum information requirements
          if (!this.hasMinimumInformation(funcA.sourceCode || '') || 
              !this.hasMinimumInformation(funcB.sourceCode || '')) {
            skippedDueToMinInfo++;
            console.debug('[AST-verify-skip] Insufficient info: %s vs %s (len: %d, %d)',
              funcA.name, funcB.name, 
              funcA.sourceCode?.length ?? 0, funcB.sourceCode?.length ?? 0
            );
            continue; // 検証不能 → ハッシュ一致だけでは昇格させない
          }

          try {
            const astResults = await this.astDetector!.detect(
              [funcA, funcB], 
              { threshold: Math.max(0.85, config.threshold) }
            );
            
            if (astResults.length === 0) {
              console.debug('[AST-verify-reject] Below threshold: %s vs %s', funcA.name, funcB.name);
              continue; // AST検証で類似度不足
            }

            const astResult = astResults[0];
            const rawSimilarity = astResult.similarity;
            
            // Apply safety valve for 1.0 similarities
            const safeSimilarity = this.applySafetyValve(rawSimilarity, astResult);
            
            console.debug('[AST-verify-accept] %s vs %s: raw=%.3f, safe=%.3f', 
              funcA.name, funcB.name, rawSimilarity, safeSimilarity
            );

            verifiedResults.push({
              type: 'structural',
              functions: [functions[i], functions[j]],
              similarity: safeSimilarity,
              detector: 'AST-verified (hash pre-filtered)',
              metadata: {
                ...hashResult.metadata,
                originalHashSimilarity: hashResult.similarity,
                verificationMethod: 'ast',
                rawAstSimilarity: rawSimilarity,
                appliedSafetyValve: safeSimilarity !== rawSimilarity,
                reason: `AST similarity: ${(safeSimilarity * 100).toFixed(1)}%`,
                comparisonTime: Date.now() - startTime
              }
            });
          } catch (error) {
            console.warn('[AST-verify-error] Failed to compare %s vs %s: %s', 
              funcA.name, funcB.name, error instanceof Error ? error.message : String(error)
            );
            // エラーの場合は昇格させない（ハッシュ結果を破棄）
          }
        }
      }
    }

    const endTime = Date.now();
    console.log(`✅ AST verification completed: ${totalComparisons} comparisons in ${endTime - startTime}ms`);
    console.log(`📊 Results: ${hashResults.length} hash groups → ${verifiedResults.length} verified similarities`);
    console.log(`⚠️  Skipped ${skippedDueToMinInfo} comparisons due to insufficient information`);

    return this.groupSimilarFunctions(verifiedResults);
  }
}

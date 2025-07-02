import { createHash } from 'crypto';
import { Project, Node, SyntaxKind, ts, SourceFile } from 'ts-morph';
import { LRUCache } from 'lru-cache';
import { FunctionInfo, SimilarityDetector, SimilarityOptions, SimilarityResult, SimilarFunction } from '../types';
import { HashWinnowingUtility } from '../utils/hash-winnowing-utility';
import { GraphAlgorithms } from '../utils/graph-algorithms';

/**
 * Advanced similarity detector using AST canonicalization, Merkle hashing, 
 * k-gram SimHash fingerprinting, and LSH bucketing for optimal performance
 * and detection accuracy
 */
export class AdvancedSimilarityDetector implements SimilarityDetector {
  name = 'advanced-structural';
  version = '1.0.0';
  supportedLanguages = ['typescript', 'javascript'];

  private project: Project | null = null;
  private merkleCache = new LRUCache<string, bigint>({ max: 1000 });
  private canonicalCache = new LRUCache<string, string>({ max: 1000 });
  
  // Configuration - optimized LSH parameters for O(n) performance
  private readonly DEFAULT_K_GRAM_SIZE = 15;  // Reduced for finer granularity
  private readonly DEFAULT_WINNOWING_WINDOW = 8;  // Increased for stability
  private readonly DEFAULT_LSH_BITS = 24;  // Increased for better distribution (16.7M buckets)
  private readonly SIMHASH_BITS = 64;
  private readonly MAX_LSH_BUCKET_SIZE = 10;  // Maximum bucket size for O(n) performance guarantee
  private readonly SINGLE_STAGE_THRESHOLD = 1000;  // Function count threshold for single-stage analysis

  async isAvailable(): Promise<boolean> {
    return true; // Always available since it only uses ts-morph
  }

  async detect(functions: FunctionInfo[], options: SimilarityOptions = {}): Promise<SimilarityResult[]> {
    const config = this.parseDetectionOptions(options);
    const validFunctions = this.filterValidFunctions(functions, config);
    
    console.log(`Advanced detector processing ${validFunctions.length} functions...`);
    
    // For small datasets, use direct advanced analysis
    if (validFunctions.length <= this.SINGLE_STAGE_THRESHOLD) {
      console.log('🎯 Direct O(n) advanced analysis (testing single-stage performance)');
      return this.detectAdvancedMode(validFunctions, config);
    }
    
    // For large datasets, use 2-stage filtering approach
    console.log('🚀 Large dataset - using 2-stage filtering approach');
    return this.detectTwoStageMode(validFunctions, config);
  }

  /**
   * Advanced mode for small datasets - full algorithm suite
   */
  private async detectAdvancedMode(
    functions: FunctionInfo[],
    config: ReturnType<typeof this.parseDetectionOptions>
  ): Promise<SimilarityResult[]> {
    // Initialize ts-morph project
    await this.initializeProject(functions);
    
    // Generate fingerprints for all functions
    const functionFingerprints = await this.generateFingerprints(functions, config);
    
    // Execute detection algorithms in sequence
    return this.executeDetectionAlgorithms(functionFingerprints, config);
  }

  /**
   * Execute all detection algorithms and combine results
   */
  private executeDetectionAlgorithms(
    functionFingerprints: FunctionFingerprint[],
    config: ReturnType<typeof this.parseDetectionOptions>
  ): SimilarityResult[] {
    const results: SimilarityResult[] = [];
    
    // 1. Exact matches using Merkle hash (O(n))
    const exactMatches = this.detectExactMatches(functionFingerprints, config);
    results.push(...exactMatches);
    
    // 2. Near duplicates using SimHash + LSH (O(n)) - exclude pairs already found
    const nearDuplicates = this.detectNearDuplicates(functionFingerprints, config, exactMatches);
    results.push(...nearDuplicates);
    
    // 3. Structural similarities using advanced AST comparison
    const structuralSimilarities = this.detectStructuralSimilarities(functionFingerprints, config);
    results.push(...structuralSimilarities);
    
    return this.deduplicateResults(results);
  }

  /**
   * Two-stage mode for large datasets - fast filtering + advanced analysis
   */
  private async detectTwoStageMode(
    functions: FunctionInfo[],
    config: ReturnType<typeof this.parseDetectionOptions>
  ): Promise<SimilarityResult[]> {
    // Stage 1: Fast pre-filtering to identify candidates
    console.log('🔥 Stage 1: Fast similarity pre-filtering...');
    const fastResults = this.detectFastMode(functions);
    
    // Extract candidate functions for detailed analysis
    const candidates = this.extractCandidates(fastResults, functions);
    console.log(`📊 Identified ${candidates.length} candidates from ${functions.length} functions`);
    
    if (candidates.length === 0) {
      console.log('✨ No candidates found - returning fast results');
      return fastResults;
    }
    
    // Stage 2: Advanced analysis on candidates only
    console.log(`🎯 Stage 2: Advanced analysis on ${candidates.length} candidates...`);
    const advancedResults = await this.detectAdvancedMode(candidates, config);
    
    // Merge results with priority to advanced analysis
    return this.mergeResults(fastResults, advancedResults);
  }

  /**
   * Extract candidate functions for detailed analysis - LSH collision based only
   */
  private extractCandidates(
    fastResults: SimilarityResult[],
    allFunctions: FunctionInfo[]
  ): FunctionInfo[] {
    const candidateIds = new Set<string>();
    
    // Primary: Add functions from similarity groups discovered in fast mode
    fastResults.forEach(result => {
      result.functions.forEach(func => candidateIds.add(func.functionId));
    });
    
    // Create proper config for SimHash generation
    const config = this.parseDetectionOptions({});
    
    // Generate SimHash for all functions to find LSH collisions
    const functionHashes = new Map<string, bigint[]>();
    allFunctions.forEach(func => {
      if (func.sourceCode) {
        const tokens = this.tokenizeSourceCode(func.sourceCode);
        const canonical = this.canonicalizeTokens(tokens);
        const simHashes = this.generateSimHashFingerprints(canonical, config);
        functionHashes.set(func.id, simHashes);
      }
    });
    
    // LSH bucketing to find collision candidates
    const lshBuckets = new Map<string, string[]>();
    for (const [funcId, hashes] of functionHashes) {
      for (const hash of hashes) {
        const bucketKey = this.getLSHBucketKey(hash, this.DEFAULT_LSH_BITS);
        if (!lshBuckets.has(bucketKey)) {
          lshBuckets.set(bucketKey, []);
        }
        lshBuckets.get(bucketKey)!.push(funcId);
      }
    }
    
    // Add functions from LSH buckets with 2-10 functions (sweet spot)
    for (const [bucketKey, bucketFunctions] of lshBuckets) {
      if (bucketFunctions.length >= 2 && bucketFunctions.length <= this.MAX_LSH_BUCKET_SIZE) {
        bucketFunctions.forEach(funcId => candidateIds.add(funcId));
        console.log(`LSH bucket ${bucketKey.slice(0, 8)}... has ${bucketFunctions.length} candidates`);
      }
    }
    
    const candidates = allFunctions.filter(func => candidateIds.has(func.id));
    
    // Apply post-filtering to remove obvious non-duplicates
    return this.postFilterCandidates(candidates);
  }

  /**
   * Post-filter candidates to remove obvious non-duplicates
   */
  private postFilterCandidates(candidates: FunctionInfo[]): FunctionInfo[] {
    // Remove functions that are too complex/large (likely unique)
    return candidates.filter(func => {
      const metrics = func.metrics;
      if (!metrics) return true;
      
      // Filter out extremely complex functions (unlikely to be duplicates)
      if (metrics.cyclomaticComplexity > 20) return false;
      
      // Filter out extremely large functions (unlikely to be exact duplicates)
      // Increased to 300 lines as large functions often contain copy-paste duplicates
      if (metrics.linesOfCode > 300) return false;
      
      return true;
    });
  }


  /**
   * Merge fast and advanced results with deduplication
   */
  private mergeResults(
    fastResults: SimilarityResult[],
    advancedResults: SimilarityResult[]
  ): SimilarityResult[] {
    // Create a map of function pairs to avoid duplicates
    const seenPairs = new Set<string>();
    const mergedResults: SimilarityResult[] = [];
    
    // Priority 1: Advanced results (higher precision)
    for (const result of advancedResults) {
      const pairKey = this.createPairKey(result.functions);
      if (!seenPairs.has(pairKey)) {
        seenPairs.add(pairKey);
        mergedResults.push({
          ...result,
          detector: result.detector.includes('advanced') ? result.detector : 'advanced-structural-hybrid'
        });
      }
    }
    
    // Priority 2: Fast results not covered by advanced analysis
    for (const result of fastResults) {
      const pairKey = this.createPairKey(result.functions);
      if (!seenPairs.has(pairKey)) {
        seenPairs.add(pairKey);
        mergedResults.push({
          ...result,
          detector: 'advanced-structural-fast'
        });
      }
    }
    
    return this.deduplicateResults(mergedResults);
  }

  private createPairKey(functions: SimilarFunction[]): string {
    return functions
      .map(f => f.functionId)
      .sort()
      .join('|');
  }

  /**
   * Fast mode for large datasets - uses simplified algorithms
   */
  private detectFastMode(
    functions: FunctionInfo[]
  ): SimilarityResult[] {
    const results: SimilarityResult[] = [];
    
    // Group by simple source code hash for fast exact matches
    const codeGroups = new Map<string, FunctionInfo[]>();
    
    for (const func of functions) {
      if (!func.sourceCode) continue;
      
      const hash = this.hash64(func.sourceCode.trim()).toString();
      if (!codeGroups.has(hash)) {
        codeGroups.set(hash, []);
      }
      codeGroups.get(hash)!.push(func);
    }
    
    // Create results for groups with multiple functions
    for (const [hash, group] of codeGroups) {
      if (group.length >= 2) {
        const functions = group.map(func => ({
          functionId: func.id,
          functionName: func.name,
          filePath: func.filePath,
          startLine: func.startLine,
          endLine: func.endLine,
          originalFunction: func
        }));

        results.push({
          type: 'structural',
          similarity: 1.0,
          functions,
          detector: this.name + '-fast',
          metadata: {
            algorithm: 'source-code-hash',
            resultType: 'exact-match',
            functionCount: functions.length,
            hash
          }
        });
      }
    }
    
    return results;
  }

  private parseDetectionOptions(options: SimilarityOptions) {
    return {
      threshold: options.threshold || 0.7,
      minLines: options.minLines || 5,
      crossFile: options.crossFile !== false,
      kGramSize: this.DEFAULT_K_GRAM_SIZE,
      winnowingWindow: this.DEFAULT_WINNOWING_WINDOW,
      lshBits: this.DEFAULT_LSH_BITS
    };
  }

  private filterValidFunctions(functions: FunctionInfo[], config: { minLines: number }): FunctionInfo[] {
    return functions.filter(func => {
      if (!func.sourceCode || func.sourceCode.trim().length <= 10) {
        return false;
      }
      
      // If metrics are available, use them
      if (func.metrics) {
        return func.metrics.linesOfCode >= config.minLines;
      }
      
      // Fallback: estimate lines from source code
      const estimatedLines = func.sourceCode.split('\n').length;
      return estimatedLines >= config.minLines;
    });
  }

  private async initializeProject(functions: FunctionInfo[]): Promise<void> {
    if (this.project) {
      // Reuse existing project, just verify files are loaded
      await this.ensureFilesLoaded(functions);
      return;
    }
    
    this.project = new Project({
      // Don't use in-memory filesystem to avoid path resolution issues
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        lib: ['ES2020'],
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
        skipLibCheck: true
      }
    });

    // Add unique files to project with proper path resolution
    const uniqueFiles = new Set(functions.map(f => f.filePath));
    let successCount = 0;
    
    for (const filePath of uniqueFiles) {
      try {
        // Use the existing file system instead of trying to add non-existent files
        if (await this.fileExists(filePath)) {
          this.project.addSourceFileAtPathIfExists(filePath);
          successCount++;
        }
      } catch (error) {
        // Skip files that can't be added - this is expected for some database entries
        // Log only in debug mode to avoid cluttering output
        if (process.env['DEBUG']) {
          console.debug(`Skipping file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    
    console.log(`Successfully loaded ${successCount}/${uniqueFiles.size} source files for AST analysis`);
  }

  private async ensureFilesLoaded(functions: FunctionInfo[]): Promise<void> {
    const uniqueFiles = new Set(functions.map(f => f.filePath));
    const loadedFilePaths = this.project!.getSourceFiles().map(sf => sf.getFilePath().toString());
    const loadedFiles = new Set(loadedFilePaths);
    
    let newCount = 0;
    for (const filePath of uniqueFiles) {
      if (!loadedFiles.has(filePath)) {
        try {
          if (await this.fileExists(filePath)) {
            this.project!.addSourceFileAtPathIfExists(filePath);
            newCount++;
          }
        } catch {
          // Silently skip files that can't be added
        }
      }
    }
    
    if (newCount > 0) {
      console.log(`Added ${newCount} new source files to existing project`);
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const fs = await import('fs/promises');
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async generateFingerprints(
    functions: FunctionInfo[], 
    config: ReturnType<typeof this.parseDetectionOptions>
  ): Promise<FunctionFingerprint[]> {
    const fingerprints: FunctionFingerprint[] = [];
    
    // Process in batches for better performance
    const batchSize = 50;
    for (let i = 0; i < functions.length; i += batchSize) {
      const batch = functions.slice(i, i + batchSize);
      
      for (const func of batch) {
        try {
          const fingerprint = await this.generateFunctionFingerprint(func, config);
          if (fingerprint) {
            fingerprints.push(fingerprint);
          }
        } catch (error) {
          console.warn(`Failed to generate fingerprint for ${func.name}:`, error);
        }
      }
      
      // Progress indication for large batches
      if (functions.length > 100 && i % (batchSize * 4) === 0) {
        console.log(`Processing fingerprints: ${Math.min(i + batchSize, functions.length)}/${functions.length}`);
      }
    }
    
    return fingerprints;
  }

  private async generateFunctionFingerprint(
    func: FunctionInfo,
    config: ReturnType<typeof this.parseDetectionOptions>
  ): Promise<FunctionFingerprint | null> {
    if (!this.project || !func.sourceCode) return null;

    try {
      // Find the function node in the AST
      const sourceFile = this.project.getSourceFile(func.filePath);
      if (!sourceFile) {
        // Fallback: use source code directly for analysis
        return this.generateFingerprintFromSource(func, config);
      }

      const functionNode = this.findFunctionNode(sourceFile, func);
      if (!functionNode) {
        // Fallback: use source code directly for analysis
        return this.generateFingerprintFromSource(func, config);
      }

      // Generate canonical representation
      const canonical = this.canonicalizeAST(functionNode);
      
      // Generate Merkle hash for exact matching
      const merkleHash = this.computeMerkleHash(functionNode);
      
      // Generate SimHash fingerprints for near-duplicate detection
      const simHashFingerprints = this.generateSimHashFingerprints(canonical, config);
      
      // Generate signature hash for structural similarity
      const signatureHash = this.computeSignatureHash(functionNode);

      return {
        functionInfo: func,
        canonical,
        merkleHash,
        simHashFingerprints,
        signatureHash,
        functionNode
      };
    } catch (error) {
      console.warn(`Error generating fingerprint for ${func.name}:`, error);
      return null;
    }
  }

  /**
   * Fallback fingerprint generation when AST node is not available
   */
  private generateFingerprintFromSource(
    func: FunctionInfo,
    config: ReturnType<typeof this.parseDetectionOptions>
  ): FunctionFingerprint {
    // Use source code for basic analysis
    const sourceCode = func.sourceCode || '';
    
    // Simple tokenization for fallback analysis
    const tokens = this.tokenizeSourceCode(sourceCode);
    const canonical = this.canonicalizeTokens(tokens);
    
    // Generate basic hashes
    const merkleHash = this.hash64(canonical);
    const simHashFingerprints = this.generateSimHashFingerprints(canonical, config);
    const signatureHash = this.hash64(func.signature || func.name);
    
    return {
      functionInfo: func,
      canonical,
      merkleHash,
      simHashFingerprints,
      signatureHash: signatureHash.toString(),
      functionNode: null // No AST node available in fallback mode
    };
  }

  private tokenizeSourceCode(source: string): string[] {
    // Simple tokenization - split on common delimiters
    return source
      .replace(/[{}()\[\];,=+\-*/%<>!&|]/g, ' $& ')
      .split(/\s+/)
      .filter(token => token.length > 0);
  }

  private canonicalizeTokens(tokens: string[]): string {
    const idMap = new Map<string, string>();
    let idCounter = 0;
    
    return tokens
      .map(token => {
        // Normalize identifiers
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(token)) {
          if (!idMap.has(token)) {
            idMap.set(token, `ID${++idCounter}`);
          }
          return idMap.get(token)!;
        }
        
        // Normalize literals
        if (/^["'`]/.test(token) || /^\d/.test(token)) {
          return 'LIT';
        }
        
        return token;
      })
      .join(',');
  }

  private findFunctionNode(sourceFile: SourceFile, func: FunctionInfo): Node | null {
    let targetNode: Node | null = null;
    
    sourceFile.forEachDescendant((node) => {
      if (ts.isFunctionLike(node.compilerNode)) {
        const start = node.getStartLineNumber();
        const end = node.getEndLineNumber();
        
        // Match by line numbers with some tolerance
        if (Math.abs(start - func.startLine) <= 2 && Math.abs(end - func.endLine) <= 2) {
          targetNode = node;
          return false; // Stop traversal
        }
      }
      return undefined;
    });
    
    return targetNode;
  }

  /**
   * AST Canonicalization - normalize identifiers, literals, types
   */
  private canonicalizeAST(node: Node): string {
    const cacheKey = `${node.getSourceFile().getFilePath()}:${node.getStart()}`;
    if (this.canonicalCache.has(cacheKey)) {
      return this.canonicalCache.get(cacheKey)!;
    }

    const idMap = new Map<string, string>();
    const idCounter = { value: 0 };
    
    const canonical = this.canonicalizeNode(node, idMap, idCounter);
    this.canonicalCache.set(cacheKey, canonical);
    
    return canonical;
  }

  private canonicalizeNode(node: Node, idMap: Map<string, string>, idCounter: { value: number }): string {
    const kind = SyntaxKind[node.getKind()];

    // Skip type annotations and decorators
    if (this.shouldSkipNode(node)) {
      return '';
    }

    // Handle different node types with dedicated methods
    if (Node.isIdentifier(node)) {
      return this.canonicalizeIdentifier(node, idMap, idCounter);
    }

    if (Node.isLiteralLike(node)) {
      return this.canonicalizeLiteral(node);
    }

    // Recursively process children
    const children = node.getChildren()
      .map(child => this.canonicalizeNode(child, idMap, idCounter))
      .filter(child => child.length > 0);

    return `${kind}(${children.join(',')})`;
  }

  private shouldSkipNode(node: Node): boolean {
    return Node.isTypeNode(node) || Node.isDecorator(node);
  }

  private canonicalizeIdentifier(node: Node, idMap: Map<string, string>, idCounter: { value: number }): string {
    if (!Node.isIdentifier(node)) {
      return '';
    }

    const text = node.getText();
    const parent = node.getParent();
    
    // Preserve function names for better differentiation
    if (parent && this.isFunctionContext(parent)) {
      return `FUNC_${text}`;
    }
    
    // Create contextual identifiers
    if (!idMap.has(text)) {
      idMap.set(text, `ID${++idCounter.value}`);
    }
    return idMap.get(text)!;
  }

  private isFunctionContext(parent: Node): boolean {
    return Node.isFunctionDeclaration(parent) ||
           Node.isMethodDeclaration(parent) ||
           Node.isArrowFunction(parent);
  }

  private canonicalizeLiteral(node: Node): string {
    if (!Node.isLiteralLike(node)) {
      return 'LIT';
    }

    const text = node.getText();
    if (Node.isStringLiteral(node)) return 'STR_LIT';
    if (Node.isNumericLiteral(node)) return 'NUM_LIT';
    if (text === 'true' || text === 'false') return 'BOOL_LIT';
    return 'LIT';
  }

  /**
   * Merkle Hash - structural hashing for exact matches
   */
  private computeMerkleHash(node: Node): bigint {
    const cacheKey = `${node.getSourceFile().getFilePath()}:${node.getStart()}`;
    if (this.merkleCache.has(cacheKey)) {
      return this.merkleCache.get(cacheKey)!;
    }

    const hash = this.computeNodeMerkleHash(node);
    this.merkleCache.set(cacheKey, hash);
    
    return hash;
  }

  private computeNodeMerkleHash(node: Node): bigint {
    const kind = node.getKind();
    const kindHash = this.hash64(SyntaxKind[kind]);
    
    const childHashes = node.getChildren()
      .map(child => this.computeNodeMerkleHash(child));
    
    return this.mixHashes(kindHash, childHashes);
  }

  private hash64(input: string): bigint {
    // True 64-bit FNV-1a hash implementation
    const FNV_OFFSET_BASIS = 14695981039346656037n;
    const FNV_PRIME = 1099511628211n;
    
    let hash = FNV_OFFSET_BASIS;
    
    for (let i = 0; i < input.length; i++) {
      const byte = BigInt(input.charCodeAt(i));
      hash ^= byte;
      hash = (hash * FNV_PRIME) & 0xFFFFFFFFFFFFFFFFn; // Keep in 64-bit range
    }
    
    return hash;
  }

  private mixHashes(base: bigint, childHashes: bigint[]): bigint {
    const PRIME = 0x100000001b3n; // Large prime for mixing
    let result = base;
    
    // Preserve order information by combining with position-dependent operations
    for (let i = 0; i < childHashes.length; i++) {
      const childHash = childHashes[i];
      const position = BigInt(i);
      // Mix child hash with its position using BigInt arithmetic (faster than string conversion)
      result = (result ^ ((childHash + position) << 1n)) * PRIME;
    }
    return result;
  }

  /**
   * SimHash Fingerprinting - k-gram based near-duplicate detection
   */
  private generateSimHashFingerprints(canonical: string, config: ReturnType<typeof this.parseDetectionOptions>): bigint[] {
    const tokens = canonical.split(/[(),]/g).filter(t => t.length > 0);
    
    // Ensure minimum k-gram size for meaningful features, with fallback for short functions
    const optimizedKSize = tokens.length < 15 
      ? Math.max(3, tokens.length) 
      : Math.min(config.kGramSize, Math.max(15, tokens.length / 4));
    const kGrams = HashWinnowingUtility.extractKGrams(tokens, optimizedKSize);
    
    // Limit the number of k-grams for performance
    const limitedKGrams = kGrams.slice(0, Math.min(50, kGrams.length));
    const hashes = limitedKGrams.map(gram => this.hash64(gram.join('')));
    
    // Apply winnowing to reduce fingerprint count
    const winnowed = HashWinnowingUtility.winnowHashes(hashes, config.winnowingWindow);
    
    // Generate single SimHash from all winnowed features
    return winnowed.length > 0 ? [this.computeSimHash(winnowed)] : [];
  }


  /**
   * True SimHash implementation: combine multiple features into single fingerprint
   */
  private computeSimHash(features: bigint[]): bigint {
    const weights = new Array(this.SIMHASH_BITS).fill(0);
    
    // Accumulate weights from all features
    for (const feature of features) {
      for (let i = 0; i < this.SIMHASH_BITS; i++) {
        if ((feature & (1n << BigInt(i))) !== 0n) {
          weights[i] += 1;
        } else {
          weights[i] -= 1;
        }
      }
    }
    
    // Generate final SimHash based on accumulated weights
    let simHash = 0n;
    for (let i = 0; i < this.SIMHASH_BITS; i++) {
      if (weights[i] > 0) {
        simHash |= (1n << BigInt(i));
      }
    }
    
    return simHash;
  }

  /**
   * Signature Hash - structural pattern matching
   */
  private computeSignatureHash(node: Node): string {
    const signature = this.extractStructuralSignature(node);
    return createHash('sha256').update(signature).digest('hex');
  }

  private extractStructuralSignature(node: Node): string {
    const features: string[] = [];
    
    // Extract control flow patterns
    node.forEachDescendant((child) => {
      const kind = child.getKind();
      switch (kind) {
        case SyntaxKind.IfStatement:
          features.push('IF');
          break;
        case SyntaxKind.ForStatement:
        case SyntaxKind.WhileStatement:
        case SyntaxKind.DoStatement:
          features.push('LOOP');
          break;
        case SyntaxKind.SwitchStatement:
          features.push('SWITCH');
          break;
        case SyntaxKind.TryStatement:
          features.push('TRY');
          break;
        case SyntaxKind.FunctionDeclaration:
        case SyntaxKind.ArrowFunction:
        case SyntaxKind.FunctionExpression:
          features.push('FUNC');
          break;
      }
    });
    
    return features.join('|');
  }

  /**
   * Exact Match Detection using Merkle Hash
   */
  private detectExactMatches(
    fingerprints: FunctionFingerprint[],
    config: ReturnType<typeof this.parseDetectionOptions>
  ): SimilarityResult[] {
    const results: SimilarityResult[] = [];
    const merkleGroups = new Map<string, FunctionFingerprint[]>();
    
    // Group by Merkle hash
    for (const fp of fingerprints) {
      const key = fp.merkleHash.toString();
      if (!merkleGroups.has(key)) {
        merkleGroups.set(key, []);
      }
      merkleGroups.get(key)!.push(fp);
    }
    
    // Create results for groups with multiple functions
    for (const [hash, group] of merkleGroups) {
      if (group.length >= 2 && this.shouldIncludeGroup(group, config)) {
        results.push(this.createSimilarityResult(
          group,
          1.0,
          'exact-match',
          { merkleHash: hash, algorithm: 'merkle-tree', groupType: 'structural-identical' }
        ));
      }
    }
    
    return results;
  }

  /**
   * Near Duplicate Detection using SimHash + LSH - Proper O(n) implementation
   */
  private detectNearDuplicates(
    fingerprints: FunctionFingerprint[],
    config: ReturnType<typeof this.parseDetectionOptions>,
    excludeResults: SimilarityResult[] = []
  ): SimilarityResult[] {
    const results: SimilarityResult[] = [];
    const lshBuckets = new Map<string, FunctionFingerprint[]>();
    
    // Create set of excluded function pairs from previous results
    const excludedPairs = new Set<string>();
    for (const result of excludeResults) {
      for (let i = 0; i < result.functions.length; i++) {
        for (let j = i + 1; j < result.functions.length; j++) {
          const pair = [result.functions[i].functionId, result.functions[j].functionId].sort().join('|');
          excludedPairs.add(pair);
        }
      }
    }
    
    // LSH bucketing
    for (const fp of fingerprints) {
      for (const simHash of fp.simHashFingerprints) {
        const bucketKey = this.getLSHBucketKey(simHash, config.lshBits);
        if (!lshBuckets.has(bucketKey)) {
          lshBuckets.set(bucketKey, []);
        }
        lshBuckets.get(bucketKey)!.push(fp);
      }
    }
    
    // Check candidates within each bucket - ONLY small buckets for O(n) performance
    for (const [bucketKey, candidates] of lshBuckets) {
      if (candidates.length >= 2 && candidates.length <= this.MAX_LSH_BUCKET_SIZE) {
        console.log(`Processing LSH bucket ${bucketKey.slice(0, 8)}... with ${candidates.length} functions`);
        const bucketResults = this.checkSmallBucketCandidates(candidates, config, excludedPairs);
        results.push(...bucketResults);
      } else if (candidates.length > this.MAX_LSH_BUCKET_SIZE) {
        console.log(`Skipping large LSH bucket ${bucketKey.slice(0, 8)}... with ${candidates.length} functions (too large for O(n) guarantee)`);
      }
    }
    
    return results;
  }

  private getLSHBucketKey(simHash: bigint, bits: number): string {
    // Use top bits as bucket key
    const bucket = simHash >> BigInt(this.SIMHASH_BITS - bits);
    return bucket.toString();
  }

  /**
   * Optimized comparison for small buckets (2-10 functions) - maintains O(n) overall
   */
  private checkSmallBucketCandidates(
    candidates: FunctionFingerprint[],
    config: ReturnType<typeof this.parseDetectionOptions>,
    excludedPairs: Set<string> = new Set()
  ): SimilarityResult[] {
    const results: SimilarityResult[] = [];
    
    // LSH bucket already groups similar functions, no need for additional sorting
    // Direct pairwise comparison within small buckets
    for (let i = 0; i < candidates.length - 1; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const pairKey = [candidates[i].functionInfo.id, candidates[j].functionInfo.id].sort().join('|');
        if (excludedPairs.has(pairKey)) {
          continue; // Skip pair already detected by previous algorithm
        }
        
        const similarity = this.computeSimHashSimilarity(candidates[i], candidates[j]);
        
        if (similarity >= config.threshold && 
            this.shouldIncludePair(candidates[i], candidates[j], config) &&
            this.isValidSimilarity(candidates[i], candidates[j], similarity)) {
          results.push(this.createSimilarityResult(
            [candidates[i], candidates[j]],
            similarity,
            'near-duplicate',
            { 
              algorithm: 'simhash-lsh-optimized', 
              hammingDistance: this.computeHammingDistance(candidates[i], candidates[j]),
              groupType: 'semantic-similar'
            }
          ));
        }
      }
    }
    
    return results;
  }

  private computeSimHashSimilarity(fp1: FunctionFingerprint, fp2: FunctionFingerprint): number {
    let minDistance = Infinity;
    
    // Compare all SimHash fingerprints between the two functions
    for (const hash1 of fp1.simHashFingerprints) {
      for (const hash2 of fp2.simHashFingerprints) {
        const distance = this.hammingDistance(hash1, hash2);
        minDistance = Math.min(minDistance, distance);
      }
    }
    
    // Convert Hamming distance to similarity (0-1)
    return Math.max(0, 1 - (minDistance / this.SIMHASH_BITS));
  }

  private computeHammingDistance(fp1: FunctionFingerprint, fp2: FunctionFingerprint): number {
    let minDistance = Infinity;
    
    for (const hash1 of fp1.simHashFingerprints) {
      for (const hash2 of fp2.simHashFingerprints) {
        const distance = this.hammingDistance(hash1, hash2);
        minDistance = Math.min(minDistance, distance);
      }
    }
    
    return minDistance;
  }

  private hammingDistance(hash1: bigint, hash2: bigint): number {
    let xor = hash1 ^ hash2;
    let distance = 0;
    
    while (xor !== 0n) {
      distance += Number(xor & 1n);
      xor >>= 1n;
    }
    
    return distance;
  }

  /**
   * Validate similarity to avoid false positives
   */
  private isValidSimilarity(fp1: FunctionFingerprint, fp2: FunctionFingerprint, similarity: number): boolean {
    const func1 = fp1.functionInfo;
    const func2 = fp2.functionInfo;
    
    // Skip if comparing the same function (self-comparison)
    if (func1.id === func2.id) {
      return false;
    }
    
    // Skip if functions are too different in size (likely false positive)
    const lineDiff = Math.abs((func1.metrics?.linesOfCode || 0) - (func2.metrics?.linesOfCode || 0));
    if (lineDiff > 15) {
      return false;
    }
    
    // Skip if function names are completely different and similarity is very high
    if (similarity > 0.95) {
      const name1 = func1.name.toLowerCase();
      const name2 = func2.name.toLowerCase();
      
      // Allow if names are similar
      if (this.areNamesSimilar(name1, name2)) {
        return true;
      }
      
      // Allow if functions are very short (likely genuine duplicates)
      if ((func1.metrics?.linesOfCode || 0) <= 10 && (func2.metrics?.linesOfCode || 0) <= 10) {
        return true;
      }
      
      // Otherwise, require lower similarity threshold for different names
      return similarity < 0.98;
    }
    
    return true;
  }

  private areNamesSimilar(name1: string, name2: string): boolean {
    // Check if names share common words or prefixes
    const words1 = name1.split(/[A-Z]|_/);
    const words2 = name2.split(/[A-Z]|_/);
    
    for (const word1 of words1) {
      for (const word2 of words2) {
        if (word1.length > 3 && word2.length > 3 && word1 === word2) {
          return true;
        }
      }
    }
    
    // Check edit distance for short names
    if (name1.length <= 10 && name2.length <= 10) {
      return this.editDistance(name1, name2) <= 2;
    }
    
    return false;
  }

  private editDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,     // deletion
          matrix[j - 1][i] + 1,     // insertion
          matrix[j - 1][i - 1] + cost // substitution
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Structural Similarity Detection
   */
  private detectStructuralSimilarities(
    fingerprints: FunctionFingerprint[],
    config: ReturnType<typeof this.parseDetectionOptions>
  ): SimilarityResult[] {
    const results: SimilarityResult[] = [];
    const signatureGroups = new Map<string, FunctionFingerprint[]>();
    
    // Group by signature hash
    for (const fp of fingerprints) {
      if (!signatureGroups.has(fp.signatureHash)) {
        signatureGroups.set(fp.signatureHash, []);
      }
      signatureGroups.get(fp.signatureHash)!.push(fp);
    }
    
    // Create results for groups with structural similarity
    for (const [signature, group] of signatureGroups) {
      if (group.length >= 2 && this.shouldIncludeGroup(group, config)) {
        const similarity = this.computeStructuralSimilarity(group);
        if (similarity >= config.threshold) {
          results.push(this.createSimilarityResult(
            group,
            similarity,
            'structural-pattern',
            { 
              signatureHash: signature, 
              algorithm: 'structural-signature',
              groupType: 'pattern-similar'
            }
          ));
        }
      }
    }
    
    return results;
  }

  private computeStructuralSimilarity(group: FunctionFingerprint[]): number {
    // Compute average canonical similarity within group
    let totalSimilarity = 0;
    let comparisons = 0;
    
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const similarity = this.jaccardSimilarity(
          group[i].canonical.split(','),
          group[j].canonical.split(',')
        );
        totalSimilarity += similarity;
        comparisons++;
      }
    }
    
    return comparisons > 0 ? totalSimilarity / comparisons : 0;
  }

  private jaccardSimilarity(set1: string[], set2: string[]): number {
    const s1 = new Set(set1);
    const s2 = new Set(set2);
    
    const intersection = new Set([...s1].filter(x => s2.has(x)));
    const union = new Set([...s1, ...s2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Utility methods
   */
  private shouldIncludeGroup(group: FunctionFingerprint[], config: ReturnType<typeof this.parseDetectionOptions>): boolean {
    if (!config.crossFile) {
      // Check if there are multiple functions in the same file
      const filesInGroup = new Set(group.map(fp => fp.functionInfo.filePath));
      return filesInGroup.size < group.length; // At least one file has multiple functions
    }
    return true;
  }

  private shouldIncludePair(fp1: FunctionFingerprint, fp2: FunctionFingerprint, config: ReturnType<typeof this.parseDetectionOptions>): boolean {
    if (!config.crossFile) {
      // When crossFile is disabled, only include pairs within the same file
      return fp1.functionInfo.filePath === fp2.functionInfo.filePath;
    }
    // When crossFile is enabled, include all pairs regardless of file location
    return true;
  }

  private createSimilarityResult(
    fingerprints: FunctionFingerprint[],
    similarity: number,
    resultType: string,
    metadata: Record<string, unknown>
  ): SimilarityResult {
    const functions: SimilarFunction[] = fingerprints.map(fp => ({
      functionId: fp.functionInfo.id,
      functionName: fp.functionInfo.name,
      filePath: fp.functionInfo.filePath,
      startLine: fp.functionInfo.startLine,
      endLine: fp.functionInfo.endLine,
      originalFunction: fp.functionInfo
    }));

    return {
      type: 'structural',
      similarity,
      functions,
      detector: this.name,
      metadata: {
        ...metadata,
        resultType,
        functionCount: functions.length,
        avgComplexity: this.computeAverageComplexity(fingerprints),
        avgLines: this.computeAverageLines(fingerprints)
      }
    };
  }

  private computeAverageComplexity(fingerprints: FunctionFingerprint[]): number {
    const complexities = fingerprints
      .map(fp => fp.functionInfo.metrics?.cyclomaticComplexity || 0)
      .filter(c => c > 0);
    
    return complexities.length > 0 
      ? complexities.reduce((sum, c) => sum + c, 0) / complexities.length 
      : 0;
  }

  private computeAverageLines(fingerprints: FunctionFingerprint[]): number {
    const lines = fingerprints
      .map(fp => fp.functionInfo.metrics?.linesOfCode || 0)
      .filter(l => l > 0);
    
    return lines.length > 0 
      ? lines.reduce((sum, l) => sum + l, 0) / lines.length 
      : 0;
  }

  private deduplicateResults(results: SimilarityResult[]): SimilarityResult[] {
    console.log(`🔄 Merging ${results.length} similarity groups...`);
    
    // Advanced group merging: combine overlapping groups
    const mergedGroups = this.mergeOverlappingGroups(results);
    
    console.log(`✅ Merged into ${mergedGroups.length} unique groups`);
    return mergedGroups;
  }

  /**
   * Advanced group merging algorithm
   */
  private mergeOverlappingGroups(results: SimilarityResult[]): SimilarityResult[] {
    // Step 1: Build function-to-groups mapping
    const functionToGroups = GraphAlgorithms.buildItemToGroupsMapping(
      results,
      (result) => result.functions.map(func => func.functionId)
    );
    
    // Step 2: Find connected components (groups that share functions)
    const visited = new Set<number>();
    const mergedResults: SimilarityResult[] = [];
    
    for (let i = 0; i < results.length; i++) {
      if (visited.has(i)) continue;
      
      // Find all groups connected to this group
      const connectedGroups = this.findConnectedGroups(i, results, functionToGroups);
      connectedGroups.forEach(idx => visited.add(idx));
      
      // Merge all connected groups
      const mergedGroup = this.mergeGroupsIntoOne(connectedGroups.map(idx => results[idx]));
      mergedResults.push(mergedGroup);
    }
    
    return mergedResults;
  }

  private findConnectedGroups(
    startIndex: number, 
    results: SimilarityResult[], 
    functionToGroups: Map<string, number[]>
  ): number[] {
    return GraphAlgorithms.findConnectedComponents(
      startIndex,
      results,
      (current, items) => {
        const relatedGroups: number[] = [];
        items[current].functions.forEach(func => {
          const groups = functionToGroups.get(func.functionId) || [];
          relatedGroups.push(...groups);
        });
        return relatedGroups;
      }
    );
  }

  private mergeGroupsIntoOne(groups: SimilarityResult[]): SimilarityResult {
    if (groups.length === 1) return groups[0];
    
    // Collect all unique functions
    const uniqueFunctions = new Map<string, SimilarFunction>();
    let highestSimilarity = 0;
    let primaryDetector = groups[0].detector;
    const algorithms = new Set<string>();
    
    groups.forEach(group => {
      group.functions.forEach(func => {
        uniqueFunctions.set(func.functionId, func);
      });
      
      if (group.similarity > highestSimilarity) {
        highestSimilarity = group.similarity;
        primaryDetector = group.detector;
      }
      
      // Track which algorithms detected this group
      algorithms.add(group.metadata?.['algorithm'] as string || 'unknown');
    });
    
    return {
      type: 'structural',
      similarity: highestSimilarity,
      functions: Array.from(uniqueFunctions.values()),
      detector: primaryDetector,
      metadata: {
        mergedFrom: groups.length,
        algorithms: Array.from(algorithms),
        resultType: 'merged-group',
        functionCount: uniqueFunctions.size
      }
    };
  }


}

/**
 * Internal data structures
 */
interface FunctionFingerprint {
  functionInfo: FunctionInfo;
  canonical: string;
  merkleHash: bigint;
  simHashFingerprints: bigint[];
  signatureHash: string;
  functionNode: Node | null;
}
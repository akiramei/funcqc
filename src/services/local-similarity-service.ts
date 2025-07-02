/**
 * Local Similarity Service
 * 
 * Provides semantic search capabilities without external API dependencies.
 * Implements TF-IDF vectorization, cosine similarity, n-gram matching,
 * and lightweight embedding computation for AI-collaborative search.
 */

export interface LocalSimilarityConfig {
  /** Minimum document frequency for TF-IDF terms */
  minDocFreq: number;
  /** Maximum document frequency for TF-IDF terms (filter out stop words) */
  maxDocFreq: number;
  /** N-gram size for text matching */
  ngramSize: number;
  /** Minimum term frequency for inclusion in vocabulary */
  minTermFreq: number;
  /** Maximum vocabulary size */
  maxVocabSize: number;
  /** Use stemming for term normalization */
  useStemming: boolean;
}

export interface DocumentVector {
  id: string;
  vector: Float32Array;
  terms: string[];
  metadata?: Record<string, unknown>;
}

export interface SimilarityResult {
  id: string;
  similarity: number;
  explanation: string;
  matchedTerms: string[];
}

export interface TFIDFMetrics {
  termFrequency: Map<string, number>;
  documentFrequency: Map<string, number>;
  vocabulary: string[];
  totalDocuments: number;
}

/**
 * Simple stemming implementation for English text
 */
function simpleStem(word: string): string {
  // Basic Porter stemmer-like rules
  const stemRules = [
    [/ies$/, 'y'],
    [/ied$/, 'y'],
    [/s$/, ''],
    [/ing$/, ''],
    [/ly$/, ''],
    [/ed$/, ''],
    [/er$/, ''],
    [/est$/, ''],
    [/tion$/, 'te'],
    [/ness$/, ''],
    [/ment$/, '']
  ] as const;

  const lowerWord = word.toLowerCase();
  
  for (const [pattern, replacement] of stemRules) {
    if (pattern.test(lowerWord) && lowerWord.length > 3) {
      return lowerWord.replace(pattern, replacement);
    }
  }
  
  return lowerWord;
}

/**
 * Tokenize text into normalized terms
 */
function tokenizeText(text: string, useStemming: boolean = true): string[] {
  // Remove code-specific characters and split on boundaries
  const cleanText = text
    .replace(/[{}()[\]<>]/g, ' ')
    .replace(/[._-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Split camelCase
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = cleanText
    .toLowerCase()
    .split(/\s+/)
    .filter(token => token.length > 2 && /^[a-zA-Z]/.test(token))
    .map(token => token.replace(/[^a-zA-Z0-9]/g, ''));

  return useStemming 
    ? tokens.map(simpleStem)
    : tokens;
}

/**
 * Generate n-grams from text
 */
function generateNgrams(text: string, n: number): string[] {
  const words = tokenizeText(text, false);
  const ngrams: string[] = [];
  
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(' '));
  }
  
  return ngrams;
}

/**
 * Calculate TF-IDF vector for a document
 */
function calculateTFIDF(
  documentTerms: string[],
  vocabulary: string[],
  documentFrequency: Map<string, number>,
  totalDocuments: number
): Float32Array {
  const vector = new Float32Array(vocabulary.length);
  
  // Calculate term frequency for this document
  const termFreq = new Map<string, number>();
  for (const term of documentTerms) {
    termFreq.set(term, (termFreq.get(term) || 0) + 1);
  }
  
  // Calculate TF-IDF for each vocabulary term
  for (let i = 0; i < vocabulary.length; i++) {
    const term = vocabulary[i];
    const tf = termFreq.get(term) || 0;
    const df = documentFrequency.get(term) || 0;
    
    if (tf > 0 && df > 0) {
      // TF-IDF = (term frequency) * log(total documents / document frequency)
      vector[i] = tf * Math.log(totalDocuments / df);
    }
  }
  
  // Normalize vector
  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= norm;
    }
  }
  
  return vector;
}

/**
 * Calculate cosine similarity between two vectors
 */
function calculateCosineSimilarity(vec1: Float32Array, vec2: Float32Array): number {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }
  
  const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Calculate Jaccard similarity for n-gram matching
 */
function calculateJaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Local Similarity Service Implementation
 */
export class LocalSimilarityService {
  private config: LocalSimilarityConfig;
  private documents: Map<string, DocumentVector> = new Map();
  private tfidfMetrics: TFIDFMetrics | null = null;

  constructor(config: Partial<LocalSimilarityConfig> = {}) {
    this.config = {
      minDocFreq: 1,
      maxDocFreq: 0.8,
      ngramSize: 2,
      minTermFreq: 1,
      maxVocabSize: 10000,
      useStemming: true,
      ...config
    };
  }

  /**
   * Index documents for similarity search
   */
  async indexDocuments(documents: { id: string; text: string; metadata?: Record<string, unknown> }[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }

    // Tokenize all documents
    const documentTerms = new Map<string, string[]>();
    const termFrequency = new Map<string, number>();
    const documentFrequency = new Map<string, number>();

    for (const doc of documents) {
      const terms = tokenizeText(doc.text, this.config.useStemming);
      documentTerms.set(doc.id, terms);

      // Count term frequencies
      const docTermSet = new Set(terms);
      for (const term of terms) {
        termFrequency.set(term, (termFrequency.get(term) || 0) + 1);
      }

      // Count document frequencies
      for (const term of docTermSet) {
        documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
      }
    }

    // Filter vocabulary based on document frequency
    const totalDocs = documents.length;
    const vocabulary = Array.from(documentFrequency.entries())
      .filter(([term, df]) => {
        const tf = termFrequency.get(term) || 0;
        return tf >= this.config.minTermFreq &&
               df >= this.config.minDocFreq &&
               df / totalDocs <= this.config.maxDocFreq;
      })
      .sort((a, b) => b[1] - a[1]) // Sort by document frequency
      .slice(0, this.config.maxVocabSize)
      .map(([term]) => term);

    // Store TF-IDF metrics
    this.tfidfMetrics = {
      termFrequency,
      documentFrequency,
      vocabulary,
      totalDocuments: totalDocs
    };

    // Calculate TF-IDF vectors for all documents
    this.documents.clear();
    for (const doc of documents) {
      const terms = documentTerms.get(doc.id) || [];
      const vector = calculateTFIDF(
        terms,
        vocabulary,
        documentFrequency,
        totalDocs
      );

      this.documents.set(doc.id, {
        id: doc.id,
        vector,
        terms,
        ...(doc.metadata ? { metadata: doc.metadata } : {})
      });
    }
  }

  /**
   * Search for similar documents using multiple similarity metrics
   */
  async searchSimilar(
    query: string,
    options: {
      limit?: number;
      minSimilarity?: number;
      weights?: {
        tfidf?: number;
        ngram?: number;
        jaccard?: number;
      };
      aiHints?: {
        relatedTerms?: string[];
        context?: string;
        weights?: Record<string, number>;
      };
    } = {}
  ): Promise<SimilarityResult[]> {
    if (!this.tfidfMetrics || this.documents.size === 0) {
      return [];
    }

    const {
      limit = 10,
      minSimilarity = 0.1,
      weights = { tfidf: 0.5, ngram: 0.3, jaccard: 0.2 },
      aiHints
    } = options;

    // Expand query with AI hints
    let expandedQuery = query;
    if (aiHints?.relatedTerms) {
      expandedQuery += ' ' + aiHints.relatedTerms.join(' ');
    }
    if (aiHints?.context) {
      expandedQuery += ' ' + aiHints.context;
    }

    // Tokenize query
    const queryTerms = tokenizeText(expandedQuery, this.config.useStemming);
    const queryVector = calculateTFIDF(
      queryTerms,
      this.tfidfMetrics.vocabulary,
      this.tfidfMetrics.documentFrequency,
      this.tfidfMetrics.totalDocuments
    );

    // Generate n-grams for query
    const queryNgrams = new Set(generateNgrams(query, this.config.ngramSize));
    const queryTermSet = new Set(queryTerms);

    // Calculate similarities
    const results: SimilarityResult[] = [];

    for (const [docId, docVector] of this.documents) {
      // TF-IDF cosine similarity
      const tfidfSim = calculateCosineSimilarity(queryVector, docVector.vector);

      // N-gram similarity
      const docNgrams = new Set(generateNgrams(docVector.terms.join(' '), this.config.ngramSize));
      const ngramSim = calculateJaccardSimilarity(queryNgrams, docNgrams);

      // Jaccard similarity on terms
      const docTermSet = new Set(docVector.terms);
      const jaccardSim = calculateJaccardSimilarity(queryTermSet, docTermSet);

      // Combined similarity score
      let combinedSim = 
        (tfidfSim * (weights.tfidf || 0.5)) +
        (ngramSim * (weights.ngram || 0.3)) +
        (jaccardSim * (weights.jaccard || 0.2));

      // Apply AI hints weighting
      if (aiHints?.weights) {
        for (const term of docVector.terms) {
          if (aiHints.weights[term]) {
            combinedSim *= (1 + aiHints.weights[term]);
          }
        }
      }

      if (combinedSim >= minSimilarity) {
        // Find matched terms for explanation
        const matchedTerms = docVector.terms.filter(term => 
          queryTerms.includes(term) || 
          (aiHints?.relatedTerms && aiHints.relatedTerms.includes(term))
        );

        results.push({
          id: docId,
          similarity: combinedSim,
          explanation: `TF-IDF: ${tfidfSim.toFixed(3)}, N-gram: ${ngramSim.toFixed(3)}, Jaccard: ${jaccardSim.toFixed(3)}`,
          matchedTerms
        });
      }
    }

    // Sort by similarity and return top results
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  /**
   * Get similarity metrics for analysis
   */
  getMetrics(): {
    vocabularySize: number;
    documentCount: number;
    averageTermsPerDocument: number;
    topTerms: Array<{ term: string; frequency: number }>;
  } {
    if (!this.tfidfMetrics) {
      return {
        vocabularySize: 0,
        documentCount: 0,
        averageTermsPerDocument: 0,
        topTerms: []
      };
    }

    const totalTerms = Array.from(this.documents.values())
      .reduce((sum, doc) => sum + doc.terms.length, 0);

    const topTerms = Array.from(this.tfidfMetrics.termFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([term, frequency]) => ({ term, frequency }));

    return {
      vocabularySize: this.tfidfMetrics.vocabulary.length,
      documentCount: this.documents.size,
      averageTermsPerDocument: this.documents.size > 0 ? totalTerms / this.documents.size : 0,
      topTerms
    };
  }

  /**
   * Clear all indexed documents
   */
  clear(): void {
    this.documents.clear();
    this.tfidfMetrics = null;
  }
}
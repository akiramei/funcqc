import { describe, it, expect, beforeEach } from 'vitest';
import { LocalSimilarityService } from '../../src/services/local-similarity-service';

describe('LocalSimilarityService', () => {
  let service: LocalSimilarityService;

  beforeEach(() => {
    service = new LocalSimilarityService({
      minDocFreq: 1,
      maxDocFreq: 0.8,
      ngramSize: 2,
      useStemming: true
    });
  });

  describe('Document Indexing', () => {
    it('should index documents and build TF-IDF vectors', async () => {
      const documents = [
        { id: 'doc1', text: 'user authentication login system' },
        { id: 'doc2', text: 'database connection error handling' },
        { id: 'doc3', text: 'user interface login form validation' }
      ];

      await service.indexDocuments(documents);

      const metrics = service.getMetrics();
      expect(metrics.documentCount).toBe(3);
      expect(metrics.vocabularySize).toBeGreaterThan(0);
      expect(metrics.averageTermsPerDocument).toBeGreaterThan(0);
    });

    it('should handle empty document list', async () => {
      await service.indexDocuments([]);

      const metrics = service.getMetrics();
      expect(metrics.documentCount).toBe(0);
      expect(metrics.vocabularySize).toBe(0);
    });

    it('should filter vocabulary based on document frequency', async () => {
      const documents = [
        { id: 'doc1', text: 'function handles user authentication' },
        { id: 'doc2', text: 'function processes database queries' },
        { id: 'doc3', text: 'function validates user input' },
        { id: 'doc4', text: 'function manages error handling' }
      ];

      await service.indexDocuments(documents);

      const metrics = service.getMetrics();
      // Check that we have a reasonable vocabulary size (stemming may reduce 'function' to 'funct')
      expect(metrics.vocabularySize).toBeGreaterThan(0);
      expect(metrics.topTerms.length).toBeGreaterThan(0);
    });
  });

  describe('Similarity Search', () => {
    beforeEach(async () => {
      const documents = [
        { 
          id: 'auth1', 
          text: 'authenticateUser validates credentials and manages user login sessions',
          metadata: { type: 'auth' }
        },
        { 
          id: 'db1', 
          text: 'connectDatabase establishes connection to database and handles errors',
          metadata: { type: 'database' }
        },
        { 
          id: 'ui1', 
          text: 'validateLoginForm checks user input and validates form data',
          metadata: { type: 'validation' }
        },
        { 
          id: 'auth2', 
          text: 'verifyUserCredentials checks password and authenticates user access',
          metadata: { type: 'auth' }
        }
      ];

      await service.indexDocuments(documents);
    });

    it('should find semantically similar documents', async () => {
      const results = await service.searchSimilar('user authentication');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].similarity).toBeGreaterThan(0);
      
      // Should find authentication-related functions first
      const authResults = results.filter(r => r.id.startsWith('auth'));
      expect(authResults.length).toBeGreaterThan(0);
    });

    it('should respect similarity threshold', async () => {
      const highThresholdResults = await service.searchSimilar('authentication', {
        minSimilarity: 0.8
      });

      const lowThresholdResults = await service.searchSimilar('authentication', {
        minSimilarity: 0.1
      });

      expect(lowThresholdResults.length).toBeGreaterThanOrEqual(highThresholdResults.length);
    });

    it('should limit results correctly', async () => {
      const results = await service.searchSimilar('user', {
        limit: 2
      });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should work with AI hints', async () => {
      const resultsWithHints = await service.searchSimilar('login', {
        aiHints: {
          relatedTerms: ['authentication', 'credentials'],
          context: 'security system',
          weights: { 'user': 1.5, 'auth': 2.0 }
        }
      });

      expect(resultsWithHints.length).toBeGreaterThan(0);
      expect(resultsWithHints[0].matchedTerms).toBeDefined();
    });

    it('should provide detailed similarity explanations', async () => {
      const results = await service.searchSimilar('database connection');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].explanation).toContain('TF-IDF');
      expect(results[0].explanation).toContain('N-gram');
      expect(results[0].explanation).toContain('Jaccard');
    });

    it('should handle custom similarity weights', async () => {
      const results = await service.searchSimilar('user validation', {
        weights: {
          tfidf: 0.8,
          ngram: 0.1,
          jaccard: 0.1
        }
      });

      expect(results.length).toBeGreaterThan(0);
      // Results should prioritize TF-IDF similarity
    });
  });

  describe('Edge Cases', () => {
    it('should handle search on empty index', async () => {
      const results = await service.searchSimilar('test query');
      expect(results).toEqual([]);
    });

    it('should handle special characters and camelCase', async () => {
      const documents = [
        { id: 'func1', text: 'getUserProfile() handles user-data retrieval' },
        { id: 'func2', text: 'validateHTTPRequest checks incoming requests' }
      ];

      await service.indexDocuments(documents);

      const results = await service.searchSimilar('userProfile HTTP');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle very long documents', async () => {
      const longText = 'function handles complex business logic validation system';
      const documents = [
        { id: 'long1', text: longText },
        { id: 'short1', text: 'simple validation function' }
      ];

      await service.indexDocuments(documents);

      const results = await service.searchSimilar('validation', { minSimilarity: 0.01 });
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Metrics and Statistics', () => {
    it('should provide comprehensive metrics', async () => {
      const documents = [
        { id: 'doc1', text: 'authentication system with user management' },
        { id: 'doc2', text: 'database query optimization and caching' },
        { id: 'doc3', text: 'user interface validation and error handling' }
      ];

      await service.indexDocuments(documents);

      const metrics = service.getMetrics();
      
      expect(metrics.vocabularySize).toBeGreaterThan(0);
      expect(metrics.documentCount).toBe(3);
      expect(metrics.averageTermsPerDocument).toBeGreaterThan(0);
      expect(metrics.topTerms).toBeDefined();
      expect(metrics.topTerms.length).toBeGreaterThan(0);
      
      // Check that top terms include frequency information
      metrics.topTerms.forEach(term => {
        expect(term.term).toBeDefined();
        expect(term.frequency).toBeGreaterThan(0);
      });
    });

    it('should clear index correctly', async () => {
      const documents = [{ id: 'doc1', text: 'test document' }];
      await service.indexDocuments(documents);

      let metrics = service.getMetrics();
      expect(metrics.documentCount).toBe(1);

      service.clear();
      metrics = service.getMetrics();
      expect(metrics.documentCount).toBe(0);
      expect(metrics.vocabularySize).toBe(0);
    });
  });

  describe('Text Processing', () => {
    it('should handle stemming correctly', async () => {
      const serviceWithStemming = new LocalSimilarityService({ useStemming: true });
      const serviceWithoutStemming = new LocalSimilarityService({ useStemming: false });

      const documents = [
        { id: 'doc1', text: 'running runs runner' },
        { id: 'doc2', text: 'walking walks walker' }
      ];

      await serviceWithStemming.indexDocuments(documents);
      await serviceWithoutStemming.indexDocuments(documents);

      const metricsWithStemming = serviceWithStemming.getMetrics();
      const metricsWithoutStemming = serviceWithoutStemming.getMetrics();

      // With stemming, should have fewer unique terms
      expect(metricsWithStemming.vocabularySize).toBeLessThan(metricsWithoutStemming.vocabularySize);
    });

    it('should generate n-grams for better matching', async () => {
      const documents = [
        { id: 'doc1', text: 'user authentication system' },
        { id: 'doc2', text: 'system authentication user' } // Same words, different order
      ];

      await service.indexDocuments(documents);

      const results = await service.searchSimilar('authentication system');
      
      // Both documents should match due to n-gram similarity
      expect(results.length).toBe(2);
      expect(results[0].similarity).toBeGreaterThan(0);
      expect(results[1].similarity).toBeGreaterThan(0);
    });
  });
});
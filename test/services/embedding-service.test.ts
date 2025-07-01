import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmbeddingService, EMBEDDING_MODELS } from '../../src/services/embedding-service';
import { FunctionInfo } from '../../src/types';

// Mock OpenAI
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      embeddings: {
        create: vi.fn()
      }
    }))
  };
});

describe('EmbeddingService', () => {
  let embeddingService: EmbeddingService;

  beforeEach(() => {
    embeddingService = new EmbeddingService({
      apiKey: 'test-api-key',
      model: 'text-embedding-3-small',
      batchSize: 2
    });
  });

  describe('initialization', () => {
    it('should initialize with default configuration', () => {
      const service = new EmbeddingService();
      expect(service.isInitialized()).toBe(false);
    });

    it('should initialize with API key', () => {
      expect(embeddingService.isInitialized()).toBe(true);
    });

    it('should allow manual initialization', () => {
      const service = new EmbeddingService();
      service.initialize('test-key');
      expect(service.isInitialized()).toBe(true);
    });

    it('should support all embedding models', () => {
      expect(() => new EmbeddingService({ model: 'text-embedding-3-small' })).not.toThrow();
      expect(() => new EmbeddingService({ model: 'text-embedding-3-large' })).not.toThrow();
      expect(() => new EmbeddingService({ model: 'text-embedding-ada-002' })).not.toThrow();
    });

    it('should reject unsupported models', () => {
      expect(() => new EmbeddingService({ model: 'invalid-model' }))
        .toThrow('Unsupported embedding model: invalid-model');
    });

    it('should use text-embedding-3-small as default', () => {
      const service = new EmbeddingService();
      expect((service as any).model).toBe('text-embedding-3-small');
    });
  });

  describe('prepareFunctionText', () => {
    it('should prepare function text correctly', () => {
      const func: FunctionInfo = {
        id: 'test-id',
        semanticId: 'semantic-123',
        contentId: 'content-123',
        name: 'testFunction',
        displayName: 'testFunction',
        signature: 'function testFunction(param: string): void',
        signatureHash: 'sig-hash',
        filePath: 'src/test.ts',
        fileHash: 'file-hash',
        startLine: 10,
        endLine: 15,
        startColumn: 0,
        endColumn: 10,
        astHash: 'ast-hash',
        isExported: true,
        isAsync: false,
        isGenerator: false,
        isArrowFunction: false,
        isMethod: false,
        isConstructor: false,
        isStatic: false,
        parameters: [
          {
            name: 'param',
            type: 'string',
            typeSimple: 'string',
            position: 0,
            isOptional: false,
            isRest: false
          }
        ],
        description: 'A test function'
      };

      // Access the private method for testing
      const text = (embeddingService as any).prepareFunctionText(func);
      
      expect(text).toContain('Primary: A test function'); // Description prioritized
      expect(text).toContain('Function: testFunction');
      expect(text).toContain('Parameters: param: string');
      expect(text).toContain('File: src/test.ts');
    });

    it('should handle function without description', () => {
      const func: FunctionInfo = {
        id: 'test-id',
        semanticId: 'semantic-123',
        contentId: 'content-123',
        name: 'testFunction',
        displayName: 'testFunction',
        signature: 'function testFunction(): void',
        signatureHash: 'sig-hash',
        filePath: 'src/test.ts',
        fileHash: 'file-hash',
        startLine: 10,
        endLine: 15,
        startColumn: 0,
        endColumn: 10,
        astHash: 'ast-hash',
        isExported: false,
        isAsync: false,
        isGenerator: false,
        isArrowFunction: false,
        isMethod: false,
        isConstructor: false,
        isStatic: false,
        parameters: [],
        jsDoc: '/**\n * Test function\n * @returns void\n */'
      };

      const text = (embeddingService as any).prepareFunctionText(func);
      
      expect(text).toContain('Function: testFunction');
      expect(text).toContain('Documentation: Test function');
      expect(text).not.toContain('Primary:'); // No description, so no "Primary:"
    });
  });

  describe('similarity calculations', () => {
    it('should calculate cosine similarity correctly', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [0, 1, 0];
      const vec3 = [1, 0, 0];

      expect(EmbeddingService.cosineSimilarity(vec1, vec2)).toBe(0);
      expect(EmbeddingService.cosineSimilarity(vec1, vec3)).toBe(1);
    });

    it('should calculate euclidean distance correctly', () => {
      const vec1 = [0, 0];
      const vec2 = [3, 4];

      expect(EmbeddingService.euclideanDistance(vec1, vec2)).toBe(5);
    });

    it('should throw error for different vector dimensions', () => {
      const vec1 = [1, 2];
      const vec2 = [1, 2, 3];

      expect(() => EmbeddingService.cosineSimilarity(vec1, vec2))
        .toThrow('Vectors must have the same dimension');
      
      expect(() => EmbeddingService.euclideanDistance(vec1, vec2))
        .toThrow('Vectors must have the same dimension');
    });
  });

  describe('JSDoc cleaning', () => {
    it('should clean JSDoc comments correctly', () => {
      const jsDoc = '/**\n * Test function\n * @param {string} input - Input parameter\n * @returns {string} Output\n */';
      
      const cleaned = (embeddingService as any).cleanJsDoc(jsDoc);
      
      expect(cleaned).toContain('Test function');
      expect(cleaned).toContain('input:'); // Check for parameter processing
      expect(cleaned).toContain('Returns: Output');
      expect(cleaned).not.toContain('/**');
      expect(cleaned).not.toContain('*/');
      expect(cleaned).not.toContain('@param');
    });
  });

  describe('error handling', () => {
    it('should throw error when not initialized for generateEmbedding', async () => {
      const uninitializedService = new EmbeddingService();
      
      await expect(uninitializedService.generateEmbedding('test'))
        .rejects.toThrow('OpenAI client not initialized');
    });

    it('should throw error when not initialized for batchGenerateEmbeddings', async () => {
      const uninitializedService = new EmbeddingService();
      
      await expect(uninitializedService.batchGenerateEmbeddings(['test']))
        .rejects.toThrow('OpenAI client not initialized');
    });
  });
});
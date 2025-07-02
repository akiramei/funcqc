import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { FunctionInfo } from '../../../src/types';
import {
  EnhancedEmbeddingService,
  EmbeddingServiceFactory,
  EmbeddingModel,
  EnhancedEmbeddingConfig
} from '../../../src/services/embedding';

// Mock the OpenAI client
vi.mock('openai', () => ({
  default: class MockOpenAI {
    embeddings = {
      create: vi.fn()
    };
  }
}));

describe('EnhancedEmbeddingService', () => {
  let service: EnhancedEmbeddingService;
  let mockFunctions: FunctionInfo[];

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock functions
    mockFunctions = [
      {
        id: 'func1',
        semanticId: 'sem1',
        name: 'testFunction',
        displayName: 'testFunction',
        signature: 'function testFunction(): void',
        filePath: '/test/file.ts',
        startLine: 1,
        endLine: 5,
        isExported: true,
        isAsync: false,
        parameters: [],
        contextPath: [],
        description: 'A test function for unit testing'
      } as FunctionInfo,
      {
        id: 'func2',
        semanticId: 'sem2',
        name: 'anotherFunction',
        displayName: 'anotherFunction',
        signature: 'function anotherFunction(param: string): number',
        filePath: '/test/another.ts',
        startLine: 10,
        endLine: 20,
        isExported: false,
        isAsync: true,
        parameters: [
          {
            name: 'param',
            typeSimple: 'string',
            isOptional: false,
            isRest: false
          }
        ],
        contextPath: ['MyClass'],
        jsDoc: '/**\n * @param param Input parameter\n * @returns A number result\n */',
        description: 'Another test function with parameters'
      } as FunctionInfo
    ];
  });

  describe('Factory and Builder Pattern', () => {
    it('should create service using factory method', () => {
      const service = EmbeddingServiceFactory.createForDevelopment();
      expect(service).toBeInstanceOf(EnhancedEmbeddingService);
    });

    it('should create service using builder pattern', () => {
      const service = EmbeddingServiceFactory.builder()
        .withOpenAIKey('test-key', EmbeddingModel.SMALL_3)
        .forDevelopment()
        .build();
      
      expect(service).toBeInstanceOf(EnhancedEmbeddingService);
    });

    it('should create production-ready service', () => {
      const service = EmbeddingServiceFactory.createForProduction('test-key');
      expect(service).toBeInstanceOf(EnhancedEmbeddingService);
    });
  });

  describe('Service Initialization', () => {
    beforeEach(() => {
      service = new EnhancedEmbeddingService();
    });

    it('should initialize with valid configuration', async () => {
      const config: EnhancedEmbeddingConfig = {
        client: {
          apiKey: 'test-key',
          model: EmbeddingModel.SMALL_3
        },
        vectorStore: {
          algorithm: 'hierarchical',
          clusterCount: 20
        },
        enableANN: true
      };

      await expect(service.initialize(config)).resolves.not.toThrow();
    });

    it('should report readiness correctly', async () => {
      expect(service.isReady()).toBe(false);

      const config: EnhancedEmbeddingConfig = {
        client: {
          apiKey: 'test-key',
          model: EmbeddingModel.SMALL_3
        },
        enableANN: false // Disable ANN for simpler test
      };

      await service.initialize(config);
      expect(service.isReady()).toBe(true);
    });
  });

  describe('Function Text Preparation', () => {
    beforeEach(async () => {
      service = new EnhancedEmbeddingService();
      await service.initialize({
        client: {
          apiKey: 'test-key',
          model: EmbeddingModel.SMALL_3
        },
        enableANN: false
      });
    });

    it('should prepare text with description priority', () => {
      // Access private method for testing
      const prepareFunctionText = (service as any).prepareFunctionText.bind(service);
      const text = prepareFunctionText(mockFunctions[0]);
      
      expect(text).toContain('Primary: A test function for unit testing');
      expect(text).toContain('Function: testFunction');
      expect(text).toContain('Signature: function testFunction(): void');
    });

    it('should handle JSDoc when no description exists', () => {
      const funcWithoutDesc = { ...mockFunctions[1] };
      delete funcWithoutDesc.description;
      
      const prepareFunctionText = (service as any).prepareFunctionText.bind(service);
      const text = prepareFunctionText(funcWithoutDesc);
      
      expect(text).toContain('Documentation:');
      expect(text).toContain('param Input parameter');
    });

    it('should include parameter information', () => {
      const prepareFunctionText = (service as any).prepareFunctionText.bind(service);
      const text = prepareFunctionText(mockFunctions[1]);
      
      expect(text).toContain('Parameters: param: string');
      expect(text).toContain('Context: MyClass');
    });
  });

  describe('Statistics and Monitoring', () => {
    beforeEach(async () => {
      service = new EnhancedEmbeddingService();
      await service.initialize({
        client: {
          apiKey: 'test-key',
          model: EmbeddingModel.SMALL_3
        },
        enableANN: true
      });
    });

    it('should provide comprehensive statistics', () => {
      const stats = service.getStats();
      
      expect(stats).toHaveProperty('client');
      expect(stats).toHaveProperty('vectorStore');
      expect(stats).toHaveProperty('service');
      
      expect(stats.service).toHaveProperty('enableANN', true);
      expect(stats.service).toHaveProperty('ready');
    });

    it('should track service metrics', () => {
      const stats = service.getStats();
      
      expect(stats.service).toHaveProperty('totalFunctionsProcessed', 0);
      expect(stats.service).toHaveProperty('totalSearches', 0);
      expect(stats.service).toHaveProperty('errors', 0);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      service = new EnhancedEmbeddingService();
    });

    it('should handle initialization errors gracefully', async () => {
      const invalidConfig: EnhancedEmbeddingConfig = {
        client: {
          // Missing API key
          model: EmbeddingModel.SMALL_3
        }
      };

      // Should not throw during construction
      expect(() => new EnhancedEmbeddingService(invalidConfig)).not.toThrow();
    });

    it('should throw error when accessing uninitialized client', async () => {
      await expect(
        service.generateFunctionEmbeddings(mockFunctions)
      ).rejects.toThrow('Embeddings client not initialized');
    });

    it('should throw error for search without initialized client', async () => {
      await expect(
        service.semanticSearch('test query', [])
      ).rejects.toThrow('Embeddings client not initialized');
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain interface compatibility with original service', () => {
      const service = new EnhancedEmbeddingService();
      
      // Check that all expected methods exist
      expect(typeof service.generateFunctionEmbeddings).toBe('function');
      expect(typeof service.buildIndex).toBe('function');
      expect(typeof service.addToIndex).toBe('function');
      expect(typeof service.semanticSearch).toBe('function');
      expect(typeof service.isReady).toBe('function');
    });

    it('should work with existing configuration patterns', async () => {
      // Test that old-style configuration still works
      const config: EnhancedEmbeddingConfig = {
        enableANN: true,
        client: {
          apiKey: 'test-key'
        }
      };

      expect(() => new EnhancedEmbeddingService(config)).not.toThrow();
    });
  });

  describe('Builder Pattern Advanced Usage', () => {
    it('should allow method chaining', () => {
      const builder = EmbeddingServiceFactory.builder()
        .withOpenAIKey('test-key')
        .withANN(true)
        .forProduction();
      
      expect(builder).toBeDefined();
      expect(() => builder.build()).not.toThrow();
    });

    it('should provide separate development and production configurations', () => {
      const devService = EmbeddingServiceFactory.builder()
        .forDevelopment()
        .build();
      
      const prodService = EmbeddingServiceFactory.builder()
        .forProduction()
        .build();
      
      const devStats = devService.getStats();
      const prodStats = prodService.getStats();
      
      // Production should have more aggressive caching and buffering
      expect(prodStats.vectorStore).toBeDefined();
      expect(devStats.vectorStore).toBeDefined();
    });
  });
});
/**
 * Unit tests for VectorizeOptionsValidator
 */

import { describe, it, expect } from 'vitest';
import { VectorizeOptionsValidator } from '../../src/use-cases/vectorize-options';

describe('VectorizeOptionsValidator', () => {
  const validator = new VectorizeOptionsValidator();

  describe('validate', () => {
    it('should accept valid options with recent mode', () => {
      const result = validator.validate({
        recent: true,
        model: 'text-embedding-3-small',
        batchSize: 50
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.recent).toBe(true);
      expect(result.data?.model).toBe('text-embedding-3-small');
      expect(result.data?.batchSize).toBe(50);
    });

    it('should accept valid options with all mode', () => {
      const result = validator.validate({
        all: true,
        model: 'text-embedding-3-large',
        force: true
      });

      expect(result.success).toBe(true);
      expect(result.data?.all).toBe(true);
      expect(result.data?.force).toBe(true);
    });

    it('should reject mutual exclusion of --all and --recent', () => {
      const result = validator.validate({
        all: true,
        recent: true
      });

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.[0]).toContain('Cannot specify multiple operation modes');
    });

    it('should reject invalid embedding model', () => {
      const result = validator.validate({
        recent: true,
        model: 'invalid-model'
      });

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should reject invalid ANN algorithm', () => {
      const result = validator.validate({
        recent: true,
        indexAlgorithm: 'invalid-algorithm'
      });

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should reject invalid batch size', () => {
      const result = validator.validate({
        recent: true,
        batchSize: 0
      });

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should default to recent mode when no operation mode specified', () => {
      const result = validator.validate({
        model: 'text-embedding-3-small',
        batchSize: 100
      });

      expect(result.success).toBe(true);
      expect(result.data?.recent).toBe(true);
      expect(result.data?.all).toBeUndefined();
      expect(result.data?.status).toBeUndefined();
    });

    it('should coerce string numbers to numbers', () => {
      const result = validator.validate({
        recent: true,
        batchSize: '50',
        limit: '100'
      });

      expect(result.success).toBe(true);
      expect(result.data?.batchSize).toBe(50);
      expect(result.data?.limit).toBe(100);
    });
  });

  describe('parseIndexConfig', () => {
    it('should parse valid JSON configuration', () => {
      const config = validator.parseIndexConfig('{"clusters": 10, "hashBits": 16}');
      
      expect(config).toEqual({
        clusters: 10,
        hashBits: 16
      });
    });

    it('should return null for undefined config', () => {
      const config = validator.parseIndexConfig(undefined);
      expect(config).toBe(null);
    });

    it('should throw error for invalid JSON', () => {
      expect(() => {
        validator.parseIndexConfig('invalid json');
      }).toThrow('Invalid index configuration JSON');
    });

    it('should validate config structure', () => {
      expect(() => {
        validator.parseIndexConfig('{"invalidField": "value"}');
      }).toThrow('Invalid index configuration JSON');
    });
  });

  describe('requiresApiKey', () => {
    it('should return true for --all operation', () => {
      const requires = validator.requiresApiKey({ 
        all: true, 
        model: 'text-embedding-3-small',
        batchSize: 100,
        indexAlgorithm: 'hierarchical',
        output: 'console'
      });
      expect(requires).toBe(true);
    });

    it('should return true for --recent operation', () => {
      const requires = validator.requiresApiKey({ 
        recent: true,
        model: 'text-embedding-3-small',
        batchSize: 100,
        indexAlgorithm: 'hierarchical',
        output: 'console'
      });
      expect(requires).toBe(true);
    });

    it('should return false for --status operation', () => {
      const requires = validator.requiresApiKey({ 
        status: true,
        model: 'text-embedding-3-small',
        batchSize: 100,
        indexAlgorithm: 'hierarchical',
        output: 'console'
      });
      expect(requires).toBe(false);
    });
  });

  describe('isDangerousOperation', () => {
    it('should return true for --all operation', () => {
      const isDangerous = validator.isDangerousOperation({ 
        all: true,
        model: 'text-embedding-3-small',
        batchSize: 100,
        indexAlgorithm: 'hierarchical',
        output: 'console'
      });
      expect(isDangerous).toBe(true);
    });

    it('should return false for --recent operation', () => {
      const isDangerous = validator.isDangerousOperation({ 
        recent: true,
        model: 'text-embedding-3-small',
        batchSize: 100,
        indexAlgorithm: 'hierarchical',
        output: 'console'
      });
      expect(isDangerous).toBe(false);
    });
  });

  describe('getOperationDescription', () => {
    it('should return correct description for --all', () => {
      const description = validator.getOperationDescription({ 
        all: true,
        model: 'text-embedding-3-small',
        batchSize: 100,
        indexAlgorithm: 'hierarchical',
        output: 'console'
      });
      expect(description).toContain('Re-vectorize ALL functions');
    });

    it('should return correct description for --recent', () => {
      const description = validator.getOperationDescription({ 
        recent: true,
        model: 'text-embedding-3-small',
        batchSize: 100,
        indexAlgorithm: 'hierarchical',
        output: 'console'
      });
      expect(description).toContain('Vectorize functions without embeddings');
    });

    it('should return correct description for --status', () => {
      const description = validator.getOperationDescription({ 
        status: true,
        model: 'text-embedding-3-small',
        batchSize: 100,
        indexAlgorithm: 'hierarchical',
        output: 'console'
      });
      expect(description).toContain('Show vectorization status');
    });
  });
});
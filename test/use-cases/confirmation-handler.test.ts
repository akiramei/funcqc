/**
 * Unit tests for ConfirmationHandler
 */

import { describe, it, expect } from 'vitest';
import { ConfirmationHandler } from '../../src/use-cases/confirmation-handler';

describe('ConfirmationHandler', () => {
  const handler = new ConfirmationHandler();

  describe('estimateEmbeddingCost', () => {
    it('should calculate cost for text-embedding-3-small', () => {
      const cost = handler.estimateEmbeddingCost(1000, 'text-embedding-3-small', 200);
      
      // 1000 functions * 200 tokens = 200,000 tokens
      // 200,000 / 1000 * 0.00002 = $0.004
      expect(cost).toBeCloseTo(0.004, 6);
    });

    it('should calculate cost for text-embedding-3-large', () => {
      const cost = handler.estimateEmbeddingCost(500, 'text-embedding-3-large', 300);
      
      // 500 functions * 300 tokens = 150,000 tokens
      // 150,000 / 1000 * 0.00013 = $0.0195
      expect(cost).toBeCloseTo(0.0195, 6);
    });

    it('should use default model for unknown models', () => {
      const cost = handler.estimateEmbeddingCost(100, 'unknown-model', 100);
      const expectedCost = handler.estimateEmbeddingCost(100, 'text-embedding-3-small', 100);
      
      expect(cost).toBe(expectedCost);
    });

    it('should handle zero functions', () => {
      const cost = handler.estimateEmbeddingCost(0, 'text-embedding-3-small', 200);
      expect(cost).toBe(0);
    });

    it('should use default token count when not specified', () => {
      const cost = handler.estimateEmbeddingCost(100, 'text-embedding-3-small');
      
      // Should use default 200 tokens per function
      const expectedCost = handler.estimateEmbeddingCost(100, 'text-embedding-3-small', 200);
      expect(cost).toBe(expectedCost);
    });
  });

  describe('createVectorizeConfirmationMessage', () => {
    it('should create message with operation only', () => {
      const message = handler.createVectorizeConfirmationMessage('Test operation');
      
      expect(message).toContain('⚠️  Test operation');
      expect(message).toContain('Do you want to continue?');
    });

    it('should include function count when provided', () => {
      const message = handler.createVectorizeConfirmationMessage(
        'Re-vectorize all functions', 
        500
      );
      
      expect(message).toContain('This will process 500 functions');
    });

    it('should include estimated cost when provided', () => {
      const message = handler.createVectorizeConfirmationMessage(
        'Re-vectorize all functions',
        1000,
        0.025
      );
      
      expect(message).toContain('Estimated cost: ~$0.025');
    });

    it('should include both count and cost when provided', () => {
      const message = handler.createVectorizeConfirmationMessage(
        'Re-vectorize all functions',
        750,
        0.015
      );
      
      expect(message).toContain('This will process 750 functions');
      expect(message).toContain('Estimated cost: ~$0.015');
      expect(message).toContain('Do you want to continue?');
    });

    it('should not show cost when it is zero', () => {
      const message = handler.createVectorizeConfirmationMessage(
        'Test operation',
        100,
        0
      );
      
      expect(message).toContain('This will process 100 functions');
      expect(message).not.toContain('Estimated cost');
    });
  });
});
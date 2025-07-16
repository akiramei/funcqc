import { describe, expect, it } from 'vitest';
import { CallGraphAnalyzer } from '../src/analyzers/call-graph-analyzer';

describe('CallGraphAnalyzer Basic Tests', () => {
  it('should create CallGraphAnalyzer instance', () => {
    const analyzer = new CallGraphAnalyzer(false); // Disable cache for tests
    expect(analyzer).toBeDefined();
  });

  it('should have cache statistics method', () => {
    const analyzer = new CallGraphAnalyzer(false);
    const stats = analyzer.getCacheStats();
    expect(stats).toBeDefined();
  });

  it('should have clear cache method', () => {
    const analyzer = new CallGraphAnalyzer(false);
    expect(() => analyzer.clearCache()).not.toThrow();
  });
});
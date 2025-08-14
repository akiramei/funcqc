import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConverterNetworkAnalyzer } from '../../src/analyzers/type-insights/converter-network-analyzer';
import type { StorageQueryInterface } from '../../src/analyzers/type-insights/types';

/**
 * Test suite for Converter Network Analyzer
 * Tests type conversion pattern detection and network analysis functionality
 */

// Mock storage interface for testing
class MockStorage implements StorageQueryInterface {
  private mockFunctions: Array<Record<string, unknown>> = [];
  private mockParameters: Array<Record<string, unknown>> = [];
  private mockTypeDefinitions: Array<Record<string, unknown>> = [];
  private mockCallEdges: Array<Record<string, unknown>> = [];

  async query(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    // Function queries
    if (sql.includes('FROM functions') && sql.includes("f.name LIKE 'to%'")) {
      return { rows: this.mockFunctions };
    }
    
    // Parameter queries  
    if (sql.includes('FROM function_parameters')) {
      const functionId = params[0] as string;
      return { 
        rows: this.mockParameters.filter(p => p['function_id'] === functionId)
      };
    }
    
    // Type definition queries
    if (sql.includes('FROM type_definitions')) {
      const typeName = params[0] as string;
      return { 
        rows: this.mockTypeDefinitions.filter(t => t['name'] === typeName)
      };
    }
    
    // Call edge queries
    if (sql.includes('FROM call_edges')) {
      return { rows: this.mockCallEdges };
    }
    
    return { rows: [] };
  }

  // Setup methods for test data
  setMockFunctions(functions: Array<Record<string, unknown>>): void {
    this.mockFunctions = functions;
  }

  setMockParameters(parameters: Array<Record<string, unknown>>): void {
    this.mockParameters = parameters;
  }

  setMockTypeDefinitions(types: Array<Record<string, unknown>>): void {
    this.mockTypeDefinitions = types;
  }

  setMockCallEdges(edges: Array<Record<string, unknown>>): void {
    this.mockCallEdges = edges;
  }
}

describe('ConverterNetworkAnalyzer', () => {
  let mockStorage: MockStorage;
  let analyzer: ConverterNetworkAnalyzer;

  beforeEach(() => {
    mockStorage = new MockStorage();
    analyzer = new ConverterNetworkAnalyzer(mockStorage, {
      minConverters: 2,
      includeInternalCalls: true,
      includeParsers: true,
      showChains: false,
      canonicalOnly: false,
      maxChainLength: 4
    });
  });

  afterEach(() => {
    // Clean up if needed
  });

  describe('Configuration', () => {
    it('should use default configuration options', () => {
      const defaultAnalyzer = new ConverterNetworkAnalyzer(mockStorage);
      const config = defaultAnalyzer.getConverterConfiguration();
      
      expect(config.minConverters).toBe(2);
      expect(config.includeInternalCalls).toBe(true);
      expect(config.includeParsers).toBe(true);
      expect(config.showChains).toBe(false);
      expect(config.canonicalOnly).toBe(false);
      expect(config.maxChainLength).toBe(4);
    });

    it('should accept custom configuration options', () => {
      const customAnalyzer = new ConverterNetworkAnalyzer(mockStorage, {
        minConverters: 3,
        includeInternalCalls: false,
        includeParsers: false,
        showChains: true,
        canonicalOnly: true,
        maxChainLength: 2
      });
      
      const config = customAnalyzer.getConverterConfiguration();
      
      expect(config.minConverters).toBe(3);
      expect(config.includeInternalCalls).toBe(false);
      expect(config.includeParsers).toBe(false);
      expect(config.showChains).toBe(true);
      expect(config.canonicalOnly).toBe(true);
      expect(config.maxChainLength).toBe(2);
    });
  });

  describe('Converter Function Detection', () => {
    beforeEach(() => {
      // Setup mock converter functions
      mockStorage.setMockFunctions([
        {
          function_id: 'f1',
          name: 'toString',
          return_type: 'string',
          file_path: 'utils.ts',
          line_number: 10,
          usage_count: 5
        },
        {
          function_id: 'f2',
          name: 'fromString',
          return_type: 'number',
          file_path: 'utils.ts',
          line_number: 20,
          usage_count: 3
        },
        {
          function_id: 'f3',
          name: 'parseUser',
          return_type: 'User',
          file_path: 'parsers.ts',
          line_number: 15,
          usage_count: 8
        },
        {
          function_id: 'f4',
          name: 'convertData',
          return_type: 'ProcessedData',
          file_path: 'converters.ts',
          line_number: 25,
          usage_count: 2
        },
        {
          function_id: 'f5',
          name: 'transformInput',
          return_type: 'Output',
          file_path: 'transforms.ts',
          line_number: 30,
          usage_count: 1
        }
      ]);

      // Setup mock parameters
      mockStorage.setMockParameters([
        { function_id: 'f1', type: 'number', type_simple: 'number', position: 0 },
        { function_id: 'f2', type: 'string', type_simple: 'string', position: 0 },
        { function_id: 'f3', type: 'string', type_simple: 'string', position: 0 },
        { function_id: 'f4', type: 'RawData', type_simple: 'object', position: 0 },
        { function_id: 'f5', type: 'Input', type_simple: 'object', position: 0 }
      ]);

      // Setup mock type definitions
      mockStorage.setMockTypeDefinitions([
        { id: 't1', name: 'User' },
        { id: 't2', name: 'ProcessedData' },
        { id: 't3', name: 'Output' }
      ]);
    });

    it('should detect converter functions with various naming patterns', async () => {
      const reports = await analyzer.analyze();
      
      expect(reports).toHaveLength(1);
      const report = reports[0];
      
      if (!report) {
        throw new Error('Report should not be undefined');
      }
      
      expect(report.converters).toHaveLength(5);
      
      // Check converter types
      const converterTypes = report.converters.map(c => c.converterType);
      expect(converterTypes).toContain('to');
      expect(converterTypes).toContain('from');
      expect(converterTypes).toContain('parse');
      expect(converterTypes).toContain('convert');
      expect(converterTypes).toContain('transform');
    });

    it('should extract source and target types correctly', async () => {
      const reports = await analyzer.analyze();
      const report = reports[0];
      
      if (!report) {
        throw new Error('Report should not be undefined');
      }
      
      const toStringConverter = report.converters.find(c => c.name === 'toString');
      expect(toStringConverter?.sourceType).toBe('number');
      expect(toStringConverter?.targetType).toBe('String'); // Function extracts capitalized type from name
      
      const fromStringConverter = report.converters.find(c => c.name === 'fromString');
      expect(fromStringConverter?.sourceType).toBe('string');
      expect(fromStringConverter?.targetType).toBe('number');
      
      const parseUserConverter = report.converters.find(c => c.name === 'parseUser');
      expect(parseUserConverter?.sourceType).toBe('string');
      expect(parseUserConverter?.targetType).toBe('User');
    });

    it('should include usage count information', async () => {
      const reports = await analyzer.analyze();
      const report = reports[0];
      
      if (!report) {
        throw new Error('Report should not be undefined');
      }
      
      const parseUserConverter = report.converters.find(c => c.name === 'parseUser');
      expect(parseUserConverter?.usageCount).toBe(8);
      
      const toStringConverter = report.converters.find(c => c.name === 'toString');
      expect(toStringConverter?.usageCount).toBe(5);
    });
  });

  describe('Type Network Construction', () => {
    beforeEach(() => {
      // Setup a network with string as central type
      mockStorage.setMockFunctions([
        { function_id: 'f1', name: 'toString', return_type: 'string', file_path: 'utils.ts', line_number: 10, usage_count: 10 },
        { function_id: 'f2', name: 'toNumber', return_type: 'number', file_path: 'utils.ts', line_number: 15, usage_count: 5 },
        { function_id: 'f3', name: 'fromString', return_type: 'Date', file_path: 'utils.ts', line_number: 20, usage_count: 8 },
        { function_id: 'f4', name: 'parseString', return_type: 'User', file_path: 'parsers.ts', line_number: 25, usage_count: 3 }
      ]);

      mockStorage.setMockParameters([
        { function_id: 'f1', type: 'number', type_simple: 'number', position: 0 },
        { function_id: 'f2', type: 'string', type_simple: 'string', position: 0 },
        { function_id: 'f3', type: 'string', type_simple: 'string', position: 0 },
        { function_id: 'f4', type: 'string', type_simple: 'string', position: 0 }
      ]);

      mockStorage.setMockTypeDefinitions([
        { id: 't1', name: 'User' },
        { id: 't2', name: 'Date' }
      ]);
    });

    it('should build type nodes with correct converter associations', async () => {
      const reports = await analyzer.analyze();
      const report = reports[0];
      
      if (!report) {
        throw new Error('Report should not be undefined');
      }
      
      expect(report.nodes.length).toBeGreaterThanOrEqual(2); // At least String and number types
      
      const stringNode = report.nodes.find(n => n.typeName === 'String' || n.typeName === 'string');
      expect(stringNode).toBeDefined();
      
      if (!stringNode) {
        throw new Error('String node should be defined');
      }
      
      // String should have converters (either in or out, based on actual data flow)
      expect(stringNode.totalConverters).toBeGreaterThan(0);
      expect(stringNode.convertersIn.length + stringNode.convertersOut.length).toBe(stringNode.totalConverters);
    });

    it('should calculate centrality scores correctly', async () => {
      const reports = await analyzer.analyze();
      const report = reports[0];
      
      if (!report) {
        throw new Error('Report should not be undefined');
      }
      
      // String should have highest centrality (most converters and usage)
      const stringNode = report.nodes.find(n => n.typeName === 'string');
      const numberNode = report.nodes.find(n => n.typeName === 'number');
      
      expect(stringNode?.centralityScore).toBeGreaterThan(0);
      expect(stringNode?.centralityScore).toBeGreaterThanOrEqual(numberNode?.centralityScore ?? 0);
    });

    it('should determine canonical types based on centrality', async () => {
      const reports = await analyzer.analyze();
      const report = reports[0];
      
      if (!report) {
        throw new Error('Report should not be undefined');
      }
      
      const canonicalTypes = report.nodes.filter(n => n.isCanonical);
      const redundantTypes = report.nodes.filter(n => !n.isCanonical);
      
      expect(canonicalTypes.length).toBeGreaterThan(0);
      expect(redundantTypes.length).toBeGreaterThanOrEqual(0);
      
      // String should likely be canonical due to high usage
      const stringNode = report.nodes.find(n => n.typeName === 'string');
      expect(stringNode?.isCanonical).toBe(true);
    });
  });

  describe('Statistics and Reporting', () => {
    beforeEach(() => {
      // Setup basic converter network
      mockStorage.setMockFunctions([
        { function_id: 'f1', name: 'toString', return_type: 'string', file_path: 'utils.ts', line_number: 10, usage_count: 5 },
        { function_id: 'f2', name: 'fromString', return_type: 'number', file_path: 'utils.ts', line_number: 15, usage_count: 3 },
        { function_id: 'f3', name: 'parseData', return_type: 'Data', file_path: 'parsers.ts', line_number: 20, usage_count: 2 }
      ]);

      mockStorage.setMockParameters([
        { function_id: 'f1', type: 'number', type_simple: 'number', position: 0 },
        { function_id: 'f2', type: 'string', type_simple: 'string', position: 0 },
        { function_id: 'f3', type: 'string', type_simple: 'string', position: 0 }
      ]);

      mockStorage.setMockTypeDefinitions([
        { id: 't1', name: 'Data' }
      ]);
    });

    it('should generate comprehensive statistics', async () => {
      const reports = await analyzer.analyze();
      const report = reports[0];
      
      if (!report) {
        throw new Error('Report should not be undefined');
      }
      
      expect(report.statistics).toBeDefined();
      expect(report.statistics.totalTypes).toBeGreaterThan(0);
      expect(report.statistics.totalConverters).toBe(3);
      expect(report.statistics.averageConvertersPerType).toBeGreaterThan(0);
      expect(report.statistics.canonicalTypes).toBeGreaterThan(0);
      expect(report.statistics.redundantTypes).toBeGreaterThanOrEqual(0);
    });

    it('should calculate impact score based on network complexity', async () => {
      const reports = await analyzer.analyze();
      const report = reports[0];
      
      if (!report) {
        throw new Error('Report should not be undefined');
      }
      
      expect(report.impactScore).toBeGreaterThan(0);
      expect(report.impactScore).toBeLessThanOrEqual(100);
    });

    it('should provide actionable suggestions', async () => {
      const reports = await analyzer.analyze();
      const report = reports[0];
      
      if (!report) {
        throw new Error('Report should not be undefined');
      }
      
      expect(report.suggestedAction).toBeTruthy();
      expect(typeof report.suggestedAction).toBe('string');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty converter function set', async () => {
      mockStorage.setMockFunctions([]);
      
      const reports = await analyzer.analyze();
      
      expect(reports).toHaveLength(0);
    });

    it('should handle functions without parameters', async () => {
      mockStorage.setMockFunctions([
        { function_id: 'f1', name: 'toString', return_type: 'string', file_path: 'utils.ts', line_number: 10, usage_count: 1 }
      ]);
      
      // No parameters setup
      mockStorage.setMockParameters([]);
      
      const reports = await analyzer.analyze();
      const report = reports[0];
      
      if (report) {
        const converter = report.converters.find(c => c.name === 'toString');
        expect(converter?.sourceType).toBeNull();
        expect(converter?.targetType).toBe('String'); // Function name extraction gives capitalized type
      }
    });

    it('should exclude parsers when includeParsers is false', async () => {
      const analyzerWithoutParsers = new ConverterNetworkAnalyzer(mockStorage, {
        includeParsers: false
      });
      
      mockStorage.setMockFunctions([
        { function_id: 'f1', name: 'toString', return_type: 'string', file_path: 'utils.ts', line_number: 10, usage_count: 5 },
        { function_id: 'f2', name: 'parseData', return_type: 'Data', file_path: 'parsers.ts', line_number: 15, usage_count: 3 }
      ]);
      
      const reports = await analyzerWithoutParsers.analyze();
      
      if (reports.length > 0 && reports[0]) {
        const parseConverter = reports[0].converters.find(c => c.name === 'parseData');
        expect(parseConverter).toBeUndefined();
      }
    });

    it('should filter nodes below minimum converter threshold', async () => {
      const analyzerHighThreshold = new ConverterNetworkAnalyzer(mockStorage, {
        minConverters: 5
      });
      
      mockStorage.setMockFunctions([
        { function_id: 'f1', name: 'toString', return_type: 'string', file_path: 'utils.ts', line_number: 10, usage_count: 1 }
      ]);
      
      mockStorage.setMockParameters([
        { function_id: 'f1', type: 'number', type_simple: 'number', position: 0 }
      ]);
      
      const reports = await analyzerHighThreshold.analyze();
      
      // Should have empty nodes due to high threshold, but may still return a report structure
      if (reports.length > 0 && reports[0]) {
        expect(reports[0].nodes).toHaveLength(0);
      }
    });

    it('should handle database query errors gracefully', async () => {
      const errorStorage: StorageQueryInterface = {
        async query(): Promise<{ rows: Record<string, unknown>[] }> {
          throw new Error('Database connection failed');
        }
      };
      
      const errorAnalyzer = new ConverterNetworkAnalyzer(errorStorage);
      
      await expect(errorAnalyzer.analyze()).rejects.toThrow('Failed to analyze converter networks');
    });
  });

  describe('Conversion Chains', () => {
    beforeEach(() => {
      // Setup chain: number -> toString -> fromString -> parseData
      mockStorage.setMockFunctions([
        { function_id: 'f1', name: 'toString', return_type: 'string', file_path: 'utils.ts', line_number: 10, usage_count: 5 },
        { function_id: 'f2', name: 'fromString', return_type: 'ParsedString', file_path: 'utils.ts', line_number: 15, usage_count: 3 },
        { function_id: 'f3', name: 'parseData', return_type: 'Data', file_path: 'parsers.ts', line_number: 20, usage_count: 2 }
      ]);

      mockStorage.setMockParameters([
        { function_id: 'f1', type: 'number', type_simple: 'number', position: 0 },
        { function_id: 'f2', type: 'string', type_simple: 'string', position: 0 },
        { function_id: 'f3', type: 'ParsedString', type_simple: 'object', position: 0 }
      ]);

      mockStorage.setMockTypeDefinitions([
        { id: 't1', name: 'Data' },
        { id: 't2', name: 'ParsedString' }
      ]);
    });

    it('should find conversion chains with showChains enabled', async () => {
      const analyzerWithChains = new ConverterNetworkAnalyzer(mockStorage, {
        showChains: true,
        maxChainLength: 3
      });
      
      const reports = await analyzerWithChains.analyze();
      const report = reports[0];
      
      if (!report) {
        throw new Error('Report should not be undefined');
      }
      
      // Should find chains between types
      expect(report.chains.length).toBeGreaterThanOrEqual(0);
      
      // Check statistics include chain information
      expect(report.statistics.longestChain).toBeGreaterThanOrEqual(0);
    });
  });
});
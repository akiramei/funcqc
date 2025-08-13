/**
 * Property Slice Miner Tests
 * 
 * Tests for the Property Slice Mining functionality including Apriori algorithm,
 * pattern detection, and Value Object suggestions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PropertySliceMiner } from '../../src/analyzers/type-insights/property-slice-miner';
import type { StorageQueryInterface } from '../../src/analyzers/type-insights/types';

// Mock storage interface for testing
class MockStorage implements StorageQueryInterface {
  private mockData: any[] = [];

  setMockData(data: any[]): void {
    this.mockData = data;
  }

  async query(sql: string, _params?: any[]): Promise<{ rows: any[] }> {
    const s = sql.toLowerCase();
    // Simulate SELECT from type_definitions
    if (s.includes('from type_definitions')) {
      // Deduplicate by type_id
      const byId = new Map<string, any>();
      for (const row of this.mockData) {
        byId.set(row.type_id, row);
      }
      const rows = Array.from(byId.values()).map(r => ({
        id: r.type_id,
        name: r.type_name,
        file_path: r.file_path
      }));
      return { rows };
    }
    // Simulate SELECT from type_members
    if (s.includes('from type_members')) {
      const rows: any[] = [];
      for (const r of this.mockData) {
        try {
          const props: string[] = JSON.parse(r.properties ?? '[]');
          const methods: string[] = JSON.parse(r.methods ?? '[]');
          for (const p of props) {
            rows.push({ type_id: r.type_id, name: p, member_kind: 'property' });
          }
          for (const m of methods) {
            rows.push({ type_id: r.type_id, name: m, member_kind: 'method' });
          }
        } catch {
          // ignore malformed mock rows
        }
      }
      return { rows };
    }
    return { rows: [] };
  }
}

describe('PropertySliceMiner', () => {
  let mockStorage: MockStorage;
  let sliceMiner: PropertySliceMiner;

  beforeEach(() => {
    mockStorage = new MockStorage();
    sliceMiner = new PropertySliceMiner(mockStorage, {
      minSupport: 2,
      minSliceSize: 2,
      maxSliceSize: 4,
      considerMethods: false,
      excludeCommonProperties: false
    });
  });

  describe('Constructor and Configuration', () => {
    it('should initialize with default options', () => {
      const defaultMiner = new PropertySliceMiner(mockStorage);
      const config = defaultMiner.getConfiguration();
      
      expect(config.minSupport).toBe(3);
      expect(config.minConfidence).toBe(0.8);
      expect(config.maxPatternSize).toBe(5);
    });

    it('should accept custom options', () => {
      const customMiner = new PropertySliceMiner(mockStorage, {
        minSupport: 5,
        minSliceSize: 3,
        maxSliceSize: 6,
        considerMethods: true,
        excludeCommonProperties: false
      });
      
      const config = customMiner.getConfiguration();
      expect(config.minSupport).toBe(5);
      expect(config.maxPatternSize).toBe(6);
    });
  });

  describe('Frequent Itemset Mining', () => {
    it('should detect simple property patterns', async () => {
      // Mock data representing types with shared properties
      const mockTypes = [
        {
          type_id: 'type1',
          type_name: 'Order',
          file_path: 'order.ts',
          total_members: 4,
          properties: JSON.stringify(['amount', 'currency', 'date', 'status']),
          methods: JSON.stringify([])
        },
        {
          type_id: 'type2',
          type_name: 'Invoice',
          file_path: 'invoice.ts',
          total_members: 5,
          properties: JSON.stringify(['amount', 'currency', 'customer', 'date', 'paid']),
          methods: JSON.stringify([])
        },
        {
          type_id: 'type3',
          type_name: 'Payment',
          file_path: 'payment.ts',
          total_members: 3,
          properties: JSON.stringify(['amount', 'currency', 'method']),
          methods: JSON.stringify([])
        }
      ];

      mockStorage.setMockData(mockTypes);
      const slices = await sliceMiner.analyze('test-snapshot');

      expect(slices.length).toBeGreaterThan(0);
      
      // Should find {amount, currency} pattern in all 3 types
      const moneyPattern = slices.find(slice => 
        slice.properties.includes('amount') && 
        slice.properties.includes('currency')
      );
      
      expect(moneyPattern).toBeDefined();
      expect(moneyPattern?.support).toBe(3);
      expect(moneyPattern?.suggestedVOName).toBe('Money');
    });

    it('should respect minimum support threshold', async () => {
      const mockTypes = [
        {
          type_id: 'type1',
          type_name: 'TypeA',
          file_path: 'a.ts',
          total_members: 2,
          properties: JSON.stringify(['prop1', 'prop2']),
          methods: JSON.stringify([])
        },
        {
          type_id: 'type2',
          type_name: 'TypeB',
          file_path: 'b.ts',
          total_members: 2,
          properties: JSON.stringify(['prop3', 'prop4']),
          methods: JSON.stringify([])
        }
      ];

      mockStorage.setMockData(mockTypes);
      
      // With minSupport = 2, no patterns should be found (each pattern appears only once)
      const slices = await sliceMiner.analyze('test-snapshot');
      expect(slices.length).toBe(0);
    });

    it('should generate appropriate Value Object names', async () => {
      const mockTypes = [
        {
          type_id: 'type1',
          type_name: 'Person1',
          file_path: 'person1.ts',
          total_members: 3,
          properties: JSON.stringify(['firstName', 'lastName', 'age']),
          methods: JSON.stringify([])
        },
        {
          type_id: 'type2',
          type_name: 'Person2',
          file_path: 'person2.ts',
          total_members: 3,
          properties: JSON.stringify(['firstName', 'lastName', 'email']),
          methods: JSON.stringify([])
        }
      ];

      mockStorage.setMockData(mockTypes);
      const slices = await sliceMiner.analyze('test-snapshot');

      const namePattern = slices.find(slice => 
        slice.properties.includes('firstName') && 
        slice.properties.includes('lastName')
      );
      
      expect(namePattern?.suggestedVOName).toBe('PersonName');
    });
  });

  describe('Extraction Benefit Calculation', () => {
    it('should calculate high benefit for frequent large patterns', async () => {
      const mockTypes = Array.from({ length: 5 }, (_, i) => ({
        type_id: `type${i + 1}`,
        type_name: `Type${i + 1}`,
        file_path: `type${i + 1}.ts`,
        total_members: 4,
        properties: JSON.stringify(['street', 'city', 'state', 'zip']),
        methods: JSON.stringify(['format', 'validate'])
      }));

      // Enable method consideration for this test
      const methodMiner = new PropertySliceMiner(mockStorage, {
        minSupport: 2,
        minSliceSize: 3,
        considerMethods: true
      });

      mockStorage.setMockData(mockTypes);
      const slices = await methodMiner.analyze('test-snapshot');

      const addressPattern = slices.find(slice => 
        slice.properties.includes('street') && 
        slice.properties.includes('city')
      );
      
      expect(addressPattern?.extractionBenefit).toBe('high');
      expect(addressPattern?.support).toBe(5);
    });

    it('should calculate medium benefit for moderate patterns', async () => {
      const mockTypes = [
        {
          type_id: 'type1',
          type_name: 'Event',
          file_path: 'event.ts',
          total_members: 3,
          properties: JSON.stringify(['start', 'end', 'title']),
          methods: JSON.stringify([])
        },
        {
          type_id: 'type2',
          type_name: 'Booking',
          file_path: 'booking.ts',
          total_members: 3,
          properties: JSON.stringify(['start', 'end', 'user']),
          methods: JSON.stringify([])
        },
        {
          type_id: 'type3',
          type_name: 'Schedule',
          file_path: 'schedule.ts',
          total_members: 3,
          properties: JSON.stringify(['start', 'end', 'resource']),
          methods: JSON.stringify([])
        }
      ];

      mockStorage.setMockData(mockTypes);
      const slices = await sliceMiner.analyze('test-snapshot');

      const dateRangePattern = slices.find(slice => 
        slice.properties.includes('start') && 
        slice.properties.includes('end')
      );
      
      expect(dateRangePattern?.extractionBenefit).toBeOneOf(['medium', 'high']);
      expect(dateRangePattern?.suggestedVOName).toBe('DateRange');
    });
  });

  describe('Report Generation', () => {
    it('should generate comprehensive analysis report', async () => {
      const mockTypes = [
        {
          type_id: 'type1',
          type_name: 'Product',
          file_path: 'product.ts',
          total_members: 4,
          properties: JSON.stringify(['name', 'price', 'currency', 'stock']),
          methods: JSON.stringify([])
        },
        {
          type_id: 'type2',
          type_name: 'Service',
          file_path: 'service.ts',
          total_members: 3,
          properties: JSON.stringify(['name', 'price', 'currency']),
          methods: JSON.stringify([])
        }
      ];

      mockStorage.setMockData(mockTypes);
      const report = await sliceMiner.generateReport('test-snapshot');

      expect(report).toHaveProperty('totalSlices');
      expect(report).toHaveProperty('highValueSlices');
      expect(report).toHaveProperty('mediumValueSlices');
      expect(report).toHaveProperty('lowValueSlices');
      expect(report).toHaveProperty('estimatedCodeReduction');
      expect(report).toHaveProperty('recommendations');

      expect(Array.isArray(report.recommendations)).toBe(true);
      expect(typeof report.estimatedCodeReduction).toBe('number');
    });

    it('should provide actionable recommendations', async () => {
      const mockTypes = Array.from({ length: 6 }, (_, i) => ({
        type_id: `type${i + 1}`,
        type_name: `Type${i + 1}`,
        file_path: `type${i + 1}.ts`,
        total_members: 3,
        properties: JSON.stringify(['amount', 'currency', 'description']),
        methods: JSON.stringify([])
      }));

      mockStorage.setMockData(mockTypes);
      const report = await sliceMiner.generateReport('test-snapshot');

      expect(report.recommendations.length).toBeGreaterThan(0);
      
      // Should recommend high priority extraction for frequent patterns
      const hasHighPriorityRec = report.recommendations.some(rec => 
        rec.includes('High Priority') || rec.includes('high')
      );
      expect(hasHighPriorityRec).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty type data', async () => {
      mockStorage.setMockData([]);
      const slices = await sliceMiner.analyze('test-snapshot');
      expect(slices).toEqual([]);
    });

    it('should handle types with no shared properties', async () => {
      const mockTypes = [
        {
          type_id: 'type1',
          type_name: 'TypeA',
          file_path: 'a.ts',
          total_members: 2,
          properties: JSON.stringify(['uniqueA1', 'uniqueA2']),
          methods: JSON.stringify([])
        },
        {
          type_id: 'type2',
          type_name: 'TypeB',
          file_path: 'b.ts',
          total_members: 2,
          properties: JSON.stringify(['uniqueB1', 'uniqueB2']),
          methods: JSON.stringify([])
        }
      ];

      mockStorage.setMockData(mockTypes);
      const slices = await sliceMiner.analyze('test-snapshot');
      expect(slices.length).toBe(0);
    });

    it('should handle types with only common properties when excluded', async () => {
      const excludingMiner = new PropertySliceMiner(mockStorage, {
        minSupport: 2,
        excludeCommonProperties: true
      });

      const mockTypes = [
        {
          type_id: 'type1',
          type_name: 'TypeA',
          file_path: 'a.ts',
          total_members: 2,
          properties: JSON.stringify(['id', 'name']),
          methods: JSON.stringify([])
        },
        {
          type_id: 'type2',
          type_name: 'TypeB',
          file_path: 'b.ts',
          total_members: 2,
          properties: JSON.stringify(['id', 'name']),
          methods: JSON.stringify([])
        }
      ];

      mockStorage.setMockData(mockTypes);
      const slices = await excludingMiner.analyze('test-snapshot');
      expect(slices.length).toBe(0);
    });
  });

  describe('Performance Considerations', () => {
    it('should handle larger datasets efficiently', async () => {
      // Generate 20 types with overlapping property patterns
      const mockTypes = Array.from({ length: 20 }, (_, i) => ({
        type_id: `type${i + 1}`,
        type_name: `Type${i + 1}`,
        file_path: `type${i + 1}.ts`,
        total_members: 5,
        properties: JSON.stringify([
          'common1', 'common2', 
          `unique${i}_1`, `unique${i}_2`, `unique${i}_3`
        ]),
        methods: JSON.stringify([])
      }));

      mockStorage.setMockData(mockTypes);
      
      const startTime = Date.now();
      const slices = await sliceMiner.analyze('test-snapshot');
      const endTime = Date.now();

      // Should complete within reasonable time (< 1 second for 20 types)
      expect(endTime - startTime).toBeLessThan(1000);
      expect(slices.length).toBeGreaterThan(0);
    });
  });
});
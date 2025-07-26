/**
 * LRU Cache Performance Comparison
 * 
 * Compare custom LRUCache vs npm lru-cache package
 */

import { LRUCache as CustomLRUCache } from '../src/utils/lru-cache';
import { LRUCache as NodeLRUCache } from 'lru-cache';

interface TestData {
  id: string;
  content: string;
  size: number;
}

function generateTestData(count: number): TestData[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `test-${i}`,
    content: `content-${i}`.repeat(100), // Simulate file content
    size: Math.floor(Math.random() * 1000) + 100
  }));
}

async function benchmarkCache(cacheName: string, cache: any, testData: TestData[]) {
  const startTime = process.hrtime.bigint();
  const memStart = process.memoryUsage();
  
  // Fill cache
  for (const data of testData) {
    cache.set(data.id, data);
  }
  
  // Access pattern simulation (80% hits, 20% misses)
  const accessCount = testData.length * 2;
  let hits = 0;
  let misses = 0;
  
  for (let i = 0; i < accessCount; i++) {
    const key = Math.random() < 0.8 
      ? testData[Math.floor(Math.random() * testData.length)].id  // Hit
      : `miss-${i}`;  // Miss
      
    const result = cache.get(key);
    if (result) hits++; else misses++;
  }
  
  const endTime = process.hrtime.bigint();
  const memEnd = process.memoryUsage();
  
  const durationMs = Number(endTime - startTime) / 1_000_000;
  const memoryDeltaMB = (memEnd.heapUsed - memStart.heapUsed) / 1024 / 1024;
  
  return {
    cacheName,
    durationMs: Math.round(durationMs * 100) / 100,
    memoryDeltaMB: Math.round(memoryDeltaMB * 100) / 100,
    hits,
    misses,
    hitRate: Math.round((hits / (hits + misses)) * 100 * 100) / 100,
    opsPerMs: Math.round((accessCount / durationMs) * 100) / 100
  };
}

async function runBenchmark() {
  console.log('🚀 LRU Cache Performance Benchmark');
  console.log('=====================================');
  
  const testSizes = [100, 500, 1000, 5000];
  
  for (const size of testSizes) {
    console.log(`\n📊 Testing with ${size} entries:`);
    console.log('─'.repeat(50));
    
    const testData = generateTestData(size);
    
    // Test custom LRU cache
    const customCache = new CustomLRUCache<TestData>({
      maxSize: Math.floor(size * 0.8), // 80% of data fits in cache
      onEvict: () => {} // No cleanup needed for test
    });
    
    const customResult = await benchmarkCache('Custom LRUCache', customCache, testData);
    
    // Test npm lru-cache
    const nodeCache = new NodeLRUCache<string, TestData>({
      max: Math.floor(size * 0.8)
    });
    
    const nodeResult = await benchmarkCache('npm lru-cache', nodeCache, testData);
    
    // Display results
    console.log(`${customResult.cacheName}:`);
    console.log(`  Duration: ${customResult.durationMs}ms`);
    console.log(`  Memory: ${customResult.memoryDeltaMB}MB`);
    console.log(`  Hit Rate: ${customResult.hitRate}%`);
    console.log(`  Ops/ms: ${customResult.opsPerMs}`);
    
    console.log(`${nodeResult.cacheName}:`);
    console.log(`  Duration: ${nodeResult.durationMs}ms`);
    console.log(`  Memory: ${nodeResult.memoryDeltaMB}MB`);
    console.log(`  Hit Rate: ${nodeResult.hitRate}%`);
    console.log(`  Ops/ms: ${nodeResult.opsPerMs}`);
    
    // Performance comparison
    const speedupRatio = nodeResult.durationMs / customResult.durationMs;
    const memoryRatio = nodeResult.memoryDeltaMB / customResult.memoryDeltaMB;
    
    console.log(`📈 Performance Comparison:`);
    console.log(`  Speed: Custom is ${speedupRatio.toFixed(2)}x faster`);
    console.log(`  Memory: Custom uses ${(1/memoryRatio).toFixed(2)}x less memory`);
  }
}

// Export for use in tests
export { runBenchmark };

// Run if called directly
if (require.main === module) {
  runBenchmark().catch(console.error);
}
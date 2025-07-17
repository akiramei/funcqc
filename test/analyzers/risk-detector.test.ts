import { describe, it, expect, beforeEach } from 'vitest';
import { RiskDetector } from '../../src/analyzers/risk-detector';
import { FunctionInfo, CallEdge } from '../../src/types';
import { DependencyMetrics } from '../../src/analyzers/dependency-metrics';

describe('RiskDetector', () => {
  let detector: RiskDetector;
  let mockFunctions: FunctionInfo[];
  let mockCallEdges: CallEdge[];
  let mockMetrics: DependencyMetrics[];

  beforeEach(() => {
    detector = new RiskDetector();
    
    // Mock functions
    mockFunctions = [
      {
        id: 'func1',
        name: 'simpleWrapper',
        filePath: '/test/file1.ts',
        startLine: 1,
        endLine: 5,
        parameters: [{ name: 'param1', type: 'string' }],
        returnType: 'string',
        exported: false,
        async: false,
        metrics: {
          cyclomaticComplexity: 1,
          cognitiveComplexity: 1,
          linesOfCode: 3,
          halsteadVolume: 10,
          maintainabilityIndex: 90,
          maxNestingDepth: 1,
        },
      },
      {
        id: 'func2',
        name: 'wrappedFunction',
        filePath: '/test/file1.ts',
        startLine: 10,
        endLine: 20,
        parameters: [{ name: 'param1', type: 'string' }],
        returnType: 'string',
        exported: true,
        async: false,
        metrics: {
          cyclomaticComplexity: 5,
          cognitiveComplexity: 3,
          linesOfCode: 15,
          halsteadVolume: 50,
          maintainabilityIndex: 70,
          maxNestingDepth: 2,
        },
      },
      {
        id: 'func3',
        name: 'complexFunction',
        filePath: '/test/file2.ts',
        startLine: 1,
        endLine: 50,
        parameters: [
          { name: 'param1', type: 'string' },
          { name: 'param2', type: 'number' },
          { name: 'param3', type: 'boolean' },
        ],
        returnType: 'void',
        exported: true,
        async: false,
        metrics: {
          cyclomaticComplexity: 25,
          cognitiveComplexity: 30,
          linesOfCode: 80,
          halsteadVolume: 200,
          maintainabilityIndex: 20,
          maxNestingDepth: 5,
        },
      },
      {
        id: 'func4',
        name: 'isolatedFunction',
        filePath: '/test/file3.ts',
        startLine: 1,
        endLine: 10,
        parameters: [],
        returnType: 'void',
        exported: false,
        async: false,
        metrics: {
          cyclomaticComplexity: 2,
          cognitiveComplexity: 1,
          linesOfCode: 8,
          halsteadVolume: 15,
          maintainabilityIndex: 85,
          maxNestingDepth: 1,
        },
      },
    ];

    // Mock call edges
    mockCallEdges = [
      {
        callerFunctionId: 'func1',
        calleeFunctionId: 'func2',
        calleeName: 'wrappedFunction',
        callType: 'direct',
        lineNumber: 3,
        callContext: 'normal',
      },
    ];

    // Mock metrics
    mockMetrics = [
      {
        functionId: 'func1',
        functionName: 'simpleWrapper',
        filePath: '/test/file1.ts',
        fanIn: 0,
        fanOut: 1,
        depthFromEntry: 1,
        isCyclic: false,
        isEntryPoint: false,
        isIsolated: false,
      },
      {
        functionId: 'func2',
        functionName: 'wrappedFunction',
        filePath: '/test/file1.ts',
        fanIn: 1,
        fanOut: 0,
        depthFromEntry: 2,
        isCyclic: false,
        isEntryPoint: false,
        isIsolated: false,
      },
      {
        functionId: 'func3',
        functionName: 'complexFunction',
        filePath: '/test/file2.ts',
        fanIn: 5,
        fanOut: 10,
        depthFromEntry: 1,
        isCyclic: false,
        isEntryPoint: true,
        isIsolated: false,
      },
      {
        functionId: 'func4',
        functionName: 'isolatedFunction',
        filePath: '/test/file3.ts',
        fanIn: 0,
        fanOut: 0,
        depthFromEntry: -1,
        isCyclic: false,
        isEntryPoint: false,
        isIsolated: true,
      },
    ];
  });

  describe('analyzeRisks', () => {
    it('should detect wrapper functions', () => {
      const result = detector.analyzeRisks(mockFunctions, mockCallEdges, mockMetrics);
      
      const wrapperPatterns = result.patterns.filter(p => p.type === 'wrapper');
      expect(wrapperPatterns).toHaveLength(1);
      
      const wrapper = wrapperPatterns[0];
      expect(wrapper.functionId).toBe('func1');
      expect(wrapper.functionName).toBe('simpleWrapper');
      expect(wrapper.severity).toMatch(/^(high|medium|low)$/);
      expect(wrapper.score).toBeGreaterThan(0);
    });

    it('should detect complexity hotspots', () => {
      const result = detector.analyzeRisks(mockFunctions, mockCallEdges, mockMetrics);
      
      const hotspotPatterns = result.patterns.filter(p => p.type === 'complexity-hotspot');
      expect(hotspotPatterns).toHaveLength(1);
      
      const hotspot = hotspotPatterns[0];
      expect(hotspot.functionId).toBe('func3');
      expect(hotspot.functionName).toBe('complexFunction');
      expect(hotspot.severity).toBe('high');
    });

    it('should detect isolated functions when enabled', () => {
      const detectorWithIsolated = new RiskDetector({ includeIsolated: true });
      const result = detectorWithIsolated.analyzeRisks(mockFunctions, mockCallEdges, mockMetrics);
      
      const isolatedPatterns = result.patterns.filter(p => p.type === 'isolated');
      expect(isolatedPatterns).toHaveLength(1);
      
      const isolated = isolatedPatterns[0];
      expect(isolated.functionId).toBe('func4');
      expect(isolated.functionName).toBe('isolatedFunction');
    });

    it('should not detect isolated functions when disabled', () => {
      const detectorWithoutIsolated = new RiskDetector({ includeIsolated: false });
      const result = detectorWithoutIsolated.analyzeRisks(mockFunctions, mockCallEdges, mockMetrics);
      
      const isolatedPatterns = result.patterns.filter(p => p.type === 'isolated');
      expect(isolatedPatterns).toHaveLength(0);
    });

    it('should generate proper summary', () => {
      const result = detector.analyzeRisks(mockFunctions, mockCallEdges, mockMetrics);
      
      expect(result.summary).toBeDefined();
      expect(result.summary.totalRisks).toBeGreaterThan(0);
      expect(result.summary.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.summary.riskScore).toBeLessThanOrEqual(100);
    });

    it('should generate recommendations', () => {
      const result = detector.analyzeRisks(mockFunctions, mockCallEdges, mockMetrics);
      
      expect(result.recommendations).toBeDefined();
      expect(Array.isArray(result.recommendations)).toBe(true);
    });
  });

  describe('fake split detection', () => {
    it('should detect fake split patterns in clustered functions', () => {
      // Create a cluster of small, tightly coupled functions
      const clusteredFunctions: FunctionInfo[] = [
        {
          id: 'cluster1',
          name: 'handleUserInput',
          filePath: '/test/cluster.ts',
          startLine: 1,
          endLine: 15,
          parameters: [{ name: 'input', type: 'string' }],
          returnType: 'void',
          exported: false,
          async: false,
          metrics: {
            cyclomaticComplexity: 3,
            cognitiveComplexity: 2,
            linesOfCode: 12,
            halsteadVolume: 20,
            maintainabilityIndex: 70,
            maxNestingDepth: 2,
          },
        },
        {
          id: 'cluster2',
          name: 'handleUserValidation',
          filePath: '/test/cluster.ts',
          startLine: 20,
          endLine: 35,
          parameters: [{ name: 'input', type: 'string' }],
          returnType: 'boolean',
          exported: false,
          async: false,
          metrics: {
            cyclomaticComplexity: 4,
            cognitiveComplexity: 3,
            linesOfCode: 14,
            halsteadVolume: 25,
            maintainabilityIndex: 65,
            maxNestingDepth: 2,
          },
        },
        {
          id: 'cluster3',
          name: 'handleUserProcessing',
          filePath: '/test/cluster.ts',
          startLine: 40,
          endLine: 55,
          parameters: [{ name: 'input', type: 'string' }],
          returnType: 'string',
          exported: false,
          async: false,
          metrics: {
            cyclomaticComplexity: 5,
            cognitiveComplexity: 4,
            linesOfCode: 16,
            halsteadVolume: 30,
            maintainabilityIndex: 60,
            maxNestingDepth: 3,
          },
        },
      ];

      const clusteredCallEdges: CallEdge[] = [
        {
          callerFunctionId: 'cluster1',
          calleeFunctionId: 'cluster2',
          calleeName: 'handleUserValidation',
          callType: 'direct',
          lineNumber: 10,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'cluster1',
          calleeFunctionId: 'cluster3',
          calleeName: 'handleUserProcessing',
          callType: 'direct',
          lineNumber: 12,
          callContext: 'normal',
        },
        {
          callerFunctionId: 'cluster2',
          calleeFunctionId: 'cluster3',
          calleeName: 'handleUserProcessing',
          callType: 'direct',
          lineNumber: 30,
          callContext: 'normal',
        },
      ];

      const clusteredMetrics: DependencyMetrics[] = [
        {
          functionId: 'cluster1',
          functionName: 'handleUserInput',
          filePath: '/test/cluster.ts',
          fanIn: 0,
          fanOut: 2,
          depthFromEntry: 1,
          isCyclic: false,
          isEntryPoint: true,
          isIsolated: false,
        },
        {
          functionId: 'cluster2',
          functionName: 'handleUserValidation',
          filePath: '/test/cluster.ts',
          fanIn: 2,
          fanOut: 1,
          depthFromEntry: 2,
          isCyclic: false,
          isEntryPoint: false,
          isIsolated: false,
        },
        {
          functionId: 'cluster3',
          functionName: 'handleUserProcessing',
          filePath: '/test/cluster.ts',
          fanIn: 2,
          fanOut: 0,
          depthFromEntry: 3,
          isCyclic: false,
          isEntryPoint: false,
          isIsolated: false,
        },
      ];

      const result = detector.analyzeRisks(clusteredFunctions, clusteredCallEdges, clusteredMetrics);
      
      const fakeSplitPatterns = result.patterns.filter(p => p.type === 'fake-split');
      expect(fakeSplitPatterns.length).toBeGreaterThan(0);
      
      // Should detect all functions in the cluster
      expect(fakeSplitPatterns).toHaveLength(3);
      
      const clusterPattern = fakeSplitPatterns[0];
      expect(clusterPattern.details.clusterSize).toBe(3);
      expect(clusterPattern.details.totalComplexity).toBe(12); // 3 + 4 + 5
    });
  });

  describe('configuration options', () => {
    it('should respect wrapper threshold configuration', () => {
      const strictDetector = new RiskDetector({ wrapperThreshold: 0.9 });
      const lenientDetector = new RiskDetector({ wrapperThreshold: 0.5 });
      
      const strictResult = strictDetector.analyzeRisks(mockFunctions, mockCallEdges, mockMetrics);
      const lenientResult = lenientDetector.analyzeRisks(mockFunctions, mockCallEdges, mockMetrics);
      
      const strictWrappers = strictResult.patterns.filter(p => p.type === 'wrapper');
      const lenientWrappers = lenientResult.patterns.filter(p => p.type === 'wrapper');
      
      // Lenient detector should find at least as many wrappers as strict detector
      expect(lenientWrappers.length).toBeGreaterThanOrEqual(strictWrappers.length);
    });

    it('should respect complexity threshold configuration', () => {
      const lowThresholdDetector = new RiskDetector({ complexityHotspotThreshold: 10 });
      const highThresholdDetector = new RiskDetector({ complexityHotspotThreshold: 30 });
      
      const lowThresholdResult = lowThresholdDetector.analyzeRisks(mockFunctions, mockCallEdges, mockMetrics);
      const highThresholdResult = highThresholdDetector.analyzeRisks(mockFunctions, mockCallEdges, mockMetrics);
      
      const lowThresholdHotspots = lowThresholdResult.patterns.filter(p => p.type === 'complexity-hotspot');
      const highThresholdHotspots = highThresholdResult.patterns.filter(p => p.type === 'complexity-hotspot');
      
      // Lower threshold should find at least as many hotspots as higher threshold
      expect(lowThresholdHotspots.length).toBeGreaterThanOrEqual(highThresholdHotspots.length);
    });

    it('should respect minimum function size', () => {
      const smallSizeDetector = new RiskDetector({ minFunctionSize: 1 });
      const largeSizeDetector = new RiskDetector({ minFunctionSize: 10 });
      
      const smallSizeResult = smallSizeDetector.analyzeRisks(mockFunctions, mockCallEdges, mockMetrics);
      const largeSizeResult = largeSizeDetector.analyzeRisks(mockFunctions, mockCallEdges, mockMetrics);
      
      const smallSizeIsolated = smallSizeResult.patterns.filter(p => p.type === 'isolated');
      const largeSizeIsolated = largeSizeResult.patterns.filter(p => p.type === 'isolated');
      
      // Smaller minimum size should find at least as many isolated functions
      expect(smallSizeIsolated.length).toBeGreaterThanOrEqual(largeSizeIsolated.length);
    });
  });
});
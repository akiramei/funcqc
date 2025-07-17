import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { riskAnalyzeCommand, riskSCCCommand, riskScoreCommand } from '../../src/cli/risk';

// Mock all dependencies
vi.mock('../../src/storage/pglite-adapter.js');
vi.mock('../../src/analyzers/risk-detector.js');
vi.mock('../../src/analyzers/scc-analyzer.js');
vi.mock('../../src/analyzers/comprehensive-risk-scorer.js');
vi.mock('../../src/config/risk-config.js');
vi.mock('../../src/analyzers/dependency-metrics.js');
vi.mock('ora');

describe('Risk Analysis CLI Commands', () => {
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;
  let mockEnv: any;

  beforeEach(async () => {
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    // Create mock environment
    mockEnv = {
      storage: {
        getSnapshot: vi.fn().mockResolvedValue({
          id: 'test-snapshot',
          timestamp: new Date(),
          gitCommit: 'test-commit',
          totalFunctions: 10,
          metadataHash: 'test-hash',
        }),
        getLatestSnapshot: vi.fn().mockResolvedValue({
          id: 'latest-snapshot',
          timestamp: new Date(),
          gitCommit: 'latest-commit',
          totalFunctions: 10,
          metadataHash: 'latest-hash',
        }),
        getFunctionsBySnapshot: vi.fn().mockResolvedValue([
          {
            id: 'func1',
            name: 'testFunction',
            filePath: '/test/file.ts',
            startLine: 1,
            endLine: 10,
            parameters: [],
            returnType: 'void',
            exported: false,
            async: false,
            metrics: {
              cyclomaticComplexity: 5,
              cognitiveComplexity: 3,
              linesOfCode: 8,
              halsteadVolume: 20,
              maintainabilityIndex: 70,
              maxNestingDepth: 2,
            },
          },
        ]),
        getCallEdgesBySnapshot: vi.fn().mockResolvedValue([]),
      },
      commandLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    };

    // Mock ora
    const { default: ora } = await import('ora');
    (ora as any).mockReturnValue({
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
      text: '',
    });
  });

  afterEach(() => {
    mockConsoleLog.mockRestore();
    vi.clearAllMocks();
  });

  describe('riskAnalyzeCommand', () => {
    it('should create command function with valid options', () => {
      const options = {
        config: './test-config.yaml',
        format: 'json' as const,
        severity: 'high' as const,
        pattern: 'wrapper' as const,
        limit: '10',
        minScore: '50',
        includeRecommendations: true,
        groupBy: 'severity' as const,
        snapshot: 'test-snapshot',
      };

      const command = riskAnalyzeCommand(options);
      expect(command).toBeInstanceOf(Function);
    });

    it('should handle table format option', () => {
      const options = {
        format: 'table' as const,
      };

      const command = riskAnalyzeCommand(options);
      expect(command).toBeInstanceOf(Function);
    });

    it('should handle all severity levels', () => {
      const severityLevels = ['critical', 'high', 'medium', 'low'] as const;
      
      for (const severity of severityLevels) {
        const options = { severity };
        const command = riskAnalyzeCommand(options);
        expect(command).toBeInstanceOf(Function);
      }
    });

    it('should handle all pattern types', () => {
      const patterns = ['wrapper', 'fake-split', 'complexity-hotspot', 'isolated', 'circular'] as const;
      
      for (const pattern of patterns) {
        const options = { pattern };
        const command = riskAnalyzeCommand(options);
        expect(command).toBeInstanceOf(Function);
      }
    });

    it('should handle all groupBy options', () => {
      const groupByOptions = ['severity', 'file', 'pattern', 'score'] as const;
      
      for (const groupBy of groupByOptions) {
        const options = { groupBy };
        const command = riskAnalyzeCommand(options);
        expect(command).toBeInstanceOf(Function);
      }
    });
  });

  describe('riskSCCCommand', () => {
    it('should create command function with valid options', () => {
      const options = {
        format: 'json' as const,
        minSize: '2',
        includeRecursive: true,
        showMetrics: true,
        snapshot: 'test-snapshot',
      };

      const command = riskSCCCommand(options);
      expect(command).toBeInstanceOf(Function);
    });

    it('should handle table format option', () => {
      const options = {
        format: 'table' as const,
      };

      const command = riskSCCCommand(options);
      expect(command).toBeInstanceOf(Function);
    });

    it('should handle boolean options', () => {
      const options = {
        includeRecursive: false,
        showMetrics: false,
      };

      const command = riskSCCCommand(options);
      expect(command).toBeInstanceOf(Function);
    });
  });

  describe('riskScoreCommand', () => {
    it('should create command function with function name', () => {
      const options = {
        functionName: 'testFunction',
        config: './test-config.yaml',
        format: 'json' as const,
        includeFactors: true,
        snapshot: 'test-snapshot',
      };

      const command = riskScoreCommand(options);
      expect(command).toBeInstanceOf(Function);
    });

    it('should create command function with function ID', () => {
      const options = {
        functionId: 'test-func-id',
        format: 'table' as const,
        includeFactors: false,
      };

      const command = riskScoreCommand(options);
      expect(command).toBeInstanceOf(Function);
    });

    it('should handle both format options', () => {
      const formats = ['table', 'json'] as const;
      
      for (const format of formats) {
        const options = { format, functionName: 'test' };
        const command = riskScoreCommand(options);
        expect(command).toBeInstanceOf(Function);
      }
    });
  });

  describe('Command Execution', () => {
    it('should execute risk analyze command without throwing', async () => {
      // Mock the dependencies to return successful results
      const { RiskConfigManager } = await import('../../src/config/risk-config.js');
      const { RiskDetector } = await import('../../src/analyzers/risk-detector.js');
      const { SCCAnalyzer } = await import('../../src/analyzers/scc-analyzer.js');
      const { ComprehensiveRiskScorer } = await import('../../src/analyzers/comprehensive-risk-scorer.js');
      const { DependencyMetricsCalculator } = await import('../../src/analyzers/dependency-metrics.js');

      (RiskConfigManager as any).mockImplementation(() => ({
        load: vi.fn().mockReturnValue({
          scoring: {},
          detection: {
            wrapperDetection: { couplingThreshold: 0.8 },
            fakeSplitDetection: { couplingThreshold: 0.7 },
            complexityHotspots: { cyclomaticThreshold: 15 },
            isolatedFunctions: { minSize: 3, enabled: true },
          },
        }),
      }));

      (RiskDetector as any).mockImplementation(() => ({
        analyzeRisks: vi.fn().mockReturnValue({
          patterns: [],
          summary: { totalRisks: 0, riskScore: 0 },
          recommendations: [],
        }),
      }));

      (SCCAnalyzer as any).mockImplementation(() => ({
        findStronglyConnectedComponents: vi.fn().mockReturnValue({
          components: [],
          totalComponents: 0,
          largestComponentSize: 0,
          recursiveFunctions: [],
          componentMap: new Map(),
        }),
      }));

      (ComprehensiveRiskScorer as any).mockImplementation(() => ({
        assessRisks: vi.fn().mockReturnValue([]),
      }));

      (DependencyMetricsCalculator as any).mockImplementation(() => ({
        calculateMetrics: vi.fn().mockReturnValue([]),
      }));

      const command = riskAnalyzeCommand({ format: 'json' });
      
      // Should not throw an error
      await expect(command(mockEnv)).resolves.not.toThrow();
    });

    it('should execute SCC command without throwing', async () => {
      const { SCCAnalyzer } = await import('../../src/analyzers/scc-analyzer.js');

      (SCCAnalyzer as any).mockImplementation(() => ({
        findStronglyConnectedComponents: vi.fn().mockReturnValue({
          components: [],
          totalComponents: 0,
          largestComponentSize: 0,
          recursiveFunctions: [],
          componentMap: new Map(),
        }),
      }));

      const command = riskSCCCommand({ format: 'json' });
      
      // Should not throw an error
      await expect(command(mockEnv)).resolves.not.toThrow();
    });

    it('should execute score command without throwing', async () => {
      // Mock dependencies for score command
      const { RiskConfigManager } = await import('../../src/config/risk-config.js');
      const { DependencyMetricsCalculator } = await import('../../src/analyzers/dependency-metrics.js');
      const { RiskDetector } = await import('../../src/analyzers/risk-detector.js');
      const { SCCAnalyzer } = await import('../../src/analyzers/scc-analyzer.js');
      const { ComprehensiveRiskScorer } = await import('../../src/analyzers/comprehensive-risk-scorer.js');

      (RiskConfigManager as any).mockImplementation(() => ({
        load: vi.fn().mockReturnValue({ scoring: {} }),
      }));

      (DependencyMetricsCalculator as any).mockImplementation(() => ({
        calculateMetrics: vi.fn().mockReturnValue([
          {
            functionId: 'func1',
            functionName: 'testFunction',
            filePath: '/test/file.ts',
            fanIn: 0,
            fanOut: 0,
            depthFromEntry: 1,
            isCyclic: false,
            isEntryPoint: false,
            isIsolated: false,
          },
        ]),
      }));

      (RiskDetector as any).mockImplementation(() => ({
        analyzeRisks: vi.fn().mockReturnValue({
          patterns: [],
          summary: { totalRisks: 0, riskScore: 0 },
          recommendations: [],
        }),
      }));

      (SCCAnalyzer as any).mockImplementation(() => ({
        findStronglyConnectedComponents: vi.fn().mockReturnValue({
          components: [],
          totalComponents: 0,
          largestComponentSize: 0,
          recursiveFunctions: [],
          componentMap: new Map(),
        }),
      }));

      (ComprehensiveRiskScorer as any).mockImplementation(() => ({
        assessRisks: vi.fn().mockReturnValue([
          {
            functionId: 'func1',
            functionName: 'testFunction',
            filePath: '/test/file.ts',
            overallScore: 50,
            riskLevel: 'medium',
            factors: [],
            patterns: [],
            recommendations: [],
            priority: 50,
          },
        ]),
      }));

      const command = riskScoreCommand({ 
        functionName: 'testFunction',
        format: 'json' 
      });
      
      // Should not throw an error
      await expect(command(mockEnv)).resolves.not.toThrow();
    });
  });
});
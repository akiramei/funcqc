/**
 * CLI Command: funcqc du detect
 * 
 * Detects discriminated union opportunities with comprehensive analysis.
 * This is Step A of the incremental DU transformation approach.
 */

import { Command } from 'commander';
import { PGLiteStorageAdapter } from '../../../storage/pglite-adapter';
import { DUIncrementalDetector } from '../../../analyzers/type-refactoring/du-incremental/detector';
import type { DetectionOptions, DetectionResult, DUPlan } from '../../../analyzers/type-refactoring/du-incremental/types';
import { performance } from 'perf_hooks';
import fs from 'fs/promises';

interface CommandOptions {
  snapshotId?: string;
  targetTypes?: string;
  minCoverage?: string;
  minMutualExclusivity?: string;
  minUsageFrequency?: string;
  maxVariants?: string;
  minVariants?: string;
  excludeProps?: string;
  output?: string;
  format?: string;
  saveJson?: boolean;
  saveHtml?: boolean;
  verbose?: boolean;
}

interface DetectCliResult {
  summary: {
    totalTypes: number;
    candidatesFound: number;
    flagProperties: number;
    mutualExclusionPatterns: number;
    avgCoverageRate: number;
    estimatedEffort: string;
  };
  candidates: Array<{
    typeName: string;
    discriminant: string;
    variants: number;
    coverageRate: number;
    riskLevel: string;
    implementationPriority: 'high' | 'medium' | 'low';
    estimatedReferences: {
      files: number;
      callsites: number;
    };
  }>;
  recommendations: {
    implementationOrder: string[];
    nextSteps: string[];
  };
}

export function createDetectCommand(): Command {
  const cmd = new Command('detect');
  
  cmd
    .description('🔍 Detect discriminated union opportunities (Step A: Detection)')
    .option('--snapshot-id <id>', 'Use specific snapshot for analysis')
    .option('--target-types <types>', 'Comma-separated list of specific types to analyze')
    .option('--min-coverage <number>', 'Minimum coverage threshold (0-1)', '0.8')
    .option('--min-mutual-exclusivity <number>', 'Minimum mutual exclusivity score (0-1)', '0.1')
    .option('--min-usage-frequency <number>', 'Minimum discriminant usage frequency (0-1)', '0.005')
    .option('--max-variants <number>', 'Maximum union variants per type', '8')
    .option('--min-variants <number>', 'Minimum union variants per type', '2')
    .option('--exclude-props <props>', 'Comma-separated properties to exclude', 'id,createdAt,updatedAt')
    .option('--output <format>', 'Output format: table|json|detailed', 'table')
    .option('--format <format>', 'Alias for --output', 'table')
    .option('--save-json [path]', 'Save detailed results as JSON file', false)
    .option('--save-html [path]', 'Save analysis report as HTML file', false)
    .option('--verbose', 'Enable verbose logging', false)
    .action(async (options: CommandOptions) => {
      await executeDetect(options);
    });

  return cmd;
}

export async function executeDetect(options: CommandOptions): Promise<void> {
  const startTime = performance.now();
  
  try {
    // Initialize storage
    const storage = new PGLiteStorageAdapter('.funcqc/funcqc.db');

    if (options.verbose) {
      console.log('🔍 Starting discriminated union detection analysis...');
    }

    // Configure detection options
    const detectionOptions: Partial<DetectionOptions> = {
      minCoverageRate: parseFloat(options.minCoverage || '0.8'),
      minMutualExclusivity: parseFloat(options.minMutualExclusivity || '0.1'),
      minUsageFrequency: parseFloat(options.minUsageFrequency || '0.005'),
      maxVariants: parseInt(options.maxVariants || '8'),
      minVariants: parseInt(options.minVariants || '2'),
      includeRiskAssessment: true,
      includeReferenceAnalysis: true,
      excludeCommonProperties: options.excludeProps?.split(',').map(s => s.trim()) || ['id', 'createdAt', 'updatedAt']
    };

    // Run detection analysis
    const detector = new DUIncrementalDetector(storage, detectionOptions);
    const analysisResult = await detector.detect(options.snapshotId, options.verbose);

    if (options.verbose) {
      console.log(`📊 Analysis complete: ${analysisResult.candidates.length} candidates found`);
    }

    // Filter by target types if specified
    let filteredCandidates = analysisResult.candidates;
    if (options.targetTypes) {
      const targetTypes = options.targetTypes.split(',').map(t => t.trim());
      filteredCandidates = analysisResult.candidates.filter(c =>
        targetTypes.includes(c.typeName)
      );
      
      if (options.verbose) {
        console.log(`🎯 Filtered to ${filteredCandidates.length} target types`);
      }
    }

    // Prepare CLI result
    const cliResult = await prepareCliResult(analysisResult, filteredCandidates);

    // Save files if requested
    if (options.saveJson) {
      await saveJsonReport(analysisResult, options.saveJson);
    }

    if (options.saveHtml) {
      await saveHtmlReport(analysisResult, options.saveHtml);
    }

    // Output results
    const outputFormat = options.format || options.output || 'table';
    await outputResults(cliResult, analysisResult, outputFormat);

    const endTime = performance.now();
    if (options.verbose) {
      console.log(`✅ Detection analysis completed in ${Math.round(endTime - startTime)}ms`);
    }

  } catch (error) {
    console.error(`❌ DU detection failed: ${error instanceof Error ? error.message : String(error)}`);
    if (options.verbose && error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

async function prepareCliResult(fullResult: DetectionResult, filteredCandidates: DUPlan[]): Promise<DetectCliResult> {
  return {
    summary: {
      totalTypes: fullResult.statistics.totalTypesAnalyzed,
      candidatesFound: filteredCandidates.length,
      flagProperties: fullResult.statistics.flagPropertiesFound,
      mutualExclusionPatterns: fullResult.statistics.mutualExclusionPatterns,
      avgCoverageRate: Math.round(fullResult.statistics.avgCoverageRate * 100) / 100,
      estimatedEffort: fullResult.recommendations.estimatedEffort
    },
    candidates: filteredCandidates.map(candidate => {
      const priority: 'high' | 'medium' | 'low' = 
        fullResult.recommendations.highPriority.includes(candidate.typeName) ? 'high' :
        fullResult.recommendations.mediumPriority.includes(candidate.typeName) ? 'medium' : 'low';

      return {
        typeName: candidate.typeName,
        discriminant: candidate.discriminant,
        variants: candidate.variants.length,
        coverageRate: Math.round(candidate.coverage.rate * 100) / 100,
        riskLevel: candidate.risk || 'unknown',
        implementationPriority: priority,
        estimatedReferences: {
          files: candidate.refs?.files || 0,
          callsites: candidate.refs?.callsites || 0
        }
      };
    }),
    recommendations: {
      implementationOrder: fullResult.recommendations.implementationOrder,
      nextSteps: generateNextSteps(fullResult)
    }
  };
}

function generateNextSteps(result: DetectionResult): string[] {
  const steps: string[] = [];

  if (result.candidates.length === 0) {
    steps.push('No discriminated union opportunities found');
    steps.push('Consider adjusting detection thresholds or analyzing more types');
    return steps;
  }

  steps.push(`Found ${result.candidates.length} DU transformation candidates`);
  
  if (result.recommendations.highPriority.length > 0) {
    steps.push(`Start with high-priority types: ${result.recommendations.highPriority.slice(0, 3).join(', ')}`);
    steps.push('Use \'funcqc du plan --type <typename>\' to generate detailed transformation plan');
  }

  if (result.statistics.avgCoverageRate < 0.9) {
    steps.push('Review low-coverage candidates - may require manual data migration');
  }

  steps.push('Run type safety analysis after each transformation');
  steps.push('Consider gradual migration strategy for high-risk types');

  return steps;
}

async function saveJsonReport(result: DetectionResult, outputPath: string | boolean): Promise<void> {
  const filePath = typeof outputPath === 'string' ? outputPath : './du-detection-report.json';
  await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`💾 Detailed JSON report saved to: ${filePath}`);
}

async function saveHtmlReport(result: DetectionResult, outputPath: string | boolean): Promise<void> {
  const filePath = typeof outputPath === 'string' ? outputPath : './du-detection-report.html';
  
  const html = generateHtmlReport(result);
  await fs.writeFile(filePath, html, 'utf8');
  console.log(`📄 HTML report saved to: ${filePath}`);
}

function generateHtmlReport(result: DetectionResult): string {
  const candidates = result.candidates;
  const stats = result.statistics;

  return `<!DOCTYPE html>
<html>
<head>
    <title>DU Detection Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .header { background: #f0f8ff; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
        .metric { background: #fff; border: 1px solid #ddd; padding: 15px; border-radius: 5px; text-align: center; }
        .metric-value { font-size: 24px; font-weight: bold; color: #2563eb; }
        .metric-label { color: #666; font-size: 14px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f8f9fa; font-weight: bold; }
        .risk-low { color: #22c55e; }
        .risk-medium { color: #f59e0b; }
        .risk-high { color: #ef4444; }
        .priority-high { background-color: #fef3c7; }
        .priority-medium { background-color: #e0f2fe; }
        .priority-low { background-color: #f3f4f6; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🏷️ Discriminated Union Detection Report</h1>
        <p>Generated: ${new Date().toLocaleString()}</p>
    </div>

    <div class="summary">
        <div class="metric">
            <div class="metric-value">${stats.totalTypesAnalyzed}</div>
            <div class="metric-label">Types Analyzed</div>
        </div>
        <div class="metric">
            <div class="metric-value">${candidates.length}</div>
            <div class="metric-label">DU Candidates</div>
        </div>
        <div class="metric">
            <div class="metric-value">${stats.flagPropertiesFound}</div>
            <div class="metric-label">Flag Properties</div>
        </div>
        <div class="metric">
            <div class="metric-value">${stats.mutualExclusionPatterns}</div>
            <div class="metric-label">Exclusion Patterns</div>
        </div>
        <div class="metric">
            <div class="metric-value">${(stats.avgCoverageRate * 100).toFixed(1)}%</div>
            <div class="metric-label">Avg Coverage</div>
        </div>
    </div>

    <h2>📋 DU Transformation Candidates</h2>
    <table>
        <thead>
            <tr>
                <th>Type Name</th>
                <th>Discriminant</th>
                <th>Variants</th>
                <th>Coverage</th>
                <th>Risk</th>
                <th>Files</th>
                <th>Priority</th>
            </tr>
        </thead>
        <tbody>
            ${candidates.map(c => {
              const priority = result.recommendations.highPriority.includes(c.typeName) ? 'high' :
                             result.recommendations.mediumPriority.includes(c.typeName) ? 'medium' : 'low';
              return `
            <tr class="priority-${priority}">
                <td><strong>${c.typeName}</strong></td>
                <td><code>${c.discriminant}</code></td>
                <td>${c.variants.length}</td>
                <td>${(c.coverage.rate * 100).toFixed(1)}%</td>
                <td><span class="risk-${c.risk}">${c.risk || 'unknown'}</span></td>
                <td>${c.refs?.files || 0}</td>
                <td>${priority}</td>
            </tr>`;
            }).join('')}
        </tbody>
    </table>

    <h2>💡 Recommendations</h2>
    <ul>
        ${result.recommendations.implementationOrder.slice(0, 5).map(type => 
          `<li><strong>${type}</strong> - Ready for transformation</li>`
        ).join('')}
    </ul>

</body>
</html>`;
}

async function outputResults(cliResult: DetectCliResult, fullResult: DetectionResult, format: string): Promise<void> {
  switch (format) {
    case 'json':
      console.log(JSON.stringify(cliResult, null, 2));
      return;

    case 'detailed':
      outputDetailed(cliResult, fullResult);
      return;

    case 'table':
    default:
      outputTable(cliResult);
      return;
  }
}

function outputTable(result: DetectCliResult): void {
  console.log('\n🏷️  Discriminated Union Detection Results\n');
  
  // Summary table
  console.log('📊 Detection Summary:');
  console.log(`   Types analyzed: ${result.summary.totalTypes}`);
  console.log(`   DU candidates found: ${result.summary.candidatesFound}`);
  console.log(`   Flag properties detected: ${result.summary.flagProperties}`);
  console.log(`   Mutual exclusion patterns: ${result.summary.mutualExclusionPatterns}`);
  console.log(`   Average coverage rate: ${(result.summary.avgCoverageRate * 100).toFixed(1)}%`);
  console.log(`   Estimated implementation effort: ${result.summary.estimatedEffort}`);

  if (result.candidates.length > 0) {
    console.log('\n🏆 Top DU Candidates:');
    console.log('┌─────────────────────┬──────────────┬──────────┬────────────┬────────────┬──────────┬──────────────┐');
    console.log('│ Type Name           │ Discriminant │ Variants │ Coverage   │ Risk       │ Files    │ Priority     │');
    console.log('├─────────────────────┼──────────────┼──────────┼────────────┼────────────┼──────────┼──────────────┤');
    
    result.candidates.slice(0, 10).forEach(candidate => {
      const typeName = candidate.typeName.substring(0, 19);
      const discriminant = candidate.discriminant.substring(0, 12);
      const variants = candidate.variants.toString();
      const coverage = `${(candidate.coverageRate * 100).toFixed(0)}%`;
      const risk = candidate.riskLevel;
      const files = candidate.estimatedReferences.files.toString();
      const priority = candidate.implementationPriority;
      
      console.log(`│ ${typeName.padEnd(19)} │ ${discriminant.padEnd(12)} │ ${variants.padEnd(8)} │ ${coverage.padEnd(10)} │ ${risk.padEnd(10)} │ ${files.padEnd(8)} │ ${priority.padEnd(12)} │`);
    });
    
    console.log('└─────────────────────┴──────────────┴──────────┴────────────┴────────────┴──────────┴──────────────┘');
  }

  // Recommendations
  console.log('\n💡 Implementation Recommendations:');
  if (result.recommendations.implementationOrder.length > 0) {
    console.log(`   Recommended order: ${result.recommendations.implementationOrder.slice(0, 5).join(', ')}`);
  }
  
  console.log('\n📝 Next Steps:');
  result.recommendations.nextSteps.forEach((step, index) => {
    console.log(`   ${index + 1}. ${step}`);
  });
}

function outputDetailed(cliResult: DetectCliResult, fullResult: DetectionResult): void {
  console.log('\n🏷️  Detailed Discriminated Union Detection Report\n');

  // Summary
  outputTable(cliResult);

  // Flag correlations
  if (fullResult.flagCorrelations.length > 0) {
    console.log('\n🔗 Flag Correlations Analysis:');
    console.log('═'.repeat(50));
    
    fullResult.flagCorrelations.slice(0, 10).forEach((correlation, index) => {
      console.log(`\n${index + 1}. ${correlation.propertyA} ↔ ${correlation.propertyB}`);
      console.log(`   Relationship: ${correlation.relationshipType}`);
      console.log(`   φ coefficient: ${correlation.phiCoefficient.toFixed(3)}`);
      console.log(`   Jaccard index: ${correlation.jaccardIndex.toFixed(3)}`);
      console.log(`   Co-occurrences: ${correlation.cooccurrenceCount}/${correlation.totalCount}`);
    });
  }

  // Discriminant candidates
  if (fullResult.discriminantCandidates.length > 0) {
    console.log('\n🎯 Discriminant Candidates:');
    console.log('═'.repeat(50));
    
    fullResult.discriminantCandidates.forEach((candidate, index) => {
      console.log(`\n${index + 1}. ${candidate.propertyName} (${candidate.propertyType})`);
      console.log(`   Usage frequency: ${(candidate.usageFrequency * 100).toFixed(1)}%`);
      console.log(`   Mutual exclusivity: ${(candidate.mutualExclusivity * 100).toFixed(1)}%`);
      console.log(`   Possible values: ${candidate.possibleValues.join(', ')}`);
      console.log(`   Correlated properties: ${candidate.correlatedProperties.join(', ') || 'none'}`);
    });
  }
}
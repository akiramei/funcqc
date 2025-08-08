/**
 * Programming Style Analysis for Health Command
 * Analyzes programming patterns and style distribution across the codebase
 */

import { FunctionInfo } from '../../../types';

export interface ProgrammingStyleDistribution {
  functionStyles: {
    namedFunctions: number;
    arrowFunctions: number;
    methods: number;
    constructors: number;
    getters: number;
    setters: number;
  };
  
  complexityPatterns: {
    simple: number;        // CC 1-3
    moderate: number;      // CC 4-7
    complex: number;       // CC 8-15
    veryComplex: number;   // CC >15
  };
  
  sizeDistribution: {
    tiny: number;         // 1-10 lines
    small: number;        // 11-25 lines
    medium: number;       // 26-50 lines
    large: number;        // 51-100 lines
    huge: number;         // >100 lines
  };
  
  namingPatterns: {
    camelCase: number;
    pascalCase: number;
    snakeCase: number;
    kebabCase: number;
    singleWord: number;
    acronyms: number;
  };
  
  overallStats: {
    totalFunctions: number;
    avgComplexity: number;
    avgLineCount: number;
    mostCommonStyle: string;
    styleConsistency: number; // 0-100%
  };
}

/**
 * Analyze programming style distribution across functions
 */
export function analyzeProgrammingStyleDistribution(functions: FunctionInfo[]): ProgrammingStyleDistribution {
  const functionsWithData = functions.filter(f => f.metrics);
  
  const distribution: ProgrammingStyleDistribution = {
    functionStyles: {
      namedFunctions: 0,
      arrowFunctions: 0,
      methods: 0,
      constructors: 0,
      getters: 0,
      setters: 0,
    },
    
    complexityPatterns: {
      simple: 0,
      moderate: 0,
      complex: 0,
      veryComplex: 0,
    },
    
    sizeDistribution: {
      tiny: 0,
      small: 0,
      medium: 0,
      large: 0,
      huge: 0,
    },
    
    namingPatterns: {
      camelCase: 0,
      pascalCase: 0,
      snakeCase: 0,
      kebabCase: 0,
      singleWord: 0,
      acronyms: 0,
    },
    
    overallStats: {
      totalFunctions: functionsWithData.length,
      avgComplexity: 0,
      avgLineCount: 0,
      mostCommonStyle: 'unknown',
      styleConsistency: 0,
    }
  };
  
  if (functionsWithData.length === 0) {
    return distribution;
  }
  
  let totalComplexity = 0;
  let totalLines = 0;
  
  // Analyze each function
  for (const func of functionsWithData) {
    const complexity = func.metrics?.cyclomaticComplexity || 1;
    const lineCount = func.endLine - func.startLine + 1;
    
    totalComplexity += complexity;
    totalLines += lineCount;
    
    // Analyze function styles
    analyzeFunctionStyle(func, distribution.functionStyles);
    
    // Analyze complexity patterns
    analyzeComplexityPattern(complexity, distribution.complexityPatterns);
    
    // Analyze size distribution
    analyzeSizeDistribution(lineCount, distribution.sizeDistribution);
    
    // Analyze naming patterns
    analyzeNamingPattern(func.name, distribution.namingPatterns);
  }
  
  // Calculate overall stats
  distribution.overallStats.avgComplexity = totalComplexity / functionsWithData.length;
  distribution.overallStats.avgLineCount = totalLines / functionsWithData.length;
  distribution.overallStats.mostCommonStyle = findMostCommonStyle(distribution.functionStyles);
  distribution.overallStats.styleConsistency = calculateStyleConsistency(distribution);
  
  return distribution;
}

/**
 * Analyze function style based on name and patterns
 */
function analyzeFunctionStyle(func: FunctionInfo, styles: ProgrammingStyleDistribution['functionStyles']): void {
  const name = func.name.toLowerCase();
  
  if (name === 'constructor') {
    styles.constructors++;
  } else if (name.startsWith('get') && name.length > 3) {
    styles.getters++;
  } else if (name.startsWith('set') && name.length > 3) {
    styles.setters++;
  } else if (func.name.includes('.')) {
    styles.methods++;
  } else if (func.type === 'ArrowFunction') {
    styles.arrowFunctions++;
  } else {
    styles.namedFunctions++;
  }
}

/**
 * Categorize complexity into patterns
 */
function analyzeComplexityPattern(complexity: number, patterns: ProgrammingStyleDistribution['complexityPatterns']): void {
  if (complexity <= 3) {
    patterns.simple++;
  } else if (complexity <= 7) {
    patterns.moderate++;
  } else if (complexity <= 15) {
    patterns.complex++;
  } else {
    patterns.veryComplex++;
  }
}

/**
 * Categorize function size
 */
function analyzeSizeDistribution(lineCount: number, sizes: ProgrammingStyleDistribution['sizeDistribution']): void {
  if (lineCount <= 10) {
    sizes.tiny++;
  } else if (lineCount <= 25) {
    sizes.small++;
  } else if (lineCount <= 50) {
    sizes.medium++;
  } else if (lineCount <= 100) {
    sizes.large++;
  } else {
    sizes.huge++;
  }
}

/**
 * Analyze naming conventions
 */
function analyzeNamingPattern(name: string, patterns: ProgrammingStyleDistribution['namingPatterns']): void {
  // Remove common prefixes/suffixes for analysis
  const cleanName = name.replace(/^(get|set|is|has|can|should|will)/, '').replace(/\d+$/, '');
  
  if (/^[a-z][a-zA-Z0-9]*$/.test(cleanName)) {
    patterns.camelCase++;
  } else if (/^[A-Z][a-zA-Z0-9]*$/.test(cleanName)) {
    patterns.pascalCase++;
  } else if (/^[a-z]+(_[a-z]+)*$/.test(cleanName)) {
    patterns.snakeCase++;
  } else if (/^[a-z]+(-[a-z]+)*$/.test(cleanName)) {
    patterns.kebabCase++;
  } else if (/^[A-Z]{2,}$/.test(cleanName)) {
    patterns.acronyms++;
  } else if (!/[_\-]/.test(cleanName) && cleanName.length > 0) {
    patterns.singleWord++;
  } else {
    // Default to camelCase for unmatched patterns
    patterns.camelCase++;
  }
}

/**
 * Find the most common function style
 */
function findMostCommonStyle(styles: ProgrammingStyleDistribution['functionStyles']): string {
  const entries = Object.entries(styles);
  const maxEntry = entries.reduce((max, current) => 
    current[1] > max[1] ? current : max
  );
  return maxEntry[0];
}

/**
 * Calculate style consistency score (0-100%)
 */
function calculateStyleConsistency(distribution: ProgrammingStyleDistribution): number {
  const total = distribution.overallStats.totalFunctions;
  if (total === 0) return 0;
  
  // Weight different aspects of consistency
  const namingConsistency = calculateNamingConsistency(distribution.namingPatterns, total);
  const sizeConsistency = calculateSizeConsistency(distribution.sizeDistribution, total);
  const complexityConsistency = calculateComplexityConsistency(distribution.complexityPatterns, total);
  
  // Weighted average of consistency metrics
  return Math.round((namingConsistency * 0.4 + sizeConsistency * 0.3 + complexityConsistency * 0.3));
}

function calculateNamingConsistency(patterns: ProgrammingStyleDistribution['namingPatterns'], total: number): number {
  const maxPattern = Math.max(...Object.values(patterns));
  return (maxPattern / total) * 100;
}

function calculateSizeConsistency(sizes: ProgrammingStyleDistribution['sizeDistribution'], total: number): number {
  // Good consistency means most functions are small to medium size
  const goodSized = sizes.tiny + sizes.small + sizes.medium;
  return (goodSized / total) * 100;
}

function calculateComplexityConsistency(patterns: ProgrammingStyleDistribution['complexityPatterns'], total: number): number {
  // Good consistency means most functions are simple to moderate complexity
  const goodComplexity = patterns.simple + patterns.moderate;
  return (goodComplexity / total) * 100;
}

/**
 * Display programming style distribution in console
 */
export function displayProgrammingStyleDistribution(distribution: ProgrammingStyleDistribution, verbose: boolean = false): void {
  if (distribution.overallStats.totalFunctions === 0) {
    console.log('📝 Programming Style Distribution: No function data available');
    return;
  }
  
  console.log('📝 Programming Style Distribution:');
  
  // Overall stats
  console.log(`  ├── Total Functions: ${distribution.overallStats.totalFunctions}`);
  console.log(`  ├── Avg Complexity: ${distribution.overallStats.avgComplexity.toFixed(1)}`);
  console.log(`  ├── Avg Function Size: ${distribution.overallStats.avgLineCount.toFixed(1)} lines`);
  console.log(`  ├── Most Common Style: ${distribution.overallStats.mostCommonStyle}`);
  console.log(`  └── Style Consistency: ${distribution.overallStats.styleConsistency}%`);
  
  if (verbose) {
    console.log();
    
    // Function styles breakdown
    console.log('🎨 Function Styles:');
    displayCategoryBreakdown(distribution.functionStyles, distribution.overallStats.totalFunctions);
    
    // Complexity patterns
    console.log('🧮 Complexity Patterns:');
    displayCategoryBreakdown(distribution.complexityPatterns, distribution.overallStats.totalFunctions);
    
    // Size distribution
    console.log('📏 Size Distribution:');
    displayCategoryBreakdown(distribution.sizeDistribution, distribution.overallStats.totalFunctions);
    
    // Naming patterns
    console.log('🏷️  Naming Patterns:');
    displayCategoryBreakdown(distribution.namingPatterns, distribution.overallStats.totalFunctions);
  }
}

/**
 * Display category breakdown with percentages
 */
function displayCategoryBreakdown(category: Record<string, number>, total: number): void {
  const entries = Object.entries(category)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);
  
  for (const [key, count] of entries) {
    const percentage = ((count / total) * 100).toFixed(1);
    console.log(`  ├── ${formatCategoryName(key)}: ${count} (${percentage}%)`);
  }
}

/**
 * Format category names for display
 */
function formatCategoryName(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}
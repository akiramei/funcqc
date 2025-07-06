export interface MetricExplanation {
  name: string;
  displayName: string;
  category: 'complexity' | 'size' | 'structure' | 'documentation' | 'advanced' | 'patterns';
  definition: string;
  purpose: string;
  calculation: string;
  thresholds: {
    low: { value: number; description: string };
    medium: { value: number; description: string };
    high: { value: number; description: string };
  };
  industryStandards: string;
  bestPractices: string[];
  relatedMetrics: string[];
  examples?: {
    good: string;
    bad: string;
  };
}

export interface ConceptExplanation {
  name: string;
  definition: string;
  importance: string;
  keyPrinciples: string[];
  relatedMetrics: string[];
  practicalTips: string[];
}

export const METRIC_EXPLANATIONS: Record<string, MetricExplanation> = {
  cyclomaticComplexity: {
    name: 'cyclomaticComplexity',
    displayName: 'Cyclomatic Complexity',
    category: 'complexity',
    definition: 'Measures the number of linearly independent paths through a function\'s control flow.',
    purpose: 'Indicates testing effort required and maintenance difficulty. Higher values suggest more complex logic flow that is harder to understand and test.',
    calculation: 'CC = Edges - Nodes + 2P, where P is the number of connected components. Practically: start with 1 and add 1 for each decision point (if, while, for, case, etc.).',
    thresholds: {
      low: { value: 10, description: 'Simple, easy to understand and test' },
      medium: { value: 15, description: 'Moderate complexity, needs attention' },
      high: { value: 20, description: 'High complexity, refactoring recommended' }
    },
    industryStandards: 'Most organizations set CC <= 10. Critical systems often use CC <= 5. Some legacy systems tolerate CC <= 15.',
    bestPractices: [
      'Break down large functions into smaller, focused functions',
      'Use early returns to reduce nesting',
      'Extract complex conditions into well-named boolean functions',
      'Consider using strategy pattern for complex conditional logic'
    ],
    relatedMetrics: ['cognitiveComplexity', 'maxNestingLevel', 'branchCount'],
    examples: {
      good: 'Simple linear function with 1-2 decision points',
      bad: 'Function with nested loops, multiple if-else chains, and complex conditions'
    }
  },

  cognitiveComplexity: {
    name: 'cognitiveComplexity',
    displayName: 'Cognitive Complexity',
    category: 'complexity',
    definition: 'Measures how difficult it is for humans to understand a function based on control flow and nesting.',
    purpose: 'Focuses on human readability rather than just path count. Emphasizes the mental effort required to understand code.',
    calculation: 'Increments based on nesting level and specific constructs. Deeply nested code receives higher penalties.',
    thresholds: {
      low: { value: 15, description: 'Easy to understand and modify' },
      medium: { value: 25, description: 'Moderate mental effort required' },
      high: { value: 35, description: 'High mental burden, refactor recommended' }
    },
    industryStandards: 'SonarQube recommends CC <= 15. Many teams use CC <= 20 for regular functions.',
    bestPractices: [
      'Minimize nesting depth (use guard clauses)',
      'Extract nested logic into separate functions',
      'Use polymorphism instead of complex conditional chains',
      'Prefer composition over inheritance in complex scenarios'
    ],
    relatedMetrics: ['cyclomaticComplexity', 'maxNestingLevel'],
    examples: {
      good: 'Function with clear, linear flow and minimal nesting',
      bad: 'Function with deeply nested loops and conditionals'
    }
  },

  linesOfCode: {
    name: 'linesOfCode',
    displayName: 'Lines of Code',
    category: 'size',
    definition: 'Count of executable lines of code, excluding comments and blank lines.',
    purpose: 'Indicates function size and potential complexity. Larger functions are generally harder to understand, test, and maintain.',
    calculation: 'Count all lines containing executable code statements, excluding comments, blank lines, and closing braces only.',
    thresholds: {
      low: { value: 20, description: 'Small, focused function' },
      medium: { value: 40, description: 'Medium-sized function' },
      high: { value: 60, description: 'Large function, consider breaking down' }
    },
    industryStandards: 'Clean Code suggests functions should fit on a screen (20-30 lines). Many teams use 40-50 lines as upper limit.',
    bestPractices: [
      'Keep functions small and focused on single responsibility',
      'Extract logical blocks into separate functions',
      'Use descriptive function names to clarify intent',
      'Consider that longer functions often indicate multiple responsibilities'
    ],
    relatedMetrics: ['totalLines', 'cyclomaticComplexity', 'parameterCount'],
    examples: {
      good: 'Short function that does one thing well',
      bad: 'Long function that handles multiple concerns'
    }
  },

  totalLines: {
    name: 'totalLines',
    displayName: 'Total Lines',
    category: 'size',
    definition: 'Total count of all lines in the function, including comments, blank lines, and code.',
    purpose: 'Provides overall function size including documentation. Useful for understanding the complete footprint of a function.',
    calculation: 'Count from function start to end, including all lines regardless of content.',
    thresholds: {
      low: { value: 30, description: 'Small function with moderate documentation' },
      medium: { value: 60, description: 'Medium-sized function' },
      high: { value: 100, description: 'Large function footprint' }
    },
    industryStandards: 'Generally should be proportional to lines of code. Well-documented functions may have higher total lines.',
    bestPractices: [
      'Balance code size with adequate documentation',
      'Remove unnecessary blank lines and comments',
      'Consider if large total lines indicate overly complex function',
      'Ensure comments add value rather than stating the obvious'
    ],
    relatedMetrics: ['linesOfCode', 'commentLines', 'codeToCommentRatio']
  },

  parameterCount: {
    name: 'parameterCount',
    displayName: 'Parameter Count',
    category: 'size',
    definition: 'Number of parameters accepted by the function.',
    purpose: 'Indicates function interface complexity. Too many parameters suggest the function may be doing too much or needs refactoring.',
    calculation: 'Count all formal parameters in the function signature.',
    thresholds: {
      low: { value: 3, description: 'Simple, focused interface' },
      medium: { value: 5, description: 'Moderate interface complexity' },
      high: { value: 7, description: 'Complex interface, consider refactoring' }
    },
    industryStandards: 'Clean Code suggests 3 parameters max. Many teams allow up to 4-5 parameters. Beyond 7 is generally discouraged.',
    bestPractices: [
      'Group related parameters into objects',
      'Use configuration objects for optional parameters',
      'Consider if many parameters indicate function doing too much',
      'Use builder pattern for complex object construction'
    ],
    relatedMetrics: ['cyclomaticComplexity', 'linesOfCode']
  },

  maxNestingLevel: {
    name: 'maxNestingLevel',
    displayName: 'Maximum Nesting Level',
    category: 'structure',
    definition: 'The deepest level of nested control structures (if, for, while, etc.) within the function.',
    purpose: 'Indicates code structure complexity. Deep nesting makes code harder to read and understand.',
    calculation: 'Count the maximum depth of nested control structures. Each if, for, while, etc. increases nesting level.',
    thresholds: {
      low: { value: 2, description: 'Simple, readable structure' },
      medium: { value: 3, description: 'Moderate nesting, manageable' },
      high: { value: 4, description: 'Deep nesting, refactor recommended' }
    },
    industryStandards: 'Most coding standards recommend maximum 3-4 levels. Some strict standards limit to 2 levels.',
    bestPractices: [
      'Use guard clauses and early returns',
      'Extract nested logic into separate functions',
      'Use polymorphism to eliminate conditional nesting',
      'Invert conditions to reduce nesting depth'
    ],
    relatedMetrics: ['cognitiveComplexity', 'cyclomaticComplexity']
  },

  branchCount: {
    name: 'branchCount',
    displayName: 'Branch Count',
    category: 'structure',
    definition: 'Number of conditional branches (if-else, switch-case, ternary operators) in the function.',
    purpose: 'Indicates decision complexity and testing requirements. More branches mean more test cases needed.',
    calculation: 'Count each if, else if, else, case statement, and ternary operator.',
    thresholds: {
      low: { value: 5, description: 'Simple decision logic' },
      medium: { value: 10, description: 'Moderate branching' },
      high: { value: 15, description: 'Complex branching logic' }
    },
    industryStandards: 'Varies by function purpose. Business logic functions may have more branches than utility functions.',
    bestPractices: [
      'Use lookup tables or maps for many similar branches',
      'Consider strategy or state pattern for complex branching',
      'Extract branch logic into separate functions',
      'Use polymorphism to eliminate type-based branching'
    ],
    relatedMetrics: ['cyclomaticComplexity', 'returnStatementCount']
  },

  loopCount: {
    name: 'loopCount',
    displayName: 'Loop Count',
    category: 'structure',
    definition: 'Number of loop constructs (for, while, do-while, forEach) in the function.',
    purpose: 'Indicates iterative complexity. Multiple loops can affect performance and readability.',
    calculation: 'Count each for, while, do-while loop and functional iteration methods.',
    thresholds: {
      low: { value: 2, description: 'Simple iteration logic' },
      medium: { value: 4, description: 'Moderate iteration complexity' },
      high: { value: 6, description: 'High iteration complexity' }
    },
    industryStandards: 'No strict standards, but nested loops and multiple loops in one function often indicate complexity.',
    bestPractices: [
      'Avoid nested loops when possible',
      'Use functional programming methods (map, filter, reduce)',
      'Extract loop bodies into separate functions',
      'Consider performance implications of multiple loops'
    ],
    relatedMetrics: ['cyclomaticComplexity', 'maxNestingLevel']
  },

  returnStatementCount: {
    name: 'returnStatementCount',
    displayName: 'Return Statement Count',
    category: 'structure',
    definition: 'Number of return statements in the function.',
    purpose: 'Indicates control flow complexity. Multiple returns can make function flow harder to follow.',
    calculation: 'Count each explicit return statement in the function.',
    thresholds: {
      low: { value: 1, description: 'Single exit point' },
      medium: { value: 3, description: 'Multiple exits, manageable' },
      high: { value: 5, description: 'Many exit points, complex flow' }
    },
    industryStandards: 'Debated topic. Some prefer single return, others allow multiple early returns for guard clauses.',
    bestPractices: [
      'Use early returns for guard clauses and validation',
      'Avoid returns in the middle of complex logic',
      'Ensure all return paths are clearly intentional',
      'Consider if many returns indicate function doing too much'
    ],
    relatedMetrics: ['branchCount', 'cyclomaticComplexity']
  },

  tryCatchCount: {
    name: 'tryCatchCount',
    displayName: 'Try-Catch Count',
    category: 'structure',
    definition: 'Number of try-catch blocks in the function.',
    purpose: 'Indicates error handling complexity. Multiple try-catch blocks may suggest function handling too many concerns.',
    calculation: 'Count each try-catch or try-finally block.',
    thresholds: {
      low: { value: 1, description: 'Simple error handling' },
      medium: { value: 2, description: 'Moderate error handling' },
      high: { value: 3, description: 'Complex error handling' }
    },
    industryStandards: 'Generally prefer specific error handling. Multiple try-catch blocks often indicate need for refactoring.',
    bestPractices: [
      'Handle specific exceptions rather than general ones',
      'Extract error-prone operations into separate functions',
      'Use validation to prevent errors rather than catching them',
      'Consider if multiple try-catch indicates function doing too much'
    ],
    relatedMetrics: ['cyclomaticComplexity', 'linesOfCode']
  },

  asyncAwaitCount: {
    name: 'asyncAwaitCount',
    displayName: 'Async/Await Count',
    category: 'patterns',
    definition: 'Number of async/await operations in the function.',
    purpose: 'Indicates asynchronous complexity. Multiple async operations may suggest coordination complexity.',
    calculation: 'Count each await expression in the function.',
    thresholds: {
      low: { value: 2, description: 'Simple async operations' },
      medium: { value: 5, description: 'Moderate async complexity' },
      high: { value: 8, description: 'High async complexity' }
    },
    industryStandards: 'No strict standards, but many sequential awaits may indicate performance or design issues.',
    bestPractices: [
      'Use Promise.all() for independent async operations',
      'Avoid sequential awaits when parallel execution is possible',
      'Extract complex async logic into separate functions',
      'Consider async/await vs Promise chains for readability'
    ],
    relatedMetrics: ['cyclomaticComplexity', 'linesOfCode']
  },

  callbackCount: {
    name: 'callbackCount',
    displayName: 'Callback Count',
    category: 'patterns',
    definition: 'Number of callback functions used within the function.',
    purpose: 'Indicates functional programming usage and potential complexity from nested callbacks.',
    calculation: 'Count anonymous functions passed as arguments and higher-order function usage.',
    thresholds: {
      low: { value: 2, description: 'Simple callback usage' },
      medium: { value: 4, description: 'Moderate functional style' },
      high: { value: 6, description: 'Heavy callback usage' }
    },
    industryStandards: 'Depends on programming style. Functional style may have higher counts legitimately.',
    bestPractices: [
      'Avoid deeply nested callbacks (callback hell)',
      'Use named functions instead of anonymous ones for complex logic',
      'Consider async/await for asynchronous callbacks',
      'Extract complex callback logic into separate functions'
    ],
    relatedMetrics: ['asyncAwaitCount', 'cyclomaticComplexity']
  },

  commentLines: {
    name: 'commentLines',
    displayName: 'Comment Lines',
    category: 'documentation',
    definition: 'Number of lines containing comments (single-line and multi-line).',
    purpose: 'Indicates documentation level. Balance between under-documented and over-commented code.',
    calculation: 'Count lines starting with //, /* */ blocks, and JSDoc comments.',
    thresholds: {
      low: { value: 5, description: 'Minimal documentation' },
      medium: { value: 15, description: 'Adequate documentation' },
      high: { value: 25, description: 'Heavily documented' }
    },
    industryStandards: 'Varies by team and context. Critical functions should have more comments than simple utilities.',
    bestPractices: [
      'Focus on why, not what the code does',
      'Document complex algorithms and business logic',
      'Remove obvious comments that restate the code',
      'Keep comments up-to-date with code changes'
    ],
    relatedMetrics: ['codeToCommentRatio', 'linesOfCode']
  },

  codeToCommentRatio: {
    name: 'codeToCommentRatio',
    displayName: 'Code to Comment Ratio',
    category: 'documentation',
    definition: 'Ratio of comment lines to code lines.',
    purpose: 'Indicates documentation density. Helps balance between under-documented and over-commented code.',
    calculation: 'Comment lines divided by lines of code.',
    thresholds: {
      low: { value: 0.1, description: 'Low documentation level' },
      medium: { value: 0.3, description: 'Balanced documentation' },
      high: { value: 0.5, description: 'High documentation level' }
    },
    industryStandards: 'Typically 10-30% comments. Higher for complex algorithms, lower for self-explanatory code.',
    bestPractices: [
      'Aim for self-documenting code first',
      'Add comments for complex business logic',
      'Document non-obvious algorithms and optimizations',
      'Balance readability with documentation needs'
    ],
    relatedMetrics: ['commentLines', 'linesOfCode']
  },

  halsteadVolume: {
    name: 'halsteadVolume',
    displayName: 'Halstead Volume',
    category: 'advanced',
    definition: 'Software science metric measuring the size of implementation based on operators and operands.',
    purpose: 'Indicates information content and potential for errors. Higher volume suggests more complex implementation.',
    calculation: 'V = N * log2(n), where N is total operators and operands, n is unique operators and operands.',
    thresholds: {
      low: { value: 100, description: 'Simple implementation' },
      medium: { value: 300, description: 'Moderate complexity' },
      high: { value: 500, description: 'Complex implementation' }
    },
    industryStandards: 'Academic metric with limited industry adoption. Useful for research and detailed analysis.',
    bestPractices: [
      'Use to identify overly complex implementations',
      'Compare similar functions to find outliers',
      'Consider alongside other complexity metrics',
      'Focus on reducing unique operators for lower volume'
    ],
    relatedMetrics: ['halsteadDifficulty', 'cyclomaticComplexity']
  },

  halsteadDifficulty: {
    name: 'halsteadDifficulty',
    displayName: 'Halstead Difficulty',
    category: 'advanced',
    definition: 'Software science metric measuring how difficult the code is to understand and modify.',
    purpose: 'Indicates cognitive burden for understanding and maintaining the code.',
    calculation: 'D = (unique operators / 2) * (total operands / unique operands).',
    thresholds: {
      low: { value: 10, description: 'Easy to understand' },
      medium: { value: 20, description: 'Moderate difficulty' },
      high: { value: 30, description: 'Difficult to understand' }
    },
    industryStandards: 'Academic metric. Higher values suggest need for refactoring or better documentation.',
    bestPractices: [
      'Reduce unique operators (use consistent patterns)',
      'Increase unique operands (use meaningful variable names)',
      'Break complex expressions into simpler ones',
      'Use helper functions to reduce operator density'
    ],
    relatedMetrics: ['halsteadVolume', 'cognitiveComplexity']
  },

  maintainabilityIndex: {
    name: 'maintainabilityIndex',
    displayName: 'Maintainability Index',
    category: 'advanced',
    definition: 'Composite metric combining cyclomatic complexity, lines of code, and Halstead volume to assess maintainability.',
    purpose: 'Provides overall assessment of how maintainable the code is. Higher values indicate easier maintenance.',
    calculation: 'MI = 171 - 5.2 * ln(V) - 0.23 * CC - 16.2 * ln(LOC), where V=Halstead Volume, CC=Cyclomatic Complexity, LOC=Lines of Code.',
    thresholds: {
      low: { value: 65, description: 'Difficult to maintain' },
      medium: { value: 85, description: 'Moderately maintainable' },
      high: { value: 95, description: 'Highly maintainable' }
    },
    industryStandards: 'Microsoft uses: >85 (green), 65-85 (yellow), <65 (red). Many tools adopt similar thresholds.',
    bestPractices: [
      'Focus on reducing cyclomatic complexity',
      'Keep functions small and focused',
      'Use meaningful names to reduce Halstead volume',
      'Regular refactoring to maintain high MI scores'
    ],
    relatedMetrics: ['cyclomaticComplexity', 'linesOfCode', 'halsteadVolume']
  }
};

export const CONCEPT_EXPLANATIONS: Record<string, ConceptExplanation> = {
  complexity: {
    name: 'Code Complexity',
    definition: 'The degree of difficulty in understanding, testing, and maintaining code.',
    importance: 'Complex code leads to more bugs, longer development time, and higher maintenance costs. Managing complexity is crucial for software quality.',
    keyPrinciples: [
      'Simplicity: Write the simplest code that solves the problem',
      'Single Responsibility: Each function should do one thing well',
      'Readability: Code should be easy for humans to understand',
      'Testability: Complex code is harder to test thoroughly'
    ],
    relatedMetrics: ['cyclomaticComplexity', 'cognitiveComplexity', 'maxNestingLevel'],
    practicalTips: [
      'Break large functions into smaller ones',
      'Use early returns and guard clauses',
      'Extract complex conditions into well-named functions',
      'Prefer composition over inheritance',
      'Use design patterns appropriately'
    ]
  },

  maintainability: {
    name: 'Code Maintainability',
    definition: 'The ease with which software can be modified to correct faults, improve performance, or adapt to changed requirements.',
    importance: 'Maintainable code reduces long-term costs and enables faster feature development. It\'s essential for sustainable software development.',
    keyPrinciples: [
      'Readability: Code should clearly express its intent',
      'Modularity: Well-separated concerns and clear interfaces',
      'Documentation: Appropriate comments and documentation',
      'Consistency: Uniform coding style and patterns'
    ],
    relatedMetrics: ['maintainabilityIndex', 'cyclomaticComplexity', 'codeToCommentRatio'],
    practicalTips: [
      'Use meaningful names for variables and functions',
      'Keep functions small and focused',
      'Write comprehensive tests',
      'Regularly refactor to improve design',
      'Document complex business logic'
    ]
  },

  quality: {
    name: 'Code Quality',
    definition: 'The degree to which code meets specified requirements and is free from defects, while being maintainable and efficient.',
    importance: 'High-quality code reduces bugs, improves performance, and makes development more efficient. It\'s fundamental to successful software projects.',
    keyPrinciples: [
      'Correctness: Code works as intended',
      'Reliability: Code performs consistently',
      'Efficiency: Code uses resources appropriately',
      'Maintainability: Code can be easily modified',
      'Readability: Code can be easily understood'
    ],
    relatedMetrics: ['maintainabilityIndex', 'cyclomaticComplexity', 'testCoverage'],
    practicalTips: [
      'Follow coding standards and best practices',
      'Write comprehensive unit tests',
      'Use static analysis tools',
      'Regular code reviews',
      'Continuous refactoring'
    ]
  },

  testing: {
    name: 'Code Testing',
    definition: 'The practice of verifying that code works correctly and meets requirements through automated and manual verification.',
    importance: 'Testing ensures code reliability, enables safe refactoring, and provides documentation of intended behavior.',
    keyPrinciples: [
      'Coverage: Test all important code paths',
      'Isolation: Tests should be independent',
      'Repeatability: Tests should produce consistent results',
      'Fast Feedback: Tests should run quickly',
      'Clear Intent: Tests should clearly show what they verify'
    ],
    relatedMetrics: ['cyclomaticComplexity', 'branchCount', 'returnStatementCount'],
    practicalTips: [
      'Write tests before or alongside code (TDD)',
      'Test edge cases and error conditions',
      'Keep tests simple and focused',
      'Use meaningful test names',
      'Mock external dependencies appropriately'
    ]
  },

  refactoring: {
    name: 'Code Refactoring',
    definition: 'The process of restructuring existing code without changing its external behavior to improve its internal structure.',
    importance: 'Refactoring improves code quality, reduces technical debt, and makes future changes easier and safer.',
    keyPrinciples: [
      'Preserve Behavior: External functionality must remain unchanged',
      'Small Steps: Make incremental improvements',
      'Test Safety: Ensure comprehensive tests before refactoring',
      'Clear Intent: Each refactoring should have a specific goal'
    ],
    relatedMetrics: ['cyclomaticComplexity', 'maintainabilityIndex', 'linesOfCode'],
    practicalTips: [
      'Identify code smells and quality issues',
      'Use automated refactoring tools when available',
      'Refactor regularly, not just when fixing bugs',
      'Focus on the most problematic areas first',
      'Measure improvement with quality metrics'
    ]
  }
};

export function getMetricExplanation(metricName: string): MetricExplanation | undefined {
  return METRIC_EXPLANATIONS[metricName];
}

export function getConceptExplanation(conceptName: string): ConceptExplanation | undefined {
  return CONCEPT_EXPLANATIONS[conceptName.toLowerCase()];
}

export function getAllMetrics(): MetricExplanation[] {
  return Object.values(METRIC_EXPLANATIONS);
}

export function getMetricsByCategory(category: MetricExplanation['category']): MetricExplanation[] {
  return Object.values(METRIC_EXPLANATIONS).filter(metric => metric.category === category);
}

export function getAllConcepts(): ConceptExplanation[] {
  return Object.values(CONCEPT_EXPLANATIONS);
}

export function searchMetrics(searchTerm: string): MetricExplanation[] {
  const term = searchTerm.toLowerCase();
  return Object.values(METRIC_EXPLANATIONS).filter(metric =>
    metric.name.toLowerCase().includes(term) ||
    metric.displayName.toLowerCase().includes(term) ||
    metric.definition.toLowerCase().includes(term)
  );
}
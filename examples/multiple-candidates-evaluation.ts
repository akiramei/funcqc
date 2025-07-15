/**
 * Example: Multiple Candidates Evaluation
 * 
 * This example demonstrates how to use the new multiple function evaluation
 * and refactoring candidate selection features.
 */

import { 
  RealTimeQualityGate,
  RefactoringCandidateEvaluator,
  RefactoringCandidateGenerator,
  RefactoringCandidate,
} from '../src/index.js';

// Example: Complex function that needs refactoring
const complexFunction = `
function processUserData(userId, userData, options, callback, errorHandler) {
  if (!userId) {
    errorHandler('User ID is required');
    return;
  }
  
  if (!userData) {
    errorHandler('User data is required');
    return;
  }
  
  if (!options) {
    options = {};
  }
  
  if (!callback) {
    callback = () => {};
  }
  
  if (options.validateEmail) {
    if (!userData.email) {
      errorHandler('Email is required when validation is enabled');
      return;
    }
    if (!userData.email.includes('@')) {
      errorHandler('Invalid email format');
      return;
    }
  }
  
  if (options.validateAge) {
    if (!userData.age) {
      errorHandler('Age is required when validation is enabled');
      return;
    }
    if (userData.age < 0 || userData.age > 120) {
      errorHandler('Age must be between 0 and 120');
      return;
    }
  }
  
  // Process the data
  const processedData = {
    id: userId,
    name: userData.name,
    email: userData.email,
    age: userData.age,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  if (options.includeMetadata) {
    processedData.metadata = {
      source: 'user-input',
      processedAt: new Date(),
      version: '1.0.0',
    };
  }
  
  callback(processedData);
}
`;

// Candidate 1: Early Return Pattern
const earlyReturnCandidate: RefactoringCandidate = {
  id: 'early-return-1',
  name: 'Early Return Pattern',
  code: `
function processUserData(userId, userData, options, callback, errorHandler) {
  // Early validation returns
  if (!userId) {
    errorHandler('User ID is required');
    return;
  }
  
  if (!userData) {
    errorHandler('User data is required');
    return;
  }
  
  // Set defaults
  options = options || {};
  callback = callback || (() => {});
  
  // Validate email if required
  if (options.validateEmail) {
    if (!userData.email) {
      errorHandler('Email is required when validation is enabled');
      return;
    }
    if (!userData.email.includes('@')) {
      errorHandler('Invalid email format');
      return;
    }
  }
  
  // Validate age if required
  if (options.validateAge) {
    if (!userData.age) {
      errorHandler('Age is required when validation is enabled');
      return;
    }
    if (userData.age < 0 || userData.age > 120) {
      errorHandler('Age must be between 0 and 120');
      return;
    }
  }
  
  // Process the data
  const processedData = createProcessedData(userId, userData, options);
  callback(processedData);
}

function createProcessedData(userId, userData, options) {
  const processedData = {
    id: userId,
    name: userData.name,
    email: userData.email,
    age: userData.age,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  if (options.includeMetadata) {
    processedData.metadata = {
      source: 'user-input',
      processedAt: new Date(),
      version: '1.0.0',
    };
  }
  
  return processedData;
}
  `,
  strategy: 'early-return',
  description: 'Reduced nesting with early returns and extracted data creation',
  metadata: {
    originalComplexity: 12,
    targetComplexity: 8,
    estimatedReduction: 33,
    patterns: ['early-return', 'extract-method'],
  },
};

// Candidate 2: Options Object Pattern
const optionsObjectCandidate: RefactoringCandidate = {
  id: 'options-object-1',
  name: 'Options Object Pattern',
  code: `
interface ProcessUserOptions {
  validateEmail?: boolean;
  validateAge?: boolean;
  includeMetadata?: boolean;
  callback?: (data: any) => void;
  errorHandler?: (error: string) => void;
}

function processUserData(userId: string, userData: any, options: ProcessUserOptions = {}) {
  const { 
    validateEmail = false,
    validateAge = false,
    includeMetadata = false,
    callback = () => {},
    errorHandler = () => {}
  } = options;
  
  // Validation
  if (!userId) {
    errorHandler('User ID is required');
    return;
  }
  
  if (!userData) {
    errorHandler('User data is required');
    return;
  }
  
  // Email validation
  if (validateEmail && !validateUserEmail(userData.email, errorHandler)) {
    return;
  }
  
  // Age validation
  if (validateAge && !validateUserAge(userData.age, errorHandler)) {
    return;
  }
  
  // Process the data
  const processedData = createProcessedData(userId, userData, includeMetadata);
  callback(processedData);
}

function validateUserEmail(email: string, errorHandler: (error: string) => void): boolean {
  if (!email) {
    errorHandler('Email is required when validation is enabled');
    return false;
  }
  if (!email.includes('@')) {
    errorHandler('Invalid email format');
    return false;
  }
  return true;
}

function validateUserAge(age: number, errorHandler: (error: string) => void): boolean {
  if (!age) {
    errorHandler('Age is required when validation is enabled');
    return false;
  }
  if (age < 0 || age > 120) {
    errorHandler('Age must be between 0 and 120');
    return false;
  }
  return true;
}

function createProcessedData(userId: string, userData: any, includeMetadata: boolean) {
  const processedData = {
    id: userId,
    name: userData.name,
    email: userData.email,
    age: userData.age,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  if (includeMetadata) {
    processedData.metadata = {
      source: 'user-input',
      processedAt: new Date(),
      version: '1.0.0',
    };
  }
  
  return processedData;
}
  `,
  strategy: 'options-object',
  description: 'Replaced multiple parameters with options object and extracted validation',
  metadata: {
    originalComplexity: 12,
    targetComplexity: 6,
    estimatedReduction: 50,
    patterns: ['options-object', 'extract-method', 'parameter-object'],
  },
};

// Candidate 3: Strategy Pattern (over-engineered for demonstration)
const strategyPatternCandidate: RefactoringCandidate = {
  id: 'strategy-pattern-1',
  name: 'Strategy Pattern',
  code: `
interface ValidationStrategy {
  validate(data: any, errorHandler: (error: string) => void): boolean;
}

class EmailValidator implements ValidationStrategy {
  validate(email: string, errorHandler: (error: string) => void): boolean {
    if (!email) {
      errorHandler('Email is required when validation is enabled');
      return false;
    }
    if (!email.includes('@')) {
      errorHandler('Invalid email format');
      return false;
    }
    return true;
  }
}

class AgeValidator implements ValidationStrategy {
  validate(age: number, errorHandler: (error: string) => void): boolean {
    if (!age) {
      errorHandler('Age is required when validation is enabled');
      return false;
    }
    if (age < 0 || age > 120) {
      errorHandler('Age must be between 0 and 120');
      return false;
    }
    return true;
  }
}

function processUserData(userId, userData, options, callback, errorHandler) {
  // Basic validation
  if (!userId) {
    errorHandler('User ID is required');
    return;
  }
  
  if (!userData) {
    errorHandler('User data is required');
    return;
  }
  
  // Set defaults
  options = options || {};
  callback = callback || (() => {});
  
  // Validation strategies
  const validators = [];
  if (options.validateEmail) {
    validators.push({ strategy: new EmailValidator(), data: userData.email });
  }
  if (options.validateAge) {
    validators.push({ strategy: new AgeValidator(), data: userData.age });
  }
  
  // Execute validations
  for (const validator of validators) {
    if (!validator.strategy.validate(validator.data, errorHandler)) {
      return;
    }
  }
  
  // Process the data
  const processedData = createProcessedData(userId, userData, options);
  callback(processedData);
}

function createProcessedData(userId, userData, options) {
  const processedData = {
    id: userId,
    name: userData.name,
    email: userData.email,
    age: userData.age,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  if (options.includeMetadata) {
    processedData.metadata = {
      source: 'user-input',
      processedAt: new Date(),
      version: '1.0.0',
    };
  }
  
  return processedData;
}
  `,
  strategy: 'strategy-pattern',
  description: 'Applied strategy pattern for validation (might be over-engineered)',
  metadata: {
    originalComplexity: 12,
    targetComplexity: 8,
    estimatedReduction: 33,
    patterns: ['strategy-pattern', 'extract-method'],
  },
};

/**
 * Example usage of multiple candidates evaluation
 */
export async function runMultipleCandidatesExample() {
  console.log('🎯 Multiple Candidates Evaluation Example\n');
  
  // Initialize quality gate
  const qualityGate = new RealTimeQualityGate({
    warningThreshold: 2.0,
    criticalThreshold: 3.0,
    minBaselineFunctions: 5,
    maxAnalysisTime: 10000,
  });
  
  // Initialize candidate evaluator
  const evaluator = new RefactoringCandidateEvaluator(qualityGate, {
    qualityWeight: 0.4,
    improvementWeight: 0.3,
    structuralWeight: 0.3,
    minAcceptableScore: 70,
  });
  
  // Prepare candidates
  const candidates = [
    earlyReturnCandidate,
    optionsObjectCandidate,
    strategyPatternCandidate,
  ];
  
  console.log('📊 Evaluating candidates...\n');
  
  // Evaluate candidates
  const comparison = await evaluator.evaluateAndSelectBest(complexFunction, candidates);
  
  // Display results
  console.log('📈 Results Summary:');
  console.log(`   Total Candidates: ${comparison.summary.totalCandidates}`);
  console.log(`   Acceptable Candidates: ${comparison.summary.acceptableCandidates}`);
  console.log(`   Average Score: ${comparison.summary.averageScore.toFixed(1)}`);
  console.log(`   Best Strategy: ${comparison.summary.bestStrategy}`);
  console.log(`   Improvement Achieved: ${comparison.summary.improvementAchieved ? '✅' : '❌'}`);
  
  console.log('\n🏆 Winner:');
  console.log(`   Name: ${comparison.winner.candidate.name}`);
  console.log(`   Strategy: ${comparison.winner.candidate.strategy}`);
  console.log(`   Score: ${comparison.winner.score.toFixed(1)}`);
  console.log(`   Acceptable: ${comparison.winner.acceptable ? '✅' : '❌'}`);
  
  console.log('\n📋 All Candidates:');
  comparison.candidates.forEach((candidate, index) => {
    const status = candidate.acceptable ? '✅' : '❌';
    console.log(`   ${index + 1}. ${status} ${candidate.candidate.name} - Score: ${candidate.score.toFixed(1)}`);
    console.log(`      Strategy: ${candidate.candidate.strategy}`);
    console.log(`      Quality: ${candidate.scoring.qualityScore.toFixed(1)}, Improvement: ${candidate.scoring.improvementScore.toFixed(1)}, Structural: ${candidate.scoring.structuralScore.toFixed(1)}`);
  });
  
  console.log('\n🔍 Baseline (Original):');
  console.log(`   Score: ${comparison.baseline.score.toFixed(1)}`);
  console.log(`   Acceptable: ${comparison.baseline.acceptable ? '✅' : '❌'}`);
  
  return comparison;
}

/**
 * Example usage of single file evaluation with multiple functions
 */
export async function runMultipleFunctionsExample() {
  console.log('\n🎯 Multiple Functions Evaluation Example\n');
  
  const multipleFunction = `
function simpleFunction() {
  return 'Hello World';
}

function complexFunction(a, b, c, d, e) {
  if (a) {
    if (b) {
      if (c) {
        if (d) {
          if (e) {
            return a + b + c + d + e;
          } else {
            return a + b + c + d;
          }
        } else {
          return a + b + c;
        }
      } else {
        return a + b;
      }
    } else {
      return a;
    }
  } else {
    return 0;
  }
}

function mediumFunction(x, y) {
  if (x > 0) {
    return x * y;
  } else {
    return y;
  }
}
  `;
  
  // Initialize quality gate
  const qualityGate = new RealTimeQualityGate();
  
  // Evaluate all functions
  const assessment = await qualityGate.evaluateAllFunctions(multipleFunction);
  
  // Display results
  console.log('📊 Multi-Function Assessment:');
  console.log(`   Total Functions: ${assessment.summary.totalFunctions}`);
  console.log(`   Acceptable Functions: ${assessment.summary.acceptableFunctions}/${assessment.summary.totalFunctions}`);
  console.log(`   Average Score: ${assessment.summary.averageScore.toFixed(1)}`);
  console.log(`   Best Function: ${assessment.summary.bestFunction}`);
  console.log(`   Worst Function: ${assessment.summary.worstFunction}`);
  console.log(`   Overall Acceptable: ${assessment.overallAcceptable ? '✅' : '❌'}`);
  
  console.log('\n📋 Individual Functions:');
  assessment.allFunctions.forEach((func, index) => {
    const status = func.assessment.acceptable ? '✅' : '❌';
    console.log(`   ${index + 1}. ${status} ${func.functionName} - Score: ${func.assessment.qualityScore}/100`);
    
    if (func.assessment.violations.length > 0) {
      const criticalCount = func.assessment.violations.filter(v => v.severity === 'critical').length;
      const warningCount = func.assessment.violations.filter(v => v.severity === 'warning').length;
      console.log(`      🔴 ${criticalCount} critical, 🟡 ${warningCount} warnings`);
    }
  });
  
  return assessment;
}

// Run examples if executed directly
if (require.main === module) {
  (async () => {
    try {
      await runMultipleCandidatesExample();
      await runMultipleFunctionsExample();
    } catch (error) {
      console.error('Error running examples:', error);
    }
  })();
}
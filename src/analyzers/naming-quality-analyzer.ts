/**
 * Naming Quality Analyzer for funcqc v1.6
 * 
 * Evaluates function naming quality based on Clean Code principles:
 * - Basic Naming Rules (30%): Length, camelCase, generic name prohibition
 * - Semantic Appropriateness (40%): Action verbs, boolean patterns, role clarity
 * - Consistency (20%): Pattern consistency within file
 * - Redundancy (10%): Avoidance of class/filename duplication
 */

import { FunctionInfo } from '../types';
import { NamingQualityScore, NamingIssue } from '../types/quality-enhancements';

export class NamingQualityAnalyzer {
  private readonly GENERIC_NAMES = new Set([
    'func', 'function', 'handler', 'util', 'utils', 'helper', 'helpers',
    'data', 'item', 'obj', 'temp', 'tmp', 'value', 'val', 'result',
    'process', 'handle', 'do', 'run', 'exec', 'execute', 'perform',
    'check', 'test', 'validate', 'parse', 'convert', 'transform'
  ]);

  private readonly ACTION_VERBS = new Set([
    'get', 'set', 'create', 'make', 'build', 'generate', 'produce',
    'add', 'remove', 'delete', 'update', 'modify', 'change', 'edit',
    'find', 'search', 'locate', 'fetch', 'retrieve', 'load', 'save',
    'store', 'insert', 'upload', 'download', 'send', 'receive',
    'process', 'handle', 'manage', 'control', 'execute', 'run',
    'calculate', 'compute', 'evaluate', 'analyze', 'parse', 'format',
    'convert', 'transform', 'map', 'filter', 'reduce', 'sort',
    'validate', 'verify', 'check', 'test', 'confirm', 'ensure',
    'initialize', 'setup', 'configure', 'prepare', 'cleanup', 'dispose',
    'connect', 'disconnect', 'open', 'close', 'start', 'stop', 'pause',
    'enable', 'disable', 'activate', 'deactivate', 'trigger', 'emit',
    'subscribe', 'unsubscribe', 'listen', 'notify', 'broadcast'
  ]);

  private readonly BOOLEAN_PREFIXES = new Set([
    'is', 'has', 'can', 'should', 'will', 'was', 'were', 'does', 'did',
    'contains', 'includes', 'exists', 'supports', 'allows', 'requires',
    'needs', 'accepts', 'rejects', 'matches', 'equals', 'differs'
  ]);

  /**
   * Analyzes naming quality for a single function
   */
  analyze(functionInfo: FunctionInfo, contextFunctions: FunctionInfo[] = []): NamingQualityScore {
    const issues: NamingIssue[] = [];
    
    // Calculate component scores
    const basicRules = this.checkBasicNamingRules(functionInfo, issues);
    const semanticAppropriate = this.checkSemanticAppropriateness(functionInfo, issues);
    const consistency = this.checkConsistency(functionInfo, contextFunctions, issues);
    const redundancy = this.checkRedundancy(functionInfo, issues);

    // Calculate overall score with weights
    const score = Math.round(
      basicRules * 0.30 +
      semanticAppropriate * 0.40 +
      consistency * 0.20 +
      redundancy * 0.10
    );

    // Calculate confidence based on function attributes
    const confidence = this.calculateConfidence(functionInfo, issues);

    return {
      score: Math.max(0, Math.min(100, score)),
      components: {
        basicRules,
        semanticAppropriate,
        consistency,
        redundancy
      },
      issues,
      confidence
    };
  }

  /**
   * Checks basic naming rules (30% weight)
   * - Length appropriateness (3-50 characters)
   * - camelCase compliance
   * - Generic name prohibition
   */
  private checkBasicNamingRules(functionInfo: FunctionInfo, issues: NamingIssue[]): number {
    let score = 100;
    const name = functionInfo.name;

    // Length check
    if (name.length < 3) {
      score -= 15;
      issues.push({
        type: 'basic',
        severity: 'high',
        description: `Function name too short (${name.length} characters)`,
        points: 15,
        suggestion: 'Use more descriptive names with at least 3 characters'
      });
    } else if (name.length > 50) {
      score -= 10;
      issues.push({
        type: 'basic',
        severity: 'medium',
        description: `Function name too long (${name.length} characters)`,
        points: 10,
        suggestion: 'Consider breaking down the function or using shorter, clearer names'
      });
    }

    // camelCase check
    if (!this.isCamelCase(name)) {
      score -= 10;
      issues.push({
        type: 'basic',
        severity: 'medium',
        description: 'Function name should use camelCase convention',
        points: 10,
        suggestion: `Use camelCase: ${this.toCamelCase(name)}`
      });
    }

    // Generic name check
    if (this.GENERIC_NAMES.has(name.toLowerCase())) {
      score -= 20;
      issues.push({
        type: 'basic',
        severity: 'high',
        description: `Generic function name "${name}" provides no semantic meaning`,
        points: 20,
        suggestion: 'Use descriptive names that clearly indicate the function\'s purpose'
      });
    }

    // Check for meaningless suffixes/prefixes
    if (this.hasGenericSuffixes(name)) {
      score -= 5;
      issues.push({
        type: 'basic',
        severity: 'low',
        description: 'Generic suffixes like "Func", "Method", "Handler" add no value',
        points: 5,
        suggestion: 'Remove generic suffixes and focus on the function\'s actual purpose'
      });
    }

    return Math.max(0, score);
  }

  /**
   * Checks semantic appropriateness (40% weight)
   * - Action verbs for functions/methods
   * - Boolean naming patterns
   * - Constructor vs function naming distinction
   */
  private checkSemanticAppropriateness(functionInfo: FunctionInfo, issues: NamingIssue[]): number {
    let score = 100;
    const name = functionInfo.name;
    const returnType = functionInfo.returnType?.type || '';

    // Check action verbs for non-boolean functions
    if (!this.isReturnTypeBoolean(returnType)) {
      if (!this.startsWithActionVerb(name) && !functionInfo.isConstructor) {
        score -= 20;
        issues.push({
          type: 'semantic',
          severity: 'high',
          description: 'Function names should start with action verbs (get, set, create, etc.)',
          points: 20,
          suggestion: `Consider names like: ${this.suggestActionVerbs(name).join(', ')}`
        });
      }
    }

    // Check boolean naming patterns
    if (this.isReturnTypeBoolean(returnType)) {
      if (!this.hasValidBooleanPrefix(name)) {
        score -= 15;
        issues.push({
          type: 'semantic',
          severity: 'medium',
          description: 'Boolean functions should use appropriate prefixes (is, has, can, should, etc.)',
          points: 15,
          suggestion: `Consider: ${this.suggestBooleanNames(name).join(', ')}`
        });
      }
    }

    // Constructor naming check
    if (functionInfo.isConstructor) {
      if (!this.isValidConstructorName(name)) {
        score -= 10;
        issues.push({
          type: 'semantic',
          severity: 'medium',
          description: 'Constructor should be named after the class or use "constructor"',
          points: 10,
          suggestion: 'Use class name or "constructor" for constructor functions'
        });
      }
    }

    // Check for verb-noun balance
    if (!this.hasGoodVerbNounBalance(name) && !functionInfo.isConstructor) {
      score -= 10;
      issues.push({
        type: 'semantic',
        severity: 'low',
        description: 'Function name should clearly indicate both action (verb) and target (noun)',
        points: 10,
        suggestion: 'Use verb-noun combinations like "getUserData", "validateEmail", "calculateTotal"'
      });
    }

    return Math.max(0, score);
  }

  /**
   * Checks consistency within file (20% weight)
   * - Pattern consistency with other functions in same file
   */
  private checkConsistency(functionInfo: FunctionInfo, contextFunctions: FunctionInfo[], issues: NamingIssue[]): number {
    if (contextFunctions.length < 2) {
      return 100; // Can't check consistency with insufficient context
    }

    let score = 100;
    const sameLevelFunctions = contextFunctions.filter(f => 
      f.filePath === functionInfo.filePath && 
      f.id !== functionInfo.id &&
      f.functionType === functionInfo.functionType
    );

    if (sameLevelFunctions.length === 0) {
      return 100; // No similar functions to compare with
    }

    // Check verb consistency
    const verbPatterns = this.extractVerbPatterns(sameLevelFunctions);
    if (verbPatterns.size > 0 && !this.followsVerbPattern(functionInfo.name, verbPatterns)) {
      score -= 10;
      issues.push({
        type: 'consistency',
        severity: 'low',
        description: 'Function naming pattern inconsistent with other functions in file',
        points: 10,
        suggestion: `Follow established patterns: ${Array.from(verbPatterns).join(', ')}`
      });
    }

    // Check naming convention consistency
    const conventions = this.extractNamingConventions(sameLevelFunctions);
    if (!this.followsConventions(functionInfo.name, conventions)) {
      score -= 5;
      issues.push({
        type: 'consistency',
        severity: 'low',
        description: 'Naming convention inconsistent with file patterns',
        points: 5,
        suggestion: 'Maintain consistent naming patterns within the same file'
      });
    }

    return Math.max(0, score);
  }

  /**
   * Checks redundancy avoidance (10% weight)
   * - Class name duplication avoidance
   * - Filename duplication avoidance
   */
  private checkRedundancy(functionInfo: FunctionInfo, issues: NamingIssue[]): number {
    let score = 100;
    const name = functionInfo.name;

    // Check for class name redundancy
    if (functionInfo.contextPath && functionInfo.contextPath.length > 0) {
      const className = functionInfo.contextPath[0];
      if (this.hasRedundantClassPrefix(name, className)) {
        score -= 5;
        issues.push({
          type: 'redundancy',
          severity: 'low',
          description: `Function name redundantly includes class name "${className}"`,
          points: 5,
          suggestion: `Remove class prefix: ${this.removeClassPrefix(name, className)}`
        });
      }
    }

    // Check for filename redundancy
    const filename = this.extractFilename(functionInfo.filePath);
    if (this.hasRedundantFilePrefix(name, filename)) {
      score -= 3;
      issues.push({
        type: 'redundancy',
        severity: 'low',
        description: `Function name redundantly includes filename "${filename}"`,
        points: 3,
        suggestion: `Remove file prefix: ${this.removeFilePrefix(name, filename)}`
      });
    }

    return Math.max(0, score);
  }

  /**
   * Calculates confidence in the analysis based on available information
   */
  private calculateConfidence(functionInfo: FunctionInfo, issues: NamingIssue[]): number {
    let confidence = 0.8; // Base confidence

    // Higher confidence for exported functions (more important)
    if (functionInfo.isExported) confidence += 0.1;

    // Higher confidence when we have return type information
    if (functionInfo.returnType?.type) confidence += 0.05;

    // Higher confidence when we have JSDoc
    if (functionInfo.jsDoc) confidence += 0.05;

    // Lower confidence for very short or very long names (edge cases)
    if (functionInfo.name.length < 3 || functionInfo.name.length > 30) {
      confidence -= 0.1;
    }

    // Lower confidence when many low-severity issues (borderline cases)
    const lowSeverityIssues = issues.filter(i => i.severity === 'low').length;
    if (lowSeverityIssues > 2) confidence -= 0.1;

    return Math.max(0.3, Math.min(1.0, confidence));
  }

  // =============================================================================
  // Helper Methods
  // =============================================================================

  private isCamelCase(name: string): boolean {
    // Should start with lowercase and use camelCase (single lowercase words are valid)
    return /^[a-z][a-zA-Z0-9]*$/.test(name);
  }

  private toCamelCase(name: string): string {
    return name
      .replace(/[-_\s]+(.)?/g, (_, char) => char ? char.toUpperCase() : '')
      .replace(/^[A-Z]/, char => char.toLowerCase());
  }

  private hasGenericSuffixes(name: string): boolean {
    const genericSuffixes = ['Func', 'Function', 'Method', 'Handler', 'Util', 'Helper'];
    return genericSuffixes.some(suffix => name.endsWith(suffix));
  }

  private startsWithActionVerb(name: string): boolean {
    const verb = this.extractFirstWord(name).toLowerCase();
    return this.ACTION_VERBS.has(verb);
  }

  private hasValidBooleanPrefix(name: string): boolean {
    const prefix = this.extractFirstWord(name).toLowerCase();
    return this.BOOLEAN_PREFIXES.has(prefix);
  }

  private extractFirstWord(name: string): string {
    // Extract first word from camelCase, handling edge cases
    const match = name.match(/^[a-z]+/i);
    return match ? match[0].toLowerCase() : name.toLowerCase();
  }

  private isReturnTypeBoolean(returnType: string): boolean {
    return returnType.toLowerCase().includes('boolean') || 
           returnType.toLowerCase().includes('bool');
  }

  private isValidConstructorName(name: string): boolean {
    return name === 'constructor' || /^[A-Z][a-zA-Z0-9]*$/.test(name);
  }

  private hasGoodVerbNounBalance(name: string): boolean {
    // Check if name has both verb and noun components
    const words = this.splitCamelCase(name);
    if (words.length < 2) return false;
    
    const hasVerb = this.ACTION_VERBS.has(words[0].toLowerCase());
    const hasNoun = words.length > 1 && words[1].length > 2;
    
    return hasVerb && hasNoun;
  }

  private splitCamelCase(name: string): string[] {
    return name
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([a-z])([0-9])/g, '$1 $2')
      .replace(/([0-9])([A-Z])/g, '$1 $2')
      .split(' ')
      .filter(word => word.length > 0);
  }

  private suggestActionVerbs(name: string): string[] {
    const words = this.splitCamelCase(name);
    const mainPart = words.slice(1).join('');
    
    return ['get', 'set', 'create', 'update', 'delete'].map(verb => 
      verb + mainPart.charAt(0).toUpperCase() + mainPart.slice(1)
    );
  }

  private suggestBooleanNames(name: string): string[] {
    const words = this.splitCamelCase(name);
    const mainPart = words.join('');
    
    return ['is', 'has', 'can', 'should'].map(prefix => 
      prefix + mainPart.charAt(0).toUpperCase() + mainPart.slice(1)
    );
  }

  private extractVerbPatterns(functions: FunctionInfo[]): Set<string> {
    const verbs = new Set<string>();
    functions.forEach(f => {
      const verb = this.extractFirstWord(f.name).toLowerCase();
      if (this.ACTION_VERBS.has(verb)) {
        verbs.add(verb);
      }
    });
    return verbs;
  }

  private followsVerbPattern(name: string, patterns: Set<string>): boolean {
    const verb = this.extractFirstWord(name).toLowerCase();
    return patterns.has(verb) || patterns.size < 3; // Allow flexibility with few functions
  }

  private extractNamingConventions(functions: FunctionInfo[]): Set<string> {
    const conventions = new Set<string>();
    functions.forEach(f => {
      if (this.isCamelCase(f.name)) conventions.add('camelCase');
      if (f.name.includes('_')) conventions.add('snake_case');
      if (/^[A-Z]/.test(f.name)) conventions.add('PascalCase');
    });
    return conventions;
  }

  private followsConventions(name: string, conventions: Set<string>): boolean {
    if (conventions.size === 0) return true;
    
    if (conventions.has('camelCase') && this.isCamelCase(name)) return true;
    if (conventions.has('snake_case') && name.includes('_')) return true;
    if (conventions.has('PascalCase') && /^[A-Z]/.test(name)) return true;
    
    return conventions.size > 1; // Allow flexibility with mixed conventions
  }

  private hasRedundantClassPrefix(name: string, className: string): boolean {
    const lowerName = name.toLowerCase();
    const lowerClass = className.toLowerCase();
    return lowerName.startsWith(lowerClass) && lowerName !== lowerClass;
  }

  private removeClassPrefix(name: string, className: string): string {
    if (name.toLowerCase().startsWith(className.toLowerCase())) {
      const remaining = name.substring(className.length);
      return remaining.charAt(0).toLowerCase() + remaining.slice(1);
    }
    return name;
  }

  private extractFilename(filePath: string): string {
    const parts = filePath.split('/');
    const filename = parts[parts.length - 1];
    return filename.replace(/\.[^.]+$/, ''); // Remove extension
  }

  private hasRedundantFilePrefix(name: string, filename: string): boolean {
    const cleanFilename = filename.replace(/[-_]/g, '').toLowerCase();
    const cleanName = name.toLowerCase();
    return cleanName.startsWith(cleanFilename) && cleanName !== cleanFilename;
  }

  private removeFilePrefix(name: string, filename: string): string {
    const cleanFilename = filename.replace(/[-_]/g, '');
    if (name.toLowerCase().startsWith(cleanFilename.toLowerCase())) {
      const remaining = name.substring(cleanFilename.length);
      return remaining.charAt(0).toLowerCase() + remaining.slice(1);
    }
    return name;
  }
}
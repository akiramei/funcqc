import * as ts from 'typescript';
import { FunctionInfo, QualityMetrics } from '../types';

export class QualityCalculator {
  
  /**
   * Calculate quality metrics for a function
   */
  async calculate(functionInfo: FunctionInfo): Promise<QualityMetrics> {
    // Parse the source code to get AST
    const sourceFile = ts.createSourceFile(
      'temp.ts',
      functionInfo.sourceCode || '',
      ts.ScriptTarget.Latest,
      true
    );

    // Find the function node in the AST
    let functionNode: ts.FunctionLikeDeclaration | null = null;
    
    const findFunction = (node: ts.Node) => {
      if (this.isFunctionLike(node)) {
        functionNode = node as ts.FunctionLikeDeclaration;
        return;
      }
      ts.forEachChild(node, findFunction);
    };

    findFunction(sourceFile);

    if (!functionNode) {
      // Fallback to basic metrics from text analysis
      return this.calculateFromText(functionInfo);
    }

    return {
      linesOfCode: this.calculateLinesOfCode(functionNode),
      totalLines: this.calculateTotalLines(functionNode),
      cyclomaticComplexity: this.calculateCyclomaticComplexity(functionNode),
      cognitiveComplexity: this.calculateCognitiveComplexity(functionNode),
      maxNestingLevel: this.calculateMaxNestingLevel(functionNode),
      parameterCount: functionInfo.parameters.length,
      returnStatementCount: this.countReturnStatements(functionNode),
      branchCount: this.countBranches(functionNode),
      loopCount: this.countLoops(functionNode),
      tryCatchCount: this.countTryCatch(functionNode),
      asyncAwaitCount: this.countAsyncAwait(functionNode),
      callbackCount: this.countCallbacks(functionNode),
      commentLines: this.calculateCommentLines(functionNode),
      codeToCommentRatio: 0, // Will be calculated after getting comment lines
      halsteadVolume: this.calculateHalsteadVolume(functionNode),
      halsteadDifficulty: this.calculateHalsteadDifficulty(functionNode),
      maintainabilityIndex: 0 // Will be calculated based on other metrics
    };
  }

  private isFunctionLike(node: ts.Node): boolean {
    return (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node)
    );
  }

  private calculateFromText(functionInfo: FunctionInfo): QualityMetrics {
    const lines = functionInfo.sourceCode?.split('\n') || [];
    const codeLines = lines.filter(line => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('/*');
    });

    return {
      linesOfCode: codeLines.length,
      totalLines: lines.length,
      cyclomaticComplexity: 1, // Minimum complexity
      cognitiveComplexity: 1,
      maxNestingLevel: 1,
      parameterCount: functionInfo.parameters.length,
      returnStatementCount: (functionInfo.sourceCode?.match(/return\s/g) || []).length,
      branchCount: 0,
      loopCount: 0,
      tryCatchCount: 0,
      asyncAwaitCount: 0,
      callbackCount: 0,
      commentLines: 0,
      codeToCommentRatio: 0
    };
  }

  private calculateLinesOfCode(node: ts.FunctionLikeDeclaration): number {
    const text = node.getFullText();
    const lines = text.split('\n');
    
    // Count non-empty, non-comment lines
    let count = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0 && 
          !trimmed.startsWith('//') && 
          !trimmed.startsWith('/*') &&
          !trimmed.startsWith('*') &&
          !trimmed.endsWith('*/')) {
        count++;
      }
    }
    
    return count;
  }

  private calculateTotalLines(node: ts.FunctionLikeDeclaration): number {
    return node.getFullText().split('\n').length;
  }

  private calculateCyclomaticComplexity(node: ts.FunctionLikeDeclaration): number {
    let complexity = 1; // Base complexity

    const visit = (node: ts.Node) => {
      switch (node.kind) {
        case ts.SyntaxKind.IfStatement:
        case ts.SyntaxKind.WhileStatement:
        case ts.SyntaxKind.DoStatement:
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.CaseClause:
        case ts.SyntaxKind.CatchClause:
        case ts.SyntaxKind.ConditionalExpression:
          complexity++;
          break;
        
        case ts.SyntaxKind.BinaryExpression:
          const binExpr = node as ts.BinaryExpression;
          if (binExpr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
              binExpr.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
            complexity++;
          }
          break;
      }

      ts.forEachChild(node, visit);
    };

    visit(node);
    return complexity;
  }

  private calculateCognitiveComplexity(node: ts.FunctionLikeDeclaration): number {
    let complexity = 0;
    let nestingLevel = 0;

    const visit = (node: ts.Node, isNested: boolean = false) => {
      let localIncrement = 0;
      let incrementsNesting = false;

      switch (node.kind) {
        case ts.SyntaxKind.IfStatement:
          localIncrement = 1;
          incrementsNesting = true;
          break;
        
        case ts.SyntaxKind.SwitchStatement:
          localIncrement = 1;
          incrementsNesting = true;
          break;
        
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.WhileStatement:
        case ts.SyntaxKind.DoStatement:
          localIncrement = 1;
          incrementsNesting = true;
          break;
        
        case ts.SyntaxKind.CatchClause:
          localIncrement = 1;
          incrementsNesting = true;
          break;
        
        case ts.SyntaxKind.ConditionalExpression:
          localIncrement = 1;
          break;
        
        case ts.SyntaxKind.BinaryExpression:
          const binExpr = node as ts.BinaryExpression;
          if (binExpr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
              binExpr.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
            localIncrement = 1;
          }
          break;
      }

      // Add nesting bonus
      if (isNested && localIncrement > 0) {
        localIncrement += nestingLevel;
      }

      complexity += localIncrement;

      // Increase nesting level for children
      if (incrementsNesting) {
        nestingLevel++;
      }

      ts.forEachChild(node, child => visit(child, true));

      // Decrease nesting level
      if (incrementsNesting) {
        nestingLevel--;
      }
    };

    visit(node);
    return complexity;
  }

  private calculateMaxNestingLevel(node: ts.FunctionLikeDeclaration): number {
    let maxLevel = 0;
    let currentLevel = 0;

    const visit = (node: ts.Node) => {
      const isNestingNode = this.isNestingNode(node);
      
      if (isNestingNode) {
        currentLevel++;
        maxLevel = Math.max(maxLevel, currentLevel);
      }

      ts.forEachChild(node, visit);

      if (isNestingNode) {
        currentLevel--;
      }
    };

    visit(node);
    return maxLevel;
  }

  private isNestingNode(node: ts.Node): boolean {
    return (
      ts.isIfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isSwitchStatement(node) ||
      ts.isTryStatement(node) ||
      ts.isCatchClause(node) ||
      ts.isBlock(node)
    );
  }

  private countReturnStatements(node: ts.FunctionLikeDeclaration): number {
    let count = 0;

    const visit = (node: ts.Node) => {
      if (ts.isReturnStatement(node)) {
        count++;
      }
      ts.forEachChild(node, visit);
    };

    visit(node);
    return count;
  }

  private countBranches(node: ts.FunctionLikeDeclaration): number {
    let count = 0;

    const visit = (node: ts.Node) => {
      if (ts.isIfStatement(node) || ts.isSwitchStatement(node)) {
        count++;
      }
      ts.forEachChild(node, visit);
    };

    visit(node);
    return count;
  }

  private countLoops(node: ts.FunctionLikeDeclaration): number {
    let count = 0;

    const visit = (node: ts.Node) => {
      if (ts.isForStatement(node) || 
          ts.isForInStatement(node) || 
          ts.isForOfStatement(node) || 
          ts.isWhileStatement(node) || 
          ts.isDoStatement(node)) {
        count++;
      }
      ts.forEachChild(node, visit);
    };

    visit(node);
    return count;
  }

  private countTryCatch(node: ts.FunctionLikeDeclaration): number {
    let count = 0;

    const visit = (node: ts.Node) => {
      if (ts.isTryStatement(node)) {
        count++;
      }
      ts.forEachChild(node, visit);
    };

    visit(node);
    return count;
  }

  private countAsyncAwait(node: ts.FunctionLikeDeclaration): number {
    let count = 0;

    const visit = (node: ts.Node) => {
      if (node.kind === ts.SyntaxKind.AwaitExpression) {
        count++;
      }
      ts.forEachChild(node, visit);
    };

    visit(node);
    return count;
  }

  private countCallbacks(node: ts.FunctionLikeDeclaration): number {
    let count = 0;

    const visit = (node: ts.Node) => {
      // Count function expressions and arrow functions passed as arguments
      if ((ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && 
          ts.isCallExpression(node.parent)) {
        count++;
      }
      ts.forEachChild(node, visit);
    };

    visit(node);
    return count;
  }

  private calculateCommentLines(node: ts.FunctionLikeDeclaration): number {
    const text = node.getFullText();
    const lines = text.split('\n');
    
    let count = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || 
          trimmed.startsWith('/*') || 
          trimmed.startsWith('*') ||
          trimmed.endsWith('*/')) {
        count++;
      }
    }
    
    return count;
  }

  private calculateHalsteadVolume(node: ts.FunctionLikeDeclaration): number {
    // Simplified Halstead volume calculation
    const operators = new Set<string>();
    const operands = new Set<string>();

    const visit = (node: ts.Node) => {
      const text = node.getText();
      
      // Count operators (simplified)
      if (ts.isBinaryExpression(node)) {
        operators.add(node.operatorToken.getText());
      }
      
      // Count operands (identifiers, literals)
      if (ts.isIdentifier(node) || ts.isLiteralExpression(node)) {
        operands.add(text);
      }

      ts.forEachChild(node, visit);
    };

    visit(node);

    const n1 = operators.size; // Unique operators
    const n2 = operands.size;  // Unique operands
    const vocabulary = n1 + n2;
    const length = node.getFullText().length; // Simplified

    return vocabulary > 0 ? length * Math.log2(vocabulary) : 0;
  }

  private calculateHalsteadDifficulty(node: ts.FunctionLikeDeclaration): number {
    // Simplified Halstead difficulty calculation
    // This is a placeholder implementation
    return 1;
  }

  private calculateMaintainabilityIndex(metrics: QualityMetrics): number {
    // Microsoft's maintainability index formula (simplified)
    const complexity = metrics.cyclomaticComplexity;
    const loc = metrics.linesOfCode;
    const volume = metrics.halsteadVolume || 0;

    if (loc === 0) return 100;

    let mi = 171 - 5.2 * Math.log(volume) - 0.23 * complexity - 16.2 * Math.log(loc);
    
    // Normalize to 0-100 scale
    mi = Math.max(0, Math.min(100, mi));
    
    return Math.round(mi);
  }
}

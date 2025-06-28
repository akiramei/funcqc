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

    const linesOfCode = this.calculateLinesOfCode(functionNode);
    const commentLines = this.calculateCommentLines(functionNode);
    const cyclomaticComplexity = this.calculateCyclomaticComplexity(functionNode);
    const halsteadVolume = this.calculateHalsteadVolume(functionNode);
    const halsteadDifficulty = this.calculateHalsteadDifficulty(functionNode);

    const metrics = {
      linesOfCode,
      totalLines: this.calculateTotalLines(functionNode),
      cyclomaticComplexity,
      cognitiveComplexity: this.calculateCognitiveComplexity(functionNode),
      maxNestingLevel: this.calculateMaxNestingLevel(functionNode),
      parameterCount: functionInfo.parameters.length,
      returnStatementCount: this.countReturnStatements(functionNode),
      branchCount: this.countBranches(functionNode),
      loopCount: this.countLoops(functionNode),
      tryCatchCount: this.countTryCatch(functionNode),
      asyncAwaitCount: this.countAsyncAwait(functionNode),
      callbackCount: this.countCallbacks(functionNode),
      commentLines,
      codeToCommentRatio: linesOfCode > 0 ? Math.round((commentLines / linesOfCode) * 100) / 100 : 0,
      halsteadVolume,
      halsteadDifficulty,
      maintainabilityIndex: this.calculateMaintainabilityIndex({
        cyclomaticComplexity,
        linesOfCode,
        halsteadVolume
      })
    };

    return metrics;
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
      const complexityInfo = this.getCognitiveComplexityInfo(node);
      
      // Add nesting bonus
      let localIncrement = complexityInfo.increment;
      if (isNested && localIncrement > 0) {
        localIncrement += nestingLevel;
      }

      complexity += localIncrement;

      // Manage nesting level
      if (complexityInfo.incrementsNesting) {
        nestingLevel++;
      }

      ts.forEachChild(node, child => visit(child, true));

      if (complexityInfo.incrementsNesting) {
        nestingLevel--;
      }
    };

    visit(node);
    return complexity;
  }

  private getCognitiveComplexityInfo(node: ts.Node): { increment: number; incrementsNesting: boolean } {
    const controlFlowNodes = [
      ts.SyntaxKind.IfStatement,
      ts.SyntaxKind.SwitchStatement,
      ts.SyntaxKind.CatchClause
    ];

    const loopNodes = [
      ts.SyntaxKind.ForStatement,
      ts.SyntaxKind.ForInStatement,
      ts.SyntaxKind.ForOfStatement,
      ts.SyntaxKind.WhileStatement,
      ts.SyntaxKind.DoStatement
    ];

    if (controlFlowNodes.includes(node.kind) || loopNodes.includes(node.kind)) {
      return { increment: 1, incrementsNesting: true };
    }

    if (node.kind === ts.SyntaxKind.ConditionalExpression) {
      return { increment: 1, incrementsNesting: false };
    }

    if (node.kind === ts.SyntaxKind.BinaryExpression) {
      const binExpr = node as ts.BinaryExpression;
      const isLogicalOperator = 
        binExpr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        binExpr.operatorToken.kind === ts.SyntaxKind.BarBarToken;
      
      return { increment: isLogicalOperator ? 1 : 0, incrementsNesting: false };
    }

    return { increment: 0, incrementsNesting: false };
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
    const operators = new Set<string>();
    const operands = new Set<string>();
    let totalOperators = 0;
    let totalOperands = 0;

    const visit = (node: ts.Node) => {
      // Count operators
      if (ts.isBinaryExpression(node)) {
        const op = node.operatorToken.getText();
        operators.add(op);
        totalOperators++;
      } else if (ts.isUnaryExpression(node)) {
        const op = node.operator === ts.SyntaxKind.PlusPlusToken ? '++' :
                   node.operator === ts.SyntaxKind.MinusMinusToken ? '--' :
                   node.operator === ts.SyntaxKind.ExclamationToken ? '!' :
                   node.operator === ts.SyntaxKind.TildeToken ? '~' :
                   node.operator === ts.SyntaxKind.PlusToken ? '+' :
                   node.operator === ts.SyntaxKind.MinusToken ? '-' : '';
        if (op) {
          operators.add(op);
          totalOperators++;
        }
      } else if (ts.isAssignmentExpression(node)) {
        operators.add('=');
        totalOperators++;
      } else if (ts.isCallExpression(node)) {
        operators.add('()');
        totalOperators++;
      } else if (ts.isPropertyAccessExpression(node)) {
        operators.add('.');
        totalOperators++;
      } else if (ts.isElementAccessExpression(node)) {
        operators.add('[]');
        totalOperators++;
      }

      // Count operands (identifiers, literals, etc.)
      if (ts.isIdentifier(node) || ts.isLiteralExpression(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
        const text = node.getText();
        operands.add(text);
        totalOperands++;
      }

      ts.forEachChild(node, visit);
    };

    visit(node);

    const n1 = operators.size; // Unique operators
    const n2 = operands.size;  // Unique operands
    const N1 = totalOperators; // Total operators
    const N2 = totalOperands;  // Total operands

    const vocabulary = n1 + n2;
    const length = N1 + N2;

    // Halstead Volume = Length * log2(Vocabulary)
    return vocabulary > 0 ? Math.round(length * Math.log2(vocabulary) * 100) / 100 : 0;
  }

  private calculateHalsteadDifficulty(node: ts.FunctionLikeDeclaration): number {
    const operators = new Set<string>();
    const operands = new Set<string>();
    let totalOperands = 0;

    const visit = (node: ts.Node) => {
      // Count operators
      if (ts.isBinaryExpression(node)) {
        operators.add(node.operatorToken.getText());
      } else if (ts.isUnaryExpression(node)) {
        const op = node.operator === ts.SyntaxKind.PlusPlusToken ? '++' :
                   node.operator === ts.SyntaxKind.MinusMinusToken ? '--' :
                   node.operator === ts.SyntaxKind.ExclamationToken ? '!' :
                   node.operator === ts.SyntaxKind.TildeToken ? '~' :
                   node.operator === ts.SyntaxKind.PlusToken ? '+' :
                   node.operator === ts.SyntaxKind.MinusToken ? '-' : '';
        if (op) operators.add(op);
      } else if (ts.isAssignmentExpression(node)) {
        operators.add('=');
      } else if (ts.isCallExpression(node)) {
        operators.add('()');
      } else if (ts.isPropertyAccessExpression(node)) {
        operators.add('.');
      } else if (ts.isElementAccessExpression(node)) {
        operators.add('[]');
      }

      // Count operands
      if (ts.isIdentifier(node) || ts.isLiteralExpression(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
        const text = node.getText();
        operands.add(text);
        totalOperands++;
      }

      ts.forEachChild(node, visit);
    };

    visit(node);

    const n1 = operators.size; // Unique operators
    const n2 = operands.size;  // Unique operands
    const N2 = totalOperands;  // Total operands

    // Halstead Difficulty = (n1/2) * (N2/n2)
    // Avoid division by zero
    if (n2 === 0) return 0;
    
    const difficulty = (n1 / 2) * (N2 / n2);
    return Math.round(difficulty * 100) / 100;
  }

  private calculateMaintainabilityIndex(partialMetrics: { cyclomaticComplexity: number; linesOfCode: number; halsteadVolume: number }): number {
    // Microsoft's maintainability index formula (simplified)
    const complexity = partialMetrics.cyclomaticComplexity;
    const loc = partialMetrics.linesOfCode;
    const volume = partialMetrics.halsteadVolume || 0;

    if (loc === 0) return 100;

    // Ensure we have valid values for the logarithms
    const safeVolume = Math.max(1, volume);
    const safeLoc = Math.max(1, loc);

    let mi = 171 - 5.2 * Math.log(safeVolume) - 0.23 * complexity - 16.2 * Math.log(safeLoc);
    
    // Normalize to 0-100 scale
    mi = Math.max(0, Math.min(100, mi));
    
    return Math.round(mi * 100) / 100;
  }
}

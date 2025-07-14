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
      codeToCommentRatio:
        linesOfCode > 0 ? Math.round((commentLines / linesOfCode) * 100) / 100 : 0,
      halsteadVolume,
      halsteadDifficulty,
      maintainabilityIndex: this.calculateMaintainabilityIndex({
        cyclomaticComplexity,
        linesOfCode,
        halsteadVolume,
      }),
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
      codeToCommentRatio: 0,
    };
  }

  private calculateLinesOfCode(node: ts.FunctionLikeDeclaration): number {
    const text = node.getFullText();
    const lines = text.split('\n');

    // Count non-empty, non-comment lines
    let count = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.length > 0 &&
        !trimmed.startsWith('//') &&
        !trimmed.startsWith('/*') &&
        !trimmed.startsWith('*') &&
        !trimmed.endsWith('*/')
      ) {
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

        case ts.SyntaxKind.BinaryExpression: {
          const binExpr = node as ts.BinaryExpression;
          if (
            binExpr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
            binExpr.operatorToken.kind === ts.SyntaxKind.BarBarToken
          ) {
            complexity++;
          }
          break;
        }
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

      // Add nesting bonus for complexity increment
      let localIncrement = complexityInfo.increment;
      if (isNested && localIncrement > 0) {
        localIncrement += nestingLevel;
      }

      complexity += localIncrement;

      // Manage nesting level
      if (complexityInfo.incrementsNesting) {
        nestingLevel++;
      }

      // Special handling for switch statements
      if (ts.isSwitchStatement(node)) {
        // Visit switch expression without nesting increment
        ts.forEachChild(node.expression, child => visit(child, isNested));
        
        // Visit case block with proper nesting
        if (node.caseBlock) {
          ts.forEachChild(node.caseBlock, child => visit(child, true));
        }
      } else {
        ts.forEachChild(node, child => visit(child, true));
      }

      if (complexityInfo.incrementsNesting) {
        nestingLevel--;
      }
    };

    visit(node);
    return complexity;
  }

  private getCognitiveComplexityInfo(node: ts.Node): {
    increment: number;
    incrementsNesting: boolean;
  } {
    // Basic control flow structures (contribute to complexity and nesting)
    const basicControlFlowNodes = [
      ts.SyntaxKind.IfStatement,
      ts.SyntaxKind.CatchClause,
    ];

    const loopNodes = [
      ts.SyntaxKind.ForStatement,
      ts.SyntaxKind.ForInStatement,
      ts.SyntaxKind.ForOfStatement,
      ts.SyntaxKind.WhileStatement,
      ts.SyntaxKind.DoStatement,
    ];

    // Handle switch statements with enhanced logic
    if (node.kind === ts.SyntaxKind.SwitchStatement) {
      return this.getSwitchComplexityInfo(node as ts.SwitchStatement);
    }

    // Handle case clauses specifically
    if (node.kind === ts.SyntaxKind.CaseClause) {
      return this.getCaseClauseComplexityInfo(node as ts.CaseClause);
    }

    // Handle default clause specifically
    if (node.kind === ts.SyntaxKind.DefaultClause) {
      return { increment: 1, incrementsNesting: false }; // Default clause adds complexity but doesn't nest
    }

    if (basicControlFlowNodes.includes(node.kind) || loopNodes.includes(node.kind)) {
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

  /**
   * Enhanced switch statement complexity calculation
   * Switch statements contribute +1 and increase nesting level
   */
  private getSwitchComplexityInfo(_switchNode: ts.SwitchStatement): {
    increment: number;
    incrementsNesting: boolean;
  } {
    return { increment: 1, incrementsNesting: true };
  }

  /**
   * Enhanced case clause complexity calculation
   * Each case adds complexity but doesn't create additional nesting
   * (the nesting is already accounted for by the switch statement)
   */
  private getCaseClauseComplexityInfo(caseNode: ts.CaseClause): {
    increment: number;
    incrementsNesting: boolean;
  } {
    // Check if this case has a fall-through pattern (no break/return)
    const hasFallThrough = this.caseHasFallThrough(caseNode);
    
    // Fall-through cases add extra cognitive load
    const increment = hasFallThrough ? 2 : 1;
    
    return { increment, incrementsNesting: false };
  }

  /**
   * Detect if a case clause has fall-through behavior (excluding intentional)
   */
  private caseHasFallThrough(caseNode: ts.CaseClause): boolean {
    if (!caseNode.statements || caseNode.statements.length === 0) {
      // Check for intentional fall-through comment in empty case
      return !this.hasIntentionalFallThroughComment(caseNode);
    }

    const lastStatement = caseNode.statements[caseNode.statements.length - 1];
    
    // Check for explicit break/return/throw/continue statements
    const hasControlFlow = (
      ts.isBreakStatement(lastStatement) ||
      ts.isReturnStatement(lastStatement) ||
      ts.isThrowStatement(lastStatement) ||
      ts.isContinueStatement(lastStatement) ||
      this.endsWithControlFlow(lastStatement)
    );

    if (hasControlFlow) {
      return false; // Has proper control flow
    }

    // Check for intentional fall-through comment
    return !this.hasIntentionalFallThroughComment(caseNode);
  }

  /**
   * Check for intentional fall-through comments
   */
  private hasIntentionalFallThroughComment(caseNode: ts.CaseClause): boolean {
    const sourceFile = caseNode.getSourceFile();
    const text = sourceFile.text;
    
    // Get leading comments for the case node
    const leadingComments = ts.getLeadingCommentRanges(text, caseNode.getFullStart());
    
    // Get trailing comments for the case node (more common for fall-through)
    const trailingComments = ts.getTrailingCommentRanges(text, caseNode.getEnd());
    
    // Check comments within the case statements
    let internalComments: ts.CommentRange[] = [];
    if (caseNode.statements && caseNode.statements.length > 0) {
      const startPos = caseNode.statements[0].getFullStart();
      const endPos = caseNode.statements[caseNode.statements.length - 1].getEnd();
      internalComments = this.getCommentsInRange(text, startPos, endPos);
    }
    
    const allComments = [
      ...(leadingComments || []),
      ...(trailingComments || []),
      ...internalComments
    ];
    
    // Check if any comment indicates intentional fall-through
    const fallThroughPatterns = [
      /fall\s*through/i,
      /fallthrough/i,
      /fall\s*thru/i,
      /intended\s*fall/i,
      /no\s*break/i
    ];
    
    return allComments.some(comment => {
      const commentText = text.substring(comment.pos, comment.end);
      return fallThroughPatterns.some(pattern => pattern.test(commentText));
    });
  }

  /**
   * Get all comments within a text range
   */
  private getCommentsInRange(text: string, start: number, end: number): ts.CommentRange[] {
    const comments: ts.CommentRange[] = [];
    let pos = start;
    
    while (pos < end) {
      const leadingComments = ts.getLeadingCommentRanges(text, pos);
      if (leadingComments) {
        comments.push(...leadingComments.filter(c => c.pos >= start && c.end <= end));
        pos = leadingComments[leadingComments.length - 1].end;
      } else {
        pos++;
      }
    }
    
    return comments;
  }

  /**
   * Check if a statement ends with control flow that prevents fall-through
   */
  private endsWithControlFlow(statement: ts.Statement): boolean {
    // Check for if/else structures that both return/break/throw
    if (ts.isIfStatement(statement)) {
      const hasElse = statement.elseStatement !== undefined;
      if (!hasElse) return false;
      
      const thenEnds = this.blockEndsWithControlFlow(statement.thenStatement);
      const elseEnds = this.blockEndsWithControlFlow(statement.elseStatement!);
      
      return thenEnds && elseEnds;
    }
    
    // Check for switch statements (they don't prevent fall-through by default)
    if (ts.isSwitchStatement(statement)) {
      return false; // Switch statements don't prevent fall-through
    }
    
    return false;
  }

  /**
   * Check if a statement block ends with control flow
   */
  private blockEndsWithControlFlow(statement: ts.Statement): boolean {
    if (ts.isBlock(statement)) {
      if (statement.statements.length === 0) return false;
      const lastStmt = statement.statements[statement.statements.length - 1];
      return (
        ts.isBreakStatement(lastStmt) ||
        ts.isReturnStatement(lastStmt) ||
        ts.isThrowStatement(lastStmt) ||
        ts.isContinueStatement(lastStmt) ||
        this.endsWithControlFlow(lastStmt)
      );
    }
    
    return (
      ts.isBreakStatement(statement) ||
      ts.isReturnStatement(statement) ||
      ts.isThrowStatement(statement) ||
      ts.isContinueStatement(statement) ||
      this.endsWithControlFlow(statement)
    );
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
      if (
        ts.isForStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isWhileStatement(node) ||
        ts.isDoStatement(node)
      ) {
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
      if (
        (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) &&
        ts.isCallExpression(node.parent)
      ) {
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
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*') ||
        trimmed.endsWith('*/')
      ) {
        count++;
      }
    }

    return count;
  }

  private calculateHalsteadVolume(node: ts.FunctionLikeDeclaration): number {
    const metrics = this.collectHalsteadMetrics(node);
    const vocabulary = metrics.uniqueOperators + metrics.uniqueOperands;
    const length = metrics.totalOperators + metrics.totalOperands;

    // Halstead Volume = Length * log2(Vocabulary)
    return vocabulary > 0 ? Math.round(length * Math.log2(vocabulary) * 100) / 100 : 0;
  }

  private collectHalsteadMetrics(node: ts.FunctionLikeDeclaration) {
    const operators = new Set<string>();
    const operands = new Set<string>();
    let totalOperators = 0;
    let totalOperands = 0;

    const visit = (node: ts.Node) => {
      this.processOperators(node, operators, () => totalOperators++);
      this.processOperands(node, operands, () => totalOperands++);
      ts.forEachChild(node, visit);
    };

    visit(node);

    return {
      uniqueOperators: operators.size,
      uniqueOperands: operands.size,
      totalOperators,
      totalOperands,
    };
  }

  private processOperators(node: ts.Node, operators: Set<string>, incrementTotal: () => void) {
    if (ts.isBinaryExpression(node)) {
      this.processBinaryOperator(node, operators, incrementTotal);
      return;
    }

    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      this.processUnaryOperator(node, operators, incrementTotal);
      return;
    }

    if (ts.isCallExpression(node)) {
      this.addOperator('()', operators, incrementTotal);
      return;
    }

    if (ts.isPropertyAccessExpression(node)) {
      this.addOperator('.', operators, incrementTotal);
      return;
    }

    if (ts.isElementAccessExpression(node)) {
      this.addOperator('[]', operators, incrementTotal);
    }
  }

  private processBinaryOperator(
    node: ts.BinaryExpression,
    operators: Set<string>,
    incrementTotal: () => void
  ) {
    const op = node.operatorToken.getText();
    this.addOperator(op, operators, incrementTotal);
  }

  private processUnaryOperator(
    node: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression,
    operators: Set<string>,
    incrementTotal: () => void
  ) {
    const op = this.getUnaryOperator(node);
    if (op) {
      this.addOperator(op, operators, incrementTotal);
    }
  }

  private addOperator(operator: string, operators: Set<string>, incrementTotal: () => void) {
    operators.add(operator);
    incrementTotal();
  }

  private getUnaryOperator(node: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression): string {
    switch (node.operator) {
      case ts.SyntaxKind.PlusPlusToken:
        return '++';
      case ts.SyntaxKind.MinusMinusToken:
        return '--';
      case ts.SyntaxKind.ExclamationToken:
        return '!';
      case ts.SyntaxKind.TildeToken:
        return '~';
      case ts.SyntaxKind.PlusToken:
        return '+';
      case ts.SyntaxKind.MinusToken:
        return '-';
      default:
        return '';
    }
  }

  private processOperands(node: ts.Node, operands: Set<string>, incrementTotal: () => void) {
    if (
      ts.isIdentifier(node) ||
      ts.isLiteralExpression(node) ||
      ts.isStringLiteral(node) ||
      ts.isNumericLiteral(node)
    ) {
      const text = node.getText();
      operands.add(text);
      incrementTotal();
    }
    
    // Include function calls as operands (missing in original implementation)
    if (ts.isCallExpression(node)) {
      const functionName = node.expression.getText();
      operands.add(functionName);
      incrementTotal();
    }
  }

  private calculateHalsteadDifficulty(node: ts.FunctionLikeDeclaration): number {
    const metrics = this.collectHalsteadMetrics(node);

    // Halstead Difficulty = (n1/2) * (N2/n2)
    // Avoid division by zero
    if (metrics.uniqueOperands === 0) return 0;

    const difficulty =
      (metrics.uniqueOperators / 2) * (metrics.totalOperands / metrics.uniqueOperands);
    return Math.round(difficulty * 100) / 100;
  }

  private calculateMaintainabilityIndex(partialMetrics: {
    cyclomaticComplexity: number;
    linesOfCode: number;
    halsteadVolume: number;
  }): number {
    // Improved Microsoft's maintainability index formula
    const complexity = partialMetrics.cyclomaticComplexity;
    const loc = partialMetrics.linesOfCode;
    const volume = partialMetrics.halsteadVolume || 0;

    if (loc === 0) return 100;

    // Use log2 for better information-theoretic interpretation
    // Ensure numerical stability with proper floor values
    const volumeTerm = Math.log2(Math.max(1, volume));
    const locTerm = Math.log2(Math.max(1, loc));

    // Adjusted coefficients for log2 and better 0-100 range
    let mi = 171 - 5.2 * volumeTerm - 0.23 * complexity - 16.2 * locTerm;

    // Normalize to 0-100 scale with better bounds
    mi = Math.max(0, Math.min(100, mi));

    return Math.round(mi * 100) / 100;
  }
}

import * as ts from 'typescript';
import { FunctionInfo, QualityMetrics } from '../types';
import { FunctionDeclaration, MethodDeclaration, ArrowFunction, FunctionExpression, ConstructorDeclaration, Node, SyntaxKind } from 'ts-morph';

export class QualityCalculator {
  /**
   * Calculate quality metrics directly from ts-morph node (optimized path)
   */
  calculateFromTsMorphNode(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration,
    functionInfo: FunctionInfo
  ): QualityMetrics {
    // Direct calculation from ts-morph node without re-parsing
    return this.calculateMetricsFromTsMorphNode(node, functionInfo);
  }

  /**
   * Calculate quality metrics for a function (legacy method)
   * WARNING: This method creates a new AST - prefer calculateFromTsMorphNode for performance
   */
  calculate(functionInfo: FunctionInfo): QualityMetrics {
    // Log usage of legacy path for monitoring
    if (process.env['NODE_ENV'] !== 'production') {
      console.warn(`⚠️  Using legacy AST creation for ${functionInfo.name} - consider optimizing the call path`);
    }
    
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
        // Check if this is the function we're looking for
        const nodeName = this.getFunctionName(node);
        if (nodeName === functionInfo.name) {
          functionNode = node as ts.FunctionLikeDeclaration;
          return;
        }
        // If no exact match found yet, keep the first function-like node as fallback
        if (!functionNode) {
          functionNode = node as ts.FunctionLikeDeclaration;
        }
      }
      ts.forEachChild(node, findFunction);
    };

    findFunction(sourceFile);

    if (!functionNode) {
      // Fallback to basic metrics from text analysis
      return this.calculateFromText(functionInfo);
    }

    return this.calculateMetricsFromTsNode(functionNode, functionInfo);
  }

  /**
   * Calculate metrics from TypeScript AST node (shared logic)
   */
  private calculateMetricsFromTsNode(tsNode: ts.FunctionLikeDeclaration, functionInfo: FunctionInfo): QualityMetrics {
    const linesOfCode = this.calculateLinesOfCode(tsNode);
    const commentLines = this.calculateCommentLines(tsNode);
    const cyclomaticComplexity = this.calculateCyclomaticComplexity(tsNode);
    const halsteadVolume = this.calculateHalsteadVolume(tsNode);
    const halsteadDifficulty = this.calculateHalsteadDifficulty(tsNode);

    const metrics = {
      linesOfCode,
      totalLines: this.calculateTotalLines(tsNode),
      cyclomaticComplexity,
      cognitiveComplexity: this.calculateCognitiveComplexity(tsNode),
      maxNestingLevel: this.calculateMaxNestingLevel(tsNode),
      parameterCount: functionInfo.parameters.length,
      returnStatementCount: this.countReturnStatements(tsNode),
      branchCount: this.countBranches(tsNode),
      loopCount: this.countLoops(tsNode),
      tryCatchCount: this.countTryCatch(tsNode),
      asyncAwaitCount: this.countAsyncAwait(tsNode),
      callbackCount: this.countCallbacks(tsNode),
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
      halsteadVolume: 0,
      halsteadDifficulty: 0,
      maintainabilityIndex: 100, // Default high maintainability for simple functions
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

  /**
   * Calculate quality metrics directly from ts-morph node (NEW: no re-parsing)
   */
  private calculateMetricsFromTsMorphNode(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration,
    functionInfo: FunctionInfo
  ): QualityMetrics {
    // Calculate metrics directly from ts-morph node
    const linesOfCode = this.calculateLinesOfCodeFromTsMorph(node);
    const totalLines = this.calculateTotalLinesFromTsMorph(node);
    const cyclomaticComplexity = this.calculateCyclomaticComplexityFromTsMorph(node);
    const cognitiveComplexity = this.calculateCognitiveComplexityFromTsMorph(node);
    const maxNestingLevel = this.calculateMaxNestingLevelFromTsMorph(node);
    const parameterCount = functionInfo.parameters.length;

    // Count other metrics
    const returnStatementCount = this.countReturnStatementsFromTsMorph(node);
    const branchCount = this.countBranchesFromTsMorph(node);
    const loopCount = this.countLoopsFromTsMorph(node);
    const tryCatchCount = this.countTryCatchFromTsMorph(node);
    const asyncAwaitCount = this.countAsyncAwaitFromTsMorph(node);
    const callbackCount = this.countCallbacksFromTsMorph(node);
    
    // Calculate Halstead metrics and other advanced metrics
    // For these metrics, we need to parse the source code as TypeScript AST
    // because they require detailed token analysis
    const sourceFile = ts.createSourceFile(
      'temp.ts',
      functionInfo.sourceCode || node.getFullText(),
      ts.ScriptTarget.Latest,
      true
    );
    
    // Find the function node in the parsed AST
    let tsNode: ts.FunctionLikeDeclaration | null = null;
    const findFunction = (node: ts.Node) => {
      if (this.isFunctionLike(node)) {
        tsNode = node as ts.FunctionLikeDeclaration;
        return;
      }
      ts.forEachChild(node, findFunction);
    };
    findFunction(sourceFile);
    
    const halsteadVolume = tsNode ? this.calculateHalsteadVolume(tsNode) : 0;
    const halsteadDifficulty = tsNode ? this.calculateHalsteadDifficulty(tsNode) : 0;
    const commentLines = tsNode ? this.calculateCommentLines(tsNode) : 0;
    const codeToCommentRatio = linesOfCode > 0 && commentLines > 0 ? linesOfCode / commentLines : 0;
    
    // Calculate maintainability index
    const maintainabilityIndex = this.calculateMaintainabilityIndex({
      cyclomaticComplexity,
      linesOfCode,
      halsteadVolume
    });

    return {
      linesOfCode,
      totalLines,
      cyclomaticComplexity,
      cognitiveComplexity,
      maxNestingLevel,
      parameterCount,
      returnStatementCount,
      branchCount,
      loopCount,
      tryCatchCount,
      asyncAwaitCount,
      callbackCount,
      commentLines,
      codeToCommentRatio,
      halsteadVolume,
      halsteadDifficulty,
      maintainabilityIndex,
    };
  }

  /**
   * Calculate cyclomatic complexity using ts-morph (McCabe standard)
   * Based on provided reference implementation
   */
  private calculateCyclomaticComplexityFromTsMorph(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration
  ): number {
    let complexity = 1; // Base complexity

    // Count decision points using ts-morph traversal
    node.forEachDescendant((descendant) => {
      if (this.isDecisionNodeTsMorph(descendant)) {
        complexity++;
      }
    });

    return complexity;
  }

  /**
   * Determine if a ts-morph node is a decision point (based on reference implementation)
   */
  private isDecisionNodeTsMorph(node: Node): boolean {
    const kind = node.getKind();
    
    switch (kind) {
      // Basic control flow
      case SyntaxKind.IfStatement:
      case SyntaxKind.WhileStatement:
      case SyntaxKind.DoStatement:
      case SyntaxKind.ForStatement:
      case SyntaxKind.ForInStatement:
      case SyntaxKind.ForOfStatement:
      case SyntaxKind.CaseClause:         // switch case
      case SyntaxKind.DefaultClause:      // switch default
      case SyntaxKind.CatchClause:
      case SyntaxKind.ConditionalExpression: // ternary operator ?:
        return true;

      // Logical operators (short-circuit evaluation)
      case SyntaxKind.BinaryExpression: {
        if (!Node.isBinaryExpression(node)) return false;
        const op = node.getOperatorToken().getKind();
        return (
          op === SyntaxKind.AmpersandAmpersandToken ||  // &&
          op === SyntaxKind.BarBarToken ||              // ||
          op === SyntaxKind.QuestionQuestionToken       // ??
        );
      }

      default:
        return false;
    }
  }

  // Helper methods for ts-morph based calculations
  private calculateLinesOfCodeFromTsMorph(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration
  ): number {
    const text = node.getFullText();
    const lines = text.split('\n');
    
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

  private calculateTotalLinesFromTsMorph(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration
  ): number {
    return node.getFullText().split('\n').length;
  }

  private calculateCognitiveComplexityFromTsMorph(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration
  ): number {
    // Simplified cognitive complexity - can be enhanced later
    return this.calculateCyclomaticComplexityFromTsMorph(node);
  }

  private calculateMaxNestingLevelFromTsMorph(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration
  ): number {
    let maxNesting = 0;
    let currentNesting = 0;

    const countNesting = (n: Node) => {
      const kind = n.getKind();
      const isNestingNode = [
        SyntaxKind.IfStatement,
        SyntaxKind.WhileStatement,
        SyntaxKind.DoStatement,
        SyntaxKind.ForStatement,
        SyntaxKind.ForInStatement,
        SyntaxKind.ForOfStatement,
        SyntaxKind.SwitchStatement,
        SyntaxKind.TryStatement
      ].includes(kind);

      if (isNestingNode) {
        currentNesting++;
        maxNesting = Math.max(maxNesting, currentNesting);
      }

      n.forEachChild(countNesting);

      if (isNestingNode) {
        currentNesting--;
      }
    };

    countNesting(node);
    return maxNesting;
  }

  private countReturnStatementsFromTsMorph(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration
  ): number {
    let count = 0;
    node.forEachDescendant((descendant) => {
      if (descendant.getKind() === SyntaxKind.ReturnStatement) {
        count++;
      }
    });
    return count;
  }

  private countBranchesFromTsMorph(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration
  ): number {
    let count = 0;
    node.forEachDescendant((descendant) => {
      const kind = descendant.getKind();
      if ([
        SyntaxKind.IfStatement,
        SyntaxKind.SwitchStatement,
        SyntaxKind.ConditionalExpression
      ].includes(kind)) {
        count++;
      }
    });
    return count;
  }

  private countLoopsFromTsMorph(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration
  ): number {
    let count = 0;
    node.forEachDescendant((descendant) => {
      const kind = descendant.getKind();
      if ([
        SyntaxKind.WhileStatement,
        SyntaxKind.DoStatement,
        SyntaxKind.ForStatement,
        SyntaxKind.ForInStatement,
        SyntaxKind.ForOfStatement
      ].includes(kind)) {
        count++;
      }
    });
    return count;
  }

  private countTryCatchFromTsMorph(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration
  ): number {
    let count = 0;
    node.forEachDescendant((descendant) => {
      if (descendant.getKind() === SyntaxKind.TryStatement) {
        count++;
      }
    });
    return count;
  }

  private countAsyncAwaitFromTsMorph(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration
  ): number {
    let count = 0;
    node.forEachDescendant((descendant) => {
      if (descendant.getKind() === SyntaxKind.AwaitExpression) {
        count++;
      }
    });
    return count;
  }

  private countCallbacksFromTsMorph(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration
  ): number {
    // Count function expressions and arrow functions passed as arguments
    let count = 0;
    node.forEachDescendant((descendant) => {
      const kind = descendant.getKind();
      if (kind === SyntaxKind.ArrowFunction || kind === SyntaxKind.FunctionExpression) {
        // Check if this is a callback (function passed as argument)
        const parent = descendant.getParent();
        if (parent && Node.isCallExpression(parent)) {
          count++;
        }
      }
    });
    return count;
  }



  private calculateCyclomaticComplexity(root: ts.FunctionLikeDeclaration): number {
    let complexity = 1; // Base complexity (McCabe standard)

    const visit = (node: ts.Node) => {
      // Skip nested functions to avoid counting their control structures
      if (node !== root && this.isFunctionLike(node)) {
        return;
      }

      // Use improved decision point detection (based on reference implementation)
      if (this.shouldIncrementComplexityImproved(node)) {
        complexity++;
      }
      ts.forEachChild(node, visit);
    };

    visit(root);
    return complexity;
  }

  /**
   * Improved decision point detection matching reference implementation
   */
  private shouldIncrementComplexityImproved(node: ts.Node): boolean {
    const kind = node.kind;
    
    switch (kind) {
      // Basic control flow
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.CaseClause:         // switch case
      case ts.SyntaxKind.DefaultClause:      // switch default
      case ts.SyntaxKind.CatchClause:
      case ts.SyntaxKind.ConditionalExpression: // ternary operator ?:
        return true;

      // Logical operators (short-circuit evaluation)
      case ts.SyntaxKind.BinaryExpression: {
        const binExpr = node as ts.BinaryExpression;
        const op = binExpr.operatorToken.kind;
        return (
          op === ts.SyntaxKind.AmpersandAmpersandToken ||  // &&
          op === ts.SyntaxKind.BarBarToken ||              // ||
          op === ts.SyntaxKind.QuestionQuestionToken       // ??
        );
      }

      default:
        return false;
    }
  }

  private calculateCognitiveComplexity(root: ts.FunctionLikeDeclaration): number {
    let complexity = 0;
    let nestingLevel = 0;

    const visit = (node: ts.Node, isNested: boolean = false) => {
      // Skip nested functions to avoid counting their control structures
      if (node !== root && this.isFunctionLike(node)) {
        return;
      }

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

    visit(root);
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
   * Enhanced to check comments before the next case clause
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
    
    // Enhanced: Check comments before the next case clause
    let nextCaseComments: ts.CommentRange[] = [];
    const nextCaseNode = this.getNextCaseNode(caseNode);
    if (nextCaseNode) {
      nextCaseComments = ts.getLeadingCommentRanges(text, nextCaseNode.getFullStart()) || [];
    }
    
    const allComments = [
      ...(leadingComments || []),
      ...(trailingComments || []),
      ...internalComments,
      ...nextCaseComments
    ];
    
    // Check if any comment indicates intentional fall-through
    const fallThroughPatterns = [
      /fall\s*through/i,
      /fallthrough/i,
      /fall\s*thru/i,
      /falls?\s*thru/i,  // Enhanced: matches "falls thru" and "fall thru" with optional space
      /intended\s*fall/i,
      /no\s*break/i
    ];
    
    return allComments.some(comment => {
      const commentText = text.substring(comment.pos, comment.end);
      return fallThroughPatterns.some(pattern => pattern.test(commentText));
    });
  }

  /**
   * Get the next case clause node for fall-through comment detection
   */
  private getNextCaseNode(currentCase: ts.CaseClause): ts.CaseClause | ts.DefaultClause | null {
    const parent = currentCase.parent;
    if (!ts.isCaseBlock(parent)) {
      return null;
    }
    
    const clauses = parent.clauses;
    const currentIndex = clauses.indexOf(currentCase);
    
    if (currentIndex === -1 || currentIndex >= clauses.length - 1) {
      return null;
    }
    
    return clauses[currentIndex + 1];
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

  private calculateMaxNestingLevel(root: ts.FunctionLikeDeclaration): number {
    let maxLevel = 0;
    let currentLevel = 0;

    const visit = (node: ts.Node) => {
      // Skip nested functions to avoid counting their nesting structures
      if (node !== root && this.isFunctionLike(node)) {
        return;
      }

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

    visit(root);
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
      ts.isCatchClause(node)
    );
  }

  private countReturnStatements(root: ts.FunctionLikeDeclaration): number {
    let count = 0;

    const visit = (node: ts.Node) => {
      // Skip nested functions to avoid counting their return statements
      if (node !== root && this.isFunctionLike(node)) {
        return;
      }

      if (ts.isReturnStatement(node)) {
        count++;
      }
      ts.forEachChild(node, visit);
    };

    visit(root);
    return count;
  }

  private countBranches(root: ts.FunctionLikeDeclaration): number {
    let count = 0;

    const visit = (node: ts.Node) => {
      // Skip nested functions to avoid counting their branches
      if (node !== root && this.isFunctionLike(node)) {
        return;
      }

      if (ts.isIfStatement(node) || ts.isSwitchStatement(node)) {
        count++;
      }
      ts.forEachChild(node, visit);
    };

    visit(root);
    return count;
  }

  private countLoops(root: ts.FunctionLikeDeclaration): number {
    let count = 0;

    const visit = (node: ts.Node) => {
      // Skip nested functions to avoid counting their loops
      if (node !== root && this.isFunctionLike(node)) {
        return;
      }

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

    visit(root);
    return count;
  }

  private countTryCatch(root: ts.FunctionLikeDeclaration): number {
    let count = 0;

    const visit = (node: ts.Node) => {
      // Skip nested functions to avoid counting their try-catch statements
      if (node !== root && this.isFunctionLike(node)) {
        return;
      }

      if (ts.isTryStatement(node)) {
        count++;
      }
      ts.forEachChild(node, visit);
    };

    visit(root);
    return count;
  }

  private countAsyncAwait(root: ts.FunctionLikeDeclaration): number {
    let count = 0;

    const visit = (node: ts.Node) => {
      // Skip nested functions to avoid counting their await expressions
      if (node !== root && this.isFunctionLike(node)) {
        return;
      }

      if (node.kind === ts.SyntaxKind.AwaitExpression) {
        count++;
      }
      ts.forEachChild(node, visit);
    };

    visit(root);
    return count;
  }

  private countCallbacks(root: ts.FunctionLikeDeclaration): number {
    let count = 0;

    const visit = (node: ts.Node) => {
      // Skip nested functions (but still count them as callbacks if they are direct children)
      if (node !== root && this.isFunctionLike(node)) {
        // Count function expressions and arrow functions passed as arguments
        if (
          (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) &&
          ts.isCallExpression(node.parent)
        ) {
          count++;
        }
        return; // Don't traverse into nested functions
      }

      ts.forEachChild(node, visit);
    };

    visit(root);
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

  /**
   * Extract function name from TypeScript AST node
   */
  private getFunctionName(node: ts.Node): string | null {
    if (ts.isFunctionDeclaration(node)) {
      return node.name?.text || null;
    }
    if (ts.isMethodDeclaration(node)) {
      if (ts.isIdentifier(node.name)) {
        return node.name.text;
      }
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      // For anonymous functions, we can't get a name
      return null;
    }
    if (ts.isConstructorDeclaration(node)) {
      return 'constructor';
    }
    return null;
  }
}

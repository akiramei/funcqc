import { Node, SyntaxKind, SourceFile, FunctionDeclaration, MethodDeclaration, ArrowFunction, FunctionExpression } from 'ts-morph';

/**
 * AST Canonicalizer for TypeScript functions
 * Converts AST nodes to canonical representation for structural similarity comparison
 */
export class ASTCanonicalizer {
  private identifierCounter = 0;
  private identifierMap = new Map<string, string>();

  /**
   * Canonicalize a function's AST to a normalized string representation
   */
  canonicalize(functionNode: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression): string {
    // Reset state for each function
    this.identifierCounter = 0;
    this.identifierMap.clear();

    const body = functionNode.getBody();
    if (!body) return '';

    return this.canonicalizeNode(body);
  }

  /**
   * Canonicalize source code by parsing it and extracting the function body
   */
  canonicalizeSourceCode(sourceCode: string, sourceFile: SourceFile): string {
    try {
      // Create a temporary source file to parse the function
      const tempFile = sourceFile.getProject().createSourceFile(
        'temp.ts',
        sourceCode,
        { overwrite: true }
      );

      // Find the first function in the code
      const functions = tempFile.getFunctions();
      const methods = tempFile.getClasses().flatMap(cls => cls.getMethods());
      const arrows = this.findArrowFunctions(tempFile);

      const allFunctions = [...functions, ...methods, ...arrows];
      
      if (allFunctions.length > 0) {
        const result = this.canonicalize(allFunctions[0]);
        // Clean up
        sourceFile.getProject().removeSourceFile(tempFile);
        return result;
      }

      // Clean up
      sourceFile.getProject().removeSourceFile(tempFile);
      return '';
    } catch (error) {
      return '';
    }
  }

  private findArrowFunctions(sourceFile: SourceFile): (ArrowFunction | FunctionExpression)[] {
    const arrows: (ArrowFunction | FunctionExpression)[] = [];
    
    sourceFile.forEachDescendant(node => {
      if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
        arrows.push(node);
      }
    });
    
    return arrows;
  }

  private canonicalizeNode(node: Node): string {
    const kind = node.getKind();

    // Handle different node types
    switch (kind) {
      case SyntaxKind.Block:
        return this.canonicalizeBlock(node);
      
      case SyntaxKind.IfStatement:
        return this.canonicalizeIfStatement(node);
      
      case SyntaxKind.ForStatement:
      case SyntaxKind.ForInStatement:
      case SyntaxKind.ForOfStatement:
      case SyntaxKind.WhileStatement:
        return this.canonicalizeLoop(node);
      
      case SyntaxKind.ReturnStatement:
        return this.canonicalizeReturnStatement(node);
      
      case SyntaxKind.VariableStatement:
        return this.canonicalizeVariableStatement(node);
      
      case SyntaxKind.ExpressionStatement:
        return this.canonicalizeExpressionStatement(node);
      
      case SyntaxKind.TryStatement:
        return this.canonicalizeTryStatement(node);
      
      case SyntaxKind.SwitchStatement:
        return this.canonicalizeSwitchStatement(node);
      
      case SyntaxKind.Identifier:
        return this.canonicalizeIdentifier(node.getText());
      
      case SyntaxKind.CallExpression:
        return this.canonicalizeCallExpression(node);
      
      case SyntaxKind.BinaryExpression:
        return this.canonicalizeBinaryExpression(node);
      
      case SyntaxKind.PropertyAccessExpression:
        return this.canonicalizePropertyAccess(node);
      
      // Literals and constants
      case SyntaxKind.StringLiteral:
      case SyntaxKind.NoSubstitutionTemplateLiteral:
        return '"STRING"';
      
      case SyntaxKind.NumericLiteral:
        return 'NUMBER';
      
      case SyntaxKind.TrueKeyword:
      case SyntaxKind.FalseKeyword:
        return 'BOOLEAN';
      
      case SyntaxKind.NullKeyword:
        return 'NULL';
      
      case SyntaxKind.UndefinedKeyword:
        return 'UNDEFINED';
      
      // Keywords - preserve structural meaning
      case SyntaxKind.IfKeyword:
        return 'if';
      case SyntaxKind.ElseKeyword:
        return 'else';
      case SyntaxKind.ForKeyword:
        return 'for';
      case SyntaxKind.WhileKeyword:
        return 'while';
      case SyntaxKind.ReturnKeyword:
        return 'return';
      case SyntaxKind.TryKeyword:
        return 'try';
      case SyntaxKind.CatchKeyword:
        return 'catch';
      case SyntaxKind.FinallyKeyword:
        return 'finally';
      case SyntaxKind.SwitchKeyword:
        return 'switch';
      case SyntaxKind.CaseKeyword:
        return 'case';
      case SyntaxKind.DefaultKeyword:
        return 'default';
      case SyntaxKind.BreakKeyword:
        return 'break';
      case SyntaxKind.ContinueKeyword:
        return 'continue';
      
      default:
        // For unhandled nodes, recursively process children
        return this.canonicalizeChildren(node);
    }
  }

  private canonicalizeBlock(node: Node): string {
    const children = node.getChildren().filter(child => 
      child.getKind() !== SyntaxKind.OpenBraceToken && 
      child.getKind() !== SyntaxKind.CloseBraceToken
    );
    
    const statements = children.map(child => this.canonicalizeNode(child)).filter(s => s.length > 0);
    return `{${statements.join(';')}}`;
  }

  private canonicalizeIfStatement(node: Node): string {
    const children = node.getChildren();
    const condition = children.find(child => 
      child.getKind() === SyntaxKind.ParenthesizedExpression ||
      child.getKind() === SyntaxKind.BinaryExpression ||
      child.getKind() === SyntaxKind.Identifier
    );
    const thenStatement = children.find(child => 
      child.getKind() === SyntaxKind.Block || 
      child.getKind() === SyntaxKind.ExpressionStatement
    );
    const elseStatement = children.find(child => 
      child.getKind() === SyntaxKind.ElseKeyword
    );

    let result = 'if(' + (condition ? this.canonicalizeNode(condition) : 'CONDITION') + ')';
    result += thenStatement ? this.canonicalizeNode(thenStatement) : '{}';
    
    if (elseStatement) {
      const elseIndex = children.indexOf(elseStatement);
      const elseBody = children[elseIndex + 1];
      result += 'else' + (elseBody ? this.canonicalizeNode(elseBody) : '{}');
    }
    
    return result;
  }

  private canonicalizeLoop(node: Node): string {
    const children = node.getChildren();
    
    // Simplify all loops to a generic LOOP structure
    const body = children.find(child => child.getKind() === SyntaxKind.Block);
    return 'LOOP' + (body ? this.canonicalizeNode(body) : '{}');
  }

  private canonicalizeReturnStatement(node: Node): string {
    const children = node.getChildren();
    const expression = children.find(child => 
      child.getKind() !== SyntaxKind.ReturnKeyword && 
      child.getKind() !== SyntaxKind.SemicolonToken
    );
    
    return 'return' + (expression ? '(' + this.canonicalizeNode(expression) + ')' : '');
  }

  private canonicalizeVariableStatement(_node: Node): string {
    // Normalize all variable declarations to VAR
    return 'VAR=EXPR';
  }

  private canonicalizeExpressionStatement(node: Node): string {
    const children = node.getChildren();
    const expression = children.find(child => child.getKind() !== SyntaxKind.SemicolonToken);
    return expression ? this.canonicalizeNode(expression) : '';
  }

  private canonicalizeTryStatement(node: Node): string {
    const children = node.getChildren();
    const tryBlock = children.find(child => child.getKind() === SyntaxKind.Block);
    const catchClause = children.find(child => child.getKind() === SyntaxKind.CatchClause);

    let result = 'try' + (tryBlock ? this.canonicalizeNode(tryBlock) : '{}');
    if (catchClause) result += 'catch{}';
    
    return result;
  }

  private canonicalizeSwitchStatement(_node: Node): string {
    // Simplify switch statements
    return 'SWITCH{CASES}';
  }

  private canonicalizeCallExpression(node: Node): string {
    const children = node.getChildren();
    const expression = children[0];
    const args = children.find(child => child.getKind() === SyntaxKind.SyntaxList);
    
    const funcName = expression ? this.canonicalizeNode(expression) : 'FUNC';
    const argCount = args ? args.getChildren().filter(child => 
      child.getKind() !== SyntaxKind.CommaToken
    ).length : 0;
    
    return `${funcName}(${Array(argCount).fill('ARG').join(',')})`;
  }

  private canonicalizeBinaryExpression(node: Node): string {
    const children = node.getChildren();
    if (children.length >= 3) {
      const left = this.canonicalizeNode(children[0]);
      const operator = children[1].getText();
      const right = this.canonicalizeNode(children[2]);
      return `(${left}${operator}${right})`;
    }
    return 'EXPR';
  }

  private canonicalizePropertyAccess(node: Node): string {
    const children = node.getChildren();
    const object = children[0];
    const property = children[2]; // Skip the dot token
    
    const objName = object ? this.canonicalizeNode(object) : 'OBJ';
    const propName = property ? this.canonicalizeNode(property) : 'PROP';
    
    return `${objName}.${propName}`;
  }

  private canonicalizeIdentifier(identifier: string): string {
    // Preserve built-in functions and keywords
    const builtins = [
      'console', 'log', 'error', 'warn', 'info',
      'Array', 'Object', 'String', 'Number', 'Boolean',
      'Math', 'Date', 'JSON', 'Promise',
      'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
      'parseInt', 'parseFloat', 'isNaN', 'isFinite',
      'push', 'pop', 'shift', 'unshift', 'slice', 'splice',
      'map', 'filter', 'reduce', 'forEach', 'find', 'includes',
      'length', 'indexOf', 'toString', 'valueOf'
    ];

    if (builtins.includes(identifier)) {
      return identifier;
    }

    // Replace user-defined identifiers with placeholders
    if (!this.identifierMap.has(identifier)) {
      this.identifierMap.set(identifier, `VAR${this.identifierCounter++}`);
    }
    
    return this.identifierMap.get(identifier)!;
  }

  private canonicalizeChildren(node: Node): string {
    return node.getChildren()
      .map(child => this.canonicalizeNode(child))
      .filter(s => s.length > 0)
      .join('');
  }
}

/**
 * Calculate similarity between two canonicalized AST strings
 */
export function calculateASTSimilarity(canonical1: string, canonical2: string): number {
  if (canonical1 === canonical2) return 1.0;
  if (!canonical1 || !canonical2) return 0.0;

  const distance = levenshteinDistance(canonical1, canonical2);
  const maxLength = Math.max(canonical1.length, canonical2.length);
  
  return maxLength > 0 ? 1 - (distance / maxLength) : 0;
}

function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + 1
        );
      }
    }
  }

  return dp[m][n];
}
/**
 * AST Transformer - Safe AST-based code transformation
 * 
 * Provides safe, transaction-based AST transformations with automatic rollback
 */

import path from 'path';
import { 
  Project, 
  SourceFile, 
  Node, 
  SyntaxKind,
  BinaryExpression,
  Expression,
  ProjectOptions,
  QuoteKind,
  NewLineKind,
  IndentationText,
  SwitchStatement,
  CaseClause,
  DefaultClause
} from 'ts-morph';

/**
 * Result of file transformation
 */
export interface FileTransformResult {
  applied: number;
  saved: boolean;
  errors?: string[];
}

/**
 * Information about a switch statement analysis
 */
export interface SwitchAnalysisResult {
  switchStatement: SwitchStatement;
  discriminantExpression: Expression;
  discriminantProperty: string;
  cases: SwitchCaseInfo[];
  hasDefault: boolean;
  isSimpleSwitch: boolean;
  canTransform: boolean;
}

/**
 * Information about a single case in switch statement
 */
export interface SwitchCaseInfo {
  caseClause: CaseClause | DefaultClause;
  value?: string | number | boolean;
  isDefault: boolean;
  hasBreak: boolean;
  hasFallthrough: boolean;
}

/**
 * Safe AST-based transformer with transaction support
 */
export class AstTransformer {
  private project: Project;
  private verbose: boolean;
  private skipDiagnostics: boolean;

  constructor(tsConfigPath?: string, verbose = false, skipDiagnostics = false) {
    this.verbose = verbose;
    this.skipDiagnostics = skipDiagnostics;
    
    // Project options following core/analyzer pattern
    const projectOptions: ProjectOptions = {
      skipAddingFilesFromTsConfig: true,
      skipLoadingLibFiles: true,
      useInMemoryFileSystem: false,
      manipulationSettings: {
        indentationText: IndentationText.TwoSpaces,
        quoteKind: QuoteKind.Single,
        newLineKind: NewLineKind.LineFeed
      }
    };

    if (tsConfigPath) {
      projectOptions.tsConfigFilePath = tsConfigPath;
    }

    this.project = new Project(projectOptions);
    
    if (this.verbose) {
      console.log(`🔧 AST Transformer initialized with tsconfig: ${tsConfigPath || 'none'}`);
    }
  }

  /**
   * Open or add source file to project
   */
  private async open(filePath: string): Promise<SourceFile> {
    const normalizedPath = path.resolve(filePath);
    return this.project.getSourceFile(normalizedPath) ?? 
           this.project.addSourceFileAtPath(normalizedPath);
  }

  /**
   * Ensure import is added to source file (avoiding duplicates)
   */
  private ensureImport(sourceFile: SourceFile, namedImport: string, moduleSpecifier: string): void {
    // Check if import declaration already exists
    let importDeclaration = sourceFile.getImportDeclaration(decl => 
      decl.getModuleSpecifierValue() === moduleSpecifier
    );

    if (!importDeclaration) {
      // Create new import declaration
      importDeclaration = sourceFile.addImportDeclaration({
        moduleSpecifier,
        namedImports: [namedImport]
      });
      if (this.verbose) {
        console.log(`   📥 Added import: { ${namedImport} } from '${moduleSpecifier}'`);
      }
    } else {
      // Check if named import already exists
      const existingImports = importDeclaration.getNamedImports();
      const hasImport = existingImports.some(imp => imp.getName() === namedImport);
      
      if (!hasImport) {
        importDeclaration.addNamedImport({ name: namedImport });
        if (this.verbose) {
          console.log(`   📥 Added to existing import: ${namedImport}`);
        }
      }
    }
  }

  /**
   * Check if pre-emit diagnostics are clean
   */
  private preEmitOk(): boolean {
    const diagnostics = this.project.getPreEmitDiagnostics();
    return diagnostics.length === 0;
  }

  // Reserved for future use with line/column-based transformations
  // private findTransformAnchor(sourceFile: SourceFile, line: number, column: number): Node | undefined {
  //   try {
  //     const sourceFileText = sourceFile.getFullText();
  //     const lines = sourceFileText.split('\n');
  //     
  //     let pos = 0;
  //     for (let i = 0; i < line - 1 && i < lines.length; i++) {
  //       pos += lines[i].length + 1; // +1 for newline
  //     }
  //     pos += column;
  //     
  //     let node = sourceFile.getDescendantAtPos(pos);
  //     
  //     // Walk up to find transformable parent
  //     while (node && !this.isTransformableNode(node)) {
  //       node = node.getParent();
  //     }
  //     
  //     return node ?? undefined;
  //   } catch (error) {
  //     if (this.verbose) {
  //       console.warn(`   ⚠ Could not find node at ${line}:${column}`);
  //     }
  //     return undefined;
  //   }
  // }

  // Reserved for future use with complex transformation logic
  // private isTransformableNode(node: Node): boolean {
  //   return Node.isBinaryExpression(node) ||
  //          Node.isIfStatement(node) ||
  //          Node.isConditionalExpression(node) ||
  //          Node.isSwitchStatement(node);
  // }

  /**
   * Transform a file with automatic transaction and rollback
   */
  async transformFile(
    filePath: string, 
    applyFn: (sourceFile: SourceFile, transformer: AstTransformer) => number
  ): Promise<FileTransformResult> {
    const sourceFile = await this.open(filePath);
    const originalText = sourceFile.getFullText();
    let applied = 0;
    const errors: string[] = [];

    try {
      if (this.verbose) {
        console.log(`📄 Processing file: ${filePath}`);
      }

      // Apply transformations
      applied = applyFn(sourceFile, this);
      
      if (applied === 0) {
        if (this.verbose) {
          console.log(`   ✓ No transformations applied`);
        }
        return { applied, saved: false };
      }

      // Check TypeScript diagnostics
      if (!this.skipDiagnostics && !this.preEmitOk()) {
        // In-memory rollback
        sourceFile.replaceWithText(originalText);
        errors.push('TypeScript diagnostics failed after transformation');
        
        if (this.verbose) {
          console.log(`   ❌ Transformation failed diagnostics - rolled back`);
          const diagnostics = this.project.getPreEmitDiagnostics();
          diagnostics.forEach(diag => {
            console.log(`     - ${diag.getMessageText()}`);
          });
        }
        
        return { applied: 0, saved: false, errors };
      }

      // Save to disk
      await sourceFile.save();
      
      if (this.verbose) {
        console.log(`   ✅ Applied ${applied} transformations and saved`);
      }
      
      return { applied, saved: true };

    } catch (error) {
      // In-memory rollback
      sourceFile.replaceWithText(originalText);
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Transformation error: ${errorMessage}`);
      
      if (this.verbose) {
        console.log(`   ❌ Transformation error - rolled back: ${errorMessage}`);
      }
      
      return { applied: 0, saved: false, errors };
      
    } finally {
      // Memory cleanup
      sourceFile.forget();
      this.project.forgetNodesCreatedInBlock(() => {});
    }
  }

  /**
   * Apply simple discriminant guard replacement
   * Pattern: obj.kind === 'Tag' → isTag(obj)
   */
  applySimpleGuardReplacement(
    sourceFile: SourceFile, 
    discriminant: string, 
    guardsModule: string
  ): number {
    let count = 0;
    
    // Collect nodes to transform first to avoid iteration issues
    const nodesToTransform: {
      node: BinaryExpression;
      objExpr: Expression;
      guardName: string;
    }[] = [];
    
    // Process all binary expressions
    sourceFile.forEachDescendant((node) => {
      if (!Node.isBinaryExpression(node)) return;
      
      if (!this.isSimpleDiscriminantCheck(node, discriminant)) return;

      try {
        const left = node.getLeft();
        const right = node.getRight();
        
        // Extract object expression
        const objExpr = this.getObjectExpression(left);
        if (!objExpr) return;
        
        // Extract tag and create guard name
        const tag = this.literalToTagName(right);
        if (!tag) return;
        
        const sanitizedTag = this.sanitizeIdentifier(tag);
        const guardName = `is${sanitizedTag}`;
        
        // Ensure import is available
        this.ensureImport(sourceFile, guardName, guardsModule);
        
        // Store for later transformation
        nodesToTransform.push({
          node,
          objExpr,
          guardName
        });
        
      } catch (error) {
        if (this.verbose) {
          console.warn(`   ⚠ Failed to analyze expression: ${error}`);
        }
      }
    });

    // Apply transformations in reverse order to avoid position shifts
    for (let i = nodesToTransform.length - 1; i >= 0; i--) {
      const { node, objExpr, guardName } = nodesToTransform[i];
      
      try {
        const originalText = node.getText();
        const objText = objExpr.getText();
        const replacementText = `${guardName}(${objText})`;
        
        node.replaceWithText(replacementText);
        count++;
        
        if (this.verbose) {
          console.log(`   ✓ Replaced: ${originalText} → ${replacementText}`);
        }
        
      } catch (error) {
        if (this.verbose) {
          console.warn(`   ⚠ Failed to transform expression: ${error}`);
        }
      }
    }

    return count;
  }

  /**
   * Add exhaustiveness checks to switch statements (Stage 3.3)
   */
  addExhaustivenessChecks(
    sourceFile: SourceFile,
    discriminant: string
  ): number {
    let count = 0;
    
    // Analyze switch statements for the discriminant
    const switchAnalyses = this.analyzeSwitchStatements(sourceFile, discriminant);
    
    // Filter for switches that need exhaustiveness checks
    const needsExhaustivenessCheck = switchAnalyses.filter(analysis => 
      analysis.hasDefault && 
      analysis.isSimpleSwitch &&
      !this.hasExhaustivenessCheck(analysis)
    );
    
    if (this.verbose) {
      console.log(`   Found ${needsExhaustivenessCheck.length} switch statements needing exhaustiveness checks`);
    }
    
    // Add exhaustiveness check to each switch
    for (const analysis of needsExhaustivenessCheck) {
      try {
        const success = this.addExhaustivenessCheckToSwitch(analysis);
        if (success) {
          count++;
          
          if (this.verbose) {
            console.log(`   ✓ Added exhaustiveness check to switch with ${analysis.cases.length} cases`);
          }
        }
      } catch (error) {
        if (this.verbose) {
          console.warn(`   ⚠ Failed to add exhaustiveness check: ${error}`);
        }
      }
    }
    
    return count;
  }

  /**
   * Check if switch already has exhaustiveness check
   */
  private hasExhaustivenessCheck(analysis: SwitchAnalysisResult): boolean {
    const defaultClause = analysis.cases.find(c => c.isDefault);
    if (!defaultClause) {
      return false;
    }
    
    const statements = defaultClause.caseClause.getStatements();
    return statements.some(stmt => {
      const text = stmt.getText();
      return text.includes('never') && 
             text.includes('_exhaustive') &&
             (text.includes('as never') || text.includes(': never ='));
    });
  }

  /**
   * Add exhaustiveness check to a single switch statement
   */
  private addExhaustivenessCheckToSwitch(analysis: SwitchAnalysisResult): boolean {
    const defaultClause = analysis.cases.find(c => c.isDefault);
    if (!defaultClause) {
      return false;
    }
    
    const defaultCaseClause = defaultClause.caseClause;
    const statements = defaultCaseClause.getStatements();
    
    // Find the variable name from the discriminant expression
    const objExpression = this.getObjectExpression(analysis.discriminantExpression);
    if (!objExpression) {
      return false;
    }
    
    const varName = this.extractVariableName(objExpression);
    const exhaustivenessCheck = this.generateExhaustivenessCheck(varName, analysis.discriminantProperty);
    
    try {
      // If default clause has statements, replace the last return with exhaustiveness check
      if (statements.length > 0) {
        const lastStatement = statements[statements.length - 1];
        
        // If last statement is return - replace it with exhaustiveness check
        if (lastStatement.getKind() === SyntaxKind.ReturnStatement) {
          lastStatement.replaceWithText(exhaustivenessCheck);
        } else {
          // Add exhaustiveness check after existing statements
          lastStatement.replaceWithText(`${lastStatement.getText()}\n  ${exhaustivenessCheck}`);
        }
      } else {
        // If default clause is empty, add the exhaustiveness check
        defaultCaseClause.addStatements(exhaustivenessCheck);
      }
      
      return true;
    } catch (error) {
      if (this.verbose) {
        console.warn(`   ⚠ Failed to modify default clause: ${error}`);
      }
      return false;
    }
  }

  /**
   * Generate exhaustiveness check code
   */
  private generateExhaustivenessCheck(varName: string, discriminant: string): string {
    return `const _exhaustive: never = ${varName}.${discriminant} as never;\n  return _exhaustive;`;
  }

  /**
   * Extract variable name from expression
   */
  private extractVariableName(expression: Expression): string {
    // For simple cases like "obj.kind", return "obj"
    if (Node.isPropertyAccessExpression(expression)) {
      return expression.getExpression().getText();
    }
    
    // For element access like "obj['kind']", return "obj"
    if (Node.isElementAccessExpression(expression)) {
      return expression.getExpression().getText();
    }
    
    // Fallback
    return expression.getText();
  }

  /**
   * Apply switch statement to if-else transformation (Stage 3.2)
   */
  applySwitchToIfElseTransformation(
    sourceFile: SourceFile,
    discriminant: string,
    guardsModule: string
  ): number {
    let count = 0;
    
    // First, analyze all switch statements
    const switchAnalyses = this.analyzeSwitchStatements(sourceFile, discriminant);
    
    // Filter for transformable switches
    const transformableSwitches = switchAnalyses.filter(analysis => analysis.canTransform);
    
    if (this.verbose) {
      console.log(`   Found ${transformableSwitches.length} transformable switch statements`);
    }
    
    // Transform each switch statement
    for (const analysis of transformableSwitches) {
      try {
        const success = this.transformSingleSwitch(analysis, guardsModule, sourceFile);
        if (success) {
          count++;
          
          if (this.verbose) {
            console.log(`   ✓ Transformed switch with ${analysis.cases.length} cases`);
          }
        }
      } catch (error) {
        if (this.verbose) {
          console.warn(`   ⚠ Failed to transform switch: ${error}`);
        }
      }
    }
    
    return count;
  }

  /**
   * Transform a single switch statement to if-else chain
   */
  private transformSingleSwitch(
    analysis: SwitchAnalysisResult,
    guardsModule: string,
    sourceFile: SourceFile
  ): boolean {
    const { switchStatement, cases, discriminantExpression } = analysis;
    
    // Generate if-else chain
    const ifElseChain = this.generateIfElseChain(cases, discriminantExpression, guardsModule, sourceFile);
    
    if (!ifElseChain) {
      return false;
    }
    
    try {
      // Replace switch statement with if-else chain
      switchStatement.replaceWithText(ifElseChain);
      return true;
    } catch (error) {
      if (this.verbose) {
        console.warn(`   ⚠ Failed to replace switch statement: ${error}`);
      }
      return false;
    }
  }

  /**
   * Generate if-else chain code from switch cases
   */
  private generateIfElseChain(
    cases: SwitchCaseInfo[],
    discriminantExpr: Expression,
    guardsModule: string,
    sourceFile: SourceFile
  ): string | null {
    const objExpression = this.getObjectExpression(discriminantExpr);
    if (!objExpression) {
      return null;
    }
    
    const objText = objExpression.getText();
    const lines: string[] = [];
    
    // Separate case clauses and default clause
    const caseClauses = cases.filter(c => !c.isDefault);
    const defaultClause = cases.find(c => c.isDefault);
    
    // Generate if/else if statements for each case
    for (let i = 0; i < caseClauses.length; i++) {
      const caseInfo = caseClauses[i];
      
      if (!caseInfo.value) {
        continue; // Skip cases without literal values
      }
      
      // Generate guard name and ensure import
      const sanitizedTag = this.sanitizeIdentifier(String(caseInfo.value));
      const guardName = `is${sanitizedTag}`;
      this.ensureImport(sourceFile, guardName, guardsModule);
      
      // Generate if/else if condition
      const condition = `${guardName}(${objText})`;
      const keyword = i === 0 ? 'if' : 'else if';
      
      // Get case body (statements)
      const statements = caseInfo.caseClause.getStatements();
      const bodyText = this.generateCaseBody(statements);
      
      lines.push(`${keyword} (${condition}) {`);
      lines.push(bodyText);
      lines.push('}');
    }
    
    // Add else clause for default case
    if (defaultClause) {
      const statements = defaultClause.caseClause.getStatements();
      const bodyText = this.generateCaseBody(statements);
      
      lines.push('else {');
      lines.push(bodyText);
      lines.push('}');
    }
    
    return lines.join('\n');
  }

  /**
   * Generate body text from case statements
   */
  private generateCaseBody(statements: any[]): string {
    if (statements.length === 0) {
      return '  // Empty case';
    }
    
    const bodyLines: string[] = [];
    
    for (const stmt of statements) {
      const stmtText = stmt.getText();
      
      // Skip break statements as they're not needed in if-else
      if (stmt.getKind() === SyntaxKind.BreakStatement) {
        continue;
      }
      
      // Add proper indentation
      const indentedText = stmtText.split('\n').map((line: string) => `  ${line}`).join('\n');
      bodyLines.push(indentedText);
    }
    
    return bodyLines.length > 0 ? bodyLines.join('\n') : '  // Empty case';
  }

  /**
   * Analyze switch statements for discriminant patterns (Stage 3.1)
   */
  analyzeSwitchStatements(sourceFile: SourceFile, discriminant: string): SwitchAnalysisResult[] {
    const results: SwitchAnalysisResult[] = [];
    
    // Find all switch statements
    sourceFile.forEachDescendant((node) => {
      if (!Node.isSwitchStatement(node)) return;
      
      try {
        const analysis = this.analyzeSingleSwitchStatement(node, discriminant);
        if (analysis) {
          results.push(analysis);
          
          if (this.verbose) {
            console.log(`   🔍 Found switch: discriminant=${analysis.discriminantProperty}, cases=${analysis.cases.length}, canTransform=${analysis.canTransform}`);
          }
        }
      } catch (error) {
        if (this.verbose) {
          console.warn(`   ⚠ Failed to analyze switch statement: ${error}`);
        }
      }
    });

    return results;
  }

  /**
   * Analyze a single switch statement
   */
  private analyzeSingleSwitchStatement(switchStmt: SwitchStatement, discriminant: string): SwitchAnalysisResult | null {
    const expression = switchStmt.getExpression();
    
    // Check if switch expression is discriminant access
    if (!this.isDiscriminantAccess(expression, discriminant)) {
      return null;
    }

    const cases: SwitchCaseInfo[] = [];
    let hasDefault = false;
    let isSimpleSwitch = true;

    // Analyze each case clause
    const clauses = switchStmt.getClauses();
    for (let i = 0; i < clauses.length; i++) {
      const clause = clauses[i];
      const isLast = i === clauses.length - 1;

      if (Node.isDefaultClause(clause)) {
        hasDefault = true;
        cases.push({
          caseClause: clause,
          isDefault: true,
          hasBreak: this.hasBreakStatement(clause),
          hasFallthrough: !isLast && !this.hasBreakStatement(clause)
        });
      } else if (Node.isCaseClause(clause)) {
        const value = this.extractCaseValue(clause);
        const hasBreak = this.hasBreakStatement(clause);
        const hasFallthrough = !isLast && !hasBreak;

        const caseInfo: SwitchCaseInfo = {
          caseClause: clause,
          isDefault: false,
          hasBreak,
          hasFallthrough
        };
        
        if (value !== undefined) {
          caseInfo.value = value;
        }
        
        cases.push(caseInfo);

        // Simple switch requires literal values and no fallthrough
        if (value === undefined || hasFallthrough) {
          isSimpleSwitch = false;
        }
      }
    }

    // Can transform if it's a simple switch with literal values
    const canTransform = isSimpleSwitch && 
                        cases.length > 0 && 
                        cases.some(c => !c.isDefault);

    return {
      switchStatement: switchStmt,
      discriminantExpression: expression,
      discriminantProperty: discriminant,
      cases,
      hasDefault,
      isSimpleSwitch,
      canTransform
    };
  }

  /**
   * Extract case value from case clause
   */
  private extractCaseValue(caseClause: CaseClause): string | number | boolean | undefined {
    const expr = caseClause.getExpression();
    return this.literalToTagName(expr);
  }

  /**
   * Check if clause has break statement
   */
  private hasBreakStatement(clause: CaseClause | DefaultClause): boolean {
    const statements = clause.getStatements();
    return statements.some(stmt => 
      Node.isBreakStatement(stmt) || 
      Node.isReturnStatement(stmt) ||
      Node.isThrowStatement(stmt)
    );
  }

  /**
   * Check if binary expression is a simple discriminant check
   */
  private isSimpleDiscriminantCheck(expr: BinaryExpression, discriminant: string): boolean {
    // Only handle === operator
    if (expr.getOperatorToken().getKind() !== SyntaxKind.EqualsEqualsEqualsToken) {
      return false;
    }

    const left = expr.getLeft();
    const right = expr.getRight();

    // Left side must be discriminant property access
    const isDiscriminantAccess = this.isDiscriminantAccess(left, discriminant);
    
    // Right side must be a literal
    const isLiteral = this.isLiteral(right);

    return isDiscriminantAccess && isLiteral;
  }

  /**
   * Check if expression accesses the discriminant property
   */
  private isDiscriminantAccess(expr: Expression, discriminant: string): boolean {
    if (Node.isPropertyAccessExpression(expr)) {
      return expr.getName() === discriminant;
    }
    
    if (Node.isElementAccessExpression(expr)) {
      const arg = expr.getArgumentExpression();
      return !!arg && Node.isStringLiteral(arg) && arg.getLiteralValue() === discriminant;
    }
    
    return false;
  }

  /**
   * Check if expression is a literal value
   */
  private isLiteral(expr: Expression): boolean {
    return Node.isStringLiteral(expr) ||
           Node.isNumericLiteral(expr) ||
           expr.getKind() === SyntaxKind.TrueKeyword ||
           expr.getKind() === SyntaxKind.FalseKeyword;
  }

  /**
   * Get object expression from property/element access
   */
  private getObjectExpression(expr: Expression): Expression | undefined {
    if (Node.isPropertyAccessExpression(expr)) {
      return expr.getExpression();
    }
    
    if (Node.isElementAccessExpression(expr)) {
      return expr.getExpression();
    }
    
    return undefined;
  }

  /**
   * Convert literal to tag name
   */
  private literalToTagName(expr: Expression): string | undefined {
    if (Node.isStringLiteral(expr)) {
      return expr.getLiteralValue();
    }
    
    if (Node.isNumericLiteral(expr)) {
      return `Variant${expr.getLiteralValue()}`;
    }
    
    if (expr.getKind() === SyntaxKind.TrueKeyword) {
      return 'True';
    }
    
    if (expr.getKind() === SyntaxKind.FalseKeyword) {
      return 'False';
    }
    
    return undefined;
  }

  /**
   * Sanitize identifier for TypeScript naming
   */
  private sanitizeIdentifier(raw: string): string {
    // Remove non-alphanumeric characters and convert to PascalCase
    const base = raw
      .replace(/[^A-Za-z0-9_]+/g, ' ')
      .trim()
      .replace(/\s+([a-z])/g, (_, c) => c.toUpperCase())
      .replace(/^([a-z])/, (_, c) => c.toUpperCase());
    
    // Handle leading numbers
    const fixed = base.replace(/^[0-9]/, '_$&');
    
    // Handle reserved words
    const reserved = new Set([
      'default', 'class', 'function', 'switch', 'case', 'true', 'false',
      'var', 'let', 'const', 'enum', 'type', 'interface', 'return',
      'if', 'else', 'for', 'while', 'do', 'break', 'continue'
    ]);
    
    const result = reserved.has(fixed.toLowerCase()) ? `${fixed}Case` : fixed;
    
    return result || 'Unknown';
  }

  /**
   * Get transformation statistics
   */
  getStatistics(): {
    totalFiles: number;
    totalTransformations: number;
    avgTimePerFile: number;
  } {
    // Placeholder for statistics tracking
    return {
      totalFiles: 0,
      totalTransformations: 0,
      avgTimePerFile: 0
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    // Clean up ts-morph project if needed
    if (this.verbose) {
      console.log('🧹 AST Transformer disposed');
    }
  }
}
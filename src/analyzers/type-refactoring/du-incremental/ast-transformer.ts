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
  IndentationText
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
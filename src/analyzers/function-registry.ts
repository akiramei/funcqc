import { Project, Node, SourceFile, SyntaxKind } from 'ts-morph';
import { FunctionMetadata } from './ideal-call-graph-analyzer';
import * as crypto from 'crypto';
import * as path from 'path';

/**
 * Function Registry - Comprehensive Function Collection System
 * 
 * Collects ALL function-like nodes with 100% coverage:
 * - Top-level functions
 * - Class/object methods  
 * - Arrow functions & function expressions
 * - Nested functions with lexical paths
 * - Getters/setters
 * - Constructors
 */
export class FunctionRegistry {
  private project: Project;
  private functionMap = new Map<string, FunctionMetadata>();

  constructor(project: Project) {
    this.project = project;
  }

  /**
   * Collect all function-like nodes with complete coverage
   */
  async collectAllFunctions(): Promise<Map<string, FunctionMetadata>> {
    console.log('   📋 Scanning all source files for function-like nodes...');
    
    const sourceFiles = this.project.getSourceFiles();
    let totalFunctions = 0;
    
    for (const sourceFile of sourceFiles) {
      const fileFunctions = await this.collectFunctionsFromFile(sourceFile);
      totalFunctions += fileFunctions;
    }
    
    console.log(`   ✅ Collected ${totalFunctions} functions from ${sourceFiles.length} files`);
    return this.functionMap;
  }

  private async collectFunctionsFromFile(sourceFile: SourceFile): Promise<number> {
    let functionCount = 0;
    const filePath = sourceFile.getFilePath();
    
    // Use forEachDescendant to visit every node
    sourceFile.forEachDescendant((node, traversal) => {
      if (this.isFunctionLikeNode(node)) {
        try {
          const metadata = this.createFunctionMetadata(node, filePath);
          this.functionMap.set(metadata.id, metadata);
          functionCount++;
        } catch (error) {
          console.warn(`   ⚠️ Failed to process function in ${filePath}: ${error}`);
        }
      }
    });
    
    return functionCount;
  }

  /**
   * Comprehensive function-like node detection
   */
  private isFunctionLikeNode(node: Node): boolean {
    return Node.isFunctionDeclaration(node) ||
           Node.isMethodDeclaration(node) ||
           Node.isArrowFunction(node) ||
           Node.isFunctionExpression(node) ||
           Node.isGetAccessorDeclaration(node) ||
           Node.isSetAccessorDeclaration(node) ||
           Node.isConstructorDeclaration(node);
  }

  /**
   * Create comprehensive function metadata
   */
  private createFunctionMetadata(node: Node, filePath: string): FunctionMetadata {
    const name = this.getFunctionName(node);
    const lexicalPath = this.buildLexicalPath(node, filePath);
    const signature = this.getFunctionSignature(node);
    const contentHash = this.calculateContentHash(node);
    
    return {
      id: lexicalPath, // Use lexical path as unique ID
      name,
      filePath,
      lexicalPath,
      nodeKind: node.getKindName(),
      isExported: this.isExported(node),
      isMethod: this.isMethod(node),
      className: this.getClassName(node),
      signature,
      startLine: node.getStartLineNumber(),
      endLine: node.getEndLineNumber(),
      contentHash
    };
  }

  /**
   * Build lexical path for unique identification
   * Format: file#outer.inner.method
   */
  private buildLexicalPath(node: Node, filePath: string): string {
    const relativePath = this.getRelativePath(filePath);
    const ancestorNames: string[] = [];
    
    // Walk up the AST to build lexical path
    let current = node.getParent();
    while (current) {
      if (this.isFunctionLikeNode(current)) {
        const name = this.getFunctionName(current);
        if (name) {
          ancestorNames.unshift(name);
        }
      } else if (Node.isClassDeclaration(current) || Node.isInterfaceDeclaration(current)) {
        const name = current.getName();
        if (name) {
          ancestorNames.unshift(name);
        }
      }
      current = current.getParent();
    }
    
    const functionName = this.getFunctionName(node);
    if (functionName) {
      ancestorNames.push(functionName);
    }
    
    // Add line number for disambiguation
    const lineNumber = node.getStartLineNumber();
    const pathSuffix = ancestorNames.length > 0 ? ancestorNames.join('.') : `anonymous_${lineNumber}`;
    
    return `${relativePath}#${pathSuffix}`;
  }

  /**
   * Get function name with fallback for anonymous functions
   */
  private getFunctionName(node: Node): string {
    if (Node.isFunctionDeclaration(node)) {
      return node.getName() || `anonymous_${node.getStartLineNumber()}`;
    }
    
    if (Node.isMethodDeclaration(node)) {
      return node.getName();
    }
    
    if (Node.isGetAccessorDeclaration(node)) {
      return `get_${node.getName()}`;
    }
    
    if (Node.isSetAccessorDeclaration(node)) {
      return `set_${node.getName()}`;
    }
    
    if (Node.isConstructorDeclaration(node)) {
      return 'constructor';
    }
    
    // For arrow functions and function expressions, try to get name from context
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const parent = node.getParent();
      
      if (Node.isVariableDeclaration(parent)) {
        return parent.getName();
      }
      
      if (Node.isPropertyAssignment(parent)) {
        const nameNode = parent.getNameNode();
        if (Node.isIdentifier(nameNode)) {
          return nameNode.getText();
        }
      }
      
      if (Node.isParameterDeclaration(parent)) {
        return parent.getName();
      }
      
      return `anonymous_${node.getStartLineNumber()}`;
    }
    
    return `unknown_${node.getStartLineNumber()}`;
  }

  /**
   * Get function signature
   */
  private getFunctionSignature(node: Node): string {
    try {
      if (Node.isFunctionLike(node)) {
        const parameters = node.getParameters();
        const paramList = parameters.map(p => p.getName()).join(', ');
        const name = this.getFunctionName(node);
        return `${name}(${paramList})`;
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Check if function is exported
   */
  private isExported(node: Node): boolean {
    return node.getModifiers().some(modifier => 
      modifier.getKind() === SyntaxKind.ExportKeyword
    );
  }

  /**
   * Check if node is a method
   */
  private isMethod(node: Node): boolean {
    return Node.isMethodDeclaration(node) ||
           Node.isGetAccessorDeclaration(node) ||
           Node.isSetAccessorDeclaration(node) ||
           Node.isConstructorDeclaration(node);
  }

  /**
   * Get class name if method belongs to a class
   */
  private getClassName(node: Node): string | undefined {
    let current = node.getParent();
    while (current) {
      if (Node.isClassDeclaration(current)) {
        return current.getName();
      }
      current = current.getParent();
    }
    return undefined;
  }

  /**
   * Calculate content hash for change detection
   */
  private calculateContentHash(node: Node): string {
    const content = node.getFullText();
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Get relative path from project root
   */
  private getRelativePath(filePath: string): string {
    try {
      // Try to get the project root directory
      const cwd = process.cwd();
      return path.relative(cwd, filePath);
    } catch {
      return path.basename(filePath);
    }
  }

  /**
   * Get function metadata by ID
   */
  getFunctionById(id: string): FunctionMetadata | undefined {
    return this.functionMap.get(id);
  }

  /**
   * Get all functions
   */
  getAllFunctions(): Map<string, FunctionMetadata> {
    return this.functionMap;
  }

  /**
   * Clear registry
   */
  clear(): void {
    this.functionMap.clear();
  }
}
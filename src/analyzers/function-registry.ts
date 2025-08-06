import { Project, Node, SourceFile } from 'ts-morph';
import { FunctionMetadata } from './ideal-call-graph-analyzer';
import * as crypto from 'crypto';
import { getRelativePath } from '../utils/path-utils';

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
  private declToIdMap = new WeakMap<Node, string>(); // 宣言ノード → functionId 逆引き

  constructor(project: Project) {
    this.project = project;
  }

  /**
   * Collect all function-like nodes with complete coverage
   */
  async collectAllFunctions(): Promise<Map<string, FunctionMetadata>> {
    const sourceFiles = this.project.getSourceFiles();
    
    for (const sourceFile of sourceFiles) {
      await this.collectFunctionsFromFile(sourceFile);
    }
    return this.functionMap;
  }

  /**
   * Get function ID by declaration node (for symbol resolution)
   */
  getFunctionIdByDeclaration(decl: Node): string | undefined {
    return this.declToIdMap.get(decl);
  }

  private async collectFunctionsFromFile(sourceFile: SourceFile): Promise<number> {
    let functionCount = 0;
    const filePath = sourceFile.getFilePath();
    
    // Use forEachDescendant to visit every node
    sourceFile.forEachDescendant((node, _traversal) => {
      if (this.isFunctionLikeNode(node)) {
        try {
          const metadata = this.createFunctionMetadata(node, filePath);
          this.functionMap.set(metadata.id, metadata);
          // 宣言ノード → functionId のマッピングを記録
          this.declToIdMap.set(node, metadata.id);
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
    
    const className = this.getClassName(node);
    
    // Generate UUID for physical function identity
    const uniqueId = crypto.randomUUID();
    
    return {
      id: uniqueId,
      name,
      filePath,
      lexicalPath,
      nodeKind: node.getKindName(),
      isExported: this.isExported(node),
      isMethod: this.isMethod(node),
      ...(className && { className }),
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
    const relativePath = getRelativePath(filePath);
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
      } else if (current.getKind() === 267) { // ModuleDeclaration (namespace)
        // Check if the node has a getName method (ModuleDeclaration)
        const name = 'getName' in current && typeof current.getName === 'function' 
          ? current.getName() : undefined;
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
      if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isConstructorDeclaration(node)) {
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
    try {
      // Use type guards to safely check for exported functions
      if (Node.isFunctionDeclaration(node)) {
        return node.isExported();
      }
      
      // For methods, getters, setters, and constructors, check if the containing class is exported
      if (Node.isMethodDeclaration(node) || Node.isGetAccessorDeclaration(node) || 
          Node.isSetAccessorDeclaration(node) || Node.isConstructorDeclaration(node)) {
        const classDeclaration = node.getParent();
        if (Node.isClassDeclaration(classDeclaration)) {
          return classDeclaration.isExported();
        }
        return false;
      }
      
      // For arrow functions and function expressions, check parent context
      if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
        const parent = node.getParent();
        if (Node.isVariableDeclaration(parent)) {
          const statement = parent.getVariableStatement();
          return statement ? statement.isExported() : false;
        }
        return false;
      }
    } catch {
      // Fallback to false if any check fails
      return false;
    }
    return false;
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
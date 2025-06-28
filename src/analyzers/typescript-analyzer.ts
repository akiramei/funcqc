import * as ts from 'typescript';
import * as path from 'path';
import * as crypto from 'crypto';
import { FunctionInfo, ParameterInfo, ReturnTypeInfo } from '../types';

export class TypeScriptAnalyzer {
  constructor() {}

  /**
   * Analyze a TypeScript file and extract function information
   */
  async analyzeFile(filePath: string): Promise<FunctionInfo[]> {
    try {
      // Create TypeScript program for this file
      const program = this.createProgram([filePath]);
      const sourceFile = program.getSourceFile(filePath);
      
      if (!sourceFile) {
        throw new Error(`Could not load source file: ${filePath}`);
      }

      // const checker = program.getTypeChecker(); // For future type analysis

      const functions: FunctionInfo[] = [];
      this.visitNode(sourceFile, sourceFile, functions);

      return functions;

    } catch (error) {
      throw new Error(`Failed to analyze ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private createProgram(files: string[]): ts.Program {
    // Try to load tsconfig.json
    const configPath = this.findTsConfig();
    let compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      strict: false, // Be permissive for analysis
      allowJs: true,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      skipLibCheck: true
    };

    if (configPath) {
      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      if (!configFile.error) {
        const config = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          path.dirname(configPath)
        );
        compilerOptions = { ...compilerOptions, ...config.options };
      }
    }

    return ts.createProgram(files, compilerOptions);
  }

  private findTsConfig(): string | null {
    let currentDir = process.cwd();
    
    while (currentDir !== path.dirname(currentDir)) {
      const configPath = path.join(currentDir, 'tsconfig.json');
      if (require('fs').existsSync(configPath)) {
        return configPath;
      }
      currentDir = path.dirname(currentDir);
    }
    
    return null;
  }

  private visitNode(node: ts.Node, sourceFile: ts.SourceFile, functions: FunctionInfo[]): void {
    // Check if this node is a function-like declaration
    if (this.isFunctionLike(node)) {
      const functionInfo = this.extractFunctionInfo(node as ts.FunctionLikeDeclaration, sourceFile);
      if (functionInfo) {
        functions.push(functionInfo);
      }
    }

    // Continue visiting child nodes
    ts.forEachChild(node, child => this.visitNode(child, sourceFile, functions));
  }

  private isFunctionLike(node: ts.Node): boolean {
    return (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    );
  }

  private extractFunctionInfo(
    node: ts.FunctionLikeDeclaration,
    sourceFile: ts.SourceFile
  ): FunctionInfo | null {
    try {
      const name = this.getFunctionName(node);
      if (!name) return null; // Skip anonymous functions for now

      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

      const functionInfo: FunctionInfo = {
        id: '', // Will be set later
        name,
        displayName: this.getDisplayName(node),
        signature: this.getSignature(node),
        signatureHash: '',
        filePath: path.relative(process.cwd(), sourceFile.fileName),
        fileHash: this.calculateFileHash(sourceFile.getFullText()),
        startLine: start.line + 1,
        endLine: end.line + 1,
        startColumn: start.character,
        endColumn: end.character,
        astHash: this.calculateASTHash(node),

        // Function attributes
        isExported: this.isExported(node),
        isAsync: this.isAsync(node),
        isGenerator: this.isGenerator(node),
        isArrowFunction: ts.isArrowFunction(node),
        isMethod: ts.isMethodDeclaration(node),
        isConstructor: ts.isConstructorDeclaration(node),
        isStatic: this.isStatic(node),
        ...(this.getAccessModifier(node) && { accessModifier: this.getAccessModifier(node) }),
        ...(this.getParentClassName(node) && { parentClass: this.getParentClassName(node) }),
        ...(this.getParentNamespace(node) && { parentNamespace: this.getParentNamespace(node) }),

        // Documentation
        ...(this.getJSDoc(node) && { jsDoc: this.getJSDoc(node) }),
        sourceCode: node.getFullText(sourceFile).trim(),

        // Relations
        parameters: this.extractParameters(node),
        returnType: this.extractReturnType(node)
      };

      // Generate hashes
      functionInfo.signatureHash = this.calculateSignatureHash(functionInfo.signature);
      functionInfo.id = this.generateFunctionId(functionInfo);

      return functionInfo;

    } catch (error) {
      console.warn(`Warning: Failed to extract function info from ${sourceFile.fileName}:`, error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  private getFunctionName(node: ts.FunctionLikeDeclaration): string | null {
    // Named function or method
    if (node.name) {
      return node.name.getText();
    }

    // Constructor
    if (ts.isConstructorDeclaration(node)) {
      return 'constructor';
    }

    // Arrow function or function expression - try to get name from context
    const parent = node.parent;
    
    if (ts.isVariableDeclaration(parent) && parent.name) {
      return parent.name.getText();
    }
    
    if (ts.isPropertyAssignment(parent) && parent.name) {
      return parent.name.getText();
    }
    
    if (ts.isPropertyDeclaration(parent) && parent.name) {
      return parent.name.getText();
    }

    return null; // Anonymous function
  }

  private getDisplayName(node: ts.FunctionLikeDeclaration): string {
    const name = this.getFunctionName(node);
    const className = this.getParentClassName(node);
    
    if (className && name) {
      return `${className}.${name}`;
    }
    
    return name || '<anonymous>';
  }

  private getSignature(node: ts.FunctionLikeDeclaration): string {
    const name = this.getFunctionName(node) || '<anonymous>';
    const params = node.parameters.map(p => p.getText()).join(', ');
    const returnType = node.type ? `: ${node.type.getText()}` : '';
    
    return `${name}(${params})${returnType}`;
  }

  private isExported(node: ts.FunctionLikeDeclaration): boolean {
    // Check for export modifier
    if (node.modifiers) {
      return node.modifiers.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword);
    }

    // Check if parent is an export declaration
    const parent = node.parent;
    if (ts.isExportAssignment(parent) || ts.isExportDeclaration(parent)) {
      return true;
    }

    return false;
  }

  private isAsync(node: ts.FunctionLikeDeclaration): boolean {
    if (node.modifiers) {
      return node.modifiers.some(mod => mod.kind === ts.SyntaxKind.AsyncKeyword);
    }
    return false;
  }

  private isGenerator(node: ts.FunctionLikeDeclaration): boolean {
    return !!(node as any).asteriskToken;
  }

  private isStatic(node: ts.FunctionLikeDeclaration): boolean {
    if (node.modifiers) {
      return node.modifiers.some(mod => mod.kind === ts.SyntaxKind.StaticKeyword);
    }
    return false;
  }

  private getAccessModifier(node: ts.FunctionLikeDeclaration): 'public' | 'private' | 'protected' | undefined {
    if (!node.modifiers) return undefined;

    for (const modifier of node.modifiers) {
      switch (modifier.kind) {
        case ts.SyntaxKind.PublicKeyword:
          return 'public';
        case ts.SyntaxKind.PrivateKeyword:
          return 'private';
        case ts.SyntaxKind.ProtectedKeyword:
          return 'protected';
      }
    }

    return undefined;
  }

  private getParentClassName(node: ts.FunctionLikeDeclaration): string | undefined {
    let current = node.parent;
    
    while (current) {
      if (ts.isClassDeclaration(current) && current.name) {
        return current.name.getText();
      }
      current = current.parent;
    }
    
    return undefined;
  }

  private getParentNamespace(node: ts.FunctionLikeDeclaration): string | undefined {
    let current = node.parent;
    const namespaces: string[] = [];
    
    while (current) {
      if (ts.isModuleDeclaration(current) && current.name) {
        namespaces.unshift(current.name.getText());
      }
      current = current.parent;
    }
    
    return namespaces.length > 0 ? namespaces.join('.') : undefined;
  }

  private getJSDoc(node: ts.FunctionLikeDeclaration): string | undefined {
    const jsDoc = (node as any).jsDoc;
    if (jsDoc && jsDoc.length > 0) {
      return jsDoc[0].getFullText().trim();
    }
    return undefined;
  }

  private extractParameters(node: ts.FunctionLikeDeclaration): ParameterInfo[] {
    return node.parameters.map((param, index) => {
      const defaultValue = param.initializer?.getText();
      const description = this.getParameterDescription(param);
      
      return {
        name: param.name.getText(),
        type: param.type ? param.type.getText() : 'any',
        typeSimple: this.simplifyType(param.type ? param.type.getText() : 'any'),
        position: index,
        isOptional: !!param.questionToken,
        isRest: !!param.dotDotDotToken,
        ...(defaultValue && { defaultValue }),
        ...(description && { description })
      };
    });
  }

  private extractReturnType(node: ts.FunctionLikeDeclaration): ReturnTypeInfo | undefined {
    if (!node.type) return undefined;

    const typeText = node.type.getText();
    
    const promiseType = this.extractPromiseType(typeText);
    const description = this.getReturnDescription(node);
    
    return {
      type: typeText,
      typeSimple: this.simplifyType(typeText),
      isPromise: typeText.startsWith('Promise<'),
      ...(promiseType && { promiseType }),
      ...(description && { description })
    };
  }

  private simplifyType(typeText: string): string {
    // Simplify complex types to basic categories
    if (typeText.includes('Promise<')) return 'Promise';
    if (typeText.includes('[]') || typeText.includes('Array<')) return 'Array';
    if (typeText.includes('{') || typeText.includes('interface')) return 'Object';
    if (typeText.includes('|')) return 'Union';
    if (typeText.includes('&')) return 'Intersection';
    
    // Basic types
    const basicTypes = ['string', 'number', 'boolean', 'void', 'null', 'undefined', 'any', 'unknown'];
    for (const basicType of basicTypes) {
      if (typeText.toLowerCase().includes(basicType)) {
        return basicType;
      }
    }
    
    return 'Custom';
  }

  private extractPromiseType(typeText: string): string | undefined {
    const match = typeText.match(/Promise<(.+)>/);
    return match ? match[1] : undefined;
  }

  private getParameterDescription(_param: ts.ParameterDeclaration): string | undefined {
    // Extract from JSDoc if available
    // This is a simplified implementation
    return undefined;
  }

  private getReturnDescription(_node: ts.FunctionLikeDeclaration): string | undefined {
    // Extract from JSDoc if available
    // This is a simplified implementation
    return undefined;
  }

  private calculateASTHash(node: ts.Node): string {
    // Create a simplified representation of the AST structure
    const structure = this.getASTStructure(node);
    return crypto.createHash('md5').update(JSON.stringify(structure)).digest('hex');
  }

  private getASTStructure(node: ts.Node): any {
    const structure: any = {
      kind: ts.SyntaxKind[node.kind]
    };

    // Add relevant properties for function nodes
    if (ts.isFunctionLike(node)) {
      structure.paramCount = (node as ts.FunctionLikeDeclaration).parameters.length;
      structure.hasReturn = !!(node as ts.FunctionLikeDeclaration).type;
    }

    // Recursively process children for structural comparison
    const children: any[] = [];
    ts.forEachChild(node, child => {
      children.push(this.getASTStructure(child));
    });

    if (children.length > 0) {
      structure.children = children;
    }

    return structure;
  }

  private calculateSignatureHash(signature: string): string {
    return crypto.createHash('md5').update(signature).digest('hex');
  }

  private calculateFileHash(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  private generateFunctionId(func: FunctionInfo): string {
    const components = [
      func.filePath,
      func.name,
      func.startLine.toString(),
      func.signatureHash
    ];
    
    const combined = components.join('|');
    return crypto.createHash('sha256').update(combined).digest('hex').slice(0, 16);
  }
}

import { Project, SourceFile, FunctionDeclaration, MethodDeclaration, ArrowFunction, FunctionExpression, SyntaxKind, ClassDeclaration, ConstructorDeclaration } from 'ts-morph';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { FunctionInfo, ParameterInfo, ReturnTypeInfo } from '../types';

/**
 * TypeScript analyzer using ts-morph for robust AST parsing
 */
export class TypeScriptAnalyzer {
  private project: Project;

  constructor() {
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      skipLoadingLibFiles: true,
      compilerOptions: {
        isolatedModules: true,
        skipLibCheck: true,
        noResolve: true,
        noLib: true,
        target: 99, // ESNext
        jsx: 4 // Preserve
      }
    });
  }

  /**
   * Analyze a TypeScript file and extract function information
   */
  async analyzeFile(filePath: string): Promise<FunctionInfo[]> {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File does not exist: ${filePath}`);
      }

      const sourceFile = this.project.addSourceFileAtPath(filePath);
      const fileContent = sourceFile.getFullText();
      const fileHash = this.calculateFileHash(fileContent);
      const relativePath = path.relative(process.cwd(), filePath);

      const functions: FunctionInfo[] = [];

      try {
        // Function declarations
        sourceFile.getFunctions().forEach(func => {
          const info = this.extractFunctionInfo(func, relativePath, fileHash, sourceFile, fileContent);
          if (info) functions.push(info);
        });

        // Method declarations (class methods) and constructors
        sourceFile.getClasses().forEach(cls => {
          // Methods
          cls.getMethods().forEach(method => {
            const info = this.extractMethodInfo(method, relativePath, fileHash, sourceFile, fileContent);
            if (info) functions.push(info);
          });
          
          // Constructors
          cls.getConstructors().forEach(ctor => {
            const info = this.extractConstructorInfo(ctor, relativePath, fileHash, sourceFile, fileContent);
            if (info) functions.push(info);
          });
        });

        // Arrow functions and function expressions assigned to variables
        this.extractVariableFunctions(sourceFile, relativePath, fileHash, fileContent).forEach(info => {
          functions.push(info);
        });

      } finally {
        // Prevent memory leaks by removing the file
        this.project.removeSourceFile(sourceFile);
      }

      return functions;

    } catch (error) {
      throw new Error(`Failed to analyze ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private extractFunctionInfo(
    func: FunctionDeclaration,
    relativePath: string,
    fileHash: string,
    _sourceFile: SourceFile,
    fileContent: string
  ): FunctionInfo | null {
    const name = func.getName();
    if (!name) return null;

    const signature = this.getFunctionSignature(func);
    const startPos = func.getBody()?.getStart() || func.getStart();
    const endPos = func.getBody()?.getEnd() || func.getEnd();
    const functionBody = fileContent.substring(startPos, endPos);
    const astHash = this.calculateASTHash(functionBody);
    const signatureHash = this.calculateSignatureHash(signature);
    const returnType = this.extractFunctionReturnType(func);

    const functionInfo: FunctionInfo = {
      id: this.generateFunctionId(relativePath, name, signatureHash),
      name,
      displayName: name,
      signature,
      signatureHash,
      filePath: relativePath,
      fileHash,
      startLine: func.getStartLineNumber(),
      endLine: func.getEndLineNumber(),
      startColumn: 0,
      endColumn: 0,
      astHash,
      isExported: func.isExported(),
      isAsync: func.isAsync(),
      isGenerator: !!func.getAsteriskToken(),
      isArrowFunction: false,
      isMethod: false,
      isConstructor: false,
      isStatic: false,
      sourceCode: func.getFullText().trim(),
      parameters: this.extractFunctionParameters(func)
    };

    if (returnType) {
      functionInfo.returnType = returnType;
    }

    return functionInfo;
  }

  private extractMethodInfo(
    method: MethodDeclaration,
    relativePath: string,
    fileHash: string,
    _sourceFile: SourceFile,
    fileContent: string
  ): FunctionInfo | null {
    const name = method.getName();
    if (!name) return null;

    const className = (method.getParent() as ClassDeclaration)?.getName() || 'Unknown';
    const fullName = name === 'constructor' ? `${className}.constructor` : `${className}.${name}`;
    const signature = this.getMethodSignature(method, className);
    const startPos = method.getBody()?.getStart() || method.getStart();
    const endPos = method.getBody()?.getEnd() || method.getEnd();
    const methodBody = fileContent.substring(startPos, endPos);
    const astHash = this.calculateASTHash(methodBody);
    const signatureHash = this.calculateSignatureHash(signature);

    const parent = method.getParent();
    let isClassExported = false;
    if (parent && parent.getKind() === SyntaxKind.ClassDeclaration) {
      isClassExported = (parent as ClassDeclaration).isExported();
    }

    const returnType = this.extractMethodReturnType(method);

    const functionInfo: FunctionInfo = {
      id: this.generateFunctionId(relativePath, fullName, signatureHash),
      name: name,
      displayName: fullName,
      signature,
      signatureHash,
      filePath: relativePath,
      fileHash,
      startLine: method.getStartLineNumber(),
      endLine: method.getEndLineNumber(),
      startColumn: 0,
      endColumn: 0,
      astHash,
      isExported: isClassExported,
      isAsync: method.isAsync(),
      isGenerator: !!method.getAsteriskToken(),
      isArrowFunction: false,
      isMethod: true,
      isConstructor: false,
      isStatic: method.isStatic(),
      sourceCode: method.getFullText().trim(),
      parameters: this.extractMethodParameters(method)
    };

    if (returnType) {
      functionInfo.returnType = returnType;
    }

    const scope = method.getScope();
    if (scope && scope !== 'public') {
      functionInfo.accessModifier = scope;
    }

    functionInfo.parentClass = className;

    return functionInfo;
  }

  private extractConstructorInfo(
    ctor: ConstructorDeclaration,
    relativePath: string,
    fileHash: string,
    _sourceFile: SourceFile,
    fileContent: string
  ): FunctionInfo | null {
    const className = (ctor.getParent() as ClassDeclaration)?.getName() || 'Unknown';
    const fullName = `${className}.constructor`;
    const signature = this.getConstructorSignature(ctor, className);
    const startPos = ctor.getBody()?.getStart() || ctor.getStart();
    const endPos = ctor.getBody()?.getEnd() || ctor.getEnd();
    const constructorBody = fileContent.substring(startPos, endPos);
    const astHash = this.calculateASTHash(constructorBody);
    const signatureHash = this.calculateSignatureHash(signature);

    const parent = ctor.getParent();
    let isClassExported = false;
    if (parent && parent.getKind() === SyntaxKind.ClassDeclaration) {
      isClassExported = (parent as ClassDeclaration).isExported();
    }

    const functionInfo: FunctionInfo = {
      id: this.generateFunctionId(relativePath, fullName, signatureHash),
      name: 'constructor',
      displayName: fullName,
      signature,
      signatureHash,
      filePath: relativePath,
      fileHash,
      startLine: ctor.getStartLineNumber(),
      endLine: ctor.getEndLineNumber(),
      startColumn: 0,
      endColumn: 0,
      astHash,
      isExported: isClassExported,
      isAsync: false,
      isGenerator: false,
      isArrowFunction: false,
      isMethod: false,
      isConstructor: true,
      isStatic: false,
      sourceCode: ctor.getFullText().trim(),
      parameters: this.extractConstructorParameters(ctor)
    };

    const scope = ctor.getScope();
    if (scope && scope !== 'public') {
      functionInfo.accessModifier = scope;
    }

    functionInfo.parentClass = className;

    return functionInfo;
  }

  private extractVariableFunctions(
    sourceFile: SourceFile,
    relativePath: string,
    fileHash: string,
    fileContent: string
  ): FunctionInfo[] {
    const functions: FunctionInfo[] = [];

    sourceFile.getVariableStatements().forEach(stmt => {
      stmt.getDeclarations().forEach(decl => {
        const initializer = decl.getInitializer();
        if (!initializer) return;

        const name = decl.getName();
        let functionNode: ArrowFunction | FunctionExpression | null = null;

        if (initializer.getKind() === SyntaxKind.ArrowFunction) {
          functionNode = initializer as ArrowFunction;
        } else if (initializer.getKind() === SyntaxKind.FunctionExpression) {
          functionNode = initializer as FunctionExpression;
        }

        if (functionNode) {
          const signature = this.getArrowFunctionSignature(name, functionNode);
          const startPos = functionNode.getBody()?.getStart() || functionNode.getStart();
          const endPos = functionNode.getBody()?.getEnd() || functionNode.getEnd();
          const functionBody = fileContent.substring(startPos, endPos);
          const astHash = this.calculateASTHash(functionBody);
          const signatureHash = this.calculateSignatureHash(signature);
          const returnType = this.extractArrowFunctionReturnType(functionNode);

          const functionInfo: FunctionInfo = {
            id: this.generateFunctionId(relativePath, name, signatureHash),
            name,
            displayName: name,
            signature,
            signatureHash,
            filePath: relativePath,
            fileHash,
            startLine: functionNode.getStartLineNumber(),
            endLine: functionNode.getEndLineNumber(),
            startColumn: 0,
            endColumn: 0,
            astHash,
            isExported: stmt.isExported(),
            isAsync: functionNode.isAsync(),
            isGenerator: functionNode.getKind() === SyntaxKind.FunctionExpression ? !!(functionNode as FunctionExpression).getAsteriskToken() : false,
            isArrowFunction: functionNode.getKind() === SyntaxKind.ArrowFunction,
            isMethod: false,
            isConstructor: false,
            isStatic: false,
            sourceCode: functionNode.getFullText().trim(),
            parameters: this.extractArrowFunctionParameters(functionNode)
          };

          if (returnType) {
            functionInfo.returnType = returnType;
          }

          functions.push(functionInfo);
        }
      });
    });

    return functions;
  }

  private getFunctionSignature(func: FunctionDeclaration): string {
    const name = func.getName() || 'anonymous';
    const params = func.getParameters().map(p => p.getText()).join(', ');
    const returnType = func.getReturnTypeNode()?.getText() || 'void';
    const asyncModifier = func.isAsync() ? 'async ' : '';
    
    return `${asyncModifier}${name}(${params}): ${returnType}`;
  }

  private getMethodSignature(method: MethodDeclaration, className: string): string {
    const name = method.getName();
    const params = method.getParameters().map(p => p.getText()).join(', ');
    const returnType = method.getReturnTypeNode()?.getText() || 'void';
    const asyncModifier = method.isAsync() ? 'async ' : '';
    const accessibility = method.getScope() || 'public';
    
    return `${accessibility} ${asyncModifier}${className}.${name}(${params}): ${returnType}`;
  }

  private getArrowFunctionSignature(name: string, func: ArrowFunction | FunctionExpression): string {
    const params = func.getParameters().map(p => p.getText()).join(', ');
    const returnType = func.getReturnTypeNode()?.getText() || 'unknown';
    const asyncModifier = func.isAsync() ? 'async ' : '';
    
    return `${asyncModifier}${name} = (${params}): ${returnType} => {...}`;
  }

  private getConstructorSignature(ctor: ConstructorDeclaration, className: string): string {
    const params = ctor.getParameters().map(p => p.getText()).join(', ');
    const accessibility = ctor.getScope() || 'public';
    
    return `${accessibility} ${className}(${params})`;
  }

  private extractFunctionParameters(func: FunctionDeclaration): ParameterInfo[] {
    return func.getParameters().map((param, index) => {
      const paramInfo: ParameterInfo = {
        name: param.getName(),
        type: param.getTypeNode()?.getText() || 'any',
        typeSimple: this.simplifyType(param.getTypeNode()?.getText() || 'any'),
        position: index,
        isOptional: param.hasQuestionToken(),
        isRest: param.isRestParameter()
      };

      const defaultValue = param.getInitializer()?.getText();
      if (defaultValue) {
        paramInfo.defaultValue = defaultValue;
      }

      return paramInfo;
    });
  }

  private extractMethodParameters(method: MethodDeclaration): ParameterInfo[] {
    return method.getParameters().map((param, index) => {
      const paramInfo: ParameterInfo = {
        name: param.getName(),
        type: param.getTypeNode()?.getText() || 'any',
        typeSimple: this.simplifyType(param.getTypeNode()?.getText() || 'any'),
        position: index,
        isOptional: param.hasQuestionToken(),
        isRest: param.isRestParameter()
      };

      const defaultValue = param.getInitializer()?.getText();
      if (defaultValue) {
        paramInfo.defaultValue = defaultValue;
      }

      return paramInfo;
    });
  }

  private extractArrowFunctionParameters(func: ArrowFunction | FunctionExpression): ParameterInfo[] {
    return func.getParameters().map((param, index) => {
      const paramInfo: ParameterInfo = {
        name: param.getName(),
        type: param.getTypeNode()?.getText() || 'any',
        typeSimple: this.simplifyType(param.getTypeNode()?.getText() || 'any'),
        position: index,
        isOptional: param.hasQuestionToken(),
        isRest: param.isRestParameter()
      };

      const defaultValue = param.getInitializer()?.getText();
      if (defaultValue) {
        paramInfo.defaultValue = defaultValue;
      }

      return paramInfo;
    });
  }

  private extractFunctionReturnType(func: FunctionDeclaration): ReturnTypeInfo | undefined {
    const returnTypeNode = func.getReturnTypeNode();
    if (!returnTypeNode) return undefined;

    const typeText = returnTypeNode.getText();
    const returnInfo: ReturnTypeInfo = {
      type: typeText,
      typeSimple: this.simplifyType(typeText),
      isPromise: typeText.startsWith('Promise<')
    };

    const promiseType = this.extractPromiseType(typeText);
    if (promiseType) {
      returnInfo.promiseType = promiseType;
    }

    return returnInfo;
  }

  private extractMethodReturnType(method: MethodDeclaration): ReturnTypeInfo | undefined {
    const returnTypeNode = method.getReturnTypeNode();
    if (!returnTypeNode) return undefined;

    const typeText = returnTypeNode.getText();
    const returnInfo: ReturnTypeInfo = {
      type: typeText,
      typeSimple: this.simplifyType(typeText),
      isPromise: typeText.startsWith('Promise<')
    };

    const promiseType = this.extractPromiseType(typeText);
    if (promiseType) {
      returnInfo.promiseType = promiseType;
    }

    return returnInfo;
  }

  private extractArrowFunctionReturnType(func: ArrowFunction | FunctionExpression): ReturnTypeInfo | undefined {
    const returnTypeNode = func.getReturnTypeNode();
    if (!returnTypeNode) return undefined;

    const typeText = returnTypeNode.getText();
    const returnInfo: ReturnTypeInfo = {
      type: typeText,
      typeSimple: this.simplifyType(typeText),
      isPromise: typeText.startsWith('Promise<')
    };

    const promiseType = this.extractPromiseType(typeText);
    if (promiseType) {
      returnInfo.promiseType = promiseType;
    }

    return returnInfo;
  }

  private extractConstructorParameters(ctor: ConstructorDeclaration): ParameterInfo[] {
    return ctor.getParameters().map((param, index) => {
      const paramInfo: ParameterInfo = {
        name: param.getName(),
        type: param.getTypeNode()?.getText() || 'any',
        typeSimple: this.simplifyType(param.getTypeNode()?.getText() || 'any'),
        position: index,
        isOptional: param.hasQuestionToken(),
        isRest: param.isRestParameter()
      };

      const defaultValue = param.getInitializer()?.getText();
      if (defaultValue) {
        paramInfo.defaultValue = defaultValue;
      }

      return paramInfo;
    });
  }

  private simplifyType(typeText: string): string {
    if (typeText.includes('string')) return 'string';
    if (typeText.includes('number')) return 'number';
    if (typeText.includes('boolean')) return 'boolean';
    if (typeText.includes('Promise<')) return 'Promise';
    if (typeText.includes('[]')) return 'array';
    if (typeText.includes('{}') || typeText.includes('object')) return 'object';
    return typeText;
  }

  private extractPromiseType(typeText: string): string | undefined {
    const match = typeText.match(/Promise<(.+)>/);
    return match?.[1];
  }

  private calculateFileHash(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  private calculateASTHash(content: string): string {
    const normalized = content
      .replace(/\s+/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .trim();
    
    return crypto
      .createHash('sha256')
      .update(normalized)
      .digest('hex')
      .substring(0, 8);
  }

  private calculateSignatureHash(signature: string): string {
    return crypto.createHash('md5').update(signature).digest('hex');
  }

  private generateFunctionId(filePath: string, name: string, signatureHash: string): string {
    const components = [filePath, name, signatureHash.substring(0, 8)];
    return crypto.createHash('md5').update(components.join('|')).digest('hex');
  }
}
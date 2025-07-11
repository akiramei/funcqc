import {
  Project,
  SourceFile,
  FunctionDeclaration,
  MethodDeclaration,
  ArrowFunction,
  FunctionExpression,
  SyntaxKind,
  ClassDeclaration,
  ConstructorDeclaration,
  Node,
  ModuleDeclaration,
} from 'ts-morph';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { FunctionInfo, ParameterInfo, ReturnTypeInfo } from '../types';
import { BatchProcessor } from '../utils/batch-processor';
import { AnalysisCache, CacheStats } from '../utils/analysis-cache';

/**
 * TypeScript analyzer using ts-morph for robust AST parsing
 * Optimized for large-scale projects with streaming and memory management
 */
export class TypeScriptAnalyzer {
  private project: Project;
  private readonly maxSourceFilesInMemory: number;
  private cache: AnalysisCache;

  constructor(maxSourceFilesInMemory: number = 50, enableCache: boolean = true) {
    this.maxSourceFilesInMemory = maxSourceFilesInMemory;
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
        jsx: 4, // Preserve
      },
    });

    // Initialize cache if enabled
    if (enableCache) {
      this.cache = new AnalysisCache({
        maxMemoryEntries: Math.max(500, maxSourceFilesInMemory * 10),
        maxMemorySize: 50, // 50MB cache
        persistentCachePath: path.join(process.cwd(), '.funcqc-cache'),
      });
    } else {
      this.cache = new AnalysisCache({
        maxMemoryEntries: 0,
        maxMemorySize: 0,
      });
    }
  }

  /**
   * Analyze a TypeScript file and extract function information
   */
  async analyzeFile(filePath: string): Promise<FunctionInfo[]> {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File does not exist: ${filePath}`);
      }

      // Check cache first
      try {
        const cachedResult = await this.cache.get(filePath);
        if (cachedResult) {
          // Generate new physical IDs for cached functions to ensure uniqueness
          return cachedResult.map(func => ({
            ...func,
            id: this.generatePhysicalId(),
          }));
        }
      } catch (error) {
        console.warn(
          `Cache retrieval failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      const sourceFile = this.project.addSourceFileAtPath(filePath);
      const fileContent = sourceFile.getFullText();
      const fileHash = this.calculateFileHash(fileContent);
      const relativePath = path.relative(process.cwd(), filePath);

      const functions: FunctionInfo[] = [];

      try {
        // Function declarations
        sourceFile.getFunctions().forEach(func => {
          const info = this.extractFunctionInfo(
            func,
            relativePath,
            fileHash,
            sourceFile,
            fileContent
          );
          if (info) functions.push(info);
        });

        // Method declarations (class methods) and constructors
        sourceFile.getClasses().forEach(cls => {
          // Methods
          cls.getMethods().forEach(method => {
            const info = this.extractMethodInfo(
              method,
              relativePath,
              fileHash,
              sourceFile,
              fileContent
            );
            if (info) functions.push(info);
          });

          // Constructors
          cls.getConstructors().forEach(ctor => {
            const info = this.extractConstructorInfo(
              ctor,
              relativePath,
              fileHash,
              sourceFile,
              fileContent
            );
            if (info) functions.push(info);
          });
        });

        // Arrow functions and function expressions assigned to variables
        this.extractVariableFunctions(sourceFile, relativePath, fileHash, fileContent).forEach(
          info => {
            functions.push(info);
          }
        );
      } finally {
        // Prevent memory leaks by removing the file
        this.project.removeSourceFile(sourceFile);
        this.manageMemory();
      }

      // Cache the results
      try {
        await this.cache.set(filePath, functions);
      } catch (error) {
        console.warn(
          `Cache storage failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      return functions;
    } catch (error) {
      throw new Error(
        `Failed to analyze ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Analyze multiple files in batches for optimal memory usage
   */
  async analyzeFilesBatch(
    filePaths: string[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<FunctionInfo[]> {
    const batchSize = Math.min(this.maxSourceFilesInMemory, 20); // Conservative batch size
    const allFunctions: FunctionInfo[] = [];

    // Process files in batches to control memory usage
    const results = await BatchProcessor.processWithProgress(
      filePaths,
      async (filePath: string) => {
        try {
          return await this.analyzeFile(filePath);
        } catch (error) {
          // Log the error with file path for debugging
          console.warn(
            `Warning: Failed to analyze ${filePath}: ${error instanceof Error ? error.message : String(error)}`
          );
          // Return empty array to continue processing other files
          return [];
        }
      },
      onProgress,
      batchSize
    );

    // Flatten results
    for (const batch of results) {
      allFunctions.push(...batch);
    }

    return allFunctions;
  }

  /**
   * Stream analyze files one by one with callback for each file
   * Most memory-efficient approach for very large projects
   */
  async analyzeFilesStream(
    filePaths: string[],
    onFileAnalyzed: (filePath: string, functions: FunctionInfo[]) => Promise<void>,
    onProgress?: (completed: number, total: number) => void
  ): Promise<void> {
    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];

      try {
        const functions = await this.analyzeFile(filePath);
        await onFileAnalyzed(filePath, functions);
      } catch (error) {
        console.warn(
          `Warning: Failed to analyze ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        );
        await onFileAnalyzed(filePath, []);
      }

      if (onProgress) {
        onProgress(i + 1, filePaths.length);
      }

      // Force garbage collection every 100 files
      if (i % 100 === 0 && global.gc) {
        global.gc();
      }
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

    // Extract comprehensive function context
    const contextPath = this.extractContextPath(func);
    const modifiers = this.extractModifiers(func);
    const functionType = this.determineFunctionType(func);
    const nestingLevel = this.calculateNestingLevel(func);

    // Generate 3D identification system
    const physicalId = this.generatePhysicalId();
    const semanticId = this.generateSemanticId(
      relativePath,
      name,
      signature,
      contextPath,
      modifiers
    );
    const contentId = this.generateContentId(astHash, functionBody);

    const functionInfo: FunctionInfo = {
      id: physicalId,
      semanticId,
      contentId,
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

      // Enhanced function identification
      contextPath,
      functionType,
      modifiers,
      nestingLevel,

      // Existing function attributes
      isExported: func.isExported(),
      isAsync: func.isAsync(),
      isGenerator: !!func.getAsteriskToken(),
      isArrowFunction: false,
      isMethod: false,
      isConstructor: false,
      isStatic: false,
      sourceCode: func.getFullText().trim(),
      parameters: this.extractFunctionParameters(func),
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

    // Extract comprehensive function context
    const contextPath = this.extractContextPath(method);
    const modifiers = this.extractModifiers(method);
    const functionType = this.determineFunctionType(method);
    const nestingLevel = this.calculateNestingLevel(method);

    // Generate 3D identification system
    const physicalId = this.generatePhysicalId();
    const semanticId = this.generateSemanticId(
      relativePath,
      fullName,
      signature,
      contextPath,
      modifiers
    );
    const contentId = this.generateContentId(astHash, methodBody);

    const functionInfo: FunctionInfo = {
      id: physicalId,
      semanticId,
      contentId,
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

      // Enhanced function identification
      contextPath,
      functionType,
      modifiers,
      nestingLevel,

      // Existing function attributes
      isExported: isClassExported,
      isAsync: method.isAsync(),
      isGenerator: !!method.getAsteriskToken(),
      isArrowFunction: false,
      isMethod: true,
      isConstructor: false,
      isStatic: method.isStatic(),
      sourceCode: method.getFullText().trim(),
      parameters: this.extractMethodParameters(method),
    };

    if (returnType) {
      functionInfo.returnType = returnType;
    }

    const scope = method.getScope();
    if (scope && scope !== 'public') {
      functionInfo.accessModifier = scope;
    }

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

    // Extract comprehensive function context
    const contextPath = this.extractConstructorContextPath(ctor);
    const modifiers: string[] = [];
    if (isClassExported) modifiers.push('exported');

    const functionType = 'method'; // Constructors are a type of method
    const nestingLevel = this.calculateConstructorNestingLevel(ctor);

    // Generate 3D identification system
    const physicalId = this.generatePhysicalId();
    const semanticId = this.generateSemanticId(
      relativePath,
      fullName,
      signature,
      contextPath,
      modifiers
    );
    const contentId = this.generateContentId(astHash, constructorBody);

    const functionInfo: FunctionInfo = {
      id: physicalId,
      semanticId,
      contentId,
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

      // Enhanced function identification
      contextPath,
      functionType,
      modifiers,
      nestingLevel,

      // Existing function attributes
      isExported: isClassExported,
      isAsync: false,
      isGenerator: false,
      isArrowFunction: false,
      isMethod: false,
      isConstructor: true,
      isStatic: false,
      sourceCode: ctor.getFullText().trim(),
      parameters: this.extractConstructorParameters(ctor),
    };

    const scope = ctor.getScope();
    if (scope && scope !== 'public') {
      functionInfo.accessModifier = scope;
    }

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

          // Extract comprehensive function context
          const contextPath = this.extractContextPath(functionNode as ArrowFunction);
          const modifiers: string[] = [];
          if (functionNode.isAsync()) modifiers.push('async');
          if (stmt.isExported()) modifiers.push('exported');

          const functionType = this.determineFunctionType(functionNode as ArrowFunction);
          const nestingLevel = this.calculateNestingLevel(functionNode as ArrowFunction);

          // Generate 3D identification system
          const physicalId = this.generatePhysicalId();
          const semanticId = this.generateSemanticId(
            relativePath,
            name,
            signature,
            contextPath,
            modifiers
          );
          const contentId = this.generateContentId(astHash, functionBody);
          const functionInfo: FunctionInfo = {
            id: physicalId,
            semanticId,
            contentId,
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

            // Enhanced function identification
            contextPath,
            functionType,
            modifiers,
            nestingLevel,

            // Existing function attributes
            isExported: stmt.isExported(),
            isAsync: functionNode.isAsync(),
            isGenerator:
              functionNode.getKind() === SyntaxKind.FunctionExpression
                ? !!(functionNode as FunctionExpression).getAsteriskToken()
                : false,
            isArrowFunction: functionNode.getKind() === SyntaxKind.ArrowFunction,
            isMethod: false,
            isConstructor: false,
            isStatic: false,
            sourceCode: functionNode.getFullText().trim(),
            parameters: this.extractArrowFunctionParameters(functionNode),
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
    const params = func
      .getParameters()
      .map(p => p.getText())
      .join(', ');
    const returnType = func.getReturnTypeNode()?.getText() || 'void';
    const asyncModifier = func.isAsync() ? 'async ' : '';

    return `${asyncModifier}${name}(${params}): ${returnType}`;
  }

  private getMethodSignature(method: MethodDeclaration, className: string): string {
    const name = method.getName();
    const params = method
      .getParameters()
      .map(p => p.getText())
      .join(', ');
    const returnType = method.getReturnTypeNode()?.getText() || 'void';
    const asyncModifier = method.isAsync() ? 'async ' : '';
    const accessibility = method.getScope() || 'public';

    return `${accessibility} ${asyncModifier}${className}.${name}(${params}): ${returnType}`;
  }

  private getArrowFunctionSignature(
    name: string,
    func: ArrowFunction | FunctionExpression
  ): string {
    const params = func
      .getParameters()
      .map(p => p.getText())
      .join(', ');
    const returnType = func.getReturnTypeNode()?.getText() || 'unknown';
    const asyncModifier = func.isAsync() ? 'async ' : '';

    return `${asyncModifier}${name} = (${params}): ${returnType} => {...}`;
  }

  private getConstructorSignature(ctor: ConstructorDeclaration, className: string): string {
    const params = ctor
      .getParameters()
      .map(p => p.getText())
      .join(', ');
    const accessibility = ctor.getScope() || 'public';

    return `${accessibility} ${className}(${params})`;
  }

  /**
   * Extract parameters from any function-like node
   * Unified method to handle all function types consistently
   */
  private extractParameters(
    node:
      | FunctionDeclaration
      | MethodDeclaration
      | ArrowFunction
      | FunctionExpression
      | ConstructorDeclaration
  ): ParameterInfo[] {
    return node.getParameters().map((param, index) => {
      const paramInfo: ParameterInfo = {
        name: param.getName(),
        type: param.getTypeNode()?.getText() || 'any',
        typeSimple: this.simplifyType(param.getTypeNode()?.getText() || 'any'),
        position: index,
        isOptional: param.hasQuestionToken(),
        isRest: param.isRestParameter(),
      };

      const defaultValue = param.getInitializer()?.getText();
      if (defaultValue) {
        paramInfo.defaultValue = defaultValue;
      }

      return paramInfo;
    });
  }

  private extractFunctionParameters(func: FunctionDeclaration): ParameterInfo[] {
    return this.extractParameters(func);
  }

  private extractMethodParameters(method: MethodDeclaration): ParameterInfo[] {
    return this.extractParameters(method);
  }

  private extractArrowFunctionParameters(
    func: ArrowFunction | FunctionExpression
  ): ParameterInfo[] {
    return this.extractParameters(func);
  }

  private extractFunctionReturnType(func: FunctionDeclaration): ReturnTypeInfo | undefined {
    const returnTypeNode = func.getReturnTypeNode();
    if (!returnTypeNode) return undefined;

    const typeText = returnTypeNode.getText();
    const returnInfo: ReturnTypeInfo = {
      type: typeText,
      typeSimple: this.simplifyType(typeText),
      isPromise: typeText.startsWith('Promise<'),
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
      isPromise: typeText.startsWith('Promise<'),
    };

    const promiseType = this.extractPromiseType(typeText);
    if (promiseType) {
      returnInfo.promiseType = promiseType;
    }

    return returnInfo;
  }

  private extractArrowFunctionReturnType(
    func: ArrowFunction | FunctionExpression
  ): ReturnTypeInfo | undefined {
    const returnTypeNode = func.getReturnTypeNode();
    if (!returnTypeNode) return undefined;

    const typeText = returnTypeNode.getText();
    const returnInfo: ReturnTypeInfo = {
      type: typeText,
      typeSimple: this.simplifyType(typeText),
      isPromise: typeText.startsWith('Promise<'),
    };

    const promiseType = this.extractPromiseType(typeText);
    if (promiseType) {
      returnInfo.promiseType = promiseType;
    }

    return returnInfo;
  }

  private extractConstructorParameters(ctor: ConstructorDeclaration): ParameterInfo[] {
    return this.extractParameters(ctor);
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

    return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 8);
  }

  private calculateSignatureHash(signature: string): string {
    return crypto.createHash('sha256').update(signature).digest('hex');
  }

  /**
   * Generate a UUID for the physical function instance
   */
  private generatePhysicalId(): string {
    return crypto.randomUUID();
  }

  /**
   * Generate a semantic ID that identifies the same function role across versions
   * Excludes position information for stability during refactoring
   */
  private generateSemanticId(
    filePath: string,
    name: string,
    signature: string,
    contextPath: string[],
    modifiers: string[]
  ): string {
    const components = [
      filePath,
      ...contextPath,
      name || '<anonymous>',
      signature,
      ...modifiers.sort(),
      // Position information deliberately excluded for stability
    ];

    return crypto.createHash('sha256').update(components.join('|')).digest('hex');
  }

  /**
   * Generate a content ID that identifies the same implementation
   * Changes when function body or AST structure changes
   */
  private generateContentId(astHash: string, sourceCode: string): string {
    const contentComponents = [astHash, sourceCode.trim()];

    return crypto.createHash('sha256').update(contentComponents.join('|')).digest('hex');
  }

  /**
   * Extract hierarchical context path for a function
   */
  private extractContextPath(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction
  ): string[] {
    const path: string[] = [];
    let current = node.getParent();

    while (current) {
      if (current.getKind() === SyntaxKind.ClassDeclaration) {
        const className = (current as ClassDeclaration).getName();
        if (className) path.unshift(className);
      } else if (current.getKind() === SyntaxKind.ModuleDeclaration) {
        const moduleName = (current as ModuleDeclaration).getName();
        path.unshift(moduleName);
      } else if (current.getKind() === SyntaxKind.FunctionDeclaration) {
        const funcName = (current as FunctionDeclaration).getName();
        if (funcName) path.unshift(funcName);
      }
      const nextParent = current.getParent();
      if (!nextParent) break;
      current = nextParent;
    }

    return path;
  }

  /**
   * Extract function modifiers as string array
   */
  private extractModifiers(node: FunctionDeclaration | MethodDeclaration): string[] {
    const modifiers: string[] = [];

    if (Node.isFunctionDeclaration(node)) {
      if (node.isAsync()) modifiers.push('async');
      if (node.isExported()) modifiers.push('exported');
      if (node.getAsteriskToken()) modifiers.push('generator');
    }

    if (Node.isMethodDeclaration(node)) {
      if (node.isAsync()) modifiers.push('async');
      if (node.isStatic()) modifiers.push('static');
      if (node.getAsteriskToken()) modifiers.push('generator');

      const accessModifier = node
        .getModifiers()
        .find(m =>
          [
            SyntaxKind.PublicKeyword,
            SyntaxKind.PrivateKeyword,
            SyntaxKind.ProtectedKeyword,
          ].includes(m.getKind())
        );
      if (accessModifier) {
        modifiers.push(accessModifier.getText());
      } else {
        modifiers.push('public'); // Default access modifier
      }
    }

    return modifiers;
  }

  /**
   * Determine function type based on node type and context
   */
  private determineFunctionType(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction
  ): 'function' | 'method' | 'arrow' | 'local' {
    if (Node.isMethodDeclaration(node)) {
      return 'method';
    }
    if (Node.isArrowFunction(node)) {
      return 'arrow';
    }

    // Check if it's a local function (inside another function)
    let parent = node.getParent();
    while (parent && !Node.isSourceFile(parent)) {
      if (
        Node.isFunctionDeclaration(parent) ||
        Node.isMethodDeclaration(parent) ||
        Node.isArrowFunction(parent)
      ) {
        return 'local';
      }
      const nextParent = parent.getParent();
      if (!nextParent) break;
      parent = nextParent;
    }

    return 'function';
  }

  /**
   * Calculate nesting level for the function
   */
  private calculateNestingLevel(
    node: FunctionDeclaration | MethodDeclaration | ArrowFunction
  ): number {
    let level = 0;
    let parent = node.getParent();

    while (parent && !Node.isSourceFile(parent)) {
      if (
        Node.isFunctionDeclaration(parent) ||
        Node.isMethodDeclaration(parent) ||
        Node.isArrowFunction(parent)
      ) {
        level++;
      }
      const nextParent = parent.getParent();
      if (!nextParent) break;
      parent = nextParent;
    }

    return level;
  }

  /**
   * Extract hierarchical context path for a constructor
   */
  private extractConstructorContextPath(ctor: ConstructorDeclaration): string[] {
    const path: string[] = [];

    // For constructors, we know the immediate parent is a class
    const parent = ctor.getParent();
    if (parent && parent.getKind() === SyntaxKind.ClassDeclaration) {
      const className = (parent as ClassDeclaration).getName();
      if (className) path.push(className);
    }

    return path;
  }

  /**
   * Calculate nesting level for a constructor
   */
  private calculateConstructorNestingLevel(_ctor: ConstructorDeclaration): number {
    // Constructors are not typically nested, but we can check for nested classes
    return 0;
  }

  /**
   * Manage memory by cleaning up project if too many source files are loaded
   */
  private manageMemory(): void {
    const sourceFiles = this.project.getSourceFiles();
    if (sourceFiles.length > this.maxSourceFilesInMemory) {
      // Remove oldest source files to free memory
      const filesToRemove = sourceFiles.slice(0, Math.floor(sourceFiles.length / 2));
      filesToRemove.forEach(file => {
        this.project.removeSourceFile(file);
      });
    }
  }

  /**
   * Clean up all source files from memory
   */
  async cleanup(): Promise<void> {
    const sourceFiles = this.project.getSourceFiles();
    sourceFiles.forEach(file => {
      this.project.removeSourceFile(file);
    });

    // Cleanup cache
    await this.cache.cleanup();
  }

  /**
   * Get memory usage statistics
   */
  getMemoryStats(): { sourceFilesInMemory: number; maxSourceFiles: number } {
    return {
      sourceFilesInMemory: this.project.getSourceFiles().length,
      maxSourceFiles: this.maxSourceFilesInMemory,
    };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return this.cache.getStats();
  }

  /**
   * Safely traverse parent nodes with callback
   * Currently unused but available for future parent traversal optimization
   */
  // private traverseParents(
  //   node: Node,
  //   callback: (parent: Node) => void | boolean
  // ): void {
  //   let current = node.getParent();
  //   while (current && !Node.isSourceFile(current)) {
  //     if (callback(current) === false) break;
  //     const next = current.getParent();
  //     if (!next) break;
  //     current = next;
  //   }
  // }
}

/**
 * Debug Residue Detector
 * 
 * Detects debug code residue in TypeScript files using AST analysis
 */

import {
  Project,
  SourceFile,
  Node,
  CallExpression,
  SyntaxKind
} from 'ts-morph';
import * as path from 'path';
import {
  ResidueFinding,
  ResidueKind,
  ResiduePattern,
  ResidueDetectionConfig,
  ResidueCheckResult,
  ResidueSummary,
  ResidueContext
} from '../types/debug-residue';

/**
 * Default configuration for residue detection
 */
const DEFAULT_CONFIG: ResidueDetectionConfig = {
  exemptFunctionNames: ['notifyUser', 'printUsage', 'displayHelp', 'showError'],
  loggerNames: ['logger', 'winston', 'pino', 'bunyan', 'log4js'],
  customMarkers: ['// DEBUG:', '/* DEBUG:', '// TEMP:', '// TODO: remove'],
  exclude: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**', '**/dist/**', '**/build/**']
};

/**
 * Debug Residue Detector using ts-morph
 */
export class DebugResidueDetector {
  private project: Project;
  private config: ResidueDetectionConfig;
  private findings: ResidueFinding[] = [];
  private filesAnalyzed = 0;
  private functionsAnalyzed = 0;

  constructor(config: Partial<ResidueDetectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.project = new Project({
      ...(this.config.tsconfigPath ? { tsConfigFilePath: this.config.tsconfigPath } : {}),
      skipAddingFilesFromTsConfig: !this.config.tsconfigPath,
      compilerOptions: {
        isolatedModules: true,
        skipLibCheck: true,
        noResolve: true,
        noLib: true
      }
    });
  }

  /**
   * Analyze files for debug residue
   */
  async analyze(filePaths: string[], includeContext: boolean = false): Promise<ResidueCheckResult> {
    this.findings = [];
    this.filesAnalyzed = 0;
    this.functionsAnalyzed = 0;

    // Add source files to project
    for (const filePath of filePaths) {
      if (this.shouldExclude(filePath)) {
        continue;
      }
      try {
        this.project.addSourceFileAtPath(filePath);
      } catch (error) {
        // Skip files that can't be parsed
        console.error(`Failed to parse ${filePath}:`, error);
      }
    }

    // Analyze each source file
    for (const sourceFile of this.project.getSourceFiles()) {
      this.analyzeSourceFile(sourceFile, includeContext);
      this.filesAnalyzed++;
    }

    return this.createResult();
  }

  /**
   * Analyze a single source file
   */
  private analyzeSourceFile(sourceFile: SourceFile, includeContext: boolean): void {
    const filePath = sourceFile.getFilePath();

    // Count functions
    sourceFile.forEachDescendant((node) => {
      if (this.isFunction(node)) {
        this.functionsAnalyzed++;
      }
    });

    // Analyze nodes
    sourceFile.forEachDescendant((node) => {
      // Check for debugger statements
      if (node.getKind() === SyntaxKind.DebuggerStatement) {
        this.addFinding(
          filePath,
          node,
          'AutoRemove',
          'debugger',
          'debugger statement',
          'debugger;',
          includeContext
        );
        return;
      }

      // Check for call expressions
      if (Node.isCallExpression(node)) {
        this.analyzeCallExpression(node, filePath, includeContext);
      }

      // Check for comments with debug markers
      const leadingComments = node.getLeadingCommentRanges();
      const trailingComments = node.getTrailingCommentRanges();
      const allComments = [...leadingComments, ...trailingComments];

      for (const comment of allComments) {
        const commentText = comment.getText();
        if (this.hasDebugMarker(commentText)) {
          const { line, column } = sourceFile.getLineAndColumnAtPos(comment.getPos());
          const finding: ResidueFinding = {
            filePath,
            line,
            column,
            kind: 'AutoRemove',
            pattern: 'debug-marker',
            reason: 'debug marker in comment',
            code: commentText.trim()
          };
          if (includeContext) {
            finding.context = this.getContext(node, sourceFile);
          }
          this.findings.push(finding);
        }
      }
    });
  }

  /**
   * Analyze a call expression
   */
  private analyzeCallExpression(node: CallExpression, filePath: string, includeContext: boolean): void {
    const calleeText = node.getExpression().getText();

    // Check if it has a debug marker comment
    if (this.hasDebugMarkerComment(node)) {
      this.addFinding(
        filePath,
        node,
        'AutoRemove',
        this.getPatternFromCallee(calleeText),
        'has DEBUG marker',
        node.getText(),
        includeContext
      );
      return;
    }

    // AutoRemove patterns
    if (calleeText === 'debugger' || 
        calleeText === 'console.debug' || 
        calleeText === 'console.trace' || 
        calleeText === 'alert') {
      this.addFinding(
        filePath,
        node,
        'AutoRemove',
        this.getPatternFromCallee(calleeText),
        'explicit debug API',
        node.getText(),
        includeContext
      );
      return;
    }

    // Check for logger.debug
    if (this.isLoggerDebug(calleeText)) {
      this.addFinding(
        filePath,
        node,
        'AutoRemove',
        'logger.debug',
        'logger debug call',
        node.getText(),
        includeContext
      );
      return;
    }

    // Check if within exempt function
    if (this.isWithinExemptFunction(node)) {
      if (this.isConsoleOrProcessOutput(calleeText)) {
        this.addFinding(
          filePath,
          node,
          'Exempt',
          this.getPatternFromCallee(calleeText),
          'inside exempt wrapper (user-facing)',
          node.getText(),
          includeContext
        );
        return;
      }
    }

    // NeedsReview patterns
    if (calleeText === 'console.log' || 
        calleeText === 'console.error' ||
        calleeText === 'process.stdout.write' || 
        calleeText === 'process.stderr.write') {
      
      // Check if under NODE_ENV guard
      const underEnvGuard = this.isUnderNodeEnvDevGuard(node);
      const reason = underEnvGuard ? 'under NODE_ENV===development guard' : 'generic console output';
      
      this.addFinding(
        filePath,
        node,
        'NeedsReview',
        this.getPatternFromCallee(calleeText),
        reason,
        node.getText(),
        includeContext
      );
    }
  }

  /**
   * Add a finding to the results
   */
  private addFinding(
    filePath: string,
    node: Node,
    kind: ResidueKind,
    pattern: ResiduePattern,
    reason: string,
    code: string,
    includeContext: boolean
  ): void {
    const sourceFile = node.getSourceFile();
    const { line, column } = sourceFile.getLineAndColumnAtPos(node.getStart());

    const finding: ResidueFinding = {
      filePath,
      line,
      column,
      kind,
      pattern,
      reason,
      code: code.substring(0, 200) // Limit code length
    };

    const functionDisplayName = this.getFunctionDisplayName(node);
    if (functionDisplayName) {
      finding.functionDisplayName = functionDisplayName;
    }

    if (includeContext) {
      finding.context = this.getContext(node, sourceFile);
    }

    this.findings.push(finding);
  }

  /**
   * Get context information for a node
   */
  private getContext(node: Node, sourceFile: SourceFile): ResidueContext {
    const functionNode = this.getContainingFunction(node);
    const classNode = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
    
    // Get surrounding code
    const startLine = Math.max(1, node.getStartLineNumber() - 3);
    const endLine = Math.min(sourceFile.getEndLineNumber(), node.getEndLineNumber() + 3);
    const lines = sourceFile.getFullText().split('\n');
    
    const before: string[] = [];
    const after: string[] = [];
    
    for (let i = startLine - 1; i < node.getStartLineNumber() - 1; i++) {
      if (lines[i] !== undefined) {
        before.push(lines[i]);
      }
    }
    
    for (let i = node.getEndLineNumber(); i < endLine; i++) {
      if (lines[i] !== undefined) {
        after.push(lines[i]);
      }
    }

    // Get imports
    const imports = sourceFile.getImportDeclarations()
      .map(imp => imp.getText())
      .slice(0, 10); // Limit to first 10 imports

    // Check available helpers
    const availableHelpers: string[] = [];
    if (imports.some(imp => imp.includes('logger'))) {
      availableHelpers.push('logger');
    }
    if (imports.some(imp => imp.includes('notifyUser'))) {
      availableHelpers.push('notifyUser');
    }

    // Check if in try-catch
    const isInTryCatch = node.getFirstAncestorByKind(SyntaxKind.TryStatement) !== undefined;
    
    // Check if in conditional
    const isInConditional = node.getFirstAncestorByKind(SyntaxKind.IfStatement) !== undefined;

    return {
      functionName: functionNode ? this.getFunctionName(functionNode) : undefined,
      functionType: functionNode ? this.getFunctionType(functionNode) : undefined,
      className: classNode?.getName(),
      surroundingCode: { before, after },
      imports,
      availableHelpers,
      isInTryCatch,
      isInConditional,
      isUnderNodeEnvGuard: this.isUnderNodeEnvDevGuard(node),
      functionPurpose: this.inferFunctionPurpose(functionNode),
      fileType: this.inferFileType(sourceFile.getFilePath())
    };
  }

  /**
   * Check if path should be excluded
   */
  private shouldExclude(filePath: string): boolean {
    if (!this.config.exclude) return false;
    
    return this.config.exclude.some(pattern => {
      // Simple glob pattern matching
      const regex = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.');
      return new RegExp(regex).test(filePath);
    });
  }

  /**
   * Check if text has debug marker
   */
  private hasDebugMarker(text: string): boolean {
    if (!this.config.customMarkers) return false;
    
    return this.config.customMarkers.some(marker => 
      text.toUpperCase().includes(marker.toUpperCase())
    );
  }

  /**
   * Check if node has debug marker comment
   */
  private hasDebugMarkerComment(node: Node): boolean {
    const comments = [
      ...node.getLeadingCommentRanges(),
      ...node.getTrailingCommentRanges()
    ];
    
    return comments.some(comment => 
      this.hasDebugMarker(comment.getText())
    );
  }

  /**
   * Get pattern from callee text
   */
  private getPatternFromCallee(calleeText: string): ResiduePattern {
    const patternMap: Record<string, ResiduePattern> = {
      'debugger': 'debugger',
      'console.debug': 'console.debug',
      'console.trace': 'console.trace',
      'console.log': 'console.log',
      'console.error': 'console.error',
      'alert': 'alert',
      'process.stdout.write': 'process.stdout.write',
      'process.stderr.write': 'process.stderr.write'
    };
    
    if (calleeText.includes('.debug')) return 'logger.debug';
    
    return patternMap[calleeText] || 'custom';
  }

  /**
   * Check if callee is logger.debug
   */
  private isLoggerDebug(calleeText: string): boolean {
    if (!this.config.loggerNames) return false;
    
    return this.config.loggerNames.some(logger => 
      calleeText === `${logger}.debug`
    );
  }

  /**
   * Check if node is within exempt function
   */
  private isWithinExemptFunction(node: Node): boolean {
    if (!this.config.exemptFunctionNames) return false;
    
    const func = this.getContainingFunction(node);
    if (!func) return false;
    
    const funcName = this.getFunctionName(func);
    return this.config.exemptFunctionNames.includes(funcName || '');
  }

  /**
   * Check if callee is console or process output
   */
  private isConsoleOrProcessOutput(calleeText: string): boolean {
    return calleeText.startsWith('console.') || 
           calleeText.startsWith('process.stdout.') ||
           calleeText.startsWith('process.stderr.');
  }

  /**
   * Check if under NODE_ENV development guard
   */
  private isUnderNodeEnvDevGuard(node: Node): boolean {
    return node.getAncestors().some(ancestor => {
      const text = ancestor.getText();
      return /process\.env\.NODE_ENV\s*===?\s*['"]development['"]/.test(text);
    });
  }

  /**
   * Get containing function
   */
  private getContainingFunction(node: Node): Node | undefined {
    return node.getFirstAncestor(n => this.isFunction(n));
  }

  /**
   * Check if node is a function
   */
  private isFunction(node: Node): boolean {
    return Node.isFunctionDeclaration(node) ||
           Node.isMethodDeclaration(node) ||
           Node.isArrowFunction(node) ||
           Node.isFunctionExpression(node) ||
           Node.isConstructorDeclaration(node);
  }

  /**
   * Get function name
   */
  private getFunctionName(node: Node): string | undefined {
    if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
      return node.getName();
    }
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const parent = node.getParent();
      if (Node.isVariableDeclaration(parent)) {
        return parent.getName();
      }
      if (Node.isPropertyAssignment(parent)) {
        return parent.getName();
      }
    }
    return undefined;
  }

  /**
   * Get function display name for reporting
   */
  private getFunctionDisplayName(node: Node): string | undefined {
    const func = this.getContainingFunction(node);
    if (!func) return undefined;
    
    const name = this.getFunctionName(func);
    const className = func.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)?.getName();
    
    if (className && name) {
      return `${className}.${name}`;
    }
    return name;
  }

  /**
   * Get function type
   */
  private getFunctionType(node: Node): string {
    if (Node.isFunctionDeclaration(node)) return 'function';
    if (Node.isMethodDeclaration(node)) return 'method';
    if (Node.isArrowFunction(node)) return 'arrow';
    if (Node.isFunctionExpression(node)) return 'function';
    if (Node.isConstructorDeclaration(node)) return 'constructor';
    return 'unknown';
  }

  /**
   * Infer function purpose from name
   */
  private inferFunctionPurpose(node: Node | undefined): string | undefined {
    if (!node) return undefined;
    
    const name = this.getFunctionName(node)?.toLowerCase() || '';
    
    if (name.includes('auth') || name.includes('login')) return 'authentication';
    if (name.includes('valid')) return 'validation';
    if (name.includes('handle') || name.includes('process')) return 'processing';
    if (name.includes('get') || name.includes('fetch')) return 'data-retrieval';
    if (name.includes('save') || name.includes('update')) return 'data-mutation';
    if (name.includes('render') || name.includes('display')) return 'rendering';
    
    return undefined;
  }

  /**
   * Infer file type from path
   */
  private inferFileType(filePath: string): string {
    const basename = path.basename(filePath).toLowerCase();
    
    if (basename.includes('handler')) return 'api-handler';
    if (basename.includes('service')) return 'service';
    if (basename.includes('util')) return 'utility';
    if (basename.includes('model')) return 'model';
    if (basename.includes('controller')) return 'controller';
    if (basename.includes('component')) return 'component';
    if (basename.includes('test') || basename.includes('spec')) return 'test';
    
    return 'unknown';
  }

  /**
   * Create the final result
   */
  private createResult(): ResidueCheckResult {
    const summary: ResidueSummary = {
      total: this.findings.length,
      autoRemove: this.findings.filter(f => f.kind === 'AutoRemove').length,
      needsReview: this.findings.filter(f => f.kind === 'NeedsReview').length,
      exempt: this.findings.filter(f => f.kind === 'Exempt').length,
      filesAnalyzed: this.filesAnalyzed,
      functionsAnalyzed: this.functionsAnalyzed
    };

    return {
      findings: this.findings,
      summary,
      config: this.config,
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    };
  }
}
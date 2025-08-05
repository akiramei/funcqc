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
import { StorageProvider } from '../core/storage-provider';
import { FunctionInfo } from '../types';
import { getFileModificationTime } from '../utils/hash-utils';

/**
 * Default configuration for residue detection
 */
const DEFAULT_CONFIG: ResidueDetectionConfig = {
  exemptFunctionNames: [
    // CLI/User-facing functions
    'notifyUser', 'printUsage', 'displayHelp', 'showError', 
    'printHelp', 'showUsage', 'displayError', 'reportError',
    'formatOutput', 'formatResult', 'formatSummary', 'formatTable',
    'displaySummary', 'displayResult', 'displayStatus',
    'logInfo', 'logSuccess', 'logWarning', 'logError',
    // Progress and status functions
    'updateProgress', 'showProgress', 'displayProgress',
    'statusUpdate', 'progressUpdate', 'reportProgress',
    // CLI command handlers (patterns)
    'Command', 'Handler', 'Action',
    // Formatters and printers
    'format', 'print', 'display', 'show', 'render'
  ],
  loggerNames: ['logger', 'winston', 'pino', 'bunyan', 'log4js'],
  customMarkers: ['// DEBUG:', '/* DEBUG:', '// TEMP:', '// TODO: remove', '// FIXME:', '// XXX:'],
  exclude: [
    '**/*.test.ts', '**/*.spec.ts', 
    '**/node_modules/**', '**/dist/**', '**/build/**',
    '**/scripts/**', '**/test/**', '**/tests/**'
  ]
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
  private functionMetadata: Map<string, FunctionInfo> = new Map();
  private storageProvider: StorageProvider;
  private snapshotTimestamp: number = 0;

  constructor(config: Partial<ResidueDetectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.storageProvider = StorageProvider.getInstance();
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
    this.functionMetadata.clear();
    this.snapshotTimestamp = 0;

    // Load function metadata from funcqc database
    await this.loadFunctionMetadata(filePaths);

    // HOTFIX: Validate file integrity before proceeding
    await this.validateFileIntegrity(filePaths);

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
   * Load function metadata from funcqc database
   */
  private async loadFunctionMetadata(filePaths: string[]): Promise<void> {
    try {
      const storage = await this.storageProvider.getStorage();
      
      // Get latest snapshot
      const snapshots = await storage.getSnapshots({ limit: 1, sort: 'created_at' });
      if (snapshots.length === 0) {
        console.warn('No snapshots found in funcqc database');
        return;
      }
      
      const latestSnapshot = snapshots[0];
      this.snapshotTimestamp = new Date(latestSnapshot.createdAt).getTime();
      
      // Get all functions from the latest snapshot
      const functions = await storage.getFunctionsBySnapshotId(latestSnapshot.id);
      
      // Filter functions by the files we're analyzing and create lookup map
      const filePathSet = new Set(filePaths.map(fp => path.resolve(fp)));
      
      for (const func of functions) {
        if (func.filePath && filePathSet.has(path.resolve(func.filePath))) {
          // Create a unique key for the function
          const key = `${func.filePath}:${func.name}:${func.startLine}`;
          this.functionMetadata.set(key, func);
        }
      }
    } catch (error) {
      // If we can't load metadata, continue without it
      console.warn('Could not load function metadata from funcqc database:', error);
    }
  }

  /**
   * HOTFIX: Validate file integrity against snapshot
   */
  private async validateFileIntegrity(filePaths: string[]): Promise<void> {
    if (this.snapshotTimestamp === 0) {
      console.warn('⚠️  SAFETY WARNING: No snapshot timestamp available - cannot validate file freshness');
      return;
    }

    const warnings: string[] = [];
    
    for (const filePath of filePaths) {
      try {
        const resolvedPath = path.resolve(filePath);
        
        // Check file modification time vs snapshot timestamp
        const fileModTime = await getFileModificationTime(resolvedPath);
        
        if (fileModTime > this.snapshotTimestamp) {
          const timeDiff = Math.round((fileModTime - this.snapshotTimestamp) / 1000);
          warnings.push(`${path.relative(process.cwd(), resolvedPath)} (modified ${timeDiff}s after snapshot)`);
        }
        
      } catch (error) {
        console.warn(`Failed to validate ${filePath}: ${error instanceof Error ? error.message : error}`);
      }
    }

    if (warnings.length > 0) {
      
      console.error('\n🚨 CRITICAL SAFETY WARNING:');
      console.error('The following files have been modified AFTER the funcqc snapshot was created:');
      warnings.forEach(warning => console.error(`  • ${warning}`));
      console.error('\nThis means residue-check is operating on STALE DATA and may report incorrect line numbers.');
      console.error('Recommendations:');
      console.error('  • Run "npm run dev -- scan" to create a fresh snapshot');
      console.error('  • Rerun residue-check after updating the snapshot');
      console.error('  • DO NOT use --fix mode until files are synchronized\n');
      
      // SAFETY: Add warning to findings
      const safetyWarning: ResidueFinding = {
        filePath: 'SYSTEM_WARNING',
        line: 0,
        column: 0,
        kind: 'NeedsReview',
        pattern: 'file-integrity-warning',
        reason: `${warnings.length} files modified after snapshot - results may be unreliable`,
        code: warnings.join(', ')
      };
      this.findings.unshift(safetyWarning);
    }
  }

  /**
   * Get function metadata for a given node
   */
  private getFunctionMetadata(node: Node, filePath: string): FunctionInfo | undefined {
    const functionNode = this.getContainingFunction(node);
    if (!functionNode) return undefined;
    
    const functionName = this.getFunctionName(functionNode);
    const startLine = functionNode.getStartLineNumber();
    const resolvedPath = path.resolve(filePath);
    const key = `${resolvedPath}:${functionName}:${startLine}`;
    
    return this.functionMetadata.get(key);
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
   * Analyze a call expression with AST-aware classification
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

    // AutoRemove patterns - always remove these
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

    // For console/process output, use enhanced classification
    if (this.isConsoleOrProcessOutput(calleeText)) {
      const classification = this.classifyConsoleOutput(node, filePath);
      
      this.addFinding(
        filePath,
        node,
        classification.kind,
        this.getPatternFromCallee(calleeText),
        classification.reason,
        node.getText(),
        includeContext
      );
    }
  }

  /**
   * Enhanced classification for console/process output using AST and function metadata
   */
  private classifyConsoleOutput(node: CallExpression, filePath: string): { kind: ResidueKind; reason: string } {
    // Check file path patterns first - strongest indicator
    if (this.isInScriptsDirectory(filePath)) {
      return { kind: 'Exempt', reason: 'in scripts directory (build/utility script)' };
    }

    if (this.isInTestDirectory(filePath)) {
      return { kind: 'Exempt', reason: 'in test directory (test output)' };
    }

    // Check function context using funcqc metadata
    const funcMetadata = this.getFunctionMetadata(node, filePath);
    if (funcMetadata) {
      // Check if function name suggests user-facing purpose
      if (this.isCLIFunction(funcMetadata.name)) {
        return { kind: 'Exempt', reason: `CLI function (${funcMetadata.name})` };
      }

      // Check function complexity - complex functions less likely to be debug
      if (funcMetadata.metrics?.cyclomaticComplexity && funcMetadata.metrics.cyclomaticComplexity > 10) {
        return { kind: 'Exempt', reason: 'complex function likely user-facing' };
      }
    }

    // Check if within exempt function (expanded logic)
    if (this.isWithinExemptFunction(node)) {
      return { kind: 'Exempt', reason: 'inside exempt wrapper (user-facing)' };
    }

    // Check for structured output patterns
    if (this.hasStructuredOutput(node)) {
      return { kind: 'Exempt', reason: 'structured output with formatting' };
    }

    // Check for CLI framework usage
    if (this.usesCLIFramework(node)) {
      return { kind: 'Exempt', reason: 'uses CLI framework (chalk/ora)' };
    }

    // Check error handling context
    if (this.isInErrorHandling(node)) {
      return { kind: 'Exempt', reason: 'error reporting/handling' };
    }

    // Check if under NODE_ENV guard
    if (this.isUnderNodeEnvDevGuard(node)) {
      return { kind: 'NeedsReview', reason: 'under NODE_ENV===development guard' };
    }

    // Default to NeedsReview for ambiguous cases
    return { kind: 'NeedsReview', reason: 'generic console output' };
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

  /**
   * Check if file is in scripts directory
   */
  private isInScriptsDirectory(filePath: string): boolean {
    return filePath.includes('/scripts/') || filePath.includes('\\scripts\\');
  }

  /**
   * Check if file is in test directory
   */
  private isInTestDirectory(filePath: string): boolean {
    return filePath.includes('/test/') || filePath.includes('\\test\\') ||
           filePath.includes('/tests/') || filePath.includes('\\tests\\') ||
           filePath.endsWith('.test.ts') || filePath.endsWith('.spec.ts');
  }

  /**
   * Check if function name suggests CLI purpose
   */
  private isCLIFunction(functionName: string): boolean {
    const name = functionName.toLowerCase();
    return name.includes('command') || name.includes('handler') || 
           name.includes('action') || name.includes('format') ||
           name.includes('print') || name.includes('display') ||
           name.includes('show') || name.includes('render') ||
           name.includes('report') || name.includes('output') ||
           name.includes('log') || name.startsWith('cli');
  }

  /**
   * Check if output has structured formatting (chalk, templates, etc.)
   */
  private hasStructuredOutput(node: CallExpression): boolean {
    const args = node.getArguments();
    if (args.length === 0) return false;

    const firstArg = args[0];
    const argText = firstArg.getText();

    // Check for template literals with structured content
    if (firstArg.getKind() === SyntaxKind.TemplateExpression ||
        firstArg.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
      return argText.includes('\\n') || argText.includes('🔍') || 
             argText.includes('✅') || argText.includes('❌') || 
             argText.includes('📊') || argText.includes('⚠️');
    }

    // Check for chalk usage in arguments
    return argText.includes('chalk.') || argText.includes('.blue(') ||
           argText.includes('.red(') || argText.includes('.green(') ||
           argText.includes('.yellow(') || argText.includes('.bold(');
  }

  /**
   * Check if uses CLI framework (chalk, ora, etc.)
   */
  private usesCLIFramework(node: CallExpression): boolean {
    const sourceFile = node.getSourceFile();
    const imports = sourceFile.getImportDeclarations();
    
    return imports.some(imp => {
      const moduleSpecifier = imp.getModuleSpecifierValue();
      return moduleSpecifier === 'chalk' || moduleSpecifier === 'ora' ||
             moduleSpecifier === 'commander' || moduleSpecifier === 'inquirer';
    });
  }

  /**
   * Check if call is in error handling context
   */
  private isInErrorHandling(node: CallExpression): boolean {
    // Check if in catch block
    if (node.getFirstAncestorByKind(SyntaxKind.CatchClause)) {
      return true;
    }

    // Check if in error handling function
    const containingFunction = this.getContainingFunction(node);
    if (containingFunction) {
      const functionName = this.getFunctionName(containingFunction)?.toLowerCase() || '';
      if (functionName.includes('error') || functionName.includes('fail') ||
          functionName.includes('catch') || functionName.includes('handle')) {
        return true;
      }
    }

    // Check if console.error pattern
    const calleeText = node.getExpression().getText();
    return calleeText === 'console.error' || calleeText === 'process.stderr.write';
  }
}
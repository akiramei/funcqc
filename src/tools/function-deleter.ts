import { Project, SyntaxKind, SourceFile, VariableDeclaration, ProjectOptions, Node } from 'ts-morph';
import { FunctionInfo } from '../types/index.js';
import { groupFunctionsByFile, sortFunctionsForDeletion } from '../utils/function-utils.js';
import chalk from 'chalk';
import { toFileSystemPath } from '../utils/path-normalizer.js';

/**
 * Options for function deletion
 */
export interface FunctionDeletionOptions {
  dryRun?: boolean;
  verbose?: boolean;
  backupFiles?: boolean;
  skipJsDoc?: boolean;
}

/**
 * Result of function deletion operation
 */
export interface DeletionResult {
  success: boolean;
  functionsDeleted: number;
  filesModified: string[];
  errors: string[];
  warnings: string[];
}

/**
 * A safe function deleter using ts-morph for syntax-aware deletion
 */
export class SafeFunctionDeleter {
  private project: Project;
  private verbose: boolean;

  constructor(options: { tsConfigPath?: string; verbose?: boolean } = {}) {
    const projectOptions: Partial<ProjectOptions> = {
      skipFileDependencyResolution: true, // Performance optimization
    };
    
    if (options.tsConfigPath) {
      projectOptions.tsConfigFilePath = options.tsConfigPath;
    }
    
    this.project = new Project(projectOptions);
    this.verbose = options.verbose ?? false;
  }

  /**
   * Delete functions from source files based on funcqc FunctionInfo
   */
  async deleteFunctions(
    functions: FunctionInfo[],
    options: FunctionDeletionOptions = {}
  ): Promise<DeletionResult> {
    const result: DeletionResult = {
      success: true,
      functionsDeleted: 0,
      filesModified: [],
      errors: [],
      warnings: [],
    };

    // Group functions by file for efficient processing
    const functionsByFile = groupFunctionsByFile(functions);

    for (const [filePath, fileFunctions] of functionsByFile.entries()) {
      try {
        const deletionCount = await this.deleteFromFile(filePath, fileFunctions, options);
        
        if (deletionCount > 0) {
          result.functionsDeleted += deletionCount;
          result.filesModified.push(filePath);
          
          if (this.verbose) {
            console.log(chalk.green(`✓ Deleted ${deletionCount} functions from ${filePath}`));
          }
        }
      } catch (error) {
        const errorMsg = `Failed to process ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(errorMsg);
        result.success = false;
        
        if (this.verbose) {
          console.error(chalk.red(`✗ ${errorMsg}`));
        }
      }
    }

    return result;
  }

  /**
   * Delete functions from a single file
   */
  private async deleteFromFile(
    filePath: string, 
    functions: FunctionInfo[], 
    options: FunctionDeletionOptions
  ): Promise<number> {
    // Resolve funcqc unified path ('/src/...') or relative path to actual filesystem path
    const fsPath = toFileSystemPath(filePath);
    // Add source file to project if not already present
    let sourceFile: SourceFile;
    try {
      sourceFile = this.project.getSourceFileOrThrow(fsPath);
    } catch {
      sourceFile = this.project.addSourceFileAtPath(fsPath);
    }

    let deletedCount = 0;

    // Sort functions by start line in reverse order to avoid position shifts
    const sortedFunctions = sortFunctionsForDeletion(functions);

    for (const func of sortedFunctions) {
      try {
        const deleted = this.deleteFunctionFromSource(sourceFile, func, options);
        if (deleted) {
          deletedCount++;
          
          if (this.verbose) {
            console.log(chalk.yellow(`  - Deleted: ${func.displayName} (${func.startLine}:${func.startColumn})`));
          }
        }
      } catch (error) {
        const errorMsg = `Failed to delete ${func.displayName}: ${error instanceof Error ? error.message : String(error)}`;
        
        if (this.verbose) {
          console.warn(chalk.yellow(`  ! ${errorMsg}`));
        }
      }
    }

    // Save file if not in dry-run mode and functions were deleted
    if (!options.dryRun && deletedCount > 0) {
      if (options.backupFiles) {
        // Create backup before saving (use real FS path and persist)
        const backupPath = `${fsPath}.backup.${Date.now()}`;
        const backupFile = sourceFile.copy(backupPath, { overwrite: true });
        await backupFile.save();

        if (this.verbose) {
          console.log(chalk.blue(`  📄 Backup created: ${backupPath}`));
        }
      }
      
      // Format the file to clean up any extra whitespace or formatting issues
      try {
        sourceFile.formatText();
        
        if (this.verbose) {
          console.log(chalk.gray(`  🎨 Formatted file after deletion`));
        }
      } catch {
        // Formatting is nice-to-have, don't fail if it doesn't work
        if (this.verbose) {
          console.warn(chalk.yellow(`  ⚠ Could not format file after deletion`));
        }
      }
      
      await sourceFile.save();
    }

    return deletedCount;
  }

  /**
   * Delete a specific function from source file
   */
  private deleteFunctionFromSource(
    sourceFile: SourceFile, 
    func: FunctionInfo, 
    options: FunctionDeletionOptions
  ): boolean {
    // Try different node types based on function type
    const candidates = this.findFunctionNode(sourceFile, func);

    for (const node of candidates) {
      if (this.matchesFunction(node, func)) {
        // Remove leading JSDoc comments if not skipped
        if (!options.skipJsDoc) {
          this.removeLeadingJsDoc(node);
        }

        // Remove the function node
        if ('remove' in node && typeof (node as { remove(): void }).remove === 'function') {
          (node as { remove(): void }).remove();
        }
        return true;
      }
    }

    if (this.verbose) {
      console.warn(chalk.yellow(`  ⚠ Function not found by AST: ${func.displayName} at ${func.startLine}:${func.startColumn}`));
    }

    return false;
  }

  /**
   * Find potential function nodes in source file (optimized approach)
   */
  private findFunctionNode(sourceFile: SourceFile, func: FunctionInfo) {
    const nodes: Node[] = [];

    // First: Try targeted search by function type and name (more efficient)
    const targetedCandidates = this.getTargetedFunctionCandidates(sourceFile, func);
    
    // Filter by position for exact match
    for (const candidate of targetedCandidates) {
      const start = candidate.getStartLineNumber();
      const end = candidate.getEndLineNumber();
      
      // Check for exact position match first
      if (start === func.startLine && end === func.endLine) {
        nodes.push(candidate);
        break; // Exact match found, no need to continue
      }
      
      // Check for position with small tolerance (±1 line)
      if (Math.abs(start - func.startLine) <= 1 && Math.abs(end - func.endLine) <= 1) {
        nodes.push(candidate);
      }
    }

    // Fallback: Broader search if targeted search failed
    if (nodes.length === 0) {
      const allNodes = sourceFile.getDescendants().filter(node => 
        node.getKind() === SyntaxKind.FunctionDeclaration ||
        node.getKind() === SyntaxKind.MethodDeclaration ||
        node.getKind() === SyntaxKind.VariableDeclaration
      );
      
      for (const node of allNodes) {
        const start = node.getStartLineNumber();
        const end = node.getEndLineNumber();
        
        // Check if position matches (with some tolerance)
        if (start <= func.startLine && end >= func.endLine) {
          nodes.push(node);
        }
      }
    }

    return nodes;
  }

  /**
   * Get targeted function candidates based on function type and name
   */
  private getTargetedFunctionCandidates(sourceFile: SourceFile, func: FunctionInfo): Node[] {
    const candidates: Node[] = [];

    // Function declarations
    const functions = sourceFile.getFunctions();
    for (const f of functions) {
      if (f.getName() === func.name) {
        candidates.push(f);
      }
    }
    
    // Method declarations (including constructors)
    const classes = sourceFile.getClasses();
    for (const cls of classes) {
      // Regular methods
      const methods = cls.getMethods();
      for (const method of methods) {
        if (method.getName() === func.name) {
          candidates.push(method);
        }
      }
      
      // Constructors
      const constructors = cls.getConstructors();
      for (const constructor of constructors) {
        if (func.name === 'constructor') {
          candidates.push(constructor);
        }
      }
      
      // Getters and setters
      const getters = cls.getGetAccessors();
      for (const getter of getters) {
        if (getter.getName() === func.name) {
          candidates.push(getter);
        }
      }
      
      const setters = cls.getSetAccessors();
      for (const setter of setters) {
        if (setter.getName() === func.name) {
          candidates.push(setter);
        }
      }
    }
    
    // Interface methods
    const interfaces = sourceFile.getInterfaces();
    for (const iface of interfaces) {
      const methods = iface.getMethods();
      for (const method of methods) {
        if (method.getName() === func.name) {
          candidates.push(method);
        }
      }
    }
    
    // Variable function expressions and arrow functions
    const variables = sourceFile.getVariableDeclarations();
    for (const variable of variables) {
      if (variable.getName() === func.name) {
        const initializer = variable.getInitializer();
        if (initializer && (
          initializer.getKind() === SyntaxKind.FunctionExpression ||
          initializer.getKind() === SyntaxKind.ArrowFunction
        )) {
          candidates.push(variable);
        }
      }
    }

    return candidates;
  }

  /**
   * Check if a node matches the function info
   */
  private matchesFunction(node: Node, func: FunctionInfo): boolean {
    const nodeStart = node.getStartLineNumber();
    const nodeEnd = node.getEndLineNumber();
    
    // Primary match: position
    const positionMatch = nodeStart === func.startLine && nodeEnd === func.endLine;
    
    if (positionMatch) {
      return true;
    }

    // Secondary match: name and approximate position (within 2 lines)
    const nameMatch = this.getNodeName(node) === func.name;
    const approximatePositionMatch = Math.abs(nodeStart - func.startLine) <= 2;
    
    return nameMatch && approximatePositionMatch;
  }

  /**
   * Get name from different node types
   */
  private getNodeName(node: Node): string | undefined {
    // Type-safe check for nodes with getName method
    if ('getName' in node && typeof (node as { getName(): string }).getName === 'function') {
      return (node as { getName(): string }).getName();
    }
    
    if (node.getKind() === SyntaxKind.VariableDeclaration) {
      return (node as VariableDeclaration).getName();
    }
    
    return undefined;
  }

  /**
   * Remove leading JSDoc comments using ts-morph high-level APIs
   */
  private removeLeadingJsDoc(node: Node): void {
    try {
      // ts-morph's high-level approach: get JSDoc nodes and remove them
      if ('getJsDocs' in node && typeof (node as { getJsDocs(): Array<{ remove(): void }> }).getJsDocs === 'function') {
        const jsDocs = (node as { getJsDocs(): Array<{ remove(): void }> }).getJsDocs();
        
        // Remove all JSDoc comments associated with this node
        for (const jsDoc of jsDocs) {
          jsDoc.remove();
        }
        
        if (this.verbose && jsDocs.length > 0) {
          console.log(chalk.gray(`    📄 Removed ${jsDocs.length} JSDoc comment(s)`));
        }
      }
      
      // Fallback: check for leading comments manually (for nodes without getJsDocs)
      else if ('getLeadingCommentRanges' in node && typeof (node as { getLeadingCommentRanges(): unknown[] }).getLeadingCommentRanges === 'function') {
        const leadingComments = (node as { getLeadingCommentRanges(): Array<{ getPos(): number; getEnd(): number }> }).getLeadingCommentRanges();
        
        for (const comment of leadingComments) {
          const commentText = node.getSourceFile().getFullText().slice(comment.getPos(), comment.getEnd());
          
          // Check if it's a JSDoc comment
          if (commentText.trim().startsWith('/**')) {
            // Remove the comment by replacing with empty string
            node.getSourceFile().removeText(comment.getPos(), comment.getEnd());
          }
        }
      }
    } catch {
      // Ignore JSDoc removal errors - not critical
      if (this.verbose) {
        console.warn(chalk.yellow(`  ⚠ Could not remove JSDoc for function`));
      }
    }
  }

  /**
   * Get project statistics
   */
  getProjectStats() {
    return {
      sourceFiles: this.project.getSourceFiles().length,
      filesInMemory: this.project.getSourceFiles().length,
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    // ts-morph doesn't require explicit cleanup, but we can clear the project
    this.project = new Project();
  }
}

/**
 * Utility function to create a deleter and delete functions in one call
 */
export async function deleteFunctionsSafely(
  functions: FunctionInfo[],
  options: FunctionDeletionOptions & { tsConfigPath?: string } = {}
): Promise<DeletionResult> {
  const deleterOptions: { tsConfigPath?: string; verbose?: boolean } = {};
  
  if (options.tsConfigPath) {
    deleterOptions.tsConfigPath = options.tsConfigPath;
  }
  if (options.verbose !== undefined) {
    deleterOptions.verbose = options.verbose;
  }
  
  const deleter = new SafeFunctionDeleter(deleterOptions);

  try {
    return await deleter.deleteFunctions(functions, options);
  } finally {
    deleter.dispose();
  }
}

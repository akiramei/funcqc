import * as ts from 'typescript';

/**
 * Finds a function node in the TypeScript AST by name
 * 
 * This utility function searches through a TypeScript source file to find
 * a function node matching the given name. It handles various function types:
 * - Function declarations
 * - Arrow functions assigned to variables 
 * - Method declarations
 * - Constructor declarations
 * 
 * @param sourceFile - The TypeScript source file to search
 * @param functionName - The name of the function to find
 * @returns The matching function node, or undefined if not found
 */
export function findFunctionNode(
  sourceFile: ts.SourceFile, 
  functionName: string
): ts.Node | undefined {
  let result: ts.Node | undefined;

  const visit = (node: ts.Node): void => {
    // Function declaration
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      result = node;
      return;
    }
    
    // Arrow function assigned to variable
    if (
      ts.isVariableDeclaration(node) &&
      node.name.kind === ts.SyntaxKind.Identifier &&
      (node.name as ts.Identifier).text === functionName &&
      node.initializer &&
      ts.isArrowFunction(node.initializer)
    ) {
      result = node.initializer;
      return;
    }
    
    // Method declaration
    if (
      ts.isMethodDeclaration(node) &&
      node.name?.kind === ts.SyntaxKind.Identifier &&
      (node.name as ts.Identifier).text === functionName
    ) {
      result = node;
      return;
    }
    
    // Constructor
    if (ts.isConstructorDeclaration(node) && functionName === 'constructor') {
      result = node;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return result;
}
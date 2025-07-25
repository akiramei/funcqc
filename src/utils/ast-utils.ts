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
function matchesFunctionDeclaration(node: ts.Node, functionName: string): boolean {
  return ts.isFunctionDeclaration(node) && node.name?.text === functionName;
}

function matchesArrowFunctionVariable(node: ts.Node, functionName: string): boolean {
  return (
    ts.isVariableDeclaration(node) &&
    node.name.kind === ts.SyntaxKind.Identifier &&
    (node.name as ts.Identifier).text === functionName &&
    !!node.initializer &&
    ts.isArrowFunction(node.initializer)
  );
}

function matchesMethodDeclaration(node: ts.Node, functionName: string): boolean {
  return (
    ts.isMethodDeclaration(node) &&
    node.name?.kind === ts.SyntaxKind.Identifier &&
    (node.name as ts.Identifier).text === functionName
  );
}

function matchesConstructor(node: ts.Node, functionName: string): boolean {
  return ts.isConstructorDeclaration(node) && functionName === 'constructor';
}

function getNodeForMatch(node: ts.Node, functionName: string): ts.Node | undefined {
  if (matchesFunctionDeclaration(node, functionName)) {
    return node;
  }
  
  if (matchesArrowFunctionVariable(node, functionName)) {
    return (node as ts.VariableDeclaration).initializer;
  }
  
  if (matchesMethodDeclaration(node, functionName)) {
    return node;
  }
  
  if (matchesConstructor(node, functionName)) {
    return node;
  }
  
  return undefined;
}

export function findFunctionNode(
  sourceFile: ts.SourceFile, 
  functionName: string
): ts.Node | undefined {
  let result: ts.Node | undefined;

  const visit = (node: ts.Node): void => {
    const match = getNodeForMatch(node, functionName);
    if (match) {
      result = match;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return result;
}
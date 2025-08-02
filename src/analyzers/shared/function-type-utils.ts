import { FunctionDeclaration, MethodDeclaration, ArrowFunction, FunctionExpression, ConstructorDeclaration, Node } from 'ts-morph';

/**
 * Determine function type based on node type and context
 * 
 * @param node - AST node representing a function
 * @returns Function type classification
 */
export function determineFunctionType(
  node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration
): 'function' | 'method' | 'arrow' | 'local' {
  if (Node.isMethodDeclaration(node) || Node.isConstructorDeclaration(node)) {
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
      Node.isArrowFunction(parent) ||
      Node.isFunctionExpression(parent)
    ) {
      return 'local';
    }
    const nextParent = parent.getParent();
    if (!nextParent) break;
    parent = nextParent;
  }
  return 'function';
}
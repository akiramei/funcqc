import {
  Node, SyntaxKind, CallExpression, FunctionDeclaration, MethodDeclaration,
  ArrowFunction, FunctionExpression, ConstructorDeclaration
} from "ts-morph";

type FnNode = FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | ConstructorDeclaration;

export interface PassthroughAnalysisAST {
  paramForwardingRatio: number;      // 0..1
  returnsCalleeResult: boolean;
  hasSideEffectsNearby: boolean;
  singlePrimaryCallee: boolean;
  primaryCalleeName?: string;
}

const SIDE_EFFECT_HINTS = ["log", "logger", "metrics", "audit", "track", "report", "telemetry", "console", "process"];

export function analyzePassthroughAST(fn: FnNode): PassthroughAnalysisAST {
  const body = fn.getBody();
  if (!body) {
    return {
      paramForwardingRatio: 0,
      returnsCalleeResult: false,
      hasSideEffectsNearby: false,
      singlePrimaryCallee: false
    };
  }

  const params = fn.getParameters().map(p => p.getName());
  const calls = body.getDescendantsOfKind(SyntaxKind.CallExpression);

  // Primary callee selection (most frequent or single)
  const byName = new Map<string, CallExpression[]>();
  for (const call of calls) {
    const name = getCalleeName(call);
    if (!name) continue;
    const bucket = byName.get(name) ?? [];
    bucket.push(call);
    byName.set(name, bucket);
  }
  
  const sorted = [...byName.entries()].sort((a, b) => b[1].length - a[1].length);
  const primary = sorted[0]?.[1] ?? [];
  const primaryName = sorted[0]?.[0];
  const singlePrimaryCallee = byName.size === 1;

  // Parameter forwarding ratio (representative call from primary group)
  const rep = primary[0];
  const paramForwardingRatio = rep ? computeForwardingRatio(rep, params) : 0;

  // Returns callee result directly
  const returnsCalleeResult = rep ? isDirectReturnOfCall(rep) : false;

  // Side effects nearby (other calls with suspicious names)
  const hasSideEffectsNearby = calls.some(c => {
    if (primary.includes(c)) return false;
    const n = getCalleeName(c)?.toLowerCase() ?? "";
    return SIDE_EFFECT_HINTS.some(h => n.includes(h));
  });

  return {
    paramForwardingRatio,
    returnsCalleeResult,
    hasSideEffectsNearby,
    singlePrimaryCallee,
    primaryCalleeName: primaryName
  };
}

function getCalleeName(call: CallExpression): string | undefined {
  const expr = call.getExpression();
  if (Node.isIdentifier(expr)) return expr.getText();
  if (Node.isPropertyAccessExpression(expr)) return expr.getName();
  return undefined;
}

function computeForwardingRatio(call: CallExpression, formalParams: string[]): number {
  const args = call.getArguments();
  if (formalParams.length === 0) return 1; // No params = 100% forwarding
  
  let forwarded = 0;

  for (const arg of args) {
    // Consider as pass-through
    if (Node.isIdentifier(arg) && formalParams.includes(arg.getText())) {
      forwarded++;
      continue;
    }
    if (arg.getKind() === SyntaxKind.SpreadElement) {
      // ...args case
      forwarded += 1; // Rough scoring (could be weighted by param count)
      continue;
    }
    // Other cases (transformations) don't add points
  }
  
  return Math.max(0, Math.min(1, forwarded / Math.max(1, formalParams.length)));
}

function isDirectReturnOfCall(call: CallExpression): boolean {
  const parent = call.getParent();
  if (Node.isReturnStatement(parent)) return true;
  // Simple wrapping like `const v = callee(...); return v;` not caught here (keeping R2 strict)
  return false;
}

/**
 * Score R2 based on AST analysis
 */
export function scoreR2AST(ast: PassthroughAnalysisAST): number {
  if (!ast.singlePrimaryCallee) return 0; // Not a thin wrapper if multiple callees
  if (ast.hasSideEffectsNearby) return 0; // Side effects invalidate wrapper status

  // Base score from parameter forwarding ratio
  const base = ast.paramForwardingRatio;
  
  // Bonus for direct return
  const bonus = ast.returnsCalleeResult ? 0.2 : 0;
  
  return Math.min(1, base + bonus); // 0..1 (probability interpretation)
}
import {
  Node, SourceFile, CallExpression, PropertyAccessExpression,
  TypeChecker, Symbol as TsSymbol
} from "ts-morph";

// Confidence scores for different resolution paths
const CONFIDENCE_SCORES = {
  EXTERNAL_IMPORT: 1.0,         // Explicit import with known module
  DIRECT_SYMBOL: 1.0,           // Direct identifier resolved via TypeChecker
  INTERNAL_IMPORT: 0.9,         // Internal module via import
  THIS_METHOD: 0.9,             // this.method() calls
  FALLBACK_DECLARATION: 0.8,    // Local function found via fallback mechanism
  PROPERTY_SYMBOL: 0.8,         // Property access resolved via symbol
  UNKNOWN_PROPERTY: 0.3,        // Unresolved property access
  UNKNOWN_IDENTIFIER: 0.2,      // Unresolved identifier
} as const;

/**
 * 呼び出し解決結果（callee）の表現。
 * - internal: プロジェクト内の関数（FunctionIndexで一意に識別できる）
 * - external: Nodeコア/外部パッケージ/グローバル（console等）
 * - unknown : 解決不能（低信頼）
 */
export type CalleeResolution =
  | { kind: "internal"; functionId: string; confidence: number; via: "symbol" | "this" | "fallback" }
  | { kind: "external"; module: string; member: string; id: string; confidence: number }
  | { kind: "unknown"; raw: string; confidence: number };

export interface ResolverContext {
  sourceFile: SourceFile;
  typeChecker: TypeChecker;
  /** 関数ノード(宣言) → 内部IDの逆引き。既存 FunctionIndex から供給してください。*/
  getFunctionIdByDeclaration: (decl: Node) => string | undefined;
  /** import alias → module specifier の索引 */
  importIndex?: Map<string, { module: string; kind: "namespace" | "named" | "default" | "require" }>;
  /** 内部モジュールとみなすパス接頭辞（例: ["src/", "@/"]）。相対("./", "../")は常に内部扱い。*/
  internalModulePrefixes?: string[];
}

type ImportRecord = { module: string; kind: "namespace" | "named" | "default" | "require" };

/**
 * Process ES Module import statements
 */
function processESModuleImports(sf: SourceFile, map: Map<string, ImportRecord>): void {
  for (const imp of sf.getImportDeclarations()) {
    const mod = imp.getModuleSpecifierValue();
    
    // import * as name from 'module'
    const ns = imp.getNamespaceImport();
    if (ns) {
      map.set(ns.getText(), { module: mod, kind: "namespace" });
    }
    
    // import name from 'module'
    const def = imp.getDefaultImport();
    if (def) {
      map.set(def.getText(), { module: mod, kind: "default" });
    }
    
    // import { name1, name2 as alias } from 'module'
    for (const n of imp.getNamedImports()) {
      const name = n.getAliasNode()?.getText() ?? n.getNameNode().getText();
      map.set(name, { module: mod, kind: "named" });
    }
  }
}

/**
 * Process TypeScript import = require() statements
 */
function processTypeScriptImports(sf: SourceFile, map: Map<string, ImportRecord>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const importEqualsDeclarations = (sf as any).getImportEqualsDeclarations?.() || [];
    for (const ie of importEqualsDeclarations) {
      const ref = ie.getModuleReference();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = (ref as any)?.getExpression?.()?.getText?.()?.replace?.(/^['"]|['"]$/g, "");
      const name = ie.getNameNode().getText();
      if (mod && name) {
        map.set(name, { module: mod, kind: "require" });
      }
    }
  } catch (error) {
    // ImportEqualsDeclarations API not available in this ts-morph version
    // This is expected for older versions and can be safely ignored
    if (process.env['NODE_ENV'] === 'development') {
      console.debug('TypeScript import=require parsing not available:', error);
    }
  }
}

/**
 * Process CommonJS require() patterns
 */
function processCommonJSImports(sf: SourceFile, map: Map<string, ImportRecord>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const variableDeclarations = (sf as any).getVariableDeclarations?.() || [];
    for (const v of variableDeclarations) {
      processRequireDeclaration(v, map);
    }
  } catch (error) {
    // VariableDeclarations API not available in this ts-morph version
    if (process.env['NODE_ENV'] === 'development') {
      console.debug('CommonJS require parsing not available:', error);
    }
  }
}

/**
 * Process a single variable declaration that might contain require()
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processRequireDeclaration(v: any, map: Map<string, ImportRecord>): void {
  const init = v.getInitializer();
  if (!init) return;
  
  // const X = require('mod')
  if (init.getKindName() === "CallExpression") {
    processDirectRequire(v, init, map);
  }
  
  // const x = require('mod').resolve
  if (init.getKindName() === "PropertyAccessExpression") {
    processPropertyRequire(v, init, map);
  }
}

/**
 * Process direct require: const X = require('mod')
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processDirectRequire(v: any, init: any, map: Map<string, ImportRecord>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callee = (init as any).getExpression().getText();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args = (init as any).getArguments?.();
  const arg0 = args?.[0]?.getText?.()?.replace?.(/^['"]|['"]$/g, "");
  
  if (callee === "require" && typeof arg0 === "string" && arg0.length > 0) {
    const nameNode = v.getNameNode();
    if (nameNode.getKindName() === "Identifier") {
      // const path = require('path')
      map.set(nameNode.getText(), { module: arg0, kind: "namespace" });
    } else if (nameNode.getKindName() === "ObjectBindingPattern") {
      // const { resolve, join: pathJoin } = require('path')
      processDestructuringRequire(nameNode, arg0, map);
    }
  }
}

/**
 * Process destructuring require: const { resolve } = require('path')
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processDestructuringRequire(nameNode: any, module: string, map: Map<string, ImportRecord>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const be of (nameNode as any).getElements()) {
      const alias = be.getNameNode().getText();
      map.set(alias, { module, kind: "named" });
    }
  } catch (error) {
    if (process.env['NODE_ENV'] === 'development') {
      console.debug('Failed to process destructuring require:', error);
    }
  }
}

/**
 * Process property access require: const x = require('mod').resolve
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processPropertyRequire(v: any, init: any, map: Map<string, ImportRecord>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const left = (init as any).getExpression();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const name = (init as any).getNameNode().getText?.();
  
  if (left?.getKindName?.() === "CallExpression" &&
      left.getExpression().getText() === "require") {
    const args = left.getArguments?.();
    const arg0 = args?.[0]?.getText?.()?.replace?.(/^['"]|['"]$/g, "");
    const alias = v.getNameNode().getText();
    if (arg0 && alias && name) {
      map.set(alias, { module: arg0, kind: "named" });
    }
  }
}

/**
 * import索引を構築（ES Modules、CommonJS、TypeScript互換の全取り込みパターンに対応）
 */
export function buildImportIndex(sf: SourceFile): Map<string, ImportRecord> {
  const map = new Map<string, ImportRecord>();
  
  processESModuleImports(sf, map);
  processTypeScriptImports(sf, map);
  processCommonJSImports(sf, map);
  
  return map;
}

/**
 * 外部モジュールか？（"./" 以外、かつ内部接頭辞に該当しないものを外部とみなす）
 */
function isExternalModule(module: string, internalPrefixes: string[] = []): boolean {
  if (module.startsWith("./") || module.startsWith("../") || module.startsWith("/")) return false;
  return !internalPrefixes.some(p => module.startsWith(p));
}

// Extensible set of known Node.js global objects
const GLOBAL_OBJECTS = new Set([
  'console', 'process', 'Buffer', 'global',
  'setTimeout', 'setInterval', 'setImmediate',
  'clearTimeout', 'clearInterval', 'clearImmediate',
]);

/**
 * console / globalThis / process など「グローバルに見える外部」のラベル化
 */
function classifyGlobalLike(exprText: string): { module: string; member: string } | undefined {
  const parts = exprText.split(".");
  if (parts.length >= 2 && GLOBAL_OBJECTS.has(parts[0])) {
    return { module: parts[0], member: parts[1] ?? "<unknown>" };
  }
  return undefined;
}

/**
 * PropertyAccess の左辺が import alias のとき、モジュール名を返す
 */
function resolveLeftModuleFromImports(
  left: Node,
  ctx: ResolverContext
): { module: string } | undefined {
  if (Node.isIdentifier(left) && ctx.importIndex?.has(left.getText())) {
    const rec = ctx.importIndex.get(left.getText());
    if (rec) {
      return { module: rec.module };
    }
  }
  return undefined;
}

/**
 * シンボルが関数宣言/メソッド/関数式を指しているか判定し、内部IDに解決
 */
function tryResolveInternalBySymbol(sym: TsSymbol | undefined, ctx: ResolverContext):
  { functionId?: string; decl?: Node } {
  if (!sym) return {};
  for (const d of sym.getDeclarations() ?? []) {
    // 関数/メソッド/コンストラクタ/関数式・アロー関数に対応
    if (
      Node.isFunctionDeclaration(d) ||
      Node.isMethodDeclaration(d) ||
      Node.isConstructorDeclaration(d) ||
      Node.isFunctionExpression(d) ||
      Node.isArrowFunction(d)
    ) {
      const id = ctx.getFunctionIdByDeclaration(d);
      
      if (id) return { functionId: id, decl: d };
    }
  }
  return {};
}

/**
 * this.foo() → 同一クラス内メソッド解決（保守的に）
 */
function tryResolveThisMethod(pa: PropertyAccessExpression, ctx: ResolverContext):
  { functionId?: string } {
  const left = pa.getExpression();
  if (left.getKindName() !== "ThisKeyword") return {};
  const name = pa.getNameNode().getText();
  // `this` の型からメンバシンボルを取得
  const t = left.getType();
  const prop = t.getProperty(name);
  if (!prop) return {};
  const { functionId } = tryResolveInternalBySymbol(prop, ctx);
  return functionId ? { functionId } : {};
}

/**
 * CallExpression から callee を解決。
 * - 完全修飾（import alias 経由）を最優先
 * - this メソッド → 同一クラス内
 * - 素の identifier → 直接シンボル解決
 * - 解決不可は unknown（低信頼）
 */
export function resolveCallee(call: CallExpression, ctx: ResolverContext): CalleeResolution {
  const expr = call.getExpression();
  const internalPrefixes = ctx.internalModulePrefixes ?? ["src/", "@/", "#/"];

  // console.log / process.env 等の明示的グローバル
  const globalLike = classifyGlobalLike(expr.getText());
  if (globalLike) {
    const id = `external:${globalLike.module}:${globalLike.member}`;
    return { kind: "external", module: globalLike.module, member: globalLike.member, id, confidence: CONFIDENCE_SCORES.EXTERNAL_IMPORT };
  }

  // obj.method(...) 形式
  if (Node.isPropertyAccessExpression(expr)) {
    const left = expr.getExpression();
    const name = expr.getNameNode().getText();

    // import alias 経由（例: path.resolve, crypto.createHash）
    const modViaImport = resolveLeftModuleFromImports(left, ctx);
    if (modViaImport) {
      const external = isExternalModule(modViaImport.module, internalPrefixes);
      if (external) {
        const id = `external:${modViaImport.module}:${name}`;
        return { kind: "external", module: modViaImport.module, member: name, id, confidence: CONFIDENCE_SCORES.EXTERNAL_IMPORT };
      }
      // 内部モジュール由来だが import/alias が確認できた場合のみ、内部解決を試みる
      const sym = ctx.typeChecker.getSymbolAtLocation(expr.getNameNode());
      const { functionId } = tryResolveInternalBySymbol(sym, ctx);
      if (functionId) {
        return { kind: "internal", functionId, confidence: CONFIDENCE_SCORES.INTERNAL_IMPORT, via: "symbol" };
      }
      // import/alias 解釈はできたが内部IDに落ちない場合、外部とは断定できないため unknown で返す
      return { kind: "unknown", raw: expr.getText(), confidence: CONFIDENCE_SCORES.UNKNOWN_PROPERTY };
    }

    // this.method(...) → 同一クラス内優先
    const thisRes = tryResolveThisMethod(expr, ctx);
    if (thisRes.functionId) {
      return { kind: "internal", functionId: thisRes.functionId, confidence: CONFIDENCE_SCORES.THIS_METHOD, via: "this" };
    }

    // 左辺の実体から解決（プロパティシンボル）
    const sym = ctx.typeChecker.getSymbolAtLocation(expr.getNameNode());
    const { functionId } = tryResolveInternalBySymbol(sym, ctx);
    if (functionId) {
      return { kind: "internal", functionId, confidence: CONFIDENCE_SCORES.PROPERTY_SYMBOL, via: "symbol" };
    }

    // 解決不能: 外部の可能性もあるが証拠不足 → unknown
    return { kind: "unknown", raw: expr.getText(), confidence: CONFIDENCE_SCORES.UNKNOWN_PROPERTY };
  }

  // 素の識別子 foo(...)
  if (Node.isIdentifier(expr)) {
    const sym = ctx.typeChecker.getSymbolAtLocation(expr);
    const { functionId } = tryResolveInternalBySymbol(sym, ctx);
    if (functionId) {
      return { kind: "internal", functionId, confidence: CONFIDENCE_SCORES.DIRECT_SYMBOL, via: "symbol" };
    }
    
    
    // Fallback: Try to find matching function declarations by name in the same source file
    // This handles cases where TypeScript symbol resolution fails but we have local declarations
    if (!sym) {
      const functionName = expr.getText();
      const sourceFile = expr.getSourceFile();
      
      // Find all function declarations with matching name in the same file
      const matchingDeclarations: Node[] = [];
      sourceFile.forEachDescendant(node => {
        if (Node.isFunctionDeclaration(node) && node.getName() === functionName) {
          matchingDeclarations.push(node);
        }
      });
      
      // Try to resolve using our fallback mechanism
      for (const decl of matchingDeclarations) {
        const fallbackId = ctx.getFunctionIdByDeclaration(decl);
        if (fallbackId) {
          return { kind: "internal", functionId: fallbackId, confidence: CONFIDENCE_SCORES.FALLBACK_DECLARATION, via: "fallback" };
        }
      }
    }
    
    // import default/named による関数呼び出し（外部）判定
    const alias = ctx.importIndex?.get(expr.getText());
    if (alias && isExternalModule(alias.module, internalPrefixes)) {
      const id = `external:${alias.module}:${expr.getText()}`;
      return { kind: "external", module: alias.module, member: expr.getText(), id, confidence: CONFIDENCE_SCORES.EXTERNAL_IMPORT };
    }
    return { kind: "unknown", raw: expr.getText(), confidence: CONFIDENCE_SCORES.UNKNOWN_IDENTIFIER };
  }

  // その他（ElementAccessExpression 等）は保守的に unknown
  return { kind: "unknown", raw: expr.getText(), confidence: CONFIDENCE_SCORES.UNKNOWN_IDENTIFIER };
}
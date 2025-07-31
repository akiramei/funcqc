import {
  Node, SourceFile, CallExpression, PropertyAccessExpression,
  TypeChecker, Symbol as TsSymbol
} from "ts-morph";

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

/**
 * import索引を構築（ES Modules、CommonJS、TypeScript互換の全取り込みパターンに対応）
 */
export function buildImportIndex(
  sf: SourceFile
): Map<string, { module: string; kind: "namespace" | "named" | "default" | "require" }> {
  const map = new Map<string, { module: string; kind: "namespace" | "named" | "default" | "require" }>();
  
  // ES Modules: import statements
  for (const imp of sf.getImportDeclarations()) {
    const mod = imp.getModuleSpecifierValue();
    const ns = imp.getNamespaceImport();
    if (ns) {
      map.set(ns.getText(), { module: mod, kind: "namespace" });
    }
    const def = imp.getDefaultImport();
    if (def) {
      map.set(def.getText(), { module: mod, kind: "default" });
    }
    for (const n of imp.getNamedImports()) {
      const name = n.getAliasNode()?.getText() ?? n.getNameNode().getText();
      map.set(name, { module: mod, kind: "named" });
    }
  }

  // TypeScript: import = require() statements (if available)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const importEqualsDeclarations = (sf as any).getImportEqualsDeclarations?.() || [];
    for (const ie of importEqualsDeclarations) {
      const ref = ie.getModuleReference();
      // ExternalModuleReference with string literal
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = (ref as any)?.getExpression?.()?.getText?.()?.replace?.(/^['"]|['"]$/g, "");
      const name = ie.getNameNode().getText();
      if (mod && name) {
        map.set(name, { module: mod, kind: "namespace" });
      }
    }
  } catch {
    // ImportEqualsDeclarations not available in this ts-morph version
  }

  // CommonJS: require() patterns (if available)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const variableDeclarations = (sf as any).getVariableDeclarations?.() || [];
    for (const v of variableDeclarations) {
      const init = v.getInitializer();
      if (!init) continue;
      
      // const X = require('mod')
      if (init.getKindName() === "CallExpression") {
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const be of (nameNode as any).getElements()) {
              const alias = be.getNameNode().getText();
              map.set(alias, { module: arg0, kind: "named" });
            }
          }
        }
      }
      
      // const x = require('mod').resolve
      if (init.getKindName() === "PropertyAccessExpression") {
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
    }
  } catch {
    // VariableDeclarations API not available in this ts-morph version
  }
  
  return map;
}

/**
 * 外部モジュールか？（"./" 以外、かつ内部接頭辞に該当しないものを外部とみなす）
 */
function isExternalModule(module: string, internalPrefixes: string[] = []): boolean {
  if (module.startsWith("./") || module.startsWith("../") || module.startsWith("/")) return false;
  return !internalPrefixes.some(p => module.startsWith(p));
}

/**
 * console / globalThis / process など「グローバルに見える外部」のラベル化
 */
function classifyGlobalLike(exprText: string): { module: string; member: string } | undefined {
  if (exprText.startsWith("console.")) {
    return { module: "console", member: exprText.split(".")[1] ?? "<unknown>" };
  }
  if (exprText.startsWith("process.")) {
    return { module: "process", member: exprText.split(".")[1] ?? "<unknown>" };
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
    return { kind: "external", module: globalLike.module, member: globalLike.member, id, confidence: 1.0 };
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
        return { kind: "external", module: modViaImport.module, member: name, id, confidence: 1.0 };
      }
      // 内部モジュール由来だが import/alias が確認できた場合のみ、内部解決を試みる
      const sym = ctx.typeChecker.getSymbolAtLocation(expr.getNameNode());
      const { functionId } = tryResolveInternalBySymbol(sym, ctx);
      if (functionId) {
        return { kind: "internal", functionId, confidence: 0.9, via: "symbol" };
      }
      // import/alias 解釈はできたが内部IDに落ちない場合、外部とは断定できないため unknown で返す
      return { kind: "unknown", raw: expr.getText(), confidence: 0.4 };
    }

    // this.method(...) → 同一クラス内優先
    const thisRes = tryResolveThisMethod(expr, ctx);
    if (thisRes.functionId) {
      return { kind: "internal", functionId: thisRes.functionId, confidence: 0.9, via: "this" };
    }

    // 左辺の実体から解決（プロパティシンボル）
    const sym = ctx.typeChecker.getSymbolAtLocation(expr.getNameNode());
    const { functionId } = tryResolveInternalBySymbol(sym, ctx);
    if (functionId) {
      return { kind: "internal", functionId, confidence: 0.8, via: "symbol" };
    }

    // 解決不能: 外部の可能性もあるが証拠不足 → unknown
    return { kind: "unknown", raw: expr.getText(), confidence: 0.3 };
  }

  // 素の識別子 foo(...)
  if (Node.isIdentifier(expr)) {
    const sym = ctx.typeChecker.getSymbolAtLocation(expr);
    const { functionId } = tryResolveInternalBySymbol(sym, ctx);
    if (functionId) {
      return { kind: "internal", functionId, confidence: 1.0, via: "symbol" };
    }
    // import default/named による関数呼び出し（外部）判定
    const alias = ctx.importIndex?.get(expr.getText());
    if (alias && isExternalModule(alias.module, internalPrefixes)) {
      const id = `external:${alias.module}:${expr.getText()}`;
      return { kind: "external", module: alias.module, member: expr.getText(), id, confidence: 1.0 };
    }
    return { kind: "unknown", raw: expr.getText(), confidence: 0.2 };
  }

  // その他（ElementAccessExpression 等）は保守的に unknown
  return { kind: "unknown", raw: expr.getText(), confidence: 0.2 };
}
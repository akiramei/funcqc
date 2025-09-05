import {
  Node, SourceFile, CallExpression, NewExpression, PropertyAccessExpression,
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
  importIndex?: Map<string, ImportRecord>;
  /** 内部モジュールとみなすパス接頭辞（例: ["src/", "@/"]）。相対("./", "../")は常に内部扱い。*/
  internalModulePrefixes?: string[];
  /** Optional: Resolve imported symbol from module specifier and exported name */
  resolveImportedSymbol?: (moduleSpecifier: string, exportedName: string) => Node | undefined;
}

export type ImportRecord = {
  module: string;
  kind: "namespace" | "named" | "default" | "require";
  local: string;      // ローカル名（alias名）
  imported?: string;  // 元のexport名（namedの場合の実名、defaultの場合は"default"）
};

/**
 * Process ES Module import statements
 */
function processESModuleImports(sf: SourceFile, map: Map<string, ImportRecord>): void {
  for (const imp of sf.getImportDeclarations()) {
    const mod = imp.getModuleSpecifierValue();
    
    // import * as name from 'module'
    const ns = imp.getNamespaceImport();
    if (ns) {
      const local = ns.getText();
      map.set(local, { module: mod, kind: "namespace", local });
    }
    
    // import name from 'module'
    const def = imp.getDefaultImport();
    if (def) {
      const local = def.getText();
      map.set(local, { module: mod, kind: "default", local, imported: "default" });
    }
    
    // import { name1, name2 as alias } from 'module'
    for (const n of imp.getNamedImports()) {
      const local = n.getAliasNode()?.getText() ?? n.getNameNode().getText();
      const imported = n.getNameNode().getText(); // 元のexport名
      map.set(local, { module: mod, kind: "named", local, imported });
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
      const local = ie.getNameNode().getText();
      if (mod && local) {
        map.set(local, { module: mod, kind: "require", local });
      }
    }
  } catch {
    // ImportEqualsDeclarations API not available in this ts-morph version
    // This is expected for older versions and can be safely ignored
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
  } catch {
    // VariableDeclarations API not available in this ts-morph version
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
      const local = nameNode.getText();
      map.set(local, { module: arg0, kind: "namespace", local });
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
      const local = be.getNameNode().getText();
      // TODO: For aliased destructuring, we'd need to get the original name too
      map.set(local, { module, kind: "named", local, imported: local });
    }
  } catch {
    // Failed to process destructuring require - this is expected and can be safely ignored
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
    const local = v.getNameNode().getText();
    if (arg0 && local && name) {
      map.set(local, { module: arg0, kind: "named", local, imported: name });
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
  if (!sym) {
    return {};
  }
  
  const declarations = sym.getDeclarations() ?? [];
  
  for (let i = 0; i < declarations.length; i++) {
    const d = declarations[i];
    
    // Check if this is an import-related declaration
    if (Node.isImportSpecifier(d) || Node.isImportClause(d) || Node.isNamespaceImport(d)) {
      // For import declarations, try to resolve to the actual imported symbol
      const aliasedSymbol = ctx.typeChecker.getAliasedSymbol(sym);
      if (aliasedSymbol && aliasedSymbol !== sym) {
        const result = tryResolveInternalBySymbol(aliasedSymbol, ctx);
        if (result.functionId) {
          return result;
        }
      }
    }
    
    // 関数/メソッド/コンストラクタ/関数式・アロー関数、
    // さらに変数宣言の初期化子が関数式/アロー関数のケースにも対応
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

    // 例: export const foo = () => {} / function(){...}
    if (Node.isVariableDeclaration(d)) {
      const init = d.getInitializer();
      if (init && (Node.isFunctionExpression(init) || Node.isArrowFunction(init))) {
        const id = ctx.getFunctionIdByDeclaration(init);
        if (id) return { functionId: id, decl: init };
      }
    }
  }
  // If we still haven't found anything, try getting the aliased symbol as a fallback
  const aliasedSymbol = ctx.typeChecker.getAliasedSymbol(sym);
  if (aliasedSymbol && aliasedSymbol !== sym) {
    const result = tryResolveInternalBySymbol(aliasedSymbol, ctx);
    if (result.functionId) {
      return result;
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
export function resolveCallee(call: CallExpression | NewExpression, ctx: ResolverContext): CalleeResolution {
  const expr = call.getExpression();
  
  // Handle constructor calls (new expressions)
  if (Node.isNewExpression(call)) {
    return resolveNewExpression(call, ctx);
  }
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
    // Fallback: 左辺の型からプロパティシンボルを引く
    try {
      const leftType = ctx.typeChecker.getTypeAtLocation(left);
      const prop = leftType?.getProperty?.(name as string);
      if (prop) {
        const byType = tryResolveInternalBySymbol(prop, ctx);
        if (byType.functionId) {
          return { kind: "internal", functionId: byType.functionId, confidence: CONFIDENCE_SCORES.PROPERTY_SYMBOL, via: "symbol" };
        }
      }
    } catch {
      // ignore
    }

    // 解決不能: 外部の可能性もあるが証拠不足 → unknown
    return { kind: "unknown", raw: expr.getText(), confidence: CONFIDENCE_SCORES.UNKNOWN_PROPERTY };
  }

  // element access 形式: obj['method'](...)
  if (Node.isElementAccessExpression(expr)) {
    const left = expr.getExpression();
    const arg = expr.getArgumentExpression();
    const name = arg && Node.isStringLiteral(arg) ? arg.getLiteralText() : undefined;
    if (left && name) {
      // import alias 経由か、左辺型のプロパティから解決
      const leftNode = left as Node;
      const modViaImport = resolveLeftModuleFromImports(leftNode, ctx);
      if (modViaImport) {
        const external = isExternalModule(modViaImport.module, ctx.internalModulePrefixes ?? []);
        if (!external) {
          // Try symbol on synthetic property name
          const sym = arg ? ctx.typeChecker.getSymbolAtLocation(arg) : undefined;
          const { functionId } = tryResolveInternalBySymbol(sym, ctx);
          if (functionId) {
            return { kind: 'internal', functionId, confidence: CONFIDENCE_SCORES.INTERNAL_IMPORT, via: 'symbol' };
          }
        }
      }
      // Fallback: 左辺の型からプロパティを解決
      try {
        const leftType = ctx.typeChecker.getTypeAtLocation(leftNode);
        const prop = leftType?.getProperty?.(name);
        if (prop) {
          const r = tryResolveInternalBySymbol(prop, ctx);
          if (r.functionId) {
            return { kind: 'internal', functionId: r.functionId, confidence: CONFIDENCE_SCORES.PROPERTY_SYMBOL, via: 'symbol' };
          }
        }
      } catch {
        // ignore
      }
    }
    return { kind: 'unknown', raw: expr.getText(), confidence: CONFIDENCE_SCORES.UNKNOWN_PROPERTY };
  }

  // 素の識別子 foo(...)
  if (Node.isIdentifier(expr)) {
    
    const sym = ctx.typeChecker.getSymbolAtLocation(expr);
    if (sym) {
    } else {
    }
    
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
    
    // import default/named による関数呼び出し判定
    const alias = ctx.importIndex?.get(expr.getText());
    
    if (alias) {
      
      if (isExternalModule(alias.module, internalPrefixes)) {
        // 外部モジュールの場合
        const id = `external:${alias.module}:${expr.getText()}`;
        return { kind: "external", module: alias.module, member: expr.getText(), id, confidence: CONFIDENCE_SCORES.EXTERNAL_IMPORT };
      } else {
        // 内部モジュール（相対インポート）の場合
        // resolveImportedSymbolで宣言ノードを取得を試みる
        if (ctx.resolveImportedSymbol) {
          // CRITICAL FIX: Use imported name (original export name) instead of local name
          const exportedName = alias.kind === "named" || alias.kind === "default" 
            ? ('imported' in alias ? alias.imported : expr.getText())  // Use imported name if available
            : expr.getText(); // For namespace/require, use local name
          
          const declNode = ctx.resolveImportedSymbol(alias.module, String(exportedName));
          
          if (declNode) {
            const functionId = ctx.getFunctionIdByDeclaration(declNode);
            
            if (functionId) {
              return { kind: "internal", functionId, confidence: CONFIDENCE_SCORES.INTERNAL_IMPORT, via: "symbol" };
            }
          } else {
          }
        } else {
        }
        // 解決できない場合はunknownとして扱う
        return { kind: "unknown", raw: expr.getText(), confidence: CONFIDENCE_SCORES.UNKNOWN_IDENTIFIER };
      }
    }
    
    return { kind: "unknown", raw: expr.getText(), confidence: CONFIDENCE_SCORES.UNKNOWN_IDENTIFIER };
  }

  // その他（ElementAccessExpression 等）は保守的に unknown
  return { kind: "unknown", raw: expr.getText(), confidence: CONFIDENCE_SCORES.UNKNOWN_IDENTIFIER };
}

/**
 * Resolve constructor calls (new expressions)
 * Maps new ClassName() to the constructor function
 */
function resolveNewExpression(newExpr: NewExpression, ctx: ResolverContext): CalleeResolution {
  const expr = newExpr.getExpression();
  const internalPrefixes = ctx.internalModulePrefixes ?? ["src/", "@/", "#/"];

  // Handle simple constructor calls: new ClassName()
  if (Node.isIdentifier(expr)) {
    const className = expr.getText();
    
    // Try to resolve via TypeChecker first
    const symbol = ctx.typeChecker.getSymbolAtLocation(expr);
    if (symbol) {
      const declaration = symbol.getDeclarations()?.[0];
      if (declaration && Node.isClassDeclaration(declaration)) {
        // Look for constructor method in the class
        const ctor = declaration.getConstructors()?.[0];
        if (ctor) {
          const constructorId = ctx.getFunctionIdByDeclaration(ctor);
          if (constructorId) {
            return { kind: "internal", functionId: constructorId, confidence: CONFIDENCE_SCORES.DIRECT_SYMBOL, via: "symbol" };
          }
        }
      }
    }

    // Check if this is an imported class
    const alias = ctx.importIndex?.get(className);
    if (alias) {
      if (isExternalModule(alias.module, internalPrefixes)) {
        // External constructor call
        const id = `external:${alias.module}:${className}:constructor`;
        return { kind: "external", module: alias.module, member: `${className}:constructor`, id, confidence: CONFIDENCE_SCORES.EXTERNAL_IMPORT };
      } else {
        // Internal imported class - try to resolve constructor
        if (ctx.resolveImportedSymbol) {
          const exportedName = alias.kind === "named" || alias.kind === "default" 
            ? ('imported' in alias ? alias.imported : className)
            : className;
          
          const declNode = ctx.resolveImportedSymbol(alias.module, String(exportedName));
          if (declNode && Node.isClassDeclaration(declNode)) {
            const ctor = declNode.getConstructors()?.[0];
            if (ctor) {
              const constructorId = ctx.getFunctionIdByDeclaration(ctor);
              if (constructorId) {
                return { kind: "internal", functionId: constructorId, confidence: CONFIDENCE_SCORES.INTERNAL_IMPORT, via: "symbol" };
              }
            }
          }
        }
      }
    }

    // Look for local class declarations in the same file
    const sourceFile = newExpr.getSourceFile();
    const matchingClasses: Node[] = [];
    sourceFile.forEachDescendant(node => {
      if (Node.isClassDeclaration(node) && node.getName() === className) {
        matchingClasses.push(node);
      }
    });

    for (const classNode of matchingClasses) {
      if (Node.isClassDeclaration(classNode)) {
        const ctor = classNode.getConstructors()?.[0];
        if (ctor) {
          const constructorId = ctx.getFunctionIdByDeclaration(ctor);
          if (constructorId) {
            return { kind: "internal", functionId: constructorId, confidence: CONFIDENCE_SCORES.FALLBACK_DECLARATION, via: "fallback" };
          }
        }
      }
    }
  }

  // Handle property access constructor calls: new namespace.ClassName()
  if (Node.isPropertyAccessExpression(expr)) {
    const left = expr.getExpression();
    const className = expr.getNameNode().getText();

    const modViaImport = resolveLeftModuleFromImports(left, ctx);
    if (modViaImport) {
      if (isExternalModule(modViaImport.module, internalPrefixes)) {
        const id = `external:${modViaImport.module}:${className}:constructor`;
        return { kind: "external", module: modViaImport.module, member: `${className}:constructor`, id, confidence: CONFIDENCE_SCORES.EXTERNAL_IMPORT };
      } else if (ctx.resolveImportedSymbol) {
        const declNode = ctx.resolveImportedSymbol(modViaImport.module, className);
        if (declNode && Node.isClassDeclaration(declNode)) {
          const ctorDecl = declNode.getConstructors()?.[0];
          if (ctorDecl) {
            const ctorId = ctx.getFunctionIdByDeclaration(ctorDecl);
            if (ctorId) {
              return { kind: "internal", functionId: ctorId, confidence: CONFIDENCE_SCORES.INTERNAL_IMPORT, via: "symbol" };
            }
          }
        }
      }
    }
  }

  // Unknown constructor call
  return { kind: "unknown", raw: `new ${expr.getText()}()`, confidence: CONFIDENCE_SCORES.UNKNOWN_IDENTIFIER };
}

/**
 * 依存関係の定義と設定
 * 
 * 各依存関係の優先順位、前提条件、説明を定義
 */

import { DependencyType } from '../types/command-protocol';

/**
 * 依存関係のメタデータ定義
 */
export interface DependencyDefinition {
  /** 実行優先順位（小さい数字ほど先に実行） */
  priority: number;
  /** 表示名 */
  name: string;
  /** 説明 */
  description: string;
  /** 前提条件となる依存関係 */
  prerequisites: DependencyType[];
}

/**
 * 依存関係定義テーブル
 * 
 * 優先順位ルール:
 * 1. BASIC (最優先 - 他の全ての前提条件)
 * 2. CALL_GRAPH (BASICに依存)
 * 3. TYPE_SYSTEM (BASICに依存、CALL_GRAPHとは独立)
 * 4. COUPLING (BASICに依存、他とは独立)
 */
export const DEPENDENCY_DEFINITIONS: Record<DependencyType, DependencyDefinition> = {
  BASIC: {
    priority: 1,
    name: "Basic Function Analysis",
    description: "基本的な関数解析（CC、LOC、パラメータ数等）",
    prerequisites: []
  },
  
  CALL_GRAPH: {
    priority: 2,
    name: "Call Graph Analysis", 
    description: "関数間の呼び出し関係解析",
    prerequisites: ["BASIC"]
  },
  
  TYPE_SYSTEM: {
    priority: 3,
    name: "TypeScript Type Analysis",
    description: "TypeScript型システム解析",
    prerequisites: ["BASIC"]
  },
  
  COUPLING: {
    priority: 4,
    name: "Parameter Coupling Analysis",
    description: "パラメータ結合度解析",
    prerequisites: ["BASIC"]
  }
} as const;

/**
 * 依存関係の実行順序を決定するユーティリティ
 */
export class DependencyOrderResolver {
  /**
   * 必要な依存関係を優先順位でソートし、前提条件を含めて実行順序を決定
   */
  static resolveDependencyOrder(required: DependencyType[]): DependencyType[] {
    // 1. 前提条件を含めて展開
    const expanded = this.expandPrerequisites(required);
    
    // 2. 優先順位でソート
    const sorted = expanded.sort((a, b) => 
      DEPENDENCY_DEFINITIONS[a].priority - DEPENDENCY_DEFINITIONS[b].priority
    );
    
    // 3. 重複除去
    return [...new Set(sorted)];
  }
  
  /**
   * 前提条件を再帰的に展開
   */
  private static expandPrerequisites(dependencies: DependencyType[]): DependencyType[] {
    const result = new Set<DependencyType>();
    
    const addWithPrerequisites = (dep: DependencyType) => {
      // 前提条件を先に追加
      const prerequisites = DEPENDENCY_DEFINITIONS[dep].prerequisites;
      prerequisites.forEach(prereq => addWithPrerequisites(prereq));
      
      // 自分自身を追加
      result.add(dep);
    };
    
    dependencies.forEach(dep => addWithPrerequisites(dep));
    return Array.from(result);
  }
  
  /**
   * 依存関係の説明を取得
   */
  static getDependencyDescription(dependency: DependencyType): string {
    return DEPENDENCY_DEFINITIONS[dependency].description;
  }
  
  /**
   * 全ての依存関係を優先順位順で取得
   */
  static getAllDependenciesInOrder(): DependencyType[] {
    return (Object.keys(DEPENDENCY_DEFINITIONS) as DependencyType[])
      .sort((a, b) => DEPENDENCY_DEFINITIONS[a].priority - DEPENDENCY_DEFINITIONS[b].priority);
  }
}
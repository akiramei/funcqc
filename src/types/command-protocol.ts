/**
 * Command Protocol: cli-wrapper と command 間の統一インターフェース
 * 
 * 責務分担:
 * - cli-wrapper: コマンドが実行できる状態を保証する
 * - command: 自分の依存関係申告と処理実行のみに集中
 */

import { CommandEnvironment } from './environment';

/**
 * 依存関係タイプの定義
 */
export type DependencyType = 
  | 'SNAPSHOT'    // 新規スナップショット作成
  | 'BASIC'       // 基本的な関数解析
  | 'CALL_GRAPH'  // 関数間呼び出し関係解析  
  | 'TYPE_SYSTEM' // TypeScript型システム解析
  | 'COUPLING';   // パラメータ結合度解析

/**
 * Command統一インターフェース
 * 全てのコマンドはこのインターフェースを実装する
 */
export interface Command {
  /**
   * subCommandに基づいて必要な依存関係を返す
   * 
   * 重要: この段階では環境は初期化されていない
   * 純粋にオプション解析のみに基づいて判定する
   * 
   * @param subCommand process.argv.slice(3) - コマンドライン引数
   * @returns 必要な依存関係の配列（空配列なら依存なし）
   */
  getRequires(subCommand: string[]): Promise<DependencyType[]>;
  
  /**
   * 実際の処理を実行
   * 
   * 前提条件: getRequires()で返した依存関係は全て初期化済み
   * この前提が満たされていない場合はcli-wrapper側の責務違反
   * 
   * @param env 初期化済みの環境（必要な依存関係が保証されている）
   * @param subCommand process.argv.slice(3) - コマンドライン引数
   */
  perform(env: CommandEnvironment, subCommand: string[]): Promise<void>;
}

/**
 * 依存関係初期化の結果
 */
export interface InitializationResult {
  /** 成功した依存関係 */
  successful: DependencyType[];
  /** 失敗した依存関係 */
  failed: Array<{ dependency: DependencyType; error: Error }>;
  /** 部分成功かどうか */
  partialSuccess: boolean;
}

/**
 * Command実装時のヘルパータイプ
 */
export type CommandClass<T extends Command = Command> = new () => T;

/**
 * 依存関係の責務違反エラー
 * commandのperform()実行時に必要な依存関係が初期化されていない場合に投げる
 */
export class DependencyViolationError extends Error {
  constructor(
    public readonly command: string,
    public readonly missingDependency: DependencyType,
    public readonly context: string
  ) {
    super(
      `Dependency violation in ${command}: ${missingDependency} not initialized (${context}). ` +
      `This is a cli-wrapper responsibility violation.`
    );
    this.name = 'DependencyViolationError';
  }
}
# Call Graph Contract (Analyzer Integration)

この文書は、BASIC解析の出力をコールグラフ解析へ安全に受け渡すための契約（Contract）を定義します。目的は「初回解析で確実にエッジが出る」ことと「フォールバックに依存しない」ことです。

## 目的
- BASIC → CallGraph の連携を安定化し、1回目の解析で正しいエッジを生成する。
- 実装が部分最適で分岐（フォールバック）に頼らないよう、前提条件を明文化。

## 前提条件（入力契約）
コールグラフ解析の入力（FunctionMetadata／FunctionInfo 由来）では、以下を満たすこと:

- filePath: Project.getSourceFile().getFilePath() と照合可能な形式であること。
  - 基本は「絶対パス」。
  - Converter 側で `path.resolve()` により絶対化済み。
- 位置情報: startLine / endLine / startColumn / endColumn が正しく、関数の包含判定に使えること。
- ID/識別情報: id（物理 UUID）と semanticId が一貫していること。

## 実装上の約束事
- 共有 Project: env.projectManager により、スナップショット単位の単一 ts-morph Project を作成・再利用する。
- BASIC 後の関数キャッシュ: BASIC 保存直後に env.callGraphData.functions は DB 版で初期化する（最初の 1 回）。これにより、パス/行番号/ID などが永続化後の「真実の形」にそろう。
- 受け側の堅牢性（Analyzer 内部）:
  - FunctionMetadataConverter は filePath を `path.resolve()` で絶対化する。
  - StagedAnalysisEngine はルックアップを abs/raw/leading-slash の複数キーで構築し、表現ゆれを吸収する。

## フォールバックの扱い
- デフォルト無効。
- 明示的に `FUNCQC_ENABLE_DB_FUNCTIONS_FALLBACK=1` を指定した場合のみ、初回 0 edges 時に DB から関数を再取得して再解析を試行する。
- 通常運用では「初回でエッジが出る状態」を守り、フォールバックに依存しない。

## デバッグ
- `FUNCQC_DEBUG_PATHS=true` を指定すると、初回 0 edges 時に診断ログ（関数数/ファイル数など）を出力する。

## 二段階フローの互換性
- `scan`（BASICのみ）→ `analyze`（call-graph/types…）の分割実行でも、共有 Project の再構築と DB 版関数の読み込みにより同様に安定してエッジを生成する。


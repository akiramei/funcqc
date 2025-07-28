`pr-get.ts` を作成しました。このスクリプトは以下の機能を備えています：

---

## ✅ 主な機能

| 機能           | 説明                                      |
| ------------ | --------------------------------------- |
| PR番号指定       | `tsx pr-get.ts 237` のように指定可能            |
| リポジトリ指定      | `--repo akiramei/funcqc` で明示可能          |
| 出力先指定        | `--out ./pr/237/comments/` で保存先フォルダ変更可能 |
| ドライラン        | `--dry-run` で実際のファイルは書き込まずログ出力のみ        |
| Markdown保存   | 1コメント＝1ファイルで構造化された `.md` に出力            |
| YAMLメタヘッダー付き | コメントID, 投稿者, 日時, ファイル名, 行番号を記録          |
| 対応ログ欄付き      | 「理解完了」「修正済み」などのチェック欄を自動挿入               |

---

## 🧪 使い方の例

```bash
# 実際にファイルを作成する（標準ディレクトリ構造）
tsx pr-get.ts 237 --repo akiramei/funcqc

# 出力先変更
tsx pr-get.ts 237 --repo akiramei/funcqc --out tmp/comments/

# 安全確認（dry-run）
tsx pr-get.ts 237 --repo akiramei/funcqc --dry-run
```

---

## 🧼 出力されるファイルの例

```markdown
---  
commentId: 1283883423  
reviewer: CodeRabbit  
createdAt: 2025-07-26T11:45:23Z  
filePath: src/analyzer/dep/callgraph-analyzer.ts  
line: 137  
---

関数 `extractFunctionCalls` では依存関係を集約しているが、責務が曖昧です…

## 対応ログ
- [ ] 理解完了
- [ ] 対応方針決定
- [ ] 修正実施済み
- [ ] テスト確認
```

---

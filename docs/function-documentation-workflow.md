# funcqc 関数文書化ワークフロー完全ガイド

## 🎯 概要

funcqcの`--needs-description`機能を使用した体系的な関数文書化により、コードベースの理解と保守性を大幅に向上させます。

## 📋 基本ワークフロー

### Step 1: 文書化が必要な関数の特定

```bash
# 基本コマンド
npm run dev -- list --needs-description --show-id

# エクスポート関数優先
npm run dev -- list --needs-description --exported --show-id

# 複雑な関数優先
npm run dev -- list --needs-description --complexity ">5" --show-id
```

### Step 2: 情報の読み取り

テーブル形式の出力から以下を確認：
- **ID**: 説明登録に使用（例: `c88edcfc`）
- **File**: ソースファイルパス
- **Location**: 開始行-終了行

### Step 3: 関数内容の確認

```bash
# Readツールで関数を読む
Read src/cli/search.ts:129

# または、showコマンドで詳細確認
npm run dev -- show --id "c88edcfc"
```

### Step 4: 英語説明の登録

```bash
npm run dev -- describe "c88edcfc" --text "Clear, concise English description of what the function does"
```

### Step 5: 登録確認

```bash
# 説明が登録されたか確認
npm run dev -- show --id "c88edcfc"

# needs-descriptionリストから消えたか確認
npm run dev -- list --needs-description --show-id
```

## 🚀 効率的な文書化戦略

### 優先順位付け

1. **エクスポート関数優先**
   ```bash
   npm run dev -- list --needs-description --exported --show-id
   ```
   - 外部から使用される関数
   - APIドキュメントに重要

2. **複雑な関数優先**
   ```bash
   npm run dev -- list --needs-description --complexity ">5" --sort complexity:desc --show-id
   ```
   - 理解が困難な関数
   - メンテナンスリスクが高い

3. **大きな関数優先**
   ```bash
   npm run dev -- list --needs-description --lines ">30" --show-id
   ```
   - 多くのロジックを含む
   - 分割候補の可能性

### バッチ処理のコツ

```bash
# 同一ファイルの関数をまとめて処理
npm run dev -- list --needs-description --file "src/cli/list.ts" --show-id

# 特定のパターンに一致する関数
npm run dev -- list --needs-description --name "*Handler*" --show-id
```

## 📝 良い説明の書き方

### 基本原則

1. **What, not How**: 何をするかを説明（どうやるかは不要）
2. **簡潔明瞭**: 1-2文で本質を説明
3. **パラメータへの言及**: 重要なパラメータの役割を明記
4. **戻り値の説明**: 何を返すか明確に

### 例

**良い例**:
```bash
npm run dev -- describe "id" --text "Validates user input against security rules and returns sanitized data or throws ValidationError on failure"
```

**避けるべき例**:
```bash
# 曖昧すぎる
--text "Processes data"

# 実装詳細すぎる
--text "Uses regex to check string then loops through array and calls helper function"
```

## 🔧 トラブルシューティング

### テーブルが崩れてIDが見えない

```bash
# friendly形式を使用
npm run dev -- list --needs-description --show-id --format friendly
```

### showコマンドでエラーが出る

```bash
# ❌ 間違い: IDを名前として検索
npm run dev -- show "13b46d5e"

# ✅ 正解: --idオプションを使用
npm run dev -- show --id "13b46d5e"
```

### 大量の関数がある場合

```bash
# ページネーション
npm run dev -- list --needs-description --show-id --limit 10

# 特定条件で絞り込み
npm run dev -- list --needs-description --exported --complexity ">5" --show-id
```

## 📊 文書化進捗の確認

### 統計情報の取得

```bash
# 全体の文書化状況
npm run dev -- list --no-description --json | jq '.functions | length'
npm run dev -- list --with-description --json | jq '.functions | length'

# 文書化率の計算
total=$(npm run dev -- list --json | jq '.functions | length')
documented=$(npm run dev -- list --with-description --json | jq '.functions | length')
echo "Documentation coverage: $((documented * 100 / total))%"
```

### 定期的な確認

```bash
# 週次で実行
npm run dev -- list --needs-description --exported --show-id

# 月次でレポート生成
npm run dev -- list --no-description --exported --json > undocumented-functions.json
```

## 🎨 AIアシスタント向けベストプラクティス

### 効率的な処理順序

1. **初回スキャン**: 全体状況把握
   ```bash
   npm run dev -- list --needs-description --show-id --limit 20
   ```

2. **優先度設定**: エクスポート＆複雑な関数
   ```bash
   npm run dev -- list --needs-description --exported --complexity ">5" --show-id
   ```

3. **バッチ処理**: 同一ファイルごと
   ```bash
   npm run dev -- list --needs-description --file "specific-file.ts" --show-id
   ```

### 説明テンプレート

```typescript
// 一般的な関数
"[Action verb] [object] [additional context if needed]"

// 検証関数
"Validates [what] against [criteria] and returns [result] or throws [error]"

// 変換関数
"Converts [input type] to [output type] by [brief method]"

// ハンドラー関数
"Handles [event/request type] by [main action] and returns [result]"
```

## 🚨 重要な注意事項

1. **説明は英語で**: 国際的な開発者への配慮
2. **更新時の再文書化**: コード変更時は説明も更新
3. **一貫性の維持**: 同じプロジェクトでは統一したスタイル
4. **簡潔性優先**: 詳細はコードコメントに

## 📈 期待される効果

- **理解速度**: 新規開発者のオンボーディング50%短縮
- **バグ削減**: 関数の誤用による不具合30%減少
- **保守効率**: コードレビュー時間25%削減
- **知識共有**: チーム全体の理解度向上

この体系的なアプローチにより、funcqcはコードベースの「生きたドキュメント」として機能し、開発効率と品質を継続的に向上させます。
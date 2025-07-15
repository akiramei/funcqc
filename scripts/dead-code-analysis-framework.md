# デッドコード分析フレームワーク

## 🔍 調査段階

### Phase 1: 技術的使用状況
- [ ] インスタンス化 (`new ClassName`)
- [ ] メソッド呼び出し (`.methodName()`)
- [ ] 型参照 (`TypeName` as type)
- [ ] インポート先での使用

### Phase 2: 意図・設計確認
- [ ] ドキュメント内での言及
- [ ] テストファイル内での使用
- [ ] 設定ファイルでの参照
- [ ] README・CHANGELOG記載

### Phase 3: プロジェクト文脈
- [ ] 将来使用予定の機能か
- [ ] 実験的機能か
- [ ] 開発中の機能か
- [ ] 廃止予定の機能か

## 📊 判定基準マトリックス

| 使用状況 | 意図確認 | 文脈 | 判定 |
|----------|----------|------|------|
| ❌ なし | ❌ なし | ❌ 不明 | **DEAD** |
| ❌ なし | ✅ あり | ✅ 将来使用 | **未統合** |
| ❌ なし | ❌ なし | ✅ 実験 | **検討中** |
| ✅ あり | ✅ あり | ✅ 現役 | **LIVE** |

## 🚨 注意すべきケース

### False Positive (誤判定)
- **動的呼び出し**: `this[methodName]()`
- **設定ドリブン**: JSON設定からの参照
- **プラグイン系**: 動的ロード
- **テンプレート系**: 文字列内での参照

### False Negative (見落とし)
- **コメントアウト済み**: 本当は削除すべき
- **条件付き使用**: 特定条件でのみ使用
- **デバッグ用**: 開発時のみ使用

## 🔧 具体的調査コマンド

```bash
# 1. 基本的な使用確認
function check_usage() {
  local symbol="$1"
  echo "=== $symbol の使用状況 ==="
  
  # インスタンス化
  grep -r "new $symbol" src/ --include="*.ts"
  
  # メソッド呼び出し
  grep -r "\.$symbol\|$symbol\." src/ --include="*.ts"
  
  # 型として使用
  grep -r ": $symbol\|<$symbol>" src/ --include="*.ts"
  
  # 動的参照
  grep -r "'$symbol'\|\"$symbol\"" src/ --include="*.ts"
}

# 2. 文脈確認
function check_context() {
  local symbol="$1"
  echo "=== $symbol の文脈確認 ==="
  
  # ドキュメント
  find . -name "*.md" -exec grep -l "$symbol" {} \;
  
  # 設定ファイル
  find . -name "*.json" -o -name "*.yaml" -o -name "*.yml" | xargs grep -l "$symbol"
  
  # テスト
  find test/ -name "*.ts" -exec grep -l "$symbol" {} \;
}

# 3. 時系列確認
function check_history() {
  local symbol="$1"
  echo "=== $symbol の履歴確認 ==="
  
  # 最初の追加
  git log --follow --patch -S "$symbol" -- src/
  
  # 最後の変更
  git log -1 --stat -S "$symbol"
}
```

## 📈 信頼度の計算

```bash
# 総合判定スコア
function calculate_dead_score() {
  local symbol="$1"
  local score=0
  
  # 使用なし: +50点
  local usage_count=$(grep -r "$symbol" src/ --include="*.ts" | grep -v "export\|import\|interface\|class" | wc -l)
  if [ "$usage_count" -eq 0 ]; then
    score=$((score + 50))
  fi
  
  # ドキュメント言及なし: +30点
  local doc_count=$(find . -name "*.md" -exec grep -l "$symbol" {} \; | wc -l)
  if [ "$doc_count" -eq 0 ]; then
    score=$((score + 30))
  fi
  
  # テストなし: +20点
  local test_count=$(find test/ -name "*.ts" -exec grep -l "$symbol" {} \; | wc -l)
  if [ "$test_count" -eq 0 ]; then
    score=$((score + 20))
  fi
  
  echo "Dead Code Score: $score/100"
  
  if [ "$score" -ge 80 ]; then
    echo "🚨 HIGH: Likely dead code"
  elif [ "$score" -ge 50 ]; then
    echo "⚠️  MEDIUM: Possibly dead code"
  else
    echo "✅ LOW: Likely live code"
  fi
}
```
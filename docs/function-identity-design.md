# Function Identity Design - 関数識別体系の設計

## 概要

funcqc における関数識別は、異なる目的に応じて3つの次元で管理される複合的なシステムです。
Issue #46 の実装過程で、単一の識別子では複数の要求を満たせないことが判明し、以下の設計方針を確立しました。

## 3つの識別次元

### 1. 物理ベース識別 (Physical Identity)

**目的**: 特定時点・場所での物理的実体の一意識別

```typescript
interface PhysicalIdentity {
  physicalId: string;        // UUID - 絶対的に一意
  snapshotId: string;        // どのスナップショット時点
  filePath: string;          // 物理的ファイル位置
  position: {                // 物理的コード位置
    line: number;
    column: number;
  };
  timestamp: number;         // スキャン実行時刻
}
```

**特徴**:
- メトリクス、パラメータ等の物理データとの紐付け
- 外部キー参照の基準点
- ファイル移動、リファクタリングで変更される
- git commit、スナップショット等の時系列データと連携

**使用例**:
```sql
-- 特定スナップショットでの品質メトリクス
SELECT qm.* FROM quality_metrics qm 
WHERE qm.function_id = 'uuid-physical-id';
```

### 2. 意味/役割ベース識別 (Semantic/Role Identity)

**目的**: 関数の責務・役割による論理的識別

```typescript
interface SemanticIdentity {
  semanticId: string;        // 役割ベースのハッシュ
  filePath: string;          // 論理的所属（役割コンテキスト）
  contextPath: string[];     // クラス・名前空間での役割階層
  name: string;              // 関数の役割名
  signature: string;         // 関数契約（入出力仕様）
  modifiers: string[];       // 役割属性（static, private等）
}
```

**重要**: `position` は含まない（物理的移動で変わるため）

**特徴**:
- 関数説明の管理基準
- API互換性の追跡
- リファクタリング時の論理的継続性
- 役割が同じなら物理的移動があっても同一

**使用例**:
```sql
-- 同じ役割の関数の歴史的変遷
SELECT s.created_at, f.physical_id, qm.cyclomatic_complexity
FROM functions f
JOIN snapshots s ON f.snapshot_id = s.id
WHERE f.semantic_id = 'hash-of-role'
ORDER BY s.created_at;

-- 説明管理
CREATE TABLE function_descriptions (
  semantic_id TEXT PRIMARY KEY,     -- 役割ベース参照
  description TEXT,
  validated_for_content_id TEXT,    -- 実装確認済みマーク
  needs_review BOOLEAN
);
```

### 3. 内容ベース識別 (Content Identity)

**目的**: 実装内容による具体的識別

```typescript
interface ContentIdentity {
  contentId: string;         // 実装内容のハッシュ
  astHash: string;          // 抽象構文木の構造
  sourceCodeHash: string;   // ソースコード内容
  semanticFingerprint: string; // 処理ロジックの指紋
}
```

**特徴**:
- 実装変更の検出
- 重複コードの発見
- 説明の妥当性確認
- 1文字でも変わると変更

**使用例**:
```sql
-- 実装が変更された関数
SELECT f1.name FROM functions f1, functions f2 
WHERE f1.semantic_id = f2.semantic_id      -- 同じ役割
  AND f1.content_id != f2.content_id;      -- 異なる実装

-- 重複実装の検出
SELECT content_id, COUNT(*), array_agg(semantic_id)
FROM functions GROUP BY content_id HAVING COUNT(*) > 1;
```

## 現在の実装状況

### ✅ 完了
- **物理ベース**: UUID による `id` フィールド
- **基本スキーマ**: context_path, function_type, modifiers 追加

### ⚠️ 修正必要
- **意味ベース**: `logical_id` に `position` が混入（修正予定）

### ❌ 未実装  
- **内容ベース**: `content_id` フィールドと生成ロジック

## 修正計画

### Phase 1.5: 意味ベース識別の修正

```typescript
// 現在（問題）
const logicalId = hash([
  filePath, contextPath, name, signature, modifiers,
  `${position.line}:${position.column}` // ← 除去必要
]);

// 修正後
const semanticId = hash([
  filePath, contextPath, name, signature, modifiers
  // position 除去で移動に対して安定
]);
```

### Phase 2: 内容ベース識別の追加

```typescript
const contentId = hash([astHash, sourceCodeHash]);
```

### Phase 3: 説明管理の改善

```sql
-- 実装変更時の自動検出
IF NEW.content_id != OLD.content_id THEN
  UPDATE function_descriptions 
  SET needs_review = TRUE 
  WHERE semantic_id = NEW.semantic_id;
END IF;
```

## 設計原則

1. **分離の原則**: 各識別次元は独立した目的を持つ
2. **安定性の原則**: 意味ベースは物理変更に対して安定
3. **検出可能性**: 内容ベースで実装変更を確実に検出
4. **実用性**: 説明管理など実際のユースケースに適合

## 期待される効果

### 関数説明管理の改善
- 意味が同じなら説明を引き継ぎ
- 実装変更時は確認を促す
- 無駄な再入力を削減

### コード品質の向上
- 重複実装の自動検出
- リファクタリング追跡の精度向上
- API変更の影響範囲特定

### 開発体験の向上
- 関数移動時の履歴保持
- 適切な粒度での変更通知
- 論理的な関数管理

---

**注意**: この設計は Issue #46 の実装過程で発見された課題に基づいています。
当初の単一 logical_id 設計では不十分であることが実装中に判明し、より精密な識別体系が必要となりました。

**更新日**: 2025-01-01  
**関連**: Issue #46, Pull Request #47
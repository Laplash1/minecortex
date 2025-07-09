# 変更履歴 - v1.7.0

## バージョン情報
- **バージョン**: v1.7.0
- **リリース日**: 2025-07-09
- **変更タイプ**: 機能改善・バグ修正

## 主要な変更

### 材料自動作成機能の完成

#### src/SkillLibrary.js
**変更内容**: `getMissingMaterialsForActualRecipe()` 関数の材料不足検出ロジックを大幅改善
**変更意図**: ツール作成時に材料が不足している場合、その場でクラフトして材料を補う機能が正常に動作していなかった問題を解決
**期待効果**: 
- AIボットが材料不足時に自動的に中間材料（スティック等）を作成
- 手動介入なしでより自律的なクラフト動作が実現
- プレイヤーの待機時間短縮

**具体的な修正箇所**:
1. `stick_from_planks` 置換タイプの処理を追加（1800行目付近）
2. 実際のスティック不足量の正確な計算ロジックを実装
3. missing配列への適切な材料情報追加

**修正前の問題**:
```javascript
// 置換可能性の検出のみで、実際の不足量を見逃していた
if (canSubstituteMaterial(...)) {
  // 何もしない - 置換可能として扱うだけ
}
```

**修正後の解決**:
```javascript
} else if (substitutionInfo.substitutionType === 'stick_from_planks') {
  const currentSticks = substitutionInfo.substitutes.stick || 0;
  const sticksNeeded = needed - currentSticks;
  if (sticksNeeded > 0) {
    console.log(`[材料チェック] スティック不足: ${itemName} (必要:${needed}, 現在:${currentSticks}) -> ${sticksNeeded}個を板材から作成が必要`);
    missing.push({
      item: itemName,
      needed: sticksNeeded,
      have: currentSticks,
      substitutionType: substitutionInfo.substitutionType,
      possibleSubstitutes: substitutionInfo.substitutes
    });
  }
}
```

## テスト結果

### 動作確認
- **テスト方法**: npm start で120秒間実行
- **確認事項**: ツール作成時の材料自動作成機能
- **結果**: 成功 ✅

### ログ出力例
```
[材料チェック] スティック不足: stick (必要:2, 現在:0) -> 2個を板材から作成が必要
Missing materials for crafting: stick (needed: 2, have: 0)
```

## 技術的詳細

### 修正の背景
従来の `getMissingMaterialsForActualRecipe()` 関数は、材料の置換可能性を検出する機能と、実際の不足量を計算する機能が分離されていました。これにより、「置換可能」と判定された材料について、実際の不足量が正しく計算されず、自動作成が実行されない問題が発生していました。

### 解決アプローチ
1. 置換可能性の検出後、実際の不足量を正確に計算
2. 不足量が0より大きい場合のみ、missing配列に追加
3. 詳細なログ出力で問題の特定と解決状況を可視化

### 影響範囲
- **直接影響**: ツール作成時の材料管理システム
- **間接影響**: AIボットの全体的な自律性向上
- **パフォーマンス**: 材料不足時の待機時間短縮

## 今後の改善予定

### 短期計画
- [ ] 他の材料置換タイプ（wood_variants等）での同様の改善
- [ ] 複数階層の材料依存関係への対応検討
- [ ] エラーハンドリングの強化

### 中期計画
- [ ] 材料管理システムの全体的な構造化
- [ ] 自動テストの導入
- [ ] パフォーマンス最適化

## 破壊的変更
なし

## 非推奨機能
なし

## セキュリティ修正
なし

## 依存関係の変更
なし
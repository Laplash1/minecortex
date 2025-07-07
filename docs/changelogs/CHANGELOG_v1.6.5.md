# Change Log - v1.6.5

## 概要

`craft_tools`スキルのwooden_pickaxe作成時の"missing ingredient"エラーを修正。stick不足時の自動作成機能を実装。

## 変更ファイル

### src/InventoryUtils.js
**変更内容**: `canSubstituteMaterial`メソッドでstick代替処理を追加
**変更意図**: stickが不足している場合に板材から自動作成可能かどうかを判定する機能を追加
**期待効果**: wooden_pickaxeなどのツール作成時にstick不足が発生しても、板材があれば自動的にstickを作成できる

主な変更:
- stick用の代替処理ロジックを追加
- 既存のstick在庫と板材から作成可能なstick数を計算
- 3つの状態を判定: `exact_match`（十分なstickあり）、`stick_from_planks`（板材から作成可能）、`stick_insufficient`（材料不足）
- 2板材→4stickの変換レートを適用

### src/SkillLibrary.js
**変更内容**: `CraftToolsSkill`クラスの材料チェック機能を改善
**変更意図**: 新しいstick代替システムと連携して、適切な材料変換を実行
**期待効果**: wooden_pickaxe作成時のmissing ingredientエラーを解消

主な変更:
- `getMissingMaterialsForRecipe`でstick代替処理のログを追加
- `execute`メソッドでstick不足時の処理を改善
- 新しい代替システムの結果に基づく適切な処理分岐を実装
- フォールバック機能を追加

## 技術的詳細

### 問題の原因
wooden_pickaxeのレシピには以下が必要:
- 木材の板（planks）3個
- stick 2個

従来の実装では、`canSubstituteMaterial`メソッドがstickを考慮せず、板材からstickを作成する機能が不完全でした。

### 解決策
1. **stick代替判定**: `canSubstituteMaterial`でstick専用の処理を追加
2. **変換レート計算**: 2板材→4stickの正確な変換レートを実装
3. **段階的判定**: 既存stick + 板材から作成可能なstick数を計算
4. **統合処理**: CraftToolsSkillで新しい代替システムを活用

### テスト結果
- 2stick必要、0stick保有、38板材保有 → 作成可能（76stick相当）
- 5stick必要、0stick保有、38板材保有 → 作成可能（76stick相当）
- 100stick必要、0stick保有、38板材保有 → 作成不可（50板材必要）
- 3stick必要、1stick保有、38板材保有 → 作成可能（77stick相当）

## 影響範囲
- wooden_pickaxeを含むすべての木製ツールの作成が安定化
- stick不足による作成エラーを大幅に削減
- 材料の有効活用による効率的なツール作成

## 次のステップ
- 他のツール（iron_pickaxe、diamond_pickaxeなど）でも同様の問題がないか確認
- 石材や金属材料の代替処理も検討
- ログ出力を調整してデバッグしやすくする

---

# 追加変更 - 移動処理統一化リファクタリング

## 概要
SkillLibrary.jsの移動処理をMovementUtilsに集約し、コードの一貫性と保守性を向上させました。

## 変更内容

### src/utils/MovementUtils.js
**変更内容**: 新しい汎用的な移動関数を追加
- `moveToBlock()`: ブロックオブジェクトへの移動
- `moveToPosition()`: 座標への移動
- `moveToEntity()`: エンティティへの移動
**変更意図**: pathfinder.gotoの直接使用を統一し、一貫した移動処理を提供
**期待効果**: 移動処理の統一化により、バグの減少と保守性の向上

### src/SkillLibrary.js
**変更内容**: pathfinder.gotoの使用箇所をMovementUtils関数に置き換え
- ApproachSkill: moveToPosition使用
- NavigateTerrainSkill: moveToPosition使用
- SimpleGatherWoodSkill: moveToBlock使用
- SimpleFindFoodSkill: moveToEntity使用
- MiningSkill: moveToPosition使用
- ExploreSkill: moveToPosition使用
- GotoSkill: moveToPosition使用（複雑な処理も含む）
**変更意図**: 移動処理の統一化と一貫性の確保
**期待効果**: 移動処理のメンテナンスが容易になり、バグの発生を抑制

## 技術的詳細

### リファクタリング統計
- pathfinder.goto使用箇所: 11箇所 → 1箇所に削減
- MovementUtils関数使用箇所: 2箇所 → 10箇所に増加
- エラー修正: ESLintエラー49件を修正

### 品質改善
- ESLint重大エラー: 49件 → 0件
- ESLint警告: 変更前後で警告数は同水準（機能影響なし）
- コードの一貫性: pathfinder.goto使用の90%以上を統一

## 今後の改善点
1. 残存するpathfinder.goto使用箇所の統一
2. 長い行の警告修正（オプショナル）
3. 移動処理の追加テストケース作成
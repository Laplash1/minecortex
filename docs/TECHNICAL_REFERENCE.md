# 技術リファレンス

🧠 **MineCortex v1.1.0** の技術的な詳細とアーキテクチャについて説明します。

## 📐 システムアーキテクチャ

### 全体構成
```
MineCortex v1.1.0
├── MinecraftAI (コアAIシステム)
├── VoyagerAI (学習・スキル生成)
├── SkillLibrary (行動定義)
├── TaskPlanner (タスク管理)
├── EnvironmentObserver (環境認識)
├── StateManager (状態管理)
└── MultiPlayerCoordinator (協調制御)
```

### データフローアーキテクチャ
```
[環境観察] → [タスク計画] → [スキル実行] → [結果評価] → [学習データ蓄積] → [AI改善]
     ↑                                                              ↓
[状況判断] ← [カリキュラム生成] ← [学習分析] ← [パターン認識] ← [経験データベース]
```

---

## 🧠 AI学習データフロー詳細

### 学習サイクル

#### 1. 初期化フェーズ
```javascript
// MinecraftAI.js:37-56
initialize() {
  // 基本スキルロード
  this.skillLibrary.loadBasicSkills();
  
  // 初期目標設定
  this.goals = [
    { type: 'explore', priority: 1, description: '世界を探索する' },
    { type: 'gather_wood', priority: 2, description: '木材を収集する' },
    { type: 'find_food', priority: 3, description: '食料源を探す' }
  ];
}
```

**データ構造**:
```javascript
{
  knownSkills: Map<string, Skill>,
  activeGoals: Array<Goal>,
  learningHistory: Array<Experience>
}
```

#### 2. 観察フェーズ
```javascript
// EnvironmentObserver.js 観察データ構造
ObservationData = {
  position: { x: number, y: number, z: number },
  health: number,
  food: number,
  timeOfDay: string,
  weather: string,
  nearbyEntities: Array<Entity>,
  nearbyBlocks: Array<Block>,
  inventoryItems: Array<Item>,
  dangers: Array<Danger>
}
```

**リアルタイム更新**:
- 位置情報: 100ms間隔
- 健康状態: 500ms間隔
- 環境スキャン: 1s間隔
- 地形分析: 2s間隔

#### 3. タスク計画フェーズ
```javascript
// TaskPlanner.js:45-89
planTask(goal) {
  const task = {
    type: goal.type,
    params: this.analyzeRequirements(goal),
    priority: goal.priority,
    timeout: Date.now() + this.calculateTimeout(goal),
    prerequisites: this.checkPrerequisites(goal)
  };
  
  return this.optimizeTask(task);
}
```

**計画アルゴリズム**:
1. 目標分析
2. 前提条件チェック
3. リソース要件分析
4. タイムアウト計算
5. 最適化

#### 4. スキル実行フェーズ
```javascript
// MinecraftAI.js:484-506 (リファクタリング後)
async executeCurrentTask() {
  const skill = await this.getOrGenerateSkill(taskName);
  const result = await this.executeSkillSafely(skill, taskName);
  await this.processTaskResult(result, taskName);
}
```

**実行制御**:
- タイムアウト管理
- エラーハンドリング
- リソース保護
- パフォーマンス監視

#### 5. 学習フェーズ
```javascript
// VoyagerAI.js:240-260
async learnFromExperience(task, result, context) {
  const experience = {
    task: task,
    result: result,
    context: context,
    timestamp: Date.now(),
    success: result.success
  };
  
  this.learningHistory.push(experience);
  
  if (!result.success) {
    await this.analyzeAndImprove(task, result, context);
  }
}
```

---

## 🔧 コンポーネント詳細

### MinecraftAI (コアAIシステム)
**ファイル**: `src/MinecraftAI.js` (1052行)
**責任**: 全体制御、意思決定、ライフサイクル管理

**主要メソッド**:
```javascript
// 生命線
initialize()                  // システム初期化
startMainLoop()              // メインループ開始
mainLoopIteration()          // 1回のループ処理

// タスク管理
executeCurrentTask()         // 現在タスク実行
getOrGenerateSkill()         // スキル取得/生成
executeSkillSafely()         // 安全なスキル実行
processTaskResult()          // 結果処理

// 脅威対応
handleImmediateThreats()     // 即座の脅威処理
performEvasiveAction()       // 回避行動
safeExploration()           // 安全な探索

// 状態管理
calculateAdaptiveSleep()     // 適応的スリープ
updatePerformanceMetrics()   // パフォーマンス更新
```

### VoyagerAI (学習・スキル生成)
**ファイル**: `src/VoyagerAI.js` (446行)
**責任**: AI学習、動的スキル生成、経験分析

**学習アルゴリズム**:
```javascript
// スキル生成
async generateSkill(task, context) {
  const prompt = this.buildSkillPrompt(task, context);
  const response = await this.openai.chat.completions.create({
    model: process.env.OPENAI_SKILL_MODEL || 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1500,
    temperature: 0.3
  });
  
  return this.parseSkillCode(response.choices[0].message.content);
}

// 経験分析
async analyzeAndImprove(task, result, context) {
  const analysis = await this.generateAnalysis(task, result, context);
  this.learnings.push({
    task: task.type,
    error: result.error,
    analysis: analysis,
    timestamp: Date.now()
  });
}
```

### SkillLibrary (行動定義)
**ファイル**: `src/SkillLibrary.js` (706行)
**責任**: スキル定義、行動ライブラリ管理

**スキル階層**:
```javascript
class Skill {
  constructor(name, description) {
    this.name = name;
    this.description = description;
  }
  
  async execute(bot, params) {
    throw new Error('execute method must be implemented');
  }
}

// 基本スキル
class MoveToSkill extends Skill { /* 移動 */ }
class GatherWoodSkill extends Skill { /* 木材収集 */ }
class CraftBasicToolsSkill extends Skill { /* 道具作成 */ }
class AttackEntitySkill extends Skill { /* 戦闘 */ }
class PlaceBlockSkill extends Skill { /* ブロック設置 */ }
```

### TaskPlanner (タスク管理)
**ファイル**: `src/TaskPlanner.js` (509行)
**責任**: タスク計画、優先度管理、依存関係解決

**計画アルゴリズム**:
```javascript
// タスク生成
planTask(goal) {
  switch (goal.type) {
    case 'gather_wood':
      return this.planGatherWoodTask(goal);
    case 'craft_tools':
      return this.planCraftingTask(goal);
    case 'explore':
      return this.planExplorationTask(goal);
    default:
      return this.planGenericTask(goal);
  }
}

// 依存関係解決
checkPrerequisites(task) {
  const prerequisites = [];
  
  if (task.type === 'craft_stone_tools') {
    if (!this.hasWoodenPickaxe()) {
      prerequisites.push({ type: 'craft_basic_tools' });
    }
    if (!this.hasStone()) {
      prerequisites.push({ type: 'find_stone' });
    }
  }
  
  return prerequisites;
}
```

### EnvironmentObserver (環境認識)
**ファイル**: `src/EnvironmentObserver.js` (440行)
**責任**: 環境監視、危険検出、地形分析

**観察システム**:
```javascript
// 継続的観察
update() {
  this.updatePosition();        // 位置更新
  this.updateNearbyEntities();  // エンティティ検出
  this.updateNearbyBlocks();    // ブロック分析
  this.updateInventory();       // インベントリ状態
  this.updatePlayerStats();     // プレイヤー統計
  this.updateEnvironment();     // 環境条件
  this.recordObservation();     // 観察記録
}

// 危険検出
getNearbyDangers() {
  const dangers = [];
  
  // 敵対エンティティ
  for (const entity of this.nearbyEntities.values()) {
    if (entity.isHostile && entity.distance < 16) {
      dangers.push({
        type: 'hostile_entity',
        entityType: entity.type,
        distance: entity.distance,
        position: entity.position
      });
    }
  }
  
  // 環境危険
  if (this.bot.health < 6) {
    dangers.push({ type: 'low_health', severity: 'critical' });
  }
  
  return dangers;
}
```

### StateManager (状態管理)
**ファイル**: `src/StateManager.js` (500行)
**責任**: 状態同期、整合性管理、パフォーマンス追跡

**状態構造**:
```javascript
SystemState = {
  // ボット状態
  position: { x, y, z },
  health: number,
  food: number,
  experience: number,
  
  // AI状態
  currentTask: Task | null,
  activeGoals: Array<Goal>,
  knownSkills: Set<string>,
  
  // 学習状態
  completedTasks: Array<TaskHistory>,
  skillPerformance: Map<string, PerformanceData>,
  
  // システム状態
  isInitialized: boolean,
  performanceMetrics: PerformanceData
}
```

### MultiPlayerCoordinator (協調制御)
**ファイル**: `src/MultiPlayerCoordinator.js` (390行)
**責任**: マルチプレイヤー協調、リソース競合解決

**協調アルゴリズム**:
```javascript
// リソース競合解決
async resolveResourceConflict(requesterId, currentClaim, resourceLocation, resourceType) {
  const requester = this.players.get(requesterId);
  const claimant = this.players.get(currentClaim.playerId);
  
  // 多次元評価
  const requesterPriority = this.calculateResourcePriority(requester, resourceType);
  const claimantPriority = this.calculateResourcePriority(claimant, resourceType);
  const cooperationFactor = (requester.cooperationScore + claimant.cooperationScore) / 200;
  
  // 距離による補正
  const requesterDistance = this.calculateDistance(requester.position, resourceLocation);
  const claimantDistance = this.calculateDistance(claimant.position, resourceLocation);
  
  // 最終判定
  const requesterScore = requesterPriority + cooperationFactor + (50 - requesterDistance);
  const claimantScore = claimantPriority + (50 - claimantDistance);
  
  return requesterScore > claimantScore;
}
```

---

## 📊 パフォーマンス指標

### システム要件とベンチマーク

| 指標 | シングル | 5プレイヤー | 10プレイヤー |
|------|----------|-------------|-------------|
| CPU使用率 | 5-10% | 15-25% | 30-50% |
| メモリ使用量 | 100MB | 500MB | 1GB |
| ネットワーク | 5KB/s | 25KB/s | 50KB/s |
| ディスクI/O | 1MB/h | 5MB/h | 10MB/h |

### パフォーマンス最適化技術

#### 適応的スリープ
```javascript
calculateAdaptiveSleep() {
  const baseSleep = 1000;
  let multiplier = 1.0;
  
  if (this.observer.isDangerous()) multiplier = 0.5;     // 危険時高速化
  if (!this.currentTask && this.goals.length === 0) multiplier = 2.0; // 待機時省電力
  if (this.bot.health < 10) multiplier = 0.7;           // 低体力時迅速対応
  
  return Math.floor(baseSleep * multiplier);
}
```

#### メモリ管理
```javascript
// 定期的クリーンアップ
performMaintenanceCleanup() {
  // 観察履歴制限
  if (this.observer.observationHistory.length > 500) {
    this.observer.observationHistory = this.observer.observationHistory.slice(-250);
  }
  
  // 学習履歴制限
  if (this.voyagerAI.learningHistory.length > 100) {
    this.voyagerAI.learningHistory = this.voyagerAI.learningHistory.slice(-50);
  }
  
  // 状態整合性チェック
  this.stateManager.validateAndRepair();
}
```

#### リソース保護
```javascript
// リソース競合制御
async requestResourceAccess(location, resourceType, estimatedTime) {
  if (!this.coordinator) return { granted: true };
  
  const result = await this.coordinator.requestResourceAccess(
    this.playerId, location, resourceType, estimatedTime
  );
  
  if (!result.granted && result.waitTime < 60000) {
    await this.sleep(result.waitTime);
    return this.requestResourceAccess(location, resourceType, estimatedTime);
  }
  
  return result;
}
```

---

## 🔒 セキュリティとエラーハンドリング

### 安全性保証

#### Null/Undefined チェック
```javascript
// v1.1.0で強化されたチェック
updatePosition() {
  if (!this.bot?.entity?.position) {
    return; // 安全に早期リターン
  }
  
  const pos = this.bot.entity.position;
  this.lastPosition = {
    x: Math.round(pos.x * 100) / 100,
    y: Math.round(pos.y * 100) / 100,
    z: Math.round(pos.z * 100) / 100,
    timestamp: Date.now()
  };
}
```

#### タイムアウト管理
```javascript
async executeSkillWithTimeout(skill, params, timeoutMs) {
  return new Promise(async (resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Skill execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      const result = await skill.execute(this.bot, params);
      clearTimeout(timeoutId);
      resolve(result);
    } catch (error) {
      clearTimeout(timeoutId);
      resolve({ success: false, error: error.message });
    }
  });
}
```

#### 指数バックオフ
```javascript
// エラー時の再試行制御
async retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      
      const delay = Math.min(30000, 1000 * Math.pow(2, i));
      await this.sleep(delay);
    }
  }
}
```

---

## 🔧 API仕様

### コアAIインターフェース

#### MinecraftAI Public API
```javascript
class MinecraftAI {
  // ライフサイクル
  initialize(): void
  startMainLoop(): Promise<void>
  shutdown(): Promise<void>
  
  // 制御
  setGoal(goal: Goal): void
  reportStatus(): string
  processCommand(username: string, command: string): Promise<void>
  
  // 状態
  getCurrentTask(): Task | null
  getActiveGoals(): Goal[]
  getPerformanceMetrics(): PerformanceData
}
```

#### スキルインターフェース
```javascript
interface Skill {
  name: string
  description: string
  execute(bot: Bot, params: any): Promise<SkillResult>
}

interface SkillResult {
  success: boolean
  error?: string
  data?: any
  metrics?: {
    executionTime: number
    resourcesUsed: any
  }
}
```

#### 観察データインターフェース
```javascript
interface ObservationData {
  position: Position
  health: number
  food: number
  timeOfDay: string
  weather: string
  nearbyEntities: Entity[]
  nearbyBlocks: Block[]
  inventoryItems: Item[]
  dangers: Danger[]
}
```

---

## 📈 拡張性

### プラグインシステム
```javascript
// カスタムプラグインの実装例
class CustomPlugin {
  constructor(ai) {
    this.ai = ai;
    this.setupEventHandlers();
  }
  
  setupEventHandlers() {
    this.ai.bot.on('chat', this.handleChat.bind(this));
    this.ai.on('taskComplete', this.handleTaskComplete.bind(this));
  }
  
  async handleChat(username, message) {
    if (message.startsWith('!custom')) {
      await this.executeCustomCommand(username, message);
    }
  }
}
```

### カスタムスキル開発
```javascript
// 新しいスキルの追加
class CustomBuildingSkill extends Skill {
  constructor() {
    super('custom_building', 'カスタム建築スキル');
  }
  
  async execute(bot, params) {
    const { structure, location } = params;
    
    try {
      await this.buildStructure(bot, structure, location);
      return { 
        success: true, 
        built: structure.name,
        location: location 
      };
    } catch (error) {
      return { 
        success: false, 
        error: error.message 
      };
    }
  }
}
```

---

このテクニカルリファレンスは、MineCortex v1.1.0のアーキテクチャと実装詳細を包括的に説明しています。開発者はこの情報を基に、システムの理解を深め、カスタマイズや拡張を行うことができます。
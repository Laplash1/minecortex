// Minecraft AI 学習シナリオ
// このファイルは様々な学習シナリオとテストケースを定義します

class TrainingScenarios {
  static getBasicSurvivalScenario() {
    return {
      name: "基本サバイバル",
      description: "基本的なサバイバルスキルを学習する",
      initialState: {
        position: { x: 0, y: 64, z: 0 },
        health: 20,
        food: 20,
        inventory: [],
        timeOfDay: "day",
        weather: "clear"
      },
      tasks: [
        {
          type: "gather_wood",
          params: { amount: 10, wood_type: "oak" },
          description: "オークの木材を10個収集",
          expectedDuration: 60000,
          successCriteria: { minGathered: 8 }
        },
        {
          type: "craft_basic_tools", 
          params: { tools: ["wooden_pickaxe", "wooden_axe", "wooden_sword"] },
          description: "基本的な木製ツールを作成",
          expectedDuration: 45000,
          successCriteria: { minCrafted: 2 }
        },
        {
          type: "find_food",
          params: { food_type: "any", amount: 5 },
          description: "食料を5個確保",
          expectedDuration: 90000,
          successCriteria: { minFood: 3 }
        }
      ],
      learningObjectives: [
        "資源収集の効率性",
        "ツール作成の優先順位",
        "サバイバルの基本戦略"
      ]
    };
  }

  static getAdvancedCraftingScenario() {
    return {
      name: "高度なクラフト",
      description: "複雑なクラフトレシピと材料管理を学習",
      initialState: {
        position: { x: 100, y: 64, z: 100 },
        health: 20,
        food: 15,
        inventory: ["oak_planks:20", "stick:10", "cobblestone:15"],
        timeOfDay: "day",
        weather: "clear"
      },
      tasks: [
        {
          type: "craft_furnace",
          params: { amount: 1 },
          description: "かまどを作成",
          expectedDuration: 30000,
          successCriteria: { crafted: ["furnace"] }
        },
        {
          type: "mine_iron_ore",
          params: { amount: 5 },
          description: "鉄鉱石を5個採掘",
          expectedDuration: 120000,
          successCriteria: { minMined: 3 }
        },
        {
          type: "smelt_iron",
          params: { ore_type: "iron_ore", amount: 5 },
          description: "鉄鉱石を精錬",
          expectedDuration: 180000,
          successCriteria: { smelted: ["iron_ingot"] }
        },
        {
          type: "craft_iron_tools",
          params: { tools: ["iron_pickaxe", "iron_sword"] },
          description: "鉄製ツールを作成",
          expectedDuration: 60000,
          successCriteria: { crafted: ["iron_pickaxe", "iron_sword"] }
        }
      ],
      learningObjectives: [
        "材料の効率的な管理",
        "精錬プロセスの理解",
        "上位ツールへのアップグレード戦略"
      ]
    };
  }

  static getCombatScenario() {
    return {
      name: "戦闘と防御",
      description: "敵対的モブとの戦闘スキルを学習",
      initialState: {
        position: { x: 200, y: 64, z: 200 },
        health: 20,
        food: 18,
        inventory: ["wooden_sword:1", "bread:5"],
        timeOfDay: "night",
        weather: "clear"
      },
      tasks: [
        {
          type: "kill_hostile_mob",
          params: { mob_type: "zombie", amount: 3 },
          description: "ゾンビを3体倒す",
          expectedDuration: 150000,
          successCriteria: { minKilled: 2 }
        },
        {
          type: "avoid_damage",
          params: { maxDamageTaken: 6 },
          description: "受けるダメージを最小限に抑える",
          expectedDuration: 120000,
          successCriteria: { maxDamage: 8 }
        },
        {
          type: "collect_drops",
          params: { items: ["rotten_flesh", "bone"] },
          description: "ドロップアイテムを収集",
          expectedDuration: 60000,
          successCriteria: { minItems: 2 }
        }
      ],
      learningObjectives: [
        "戦闘の基本戦術",
        "ダメージ回避技術",
        "リソース効率的な戦闘"
      ]
    };
  }

  static getBuildingScenario() {
    return {
      name: "建築とクリエイティブ",
      description: "構造物の建設と空間設計を学習",
      initialState: {
        position: { x: 300, y: 64, z: 300 },
        health: 20,
        food: 20,
        inventory: ["cobblestone:64", "oak_planks:32", "glass:16"],
        timeOfDay: "day",
        weather: "clear"
      },
      tasks: [
        {
          type: "build_shelter",
          params: { 
            structure_type: "house",
            size: "medium",
            materials: ["cobblestone", "oak_planks", "glass"]
          },
          description: "中型の家を建設",
          expectedDuration: 300000,
          successCriteria: { 
            minBlocks: 50,
            hasRoof: true,
            hasDoor: true,
            hasWindows: true
          }
        },
        {
          type: "create_farm",
          params: {
            crop_type: "wheat",
            size: "5x5"
          },
          description: "小麦農場を作成",
          expectedDuration: 180000,
          successCriteria: {
            farmSize: 25,
            hasWater: true,
            planted: true
          }
        }
      ],
      learningObjectives: [
        "効率的な建設プロセス",
        "材料の最適利用",
        "機能的なデザイン"
      ]
    };
  }

  static getExplorationScenario() {
    return {
      name: "探索と発見",
      description: "世界探索と資源発見のスキルを学習",
      initialState: {
        position: { x: 500, y: 64, z: 500 },
        health: 20,
        food: 20,
        inventory: ["bread:10", "wooden_pickaxe:1", "wooden_sword:1"],
        timeOfDay: "day",
        weather: "clear"
      },
      tasks: [
        {
          type: "explore_biomes",
          params: {
            target_biomes: ["forest", "mountains", "desert"],
            min_distance: 100
          },
          description: "異なるバイオームを探索",
          expectedDuration: 600000,
          successCriteria: {
            biomesVisited: 2,
            distanceTraveled: 200
          }
        },
        {
          type: "discover_structures",
          params: {
            structures: ["village", "cave", "dungeon"]
          },
          description: "自然構造物を発見",
          expectedDuration: 400000,
          successCriteria: {
            structuresFound: 1
          }
        },
        {
          type: "map_area",
          params: {
            area_size: "200x200"
          },
          description: "エリアをマッピング",
          expectedDuration: 300000,
          successCriteria: {
            areaMapped: 30000
          }
        }
      ],
      learningObjectives: [
        "効率的な探索パターン",
        "重要な場所の認識",
        "ナビゲーション戦略"
      ]
    };
  }

  static getAdaptiveScenario() {
    return {
      name: "適応的学習",
      description: "予期しない状況への適応能力を学習",
      initialState: {
        position: { x: 0, y: 64, z: 0 },
        health: 10, // 低い体力でスタート
        food: 8,   // 低い食料でスタート
        inventory: ["wooden_sword:1"],
        timeOfDay: "night", // 困難な時間帯
        weather: "thunderstorm" // 困難な天候
      },
      randomEvents: [
        {
          type: "mob_spawn",
          probability: 0.3,
          mobs: ["zombie", "skeleton", "creeper"]
        },
        {
          type: "resource_depletion",
          probability: 0.2,
          affectedResources: ["wood", "stone"]
        },
        {
          type: "weather_change",
          probability: 0.4,
          newWeather: ["rain", "clear", "thunderstorm"]
        }
      ],
      tasks: [
        {
          type: "survive_until_dawn",
          params: { target_time: "day" },
          description: "夜明けまで生き延びる",
          expectedDuration: 480000,
          successCriteria: {
            survivedUntil: "day",
            minHealth: 1
          }
        },
        {
          type: "adapt_to_events",
          params: { flexibility: "high" },
          description: "ランダムイベントに適応",
          expectedDuration: 600000,
          successCriteria: {
            eventsHandled: 3,
            adaptationSuccess: 0.7
          }
        }
      ],
      learningObjectives: [
        "危機管理能力",
        "状況判断力",
        "柔軟な戦略変更"
      ]
    };
  }

  static getAllScenarios() {
    return [
      this.getBasicSurvivalScenario(),
      this.getAdvancedCraftingScenario(),
      this.getCombatScenario(),
      this.getBuildingScenario(),
      this.getExplorationScenario(),
      this.getAdaptiveScenario()
    ];
  }

  static getScenarioByDifficulty(difficulty) {
    const scenarios = this.getAllScenarios();
    const difficultyMap = {
      'beginner': [scenarios[0]], // 基本サバイバル
      'intermediate': [scenarios[1], scenarios[2]], // 高度クラフト、戦闘
      'advanced': [scenarios[3], scenarios[4]], // 建築、探索
      'expert': [scenarios[5]] // 適応的学習
    };

    return difficultyMap[difficulty] || [];
  }

  static getProgressiveScenarios() {
    // 段階的に難易度が上がるシナリオの順序
    const scenarios = this.getAllScenarios();
    return [
      scenarios[0], // 基本サバイバル
      scenarios[1], // 高度クラフト
      scenarios[2], // 戦闘
      scenarios[3], // 建築
      scenarios[4], // 探索
      scenarios[5]  // 適応的学習
    ];
  }
}

module.exports = { TrainingScenarios };
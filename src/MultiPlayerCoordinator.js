class MultiPlayerCoordinator {
  constructor() {
    this.players = new Map(); // playerId -> player info
    this.resourceClaims = new Map(); // resource -> claimant info
    this.sharedGoals = [];
    this.conflictResolutionQueue = [];
    this.coordinationChannel = new Map(); // For inter-bot communication

    this.maxResourceDistance = 32; // Distance for resource conflict detection
    this.claimTimeout = 300000; // 5 minutes claim timeout
    
    // 同期開始機能
    this.expectedPlayersCount = 0; // 期待するプレイヤー数
    this.readyPlayers = new Set(); // 準備完了プレイヤー
    this.isAllPlayersReady = false; // 全員準備完了フラグ
    this.syncStartEnabled = true; // 同期開始を有効にするか
  }

  // Register a player in the coordination system
  registerPlayer(playerId, bot, ai) {
    if (!bot) {
      console.error(`[Coordinator] Cannot register player ${playerId}: bot is null`);
      return;
    }

    const position = bot.entity?.position || { x: 0, y: 64, z: 0 };

    this.players.set(playerId, {
      id: playerId,
      bot,
      ai,
      position,
      currentTask: null,
      resourceClaims: new Set(),
      lastActivity: Date.now(),
      personality: this.detectPersonality(playerId),
      cooperationScore: 100 // Initial cooperation score
    });

    console.log(`[Coordinator] Player ${playerId} registered with personality: ${this.detectPersonality(playerId)}`);
  }

  // Remove a player from coordination
  unregisterPlayer(playerId) {
    const player = this.players.get(playerId);
    if (player) {
      // Release all resource claims
      for (const resource of player.resourceClaims) {
        this.releaseResourceClaim(resource, playerId);
      }
      this.players.delete(playerId);
      console.log(`[Coordinator] Player ${playerId} unregistered`);
    }
  }

  // Update player information
  updatePlayer(playerId, updateInfo) {
    const player = this.players.get(playerId);
    if (player) {
      Object.assign(player, updateInfo);
      player.lastActivity = Date.now();
    }
  }

  // Detect personality from player ID or username
  detectPersonality(playerId) {
    if (!playerId || typeof playerId !== 'string') {
      return 'generalist'; // Fallback when ID is not yet available
    }
    const id = playerId.toLowerCase();

    if (id.includes('explorer') || id.includes('scout')) return 'explorer';
    if (id.includes('miner') || id.includes('digger')) return 'miner';
    if (id.includes('builder') || id.includes('architect')) return 'builder';
    if (id.includes('farmer') || id.includes('gardener')) return 'farmer';
    if (id.includes('guard') || id.includes('defender')) return 'guard';
    if (id.includes('collector') || id.includes('gatherer')) return 'collector';
    if (id.includes('crafter') || id.includes('smith')) return 'crafter';
    if (id.includes('trader') || id.includes('merchant')) return 'trader';
    if (id.includes('helper') || id.includes('assistant')) return 'helper';

    return 'generalist';
  }

  // Resource conflict resolution
  async requestResourceAccess(playerId, resourceLocation, resourceType, estimatedTime = 300000) {
    const resourceKey = this.generateResourceKey(resourceLocation, resourceType);
    const currentClaim = this.resourceClaims.get(resourceKey);

    // Check if resource is already claimed
    if (currentClaim && currentClaim.playerId !== playerId) {
      // Check if claim has expired
      if (Date.now() - currentClaim.timestamp > this.claimTimeout) {
        this.releaseResourceClaim(resourceKey, currentClaim.playerId);
      } else {
        // Resource is claimed by another player
        return await this.resolveResourceConflict(playerId, currentClaim, resourceLocation, resourceType);
      }
    }

    // Grant resource access
    this.resourceClaims.set(resourceKey, {
      playerId,
      resourceType,
      location: resourceLocation,
      timestamp: Date.now(),
      estimatedTime
    });

    const player = this.players.get(playerId);
    if (player) {
      player.resourceClaims.add(resourceKey);
    }

    console.log(`[Coordinator] Resource access granted to ${playerId} for ${resourceType} at ${JSON.stringify(resourceLocation)}`);
    return { granted: true, waitTime: 0 };
  }

  // Release a resource claim
  releaseResourceClaim(resourceKey, playerId) {
    const claim = this.resourceClaims.get(resourceKey);
    if (claim && claim.playerId === playerId) {
      this.resourceClaims.delete(resourceKey);

      const player = this.players.get(playerId);
      if (player) {
        player.resourceClaims.delete(resourceKey);
      }

      console.log(`[Coordinator] Resource ${resourceKey} released by ${playerId}`);
      return true;
    }
    return false;
  }

  // Resolve resource conflicts
  async resolveResourceConflict(requesterId, currentClaim, resourceLocation, resourceType) {
    const requester = this.players.get(requesterId);
    const claimant = this.players.get(currentClaim.playerId);

    if (!requester || !claimant) {
      return { granted: false, reason: 'Invalid players' };
    }

    // Priority-based conflict resolution
    const requesterPriority = this.calculateResourcePriority(requester, resourceType);
    const claimantPriority = this.calculateResourcePriority(claimant, resourceType);

    // Check cooperation scores
    const cooperationFactor = (requester.cooperationScore + claimant.cooperationScore) / 200;

    // Distance-based priority (closer player gets preference)
    const requesterDistance = this.calculateDistance(requester.position, resourceLocation);
    const claimantDistance = this.calculateDistance(claimant.position, resourceLocation);

    let decision = 'wait';

    // Decision matrix
    if (requesterPriority > claimantPriority + 2) {
      decision = 'takeover';
    } else if (requesterDistance < claimantDistance / 2 && requesterPriority >= claimantPriority) {
      decision = 'takeover';
    } else if (cooperationFactor > 0.8 && Math.abs(requesterPriority - claimantPriority) <= 1) {
      decision = 'share';
    }

    switch (decision) {
    case 'takeover':
      this.releaseResourceClaim(this.generateResourceKey(resourceLocation, resourceType), currentClaim.playerId);
      await this.notifyPlayer(claimant.id, `Resource ${resourceType} reassigned to ${requesterId}`);
      return await this.requestResourceAccess(requesterId, resourceLocation, resourceType);

    case 'share':
      await this.coordinateSharedResource(requesterId, currentClaim.playerId, resourceLocation, resourceType);
      return { granted: true, shared: true, partner: currentClaim.playerId };

    default: { // wait
      const estimatedWaitTime = Math.max(0, currentClaim.timestamp + currentClaim.estimatedTime - Date.now());
      return { granted: false, waitTime: estimatedWaitTime, reason: 'Resource currently in use' };
    }
    }
  }

  // Calculate resource priority based on player personality and current needs
  calculateResourcePriority(player, resourceType) {
    let basePriority = 5; // Default priority

    const personalityBonus = {
      miner: { stone: 3, iron_ore: 3, coal_ore: 2 },
      builder: { wood: 3, stone: 2, cobblestone: 2 },
      crafter: { wood: 2, iron: 3, coal: 2 },
      farmer: { water: 3, seeds: 3, animals: 2 },
      explorer: { food: 2 },
      collector: { wood: 1, stone: 1, iron: 1 }
    };

    const bonus = personalityBonus[player.personality]?.[resourceType] || 0;
    basePriority += bonus;

    // Urgency modifiers
    if (player.bot.health < 10) basePriority += 2; // Low health increases priority
    if (player.bot.food < 10) basePriority += 2; // Low food increases priority

    return basePriority;
  }

  // Coordinate shared resource usage
  async coordinateSharedResource(player1Id, player2Id, resourceLocation, resourceType) {
    const coordination = {
      players: [player1Id, player2Id],
      resource: resourceType,
      location: resourceLocation,
      strategy: 'alternate', // or 'split'
      startTime: Date.now()
    };

    // Notify both players about the coordination
    await this.notifyPlayer(player1Id, `Sharing ${resourceType} with ${player2Id}`);
    await this.notifyPlayer(player2Id, `Sharing ${resourceType} with ${player1Id}`);

    console.log(`[Coordinator] Coordinated shared resource: ${resourceType} between ${player1Id} and ${player2Id}`);
    return coordination;
  }

  // Task coordination and distribution
  async coordinateTask(taskType, requirements, excludePlayers = []) {
    const availablePlayers = Array.from(this.players.values())
      .filter(p => !excludePlayers.includes(p.id))
      .filter(p => Date.now() - p.lastActivity < 60000); // Active in last minute

    if (availablePlayers.length === 0) {
      return { success: false, reason: 'No available players' };
    }

    // Score players for this task
    const scoredPlayers = availablePlayers.map(player => ({
      player,
      score: this.calculateTaskSuitability(player, taskType, requirements)
    }));

    // Sort by score (highest first)
    scoredPlayers.sort((a, b) => b.score - a.score);

    const selectedPlayer = scoredPlayers[0].player;

    // Assign task
    const taskAssignment = {
      playerId: selectedPlayer.id,
      taskType,
      requirements,
      assignedAt: Date.now()
    };

    await this.notifyPlayer(selectedPlayer.id, `Task assigned: ${taskType}`);
    console.log(`[Coordinator] Task ${taskType} assigned to ${selectedPlayer.id}`);

    return { success: true, assignment: taskAssignment };
  }

  // Calculate task suitability score
  calculateTaskSuitability(player, taskType, requirements) {
    let score = 0;

    // Personality-based scoring
    const personalityScores = {
      explore: { explorer: 10, scout: 9, generalist: 5 },
      mine: { miner: 10, collector: 7, generalist: 5 },
      build: { builder: 10, crafter: 7, generalist: 5 },
      craft: { crafter: 10, builder: 6, generalist: 5 },
      farm: { farmer: 10, collector: 6, generalist: 5 },
      guard: { guard: 10, generalist: 4 },
      trade: { trader: 10, helper: 6, generalist: 5 }
    };

    score += personalityScores[taskType]?.[player.personality] || 0;

    // Distance scoring (closer is better for location-based tasks)
    if (requirements.location) {
      const distance = this.calculateDistance(player.position, requirements.location);
      score += Math.max(0, 50 - distance); // Max 50 points for being at location
    }

    // Cooperation score factor
    score *= (player.cooperationScore / 100);

    // Current load factor (less loaded players preferred)
    const currentTasks = player.resourceClaims.size;
    score *= Math.max(0.5, 1 - (currentTasks * 0.2));

    return score;
  }

  // Communication between bots
  async sendMessage(fromPlayerId, toPlayerId, message, messageType = 'info') {
    const fromPlayer = this.players.get(fromPlayerId);
    const toPlayer = this.players.get(toPlayerId);

    if (!fromPlayer || !toPlayer) {
      return { success: false, reason: 'Invalid players' };
    }

    const messageData = {
      from: fromPlayerId,
      to: toPlayerId,
      message,
      type: messageType,
      timestamp: Date.now()
    };

    // Store in coordination channel
    const channelKey = `${Math.min(fromPlayerId, toPlayerId)}-${Math.max(fromPlayerId, toPlayerId)}`;
    if (!this.coordinationChannel.has(channelKey)) {
      this.coordinationChannel.set(channelKey, []);
    }
    this.coordinationChannel.get(channelKey).push(messageData);

    // Deliver message to target player
    await this.notifyPlayer(toPlayerId, `${fromPlayerId}: ${message}`);

    return { success: true };
  }

  // Notify a player (through their bot's chat)
  async notifyPlayer(playerId, message) {
    const player = this.players.get(playerId);
    if (player && player.bot) {
      try {
        player.bot.chat(`[Coordinator] ${message}`);
      } catch (error) {
        console.log(`[Coordinator] Failed to notify ${playerId}: ${error.message}`);
      }
    }
  }

  // Utility functions
  generateResourceKey(location, resourceType) {
    const roundedLoc = {
      x: Math.floor(location.x / 8) * 8,
      y: Math.floor(location.y / 8) * 8,
      z: Math.floor(location.z / 8) * 8
    };
    return `${resourceType}-${roundedLoc.x}-${roundedLoc.y}-${roundedLoc.z}`;
  }

  calculateDistance(pos1, pos2) {
    return Math.sqrt(
      Math.pow(pos1.x - pos2.x, 2) +
      Math.pow(pos1.y - pos2.y, 2) +
      Math.pow(pos1.z - pos2.z, 2)
    );
  }

  // Maintenance and cleanup
  cleanup() {
    const now = Date.now();

    // Clean up expired resource claims
    for (const [resourceKey, claim] of this.resourceClaims.entries()) {
      if (now - claim.timestamp > this.claimTimeout) {
        this.releaseResourceClaim(resourceKey, claim.playerId);
      }
    }

    // Clean up old messages
    for (const [channelKey, messages] of this.coordinationChannel.entries()) {
      const recentMessages = messages.filter(msg => now - msg.timestamp < 3600000); // Keep 1 hour
      this.coordinationChannel.set(channelKey, recentMessages);
    }

    // Update cooperation scores based on recent behavior
    this.updateCooperationScores();
  }

  updateCooperationScores() {
    for (const player of this.players.values()) {
      // Increase cooperation score for players who share resources
      // Decrease for players who monopolize resources
      const claimCount = player.resourceClaims.size;
      if (claimCount > 3) {
        player.cooperationScore = Math.max(0, player.cooperationScore - 1);
      } else if (claimCount === 0) {
        player.cooperationScore = Math.min(100, player.cooperationScore + 1);
      }
    }
  }

  // 同期開始機能の設定
  configureSyncStart(expectedPlayersCount, enabled = true) {
    this.expectedPlayersCount = expectedPlayersCount;
    this.syncStartEnabled = enabled;
    this.readyPlayers.clear();
    this.isAllPlayersReady = false;
    
    console.log(`[Coordinator] 同期開始設定: 期待プレイヤー数=${expectedPlayersCount}, 有効=${enabled}`);
  }

  // プレイヤーの準備完了を報告
  reportPlayerReady(playerId) {
    if (!this.syncStartEnabled) {
      return { canStart: true, reason: '同期開始が無効' };
    }

    this.readyPlayers.add(playerId);
    const readyCount = this.readyPlayers.size;
    
    console.log(`[Coordinator] ${playerId} 準備完了 (${readyCount}/${this.expectedPlayersCount})`);

    // 全員準備完了チェック
    if (readyCount >= this.expectedPlayersCount && !this.isAllPlayersReady) {
      this.isAllPlayersReady = true;
      console.log(`[Coordinator] 🎉 全${this.expectedPlayersCount}人の準備完了！タスク開始を許可`);
      
      // 全プレイヤーに開始通知
      this.notifyAllPlayers('全員の準備が完了しました！AIタスクを開始します');
      
      return { canStart: true, reason: '全員準備完了' };
    }

    return { 
      canStart: false, 
      reason: `他のプレイヤーを待機中 (${readyCount}/${this.expectedPlayersCount})`,
      waitingFor: this.expectedPlayersCount - readyCount
    };
  }

  // 全員準備完了かチェック
  canStartTasks(playerId) {
    if (!this.syncStartEnabled) {
      return { canStart: true, reason: '同期開始が無効' };
    }

    if (this.isAllPlayersReady) {
      return { canStart: true, reason: '全員準備完了済み' };
    }

    const readyCount = this.readyPlayers.size;
    return { 
      canStart: false, 
      reason: `他のプレイヤーを待機中 (${readyCount}/${this.expectedPlayersCount})`,
      waitingFor: this.expectedPlayersCount - readyCount
    };
  }

  // 全プレイヤーに通知
  async notifyAllPlayers(message) {
    const notifications = [];
    for (const playerId of this.players.keys()) {
      notifications.push(this.notifyPlayer(playerId, message));
    }
    await Promise.all(notifications);
  }

  // Get coordination status
  getStatus() {
    return {
      playersCount: this.players.size,
      activeResourceClaims: this.resourceClaims.size,
      sharedGoalsCount: this.sharedGoals.length,
      conflictsInQueue: this.conflictResolutionQueue.length,
      averageCooperationScore: this.calculateAverageCooperationScore(),
      // 同期開始ステータス
      syncStart: {
        enabled: this.syncStartEnabled,
        expectedPlayers: this.expectedPlayersCount,
        readyPlayers: this.readyPlayers.size,
        allReady: this.isAllPlayersReady,
        readyPlayersList: Array.from(this.readyPlayers)
      }
    };
  }

  calculateAverageCooperationScore() {
    if (this.players.size === 0) return 0;

    const totalScore = Array.from(this.players.values())
      .reduce((sum, player) => sum + player.cooperationScore, 0);

    return Math.round(totalScore / this.players.size);
  }
}

module.exports = { MultiPlayerCoordinator };

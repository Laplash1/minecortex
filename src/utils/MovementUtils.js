const { goals } = require('mineflayer-pathfinder');
// const { Vec3 } = require('vec3'); // Unused import
const { Logger } = require('./Logger');

const logger = Logger.createLogger('MovementUtils');

/**
 * Ensure the bot is within maxDist blocks of the given reference block.
 * If it is already close enough this resolves immediately.
 * Otherwise the bot attempts to path-find or fallback-walk toward the block.
 *
 * @param {Bot}  bot    mineflayer bot instance
 * @param {Block} block reference block (e.g. crafting_table)
 * @param {number} maxDist acceptable distance (default 3)
 * @param {object} opts
 *        ├─ timeoutMs   total time allowed for one movement attempt (default 10 000)
 *        └─ retries     number of retries (default 2)
 * @returns {Promise<{success:boolean, error?:string}>}
 */
async function ensureProximity(bot, block, maxDist = 3, opts = {}) {
  if (!block) return { success: false, error: 'Block is null' };

  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = opts.retries ?? 2;

  const distance = bot.entity.position.distanceTo(block.position);
  if (distance <= maxDist) return { success: true };

  logger.info(`approaching block ${block.name} (dist=${distance.toFixed(1)})`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Prefer pathfinder if available
      if (bot.pathfinder && typeof bot.pathfinder.goto === 'function') {
        const goal = new goals.GoalNear(
          block.position.x,
          block.position.y,
          block.position.z,
          maxDist
        );
        await Promise.race([
          bot.pathfinder.goto(goal),
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error('movement timeout')), timeoutMs)
          )
        ]);
      } else {
        // Fallback basic forward walking
        await bot.lookAt(block.position);
        bot.setControlState('forward', true);
        await new Promise(resolve => setTimeout(resolve, Math.min(timeoutMs, 3000)));
        bot.setControlState('forward', false);
      }

      const newDist = bot.entity.position.distanceTo(block.position);
      if (newDist <= maxDist) {
        logger.info(`reached proximity (dist=${newDist.toFixed(1)})`);
        return { success: true };
      }

      logger.warn(`attempt ${attempt} did not reach proximity (dist=${newDist.toFixed(1)})`);
    } catch (err) {
      logger.warn(`movement attempt ${attempt} failed: ${err.message}`);
    }

    // small back-off
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return { success: false, error: 'UNREACHABLE' };
}

/**
 * 指定されたブロックオブジェクトの近くへ移動します。
 * @param {import('mineflayer').Bot} bot - botインスタンス
 * @param {import('prismarine-block').Block} block - 移動先のブロックオブジェクト
 * @param {number} [range=1] - ブロックからの目標距離
 * @param {object} opts - オプション
 * @returns {Promise<{success:boolean, error?:string}>}
 */
async function moveToBlock(bot, block, range = 1, opts = {}) {
  if (!block) return { success: false, error: 'Block is null' };

  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = opts.retries ?? 2;

  const distance = bot.entity.position.distanceTo(block.position);
  if (distance <= range) return { success: true };

  logger.info(`moving to block ${block.name} at ${block.position} (dist=${distance.toFixed(1)})`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (bot.pathfinder && typeof bot.pathfinder.goto === 'function') {
        const goal = new goals.GoalNear(
          block.position.x,
          block.position.y,
          block.position.z,
          range
        );
        await Promise.race([
          bot.pathfinder.goto(goal),
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error('movement timeout')), timeoutMs)
          )
        ]);
      } else {
        await bot.lookAt(block.position);
        bot.setControlState('forward', true);
        await new Promise(resolve => setTimeout(resolve, Math.min(timeoutMs, 3000)));
        bot.setControlState('forward', false);
      }

      const newDist = bot.entity.position.distanceTo(block.position);
      if (newDist <= range) {
        logger.info(`reached block (dist=${newDist.toFixed(1)})`);
        return { success: true };
      }

      logger.warn(`attempt ${attempt} did not reach block (dist=${newDist.toFixed(1)})`);
    } catch (err) {
      logger.warn(`movement attempt ${attempt} failed: ${err.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return { success: false, error: 'UNREACHABLE' };
}

/**
 * 指定された座標へ移動します。
 * @param {import('mineflayer').Bot} bot - botインスタンス
 * @param {import('vec3').Vec3} position - 移動先の座標
 * @param {number} [range=0] - 座標からの目標距離
 * @param {object} opts - オプション
 * @returns {Promise<{success:boolean, error?:string}>}
 */
async function moveToPosition(bot, position, range = 0, opts = {}) {
  if (!position) return { success: false, error: 'Position is null' };

  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = opts.retries ?? 2;

  const distance = bot.entity.position.distanceTo(position);
  if (distance <= range) return { success: true };

  logger.info(`moving to position ${position} (dist=${distance.toFixed(1)})`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (bot.pathfinder && typeof bot.pathfinder.goto === 'function') {
        const goal = range > 0
          ? new goals.GoalNear(position.x, position.y, position.z, range)
          : new goals.GoalBlock(position.x, position.y, position.z);

        await Promise.race([
          bot.pathfinder.goto(goal),
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error('movement timeout')), timeoutMs)
          )
        ]);
      } else {
        await bot.lookAt(position);
        bot.setControlState('forward', true);
        await new Promise(resolve => setTimeout(resolve, Math.min(timeoutMs, 3000)));
        bot.setControlState('forward', false);
      }

      const newDist = bot.entity.position.distanceTo(position);
      if (newDist <= range) {
        logger.info(`reached position (dist=${newDist.toFixed(1)})`);
        return { success: true };
      }

      logger.warn(`attempt ${attempt} did not reach position (dist=${newDist.toFixed(1)})`);
    } catch (err) {
      logger.warn(`movement attempt ${attempt} failed: ${err.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return { success: false, error: 'UNREACHABLE' };
}

/**
 * 指定されたエンティティの近くへ移動します。
 * @param {import('mineflayer').Bot} bot - botインスタンス
 * @param {import('prismarine-entity').Entity} entity - 移動先のエンティティ
 * @param {number} [range=1] - エンティティからの目標距離
 * @param {object} opts - オプション
 * @returns {Promise<{success:boolean, error?:string}>}
 */
async function moveToEntity(bot, entity, range = 1, opts = {}) {
  if (!entity) return { success: false, error: 'Entity is null' };

  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = opts.retries ?? 2;

  const distance = bot.entity.position.distanceTo(entity.position);
  if (distance <= range) return { success: true };

  logger.info(`moving to entity ${entity.name || entity.type} (dist=${distance.toFixed(1)})`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (bot.pathfinder && typeof bot.pathfinder.goto === 'function') {
        const goal = new goals.GoalNear(
          entity.position.x,
          entity.position.y,
          entity.position.z,
          range
        );

        await Promise.race([
          bot.pathfinder.goto(goal),
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error('movement timeout')), timeoutMs)
          )
        ]);
      } else {
        await bot.lookAt(entity.position);
        bot.setControlState('forward', true);
        await new Promise(resolve => setTimeout(resolve, Math.min(timeoutMs, 3000)));
        bot.setControlState('forward', false);
      }

      const newDist = bot.entity.position.distanceTo(entity.position);
      if (newDist <= range) {
        logger.info(`reached entity (dist=${newDist.toFixed(1)})`);
        return { success: true };
      }

      logger.warn(`attempt ${attempt} did not reach entity (dist=${newDist.toFixed(1)})`);
    } catch (err) {
      logger.warn(`movement attempt ${attempt} failed: ${err.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return { success: false, error: 'UNREACHABLE' };
}

module.exports = {
  ensureProximity,
  moveToBlock,
  moveToPosition,
  moveToEntity
};

const { setTimeout: delay } = require('node:timers/promises');

function stopActions(bot) {
  // setGoal(null) cancels goto immediately; stop() waits for a path node.
  bot.pathfinder?.setGoal(null);
  bot.clearControlStates?.();
  bot.stopDigging?.();
  if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
}

function check(signal) {
  signal?.throwIfAborted();
}

async function sleep(ms, signal) {
  await delay(ms, undefined, { signal });
}

// Guard later calls from legacy skills too. Cancellation is never permission to
// start another operation while the previous execute() promise is still alive.
function guardedBot(bot, signal) {
  const guarded = new Set([
    'dig', 'equip', 'craft', 'placeBlock', 'activateBlock', 'activateItem',
    'attack', 'lookAt', 'look', 'setControlState', 'toss', 'tossStack',
    'clickWindow', 'useOn', 'chat', 'putSelectedItemRange', 'putAway',
    '_syncWindow', 'moveSlotItem', 'closeWindow'
  ]);
  const pathfinder = bot.pathfinder && new Proxy(bot.pathfinder, {
    get(target, key) {
      const value = target[key];
      if (typeof value !== 'function') return value;
      return (...args) => {
        check(signal);
        return value.apply(target, args);
      };
    }
  });
  return new Proxy(bot, {
    get(target, key) {
      if (key === 'pathfinder') return pathfinder;
      const value = target[key];
      if (typeof value !== 'function') return value;
      return (...args) => {
        if (guarded.has(key)) check(signal);
        return value.apply(target, args);
      };
    }
  });
}

class OperationRunner {
  constructor(bot) {
    this.bot = bot;
    this.active = null;
  }

  async run(skill, params, timeoutMs) {
    if (this.active) throw new Error('Another operation has not settled');
    const controller = new AbortController();
    const { signal } = controller;
    const operation = { controller, done: null };
    this.active = operation;
    const client = this.bot._client;
    const originalWrite = client?.write;
    // Native Mineflayer operations close over the original bot. Guard their
    // outgoing mutations too, including a dig that was still awaiting lookAt.
    if (originalWrite) {
      client.write = (packet, data, ...args) => {
        const mutates = ['window_click', 'block_place', 'use_item', 'use_entity',
          'creative_inventory_action'].includes(packet) || (packet === 'block_dig' && data.status !== 1);
        if (mutates) check(signal);
        return originalWrite.call(client, packet, data, ...args);
      };
    }
    const cancel = () => stopActions(this.bot);
    signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      controller.abort(new Error(`Operation deadline exceeded (${timeoutMs}ms)`));
    }, timeoutMs);
    operation.done = Promise.resolve().then(() => {
      check(signal);
      return skill.execute(guardedBot(this.bot, signal), params, { signal });
    });
    try {
      const result = await operation.done;
      check(signal);
      return result;
    } catch (error) {
      check(signal);
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      stopActions(this.bot);
      if (originalWrite) client.write = originalWrite;
      this.active = null;
    }
  }

  async cancel(reason = 'Operation stopped') {
    const operation = this.active;
    if (!operation) {
      stopActions(this.bot);
      return;
    }
    operation.controller.abort(new Error(reason));
    await operation.done.catch(() => {});
  }
}

module.exports = { OperationRunner, stopActions, check, sleep };

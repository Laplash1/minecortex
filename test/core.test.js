const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { SkillLibrary } = require('../src/SkillLibrary');
const { TaskPlanner } = require('../src/TaskPlanner');
const { StateManager } = require('../src/StateManager');
const { EnvironmentObserver } = require('../src/EnvironmentObserver');
const { MinecraftAI } = require('../src/MinecraftAI');
const { OperationRunner, sleep } = require('../src/utils/OperationRunner');
const BasicSkills = require('../src/skills/BasicSkills');

function botStub() {
  const bot = new EventEmitter();
  return Object.assign(bot, {
    username: 'MineCortexBot1',
    entity: { position: new Vec3(0, 64, 0) },
    health: 0,
    food: 0,
    experience: {},
    entities: {},
    inventory: { items: () => [], slots: [], emptySlotCount: () => 36 },
    pathfinder: { setGoal: jest.fn() },
    clearControlStates: jest.fn(),
    stopDigging: jest.fn(),
    chat: jest.fn(),
    dig: jest.fn(),
    blockAt: () => null
  });
}

test('all 17 registered skills receive a usable logger through the base class', () => {
  const library = new SkillLibrary();
  library.loadBasicSkills();
  expect(library.listSkills()).toHaveLength(17);
  for (const name of library.listSkills()) {
    expect(typeof library.getSkill(name).logger.log).toBe('function');
  }
});

test('default goals follow the empty-inventory dependency order without an axe cycle', async () => {
  const bot = botStub();
  const planner = new TaskPlanner(bot);
  const goals = MinecraftAI.prototype.defaultGoals();
  const tasks = await Promise.all(goals.map(goal => planner.planTask(goal)));
  expect(tasks.map(t => t.type)).toEqual([
    'gather_wood', 'craft_workbench', 'place_workbench', 'craft_tools', 'mine_block'
  ]);
  expect(tasks[0].prerequisites).toEqual([]);
  expect(tasks[0].params.amount).toBe(3);
  expect(tasks[3].params.tools).toEqual(['wooden_pickaxe']);
  expect(tasks[4].params).toEqual({ blockType: 'stone', amount: 3 });
  await expect(planner.planTask({ type: 'craft_stone_tools' })).rejects.toThrow('Unsupported goal');
});

test('observer refreshes own health, food and inventory while throttling nearby scans', () => {
  const bot = botStub();
  const observer = new EnvironmentObserver(bot);
  const scan = jest.spyOn(observer, 'updateNearbyBlocks');
  observer.update(10000);
  expect(observer.health).toBe(0);
  expect(observer.food).toBe(0);
  bot.inventory.items = () => [{ name: 'cobblestone', count: 3 }];
  bot.entity.position = new Vec3(2, 64, 0);
  observer.update(10250);
  expect(observer.inventoryState.get('cobblestone')).toBe(3);
  expect(observer.lastPosition.x).toBe(2);
  expect(observer.updatedAt).toBe(10250);
  expect(scan).toHaveBeenCalledTimes(1);
  observer.update(12000);
  expect(scan).toHaveBeenCalledTimes(2);
});

test('state synchronization reads bot health/food including zero and is not starved by other updates', () => {
  const bot = botStub();
  const state = new StateManager(bot);
  state.updateState({ currentTask: { type: 'move_to' } });
  state.syncWithBot();
  expect(state.getState('health')).toBe(0);
  expect(state.getState('food')).toBe(0);
});

test('cancel stops actual actions, blocks overlap until settlement and rejects late mutations', async () => {
  const bot = botStub();
  const runner = new OperationRunner(bot);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const result = runner.run({
    execute: async guarded => {
      await pending;
      guarded.dig('late block');
    }
  }, {}, 5000);
  const rejection = expect(result).rejects.toThrow('manual stop');
  await Promise.resolve();
  const cancellation = runner.cancel('manual stop');
  expect(bot.clearControlStates).toHaveBeenCalled();
  expect(bot.stopDigging).toHaveBeenCalled();
  expect(bot.pathfinder.setGoal).toHaveBeenCalledWith(null);
  await expect(runner.run({ execute: jest.fn() }, {}, 100)).rejects.toThrow('not settled');
  release();
  await cancellation;
  await rejection;
  expect(bot.dig).not.toHaveBeenCalled();
  expect(runner.active).toBe(null);
  await expect(runner.run({ execute: async () => ({ success: true }) }, {}, 100))
    .resolves.toEqual({ success: true });
});

test('deadline cancels cooperative waits and releases the runner only after settlement', async () => {
  const bot = botStub();
  const runner = new OperationRunner(bot);
  await expect(runner.run({
    execute: async (_bot, _params, { signal }) => {
      await sleep(5000, signal);
    }
  }, {}, 20)).rejects.toThrow();
  expect(bot.pathfinder.setGoal).toHaveBeenCalledWith(null);
  expect(runner.active).toBe(null);
});

test('missing targets, missing materials and missing tools fail explicitly', async () => {
  const bot = botStub();
  bot.findBlock = () => null;
  bot.registry = { blocksByName: { stone: { id: 1 }, oak_log: { id: 2 } } };
  await expect(BasicSkills.gatherWood(bot, { amount: 1 })).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' });
  await expect(BasicSkills.craftWorkbench(bot, {})).rejects.toMatchObject({ code: 'MISSING_MATERIALS' });
  await expect(BasicSkills.mineBlocks(bot, { blockType: 'stone' })).rejects.toMatchObject({ code: 'NO_TOOL' });
  await expect(BasicSkills.mineBlocks(bot, { blockType: 'diamond_ore' }))
    .rejects.toMatchObject({ code: 'UNSUPPORTED_BLOCK' });
});

test('shutdown before initialization stops resources without removing manager or mineflayer listeners', async () => {
  const bot = botStub();
  const previous = process.env.PERFORMANCE_MONITORING;
  process.env.PERFORMANCE_MONITORING = 'false';
  const ai = new MinecraftAI(bot);
  const managerEnd = jest.fn();
  bot.on('end', managerEnd);
  await ai.shutdown('before_spawn');
  expect(ai.isShuttingDown).toBe(true);
  expect(bot.listeners('end')).toContain(managerEnd);
  expect(ai.observationTimer).toBeUndefined();
  await ai.initialize();
  expect(ai.isInitialized).toBe(false);
  if (previous === undefined) delete process.env.PERFORMANCE_MONITORING;
  else process.env.PERFORMANCE_MONITORING = previous;
});

test('disconnect during chunk initialization cancels polling and cannot initialize later', async () => {
  const bot = botStub();
  const previous = process.env.PERFORMANCE_MONITORING;
  process.env.PERFORMANCE_MONITORING = 'false';
  const ai = new MinecraftAI(bot);
  const initialization = ai.initialize();
  await ai.shutdown('disconnected_while_loading_chunks');
  await initialization;
  expect(ai.isInitialized).toBe(false);
  expect(ai.skillLibrary.listSkills()).toHaveLength(0);
  expect(ai.observationTimer).toBeUndefined();
  if (previous === undefined) delete process.env.PERFORMANCE_MONITORING;
  else process.env.PERFORMANCE_MONITORING = previous;
});

test('native operations that close over the raw bot cannot send mutations after cancellation', async () => {
  const bot = botStub();
  const write = jest.fn();
  bot._client = { write };
  const runner = new OperationRunner(bot);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const operation = runner.run({
    execute: async () => {
      await pending;
      bot._client.write('block_dig', { status: 0 });
    }
  }, {}, 5000);
  const assertion = expect(operation).rejects.toThrow('cancel native');
  await Promise.resolve();
  const cancellation = runner.cancel('cancel native');
  release();
  await cancellation;
  await assertion;
  expect(write).not.toHaveBeenCalled();
  expect(bot._client.write).toBe(write);
});

test('failed initialization can still shut down without propagating the original failure again', async () => {
  const bot = botStub();
  const previous = process.env.PERFORMANCE_MONITORING;
  process.env.PERFORMANCE_MONITORING = 'false';
  const ai = new MinecraftAI(bot);
  ai.waitForWorldReady = async () => { throw new Error('chunks unavailable'); };
  await expect(ai.initialize()).rejects.toThrow('chunks unavailable');
  await expect(ai.shutdown('initialization_failed')).resolves.toBeUndefined();
  expect(ai.isInitialized).toBe(false);
  if (previous === undefined) delete process.env.PERFORMANCE_MONITORING;
  else process.env.PERFORMANCE_MONITORING = previous;
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

// Deliberately ignore API credentials for this local, offline acceptance run.
Object.assign(process.env, {
  MULTIPLE_PLAYERS_COUNT: '1',
  PLAYER1_USERNAME: process.env.PLAYER1_USERNAME || 'MineCortexBot1',
  MINECRAFT_HOST: '127.0.0.1',
  MINECRAFT_PORT: '25565',
  MINECRAFT_VERSION: '1.21.4',
  PLAYER1_HOST: '127.0.0.1',
  PLAYER1_PORT: '25565',
  PLAYER1_AUTH: 'offline',
  MINECRAFT_AUTH: 'offline',
  AUTO_RESPAWN: 'false',
  OPENAI_API_KEY: '',
  AI_AUTOSTART: 'false',
  PERFORMANCE_MONITORING: 'false'
});
const { MultiplePlayersManager } = require('../examples/multiple-players');
const { PaperProcess } = require('./paper-process');
const { inventory } = require('../src/skills/BasicSkills');
const name = process.env.PLAYER1_USERNAME;
assert.match(name, /^[A-Za-z0-9]{3,16}$/);
const output = path.resolve(__dirname, '../.runtime');
fs.mkdirSync(output, { recursive: true });
const server = new PaperProcess(path.join(output, 'acceptance-paper.log'));
const report = {
  startedAt: new Date().toISOString(),
  versions: {
    node: process.version,
    mineflayer: require('mineflayer/package.json').version,
    ...require('../config/paper-version.json')
  },
  trials: [],
  checks: []
};
let manager;

async function until(predicate, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Acceptance wait deadline exceeded');
    await delay(50);
  }
}

async function fixture() {
  for (const command of [
    'gamerule doDaylightCycle false', 'gamerule doWeatherCycle false', 'gamerule doMobSpawning false',
    'gamerule randomTickSpeed 0', 'gamerule keepInventory false', 'time set day', 'weather clear',
    'fill -16 64 -16 32 80 16 air', 'fill -16 63 -16 32 63 16 grass_block',
    'setworldspawn 0 64 0', 'kill @e[type=item]',
    'fill 4 64 0 4 66 0 oak_log[axis=y]', 'setblock 4 67 0 oak_leaves[persistent=true]',
    'fill 10 64 0 12 64 0 stone'
  ]) await server.command(command);
}

async function connect() {
  manager = new MultiplePlayersManager();
  const result = await manager.spawnPlayer(1);
  assert.equal(result.success, true);
  const { bot, ai } = manager.players.get(1);
  let loadedPackets = 0;
  const originalWrite = bot._client.write.bind(bot._client);
  bot._client.write = (packet, ...args) => {
    if (packet === 'player_loaded') loadedPackets++;
    return originalWrite(packet, ...args);
  };
  await until(() => ai.isInitialized);
  assert.equal(loadedPackets, 1, '1.21.4 client readiness handshake');
  assert.equal(ai.skillLibrary.listSkills().length, 17);
  assert.equal(ai.voyagerAI.openai, null);
  await server.command(`clear ${name}`);
  await server.command(`gamemode survival ${name}`);
  await server.command(`tp ${name} 0.5 64 0.5`);
  await delay(400);
  assert.deepEqual(inventory(bot), {});
  const initial = await server.command(`data get entity ${name} Inventory`);
  assert.match(initial, /entity data: \[\]/);
  return { bot, ai, initial, loadedPackets };
}

async function serverInventory() {
  return server.command(`data get entity ${name} Inventory`);
}
async function serverCount(item) {
  // maxCount=0 is a read-only count on the server, not an item grant/removal.
  const raw = await server.command(`clear ${name} minecraft:${item} 0`);
  const found = raw.match(/Found (\d+) matching item/);
  if (found) return { count: Number(found[1]), raw };
  if (/No items were found/.test(raw)) return { count: 0, raw };
  throw new Error(`Unrecognized inventory count response: ${raw}`);
}

async function disconnect() {
  await manager.shutdown();
  await delay(300);
  const list = await server.command('list');
  assert.match(list, /There are 0 of a max/);
  manager = null;
  return list;
}

async function lifecycleChecks() {
  manager = new MultiplePlayersManager();
  await manager.spawnPlayer(1);
  const { bot, ai } = manager.players.get(1);
  let shutdown;
  bot.once('login', () => { shutdown = manager.shutdown(); });
  await until(() => shutdown);
  await shutdown;
  assert.equal(ai.isInitialized, false);
  assert.equal(ai.operations.active, null);
  assert.match(await server.command('list'), /There are 0 of a max/);
  report.checks.push({ check: 'disconnect_before_spawn_initialization', success: true });
  manager = null;
}

async function entrypointSmoke() {
  const child = spawn('npm', ['start'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, AI_AUTOSTART: 'false' },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let transcript = '';
  child.stdout.on('data', data => { transcript += data; });
  child.stderr.on('data', data => { transcript += data; });
  const exited = once(child, 'exit');
  try {
    await until(() => transcript.includes('AIシステムの初期化が完了しました'));
  } finally {
    process.kill(-child.pid, 'SIGTERM');
    await exited;
    await until(() => transcript.includes('全プレイヤーのシャットダウン完了'));
  }
  fs.writeFileSync(path.join(output, 'entrypoint-smoke.log'), transcript);
  assert.match(await server.command('list'), /There are 0 of a max/);
  report.checks.push({ check: 'npm_start_and_sigterm_shutdown', success: true });
}

async function controls() {
  await fixture();
  const { bot, ai } = await connect();
  await ai.processCommand('Lap', 'status');
  await until(() => ai.observer.updatedAt && ai.observer.nearbyUpdatedAt);
  await until(() => ai.observer.health === bot.health && ai.stateManager.getState('health') === bot.health, 3000);
  assert.equal(ai.observer.health, bot.health);
  assert.equal(ai.stateManager.getState('health'), bot.health);
  assert.deepEqual(Object.fromEntries(ai.observer.inventoryState), inventory(bot));
  await ai.processCommand('Lap', 'goto 2 64 3');
  await until(() => ai.taskResults.length === 1);
  assert.equal(ai.taskResults[0].result.success, true);
  assert.ok(bot.entity.position.distanceTo(require('vec3')(2.5, 64, 3.5)) < 2);
  report.checks.push({
    check: 'status_and_nearby_goto',
    position: bot.entity.position.clone(),
    observer: ai.observer.lastPosition
  });

  ai.setGoal({ type: 'move_to', target: { x: 29, y: 64, z: 3 } });
  await until(() => ai.operations.active && bot.pathfinder.isMoving());
  await ai.processCommand('Lap', 'stop');
  await until(() => !ai.operations.active && !ai.currentTask);
  const stopped = bot.entity.position.clone();
  await delay(1200);
  assert.ok(stopped.distanceTo(bot.entity.position) < 0.3);
  assert.equal(ai.paused, true);
  assert.equal(ai.goals.length, 0);
  assert.equal(bot.pathfinder.goal, null);
  report.checks.push({ check: 'stop_movement_and_stay_paused', position: stopped });

  const previous = ai.taskResults.length;
  // This valid but unreachable high target forces deadline cancellation while
  // a path is active; it must settle before the next explicit goto.
  ai.setGoal({ type: 'move_to', target: { x: 100, y: 100, z: 0 }, timeoutMs: 150 });
  await until(() => ai.taskResults.length > previous);
  assert.equal(ai.taskResults.at(-1).result.success, false);
  assert.match(ai.taskResults.at(-1).result.error, /deadline/i);
  assert.equal(ai.paused, true);
  assert.equal(ai.operations.active, null);
  assert.equal(bot.pathfinder.goal, null);
  const expired = bot.entity.position.clone();
  await delay(500);
  assert.ok(expired.distanceTo(bot.entity.position) < 0.3);
  report.checks.push({ check: 'deadline_cancels_operation', record: ai.taskResults.at(-1) });
  const beforeNewCommand = ai.taskResults.length;
  await ai.processCommand('Lap', 'goto 0 64 2');
  await until(() => ai.taskResults.length > beforeNewCommand);
  assert.equal(ai.taskResults.at(-1).result.success, true);
  report.checks.push({ check: 'goto_after_cancellation', record: ai.taskResults.at(-1) });

  const beforeMining = ai.taskResults.length;
  ai.setGoal({ type: 'gather_wood', amount: 3 });
  await until(() => bot.targetDigBlock);
  await ai.processCommand('Lap', 'stop');
  await until(() => ai.taskResults.length > beforeMining);
  const afterStop = inventory(bot);
  await delay(1200);
  assert.deepEqual(inventory(bot), afterStop);
  assert.equal(bot.targetDigBlock, null);
  report.checks.push({ check: 'stop_digging', record: ai.taskResults.at(-1) });
  await server.command('fill 4 64 0 4 67 0 air');
  async function expectFailure(goal, reason) {
    const before = ai.taskResults.length;
    ai.setGoal(goal);
    await until(() => ai.taskResults.length > before);
    const record = ai.taskResults.at(-1);
    assert.equal(record.result.success, false);
    assert.equal(record.result.reason, reason);
    assert.equal(ai.paused, true);
    assert.equal(ai.goals.length, 0);
    assert.equal(ai.operations.active, null);
    report.checks.push({ check: `failure_${reason}`, record });
  }
  await expectFailure({ type: 'gather_wood', amount: 1 }, 'TARGET_NOT_FOUND');
  await expectFailure({ type: 'craft_workbench' }, 'MISSING_MATERIALS');
  await expectFailure({ type: 'find_stone', amount: 1 }, 'NO_TOOL');
  await server.command('setblock 0 80 0 oak_log');
  await delay(200);
  await expectFailure({ type: 'gather_wood', amount: 1 }, 'UNREACHABLE');
  await disconnect();
}

async function trial(number) {
  await fixture();
  const { bot, ai, initial, loadedPackets } = await connect();
  const result = { number, initial, loadedPackets, steps: [] };
  report.trials.push(result);
  bot.on('taskResult', () => { ai.paused = true; });
  await ai.processCommand('Lap', 'start');
  const expected = ['gather_wood', 'craft_workbench', 'place_workbench', 'craft_tools', 'mine_block'];
  for (let index = 0; index < expected.length; index++) {
    await until(() => ai.taskResults.length > index, 120000);
    const record = ai.taskResults[index];
    assert.equal(record.task, expected[index]);
    assert.equal(record.result.success, true, JSON.stringify(record));
    const step = { ...record, serverInventory: await serverInventory() };
    if (index === 0) {
      step.serverCount = await serverCount('oak_log');
      assert.equal(step.serverCount.count, 3);
      assert.equal(record.after.oak_log - (record.before.oak_log || 0), 3);
    }
    if (index === 1) {
      step.serverCount = await serverCount('crafting_table');
      assert.equal(step.serverCount.count, 1);
      assert.equal(record.after.crafting_table, 1);
    }
    if (index === 2) {
      const p = record.result.position;
      step.serverBlock = await server.command(
        `execute if block ${p.x} ${p.y} ${p.z} crafting_table run gamerule doTileDrops`);
      assert.match(step.serverBlock, /Gamerule doTileDrops is currently set to: true/);
      assert.equal(record.after.crafting_table || 0, 0);
    }
    if (index === 3) {
      step.serverCount = await serverCount('wooden_pickaxe');
      assert.equal(step.serverCount.count, 1);
      assert.equal(record.after.wooden_pickaxe, 1);
    }
    if (index === 4) {
      step.serverCount = await serverCount('cobblestone');
      assert.equal(step.serverCount.count, 3);
      assert.equal(record.after.cobblestone - (record.before.cobblestone || 0), 3);
    }
    result.steps.push(step);
    ai.paused = false;
  }
  await ai.stop('Trial complete');
  result.finalInventory = inventory(bot);
  result.serverDisconnect = await disconnect();
  result.success = true;
  console.log(`ACCEPTANCE_TRIAL_${number}_PASSED ${JSON.stringify(result.finalInventory)}`);
}

async function run() {
  // Refuse to run a second server or modify an existing server on the test port.
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(25565, '127.0.0.1', () => probe.close(resolve));
  });
  try {
    await server.start();
    report.listener = execFileSync('ss', ['-ltnp'], { encoding: 'utf8' })
      .split('\n').find(line => line.includes(':25565'));
    assert.match(report.listener, /127\.0\.0\.1/);
    await lifecycleChecks();
    await controls();
    for (let number = 1; number <= 3; number++) await trial(number);
    await entrypointSmoke();
    report.success = true;
  } catch (error) {
    report.error = error.stack;
    if (manager) {
      report.failureInventory = await serverInventory();
      report.failureDrops = await server.command('execute as @e[type=item] run data get entity @s');
      report.failureColumn = [];
      for (let y = 64; y <= 66; y++) {
        report.failureColumn.push({
          y,
          raw: await server.command(
            `execute if block 4 ${y} 0 oak_log run gamerule doTileDrops`)
        });
      }
    }
    throw error;
  } finally {
    if (manager) await manager.shutdown();
    await server.stop();
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'acceptance-report.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });

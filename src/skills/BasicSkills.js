const { Vec3 } = require('vec3');
const { once } = require('node:events');
const { Movements, goals } = require('mineflayer-pathfinder');
const { check, sleep } = require('../utils/OperationRunner');

function failure(code, message = code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function count(bot, name) {
  return bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
}

function inventory(bot) {
  const result = {};
  for (const item of bot.inventory.items()) result[item.name] = (result[item.name] || 0) + item.count;
  return result;
}

function amountOf(amount) {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 64) failure('INVALID_AMOUNT');
  return amount;
}

function configureMovement(bot) {
  if (!bot.pathfinder) failure('NO_PATHFINDER');
  const movement = new Movements(bot);
  movement.canDig = false;
  movement.allow1by1towers = false;
  movement.allowParkour = false;
  movement.scafoldingBlocks = [];
  bot.pathfinder.setMovements(movement);
}

async function go(bot, goal, signal, timeoutMs = 15000) {
  check(signal);
  configureMovement(bot);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    bot.pathfinder.setGoal(null);
  }, timeoutMs);
  try {
    await bot.pathfinder.goto(goal);
    check(signal);
    if (timedOut) failure('UNREACHABLE', 'Movement deadline exceeded');
    if (!goal.isEnd(bot.entity.position.floored())) failure('UNREACHABLE');
  } catch (error) {
    check(signal);
    failure('UNREACHABLE', JSON.stringify({ goal, position: bot.entity.position, error: error.message, timedOut }));
  } finally {
    clearTimeout(timer);
    // The runner owns cancellation. A guarded bot cannot issue commands after abort.
    if (!signal?.aborted) bot.pathfinder.setGoal(null);
  }
}

async function moveTo(bot, params, { signal } = {}) {
  const { x, y, z } = params.target || params;
  if (![x, y, z].every(Number.isFinite)) failure('INVALID_POSITION');
  await go(bot, new goals.GoalNear(Math.floor(x), Math.floor(y), Math.floor(z), 1), signal,
    params.timeoutMs || 15000);
  return { success: true, position: bot.entity.position.clone() };
}

async function serverClick(bot, window, slot, button, signal) {
  check(signal);
  const copy = item => item ? { type: item.type, count: item.count } : null;
  const cursor = copy(window.selectedItem);
  const destination = copy(window.slots[slot]);
  let expectedCursor;
  let expectedSlot;
  if (button === 1 && cursor && (!destination || destination.type === cursor.type)) {
    expectedCursor = cursor.count === 1 ? null : { type: cursor.type, count: cursor.count - 1 };
    expectedSlot = { type: cursor.type, count: (destination?.count || 0) + 1 };
  } else if (button === 0 && !cursor && destination) {
    expectedCursor = destination;
    expectedSlot = null;
  } else if (button === 0 && cursor && (!destination || destination.type === cursor.type)) {
    expectedCursor = null;
    expectedSlot = { type: cursor.type, count: cursor.count + (destination?.count || 0) };
  } else failure('INVALID_CRAFT_CLICK');
  const matches = (actual, expected) => expected
    ? actual?.type === expected.type && actual?.count === expected.count
    : !actual;
  const confirmed = () => matches(window.selectedItem, expectedCursor) &&
    (slot === 0 || matches(window.slots[slot], expectedSlot));
  const Item = require('prismarine-item')(bot.registry);
  const response = once(bot, `setWindowItems:${window.id}`, { signal });
  response.catch(() => {});
  // The stale stateId requests authoritative post-click contents. Only this
  // click is sent; later resyncs are read-only and never repeat the mutation.
  bot._client.write('window_click', {
    windowId: window.id,
    stateId: -1,
    slot,
    mouseButton: button,
    mode: 0,
    changedSlots: [],
    cursorItem: Item.toNotch(window.selectedItem)
  });
  await response;
  const deadline = Date.now() + 2000;
  while (!confirmed()) {
    check(signal);
    if (Date.now() >= deadline) {
      failure('CLICK_NOT_CONFIRMED', JSON.stringify({
        slot,
        button,
        expectedCursor,
        expectedSlot,
        cursor: copy(window.selectedItem),
        actualSlot: copy(window.slots[slot])
      }));
    }
    // Window updates from earlier actions may still be arriving. Require the
    // exact cursor/slot effect instead of accepting the first packet as an ack.
    await sleep(50, signal);
    await bot._syncWindow(window);
  }
  check(signal);
}

async function syncInventory(bot, signal) {
  check(signal);
  await bot._syncWindow(bot.inventory);
  check(signal);
  if (bot.inventory.selectedItem) {
    const slot = bot.inventory.firstEmptySlotRange(bot.inventory.inventoryStart, bot.inventory.inventoryEnd);
    if (slot === null) failure('INVENTORY_FULL');
    await serverClick(bot, bot.inventory, slot, 0, signal);
  }
}

async function craft(bot, name, table, signal) {
  await syncInventory(bot, signal);
  const item = bot.registry.itemsByName[name];
  if (!item) failure('UNSUPPORTED_ITEM', name);
  const recipe = bot.recipesFor(item.id, null, 1, table)[0];
  if (!recipe) failure('MISSING_MATERIALS', `No available recipe for ${name}`);
  const before = count(bot, name);
  let window = bot.inventory;
  let opened = false;
  if (table) {
    const opening = new AbortController();
    const combined = signal ? AbortSignal.any([signal, opening.signal]) : opening.signal;
    const event = once(bot, 'windowOpen', { signal: combined });
    event.catch(() => {});
    try {
      await bot.activateBlock(table);
      [window] = await event;
      opened = true;
    } finally {
      opening.abort();
    }
  }
  try {
    await bot._syncWindow(window);
    check(signal);
    const width = opened ? 3 : 2;
    if (window.slots.slice(1, width * width + 1).some(Boolean)) failure('CRAFT_GRID_OCCUPIED');
    const click = (slot, button = 0) => serverClick(bot, window, slot, button, signal);
    const inputs = [];
    if (recipe.inShape) {
      for (let y = 0; y < recipe.inShape.length; y++) {
        for (let x = 0; x < recipe.inShape[y].length; x++) {
          const ingredient = recipe.inShape[y][x];
          if (ingredient.id !== -1) inputs.push({ slot: 1 + x + y * width, ingredient });
        }
      }
    } else {
      for (const [index, ingredient] of recipe.ingredients.entries()) {
        inputs.push({ slot: index + 1, ingredient });
      }
    }
    for (const { slot, ingredient } of inputs) {
      const source = window.findInventoryItem(ingredient.id, ingredient.metadata);
      if (!source) failure('MISSING_MATERIALS', name);
      const sourceSlot = source.slot;
      await click(sourceSlot); // pick up the ingredient stack
      await click(slot, 1); // place exactly one ingredient
      if (window.selectedItem) await click(sourceSlot); // return the remainder
    }
    const result = window.slots[0];
    if (result?.type !== item.id || result.count !== recipe.result.count) failure('CRAFT_RESULT_MISMATCH', name);
    // Never synthesize the result slot or count a client-side click as a craft.
    await click(0);
    if (window.selectedItem?.type !== item.id) failure('CRAFT_NOT_CONFIRMED', name);
    const merge = window.findItemRange(window.inventoryStart, window.inventoryEnd, item.id, null, true);
    const destination = merge && merge.count + recipe.result.count <= merge.stackSize
      ? merge.slot
      : window.firstEmptySlotRange(window.inventoryStart, window.inventoryEnd);
    if (destination === null) failure('INVENTORY_FULL');
    await click(destination);
    if (window.selectedItem) failure('CURSOR_NOT_CLEARED');
  } finally {
    if (opened && !signal?.aborted) await bot.closeWindow(window);
  }
  await syncInventory(bot, signal);
  if (count(bot, name) - before !== recipe.result.count) failure('CRAFT_NOT_CONFIRMED', name);
  return recipe.result.count;
}

async function planks(bot, required, signal) {
  const total = () => bot.inventory.items().filter(i => i.name.endsWith('_planks'))
    .reduce((n, i) => n + i.count, 0);
  while (total() < required) {
    check(signal);
    const log = bot.inventory.items().find(i => /_(log|stem)$/.test(i.name));
    if (!log) failure('MISSING_MATERIALS', `Need ${required} planks`);
    const name = log.name.replace(/_(log|stem)$/, '_planks');
    await craft(bot, name, null, signal);
  }
}

async function craftWorkbench(bot, _params, { signal } = {}) {
  await planks(bot, 4, signal);
  const crafted = await craft(bot, 'crafting_table', null, signal);
  return { success: true, crafted: { crafting_table: crafted } };
}

async function placeWorkbench(bot, _params, { signal } = {}) {
  check(signal);
  const table = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (!table) failure('MISSING_WORKBENCH');
  const origin = bot.entity.position.floored();
  let reference;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]]) {
    const floor = bot.blockAt(origin.offset(dx, -1, dz));
    const above = bot.blockAt(origin.offset(dx, 0, dz));
    if (floor?.boundingBox === 'block' && above?.name === 'air') {
      reference = floor;
      break;
    }
  }
  if (!reference) failure('NO_PLACEMENT_SITE');
  await bot.equip(table, 'hand');
  await syncInventory(bot, signal);
  const before = count(bot, 'crafting_table');
  await bot.placeBlock(reference, new Vec3(0, 1, 0));
  await syncInventory(bot, signal);
  const position = reference.position.offset(0, 1, 0);
  if (bot.blockAt(position)?.name !== 'crafting_table' || count(bot, 'crafting_table') !== before - 1) {
    failure('PLACEMENT_NOT_CONFIRMED');
  }
  return { success: true, placed: 'crafting_table', position };
}

async function craftTools(bot, { tools = ['wooden_pickaxe'] } = {}, { signal } = {}) {
  if (!Array.isArray(tools) || tools.length === 0 || tools.some(t => t !== 'wooden_pickaxe')) {
    failure('UNSUPPORTED_TOOLS', 'This milestone supports wooden_pickaxe');
  }
  const table = bot.findBlock({ matching: b => b.name === 'crafting_table', maxDistance: 16 });
  if (!table) failure('MISSING_WORKBENCH', 'Craft and place a workbench first');
  await go(bot, new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2), signal);
  const crafted = {};
  for (const tool of tools) {
    await planks(bot, count(bot, 'stick') >= 2 ? 3 : 5, signal);
    if (count(bot, 'stick') < 2) await craft(bot, 'stick', null, signal);
    crafted[tool] = (crafted[tool] || 0) + await craft(bot, tool, table, signal);
  }
  return { success: true, crafted };
}

async function craftWithWorkbench(bot, params, { signal } = {}) {
  const name = params.item || params.itemName;
  if (!name || (params.count ?? 1) !== 1) failure('UNSUPPORTED_CRAFT');
  const table = bot.findBlock({ matching: b => b.name === 'crafting_table', maxDistance: 16 });
  if (!table) failure('MISSING_WORKBENCH');
  await go(bot, new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2), signal);
  return { success: true, crafted: { [name]: await craft(bot, name, table, signal) } };
}

async function collect(bot, position, itemName, initial, amount, signal) {
  // Finish removing the requested blocks before walking into the trunk. Drops
  // can drift beyond pickup range while an upper log still obstructs that spot.
  if (process.env.DEBUG_MODE === 'true') console.log('COLLECT_FROM', bot.entity.position, 'TARGET', position);
  await go(bot, new goals.GoalBlock(position.x, Math.floor(bot.entity.position.y), position.z), signal);
  const deadline = Date.now() + 8000;
  while (count(bot, itemName) - initial < amount && Date.now() < deadline) {
    check(signal);
    const drops = Object.values(bot.entities).filter(e => e.position &&
      e.getDroppedItem?.()?.name === itemName && e.position.distanceTo(bot.entity.position) < 8);
    drops.sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
    if (drops[0]) {
      const p = drops[0].position;
      await go(bot, new goals.GoalBlock(Math.floor(p.x), Math.floor(bot.entity.position.y), Math.floor(p.z)), signal);
    }
    await sleep(100, signal);
  }
  if (count(bot, itemName) - initial < amount) {
    failure('DROP_NOT_COLLECTED', JSON.stringify({
      itemName,
      required: amount,
      collected: count(bot, itemName) - initial,
      botPosition: bot.entity.position
    }));
  }
}

async function mineBlocks(bot, params, { signal } = {}) {
  const { blockType, amount = 1, position } = params;
  amountOf(amount);
  // Block names and harvested item names are deliberately separate.
  const itemName = blockType === 'stone' ? 'cobblestone' : blockType;
  if (!bot.registry.blocksByName[blockType] ||
      !(['stone', 'cobblestone'].includes(blockType) || /_(log|stem)$/.test(blockType))) {
    failure('UNSUPPORTED_BLOCK', String(blockType));
  }
  if (['stone', 'cobblestone'].includes(blockType)) {
    const pickaxe = bot.inventory.items().find(i => i.name.endsWith('_pickaxe'));
    if (!pickaxe) failure('NO_TOOL', 'A pickaxe is required to collect stone');
    await bot.equip(pickaxe, 'hand');
    await syncInventory(bot, signal);
  }
  const initial = count(bot, itemName);
  let lastPosition;
  for (let mined = 0; mined < amount; mined++) {
    check(signal);
    if (bot.inventory.emptySlotCount() === 0) failure('INVENTORY_FULL');
    const block = position && mined === 0
      ? bot.blockAt(new Vec3(position.x, position.y, position.z))
      : bot.findBlock({ matching: b => b.name === blockType, maxDistance: 32 });
    if (!block || block.name !== blockType) failure('TARGET_NOT_FOUND', blockType);
    await go(bot, new goals.GoalNear(block.position.x, Math.floor(bot.entity.position.y), block.position.z, 2), signal);
    check(signal);
    if (!bot.canDigBlock(block)) failure('UNREACHABLE', blockType);
    if (process.env.DEBUG_MODE === 'true') console.log('MINE_BLOCK', block.position, 'FROM', bot.entity.position);
    // Mineflayer checks exposed faces; a center ray can falsely reject the
    // bottom log of a vertical trunk when the next log hides its center.
    await bot.dig(block, true, 'raycast');
    check(signal);
    if (bot.blockAt(block.position)?.type === block.type) failure('DIG_NOT_CONFIRMED');
    lastPosition = block.position;
    await sleep(200, signal);
  }
  await collect(bot, lastPosition, itemName, initial, amount, signal);
  return { success: true, blockType, itemName, itemsCollected: count(bot, itemName) - initial, targetReached: true };
}

async function gatherWood(bot, params = {}, context) {
  const amount = amountOf(params.amount ?? 3);
  const tree = bot.findBlock({ matching: b => /_(log|stem)$/.test(b.name), maxDistance: 32 });
  if (!tree) failure('TARGET_NOT_FOUND', 'No logs within 32 blocks');
  return mineBlocks(bot, { blockType: tree.name, amount }, context);
}

module.exports = {
  moveTo,
  gatherWood,
  mineBlocks,
  craftWorkbench,
  placeWorkbench,
  craftTools,
  craftWithWorkbench,
  inventory,
  count,
  go,
  serverClick
};

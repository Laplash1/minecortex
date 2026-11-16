// Keep world physics in the Paper acceptance test. Here a completed dig with no
// inventory change must fail, including the stone -> cobblestone distinction.
jest.mock('mineflayer-pathfinder', () => ({
  ...jest.requireActual('mineflayer-pathfinder'),
  Movements: jest.fn().mockImplementation(() => ({}))
}));
const { Vec3 } = require('vec3');
const { mineBlocks } = require('../src/skills/BasicSkills');

function miningBot(dropCount) {
  let mined = false;
  const position = new Vec3(0, 64, 0);
  const items = [{ name: 'wooden_pickaxe', count: 1 }];
  return {
    entity: { position },
    entities: {},
    registry: { blocksByName: { stone: { id: 1 } } },
    inventory: { items: () => items, emptySlotCount: () => 35 },
    pathfinder: { setMovements: jest.fn(), setGoal: jest.fn(), goto: async () => {} },
    findBlock: () => ({ name: 'stone', type: 1, position }),
    canDigBlock: () => true,
    blockAt: () => ({ type: mined ? 0 : 1 }),
    equip: async () => {},
    _syncWindow: async () => {},
    dig: async () => {
      mined = true;
      if (dropCount) items.push({ name: 'cobblestone', count: dropCount });
    }
  };
}

test('a completed stone dig without collected cobblestone fails rather than reporting mining success', async () => {
  const result = mineBlocks(miningBot(0), { blockType: 'stone', amount: 1 });
  const assertion = expect(result).rejects.toMatchObject({ code: 'DROP_NOT_COLLECTED' });
  await assertion;
}, 15000);

test('stone mining success reports the actual cobblestone inventory delta', async () => {
  const result = mineBlocks(miningBot(1), { blockType: 'stone', amount: 1 });
  await expect(result).resolves.toMatchObject({ success: true, itemName: 'cobblestone', itemsCollected: 1 });
});

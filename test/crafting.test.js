const { EventEmitter } = require('node:events');
const { serverClick } = require('../src/skills/BasicSkills');

test('a stale window response is not confirmation and never causes a second crafting click', async () => {
  const registry = require('prismarine-registry')('1.21.4');
  const Item = require('prismarine-item')(registry);
  const planks = new Item(registry.itemsByName.oak_planks.id, 3);
  const window = { id: 0, selectedItem: planks, slots: Array(46).fill(null) };
  const bot = new EventEmitter();
  bot.registry = registry;
  bot._client = {
    write: jest.fn(() => setImmediate(() => bot.emit('setWindowItems:0')))
  };
  bot._syncWindow = jest.fn(async () => {
    window.selectedItem = null;
    window.slots[9] = planks;
  });
  await serverClick(bot, window, 9, 0);
  expect(bot._syncWindow).toHaveBeenCalledTimes(1);
  expect(bot._client.write).toHaveBeenCalledTimes(1);
  expect(bot._client.write.mock.calls[0][1]).toMatchObject({ slot: 9, stateId: -1, mode: 0 });
  expect(window.selectedItem).toBe(null);
  expect(window.slots[9].count).toBe(3);
});

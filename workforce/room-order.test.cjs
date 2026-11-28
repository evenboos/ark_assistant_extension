const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const context = vm.createContext({});
vm.runInContext(readFileSync(join(__dirname, 'room-planner.js'), 'utf8'), context);
const room = (id, type, floor, col, extra = {}) => ({ id, type, floor, col, level: 1, width: 1, builtAt: 0, upgradeAt: null, incident: null, craft: null, ...extra });
const state = () => ({ serverTime: 1000, state: { depth: 2, residents: [], rooms: [room(1, 'elevator', 1, 1), room(2, 'elevator', 2, 1), room(3, 'power', 1, 2), room(4, 'storage', 2, 2)] } });

test('新版六格房间整理后仍合并为六格并识别分拣站', () => {
  const view = state();
  view.state.rooms[2].width = 6;
  view.state.rooms[3].type = 'sorter';
  const result = context.planShelterRooms(view);
  assert.ok(result.rooms.some(item => item.type === 'power' && item.width === 6));
  assert.ok(result.rooms.some(item => item.type === 'sorter'));
});
test('自定义排序从上到下生效，原默认规划仍可调用', () => {
  const order = Array.from(context.shelterRoomOrder(), item => item.key);
  const original = context.planShelterRooms(state());
  const custom = context.planShelterRooms(state(), [...order].reverse());
  const first = plan => [...plan.rooms].sort((a,b) => a.floor - b.floor || a.col - b.col)[0].type;
  assert.equal(first(original), 'power');
  assert.equal(first(custom), 'storage');
});
test('未知、重复或不完整排序在规划前拒绝', () => {
  const order = Array.from(context.shelterRoomOrder(), item => item.key);
  for (const invalid of [[], order.slice(1), [...order.slice(1), order[1]], [...order.slice(1), 'unknown:']]) {
    assert.throws(() => context.planShelterRooms(state(), invalid), /房间排序无效/);
  }
});
test('自定义排序继续拒绝升级中的房间', () => {
  const view = state(); view.state.rooms[2].upgradeAt = 2000;
  assert.throws(() => context.planShelterRooms(view), /升级/);
});

test('夜间冻结的大门掠夺者不阻塞房间整理，其他事件和白天大门事件仍阻塞', () => {
  const at = (hour, minute = 0) => new Date(2026, 10, 24, hour, minute, 0, 0).getTime();
  const frozen = state();
  frozen.state.rooms.push(room(5, 'door', 1, 3, { incident: { kind: 'raiders' } }));
  frozen.serverTime = at(0, 30);
  assert.doesNotThrow(() => context.planShelterRooms(frozen));

  const ordinary = structuredClone(frozen);
  ordinary.state.rooms[4].incident = { kind: 'fire' };
  assert.throws(() => context.planShelterRooms(ordinary), /正在事件/);

  const daytime = structuredClone(frozen);
  daytime.serverTime = at(8);
  assert.throws(() => context.planShelterRooms(daytime), /正在事件/);
});

test('六格合并房间可以参与整理，并恢复为六格合并', () => {
  const view = { serverTime: 1000, state: { depth: 2, residents: [], rooms: [
    room(1, 'elevator', 1, 1), room(2, 'elevator', 2, 1),
    room(3, 'power', 1, 2, { width: 6 }), room(4, 'storage', 2, 2)
  ] } };
  const plan = context.planShelterRooms(view);
  assert.ok(plan.rooms.some(item => item.type === 'power' && item.width === 6));
  assert.ok(plan.steps.length > 0);
});

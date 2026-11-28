const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const vm = require('node:vm');

const planner = readFileSync(join(__dirname, 'planner.js'), 'utf8');
const runner = readFileSync(join(__dirname, 'runner.js'), 'utf8');
const now = 1000000;
const stats = values => ({ str: 3, per: 3, end: 3, cha: 3, int: 3, agi: 3, lck: 3, ...values });
const person = (id, values = {}) => ({ id, name: `居民${id}`, roomId: null, adultAt: 0, xp: 0,
  stats: stats(), weaponId: null, outfitId: null, away: null, deadAt: null, ...values });
const outfit = (id, bonus) => ({ id, name: `服装${id}`, slot: 'outfit', bonus });
const weapon = (id, damage) => ({ id, name: `武器${id}`, slot: 'weapon', damage });
const room = (id, type, values = {}) => ({ id, type, incident: null, ...values });
const view = (residents = [], items = [], rooms = []) => ({ serverTime: now, state: { residents, items, rooms } });
const plain = value => JSON.parse(JSON.stringify(value));
const load = globals => vm.createContext({ AbortSignal, crypto: { randomUUID }, location: { origin: 'https://game.arkengine.me', pathname: '/shelter' }, ...globals });
function plan(state, options) {
  const context = load();
  vm.runInContext(planner, context);
  return plain(context.planShelterEquipment(state, options));
}
function equip(state, residentId, slot, itemId) {
  const field = slot === 'weapon' ? 'weaponId' : 'outfitId';
  if (itemId !== null) for (const resident of state.state.residents) if (resident[field] === itemId) resident[field] = null;
  state.state.residents.find(resident => resident.id === residentId)[field] = itemId;
}

test('新版锁定、赠送及外出预约装备不参与一键装备分配', () => {
  const state = view([
    person(1, { locked: true, outfitId: 10 }),
    person(2, { giftOffer: { to: 'friend' }, weaponId: 20 }),
    person(3, { away: { reservedEquipment: { outfit: 11, weapon: 21 } } }),
    person(4, { roomId: 1 })
  ], [outfit(10, { lck: 7 }), outfit(11, { lck: 6 }), outfit(12, { lck: 5 }),
    weapon(20, [30, 30]), weapon(21, [20, 20]), weapon(22, [10, 10])], [room(1, 'sorter')]);
  const result = plan(state);
  assert.deepEqual(result.targets, [{ residentId: 4, weaponId: 22, outfitId: 12 }]);
});

test('提交前新增的外出预约装备不得被抢走', async () => {
  const state = view([person(1), person(2, { away: { kind: 'explore' } })], [weapon(20, [20, 20])]);
  assert.equal((await run(state, { weapons: true, outfits: false })).actions.length, 1);
  const result = await run(state, { weapons: true, outfits: false }, {
    before({ server, gets, action }) {
      if (!action && gets === 2) server.state.residents[1].away.reservedEquipment = { weapon: 20 };
    }
  });
  assert.equal(result.actions.length, 0);
});

test('只有幸运属性收益的分拣站优先获得幸运服装', () => {
  const state = view([person(1, { roomId: 1 }), person(2, { roomId: 2 })],
    [outfit(10, { lck: 7 }), outfit(11, { str: 6 })], [room(1, 'sorter'), room(2, 'power')]);
  assert.deepEqual(plan(state).targets.map(item => item.outfitId), [10, 11]);
});
function applyPlan(state, result) {
  const updated = structuredClone(state);
  for (const target of result.targets) Object.assign(updated.state.residents.find(resident => resident.id === target.residentId), {
    weaponId: target.weaponId, outfitId: target.outfitId
  });
  return updated;
}
async function run(state, options = { weapons: true, outfits: true }, hooks = {}) {
  const server = structuredClone(state), actions = [];
  let gets = 0;
  const context = load(hooks.globals);
  context.fetch = async (url, init) => {
    const action = init.method === 'POST' ? JSON.parse(init.body).action : null;
    if (action) actions.push(action);
    else gets++;
    const override = await hooks.before?.({ server, context, action, gets, actions });
    if (override) return override;
    if (action) equip(server, action.residentId, action.slot, action.itemId);
    await hooks.after?.({ server, context, action, gets, actions });
    return { ok: true, status: 200, redirected: false, json: async () => structuredClone(action ? { view: server } : server) };
  };
  vm.runInContext(planner + '\n' + runner, context);
  context.startShelterEquipment(options);
  for (let turn = 0; context.__fengbaoEquipmentAssignment.running && turn < 100; turn++) await new Promise(setImmediate);
  assert.equal(context.__fengbaoEquipmentAssignment.running, false, '任务必须结束');
  return { server, actions, gets, task: plain(context.__fengbaoEquipmentAssignment), context };
}

test('服装全局匹配优于按居民顺序贪心，重复运行无变更', () => {
  const state = view([person(1, { roomId: 1 }), person(2, { roomId: 2 })],
    [outfit(10, { str: 5, agi: 5 }), outfit(11, { str: 4 })], [room(1, 'power'), room(2, 'diner')]);
  const result = plan(state);
  assert.deepEqual(result.targets.map(target => target.outfitId), [11, 10]);
  assert.equal(plan(applyPlan(state, result)).changes.length, 0);
});

test('保护儿童、外出、倒下和事件房间居民及其装备', () => {
  const state = view([
    person(1), person(2, { adultAt: now + 1, outfitId: 11 }),
    person(3, { away: { kind: 'explore', id: 1 }, weaponId: 12 }),
    person(4, { deadAt: now - 1, outfitId: 13 }), person(5, { roomId: 1, weaponId: 14 })
  ], [outfit(10, { str: 1 }), outfit(11, { str: 7 }), weapon(12, [20, 30]), outfit(13, { str: 6 }), weapon(14, [19, 20])],
  [room(1, 'power', { incident: { kind: 'fire' } })]);
  const result = plan(state);
  assert.equal(result.excluded.length, 4);
  assert.deepEqual(result.targets, [{ residentId: 1, weaponId: null, outfitId: 10 }]);
});

test('岗位属性按含装备上限 17 计算，多余加成分给其他生产岗位', () => {
  const state = view([person(1, { roomId: 1, stats: stats({ str: 10 }) }), person(2, { roomId: 1 })],
    [outfit(10, { str: 10 }), outfit(11, { str: 7 })], [room(1, 'power')]);
  assert.deepEqual(plan(state).targets.map(target => target.outfitId), [11, 10]);
});

test('训练、宿舍、电台不为训练或魅力抢占生产服装', () => {
  for (const type of ['training', 'quarters', 'radio']) {
    const state = view([person(1, { roomId: 1 }), person(2, { roomId: 2 })],
      [outfit(10, { cha: 7, str: 1 }), outfit(11, { str: 1 })], [room(1, type, { trainStat: 'cha' }), room(2, 'power')]);
    // 岗位收益相同，保持已有穿戴，避免为了基础属性岗位强制换装。
    state.state.residents[0].outfitId = 11;
    state.state.residents[1].outfitId = 10;
    assert.equal(plan(state).changes.length, 0);
  }
});

test('大门守卫优先强武器，其他居民按最终服装战力排序', () => {
  const state = view([person(1, { roomId: 1 }), person(2, { xp: 3 * 49 ** 2 }), person(3)],
    [weapon(10, [1, 3]), weapon(11, [10, 20]), weapon(12, [5, 9])], [room(1, 'door')]);
  assert.deepEqual(plan(state).targets.map(target => target.weaponId), [11, 12, 10]);
});

test('同伤害保留本人武器，装备不足时不会重复使用物品', () => {
  const state = view([person(1, { weaponId: 11 }), person(2, { weaponId: 10 }), person(3)],
    [weapon(10, [1, 3]), weapon(11, [2, 2])]);
  const result = plan(state);
  assert.equal(result.changes.length, 0);
  const equipped = result.targets.map(target => target.weaponId).filter(id => id !== null);
  assert.equal(new Set(equipped).size, 2);
});

test('只选武器或只选服装保留另一槽位，空装备池正常结束', () => {
  const state = view([person(1, { roomId: 1, weaponId: 10, outfitId: 11 }), person(2, { xp: 300 })],
    [weapon(10, [1, 3]), outfit(11, { str: 5 })], [room(1, 'power')]);
  assert.deepEqual(plan(state, { weapons: true, outfits: false }).targets.map(target => target.outfitId), [11, null]);
  assert.deepEqual(plan(state, { weapons: false, outfits: true }).targets.map(target => target.weaponId), [10, null]);
  assert.equal(plan(view([person(1)])).changes.length, 0);
  assert.throws(() => plan(state, { weapons: false, outfits: false }), /至少选择/);
});

test('无效归属、未知槽位及维护状态在提交前拒绝', () => {
  assert.throws(() => plan(view([person(1, { weaponId: 2 })])), /归属/);
  assert.throws(() => plan(view([person(1, { weaponId: 10 }), person(2, { weaponId: 10 })], [weapon(10, [1, 2])])), /归属/);
  assert.throws(() => plan(view([person(1)], [{ id: 1, name: '未知物品', slot: 'pet' }])), /格式/);
  assert.throws(() => plan({ ...view(), switches: { frozen: true } }), /维护/);
});

test('匈牙利匹配随机矩阵结果等于穷举最优值', () => {
  const context = load();
  vm.runInContext(planner, context);
  let seed = 20261117;
  const next = () => (seed = (1664525 * seed + 1013904223) >>> 0) % 20;
  const exhaustive = (scores, row = 0, used = new Set()) => row === scores.length ? 0 : Math.max(...scores[row].map((score, column) => {
    if (used.has(column)) return -Infinity;
    return score + exhaustive(scores, row + 1, new Set([...used, column]));
  }));
  for (let sample = 0; sample < 60; sample++) {
    const rows = 1 + next() % 4, columns = rows + next() % 3;
    const scores = Array.from({ length: rows }, () => Array.from({ length: columns }, next));
    const chosen = context.matchShelterOutfits(scores);
    assert.equal(chosen.reduce((sum, column, row) => sum + scores[row][column], 0), exhaustive(scores));
    assert.equal(new Set(chosen).size, rows);
  }
});

test('执行原生直接转移及互换，最终再次运行不提交操作', async () => {
  const state = view([person(1, { roomId: 1, outfitId: 10, weaponId: 12 }), person(2, { roomId: 2, outfitId: 11, weaponId: 13 })],
    [outfit(10, { agi: 5 }), outfit(11, { str: 5 }), weapon(12, [10, 20]), weapon(13, [1, 3])],
    [room(1, 'power'), room(2, 'diner')]);
  const result = await run(state);
  assert.match(result.task.message, /分配完成/);
  assert.deepEqual(result.server.state.residents.map(resident => resident.outfitId), [11, 10]);
  assert.equal(result.actions.length, 2);
  const repeated = await run(result.server);
  assert.equal(repeated.actions.length, 0);
  assert.match(repeated.task.message, /无需调整/);
});

test('转移后原主人已空槽时不多发卸下请求，未选槽位不变', async () => {
  const state = view([person(1, { weaponId: 10, outfitId: 11 }), person(2, { roomId: 1 })],
    [weapon(10, [5, 10]), outfit(11, { lck: 2 })], [room(1, 'door')]);
  const result = await run(state, { weapons: true, outfits: false });
  assert.equal(result.actions.length, 1);
  assert.deepEqual(result.server.state.residents.map(resident => resident.weaponId), [null, 10]);
  assert.equal(result.server.state.residents[0].outfitId, 11);
  assert.match(result.task.message, /分配完成/);
});

test('手动改变装备归属或新事件发生时，下一次提交前停止', async () => {
  for (const mutate of [
    server => { server.state.residents[0].weaponId = 10; },
    server => { server.state.rooms[0].incident = { kind: 'fire' }; }
  ]) {
    const state = view([person(1, { roomId: 1 })], [weapon(10, [5, 10])], [room(1, 'power')]);
    const result = await run(state, undefined, { before: ({ server, gets }) => { if (gets === 2) mutate(server); } });
    assert.equal(result.actions.length, 0);
    assert.match(result.task.message, /已停止/);
  }
});

test('穿戴返回异常、重试码、登录过期、网络错误均停止且不重试', async () => {
  const state = view([person(1), person(2)], [weapon(10, [5, 10]), weapon(11, [1, 3])]);
  const failures = [
    () => ({ ok: true, status: 200, json: async () => ({ code: 'retry' }) }),
    () => ({ ok: false, status: 401 }),
    () => { throw new Error('请求超时，结果未知'); },
    () => ({ ok: true, status: 200, json: async () => ({ view: structuredClone(state) }) })
  ];
  for (const fail of failures) {
    const result = await run(state, undefined, { before: ({ action }) => action ? fail() : null });
    assert.equal(result.actions.length, 1);
    assert.equal(result.task.completed.length, 0);
    assert.match(result.task.message, /已停止/);
  }
});

test('停止保留已确认的穿戴并跳过后续请求', async () => {
  const state = view([person(1), person(2)], [weapon(10, [5, 10]), weapon(11, [1, 3])]);
  const result = await run(state, undefined, { after: ({ context, action }) => { if (action) context.__fengbaoEquipmentAssignment.stopRequested = true; } });
  assert.equal(result.actions.length, 1);
  assert.equal(result.task.completed.length, 1);
  assert.match(result.task.message, /已停止分配/);
});

test('托管、居民安排、宿舍安排、改名任务阻止装备任务发请求', async () => {
  for (const key of ['__fengbaoShelterAuto', '__fengbaoWorkAssignment', '__fengbaoDormAssignment', '__fengbaoResidentRename']) {
    const result = await run(view(), undefined, { globals: { [key]: { running: true } } });
    assert.equal(result.gets, 0);
    assert.equal(result.actions.length, 0);
    assert.match(result.task.message, /其他避难所任务/);
  }
});

test('装备任务也阻止其他任务调动、改名或启动托管', async () => {
  const entries = [
    ['workforce/runner.js', 'startWorkforce()'], ['workforce/room-runner.js'], ['residents/rename.js'],
    ['pairing/assign.js', 'startDormAssignment([])'],
    ['stewardship/runner.js', 'startShelterAuto(600, 6, false, 20)'],
    ['workforce/incidents.js', 'runShelterIncidents()'], ['incidents/restore.js', 'restoreShelterPositions()']
  ];
  for (const [file, call] of entries) {
    let requests = 0;
    const context = load({
      __fengbaoEquipmentAssignment: { running: true }, setTimeout, clearTimeout,
      fetch: async () => { requests++; throw new Error('不应提交请求'); }
    });
    if (file === 'workforce/runner.js') vm.runInContext(readFileSync(join(__dirname, '..', 'workforce/planner.js'), 'utf8'), context);
    if (file === 'pairing/assign.js') for (const dependency of ['resident-state.js', 'skip-unavailable.js']) {
      vm.runInContext(readFileSync(join(__dirname, '../pairing', dependency), 'utf8'), context);
    }
    vm.runInContext(readFileSync(join(__dirname, '..', file), 'utf8'), context);
    if (call) vm.runInContext(call, context);
    await new Promise(setImmediate);
    assert.equal(requests, 0, file);
    for (const key of ['__fengbaoWorkAssignment', '__fengbaoResidentRename', '__fengbaoDormAssignment', '__fengbaoShelterAuto']) {
      if (context[key]) assert.equal(context[key].running, false, file);
    }
  }
});

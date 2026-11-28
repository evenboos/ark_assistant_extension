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
const person = (id, values = {}) => ({ id, name: `居民${id}`, roomId: null, adultAt: 0, xp: 0, happiness: 100,
  stats: stats(), weaponId: null, outfitId: null, away: null, deadAt: null, familyCooldownUntil: null, ...values });
const room = (id, type, values = {}) => ({ id, type, level: 1, width: 1, floor: id, col: 0, builtAt: 0,
  upgradeAt: null, incident: null, unpowered: false, craft: null, trainStat: null, ...values });
const view = (residents = [], rooms = [], items = []) => ({ serverTime: now,
  state: { residents, rooms, items, legacy: { perks: {} } } });
const plain = value => JSON.parse(JSON.stringify(value));
const load = globals => vm.createContext({ AbortSignal, crypto: { randomUUID },
  location: { origin: 'https://game.arkengine.me', pathname: '/shelter' }, ...globals });
function plan(state, options) {
  const context = load();
  vm.runInContext(planner, context);
  return plain(context.planWorkforce(state, options));
}
const at = (hour, minute = 0) => new Date(2026, 10, 24, hour, minute, 0, 0).getTime();

test('新版六格合并房可安排十二人，锁定和预约赠送居民保留原岗占位', () => {
  const residents = Array.from({ length: 13 }, (_, index) => person(index + 1));
  Object.assign(residents[0], { locked: true, roomId: 1 });
  Object.assign(residents[1], { giftOffer: { to: 'friend' }, roomId: 1 });
  const state = view(residents, [room(1, 'power', { width: 6 })]);
  const result = plan(state);
  valid(state, result);
  assert.equal(result.excluded.length, 2);
  assert.equal(result.assignments.filter(item => item.roomId === 1).length, 10);
});

test('新版分拣站按幸运安排并计生产耗电，随机物资不计确定资源收入', () => {
  const state = view([person(1, { stats: stats({ lck: 10 }) })], [room(1, 'sorter', { width: 6 })]);
  const result = plan(state);
  assert.equal(result.assignments[0].roomId, 1);
  assert.equal(result.expected.power, -6);
  assert.equal(result.expected.scrap, 0);
});

test('分拣站与普通生产争用人手时保留增量产出优化，重复安排稳定', () => {
  const state = view([person(1, { stats: stats({ lck: 10, str: 1 }) }), person(2, { stats: stats({ lck: 10, str: 1 }) }),
    person(3, { stats: stats({ str: 10, lck: 1 }) }), person(4, { stats: stats({ str: 10, lck: 1 }) })],
    [room(1, 'sorter'), room(2, 'power')]);
  for (const strategy of ['production', 'highest']) {
    const result = plan(state, { strategy });
    assert.deepEqual(result.assignments.filter(item => item.roomId === 1).map(item => item.residentId).sort(), [1, 2]);
    assert.equal(plan(applied(state, result), { strategy }).changed, 0);
    assert.deepEqual(Object.keys(result.expected).sort(), ['food', 'parts', 'power', 'scrap', 'stimpak', 'water']);
  }
});

test('提交前居民被锁定时取消一键安排', async () => {
  const result = await run(view([person(1)], [room(1, 'power')]), {}, {
    before({ server, gets, action }) { if (!action && gets === 2) server.state.residents[0].locked = true; }
  });
  assert.equal(result.actions.length, 0);
});

test('暂停电台招募仍加心情，第一间空电台不遮蔽其他值班电台', () => {
  const state = view([person(1, { roomId: 2 })], [room(1, 'radio'), room(2, 'radio')]);
  state.state.radioRecruitmentPaused = true;
  const mood = projectedHappiness(state);
  assert.equal(mood.radioActive, true);
  assert.equal(mood.residents[0].target, 95);
});

test('夜间冻结按北京时间判断，不取电脑本地时区', () => {
  const context = load(); vm.runInContext(planner, context);
  for (const [iso, required] of [['2026-11-27T15:59:00Z', true], ['2026-11-27T16:00:00Z', false],
    ['2026-11-27T23:59:00Z', false], ['2026-11-28T00:00:00Z', true]]) {
    assert.equal(context.workforceDoorGuardRequired({ serverTime: Date.parse(iso) }), required, iso);
  }
});
function projectedHappiness(state, assignments = []) {
  const context = load();
  vm.runInContext(planner, context);
  return plain(context.workforceModel(state).happiness(assignments));
}
function projectedNets(state, assignments = []) {
  const context = load();
  vm.runInContext(planner, context);
  const model = context.workforceModel(state);
  return { net: plain(model.net(assignments)), longTermNet: plain(model.longTermNet(assignments)) };
}
function productionRate(state, residentId, roomId, happiness) {
  const context = load();
  vm.runInContext(planner, context);
  const model = context.workforceModel(state);
  return model.rate(state.state.residents.find(resident => resident.id === residentId),
    state.state.rooms.find(room => room.id === roomId), happiness);
}function applied(state, result) {
  const next = structuredClone(state);
  for (const assignment of result.assignments) next.state.residents.find(resident => resident.id === assignment.residentId).roomId = assignment.roomId;
  return next;
}
function valid(state, result) {
  assert.equal(new Set(result.assignments.map(item => item.residentId)).size, result.assignments.length);
  const next = applied(state, result);
  for (const destination of next.state.rooms.filter(room => !room.incident)) {
    const count = next.state.residents.filter(resident => resident.roomId === destination.id && resident.deadAt === null && resident.adultAt <= now).length;
    assert.ok(count <= destination.width * 2, `房间 ${destination.id} 容量 ${count}/${destination.width * 2}`);
  }
  for (const protectedResident of result.excluded) assert.equal(next.state.residents.find(item => item.id === protectedResident.id).roomId,
    state.state.residents.find(item => item.id === protectedResident.id).roomId);
}
async function run(state, options, hooks = {}) {
  const server = structuredClone(state), actions = [];
  let gets = 0;
  const context = load(hooks.globals);
  context.fetch = async (url, init) => {
    const action = init.method === 'POST' ? JSON.parse(init.body).action : null;
    if (action) actions.push(action); else gets++;
    const response = await hooks.before?.({ server, context, action, gets, actions });
    if (response) return response;
    if (action) {
      assert.equal(action.type, 'assign');
      const resident = server.state.residents.find(item => item.id === action.residentId);
      if (action.roomId !== null) {
        const destination = server.state.rooms.find(item => item.id === action.roomId);
        const occupied = server.state.residents.filter(item => item.roomId === action.roomId && item.adultAt <= now && item.deadAt === null).length;
        assert.ok(occupied < destination.width * 2, '提交时目标必须有位');
      }
      resident.roomId = action.roomId;
    }
    await hooks.after?.({ server, context, action, gets, actions });
    return { ok: true, status: 200, redirected: false, json: async () => structuredClone(action ? { view: server } : server) };
  };
  vm.runInContext(planner + '\n' + runner, context);
  context.startWorkforce(options);
  for (let turn = 0; context.__fengbaoWorkAssignment.running && turn < 200; turn++) await new Promise(setImmediate);
  assert.equal(context.__fengbaoWorkAssignment.running, false);
  return { server, actions, gets, task: plain(context.__fengbaoWorkAssignment), context };
}

test('默认产出优先，不新增魅力和幸运训练', () => {
  const state = view([person(1, { stats: stats({ cha: 10, lck: 10, str: 8 }) })], [
    room(1, 'training', { trainStat: 'cha' }), room(2, 'training', { trainStat: 'lck' }), room(3, 'training', { trainStat: 'str' })
  ]);
  const result = plan(state);
  assert.deepEqual(result.options, { strategy: 'production', trainCharisma: false, trainLuck: false, reassignTraining: false });
  assert.equal(result.assignments[0].roomId, 3);
});

test('魅力和幸运训练开关独立生效，排除后按其他属性选训练室', () => {
  for (const strategy of ['production', 'highest']) for (const [key, option] of [['cha', 'trainCharisma'], ['lck', 'trainLuck']]) {
    const state = view([person(1, { stats: stats({ [key]: 8, str: 6 }) })], [
      room(1, 'training', { trainStat: key }), room(2, 'training', { trainStat: 'str' })
    ]);
    assert.equal(plan(state, { strategy }).assignments[0].roomId, 2);
    assert.equal(plan(state, { strategy, [option]: true }).assignments[0].roomId, 1);
  }
});

test('原训练室默认保留，明确选重新安排才转生产或其他允许的训练室', () => {
  const state = view([person(1, { roomId: 1 })], [room(1, 'training', { trainStat: 'cha' }), room(2, 'power')]);
  assert.equal(plan(state).assignments.length, 0);
  const result = plan(state, { reassignTraining: true });
  assert.equal(result.assignments[0].roomId, 2);
  assert.equal(result.excluded.length, 0);
});

test('生产岗位优先于训练，并计入衣服、等级、心情和房间等级', () => {
  const outfit = { id: 100, slot: 'outfit', bonus: { str: 7 } };
  const state = view([
    person(1, { stats: stats({ str: 10 }), happiness: 0 }), person(2, { stats: stats({ str: 8 }) }),
    person(3, { stats: stats({ str: 6 }), outfitId: 100, xp: 3 * 49 ** 2 }), person(4), person(5)
  ], [room(1, 'power', { level: 3 }), room(2, 'power'), room(3, 'training', { trainStat: 'str' })], [outfit]);
  const result = plan(state);
  assert.equal(result.production, 4);
  assert.equal(result.training, 1);
  assert.equal(result.assignments.find(item => item.residentId === 3).roomId, 1);

  valid(state, result);
});

test('跨岗位匹配让通才和专才各用所长', () => {
  const state = view([person(1, { stats: stats({ str: 10, agi: 9 }) }), person(2, { stats: stats({ str: 9, agi: 1 }) }),
    person(3, { roomId: 1, away: { kind: 'explore' } }), person(4, { roomId: 2, away: { kind: 'explore' } })],
  [room(1, 'power'), room(2, 'diner')]);
  const result = plan(state);
  assert.equal(result.assignments.find(item => item.residentId === 1).roomId, 2);
  assert.equal(result.assignments.find(item => item.residentId === 2).roomId, 1);
  valid(state, result);
});

test('先填满生产岗位，再按属性高低安排，不为废料收支把工坊留空', () => {
  const state = view(Array.from({ length: 4 }, (_, index) => person(index + 1, { stats: stats({ int: 10, agi: 8, end: 8 }) })),
    [room(1, 'workshop'), room(2, 'diner'), room(3, 'scrap')]);
  const highest = plan(state, { strategy: 'highest' });
  const optimized = plan(state);
  // 三间房共 6 个位置、4 名居民：全部上岗，不会为了保住废料收支把工坊空着。
  assert.equal(optimized.production, 4);
  assert.equal(optimized.training, 0);
  assert.equal(optimized.resting, 0);
  assert.equal(optimized.assignments.filter(item => item.roomId === 1).length, 2);
  assert.ok(highest.expected.scrap < 0);
  valid(state, optimized);
});

test('废料溢出的前提下不看废料收支，电力、食物、净水需求只由房间与人口决定', () => {
  // 工坊吃废料但产出零件：废料收支为负也照样填满，产出总量优先。
  const state = view([person(1, { stats: stats({ int: 10 }) }), person(2, { stats: stats({ end: 10 }) })],
    [room(1, 'workshop'), room(2, 'scrap')]);
  const result = plan(state);
  assert.equal(result.production, 2);
  assert.equal(result.assignments.find(item => item.residentId === 1).roomId, 1);
  assert.ok(result.expected.parts > 0);
  // 需求侧（电、粮、水）与是否安排无关：换一份安排不会改变需求口径。
  const model = projectedNets(state, result.assignments);
  assert.equal(typeof model.net.food, 'number');
  valid(state, result);

  // 高等级房间优先装高属性的人：同一资源、不同等级时，属性更高的去高等级房。
  const graded = view([person(1, { stats: stats({ str: 10 }) }), person(2, { stats: stats({ str: 4 }) })],
    [room(1, 'power', { level: 3 }), room(2, 'power')]);
  const gradedResult = plan(graded);
  assert.equal(gradedResult.assignments.find(item => item.residentId === 1).roomId, 1);
  valid(graded, gradedResult);
});

test('门外待命的人同样参与匹配，只有岗位不够时才留在门外', () => {
  // 全员当前都在门外，仍然会被安排进空岗位；门外不是“被跳过”。
  const outside = view([person(1, { roomId: null }), person(2, { roomId: null })], [room(1, 'power'), room(2, 'diner')]);
  const filled = plan(outside);
  assert.equal(filled.resting, 0);
  assert.equal(filled.production, 2);
  assert.deepEqual(filled.assignments.map(item => item.roomId).sort(), [1, 2]);
  valid(outside, filled);

  // 人比位置多：位置全满，留在门外的是产出最低（属性最低）的人。
  const crowded = view([
    person(1, { stats: stats({ str: 10 }) }), person(2, { stats: stats({ str: 1 }) }),
    person(3, { stats: stats({ str: 2 }) }), person(4, { stats: stats({ str: 3 }) })
  ], [room(1, 'power')]);
  const packed = plan(crowded);
  assert.equal(packed.available, 4);
  assert.equal(packed.production, 2);
  assert.equal(packed.resting, 2);
  assert.deepEqual(packed.capacity, { production: 2, training: 0 }, '容量应如实反映可用岗位');
  assert.deepEqual([...new Set(packed.assignments.filter(item => item.roomId === 1).map(item => item.residentId))].sort((a, b) => a - b), [1, 4]);
  valid(crowded, packed);
});

test('岗位填满后按对口属性高低分配，不对口的高属性居民也先上岗', () => {
  const split = view([person(1, { stats: stats({ str: 10 }) }), person(2, { stats: stats({ agi: 10 }) })],
    [room(1, 'power'), room(2, 'diner')]);
  const result = plan(split);
  assert.equal(result.production, 2);
  assert.equal(result.assignments.find(item => item.residentId === 1).roomId, 1);
  assert.equal(result.assignments.find(item => item.residentId === 2).roomId, 2);
  valid(split, result);

  // 生产位置比人多时，超出训练允许范围的人也先去空岗，而不是在门外待命。
  const spare = view(Array.from({ length: 3 }, (_, index) => person(index + 1, { stats: stats({ str: 10 - index }) })),
    [room(1, 'power'), room(2, 'scrap')]);
  const filled = plan(spare);
  assert.equal(filled.resting, 0);
  assert.equal(filled.production, 3);
  assert.equal(filled.assignments.filter(item => item.roomId === 1).length, 2);
  valid(spare, filled);
});

test('外出成人保留岗位名额，儿童和倒下不占成人名额', () => {
  for (const strategy of ['production', 'highest']) {
    const state = view([person(1, { roomId: 1, away: { kind: 'explore' } }),
      person(2, { roomId: 1, adultAt: now + 1 }), person(3, { roomId: 1, deadAt: now - 1 }), person(4), person(5)],
    [room(1, 'power')]);
    const result = plan(state, { strategy });
    assert.equal(result.production, 1);
    assert.equal(result.resting, 1);
    valid(state, result);
  }
});

test('保留大门、事件、制作中工坊和非冷却宿舍，冷却成人可调动', () => {
  const state = view([
    person(1, { roomId: 1 }), person(2, { roomId: 2 }), person(3, { roomId: 3 }), person(4, { roomId: 4 }),
    person(5, { roomId: 4, familyCooldownUntil: now + 1000 })
  ], [room(1, 'door'), room(2, 'water', { incident: { kind: 'fire' } }), room(3, 'armory', { craft: { doneAt: now + 1000 } }),
    room(4, 'quarters'), room(5, 'power')]);
  const result = plan(state, { reassignTraining: true });
  assert.equal(result.excluded.length, 4);
  assert.deepEqual(result.assignments, [{ residentId: 5, roomId: 5 }]);
  valid(state, result);
});

test('夜间大门冻结事件不排除门卫，08:00 起恢复大门守卫', () => {
  const nightState = view([person(1, { roomId: 1 }), person(2)],
    [room(1, 'door', { incident: { kind: 'raiders' } }), room(2, 'power')]);
  nightState.serverTime = at(2);
  const night = plan(nightState, { reassignTraining: true });
  assert.equal(night.excluded.some(item => item.id === 1), false);
  assert.equal(night.available, 2);
  assert.ok(night.assignments.some(item => item.roomId === 2));
  valid(nightState, night);

  const dayState = view([person(1, { roomId: 1 }), person(2)],
    [room(1, 'door', { incident: { kind: 'raiders' } }), room(2, 'power')]);
  dayState.serverTime = at(8);
  const day = plan(dayState, { reassignTraining: true });
  assert.equal(day.excluded.some(item => item.id === 1), true);
  assert.equal(day.assignments.some(item => item.residentId === 2 && item.roomId === 2), true);
  valid(dayState, day);
});

test('停电、施工和升级的目标不用，训练练满后可以训练其他未满属性', () => {
  const state = view([person(1, { stats: stats({ str: 10, agi: 8 }) })], [room(1, 'power', { unpowered: true }),
    room(2, 'power', { upgradeAt: now + 1000 }), room(3, 'power', { builtAt: now + 1000 }),
    room(4, 'training', { trainStat: 'str' }), room(5, 'training', { trainStat: 'agi' })]);
  assert.equal(plan(state).assignments[0].roomId, 5);
});

test('两种安排策略保留全部不可用标签，生产与训练房均不分配', async () => {
  const state = view([person(1)], [
    room(1, 'power', { upgradeAt: now - 1000, unpowered: true }),
    room(2, 'training', { trainStat: 'str', builtAt: now + 1000 }),
    room(3, 'water', { incident: { kind: 'fire' } }), room(4, 'power')
  ]);
  for (const strategy of ['production', 'highest']) {
    const result = plan(state, { strategy });
    assert.deepEqual(result.assignments, [{ residentId: 1, roomId: 4 }]);
    assert.deepEqual(result.unavailableRooms.map(item => [item.id, item.reasons]), [
      [1, ['升级中', '停电']], [2, ['施工中']], [3, ['事故处理中']]
    ]);
    const executed = await run(state, { strategy });
    assert.deepEqual(executed.task.unavailableRooms, result.unavailableRooms);
  }
});

test('安排提交前出现升级标签时停止，面板状态保留最新不可用原因', async () => {
  const state = view([person(1)], [room(1, 'power')]);
  const result = await run(state, undefined, { before: ({ action, gets, server }) => {
    if (!action && gets === 2) server.state.rooms[0].upgradeAt = now + 1000;
  } });
  assert.equal(result.actions.length, 0);
  assert.match(result.task.message, /已停止/);
  assert.deepEqual(result.task.unavailableRooms[0].reasons, ['升级中']);
});

test('电台分配使用基础魅力，服装和等级不夸大招募收益', () => {
  const state = view([person(1, { stats: stats({ cha: 3 }), outfitId: 100, xp: 3 * 49 ** 2 }),
    person(2, { stats: stats({ cha: 10 }), happiness: 100 }), person(3, { roomId: 1, away: { kind: 'explore' } })],
  [room(1, 'radio')], [{ id: 100, slot: 'outfit', bonus: { cha: 7 } }]);
  const result = plan(state);
  assert.equal(result.assignments.find(item => item.residentId === 2).roomId, 1);
  assert.equal(result.assignments.find(item => item.residentId === 1).roomId, null);
});

test('同收益保留原岗，安排后再次运行不来回换岗', () => {
  const state = view([person(1, { roomId: 2 }), person(2, { roomId: 1 }), person(3, { roomId: 1 }), person(4, { roomId: 2 })],
    [room(1, 'power'), room(2, 'power')]);
  for (const strategy of ['production', 'highest']) {
    const first = plan(state, { strategy });
    assert.equal(first.changed, 0);
    assert.equal(plan(applied(state, first), { strategy }).changed, 0);
  }
});

test('分别优化匹配和旧策略起点，首次安排即得到稳定的较高产出', () => {
  const values = [
    [9, 6, 5, 4, 7, 8, 9, 46, 434], [6, 7, 2, 9, 2, 7, 10, 95, 553],
    [5, 6, 7, 6, 7, 6, 7, 76, 748], [8, 5, 6, 9, 8, 1, 2, 83, 715],
    [6, 7, 4, 1, 4, 7, 2, 60, 605], [7, 4, 3, 10, 3, 2, 7, 41, 336],
    [2, 3, 8, 5, 8, 1, 8, 26, 327]
  ];
  const state = view(values.map((value, index) => person(index + 1, {
    stats: Object.fromEntries(['str', 'per', 'end', 'cha', 'int', 'agi', 'lck'].map((key, index) => [key, value[index]])),
    happiness: value[7], xp: value[8]
  })), [room(1, 'power'), room(2, 'diner'), room(3, 'water'), room(4, 'scrap'), room(5, 'workshop')]);
  const result = plan(state);
  assert.ok(result.expected.parts > 0.8);
  assert.equal(plan(applied(state, result)).changed, 0);
  valid(state, result);
});

test('夜间 07:59 大门居民参与生产，08:00 起恢复门卫保护', async () => {
  const night = view([person(1, { roomId: 1, stats: stats({ str: 10 }) })],
    [room(1, 'door'), room(2, 'power')]);
  night.serverTime = at(7, 59);
  const nightPlan = plan(night);
  assert.equal(nightPlan.doorGuardRequired, false);
  assert.deepEqual(nightPlan.assignments, [{ residentId: 1, roomId: 2 }]);
  assert.match((await run(night)).task.message, /08:00/);

  const day = structuredClone(night);
  day.serverTime = at(8, 0);
  const dayPlan = plan(day);
  assert.equal(dayPlan.doorGuardRequired, true);
  assert.deepEqual(dayPlan.assignments, []);
  assert.equal(dayPlan.excluded[0].reason, '大门守卫');
});

test('安排跨过 08:00 时停止后续请求并隐藏未完成方案预测', async () => {
  const state = view([person(1, { roomId: 1, stats: stats({ str: 10 }) }),
    person(2, { roomId: 1, stats: stats({ str: 8 }) })], [room(1, 'door'), room(2, 'power')]);
  state.serverTime = at(7, 59);
  const result = await run(state, undefined, { before: ({ server, gets }) => {
    if (gets === 3) server.serverTime = at(8, 0);
  } });
  assert.equal(result.actions.length, 1);
  assert.equal(result.task.moved, 1);
  assert.equal(result.task.rates, null);
  assert.equal(result.task.longTermRates, null);
  assert.equal(result.task.happiness, null);
  assert.match(result.task.message, /已到 08:00/);
});

test('对口目标计入衣服、并列最高属性、训练属性和一小时后心情', () => {
  const state = view([
    person(1, { stats: stats({ str: 5, cha: 3, int: 5 }), happiness: 40, outfitId: 100 }),
    person(2, { stats: stats({ str: 10, cha: 10 }) }),
    person(3, { stats: stats({ str: 10, cha: 3 }) })
  ], [room(1, 'workshop'), room(2, 'power'), room(3, 'training', { trainStat: 'cha' }),
    room(4, 'training', { trainStat: 'str' })], [{ id: 100, slot: 'outfit', bonus: { int: 7 } }]);
  const result = projectedHappiness(state, [{ residentId: 1, roomId: 1 }, { residentId: 2, roomId: 2 }]);
  const one = result.residents.find(item => item.residentId === 1);
  assert.equal(one.affinity, true);
  assert.equal(one.target, 85);
  assert.equal(one.oneHour, 62.5);
  assert.equal(result.residents.find(item => item.residentId === 2).affinity, true);
  assert.equal(projectedHappiness(state, [{ residentId: 3, roomId: 3 }]).residents.find(item => item.residentId === 3).target, 70);
  assert.equal(projectedHappiness(state, [{ residentId: 3, roomId: 4 }]).residents.find(item => item.residentId === 3).target, 85);
});

test('心情目标计入传承、事故、停电以及缺粮缺水，未知库存不扣分', () => {
  const state = view([person(1, { roomId: 1, stats: stats({ str: 10 }) })], [room(1, 'power')]);
  state.state.legacy.perks.happiness = 3;
  const baseline = projectedHappiness(state);
  assert.equal(baseline.residents[0].target, 88);
  assert.deepEqual(baseline.stockBasis, { food: 'unknown', water: 'unknown' });

  const incident = structuredClone(state);
  incident.state.rooms[0].incident = { kind: 'fire' };
  assert.equal(projectedHappiness(incident).residents[0].target, 68);
  const unpowered = structuredClone(state);
  unpowered.state.rooms[0].unpowered = true;
  assert.equal(projectedHappiness(unpowered).residents[0].target, 78);
  const shortages = structuredClone(state);
  shortages.state.resources = { food: 0, water: 0 };
  const shortage = projectedHappiness(shortages);
  assert.equal(shortage.residents[0].target, 38);
  assert.deepEqual(shortage.stockBasis, { food: 'stock', water: 'stock' });
  const alias = structuredClone(state);
  alias.state.legacy.perks = { mood: 2 };
  assert.equal(projectedHappiness(alias).residents[0].target, 87);
});

test('电台有人、有电且无事故时给全体目标心情加 10', () => {
  const state = view([person(1, { roomId: 1 }), person(2, { roomId: 2, stats: stats({ str: 10 }) })],
    [room(1, 'radio'), room(2, 'power')]);
  const active = projectedHappiness(state);
  assert.equal(active.radioActive, true);
  assert.equal(active.residents.find(item => item.residentId === 2).target, 95);

  for (const unavailable of ['empty', 'unpowered', 'incident']) {
    const next = structuredClone(state);
    if (unavailable === 'empty') next.state.residents[0].roomId = null;
    if (unavailable === 'unpowered') next.state.rooms[0].unpowered = true;
    if (unavailable === 'incident') next.state.rooms[0].incident = { kind: 'fire' };
    const result = projectedHappiness(next);
    assert.equal(result.radioActive, false, unavailable);
    assert.equal(result.residents.find(item => item.residentId === 2).target, 85, unavailable);
  }
});

test('即时产量仍用当前心情，长期产量使用目标心情', () => {
  const state = view([person(1, { stats: stats({ str: 10 }), happiness: 0 })], [room(1, 'power')]);
  const result = plan(state);
  const nets = projectedNets(state, result.assignments);
  assert.deepEqual(result.expected, nets.net);
  assert.deepEqual(result.longTermExpected, nets.longTermNet);
  assert.ok(result.longTermExpected.power > result.expected.power);
  assert.equal(result.happiness.averageCurrent, 0);
  assert.equal(result.happiness.averageTarget, 85);
  const low = productionRate(state, 1, 1, 0);
  const full = productionRate(state, 1, 1, 100);
  assert.ok(Math.abs(low / full - 0.6) < 1e-12);
});

test('电台只在长期增益超过离职损失时占用生产人手', () => {
  const calm = view(Array.from({ length: 4 }, (_, index) => person(index + 1, { happiness: 100 })),
    [room(1, 'radio'), room(2, 'power', { width: 3 })]);
  assert.ok(plan(calm).assignments.every(item => item.roomId !== 1));

  const strained = view(Array.from({ length: 28 }, (_, index) => person(index + 1, { happiness: 0 })),
    [room(1, 'radio'), ...Array.from({ length: 5 }, (_, index) => room(index + 2, 'power', { width: 3 }))]);
  const result = plan(strained);
  assert.equal(result.assignments.filter(item => item.roomId === 1).length, 1);
  assert.equal(result.happiness.radioActive, true);
  assert.ok(result.longTermExpected.power > 0);
});
test('空名单、保护名单和无岗位可用均返回完整有效方案', () => {
  assert.equal(plan(view()).assignments.length, 0);
  const state = view([person(1), person(2, { adultAt: now + 1 })]);
  const result = plan(state);
  assert.equal(result.resting, 1);
  assert.equal(result.excluded.length, 1);
});

test('维护和无效选项在执行前拒绝', () => {
  assert.throws(() => plan({ ...view(), switches: { frozen: true } }), /维护/);
  assert.throws(() => plan(view(), { strategy: 'unknown' }), /选项/);
  assert.throws(() => plan(view(), { trainLuck: 'false' }), /选项/);
});

test('最大权重岗位匹配与随机小矩阵穷举结果一致', () => {
  const context = load();
  vm.runInContext(planner, context);
  let seed = 20261117;
  const next = () => (seed = (1664525 * seed + 1013904223) >>> 0) % 30;
  function exhaustive(scores, row = 0, used = new Set()) {
    if (row === scores.length) return 0;
    return Math.max(...scores[row].map((value, column) => used.has(column) ? -Infinity :
      value + exhaustive(scores, row + 1, new Set([...used, column]))));
  }
  for (let sample = 0; sample < 50; sample++) {
    const count = next() % 4 + 1;
    const scores = Array.from({ length: count }, () => Array.from({ length: count + 1 }, next));
    const matched = context.matchWorkforceSlots(scores);
    assert.equal(matched.reduce((sum, column, row) => sum + scores[row][column], 0), exhaustive(scores));
  }
});

test('随机生产、训练组合无超员、漏人或禁止训练，重复安排稳定', () => {
  let seed = 90127;
  const next = () => (seed = (1664525 * seed + 1013904223) >>> 0);
  for (let sample = 0; sample < 30; sample++) {
    const rooms = [room(1, 'power'), room(2, 'diner'), room(3, 'water'), room(4, 'scrap'), room(5, 'workshop'),
      room(6, 'training', { trainStat: 'str' }), room(7, 'training', { trainStat: 'cha' }), room(8, 'training', { trainStat: 'lck' })];
    const state = view(Array.from({ length: 8 }, (_, index) => person(index + 1, {
      stats: Object.fromEntries(['str', 'per', 'end', 'cha', 'int', 'agi', 'lck'].map(key => [key, next() % 10 + 1])),
      happiness: next() % 101, xp: next() % 1000
    })), rooms);
    const first = plan(state);
    valid(state, first);
    assert.ok(first.assignments.every(item => ![7, 8].includes(item.roomId)));
    assert.equal(plan(applied(state, first)).changed, 0, `sample ${sample}`);
  }
});

test('满房互换仅临时移出一人，返回后完整核对，重复运行不提交', async () => {
  const state = view([person(1, { roomId: 1, stats: stats({ agi: 10, str: 1 }) }),
    person(2, { roomId: 2, stats: stats({ str: 10, agi: 1 }) }),
    person(3, { roomId: 1, away: { kind: 'explore' } }), person(4, { roomId: 2, away: { kind: 'explore' } })],
  [room(1, 'power'), room(2, 'diner')]);
  const result = await run(state);
  assert.equal(result.actions.length, 3);
  assert.equal(result.actions.filter(action => action.roomId === null).length, 1);
  assert.deepEqual(result.server.state.residents.map(item => item.roomId), [2, 1, 1, 2]);
  assert.match(result.task.message, /已安排生产/);
  assert.equal((await run(result.server)).actions.length, 0);
});

test('重新安排原训练居民时可转入生产，保护名单不变', async () => {
  const state = view([person(1, { roomId: 1 }), person(2, { roomId: 1, adultAt: now + 1 })],
    [room(1, 'training', { trainStat: 'cha' }), room(2, 'power')]);
  const result = await run(state, { reassignTraining: true });
  assert.equal(result.server.state.residents[0].roomId, 2);
  assert.equal(result.server.state.residents[1].roomId, 1);
});

test('手动改岗、装备变化和事件发生在下次提交前停止', async () => {
  for (const mutate of [server => { server.state.residents[0].roomId = 2; },
    server => { server.state.residents[0].outfitId = 100; },
    server => { server.state.rooms[0].incident = { kind: 'fire' }; }]) {
    const state = view([person(1)], [room(1, 'power'), room(2, 'diner')]);
    const result = await run(state, undefined, { before: ({ server, gets }) => { if (gets === 2) mutate(server); } });
    assert.equal(result.actions.length, 0);
    assert.match(result.task.message, /已停止/);
  }
});

test('服务端挪动保护居民也立即停止并隐藏未完成方案的预测', async () => {
  const state = view([person(1), person(2, { roomId: 2 })], [room(1, 'power'), room(2, 'door')]);
  const result = await run(state, undefined, { after: ({ server, action }) => { if (action) server.state.residents[1].roomId = null; } });
  assert.equal(result.actions.length, 1);
  assert.equal(result.task.moved, 0);
  assert.equal(result.task.rates, null);
  assert.match(result.task.message, /位置与预期不符/);
});

test('登录失效、retry、网络错误和结果不符不自动重试', async () => {
  const state = view([person(1), person(2)], [room(1, 'power')]);
  const failures = [
    () => ({ ok: true, status: 200, json: async () => ({ code: 'retry' }) }),
    () => ({ ok: false, status: 401 }),
    () => { throw new Error('网络超时'); },
    () => ({ ok: true, status: 200, json: async () => ({ view: structuredClone(state) }) })
  ];
  for (const fail of failures) {
    const result = await run(state, undefined, { before: ({ action }) => action ? fail() : null });
    assert.equal(result.actions.length, 1);
    assert.match(result.task.message, /已停止/);
    assert.equal(result.task.rates, null);
  }
});

test('停止保留已完成操作并提供实际停止时的收支', async () => {
  const state = view([person(1), person(2)], [room(1, 'power')]);
  const result = await run(state, undefined, { after: ({ context, action }) => { if (action) context.__fengbaoWorkAssignment.stopRequested = true; } });
  assert.equal(result.actions.length, 1);
  assert.equal(result.task.moved, 1);
  assert.ok(result.task.rates.power > 0);
  assert.match(result.task.message, /已停止居民安排/);
});

test('其他避难所任务阻止居民安排发请求', async () => {
  for (const key of ['__fengbaoShelterAuto', '__fengbaoEquipmentAssignment', '__fengbaoDormAssignment', '__fengbaoResidentRename']) {
    const result = await run(view(), undefined, { globals: { [key]: { running: true } } });
    assert.equal(result.gets, 0);
    assert.equal(result.actions.length, 0);
    assert.match(result.task.message, /其他避难所任务/);
  }
});

// 人口较多的避难所：优化前同规模需要 10 秒以上并卡住游戏页面，这里留足余量只拦截明显退化。
function crowdedShelter(residents) {
  const keys = ['str', 'per', 'end', 'cha', 'int', 'agi', 'lck'];
  let seed = 20261126;
  const next = () => (seed = (1664525 * seed + 1013904223) >>> 0);
  const rooms = [room(1, 'power', { width: 3, level: 3 }), room(2, 'power', { width: 3, level: 3 }),
    room(3, 'diner', { width: 3, level: 2 }), room(4, 'diner', { width: 3, level: 2 }),
    room(5, 'water', { width: 3, level: 2 }), room(6, 'water', { width: 3, level: 2 }),
    room(7, 'scrap', { width: 2, level: 2 }), room(8, 'scrap', { width: 2, level: 2 }),
    room(9, 'workshop', { width: 2, level: 2 }), room(10, 'medbay', { width: 2, level: 2 }), room(11, 'radio', { width: 2 }),
    room(12, 'training', { trainStat: 'str' }), room(13, 'training', { trainStat: 'per' }),
    room(14, 'training', { trainStat: 'end' }), room(15, 'training', { trainStat: 'int' }),
    room(16, 'quarters', { width: 3 })];
  return view(Array.from({ length: residents }, (_, index) => person(index + 1, {
    stats: Object.fromEntries(keys.map(key => [key, next() % 10 + 1])),
    happiness: next() % 101, xp: next() % 1000
  })), rooms);
}

test('人数较多时一键安排线性增长，不会长时间卡住页面', () => {
  const state = crowdedShelter(64);
  const started = Date.now();
  const result = plan(state);
  const elapsed = Date.now() - started;
  assert.equal(result.available, 64);
  valid(state, result);
  assert.ok(elapsed < 3000, `64 人一键安排耗时 ${elapsed} ms`);
});

test('分片计算与一次算完结果一致，并按时间片让出主线程', async () => {
  const state = crowdedShelter(24);
  const context = load();
  vm.runInContext(planner, context);
  const sync = plain(context.planWorkforce(state, {}));
  const slices = [];
  const phases = new Set();
  const chunked = plain(await context.planWorkforceChunked(state, {}, {
    budget: 0, defer: () => { slices.push(Date.now()); return Promise.resolve(); },
    onProgress: progress => phases.add(progress.phase)
  }));
  assert.deepEqual(chunked.assignments, sync.assignments);
  assert.deepEqual(chunked.expected, sync.expected);
  assert.ok(slices.length > 0, '应当把计算切成多段');
  assert.ok(phases.has('improve') && phases.has('long'), `进度阶段：${[...phases]}`);
  assert.ok([...phases].every(phase => typeof phase === 'string'));
  // “最高基础属性优先”只做一次线性分配，不需要分片。
  const highestSlices = [];
  const highest = plain(await context.planWorkforceChunked(state, { strategy: 'highest' }, {
    budget: 0, defer: () => { highestSlices.push(Date.now()); return Promise.resolve(); }
  }));
  assert.deepEqual(highest.assignments, plain(context.planWorkforce(state, { strategy: 'highest' })).assignments);
  assert.equal(highestSlices.length, 0);
});

test('计算过程中按下停止会放弃方案，不提交任何调动', async () => {
  const state = crowdedShelter(24);
  const context = load();
  vm.runInContext(planner, context);
  let stopped = false;
  await assert.rejects(() => context.planWorkforceChunked(state, {}, {
    budget: 0, defer: () => { stopped = true; return Promise.resolve(); }, stopped: () => stopped
  }), /已按下停止/);
});

test('六格合并房间可以正常计算产出，超过六格仍拒绝', () => {
  const state = view([person(1), person(2)], [room(1, 'power', { width: 6 })]);
  const result = plan(state);
  assert.equal(result.assignments.length, 2);
  valid(state, result);
  assert.throws(() => plan(view([person(1)], [room(1, 'power', { width: 7 })])), /房间数据已变化/);
});

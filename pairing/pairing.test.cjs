const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const vm = require('node:vm');

const assign = ['resident-state.js', 'skip-unavailable.js', 'assign.js'].map(file => readFileSync(join(__dirname, file), 'utf8')).join('\n');
const now = 1000000;
const person = (id, values = {}) => ({ id, name: `居民${id}`, roomId: null, adultAt: 0, xp: 0, happiness: 100,
  stats: { str: 5, per: 5, end: 5, cha: 5, int: 5, agi: 5, lck: 5 }, parents: [], romance: null,
  familyCooldownUntil: null, away: null, deadAt: null, outfitId: null, weaponId: null, ...values });
const room = (id, type, values = {}) => ({ id, type, level: 1, width: 1, floor: id, col: 0, builtAt: 0,
  upgradeAt: null, unpowered: false, incident: null, trainStat: null, ...values });
const view = (residents, rooms) => ({ serverTime: now, state: { residents, rooms, births: [], items: [], legacy: { perks: {} } } });
const basic = () => view([person(1, { roomId: 1 }), person(2, { roomId: 2 })],
  [room(1, 'power'), room(2, 'training', { trainStat: 'str' }), room(3, 'quarters')]);
const pairs = (...ids) => ids.map(pair => pair.map(id => ({ id, total: 35 })));
const complete = (server, ids = [1, 2]) => {
  for (const id of ids) {
    const member = server.state.residents.find(item => item.id === id);
    member.familyCooldownUntil = server.serverTime + 6 * 3600000;
    member.romance = null;
  }
};
async function run(state = basic(), options = {}, hooks = {}, selected = pairs([1, 2])) {
  const server = structuredClone(state), actions = [], timers = new Map();
  let gets = 0, timerId = 0;
  const context = vm.createContext({ AbortSignal, crypto: { randomUUID }, Date,
    location: { origin: 'https://game.arkengine.me', pathname: '/shelter' },
    setTimeout: (callback, ms) => { assert.equal(ms, 60000); timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id), ...hooks.globals });
  context.fetch = async (url, init) => {
    const action = init.method === 'POST' ? JSON.parse(init.body).action : null;
    if (action) actions.push(action); else gets++;
    const response = await hooks.before?.({ action, gets, server, context });
    if (response) return response;
    if (action) {
      assert.equal(action.type, 'assign');
      const resident = server.state.residents.find(item => item.id === action.residentId);
      if (action.roomId !== null) {
        const target = server.state.rooms.find(item => item.id === action.roomId);
        const count = server.state.residents.filter(item => item.roomId === target.id && item.deadAt === null && item.adultAt <= server.serverTime).length;
        assert.ok(count < target.width * 2, `目标 ${target.id} 有成人空位`);
      }
      resident.roomId = action.roomId;
    }
    await hooks.after?.({ action, gets, server, context });
    return { ok: true, status: 200, redirected: false, json: async () => structuredClone(action ? { view: server } : server) };
  };
  vm.runInContext(assign, context);
  await context.startDormAssignment(selected, options);
  return { server, actions, timers, context, task: context.__fengbaoDormAssignment, gets: () => gets };
}

test('六格宿舍可配对，锁定赠送和等待首次安排者不调入', async () => {
  const state = basic(); state.state.rooms[2].width = 6;
  const result = await run(state);
  assert.deepEqual(result.server.state.residents.map(item => item.roomId), [3, 3]);
  for (const flags of [{ locked: true }, { giftOffer: {} }, { awaitingAssignment: true }]) {
    const blocked = structuredClone(state); Object.assign(blocked.state.residents[0], flags);
    const skipped = await run(blocked);
    assert.equal(skipped.actions.length, 0);
  }
});

test('默认临时配对记录原生产和训练岗位，服务端组建家庭后各自归岗', async () => {
  const result = await run();
  assert.equal(result.task.monitoring, true);
  assert.equal(result.task.running, false);
  assert.deepEqual(result.server.state.residents.map(item => item.roomId), [3, 3]);
  assert.deepEqual(Array.from(result.task.entries, entry => entry.originalRoomId), [1, 2]);
  assert.equal(result.timers.size, 1);
  complete(result.server);
  await result.task.wake();
  assert.deepEqual(result.server.state.residents.map(item => item.roomId), [1, 2]);
  assert.equal(result.task.monitoring, false);
  assert.equal(result.task.restored.length, 2);
  assert.equal(result.actions.length, 4);
  assert.equal(result.timers.size, 0);
});

test('同一合并宿舍可挂载两组，分别完成并返回各自原岗', async () => {
  const state = basic();
  state.state.rooms[2].width = 3;
  state.state.residents.push(person(3, { roomId: 1 }), person(4, { roomId: 2 }));
  const result = await run(state, {}, {}, pairs([1, 2], [3, 4]));
  assert.equal(result.task.completed.length, 2, result.task.message);
  assert.deepEqual(result.server.state.residents.map(item => item.roomId), [3, 3, 3, 3]);
  complete(result.server, [1, 2]);
  await result.task.wake();
  assert.deepEqual(result.server.state.residents.map(item => item.roomId), [1, 2, 3, 3]);
  complete(result.server, [3, 4]);
  await result.task.wake();
  assert.deepEqual(result.server.state.residents.map(item => item.roomId), [1, 2, 1, 2]);
  assert.equal(result.task.monitoring, false);
});

test('已有伴侣和待产父母留在原宿舍，剩余名额可挂载新的一组', async () => {
  const state = basic();
  state.state.rooms[2].width = 3;
  state.state.residents.push(person(3, { roomId: 3, romance: { partnerId: 4, progress: 0.5 } }),
    person(4, { roomId: 3, romance: { partnerId: 3, progress: 0.5 } }));
  state.state.births.push({ roomId: 3, parents: [3, 4] });
  const result = await run(state);
  assert.equal(result.task.completed.length, 1, result.task.message);
  assert.deepEqual(result.actions.map(action => action.residentId), [1, 2]);
  assert.equal(result.task.entries.length, 2);
  complete(result.server);
  await result.task.wake();
  assert.deepEqual(result.server.state.residents.map(item => item.roomId), [1, 2, 3, 3]);
});

test('停止托管后的救援记录继续保护居民和宿舍归岗名额', async () => {
  const state = basic();
  state.state.residents.push(person(3, { roomId: 1 }));
  const globals = { __fengbaoShelterAuto: { running: false, incidentSnapshot: [
    { residentId: 3, originalRoomId: 3, expectedRoomId: 1, status: 'waiting' }
  ] } };
  const result = await run(state, {}, { globals });
  assert.equal(result.actions.length, 0);
  assert.match(result.task.message, /宿舍|空位|名额/);
  state.state.rooms[2].width = 3;
  const protectedPair = await run(state, {}, { globals }, pairs([1, 3]));
  assert.equal(protectedPair.actions.length, 0);
  assert.match(protectedPair.task.message, /无法调动配对/);
});

test('感情满但人口已满、没有冷却记录时继续等待，不提前归岗', async () => {
  const result = await run();
  result.server.state.residents.forEach((member, index) => { member.romance = { partnerId: index === 0 ? 2 : 1, progress: 1 }; });
  await result.task.wake();
  assert.equal(result.actions.length, 2);
  assert.equal(result.task.monitoring, true);
  complete(result.server, [1]);
  await result.task.wake();
  assert.equal(result.actions.length, 2, '只有一方冷却不视为本对完成');
});

test('恢复宿舍被暂移的成人，儿童保留，待产记录不受归岗影响', async () => {
  const state = basic();
  state.state.residents.push(person(3, { roomId: 3 }), person(4, { roomId: 3, adultAt: now + 100000 }));
  const result = await run(state);
  assert.equal(result.server.state.residents[2].roomId, null);
  assert.equal(result.server.state.residents[3].roomId, 3);
  complete(result.server);
  result.server.state.births.push({ roomId: 3, parents: [1, 2], bornAt: now + 100000 });
  await result.task.wake();
  assert.deepEqual(result.server.state.residents.map(item => item.roomId), [1, 2, 3, 3]);
  assert.equal(result.server.state.births.length, 1);
  assert.equal(result.task.restored.length, 3);
});

test('原岗满员、事件、升级、改型或拆除时等待，空位恢复后再归岗', async () => {
  for (const change of [
    server => { server.state.residents.push(person(3, { roomId: 1 }), person(4, { roomId: 1 })); },
    server => { server.state.rooms[0].incident = { kind: 'fire' }; },
    server => { server.state.rooms[0].upgradeAt = now + 100000; },
    server => { server.state.rooms[0].type = 'water'; },
    server => { server.state.rooms = server.state.rooms.filter(item => item.id !== 1); }
  ]) {
    const result = await run();
    change(result.server);
    complete(result.server);
    await result.task.wake();
    assert.equal(result.server.state.residents[0].roomId, 3);
    assert.equal(result.server.state.residents[1].roomId, 2);
    assert.equal(result.task.monitoring, true);
    assert.match(result.task.entries[0].note, /原岗位/);
    result.server.state.rooms = basic().state.rooms;
    result.server.state.residents = result.server.state.residents.filter(item => item.id <= 2);
    await result.task.wake();
    assert.equal(result.server.state.residents[0].roomId, 1);
    assert.equal(result.task.monitoring, false);
  }
});

test('手动调动一方后不强行拉回，同组剩余居民返回原岗', async () => {
  const result = await run();
  result.server.state.residents[0].roomId = null;
  await result.task.wake();
  assert.deepEqual(result.server.state.residents.map(item => item.roomId), [null, 2]);
  assert.equal(result.task.entries[0].status, 'released');
  assert.equal(result.task.monitoring, false);
  assert.equal(result.task.issues.length, 1);
});

test('结束挂载立即尝试归岗；关闭归岗选项时保持原有单次安排', async () => {
  const result = await run();
  result.task.returnRequested = true;
  await result.task.wake();
  assert.deepEqual(result.server.state.residents.map(item => item.roomId), [1, 2]);
  assert.equal(result.task.monitoring, false);
  const disabled = await run(basic(), { returnToWork: false });
  assert.equal(disabled.task.monitoring, false);
  assert.equal(disabled.timers.size, 0);
  assert.deepEqual(disabled.server.state.residents.map(item => item.roomId), [3, 3]);
});

test('多对独立完成归岗，不必等待整批组建家庭', async () => {
  const state = basic();
  state.state.rooms.push(room(4, 'quarters', { level: 2 }));
  state.state.residents.push(person(3, { roomId: 1 }), person(4, { roomId: 2 }));
  const result = await run(state, {}, {}, pairs([1, 2], [3, 4]));
  complete(result.server, [1, 2]);
  await result.task.wake();
  assert.deepEqual(result.server.state.residents.map(item => item.roomId), [1, 2, 3, 3]);
  assert.equal(result.task.monitoring, true);
  complete(result.server, [3, 4]);
  await result.task.wake();
  assert.deepEqual(result.server.state.residents.map(item => item.roomId), [1, 2, 1, 2]);
  assert.equal(result.task.monitoring, false);
});

test('等待时允许其他任务，实际归岗互斥；托管轮次之间完成归岗', async () => {
  const result = await run();
  complete(result.server);
  for (const [key, value] of [
    ['__fengbaoWorkAssignment', { running: true }], ['__fengbaoEquipmentAssignment', { running: true }],
    ['__fengbaoResidentRename', { running: true }], ['__fengbaoShelterAuto', { running: true, cycleRunning: true }]
  ]) {
    result.context[key] = value;
    await result.task.wake();
    assert.equal(result.actions.length, 2);
    delete result.context[key];
  }
  result.context.__fengbaoShelterAuto = { running: true, cycleRunning: false };
  await result.task.wake();
  assert.equal(result.task.monitoring, false);
});

test('归岗网络超时、登录失效、retry或结果不符后停止且不重试', async () => {
  for (const fail of [
    () => { throw new Error('网络超时'); }, () => ({ ok: false, status: 401 }),
    () => ({ ok: true, status: 200, json: async () => ({ code: 'retry' }) }),
    server => ({ ok: true, status: 200, json: async () => ({ view: structuredClone(server) }) })
  ]) {
    let failReturn = false;
    const result = await run(basic(), {}, { before: ({ action, server }) => failReturn && action ? fail(server) : null });
    complete(result.server);
    failReturn = true;
    await result.task.wake();
    assert.equal(result.actions.length, 3);
    assert.equal(result.task.monitoring, false);
    assert.match(result.task.message, /已停止/);
    await result.task.wake();
    assert.equal(result.actions.length, 3);
  }
});

test('不可调居民、重复名单、亲属和宿舍待产在提交前拒绝', async () => {
  for (const mutate of [
    state => { state.state.residents[0].away = {}; },
    state => { state.state.residents[0].deadAt = now - 1; },
    state => { state.state.residents[0].adultAt = now + 1; },
    state => { state.state.residents[0].parents = [2]; },
    state => { state.state.births.push({ roomId: 3 }); }
  ]) {
    const state = basic(); mutate(state);
    const result = await run(state);
    assert.equal(result.actions.length, 0);
    assert.equal(result.task.monitoring, false);
    assert.match(result.task.message, /已停止|已跳过/);
  }
  const repeated = await run(basic(), {}, {}, pairs([1, 1]));
  assert.equal(repeated.actions.length, 0);
});

test('一组居民无法调动时跳过整组，继续安排可用组并保留自动归岗', async () => {
  const state = basic();
  state.state.residents[0].away = {};
  state.state.residents.push(person(4), person(5));
  const result = await run(state, {}, {}, pairs([1, 2], [4, 5]));
  assert.deepEqual(result.actions.map(action => action.residentId), [4, 5]);
  assert.match(result.task.message, /已跳过 1 对/);
  complete(result.server, [4, 5]);
  await result.task.wake();
  assert.deepEqual(result.server.state.residents.slice(2).map(item => item.roomId), [null, null]);
  assert.equal(result.task.monitoring, false);
});

test('宿舍腾位后配对状态变化时跳过该组，暂移原住户仍能归岗', async () => {
  const state = basic(); state.state.residents.push(person(4, { roomId: 3 }));
  const result = await run(state, {}, { after: ({ action, server }) => {
    if (action?.residentId === 4 && action.roomId === null) server.state.residents[0].away = {};
  } });
  assert.deepEqual(result.actions.map(action => action.residentId), [4]);
  assert.match(result.task.message, /已跳过 1 对/);
  await result.task.wake();
  assert.equal(result.server.state.residents.find(item => item.id === 4).roomId, 3);
  assert.equal(result.task.monitoring, false);
});

test('宿舍不可用时跳过且显示原因，仍可选择其他可用宿舍', async () => {
  for (const [values, label] of [
    [{ upgradeAt: now + 1000 }, '升级中'], [{ upgradeAt: now - 1000 }, '升级中'],
    [{ builtAt: now + 1000 }, '施工中'], [{ unpowered: true }, '停电'],
    [{ incident: { kind: 'fire' } }, '事故处理中']
  ]) {
    const state = basic();
    Object.assign(state.state.rooms[2], values, { level: 3 });
    const blocked = await run(state);
    assert.equal(blocked.actions.length, 0, label);
    assert.match(blocked.task.message, /没有可用宿舍/);
    assert.ok(blocked.task.unavailableRooms.some(item => item.id === 3 && item.reasons.includes(label)), label);
    state.state.rooms.push(room(4, 'quarters'));
    const result = await run(state);
    assert.deepEqual(result.server.state.residents.map(item => item.roomId), [4, 4], label);
  }
});

test('选房后或逐人入住前宿舍变为不可用，不再提交调动', async () => {
  for (const [values, label] of [
    [{ upgradeAt: now + 1000 }, '升级中'], [{ builtAt: now + 1000 }, '施工中'],
    [{ unpowered: true }, '停电'], [{ incident: { kind: 'fire' } }, '事故处理中']
  ]) for (const changedAt of [2, 3, 4]) {
    const result = await run(basic(), {}, { before: ({ action, gets, server }) => {
      if (!action && gets === changedAt) Object.assign(server.state.rooms[2], values);
    } });
    assert.equal(result.actions.length, changedAt === 4 ? 1 : 0, `${label}，第 ${changedAt} 次读取`);
    assert.match(result.task.message, new RegExp(label));
    assert.equal(result.task.monitoring, false);
  }
});

test('清理宿舍前复查不可用状态，不暂移原有成人', async () => {
  const state = basic();
  state.state.residents.push(person(3, { roomId: 3 }));
  const result = await run(state, {}, { before: ({ action, gets, server }) => {
    if (!action && gets === 2) server.state.rooms[2].upgradeAt = now + 1000;
  } });
  assert.equal(result.actions.length, 0);
  assert.equal(result.server.state.residents[2].roomId, 3);
  assert.match(result.task.message, /升级中/);
});

test('归岗等待显示具体不可用标签，多个状态同时保留', async () => {
  const result = await run();
  Object.assign(result.server.state.rooms[0], { upgradeAt: now + 1000, unpowered: true, builtAt: now + 1000 });
  complete(result.server);
  await result.task.wake();
  for (const label of ['升级中', '施工中', '停电']) assert.ok(result.task.entries[0].note.includes(label));
  assert.equal(result.server.state.residents[0].roomId, 3);
  assert.equal(result.task.monitoring, true);
});

test('等待归岗的居民和原岗位空位均不参与一键重排，训练开关仍独立生效', async () => {
  const state = basic();
  state.state.residents.push(person(3), person(4), person(5, { roomId: 2 }));
  const result = await run(state);
  vm.runInContext(readFileSync(join(__dirname, '..', 'workforce/planner.js'), 'utf8'), result.context);
  for (const reassignTraining of [false, true]) {
    const plan = result.context.planWorkforce(result.server, { reassignTraining });
    assert.ok(plan.excluded.some(item => item.id === 1));
    assert.ok(plan.excluded.some(item => item.id === 2));
    assert.equal(plan.assignments.filter(item => item.roomId === 1).length, 1, '发电站保留一名归岗名额');
    assert.equal(plan.assignments.some(item => item.residentId === 5), reassignTraining);
    assert.ok(plan.assignments.filter(item => item.roomId === 2).length <= (reassignTraining ? 1 : 0));
  }
});

test('原宿舍之间满员互换时逐次临时移出一人解环，恢复全部原岗', async () => {
  const state = view([person(1, { roomId: 2 }), person(2, { roomId: 2 }), person(3, { roomId: 1 }), person(4, { roomId: 1 })],
    [room(1, 'quarters', { level: 2 }), room(2, 'quarters')]);
  const result = await run(state, {}, {}, pairs([1, 2], [3, 4]));
  complete(result.server, [1, 2, 3, 4]);
  const before = result.actions.length;
  await result.task.wake();
  assert.deepEqual(result.server.state.residents.map(item => item.roomId), [2, 2, 1, 1]);
  assert.equal(result.actions.length - before, 6);
  assert.equal(result.task.monitoring, false);
});

test('等待挂载时一键整理房间被拦截，不发拆分移动请求', async () => {
  const result = await run();
  const before = result.gets();
  vm.runInContext(readFileSync(join(__dirname, '..', 'workforce/room-runner.js'), 'utf8'), result.context);
  await new Promise(setImmediate);
  assert.equal(result.gets(), before);
  assert.match(result.context.__fengbaoWorkAssignment.message, /挂载/);
  assert.equal(result.task.monitoring, true);
});

test('关闭面板后的定时检查仍会自动归岗，挂载未结束时不接受重复启动', async () => {
  const result = await run();
  await result.context.startDormAssignment(pairs([1, 2]));
  assert.equal(result.context.__fengbaoDormAssignment, result.task);
  complete(result.server);
  const [callback] = result.timers.values();
  callback();
  for (let turn = 0; result.task.running && turn < 20; turn++) await new Promise(setImmediate);
  assert.deepEqual(result.server.state.residents.map(item => item.roomId), [1, 2]);
  assert.equal(result.task.monitoring, false);
});

test('挂载与托管同时运行时，门外暂移居民不会被当作新人改名或安排', async () => {
  const state = basic();
  state.state.rooms.push(room(4, 'radio'));
  state.state.rooms[0].width = 1;
  state.state.residents.push(person(3, { roomId: 3 }));
  const result = await run(state);
  result.server.state.explorers = [];
  vm.runInContext(readFileSync(join(__dirname, '..', 'workforce/planner.js'), 'utf8') + '\n' +
    readFileSync(join(__dirname, '..', 'stewardship/runner.js'), 'utf8'), result.context);
  const autoActions = [];
  result.context.fetch = async (url, init) => {
    const action = init.method === 'POST' ? JSON.parse(init.body).action : null;
    if (action) autoActions.push(action);
    // 托管本轮结束的等待处断开，不让测试实际等待 600 秒。
    return { ok: true, status: 200, json: async () => structuredClone(action ? { view: result.server } : result.server) };
  };
  result.context.setTimeout = (_callback, ms) => {
    assert.equal(ms, 600000);
    complete(result.server);
    return 1;
  };
  result.context.startShelterAuto(600, 6, false, 20);
  for (let turn = 0; result.context.__fengbaoShelterAuto.cycleRunning !== false && turn < 30; turn++) await new Promise(setImmediate);
  assert.deepEqual(autoActions.map(action => action.type), ['collect_all'], '暂移成人不改名或安排');
  assert.equal(result.context.__fengbaoShelterAuto.cycleRunning, false);
  const auto = result.context.__fengbaoShelterAuto;
  auto.stopRequested = true;
  auto.wake();
  for (let turn = 0; auto.running && turn < 20; turn++) await new Promise(setImmediate);
  assert.equal(auto.running, false);
  assert.equal(result.server.state.residents[2].roomId, null);
});

test('六格合并宿舍可以正常接纳配对', async () => {
  const state = basic();
  state.state.rooms[2].width = 6;
  const result = await run(state);
  assert.equal(result.task.completed.length, 1, result.task.message);
  assert.deepEqual(result.server.state.residents.map(item => item.roomId), [3, 3]);
});

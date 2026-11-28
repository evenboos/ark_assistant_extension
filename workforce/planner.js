// 00:00–07:59 掠夺者不进大门，门卫可以参与生产；08:00 起恢复大门值守。
// 只把时段化结果放进核验快照，避免同一时段内服务器时间变化导致任务误停。
function workforceDoorGuardRequired(view) {
  const date = new Date(view?.serverTime);
  return !Number.isFinite(date.getTime()) || date.getHours() >= 8;
}
// 夜间大门掠夺者进度冻结。该事件保留在房间数据中，但不阻止生产与居民自动化。
function workforceIncidentBlocksAutomation(room, view) {
  if (!room?.incident) return false;
  return !(room.type === 'door' && room.incident.kind === 'raiders' && !workforceDoorGuardRequired(view));
}

function workforceResourceAmount(state, key) {
  const roots = [state?.resources, state?.resource, state?.inventory, state?.stock, state?.shelter?.resources];
  for (const root of roots) {
    const value = root?.[key];
    if (Number.isFinite(value)) return value;
    if (value && typeof value === 'object') {
      for (const field of ['amount', 'value', 'quantity', 'stock', 'current']) {
        if (Number.isFinite(value[field])) return value[field];
      }
    }
  }
  return null;
}
function workforceOptions(options = {}) {
  const result = { strategy: 'production', trainCharisma: false, trainLuck: false, reassignTraining: false, ...options };
  if (!['production', 'highest'].includes(result.strategy) ||
      !['trainCharisma', 'trainLuck', 'reassignTraining'].every(key => typeof result[key] === 'boolean')) {
    throw new Error('居民安排选项无效');
  }
  return result;
}

function workforceRoomReasons(room, now) {
  if (!room) return ['房间已拆除'];
  const reasons = [];
  if (room.upgradeAt !== null) reasons.push(Number.isFinite(room.upgradeAt) ? '升级中' : '升级状态不完整');
  if (room.builtAt > now) reasons.push('施工中');
  if (workforceIncidentBlocksAutomation(room, { serverTime: now })) reasons.push('事故处理中');
  if (room.unpowered) reasons.push('停电');
  return reasons;
}

// 手动挂载、托管配对和救援共用居民保护与原岗名额，外出成人也保留岗位。
function shelterCoordination(view) {
  const auto = globalThis.__fengbaoShelterAuto;
  const entries = [
    ...(globalThis.__fengbaoDormAssignment?.entries ?? []),
    ...(auto?.parentReturns ?? []),
    ...(Array.isArray(auto?.incidentSnapshot) ? auto.incidentSnapshot : [])
  ].filter(entry => entry.status === 'waiting');
  const quests = new Set((view.state.quests ?? []).flatMap(run => Array.isArray(run.team) ? run.team : []));
  return { entries, protectedIds: new Set([...quests, ...entries.map(entry => entry.residentId)]), quests };
}

function shelterRoomOccupancy(view, roomId, assignments = [], exceptId = null) {
  const positions = new Map(assignments.map(item => [item.residentId, item.roomId]));
  const adult = resident => resident.id !== exceptId && resident.deadAt === null && resident.adultAt <= view.serverTime;
  const actual = view.state.residents.filter(resident => adult(resident) &&
    (positions.has(resident.id) ? positions.get(resident.id) : resident.roomId) === roomId);
  const ids = new Set(actual.map(resident => resident.id));
  for (const entry of shelterCoordination(view).entries) {
    const resident = view.state.residents.find(item => item.id === entry.residentId);
    if (entry.originalRoomId === roomId && resident && adult(resident)) ids.add(resident.id);
  }
  return ids.size;
}

function workforceModel(view, options = {}) {
  options = workforceOptions(options);
  const types = {
    power: { name: '发电站', stat: 'str', resource: 'power', base: 12 },
    diner: { name: '餐厅', stat: 'agi', resource: 'food', base: 8 },
    water: { name: '净水站', stat: 'per', resource: 'water', base: 8 },
    scrap: { name: '废料回收站', stat: 'end', resource: 'scrap', base: 8 },
    medbay: { name: '医务室', stat: 'int', resource: 'stimpak', base: 0.5 },
    workshop: { name: '零件工坊', stat: 'int', resource: 'parts', base: 0.6 },
    radio: { name: '电台', stat: 'cha' },
    training: { name: '训练室' }
  };
  const keys = ['str', 'per', 'end', 'cha', 'int', 'agi', 'lck'];
  const state = view?.state;
  const now = view?.serverTime;
  if (!state || !Array.isArray(state.rooms) || !Array.isArray(state.residents) ||
      !Array.isArray(state.items) || !state.legacy?.perks || !Number.isFinite(now) ||
      (view.env != null && !Array.isArray(view.env.events))) throw new Error('游戏数据不完整，无法计算产出');
  const roomIds = new Set(), residentIds = new Set();
  for (const room of state.rooms) {
    if (!['id', 'level', 'width', 'floor', 'col', 'builtAt'].every(key => Number.isFinite(room[key])) ||
        !Number.isInteger(room.id) || roomIds.has(room.id) || ![1, 2, 3, 4, 5, 6].includes(room.width) ||
        !['door', 'elevator', 'power', 'diner', 'water', 'scrap', 'quarters', 'storage', 'medbay', 'training', 'workshop', 'armory', 'tailor', 'radio'].includes(room.type) ||
        ![1, 2, 3].includes(room.level) || (room.type === 'training' && !keys.includes(room.trainStat))) throw new Error('房间数据已变化，无法计算产出');
    roomIds.add(room.id);
  }
  for (const resident of state.residents) {
    if (!['id', 'adultAt', 'xp', 'happiness'].every(key => Number.isFinite(resident[key])) ||
        !Number.isInteger(resident.id) || residentIds.has(resident.id) ||
        (resident.roomId !== null && !roomIds.has(resident.roomId)) ||
        (resident.away !== null && (!resident.away || typeof resident.away !== 'object')) ||
        (resident.deadAt !== null && !Number.isFinite(resident.deadAt)) ||
        typeof resident.name !== 'string' || !keys.every(key => Number.isFinite(resident.stats?.[key]) && resident.stats[key] >= 0 && resident.stats[key] <= 10)) {
      throw new Error(`居民「${resident.name ?? resident.id}」的数据不完整`);
    }
    residentIds.add(resident.id);
  }
  if (view.switches?.frozen) throw new Error('避难所正在维护');
  const atHome = resident => resident.away === null && resident.deadAt === null;
  const roomById = new Map();
  for (const room of state.rooms) if (!roomById.has(room.id)) roomById.set(room.id, room);
  const itemById = new Map();
  for (const item of state.items) if (!itemById.has(item.id)) itemById.set(item.id, item);
  const roomOrder = (left, right) => right.level - left.level || right.width - left.width ||
    left.floor - right.floor || left.col - right.col || left.id - right.id;
  const operating = room => !workforceRoomReasons(room, now).length;
  const unavailableRooms = state.rooms.filter(room => types[room.type] && !operating(room)).map(room => ({ id: room.id,
    label: `${room.floor} 层${types[room.type].name}（房间 ${room.id}）`, reasons: workforceRoomReasons(room, now) }));
  const excluded = [];
  const guardRequired = workforceDoorGuardRequired(view);
  const coordination = shelterCoordination(view);
  const borrowed = coordination.entries;
  const borrowedIds = coordination.protectedIds;
  const workers = state.residents.filter(resident => {
    const room = roomById.get(resident.roomId);
    // 外出成人仍占原岗位名额；事件、大门防守和正在制作的工坊也保留人手。
    const reason = resident.adultAt > now ? '儿童' : !atHome(resident) ? '外出或已倒下' :
      borrowedIds.has(resident.id) ? coordination.quests.has(resident.id) ? '本周任务小队' : '临时配对或救援，保留归岗记录' :
      workforceIncidentBlocksAutomation(room, view) ? '所在房间正在处理事件' : room?.type === 'door' && guardRequired ? '大门守卫' :
      ['armory', 'tailor'].includes(room?.type) && room.craft ? '正在制作装备的工坊居民' :
      room?.type === 'training' && !options.reassignTraining ? '保留原训练安排' :
      room?.type === 'quarters' && !(resident.familyCooldownUntil > now) ? '宿舍居民（未处于家庭冷却）' : '';
    if (reason) excluded.push({ id: resident.id, name: resident.name, reason });
    return !reason;
  }).sort((left, right) => left.id - right.id);
  const workerIds = new Set(workers.map(resident => resident.id));
  const reservedCache = new Map();
  const reserved = room => {
    let value = reservedCache.get(room.id);
    if (value === undefined) {
      value = state.residents.filter(resident => resident.roomId === room.id && resident.deadAt === null &&
        resident.adultAt <= now && !workerIds.has(resident.id)).length + borrowed.filter(entry => entry.originalRoomId === room.id &&
          state.residents.some(resident => resident.id === entry.residentId && resident.roomId !== room.id)).length;
      reservedCache.set(room.id, value);
    }
    return value;
  };
  const rooms = state.rooms.filter(room => types[room.type] && operating(room)).sort(roomOrder);
  const radioRoom = rooms.find(room => room.type === 'radio') ?? null;
  const radioUsable = Boolean(radioRoom && radioRoom.builtAt <= now && !radioRoom.unpowered &&
    !workforceIncidentBlocksAutomation(radioRoom, view));
  // 产出按房间分组一次，net 与增量评价都直接复用，不再为每个房间反复过滤全部居民。
  const atHomeResidents = state.residents.filter(atHome);
  const atHomeAdults = atHomeResidents.filter(resident => resident.adultAt <= now);
  const resourceRooms = rooms.filter(room => types[room.type].resource);
  const residentsByRoom = new Map();
  for (const resident of atHomeAdults) {
    if (resident.roomId === null) continue;
    const list = residentsByRoom.get(resident.roomId);
    if (list) list.push(resident); else residentsByRoom.set(resident.roomId, [resident]);
  }
  // 与游戏资源栏一致：建成房间耗电，在家的成人和儿童分别消耗 1、0.5 份食物/水。
  const population = state.residents.reduce((sum, resident) => sum + (atHome(resident) ? resident.adultAt <= now ? 1 : 0.5 : 0), 0);
  const demand = {
    power: state.rooms.filter(room => room.builtAt <= now).reduce((sum, room) => sum +
      (['door', 'elevator', 'power'].includes(room.type) ? 0 :
        (types[room.type]?.resource ? 1 : 0.5) * room.width * room.level), 0),
    food: population, water: population, scrap: 0, parts: 0, stimpak: 0
  };
  const events = view.env?.events ?? [];
  const eventPercent = Math.min(150, Math.max(100, ...events.filter(event => event.kind === 'production' &&
    event.startsAt <= now && now < event.endsAt).map(event => event.percent)));
  const bonus = (1 + 0.03 * (state.legacy.perks.production ?? 0)) * eventPercent / 100;
  if (!Number.isFinite(bonus)) throw new Error('生产加成数据不完整');
  const happinessPerk = state.legacy.perks.happiness ?? state.legacy.perks.mood ?? 0;
  if (!Number.isFinite(happinessPerk) || happinessPerk < 0) throw new Error('心情加成数据不完整');
  const foodStock = workforceResourceAmount(state, 'food');
  const waterStock = workforceResourceAmount(state, 'water');
  const foodShortage = foodStock !== null && foodStock <= 0;
  const waterShortage = waterStock !== null && waterStock <= 0;
  // 属性、最高属性和等级只取决于居民自身，缓存后避免每个候选都重新遍历装备和属性表。
  const statCache = new Map(), highestCache = new Map(), levelCache = new Map();
  function effectiveStat(resident, key) {
    let row = statCache.get(resident.id);
    if (row === undefined) {
      const outfit = itemById.get(resident.outfitId);
      row = {};
      for (const name of keys) row[name] = Math.min(17, resident.stats[name] + (outfit?.bonus?.[name] ?? 0));
      statCache.set(resident.id, row);
    }
    const value = row[key];
    if (!Number.isFinite(value) || value < 0) throw new Error('服装加成数据不完整');
    return value;
  }
  function stat(resident, type) {
    return effectiveStat(resident, types[type].stat);
  }
  function highestStats(resident) {
    let highest = highestCache.get(resident.id);
    if (highest === undefined) {
      const values = keys.map(key => effectiveStat(resident, key));
      const maximum = Math.max(...values);
      highest = new Set(keys.filter((key, index) => values[index] === maximum));
      highestCache.set(resident.id, highest);
    }
    return highest;
  }
  function levelBonus(resident) {
    let value = levelCache.get(resident.id);
    if (value === undefined) {
      value = 1 + (Math.min(50, 1 + Math.floor(Math.sqrt(Math.max(0, resident.xp) / 3))) - 1) * 0.01;
      levelCache.set(resident.id, value);
    }
    return value;
  }
  function moodFactor(value) {
    return 0.6 + 0.4 * Math.max(0, Math.min(100, value)) / 100;
  }
  function factor(resident, type, happiness = resident.happiness) {
    return (0.5 + stat(resident, type) / 10) * moodFactor(happiness) * levelBonus(resident);
  }
  function rate(resident, room, happiness = resident?.happiness) {
    return resident && room && types[room.type]?.resource ? types[room.type].base * [0, 1, 1.5, 2.1][room.level] *
      factor(resident, room.type, happiness) * bonus : 0;
  }
  // 心情目标只取决于居民自身和目标房间，单独缓存供心情预测与增量评价复用。
  const moodCache = new Map();
  function moodProfile(resident, roomId) {
    const key = roomId === null || roomId === undefined ? 'rest' : roomId;
    let byRoom = moodCache.get(resident.id);
    if (byRoom === undefined) { byRoom = new Map(); moodCache.set(resident.id, byRoom); }
    let profile = byRoom.get(key);
    if (profile === undefined) {
      const room = key === 'rest' ? null : roomById.get(roomId) ?? null;
      const resting = key === 'rest' || room?.type === 'quarters';
      const affinityKey = room?.type === 'training' ? room.trainStat : types[room?.type]?.stat;
      const affinity = !resting && Boolean(affinityKey && highestStats(resident).has(affinityKey));
      const incident = workforceIncidentBlocksAutomation(room, view);
      let base = 70 + happinessPerk + (resting ? 10 : 0) + (affinity ? 15 : 0);
      if (incident) base -= 20;
      if (room?.unpowered) base -= 10;
      if (foodShortage) base -= 25;
      if (waterShortage) base -= 25;
      profile = { resting, affinity, incident, unpowered: Boolean(room?.unpowered), base };
      byRoom.set(key, profile);
    }
    return profile;
  }
  function happiness(assignments) {
    const destinations = assignments && new Map(assignments.map(item => [item.residentId, item.roomId]));
    const position = resident => destinations?.has(resident.id) ? destinations.get(resident.id) : resident.roomId;
    const radioActive = radioUsable && state.residents.some(resident => resident.away === null &&
      resident.deadAt === null && resident.adultAt <= now && position(resident) === radioRoom.id);
    const projected = atHomeResidents.map(resident => {
      const profile = moodProfile(resident, position(resident));
      const target = Math.max(5, Math.min(100, profile.base + (radioActive ? 10 : 0)));
      const current = Math.max(0, Math.min(100, resident.happiness));
      return {
        residentId: resident.id, current, target, oneHour: current + (target - current) / 2,
        affinity: profile.affinity, resting: profile.resting, incident: profile.incident, unpowered: profile.unpowered
      };
    });
    const average = field => projected.length ? projected.reduce((sum, item) => sum + item[field], 0) / projected.length : 0;
    return {
      radioActive, foodShortage, waterShortage, perk: happinessPerk,
      stockBasis: { food: foodStock === null ? 'unknown' : 'stock', water: waterStock === null ? 'unknown' : 'stock' },
      averageCurrent: average('current'), averageOneHour: average('oneHour'), averageTarget: average('target'),
      residents: projected
    };
  }
  function netAt(assignments, mode = 'current') {
    const destinations = assignments && new Map(assignments.map(item => [item.residentId, item.roomId]));
    const projected = mode === 'target' ? new Map(happiness(assignments).residents.map(item => [item.residentId, item.target])) : null;
    // 按目标房间分组一次再求和；没有改派时直接用模型里预先分好的房间名单。
    let buckets = residentsByRoom;
    if (destinations) {
      buckets = new Map();
      for (const resident of atHomeAdults) {
        const roomId = destinations.has(resident.id) ? destinations.get(resident.id) : resident.roomId;
        if (roomId === null) continue;
        const list = buckets.get(roomId);
        if (list) list.push(resident); else buckets.set(roomId, [resident]);
      }
    }
    const totals = { power: 0, food: 0, water: 0, scrap: 0, parts: 0, stimpak: 0 };
    for (const room of resourceRooms) {
      const residents = buckets.get(room.id);
      if (!residents) continue;
      const limit = room.width * 2;
      let chosen = 0, sum = 0;
      for (const resident of residents) {
        if (chosen >= limit) break;
        sum += rate(resident, room, projected?.get(resident.id));
        chosen++;
      }
      totals[types[room.type].resource] += sum;
    }
    // 零件工坊每产出 1 零件消耗 6 废料，提示持续生产时的废料收支。
    totals.scrap -= totals.parts * 6;
    return Object.fromEntries(Object.keys(totals).map(resource => [resource, totals[resource] - demand[resource]]));
  }
  function net(assignments) { return netAt(assignments, 'current'); }
  function longTermNet(assignments) { return netAt(assignments, 'target'); }
  return { types, workers, excluded, rooms, unavailableRooms, demand, stat, factor, rate, happiness, net, longTermNet, reserved, options,
    doorGuardRequired: guardRequired, happinessPerk, moodProfile, moodFactor, radioRoom, radioUsable, atHomeResidents, roomById, now };
}

function workforceTrainingAllowed(resident, room, options) {
  const keys = ['str', 'per', 'end', 'int', 'agi', ...(options.trainCharisma ? ['cha'] : []), ...(options.trainLuck ? ['lck'] : [])];
  const highest = Math.max(...keys.map(key => resident.stats[key]));
  return keys.includes(room.trainStat) && resident.stats[room.trainStat] < 10 &&
    (highest >= 10 || resident.stats[room.trainStat] === highest);
}

function planWorkforceHighest(view, options = {}, model = workforceModel(view, options)) {
  const { types, workers, rooms } = model;
  // 岗位按六项基础属性选择，幸运和服装不参与最高属性比较。
  const keys = ['str', 'per', 'end', 'cha', 'int', 'agi'];
  const candidates = workers.map(worker => {
    const highest = Math.max(...keys.map(key => worker.stats[key]));
    return { worker, highest, stats: keys.filter(key => worker.stats[key] === highest) };
  });
  const order = (left, right) => right.highest - left.highest || left.worker.id - right.worker.id;
  const slots = rooms.filter(room => room.type !== 'training').flatMap(room =>
    Array.from({ length: Math.max(0, room.width * 2 - model.reserved(room)) }, () => ({ room, worker: null })));
  // 先放唯一最高者，再让并列最高者补位或替换属性更低的人；智力岗位工坊优先。
  for (const candidate of [...candidates.filter(item => item.stats.length === 1).sort(order),
    ...candidates.filter(item => item.stats.length > 1).sort(order)]) {
    let options = slots.filter(slot => candidate.stats.includes(types[slot.room.type].stat) &&
      (!slot.worker || slot.worker.stats[types[slot.room.type].stat] < candidate.highest));
    if (options.some(slot => slot.room.type === 'workshop')) options = options.filter(slot => slot.room.type !== 'medbay');
    options.sort((left, right) => {
      return Number(Boolean(left.worker)) - Number(Boolean(right.worker)) ||
        (left.worker ? left.worker.stats[types[left.room.type].stat] - right.worker.stats[types[right.room.type].stat] : 0) ||
        Number(candidate.worker.roomId !== left.room.id) - Number(candidate.worker.roomId !== right.room.id) ||
        slots.indexOf(left) - slots.indexOf(right);
    });
    if (options.length) options[0].worker = candidate.worker;
  }
  // 同类岗位内高属性者使用高等级房间；工坊和医务室按同一智力组重新排列。
  for (const key of keys) {
    const positions = slots.filter(slot => types[slot.room.type].stat === key);
    if (key === 'int') positions.sort((left, right) => Number(right.room.type === 'workshop') - Number(left.room.type === 'workshop'));
    const assigned = positions.map(slot => slot.worker).filter(Boolean)
      .sort((left, right) => right.stats[key] - left.stats[key] || left.id - right.id);
    for (const slot of positions) {
      if (!assigned.length) { slot.worker = null; continue; }
      const index = assigned.findIndex(worker => worker.stats[key] === assigned[0].stats[key] && worker.roomId === slot.room.id);
      slot.worker = assigned.splice(index < 0 ? 0 : index, 1)[0];
    }
  }
  const assignments = slots.filter(slot => slot.worker).map(slot => ({ residentId: slot.worker.id, roomId: slot.room.id }));
  const assignedIds = new Set(assignments.map(item => item.residentId));
  // 原训练室居民全部保留，只使用尚未占用的成人名额。
  const trainingSlots = rooms.filter(room => room.type === 'training').flatMap(room => {
    const occupied = model.reserved(room);
    return Array(Math.max(0, room.width * 2 - occupied)).fill(room);
  });
  let training = 0, resting = 0;
  for (const candidate of candidates.filter(item => !assignedIds.has(item.worker.id)).sort(order)) {
    const index = trainingSlots.findIndex(room => workforceTrainingAllowed(candidate.worker, room, model.options));
    const room = index < 0 ? null : trainingSlots.splice(index, 1)[0];
    assignments.push({ residentId: candidate.worker.id, roomId: room ? room.id : null });
    if (room) training++; else resting++;
  }
  // 训练无位者再补生产空位；所有待安排者已有目标，收支不再计入其原岗位。
  // 废料长期溢出、只有零件工坊消耗它，所以不因为“废料可能变负”把工坊留空。
  for (const assignment of assignments.filter(item => item.roomId === null)) {
    const worker = workers.find(item => item.id === assignment.residentId);
    const net = model.net(assignments);
    const options = slots.filter(slot => !slot.worker).map(slot => {
      const resource = types[slot.room.type].resource;
      const deficit = ['power', 'food', 'water'].includes(resource) && net[resource] < 0;
      return { slot, priority: deficit ? 0 : 1 };
    }).sort((a, b) => a.priority - b.priority ||
      worker.stats[types[b.slot.room.type].stat] - worker.stats[types[a.slot.room.type].stat] ||
      Number(worker.roomId !== a.slot.room.id) - Number(worker.roomId !== b.slot.room.id) ||
      slots.indexOf(a.slot) - slots.indexOf(b.slot));
    if (options.length) {
      const { slot } = options[0];
      slot.worker = worker;
      assignment.roomId = slot.room.id;
      assignedIds.add(worker.id);
      resting--;
    }
  }
  return { assignments, expected: model.net(assignments), excluded: model.excluded,
    available: workers.length, production: assignedIds.size, training, resting };
}

// 最大权重的一对一岗位匹配，空列表示暂不安排。不能只逐人贪心，通才可能占掉专才的唯一合适岗位。
function matchWorkforceSlots(scores) {
  const rows = scores.length;
  if (!rows) return [];
  const columns = scores[0].length;
  const u = new Float64Array(rows + 1), v = new Float64Array(columns + 1);
  const p = new Int32Array(columns + 1), way = new Int32Array(columns + 1);
  for (let row = 1; row <= rows; row++) {
    p[0] = row;
    let column = 0;
    const distance = new Float64Array(columns + 1).fill(Infinity), used = new Uint8Array(columns + 1);
    do {
      used[column] = 1;
      const current = p[column];
      let delta = Infinity, next = 0;
      for (let candidate = 1; candidate <= columns; candidate++) {
        if (used[candidate]) continue;
        const cost = -scores[current - 1][candidate - 1] - u[current] - v[candidate];
        if (cost < distance[candidate]) { distance[candidate] = cost; way[candidate] = column; }
        if (distance[candidate] < delta) { delta = distance[candidate]; next = candidate; }
      }
      for (let candidate = 0; candidate <= columns; candidate++) {
        if (used[candidate]) { u[p[candidate]] += delta; v[candidate] -= delta; }
        else distance[candidate] -= delta;
      }
      column = next;
    } while (p[column]);
    do {
      const previous = way[column];
      p[column] = p[previous];
      column = previous;
    } while (column);
  }
  const result = new Array(rows);
  for (let column = 1; column <= columns; column++) if (p[column]) result[p[column] - 1] = column - 1;
  return result;
}

// 一键安排的核心计算。写成生成器是为了让正式页面按时间片让出主线程：
// 人数很多时，一次算完会长时间占用游戏页面，玩家看到的就是“页面卡死”。
function* planWorkforceProductionSteps(view, model) {
  const { workers, rooms, types, options } = model;
  if (!workers.length) return [];
  // 进度按“准备 + 估分 + 岗位匹配 + 三个起点的迭代 + 长线迭代”的总量折算，供面板显示百分比。
  const iterationBudget = Math.max(20, workers.length * 2);
  const totalSteps = 3 + iterationBudget * 6;
  let stepCount = 0;
  const tick = phase => ({ phase, done: ++stepCount, total: totalSteps });
  yield tick('prepare');
  const targets = rooms.filter(room => room.type !== 'training' ||
    workers.some(resident => workforceTrainingAllowed(resident, room, options)));
  const capacities = targets.map(room => Math.max(0, room.width * 2 - model.reserved(room)));
  const empty = targets.length;
  const resources = ['power', 'food', 'water', 'scrap', 'parts', 'stimpak'];
  const demandOf = resources.map(resource => model.demand[resource]);
  const base = model.net(workers.map(worker => ({ residentId: worker.id, roomId: null })));
  const trainingPerk = view.state.legacy.perks.training ?? 0;
  if (!Number.isFinite(trainingPerk) || trainingPerk < 0) throw new Error('训练加成数据不完整');
  // 不同产物按各自基础产量折算，避免把 1 废料直接当作 1 治疗针比较。
  const values = workers.map(worker => [...targets, null].map(room => {
    const vector = new Array(resources.length).fill(0);
    let production = 0, efficiency = 0, training = 0, speed = 0;
    if (room?.type === 'training') {
      if (!workforceTrainingAllowed(worker, room, options)) return null;
      training = 1;
      speed = room.level * (1 + trainingPerk * 0.05) / (worker.stats[room.trainStat] + 1);
    } else if (room) {
      production = 1;
      const definition = types[room.type];
      if (definition.resource) {
        const rate = model.rate(worker, room);
        vector[resources.indexOf(definition.resource)] = rate;
        if (room.type === 'workshop') vector[3] = -6 * rate;
        efficiency = rate / definition.base;
      } else {
        // 电台招募只用基础魅力，服装、等级和心情不计入。
        efficiency = worker.stats.cha / 10;
      }
    }
    return { vector, production, efficiency, training, speed, stay: Number(worker.roomId === (room?.id ?? null)) };
  }));
  const maxEfficiency = Math.max(1, ...values.map(row => Math.max(...row.map(value => value?.efficiency ?? 0))));
  const maxSpeed = Math.max(1, ...values.map(row => Math.max(...row.map(value => value?.speed ?? 0))));
  const columns = targets.flatMap((_, index) => Array(capacities[index]).fill(index)).concat(Array(workers.length).fill(empty));
  const scores = values.map(row => columns.map(column => {
    const value = row[column];
    return !value ? -1e12 : value.production * (maxEfficiency * workers.length + 2) + value.efficiency +
      (value.training + value.speed / (maxSpeed + 1) * 0.1) / (1000 * workers.length) + value.stay * 1e-9;
  }));
  yield tick('score');
  const matched = matchWorkforceSlots(scores).map(column => columns[column]);
  yield tick('match');
  function summarize(positions) {
    const result = { net: resources.map(key => base[key]), production: 0, efficiency: 0, training: 0, speed: 0, stay: 0 };
    positions.forEach((position, index) => {
      const value = values[index][position];
      resources.forEach((_, resource) => { result.net[resource] += value.vector[resource]; });
      for (const key of ['production', 'efficiency', 'training', 'speed', 'stay']) result[key] += value[key];
    });
    return result;
  }
  // 电、粮、水的需求只由已建房间和人口决定，安排不改需求；废料长期溢出且只有零件工坊消耗它，
  // 所以“填满岗位 + 上高属性”本身就会把产出做到最好。缺口只在产出完全相同时用来打破平局
  // （例如同样产出下，一个电力房塞满两人不如电力、餐厅各一人），不参与任何牺牲产出的取舍。
  function shortageOf(net) {
    let shortage = 0;
    for (let resource = 0; resource < 3; resource++) {
      if (net[resource] < 0) shortage -= net[resource] / (resource === 0 ? 12 : 8);
    }
    return shortage;
  }
  // 总产出按各产物的基础产量折算；工坊耗料加回废料，避免同一份废料既算产出又扣一次。
  function outputOf(net) {
    const power = net[0] + demandOf[0], food = net[1] + demandOf[1], water = net[2] + demandOf[2];
    const scrap = net[3] + demandOf[3], parts = net[4] + demandOf[4], stimpak = net[5] + demandOf[5];
    return Math.max(0, power) / 12 + Math.max(0, food) / 8 + Math.max(0, water) / 8 +
      Math.max(0, scrap + 6 * parts) / 8 + Math.max(0, parts) / 0.6 + Math.max(0, stimpak) / 0.5;
  }
  // 排序目标就是“产出”：先填满生产岗位，再比总产出与有效属性，产出相同时才看电粮水平衡。
  function rank(summary) {
    return [summary.production, outputOf(summary.net), -shortageOf(summary.net), summary.efficiency,
      summary.training, summary.speed, summary.stay];
  }
  function better(left, right) {
    for (let index = 0; index < left.length; index++) {
      const difference = left[index] - right[index];
      if (difference > 1e-7) return true;
      if (difference < -1e-7) return false;
    }
    return false;
  }
  function fromAssignments(assignments) {
    const byId = new Map(assignments.map(item => [item.residentId, item.roomId]));
    return workers.map((worker, index) => {
      const target = targets.findIndex(room => room.id === byId.get(worker.id));
      return target >= 0 && values[index][target] ? target : empty;
    });
  }
  const current = fromAssignments(workers.map(worker => ({ residentId: worker.id, roomId: worker.roomId })));
  const previous = fromAssignments(planWorkforceHighest(view, options, model).assignments);
  function fits(positions) {
    return capacities.every((capacity, room) => positions.filter(position => position === room).length <= capacity);
  }
  // 逐级比较：先看岗位数，再看总产出，两项都打平才算电粮水平衡和其余指标。
  // 绝大多数候选在前两级就会被淘汰，因此后面的计算按需进行，避免每个候选都全算一遍。
  const EPS = 1e-7;
  function* improve(seed) {
    const positions = [...seed];
    let summary = summarize(positions);
    const zero = { vector: new Array(resources.length).fill(0), production: 0, efficiency: 0, training: 0, speed: 0, stay: 0 };
    const candidateRank = new Float64Array(7);
    const candidateNet = new Float64Array(resources.length);
    // 单人改派和两人互换：空位先填满，再把高属性的人换到对口岗位；每一步只接受严格改善。
    // 这是启发式优化，不宣称所有资源目标下的数学全局最优。
    for (let iteration = 0; iteration < iterationBudget; iteration++) {
      const occupied = new Array(targets.length).fill(0);
      for (const position of positions) if (position !== empty) occupied[position]++;
      let improvement = null;
      const bestRank = rank(summary);
      function consider(index, destination, other = -1) {
        const before = values[index][positions[index]], after = values[index][destination];
        const otherBefore = other < 0 ? zero : values[other][positions[other]];
        const otherAfter = other < 0 ? zero : values[other][positions[index]];
        const production = summary.production + after.production - before.production +
          otherAfter.production - otherBefore.production;
        const productionGap = production - bestRank[0];
        if (productionGap < -EPS) return;
        if (productionGap <= EPS) {
          for (let resource = 0; resource < resources.length; resource++) {
            candidateNet[resource] = summary.net[resource] + after.vector[resource] - before.vector[resource] +
              otherAfter.vector[resource] - otherBefore.vector[resource];
          }
          const outputGap = outputOf(candidateNet) - bestRank[1];
          if (outputGap < -EPS) return;
          if (outputGap <= EPS) {
            // 岗位数与产出都打平，才继续比较电粮水平衡、有效属性等。
            candidateRank[0] = production;
            candidateRank[1] = bestRank[1] + outputGap;
            candidateRank[2] = -shortageOf(candidateNet);
            candidateRank[3] = summary.efficiency + after.efficiency - before.efficiency + otherAfter.efficiency - otherBefore.efficiency;
            candidateRank[4] = summary.training + after.training - before.training + otherAfter.training - otherBefore.training;
            candidateRank[5] = summary.speed + after.speed - before.speed + otherAfter.speed - otherBefore.speed;
            candidateRank[6] = summary.stay + after.stay - before.stay + otherAfter.stay - otherBefore.stay;
            if (!better(candidateRank, bestRank)) return;
          }
        }
        // 接受候选：把整条比较向量补齐，后续候选继续和它比。
        improvement = { index, destination, other };
        for (let resource = 0; resource < resources.length; resource++) {
          candidateNet[resource] = summary.net[resource] + after.vector[resource] - before.vector[resource] +
            otherAfter.vector[resource] - otherBefore.vector[resource];
        }
        bestRank[0] = production;
        bestRank[1] = outputOf(candidateNet);
        bestRank[2] = -shortageOf(candidateNet);
        bestRank[3] = summary.efficiency + after.efficiency - before.efficiency + otherAfter.efficiency - otherBefore.efficiency;
        bestRank[4] = summary.training + after.training - before.training + otherAfter.training - otherBefore.training;
        bestRank[5] = summary.speed + after.speed - before.speed + otherAfter.speed - otherBefore.speed;
        bestRank[6] = summary.stay + after.stay - before.stay + otherAfter.stay - otherBefore.stay;
      }
      for (let index = 0; index < workers.length; index++) {
        for (let destination = 0; destination <= empty; destination++) {
          if (destination !== positions[index] && values[index][destination] &&
              (destination === empty || occupied[destination] < capacities[destination])) consider(index, destination);
        }
        for (let other = index + 1; other < workers.length; other++) {
          if (positions[index] !== positions[other] && values[index][positions[other]] && values[other][positions[index]]) {
            consider(index, positions[other], other);
          }
        }
      }
      if (!improvement) break;
      const { index, destination, other } = improvement;
      if (other >= 0) positions[other] = positions[index];
      positions[index] = destination;
      summary = summarize(positions);
      yield tick('improve');
    }
    return { positions, summary };
  }
  // 三个起点各自改派优化后只保留最好的一个（比较用同一套优先级），长线优化再从它继续。
  let best = null;
  const seen = new Set();
  for (const seed of [matched, current, previous]) if (fits(seed) && !seen.has(seed.join(','))) {
    seen.add(seed.join(','));
    const candidate = yield* improve(seed);
    if (!best || better(rank(candidate.summary), rank(best.summary))) best = candidate;
  }
  function assignmentsAt(positions) {
    return workers.map((worker, index) => ({ residentId: worker.id, roomId: targets[positions[index]]?.id ?? null }));
  }
  // 长线评价原来对每个候选都整轮重算净产出与心情（人数一多就是几亿次运算）。这里改成增量维护：
  // 每个候选只换 1–2 人，直接加减他们的贡献；电台是否有人会全体改变目标心情，
  // 因此“无电台/有电台”两套长期累加量同时维护，避免每碰一次电台就重新算一遍全场。
  const metricsKeys = ['production', 'efficiency', 'training', 'speed', 'stay'];
  const slots = empty + 1;
  const destinationResource = new Int8Array(slots).fill(-1);
  const destinationScrap = new Float64Array(slots);
  targets.forEach((room, index) => {
    const resource = types[room.type].resource;
    destinationResource[index] = resource ? resources.indexOf(resource) : -1;
    destinationScrap[index] = room.type === 'workshop' ? -6 : 0;
  });
  // 每个 (居民, 目的地) 的当前产量、两种电台状态下的长期产量和目标心情都只算一次。
  const slotCur = new Float64Array(workers.length * slots);
  const slotLong = [new Float64Array(workers.length * slots), new Float64Array(workers.length * slots)];
  const slotMood = [new Float64Array(workers.length * slots), new Float64Array(workers.length * slots)];
  for (let index = 0; index < workers.length; index++) {
    const worker = workers[index];
    for (let destination = 0; destination < slots; destination++) {
      const offset = index * slots + destination;
      const room = destination === empty ? null : targets[destination];
      const profile = model.moodProfile(worker, room ? room.id : null);
      const unit = room ? model.rate(worker, room, 100) : 0;
      for (const series of [0, 1]) {
        const mood = Math.max(5, Math.min(100, profile.base + series * 10));
        slotMood[series][offset] = mood;
        slotLong[series][offset] = unit * model.moodFactor(mood);
      }
      const value = values[index][destination];
      slotCur[offset] = value && destinationResource[destination] >= 0 ? value.vector[destinationResource[destination]] : 0;
    }
  }
  // [0..5] 当前心情总产出，[6..11] 无电台长期总产出，[12..17] 有电台长期总产出；净产出再减 demand。
  const totals = new Float64Array(18);
  const metricTotals = new Float64Array(5);
  const delta = new Float64Array(18);
  const metricDelta = new Float64Array(5);
  const candidateMetrics = new Float64Array(9);
  const netLong = new Float64Array(6);
  const occupied = new Array(targets.length).fill(0);
  const radioIndex = model.radioRoom ? targets.findIndex(room => room.id === model.radioRoom.id) : -1;
  const workerIdSet = new Set(workers.map(worker => worker.id));
  const fixedResidents = model.atHomeResidents.filter(resident => !workerIdSet.has(resident.id));
  const radioFixed = radioIndex >= 0 && fixedResidents.some(resident => resident.adultAt <= model.now && resident.roomId === model.radioRoom.id);
  let currentMoodSum = 0;
  const moodSum = [0, 0];
  function accumulate(target, metricTarget, index, destination, sign) {
    const offset = index * slots + destination;
    const resource = destinationResource[destination];
    const scrap = destinationScrap[destination];
    const cur = slotCur[offset], longNo = slotLong[0][offset], longRadio = slotLong[1][offset];
    if (resource >= 0) {
      target[resource] += sign * cur;
      target[6 + resource] += sign * longNo;
      target[12 + resource] += sign * longRadio;
    }
    if (scrap) {
      target[3] += sign * scrap * cur;
      target[9] += sign * scrap * longNo;
      target[15] += sign * scrap * longRadio;
    }
    const value = values[index][destination];
    for (let metric = 0; metric < 5; metric++) metricTarget[metric] += sign * value[metricsKeys[metric]];
  }
  // 把累加量折算成比较向量：岗位数 → 当前/长期电粮水缺口 → 长期产出 → 有效属性 → 其余。
  // 把累加量折算成比较向量：岗位数 → 长期产出 → 电粮水平衡 → 有效属性 → 训练/速度 → 心情 → 原岗保持。
  function computeMetrics(series, moodChange) {
    const offset = 6 + series * 6;
    for (let resource = 0; resource < 6; resource++) {
      netLong[resource] = totals[offset + resource] + delta[offset + resource] - demandOf[resource];
    }
    const targetSum = moodSum[series] + moodChange;
    candidateMetrics[0] = metricTotals[0] + metricDelta[0];
    candidateMetrics[1] = outputOf(netLong);
    candidateMetrics[2] = -shortageOf(netLong);
    candidateMetrics[3] = metricTotals[1] + metricDelta[1];
    candidateMetrics[4] = metricTotals[2] + metricDelta[2];
    candidateMetrics[5] = metricTotals[3] + metricDelta[3];
    candidateMetrics[6] = residentCount ? targetSum / residentCount : 0;
    candidateMetrics[7] = residentCount ? (currentMoodSum + targetSum) / 2 / residentCount : 0;
    candidateMetrics[8] = metricTotals[4] + metricDelta[4];
  }
  const residentCount = model.atHomeResidents.length;
  const positions = new Array(workers.length).fill(empty);
  // 换一个起点时把累加量整体重算一遍（只发生几次），之后每个候选都在 O(1) 时间内比较。
  function resetState(start) {
    for (let index = 0; index < workers.length; index++) positions[index] = start[index];
    totals.fill(0);
    metricTotals.fill(0);
    delta.fill(0);
    metricDelta.fill(0);
    occupied.fill(0);
    moodSum[0] = 0;
    moodSum[1] = 0;
    currentMoodSum = 0;
    for (let resource = 0; resource < 6; resource++) totals[resource] = base[resources[resource]] + demandOf[resource];
    // 不受一键安排影响的居民（儿童以外的保留者）固定在自己房间，贡献先算进累加量。
    for (const resident of fixedResidents) {
      const profile = model.moodProfile(resident, resident.roomId);
      const moods = [Math.max(5, Math.min(100, profile.base)), Math.max(5, Math.min(100, profile.base + 10))];
      moodSum[0] += moods[0];
      moodSum[1] += moods[1];
      currentMoodSum += Math.max(0, Math.min(100, resident.happiness));
      const room = resident.roomId === null ? null : model.roomById.get(resident.roomId);
      const resource = room && rooms.includes(room) ? types[room.type].resource : null;
      if (!resource) continue;
      const destinationResourceIndex = resources.indexOf(resource);
      const unit = model.rate(resident, room, 100);
      const scrap = room.type === 'workshop' ? -6 : 0;
      const rates = [unit * model.moodFactor(moods[0]), unit * model.moodFactor(moods[1])];
      for (const series of [0, 1]) {
        const offset = 6 + series * 6;
        totals[offset + destinationResourceIndex] += rates[series];
        totals[offset + 3] += scrap * rates[series];
      }
    }
    for (let index = 0; index < workers.length; index++) accumulate(totals, metricTotals, index, positions[index], 1);
    for (let index = 0; index < workers.length; index++) {
      const offset = index * slots + positions[index];
      moodSum[0] += slotMood[0][offset];
      moodSum[1] += slotMood[1][offset];
      currentMoodSum += Math.max(0, Math.min(100, workers[index].happiness));
      if (positions[index] !== empty) occupied[positions[index]]++;
    }
  }
  function seriesNow(radioWorkers) {
    return model.radioUsable && (radioWorkers > 0 || radioFixed) ? 1 : 0;
  }
  function stateMetrics() {
    delta.fill(0);
    metricDelta.fill(0);
    const series = seriesNow(radioIndex >= 0 ? occupied[radioIndex] : 0);
    computeMetrics(series, 0);
    return Float64Array.from(candidateMetrics);
  }
  function evaluate(index, destination, other) {
    delta.fill(0);
    metricDelta.fill(0);
    const from = positions[index];
    accumulate(delta, metricDelta, index, from, -1);
    accumulate(delta, metricDelta, index, destination, 1);
    const fromOffset = index * slots + from, toOffset = index * slots + destination;
    let moodChangeNo = slotMood[0][toOffset] - slotMood[0][fromOffset];
    let moodChangeRadio = slotMood[1][toOffset] - slotMood[1][fromOffset];
    let radioWorkers = radioIndex >= 0 ? occupied[radioIndex] : 0;
    if (destination === radioIndex) radioWorkers++;
    if (from === radioIndex) radioWorkers--;
    if (other >= 0) {
      const otherFrom = positions[other];
      accumulate(delta, metricDelta, other, otherFrom, -1);
      accumulate(delta, metricDelta, other, from, 1);
      moodChangeNo += slotMood[0][other * slots + from] - slotMood[0][other * slots + otherFrom];
      moodChangeRadio += slotMood[1][other * slots + from] - slotMood[1][other * slots + otherFrom];
      if (otherFrom === radioIndex) radioWorkers--;
      if (from === radioIndex) radioWorkers++;
    }
    const series = seriesNow(radioWorkers);
    computeMetrics(series, series === 1 ? moodChangeRadio : moodChangeNo);
  }
  // 按当前累加量真正落定一次改派，之后所有候选都在新状态上继续比较。
  function commit(index, destination, other) {
    const from = positions[index];
    accumulate(totals, metricTotals, index, from, -1);
    accumulate(totals, metricTotals, index, destination, 1);
    moodSum[0] += slotMood[0][index * slots + destination] - slotMood[0][index * slots + from];
    moodSum[1] += slotMood[1][index * slots + destination] - slotMood[1][index * slots + from];
    if (from !== empty) occupied[from]--;
    if (destination !== empty) occupied[destination]++;
    positions[index] = destination;
    if (other >= 0) {
      const otherFrom = positions[other];
      accumulate(totals, metricTotals, other, otherFrom, -1);
      accumulate(totals, metricTotals, other, from, 1);
      moodSum[0] += slotMood[0][other * slots + from] - slotMood[0][other * slots + otherFrom];
      moodSum[1] += slotMood[1][other * slots + from] - slotMood[1][other * slots + otherFrom];
      if (otherFrom !== empty) occupied[otherFrom]--;
      if (from !== empty) occupied[from]++;
      positions[other] = from;
    }
  }
  // 在即时资源安全的起点上再做整套分配级的长线优化。每次只接受严格改善，
  // 这样电台全体心情增益会被所有消费者共享，而调去电台者的岗位损失也会一并计入。
  function* optimizeLongTerm(start) {
    resetState(start);
    let longTerm = stateMetrics();
    for (let iteration = 0; iteration < iterationBudget; iteration++) {
      let improvement = null;
      const bestMetrics = Float64Array.from(longTerm);
      const consider = (index, destination, other = -1) => {
        evaluate(index, destination, other);
        if (better(candidateMetrics, bestMetrics)) {
          improvement = { index, destination, other };
          for (let metric = 0; metric < candidateMetrics.length; metric++) bestMetrics[metric] = candidateMetrics[metric];
        }
      };
      for (let index = 0; index < workers.length; index++) {
        for (let destination = 0; destination <= empty; destination++) {
          if (destination === positions[index] || !values[index][destination] ||
              (destination !== empty && occupied[destination] >= capacities[destination])) continue;
          consider(index, destination);
        }
        for (let other = index + 1; other < workers.length; other++) {
          if (positions[index] === positions[other] || !values[index][positions[other]] || !values[other][positions[index]]) continue;
          consider(index, positions[other], other);
        }
      }
      if (!improvement) break;
      commit(improvement.index, improvement.destination, improvement.other);
      longTerm = bestMetrics;
      yield tick('long');
    }
    return { positions: [...positions], metrics: longTerm };
  }
  // 起点确定后做长线优化：电台全体心情增益会被所有消费者共享，调去电台者的岗位损失也一并计入。
  return assignmentsAt((yield* optimizeLongTerm(best.positions)).positions);
}

function planWorkforceProduction(view, model) {
  return drainWorkforceSteps(planWorkforceProductionSteps(view, model));
}

// 生成器先跑到结束再返回最终方案，供离线测试和其它同步调用方使用。
function drainWorkforceSteps(steps) {
  let step;
  do { step = steps.next(); } while (!step.done);
  return step.value;
}

function* planWorkforceSteps(view, options = {}) {
  const model = workforceModel(view, options);
  let assignments;
  if (model.options.strategy === 'highest') {
    assignments = planWorkforceHighest(view, model.options, model).assignments;
  } else {
    assignments = yield* planWorkforceProductionSteps(view, model);
  }
  const ids = new Set();
  for (const assignment of assignments) {
    if (ids.has(assignment.residentId) || !model.workers.some(worker => worker.id === assignment.residentId) ||
        (assignment.roomId !== null && !model.rooms.some(room => room.id === assignment.roomId))) throw new Error('居民安排方案无效');
    ids.add(assignment.residentId);
  }
  if (ids.size !== model.workers.length || model.rooms.some(room => assignments.filter(item => item.roomId === room.id).length + model.reserved(room) > room.width * 2)) {
    throw new Error('居民安排方案超过房间容量');
  }
  const training = assignments.filter(item => model.rooms.find(room => room.id === item.roomId)?.type === 'training').length;
  const resting = assignments.filter(item => item.roomId === null).length;
  // 门外待命的人不是被跳过：所有在家的可调成人都会参与匹配，这里是可用岗位不够时的真实缺口。
  const capacity = { production: 0, training: 0 };
  for (const room of model.rooms) {
    const free = Math.max(0, room.width * 2 - model.reserved(room));
    if (room.type === 'training') capacity.training += free; else capacity.production += free;
  }
  const mood = model.happiness(assignments);
  return { assignments, expected: model.net(assignments), longTermExpected: model.longTermNet(assignments), happiness: mood,
    excluded: model.excluded, unavailableRooms: model.unavailableRooms, options: model.options, doorGuardRequired: model.doorGuardRequired,
    available: model.workers.length, production: assignments.length - training - resting, training, resting,
    capacity, capacityShortfall: Math.max(0, model.workers.length - capacity.production - capacity.training),
    changed: assignments.filter(item => view.state.residents.find(worker => worker.id === item.residentId).roomId !== item.roomId).length };
}

function planWorkforce(view, options = {}) {
  return drainWorkforceSteps(planWorkforceSteps(view, options));
}

// 一键安排跑在游戏页面主线程上。人数较多时单次同步计算会让页面长时间无响应，
// 因此正式流程按时间片推进：每段运行不超过 budget 毫秒，其余工作留给后续事件循环。
async function planWorkforceChunked(view, options = {}, hooks = {}) {
  const steps = planWorkforceSteps(view, options);
  const budget = Number.isFinite(hooks.budget) && hooks.budget >= 0 ? hooks.budget : 12;
  const defer = hooks.defer ?? (typeof setTimeout === 'function' ? () => new Promise(resolve => setTimeout(resolve, 0)) : () => Promise.resolve());
  let stamp = Date.now();
  for (;;) {
    if (hooks.stopped?.()) throw new Error('已按下停止，未提交安排方案');
    const step = steps.next();
    if (step.done) return step.value;
    if (Date.now() - stamp < budget) continue;
    hooks.onProgress?.(step.value);
    await defer();
    stamp = Date.now();
  }
}

function workforceContext(view, options) {
  workforceModel(view, options);
  const keys = ['str', 'per', 'end', 'cha', 'int', 'agi', 'lck'];
  return JSON.stringify({
    residents: [...view.state.residents].sort((a, b) => a.id - b.id).map(resident => [resident.id,
      resident.adultAt <= view.serverTime, Boolean(resident.away), resident.deadAt, resident.familyCooldownUntil > view.serverTime,
      resident.outfitId, resident.happiness, keys.map(key => resident.stats[key])]),
    rooms: [...view.state.rooms].sort((a, b) => a.id - b.id).map(room => [room.id, room.type, room.width, room.level, room.floor, room.col,
      room.builtAt <= view.serverTime, room.upgradeAt, workforceIncidentBlocksAutomation(room, view), Boolean(room.unpowered), room.trainStat, Boolean(room.craft)]),
    outfits: view.state.items.filter(item => item.slot === 'outfit').sort((a, b) => a.id - b.id)
      .map(item => [item.id, keys.map(key => item.bonus?.[key] ?? 0)]),
    resources: [workforceResourceAmount(view.state, 'food'), workforceResourceAmount(view.state, 'water')],
    perks: [view.state.legacy?.perks?.production ?? 0, view.state.legacy?.perks?.training ?? 0,
      view.state.legacy?.perks?.happiness ?? view.state.legacy?.perks?.mood ?? 0],
    doorGuardRequired: workforceDoorGuardRequired(view)
  });
}

// 同种资源的房间出现空位时，把已经在该资源更低等级房间里工作的居民迁到高等级房间：
// 高等级房间产能更高，迁入后这种资源的总产出上升，不会造成新的缺口。
// 外出居民的岗位仍占容量，与游戏调动校验一致；正在升级、停电的房间暂时没有产出，不作为迁入目标。
function planRoomUpgrade(view, excludedIds = new Set()) {
  const model = workforceModel(view);
  const now = view.serverTime;
  const resourceOf = room => model.types[room.type]?.resource ?? null;
  const questTeams = new Set((Array.isArray(view.state.quests) ? view.state.quests : [])
    .flatMap(run => Array.isArray(run.team) ? run.team : []));
  const positions = new Map(view.state.residents.map(resident => [resident.id, resident.roomId]));
  const occupants = roomId => shelterRoomOccupancy(view, roomId, [...positions].map(([residentId, roomId]) => ({ residentId, roomId })));
  const assignments = [];
  excludedIds = new Set([...excludedIds, ...shelterCoordination(view).protectedIds]);
  for (let step = 0; step < 12; step++) {
    let best = null;
    for (const target of model.rooms) {
      const resource = resourceOf(target);
      if (!resource || occupants(target.id) >= target.width * 2) continue;
      for (const worker of view.state.residents) {
        if (worker.away !== null || worker.deadAt !== null || worker.adultAt > now || questTeams.has(worker.id) ||
            excludedIds.has(worker.id)) continue;
        const origin = view.state.rooms.find(room => room.id === positions.get(worker.id));
        if (!origin || workforceIncidentBlocksAutomation(origin, view) || origin.craft || origin.id === target.id || resourceOf(origin) !== resource || origin.level >= target.level) continue;
        // 零件工坊迁入会增加废料消耗，废料会转负时不迁。
        if (resource === 'parts' && model.net([...assignments, { residentId: worker.id, roomId: target.id }]).scrap < 0) continue;
        const gain = model.rate(worker, target) - model.rate(worker, origin);
        if (gain <= 0) continue;
        // 优先等级差大的迁移，其次选产出提升最大的人，最后按 ID 稳定排序。
        const score = [target.level - origin.level, gain, -worker.id];
        if (!best || score[0] > best.score[0] || score[0] === best.score[0] &&
            (score[1] > best.score[1] || score[1] === best.score[1] && score[2] > best.score[2])) {
          best = { worker, origin, target, score };
        }
      }
    }
    if (!best) break;
    positions.set(best.worker.id, best.target.id);
    assignments.push({
      residentId: best.worker.id, roomId: best.target.id,
      message: `等级调整：${best.worker.name}#${best.worker.id} 从 ${best.origin.floor} 层 ${best.origin.level} 级${model.types[best.origin.type].name}调到 ` +
        `${best.target.floor} 层 ${best.target.level} 级${model.types[best.target.type].name}（房间 ${best.target.id}）。`
    });
  }
  return assignments;
}

// 资源补缺：电力、食物、净水出现负收益时，从废料回收站、零件工坊、医务室、电台等
// 非缺口岗位调出居民补进缺口房间的空位。训练室居民不参与，避免中断训练；
// 原岗位的资源调出后不能转负。一次最多规划 12 步，由托管逐条执行。
function planResourceBalance(view, excludedIds = new Set()) {
  const model = workforceModel(view);
  if (!Array.isArray(view?.state?.births)) throw new Error('避难所数据格式已变化');
  const deficitsKeys = ['power', 'food', 'water'];
  const now = view.serverTime;
  const types = model.types;
  const rooms = model.rooms;
  const roomById = new Map(view.state.rooms.map(room => [room.id, room]));
  const atHome = resident => resident.away === null && resident.deadAt === null && resident.adultAt <= now;
  const positions = new Map(view.state.residents.filter(atHome).map(resident => [resident.id, resident.roomId]));
  const resourceOf = room => types[room.type]?.resource ?? null;
  const questTeams = new Set((Array.isArray(view.state.quests) ? view.state.quests : [])
    .flatMap(run => Array.isArray(run.team) ? run.team : []));
  const occupants = room => shelterRoomOccupancy(view, room.id, [...positions].map(([residentId, roomId]) => ({ residentId, roomId })));
  // 调出优先废料回收站（废料通常富余），其次医务室、电台，最后才是零件工坊。
  const originOrder = { scrap: 0, medbay: 1, radio: 2, workshop: 3 };
  const assignments = [];
  excludedIds = new Set([...excludedIds, ...shelterCoordination(view).protectedIds]);
  for (let step = 0; step < 12; step++) {
    const net = model.net(assignments);
    const deficits = deficitsKeys.filter(key => net[key] < 0).sort((left, right) => net[left] - net[right]);
    if (!deficits.length) break;
    let best = null;
    // 逐项比较：缺口大的资源优先，同一资源优先等级高的工作地点，再比较产出增益。
    const better = (left, right) => {
      for (let index = 0; index < left.length; index++) {
        if (left[index] !== right[index]) return left[index] > right[index];
      }
      return false;
    };
    const same = (left, right) => left.every((value, index) => value === right[index]);
    for (const resident of view.state.residents) {
      if (!atHome(resident) || questTeams.has(resident.id) || excludedIds.has(resident.id)) continue;
      const origin = roomById.get(positions.get(resident.id));
      if (!origin || workforceIncidentBlocksAutomation(origin, view) || origin.craft) continue;
      const originResource = resourceOf(origin);
      // 只从非缺口资源岗位调人，训练室、宿舍等没有资源产出的岗位不动。
      if ((!originResource && origin.type !== 'radio') || deficitsKeys.includes(originResource)) continue;
      const loss = model.rate(resident, origin);
      // 调出后原岗位的资源仍不能为负。
      if (originResource && net[originResource] - loss < 0) continue;
      for (const [resourceIndex, resource] of deficits.entries()) {
        for (const room of rooms.filter(room => resourceOf(room) === resource && occupants(room) < room.width * 2)) {
          const gain = model.rate(resident, room);
          if (gain <= 0) continue;
          // 同产品优先等级高的房间；缺口相同时优先从废料回收站调人，再比较产出增益。
          const score = [deficits.length - resourceIndex, room.level, -(originOrder[origin.type] ?? 9), gain, -loss];
          if (!best || better(score, best.score) || same(score, best.score) && resident.id < best.resident.id) {
            best = { resident, origin, room, score };
          }
        }
      }
    }
    if (!best) break;
    positions.set(best.resident.id, best.room.id);
    assignments.push({
      residentId: best.resident.id, roomId: best.room.id,
      message: `资源补缺：${best.resident.name}#${best.resident.id} 从${types[best.origin.type]?.name ?? best.origin.type}调到${types[best.room.type]?.name}（房间 ${best.room.id}）。`
    });
  }
  return assignments;
}

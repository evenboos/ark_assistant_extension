// 夜间大门掠夺者冻结，不应阻止换装或让居民永久退出装备分配。
function shelterEquipmentIncidentBlocks(room, serverTime) {
  if (!room?.incident) return false;
  const date = new Date(serverTime);
  const doorGuardRequired = !Number.isFinite(date.getTime()) || new Date(date.getTime() + 8 * 3600000).getUTCHours() >= 8;
  return !(room.type === 'door' && room.incident.kind === 'raiders' && !doorGuardRequired);
}

function shelterEquipmentModel(view) {
  const state = view?.state;
  const now = view?.serverTime;
  const keys = ['str', 'per', 'end', 'cha', 'int', 'agi', 'lck'];
  const fields = { weapon: 'weaponId', outfit: 'outfitId' };
  const production = { power: 'str', diner: 'agi', water: 'per', scrap: 'end', medbay: 'int', workshop: 'int', sorter: 'lck' };
  if (!Number.isFinite(now) || !Array.isArray(state?.residents) || !Array.isArray(state.rooms) || !Array.isArray(state.items)) {
    throw new Error('装备或居民数据不完整，无法分配');
  }
  if (view.switches?.frozen) throw new Error('避难所正在维护');
  const rooms = new Map(), items = new Map(), residents = new Map(), owners = new Map();
  for (const room of state.rooms) {
    if (!Number.isInteger(room.id) || rooms.has(room.id) || typeof room.type !== 'string') throw new Error('房间数据格式已变化');
    rooms.set(room.id, room);
  }
  for (const item of state.items) {
    if (!Number.isInteger(item.id) || items.has(item.id) || !Object.hasOwn(fields, item.slot) || typeof item.name !== 'string' ||
        (item.slot === 'weapon' && (!Array.isArray(item.damage) || item.damage.length !== 2 ||
          !item.damage.every(value => Number.isFinite(value) && value >= 0) || item.damage[1] < item.damage[0])) ||
        (item.slot === 'outfit' && (!item.bonus || Object.entries(item.bonus).some(([key, value]) =>
          !keys.includes(key) || !Number.isFinite(value) || value < 0)))) throw new Error('装备属性格式已变化');
    items.set(item.id, item);
  }
  const excluded = [], candidates = [];
  const questIds = new Set((state.quests ?? []).flatMap(run => Array.isArray(run.team) ? run.team : []));
  for (const resident of state.residents) {
    if (!Number.isInteger(resident.id) || residents.has(resident.id) || typeof resident.name !== 'string' ||
        !Number.isFinite(resident.adultAt) || !Number.isFinite(resident.xp) || resident.xp < 0 ||
        !keys.every(key => Number.isFinite(resident.stats?.[key]) && resident.stats[key] >= 0 && resident.stats[key] <= 10) ||
        (resident.roomId !== null && !rooms.has(resident.roomId)) ||
        (resident.away !== null && (typeof resident.away !== 'object' || !resident.away)) ||
        (resident.deadAt !== null && !Number.isFinite(resident.deadAt))) throw new Error(`居民「${resident.name ?? resident.id}」的数据不完整`);
    residents.set(resident.id, resident);
    for (const [slot, field] of Object.entries(fields)) {
      const id = resident[field];
      if (id === null) continue;
      if (!items.has(id) || items.get(id).slot !== slot || owners.has(id)) throw new Error('装备归属数据不一致');
      owners.set(id, resident.id);
    }
    const room = rooms.get(resident.roomId);
    const reason = resident.locked ? '居民已锁定' : resident.giftOffer ? '居民正在赠送' : questIds.has(resident.id) ? '本周任务小队' : resident.adultAt > now ? '儿童' : resident.away !== null ? '外出中' :
      resident.deadAt !== null ? '已倒下' : shelterEquipmentIncidentBlocks(room, now) ? '所在房间正在处理事件' : '';
    if (reason) excluded.push({ id: resident.id, name: resident.name, reason });
    else candidates.push(resident);
  }
  candidates.sort((left, right) => left.id - right.id);
  const protectedIds = new Set(excluded.map(resident => resident.id));
  const reserved = new Set(state.residents.flatMap(resident => Object.values(resident.away?.reservedEquipment ?? {})));
  const available = state.items.filter(item => !reserved.has(item.id) && !protectedIds.has(owners.get(item.id))).sort((left, right) => left.id - right.id);
  const gain = (resident, item, key) => Math.min(17, resident.stats[key] + (item?.bonus?.[key] ?? 0)) - resident.stats[key];
  const combat = (resident, outfit) => 2 * Math.min(50, 1 + Math.floor(Math.sqrt(resident.xp / 3))) +
    ['str', 'end', 'agi'].reduce((sum, key) => sum + resident.stats[key] + gain(resident, outfit, key), 0);
  return { state, keys, fields, production, rooms, items, residents, owners, excluded, candidates, available, gain, combat };
}

// 矩形匈牙利算法：每人一行，每件服装一列，额外空列表示不穿服装。
// 一次比较全部搭配，避免先拿走通用服装后，专用服装无人可用。
function matchShelterOutfits(scores) {
  const rows = scores.length;
  if (!rows) return [];
  const columns = scores[0].length;
  const u = new Float64Array(rows + 1), v = new Float64Array(columns + 1);
  const p = new Int32Array(columns + 1), way = new Int32Array(columns + 1);
  for (let row = 1; row <= rows; row++) {
    p[0] = row;
    let column = 0;
    const distance = new Float64Array(columns + 1).fill(Infinity);
    const used = new Uint8Array(columns + 1);
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
  const assignment = new Array(rows);
  for (let column = 1; column <= columns; column++) if (p[column]) assignment[p[column] - 1] = column - 1;
  return assignment;
}

function planShelterEquipment(view, options = { weapons: true, outfits: true }) {
  if (typeof options.weapons !== 'boolean' || typeof options.outfits !== 'boolean' || (!options.weapons && !options.outfits)) {
    throw new Error('请至少选择武器或服装');
  }
  const model = shelterEquipmentModel(view);
  const { candidates, available, rooms, items, production, keys, gain, combat } = model;
  const targets = candidates.map(resident => ({ residentId: resident.id, weaponId: resident.weaponId, outfitId: resident.outfitId }));
  const targetById = new Map(targets.map(target => [target.residentId, target]));
  if (options.outfits && candidates.length) {
    const outfits = available.filter(item => item.slot === 'outfit');
    const count = candidates.length;
    // 总岗位属性优先，其次战斗属性、七项总加成；同分尽量保留当前穿戴。
    const totalWeight = count + 1;
    const combatWeight = (119 * count + 1) * totalWeight;
    const jobWeight = (51 * count + 1) * combatWeight;
    if (!Number.isSafeInteger((17 * jobWeight + 51 * combatWeight + 119 * totalWeight + 1) * count)) {
      throw new Error('居民数量超出装备分配的计算范围');
    }
    const scores = candidates.map(resident => {
      const stat = production[rooms.get(resident.roomId)?.type];
      return [...outfits, ...new Array(count).fill(null)].map(item => {
        const job = stat ? gain(resident, item, stat) : 0;
        const battle = ['str', 'end', 'agi'].reduce((sum, key) => sum + gain(resident, item, key), 0);
        const total = keys.reduce((sum, key) => sum + gain(resident, item, key), 0);
        return job * jobWeight + battle * combatWeight + total * totalWeight + Number(resident.outfitId === (item?.id ?? null));
      });
    });
    matchShelterOutfits(scores).forEach((column, index) => { targets[index].outfitId = outfits[column]?.id ?? null; });
  }
  if (options.weapons) {
    const ordered = [...candidates].sort((left, right) =>
      Number(rooms.get(right.roomId)?.type === 'door') - Number(rooms.get(left.roomId)?.type === 'door') ||
      combat(right, items.get(targetById.get(right.id).outfitId)) - combat(left, items.get(targetById.get(left.id).outfitId)) || left.id - right.id);
    const weapons = available.filter(item => item.slot === 'weapon').sort((left, right) =>
      right.damage[0] + right.damage[1] - left.damage[0] - left.damage[1] || left.id - right.id);
    // 相同伤害优先保留本人当前武器，其次取仓库闲置装备，减少无意义互换。
    for (const resident of ordered) {
      const best = weapons[0];
      if (!best) { targetById.get(resident.id).weaponId = null; continue; }
      const strength = best.damage[0] + best.damage[1];
      const equivalent = item => item.damage[0] + item.damage[1] === strength;
      let index = weapons.findIndex(item => equivalent(item) && item.id === resident.weaponId);
      if (index < 0) index = weapons.findIndex(item => equivalent(item) && !model.owners.has(item.id));
      if (index < 0) index = 0;
      targetById.get(resident.id).weaponId = weapons.splice(index, 1)[0].id;
    }
  }
  const changes = [];
  for (const slot of ['outfit', 'weapon']) {
    const field = model.fields[slot];
    for (const target of targets) {
      const resident = model.residents.get(target.residentId);
      if (resident[field] !== target[field]) changes.push({ residentId: resident.id, slot, itemId: target[field], previousId: resident[field] });
    }
  }
  return { targets, changes, excluded: model.excluded, residents: candidates.length };
}

// 不比较自然增长的经验、心情等；岗位、基础属性、可分配名单及装备池变化则停止。
function shelterEquipmentContext(view) {
  const model = shelterEquipmentModel(view);
  return JSON.stringify({
    residents: [...model.residents.values()].sort((left, right) => left.id - right.id).map(resident => [resident.id,
      resident.roomId, resident.adultAt <= view.serverTime, resident.away, resident.deadAt, Boolean(resident.locked), Boolean(resident.giftOffer), model.keys.map(key => resident.stats[key])]),
    rooms: [...model.rooms.values()].sort((left, right) => left.id - right.id).map(room => [room.id, room.type, shelterEquipmentIncidentBlocks(room, view.serverTime)]),
    items: [...model.items.values()].sort((left, right) => left.id - right.id).map(item => [item.id, item.slot,
      item.slot === 'weapon' ? item.damage : model.keys.map(key => item.bonus[key] ?? 0)])
  });
}

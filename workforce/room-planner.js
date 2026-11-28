// 默认排序同时供面板控件和整理规划使用，训练室按训练属性分别排序。
function shelterRoomOrder() {
  const names = { power: '发电站', diner: '餐厅', water: '净水站', medbay: '医务室', workshop: '工坊', scrap: '废料回收站', sorter: '垃圾分拣站', training: '训练室', radio: '电台', armory: '武器工坊', tailor: '服装工坊', quarters: '宿舍', storage: '仓库' };
  const stats = { str: '力量', per: '感知', end: '耐力', cha: '魅力', int: '智力', agi: '敏捷', lck: '幸运' };
  return Object.entries(names).flatMap(([type, name]) => type === 'training'
    ? Object.entries(stats).map(([stat, label]) => ({ key: `training:${stat}`, name: `${name}（${label}）`, weight: 10 }))
    : [{ key: `${type}:`, name, weight: type === 'storage' ? -100 : type === 'quarters' ? -20 : ['power', 'diner', 'water', 'medbay', 'workshop', 'scrap', 'sorter'].includes(type) ? 100 : 10 }]);
}

// 夜间大门掠夺者事件在游戏内冻结，不能阻塞房间整理。
function shelterRoomIncidentBlocks(room, serverTime) {
  if (!room?.incident) return false;
  const date = new Date(serverTime);
  const doorGuardRequired = !Number.isFinite(date.getTime()) || new Date(date.getTime() + 8 * 3600000).getUTCHours() >= 8;
  return !(room.type === 'door' && room.incident.kind === 'raiders' && !doorGuardRequired);
}

// 纯规划：先得到全部移动步骤，不在计算过程中调用游戏接口。
function shelterRoomModel(view, order = shelterRoomOrder().map(item => item.key)) {
  const names = { power: '发电站', diner: '餐厅', water: '净水站', medbay: '医务室', workshop: '工坊', scrap: '废料回收站', sorter: '垃圾分拣站', training: '训练室', radio: '电台', armory: '武器工坊', tailor: '服装工坊', quarters: '宿舍', storage: '仓库' };
  const types = Object.keys(names);
  const stats = ['str', 'per', 'end', 'cha', 'int', 'agi', 'lck'];
  const { state, serverTime } = view;
  if (!state || !Array.isArray(state.rooms) || !Array.isArray(state.residents) ||
      !Number.isInteger(state.depth) || !Number.isFinite(serverTime)) throw new Error('避难所数据格式已变化');
  if (view.switches?.frozen) throw new Error('避难所正在维护');
  for (const room of state.rooms) {
    const reason = room.builtAt > serverTime ? '施工' : room.upgradeAt !== null ? '升级' : shelterRoomIncidentBlocks(room, serverTime) ? '事件' : room.craft ? '制作' : '';
    if (reason) throw new Error(`${room.floor} 层${names[room.type] || room.type}（#${room.id}）正在${reason}，未启动整理`);
  }
  const rooms = state.rooms.filter(room => !['door', 'elevator'].includes(room.type));
  for (const room of rooms) {
    if (!types.includes(room.type) || ![1, 2, 3, 4, 5, 6].includes(room.width) || ![1, 2, 3].includes(room.level) ||
        !Number.isInteger(room.id) || !Number.isInteger(room.floor) || !Number.isInteger(room.col) ||
        room.col < 2 || room.floor < 1 || room.floor > state.depth ||
        (room.type === 'training' && !stats.includes(room.trainStat))) throw new Error('房间类型或位置格式已变化，无法规划');
  }
  for (let floor = 1; floor <= state.depth; floor++) {
    if (!state.rooms.some(room => room.floor === floor && room.col === 1 && room.type === 'elevator')) {
      throw new Error(`第 ${floor} 层没有可用电梯，无法整理`);
    }
    let col = 2;
    for (const room of rooms.filter(room => room.floor === floor).sort((a, b) => a.col - b.col)) {
      if (room.col !== col) throw new Error(`第 ${floor} 层通道不连续，无法整理`);
      col += room.width;
    }
    if (col > 8) throw new Error(`第 ${floor} 层房间超过 6 格`);
  }
  const group = room => `${room.type}:${room.type === 'training' ? room.trainStat : ''}`;
  const compare = (a, b) => order.indexOf(group(a)) - order.indexOf(group(b)) || b.level - a.level;
  return { names, rooms, group, compare };
}

// 不依赖合并时保留哪个 ID；每一步按楼层和位置重新定位，并核对结构。
function shelterRoomLayout(rooms) {
  return JSON.stringify(rooms.filter(room => !['door', 'elevator'].includes(room.type))
    .slice().sort((a, b) => a.floor - b.floor || a.col - b.col)
    .map(room => [room.floor, room.col, room.type, room.level, room.width, room.type === 'training' ? room.trainStat : null, Boolean(room.separate)]));
}

function planShelterRooms(view, order = shelterRoomOrder().map(item => item.key)) {
  const defaults = shelterRoomOrder();
  if (!Array.isArray(order) || order.length !== defaults.length || new Set(order).size !== defaults.length ||
      order.some(key => !defaults.some(item => item.key === key))) throw new Error('房间排序无效，请重新调整');
  const { rooms, group, compare } = shelterRoomModel(view, order);
  const depth = view.state.depth;
  const freeCells = depth * 6 - rooms.reduce((sum, room) => sum + room.width, 0);
  if (freeCells < 1) throw new Error('现有总空位 0 格，拆分不会减少占用格数；请至少留出 1 格中转空位，未执行任何操作');
  // 虚拟单格只用于规划；实际拆分产生的 ID 始终从接口返回结果中定位。
  let state = rooms.map(room => ({ ...room, members: Array.from({ length: room.width }, (_, i) => `${room.id}:${i}`) }));
  const cells = state.flatMap(room => room.members.map((member, i) => ({ ...room, width: 1, col: room.col + i, members: [member] })));
  const ordered = cells.sort((a, b) => compare(a, b) || a.floor - b.floor || a.col - b.col);
  // 单格可以自由分段：按用户排序从上到下、从左到右排列，同类尽量同层。
  const memo = new Map();
  function pack(floor, index) {
    if (floor > depth) return index === ordered.length ? { cost: 0, floors: [] } : null;
    const key = `${floor}:${index}`;
    if (memo.has(key)) return memo.get(key);
    let best = null;
    let cost = 0;
    for (let end = index; end <= Math.min(index + 6, ordered.length); end++) {
      if (end > index) {
        const room = ordered[end - 1];
        // 保留原策略的上下层偏好，但按排序位置应用，不让原类型覆盖用户顺序。
        const weight = defaults[order.indexOf(group(room))].weight;
        cost += weight * floor + (room.floor === floor ? 0 : 0.01);
      }
      const rest = pack(floor + 1, end);
      if (!rest) continue;
      const split = end > index && end < ordered.length && group(ordered[end - 1]) === group(ordered[end]) ? 100000 : 0;
      const total = rest.cost + cost + split;
      if (!best || total < best.cost) best = { cost: total, floors: [ordered.slice(index, end), ...rest.floors] };
    }
    memo.set(key, best);
    return best;
  }
  const packed = pack(1, 0);
  const destinations = new Map(packed.floors.flatMap((list, i) => list.map(room => [room.members[0], i + 1])));
  const floorRooms = (floor) => state.filter(room => room.floor === floor).sort((a, b) => a.col - b.col);
  const targetFloor = room => destinations.get(room.members[0]);
  const steps = [];
  function record(previous, type, room, floor = room.floor, before = null) {
    steps.push({
      type, source: { floor: room.floor, col: room.col }, floor,
      before: before ? { floor: before.floor, col: before.col } : null,
      beforeLayout: shelterRoomLayout(previous), afterLayout: shelterRoomLayout(state),
      // 拆分时不猜居民落到哪一格，允许落到原房间拆出的任一子房间。
      transitions: previous.map(item => ({
        floor: item.floor, col: item.col,
        targets: state.filter(next => next.members.some(member => item.members.includes(member)))
          .map(next => [next.floor, next.col])
      }))
    });
  }
  function normalize(list, floor) {
    const merged = [];
    for (const item of list) {
      const room = { ...item, members: [...item.members] };
      const previous = merged.at(-1);
      if (previous && !previous.separate && !room.separate && group(previous) === group(room) &&
          previous.level === room.level && previous.width + room.width <= 6) {
        previous.width += room.width;
        previous.members.push(...room.members);
      } else merged.push(room);
    }
    let col = 2;
    for (const room of merged) { room.floor = floor; room.col = col; col += room.width; }
    return merged;
  }
  function splitRooms() {
    while (state.some(room => room.width > 1)) {
      const room = state.find(item => item.width > 1);
      const previous = state;
      state = state.flatMap(item => item === room ? item.members.map((member, i) => ({
        ...item, width: 1, col: item.col + i, separate: true, members: [member]
      })) : [item]);
      record(previous, 'split_room', room);
    }
  }
  function move(room, floor, before) {
    const previous = state;
    const affected = new Set([room.floor, floor]);
    const result = state.filter(item => !affected.has(item.floor));
    for (const currentFloor of affected) {
      const list = floorRooms(currentFloor).filter(item => item !== room);
      // 游戏移动房间后会暂停该房间的自动合并，单格房间也一样。
      if (currentFloor === floor) list.splice(before ? list.indexOf(before) : list.length, 0, { ...room, separate: true });
      result.push(...normalize(list, currentFloor));
    }
    state = result;
    record(previous, 'move_room', room, floor, before);
    // 原本的单格可能仍开启自动合并；搬运中发生合并就立即拆回单格，保持 1 格可中转。
    splitRooms();
  }
  splitRooms();
  while (state.some(room => room.floor !== targetFloor(room))) {
    const pending = state.filter(room => room.floor !== targetFloor(room));
    const direct = pending.find(room => floorRooms(targetFloor(room)).length < 6);
    if (direct) {
      const floor = targetFloor(direct);
      move(direct, floor, floorRooms(floor).find(item => compare(direct, item) < 0) || null);
    } else {
      // 目标层均满时，先把目标层的一间错位房移到唯一空格，下一轮即可直接归位。
      const floor = targetFloor(pending[0]);
      const blocker = floorRooms(floor).find(room => targetFloor(room) !== floor);
      const spareFloor = Array.from({ length: depth }, (_, i) => i + 1).find(value => floorRooms(value).length < 6);
      move(blocker, spareFloor, null);
    }
  }
  for (let floor = 1; floor <= depth; floor++) {
    while (true) {
      const list = floorRooms(floor);
      const index = list.findIndex((room, i) => i > 0 && compare(list[i - 1], room) > 0);
      if (index < 0) break;
      const room = list[index];
      move(room, floor, list.find(item => compare(room, item) < 0));
    }
  }
  // 全部单格到位后才恢复自动合并，避免合并后的大房间妨碍中转。
  while (state.some(room => room.separate)) {
    const room = state.find(item => item.separate);
    const previous = state;
    const list = floorRooms(room.floor).map(item => item === room ? { ...item, separate: false } : item);
    state = [...state.filter(item => item.floor !== room.floor), ...normalize(list, room.floor)];
    record(previous, 'auto_merge', room);
  }
  return { steps, finalLayout: shelterRoomLayout(state), rooms: state };
}

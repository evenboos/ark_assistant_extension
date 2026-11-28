// 目标建造规划：从最早只有电梯的空楼层开始，按游戏建造面板的规则连续建格。
// 只做规划和费用计算，不直接发出游戏操作。
var shelterTargetBuildable = Object.keys(shelterUpgradeBaseCost).filter(type => type !== 'door');
var shelterTargetTrainStats = ['str', 'per', 'end', 'cha', 'int', 'agi', 'lck'];

function shelterTargetNormalizeTrainStat(value) {
  return shelterTargetTrainStats.includes(value) ? value : 'str';
}

function shelterTargetRoomMatches(room, roomType, trainStat) {
  if (!room || room.type !== roomType) return false;
  if (roomType === 'training' && (room.trainStat ?? null) !== (trainStat ?? 'str')) return false;
  return true;
}

// 一层只有电梯（没有其他任何建筑）才算空楼层；从上往下取最早的一层。
function shelterTargetEarliestEmptyFloor(view) {
  const state = view?.state;
  const depth = Math.max(0, Math.floor(Number(state?.depth) || 0));
  const rooms = Array.isArray(state?.rooms) ? state.rooms : [];
  for (let floor = 1; floor <= depth; floor++) {
    const onFloor = rooms.filter(room => Number(room.floor) === floor);
    if (!onFloor.some(room => room.type === 'elevator')) continue;
    if (!onFloor.some(room => room.type !== 'elevator')) return floor;
  }
  return null;
}

// 与游戏建造面板一致：从 col 2 开始连续排到 col 7，每格 1 个位置。
// 目标只使用空楼层或已经由目标模式占用的楼层，不往已有生产房间的楼层里插。
function shelterTargetFloorSpot(view, floor, roomType, trainStat) {
  const state = view?.state;
  const depth = Math.max(0, Math.floor(Number(state?.depth) || 0));
  if (!Number.isInteger(floor) || floor < 1 || floor > depth) return null;
  const rooms = Array.isArray(state?.rooms) ? state.rooms : [];
  const onFloor = rooms.filter(room => Number(room.floor) === floor);
  if (!onFloor.some(room => room.type === 'elevator')) return null;
  if (onFloor.some(room => room.type !== 'elevator' &&
      !shelterTargetRoomMatches(room, roomType, trainStat))) return null;
  let col = 2;
  while (col < 8) {
    const room = onFloor.find(item => Number(item.col) <= col && col < Number(item.col) + Number(item.width));
    if (!room || Number(room.col) !== col) break;
    col += Math.max(1, Math.floor(Number(room.width) || 1));
  }
  return col < 8 ? col : null;
}

// 与游戏建造面板一致：基础造价 ×(1 + 0.2 × 该建筑当前总格数)。
function shelterTargetCost(view, roomType) {
  const base = shelterUpgradeBaseCost?.[roomType];
  if (!Number.isFinite(base)) return null;
  const totalWidth = (view?.state?.rooms ?? []).filter(room => room?.type === roomType)
    .reduce((sum, room) => sum + Math.max(0, Number(room.width) || 0), 0);
  return Math.ceil(base * (1 + 0.2 * totalWidth));
}

function shelterTargetNextBuild(view, options = {}) {
  const roomType = options.room;
  const count = Math.max(0, Math.floor(Number(options.count) || 0));
  if (!roomType || count < 1 || !shelterTargetBuildable.includes(roomType)) return null;
  if (roomType === 'sorter' && view.switches?.sorterBuild === false) return null;
  const trainStat = roomType === 'training' ? shelterTargetNormalizeTrainStat(options.trainStat) : null;
  const depth = Math.max(0, Math.floor(Number(view?.state?.depth) || 0));
  let startFloor = Math.floor(Number(options.startFloor));
  if (!Number.isInteger(startFloor) || startFloor < 1 || startFloor > depth) {
    startFloor = shelterTargetEarliestEmptyFloor(view);
  }
  if (startFloor === null) return null;
  const cost = shelterTargetCost(view, roomType);
  if (!Number.isFinite(cost)) return null;
  for (let floor = startFloor; floor <= depth; floor++) {
    const col = shelterTargetFloorSpot(view, floor, roomType, trainStat);
    if (col !== null) return { floor, col, cost };
  }
  return null;
}

function shelterTargetStatus(view, options = {}) {
  const roomType = options.room;
  const count = Math.max(0, Math.floor(Number(options.count) || 0));
  const trainStat = roomType === 'training' ? shelterTargetNormalizeTrainStat(options.trainStat) : null;
  const configured = Boolean(roomType && shelterTargetBuildable.includes(roomType) && count > 0);
  const depth = Math.max(0, Math.floor(Number(view?.state?.depth) || 0));
  let startFloor = Math.floor(Number(options.startFloor));
  if (!Number.isInteger(startFloor) || startFloor < 1 || startFloor > depth) {
    startFloor = shelterTargetEarliestEmptyFloor(view);
  }
  const rooms = Array.isArray(view?.state?.rooms) ? view.state.rooms : [];
  const matching = configured && startFloor !== null
    ? rooms.filter(room => Number(room.floor) >= startFloor && shelterTargetRoomMatches(room, roomType, trainStat))
    : [];
  const cells = matching.reduce((sum, room) => sum + Math.max(0, Number(room.width) || 0), 0);
  const activeCells = matching
    .filter(room => Number(room.builtAt) > Number(view?.serverTime))
    .reduce((sum, room) => sum + Math.max(0, Number(room.width) || 0), 0);
  const complete = configured && startFloor !== null && cells >= count && activeCells === 0;
  const next = configured && startFloor !== null && cells < count
    ? shelterTargetNextBuild(view, { room: roomType, count, trainStat, startFloor })
    : null;
  return { configured, room: roomType, count, trainStat, startFloor, cells, activeCells, complete, next };
}

// 自动升级与挖层只做规划和费用计算，不直接发出游戏操作。
// 按用户调整后的房间类型顺序排序，同类型先升低等级（1 级 → 2 级，再 2 级 → 3 级）。
// 面板每次启动都会重新注入，var 允许在同一隔离环境中再次加载。
var shelterUpgradeGroups = [
  'power', 'scrap', 'workshop', 'diner', 'water',
  'quarters', 'storage', 'training', 'armory', 'tailor', 'door',
  'medbay', 'radio', 'sorter'
];
var shelterUpgradeLabels = {
  power: '发电站', scrap: '废料回收站', workshop: '零件工坊', diner: '餐厅', water: '净水站',
  quarters: '宿舍', storage: '仓库', training: '训练室', armory: '武器工坊', tailor: '服装工坊', door: '大门',
  medbay: '医务室', radio: '电台', sorter: '垃圾分拣站'
};
// 游戏房间的基础造价；大门升级固定按 400 计算，电梯不能升级。
var shelterUpgradeBaseCost = {
  door: 400, power: 100, diner: 100, water: 100, scrap: 80, quarters: 120,
  storage: 80, medbay: 300, training: 400, workshop: 500, armory: 600, tailor: 600, radio: 800, sorter: 450
};

function shelterConstructionLimit(view) {
  return Number(view?.state?.depth) >= 10 ? 3 : 2;
}

function normalizeShelterUpgradeOrder(order) {
  const result = [];
  for (const key of Array.isArray(order) ? order : []) {
    if (shelterUpgradeGroups.includes(key) && !result.includes(key)) result.push(key);
  }
  for (const key of shelterUpgradeGroups) if (!result.includes(key)) result.push(key);
  return result;
}

// 与游戏面板一致：1→2 级按基础造价 × 宽度 ×2.5，2→3 级 ×6，另加每格 15 零件。
function shelterUpgradeCost(room) {
  const next = Number(room?.level) + 1;
  const width = Number(room?.width);
  const base = shelterUpgradeBaseCost[room?.type];
  if (!Number.isFinite(next) || next < 2 || next > 3 || !Number.isFinite(width) || width < 1 || !base) return null;
  return {
    level: next,
    scrap: Math.ceil(base * width * (next === 2 ? 2.5 : 6)),
    parts: next >= 3 ? 15 * width : 0
  };
}

// 列出当前可升级的房间并按优先级排序。施工、升级中、事件、制作和电梯都不参与。
function planRoomUpgrades(view, order, blockedIds = new Set()) {
  const now = view?.serverTime;
  const orderIndex = new Map(normalizeShelterUpgradeOrder(order).map((key, index) => [key, index]));
  const rank = room => (orderIndex.get(room.type) ?? shelterUpgradeGroups.length) * 100;
  const rooms = (Array.isArray(view?.state?.rooms) ? view.state.rooms : []).filter(room =>
    room && room.type !== 'elevator' && Number.isFinite(room.level) && room.level >= 1 && room.level < 3 &&
    Number.isFinite(room.width) && room.builtAt <= now && room.upgradeAt === null &&
    !room.incident && !room.craft && !blockedIds.has(room.id));
  return rooms.map(room => ({ room, cost: shelterUpgradeCost(room), group: room.type }))
    .filter(item => item.cost)
    .sort((left, right) =>
      rank(left.room) - rank(right.room) ||
      left.room.level - right.room.level ||
      left.room.floor - right.room.floor ||
      left.room.col - right.room.col ||
      left.room.id - right.room.id);
}

function shelterUpgradeAffordable(candidates, resources) {
  const scrap = Number(resources?.scrap) || 0;
  const parts = Number(resources?.parts) || 0;
  return candidates.find(({ cost }) => scrap >= cost.scrap && parts >= cost.parts) ?? null;
}

// 与游戏按钮一致：挖第 depth+1 层需要 ceil(120 × (depth+1)^1.4) 废料。
function shelterDigCost(depth) {
  const value = Number(depth);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.ceil(120 * Math.pow(value + 1, 1.4));
}

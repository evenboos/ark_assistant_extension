// 自动穿戴服装：按居民当前房间所需的属性，给每人分配加成最高的服装。
// 服装是全局稀缺资源：混合属性服装（如耐力+力量）按“对各自岗位最有用”的居民排序分配，
// 不再因为当前持有者能用就永久锁死；外出或倒下居民身上的服装无法转交。
// 同分时优先大房间/高等级房间，其次保持当前持有者，避免每轮来回换装。每轮只返回与现状不同的操作。
function planOutfits(view) {
  const state = view?.state;
  const now = view?.serverTime;
  if (!Array.isArray(state?.residents) || !Array.isArray(state?.rooms) || !Array.isArray(state?.items) || !Number.isFinite(now)) {
    throw new Error('装备数据格式已变化');
  }
  const keys = ['str', 'per', 'end', 'cha', 'int', 'agi', 'lck'];
  // 与游戏房间定义一致：岗位需要哪项基础属性就穿对应服装。
  // 训练速度只按基础属性计算，服装不影响训练，因此训练室不分配服装；
  // 宿舍、门外和仓库也不产生属性收益。大门按耐力。
  const statByRoom = {
    door: 'end', power: 'str', diner: 'agi', water: 'per', scrap: 'end',
    medbay: 'int', workshop: 'int', armory: 'str', tailor: 'cha', sorter: 'lck'
  };
  const rooms = new Map(state.rooms.map(room => [room.id, room]));
  const items = state.items.filter(item => item?.slot === 'outfit' && item.bonus && typeof item.bonus === 'object' &&
    keys.every(key => item.bonus[key] == null || Number.isFinite(item.bonus[key])));
  const protectedIds = shelterCoordination(view).protectedIds;
  const wornBy = new Map();
  for (const resident of state.residents) if (resident.outfitId != null) wornBy.set(resident.outfitId, resident);
  // 训练室按游戏说明“服装不影响训练速度”，不占用服装；生产房间按岗位属性；
  // 宿舍、门外和外出居民没有目标属性。
  function target(resident) {
    if (protectedIds.has(resident.id) || resident.deadAt !== null || resident.away !== null || resident.adultAt > now) return null;
    const room = rooms.get(resident.roomId);
    if (!room || workforceRoomReasons(room, now).length || room.craft) return null;
    return statByRoom[room.type] ?? null;
  }
  const totalBonus = item => keys.reduce((sum, key) => sum + (Number(item.bonus[key]) || 0), 0);
  const value = (item, stat) => (Number(item.bonus[stat]) || 0) * 10 + totalBonus(item);
  // 房间优先级只用于同分时排序：先看等级（每名工人的产出随等级提高），
  // 同等级再看格数（大房间工人多，便于把高加成服装集中给主力房间）。
  // 宿舍和仓库不产生属性收益，按 0 处理。
  function priority(resident) {
    const room = rooms.get(resident.roomId);
    if (!room) return 0;
    if (room.type === 'quarters' || room.type === 'storage') return 0;
    const width = Math.max(1, Number(room.width) || 1);
    const level = Math.max(1, Number(room.level) || 1);
    return level * 100 + width;
  }
  // 外出或倒下居民身上的服装无法转交；其余服装都可以参与全局分配。
  const lockedItems = shelterReservedEquipment(view);
  for (const [itemId, owner] of wornBy) {
    const room = rooms.get(owner.roomId);
    if (protectedIds.has(owner.id) || owner.adultAt > now || owner.away !== null || owner.deadAt !== null ||
        workforceIncidentBlocksAutomation(room, view) || room?.craft) lockedItems.add(itemId);
  }
  const usable = items.filter(item => !lockedItems.has(item.id));
  // 收集所有“居民 × 对该岗位有加成的服装”组合，按加成价值全局排序后依次分配。
  // 这样混合属性服装会优先给更能发挥主属性的岗位，而不是被当前持有者锁住。
  const pairs = [];
  for (const resident of state.residents) {
    const stat = target(resident);
    if (!stat) continue;
    for (const item of usable) {
      const bonus = Number(item.bonus[stat]) || 0;
      if (bonus <= 0) continue;
      const owner = wornBy.get(item.id);
      pairs.push({
        resident, item, stat, bonus,
        score: value(item, stat),
        priority: priority(resident),
        keep: owner?.id === resident.id ? 1 : 0
      });
    }
  }
  pairs.sort((left, right) => right.score - left.score || right.priority - left.priority ||
    right.keep - left.keep || left.resident.id - right.resident.id || left.item.id - right.item.id);
  const takenItems = new Set(), assigned = new Map();
  for (const pair of pairs) {
    if (takenItems.has(pair.item.id) || assigned.has(pair.resident.id)) continue;
    takenItems.add(pair.item.id);
    assigned.set(pair.resident.id, pair);
  }
  const changes = [];
  for (const pair of assigned.values()) {
    if (pair.resident.outfitId === pair.item.id) continue;
    changes.push({
      residentId: pair.resident.id, residentName: pair.resident.name,
      itemId: pair.item.id, itemName: pair.item.name,
      stat: pair.stat, bonus: pair.bonus
    });
  }
  return { changes, assigned: assigned.size };
}

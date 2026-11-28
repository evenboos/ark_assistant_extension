function planShelterGod(view, excludedIds = new Set(), onlyFinishedTraining = false, onlyIdleJobs = false, options = {}) {
  if (!Array.isArray(view.state?.rooms) || !Array.isArray(view.state.residents)) throw new Error('造神计划数据格式已变化');
  const { rooms, residents } = view.state;
  const now = view.serverTime;
  const keys = ['str', 'per', 'end', 'cha', 'int', 'agi', 'lck'];
  const labels = { str: '力量', per: '感知', end: '耐力', cha: '魅力', int: '智力', agi: '敏捷', lck: '幸运' };
  const production = { str: ['power'], per: ['water'], agi: ['diner'], int: ['workshop', 'medbay'], end: ['scrap'], cha: ['radio'], lck: ['sorter'] };
  const names = { power: '发电站', water: '净水站', diner: '餐厅', workshop: '零件工坊', medbay: '医务室', scrap: '废料回收站', radio: '电台', sorter: '垃圾分拣站' };
  const total = resident => keys.reduce((sum, key) => sum + resident.stats[key], 0);
  options = workforceOptions(options);
  const trainingKeys = keys.filter(key => key !== 'cha' || options.trainCharisma).filter(key => key !== 'lck' || options.trainLuck);
  const trainingDone = resident => trainingKeys.every(key => resident.stats[key] >= 10);
  excludedIds = new Set([...excludedIds, ...shelterCoordination(view).protectedIds]);
  // 本周任务小队成员（进行中、返程中、失败待领取）不参与造神计划调动，领取后才回到正常调度。
  const questTeams = new Set((Array.isArray(view.state.quests) ? view.state.quests : [])
    .flatMap(run => Array.isArray(run.team) ? run.team : []));
  const workers = residents.filter(resident => resident.away === null && resident.deadAt === null &&
    resident.adultAt <= now && !questTeams.has(resident.id));
  const positions = new Map(workers.map(resident => [resident.id, resident.roomId]));
  // 岗位模型只构建一次；逐个居民重新构建会在快速检查里造成明显的整轮停顿。
  const model = typeof workforceModel === 'function' ? workforceModel(view) : null;
  // 各房间当前人数随 move 同步维护，避免每次找空位都重新遍历全部居民。
  const occupancy = new Map();
  for (const room of rooms) occupancy.set(room.id, shelterRoomOccupancy(view, room.id));
  const assignments = [], parents = [];
  const roomName = room => `${room.type === 'training' ? `${labels[room.trainStat]}训练室` : names[room.type]}（${room.floor} 层，房间 ${room.id}）`;
  const availableTraining = rooms.filter(room => room.type === 'training' && room.builtAt <= now &&
    room.upgradeAt === null && !room.incident && !room.unpowered);
  const pendingParents = new Set((view.state.births ?? []).flatMap(birth => birth.parents));
  const occupants = room => occupancy.get(room.id) ?? 0;
  const freeSlots = room => room.width * 2 - occupants(room);
  function move(resident, room, message) {
    const roomId = room ? room.id : null;
    const previous = positions.get(resident.id);
    if (previous != null) occupancy.set(previous, Math.max(0, (occupancy.get(previous) ?? 1) - 1));
    if (roomId != null) occupancy.set(roomId, (occupancy.get(roomId) ?? 0) + 1);
    assignments.push({ residentId: resident.id, roomId, message: message ?? `造神计划：${resident.name}#${resident.id} → ${room ? roomName(room) : '去休息'}。` });
    positions.set(resident.id, roomId);
  }
  // 优先练当前最高的未满属性；同一属性按房间等级、容量排序。
  function nextTraining(resident, current) {
    const stats = trainingKeys.filter(key => key !== current?.trainStat && resident.stats[key] < 10)
      .sort((left, right) => resident.stats[right] - resident.stats[left]);
    for (const key of stats) {
      const room = availableTraining.filter(room => room.trainStat === key && freeSlots(room) > 0)
        .sort((left, right) => right.level - left.level || right.width - left.width || left.floor - right.floor || left.id - right.id)[0];
      if (room) return room;
    }
    return null;
  }
  // 允许属性练满 后的岗位：先补电力、食物、净水缺口，三项都为正收益时优先废料、再零件（保证废料不为负）、治疗针，最后电台。
  function chooseJob(resident) {
    const free = room => room.width * 2 - occupants(room);
    const candidates = rooms.filter(room => names[room.type] && room.type !== 'training' && room.builtAt <= now &&
      room.upgradeAt === null && !room.incident && !room.unpowered && free(room) > 0);
    if (model) {
      const net = model.net(assignments);
      const deficits = ['power', 'food', 'water'].filter(key => net[key] < 0).sort((left, right) => net[left] - net[right]);
      // 缺口补齐后优先零件工坊，再废料回收站、医务室，最后电台；零件不能把废料吃成负数。
      const order = [...deficits, 'parts', 'scrap', 'stimpak'];
      for (const resource of order) {
        const options = candidates.filter(room => model.types[room.type]?.resource === resource)
          .map(room => ({ room, net: model.net([...assignments, { residentId: resident.id, roomId: room.id }]) }))
          .filter(item => resource !== 'parts' || item.net.scrap >= 0)
          .sort((left, right) => right.room.level - left.room.level || right.room.width - left.room.width ||
            left.room.floor - right.room.floor || left.room.id - right.room.id);
        if (options.length) return options[0].room;
      }
      // 没有缺口且零件工坊、废料回收站、医务室、电台都满员时，把空闲居民补进电力、
      // 食物、净水等还有空位的生产房间，避免有人闲置而资源库存长期不满。
      const spare = candidates.filter(room => room.type !== 'radio')
        .sort((left, right) => right.level - left.level || right.width - left.width ||
          left.floor - right.floor || left.id - right.id);
      if (spare.length) return spare[0];
      return candidates.filter(room => room.type === 'radio')
        .sort((left, right) => right.level - left.level || left.floor - right.floor || left.id - right.id)[0] ?? null;
    }
    // 未注入产出模型时按最高属性对应岗位兜底。
    const highest = keys.filter(key => resident.stats[key] === Math.max(...keys.map(item => resident.stats[item])));
    const types = highest.flatMap(key => production[key]);
    return candidates.filter(room => types.includes(room.type))
      .sort((left, right) => right.level - left.level || left.floor - right.floor || left.id - right.id)[0] ?? null;
  }

  // 已在训练室的居民：先撤出允许属性练满 的，腾出训练位；再转练允许属性未练满 的。
  // 分多遍处理，避免排在前面的人因为目标训练室还没腾空而被跳过、干等下一轮。
  if (!onlyIdleJobs) {
    const trainingRoomOf = resident => rooms.find(item => item.id === positions.get(resident.id));
    // 第一遍：允许属性练满 的普通居民去生产岗位；岗位也满员时撤到门外休息区。
    for (const resident of workers) {
      if (resident.name.includes('★')) continue;
      const room = trainingRoomOf(resident);
      if (!room || room.type !== 'training' || resident.stats[room.trainStat] < 10) continue;
      if (!trainingDone(resident) || excludedIds.has(resident.id)) continue;
      const job = chooseJob(resident);
      move(resident, job, job
        ? `造神计划：${resident.name}#${resident.id} 目标属性已练满 → ${roomName(job)}。`
        : `造神计划：${resident.name}#${resident.id} 目标属性已练满，生产岗位已满，先到门外休息区等待上岗。`);
    }
    // 第二遍：亲本记录训练情况，练满当前项的转到下一个有空位的训练室。
    for (const resident of workers) {
      if (!resident.name.includes('★')) continue;
      const room = trainingRoomOf(resident);
      if (!room || room.type !== 'training') continue;
      const current = resident.stats[room.trainStat];
      const next = nextTraining(resident, room);
      parents.push({
        id: resident.id, name: resident.name, stat: labels[room.trainStat], current,
        progress: current >= 10 ? 1 : Math.max(0, Math.min(1, shelterTrainingProgress(resident, room.trainStat))),
        room: roomName(room), nextRoom: next ? roomName(next) : '去休息'
      });
      if (current >= 10 && !excludedIds.has(resident.id)) move(resident, next);
    }
    // 第三遍：允许属性未练满 且当前训练项已满 10 的居民转练下一个未满属性。
    // 重复扫描，让别人腾出的训练位在前一轮被跳过的人也能在同一轮补上。
    for (let round = 0; round < keys.length; round++) {
      let moved = 0;
      for (const resident of workers) {
        if (resident.name.includes('★')) continue;
        const room = trainingRoomOf(resident);
        if (!room || room.type !== 'training' || resident.stats[room.trainStat] < 10) continue;
        const sum = total(resident);
        if (trainingDone(resident) || excludedIds.has(resident.id)) continue;
        // 当前属性练满但允许属性未全部练满：转到下一个最高未满属性的训练室。
        const next = nextTraining(resident, room);
        if (next) {
          move(resident, next, `造神计划：${resident.name}#${resident.id}（属性 ${sum}/70）练满${labels[room.trainStat]}，转练${labels[next.trainStat]} → ${roomName(next)}。`);
        } else {
          // 下一项训练室全满：不再空占当前训练位，先去门外休息区，
          // 等有对应属性的训练空位时再由优先训练补回。
          move(resident, null, `造神计划：${resident.name}#${resident.id}（属性 ${sum}/70）练满${labels[room.trainStat]}，暂无下一项训练空位，先到门外休息区等待。`);
        }
        moved++;
      }
      if (!moved) break;
    }
  }

  // 优先训练：把允许属性未练满 的在岗居民和门外休息区居民按属性总和从高到低补进剩余训练空位。
  // 待改名/待遣散的新人、等待再次派出的归来者由 excludedIds 排除，继续留在门外。
  // 快速检查只处理训练室里已练满的居民，不重新补人，避免每 30 秒大面积调动。
  const candidates = onlyFinishedTraining || onlyIdleJobs ? [] : workers.filter(resident => {
    const roomId = positions.get(resident.id);
    if (roomId !== null) {
      const room = rooms.find(item => item.id === roomId);
      if (!room || room.type === 'quarters' || room.type === 'storage' || room.type === 'training' || room.type === 'door') return false;
      if (room.incident || room.craft) return false;
    }
    if (pendingParents.has(resident.id) || trainingDone(resident)) return false;
    // 刚被资源补缺、配对等流程搬过的居民本轮不再转岗，避免同一个人被连续搬两次。
    if (excludedIds.has(resident.id)) return false;
    return true;
  }).sort((left, right) => total(right) - total(left) || left.id - right.id);
  // 训练不产出：抽人前先确认电力、食物、净水不会因此转负，保证资源缺口优先。
  const critical = ['power', 'food', 'water'];
  for (const resident of candidates) {
    const room = nextTraining(resident, null);
    // 高总分居民未必有对应的空训练室，继续找下一位，而不是提前停止。
    if (!room) continue;
    if (model) {
      const before = model.net(assignments);
      const after = model.net([...assignments, { residentId: resident.id, roomId: room.id }]);
      if (critical.some(key => before[key] >= 0 && after[key] < 0)) continue;
    }
    move(resident, room, `造神计划：${resident.name}#${resident.id}（属性 ${total(resident)}/70）优先训练 → ${roomName(room)}。`);
  }
  // 允许属性练满 但仍留在门外休息区的居民：生产岗位出现空位时补进去，
  // 避免从训练室撤出后长期闲置。由托管在大门值守之后单独执行，守门优先选人。
  if (onlyIdleJobs) {
    for (const resident of workers) {
      if (positions.get(resident.id) !== null) continue;
      if (pendingParents.has(resident.id) || excludedIds.has(resident.id) || !trainingDone(resident)) continue;
      const job = chooseJob(resident);
      if (job) move(resident, job, `造神计划：${resident.name}#${resident.id} 目标属性已练满，从休息区补进 ${roomName(job)}。`);
    }
  }
  return { assignments, parents };
}

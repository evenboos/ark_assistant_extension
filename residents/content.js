(async () => {
  try {
    if (location.origin !== 'https://game.arkengine.me' || !/^\/shelter\/?$/.test(location.pathname)) {
      throw new Error('请在自己的避难所页面查看');
    }
    // 每次查看都读取服务器的完整名单，排序和时间不受游戏列表筛选影响。
    const response = await fetch('/api/shelter', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000)
    });
    if (response.status === 401 || response.status === 403 || response.redirected) throw new Error('登录状态已失效，请重新登录游戏');
    if (!response.ok) throw new Error(`读取居民失败（HTTP ${response.status}）`);
    const view = await response.json();
    if (!Array.isArray(view.state?.residents) || !Array.isArray(view.state?.rooms) ||
        !Array.isArray(view.state?.births) || !Number.isFinite(view.serverTime)) {
      throw new Error('游戏返回的数据格式已变化，无法查看');
    }
    const { residents, rooms } = view.state;
    const now = view.serverTime;
    const keys = ['str', 'per', 'end', 'cha', 'int', 'agi', 'lck'];
    const roomNames = { door: '大门', elevator: '电梯', power: '发电站', diner: '餐厅', water: '净水站', scrap: '废料回收站', quarters: '宿舍', storage: '仓库', medbay: '医务室', training: '训练室', workshop: '工坊', armory: '武器工坊', tailor: '服装工坊', radio: '电台', sorter: '垃圾分拣站' };
    const statNames = { str: '力量', per: '感知', end: '耐力', cha: '魅力', int: '智力', agi: '敏捷', lck: '幸运' };
    const all = residents.map(resident => {
      if (!Number.isFinite(resident.id) || typeof resident.name !== 'string' ||
          !Number.isFinite(resident.adultAt) || !Number.isFinite(resident.xp) || !Number.isFinite(resident.happiness) ||
          (resident.deadAt !== null && !Number.isFinite(resident.deadAt)) ||
          (resident.away !== null && (!resident.away || typeof resident.away !== 'object')) ||
          (resident.roomId !== null && !Number.isFinite(resident.roomId)) ||
          !keys.every(key => Number.isFinite(resident.stats?.[key])) ||
          (resident.romance != null && (!Number.isFinite(resident.romance.partnerId) || !Number.isFinite(resident.romance.progress))) ||
          (resident.familyCooldownUntil != null && !Number.isFinite(resident.familyCooldownUntil))) {
        throw new Error(`居民「${resident.name ?? resident.id}」的数据不完整，无法查看`);
      }
      const stats = keys.map(key => resident.stats[key]);
      const level = Math.min(50, 1 + Math.floor(Math.sqrt(Math.max(0, resident.xp) / 3)));
      const reasons = [];
      if (resident.locked) reasons.push('居民已锁定');
      if (resident.giftOffer) reasons.push('居民正在赠送');
      if (resident.awaitingAssignment) reasons.push('等待首次安排');
      if (resident.adultAt > now) reasons.push('儿童（尚未成年）');
      if (resident.romance) reasons.push('正在培养感情');
      if (resident.familyCooldownUntil > now) reasons.push(`刚组建家庭（剩余 ${Math.ceil((resident.familyCooldownUntil - now) / 60000)} 分钟）`);
      if (resident.deadAt !== null) reasons.push('已倒下');
      else if (resident.away !== null) reasons.push('外出中');
      const room = rooms.find(room => room.id === resident.roomId);
      // 外出状态优先，避免把保留的岗位误显示为当前所在位置。
      const location = resident.away !== null ? '外出中' : room ?
        `${room.floor} 层 ${room.level} 级${roomNames[room.type]}${room.type === 'training' ? `·${statNames[room.trainStat]}` : ''} ×${room.width}（房间 ${room.id}）` : '门外待命';
      return {
        id: resident.id, name: resident.name, stats, level, reasons, room: location, adultAt: resident.adultAt,
        isAdult: resident.adultAt <= now, isAway: resident.away !== null, isDown: resident.deadAt !== null,
        isIdle: resident.adultAt <= now && resident.away === null && resident.deadAt === null && resident.roomId === null,
        total: stats.reduce((sum, value) => sum + value, 0),
        combatPower: level * 2 + resident.stats.str + resident.stats.end + resident.stats.agi
      };
    });
    const romances = [], seen = new Set();
    for (const resident of residents) {
      if (!resident.romance) continue;
      const partner = residents.find(item => item.id === resident.romance.partnerId);
      if (!partner) throw new Error(`居民「${resident.name}」的感情对象数据缺失`);
      // 双方都有 romance 记录，同一对按 ID 去重，重名也不会合并错。
      const ids = [resident.id, partner.id].sort((left, right) => left - right);
      const key = ids.join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      const room = rooms.find(item => item.id === resident.roomId);
      let paused = '';
      if (resident.away !== null || partner.away !== null || resident.deadAt !== null || partner.deadAt !== null) paused = '有人外出或已倒下';
      else if (resident.adultAt > now || partner.adultAt > now) paused = '尚未成年';
      else if (!room || room.type !== 'quarters' || resident.roomId !== partner.roomId) paused = '两人要在同一间宿舍';
      else if (resident.happiness < 50 || partner.happiness < 50) paused = '两人心情都要 ≥50';
      else if (resident.familyCooldownUntil > now || partner.familyCooldownUntil > now) paused = '组建家庭后的冷却尚未结束';
      else if (room.incident) paused = '宿舍正在处理事件';
      else if (room.builtAt > now) paused = '宿舍还没建好';
      romances.push({
        id: ids[0], names: [resident.name, partner.name], progress: Math.min(1, resident.romance.progress), paused,
        room: room?.type === 'quarters' && resident.roomId === partner.roomId ? `${room.floor} 层 ${room.level} 级宿舍 ×${room.width}（房间 ${room.id}）` : ''
      });
    }
    romances.sort((left, right) => right.progress - left.progress || left.id - right.id);
    // 家庭冷却不依赖感情关系或所在房间，按服务器时间列出所有尚未冷却结束的居民。
    const cooldowns = residents.filter(resident => resident.familyCooldownUntil > now)
      .map(resident => ({ id: resident.id, names: [resident.name], familyCooldownUntil: resident.familyCooldownUntil }))
      .sort((left, right) => left.familyCooldownUntil - right.familyCooldownUntil || left.id - right.id);
    const children = all.filter(resident => resident.adultAt > now)
      .sort((left, right) => left.adultAt - right.adultAt || left.id - right.id);
    // 待产婴儿独立存于 births，出生时间使用游戏的 dueAt 字段。
    const births = view.state.births.map(birth => {
      if (!Number.isFinite(birth.id) || !Number.isFinite(birth.dueAt) ||
          !Array.isArray(birth.parents) || birth.parents.length !== 2 || !birth.parents.every(Number.isFinite)) {
        throw new Error('待产婴儿的数据不完整，无法查看');
      }
      const names = birth.parents.map(id => residents.find(resident => resident.id === id)?.name ?? '已离开的居民');
      return { id: birth.id, name: `${names.join(' 和 ')} 的孩子`, dueAt: birth.dueAt, reasons: [] };
    }).sort((left, right) => left.dueAt - right.dueAt || left.id - right.id);
    // 与游戏训练详情一致，读取已结算进度；包含暂停和已练满的训练室居民。
    const training = residents.filter(resident => rooms.some(room => room.id === resident.roomId && room.type === 'training'))
      .map(resident => {
        const room = rooms.find(room => room.id === resident.roomId);
        const progress = resident.trainingStat && resident.trainingStat !== room.trainStat
          ? resident.trainingByStat?.[room.trainStat] ?? 0 : resident.training;
        if (!keys.includes(room.trainStat) || !Number.isFinite(progress)) {
          throw new Error(`居民「${resident.name}」的训练数据不完整`);
        }
        const current = resident.stats[room.trainStat];
        const trainees = residents.filter(item => item.roomId === room.id && item.away === null &&
          item.deadAt === null && item.adultAt <= now).slice(0, room.width * 2);
        const paused = resident.away !== null || resident.deadAt !== null ? '居民外出或已倒下' :
          resident.adultAt > now ? '儿童还不能训练' : room.builtAt > now ? '房间还没建好' :
          room.upgradeAt != null ? '房间正在升级' : room.incident ? '房间正在处理事件' : room.unpowered ? '房间停电' :
          !trainees.some(item => item.id === resident.id) ? '不在房间训练名额内' : '';
        // 训练每 10 分钟结算一次，按房间等级、传承和当前基础属性估算下次提升时间。
        const rate = room.level * (1 + (view.state.legacy.perks.training ?? 0) * 0.05) / (current + 1);
        const ticks = Math.ceil(Math.max(0, 1 - progress) * 6 / rate - 1e-9);
        const remainingSeconds = current >= 10 || paused ? null :
          Math.max(0, Math.ceil((view.state.lastSettledAt + ticks * 600000 - now) / 1000));
        return {
          id: resident.id, name: resident.name, stat: room.trainStat, current,
          progress: Math.max(0, Math.min(1, progress)), maxed: current >= 10, paused,
          room: all.find(item => item.id === resident.id).room, stats: keys.map(key => resident.stats[key]), remainingSeconds, reasons: []
        };
      }).sort((left, right) => right.progress - left.progress || left.id - right.id);
    return { checkedAt: now, residents: all, romances, cooldowns, children, births, training };
  } catch (error) {
    return { error: error.message };
  }
})();

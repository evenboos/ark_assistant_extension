(async () => {
  try {
    if (location.origin !== 'https://game.arkengine.me' || !/^\/shelter\/?$/.test(location.pathname)) {
      throw new Error('请在自己的避难所页面计算');
    }

    // 复用游戏页面的读取接口，一次获取全部居民，不受列表筛选和滚动位置影响。
    const response = await fetch('/api/shelter', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000)
    });
    if (response.status === 401 || response.status === 403 || response.redirected) {
      throw new Error('登录状态已失效，请重新登录游戏后计算');
    }
    if (!response.ok) throw new Error(`读取居民失败（HTTP ${response.status}）`);
    const view = await response.json();
    if (!Array.isArray(view.state?.residents) || !Array.isArray(view.state.rooms) || !Number.isFinite(view.serverTime)) {
      throw new Error('游戏返回的数据格式已变化，无法计算');
    }

    const keys = ['str', 'per', 'end', 'cha', 'int', 'agi', 'lck'];
    const residents = view.state.residents.map(resident => {
      // 外部数据格式异常时明确报错；可选状态字段为空时与游戏页面的判断一致。
      if (!Number.isFinite(resident.id) || typeof resident.name !== 'string' ||
          !Number.isFinite(resident.adultAt) ||
          !keys.every(key => Number.isFinite(resident.stats?.[key])) ||
          !Array.isArray(resident.parents) || !resident.parents.every(Number.isFinite) ||
          (resident.romance != null && (typeof resident.romance !== 'object' || !Number.isFinite(resident.romance.partnerId))) ||
          (resident.familyCooldownUntil != null && !Number.isFinite(resident.familyCooldownUntil))) {
        throw new Error(`居民「${resident.name ?? resident.id}」的数据不完整，无法计算`);
      }
      const reasons = [];
      if (resident.locked) reasons.push('居民已锁定');
      if (resident.giftOffer) reasons.push('居民正在赠送');
      if (resident.awaitingAssignment) reasons.push('等待首次安排');
      if ([...(globalThis.__fengbaoShelterAuto?.parentReturns ?? []), ...(globalThis.__fengbaoShelterAuto?.incidentSnapshot ?? [])]
        .some(entry => entry.residentId === resident.id && entry.status === 'waiting')) reasons.push('托管配对或救援待归岗');
      if ((view.state.quests ?? []).some(run => run.team?.includes(resident.id))) reasons.push('本周任务小队');
      if ((view.state.births ?? []).some(birth => birth.parents.includes(resident.id))) reasons.push('有孩子待出生');
      // 按服务器时间判断是否成年，与游戏页面的儿童标记一致。
      if (resident.adultAt > view.serverTime) reasons.push('儿童（尚未成年）');
      if (resident.away !== null) reasons.push('外出中');
      if (resident.deadAt !== null) reasons.push('已倒下');
      const currentRoom = view.state.rooms.find(room => room.id === resident.roomId);
      if (currentRoom?.incident) reasons.push('正在处理事件');
      if (['armory', 'tailor'].includes(currentRoom?.type) && currentRoom.craft) reasons.push('正在制作装备');
      // 有感情记录但已离开宿舍的居民可以重新参与配对。
      if (resident.romance && view.state.rooms.some(room => room.id === resident.roomId && room.type === 'quarters')) reasons.push('正在培养感情');
      // 使用服务器时间判断冷却，避免电脑时钟偏差导致误判。
      if (resident.familyCooldownUntil > view.serverTime) {
        const minutes = Math.ceil((resident.familyCooldownUntil - view.serverTime) / 60000);
        reasons.push(`刚组建家庭（剩余 ${minutes} 分钟）`);
      }
      const stats = keys.map(key => resident.stats[key]);
      return { id: resident.id, name: resident.name, parents: resident.parents, stats, total: stats.reduce((sum, value) => sum + value, 0), reasons };
    });

    // 采用居民列表展示的七项基础属性；同分时按居民 ID 排序，保持结果稳定。
    const eligible = residents.filter(resident => resident.reasons.length === 0)
      .sort((left, right) => right.total - left.total || left.id - right.id);
    return {
      checkedAt: view.serverTime, count: residents.length, eligibleCount: eligible.length,
      eligible,
      excluded: residents.filter(resident => resident.reasons.length > 0)
    };
  } catch (error) {
    // 将读取边界的错误交回扩展面板显示，不返回不完整的推荐结果。
    return { error: error.message };
  }
})();

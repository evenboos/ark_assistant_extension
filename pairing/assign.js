// 整个函数注入游戏页，关闭面板后继续检查本批配对和归岗。
function startDormAssignment(pairs, options = {}) {
  if (globalThis.__fengbaoShelterAuto?.running || globalThis.__fengbaoDormAssignment?.running ||
      globalThis.__fengbaoDormAssignment?.monitoring) return;
  const task = { running: true, monitoring: false, returnRequested: false, returnToWork: options.returnToWork !== false,
    message: '正在读取宿舍和居民状态…', completed: [], restored: [], issues: [], entries: [], pairs: [], unavailableRooms: [], moved: 0, nextAt: null };
  globalThis.__fengbaoDormAssignment = task;
  let view;
  const skipping = globalThis.__fengbaoDormPairSkip(checkPair, () => view.state.residents);
  const residentState = globalThis.__fengbaoDormResidentState(() => view);
  const keys = ['str', 'per', 'end', 'cha', 'int', 'agi', 'lck'];
  const pending = () => task.entries.filter(entry => entry.status === 'waiting');
  const resident = id => view.state.residents.find(item => item.id === id);
  const room = id => view.state.rooms.find(item => item.id === id);
  const occupants = id => view.state.residents.filter(item => item.roomId === id && item.deadAt === null && item.adultAt <= view.serverTime);
  const autoReturns = () => [...(globalThis.__fengbaoShelterAuto?.parentReturns ?? []),
    ...(globalThis.__fengbaoShelterAuto?.incidentSnapshot ?? [])].filter(entry => entry.status === 'waiting');
  const autoProtected = id => autoReturns().some(entry => entry.residentId === id);
  const reserved = id => new Set(autoReturns().filter(entry => entry.originalRoomId === id &&
    view.state.residents.some(member => member.id === entry.residentId && member.roomId !== id && member.deadAt === null && member.adultAt <= view.serverTime))
    .map(entry => entry.residentId)).size;
  const occupancy = id => occupants(id).length + reserved(id);
  const questIds = () => new Set((view.state.quests ?? []).flatMap(run => Array.isArray(run.team) ? run.team : []));
  const pendingParent = id => view.state.births.some(birth => birth.parents.includes(id));
  const paired = (member, list) => member.romance && list.some(other => other.id === member.romance.partnerId);
  const existingPairs = id => occupants(id).filter(member => paired(member, occupants(id))).length / 2;
  const protectedAdult = member => residentState.isProtectedAdult(member, new Set(view.state.births.flatMap(birth => birth.parents))) || !mobile(member) || questIds().has(member.id) || autoProtected(member.id);
  function roomReasons(target) {
    if (!target) return ['房间已拆除'];
    const reasons = [];
    if (target.upgradeAt !== null) reasons.push(Number.isFinite(target.upgradeAt) ? '升级中' : '升级状态不完整');
    if (!Number.isFinite(target.builtAt)) reasons.push('施工状态不完整');
    else if (target.builtAt > view.serverTime) reasons.push('施工中');
    if (target.incident) reasons.push('事故处理中');
    if (target.unpowered) reasons.push('停电');
    return reasons;
  }
  function dormReasons(target) {
    const reasons = roomReasons(target);
    if (target) {
      if (existingPairs(target.id) >= Math.min(2, target.width)) reasons.push('配对组数已满');
      if (occupants(target.id).filter(protectedAdult).length + reserved(target.id) + 2 > target.width * 2) reasons.push('成人名额不足（含待产、外出或归岗预留）');
    }
    return reasons;
  }
  function returnReasons(entry) {
    const target = room(entry.originalRoomId), reasons = roomReasons(target);
    if (target) {
      if (target.type !== entry.originalType || (target.type === 'training' && target.trainStat !== entry.originalTrainStat)) reasons.push('房间用途已改变');
      if (occupancy(target.id) >= target.width * 2) reasons.push(occupants(target.id).length >= target.width * 2 ? '满员' : '已预留归岗名额');
    }
    return reasons;
  }
  function otherBusy() {
    const auto = globalThis.__fengbaoShelterAuto;
    return globalThis.__fengbaoWorkAssignment?.running || globalThis.__fengbaoEquipmentAssignment?.running ||
      globalThis.__fengbaoResidentRename?.running || (auto?.running && auto.cycleRunning !== false);
  }
  function issue(text) { if (!task.issues.includes(text)) task.issues.push(text); }
  async function request(action) {
    const response = await fetch(action ? '/api/shelter/action' : '/api/shelter', {
      method: action ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000),
      ...(action ? { headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, idempotencyKey: crypto.randomUUID() }) } : {})
    });
    if (response.redirected || response.status === 401 || response.status === 403) throw new Error('登录已失效，请重新登录');
    const data = await response.json();
    if (!response.ok || data.code === 'retry') throw new Error(data.error || `调动结果未确认（HTTP ${response.status}）`);
    const updated = action ? data.view : data;
    if (!Array.isArray(updated?.state?.rooms) || !Array.isArray(updated.state.residents) || !Array.isArray(updated.state.births) ||
        !Number.isFinite(updated.serverTime) || new Set(updated.state.residents.map(item => item.id)).size !== updated.state.residents.length ||
        new Set(updated.state.rooms.map(item => item.id)).size !== updated.state.rooms.length) throw new Error('游戏返回的数据格式已变化');
    if (updated.switches?.frozen) throw new Error('避难所正在维护');
    view = updated;
    task.unavailableRooms = view.state.rooms.filter(item => item.type === 'quarters').map(item => ({ id: item.id,
      label: `${item.floor} 层宿舍（房间 ${item.id}）`, reasons: dormReasons(item) })).filter(item => item.reasons.length);
  }
  function checkPair(ids) {
    const members = ids.map(id => resident(id));
    for (const member of members) {
      const source = room(member?.roomId);
      if (!member || typeof member.name !== 'string' || !Number.isFinite(member.adultAt) ||
          !Array.isArray(member.parents) || !keys.every(key => Number.isFinite(member.stats?.[key])) ||
          (member.familyCooldownUntil != null && !Number.isFinite(member.familyCooldownUntil))) throw new Error('配对居民数据不完整，请重新计算');
      if (member.locked || member.giftOffer || member.awaitingAssignment || member.adultAt > view.serverTime || member.away !== null || member.deadAt !== null || source?.incident ||
          (['armory', 'tailor'].includes(source?.type) && source.craft) ||
          pendingParent(member.id) || questIds().has(member.id) || autoProtected(member.id) ||
          (member.romance && source?.type === 'quarters') || member.familyCooldownUntil > view.serverTime) {
        throw skipping.unavailable(`「${member.name}」当前无法调动配对，请重新计算`);
      }
    }
    const [left, right] = members;
    if (left.id === right.id || left.parents.includes(right.id) || right.parents.includes(left.id) ||
        left.parents.some(id => right.parents.includes(id))) throw new Error('配对居民重复或存在亲属关系，请重新计算');
    return members;
  }
  function remember(member, group, role) {
    let entry = task.entries.find(item => item.residentId === member.id);
    if (!entry) {
      const original = room(member.roomId);
      entry = { residentId: member.id, name: member.name, originalRoomId: member.roomId, expectedRoomId: member.roomId,
        originalType: original?.type ?? null, originalTrainStat: original?.trainStat ?? null,
        originalLabel: original ? `${original.floor} 层房间 ${original.id}` : '门外休息',
        groupRoomId: group.roomId, groupKey: group.key, role, status: 'waiting', baselineCooldown: member.familyCooldownUntil ?? 0 };
      task.entries.push(entry);
    }
    return entry;
  }
  function mobile(member) {
    return member && !member.locked && !member.giftOffer && member.away === null && member.deadAt === null && member.adultAt <= view.serverTime;
  }
  async function move(entry, destination, returning = false, staging = false) {
    await request();
    const member = resident(entry.residentId), source = room(member?.roomId), target = room(destination);
    if (!mobile(member) || member.roomId !== entry.expectedRoomId) throw new Error(`「${entry.name}」的位置或状态已变化，停止调动`);
    if (member.roomId === destination) return true;
    if (!returning) {
      const dorm = destination === null ? source : target, reasons = destination === null ? dormReasons(dorm) : roomReasons(dorm);
      if (dorm && dorm.type !== 'quarters') reasons.push('房间用途已改变');
      if (reasons.length) throw new Error(`目标宿舍（房间 ${dorm?.id ?? destination}）：${reasons.join('、')}，停止安排`);
    }
    if (!returning && destination !== null) {
      const expectedIds = task.pairs.filter(item => item.roomId === destination).flatMap(item => item.ids);
      if (!target || target.type !== 'quarters' ||
          occupants(destination).some(item => !expectedIds.includes(item.id) && !protectedAdult(item)) || member.familyCooldownUntil > view.serverTime ||
          (member.romance && source?.type === 'quarters')) throw new Error('配对居民或目标宿舍状态已变化，请重新计算');
    }
    if (source?.incident || (['armory', 'tailor'].includes(source?.type) && source.craft)) {
      if (returning) { entry.note = '所在房间正在处理事件或制作，等待归岗'; return false; }
      throw new Error(`「${entry.name}」所在房间正在处理事件或制作`);
    }
    if (returning && (destination !== null || staging)) {
      const reasons = returnReasons(entry).filter(reason => !staging || reason !== '满员');
      if (reasons.length) { entry.note = `原岗位：${reasons.join('、')}，等待归岗`; return false; }
    } else if (destination !== null) {
      const reasons = roomReasons(target);
      if (target && occupancy(destination) >= target.width * 2) reasons.push('满员或已预留归岗名额');
      if (reasons.length) throw new Error(`目标宿舍：${reasons.join('、')}，停止安排`);
    }
    task.message = returning ? `正在将「${entry.name}」送回${entry.originalLabel}…` : `正在临时安排「${entry.name}」${destination === null ? '到门外等待' : '入住宿舍'}…`;
    await request({ type: 'assign', residentId: entry.residentId, roomId: destination });
    if (resident(entry.residentId)?.roomId !== destination) throw new Error(`「${entry.name}」的调动结果未确认，请检查游戏页面`);
    entry.expectedRoomId = destination;
    entry.note = '';
    task.moved++;
    return true;
  }
  function fail(error) {
    clearTimeout(task.timer);
    task.monitoring = false;
    task.nextAt = null;
    task.message = `配对已停止：${error.message}\n已确认调动 ${task.moved} 人次，已执行的调动保留；结果未确认的请求不会自动重试。请按归岗记录检查游戏页面。`;
    task.message += skipping.summary();
  }
  function schedule() {
    clearTimeout(task.timer);
    if (!task.monitoring) return;
    task.nextAt = Date.now() + 60000;
    task.timer = setTimeout(() => { void tick(); }, 60000);
  }
  function report() {
    const count = pending().length;
    task.message = count ? `${task.returnRequested ? '正在结束挂载并归岗' : '配对已挂载，等待组建家庭后归岗'}；待归岗 ${count} 人，已归岗 ${task.restored.length} 人。\n每 60 秒检查，关闭面板后继续。` :
      `本批挂载已结束，已归岗 ${task.restored.length} 人。${task.issues.length ? '\n部分居民状态已变化，请查看提示。' : ''}`;
    task.message += skipping.summary();
  }
  async function tick() {
    if (!task.monitoring || task.running) return;
    if (otherBusy()) {
      task.message = '配对归岗等待其他避难所任务完成本轮操作…';
      schedule();
      return;
    }
    task.running = true;
    task.nextAt = null;
    try {
      await request();
      for (const group of task.pairs) {
        if (task.returnRequested || group.ids.every(id => {
          const member = resident(id), entry = task.entries.find(item => item.residentId === id);
          return member && member.familyCooldownUntil > Math.max(group.startedAt, entry.baselineCooldown);
        })) group.ready = true;
      }
      for (const entry of pending()) {
        const member = resident(entry.residentId), group = task.pairs.find(item => item.key === entry.groupKey);
        const partner = group.ids.find(id => id !== entry.residentId);
        if (!mobile(member) || member.roomId !== entry.expectedRoomId ||
            (entry.role === 'pair' && member.romance && member.romance.partnerId !== partner)) {
          entry.status = 'released';
          group.ready = true;
          issue(`「${entry.name}」已被另行调动、离开名单或状态变化，已取消自动归岗；同组其余居民返回原岗。`);
        }
      }
      const ready = () => pending().filter(entry => entry.role === 'displaced'
        ? task.pairs.filter(group => group.roomId === entry.groupRoomId).every(group => group.ready)
        : task.pairs.find(group => group.key === entry.groupKey).ready);
      for (let turn = 0; turn < task.entries.length * 2 + 1 && ready().length; turn++) {
        let progress = false;
        // 配对成员先离开临时宿舍，再恢复原宿舍被暂时移出的成人。
        for (const entry of ready().sort((a, b) => Number(a.role === 'displaced') - Number(b.role === 'displaced'))) {
          if (!await move(entry, entry.originalRoomId, true)) continue;
          entry.status = 'returned';
          task.restored.push(`「${entry.name}」 → ${entry.originalLabel}`);
          progress = true;
        }
        if (!progress) {
          // 原宿舍之间互换时，只有阻塞者也已允许归岗，才临时移出一人解环。
          const staged = ready().find(entry => entry.expectedRoomId !== null && !room(entry.expectedRoomId)?.incident &&
            !(['armory', 'tailor'].includes(room(entry.expectedRoomId)?.type) && room(entry.expectedRoomId).craft) &&
            returnReasons(entry).length === 1 && returnReasons(entry)[0] === '满员' &&
            occupants(entry.originalRoomId).some(member => ready().some(other => other.residentId === member.id && other.expectedRoomId !== other.originalRoomId)));
          if (staged && await move(staged, null, true, true)) continue;
          break;
        }
      }
      task.monitoring = pending().length > 0;
      report();
    } catch (error) { fail(error); }
    finally { task.running = false; schedule(); }
  }
  task.wake = () => { clearTimeout(task.timer); return tick(); };
  return (async () => {
    try {
      if (location.origin !== 'https://game.arkengine.me' || !/^\/shelter\/?$/.test(location.pathname)) throw new Error('请在自己的避难所页面安排');
      if (otherBusy()) throw new Error('其他居民任务正在执行，请等待完成');
      if (!Array.isArray(pairs) || !pairs.length || pairs.some(pair => !Array.isArray(pair) || pair.length !== 2 ||
          pair.some(member => !Number.isInteger(member.id) || !Number.isFinite(member.total))) ||
          new Set(pairs.flatMap(pair => pair.map(member => member.id))).size !== pairs.length * 2) throw new Error('请重新计算有效且不重复的配对');
      await request();
      const dorms = view.state.rooms.filter(item => item.type === 'quarters');
      if (dorms.some(item => !['id', 'level', 'floor', 'col', 'width', 'builtAt'].every(key => Number.isFinite(item[key])) ||
          ![1, 2, 3, 4, 5, 6].includes(item.width))) throw new Error('宿舍数据不完整');
      const available = dorms.filter(item => !dormReasons(item).length)
        .sort((a, b) => b.level - a.level || a.floor - b.floor || a.col - b.col || a.id - b.id);
      if (!available.length) throw new Error('没有可用宿舍，请查看不可用宿舍的状态标签');
      const ordered = skipping.filter(pairs.map(pair => ({ ids: pair.map(member => member.id), total: pair[0].total + pair[1].total }))
        .sort((a, b) => b.total - a.total));
      for (const pair of ordered) {
        const target = available.find(candidate => {
          const placed = task.pairs.filter(group => group.roomId === candidate.id).length;
          return existingPairs(candidate.id) + placed < Math.min(2, candidate.width) &&
            occupants(candidate.id).filter(protectedAdult).length + reserved(candidate.id) + (placed + 1) * 2 <= candidate.width * 2;
        });
        if (!target) break;
        task.pairs.push({ ids: pair.ids, key: pair.ids.join('-'), roomId: target.id, startedAt: view.serverTime, ready: false });
      }
      for (const group of task.pairs) for (const member of checkPair(group.ids)) remember(member, group, 'pair');
      const targetGroups = [...new Set(task.pairs.map(group => group.roomId))].map(id => task.pairs.find(group => group.roomId === id));
      for (const group of targetGroups) for (const member of occupants(group.roomId).filter(member => !protectedAdult(member))) remember(member, group, 'displaced');
      // 全部原岗位在任何调动前记录，避免后续宿舍清理覆盖记录。
      for (const group of targetGroups) for (const member of occupants(group.roomId).filter(member => !protectedAdult(member))) {
        await move(task.entries.find(entry => entry.residentId === member.id), null);
      }
      for (const group of task.pairs) {
        await request();
        if (!skipping.filter([group]).length) {
          group.ready = true;
          // 尚未入住宿舍的组不再预留原岗；被暂移的原住户仍按挂载记录恢复。
          for (const entry of task.entries.filter(entry => entry.role === 'pair' && entry.groupKey === group.key)) {
            if (resident(entry.residentId)?.roomId === entry.originalRoomId) entry.status = 'released';
          }
          continue;
        }
        const members = checkPair(group.ids), target = room(group.roomId);
        const reasons = roomReasons(target);
        if (reasons.length) throw new Error(`目标宿舍（房间 ${group.roomId}）：${reasons.join('、')}，停止安排`);
        if (!target || target.type !== 'quarters' || occupancy(target.id) + 2 > target.width * 2) throw new Error('目标宿舍状态已变化，停止安排');
        for (const id of group.ids) await move(task.entries.find(entry => entry.residentId === id), target.id);
        if (!group.ids.every(id => resident(id)?.roomId === target.id)) throw new Error('宿舍入住结果不符');
        task.completed.push(`${members.map(member => member.name).join(' ＋ ')} → ${target.floor} 层 ${target.level} 级宿舍（房间 ${target.id}）`);
      }
      task.monitoring = task.returnToWork && pending().length > 0;
      if (task.monitoring) report();
      else task.message = `已安排 ${task.completed.length} 对；${task.returnToWork ? '没有待归岗居民。' : '本次未开启自动归岗。'}${skipping.summary()}`;
      if (ordered.length > task.pairs.length) task.message += `\n宿舍不足，剩余 ${ordered.length - task.pairs.length} 对未安排。`;
    } catch (error) { fail(error); }
    finally { task.running = false; schedule(); }
  })();
}

function runShelterIncidents(options = {}) {
  if (!options.managed && globalThis.__fengbaoShelterAuto?.running) return;
  if (globalThis.__fengbaoWorkAssignment?.running || globalThis.__fengbaoEquipmentAssignment?.running) return;
  // 与生产安排共用任务状态，避免同时调动；关闭面板后本批次继续执行。
  const task = { running: true, message: '正在检查全部房间和大门的事件…', moved: 0, rooms: [], excluded: [], rates: null };
  globalThis.__fengbaoWorkAssignment = task;
  return (async () => {
    let view;
    const labels = { fire: '着火', rats: '变异鼠', leak: '漏水', raiders: '掠夺者' };
    function updateView(data) {
      if (!Array.isArray(data?.state?.rooms) || !Array.isArray(data.state.residents) || !Number.isFinite(data.serverTime)) {
        throw new Error('游戏返回的数据格式已变化');
      }
      view = data;
    }
    try {
      if (location.origin !== 'https://game.arkengine.me' || !/^\/shelter\/?$/.test(location.pathname)) throw new Error('请在自己的避难所页面使用');
      if (globalThis.__fengbaoDormAssignment?.running) throw new Error('宿舍安排正在执行，请等待完成');
      const response = await fetch('/api/shelter', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (response.redirected || response.status === 401 || response.status === 403) throw new Error('登录状态已失效');
      if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}）`);
      updateView(await response.json());
      if (view.switches?.frozen) throw new Error('避难所正在维护，暂时不能调动');

      // 完整接口包含大门及所有楼层，不依赖页面当前可见的房间。
      // 00:00–07:59 的大门掠夺者进度冻结，留给托管在 08:00 由原救援者处理。
      const incidents = view.state.rooms.filter(room => room.incident && Object.hasOwn(labels, room.incident.kind) &&
        !(room.type === 'door' && room.incident.kind === 'raiders' && new Date(view.serverTime + 8 * 3600000).getUTCHours() < 8))
        .sort((left, right) => left.floor - right.floor || left.col - right.col || left.id - right.id);
      if (!incidents.length) {
        task.message = '已检查全部房间（含大门），没有需要立即处理的着火、变异鼠、漏水或掠夺者事件；夜间大门掠夺者会留到 08:00。';
        // 托管的无事件检查不触发手动快照确认。
        if (options.managed) return task;
        // 交给扩展面板二次确认，游戏页面不直接弹窗。
        task.pendingSnapshot = {
          savedAt: view.serverTime, restored: false,
          residents: view.state.residents.map(({ id, name, roomId }) => ({ id, name, roomId })),
          rooms: view.state.rooms.map(({ id, type, floor, trainStat }) => ({ id, type, floor, trainStat }))
        };
        return;
      }
      // 首次调动前记录全员原位；重复处理事件时保留尚未恢复的快照。
      if (!globalThis.__fengbaoIncidentSnapshot || globalThis.__fengbaoIncidentSnapshot.restored) {
        globalThis.__fengbaoIncidentSnapshot = {
          savedAt: view.serverTime, restored: false,
          residents: view.state.residents.map(({ id, name, roomId }) => ({ id, name, roomId })),
          rooms: view.state.rooms.map(({ id, type, floor, trainStat }) => ({ id, type, floor, trainStat }))
        };
      }
      task.handled = true;
      const target = incidents[0];
      const kind = target.incident.kind;
      const destination = `${target.floor} 层${target.type === 'door' ? '大门' : `房间 ${target.id}`}（${labels[kind]}）`;
      task.rooms = incidents.map(room => `${room.floor} 层${room.type === 'door' ? '大门' : `房间 ${room.id}`}：${labels[room.incident.kind]}`);
      task.excluded = view.state.residents.filter(resident => resident.locked || resident.giftOffer || resident.adultAt > view.serverTime || resident.away !== null || resident.deadAt !== null)
        .map(resident => ({ id: resident.id, name: resident.name, reason: resident.locked ? '居民已锁定' : resident.giftOffer ? '居民正在赠送' : resident.adultAt > view.serverTime ? '儿童' : resident.deadAt !== null ? '已倒下（游戏不允许调动）' : '外出中（游戏不允许调动）' }));

      while (true) {
        if (options.shouldStop?.()) { task.cancelled = true; return task; }
        const latest = await fetch('/api/shelter', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (!latest.ok || latest.redirected) throw new Error('读取失败或登录状态已失效');
        updateView(await latest.json());
        if (view.switches?.frozen) throw new Error('避难所正在维护');
        const room = view.state.rooms.find(item => item.id === target.id);
        if (room?.incident?.kind !== kind) break;
        // 救援不保留宿舍、训练室或感情关系，也不检查房间定员。
        const resident = view.state.residents.find(item => !item.locked && !item.giftOffer && item.adultAt <= view.serverTime && item.away === null && item.deadAt === null && item.roomId !== target.id);
        if (!resident) break;
        task.message = `正在将「${resident.name}」调往 ${destination}…\n已确认调动 ${task.moved} 人。`;
        const moveResponse = await fetch('/api/shelter/action', {
          method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: { type: 'assign', residentId: resident.id, roomId: target.id }, idempotencyKey: crypto.randomUUID() })
        });
        if (moveResponse.redirected || moveResponse.status === 401 || moveResponse.status === 403) throw new Error('登录状态已失效');
        const data = await moveResponse.json();
        if (!moveResponse.ok || data.code === 'retry') throw new Error(data.error || `调动结果未确认（HTTP ${moveResponse.status}）`);
        updateView(data.view);
        if (view.state.residents.find(item => item.id === resident.id)?.roomId !== target.id) throw new Error(`「${resident.name}」的调动结果未确认`);
        task.moved++;
        options.log?.(`事件处理：${resident.name} → ${destination}`);
      }

      const finalResponse = await fetch('/api/shelter', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!finalResponse.ok || finalResponse.redirected) throw new Error('调动已执行，最终状态读取失败，请查看游戏页面');
      updateView(await finalResponse.json());
      const active = view.state.rooms.find(room => room.id === target.id)?.incident?.kind === kind;
      const adults = view.state.residents.filter(resident => resident.adultAt <= view.serverTime && resident.away === null && resident.deadAt === null);
      if (active && adults.some(resident => resident.roomId !== target.id)) throw new Error('仍有可调动成人未到达事件房间，请重新处理');
      const present = adults.filter(resident => resident.roomId === target.id).length;
      task.message = active ? `已将全部可调动成人集中到 ${destination}，共 ${present} 人，本次调动 ${task.moved} 人。\n居民将由游戏自动处理事件，当前事件尚未结束。` :
        `${destination} 的原事件已结束或发生变化，已停止继续集中，本次确认调动 ${task.moved} 人。`;
      if (incidents.length > 1) task.message += '\n本次只集中处理排序靠前的一个事件，其他事件可在之后再次点击处理。';
      task.message += '\n可点击“恢复原位”按快照恢复；刷新或关闭游戏页面会清除快照，请先完成恢复。';
    } catch (error) {
      task.error = error.message;
      task.message = `事件调动已停止：${error.message}\n已确认调动 ${task.moved} 人，已执行的调动保留，请检查游戏页面。`;
    } finally {
      task.running = false;
    }
    return task;
  })();
}

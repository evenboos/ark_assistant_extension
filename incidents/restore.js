function restoreShelterPositions(options = {}) {
  if (!options.managed && globalThis.__fengbaoShelterAuto?.running) return;
  if (globalThis.__fengbaoWorkAssignment?.running || globalThis.__fengbaoEquipmentAssignment?.running) return;
  const task = { running: true, message: '正在按快照恢复居民位置…', moved: 0, rooms: [], excluded: [], rates: null };
  globalThis.__fengbaoWorkAssignment = task;
  return (async () => {
    try {
      if (location.origin !== 'https://game.arkengine.me' || !/^\/shelter\/?$/.test(location.pathname)) throw new Error('请在自己的避难所页面使用');
      if (globalThis.__fengbaoDormAssignment?.running || globalThis.__fengbaoDormAssignment?.monitoring) throw new Error('宿舍安排或配对挂载中，请先完成归岗');
      const snapshot = globalThis.__fengbaoIncidentSnapshot;
      if (!snapshot) throw new Error('没有可恢复的位置快照');
      const response = await fetch('/api/shelter', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok || response.redirected) throw new Error('读取失败或登录状态已失效');
      let view = await response.json();
      if (view.switches?.frozen) throw new Error('避难所正在维护，暂时不能调动');
      // 原位未变者无需操作；无法调动者明确列出，其余居民继续恢复。
      const pending = snapshot.residents.filter(saved => {
        const resident = view.state.residents.find(item => item.id === saved.id);
        if (resident?.roomId === saved.roomId) return false;
        const reason = !resident ? '居民已不在名单中' : resident.locked ? '居民已锁定' : resident.giftOffer ? '居民正在赠送' : resident.adultAt > view.serverTime ? '儿童无法调动' :
          resident.away !== null ? '居民外出中' : resident.deadAt !== null ? '居民已倒下' :
          saved.roomId !== null && !view.state.rooms.some(room => room.id === saved.roomId) ? '原房间已不存在' : '';
        if (reason) task.excluded.push({ id: saved.id, name: saved.name, reason });
        return !reason;
      });
      async function move(saved, roomId) {
        const latest = await fetch('/api/shelter', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (!latest.ok || latest.redirected) throw new Error('读取失败或登录状态已失效');
        view = await latest.json();
        const current = view.state.residents.find(item => item.id === saved.id);
        if (!current || current.locked || current.giftOffer || current.away !== null || current.deadAt !== null ||
            view.switches?.frozen) throw new Error('居民状态已变化，停止恢复');
        if (current.roomId === roomId) return;
        task.message = `正在恢复「${saved.name}」…已确认调动 ${task.moved} 人次。`;
        const response = await fetch('/api/shelter/action', {
          method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: { type: 'assign', residentId: saved.id, roomId }, idempotencyKey: crypto.randomUUID() })
        });
        if (response.redirected || response.status === 401 || response.status === 403) throw new Error('登录状态已失效');
        const data = await response.json();
        if (!response.ok || data.code === 'retry') throw new Error(data.error || '恢复结果未确认');
        view = data.view;
        if (view.state.residents.find(item => item.id === saved.id)?.roomId !== roomId) throw new Error(`「${saved.name}」的位置未恢复成功`);
        task.moved++;
        options.log?.(`恢复原位：${saved.name} → ${roomId === null ? '门外' : `房间 ${roomId}`}`);
      }
      // 先使用空位；满房互换形成循环时临时移出一人，不移动快照外的居民。
      while (pending.length) {
        if (options.shouldStop?.()) { task.cancelled = true; return task; }
        const index = pending.findIndex(saved => saved.roomId === null || view.state.residents.filter(resident =>
          resident.roomId === saved.roomId && resident.deadAt === null && resident.adultAt <= view.serverTime).length <
          view.state.rooms.find(room => room.id === saved.roomId).width * 2);
        if (index < 0) {
          const saved = pending.find(saved => view.state.residents.find(item => item.id === saved.id).roomId !== null);
          if (!saved) throw new Error('原房间已满，剩余居民无法恢复，请手动调整');
          await move(saved, null);
        } else {
          const [saved] = pending.splice(index, 1);
          await move(saved, saved.roomId);
        }
      }
      const finalResponse = await fetch('/api/shelter', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!finalResponse.ok || finalResponse.redirected) throw new Error('恢复已执行，最终状态读取失败');
      view = await finalResponse.json();
      const unrestored = snapshot.residents.filter(saved => view.state.residents.find(item => item.id === saved.id)?.roomId !== saved.roomId);
      snapshot.restored = unrestored.length === 0;
      task.message = `${snapshot.restored ? '快照中的所有居民均已恢复原位。' : `仍有 ${unrestored.length} 名居民未恢复，请查看原因或手动调整。`}\n本次确认调动 ${task.moved} 人次，快照保留。`;
    } catch (error) {
      task.error = error.message;
      task.message = `恢复已停止：${error.message}\n已确认调动 ${task.moved} 人次，快照及已执行的调动保留。`;
    } finally {
      task.running = false;
    }
    return task;
  })();
}

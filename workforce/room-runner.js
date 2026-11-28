(() => {
  if (globalThis.__fengbaoShelterAuto?.running || globalThis.__fengbaoWorkAssignment?.running) return;
  // 复用居民安排锁和结果区域，宿舍安排与托管均会检查这个锁。
  const task = { running: true, message: '正在检查房间并规划整理顺序…', moved: 0, split: 0, merged: 0, rooms: [], excluded: [], rates: null };
  globalThis.__fengbaoWorkAssignment = task;
  (async () => {
    try {
      if (globalThis.__fengbaoDormAssignment?.monitoring) throw new Error('配对挂载仍有待归岗居民，请先在配对页结束挂载并完成归岗，再整理房间');
      const auto = globalThis.__fengbaoShelterAuto;
      if ([...(auto?.parentReturns ?? []), ...(auto?.incidentSnapshot ?? [])].some(entry => entry.status === 'waiting')) {
        throw new Error('托管仍有待归岗居民，请先重新开启托管并完成归岗，再整理房间');
      }
      if (location.origin !== 'https://game.arkengine.me' || !/^\/shelter\/?$/.test(location.pathname)) throw new Error('请在自己的避难所页面使用');
      if (globalThis.__fengbaoDormAssignment?.running || globalThis.__fengbaoResidentRename?.running || globalThis.__fengbaoEquipmentAssignment?.running) throw new Error('其他居民任务正在运行，请等待完成');
      async function read() {
        const response = await fetch('/api/shelter', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (!response.ok || response.redirected) throw new Error('读取避难所失败或登录已失效');
        const view = await response.json();
        shelterRoomModel(view);
        return view;
      }
      let view = await read();
      const initialRooms = view.state.rooms.length;
      const composition = state => JSON.stringify(Object.entries(state.rooms.reduce((totals, room) => {
        const key = `${room.type}:${room.level}:${room.type === 'training' ? room.trainStat : ''}`;
        totals[key] = (totals[key] || 0) + room.width;
        return totals;
      }, {})).sort(([a], [b]) => a.localeCompare(b)));
      const originalComposition = composition(view.state);
      const residents = new Map(view.state.residents.map(resident => [resident.id, resident.roomId]));
      const plan = planShelterRooms(view, globalThis.__fengbaoRoomOrder);
      function showRooms(rooms) {
        const { names } = shelterRoomModel(view);
        task.rooms = [];
        for (let floor = 1; floor <= view.state.depth; floor++) {
          const list = rooms.filter(room => room.floor === floor).sort((a, b) => a.col - b.col);
          task.rooms.push(`${floor} 层：${list.length ? list.map(room => `${names[room.type]}${room.type === 'training' ? `（${{ str: '力量', per: '感知', end: '耐力', cha: '魅力', int: '智力', agi: '敏捷', lck: '幸运' }[room.trainStat]}）` : ''} ${room.level} 级 ×${room.width}`).join('、') : '空层'}`);
        }
      }
      showRooms(plan.rooms);
      if (plan.steps.length) {
        const moves = plan.steps.filter(step => step.type === 'move_room').length;
        const splits = plan.steps.filter(step => step.type === 'split_room').length;
        const merges = plan.steps.filter(step => step.type === 'auto_merge').length;
        const fixedRooms = view.state.rooms.length - shelterRoomModel(view).rooms.length;
        task.message = `规划完成，以下为预计楼层分配（从左到右）。\n预计拆分 ${splits} 次、移动 ${moves} 次、恢复自动合并 ${merges} 次，房间数 ${initialRooms} → ${plan.rooms.length + fixedRooms}（含大门、电梯）。\n先拆成单格，利用至少 1 格空位中转，全部到位后重新合并。尚未执行任何操作，请确认执行或取消。`;
        task.pendingRoomConfirmation = true;
        // 等待用户查看分配后明确确认；关闭面板不会自动同意，重开后仍可确认或取消。
        const approved = await new Promise(resolve => {
          globalThis.__fengbaoConfirmRoomPlan = approved => {
            task.pendingRoomConfirmation = false;
            delete globalThis.__fengbaoConfirmRoomPlan;
            resolve(approved);
          };
        });
        if (!approved) {
          task.message = '已取消整理，未拆分、移动或合并任何房间。以下为未执行的规划。';
          return;
        }
      }
      let completed = 0;
      for (const step of plan.steps) {
        view = await read();
        if (shelterRoomLayout(view.state.rooms) !== step.beforeLayout) throw new Error('房间布局已变化，停止后续整理');
        if ([...residents].some(([id, roomId]) => view.state.residents.find(resident => resident.id === id)?.roomId !== roomId)) {
          throw new Error('居民位置已变化，请重新规划');
        }
        const previousRooms = view.state.rooms;
        const source = view.state.rooms.find(room => room.floor === step.source.floor && room.col === step.source.col);
        const before = step.before && view.state.rooms.find(room => room.floor === step.before.floor && room.col === step.before.col);
        const action = step.type === 'move_room' ? { type: step.type, roomId: source.id, floor: step.floor, beforeRoomId: before ? before.id : null } : { type: step.type, roomId: source.id };
        task.message = `正在整理房间 ${completed + 1}/${plan.steps.length}：${step.type === 'move_room' ? `移动到第 ${step.floor} 层` : step.type === 'split_room' ? '拆成单格房间' : '恢复自动合并'}…`;
        const response = await fetch('/api/shelter/action', {
          method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(15000),
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, idempotencyKey: crypto.randomUUID() })
        });
        if (response.redirected || response.status === 401 || response.status === 403) throw new Error('登录状态已失效');
        const data = await response.json();
        if (!response.ok || data.code === 'retry') throw new Error(data.error || '操作结果未确认，请查看游戏页面');
        completed++;
        if (step.type === 'move_room') task.moved++;
        if (step.type === 'split_room') task.split++;
        if (step.type === 'auto_merge') task.merged++;
        view = data.view;
        shelterRoomModel(view);
        if (shelterRoomLayout(view.state.rooms) !== step.afterLayout) throw new Error('游戏返回的拆分、移动或合并结构与计划不一致，停止后续整理');
        if (composition(view.state) !== originalComposition) throw new Error('房间总格数或类型等级发生变化，停止整理');
        for (const [id, roomId] of residents) {
          const resident = view.state.residents.find(item => item.id === id);
          const previousRoom = previousRooms.find(room => room.id === roomId);
          const transition = previousRoom && step.transitions.find(item => item.floor === previousRoom.floor && item.col === previousRoom.col);
          const expectedRoomIds = transition ? transition.targets.map(([floor, col]) => view.state.rooms.find(room => room.floor === floor && room.col === col).id) : [roomId];
          if (!resident || !expectedRoomIds.includes(resident.roomId)) throw new Error('居民位置发生非预期变化，停止整理');
          // 子房间的人员分布以服务端返回为准，下一步按实际位置继续跟踪。
          residents.set(id, resident.roomId);
        }
      }
      view = await read();
      if (shelterRoomLayout(view.state.rooms) !== plan.finalLayout) throw new Error('最终房间布局与计划不一致');
      const model = shelterRoomModel(view);
      showRooms(model.rooms);
      task.message = `整理完成：拆分 ${task.split} 次、移动 ${task.moved} 次、恢复自动合并 ${task.merged} 次，房间数 ${initialRooms} → ${view.state.rooms.length}（含大门、电梯）。\n已恢复自动合并；超过 6 格或等级不同的房间保留分开。`;
    } catch (error) {
      task.message = `整理停止：${error.message}。已完成拆分 ${task.split} 次、移动 ${task.moved} 次、恢复自动合并 ${task.merged} 次，不自动回滚。`;
    } finally {
      task.running = false;
    }
  })();
})();

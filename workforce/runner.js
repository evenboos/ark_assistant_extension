function startWorkforce(options = {}) {
  if (globalThis.__fengbaoWorkAssignment?.running) return;
  const task = { kind: 'residents', running: true, stopRequested: false, message: '正在读取居民和生产数据…', moved: 0, rooms: [], unavailableRooms: [], excluded: [], rates: null, longTermRates: null, happiness: null, doorGuardRequired: true };
  globalThis.__fengbaoWorkAssignment = task;
  (async () => {
    let view;
    try {
      task.options = workforceOptions(options);
      if (location.origin !== 'https://game.arkengine.me' || !/^\/shelter\/?$/.test(location.pathname)) throw new Error('请在自己的避难所页面使用');
      if (globalThis.__fengbaoShelterAuto?.running || globalThis.__fengbaoEquipmentAssignment?.running ||
          globalThis.__fengbaoDormAssignment?.running || globalThis.__fengbaoResidentRename?.running) {
        throw new Error('其他避难所任务正在执行，请等待完成或先关闭托管');
      }
      async function request(action) {
        const response = await fetch(action ? '/api/shelter/action' : '/api/shelter', {
          method: action ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000),
          ...(action ? { headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action, idempotencyKey: crypto.randomUUID() }) } : {})
        });
        if (response.redirected || response.status === 401 || response.status === 403) throw new Error('登录状态已失效');
        const data = await response.json();
        if (!response.ok || data.code === 'retry') throw new Error(data.error || `操作结果未确认（HTTP ${response.status}）`);
        const updated = action ? data.view : data;
        task.unavailableRooms = workforceModel(updated, task.options).unavailableRooms;
        return updated;
      }
      view = await request();
      const initialModel = workforceModel(view, task.options);
      task.beforeRates = initialModel.net();
      task.beforeLongTermRates = initialModel.longTermNet();
      task.beforeHappiness = initialModel.happiness();
      task.doorGuardRequired = workforceDoorGuardRequired(view);
      const progressLabels = { prepare: '正在读取岗位容量…', score: '正在估算每个岗位的实际产出…',
        match: '正在按产出匹配岗位…', improve: '正在修补资源缺口…', long: '正在优化心情与长期产出…' };
      function reportPlanProgress(progress) {
        const percent = Math.max(0, Math.min(99, Math.round(progress.done / progress.total * 100)));
        task.message = `${progressLabels[progress.phase] ?? '正在计算安排…'}（${percent}%）`;
      }
      task.message = task.options.strategy === 'production' ? '正在按实际产出匹配岗位，并计入电台心情增益与资源收支…' : '正在按最高基础属性安排生产岗位与训练室…';
      // 分片计算：人数很多时一次性算完会长时间卡住游戏页面，这里按时间片推进并回报进度。
      const plan = await planWorkforceChunked(view, task.options,
        { onProgress: reportPlanProgress, stopped: () => task.stopRequested });
      task.excluded = plan.excluded;
      task.expectedRates = plan.expected;
      task.rates = plan.expected;
      task.expectedLongTermRates = plan.longTermExpected;
      task.longTermRates = plan.longTermExpected;
      task.happiness = plan.happiness;
      task.planned = plan.changed;
      const protectedIds = new Set(plan.excluded.map(resident => resident.id));
      const expected = new Map(view.state.residents.map(resident => [resident.id, resident.roomId]));
      const context = workforceContext(view, task.options);
      const guardRequired = workforceDoorGuardRequired(view);
      const destinations = new Map(plan.assignments.map(item => [item.residentId, item.roomId]));
      function verify(updated) {
        if (workforceDoorGuardRequired(updated) !== guardRequired) {
          throw new Error('已到 08:00，大门重新需要守卫，停止后续调动；请刷新后重新一键安排');
        }
        if (workforceContext(updated, task.options) !== context) throw new Error('居民状态、属性、装备或房间状态已变化，请重新安排');
        for (const resident of updated.state.residents) {
          if (expected.get(resident.id) !== resident.roomId) throw new Error('居民位置与预期不符，停止后续调动');
        }
      }
      function occupants(roomId) {
        // 游戏名额包括保留原岗位的外出成人，不包括儿童和已倒下的居民。
        return view.state.residents.filter(resident => resident.roomId === roomId && resident.deadAt === null && resident.adultAt <= view.serverTime).length;
      }
      async function move(residentId, roomId) {
        if (task.stopRequested) return;
        const resident = view.state.residents.find(item => item.id === residentId);
        const target = view.state.rooms.find(room => room.id === roomId);
        if (!resident || protectedIds.has(residentId) || resident.adultAt > view.serverTime || resident.away !== null || resident.deadAt !== null) {
          throw new Error('居民状态已变化，停止后续调动');
        }
        if (resident.roomId === roomId) return;
        if (roomId !== null) {
          const reasons = workforceRoomReasons(target, view.serverTime);
          if (target && occupants(roomId) >= target.width * 2) reasons.push('满员');
          if (reasons.length) throw new Error(`目标房间：${reasons.join('、')}，停止后续调动`);
        }
        const name = target ? workforceModel(view, task.options).types[target.type].name : null;
        task.message = `正在安排「${resident.name}」 → ${target ? `${target.floor} 层${name}` : '门外休息'}…\n已确认调动 ${task.moved} 人次。`;
        const updated = await request({ type: 'assign', residentId, roomId });
        expected.set(residentId, roomId);
        verify(updated);
        view = updated;
        task.moved++;
      }
      const pending = plan.assignments.filter(item => expected.get(item.residentId) !== item.roomId);
      while (pending.length && !task.stopRequested) {
        // 每次提交前刷新，不用旧响应覆盖玩家刚做的手动安排。
        view = await request();
        verify(view);
        if (task.stopRequested) break;
        const index = pending.findIndex(item => item.roomId === null || occupants(item.roomId) < view.state.rooms.find(room => room.id === item.roomId).width * 2);
        if (index < 0) {
          const item = pending.find(item => expected.get(item.residentId) !== null);
          if (!item) throw new Error('目标房间已满，无法继续安排');
          await move(item.residentId, null);
        } else {
          const [item] = pending.splice(index, 1);
          await move(item.residentId, item.roomId);
        }
      }
      view = await request();
      verify(view);
      const finalModel = workforceModel(view, task.options);
      task.rates = finalModel.net();
      task.longTermRates = finalModel.longTermNet();
      task.happiness = finalModel.happiness();
      for (const room of finalModel.rooms) {
        const residents = view.state.residents.filter(resident => destinations.has(resident.id) && resident.roomId === room.id);
        if (residents.length) task.rooms.push(`${room.floor} 层 ${room.level} 级${finalModel.types[room.type].name}${room.type === 'training' ? `（${{ str: '力量', per: '感知', end: '耐力', cha: '魅力', int: '智力', agi: '敏捷', lck: '幸运' }[room.trainStat]}）` : ''} ×${room.width}：${residents.map(resident => resident.name).join('、')}`);
      }
      if (task.stopRequested) {
        task.message = `已停止居民安排，已确认调动 ${task.moved} 人次，已完成的调动保留。`;
      } else {
        for (const [id, roomId] of destinations) if (expected.get(id) !== roomId) throw new Error('最终居民位置与安排方案不一致');
        // 废料长期溢出，只有零件工坊会消耗它；安排不再为废料收支留空岗位，这里只作为读数提示。
        const deficits = [['power', '电力'], ['food', '食物'], ['water', '净水']]
          .filter(([key]) => task.rates[key] < -1e-7).map(([, label]) => label);
        const longDeficits = [['power', '电力'], ['food', '食物'], ['water', '净水']]
          .filter(([key]) => task.longTermRates[key] < -1e-7).map(([, label]) => label);
        const scraps = [['scrap_now', task.rates.scrap], ['scrap_long', task.longTermRates.scrap]]
          .filter(([, value]) => value < -1e-7).map(([key]) => key === 'scrap_now' ? '当前心情' : '长期目标');
        const mood = task.happiness;
        // 门外待命不是被跳过调人：在家的可调成人全都参与匹配，只是可用岗位不够。
        const capacityNote = plan.capacity && plan.resting > 0 ?
          `\n门外待命 ${plan.resting} 人（可调成人 ${plan.available} 人；可用生产位置 ${plan.capacity.production} 个已满，` +
          `训练位置 ${plan.capacity.training} 个仅限可训练的人）。留下的是产出最低的，扩建或升级房间后会自动补上。` : '';
        task.message = `已安排生产 ${plan.production} 人、训练 ${plan.training} 人，实际调动 ${task.moved} 人次。${capacityNote}\n` +
          (deficits.length ? `电力、食物、净水的即时收支仍为负：${deficits.join('、')}，现有可调人手和房间可能不足，请检查。` : '当前心情下，电力、食物、净水即时收支无亏损。') + '\n' +
          (longDeficits.length ? `心情稳定后的长期估算仍为负：${longDeficits.join('、')}。` : '按心情长期目标估算，电力、食物、净水收支无亏损。') + '\n' +
          (scraps.length ? `废料按当前配置估算为净消耗（${scraps.join('、')}），若废料库存充足可忽略。` : '') +
          `心情预估：当前平均 ${mood.averageCurrent.toFixed(1)} → 一小时后 ${mood.averageOneHour.toFixed(1)} → 长期目标 ${mood.averageTarget.toFixed(1)}；` +
          `${mood.radioActive ? '电台全体心情加成已计入' : '电台未提供全体心情加成'}。`;
      }
      if (!guardRequired) task.message += '\n当前为夜间无守卫时段（08:00 前）；08:00 后请重新一键安排以恢复大门值守。';
      task.message += `\n已保护 ${plan.excluded.length} 人；游戏画面未更新时，请刷新查看。`;
    } catch (error) {
      task.rates = null;
      task.longTermRates = null;
      task.happiness = null;
      task.message = `安排已停止：${error.message}\n已确认调动 ${task.moved} 人次；已执行的调动保留，结果未确认的请求不会自动重试。请检查游戏页面。`;
    } finally {
      task.running = false;
    }
  })();
}

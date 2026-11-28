function startShelterAuto(intervalSeconds, recallEvents, dismissEnabled, dismissTotal, dismissStatEnabled = false, dismissStatKey = 'end', dismissStat = 4, rescueCount = 1, rescueEnabled = true, rescueMode = 'auto', godEnabled = false, birthEnabled = false, questEnabled = false, trainingOptions = {}, upgradeEnabled = false, upgradeDigEnabled = false, upgradeOrder = [], craftOutfitsEnabled = false, targetEnabled = false, targetRoom = '', targetCount = 0, targetStat = 'str', populationOptions = {}, targetProgress = null, craftMultiEnabled = false) {
  const previous = globalThis.__fengbaoShelterAuto;
  if (previous?.running) return;
  if (globalThis.__fengbaoWorkAssignment?.running || globalThis.__fengbaoDormAssignment?.running ||
      globalThis.__fengbaoEquipmentAssignment?.running || globalThis.__fengbaoResidentRename?.running) return;
  trainingOptions = workforceOptions(trainingOptions);
  populationOptions = { enabled: false, total: 60, minIdle: 5, ...populationOptions };
  const validPopulationTotal = Number.isInteger(populationOptions.total) && populationOptions.total >= 1 && populationOptions.total <= 70;
  const validPopulationIdle = Number.isInteger(populationOptions.minIdle) && populationOptions.minIdle >= 2 && populationOptions.minIdle <= 200;
  if (typeof populationOptions.enabled !== 'boolean' || populationOptions.enabled && (!validPopulationTotal || !validPopulationIdle)) {
    throw new Error('人口优化：属性阈值须为 1–70，待岗人数须为 2–200 的整数');
  }
  // 关闭功能后，未填完的禁用控件不应阻止其他托管功能启动。
  if (!validPopulationTotal) populationOptions.total = 60;
  if (!validPopulationIdle) populationOptions.minIdle = 5;
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1 || !Number.isInteger(recallEvents) || recallEvents < 1) throw new Error('间隔和事件次数必须为正整数');
  if (rescueEnabled && !['auto', 'workers'].includes(rescueMode)) throw new Error('请选择事件救援方式');
  if (rescueEnabled && rescueMode === 'auto' && (!Number.isInteger(rescueCount) || rescueCount < 1)) throw new Error('救援次数必须为正整数');
  if (dismissEnabled && (!Number.isInteger(dismissTotal) || dismissTotal < 1 || dismissTotal > 70)) throw new Error('遣散阈值必须为 1–70 的整数');
  if (upgradeEnabled && !Array.isArray(upgradeOrder)) throw new Error('升级顺序格式不正确');
  if (upgradeEnabled && typeof planRoomUpgrades !== 'function') throw new Error('自动升级脚本未加载，请重新打开扩展面板');
  if (craftOutfitsEnabled && !upgradeEnabled) throw new Error('自动造服装需要同时开启自动升级');
  if (targetEnabled && (typeof shelterTargetStatus !== 'function' || !shelterTargetBuildable.includes(targetRoom) ||
      !Number.isInteger(targetCount) || targetCount < 1)) throw new Error('请选择目标建筑并填写正整数格数');
  if (targetEnabled && targetRoom === 'training' && !['str', 'per', 'end', 'cha', 'int', 'agi', 'lck'].includes(targetStat)) throw new Error('请选择目标训练属性');
  const statLabels = { str: '力量', per: '感知', end: '耐力', cha: '魅力', int: '智力', agi: '敏捷', lck: '幸运' };
  const roomLabels = { power: '发电站', diner: '餐厅', water: '净水站', scrap: '废料回收站', workshop: '零件工坊', medbay: '医务室', radio: '电台', training: '训练室' };
  const keys = ['str', 'per', 'end', 'cha', 'int', 'agi', 'lck'];
  // 游戏服装图鉴按“前缀 + 款式/档位”记录；同一档 6 种全亮才算集齐，武器不参与自动造服装。
  const outfitTierPrefixes = ['破旧', '普通', '结实', '精良', '改装', '传奇', '星核'];
  const outfitBases = ['工装', '侦察斗篷', '白大褂', '演出服', '护甲', '幸运夹克'];
  const outfitCodexKeysByTier = outfitTierPrefixes.map((prefix, tier) => outfitBases.map(base => `${prefix}${base}/${tier}`));
  const outfitCraftCost = tier => ({ scrap: 80 * (tier + 1) ** 2, parts: 4 * tier });
  const outfitCraftMaxTier = room => Math.min(6, 2 * (Number(room.level) || 0));
  if (dismissStatEnabled && !Object.hasOwn(statLabels, dismissStatKey)) throw new Error('请选择单项遣散的指定属性');
  if (dismissStatEnabled && (!Number.isInteger(dismissStat) || dismissStat < 1 || dismissStat > 10)) throw new Error('单项属性遣散阈值必须为 1–10 的整数');
  const task = { running: true, cycleRunning: true, trainingOptions, parentReturns: previous?.parentReturns ?? [], stopRequested: false, intervalSeconds, rescueEnabled, rescueMode, rescueCount, recallEvents, dismissEnabled, dismissTotal, dismissStatEnabled, dismissStatKey, dismissStat, godEnabled, birthEnabled: Boolean(birthEnabled), questEnabled: Boolean(questEnabled), upgradeEnabled: Boolean(upgradeEnabled), upgradeDigEnabled: Boolean(upgradeDigEnabled), craftOutfitsEnabled: Boolean(craftOutfitsEnabled), craftMultiEnabled: Boolean(craftMultiEnabled), targetEnabled: Boolean(targetEnabled), targetRoom: String(targetRoom || ''), targetCount: Number(targetCount) || 0, targetStat: ['str', 'per', 'end', 'cha', 'int', 'agi', 'lck'].includes(targetStat) ? targetStat : 'str', targetProgress: previous?.targetProgress ?? targetProgress ?? null, targetBlockedUntil: previous?.targetBlockedUntil ?? 0, targetBlockedReason: previous?.targetBlockedReason ?? '', upgradeOrder: typeof normalizeShelterUpgradeOrder === 'function' ? normalizeShelterUpgradeOrder(upgradeOrder) : [], upgradeBlocked: previous?.upgradeBlocked ?? {}, upgradingRooms: previous?.upgradingRooms ?? {}, craftBlocked: previous?.craftBlocked ?? {}, lastDigFloor: previous?.lastDigFloor ?? null, logs: previous?.logs ?? [], message: '正在开启托管…', nextAt: null, pendingDispatch: previous?.pendingDispatch ?? {}, newcomers: previous?.newcomers ?? [], knownIds: previous?.knownIds ?? null, deployments: previous?.deployments ?? {}, autoParents: previous?.autoParents ?? [], autoAssigned: previous?.autoAssigned ?? [], autoPairs: previous?.autoPairs ?? [], pairAttempts: previous?.pairAttempts ?? {}, pairFailedUntil: previous?.pairFailedUntil ?? {}, recentEvictions: previous?.recentEvictions ?? {}, pairLogAt: previous?.pairLogAt ?? {}, evictCounts: previous?.evictCounts ?? {}, evictHoldUntil: previous?.evictHoldUntil ?? {}, recentMoves: previous?.recentMoves ?? {}, pendingWorkBlocked: previous?.pendingWorkBlocked ?? {}, pendingWorkDone: previous?.pendingWorkDone ?? {}, dormWorkHold: previous?.dormWorkHold ?? {}, reuniteAt: previous?.reuniteAt ?? {}, gateHold: previous?.gateHold ?? {}, questRetries: previous?.questRetries ?? {}, questWeek: previous?.questWeek ?? null, questDone: previous?.questDone ?? [], questStartBlocked: previous?.questStartBlocked ?? {}, questLogAt: previous?.questLogAt ?? {}, questDoneNotice: previous?.questDoneNotice ?? false };
  // 游戏每 10 分钟结算一次感情，临时配对至少要撑过一次结算；2 分钟太短，
  // 服务端换房后扩展会提前放弃，随后又把两人搬回宿舍，造成来回切换。
  const pairGraceMs = 12 * 60000;
  const pairRetryMs = 30 * 60000;
  // 配对失败后两人也暂停同样长的时间，避免换个人重新配对、继续来回搬宿舍。
  const pairPauseMs = 30 * 60000;
  const evictGuardMs = 2 * 60000;
  // 同一居民短时间被反复放回宿舍时，调出几次后先停手，避免和游戏来回拉扯。
  const evictRepeatWindowMs = 2 * 60 * 60000;
  const evictHoldMs = 2 * 60 * 60000;
  const evictRepeatLimit = 3;
  // 刚被扩展搬动过的居民先让服务端结算一轮，避免同一轮或下一次快速检查
  // 立刻又把他搬到别处（例如刚配对就被“等级调整”调到另一个岗位）。
  const moveCooldownMs = 60 * 1000;
  // 待产父母离开宿舍去工作只尝试一次：若服务端又把他放回宿舍，就等出生，
  // 不再反复调出，避免“宿舍 ↔ 岗位”来回切。
  const pendingWorkLeadMs = 10 * 60000;
  const pendingWorkRememberMs = 4 * 60 * 60000;
  // 低进度配对/未配对候选居民调出宿舍后，在这段时间内不重聚、不再被配对拉回。
  // 若服务端仍把他们放回宿舍，也保持原样不再调出，避免形成来回切。
  const dormWorkHoldMs = 12 * 60 * 60000;
  // 家庭冷却中的居民调出宿舍后，如果服务端又把人放回宿舍，
  // 先等 30 分钟再尝试，避免每 30 秒“调出 → 放回”来回切。
  const cooldownWorkHoldMs = 30 * 60000;
  // 大门值守：调去大门后若被服务端/手动移出，短时间内不再把同一人放回，
  // 优先换下一个休息区居民；没有合适人选就留空，避免“调进 → 移出 → 再调进”。
  const gateHoldMs = 12 * 60 * 60000;
  // 已有感情的两人被服务端分开后，最多每 10 分钟尝试恢复一次同房，
  // 给服务端感情结算留出时间，避免每 30 秒搬一次。
  const reuniteCooldownMs = 10 * 60000;
  // 事件会临时打乱居民站位；无事件时持续记录全员岗位，事件结束后先按事件前
  // 的完整分配归岗，再恢复大门、生产等日常调度。关闭自动救援时不沿用旧归岗任务。
  task.incidentBaseline = rescueEnabled ? previous?.incidentBaseline ?? null : null;
  task.incidentRestore = rescueEnabled ? previous?.incidentRestore ?? null : null;
  task.incidentRestoreTries = rescueEnabled ? previous?.incidentRestoreTries ?? 0 : 0;
  task.incidentSnapshot = previous?.incidentSnapshot ?? null;
  task.incidentRescues = previous?.incidentRescues ?? {};
  task.populationOptions = populationOptions;
  task.populationIdleSince = {};
  task.populationPending = previous?.populationPending ?? [];
  task.populationLastDismissAt = previous?.populationLastDismissAt ?? null;
  const populationWaitMs = 10 * 60000;
  globalThis.__fengbaoShelterAuto = task;
  // 日志直接写入扩展本地存储（注入脚本与 content script 同处扩展隔离环境），
  // 不依赖页面是否刷新过；仍然加载了日志桥接脚本时只在拿不到存储 API 时回退。
  const logStorage = globalThis.chrome?.storage?.local;
  // 扩展存储只保留最近一段：历史无限增长会让托管、后台和面板越来越卡；
  // 本地日志文件由 host 另行追加，不受这里的上限影响。
  const logLimit = 2000;
  let logBuffer = [];
  let logTimer = 0;
  let logWrite = Promise.resolve();
  let logGeneration = 0;
  const flushLogs = () => {
    logTimer = 0;
    if (!logBuffer.length || !logStorage) return;
    const batch = logBuffer;
    const generation = logGeneration;
    logBuffer = [];
    logWrite = logWrite.then(async () => {
      const { shelterLogs = [] } = await logStorage.get('shelterLogs');
      if (generation !== logGeneration) return;
      await logStorage.set({ shelterLogs: shelterLogs.concat(batch).slice(-logLimit) });
    }).catch(() => {});
  };
  task.clearLogs = async () => {
    logGeneration++;
    clearTimeout(logTimer);
    logTimer = 0;
    logBuffer = [];
    task.logs = [];
    logWrite = logWrite.then(() => logStorage?.remove('shelterLogs')).catch(() => {});
    await logWrite;
  };
  const log = message => {
    const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${message}`;
    task.logs.push(line);
    if (task.logs.length > 2000) task.logs.shift();
    task.message = message;
    if (logStorage) {
      logBuffer.push(line);
      if (!logTimer) logTimer = setTimeout(flushLogs, 400);
    } else {
      // 兼容无法访问存储 API 的注入环境：交给页面里的日志桥接脚本。
      try { globalThis.window?.postMessage({ src: 'fengbao-shelter-log', type: 'log', line }, globalThis.location?.origin ?? '*'); } catch {}
    }
  };
  // 目标进度同时写入扩展存储；注入环境拿不到 storage API 时交给日志桥接保存。
  const saveTargetProgress = async progress => {
    if (!progress) return;
    let saved = false;
    if (logStorage) {
      try { await logStorage.set({ shelterTargetProgress: progress }); saved = true; } catch {}
    }
    if (!saved) {
      try { globalThis.window?.postMessage({ src: 'fengbao-shelter-log', type: 'target-progress', progress }, globalThis.location?.origin ?? '*'); } catch {}
    }
  };
  // “暂无空位、原地等待”这类状态每 30 秒都会重复出现；按居民节流，
  // 避免上百人每人每轮写一行，把日志撑到几万行后拖慢存储和面板。
  const quietLogAt = new Map();
  const logQuiet = (key, message, intervalMs = 30 * 60000) => {
    const now = Date.now();
    if (now - (quietLogAt.get(key) ?? 0) < intervalMs) return;
    quietLogAt.set(key, now);
    log(message);
  };
  const stopped = () => task.stopRequested;
  const fatal = message => Object.assign(new Error(message), { fatal: true });
  const stopError = () => Object.assign(new Error('托管已停止'), { stopped: true });
  const wait = ms => new Promise(resolve => { task.wake = resolve; task.timer = setTimeout(resolve, ms); });
  let view;
  // 00:00–07:59 掠夺者不推进。夜间大门事件仍保留在服务器数据里，
  // 但它不阻塞生产；白天恢复为必须优先处理的事故。
  function frozenDoorRaiders(room) {
    return Boolean(room?.type === 'door' && room.incident?.kind === 'raiders' && !workforceDoorGuardRequired(view));
  }
  function blockingIncident(room) {
    return Boolean(room?.incident && !frozenDoorRaiders(room));
  }
  function incidentRecordIsDoorRescue(entry) {
    if (entry?.kind !== 'rescue') return false;
    if (entry.incidentRoomType === 'door' && entry.incidentKind === 'raiders') return true;
    const roomId = entry.incidentRoomId ?? entry.expectedRoomId;
    const room = view.state.rooms.find(item => item.id === roomId);
    return room?.type === 'door' && room.incident?.kind === 'raiders';
  }
  function incidentRecordTarget(entry) {
    const roomId = entry.incidentRoomId ?? entry.expectedRoomId;
    const room = view.state.rooms.find(item => item.id === roomId);
    return room?.incident && (!entry.incidentKind || room.incident.kind === entry.incidentKind) &&
      (!entry.incidentKey || incidentKey(room) === entry.incidentKey) ? room : null;
  }
  function rememberIncidentTarget(entry, target) {
    entry.incidentKey = incidentKey(target);
    entry.incidentRoomId = target.id;
    entry.incidentKind = target.incident.kind;
    entry.incidentRoomType = target.type;
  }
  function deferredIncidentIds() {
    return new Set((task.incidentSnapshot ?? [])
      .filter(entry => entry.status === 'deferred')
      .map(entry => entry.residentId));
  }
  function incidentsBlockAutomation() {
    return Boolean(task.incidentSnapshot?.some(entry => entry.status === 'waiting')) ||
      view.state.rooms.some(blockingIncident);
  }
  function compactIncidentSnapshot() {
    if (!task.incidentSnapshot) return;
    task.incidentSnapshot = task.incidentSnapshot.filter(entry => entry.status === 'waiting' || entry.status === 'deferred');
    if (!task.incidentSnapshot.length) task.incidentSnapshot = null;
  }
  // 无事件时持续记录最新站位。发现阻塞事件时把它冻结为事件前分配，事件结束后
  // 由 restoreIncidentPositions 恢复；游戏把救援者放回休息区也不会丢掉原岗位。
  function rememberIncidentBaseline() {
    if (!rescueEnabled) return;
    if (!task.incidentRestore && view.state.rooms.some(blockingIncident)) {
      if (task.incidentBaseline) {
        task.incidentRestore = task.incidentBaseline.map(item => ({ ...item }));
        task.incidentRestoreTries = 0;
        log('事件开始：已记录事件前站位，结束后先恢复站位再继续调度。');
      } else {
        logQuiet('incident:no-baseline', '发现事件时没有事件前站位记录（托管在事件期间开启），本次结束后按救援记录归岗。', 60 * 60000);
      }
      return;
    }
    if (!task.incidentRestore) {
      task.incidentBaseline = view.state.residents.map(resident => ({ residentId: resident.id, roomId: resident.roomId }));
    }
  }
  function assertView(data) {
    if (!Array.isArray(data?.state?.residents) || !Array.isArray(data.state.rooms) ||
        !Array.isArray(data.state.births) || !Array.isArray(data.state.explorers) || !Number.isFinite(data.serverTime)) {
      throw fatal('避难所数据格式已变化');
    }
  }
  // since 是本次事件的发生时间；hp、ticks、moves 的变化不代表出现了新事件。
  const incidentKey = room => room?.incident && JSON.stringify([room.id, room.incident.kind, room.incident.since]);
  // 网络超时、服务端 5xx 和未确认结果都只算本轮失败：同一批操作复用同一个幂等键重试，
  // 三次仍失败就跳过本轮，托管继续运行，不再因为一次 signal timed out 整体停止。
  async function read() {
    let last;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (stopped()) throw stopError();
      try {
        const response = await fetch('/api/shelter', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000) });
        if (response.redirected || response.status === 401 || response.status === 403) throw fatal('登录已失效');
        if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}）`);
        const data = await response.json().catch(() => { throw new Error('读取失败（返回内容无法解析）'); });
        assertView(data);
        if (data.switches?.frozen) throw new Error('避难所正在维护，稍后重试');
        view = data;
        rememberIncidentBaseline();
        if (populationOptions.enabled) observePopulationIdle();
        return;
      } catch (error) {
        if (error.fatal) throw error;
        last = error;
        if (attempt < 3) await wait(2000 * attempt);
      }
    }
    throw last;
  }
  async function act(action, mode = '') {
    if (action.type === 'rush') throw new Error('已禁用星核汽水加速');
    if (stopped()) return false;
    if (['assign', 'equip', 'rename_resident', 'dismiss', 'quest_start', 'rescue_incident'].includes(action.type)) {
      const expectedIncident = incidentKey(view.state.rooms.find(room => room.id === action.roomId));
      const expected = view.state.residents.find(item => item.id === action.residentId);
      const expectedRoom = expected?.roomId;
      const expectedGear = expected ? JSON.stringify([expected.stats, expected.weaponId, expected.outfitId]) : '';
      const expectedIdentity = expected ? JSON.stringify([expected.name, expected.stats]) : '';
      const itemOwner = action.type === 'equip' ? view.state.residents.find(item =>
        item[action.slot === 'weapon' ? 'weaponId' : 'outfitId'] === action.itemId)?.id : undefined;
      await read();
      if (stopped()) return false;
      const resident = view.state.residents.find(item => item.id === action.residentId);
      const coordination = shelterCoordination(view);
      if (mode === 'population' || mode === 'population-newcomer') {
        const allowed = mode === 'population' ? populationCandidate()?.id === action.residentId :
          task.populationPending.includes(action.residentId) && populationCanDismiss() &&
          populationIdle(resident) && populationTotal(resident) < populationOptions.total && populationWithoutGear(resident);
        if (!allowed || JSON.stringify([resident?.stats, resident?.weaponId, resident?.outfitId]) !== expectedGear) {
          log('人口优化：居民、装备、待岗人数或补员条件已变化，取消本次遣散。');
          return false;
        }
      }
      if (mode === 'population-work' && (!populationIdle(resident) || populationTotal(resident) < populationOptions.total || incidentsBlockAutomation())) return false;
      if (mode === 'rescue' || action.type === 'rescue_incident') {
        const target = view.state.rooms.find(room => room.id === action.roomId);
        if (!blockingIncident(target) || incidentKey(target) !== expectedIncident) return false;
      }
      if (mode === 'pair' && action.type === 'assign') {
        const entry = task.parentReturns.find(item => item.residentId === action.residentId && item.status === 'waiting');
        const members = task.parentReturns.filter(item => entry?.groupKey && item.groupKey === entry.groupKey && item.status === 'waiting')
          .map(item => view.state.residents.find(resident => resident.id === item.residentId));
        if (members.length !== 2 || !birthPairAllowed(...members) || !safeBirthRoom(action.roomId, members)) {
          log('自动生育：配对属性或宿舍同住居民已变化，不满足每项基础属性合计至少 19，暂停本轮调入。');
          return false;
        }
      }
      if (resident) {
        if (action.type === 'assign' && resident.roomId === action.roomId) return true;
        const source = view.state.rooms.find(room => room.id === resident.roomId);
        const record = mode === 'return' ? coordination.entries.find(entry => entry.residentId === resident.id) : null;
        // 事件归岗是在事件结束后把全员送回事件前岗位，需绕过“有归岗记录”的保护；
        // 目标容量由 restoreIncidentPositions 预先检查，这里不能重复把本人算作占位。
        const restoringIncident = mode === 'incident-restore' &&
          (task.incidentRestore?.some(entry => entry.residentId === resident.id) ||
            task.incidentSnapshot?.some(entry => entry.residentId === resident.id && entry.status === 'waiting'));
        // 服装制作开始后不再要求居民留在房间；允许同一居民从制作中的服装工坊
        // 转去另一间服装工坊开工。其他生产/制作房间仍然禁止在制作期间调人。
        const craftShuttle = mode === 'craft' && action.type === 'assign' && source?.type === 'tailor' &&
          !source.incident && view.state.rooms.find(room => room.id === action.roomId)?.type === 'tailor';
        const sourceBlocked = Boolean((source?.craft && !craftShuttle) ||
          source?.incident && !(mode === 'return' && frozenDoorRaiders(source)));
        const reason = resident.deadAt !== null || resident.away !== null || resident.adultAt > view.serverTime ? '居民当前无法调动' :
          coordination.quests.has(resident.id) ? '本周任务小队' :
          coordination.protectedIds.has(resident.id) && !record && !restoringIncident && !(mode === 'pair' && task.parentReturns.some(entry => entry.residentId === resident.id && entry.expectedRoomId === resident.roomId)) && !(mode === 'rescue' && task.incidentSnapshot?.some(entry => entry.residentId === resident.id && entry.expectedRoomId === resident.roomId)) ? '有配对或救援归岗记录' :
          sourceBlocked ? '来源房间正在处理事故或制作' :
          resident.roomId !== expectedRoom ? '居民岗位已变化' :
          ['rename_resident', 'dismiss'].includes(action.type) && JSON.stringify([resident.name, resident.stats]) !== expectedIdentity ? '居民姓名或属性已变化' :
          action.type === 'equip' && JSON.stringify([resident.stats, resident.weaponId, resident.outfitId]) !== expectedGear ? '居民属性或装备已变化' : '';
        if (reason) { if (record) record.note = reason; logQuiet('guard:' + resident.id, '跳过「' + resident.name + '」：' + reason + '。'); return false; }
        if (action.type === 'assign' && action.roomId !== null) {
          const target = view.state.rooms.find(room => room.id === action.roomId);
          const reasons = workforceRoomReasons(target, view.serverTime).filter(reason => mode !== 'rescue' || reason !== '事故处理中');
          if (target?.craft) reasons.push('正在制作');
          if (mode !== 'rescue' && mode !== 'incident-restore' && target && shelterRoomOccupancy(view, target.id, [], resident.id) >= target.width * 2) reasons.push('满员或已预留归岗名额');
          if (record && target && (record.originalType !== target.type ||
              target.type === 'training' && record.originalTrainStat !== target.trainStat)) reasons.push('原房间用途已变化');
          if (reasons.length) {
            if (record) record.note = reasons.join('、');
            logQuiet('target:' + resident.id, '跳过「' + resident.name + '」：目标房间' + reasons.join('、') + '。'); return false;
          }
        }
      } else if (action.residentId != null) return false;
      if (action.type === 'quest_start') {
        const team = action.team ?? action.residentIds ?? [];
        const runs = view.state.quests ?? [];
        if (runs.filter(run => run.status === 'active' || run.status === 'returning').length >= 2 ||
            runs.some(run => run.questId === action.questId) ||
            [...(view.state.weekly?.completed ?? []), ...task.questDone].includes(action.questId) ||
            incidentsBlockAutomation()) return false;
        if (!Array.isArray(team) || team.length !== 3 || new Set(team).size !== 3 || team.some(id => {
          const resident = view.state.residents.find(item => item.id === id);
          return !resident || !questReady(resident) || coordination.protectedIds.has(id) ||
            (resident.roomId !== null && (!task.questEnabled || !questScrapResidents().some(item => item.id === id)));
        })) return false;
      }
      if (action.type === 'equip') {
        const field = action.slot === 'weapon' ? 'weaponId' : 'outfitId';
        const owner = view.state.residents.find(item => item[field] === action.itemId);
        const source = view.state.rooms.find(room => room.id === owner?.roomId);
        if (owner?.id !== itemOwner || owner && (owner.away !== null || owner.deadAt !== null ||
            coordination.protectedIds.has(owner.id) || blockingIncident(source) || source?.craft)) return false;
      }
    }
    if (stopped()) return false;
    // 与游戏页面的重试逻辑一致：同一次操作始终复用同一个幂等键，超时后重试不会重复执行。
    const idempotencyKey = crypto.randomUUID();
    let last;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (stopped()) return false;
      try {
        const response = await fetch('/api/shelter/action', {
          method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(20000),
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, idempotencyKey })
        });
        if (response.redirected || response.status === 401 || response.status === 403) throw fatal('登录已失效');
        if (response.status >= 500) throw new Error(`操作未确认（HTTP ${response.status}）`);
        const data = await response.json().catch(() => ({}));
        // 未攒满产出是正常等待状态，只跳过本次收取，不中断托管。
        if (action.type === 'collect_all' && response.status < 500 && data.code !== 'retry' &&
            /(?:没有|暂无|尚无).{0,12}可收取|(?:还没|尚未|未|没有).{0,6}攒满/.test(data.error || '')) {
          log(`全部收取：${data.error}`);
          await read();
          return false;
        }
        if (!response.ok || data.code === 'retry') {
          const message = data.error || '操作结果未确认';
          // 服务端可能在两次读取之间被游戏自动安排占满房间。这种业务错误重试也不会成功，
          // 只跳过本次调动并刷新状态，不能因为一次“房间满了”中断整轮托管。
          if (action.type === 'assign' && /房间(?:已)?满|没有空位|位置(?:已)?满/.test(message)) {
            log(`房间已满：${message}（居民 #${action.residentId} → 房间 ${action.roomId}），跳过本次调动。`);
            try { await read(); } catch (error) { if (error.fatal || error.stopped) throw error; }
            return false;
          }
          const error = new Error(message);
          // 明确的 4xx 业务错误重试也不会成功；其余（5xx、retry）按未知结果重试。
          error.permanent = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429 && data.code !== 'retry';
          throw error;
        }
        assertView(data.view);
        view = data.view;
        rememberIncidentBaseline();
        if (mode === 'population' || mode === 'population-newcomer') {
          if (view.state.residents.some(item => item.id === action.residentId)) throw fatal('人口优化：遣散结果未确认，已停止托管，请检查居民名单');
          task.populationLastDismissAt = view.serverTime;
        }
        // 收取房间数量直接使用游戏返回的结果说明。
        if (action.type === 'collect_all' && data.result?.message) log(`全部收取：${data.result.message}`);
        // 记录扩展主动搬动居民的时间；后续阶段和下一次快速检查据此让服务端先结算。
        if (action.type === 'assign' && action.residentId != null) {
          task.recentMoves[action.residentId] = view.serverTime;
          for (const entry of task.parentReturns) if (entry.residentId === action.residentId && entry.status === 'waiting') entry.expectedRoomId = action.roomId;
        }
        if (populationOptions.enabled) observePopulationIdle();
        return true;
      } catch (error) {
        // 永久遣散不沿用一般动作的自动重试，结果不明时停止，避免换人继续清理。
        if (mode === 'population' || mode === 'population-newcomer') throw fatal(`人口优化：${error.message}；已停止托管，请核对本次遣散结果`);
        if (error.fatal || error.permanent) throw error;
        last = error;
        if (attempt < 3) await wait(2000 * attempt);
      }
    }
    throw new Error(`${last?.message ?? '操作失败'}（已重试 3 次，跳过本轮）`);
  }
  // 出发日志记录原始携带数量，不能使用途中消耗后的 stimpaks 值冒充原配置。
  function rememberReturn(resident, records, kind) {
    if (records.some(entry => entry.residentId === resident.id && entry.status === 'waiting')) return;
    const room = view.state.rooms.find(item => item.id === resident.roomId);
    records.push({ residentId: resident.id, name: resident.name, kind, status: 'waiting',
      originalRoomId: resident.roomId, originalType: room?.type ?? null, originalTrainStat: room?.trainStat ?? null,
      expectedRoomId: resident.roomId, baselineCooldown: resident.familyCooldownUntil ?? 0, startedAt: view.serverTime });
  }
  async function restoreRecords(records, ready) {
    for (const entry of records.filter(item => item.status === 'waiting')) {
      await read();
      if (stopped()) return;
      const resident = view.state.residents.find(item => item.id === entry.residentId);
      if (!resident || resident.deadAt !== null || resident.away !== null) {
        entry.status = 'released';
        if (entry.kind === 'birth') {
          for (const other of records) if (other.groupKey === entry.groupKey && other.startedAt === entry.startedAt) other.returnReady = true;
        }
        log('归岗记录：' + entry.name + ' 状态或位置已变化，取消自动归岗。');
        continue;
      }
      const atOriginal = resident.roomId === entry.originalRoomId;
      // 事件救援结束后游戏可能先把救援者送回门外休息区；记录仍可把他送回原岗位。
      // 只有被移到其他实际房间时才视为手动改岗并取消记录。
      const rescueFallback = entry.kind === 'rescue' &&
        (resident.roomId === null || resident.roomId === entry.expectedRoomId || atOriginal);
      if (!rescueFallback && resident.roomId !== entry.expectedRoomId) {
        entry.status = 'released';
        if (entry.kind === 'birth') {
          for (const other of records) if (other.groupKey === entry.groupKey && other.startedAt === entry.startedAt) other.returnReady = true;
        }
        log('归岗记录：' + entry.name + ' 状态或位置已变化，取消自动归岗。');
        continue;
      }
      if (!ready(entry)) continue;
      if (atOriginal) {
        entry.status = 'returned'; entry.note = '';
        task.recentMoves[resident.id] = view.serverTime;
        continue;
      }
      try {
        if (!await act({ type: 'assign', residentId: resident.id, roomId: entry.originalRoomId },
          entry.kind === 'rescue' ? 'incident-restore' : 'return')) continue;
      } catch (error) {
        entry.note = error.message;
        if (error.fatal || error.stopped || !error.permanent) throw error;
        logQuiet('return:' + entry.residentId, '恢复原岗等待：' + entry.name + '，' + error.message + '。');
        continue;
      }
      entry.expectedRoomId = entry.originalRoomId;
      entry.status = 'returned';
      entry.note = '';
      log('恢复原岗：' + entry.name + ' → ' + (entry.originalRoomId === null ? '门外' : '房间 ' + entry.originalRoomId) + '。');
    }
  }
  async function returnPairedParents() {
    await restoreRecords(task.parentReturns, entry => {
      const group = task.parentReturns.filter(item => item.startedAt === entry.startedAt && item.groupKey === entry.groupKey);
      const ready = entry.returnReady || task.returnRequested || group.some(item => item.status === 'released') ||
        group.length > 0 && (view.serverTime - entry.startedAt > pairGraceMs &&
          !task.autoPairs.some(pair => pair.ids.includes(entry.residentId)) || group.every(item => {
        const resident = view.state.residents.find(person => person.id === item.residentId);
        return resident && (resident.familyCooldownUntil > Math.max(item.baselineCooldown, item.startedAt) ||
          view.state.births.some(birth => birth.parents.includes(resident.id)));
      }));
      if (ready) for (const member of group) member.returnReady = true;
      return ready;
    });
    const completedIds = new Set(task.parentReturns.filter(entry => entry.status !== 'waiting').map(entry => entry.residentId));
    task.autoPairs = task.autoPairs.filter(pair => !pair.ids.some(id => completedIds.has(id)));
    task.parentReturns = task.parentReturns.filter(entry => entry.status === 'waiting');
  }
  async function returnNightDoorRescuers() {
    const records = (task.incidentSnapshot ?? [])
      .filter(entry => entry.status === 'waiting' && incidentRecordIsDoorRescue(entry));
    for (const entry of records) {
      if (stopped()) return;
      await read();
      if (stopped()) return;
      const resident = view.state.residents.find(item => item.id === entry.residentId);
      const sourceRoomId = entry.incidentRoomId ?? entry.expectedRoomId;
      const source = view.state.rooms.find(item => item.id === sourceRoomId);
      if (source?.incident && !entry.incidentKey) rememberIncidentTarget(entry, source);
      if (!resident || resident.deadAt !== null || resident.away !== null) {
        entry.status = 'released';
        log('夜间大门救援：' + entry.name + ' 已失效或外出，取消 08:00 重救。');
        continue;
      }
      if (resident.roomId !== sourceRoomId) {
        if (resident.roomId === entry.originalRoomId) {
          entry.expectedRoomId = entry.originalRoomId;
          entry.status = incidentRecordTarget(entry) ? 'deferred' : 'released';
          entry.note = '';
          log('夜间大门救援：' + entry.name + ' 已回到原岗，' + (entry.status === 'deferred' ? '08:00 重救。' : '事件已结束。'));
        } else {
          entry.status = 'released';
          log('夜间大门救援：' + entry.name + ' 已手动改岗，取消 08:00 重救。');
        }
        continue;
      }
      let returned = false;
      try {
        returned = await act({ type: 'assign', residentId: resident.id, roomId: entry.originalRoomId }, 'return');
      } catch (error) {
        entry.note = error.message;
        if (error.fatal || error.stopped || !error.permanent) throw error;
        returned = false;
      }
      const targetAfter = incidentRecordTarget(entry);
      if (!returned) {
        entry.status = targetAfter ? 'deferred' : 'released';
        entry.expectedRoomId = resident.roomId;
        logQuiet('night-return:' + entry.residentId,
          '夜间大门救援：' + entry.name + ' 暂未回岗，' + (targetAfter ? '08:00 由本人重救。' : '事件已结束，取消重救。'));
        continue;
      }
      entry.expectedRoomId = entry.originalRoomId;
      task.recentMoves[resident.id] = view.serverTime;
      if (targetAfter) {
        entry.status = 'deferred';
        entry.note = '';
        log('夜间大门救援：' + entry.name + ' 已回原岗生产，08:00 由本人重救。');
      } else {
        entry.status = 'released';
        entry.note = '';
        log('夜间大门救援：' + entry.name + ' 已回原岗，事件已结束。');
      }
    }
    compactIncidentSnapshot();
  }

  async function resumeDeferredDoorRescuers() {
    const records = (task.incidentSnapshot ?? [])
      .filter(entry => entry.status === 'deferred' && incidentRecordIsDoorRescue(entry));
    for (const entry of records) {
      if (stopped()) return;
      await read();
      if (stopped()) return;
      const resident = view.state.residents.find(item => item.id === entry.residentId);
      const target = incidentRecordTarget(entry);
      if (!resident || resident.deadAt !== null || resident.away !== null) {
        entry.status = 'released';
        log('大门重救：' + entry.name + ' 已失效或外出，取消 08:00 重救。');
        continue;
      }
      if (!target) {
        entry.status = 'released';
        log('大门重救：' + entry.name + ' 对应事件已结束，取消重救。');
        continue;
      }
      if (resident.roomId !== entry.originalRoomId && resident.roomId !== target.id) {
        entry.status = 'released';
        log('大门重救：' + entry.name + ' 已手动改岗，取消重救。');
        continue;
      }
      rememberIncidentTarget(entry, target);
      entry.status = 'waiting';
      // act() 的救援保护例外要求记录仍指向居民当前岗位。居民已回原岗时，
      // 必须先认可原岗，派往事件房成功后再把预期岗位切回事件房。
      entry.expectedRoomId = resident.roomId;
      if (resident.roomId === target.id) {
        log('大门重救：' + entry.name + ' 仍在事件房，已恢复专人救援。');
        continue;
      }
      if (!await act({ type: 'assign', residentId: resident.id, roomId: target.id }, 'rescue')) {
        entry.status = 'deferred';
        entry.expectedRoomId = resident.roomId;
        logQuiet('door-resume:' + entry.residentId, '大门重救：' + entry.name + ' 暂未出发，下一轮继续。');
        continue;
      }
      entry.expectedRoomId = target.id;
      rememberIncidentTarget(entry, target);
      entry.note = '';
      log('大门重救：' + entry.name + ' → 08:00 事件房间 ' + target.id + '。');
    }
    compactIncidentSnapshot();
  }

  async function restoreFinishedIncidentRecords() {
    const records = (task.incidentSnapshot ?? []).filter(entry => entry.status === 'waiting');
    for (const entry of records) {
      if (stopped()) return;
      await read();
      if (stopped()) return;
      if (view.state.rooms.some(blockingIncident)) return;
      if (incidentRecordTarget(entry)) continue;
      await restoreRecords([entry], () => !view.state.rooms.some(blockingIncident));
    }
    compactIncidentSnapshot();
  }

  async function handleIncidents() {
    if (!rescueEnabled) return;
    // 事件结束后先按事件前站位归岗，本次不再继续救援或调度；归岗未完成时
    // 同样返回 true，避免大门补位在归岗前把休息区里的救援者抢走。
    if (!view.state.rooms.some(blockingIncident) && task.incidentRestore) {
      const result = await restoreIncidentPositions();
      if (stopped() || result.attempted || result.retry || result.incomplete) return true;
    }
    if (!workforceDoorGuardRequired(view)) await returnNightDoorRescuers();
    else await resumeDeferredDoorRescuers();
    if (stopped()) return;
    const beforeReturns = new Map(view.state.residents.map(resident => [resident.id, resident.roomId]));
    await restoreFinishedIncidentRecords();
    if (stopped()) return;
    // 普通事件归岗发生实际调动时，本次仅完成归岗；午夜回岗仍允许继续生产。
    if (view.state.residents.some(resident => beforeReturns.has(resident.id) && beforeReturns.get(resident.id) !== resident.roomId)) return true;
    const activeKeys = new Set(view.state.rooms.filter(room => room.incident).map(incidentKey));
    task.incidentRescues = Object.fromEntries(Object.entries(task.incidentRescues).filter(([key]) => activeKeys.has(key)));
    const incidents = view.state.rooms.filter(blockingIncident);
    const deferredIds = deferredIncidentIds();
    for (const original of incidents) {
      if (stopped()) return;
      const key = incidentKey(original);
      let rescue = task.incidentRescues[key];
      if (!rescue || rescue.mode !== rescueMode) rescue = task.incidentRescues[key] = { mode: rescueMode, count: 0, complete: false };
      if (rescue.complete) continue;
      if (rescueMode === 'auto') {
        while (rescue.count < rescueCount) {
          await read();
          if (stopped()) return;
          const target = view.state.rooms.find(room => room.id === original.id);
          if (!blockingIncident(target) || incidentKey(target) !== key) break;
          const before = view.state.residents.map(resident => ({ ...resident }));
          const occupied = before.filter(resident => resident.roomId === target.id && resident.deadAt === null).length;
          if (!rescue.count && occupied > target.width * 2 + rescueCount * 3) {
            rescue.complete = true;
            log('事件救援：房间人数超过本次救援预期，停止继续呼叫。');
            break;
          }
          if (!await act({ type: 'rescue_incident', roomId: target.id })) break;
          rescue.count++;
          const moved = before.filter(resident => resident.roomId !== target.id &&
            view.state.residents.find(item => item.id === resident.id)?.roomId === target.id);
          for (const resident of moved) {
            task.incidentSnapshot ??= [];
            rememberReturn(resident, task.incidentSnapshot, 'rescue');
            const entry = task.incidentSnapshot.find(item => item.residentId === resident.id && item.status === 'waiting');
            entry.expectedRoomId = target.id;
            rememberIncidentTarget(entry, target);
          }
          log('事件救援：房间 ' + target.id + '，已执行 ' + rescue.count + '/' + rescueCount + ' 次。');
          if (moved.length > 3 || moved.length === 0) {
            rescue.complete = true;
            log(moved.length > 3 ? '事件救援：单次新增超过 3 人，停止继续呼叫。' : '事件救援：本次没有新增救援者，停止继续呼叫。');
            break;
          }
        }
        if (rescue.count >= rescueCount) rescue.complete = true;
        continue;
      }
      const useDiner = ['fire', 'leak'].includes(original.incident.kind);
      const firstScrap = view.state.rooms.filter(room => room.type === 'scrap').sort((a, b) => a.floor - b.floor || a.col - b.col || a.id - b.id)[0];
      const sourceTypes = useDiner ? ['diner'] : ['door', 'power', 'armory'];
      const candidates = view.state.residents.filter(resident => {
        const source = view.state.rooms.find(room => room.id === resident.roomId);
        return source && (sourceTypes.includes(source.type) || useDiner && source.id === firstScrap?.id) &&
          !source.craft && !workforceRoomReasons(source, view.serverTime).length &&
          resident.deadAt === null && resident.away === null && resident.adultAt <= view.serverTime &&
          !deferredIds.has(resident.id) && !protectedResident(resident, true);
      });
      let complete = true;
      for (const member of candidates) {
        await read();
        if (stopped()) return;
        const target = view.state.rooms.find(room => room.id === original.id);
        if (!blockingIncident(target) || incidentKey(target) !== key) { complete = false; break; }
        const resident = view.state.residents.find(item => item.id === member.id);
        if (!resident || deferredIds.has(resident.id) || protectedResident(resident, true)) continue;
        task.incidentSnapshot ??= [];
        rememberReturn(resident, task.incidentSnapshot, 'rescue');
        const record = task.incidentSnapshot.find(entry => entry.residentId === resident.id && entry.status === 'waiting');
        if (!await act({ type: 'assign', residentId: resident.id, roomId: target.id }, 'rescue')) {
          record.status = 'released';
          complete = false;
          continue;
        }
        record.expectedRoomId = target.id;
        rememberIncidentTarget(record, target);
        rescue.count++;
        log('专人专救：' + resident.name + ' → 事件房间 ' + target.id + '。');
      }
      rescue.complete = complete && rescue.count > 0;
    }
    compactIncidentSnapshot();
  }

  function deployment(explorer) {
    if (!task.deployments[explorer.id]) {
      const departure = explorer.log.find(entry => entry.at === explorer.startedAt);
      const count = departure?.text.match(/带着\s*(\d+)\s*支治疗针/);
      if (!count) throw new Error(`探险 ${explorer.id} 缺少出发治疗针记录，无法原样再次派出`);
      task.deployments[explorer.id] = { residentId: explorer.residentId, tier: explorer.tier, abyss: explorer.abyss, stimpaks: Number(count[1]) };
    }
    return task.deployments[explorer.id];
  }
  function adultsIn(roomId) {
    return view.state.residents.filter(resident => resident.roomId === roomId && resident.deadAt === null &&
      resident.away === null && resident.adultAt <= view.serverTime);
  }
  // 本周任务小队成员（进行中、返程中、失败待领取）：领取前留在任务里，不参与其他居民调度。
  function questTeamIds() {
    const runs = Array.isArray(view.state.quests) ? view.state.quests : [];
    return new Set(runs.flatMap(run => Array.isArray(run.team) ? run.team : []));
  }
  function hasPartner(resident, list) {
    return Boolean(resident.romance) && list.some(item => item.id === resident.romance.partnerId);
  }
  function pairsInRoom(roomId) {
    const list = adultsIn(roomId);
    return list.filter(resident => hasPartner(resident, list)).length / 2;
  }
  function related(left, right) {
    return left.parents.includes(right.id) || right.parents.includes(left.id) ||
      left.parents.some(id => right.parents.includes(id));
  }
  // 用户指定的自动生育门槛：每项基础属性至少 9＋10，不计装备。
  function birthCandidate(resident) {
    return Boolean(resident) && keys.every(key =>
      Number.isInteger(resident.stats?.[key]) && resident.stats[key] >= 9 && resident.stats[key] <= 10);
  }
  function birthPairAllowed(left, right) {
    return birthCandidate(left) && birthCandidate(right) && left.id !== right.id &&
      Array.isArray(left.parents) && Array.isArray(right.parents) && !related(left, right) &&
      keys.every(key => left.stats[key] + right.stats[key] >= 19);
  }
  function safeBirthNeighbors(left, right) {
    // 跨组亲属不会建立感情；只有可能互相配对的非亲属才需要检查属性。
    return Boolean(left && right && Array.isArray(left.parents) && Array.isArray(right.parents)) &&
      (related(left, right) || birthPairAllowed(left, right));
  }
  function birthPartner(resident) {
    if (resident.romance) {
      const partner = view.state.residents.find(item => item.id === resident.romance.partnerId);
      return partner?.romance?.partnerId === resident.id ? partner : null;
    }
    const pair = task.autoPairs.find(pair => pair.ids.includes(resident.id));
    return pair && view.state.residents.find(item => item.id === pair.ids.find(id => id !== resident.id));
  }
  function hasQualifiedBirthPartner(resident) {
    return birthPairAllowed(resident, birthPartner(resident));
  }
  function availableForNewBirth(resident) {
    if (!birthCandidate(resident)) return false;
    const now = view.serverTime;
    const room = view.state.rooms.find(item => item.id === resident.roomId);
    return resident.deadAt === null && resident.away === null && resident.adultAt <= now &&
      room?.type !== 'quarters' && room?.type !== 'door' &&
      !task.pendingDispatch[resident.id] && !questTeamIds().has(resident.id) &&
      !resident.romance && !(resident.familyCooldownUntil > now) && resident.happiness >= 50 &&
      !(task.recentEvictions[resident.id] > now - evictGuardMs) && !pairPaused(resident) &&
      !protectedResident(resident) && !dormWorkHeld(resident) &&
      !task.autoPairs.some(pair => pair.ids.includes(resident.id)) &&
      !view.state.births.some(birth => birth.parents.includes(resident.id)) &&
      // 自动生育的子代成年后仍按原策略训练或工作。
      !(resident.parents.length === 2 && resident.parents.every(id => task.autoParents.includes(id)));
  }
  function selectBirthPairs(candidates, limit) {
    const partners = new Map(candidates.map(left => [left.id, candidates.filter(right =>
      birthPairAllowed(left, right) && pairCooldown(left, right) <= view.serverTime)]));
    const used = new Set(), pairs = [];
    // 优先安排可选伴侣较少的人，避免先把两个全 10 配走，剩下两个全 9 无法配对。
    while (pairs.length < limit) {
      const choices = candidates.filter(left => !used.has(left.id))
        .map(left => ({ left, options: partners.get(left.id).filter(right => !used.has(right.id)) }))
        .filter(item => item.options.length)
        .sort((a, b) => a.options.length - b.options.length || a.left.id - b.left.id);
      if (!choices.length) break;
      const { left, options } = choices[0];
      const right = options.sort((a, b) =>
        partners.get(a.id).filter(item => !used.has(item.id)).length -
        partners.get(b.id).filter(item => !used.has(item.id)).length || a.id - b.id)[0];
      used.add(left.id);
      used.add(right.id);
      pairs.push([left, right]);
    }
    return pairs;
  }
  function safeBirthRoom(roomId, members) {
    const occupants = adultsIn(roomId);
    // 服务端自行建立感情：跨组亲属可同住，其余组合须达标，避免交叉配成 9＋9。
    return occupants.filter(item => !members.some(member => member.id === item.id) && !hasPartner(item, occupants))
      .every(item => members.every(member => safeBirthNeighbors(item, member)));
  }
  // 与配对面板一致：6 人宿舍可以同时容纳两组生育，1 格宿舍只能一组。
  function pairCapacity(room) { return Math.min(2, room.width); }
  // 与居民安排共用成人占位与归岗预留模型，外出成人也保留名额。
  function occupiedBeds(roomId) {
    return shelterRoomOccupancy(view, roomId);
  }
  function pairKey(left, right) {
    return `${Math.min(left.id, right.id)}-${Math.max(left.id, right.id)}`;
  }
  function pairCooldown(left, right) {
    return task.pairAttempts[pairKey(left, right)]?.until ?? 0;
  }
  function pairPaused(resident) {
    return (task.pairFailedUntil[resident.id] ?? 0) > view.serverTime;
  }
  function recentlyMoved(residentId) {
    return (task.recentMoves[residentId] ?? 0) + moveCooldownMs > view.serverTime;
  }
  function dormWorkHeld(resident) {
    return (task.dormWorkHold[resident.id] ?? 0) > view.serverTime;
  }
  function gateHeld(resident) {
    return (task.gateHold[resident.id] ?? 0) > view.serverTime;
  }
  // 正在配对、待产、刚被扩展搬动或刚被服务端反复放回宿舍的居民，
  // 其他岗位/换房流程都不要碰，先把这一轮交给服务端结算。
  // 大门值守居民同样受保护：待产父母回岗、资源补缺等流程不能把他们调出大门。
  function protectedResident(resident, allowGuardRescue = false) {
    if (shelterCoordination(view).protectedIds.has(resident.id) || deferredIncidentIds().has(resident.id)) return true;
    if (task.evictHoldUntil[resident.id] > view.serverTime || recentlyMoved(resident.id)) return true;
    const room = view.state.rooms.find(item => item.id === resident.roomId);
    return !allowGuardRescue && room?.type === 'door' && workforceDoorGuardRequired(view) || blockingIncident(room) || Boolean(room?.craft);
  }
  function protectedIds() {
    const ids = new Set([...shelterCoordination(view).protectedIds, ...deferredIncidentIds(), ...task.autoPairs.flatMap(pair => pair.ids)]);
    for (const birth of view.state.births) {
      for (const id of Array.isArray(birth.parents) ? birth.parents : []) ids.add(id);
    }
    for (const [id, until] of Object.entries(task.evictHoldUntil)) {
      if (until > view.serverTime) ids.add(Number(id));
    }
    for (const [id, at] of Object.entries(task.recentMoves)) {
      if (at + moveCooldownMs > view.serverTime) ids.add(Number(id));
    }
    // 守门居民保持在大门，其他自动调动（资源补缺、造神、等级调整等）不要把他抽走。
    for (const resident of view.state.residents) {
      const room = view.state.rooms.find(item => item.id === resident.roomId);
      if (room?.type === 'door' && workforceDoorGuardRequired(view)) ids.add(resident.id);
    }
    return ids;
  }
  // 清理过期记录，避免托管长时间运行时对象一直变大。
  function prunePairState(now) {
    for (const [id, until] of Object.entries(task.pairFailedUntil)) {
      if (!(until > now)) delete task.pairFailedUntil[id];
    }
    for (const [key, attempt] of Object.entries(task.pairAttempts)) {
      if (!(attempt?.until > now)) delete task.pairAttempts[key];
    }
    for (const [id, at] of Object.entries(task.recentEvictions)) {
      if (!(at + evictGuardMs > now)) delete task.recentEvictions[id];
    }
    for (const [key, at] of Object.entries(task.pairLogAt)) {
      if (!(at + 10 * 60000 > now)) delete task.pairLogAt[key];
    }
    for (const [id, entry] of Object.entries(task.evictCounts)) {
      if (!(entry?.at + evictRepeatWindowMs > now)) delete task.evictCounts[id];
    }
    for (const [id, until] of Object.entries(task.evictHoldUntil)) {
      if (!(until > now)) delete task.evictHoldUntil[id];
    }
    for (const [id, at] of Object.entries(task.recentMoves)) {
      if (!(at + moveCooldownMs > now)) delete task.recentMoves[id];
    }
    for (const [id, until] of Object.entries(task.pendingWorkBlocked)) {
      if (!(until > now)) delete task.pendingWorkBlocked[id];
    }
    for (const [id, until] of Object.entries(task.pendingWorkDone)) {
      if (!(until > now)) delete task.pendingWorkDone[id];
    }
    for (const [id, until] of Object.entries(task.dormWorkHold)) {
      if (!(until > now)) delete task.dormWorkHold[id];
    }
    for (const [id, until] of Object.entries(task.gateHold)) {
      if (!(until > now)) delete task.gateHold[id];
    }
    for (const [key, at] of Object.entries(task.reuniteAt)) {
      if (!(at + reuniteCooldownMs > now)) delete task.reuniteAt[key];
    }
  }
  function freePairSlots(room) {
    const list = adultsIn(room.id);
    // 房内还有未配对的成人时不再安排，避免服务端把新居民和房里的人凑成一对。
    if (list.some(resident => !hasPartner(resident, list))) return 0;
    const freeBeds = room.width * 2 - occupiedBeds(room.id);
    return Math.max(0, Math.min(pairCapacity(room) - pairsInRoom(room.id), Math.floor(freeBeds / 2)));
  }
  // 服务端偶尔会在两次检查之间把刚安排的两人短暂移出宿舍或换房。只要宿舍里
  // 现有居民能组成每项基础属性合计至少 19 的配对，直接登记，避免他们先被
  // 清理流程撤出、又被自动生育拉回，形成每 30 秒一次的来回调动。
  function adoptCoLocatedPairs(pendingParents, questTeams, pairing) {
    const now = view.serverTime;
    const rooms = view.state.rooms.filter(room => room.type === 'quarters' && room.builtAt <= now &&
      room.upgradeAt === null && !room.unpowered && !room.incident);
    for (const room of rooms) {
      if (stopped()) return;
      let capacity = pairCapacity(room) - pairsInRoom(room.id);
      if (capacity <= 0) continue;
      const residents = view.state.residents.filter(resident =>
        resident.roomId === room.id && resident.deadAt === null && resident.away === null &&
        resident.adultAt <= now && !resident.romance && !(resident.familyCooldownUntil > now) &&
        resident.happiness >= 50 && birthCandidate(resident) &&
        !pendingParents.has(resident.id) && !questTeams.has(resident.id) &&
        !task.pendingDispatch[resident.id] && !pairing.has(resident.id) && !pairPaused(resident) &&
        !dormWorkHeld(resident) && !protectedResident(resident))
        .sort((left, right) => left.id - right.id);
      const occupants = adultsIn(room.id);
      const retained = occupants.filter(resident => pairing.has(resident.id) && !hasPartner(resident, occupants));
      capacity = Math.max(0, capacity - Math.ceil(retained.length / 2));
      for (const [left, right] of selectBirthPairs(residents, capacity)) {
        if (!retained.every(member => safeBirthNeighbors(member, left) && safeBirthNeighbors(member, right))) continue;
        retained.push(left, right);
        pairing.add(left.id);
        pairing.add(right.id);
        task.autoPairs.push({ roomId: room.id, ids: [left.id, right.id] });
        if (!task.autoParents.includes(left.id)) task.autoParents.push(left.id);
        if (!task.autoParents.includes(right.id)) task.autoParents.push(right.id);
        capacity--;
        const key = pairKey(left, right);
        if (!task.pairLogAt[key]) {
          task.pairLogAt[key] = now;
          log(`自动生育：${left.name}#${left.id} ＋ ${right.name}#${right.id} 已在${room.floor} 层 ${room.level} 级宿舍（房间 ${room.id}），继续培养感情。`);
        }
      }
    }
  }
  // 与游戏一致：人口 = 存活居民 + 待产，人口上限 = 已建成宿舍的宽度 ×(2+2×等级)，最高 200。
  function populationState() {
    const now = view.serverTime;
    const living = view.state.residents.filter(resident => resident.deadAt === null).length + view.state.births.length;
    const capacity = Math.min(200, view.state.rooms.filter(room => room.type === 'quarters' && room.builtAt <= now)
      .reduce((sum, room) => sum + room.width * (2 + 2 * room.level), 0));
    return { living, capacity, full: living >= capacity };
  }
  function populationTotal(resident) {
    const values = keys.map(key => resident?.stats?.[key]);
    return values.every(value => Number.isInteger(value) && value >= 0 && value <= 10)
      ? values.reduce((sum, value) => sum + value, 0) : NaN;
  }
  function populationIdle(resident) {
    if (!resident || !Number.isFinite(populationTotal(resident))) return false;
    return resident.roomId === null && resident.away === null && resident.deadAt === null &&
      Number.isFinite(resident.adultAt) && resident.adultAt <= view.serverTime &&
      typeof resident.name === 'string' && !resident.name.includes('★') &&
      !resident.romance && !(resident.familyCooldownUntil > view.serverTime) &&
      !protectedIds().has(resident.id) && !protectedResident(resident) &&
      !task.autoParents.includes(resident.id) && !task.pendingDispatch[resident.id] &&
      !view.state.explorers.some(explorer => explorer.residentId === resident.id) &&
      !gateHeld(resident) && !dormWorkHeld(resident) && !pairPaused(resident);
  }
  function populationWithoutGear(resident) {
    // 当前接口未承诺遣散后装备如何处理；只清理明确未携带装备的居民。
    return resident?.weaponId === null && resident?.outfitId === null;
  }
  function observePopulationIdle() {
    const next = {};
    for (const resident of view.state.residents) if (populationIdle(resident)) {
      const since = task.populationIdleSince[resident.id];
      next[resident.id] = Number.isFinite(since) && since <= view.serverTime ? since : view.serverTime;
    }
    task.populationIdleSince = next;
  }
  function populationCanDismiss() {
    return populationOptions.enabled && !incidentsBlockAutomation() && !stopped() &&
      (task.populationLastDismissAt === null || view.serverTime - task.populationLastDismissAt >= populationWaitMs);
  }
  function populationHasRecruitment() {
    // 电台必须实际值班且可用；没有补员来源时不能仅凭满人口持续减员。
    if (view.state.rooms.some(room => room.type === 'radio' && !workforceRoomReasons(room, view.serverTime).length && !room.craft &&
        view.state.residents.some(resident => resident.roomId === room.id && resident.away === null &&
          resident.deadAt === null && resident.adultAt <= view.serverTime))) return true;
    if (!task.birthEnabled) return false;
    const dorms = view.state.rooms.filter(room => room.type === 'quarters' &&
      !workforceRoomReasons(room, view.serverTime).length && !room.craft);
    if (!dorms.length) return false;
    const parents = view.state.residents.filter(resident => birthCandidate(resident) && resident.deadAt === null &&
      resident.away === null && resident.adultAt <= view.serverTime && resident.happiness >= 50 &&
      !(resident.familyCooldownUntil > view.serverTime) && !task.pendingDispatch[resident.id] &&
      !questTeamIds().has(resident.id) && !view.state.births.some(birth => birth.parents.includes(resident.id)));
    return parents.some((left, index) => parents.slice(index + 1).some(right => birthPairAllowed(left, right) &&
      (!left.romance || left.romance.partnerId === right.id) && (!right.romance || right.romance.partnerId === left.id) &&
      (dorms.some(room => left.roomId === room.id && right.roomId === room.id && safeBirthRoom(room.id, [left, right])) ||
        availableForNewBirth(left) && availableForNewBirth(right) && pairCooldown(left, right) <= view.serverTime &&
        dorms.some(room => freePairSlots(room) > 0 && safeBirthRoom(room.id, [left, right])))));
  }
  function populationCandidate() {
    if (!populationCanDismiss()) return null;
    const { full, capacity } = populationState();
    if (!full || !(capacity > 0) || !populationHasRecruitment()) return null;
    const idle = view.state.residents.filter(resident => populationIdle(resident) &&
      Number.isFinite(task.populationIdleSince[resident.id]) &&
      view.serverTime - task.populationIdleSince[resident.id] >= populationWaitMs);
    if (idle.length < populationOptions.minIdle) return null;
    return idle.filter(resident => populationTotal(resident) < populationOptions.total && populationWithoutGear(resident))
      .sort((left, right) => populationTotal(left) - populationTotal(right) || left.id - right.id)[0] ?? null;
  }
  async function optimizePopulation() {
    if (!populationOptions.enabled || stopped() || incidentsBlockAutomation()) return;
    await read();
    // 新到电台成人走同一总属性底线；旧的新人遣散配置仍独立生效。
    task.populationPending = task.populationPending.filter(id => {
      const resident = view.state.residents.find(item => item.id === id);
      return populationIdle(resident) && populationTotal(resident) < populationOptions.total;
    });
    const rejected = task.populationPending.map(id => view.state.residents.find(resident => resident.id === id))
      .filter(populationWithoutGear).sort((left, right) => populationTotal(left) - populationTotal(right) || left.id - right.id);
    if (populationCanDismiss() && rejected.length) {
      const resident = rejected[0];
      if (!await act({ type: 'dismiss', residentId: resident.id }, 'population-newcomer')) return;
      task.populationPending = task.populationPending.filter(id => id !== resident.id);
      task.newcomers = task.newcomers.filter(id => id !== resident.id);
      log(`人口优化：新居民 ${resident.name}（ID ${resident.id}）基础总属性 ${populationTotal(resident)} < ${populationOptions.total}，已遣散，继续等待合格补员。`);
      return;
    }
    // 先让高属性待岗成人补生产空位；可用房间及归岗预留交给现有岗位模型检查。
    const workers = view.state.residents.filter(resident => populationIdle(resident) && populationTotal(resident) >= populationOptions.total &&
      !(task.birthEnabled && birthCandidate(resident)))
      .sort((left, right) => populationTotal(right) - populationTotal(left) || left.id - right.id);
    for (const original of workers) {
      if (stopped() || incidentsBlockAutomation()) return;
      const resident = view.state.residents.find(item => item.id === original.id);
      if (!populationIdle(resident)) continue;
      const room = chooseProductionRoom(resident);
      if (!room) break;
      if (!await act({ type: 'assign', residentId: resident.id, roomId: room.id }, 'population-work')) return;
      if (view.state.residents.find(item => item.id === resident.id)?.roomId !== room.id) throw new Error('人口优化：高属性居民补岗结果未确认');
      log(`人口优化：${resident.name}（基础总属性 ${populationTotal(resident)}）→ 房间 ${room.id}。`);
    }
    const candidate = populationCandidate();
    if (!candidate) {
      logQuiet('population:waiting', `人口优化：等待满人口、至少 ${populationOptions.minIdle} 名成人连续待岗 10 分钟及可用补员来源；阈值为基础总属性 < ${populationOptions.total}，携带装备者保留。`);
      return;
    }
    const before = populationState();
    if (!await act({ type: 'dismiss', residentId: candidate.id }, 'population')) return;
    task.newcomers = task.newcomers.filter(id => id !== candidate.id);
    delete task.populationIdleSince[candidate.id];
    log(`人口优化：人口 ${before.living}/${before.capacity}，遣散待岗居民 ${candidate.name}（ID ${candidate.id}，基础总属性 ${populationTotal(candidate)} < ${populationOptions.total}），已腾出 1 个补员名额。`);
  }
  // 人口未满时，有合格伴侣的宿舍居民继续等待配对和感情结算。
  // 这些成年子代不参与普通岗位分配，统一交给宿舍清理流程处理：
  // 低进度配对/未配对候选居民一次性调出后由 dormWorkHold 保护，不再来回切换。
  function awaitingPairingInDorm(resident) {
    if (populationState().full) return false;
    if (resident.deadAt !== null || resident.away !== null || resident.adultAt > view.serverTime) return false;
    if (!hasQualifiedBirthPartner(resident)) return false;
    if (resident.familyCooldownUntil > view.serverTime) return false;
    const room = view.state.rooms.find(item => item.id === resident.roomId);
    return room?.type === 'quarters';
  }
  // 宿舍里的“组”包括已有感情的双人组和正在配对的双人组。
  // 待产组不占保留名额：待产父母可以先去工作，离出生不足 10 分钟时再由
  // returnParents 留在宿舍。最多保留 capacity - living 组（人口剩余空位，
  // 例如 156-155=1），优先级：
  //   1. 感情 100% 但还没待产的空闲组（能直接使用空位）
  //   2. 已有感情的配对（进度高的优先，含 30% 以下的低进度组）
  //   3. 正在配对但还没建立感情的组
  // 只要人口还有空位，低进度配对也留在宿舍继续培养感情；只有超出名额时才调出。
  function dormGroupPlan() {
    const byId = new Map(view.state.residents.map(resident => [resident.id, resident]));
    const inDorm = resident => view.state.rooms.find(room => room.id === resident?.roomId)?.type === 'quarters';
    const groups = [];
    const seen = new Set();
    for (const birth of view.state.births) {
      const parents = Array.isArray(birth.parents) ? birth.parents : [];
      // 待产父母正在工作/门外，不进入宿舍保留组；仍在宿舍的只登记 seen，
      // 避免同时按“已有感情”再保留一份名额。
      for (const id of parents) seen.add(id);
    }
    for (const resident of view.state.residents) {
      if (seen.has(resident.id) || !inDorm(resident) || !resident.romance) continue;
      const partner = byId.get(resident.romance.partnerId);
      if (!partner || partner.romance?.partnerId !== resident.id || partner.id < resident.id) continue;
      if (!inDorm(partner) || partner.roomId !== resident.roomId) continue;
      seen.add(resident.id);
      seen.add(partner.id);
      const progress = Math.max(resident.romance.progress ?? 0, partner.romance.progress ?? 0);
      groups.push({ kind: 'romance', ids: new Set([resident.id, partner.id]), dueAt: Infinity, progress });
    }
    for (const pair of task.autoPairs) {
      const [left, right] = pair.ids.map(id => byId.get(id));
      if (!left || !right || seen.has(left.id) || seen.has(right.id)) continue;
      if (!inDorm(left) || !inDorm(right) || left.roomId !== right.roomId) continue;
      seen.add(left.id);
      seen.add(right.id);
      groups.push({ kind: 'pairing', ids: new Set(pair.ids), dueAt: Infinity, progress: 0 });
    }
    const rank = group => group.kind === 'romance' && group.progress >= 1 ? 0
      : group.kind === 'romance' ? 1 : 2;
    groups.sort((left, right) => rank(left) - rank(right) ||
      (left.kind === 'romance' && right.kind === 'romance'
        ? right.progress - left.progress || Math.min(...left.ids) - Math.min(...right.ids)
        : Math.min(...left.ids) - Math.min(...right.ids)));
    const { living, capacity } = populationState();
    const keepCount = Math.max(0, capacity - living);
    const keepIds = new Set(groups.filter(group => birthPairAllowed(...[...group.ids].map(id => byId.get(id))))
      .slice(0, keepCount).flatMap(group => [...group.ids]));
    return { groups, keepIds, keepCount };
  }
  // 自动生育：双方每项基础属性合计至少 19；成年、在家、心情≥50、不在冷却、无亲属关系。
  // 放进有空位的宿舍等待服务端每 10 分钟结算感情，感情满后自动待产、出生。
  // 自动生育的子代按造神计划处理：属性总和未满 70 的优先训练，按总和从高到低排队。
  async function autoBirth(quiet = false) {
    const now = view.serverTime;
    prunePairState(now);
    const { living, capacity, full } = populationState();
    if (full) { if (!quiet) log(`自动生育：人口已满（${living}/${capacity}），本轮不安排新配对。`); return; }
    const pendingParents = new Set(view.state.births.flatMap(birth => birth.parents));
    const pairing = new Set(task.autoPairs.flatMap(pair => pair.ids));
    const byId = new Map(view.state.residents.map(resident => [resident.id, resident]));
    // 已经建立感情的配对都会占用 1 个出生名额，包括冷却中、心情不足或房间出事的；
    // 这些配对之后仍可能再要孩子。只按“当前可以生育”统计会让新配对超卖名额，
    // 感情满时就会撞上人口上限，只能显示“人口已满，等待空位”。
    const reserved = new Set();
    for (const resident of view.state.residents) {
      if (resident.deadAt !== null || resident.away !== null || resident.adultAt > now || !resident.romance) continue;
      const partner = byId.get(resident.romance.partnerId);
      if (!partner || partner.deadAt !== null || partner.romance?.partnerId !== resident.id || resident.id > partner.id) continue;
      // 待产中的这对已经计入人口（living 包含 births），不再重复预留。
      if (pendingParents.has(resident.id) || pendingParents.has(partner.id)) continue;
      const room = view.state.rooms.find(item => item.id === resident.roomId);
      const together = room && room.type === 'quarters' && partner.roomId === room.id && room.builtAt <= now;
      // 被宿舍清理流程调出的低进度配对仍在保护期内：他们还是有效配对，
      // 继续预留出生名额，避免本轮调出腾出的名额立刻被新配对占用。
      if (!together && !dormWorkHeld(resident) && !dormWorkHeld(partner)) continue;
      reserved.add(`${Math.min(resident.id, partner.id)}-${Math.max(resident.id, partner.id)}`);
    }
    // 刚安排进宿舍、服务端感情还没建立的配对同样要预留名额。
    for (const pair of task.autoPairs) {
      const [left, right] = pair.ids.map(id => byId.get(id));
      if (!left || !right || left.deadAt !== null || right.deadAt !== null) continue;
      if (pendingParents.has(left.id) || pendingParents.has(right.id)) continue;
      if (left.familyCooldownUntil > now || right.familyCooldownUntil > now) continue;
      if (left.romance || right.romance) continue;
      reserved.add(`${Math.min(left.id, right.id)}-${Math.max(left.id, right.id)}`);
    }
    const freeBirths = capacity - living - reserved.size;
    if (freeBirths <= 0) {
      if (!quiet) log(`自动生育：人口上限已全部预留给现有配对（${living + reserved.size}/${capacity}），暂不安排新配对。`);
      return;
    }
    const rooms = view.state.rooms.filter(room => room.type === 'quarters' && room.builtAt <= now &&
      room.upgradeAt === null && !room.unpowered && !room.incident && ['id', 'level', 'width', 'floor'].every(key => Number.isFinite(room[key])))
      .sort((left, right) => right.level - left.level || right.width - left.width || left.floor - right.floor || left.id - right.id);
    const slots = rooms.reduce((sum, room) => sum + freePairSlots(room), 0);
    if (!slots) { if (!quiet) log('自动生育：没有可用宿舍空位。'); return; }
    const candidates = view.state.residents.filter(availableForNewBirth).sort((left, right) => left.id - right.id);
    const limit = Math.min(slots, freeBirths, Math.floor(candidates.length / 2));
    const pairs = selectBirthPairs(candidates, limit);
    if (!pairs.length) { if (!quiet) log('自动生育：没有每项基础属性合计至少 19 的可用配对。'); return; }
    for (const room of rooms) {
      let free = freePairSlots(room);
      while (free > 0 && pairs.length) {
        if (stopped()) return;
        const pairIndex = pairs.findIndex(members => safeBirthRoom(room.id, members));
        if (pairIndex === -1) break;
        const [left, right] = pairs.splice(pairIndex, 1)[0];
        for (const member of [left, right]) { rememberReturn(member, task.parentReturns, 'birth'); task.parentReturns.find(entry => entry.residentId === member.id && entry.status === 'waiting').groupKey = pairKey(left, right); }
        for (const member of [left, right]) {
          const resident = view.state.residents.find(item => item.id === member.id);
          if (!resident || resident.deadAt !== null || resident.away !== null || resident.adultAt > view.serverTime ||
              resident.romance || resident.familyCooldownUntil > view.serverTime || resident.happiness < 50) {
            throw new Error('自动配对的居民状态已变化，跳过本轮');
          }
          if (resident.roomId === room.id) continue;
          if (!await act({ type: 'assign', residentId: resident.id, roomId: room.id }, 'pair')) return;
          if (view.state.residents.find(item => item.id === resident.id)?.roomId !== room.id) throw new Error('自动配对入住结果未确认');
        }
        for (const id of [left.id, right.id]) if (!task.autoParents.includes(id)) task.autoParents.push(id);
        // 配对后两人已离开生产岗位，生育结束回岗或配对失效后需要重新安排，不再沿用旧记录。
        task.autoAssigned = task.autoAssigned.filter(id => id !== left.id && id !== right.id);
        // 记录配对宿舍，待产记录出现后由 returnParents 释放父母回岗。
        if (!task.autoPairs.some(pair => pair.ids.includes(left.id) && pair.ids.includes(right.id))) {
          task.autoPairs.push({ roomId: room.id, ids: [left.id, right.id] });
        }
        free--;
        log(`自动生育：${left.name}#${left.id} ＋ ${right.name}#${right.id} → ${room.floor} 层 ${room.level} 级宿舍（房间 ${room.id}）。`);
      }
    }
  }
  // 生产岗位：先补电力、食物、净水缺口，正收益时优先零件工坊（不能把废料吃成负数），
  // 再废料回收站、医务室，最后电台。
  function chooseProductionRoom(resident) {
    const model = workforceModel(view);
    // 与游戏调动校验一致：房间内未倒下的成人占位（外出居民的岗位也保留）。
    const occupied = roomId => shelterRoomOccupancy(view, roomId);
    const rooms = model.rooms.filter(room => room.type !== 'training' && occupied(room.id) < room.width * 2);
    const net = model.net();
    const deficits = ['power', 'food', 'water'].filter(key => net[key] < 0).sort((left, right) => net[left] - net[right]);
    const order = [...deficits, 'parts', 'scrap', 'stimpak'];
    for (const resource of order) {
      const options = rooms.filter(room => model.types[room.type]?.resource === resource)
        .map(room => ({ room, net: model.net([{ residentId: resident.id, roomId: room.id }]) }))
        .filter(item => resource !== 'parts' || item.net.scrap >= 0)
        .sort((left, right) => right.room.level - left.room.level || right.room.width - left.room.width ||
          left.room.floor - right.room.floor || left.room.id - right.room.id);
      if (options.length) return options[0].room;
    }
    // 没有缺口且零件工坊、废料回收站、医务室、电台都满员时，把空闲居民补进电力、
    // 食物、净水等还有空位的生产房间，避免资源库存长期不满却有人留在门外。
    const spare = rooms.filter(room => room.type !== 'radio')
      .sort((left, right) => right.level - left.level || right.width - left.width ||
        left.floor - right.floor || left.id - right.id);
    if (spare.length) return spare[0];
    return rooms.filter(room => room.type === 'radio')
      .sort((left, right) => right.level - left.level || left.floor - right.floor || left.id - right.id)[0] ?? null;
  }
  // 资源补缺：电力、食物、净水为负时，从废料回收站、零件工坊等非缺口岗位调人补进空位。
  async function balanceResources() {
    const assignments = planResourceBalance(view, protectedIds());
    if (assignments.length) {
      log(`资源补缺：本轮 ${assignments.length} 步调动。`);
      for (const { residentId, roomId, message } of assignments) {
        if (stopped()) return;
        if (!await act({ type: 'assign', residentId, roomId })) return;
        if (view.state.residents.find(item => item.id === residentId)?.roomId !== roomId) throw new Error('资源补缺调动结果未确认');
        log(message);
      }
    }
    const net = workforceModel(view).net();
    const deficits = ['power', 'food', 'water'].filter(key => net[key] < 0);
    if (!deficits.length) task.deficitNotice = null;
    else {
      const labels = { power: '电力', food: '食物', water: '净水' };
      const notice = deficits.map(key => `${labels[key]} ${net[key].toFixed(1)}/时`).join('、');
      // 缺口没有变化时不重复写日志。
      if (task.deficitNotice !== notice) {
        log(`资源补缺：${notice} 仍为负，非缺口岗位暂无可调居民，请手动安排。`);
        task.deficitNotice = notice;
      }
    }
  }
  // 等级调整：同种资源有更高等级的空位时，把低等级房间的居民迁上去。
  async function upgradeRooms() {
    const assignments = planRoomUpgrade(view, protectedIds());
    for (const { residentId, roomId, message } of assignments) {
      if (stopped()) return;
      if (!await act({ type: 'assign', residentId, roomId })) return;
      if (view.state.residents.find(item => item.id === residentId)?.roomId !== roomId) throw new Error('等级调整结果未确认');
      log(message);
    }
  }

  // 每个服装档位还缺哪些款式；按 6→0 找到最高未集齐的档，全部集齐时返回 6 档空缺口。
  function outfitCodexProgress() {
    const owned = new Set(Array.isArray(view.state.codex?.items) ? view.state.codex.items : []);
    return [6, 5, 4, 3, 2, 1, 0].map(tier => ({
      tier,
      missing: outfitCodexKeysByTier[tier].filter(key => !owned.has(key))
    }));
  }

  // 装备仓库剩余格数：基础 20 格，每级仓库加 10 格（与游戏一致）；
  // 扣除未穿戴装备和正在制作、尚未入库的装备。返回 null 表示数据不足，不限制开工。
  function outfitStorageFreeSlots() {
    if (!Array.isArray(view.state.items)) return null;
    const storage = view.state.rooms.filter(room =>
      room.type === 'storage' && Number(room.builtAt) <= view.serverTime)
      .reduce((sum, room) => sum + Number(room.width || 0) * Number(room.level || 0), 0);
    const equipped = new Set(view.state.residents.flatMap(resident =>
      [resident.weaponId, resident.outfitId].filter(id => id !== null && id !== undefined)));
    const stored = view.state.items.filter(item => !equipped.has(item.id)).length;
    const pending = view.state.rooms.filter(room => room.craft).length;
    return Math.max(0, 20 + 10 * storage - stored - pending);
  }

  // 给空工坊开工的居民：优先待岗居民，其次服装工坊现有居民，不抽生产岗位。
  // 制作开始后居民可以离开，所以同一个居民能依次开多间工坊。
  function craftStarter() {
    const excluded = protectedIds();
    const usable = resident => resident && resident.deadAt === null && resident.away === null &&
      resident.adultAt <= view.serverTime && !excluded.has(resident.id) &&
      !task.populationPending?.includes(resident.id);
    const idle = view.state.residents.filter(resident => usable(resident) && resident.roomId === null)
      .sort((left, right) => (Number(right.stats?.cha) || 0) - (Number(left.stats?.cha) || 0) ||
        left.id - right.id);
    if (idle.length) return idle[0];
    const inTailor = view.state.residents.filter(resident => {
      if (!usable(resident)) return false;
      const room = view.state.rooms.find(item => item.id === resident.roomId);
      return room?.type === 'tailor' && !blockingIncident(room);
    });
    return inTailor.sort((left, right) => {
      const leftRoom = view.state.rooms.find(item => item.id === left.roomId);
      const rightRoom = view.state.rooms.find(item => item.id === right.roomId);
      // 优先从有多名居民的工坊借人，避免把唯一居民调走后原工坊空置。
      return adultsIn(rightRoom.id).length - adultsIn(leftRoom.id).length ||
        (Number(right.stats?.cha) || 0) - (Number(left.stats?.cha) || 0) || left.id - right.id;
    })[0] ?? null;
  }

  // 自动造服装：默认沿用单件模式；开启“多工坊同时制作”后由一名居民依次给空工坊开工。
  async function autoCraftOutfits() {
    return task.craftMultiEnabled ? autoCraftOutfitsMulti() : autoCraftOutfitsSingle();
  }

  // 单件模式（默认）：按 6→5→4→3→2→1→0 逐档集齐，6 种全亮后才去下一档；
  // 0–6 档全部集齐后持续制作 6 档。同一时间只制作一件，不占施工位；
  // 制作和升级共用废料，绝不使用星核汽水加速。
  async function autoCraftOutfitsSingle() {
    const now = Date.now();
    for (const [id, until] of Object.entries(task.craftBlocked)) if (until <= now) delete task.craftBlocked[id];
    const tailors = view.state.rooms.filter(room =>
      room.type === 'tailor' && Number(room.builtAt) <= view.serverTime);
    if (!tailors.length) {
      logQuiet('craft:no-room', '自动造服装：没有已建成的服装工坊，等待建造或建成。', 30 * 60000);
      return;
    }
    // 已有制作时先等它完成并入库，不同时开第二件，避免装备仓库被同时占满。
    const active = tailors.find(room => room.craft);
    if (active) {
      if (Number(active.craft.doneAt) <= view.serverTime) {
        logQuiet(`craft:storage:${active.id}`, `自动造服装：服装工坊（房间 ${active.id}）的 ${active.craft.tier} 档已制作完成，等待装备仓库空位入库。`, 30 * 60000);
      }
      return;
    }
    const progress = outfitCodexProgress();
    const target = progress.find(item => item.missing.length);
    const tier = target?.tier ?? 6;
    const missingAtTier = target?.missing ?? [];
    // 只找能制作目标档位的工坊；等级不足时等待自动升级，不跳过未集齐的高档。
    const candidates = tailors.filter(room =>
      room.upgradeAt === null && !room.incident && !room.unpowered && !task.craftBlocked[room.id] &&
      outfitCraftMaxTier(room) >= tier &&
      view.state.residents.some(resident => resident.roomId === room.id && resident.deadAt === null))
      .sort((left, right) => outfitCraftMaxTier(right) - outfitCraftMaxTier(left) ||
        Number(right.level) - Number(left.level) || Number(right.width) - Number(left.width) ||
        Number(left.floor) - Number(right.floor) || Number(left.id) - Number(right.id));
    if (!candidates.length) {
      const maxTier = tailors.reduce((max, room) => Math.max(max, outfitCraftMaxTier(room)), -1);
      if (maxTier < tier) {
        logQuiet(`craft:level:${tier}`, `自动造服装：${missingAtTier.length ? `${tier} 档还缺 ${missingAtTier.length} 种，` : '图鉴已全部集齐，'}服装工坊最高只能制作 ${maxTier} 档，目标 ${tier} 档，等待工坊升级。`, 30 * 60000);
      } else {
        logQuiet(`craft:busy:${tier}`, `自动造服装：暂时没有可用的服装工坊制作 ${tier} 档（需要已建成、未升级、有居民且未被临时跳过）。`, 30 * 60000);
      }
      return;
    }
    const room = candidates[0];
    const cost = outfitCraftCost(tier);
    const scrap = Number(view.state.resources?.scrap) || 0;
    const parts = Number(view.state.resources?.parts) || 0;
    if (scrap < cost.scrap || parts < cost.parts) {
      logQuiet(`craft:resource:${tier}`, `自动造服装：制作 ${tier} 档需 ${cost.scrap} 废料、${cost.parts} 零件（${missingAtTier.length ? `该档还缺 ${missingAtTier.length} 种` : '图鉴已全部集齐'}），当前 ${Math.floor(scrap)} 废料、${Math.floor(parts)} 零件，等待资源。`, 30 * 60000);
      return;
    }
    try {
      if (!await act({ type: 'craft', roomId: room.id, tier })) return;
      const updated = view.state.rooms.find(item => item.id === room.id);
      if (!updated?.craft || Number(updated.craft.tier) !== tier) {
        log('自动造服装：制作结果未确认，稍后再试。');
        return;
      }
      const targetText = missingAtTier.length
        ? `${tier} 档还缺 ${missingAtTier.length} 种，开始制作 ${tier} 档`
        : '图鉴 0–6 档已全部集齐，持续制作 6 档';
      log(`自动造服装：服装工坊（房间 ${room.id}）${targetText}，花费 ${cost.scrap} 废料${cost.parts ? `、${cost.parts} 零件` : ''}。`);
    } catch (error) {
      if (error.fatal || error.stopped) throw error;
      task.craftBlocked[room.id] = Date.now() + 30 * 60000;
      logQuiet(`craft:error:${room.id}`, `自动造服装：制作 ${tier} 档失败：${error.message}，30 分钟内跳过这间工坊。`, 10 * 60000);
      try { await read(); } catch (readError) { if (readError.fatal || readError.stopped) throw readError; }
    }
  }

  // 多工坊同时制作（开关开启时）：按同样顺序选档，所有空工坊同时开工；
  // 开工后居民可以前往下一间空工坊，因此一名居民就能依次开满多间。
  // 不占施工位，制作和升级共用废料，绝不使用星核汽水加速。
  async function autoCraftOutfitsMulti() {
    const now = Date.now();
    for (const [id, until] of Object.entries(task.craftBlocked)) if (until <= now) delete task.craftBlocked[id];
    const tailors = view.state.rooms.filter(room =>
      room.type === 'tailor' && Number(room.builtAt) <= view.serverTime);
    if (!tailors.length) {
      logQuiet('craft:no-room', '自动造服装：没有已建成的服装工坊，等待建造或建成。', 30 * 60000);
      return;
    }
    // 已完成的制作会留在工坊里等装备仓库空位，逐间提示。
    for (const room of tailors) {
      if (room.craft && Number(room.craft.doneAt) <= view.serverTime) {
        logQuiet(`craft:storage:${room.id}`, `自动造服装：服装工坊（房间 ${room.id}）的 ${room.craft.tier} 档已制作完成，等待装备仓库空位入库。`, 30 * 60000);
      }
    }
    const idleTailors = tailors.filter(room => !room.craft);
    if (!idleTailors.length) return;
    const progress = outfitCodexProgress();
    const target = progress.find(item => item.missing.length);
    const tier = target?.tier ?? 6;
    const missingAtTier = target?.missing ?? [];
    const cost = outfitCraftCost(tier);
    // 只找能制作目标档位的空工坊；等级不足时等待自动升级，不跳过未集齐的高档。
    const candidates = idleTailors.filter(room =>
      room.upgradeAt === null && !room.incident && !room.unpowered && !task.craftBlocked[room.id] &&
      outfitCraftMaxTier(room) >= tier)
      .sort((left, right) => {
        // 已有居民的工坊先开工，需要调人的空工坊稍后处理。
        const byResident = Number(adultsIn(right.id).length > 0) - Number(adultsIn(left.id).length > 0);
        return byResident || outfitCraftMaxTier(right) - outfitCraftMaxTier(left) ||
          Number(right.level) - Number(left.level) || Number(right.width) - Number(left.width) ||
          Number(left.floor) - Number(right.floor) || Number(left.id) - Number(right.id);
      });
    if (!candidates.length) {
      const maxTier = tailors.reduce((max, room) => Math.max(max, outfitCraftMaxTier(room)), -1);
      if (maxTier < tier) {
        logQuiet(`craft:level:${tier}`, `自动造服装：${missingAtTier.length ? `${tier} 档还缺 ${missingAtTier.length} 种，` : '图鉴已全部集齐，'}服装工坊最高只能制作 ${maxTier} 档，目标 ${tier} 档，等待工坊升级。`, 30 * 60000);
      } else if (!tailors.some(room => room.craft)) {
        logQuiet(`craft:busy:${tier}`, `自动造服装：暂时没有可用的服装工坊制作 ${tier} 档（需要已建成、未升级、未停电且未被临时跳过）。`, 30 * 60000);
      }
      return;
    }
    let slots = outfitStorageFreeSlots();
    if (slots !== null && slots <= 0) {
      logQuiet('craft:storage-full', '自动造服装：装备仓库没有空位，暂时不开始新的制作。', 30 * 60000);
      return;
    }
    // 只有空工坊需要这名开工居民；已有居民的工坊直接开工，不额外调人。
    const needsStarter = candidates.some(room => adultsIn(room.id).length === 0);
    const starter = needsStarter ? craftStarter() : null;
    let starterId = starter?.id ?? null;
    let started = 0, skippedForResident = false;
    for (const room of candidates) {
      if (stopped()) return;
      if (slots !== null && slots <= 0) {
        if (started) logQuiet('craft:storage-limit', `自动造服装：本轮已开始 ${started} 件，装备仓库空位已预留完，等待制作完成或腾出空位。`, 30 * 60000);
        break;
      }
      // 上一次操作后重新读取；工坊可能已被服务端升级、占用或开始制作。
      const current = view.state.rooms.find(item => item.id === room.id);
      if (!current || current.craft || current.upgradeAt !== null || current.incident || current.unpowered ||
          task.craftBlocked[current.id] || outfitCraftMaxTier(current) < tier) continue;
      // 先确认资源再调居民，避免资源只够上一件时把居民白搬一趟。
      const scrap = Number(view.state.resources?.scrap) || 0;
      const parts = Number(view.state.resources?.parts) || 0;
      if (scrap < cost.scrap || parts < cost.parts) {
        if (!started) {
          logQuiet(`craft:resource:${tier}`, `自动造服装：制作 ${tier} 档需 ${cost.scrap} 废料、${cost.parts} 零件（${missingAtTier.length ? `该档还缺 ${missingAtTier.length} 种` : '图鉴已全部集齐'}），当前 ${Math.floor(scrap)} 废料、${Math.floor(parts)} 零件，等待资源。`, 30 * 60000);
        } else {
          logQuiet(`craft:resource-limit:${tier}`, `自动造服装：本轮已开始 ${started} 件，剩余 ${Math.floor(scrap)} 废料、${Math.floor(parts)} 零件，不足以再开一间（每件需 ${cost.scrap} 废料${cost.parts ? `、${cost.parts} 零件` : ''}），等待资源。`, 30 * 60000);
        }
        break;
      }
      if (!adultsIn(current.id).length) {
        if (!starterId) { skippedForResident = true; continue; }
        const shuttle = view.state.residents.find(resident => resident.id === starterId);
        if (!shuttle || shuttle.deadAt !== null || shuttle.away !== null || shuttle.adultAt > view.serverTime) {
          starterId = null;
          skippedForResident = true;
          continue;
        }
        if (shuttle.roomId !== current.id) {
          let moved;
          try {
            moved = await act({ type: 'assign', residentId: starterId, roomId: current.id }, 'craft');
          } catch (error) {
            if (error.fatal || error.stopped) throw error;
            logQuiet(`craft:shuttle:${current.id}`, `自动造服装：调居民去工坊（房间 ${current.id}）开工失败：${error.message}，稍后再试。`, 10 * 60000);
            try { await read(); } catch (readError) { if (readError.fatal || readError.stopped) throw readError; }
            starterId = null;
            skippedForResident = true;
            continue;
          }
          if (!moved) {
            logQuiet(`craft:shuttle:${current.id}`, `自动造服装：无法把居民调到工坊（房间 ${current.id}）开工，稍后再试。`, 10 * 60000);
            starterId = null;
            skippedForResident = true;
            continue;
          }
          if (view.state.residents.find(item => item.id === starterId)?.roomId !== current.id) {
            log('自动造服装：居民开工位置未确认，稍后再试。');
            starterId = null;
            skippedForResident = true;
            continue;
          }
        }
      }
      const ready = view.state.rooms.find(item => item.id === current.id);
      if (!ready || ready.craft || ready.upgradeAt !== null || ready.incident || ready.unpowered ||
          task.craftBlocked[ready.id] || outfitCraftMaxTier(ready) < tier || !adultsIn(ready.id).length) continue;
      try {
        if (!await act({ type: 'craft', roomId: ready.id, tier })) return;
        const updated = view.state.rooms.find(item => item.id === ready.id);
        if (!updated?.craft || Number(updated.craft.tier) !== tier) {
          log('自动造服装：制作结果未确认，稍后再试。');
          return;
        }
        started++;
        if (slots !== null) slots--;
        const targetText = missingAtTier.length
          ? `${tier} 档还缺 ${missingAtTier.length} 种，开始制作 ${tier} 档`
          : '图鉴 0–6 档已全部集齐，持续制作 6 档';
        log(`自动造服装：服装工坊（房间 ${ready.id}）${targetText}，花费 ${cost.scrap} 废料${cost.parts ? `、${cost.parts} 零件` : ''}。`);
      } catch (error) {
        if (error.fatal || error.stopped) throw error;
        task.craftBlocked[ready.id] = Date.now() + 30 * 60000;
        logQuiet(`craft:error:${ready.id}`, `自动造服装：制作 ${tier} 档失败：${error.message}，30 分钟内跳过这间工坊。`, 10 * 60000);
        try { await read(); } catch (readError) { if (readError.fatal || readError.stopped) throw readError; }
      }
    }
    if (skippedForResident) {
      logQuiet(`craft:resident:${tier}`, '自动造服装：有空工坊，但没有可调用的待岗居民或服装工坊居民，等待居民空闲。', 30 * 60000);
    }
  }

  const activeConstructions = () => view.state.rooms.filter(room =>
    Number(room.upgradeAt) > view.serverTime || Number(room.builtAt) > view.serverTime);
  const activeConstructionCount = () => activeConstructions().length;
  // 把正在施工/升级的房间写进等待日志，避免只看到“施工位已满”却不知道是谁占着。
  const constructionText = () => activeConstructions().map(room => {
    const label = shelterUpgradeLabels[room.type] ?? room.type;
    return `${room.floor} 层${label}${Number(room.upgradeAt) > view.serverTime ? '升级' : '施工'}`;
  }).join('、');
  // 目标建造：从最早的纯电梯空楼层开始，按格连续建指定房间。
  // 目标未完成时暂停普通房间升级；已有 2 项施工/升级时只等待空位。
  async function autoBuildTarget() {
    if (!task.targetEnabled) return false;
    if (typeof shelterTargetStatus !== 'function') throw new Error('目标建造脚本未加载，请重新打开扩展面板');
    const room = task.targetRoom;
    const count = Math.max(0, Math.floor(Number(task.targetCount) || 0));
    if (!room || count < 1 || !shelterTargetBuildable.includes(room)) return false;
    const trainStat = room === 'training' ? task.targetStat : null;
    let progress = task.targetProgress;
    if (!progress || progress.room !== room || (progress.trainStat ?? null) !== trainStat ||
        !Number.isInteger(Number(progress.startFloor)) || Number(progress.startFloor) < 1 ||
        Number(progress.startFloor) > Number(view.state.depth)) {
      const startFloor = shelterTargetEarliestEmptyFloor(view);
      if (startFloor === null) {
        logQuiet('target:no-floor', '目标建造：没有空楼层，等待挖层。', 30 * 60000);
        return true;
      }
      progress = { room, trainStat, startFloor };
      task.targetProgress = progress;
      await saveTargetProgress(progress);
      log(`目标建造：从第 ${startFloor} 层开始建 ${count} 格${shelterUpgradeLabels[room] ?? room}。`);
    }
    const options = { room, count, trainStat, startFloor: progress.startFloor };
    const constructionAt = spot => view.state.rooms.some(item => item.type === room &&
      Number(item.floor) === Number(spot.floor) && Number(item.col) <= spot.col &&
      spot.col < Number(item.col) + Math.max(1, Number(item.width) || 1) &&
      Number(item.builtAt) > view.serverTime);
    let status = shelterTargetStatus(view, options);
    if (!status.configured) return false;
    if (status.complete) {
      logQuiet(`target:done:${room}:${count}:${progress.startFloor}`, `目标建造：${count} 格${shelterUpgradeLabels[room] ?? room}已完成。`, 30 * 60000);
      return false;
    }
    if (status.cells >= count && status.activeCells > 0) {
      logQuiet('target:wait-build', `目标建造：等待最后 ${status.activeCells} 格施工完成。`, 10 * 60000);
      return true;
    }
    if (Number(task.targetBlockedUntil) > Date.now()) {
      logQuiet('target:blocked', `目标建造：已完成 ${status.cells}/${count} 格，${task.targetBlockedReason || '上次建造失败'}，稍后再试。`, 10 * 60000);
      return true;
    }
    const active = activeConstructionCount();
    if (active >= 2) {
      // 施工位被升级/建造占满时，日志里带出具体占位房间；目标进度也一并显示。
      logQuiet('target:slots',
        `目标建造：已完成 ${status.cells}/${count} 格，两个施工位都被占用（${constructionText() || '未知'}），等空出一个就继续建造。`,
        10 * 60000);
      return true;
    }
    // 按可用施工位一次最多开始两格；每格都按最新状态重新计算位置和造价。
    for (let slot = active; slot < 2; slot++) {
      if (stopped()) return true;
      status = shelterTargetStatus(view, options);
      if (!status.configured || status.complete) break;
      if (status.cells >= count && status.activeCells > 0) break;
      const next = status.next;
      if (!next) {
        logQuiet('target:no-space', '目标建造：没有可用的空楼层或空位，等待挖层。', 30 * 60000);
        break;
      }
      const scrap = Number(view.state.resources?.scrap) || 0;
      if (scrap < next.cost) {
        logQuiet('target:resource', `目标建造：废料不足，下一格需 ${next.cost}，当前 ${Math.floor(scrap)}。`, 30 * 60000);
        break;
      }
      const beforeCells = status.cells;
      const label = shelterUpgradeLabels[room] ?? room;
      try {
        if (!await act({ type: 'build', room, floor: next.floor, col: next.col, trainStat })) break;
      } catch (error) {
        if (error.fatal || error.stopped) throw error;
        const message = error?.message || '建造失败';
        // 施工已经提交、但回包超时/重试时报“施工位已满”或邻接错误的情况：
        // 先以游戏状态为准确认是否真的开始了，不能把已经开始的施工再封 5 分钟。
        let confirmed = false;
        let afterError = status;
        try {
          await read();
          afterError = shelterTargetStatus(view, options);
          confirmed = afterError.cells > beforeCells || constructionAt(next);
        } catch (readError) {
          if (readError.fatal || readError.stopped) throw readError;
        }
        if (confirmed) {
          task.targetBlockedUntil = 0;
          task.targetBlockedReason = '';
          log(`目标建造：第 ${next.floor} 层第 ${next.col} 列已开始建${label}（第 ${afterError.cells}/${count} 格，已按游戏状态确认施工；接口返回：${message}）。`);
          break;
        }
        if (/施工|最多|上限|满/.test(message)) {
          logQuiet('target:slots-error', `目标建造：施工位已满（${message}），等待空位。`, 60 * 60000);
        } else {
          task.targetBlockedUntil = Date.now() + 60000;
          task.targetBlockedReason = message;
          logQuiet(`target:failed:${next.floor}:${next.col}`,
            `目标建造：第 ${next.floor} 层第 ${next.col} 列建${label}失败：${message}，1 分钟后再试。`, 5 * 60000);
        }
        break;
      }
      if (stopped()) return true;
      let after = shelterTargetStatus(view, options);
      if (!after.configured || after.cells <= beforeCells) {
        // 建造动作的回包视图可能早于施工状态落库，重新读取一次再判断。
        try {
          await read();
          after = shelterTargetStatus(view, options);
        } catch (readError) {
          if (readError.fatal || readError.stopped) throw readError;
        }
        if (!after.configured || (after.cells <= beforeCells && !constructionAt(next))) {
          log('目标建造：建造结果未确认，稍后再试。');
          break;
        }
        if (after.cells <= beforeCells) {
          log(`目标建造：第 ${next.floor} 层第 ${next.col} 列已开始建${label}（第 ${after.cells}/${count} 格，已确认施工）。`);
          break;
        }
      }
      log(`目标建造：第 ${next.floor} 层第 ${next.col} 列开始建${label}（第 ${after.cells}/${count} 格），花费 ${next.cost} 废料。`);
      if (after.complete) break;
    }
    return true;
  }
  // 目标开启且未完成时，即使调用方传入的 targetActive 失真，也不开始普通房间升级。
  function targetIncomplete() {
    if (!task.targetEnabled) return false;
    const room = task.targetRoom;
    const count = Math.max(0, Math.floor(Number(task.targetCount) || 0));
    if (!room || count < 1 || !shelterTargetBuildable.includes(room)) return false;
    const trainStat = room === 'training' ? task.targetStat : null;
    const progress = task.targetProgress;
    if (!progress || progress.room !== room || (progress.trainStat ?? null) !== trainStat) return true;
    const status = shelterTargetStatus(view, { room, count, trainStat, startFloor: progress.startFloor });
    return !status.complete;
  }
  // 自动升级与挖层：按面板顺序升级房间，同类先升低等级；有人工作的房间也升级，居民留在原房间。
  // 没有正在挖掘时顺带开始下一层。
  // 升级和挖层都只发普通动作，绝不使用星核汽水加速。每次检查最多开始一间升级，避免同时停掉多间生产。
  async function autoUpgrade(targetActive = false) {
    if (!task.upgradeEnabled) return;
    const now = Date.now();
    for (const [id, until] of Object.entries(task.upgradeBlocked)) if (until <= now) delete task.upgradeBlocked[id];
    // 上一轮开始的升级完成后提示一次。
    for (const [id, info] of Object.entries(task.upgradingRooms)) {
      const room = view.state.rooms.find(item => item.id === Number(id));
      if (!room) { delete task.upgradingRooms[id]; continue; }
      if (room.upgradeAt === null && room.level >= info.level) {
        log(`自动升级：${info.label}（房间 ${id}）已升到 ${info.level} 级。`);
        delete task.upgradingRooms[id];
      }
    }
    // 上一轮挖掘完成后提示一次；depth 已更新说明服务端结算完成。
    if (task.lastDigFloor !== null && !view.state.digging && view.state.depth >= task.lastDigFloor) {
      log(`自动挖层：第 ${task.lastDigFloor} 层已挖开，当前深度 ${view.state.depth}。`);
      task.lastDigFloor = null;
    }
    if (task.upgradeDigEnabled && !view.state.digging) {
      const cost = shelterDigCost(view.state.depth);
      const scrap = Number(view.state.resources?.scrap) || 0;
      if (cost !== null && scrap >= cost) {
        const floor = view.state.depth + 1;
        try {
          if (!await act({ type: 'dig' })) return;
          if (!view.state.digging || view.state.digging.floor !== floor) {
            log('自动挖层：挖掘结果未确认，稍后再试。');
            return;
          }
          task.lastDigFloor = floor;
          log(`自动挖层：开始挖第 ${floor} 层，花费 ${cost} 废料（不使用汽水加速）。`);
        } catch (error) {
          if (error.fatal || error.stopped) throw error;
          logQuiet('upgrade:dig', `自动挖层：第 ${floor} 层开始失败：${error.message}，稍后再试。`, 10 * 60000);
          try { await read(); } catch (readError) { if (readError.fatal || readError.stopped) throw readError; }
          return;
        }
        if (stopped()) return;
      } else if (cost !== null) {
        logQuiet('upgrade:dig-resource', `自动挖层：废料不足，挖第 ${view.state.depth + 1} 层需 ${cost}，当前 ${Math.floor(scrap)}。`, 30 * 60000);
      }
    }
    // 自动造服装排在挖层之后、升级之前：挖层仍优先，制作不占施工位，可以继续升级其他房间。
    if (task.craftOutfitsEnabled) {
      await autoCraftOutfits();
      if (stopped()) return;
    }
    const targetPending = targetIncomplete();
    if (targetActive || targetPending) {
      if (targetPending) logQuiet('upgrade:target-wait',
        `自动升级：目标建造未完成，暂停普通升级（当前施工位：${constructionText() || '等待施工'}）。`,
        30 * 60000);
      return;
    }
    // 游戏最多同时 2 间房间施工，挖层不占施工位。空位不足时只等待，
    // 不能继续逐间尝试，否则每间都会收到“同时最多 2 项施工”并被误封 30 分钟。
    const active = activeConstructionCount();
    if (active >= 2) {
      logQuiet('upgrade:slots-full', '自动升级：已有 2 间在施工，等待空位。', 60 * 60000);
      return;
    }
    const blocked = new Set([...Object.keys(task.upgradeBlocked).map(Number),
      ...shelterCoordination(view).entries.filter(entry => entry.status === 'waiting').map(entry => entry.originalRoomId)]);
    const candidates = planRoomUpgrades(view, task.upgradeOrder, blocked);
    if (!candidates.length) {
      // 有房间正在升级时属于正常等待，不重复写日志。
      const pending = view.state.rooms.some(room => room.type !== 'elevator' && room.upgradeAt !== null);
      if (!pending) logQuiet('upgrade:none', '自动升级：没有可升级的房间（已满级或正在施工/事件/制作中）。', 6 * 60 * 60000);
      return;
    }
    const chosen = shelterUpgradeAffordable(candidates, view.state.resources);
    if (!chosen) {
      const next = candidates[0];
      const label = shelterUpgradeLabels[next.group] ?? '房间';
      logQuiet('upgrade:resource', `自动升级：资源不足，下一间${label}（房间 ${next.room.id}）升到 ${next.cost.level} 级需 ${next.cost.scrap} 废料${next.cost.parts ? `、${next.cost.parts} 零件` : ''}。`, 30 * 60000);
      return;
    }
    const { room, cost } = chosen;
    const label = shelterUpgradeLabels[chosen.group] ?? '房间';
    try {
      if (!await act({ type: 'upgrade', roomId: room.id })) return;
      const updated = view.state.rooms.find(item => item.id === room.id);
      if (!updated || updated.upgradeAt === null) {
        log(`自动升级：${label}（房间 ${room.id}）升级结果未确认，稍后再试。`);
        return;
      }
      task.upgradingRooms[room.id] = { level: cost.level, label };
      log(`自动升级：${label}（房间 ${room.id}）${room.level}→${cost.level} 级开始，花费 ${cost.scrap} 废料${cost.parts ? `、${cost.parts} 零件` : ''}，升级期间暂停生产。`);
    } catch (error) {
      if (error.fatal || error.stopped) throw error;
      // 读取后施工位被占满（例如手动开始了施工）：不是这间房的问题，只等下一轮，不封锁房间。
      if (/施工/.test(error.message) && /(最多|上限|满)/.test(error.message)) {
        logQuiet('upgrade:slots-full-error', `自动升级：施工位已满（${error.message}），等待空位。`, 60 * 60000);
        try { await read(); } catch (readError) { if (readError.fatal || readError.stopped) throw readError; }
        return;
      }
      task.upgradeBlocked[room.id] = Date.now() + 30 * 60000;
      log(`自动升级：${label}（房间 ${room.id}）升级失败：${error.message}，30 分钟内跳过这间。`);
      try { await read(); } catch (readError) { if (readError.fatal || readError.stopped) throw readError; }
    }
  }
  // 自动穿装备：按居民房间需要的属性分配服装，仓库和无岗位需求居民身上的服装可以重新分配。
  async function applyOutfits() {
    const plan = planOutfits(view);
    for (const change of plan.changes) {
      if (stopped()) return;
      try {
        if (!await act({ type: 'equip', residentId: change.residentId, itemId: change.itemId, slot: 'outfit' })) return;
        const resident = view.state.residents.find(item => item.id === change.residentId);
        if (resident?.outfitId !== change.itemId) throw new Error('穿戴结果未确认');
        log(`装备分配：${change.residentName} 穿上${change.itemName}（${statLabels[change.stat]} +${change.bonus}）。`);
      } catch (error) {
        if (error.fatal || error.stopped) throw error;
        log(`装备分配：${change.residentName} 换装失败：${error.message}。`);
        await read();
      }
    }
  }
  // 孩子出生后，父母立即回到生产岗位并穿戴对应装备。待产父母等待出生期间也可以工作：
  // 出生由服务端按 dueAt 结算，不要求父母在宿舍；现网已有多名待产父母在岗位上工作，
  // 服务端没有把他们拉回宿舍。宿舍里的待产组超过人口剩余空位（capacity - living）时，
  // 只保留离出生最近的若干组，其余调出一次；如果服务端又放回宿舍，就等出生，
  // 不再反复调出（pendingWorkDone）。
  // 待产记录和家庭冷却都在服务端状态里，刷新面板后同样有效。
  async function returnParents() {
    await returnPairedParents();
    if (stopped()) return;
    const now = view.serverTime;
    prunePairState(now);
    const pending = new Map();
    for (const birth of view.state.births) {
      for (const id of Array.isArray(birth.parents) ? birth.parents : []) pending.set(id, birth);
    }
    const survivors = [];
    for (const pair of task.autoPairs) {
      const [left, right] = pair.ids.map(id => view.state.residents.find(item => item.id === id));
      if (!left || !right || left.deadAt !== null || right.deadAt !== null) continue;
      // 服务端已经建立双向感情关系，临时配对任务完成；后续由 reuniteCouples 维护同房。
      if (left.romance?.partnerId === right.id && right.romance?.partnerId === left.id) continue;
      // 任一人已待产或已进入家庭冷却，说明配对完成，父母可以离开宿舍。
      const done = resident => pending.has(resident.id) || resident.familyCooldownUntil > now;
      if (done(left) || done(right)) continue;
      // 服务端可能在两次检查之间把整对配对接去另一间宿舍；只要两人仍在同一间
      // 宿舍，就按配对成功处理，避免把服务端正常换房误判为配对失败。
      const current = view.state.rooms.find(item => item.id === left.roomId);
      const together = current?.type === 'quarters' && left.roomId === right.roomId;
      if (together) {
        pair.roomId = left.roomId;
        pair.missedAt = null;
        survivors.push(pair);
        continue;
      }
      // 服务端结算时可能暂时搬动刚安排的居民。宽限期内保留配对记录，
      // 既不把他们撤出、也不重新配对；超过宽限期才放弃这次配对。
      // 但如果其中一方已经被安排到工作岗位、另一方还单独留在宿舍，说明这次
      // 配对已经失效，不再等 12 分钟宽限，让剩下的人尽快去工作或门外休息。
      const partnerRoom = view.state.rooms.find(item => item.id === right.roomId);
      const working = room => Boolean(room) && !['quarters', 'storage', 'door', 'elevator'].includes(room.type);
      const brokeApart = !left.romance && !right.romance && (working(current) || working(partnerRoom));
      if (!brokeApart) {
        pair.missedAt = pair.missedAt ?? now;
        if (now - pair.missedAt < pairGraceMs) {
          survivors.push(pair);
          continue;
        }
      }
      // 这对暂时配不成：冷却一段时间，期间两人正常工作/休息，不再进出宿舍。
      task.pairAttempts[pairKey(left, right)] = { at: now, until: now + pairRetryMs, roomId: pair.roomId };
      for (const resident of [left, right]) task.pairFailedUntil[resident.id] = now + pairPauseMs;
      log(`自动生育：${left.name}#${left.id} ＋ ${right.name}#${right.id} 未能留在同一间宿舍，暂停这对配对，稍后再试。`);
    }
    task.autoPairs = survivors;
    const pairing = new Set(task.autoPairs.flatMap(pair => pair.ids));
    const questTeams = questTeamIds();
    const candidates = view.state.residents.filter(resident => {
      if (pairing.has(resident.id)) return false;
      if (task.pendingDispatch[resident.id]) return false;
      if (questTeams.has(resident.id)) return false;
      if (protectedResident(resident)) return false;
      if (resident.deadAt !== null || resident.away !== null || resident.adultAt > view.serverTime) return false;
      const room = view.state.rooms.find(item => item.id === resident.roomId);
      if (room && room.type !== 'quarters') return false;
      // 待产父母等待出生期间可以回岗位。已经在门外的直接回去；还在宿舍的，
      // 离出生还有足够时间就调出工作，不占宿舍等出生。服务端如果再次放回宿舍
      // 就等出生，不再重复调出；服务端明确拒绝时记录冷却，避免每轮重复尝试。
      if (pending.has(resident.id)) {
        if ((task.pendingWorkBlocked[resident.id] ?? 0) > now) return false;
        if ((task.pendingWorkDone[resident.id] ?? 0) > now) return false;
        if (resident.roomId === null) return true;
        // 离出生不足 10 分钟才留在宿舍；其余待产父母先去工作/门外。
        const birth = pending.get(resident.id);
        return room?.type === 'quarters' && Number.isFinite(birth?.dueAt) &&
          birth.dueAt - now > pendingWorkLeadMs;
      }
      return resident.familyCooldownUntil > view.serverTime;
    }).sort((left, right) => left.id - right.id);
    for (const member of candidates) {
      if (stopped()) return;
      const resident = view.state.residents.find(item => item.id === member.id);
      if (!resident || resident.deadAt !== null || resident.away !== null) continue;
      const waitingBirth = pending.has(resident.id);
      const fromDorm = view.state.rooms.find(item => item.id === resident.roomId)?.type === 'quarters';
      const room = chooseProductionRoom(resident);
      // 宿舍里的待产父母即使没有生产空位也先去门外休息区，不继续占宿舍；
      // 已经在门外的待产父母没有空位就原地等待。
      if (!room && !(waitingBirth && fromDorm)) {
        logQuiet(`parent:${resident.id}`, `自动生育：${resident.name}#${resident.id} ${waitingBirth ? '待产中，暂无生产空位，留在门外休息区' : '生育完成，暂无生产空位，留在原处等待'}。`);
        continue;
      }
      const target = room?.id ?? null;
      try {
        if (!await act({ type: 'assign', residentId: resident.id, roomId: target })) return;
        if (view.state.residents.find(item => item.id === resident.id)?.roomId !== target) throw new Error(waitingBirth ? '待产父母回岗结果未确认' : '生育父母回岗结果未确认');
      } catch (error) {
        // 网络类错误照常交给本轮统一重试；只有服务端明确拒绝待产父母上岗时，
        // 才把这个人暂时移出待产回岗名单，等出生后按普通家庭冷却流程处理。
        if (!waitingBirth || error.stopped || !error.permanent) throw error;
        task.pendingWorkBlocked[resident.id] = view.serverTime + 30 * 60000;
        log(`自动生育：${resident.name}#${resident.id} 待产期间暂时不能安排岗位（${error.message}），等孩子出生后再回岗。`);
        await read();
        continue;
      }
      // 记住这次调出：如果服务端下一轮又把人放回宿舍，不再重复调出。
      if (waitingBirth) {
        const birth = pending.get(resident.id);
        task.pendingWorkDone[resident.id] = Math.max(
          Number.isFinite(birth?.dueAt) ? birth.dueAt + 3600000 : 0,
          view.serverTime + pendingWorkRememberMs);
      } else if (fromDorm) {
        // 家庭冷却中的居民调出后，若服务端又放回宿舍，
        // 先保持 30 分钟不再调出，避免每 30 秒来回搬。
        task.dormWorkHold[resident.id] = Math.max(
          task.dormWorkHold[resident.id] ?? 0, view.serverTime + cooldownWorkHoldMs);
      }
      const verb = waitingBirth ? (fromDorm ? '待产中，调出宿舍到' : '待产中，先回到') : '生育完成，回到';
      const where = room
        ? `${room.floor} 层 ${room.level} 级${roomLabels[room.type] ?? room.type}（房间 ${room.id}）`
        : '门外休息区';
      log(`自动生育：${resident.name}#${resident.id} ${verb}${where}。`);
    }
  }
  // 超出人口剩余空位的感情配对和未配对候选居民不占宿舍：一次性调去工作，
  // 生产满员就去门外休息区。调出后 12 小时内不再重聚、不再被自动配对拉回；
  // 若服务端仍把两人放回宿舍，也不再调出，避免形成“调出 → 拉回 → 再调出”的来回切。
  async function moveLowPriorityDormResidents() {
    const now = view.serverTime;
    const byId = new Map(view.state.residents.map(resident => [resident.id, resident]));
    const questTeams = questTeamIds();
    const pendingParents = new Set(view.state.births.flatMap(birth => birth.parents));
    const pairing = new Set(task.autoPairs.flatMap(pair => pair.ids));
    // 先认领同一间宿舍里已经能组成合格配对的居民：他们是在等服务端建立感情，
    // 不能当成“未配对”调出去。认领后再用 pairing 排除，避免场景 A 的来回搬动。
    if (!populationState().full) adoptCoLocatedPairs(pendingParents, questTeams, pairing);
    const inDorm = resident => view.state.rooms.find(room => room.id === resident.roomId)?.type === 'quarters';
    const eligible = resident => resident && resident.deadAt === null && resident.away === null &&
      resident.adultAt <= now && inDorm(resident) &&
      !pendingParents.has(resident.id) && !(resident.familyCooldownUntil > now) &&
      !task.pendingDispatch[resident.id] && !questTeams.has(resident.id) &&
      !protectedResident(resident) && !dormWorkHeld(resident) &&
      birthCandidate(resident);
    async function moveOut(resident, note) {
      const room = chooseProductionRoom(resident);
      const target = room?.id ?? null;
      if (!await act({ type: 'assign', residentId: resident.id, roomId: target })) return false;
      if (view.state.residents.find(item => item.id === resident.id)?.roomId !== target) throw new Error('低优先级宿舍调动结果未确认');
      task.dormWorkHold[resident.id] = view.serverTime + dormWorkHoldMs;
      task.autoPairs = task.autoPairs.filter(pair => !pair.ids.includes(resident.id));
      const where = room
        ? `${room.floor} 层 ${room.level} 级${roomLabels[room.type] ?? room.type}（房间 ${room.id}）`
        : '门外休息区';
      log(`自动生育：${resident.name}#${resident.id} ${note}，调出宿舍到${where}。`);
      return true;
    }
    // 超过人口剩余空位的感情配对（包括 100% 等出生空位的）和正在配对组一次性调出；
    // 待产组是否调出由 returnParents 按同一份保留名额处理。
    const { groups, keepIds } = dormGroupPlan();
    async function moveGroup(group, note) {
      const members = [...group.ids].map(id => byId.get(id)).filter(resident => resident && inDorm(resident));
      if (!members.length || !members.every(eligible)) return true;
      for (const resident of members) {
        if (!await moveOut(resident, note)) return false;
      }
      return true;
    }
    for (const group of groups) {
      if (stopped()) return;
      if (group.kind === 'pending') continue;
      if ([...group.ids].some(id => keepIds.has(id))) continue;
      const members = [...group.ids].map(id => byId.get(id));
      const note = !birthPairAllowed(...members) ? '配对不满足每项基础属性合计至少 19'
        : group.kind === 'romance'
        ? `感情 ${Math.round(group.progress * 100)}%，空闲配对超过人口空位`
        : '正在配对，超过人口空位';
      if (!await moveGroup(group, note)) return;
    }
    // 未配对的候选居民也不再占宿舍等配对；正在由扩展安排感情的对象保持不动。
    for (const resident of view.state.residents) {
      if (stopped()) return;
      if (!eligible(resident) || resident.romance || pairing.has(resident.id)) continue;
      if (!await moveOut(resident, '未找到合格配对')) return;
    }
  }
  // 宿舍只留给生育流程：人口已满时未配对的居民全部撤出；
  // 人口未满时按双方每项基础属性合计至少 19 保留配对，未达标组合调出工作。
  // 待产组、已有感情的双人组和正在配对组由 moveLowPriorityDormResidents
  // 按人口剩余空位统一保留（100% 空闲配对优先），这里只处理不在上述组里的居民。
  // 待产父母如果被服务端放回宿舍，就保留到出生，不再反复调出；
  // 低进度配对和未配对候选居民由 moveLowPriorityDormResidents 一次性调出，
  // 并在一段时间内不再重聚/重新配对。撤出时有生产空位就去岗位，
  // 没有空位直接去门外休息区，不再留在宿舍。
  async function evictIneligibleDormAdults() {
    const now = view.serverTime;
    prunePairState(now);
    const { full } = populationState();
    const pendingParents = new Set(view.state.births.flatMap(birth => birth.parents));
    const pairing = new Set(task.autoPairs.flatMap(pair => pair.ids));
    const questTeams = questTeamIds();
    // 人口未满时，宿舍里已经能组成合格配对的居民直接登记为配对并留下，
    // 避免因为临时配对记录丢失，把他们撤出去后又被自动生育拉回来。
    if (!full) adoptCoLocatedPairs(pendingParents, questTeams, pairing);
    const candidates = view.state.residents.filter(resident => {
      if (resident.deadAt !== null || resident.away !== null || resident.adultAt > now) return false;
      if (task.pendingDispatch[resident.id] || questTeams.has(resident.id)) return false;
      if (protectedResident(resident)) return false;
      const room = view.state.rooms.find(item => item.id === resident.roomId);
      if (room?.type !== 'quarters') return false;
      // 同一居民短时间被反复放回宿舍时先停手，避免每 30 秒调出一次。
      if (task.evictHoldUntil[resident.id] > now || recentlyMoved(resident.id) || dormWorkHeld(resident)) return false;
      // 待产父母如果被服务端放回宿舍，就等孩子出生，不再反复调出；
      // 已在外面工作的待产父母由 returnParents 处理。
      if (pendingParents.has(resident.id)) return false;
      // 人口已满：100% 配对通常已由 moveLowPriorityDormResidents 按空位调出；
      // 被服务端放回且仍在保护期内的不再反复调出，其余配对和未配对居民撤出。
      if (full) return !(resident.romance && resident.romance.progress >= 1 && hasQualifiedBirthPartner(resident));
      // 家庭冷却中的居民要等数小时才能再次生育，不应占着宿舍闲置，
      // 先去工作；生产满员时直接去门外休息区。
      if (resident.familyCooldownUntil > now) return true;
      // 以组合判断，避免把 9＋10 中属性为 9 的成员当成不合格居民撤出。
      return !hasQualifiedBirthPartner(resident);
    }).sort((left, right) => left.id - right.id);
    for (const member of candidates) {
      if (stopped()) return;
      const resident = view.state.residents.find(item => item.id === member.id);
      if (!resident || resident.deadAt !== null || resident.away !== null) continue;
      const room = view.state.rooms.find(item => item.id === resident.roomId);
      if (room?.type !== 'quarters') continue;
      const reason = full ? '人口已满，宿舍不再培养感情'
        : resident.familyCooldownUntil > now ? '家庭冷却中，不占宿舍' : '没有每项基础属性合计至少 19 的合格配对';
      const choice = chooseProductionRoom(resident);
      // 没有生产空位时直接去门外休息区，不再留在宿舍被服务端自动配对。
      const target = choice?.id ?? null;
      if (resident.roomId === target) continue;
      if (!await act({ type: 'assign', residentId: resident.id, roomId: target })) return;
      if (view.state.residents.find(item => item.id === resident.id)?.roomId !== target) throw new Error('居民调离宿舍结果未确认');
      // 人已经离开宿舍，临时配对记录不再成立，避免后续又按配对把他拉回来。
      task.autoPairs = task.autoPairs.filter(pair => !pair.ids.includes(resident.id));
      task.recentEvictions[resident.id] = view.serverTime;
      const last = task.evictCounts[resident.id];
      const count = last && last.at + evictRepeatWindowMs > view.serverTime ? last.count + 1 : 1;
      task.evictCounts[resident.id] = { at: view.serverTime, count };
      log(choice
        ? `自动生育：${resident.name}#${resident.id} ${reason}，安排到 ${choice.floor} 层${roomLabels[choice.type] ?? choice.type}（房间 ${choice.id}）。`
        : `自动生育：${resident.name}#${resident.id} ${reason}，暂无生产空位，先移到门外休息区。`);
      // 服务端连续把同一居民放回宿舍时，不再每轮都调出，先让他留在原处。
      if (count >= evictRepeatLimit) {
        task.evictHoldUntil[resident.id] = view.serverTime + evictHoldMs;
        log(`自动生育：${resident.name}#${resident.id} 多次被放回宿舍，暂时不再调出，避免来回切换。`);
      }
    }
  }
  // 已经建立感情关系但被调到不同宿舍的两人，重新安排到同一间宿舍继续积累感情；
  // 待产或家庭冷却中的不处理。优先使用成员当前所在的宿舍。
  async function reuniteCouples() {
    // 人口已满时不再培养感情，宿舍居民交给宿舍清理流程处理。
    if (populationState().full) return;
    const now = view.serverTime;
    const byId = new Map(view.state.residents.map(resident => [resident.id, resident]));
    const pending = new Set(view.state.births.flatMap(birth => birth.parents));
    const pairing = new Set(task.autoPairs.flatMap(pair => pair.ids));
    const seen = new Set();
    for (const resident of view.state.residents) {
      if (stopped()) return;
      if (seen.has(resident.id) || !resident.romance) continue;
      const partner = byId.get(resident.romance.partnerId);
      if (!partner || partner.romance?.partnerId !== resident.id) continue;
      seen.add(resident.id);
      seen.add(partner.id);
      const members = [resident, partner];
      if (members.some(item => item.deadAt !== null || item.away !== null || item.adultAt > now)) continue;
      // 等待再次派出的探险归来者留在门外，不拉回宿舍。
      if (members.some(item => task.pendingDispatch[item.id])) continue;
      // 本周任务小队成员在领取前不拉回宿舍。
      const questTeams = questTeamIds();
      if (members.some(item => questTeams.has(item.id))) continue;
      // 已有伴侣重聚也按双方每项基础属性合计至少 19 检查。
      if (!birthPairAllowed(resident, partner)) continue;
      if (members.some(item => pending.has(item.id) || item.familyCooldownUntil > now)) continue;
      const current = view.state.rooms.find(room => room.id === resident.roomId);
      if (current?.type === 'quarters' && resident.roomId === partner.roomId) continue;
      // 正在守门的一方保持在大门，不为了同房把守门居民拉走。
      const partnerRoom = view.state.rooms.find(room => room.id === partner.roomId);
      if (current?.type === 'door' || partnerRoom?.type === 'door') continue;
      if (members.some(item => protectedResident(item) || dormWorkHeld(item))) continue;
      const key = pairKey(resident, partner);
      if ((task.reuniteAt[key] ?? 0) + reuniteCooldownMs > now) continue;
      const fits = room => {
        const list = adultsIn(room.id);
        const moving = members.filter(member => member.roomId !== room.id).length;
        if (room.width * 2 - occupiedBeds(room.id) < moving) return false;
        if (pairsInRoom(room.id) >= pairCapacity(room)) return false;
        // 房内不能有其他未配对的成人，避免服务端把新来的人和别人凑成一对。
        return !list.some(item => !members.some(member => member.id === item.id) && !hasPartner(item, list));
      };
      const rooms = view.state.rooms.filter(room => room.type === 'quarters' && room.builtAt <= now &&
          room.upgradeAt === null && !room.unpowered && !room.incident && fits(room))
        .sort((left, right) => right.level - left.level || right.width - left.width || left.floor - right.floor || left.id - right.id);
      const room = rooms.find(item => item.id === resident.roomId) ?? rooms.find(item => item.id === partner.roomId) ?? rooms[0];
      if (!room) { logQuiet(`reunite:${resident.id}`, `自动生育：${resident.name}#${resident.id} ＋ ${partner.name}#${partner.id} 感情已建立但暂无可用宿舍，等待空位。`); continue; }
      for (const member of members) {
        rememberReturn(member, task.parentReturns, 'birth');
        task.parentReturns.find(entry => entry.residentId === member.id && entry.status === 'waiting').groupKey = key;
      }
      for (const member of members) {
        if (member.roomId === room.id) continue;
        if (!await act({ type: 'assign', residentId: member.id, roomId: room.id }, 'pair')) return;
        if (view.state.residents.find(item => item.id === member.id)?.roomId !== room.id) throw new Error('感情配对恢复结果未确认');
      }
      task.reuniteAt[key] = view.serverTime;
      if (!pairing.has(resident.id) || !pairing.has(partner.id)) {
        task.autoPairs.push({ roomId: room.id, ids: [resident.id, partner.id] });
        pairing.add(resident.id);
        pairing.add(partner.id);
      }
      const progress = Math.min(100, Math.floor((resident.romance.progress ?? 0) * 100));
      log(`自动生育：${resident.name}#${resident.id} ＋ ${partner.name}#${partner.id}（感情 ${progress}%）重新安排到同一间宿舍（房间 ${room.id}）。`);
    }
  }
  // 造神计划：成年子代（有父母且父母仍在避难所，含手动生育）属性总和未到 70 的优先训练，
  // 按总和从高到低排队，先练最高的未满属性；没有训练空位或已满 70 时按资源缺口和零件、
  // 废料等顺序安排生产岗位，不留在宿舍等待。
  async function assignGrownChildren() {
    const assigned = new Set(task.autoAssigned);
    const total = resident => keys.reduce((sum, key) => sum + resident.stats[key], 0);
    const occupied = roomId => shelterRoomOccupancy(view, roomId);
    function trainingRoom(resident) {
      return view.state.rooms.filter(room => room.type === 'training' && room.builtAt <= view.serverTime &&
          room.upgradeAt === null && !room.unpowered && !room.incident && keys.includes(room.trainStat) && (room.trainStat !== 'cha' || trainingOptions.trainCharisma) && (room.trainStat !== 'lck' || trainingOptions.trainLuck) &&
          occupied(room.id) < room.width * 2 && resident.stats[room.trainStat] < 10)
        .sort((left, right) => resident.stats[right.trainStat] - resident.stats[left.trainStat] ||
          right.level - left.level || right.width - left.width || left.floor - right.floor || left.id - right.id)[0] ?? null;
    }
    // 刷新面板后 autoParents 会丢失，因此按“父母仍在避难所”识别成年子代；
    // 无父母的新人、已在生产或训练岗位的居民不在其中。
    const living = new Set(view.state.residents.filter(resident => resident.deadAt === null).map(resident => resident.id));
    const pendingParents = new Set(view.state.births.flatMap(birth => birth.parents));
    const pairing = new Set(task.autoPairs.flatMap(pair => pair.ids));
    const questTeams = questTeamIds();
    const children = view.state.residents.filter(resident =>
      !assigned.has(resident.id) && resident.deadAt === null && resident.away === null && resident.adultAt <= view.serverTime &&
      resident.parents.length === 2 && resident.parents.every(id => living.has(id)) &&
      // 等待再次派出的探险归来者留在门外，不安排岗位。
      !task.pendingDispatch[resident.id] &&
      // 本周任务小队成员在领取前不安排岗位。
      !questTeams.has(resident.id) &&
      // 正在培养感情、待产或家庭冷却中的居民属于自动生育流程，不能当成成年子代调去工作。
      !resident.romance && !(resident.familyCooldownUntil > view.serverTime) &&
      // 人口未满时有合格伴侣的居民留在宿舍，不再调去训练或岗位。
      !awaitingPairingInDorm(resident) &&
      !pendingParents.has(resident.id) && !pairing.has(resident.id) && !protectedResident(resident))
      .sort((left, right) => total(right) - total(left) || left.id - right.id);
    for (const member of children) {
      if (stopped()) return;
      const resident = view.state.residents.find(item => item.id === member.id);
      if (!resident || assigned.has(resident.id) || resident.deadAt !== null || resident.away !== null ||
          resident.adultAt > view.serverTime) continue;
      const sum = total(resident);
      const currentRoom = view.state.rooms.find(item => item.id === resident.roomId);
      // 大门值守居民留在原地，不被成年子代安排流程调去训练或生产。
      if (currentRoom?.type === 'door') continue;
      if (currentRoom?.type === 'training' && sum < 70 && resident.stats[currentRoom.trainStat] < 10) continue;
      if (currentRoom && currentRoom.type !== 'training' && !['quarters', 'storage', 'door', 'elevator'].includes(currentRoom.type)) {
        // 已在生产岗位且未满 70 的成年子代，有空训练位时转去训练；否则保持岗位。
        const training = sum < 70 ? trainingRoom(resident) : null;
        if (training) {
          if (!await act({ type: 'assign', residentId: resident.id, roomId: training.id })) return;
          if (view.state.residents.find(item => item.id === resident.id)?.roomId !== training.id) throw new Error('训练安排结果未确认');
          log(`造神计划：${resident.name}#${resident.id}（属性 ${sum}/70）训练空位已出现，转练 ${statLabels[training.trainStat]} → ${training.floor} 层训练室（房间 ${training.id}）。`);
          continue;
        }
        task.autoAssigned.push(resident.id);
        assigned.add(resident.id);
        continue;
      }
      if (sum < 70) {
        const room = trainingRoom(resident);
        if (room) {
          if (!await act({ type: 'assign', residentId: resident.id, roomId: room.id })) return;
          if (view.state.residents.find(item => item.id === resident.id)?.roomId !== room.id) throw new Error('训练安排结果未确认');
          log(`造神计划：${resident.name}#${resident.id} 已成年（属性 ${sum}/70），优先训练 ${statLabels[room.trainStat]} → ${room.floor} 层训练室（房间 ${room.id}）。`);
          continue;
        }
      }
      // 没有训练空位时直接去生产岗位，不留在宿舍等待。
      const choice = chooseProductionRoom(resident);
      if (!choice) { logQuiet(`grown:${resident.id}`, `造神计划：${resident.name}#${resident.id} 已成年，暂无训练或生产空位，下轮继续。`); continue; }
      if (!await act({ type: 'assign', residentId: resident.id, roomId: choice.id })) return;
      if (view.state.residents.find(item => item.id === resident.id)?.roomId !== choice.id) throw new Error('成年居民安排结果未确认');
      task.autoAssigned.push(resident.id);
      assigned.add(resident.id);
      log(sum < 70
        ? `造神计划：${resident.name}#${resident.id} 已成年（属性 ${sum}/70），暂无训练空位，先安排到 ${choice.floor} 层${roomLabels[choice.type] ?? choice.type}（房间 ${choice.id}）。`
        : `造神计划：${resident.name}#${resident.id} 已成年且属性满 70，安排到 ${choice.floor} 层${roomLabels[choice.type] ?? choice.type}（房间 ${choice.id}）。`);
    }
  }
  // 大门值守：只从门外休息区补空位，不抽生产、训练或宿舍居民；
  // 已有守门居民保持不动。优先选不会马上被自动生育拉去配对的居民
  // （待产、冷却中、没有合格伴侣、心情不足），有合格伴侣的居民留给生育流程。
  // 调去大门后写入 gateHold：若服务端或手动操作又把人移出，同一人短时间内
  // 不再被放回大门，换下一个休息区居民；没有合适人选就留空，避免来回切。
  async function assignGateGuards() {
    // 事件归岗未完成时休息区居民只是暂时路过，不能当作闲置人口补去大门。
    if (task.incidentRestore) return;
    const now = view.serverTime;
    const doors = view.state.rooms.filter(room => room.type === 'door' && room.builtAt <= now &&
      room.upgradeAt === null && !room.unpowered && !room.incident)
      .sort((left, right) => left.id - right.id);
    if (!doors.length) return;
    const questTeams = questTeamIds();
    const pairing = new Set(task.autoPairs.flatMap(pair => pair.ids));
    const pendingParents = new Set(view.state.births.flatMap(birth => birth.parents));
    const total = resident => keys.reduce((sum, key) => sum + resident.stats[key], 0);
    const partnerOf = resident => resident.romance
      ? view.state.residents.find(item => item.id === resident.romance.partnerId)
      : null;
    const reserveBirth = task.birthEnabled && !populationState().full;
    const birthPool = reserveBirth ? view.state.residents.filter(availableForNewBirth) : [];
    const birthIds = new Set(birthPool.filter(left => birthPool.some(right =>
      birthPairAllowed(left, right) && pairCooldown(left, right) <= now)).map(resident => resident.id));
    const occupied = room => shelterRoomOccupancy(view, room.id);
    const eligible = resident => {
      if (resident.roomId !== null || resident.deadAt !== null || resident.away !== null || resident.adultAt > now) return false;
      if (task.pendingDispatch[resident.id] || task.newcomers.includes(resident.id) || questTeams.has(resident.id)) return false;
      if (protectedResident(resident) || gateHeld(resident) || pairing.has(resident.id)) return false;
      const pending = pendingParents.has(resident.id);
      if (pending) return true;
      if (resident.romance) {
        // 已有感情的配对不拆开：两人都在门外、感情未满 100% 时可以一起守门。
        // 低进度配对通常已被调出宿舍，留在休息区也不参与新配对，用来守门不会影响生育。
        const partner = partnerOf(resident);
        if (!(Number(resident.romance.progress) < 1)) return false;
        if (!partner || partner.id === resident.id || partner.roomId !== null || partner.deadAt !== null ||
            partner.away !== null || partner.adultAt > now || partner.romance?.partnerId !== resident.id) return false;
        if (task.pendingDispatch[partner.id] || task.newcomers.includes(partner.id) ||
            questTeams.has(partner.id) || protectedResident(partner) || gateHeld(partner) || pairing.has(partner.id)) return false;
        if (reserveBirth && birthPairAllowed(resident, partner) &&
            !dormWorkHeld(resident) && !dormWorkHeld(partner) &&
            !(resident.familyCooldownUntil > now) && !(partner.familyCooldownUntil > now)) return false;
        return true;
      }
      // 真正有合格伴侣可选的居民留给生育；无匹配对象时可以守门。
      return !birthIds.has(resident.id);
    };
    for (const door of doors) {
      let free = door.width * 2 - occupied(door);
      if (free <= 0) continue;
      const assignGuard = async resident => {
        try {
          if (!await act({ type: 'assign', residentId: resident.id, roomId: door.id })) return false;
          if (view.state.residents.find(item => item.id === resident.id)?.roomId !== door.id) throw new Error('大门值守安排结果未确认');
        } catch (error) {
          if (error.fatal || error.stopped) throw error;
          // 服务端可能在我们读取后把大门占满，或临时拒绝调动；本轮不再补位，
          // 30 秒后的快速检查会重新读取状态再试，不中断整轮托管。
          log(`大门：${resident.name}#${resident.id} 安排失败（${error.message}），本轮暂停补位。`);
          return false;
        }
        task.gateHold[resident.id] = view.serverTime + gateHoldMs;
        free--;
        log(`大门：${resident.name}#${resident.id} 从门外休息区安排到大门守门。`);
        return true;
      };
      const candidates = view.state.residents.filter(eligible)
        .sort((left, right) => right.stats.end - left.stats.end || total(right) - total(left) || left.id - right.id);
      for (const resident of candidates) {
        if (free <= 0 || stopped()) break;
        const current = view.state.residents.find(item => item.id === resident.id);
        if (!current || current.roomId !== null) continue;
        const partner = current.romance && Number(current.romance.progress) < 1 ? partnerOf(current) : null;
        // 有感情的一对必须同时进大门；只剩一个空位时先留给单人候选。
        if (partner && (free < 2 || !eligible(partner))) continue;
        if (!await assignGuard(current)) break;
        if (partner && free > 0) {
          const partnerNow = view.state.residents.find(item => item.id === partner.id);
          if (partnerNow && partnerNow.roomId === null) {
            if (!await assignGuard(partnerNow)) break;
          }
        }
      }
    }
  }
  // 门外待命区的归来居民：探险或本周任务结束回到门外、又不在“等待再次派出”名单时，
  // 安排到生产岗位。电台新居民保持门外；仍在任务中的成员、正在配对/待产/冷却的居民不处理。
  async function assignReturnedResidents() {
    const now = view.serverTime;
    // 人口已满时不再培养感情，门外居民可以安排生产岗位。
    const { full } = populationState();
    const pendingParents = new Set(view.state.births.flatMap(birth => birth.parents));
    const pairing = new Set(task.autoPairs.flatMap(pair => pair.ids));
    // 本周任务进行中的小队成员仍在门外，任务领取后才算归来。
    const questMembers = new Set((view.state.quests ?? []).flatMap(quest =>
      Array.isArray(quest.team) ? quest.team : quest.team?.members ?? []));
    const outside = view.state.residents.filter(resident =>
      resident.deadAt === null && resident.away === null && resident.adultAt <= now && resident.roomId === null &&
      !task.pendingDispatch[resident.id] && !task.newcomers.includes(resident.id) && !questMembers.has(resident.id) &&
      // 人口未满时，合格伴侣留给宿舍培养（由 reuniteCouples 拉回）。
      !(!full && hasQualifiedBirthPartner(resident) && resident.romance) &&
      !(resident.familyCooldownUntil > now) &&
      !pendingParents.has(resident.id) && !pairing.has(resident.id) && !protectedResident(resident))
      .sort((left, right) => left.id - right.id);
    for (const member of outside) {
      if (stopped()) return;
      const resident = view.state.residents.find(item => item.id === member.id);
      if (!resident || resident.deadAt !== null || resident.away !== null || resident.roomId !== null) continue;
      const choice = chooseProductionRoom(resident);
      if (!choice) { logQuiet(`outside:${resident.id}`, `门外归来：${resident.name}#${resident.id} 暂无生产空位，留在门外等待。`); continue; }
      if (!await act({ type: 'assign', residentId: resident.id, roomId: choice.id })) return;
      if (view.state.residents.find(item => item.id === resident.id)?.roomId !== choice.id) throw new Error('门外居民安排结果未确认');
      log(`门外归来：${resident.name}#${resident.id} 安排到 ${choice.floor} 层${roomLabels[choice.type] ?? choice.type}（房间 ${choice.id}）。`);
    }
  }
  // 本周废土任务：小队到家后领取。完成的任务不再重试，队员回到训练、生育、工作等正常调度；
  // 失败的任务记录原班人马，随后按同样的队伍重新派出。任务领取前，小队成员在其他调度中全部排除。
  // 自动周常开启时，还会把休息区（门外）闲置居民按等级从高到低每 3 人编成一队，
  // 休息区不足 3 人时从废料回收站的居民补（只补凑不满的队伍，不拆守门、在岗等受保护居民），
  // 出发前换上对任务战力提升最大的武器和服装，派往尚未完成的本周任务；游戏最多同时 2 支小队。
  // 进行中的小队不提前召回，事件处理中暂停新的派出。
  function residentLevel(resident) {
    return Math.min(50, 1 + Math.floor(Math.sqrt(Math.max(0, Number(resident.xp) || 0) / 3)));
  }
  function residentMaxHp(resident) {
    return Math.round(100 + (residentLevel(resident) - 1) * (2 + 0.5 * (Number(resident.stats.end) || 0)));
  }
  // 与游戏一致：任务战力 = 等级 ×2 + 力量 + 耐力 + 敏捷 + 武器伤害；
  // 服装加成按属性计入并在 17 封顶，只有力量、耐力、敏捷对任务战力有用。
  function questPower(resident) {
    const items = view.state.items ?? [];
    const outfit = resident.outfitId != null ? items.find(item => item.id === resident.outfitId) : null;
    const weapon = resident.weaponId != null ? items.find(item => item.id === resident.weaponId) : null;
    const stat = key => Math.min(17, (Number(resident.stats[key]) || 0) + (Number(outfit?.bonus?.[key]) || 0));
    const damage = Array.isArray(weapon?.damage) ?
      (Number(weapon.damage[0]) || 0) + (Number(weapon.damage[1]) || 0) : 0;
    return 2 * residentLevel(resident) + stat('str') + stat('end') + stat('agi') + damage;
  }
  // 游戏要求任务队员在家、成年且血量不低于上限的 50%。
  function questReady(resident) {
    return resident.deadAt === null && resident.away === null &&
      resident.adultAt <= view.serverTime && Number(resident.hp) >= 0.5 * residentMaxHp(resident);
  }
  // 休息区（门外）闲置居民：没有房间、在家、成年；排除等待再次派出的探险归来者、
  // 电台待改名新人、正在任务中的队员、自动生育配对，以及感情已满等待出生空位的配对。
  function questIdleResidents() {
    const questTeams = questTeamIds();
    const pairing = new Set(task.autoPairs.flatMap(pair => pair.ids));
    return view.state.residents.filter(resident =>
      resident.roomId === null && questReady(resident) &&
      !task.pendingDispatch[resident.id] && !protectedResident(resident) &&
      !task.newcomers.includes(resident.id) && !questTeams.has(resident.id) &&
      !pairing.has(resident.id) &&
      // 本轮刚在门外出现、还没走新人检查/改名的电台新居民先不派出。
      !(resident.parents.length === 0 && task.knownIds && !task.knownIds.includes(resident.id)) &&
      // 感情满的配对待产或等待人口空位，不派去长时间任务，避免打断生育流程。
      !(resident.romance && resident.romance.progress >= 1)
    ).sort((left, right) => residentLevel(right) - residentLevel(left) ||
      questPower(right) - questPower(left) || left.id - right.id);
  }
  // 休息区凑不满 3 人时，从废料回收站补人：只取在家、成年、血量达标且不受保护的居民。
  // 守门、配对、待产、刚被搬动或被临时保护的居民不动，避免为了派任务打断其他流程。
  function questScrapResidents() {
    const questTeams = questTeamIds();
    return view.state.residents.filter(resident => {
      if (resident.roomId == null || !questReady(resident)) return false;
      if (view.state.rooms.find(room => room.id === resident.roomId)?.type !== 'scrap') return false;
      return !task.pendingDispatch[resident.id] && !protectedResident(resident) &&
        !questTeams.has(resident.id) && !(resident.romance && resident.romance.progress >= 1);
    }).sort((left, right) => residentLevel(right) - residentLevel(left) ||
      questPower(right) - questPower(left) || left.id - right.id);
  }
  function weaponDamage(item) {
    return Array.isArray(item?.damage) ?
      (Number(item.damage[0]) || 0) + (Number(item.damage[1]) || 0) : 0;
  }
  // 服装对任务战力的实际提升：只算力量、耐力、敏捷，并按游戏规则在 17 封顶。
  function outfitGain(resident, current, item) {
    return ['str', 'end', 'agi'].reduce((sum, key) => {
      const base = Number(resident.stats[key]) || 0;
      const before = Math.min(17, base + (Number(current?.bonus?.[key]) || 0));
      const after = Math.min(17, base + (Number(item?.bonus?.[key]) || 0));
      return sum + after - before;
    }, 0);
  }
  // 可用装备：仓库里的，或穿在休息区闲置居民身上的；其他小队成员、
  // 正在岗位、外出或倒下居民身上的装备不转交。
  function questGearPool(slot, resident, teamIds) {
    const field = slot === 'weapon' ? 'weaponId' : 'outfitId';
    const owners = new Map();
    for (const item of view.state.residents) {
      if (item[field] != null) owners.set(item[field], item);
    }
    const idle = new Set(questIdleResidents().map(item => item.id));
    return (view.state.items ?? []).filter(item => item?.slot === slot && Number.isFinite(item.tier))
      .filter(item => {
        const owner = owners.get(item.id);
        if (!owner) return true;
        if (owner.id === resident.id) return true;
        // 其他小队成员的装备不互相扒，避免出发前反复换装。
        if (teamIds.has(owner.id)) return false;
        return owner.deadAt === null && owner.away === null && owner.adultAt <= view.serverTime &&
          idle.has(owner.id);
      });
  }
  // 只换能提高任务战力的装备；同提升幅度时优先等级高的。
  async function equipQuestTeam(team) {
    const teamIds = new Set(team.map(resident => resident.id));
    const members = [...team].sort((left, right) => residentLevel(right) - residentLevel(left) ||
      questPower(right) - questPower(left) || left.id - right.id);
    for (const slot of ['weapon', 'outfit']) {
      if (stopped()) return;
      const field = slot === 'weapon' ? 'weaponId' : 'outfitId';
      for (const member of members) {
        if (stopped()) return;
        let resident = view.state.residents.find(item => item.id === member.id);
        if (!resident || resident.deadAt !== null || resident.away !== null) continue;
        const currentId = resident[field];
        const current = currentId != null ? (view.state.items ?? []).find(item => item.id === currentId) : null;
        let best = null;
        let bestGain = 0;
        for (const item of questGearPool(slot, resident, teamIds)) {
          if (item.id === currentId) continue;
          const gain = slot === 'weapon' ? weaponDamage(item) - weaponDamage(current) : outfitGain(resident, current, item);
          if (gain <= 0) continue;
          if (!best || gain > bestGain ||
              (gain === bestGain && (item.tier > best.tier ||
                (item.tier === best.tier && item.id < best.id)))) {
            best = item;
            bestGain = gain;
          }
        }
        if (!best) continue;
        try {
          if (!await act({ type: 'equip', residentId: resident.id, itemId: best.id, slot })) return;
          resident = view.state.residents.find(item => item.id === resident.id);
          if (!resident || resident[field] !== best.id) throw new Error('穿戴结果未确认');
          log(`本周任务：${resident.name} 换上 ${best.tier} 级${best.name}（${slot === 'weapon' ? '武器' : '服装'}，任务战力 +${bestGain}）。`);
        } catch (error) {
          if (error.fatal || error.stopped) throw error;
          log(`本周任务：${resident.name} 换装失败：${error.message}。`);
          try { await read(); } catch (readError) { if (readError.fatal || readError.stopped) throw readError; }
        }
      }
    }
  }
  // 三个人的任务小队才允许出发；装备后提交 quest_start，并核对返回的任务记录。
  async function dispatchQuest(quest, team, retry = false) {
    if (team.length < 3) return false;
    if (task.questEnabled) await equipQuestTeam(team);
    if (stopped()) return false;
    const ids = team.map(resident => resident.id);
    try {
      if (!await act({ type: 'quest_start', questId: quest.id, team: ids })) return false;
      const run = (view.state.quests ?? []).find(item => item.questId === quest.id &&
        Array.isArray(item.team) && ids.every(id => item.team.includes(id)));
      if (!run) throw new Error('任务派出结果未确认');
      delete task.questStartBlocked[quest.id];
      const members = ids.map(id => view.state.residents.find(resident => resident.id === id));
      const names = members.map(resident => resident ?
        `${resident.name}（${residentLevel(resident)} 级，战力 ${questPower(resident)}）` : `#${id}`).join('、');
      log(`本周任务：${quest.title ?? quest.id} ${retry ? '已重新派出' : '已派出'}：${names}。`);
      return true;
    } catch (error) {
      if (error.fatal || error.stopped) throw error;
      // 失败后冷却一段时间再试，避免每 30 秒重复提交同一个任务。
      task.questStartBlocked[quest.id] = view.serverTime + 10 * 60000;
      log(`本周任务：${quest.title ?? quest.id} 派出失败：${error.message}，稍后再试。`);
      try { await read(); } catch (readError) { if (readError.fatal || readError.stopped) throw readError; }
      return false;
    }
  }
  async function handleWeeklyQuests() {
    const now = view.serverTime;
    const definitions = Array.isArray(view.env?.quests) ? view.env.quests.filter(quest => quest?.id != null) : [];
    const titleOf = questId => definitions.find(quest => quest.id === questId)?.title ?? questId;
    // 新的一周重置本周任务的完成与重试记录，避免沿用上周的任务状态。
    const week = view.env?.week ?? view.state.weekly?.week ?? null;
    if (week && task.questWeek !== week) {
      task.questWeek = week;
      task.questDone = [];
      task.questRetries = {};
      task.questStartBlocked = {};
      task.questLogAt = {};
      task.questDoneNotice = false;
    }
    for (const [questId, until] of Object.entries(task.questStartBlocked)) {
      if (!(until > now)) delete task.questStartBlocked[questId];
    }
    for (const [questId, at] of Object.entries(task.questLogAt)) {
      if (!(at + 10 * 60000 > now)) delete task.questLogAt[questId];
    }
    const runs = Array.isArray(view.state.quests) ? view.state.quests : [];
    for (const run of [...runs]) {
      if (stopped()) return;
      if (run.returnAt === null || run.returnAt > view.serverTime) continue;
      const team = Array.isArray(run.team) ? [...run.team] : [];
      const failed = run.status === 'failed';
      const title = titleOf(run.questId);
      try {
        if (!await act({ type: 'quest_claim', runId: run.id })) return;
      } catch (error) {
        if (error.fatal || error.stopped) throw error;
        log(`本周任务：${title} 领取失败：${error.message}`);
        continue;
      }
      log(failed ? `本周任务：${title} 失败，小队已回家，准备原班人马重试。` : `本周任务：${title} 完成，小队已回家。`);
      if (failed && team.length) task.questRetries[run.questId] = team;
      // 服务端完成列表可能晚一拍更新，扩展自己记住本次完成的任务，避免领取后再次派出。
      if (!failed && !task.questDone.includes(run.questId)) task.questDone.push(run.questId);
    }
    const done = new Set([...(view.state.weekly?.completed ?? []), ...task.questDone]);
    for (const questId of Object.keys(task.questRetries)) {
      if (done.has(questId)) delete task.questRetries[questId];
    }
    const busy = incidentsBlockAutomation();
    const idlePool = questIdleResidents();
    const active = new Set((view.state.quests ?? []).map(run => run.questId));
    const activeTeams = questTeamIds();
    const claimed = new Set();
    // 游戏同一时间只允许 2 支任务小队（进行中和返程中都计入），重试和派人共用这个上限。
    const runningCount = () => (view.state.quests ?? [])
      .filter(run => run.status === 'active' || run.status === 'returning').length;
    // 失败任务优先重试：原班人马仍然可用时优先使用，人数不足 3 人时用休息区闲置居民补齐。
    for (const [questId, team] of Object.entries(task.questRetries)) {
      if (stopped()) return;
      if (done.has(questId)) { delete task.questRetries[questId]; continue; }
      if (active.has(questId) || task.questStartBlocked[questId] > now || busy) continue;
      if (runningCount() >= 2) break;
      const members = [];
      for (const id of team) {
        if (members.length >= 3) break;
        if (claimed.has(id)) continue;
        const resident = view.state.residents.find(item => item.id === id);
        if (!resident || activeTeams.has(resident.id) || !questReady(resident)) continue;
        if (!members.some(item => item.id === resident.id)) members.push(resident);
      }
      for (const resident of [...idlePool, ...questScrapResidents()]) {
        // 未开启自动周常时不主动补新人，仍只用原班人马重试。
        if (!task.questEnabled || members.length >= 3) break;
        if (claimed.has(resident.id) || members.some(item => item.id === resident.id)) continue;
        members.push(resident);
      }
      for (const resident of members) {
        claimed.add(resident.id);
        const index = idlePool.findIndex(item => item.id === resident.id);
        if (index >= 0) idlePool.splice(index, 1);
      }
      if (members.length < 3) {
        if (!task.questLogAt[questId]) {
          task.questLogAt[questId] = now;
          log(`本周任务：${titleOf(questId)} 现在只能凑齐 ${members.length} 人，等满 3 人再重试。`);
        }
        continue;
      }
      const quest = definitions.find(item => item.id === questId) ?? { id: questId, title: titleOf(questId) };
      if (!await dispatchQuest(quest, members, true)) {
        if (stopped()) return;
        continue;
      }
      delete task.questRetries[questId];
      active.add(questId);
    }
    const remaining = definitions.filter(quest => !done.has(quest.id));
    if (task.questEnabled && definitions.length && !remaining.length && !task.questDoneNotice) {
      task.questDoneNotice = true;
      log('本周任务：全部完成，不再派出新的任务小队。');
    }
    if (!task.questEnabled || busy) return;
    // 未完成、没有进行中/待领取小队、没有失败重试和冷却的任务，优先派等级要求最高的。
    const pending = remaining.filter(quest => !active.has(quest.id) &&
        !task.questRetries[quest.id] && !(task.questStartBlocked[quest.id] > now))
      .sort((left, right) => (Number(right.recommendedLevel) || 0) - (Number(left.recommendedLevel) || 0) ||
        (Number(right.difficulty) || 0) - (Number(left.difficulty) || 0) ||
        String(left.id).localeCompare(String(right.id)));
    // 休息区闲置居民按等级从高到低编组，同等级按战力，每组 3 人；休息区不足 3 人时
    // 从废料回收站补（只补凑不满的队伍，不拆散已经在休息区编好的高等级居民）。
    // 游戏最多同时 2 支小队，重试已经占用名额时这里相应少派。
    let pendingIndex = 0;
    while (pendingIndex < pending.length && idlePool.length + questScrapResidents().length >= 3) {
      if (stopped()) return;
      if (runningCount() >= 2) break;
      const team = idlePool.splice(0, Math.min(3, idlePool.length));
      for (const resident of questScrapResidents()) {
        if (team.length >= 3) break;
        team.push(resident);
      }
      if (team.length < 3) break;
      const quest = pending[pendingIndex++];
      if (!await dispatchQuest(quest, team)) {
        if (stopped()) return;
        continue;
      }
      active.add(quest.id);
    }
    if (pendingIndex < pending.length && idlePool.length + questScrapResidents().length >= 3 && runningCount() >= 2 &&
        !task.questLogAt.__questCap__) {
      task.questLogAt.__questCap__ = now;
      log('本周任务：已有 2 支小队在任务中，等有队伍回来再派新队。');
    }
  }
  // 训练室里的居民某项练满 10 后不用等完整检查间隔：快速检查时只撤出这些居民，
  // 转到下一项训练或生产岗位；不重新补人、不搬门外居民，避免每 30 秒大面积调动。
  async function rotateFinishedTrainees() {
    if (incidentsBlockAutomation()) return;
    const excluded = protectedIds();
    for (const id of task.newcomers) excluded.add(id);
    for (const id of Object.keys(task.pendingDispatch)) excluded.add(Number(id));
    const plan = planShelterGod(view, excluded, true, false, trainingOptions);
    for (const { residentId, roomId, message } of plan.assignments) {
      if (stopped()) break;
      if (!await act({ type: 'assign', residentId, roomId })) break;
      if (view.state.residents.find(resident => resident.id === residentId)?.roomId !== roomId) throw new Error('造神计划调动结果未确认');
      log(message);
    }
  }
  // 练满 70 的休息区居民：生产岗位出现空位时补进去。安排在大门值守之后执行，
  // 让守门先选人；岗位仍满员时继续留在门外休息，不占训练位。
  async function assignIdleMaxedToJobs() {
    if (incidentsBlockAutomation()) return;
    const excluded = protectedIds();
    for (const id of task.newcomers) excluded.add(id);
    for (const id of Object.keys(task.pendingDispatch)) excluded.add(Number(id));
    const plan = planShelterGod(view, excluded, false, true, trainingOptions);
    for (const { residentId, roomId, message } of plan.assignments) {
      if (stopped()) break;
      if (!await act({ type: 'assign', residentId, roomId })) break;
      if (view.state.residents.find(resident => resident.id === residentId)?.roomId !== roomId) throw new Error('造神计划调动结果未确认');
      log(message);
    }
  }
  // 事件结束后按事件前的完整分配归岗：先恢复所有能恢复的居民，再恢复调度。
  // 不先腾空房间，避免事件结束瞬间把居民成批撤到门外；目标房间满员时留给游戏/后续调度。
  async function restoreIncidentPositions() {
    const baseline = task.incidentRestore;
    if (!baseline) return { attempted: false, incomplete: false, retry: false };
    const target = new Map(baseline.map(({ residentId, roomId }) => [residentId, roomId]));
    const eligible = resident => resident && resident.away === null && resident.deadAt === null;
    const pendingList = () => view.state.residents.filter(resident =>
      eligible(resident) && target.has(resident.id) && resident.roomId !== target.get(resident.id));
    let pending = pendingList();
    const total = pending.length;
    let restored = 0;
    let paused = false;
    const incidentActive = () => view.state.rooms.some(blockingIncident);
    for (let pass = 0; pass < 3 && pending.length && !paused; pass++) {
      let progress = false;
      for (const resident of pending) {
        if (stopped()) break;
        // 归位请求会刷新事件状态；新事件出现时保留事件前分配，先暂停归位。
        if (incidentActive()) { paused = true; break; }
        const roomId = target.get(resident.id);
        if (resident.roomId === roomId) continue;
        if (roomId !== null) {
          const room = view.state.rooms.find(item => item.id === roomId);
          const occupied = view.state.residents.filter(item => item.roomId === roomId && item.deadAt === null).length;
          // 宿舍容量按游戏人口公式（宽度 ×(2+2×等级)），生产房间每格 2 人。
          const capacity = room ? (room.type === 'quarters' ? room.width * (2 + 2 * room.level) : room.width * 2) : 0;
          if (!room || occupied >= capacity) continue;
        }
        try {
          if (!await act({ type: 'assign', residentId: resident.id, roomId }, 'incident-restore')) break;
        } catch (error) {
          if (error.fatal || error.stopped) throw error;
          log(`事件恢复：${resident.name}#${resident.id} 无法回到${roomId === null ? '门外休息区' : `房间 ${roomId}`}：${error.message}。`);
          try { await read(); } catch (readError) { if (readError.fatal || readError.stopped) throw readError; }
          continue;
        }
        if (view.state.residents.find(item => item.id === resident.id)?.roomId !== roomId) {
          log(`事件恢复：${resident.name}#${resident.id} 恢复结果未确认。`);
        } else {
          restored++;
          progress = true;
        }
      }
      if (stopped() || paused) break;
      pending = pendingList();
      if (!progress) break;
    }
    // 最后一人的归位请求也可能触发新事件，循环结束后再确认一次。
    if (!paused && incidentActive()) paused = true;
    if (paused) {
      log(`事件恢复：归位期间出现新事件，暂停归位并保留事件前站位${restored ? `（已恢复 ${restored} 人）` : ''}。`);
      return { attempted: total > 0, incomplete: true, retry: false, paused: true };
    }
    const skipped = pending.length;
    if (!total) {
      log('事件已结束：居民已由游戏自动归岗，无需额外恢复。');
    } else {
      log(`事件恢复：按事件前分配恢复 ${restored} 人${skipped ? `，仍有 ${skipped} 人未能归位` : '，站位已全部恢复'}。`);
    }
    // 少数居民可能因原房间已拆、满员或游戏限制暂时回不去。再试一轮，仍不行就交给正常调度。
    const retry = skipped > 0 && task.incidentRestoreTries < 1;
    if (skipped) {
      log(retry
        ? `事件恢复：仍有 ${skipped} 人未能回到事件前位置，下一轮再试。`
        : `事件恢复：仍有 ${skipped} 人未能回到事件前位置，交由后续调度安排。`);
    }
    if (retry) {
      task.incidentRestoreTries++;
      return { attempted: total > 0, incomplete: true, retry: true };
    }
    task.incidentRestore = null;
    task.incidentRestoreTries = 0;
    return { attempted: total > 0, incomplete: skipped > 0, retry: false };
  }
  // 快速检查：成年子代安排训练或工作、待产父母回岗、配对后补资源缺口、穿上装备，
  // 不必等完整检查间隔。
  async function quickCheck() {
    await read();
    if (stopped()) return;
    if (await handleIncidents() || stopped()) return;
    await returnPairedParents();
    if (stopped()) return;
    if (incidentsBlockAutomation()) return;
    // 本周任务到家的领取和失败重试也要及时处理，不必等完整检查间隔。
    await handleWeeklyQuests();
    if (stopped()) return;
    // 大门空位不必等完整检查间隔：休息区出现合适居民时及时补齐，
    // gateHold 会避免同一居民被移出后马上放回。
    await assignGateGuards();
    if (stopped()) return;
    if (godEnabled) {
      // 练满 70 的休息区居民在岗位有空位时上岗；守门已经先选过人。
      await assignIdleMaxedToJobs();
      if (stopped()) return;
    }
    if (task.birthEnabled) await returnParents();
    if (stopped()) return;
    if (task.birthEnabled) await moveLowPriorityDormResidents();
    if (stopped()) return;
    if (task.birthEnabled) await evictIneligibleDormAdults();
    if (stopped()) return;
    if (task.birthEnabled) await reuniteCouples();
    if (stopped()) return;
    if (task.birthEnabled) await autoBirth(true);
    if (stopped()) return;
    // 配对把人调去宿舍后可能立刻出现电力、食物、净水缺口，马上从废料回收站等岗位补人。
    await balanceResources();
    if (stopped()) return;
    if (godEnabled) {
      // 练满当前训练项的居民立即转下一站，不用等完整检查间隔。
      await rotateFinishedTrainees();
      if (stopped()) return;
    }
    if (task.birthEnabled) await assignGrownChildren();
    if (stopped()) return;
    if (task.birthEnabled) await assignReturnedResidents();
    if (stopped()) return;
    await upgradeRooms();
    if (stopped()) return;
    await applyOutfits();
    if (stopped()) return;
  }
  (async () => {
    try {
      if (location.origin !== 'https://game.arkengine.me' || !/^\/shelter\/?$/.test(location.pathname)) throw new Error('请在自己的避难所页面开启');
      if (globalThis.__fengbaoWorkAssignment?.running || globalThis.__fengbaoDormAssignment?.running || globalThis.__fengbaoEquipmentAssignment?.running || globalThis.__fengbaoResidentRename?.running) throw new Error('其他居民任务正在运行，请等待完成');
      if (task.targetEnabled && logStorage && !task.targetProgress) {
        try {
          const stored = await logStorage.get('shelterTargetProgress');
          if (stored?.shelterTargetProgress) task.targetProgress = stored.shelterTargetProgress;
        } catch {}
      }
      if (task.targetProgress) await saveTargetProgress(task.targetProgress);
      let greeted = false, roundError = false, consecutiveErrors = 0;
      while (!stopped()) {
        if (globalThis.__fengbaoDormAssignment?.running || globalThis.__fengbaoWorkAssignment?.running || globalThis.__fengbaoEquipmentAssignment?.running || globalThis.__fengbaoResidentRename?.running) {
          task.cycleRunning = false;
          await wait(1000);
          continue;
        }
        task.cycleRunning = true;
        try {
        // 归岗轮会 break 到这里结束本轮，保证“先完全恢复事件前分配，再调度”。
        roundSteps: {
          // 与页面右上角刷新、全部收取按钮使用相同接口，不刷新整张网页。
          await read();
          if (stopped()) break;
          if (!greeted) {
            // 首次开启纳入门外无父母的成人；之后以新增 ID 识别电台新居民，不碰原岗位。
            if (!task.knownIds) {
              task.knownIds = view.state.residents.map(resident => resident.id);
              if (view.state.rooms.some(room => room.type === 'radio')) task.newcomers = view.state.residents.filter(resident => resident.roomId === null && resident.away === null && resident.deadAt === null && resident.adultAt <= view.serverTime && resident.parents.length === 0).map(resident => resident.id);
            }
            // 每次开启重新记录已有名单，停用期间到来的居民也不参与自动遣散。
            task.knownIds = view.state.residents.map(resident => resident.id);
            greeted = true;
            log(`托管开启：每 ${intervalSeconds} 秒检查，废土 ${recallEvents} 次事件召回${task.birthEnabled ? '，自动生育已开启' : ''}${task.targetEnabled ? `，目标建造 ${task.targetCount} 格${shelterUpgradeLabels[task.targetRoom] ?? task.targetRoom}` : ''}。`);
          }
          await act({ type: 'collect_all' });
          if (stopped()) break;
          if (await handleIncidents()) break roundSteps;
          if (stopped()) break;
          await returnPairedParents();
          if (stopped()) break;
          // 本周任务到家后领取；完成的任务放回正常调度，失败的任务按原班人马重试。
          await handleWeeklyQuests();
          if (stopped()) break;
          const hasRadio = view.state.rooms.some(room => room.type === 'radio' && room.builtAt <= view.serverTime);
          if (hasRadio) {
            for (const resident of view.state.residents) if (!task.knownIds.includes(resident.id) && resident.parents.length === 0 && resident.adultAt <= view.serverTime && resident.roomId === null && resident.away === null && resident.deadAt === null && !shelterCoordination(view).protectedIds.has(resident.id)) {
              if (stopped()) break;
              if (populationOptions.enabled && populationIdle(resident) && populationTotal(resident) < populationOptions.total) {
                if (!task.populationPending.includes(resident.id)) task.populationPending.push(resident.id);
                task.newcomers.push(resident.id);
                continue;
              }
              // 只在首次发现门外新成人时判断，已有居民和旧待改名队列不参与遣散。
              if (dismissEnabled || dismissStatEnabled) {
                const values = ['str', 'per', 'end', 'cha', 'int', 'agi', 'lck'].map(key => resident.stats[key]);
                if (!values.every(Number.isFinite)) throw new Error('新居民属性数据不完整，无法判断遣散');
                const total = values.reduce((sum, value) => sum + value, 0);
                // 单项条件只判断用户指定的基础属性。
                const statValue = resident.stats[dismissStatKey];
                // 面板单选总属性或指定属性，对选中的条件判断遣散。
                const totalTooLow = dismissEnabled && total < dismissTotal;
                const statTooLow = dismissStatEnabled && statValue < dismissStat;
                if (totalTooLow || statTooLow) {
                  if (!await act({ type: 'dismiss', residentId: resident.id })) break;
                  if (view.state.residents.some(item => item.id === resident.id)) throw new Error('新人遣散结果未确认');
                  log(`新人遣散：${resident.name}（ID ${resident.id}），${totalTooLow ? `总属性 ${total} < ${dismissTotal}` : `${statLabels[dismissStatKey]} ${statValue} < ${dismissStat}`}。`);
                  continue;
                }
              }
              task.newcomers.push(resident.id);
            }
          }
          task.knownIds = view.state.residents.map(resident => resident.id);
          log(hasRadio ? `新人检查：待改名 ${task.newcomers.length} 人。` : '没有电台，跳过新人检查。');
          if (hasRadio) for (const id of [...task.newcomers]) {
            if (stopped()) break;
            let resident = view.state.residents.find(item => item.id === id);
            if (!resident || resident.roomId !== null || resident.away !== null || resident.deadAt !== null) { task.newcomers = task.newcomers.filter(item => item !== id); continue; }
            if (shelterCoordination(view).protectedIds.has(id)) continue;
            if (populationOptions.enabled && task.populationPending.includes(id)) continue;
            const attributes = [['str', '力'], ['per', '感'], ['end', '耐'], ['cha', '魅'], ['int', '智'], ['agi', '敏'], ['lck', '幸']];
            const highest = Math.max(...attributes.map(([key]) => resident.stats[key]));
            const label = attributes.filter(([key]) => resident.stats[key] === highest).map(([,label]) => label).join('');
            const numbers = view.state.residents.map(item => item.name.match(/^(\d+)(?:\([\d,]+\))?([A-Z]*)$/) || item.name.match(/^[^-]+-(\d+)([A-Z]*)$/));
            const own = resident.name.match(/^(\d+)(?:\([\d,]+\))?([A-Z]*)$/) || resident.name.match(/^[^-]+-(\d+)([A-Z]*)$/);
            const number = own ? Number(own[1]) : Math.max(0, ...numbers.filter(Boolean).map(match => Number(match[1]))) + 1;
            const name = resident.name.includes('★') ? resident.name : `${label}-${String(number).padStart(3, '0')}${own?.[2] ?? ''}`;
            if (name !== resident.name && name.length > 12) throw new Error(`新名字 ${name} 超过 12 字`);
            if (resident.name !== name) {
              if (!await act({ type: 'rename_resident', residentId: id, name })) break;
              resident = view.state.residents.find(item => item.id === id);
              if (resident.name !== name) throw new Error('新人改名结果未确认');
              log(`新人改名：${name}（ID ${id}）。`);
            }
            const model = workforceModel(view, trainingOptions);
            const attributesForJobs = ['str', 'per', 'end', 'cha', 'int', 'agi'];
            const maximum = Math.max(...attributesForJobs.map(key => resident.stats[key]));
            const available = model.rooms.filter(room => shelterRoomOccupancy(view, room.id) < room.width * 2);
            const jobs = available.filter(room => room.type !== 'training' && resident.stats[model.types[room.type].stat] === maximum);
            if (jobs.some(room => room.type === 'workshop')) jobs.splice(0, jobs.length, ...jobs.filter(room => room.type !== 'medbay'));
            const training = available.filter(room => room.type === 'training' && workforceTrainingAllowed(resident, room, trainingOptions))
              .sort((left, right) => resident.stats[right.trainStat] - resident.stats[left.trainStat]);
            const target = jobs[0] ?? training[0] ?? chooseProductionRoom(resident);
            if (target && await act({ type: 'assign', residentId: id, roomId: target.id })) {
              task.newcomers = task.newcomers.filter(item => item !== id);
              log('新人安排：' + name + ' → 房间 ' + target.id + '。');
            } else logQuiet('new:' + id, '新人 ' + name + ' 暂无合适空位，留在门外等待。');
          }
          if (stopped()) break;
          const paused = () => incidentsBlockAutomation();
          // 先补电力、食物、净水缺口，再考虑训练和造神转岗，保证资源不因训练抽人转负。
          if ((godEnabled || task.birthEnabled) && paused()) log('资源补缺：事件处理中，暂停居民调动。');
          else if (godEnabled || task.birthEnabled) await balanceResources();
          if (stopped()) break;
          if (godEnabled) {
            // 事件归位完成后再调整训练岗位，避免新安排被归岗覆盖。
            if (paused()) log('造神计划：事件处理中，暂停居民调动。');
            else {
              // 资源补缺刚搬过的居民本轮不再被造神计划搬第二次；
              // 待改名/待遣散的新人和等待再次派出的归来者留在门外，不参与训练补位。
              const excluded = protectedIds();
              for (const id of task.newcomers) excluded.add(id);
              for (const id of Object.keys(task.pendingDispatch)) excluded.add(Number(id));
              const plan = planShelterGod(view, excluded, false, false, trainingOptions);
              log(`造神计划：检查完成，本轮 ${plan.assignments.length} 步调动。`);
              for (const { residentId, roomId, message } of plan.assignments) {
                if (!await act({ type: 'assign', residentId, roomId })) break;
                if (view.state.residents.find(resident => resident.id === residentId).roomId !== roomId) throw new Error('造神计划调动结果未确认');
                log(message);
              }
            }
          }
          if (stopped()) break;
          if ((godEnabled || task.birthEnabled) && paused()) log('大门值守：事件处理中，暂停居民调动。');
          else if (godEnabled || task.birthEnabled) await assignGateGuards();
          if (stopped()) break;
          // 守门补齐后再让练满 70 的休息区居民补生产空位，避免守门被岗位抢人。
          if (godEnabled && !paused()) await assignIdleMaxedToJobs();
          if (stopped()) break;
          await optimizePopulation();
          if (stopped()) break;
          if (task.birthEnabled) {
            if (stopped()) break;
            // 与造神计划一致，事件处理或事件归位未完成时暂停居民调动。
            if (paused()) log('自动生育：事件处理中，暂停居民调动。');
            else {
              await returnParents();
              if (stopped()) break;
              await moveLowPriorityDormResidents();
              if (stopped()) break;
              await evictIneligibleDormAdults();
              if (stopped()) break;
              await reuniteCouples();
              if (stopped()) break;
              await autoBirth();
              if (stopped()) break;
              await assignGrownChildren();
              if (stopped()) break;
              await assignReturnedResidents();
            }
          }
          if (stopped()) break;
          // 造神计划和自动生育调动结束后再补一次缺口：配对把居民拉去宿舍后可能出现负收益。
          if ((godEnabled || task.birthEnabled) && !paused()) await balanceResources();
          if (stopped()) break;
          // 同种资源有空位时，把低等级房间的居民迁到高等级房间。
          if ((godEnabled || task.birthEnabled) && !paused()) await upgradeRooms();
          if (stopped()) break;
          // 岗位调整完成后统一穿戴装备：按房间需要的属性重新分配服装。
          if ((godEnabled || task.birthEnabled) && paused()) log('装备分配：事件处理中，暂停换装。');
          else if (godEnabled || task.birthEnabled) await applyOutfits();
          if (stopped()) break;
          let targetActive = false;
          // 目标建造和普通升级都是施工操作，与居民调度、事件无关；有施工位和资源就继续。
          if (task.targetEnabled) targetActive = await autoBuildTarget();
          if (stopped()) break;
          if (task.upgradeEnabled) await autoUpgrade(targetActive);
          if (stopped()) break;
          log(view.state.explorers.length ? `废土检查：${view.state.explorers.length} 名探险者。` : '没有外出探险人员，跳过废土检查。');
          for (const original of [...view.state.explorers]) {
            if (stopped()) break;
            const explorer = view.state.explorers.find(item => item.id === original.id);
            const config = deployment(explorer);
            const resident = view.state.residents.find(item => item.id === explorer.residentId);
            if (resident.deadAt !== null) { log(`废土：${resident.name} 已倒下，请手动救回。`); continue; }
            if (explorer.returnAt !== null && explorer.returnAt <= view.serverTime) {
              if (!await act({ type: 'explore_claim', explorerId: explorer.id })) break;
              if (view.state.explorers.some(item => item.id === explorer.id)) throw new Error('探险领取结果未确认');
              task.pendingDispatch[resident.id] = { ...config, healed: false };
              delete task.deployments[explorer.id];
              log(`废土：${resident.name} 已到家并领取，准备原样再次派出。`);
            } else if (explorer.recalledAt !== null) log(`废土：${resident.name} 正在返程。`);
            else {
              // events 是服务端实际事件次数，不包含 startedAt 对应的初始出发日志。
              if (!Number.isInteger(explorer.events)) throw new Error('废土事件计数格式已变化');
              log(`废土：${resident.name} 已触发 ${explorer.events}/${recallEvents} 次事件（不含出发日志）。`);
              if (explorer.events >= recallEvents) {
                if (!await act({ type: 'explore_recall', explorerId: explorer.id })) break;
                if (view.state.explorers.find(item => item.id === explorer.id)?.recalledAt == null) throw new Error('召回结果未确认');
                log(`废土：已召回 ${resident.name}。`);
              }
            }
          }
          for (const [id,{ healed, ...config }] of Object.entries(task.pendingDispatch)) {
            if (stopped()) break;
            const resident = view.state.residents.find(item => item.id === Number(id));
            if (resident.away !== null) { log(`废土：${resident.name} 已外出，停止本条重复派出。`); delete task.pendingDispatch[id]; continue; }
            // 按游戏规则计算血量上限，每次归来只用一针，等待再次出发时不重复治疗。
            const level = Math.min(50, 1 + Math.floor(Math.sqrt(Math.max(0, resident.xp) / 3)));
            const maxHp = Math.round(100 + (level - 1) * (2 + 0.5 * resident.stats.end));
            if (!healed && resident.hp < maxHp * 0.6) {
              if (view.state.resources.stimpak < 1) { log(`废土：${resident.name} 血量低于 60%，治疗针不足，等待下轮治疗。`); continue; }
              if (!await act({ type: 'stimpak', residentId: resident.id })) break;
              task.pendingDispatch[id].healed = true;
              log(`废土：${resident.name} 血量低于 60%，已使用 1 支治疗针。`);
            }
            if (view.state.resources.stimpak < config.stimpaks) { log(`废土：${resident.name} 原配置需 ${config.stimpaks} 支治疗针，库存不足，保留配置等待下轮。`); continue; }
            if (!await act({ type: 'explore_start', ...config })) break;
            const expedition = view.state.explorers.find(item => item.residentId === Number(id));
            if (!expedition) throw new Error('再次派出结果未确认');
            task.deployments[expedition.id] = config;
            delete task.pendingDispatch[id];
            log(`废土：${resident.name} 已按原区域、${config.stimpaks} 支治疗针、${config.abyss ? '深渊' : '普通'}模式再次出发。`);
          }
        }
        } catch (error) {
          if (error.fatal) throw error;
          if (error.stopped || stopped()) break;
          consecutiveErrors++;
          if (consecutiveErrors >= 2) throw new Error(`连续两轮报错：${error.message}`);
          log(`本轮遇到临时错误：${error.message}；已保留现有状态，稍后继续。`);
          roundError = true;
        }
        if (stopped()) break;
        const nextAt = Date.now() + intervalSeconds * 1000;
        task.nextAt = nextAt;
        if (!roundError) consecutiveErrors = 0;
        log(`本轮${roundError ? '因临时错误跳过剩余步骤' : '完成'}，${intervalSeconds} 秒后开始下一轮。`);
        roundError = false;
        task.cycleRunning = false;
        // 成年子代、待产父母、练满训练项的居民和装备不必等完整间隔：等待期间每 30 秒快速检查一次。
        // 只开自动周常或造神计划时也每 30 秒检查，及时编队出发、撤出练满的居民。
        while (!stopped() && Date.now() < nextAt) {
          await wait(Math.min(task.birthEnabled || task.questEnabled || godEnabled || task.upgradeEnabled || task.targetEnabled || task.parentReturns.length || task.incidentSnapshot?.length || task.incidentRestore ? 30000 : intervalSeconds * 1000, nextAt - Date.now()));
          if (stopped()) break;
          if (!task.birthEnabled && !task.questEnabled && !godEnabled && !task.upgradeEnabled && !task.targetEnabled && !task.parentReturns.length && !task.incidentSnapshot?.length && !task.incidentRestore) continue;
          if (globalThis.__fengbaoDormAssignment?.running || globalThis.__fengbaoWorkAssignment?.running ||
              globalThis.__fengbaoEquipmentAssignment?.running || globalThis.__fengbaoResidentRename?.running) continue;
          task.cycleRunning = true;
          try {
            if (task.birthEnabled || godEnabled) await quickCheck();
            else {
              await read();
              if (await handleIncidents() || stopped()) continue;
              if (!stopped()) await returnPairedParents();
              if (!stopped()) await handleWeeklyQuests();
            }
            if (stopped()) break;
            // 目标建造和普通升级都是施工操作，与居民调度、事件无关；有施工位和资源就继续。
            let targetActive = false;
            if (task.targetEnabled) targetActive = await autoBuildTarget();
            if (stopped()) break;
            if (task.upgradeEnabled) await autoUpgrade(targetActive);
          } catch (error) {
            if (error.fatal) throw error;
            if (error.stopped || stopped()) break;
            // 快速检查里的错误以前被完全吞掉，目标建造失败时面板可能只剩“等待”。
            logQuiet(`quick:error:${error.message}`, `快速检查：${error.message}。`, 10 * 60000);
          } finally { task.cycleRunning = false; }
        }
        task.nextAt = null;
      }
      log('托管已关闭；已执行操作保留。');
    } catch (error) {
      log(`托管已停止：${error.message}。已执行操作保留，请检查游戏页面。`);
    } finally {
      clearTimeout(task.timer);
      clearTimeout(logTimer);
      flushLogs();
      task.running = false;
      task.cycleRunning = false;
      task.nextAt = null;
      task.wake = null;
    }
  })();
}

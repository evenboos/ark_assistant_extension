const start = document.querySelector('#start');
const organize = document.querySelector('#organize');
const stop = document.querySelector('#stop');
const status = document.querySelector('#status');
const strategy = document.querySelector('#strategy');
const trainCharisma = document.querySelector('#train-charisma');
const trainLuck = document.querySelector('#train-luck');
const reassignTraining = document.querySelector('#reassign-training');
const controls = [strategy, trainCharisma, trainLuck, reassignTraining];
let tabId, polling, submitting = false;
const orderList = document.querySelector('#room-order');
const roomOptions = shelterRoomOrder();
let roomOrder = roomOptions.map(item => item.key);
try {
  const savedOrder = JSON.parse(localStorage.getItem('shelterRoomOrder') || 'null');
  if (Array.isArray(savedOrder) && savedOrder.length === roomOrder.length && new Set(savedOrder).size === roomOrder.length &&
      savedOrder.every(key => roomOrder.includes(key))) roomOrder = savedOrder;
} catch { /* 读取失败时使用默认顺序。 */ }
function renderRoomOrder() {
  orderList.replaceChildren();
  roomOrder.forEach(key => {
    const item = document.createElement('li');
    item.dataset.key = key;
    const label = document.createElement('span');
    label.textContent = roomOptions.find(option => option.key === key).name;
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'room-drag-handle';
    handle.textContent = '☰';
    handle.draggable = true;
    handle.title = '按住拖动调整顺序';
    handle.setAttribute('aria-label', `拖动排序：${label.textContent}`);
    handle.addEventListener('dragstart', event => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', key);
      event.dataTransfer.setDragImage(item, 20, item.offsetHeight / 2);
      item.classList.add('dragging');
    });
    handle.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      // 拖动时直接调整列表位置，结束后保存实际顺序。
      roomOrder = [...orderList.children].map(row => row.dataset.key);
      try { localStorage.setItem('shelterRoomOrder', JSON.stringify(roomOrder)); } catch { /* 仍可按本次顺序整理。 */ }
    });
    item.append(label, handle);
    orderList.append(item);
  });
}
orderList.addEventListener('dragover', event => {
  const dragging = orderList.querySelector('.dragging');
  if (!dragging) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const before = [...orderList.children].find(item => {
    const rect = item.getBoundingClientRect();
    return item !== dragging && event.clientY < rect.top + rect.height / 2;
  });
  orderList.insertBefore(dragging, before ?? null);
});
orderList.addEventListener('drop', event => { event.preventDefault(); });
renderRoomOrder();
function options() {
  return { strategy: strategy.value, trainCharisma: trainCharisma.checked, trainLuck: trainLuck.checked, reassignTraining: reassignTraining.checked };
}
function applyOptions(value) {
  if (['production', 'highest'].includes(value?.strategy)) strategy.value = value.strategy;
  for (const [key, input] of [['trainCharisma', trainCharisma], ['trainLuck', trainLuck], ['reassignTraining', reassignTraining]]) {
    if (typeof value?.[key] === 'boolean') input.checked = value[key];
  }
}
function describeStrategy() {
  document.querySelector('#strategy-note').textContent = strategy.value === 'production' ?
    '先把所有生产岗位填满，再按服装、等级和心情算出的有效属性把高属性居民换到对口岗位，让总产出最大。电、粮、水的消耗只由已建房间和人口决定，废料长期溢出，所以不会为了收支把岗位空着；相同收益优先留在原岗。人手或房间不足时仍可能亏损。' :
    '按力、感、耐、魅、智、敏六项最高基础属性安排，智力优先零件工坊，再安排医务室；剩余居民优先训练，训练无位再补生产空位。此策略不保障资源收支。';
}
try { applyOptions(JSON.parse(localStorage.getItem('fengbao-workforce-options') || 'null')); } catch { /* 设置不可读时使用默认值。 */ }
describeStrategy();
function showError(error) {
  clearTimeout(polling);
  start.disabled = organize.disabled = stop.disabled = true;
  status.textContent = `无法读取安排状态：${error.message}。请重新打开面板或检查游戏页面。`;
}
async function refresh() {
  clearTimeout(polling);
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: () => ({
    task: globalThis.__fengbaoWorkAssignment ?? null,
    mounted: Boolean(globalThis.__fengbaoDormAssignment?.monitoring) ||
      [...(globalThis.__fengbaoShelterAuto?.parentReturns ?? []), ...(globalThis.__fengbaoShelterAuto?.incidentSnapshot ?? [])].some(entry => entry.status === 'waiting'),
    busy: globalThis.__fengbaoShelterAuto?.running ? '一键托管正在运行，请先在托管页关闭后再手动操作。' :
      globalThis.__fengbaoEquipmentAssignment?.running ? '装备分配正在运行，请等待完成。' :
      globalThis.__fengbaoDormAssignment?.running ? '宿舍安排正在运行，请等待完成。' :
      globalThis.__fengbaoResidentRename?.running ? '居民改名正在运行，请等待完成。' : ''
  }) });
  const { task, busy, mounted } = injection.result;
  const running = Boolean(task?.running);
  document.querySelector('#room-confirmation').hidden = !task?.pendingRoomConfirmation;
  document.querySelector('#confirm-rooms').disabled = !task?.pendingRoomConfirmation || submitting;
  document.querySelector('#cancel-rooms').disabled = !task?.pendingRoomConfirmation || submitting;
  start.disabled = organize.disabled = submitting || running || Boolean(busy);
  organize.disabled ||= mounted;
  organize.title = mounted ? '请先完成配对挂载或托管的待归岗记录，再整理房间' : '';
  stop.disabled = submitting || !running || task.kind !== 'residents' || task.stopRequested;
  stop.textContent = running && task.stopRequested ? '正在停止…' : '停止居民安排';
  controls.forEach(control => { control.disabled = submitting || running; });
  if (running && task.options) { applyOptions(task.options); describeStrategy(); }
  status.textContent = busy || task?.message || '选择策略和训练选项后安排居民，也可整理房间。';
  const rates = document.querySelector('#rates');
  const longTermRates = document.querySelector('#long-term-rates');
  const guardStatus = document.querySelector('#guard-status');
  const formatRate = value => `${value >= -1e-7 ? '+' : ''}${(Math.abs(value) < 1e-7 ? 0 : value).toFixed(Math.abs(value) < 10 ? 1 : 0)}`;
  const rateLines = (before, after) => [['power', '电力'], ['food', '食物'], ['water', '净水'], ['scrap', '废料'], ['parts', '零件'], ['stimpak', '治疗针']]
    .map(([key, label]) => `${label}：${before ? `${formatRate(before[key])} → ` : ''}${formatRate(after[key])}/时`).join('\n');
  const resultPhase = running ? '方案预计' : task?.stopRequested ? '停止后' : '完成后';
  rates.hidden = !task?.rates;
  if (task?.rates) {
    rates.textContent = (task.beforeRates ? `当前心情净产出：安排前 → ${resultPhase}` : '当前心情净产出') +
      `（废料已扣除工坊消耗）\n${rateLines(task.beforeRates, task.rates)}`;
  }
  longTermRates.hidden = !task?.longTermRates || !task?.happiness;
  if (task?.longTermRates && task.happiness) {
    const mood = task.happiness;
    const stock = [['food', '食物'], ['water', '净水']]
      .map(([key, label]) => `${label}${mood.stockBasis?.[key] === 'stock' ? '已读取' : '未读取'}`).join('、');
    longTermRates.textContent = `长期目标净产出${task.beforeLongTermRates ? `：安排前 → ${resultPhase}` : ''}（心情达到目标后）\n` +
      `${rateLines(task.beforeLongTermRates, task.longTermRates)}\n` +
      `平均心情：当前 ${mood.averageCurrent.toFixed(1)} → 1 小时后 ${mood.averageOneHour.toFixed(1)} → 长期目标 ${mood.averageTarget.toFixed(1)}\n` +
      `电台全体心情加成：${mood.radioActive ? '已生效并计入产出' : '未生效'}；库存扣心情检查：${stock}`;
  }
  guardStatus.hidden = !task?.rates || typeof task.doorGuardRequired !== 'boolean';
  if (!guardStatus.hidden) guardStatus.textContent = task.doorGuardRequired ?
    '门卫时段：当前为白天，已保留大门居民值守。' :
    '门卫时段：当前为夜间（00:00–07:59），大门居民可参与生产；08:00 后请重新一键安排以恢复守卫。';
  const rooms = document.querySelector('#rooms');
  rooms.replaceChildren();
  for (const text of task?.rooms ?? []) { const item = document.createElement('li'); item.textContent = text; rooms.append(item); }
  const unavailable = task?.unavailableRooms ?? [];
  document.querySelector('#unavailable-rooms').hidden = !unavailable.length;
  document.querySelector('#unavailable-room-count').textContent = `不可用房间 ${unavailable.length} 间 · 查看状态标签`;
  const roomList = document.querySelector('#unavailable-room-list');
  roomList.replaceChildren();
  for (const room of unavailable) {
    const item = document.createElement('li');
    item.textContent = `${room.label}：${room.reasons.join('、')}`;
    roomList.append(item);
  }
  const excludedResidents = task?.excluded ?? [];
  document.querySelector('#excluded').hidden = !excludedResidents.length;
  document.querySelector('#excluded-count').textContent = `保留/不调动 ${excludedResidents.length} 人 · 查看原因`;
  const excluded = document.querySelector('#excluded-list');
  excluded.replaceChildren();
  for (const resident of excludedResidents) {
    const item = document.createElement('li');
    item.textContent = `${resident.name}：${resident.reason}`;
    excluded.append(item);
  }
  polling = setTimeout(() => refresh().catch(showError), 750);
}
controls.forEach(control => control.addEventListener('change', () => {
  describeStrategy();
  try { localStorage.setItem('fengbao-workforce-options', JSON.stringify(options())); } catch { /* 不影响本次安排。 */ }
}));
function lockActions() {
  submitting = true;
  start.disabled = organize.disabled = stop.disabled = true;
  controls.forEach(control => { control.disabled = true; });
}
start.addEventListener('click', async () => {
  if (start.disabled) return;
  const selected = options();
  if (!confirm(`确定一键安排居民吗？\n策略：${selected.strategy === 'production' ? '产出优先' : '最高基础属性优先'}。\n魅力训练：${selected.trainCharisma ? '允许' : '不新增'}；幸运训练：${selected.trainLuck ? '允许' : '不新增'}。\n${selected.reassignTraining ? '原训练室居民也参与重新安排。' : '原训练室居民保留原处。'}\n已执行的调动不会自动恢复。`)) return;
  lockActions();
  status.textContent = '正在计算安排…';
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['workforce/planner.js', 'workforce/runner.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, args: [selected], func: selected => { startWorkforce(selected); } });
    submitting = false;
    await refresh();
  } catch (error) { submitting = false; showError(error); }
});
organize.addEventListener('click', async () => {
  if (organize.disabled) return;
  lockActions();
  status.textContent = '正在检查房间并规划整理顺序…';
  try {
    await chrome.scripting.executeScript({ target: { tabId }, args: [roomOrder], func: order => { globalThis.__fengbaoRoomOrder = order; } });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['workforce/room-planner.js', 'workforce/room-runner.js'] });
    submitting = false;
    await refresh();
  } catch (error) { submitting = false; showError(error); }
});
stop.addEventListener('click', async () => {
  stop.disabled = true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const task = globalThis.__fengbaoWorkAssignment;
      if (task?.kind === 'residents' && task.running) task.stopRequested = true;
    } });
    await refresh();
  } catch (error) { showError(error); }
});
for (const [id, approved] of [['confirm-rooms', true], ['cancel-rooms', false]]) {
  document.querySelector(`#${id}`).addEventListener('click', async () => {
    document.querySelector('#confirm-rooms').disabled = document.querySelector('#cancel-rooms').disabled = true;
    try {
      await chrome.scripting.executeScript({ target: { tabId }, args: [approved], func: approved => { globalThis.__fengbaoConfirmRoomPlan?.(approved); } });
      await refresh();
    } catch (error) { showError(error); }
  });
}
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https:\/\/game\.arkengine\.me\/shelter\/?(?:[?#]|$)/.test(tab.url)) {
    status.textContent = '请在自己的“避难所”页面打开此功能';
    return;
  }
  tabId = tab.id;
  await refresh();
})().catch(showError);

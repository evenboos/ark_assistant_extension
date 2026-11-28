const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const keys = ['str', 'per', 'end', 'cha', 'int', 'agi', 'lck'];
const now = 1000000;
const attributes = (value, extra = {}) => ({ ...Object.fromEntries(keys.map(key => [key, value])), ...extra });
const resident = (id, extra = {}) => ({ id, name: `居民${id}`, roomId: null, adultAt: 0, xp: 0, happiness: 100,
  stats: attributes(5), parents: [], romance: null, familyCooldownUntil: null, deadAt: null, away: null, ...extra });
const fixture = () => ({ serverTime: now, state: {
  residents: [resident(1, { stats: attributes(8, { str: 10, per: 9 }), outfitId: 1 }),
    resident(2, { stats: attributes(8, { str: 10, per: 10 }), roomId: 2 }),
    resident(3, { stats: attributes(10) }), resident(4, { stats: attributes(8), adultAt: now + 1 }),
    resident(5, { away: {}, roomId: 2 }), resident(6, { deadAt: now - 1, stats: attributes(1) })],
  rooms: [{ id: 2, type: 'power', floor: 1, level: 1, width: 1 }],
  births: [{ id: 7, parents: [1, 2], dueAt: now + 10000 }],
  items: [{ id: 1, slot: 'outfit', bonus: { str: 7 } }]
} });
const calculate = vm.runInNewContext(`${read('distribution.js')}\nresidentDistribution`);
const normalized = data => data.state.residents.map(item => ({ ...item, stats: keys.map(key => item.stats[key]),
  isAdult: item.adultAt <= data.serverTime, isDown: item.deadAt !== null, isAway: item.away !== null,
  isIdle: item.adultAt <= data.serverTime && item.away === null && item.deadAt === null && item.roomId === null }));
const plain = value => JSON.parse(JSON.stringify(value));

test('训练详情按目标属性读取保存进度，切换训练室后不沿用上一项进度', async () => {
  for (const trainingStat of ['str', 'per']) {
    const state = fixture();
    state.state.legacy = { perks: {} }; state.state.lastSettledAt = now;
    state.state.rooms[0] = { id: 2, type: 'training', trainStat: 'str', floor: 1, level: 1, width: 6,
      builtAt: 0, upgradeAt: null, incident: null, unpowered: false };
    state.state.residents = [resident(1, { roomId: 2, trainingStat, training: 0.2, trainingByStat: { str: 0.8 } })];
    const result = await vm.runInNewContext(read('content.js'), { AbortSignal,
      location: { origin: 'https://game.arkengine.me', pathname: '/shelter' },
      fetch: async () => ({ ok: true, status: 200, json: async () => state })
    });
    assert.equal(result.error, undefined);
    assert.equal(result.training[0].progress, trainingStat === 'str' ? 0.2 : 0.8);
    assert.equal(result.training[0].remainingSeconds, trainingStat === 'str' ? 17400 : 4800);
  }
});

test('存量分布覆盖存活成人儿童外出，排除倒下未出生；忽略装备并重新计算总和', () => {
  const residents = normalized(fixture()); residents[0].total = 999;
  const original = structuredClone(residents);
  const report = calculate(residents);
  assert.deepEqual(plain(report.census), { living: 5, adults: 4, children: 1, away: 1, idle: 2, down: 1 });
  assert.equal(report.count, 5);
  assert.deepEqual(plain([report.total.mean, report.total.median, report.total.min, report.total.max]), [56, 59, 35, 70]);
  assert.deepEqual(plain(report.total.groups.map(row => row.count)), [1, 0, 2, 1, 0, 1]);
  assert.deepEqual(plain(report.total.exact.map(row => row.min)), [35, 56, 59, 60, 70]);
  assert.deepEqual(plain(report.low.map(item => [item.id, item.total])), [[5, 35], [4, 56], [1, 59]]);
  assert.deepEqual(residents, original);
});

test('七项分布人数与范围分母一致，60严格不计低分，单项满10统计正确', () => {
  for (const scope of ['living', 'adults', 'idle']) {
    const report = calculate(normalized(fixture()), scope);
    for (const rows of [report.total.groups, report.total.exact, ...report.stats.map(stat => stat.buckets)]) {
      assert.equal(rows.reduce((sum, row) => sum + row.count, 0), report.count);
      assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.percent, 0) - 100) < 1e-9);
    }
    assert.ok(!report.low.some(item => item.id === 2));
  }
  const living = calculate(normalized(fixture()));
  assert.equal(living.stats[0].maxed, 3);
  assert.equal(living.stats[0].mean, 8.6);
  assert.equal(living.stats[1].maxed, 2);
  assert.equal(calculate(normalized(fixture()), 'adults').count, 4);
  const idle = calculate(normalized(fixture()), 'idle');
  assert.equal(idle.count, 2);
  assert.equal(idle.total.median, 64.5);
  assert.deepEqual(plain(idle.total.exact.map(row => row.min)), [59, 70]);
});

test('总属性分段边界无重叠或遗漏，零值和满70可统计', () => {
  const totals = [0, 39, 40, 49, 50, 59, 60, 64, 65, 69, 70];
  const residents = totals.map((total, index) => {
    let remaining = total;
    const stats = keys.map(() => { const value = Math.min(10, remaining); remaining -= value; return value; });
    return { id: index, name: String(index), stats, isDown: false, isAway: false, isAdult: true, isIdle: true };
  });
  const report = calculate(residents);
  assert.deepEqual(plain(report.total.groups.map(row => row.count)), [2, 2, 2, 2, 2, 1]);
  assert.equal(report.low.length, 6);
  assert.equal(report.total.median, 59);
  assert.equal(report.stats[0].buckets[0].count, 1);
});

test('空范围显示空统计，异常或非基础属性不静默混入分布', () => {
  for (const residents of [[], normalized(fixture()).filter(resident => resident.isDown)]) {
    const report = calculate(residents);
    assert.equal(report.count, 0);
    assert.equal(report.total.mean, null); assert.equal(report.total.median, null);
    assert.equal(report.total.min, null); assert.equal(report.total.max, null);
    assert.ok(report.total.groups.every(row => row.percent === 0));
    assert.equal(report.total.exact.length, 0);
  }
  for (const invalid of [-1, 11, 1.5, NaN, undefined, '10']) {
    const residents = normalized(fixture()); residents[0].stats[0] = invalid;
    assert.throws(() => calculate(residents), /基础属性或状态不完整/);
  }
  const residents = normalized(fixture()); delete residents[0].isIdle;
  assert.throws(() => calculate(residents), /基础属性或状态不完整/);
  assert.throws(() => calculate([], 'unknown'), /统计范围无效/);
});

async function popup() {
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.dataset = {}; this.style = {}; this.value = ''; this.hidden = this.disabled = false; this.text = ''; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set innerHTML(value) { throw new Error('居民名称必须作为文本显示'); }
    addEventListener(event, callback) { (this.listeners[event] ??= []).push(callback); }
    async emit(event) { for (const callback of this.listeners[event] ?? []) await callback({ target: this }); }
    setAttribute(key, value) { this[key] = value; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.text = ''; this.children = children; }
  }
  const elements = new Map(), buttons = [];
  for (const [, tag, attrs] of read('popup.html').matchAll(/<(\w+)\b([^>]*)>/g)) {
    const id = attrs.match(/\bid="([^"]+)"/)?.[1], mode = attrs.match(/\bdata-view="([^"]+)"/)?.[1];
    if (!id && !mode) continue;
    const el = new Element(tag); el.hidden = /\bhidden\b/.test(attrs); el.disabled = /\bdisabled\b/.test(attrs);
    if (id) elements.set(id, el);
    if (mode) { el.dataset.view = mode; buttons.push(el); }
  }
  for (const [id, value] of [['distribution-scope', 'living'], ['distribution-group', 'groups'], ['distribution-stat', '0']]) elements.get(id).value = value;
  let server = fixture(), failure = null;
  const requests = [];
  const page = vm.createContext({ AbortSignal,
    location: { origin: 'https://game.arkengine.me', pathname: '/shelter' },
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      assert.equal(url, '/api/shelter'); assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
      return { ok: !failure, status: failure ?? 200, json: async () => structuredClone(server) };
    }
  });
  const context = vm.createContext({
    document: { querySelector(selector) { assert.ok(elements.has(selector.slice(1)), selector); return elements.get(selector.slice(1)); },
      querySelectorAll(selector) { assert.equal(selector, '[data-view]'); return buttons; }, createElement: tag => new Element(tag) },
    chrome: { tabs: { query: async () => [{ id: 42, url: 'https://game.arkengine.me/shelter' }] },
      scripting: { executeScript: async request => {
        assert.equal(request.target.tabId, 42);
        if (request.files) {
          assert.deepEqual(Array.from(request.files), ['residents/content.js']);
          return [{ result: await vm.runInContext(read('content.js'), page) }];
        }
        return [{ result: await vm.runInContext(`(${request.func.toString()})()`, page) }];
      } } }, setTimeout() {}, Date
  });
  for (const file of ['distribution.js', 'popup.js']) vm.runInContext(read(file), context);
  for (let turn = 0; turn < 5; turn++) await new Promise(setImmediate);
  return { elements, buttons, requests, page, context,
    click: mode => buttons.find(button => button.dataset.view === mode).emit('click'),
    async select(id, value) { const el = elements.get(id); el.value = value; await el.emit('change'); },
    setServer(value) { server = value; }, fail(status) { failure = status; }
  };
}

test('属性分布通过只读接口读取真实结构，筛选共享同一快照，重复点击刷新', async () => {
  const ui = await popup(); await ui.click('distribution');
  const get = id => ui.elements.get(id);
  assert.equal(get('distribution').hidden, false); assert.equal(get('residents').hidden, true);
  assert.match(get('status').textContent, /存活居民 5 人/);
  assert.match(get('distribution-summary').textContent, /均值 56.*中位数 59/);
  assert.match(get('distribution-low-count').textContent, /<60：3 人（60.0%）/);
  assert.match(get('distribution-census').textContent, /倒下 1、待出生 1/);
  assert.equal(get('distribution-stat-summary').children.length, 7);
  assert.equal(get('distribution-total-chart').children.length, 6);
  await ui.select('distribution-scope', 'idle');
  assert.match(get('status').textContent, /在家待岗成人 2 人/);
  assert.match(get('distribution-summary').textContent, /中位数 64.5/);
  assert.equal(get('distribution-low-list').children.length, 1);
  await ui.select('distribution-group', 'exact');
  assert.equal(get('distribution-total-chart').children.length, 2);
  await ui.select('distribution-stat', '6');
  assert.match(get('distribution-stat-chart')['aria-label'], /幸运/);
  assert.equal(ui.requests.length, 1);
  const next = fixture(); next.state.residents[0].stats = attributes(10);
  ui.setServer(next); await ui.click('distribution');
  assert.equal(ui.requests.length, 2);
  assert.match(get('distribution-summary').textContent, /均值 70/);
  assert.equal(get('distribution-total-chart').children.length, 1);
  assert.equal(get('distribution-low-list').children.length, 0);
});

test('分布和旧排序可切换，无重复图表；居民名称按文本呈现', async () => {
  const ui = await popup(); const data = fixture();
  data.state.residents[0].name = '<img src=x onerror=alert(1)>';
  ui.setServer(data); await ui.click('distribution');
  assert.ok(ui.elements.get('distribution-low-list').textContent.includes(data.state.residents[0].name));
  await ui.click('totalAsc');
  assert.equal(ui.elements.get('distribution').hidden, true);
  assert.equal(ui.elements.get('residents').hidden, false);
  assert.equal(ui.elements.get('residents').children.length, 6);
  assert.match(ui.elements.get('residents').children[0].textContent, /居民6/);
  await ui.click('distribution'); await ui.click('distribution');
  assert.equal(ui.elements.get('distribution-stat-summary').children.length, 7);
  assert.equal(ui.elements.get('distribution-total-chart').children.length, 6);
});

test('分布空范围和接口错误不会保留旧结果，失败可重新读取', async () => {
  const ui = await popup(); await ui.click('distribution');
  const data = fixture(); data.state.residents.forEach(resident => { resident.roomId = 2; });
  ui.setServer(data); await ui.click('distribution'); await ui.select('distribution-scope', 'idle');
  assert.match(ui.elements.get('distribution-summary').textContent, /没有居民/);
  assert.match(ui.elements.get('distribution-total-chart').textContent, /暂无数据/);
  assert.ok(!ui.elements.get('distribution-summary').textContent.includes('NaN'));
  ui.fail(401); await ui.click('distribution');
  assert.equal(ui.elements.get('result').hidden, true);
  assert.match(ui.elements.get('status').textContent, /登录状态已失效/);
  assert.ok(ui.buttons.every(button => !button.disabled));
  await ui.select('distribution-scope', 'living');
  assert.equal(ui.elements.get('result').hidden, true);
  ui.fail(null); await ui.click('distribution');
  assert.equal(ui.elements.get('result').hidden, false);
  assert.match(ui.elements.get('status').textContent, /存活居民 5 人/);
});

test('读取到异常属性时显示错误，原有改名任务仍可阻止按钮操作', async () => {
  const ui = await popup(); const invalid = fixture(); invalid.state.residents[0].stats.str = 17;
  ui.setServer(invalid); await ui.click('distribution');
  assert.equal(ui.elements.get('result').hidden, true);
  assert.match(ui.elements.get('status').textContent, /基础属性或状态不完整/);
  ui.page.__fengbaoResidentRename = { running: true, completed: [], message: '改名中' };
  await ui.context.refreshRename();
  assert.ok(ui.buttons.every(button => button.disabled));
  assert.equal(ui.elements.get('distribution').hidden, true);
});

test('缺失居民状态时不将未知状态当成倒下或外出而遗漏统计', async () => {
  const ui = await popup();
  for (const key of ['deadAt', 'away', 'roomId']) {
    const data = fixture(); delete data.state.residents[0][key];
    ui.setServer(data); await ui.click('distribution');
    assert.equal(ui.elements.get('result').hidden, true);
    assert.match(ui.elements.get('status').textContent, /数据不完整/);
  }
});

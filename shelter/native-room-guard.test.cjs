const assert = require('node:assert/strict');
const { test } = require('node:test');
const { dedupeNativeRecommendationSelects, startNativeRoomGuard } = require('./native-room-guard.js');

function select(label, group = null) {
  return {
    tagName: 'SELECT',
    textContent: `推荐调入 · 按${label}（含装备）排序`,
    removed: false,
    group,
    closest(selector) {
      assert.equal(selector, 'dialog, [role="dialog"]');
      return this.group;
    },
    getAttribute(name) {
      return name === 'aria-label' ? this.textContent : null;
    },
    remove() {
      if (this.removed) return;
      this.removed = true;
      if (this.parent?.items) {
        const index = this.parent.items.indexOf(this);
        if (index !== -1) this.parent.items.splice(index, 1);
      }
      this.parent?.observer?.onMutation?.();
    }
  };
}

function root(items = []) {
  return {
    items,
    querySelectorAll(selector) {
      assert.equal(selector, 'select');
      return Array.from(this.items);
    }
  };
}

function append(target, item) {
  item.parent = target;
  target.items.push(item);
  target.observer?.onMutation?.();
}

test('同一点位连续渲染二十次后只保留第一个推荐调入下拉', () => {
  const page = root();
  const expected = select('耐力');
  append(page, expected);
  for (let index = 0; index < 20; index++) append(page, select('耐力'));
  assert.equal(dedupeNativeRecommendationSelects(page), 20);
  assert.deepEqual(page.items, [expected]);
});

test('文案片段顺序变化时仍能识别推荐调入下拉', () => {
  const page = root();
  const expected = select('耐力');
  expected.textContent = '推荐调入 · 按耐力排序（含装备）';
  append(page, expected);
  append(page, select('耐力'));
  assert.equal(dedupeNativeRecommendationSelects(page), 1);
  assert.deepEqual(page.items, [expected]);
});

test('MutationObserver 每次新增都去重，并且自身删除不会形成循环', () => {
  const page = root();
  let callback;
  let scheduled;
  let mutations = 0;
  let schedules = 0;
  const Observer = class {
    constructor(next) { callback = next; }
    observe(target, options) {
      assert.equal(target, page);
      assert.equal(options.childList, true);
      assert.equal(options.subtree, true);
      target.observer = this;
    }
    disconnect() {}
    onMutation() { mutations++; callback(); }
  };
  const guard = startNativeRoomGuard({
    root: page,
    Observer,
    schedule: task => {
      schedules++;
      scheduled = task;
    }
  });
  const expected = select('耐力');
  append(page, expected);
  scheduled();
  for (let index = 0; index < 10; index++) {
    append(page, select('感知'));
    scheduled();
  }
  assert.deepEqual(page.items, [expected]);
  assert.equal(mutations, 21);
  assert.equal(schedules, 11);
  guard.stop();
});

test('新版不再自动注入旧推荐调入去重守卫', () => {
  const fs = require('node:fs'), path = require('node:path');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.ok(!manifest.content_scripts.flatMap(item => item.js).includes('shelter/native-room-guard.js'));
});

test('不同弹窗各自保留一个，普通下拉不受影响', () => {
  const page = root();
  const dialogA = {};
  const dialogB = {};
  const a = select('耐力', dialogA);
  const b = select('感知', dialogB);
  const plain = { textContent: '普通筛选', closest: () => null, remove() { throw new Error('不应删除普通下拉'); } };
  append(page, a);
  append(page, select('耐力', dialogA));
  append(page, b);
  append(page, select('感知', dialogB));
  append(page, plain);
  assert.equal(dedupeNativeRecommendationSelects(page), 2);
  assert.deepEqual(page.items, [a, b, plain]);
});

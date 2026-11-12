/*
 * 任务数据模型与纯函数工具。
 * 同时被主进程（require）和渲染进程（<script>，挂到 window.TaskLib）使用，也方便做单元测试。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TaskLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_SETTINGS = Object.freeze({
    noteMode: true, // 默认便笺模式
    completedToBottom: true, // 完成后置底并收起到“已完成”（默认开启）
    noteSendToBottom: true, // 便笺模式窗口层级较低
    noteOpacity: 0.95,
    remindLeadMinutes: 0, // 提前提醒分钟数
  });

  const PROJECT_COLORS = ['#4f7cff', '#ef6c57', '#2fb67c', '#e0a526', '#9b6bdf', '#e0589b', '#2aa5c7'];
  const DUE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

  function uid() {
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* ---------- 标签 ---------- */

  function normalizeTag(raw) {
    return String(raw == null ? '' : raw)
      .trim()
      .replace(/^[#＃]+/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 30);
  }

  function uniqueTags(list) {
    const seen = new Set();
    const out = [];
    for (const raw of list || []) {
      const t = normalizeTag(raw);
      const k = t.toLowerCase();
      if (t && !seen.has(k)) {
        seen.add(k);
        out.push(t);
      }
    }
    return out;
  }

  /** 把用户输入（逗号、顿号、分号、换行分隔）拆成标签数组 */
  function splitTagInput(text) {
    return uniqueTags(String(text || '').split(/[,，、;；\n]+/));
  }

  /* ---------- 时间 ---------- */

  /** 到期时间以本地时间字符串 "YYYY-MM-DDTHH:mm" 存储，解析失败返回 null */
  function parseDue(str) {
    if (typeof str !== 'string' || !DUE_RE.test(str)) return null;
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function toDueString(date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function formatDue(due, now) {
    const d = parseDue(due);
    if (!d) return '';
    now = now || new Date();
    const p = (n) => String(n).padStart(2, '0');
    const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
    const diff = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
    if (diff === 0) return `今天 ${hm}`;
    if (diff === 1) return `明天 ${hm}`;
    if (diff === -1) return `昨天 ${hm}`;
    const md = `${d.getMonth() + 1}月${d.getDate()}日`;
    return d.getFullYear() === now.getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}年${md} ${hm}`;
  }

  /** 'none' | 'overdue' | 'soon'(24 小时内) | 'later' */
  function dueState(task, now) {
    if (!task || task.done) return 'none';
    const d = parseDue(task.due);
    if (!d) return 'none';
    now = now || new Date();
    if (d <= now) return 'overdue';
    return d - now < 86400000 ? 'soon' : 'later';
  }

  /* ---------- 规范化 ---------- */

  function createTask(note, extra) {
    return Object.assign(
      {
        id: uid(),
        note: String(note || '').trim(),
        done: false,
        doneAt: null,
        tags: [],
        due: null,
        collapsed: false,
        createdAt: Date.now(),
        children: [],
      },
      extra || {}
    );
  }

  /** 任务已没有标题字段：旧数据里的 title 并到 note 最前面（单独成行） */
  function mergeLegacyTitle(r) {
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    const note = typeof r.note === 'string' ? r.note : '';
    if (title && note.trim()) return `${title}\n${note}`;
    return title || note;
  }

  /** 原始数据里是否还有带非空 title 的旧任务（用于迁移前备份） */
  function hasLegacyTitles(raw) {
    const check = (tasks) =>
      Array.isArray(tasks) &&
      tasks.some((t) => t && typeof t === 'object' && ((typeof t.title === 'string' && t.title.trim() !== '') || check(t.children)));
    return !!(raw && Array.isArray(raw.projects) && raw.projects.some((p) => p && check(p.tasks)));
  }

  /** 给提醒、提示条用的简称：备注首个非空行；没有备注时用标签；都没有则返回占位文字 */
  function taskLabel(task, max) {
    const lines = String(task.note || '').split('\n');
    let s = '';
    for (const line of lines) {
      s = line.replace(/\s+/g, ' ').trim();
      if (s) break;
    }
    if (!s && Array.isArray(task.tags) && task.tags.length) s = task.tags.map((t) => '#' + t).join(' ');
    if (!s) return '（空白任务）';
    return max && s.length > max ? s.slice(0, max) + '…' : s;
  }

  /**
   * 解析“添加任务”输入：提取 #标签（仅在开头或空白后，“C#”不算），保留换行。
   * 行内连续空白合并为一个空格，去掉每行首尾空格，连续空行最多保留一个，整体去掉首尾空白。
   */
  function parseQuickInput(input) {
    const tags = [];
    const text = String(input == null ? '' : input)
      .replace(/\r\n?/g, '\n')
      .replace(/(^|\s)[#＃]([^\s#＃]+)/g, (_m, sp, tag) => {
        tags.push(tag);
        return sp;
      })
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { text, tags: uniqueTags(tags) };
  }

  function normalizeTask(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const done = !!r.done;
    return {
      id: typeof r.id === 'string' && r.id ? r.id : uid(),
      note: mergeLegacyTitle(r),
      done,
      doneAt: done && Number.isFinite(r.doneAt) ? r.doneAt : null,
      tags: uniqueTags(Array.isArray(r.tags) ? r.tags : []),
      due: parseDue(r.due) ? r.due : null,
      collapsed: !!r.collapsed,
      createdAt: Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
      children: Array.isArray(r.children) ? r.children.map(normalizeTask) : [],
    };
  }

  function createProject(name, colorIndex) {
    const i = Number.isFinite(colorIndex) ? colorIndex : 0;
    return {
      id: uid(),
      name: String(name || '').trim() || '未命名项目',
      color: PROJECT_COLORS[i % PROJECT_COLORS.length],
      createdAt: Date.now(),
      tasks: [],
    };
  }

  function normalizeProject(raw, index) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      id: typeof r.id === 'string' && r.id ? r.id : uid(),
      name: typeof r.name === 'string' && r.name.trim() ? r.name : '未命名项目',
      color: typeof r.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.color) ? r.color : PROJECT_COLORS[index % PROJECT_COLORS.length],
      createdAt: Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
      tasks: Array.isArray(r.tasks) ? r.tasks.map(normalizeTask) : [],
    };
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function normalizeSettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = DEFAULT_SETTINGS;
    const bool = (v, def) => (typeof v === 'boolean' ? v : def);
    return {
      noteMode: bool(r.noteMode, d.noteMode),
      completedToBottom: bool(r.completedToBottom, d.completedToBottom),
      noteSendToBottom: bool(r.noteSendToBottom, d.noteSendToBottom),
      noteOpacity: Number.isFinite(r.noteOpacity) ? clamp(r.noteOpacity, 0.4, 1) : d.noteOpacity,
      remindLeadMinutes: Number.isFinite(r.remindLeadMinutes) ? clamp(Math.round(r.remindLeadMinutes), 0, 1440) : d.remindLeadMinutes,
    };
  }

  function normalizeState(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    let projects = Array.isArray(r.projects) ? r.projects.map(normalizeProject) : [];
    if (projects.length === 0) projects = [createProject('收件箱', 0)];
    const view = r.ui && typeof r.ui.view === 'string' ? r.ui.view : '';
    const validView = view === 'all' || projects.some((p) => p.id === view) ? view : projects[0].id;
    return { version: 1, settings: normalizeSettings(r.settings), ui: { view: validView }, projects };
  }

  /* ---------- 树操作 ---------- */

  /** 返回从根到目标的路径 [{task, siblings, index}, ...]，找不到返回 null */
  function findPath(tasks, id, trail) {
    trail = trail || [];
    for (let i = 0; i < tasks.length; i++) {
      const here = trail.concat({ task: tasks[i], siblings: tasks, index: i });
      if (tasks[i].id === id) return here;
      const sub = findPath(tasks[i].children, id, here);
      if (sub) return sub;
    }
    return null;
  }

  function findInState(state, id) {
    for (const project of state.projects) {
      const path = findPath(project.tasks, id);
      if (path) return { project, path, task: path[path.length - 1].task };
    }
    return null;
  }

  function walk(tasks, fn, parent) {
    for (const t of tasks) {
      fn(t, parent || null);
      walk(t.children, fn, t);
    }
  }

  function removeTask(tasks, id) {
    const path = findPath(tasks, id);
    if (!path) return null;
    const { siblings, index } = path[path.length - 1];
    return siblings.splice(index, 1)[0];
  }

  function markSubtree(task, done, now) {
    if (done) {
      if (!task.done) task.doneAt = now;
      task.done = true;
    } else {
      task.done = false;
      task.doneAt = null;
    }
    task.children.forEach((c) => markSubtree(c, done, now));
  }

  /** 插入新任务：keepDoneAtBottom 时放在最后一个未完成项之后（已完成项之前），否则追加到末尾 */
  function insertTask(siblings, task, keepDoneAtBottom) {
    if (!keepDoneAtBottom) {
      siblings.push(task);
      return;
    }
    let last = -1;
    siblings.forEach((s, i) => {
      if (!s.done) last = i;
    });
    siblings.splice(last + 1, 0, task);
  }

  /**
   * 设置完成状态。
   * - 完成：同时完成所有子孙；moveToBottom 时移到当前层级最后。
   * - 取消完成：所有祖先同步变为未完成；moveToBottom 时移到未完成项的末尾（已完成项之前）。
   */
  function setDone(tasks, id, done, opts) {
    const o = opts || {};
    const now = o.now || Date.now();
    const path = findPath(tasks, id);
    if (!path) return false;
    const { task, siblings } = path[path.length - 1];
    if (done) {
      markSubtree(task, true, now);
      if (o.moveToBottom) {
        siblings.splice(siblings.indexOf(task), 1);
        siblings.push(task);
      }
    } else {
      task.done = false;
      task.doneAt = null;
      if (o.moveToBottom) {
        siblings.splice(siblings.indexOf(task), 1);
        insertTask(siblings, task, true);
      }
      path.slice(0, -1).forEach((p) => {
        const wasDone = p.task.done;
        p.task.done = false;
        p.task.doneAt = null;
        if (wasDone && o.moveToBottom) {
          p.siblings.splice(p.siblings.indexOf(p.task), 1);
          insertTask(p.siblings, p.task, true);
        }
      });
    }
    return true;
  }

  function countOpen(tasks) {
    let n = 0;
    walk(tasks, (t) => {
      if (!t.done) n++;
    });
    return n;
  }

  function countOverdue(tasks, now) {
    let n = 0;
    walk(tasks, (t) => {
      if (dueState(t, now) === 'overdue') n++;
    });
    return n;
  }

  /** 统计标签（不区分大小写），返回 Map<lowerKey, {name, count}> */
  function collectTags(tasks, into) {
    const map = into || new Map();
    walk(tasks, (t) => {
      for (const tag of t.tags) {
        const k = tag.toLowerCase();
        const e = map.get(k);
        if (e) e.count++;
        else map.set(k, { name: tag, count: 1 });
      }
    });
    return map;
  }

  /* ---------- 过滤 / 搜索 ---------- */

  /**
   * 标签组合过滤。include：必须包含（mode=and 全部满足，or 任一满足）；exclude：不得包含。
   * 没有任何条件时返回 null。
   */
  function makeTagPredicate(f) {
    const inc = ((f && f.include) || []).map((s) => String(s).toLowerCase());
    const exc = ((f && f.exclude) || []).map((s) => String(s).toLowerCase());
    const mode = f && f.mode === 'or' ? 'or' : 'and';
    if (!inc.length && !exc.length) return null;
    return (task) => {
      const set = new Set(task.tags.map((t) => t.toLowerCase()));
      if (exc.some((t) => set.has(t))) return false;
      if (!inc.length) return true;
      return mode === 'or' ? inc.some((t) => set.has(t)) : inc.every((t) => set.has(t));
    };
  }

  function isSubsequence(needle, hay) {
    let i = 0;
    for (let j = 0; j < hay.length && i < needle.length; j++) {
      if (hay[j] === needle[i]) i++;
    }
    return i === needle.length;
  }

  /**
   * 关键字模糊搜索：空格分隔的每个关键字都要命中。
   * 命中规则：在 内容/标签 中包含；或（长度>=2）按字符顺序出现在内容首行中。
   */
  function makeSearchPredicate(query) {
    const terms = String(query || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!terms.length) return null;
    return (task) => {
      const note = task.note.toLowerCase();
      const head = note.split('\n')[0];
      const hay = `${note}\n${task.tags.join(' ').toLowerCase()}`;
      return terms.every((term) => hay.includes(term) || (term.length >= 2 && isSubsequence(term, head)));
    };
  }

  function andPredicates() {
    const list = Array.prototype.slice.call(arguments).filter(Boolean);
    if (!list.length) return null;
    return (task) => list.every((p) => p(task));
  }

  /**
   * 过滤任务树：保留命中的任务及其祖先（祖先 match=false，用于展示层级）。
   * pred 为空时原样包装整棵树。返回 [{task, match, children}]
   */
  function filterTree(tasks, pred) {
    const out = [];
    for (const task of tasks) {
      const children = filterTree(task.children, pred);
      const match = pred ? !!pred(task) : true;
      if (!pred || match || children.length) out.push({ task, match, children });
    }
    return out;
  }

  return {
    DEFAULT_SETTINGS,
    PROJECT_COLORS,
    uid,
    normalizeTag,
    uniqueTags,
    splitTagInput,
    parseDue,
    toDueString,
    formatDue,
    dueState,
    taskLabel,
    parseQuickInput,
    hasLegacyTitles,
    createTask,
    createProject,
    normalizeTask,
    normalizeSettings,
    normalizeState,
    findPath,
    findInState,
    walk,
    removeTask,
    insertTask,
    setDone,
    countOpen,
    countOverdue,
    collectTags,
    makeTagPredicate,
    makeSearchPredicate,
    andPredicates,
    filterTree,
  };
});

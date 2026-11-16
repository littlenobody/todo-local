/*
 * 快捷键：默认键位、按键识别、校验、冲突检测、自定义合并。纯函数，渲染进程挂到 window.Keymap，也可在 Node 里测试。
 * 组合键用规范字符串表示："Ctrl+Shift+Enter"。修饰键顺序固定为 Ctrl、Alt、Shift、Meta，最后是主键。
 * 设置里只保存和默认不同的项：{ 操作id: 组合键 }，空字符串表示“未设置”。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Keymap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * scope: 'task'   只在光标位于某个任务的文字框里时生效
   *        'global' 除弹窗外随时生效
   */
  const ACTIONS = [
    { id: 'addSibling', scope: 'task', label: '新建同级任务（下方）', hint: '空白任务上按下则改为升一级', default: 'Alt+Enter' },
    { id: 'addSiblingAbove', scope: 'task', label: '新建同级任务（上方）', default: 'Alt+Shift+Enter' },
    { id: 'addChild', scope: 'task', label: '新建子任务', hint: '空白任务上按下则改为降一级', default: 'Tab' },
    { id: 'indent', scope: 'task', label: '降一级', hint: '变成上一个同级任务的子任务', default: 'Alt+ArrowRight' },
    { id: 'outdent', scope: 'task', label: '升一级', hint: '移出父任务，放到它后面', default: 'Alt+ArrowLeft' },
    { id: 'moveUp', scope: 'task', label: '上移', default: 'Alt+ArrowUp' },
    { id: 'moveDown', scope: 'task', label: '下移', default: 'Alt+ArrowDown' },
    { id: 'toggleDone', scope: 'task', label: '完成 / 取消完成', default: 'Ctrl+Shift+Enter' },
    { id: 'toggleCollapse', scope: 'task', label: '展开 / 收起子任务', default: 'Ctrl+/' },
    { id: 'editDue', scope: 'task', label: '设置到期时间', default: 'Ctrl+D' },
    { id: 'editTag', scope: 'task', label: '添加标签', hint: '光标跳到标签输入框', default: 'Ctrl+T' },
    { id: 'deleteTask', scope: 'task', label: '删除任务', hint: '可在提示条里撤销', default: 'Ctrl+Shift+Delete' },
    { id: 'focusPrev', scope: 'task', label: '上一个任务', hint: '光标已在第一行时跳转', default: 'ArrowUp' },
    { id: 'focusNext', scope: 'task', label: '下一个任务', hint: '光标已在最后一行时跳转', default: 'ArrowDown' },
    { id: 'finishEdit', scope: 'task', label: '结束编辑', hint: 'Esc 固定也可结束编辑；没有内容的新任务会被丢弃', default: 'Ctrl+Enter' },

    { id: 'newTask', scope: 'global', label: '新建任务', hint: '加到当前项目末尾并开始输入', default: 'Ctrl+N' },
    { id: 'search', scope: 'global', label: '搜索', default: 'Ctrl+F' },
    { id: 'toggleFilter', scope: 'global', label: '标签筛选', default: 'Ctrl+L' },
    { id: 'prevProject', scope: 'global', label: '上一个项目', default: 'Ctrl+PageUp' },
    { id: 'nextProject', scope: 'global', label: '下一个项目', default: 'Ctrl+PageDown' },
    { id: 'openSettings', scope: 'global', label: '打开设置', default: 'Ctrl+,' },
    { id: 'openShortcuts', scope: 'global', label: '查看快捷键', hint: '打开设置里的快捷键页', default: 'F1' },
    { id: 'toggleMode', scope: 'global', label: '切换便笺 / 普通窗口', default: 'Ctrl+Shift+M' },
    { id: 'togglePin', scope: 'global', label: '置顶显示', default: 'Ctrl+Shift+P' },
  ];

  const GROUPS = [
    { scope: 'task', title: '任务内', desc: '光标在任务文字里时生效' },
    { scope: 'global', title: '全局', desc: '随时可用' },
  ];

  const ACTIONS_BY_ID = {};
  ACTIONS.forEach((a) => {
    ACTIONS_BY_ID[a.id] = a;
  });

  /* ---------- 按键名 ---------- */

  const MOD_ALIASES = {
    ctrl: 'ctrl', control: 'ctrl',
    alt: 'alt', option: 'alt',
    shift: 'shift',
    meta: 'meta', win: 'meta', cmd: 'meta', command: 'meta', super: 'meta',
  };

  const NAMED_KEYS = {};
  [
    ['Enter'], ['Tab'], ['Escape', 'esc'], ['Space', 'spacebar'], ['Backspace'], ['Delete', 'del'], ['Insert', 'ins'],
    ['Home'], ['End'], ['PageUp', 'pgup'], ['PageDown', 'pgdn'], ['ArrowUp', 'up'], ['ArrowDown', 'down'],
    ['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['Plus'],
  ].forEach(([name, ...aliases]) => {
    NAMED_KEYS[name.toLowerCase()] = name;
    aliases.forEach((a) => {
      NAMED_KEYS[a] = name;
    });
  });
  for (let i = 1; i <= 24; i++) NAMED_KEYS['f' + i] = 'F' + i;

  const PUNCT = '/\\,.;\'[]-=`';
  const PUNCT_CODES = {
    Slash: '/', Backslash: '\\', Comma: ',', Period: '.', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
  };
  const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'OS']);

  function normalizeKey(p) {
    if (typeof p !== 'string' || !p) return null;
    if (p.length === 1) {
      if (/[a-z]/i.test(p)) return p.toUpperCase();
      if (/\d/.test(p) || PUNCT.includes(p)) return p;
      return null;
    }
    return NAMED_KEYS[p.toLowerCase()] || null;
  }

  /** 解析为 {ctrl, alt, shift, meta, key}，格式不对返回 null */
  function parseCombo(str) {
    if (typeof str !== 'string' || !str.trim()) return null;
    const parts = str.split('+').map((s) => s.trim());
    const c = { ctrl: false, alt: false, shift: false, meta: false, key: null };
    for (let i = 0; i < parts.length; i++) {
      if (!parts[i]) return null;
      if (i < parts.length - 1) {
        const m = MOD_ALIASES[parts[i].toLowerCase()];
        if (!m) return null;
        c[m] = true;
      } else {
        c.key = normalizeKey(parts[i]);
      }
    }
    return c.key ? c : null;
  }

  function stringify(c) {
    return [c.ctrl && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift', c.meta && 'Meta', c.key].filter(Boolean).join('+');
  }

  /** 规范化组合键字符串；无法识别返回 null */
  function normalizeCombo(str) {
    const c = parseCombo(str);
    return c ? stringify(c) : null;
  }

  /** 主键名取自物理按键（e.code），这样 Shift+/ 仍然是 “/” 而不是 “?” */
  function keyName(e) {
    const k = e.key;
    if (k && k.length === 1 && /[a-z]/i.test(k)) return k.toUpperCase(); // 字母按实际输入的字符识别，不受键盘布局影响
    const code = e.code || '';
    let m = /^Key([A-Z])$/.exec(code);
    if (m) return m[1];
    m = /^Digit(\d)$/.exec(code);
    if (m) return m[1];
    if (PUNCT_CODES[code]) return PUNCT_CODES[code];
    if (!k || MODIFIER_KEYS.has(k) || k === 'Process' || k === 'Dead' || k === 'Unidentified') return null;
    if (k === ' ') return 'Space';
    if (k === '+') return 'Plus';
    return normalizeKey(k);
  }

  /** 键盘事件 → 组合键字符串；只按下了修饰键或无法识别时返回 null */
  function comboFromEvent(e) {
    const key = keyName(e);
    if (!key) return null;
    return stringify({ ctrl: !!e.ctrlKey, alt: !!e.altKey, shift: !!e.shiftKey, meta: !!e.metaKey, key });
  }

  const DISPLAY = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Escape: 'Esc', Delete: 'Del', PageUp: 'PgUp', PageDown: 'PgDn', Plus: '+',
  };

  /** 用于界面显示的各个键，如 ['Ctrl', 'Shift', 'Enter'] */
  function displayParts(combo) {
    const c = parseCombo(combo);
    if (!c) return [];
    return stringify(c)
      .split('+')
      .map((p) => DISPLAY[p] || p);
  }

  function formatCombo(combo) {
    return displayParts(combo).join('+');
  }

  /* ---------- 校验 ---------- */

  // 浏览器 / 编辑器 / 系统已占用的组合
  const RESERVED = new Set([
    'Ctrl+C', 'Ctrl+X', 'Ctrl+V', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z',
    'Ctrl+B', 'Ctrl+I', 'Ctrl+U', 'Ctrl+K', // 备忘录里的格式化
    'Alt+F4',
    'Ctrl+Alt+T', 'Ctrl+Alt+Shift+T', 'Ctrl+Alt+J', 'Ctrl+Alt+Shift+J', // 显示 / 收起窗口的全局快捷键
  ]);
  const CURSOR_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

  /**
   * 合法返回 null，否则返回原因。scope='global' 时更严格：不带 Ctrl / Alt 的 Enter、Tab、方向键会破坏按钮和输入框的正常操作，只允许 F1~F12。
   */
  function validateCombo(combo, scope) {
    const c = parseCombo(combo);
    if (!c) return '无法识别这个按键';
    if (c.key === 'Escape') return 'Esc 固定用于结束编辑和关闭弹窗，不能自定义';
    const withCmd = c.ctrl || c.alt || c.meta;
    if (c.key === 'Enter' && !withCmd && !c.shift) return 'Enter 用于换行，不能作为快捷键';
    if (!withCmd) {
      const isF = /^F\d{1,2}$/.test(c.key);
      if (scope === 'global') {
        if (!isF) return '全局快捷键需要配合 Ctrl 或 Alt（F1~F12 除外）';
      } else {
        const bare = c.key === 'Tab' || isF || (c.shift && c.key === 'Enter');
        const arrow = !c.shift && (c.key === 'ArrowUp' || c.key === 'ArrowDown');
        if (!bare && !arrow) return '需要配合 Ctrl 或 Alt，否则会影响输入文字';
      }
    }
    if (RESERVED.has(stringify(c))) return '这个组合已被系统或编辑器占用';
    if ((c.ctrl || c.meta) && !c.alt) {
      if (!c.shift && (c.key === 'Backspace' || c.key === 'Delete')) return '这个组合用于删除单词，请换一个';
      if (CURSOR_KEYS.has(c.key)) return '这个组合用于移动光标，请换一个';
    }
    return null;
  }

  /* ---------- 合并自定义 ---------- */

  /** 默认键位叠加自定义，返回 { 操作id: 组合键 }（空字符串表示未设置）。非法或冲突的自定义项回落 / 置空 */
  function resolve(custom) {
    const c = custom && typeof custom === 'object' && !Array.isArray(custom) ? custom : {};
    const out = {};
    for (const a of ACTIONS) {
      let v = a.default;
      if (Object.prototype.hasOwnProperty.call(c, a.id)) {
        if (c[a.id] === '') v = '';
        else {
          const n = normalizeCombo(c[a.id]);
          if (n && !validateCombo(n, a.scope)) v = n;
        }
      }
      out[a.id] = v;
    }
    const seen = new Set();
    for (const a of ACTIONS) {
      const v = out[a.id];
      if (!v) continue;
      if (seen.has(v)) out[a.id] = '';
      else seen.add(v);
    }
    return out;
  }

  /** 组合键 → 操作id */
  function buildLookup(resolved) {
    const map = new Map();
    for (const a of ACTIONS) if (resolved[a.id]) map.set(resolved[a.id], a.id);
    return map;
  }

  /** 已经占用了该组合键的另一个操作的 id，没有则返回 null */
  function conflictWith(resolved, id, combo) {
    for (const a of ACTIONS) if (a.id !== id && resolved[a.id] === combo) return a.id;
    return null;
  }

  /** 返回新的自定义对象：与默认相同则删除该项，否则记录（'' 表示清除） */
  function setBinding(custom, id, combo) {
    const next = Object.assign({}, custom || {});
    const def = ACTIONS_BY_ID[id];
    if (!def) return next;
    if (combo === def.default) delete next[id];
    else next[id] = combo;
    return next;
  }

  return {
    ACTIONS,
    ACTIONS_BY_ID,
    GROUPS,
    parseCombo,
    normalizeCombo,
    comboFromEvent,
    displayParts,
    formatCombo,
    validateCombo,
    resolve,
    buildLookup,
    conflictWith,
    setBinding,
  };
});

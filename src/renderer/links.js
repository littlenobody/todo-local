'use strict';
/*
 * 链接交互：任务内容（textarea）和项目备忘录里的链接，按住 Ctrl 单击才会在浏览器中打开，
 * 避免想选中 / 复制链接文字时误触。鼠标停在链接上会提示这一点，按住 Ctrl 时光标变成手型。
 *
 * textarea 里没法渲染 <a>，所以用一个隐藏的镜像 div 复刻它的排版，量出每个链接占的矩形来做命中判断。
 * 备忘录里既认 <a>，也认纯文本里的网址。
 */
(function () {
  const ML = window.MemoLib;
  const TIP = '按住 Ctrl 并单击打开链接';
  const TIP_DELAY = 400;
  const MIRROR_PROPS = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'wordSpacing',
    'textTransform', 'textIndent', 'tabSize', 'whiteSpace', 'overflowWrap', 'wordBreak',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  ];

  const mirror = document.createElement('div');
  mirror.className = 'link-mirror';
  mirror.setAttribute('aria-hidden', 'true');
  const tip = document.createElement('div');
  tip.id = 'link-tip';
  tip.setAttribute('role', 'tooltip');
  tip.textContent = TIP;
  document.body.append(mirror, tip);

  let hit = null; // { el, node, start, href }
  let last = { x: 0, y: 0, target: null };
  let tipTimer = null;
  let ctrlEl = null;

  const isCtrl = (e) => e.ctrlKey || e.metaKey;
  const same = (a, b) => !!a && !!b && a.node === b.node && a.start === b.start;

  function pointInRects(range, x, y) {
    for (const r of range.getClientRects()) {
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    return false;
  }

  function hitTextarea(ta, x, y) {
    const links = ML.findLinks(ta.value);
    if (!links.length) return null;
    const cs = getComputedStyle(ta);
    for (const p of MIRROR_PROPS) mirror.style[p] = cs[p];
    const box = ta.getBoundingClientRect();
    mirror.style.width = ta.clientWidth + 'px';
    mirror.style.left = box.left + ta.clientLeft + 'px';
    mirror.style.top = box.top + ta.clientTop - ta.scrollTop + 'px';
    mirror.textContent = ta.value;
    const range = document.createRange();
    for (const l of links) {
      range.setStart(mirror.firstChild, l.start);
      range.setEnd(mirror.firstChild, l.end);
      if (pointInRects(range, x, y)) return { el: ta, node: ta, start: l.start, href: l.href };
    }
    return null;
  }

  function hitEditor(ed, target, x, y) {
    const a = target.closest('a');
    if (a && ed.contains(a)) {
      const href = ML.safeLinkHref(a.getAttribute('href'));
      return href ? { el: ed, node: a, start: 0, href } : null;
    }
    const caret = document.caretRangeFromPoint && document.caretRangeFromPoint(x, y);
    const node = caret && caret.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE || !ed.contains(node)) return null;
    if (node.parentElement && node.parentElement.closest('a')) return null;
    const range = document.createRange();
    for (const l of ML.findLinks(node.data)) {
      range.setStart(node, l.start);
      range.setEnd(node, l.end);
      if (pointInRects(range, x, y)) return { el: ed, node, start: l.start, href: l.href };
    }
    return null;
  }

  function find(target, x, y) {
    if (!(target instanceof Element)) return null;
    const ta = target.closest('textarea.task-text');
    if (ta) return hitTextarea(ta, x, y);
    const ed = target.closest('.memo-editor');
    if (ed) return hitEditor(ed, target, x, y);
    return null;
  }

  function hideTip() {
    clearTimeout(tipTimer);
    tipTimer = null;
    tip.classList.remove('show');
  }

  function showTip() {
    tipTimer = null;
    tip.classList.add('show');
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.max(8, Math.min(last.x + 12, window.innerWidth - w - 8));
    let top = last.y + 22;
    if (top + h > window.innerHeight - 8) top = last.y - h - 10;
    tip.style.left = left + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }

  // textarea 自带“Enter 换行…”的原生 title，悬停在链接上时先摘掉，免得和我们的提示叠在一起
  let muted = null; // { el, title }
  function unmuteTitle() {
    if (!muted) return;
    muted.el.title = muted.title;
    muted = null;
  }
  function muteTitle(el) {
    if (muted && muted.el === el) return;
    unmuteTitle();
    if (el.tagName === 'TEXTAREA' && el.title) {
      muted = { el, title: el.title };
      el.title = '';
    }
  }

  function setCursor(el, on) {
    if (ctrlEl && ctrlEl !== el) ctrlEl.classList.remove('link-ctrl');
    ctrlEl = on ? el : null;
    if (el) el.classList.toggle('link-ctrl', on);
  }

  function refresh(ctrl) {
    const t = last.target;
    const next = t && t.isConnected ? find(t, last.x, last.y) : null;
    setCursor(next && next.el, !!next && ctrl);
    if (!next) {
      hit = null;
      hideTip();
      unmuteTitle();
      return;
    }
    muteTitle(next.el);
    if (!same(hit, next)) {
      hideTip();
      tipTimer = setTimeout(showTip, TIP_DELAY);
    }
    hit = next;
  }

  function reset() {
    last.target = null;
    refresh(false);
  }

  document.addEventListener(
    'mousemove',
    (e) => {
      last = { x: e.clientX, y: e.clientY, target: e.target };
      refresh(isCtrl(e));
    },
    true
  );
  document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) reset(); }, true);
  document.addEventListener('mousedown', hideTip, true);
  document.addEventListener('scroll', reset, true);
  window.addEventListener('blur', reset);
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Control' || e.key === 'Meta') refresh(true);
      else hideTip();
    },
    true
  );
  document.addEventListener('keyup', (e) => { if (e.key === 'Control' || e.key === 'Meta') refresh(false); }, true);

  document.addEventListener(
    'click',
    (e) => {
      if (e.button !== 0 || !isCtrl(e)) return;
      const h = find(e.target, e.clientX, e.clientY);
      if (!h) return;
      e.preventDefault();
      e.stopPropagation();
      hideTip();
      window.api.openExternal(h.href);
    },
    true
  );
})();

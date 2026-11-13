'use strict';
/*
 * 项目备忘录：右下角浮标 + 富文本面板（文字、图片、表格、列表、链接……）。
 * 每个项目一份，内容以 HTML 存放在主进程管理的 memos 目录里，图片以 data URL 内嵌。
 * 外部内容（粘贴 / 拖入 / 读盘）一律先经过白名单清洗，不信任任何原始 HTML。
 */
(function () {
  const { el, icon, toast, openModal, closeModal } = window.Dom;
  const ML = window.MemoLib;

  const ALLOWED_TAGS = new Set([
    'P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'SUB', 'SUP',
    'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'A', 'IMG',
    'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD',
  ]);
  // 连同内容一起丢弃；其余不认识的标签只去掉标签本身、保留里面的文字
  const DROP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'LINK', 'META', 'TITLE', 'HEAD',
    'NOSCRIPT', 'TEMPLATE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'AUDIO', 'VIDEO',
    'CANVAS', 'APPLET', 'FRAME', 'FRAMESET', 'BASE',
  ]);

  const SAVE_DELAY = 600;
  const IMAGE_MAX_SIDE = 1600; // 超过的图片缩小后再存，避免备忘录膨胀
  const IMAGE_KEEP_BYTES = 1.5 * 1024 * 1024;

  let api = null;
  let getProject = null;
  let onHasChange = null;
  let inited = false;
  let fab, panel, editor, titleEl, dotEl, tableTools, expandBtn, fileInput;
  const formatButtons = []; // [按钮, execCommand 名]，用于显示当前选区的加粗等状态
  let open = false;
  let current = null; // { id, loaded }
  let dirty = false;
  let saveTimer = null;
  let loadToken = 0;
  let lastRange = null;
  let internalDrag = false;
  let saveFailing = false;
  let syncing = false;

  /* ---------- 清洗 ---------- */

  function clean(src, dst) {
    for (const node of Array.from(src.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        dst.append(node.nodeValue);
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = node.tagName.toUpperCase();
      if (DROP_TAGS.has(tag)) continue;
      if (!ALLOWED_TAGS.has(tag)) {
        clean(node, dst);
        continue;
      }
      if (tag === 'IMG') {
        const s = node.getAttribute('src');
        if (!ML.isSafeImageSrc(s)) continue;
        const img = document.createElement('img');
        img.setAttribute('src', s);
        const alt = node.getAttribute('alt');
        if (alt) img.setAttribute('alt', alt.slice(0, 200));
        dst.append(img);
        continue;
      }
      if (tag === 'A') {
        const href = ML.safeLinkHref(node.getAttribute('href'));
        if (!href) {
          clean(node, dst);
          continue;
        }
        const a = document.createElement('a');
        a.setAttribute('href', href);
        clean(node, a);
        dst.append(a);
        continue;
      }
      const copy = document.createElement(tag.toLowerCase());
      if (tag === 'TD' || tag === 'TH') {
        for (const k of ['colspan', 'rowspan']) {
          const n = parseInt(node.getAttribute(k), 10);
          if (n > 1 && n <= 50) copy.setAttribute(k, String(n));
        }
      }
      clean(node, copy);
      dst.append(copy);
    }
  }

  /** 把任意 HTML 清洗成只含白名单标签与属性的 DOM（DOMParser 解析不会执行脚本） */
  function sanitizeToElement(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const out = document.createElement('div');
    clean(doc.body, out);
    return out;
  }

  const hasMeaning = (root) => !!root.querySelector('img, table, hr') || root.textContent.trim() !== '';
  const hasContent = () => hasMeaning(editor);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /* ---------- 保存 / 读取 ---------- */

  function onEdit() {
    editor.classList.toggle('is-empty', !hasContent());
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DELAY);
  }

  function saveFailed() {
    if (saveFailing) return;
    saveFailing = true;
    toast('备忘录保存失败，请检查磁盘空间或内容是否过大');
  }

  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!dirty || !current || !current.loaded) return;
    dirty = false;
    const id = current.id;
    const html = editor.innerHTML;
    onHasChange(id, hasContent());
    Promise.resolve(api.saveMemo(id, html)).then((ok) => {
      if (ok) saveFailing = false;
      else saveFailed();
    }, saveFailed);
  }

  async function load(project, focus) {
    const token = ++loadToken;
    current = { id: project.id, loaded: false };
    dirty = false;
    editor.setAttribute('contenteditable', 'false');
    editor.replaceChildren();
    editor.classList.add('is-empty');
    let html = null;
    try {
      html = await api.loadMemo(project.id);
    } catch {
      html = null;
    }
    if (token !== loadToken) return;
    if (html == null) {
      toast('备忘录读取失败，已暂停编辑以免覆盖原内容');
      return;
    }
    editor.replaceChildren(...sanitizeToElement(html).childNodes);
    editor.setAttribute('contenteditable', 'true');
    current.loaded = true;
    editor.classList.toggle('is-empty', !hasContent());
    onHasChange(project.id, hasContent());
    if (focus && open) editor.focus();
  }

  /* ---------- 面板开关 / 与当前视图同步 ---------- */

  function openPanel() {
    const p = getProject();
    if (!p) return;
    open = true;
    panel.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    if (!current || current.id !== p.id) load(p, true);
    else if (current.loaded) editor.focus();
  }

  function closePanel() {
    flush();
    open = false;
    panel.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
  }

  /** 视图或项目信息变化后调用：显示 / 隐藏浮标，切换项目时换成对应的备忘录 */
  function sync() {
    if (!inited || syncing) return;
    syncing = true;
    try {
      const p = getProject();
      fab.hidden = !p;
      if (!p) {
        if (open) closePanel();
        return;
      }
      fab.classList.toggle('has-memo', !!p.hasMemo);
      titleEl.textContent = p.name;
      dotEl.style.background = p.color;
      if (open && (!current || current.id !== p.id)) {
        flush();
        load(p, false);
      }
    } finally {
      syncing = false;
    }
  }

  /** 项目被删除：放弃尚未写入的修改，避免把已删除的备忘录文件又写回来 */
  function discard(projectId) {
    if (!inited || !current || current.id !== projectId) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    dirty = false;
    current = null;
    loadToken++;
    editor.replaceChildren();
  }

  /* ---------- 选区 ---------- */

  const canEdit = () => open && !!current && current.loaded;

  function placeCaret(node, atEnd) {
    const r = document.createRange();
    r.selectNodeContents(node);
    r.collapse(!atEnd);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  /** 让编辑区获得焦点并恢复选区（点工具栏、选完图片 / 链接后选区可能已离开编辑区） */
  function ensureSelection(range) {
    const sel = getSelection();
    const inside = sel.rangeCount > 0 && editor.contains(sel.anchorNode);
    const r = range || (inside ? null : lastRange);
    editor.focus({ preventScroll: true });
    if (r) {
      sel.removeAllRanges();
      sel.addRange(r);
    } else if (!sel.rangeCount || !editor.contains(sel.anchorNode)) {
      placeCaret(editor, true);
    }
  }

  function cmd(name, value) {
    if (!canEdit()) return;
    ensureSelection();
    document.execCommand(name, false, value);
  }

  function toggleBlock(tag) {
    if (!canEdit()) return;
    ensureSelection();
    const cur = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
    document.execCommand('formatBlock', false, cur === tag ? 'p' : tag);
  }

  function updateFormatState() {
    for (const [btn, name] of formatButtons) {
      let on = false;
      try {
        on = document.queryCommandState(name);
      } catch {
        /* ignore */
      }
      btn.setAttribute('aria-pressed', String(on));
    }
  }

  /* ---------- 图片 ---------- */

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode'));
      img.src = src;
    });
  }

  /** 读成 data URL；过大的图片缩小后重新编码（GIF 保持原样以保留动画） */
  async function fileToDataUrl(file) {
    const raw = await readAsDataUrl(file);
    if (file.type === 'image/gif') return raw;
    const img = await loadImage(raw);
    const side = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = Math.min(1, IMAGE_MAX_SIDE / side);
    if (scale === 1 && file.size <= IMAGE_KEEP_BYTES && ML.isSafeImageSrc(raw)) return raw;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp', 0.88);
  }

  async function insertImages(files) {
    for (const file of files) {
      if (!canEdit()) return;
      if (file.type === 'image/svg+xml') {
        toast('暂不支持 SVG 图片');
        continue;
      }
      try {
        const url = await fileToDataUrl(file);
        if (!ML.isSafeImageSrc(url)) {
          toast('不支持这种图片格式');
          continue;
        }
        if (editor.innerHTML.length + url.length > ML.MAX_MEMO_CHARS) {
          toast('备忘录内容已达上限，无法再添加图片');
          return;
        }
        ensureSelection();
        document.execCommand('insertImage', false, url);
      } catch {
        toast('图片读取失败');
      }
    }
  }

  /** 粘贴 / 拖入：优先用清洗后的 HTML（表格、文字），没有可用内容时再取图片，最后才是纯文本 */
  function handleIncoming(dt) {
    const files = Array.from(dt.files || []).filter((f) => f.type.startsWith('image/'));
    const html = dt.getData('text/html');
    if (html) {
      const box = sanitizeToElement(html);
      if (hasMeaning(box)) {
        ensureSelection();
        document.execCommand('insertHTML', false, box.innerHTML);
        return;
      }
    }
    if (files.length) {
      insertImages(files);
      return;
    }
    const text = dt.getData('text/plain');
    if (text) {
      ensureSelection();
      document.execCommand('insertText', false, text);
    }
  }

  /* ---------- 表格 ---------- */

  function tableHtml(rows, cols) {
    const row = (t) => `<tr>${`<${t}><br></${t}>`.repeat(cols)}</tr>`;
    return `<table><tbody>${row('th')}${row('td').repeat(rows - 1)}</tbody></table><p><br></p>`;
  }

  function insertTable() {
    if (!canEdit()) return;
    ensureSelection();
    const before = new Set(editor.querySelectorAll('table'));
    document.execCommand('insertHTML', false, tableHtml(3, 3));
    // 光标放进新表格的第一格，方便直接输入，同时显示表格操作条
    const fresh = Array.from(editor.querySelectorAll('table')).find((t) => !before.has(t));
    const first = fresh && fresh.querySelector('th, td');
    if (first) placeCaret(first, false);
  }

  function currentCell() {
    const sel = getSelection();
    if (!sel.rangeCount || !editor.contains(sel.anchorNode)) return null;
    const n = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    const cell = n && n.closest('td, th');
    if (!cell || !editor.contains(cell)) return null;
    return { cell, row: cell.parentElement, table: cell.closest('table') };
  }

  const newCell = (tag) => {
    const c = document.createElement(tag);
    c.append(document.createElement('br'));
    return c;
  };

  function addRow(info) {
    const row = document.createElement('tr');
    for (let i = 0; i < info.row.cells.length; i++) row.append(newCell('td'));
    info.row.after(row);
    return row;
  }

  function addCol(info) {
    const idx = info.cell.cellIndex;
    for (const r of Array.from(info.table.rows)) {
      const ref = r.cells[idx];
      r.insertBefore(newCell(ref && ref.tagName === 'TH' ? 'th' : 'td'), ref ? ref.nextSibling : null);
    }
    placeCaret(info.row.cells[idx + 1] || info.cell, false);
  }

  function delTable(info) {
    info.table.remove();
    if (!editor.firstChild) {
      const p = document.createElement('p');
      p.append(document.createElement('br'));
      editor.append(p);
    }
    ensureSelection();
  }

  function delRow(info) {
    if (info.table.rows.length <= 1) return delTable(info);
    const i = info.row.rowIndex;
    info.row.remove();
    const rows = info.table.rows;
    const target = rows[Math.min(i, rows.length - 1)];
    if (target && target.cells[0]) placeCaret(target.cells[0], false);
  }

  function delCol(info) {
    if (info.row.cells.length <= 1) return delTable(info);
    const idx = info.cell.cellIndex;
    for (const r of Array.from(info.table.rows)) if (r.cells[idx]) r.cells[idx].remove();
    const cells = info.row.cells;
    placeCaret(cells[Math.min(idx, cells.length - 1)], false);
  }

  function tableAction(fn) {
    if (!canEdit()) return;
    ensureSelection();
    const info = currentCell();
    if (!info) return;
    fn(info);
    onEdit();
    tableTools.hidden = !currentCell();
  }

  /* ---------- 链接 ---------- */

  function anchorAtSelection() {
    const sel = getSelection();
    if (!sel.rangeCount || !editor.contains(sel.anchorNode)) return null;
    const n = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    const a = n && n.closest('a');
    return a && editor.contains(a) ? a : null;
  }

  function openLinkDialog() {
    if (!canEdit()) return;
    ensureSelection();
    const sel = getSelection();
    const saved = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const existing = anchorAtSelection();
    const input = el('input', { class: 'field', type: 'text', placeholder: 'https://example.com', 'aria-label': '链接地址' });
    input.value = existing ? existing.getAttribute('href') || '' : '';

    const apply = () => {
      const raw = input.value.trim();
      const href = raw ? ML.safeLinkHref(raw) : '';
      if (raw && !href) {
        toast('链接地址无效，仅支持 http、https 和邮箱地址');
        input.focus();
        return;
      }
      closeModal();
      if (!canEdit()) return;
      ensureSelection(saved);
      if (!href) document.execCommand('unlink');
      else if (getSelection().isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(href)}">${esc(href)}</a>`);
      else document.execCommand('createLink', false, href);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        apply();
      }
    });
    openModal({
      title: '插入链接',
      body: el(
        'div',
        { class: 'form-grid' },
        el('label', {}, el('div', { text: '链接地址（留空并确定可取消链接）' }), input),
        el('div', { class: 'setting-desc', text: '在备忘录里按住 Ctrl 单击链接即可在浏览器中打开' })
      ),
      actions: [
        el('button', { class: 'btn', type: 'button', onclick: closeModal }, '取消'),
        el('button', { class: 'btn primary', type: 'button', onclick: apply }, '确定'),
      ],
      focus: input,
    });
  }

  /* ---------- 构建界面 ---------- */

  function toolButton(iconName, label, run, stateCmd) {
    const btn = el(
      'button',
      {
        class: 'icon-btn small',
        type: 'button',
        title: label,
        'aria-label': label,
        onmousedown: (e) => e.preventDefault(), // 不抢走编辑区的选区
        onclick: run,
      },
      icon(iconName)
    );
    if (stateCmd) {
      btn.setAttribute('aria-pressed', 'false');
      formatButtons.push([btn, stateCmd]);
    }
    return btn;
  }

  function textButton(label, run) {
    return el('button', { class: 'btn small', type: 'button', onmousedown: (e) => e.preventDefault(), onclick: run }, label);
  }

  function build() {
    titleEl = el('span', { class: 'memo-title' });
    dotEl = el('span', { class: 'dot' });
    expandBtn = el('button', { class: 'icon-btn small', type: 'button', title: '放大', 'aria-label': '放大', 'aria-pressed': 'false' }, icon('expand'));
    expandBtn.addEventListener('click', () => {
      const big = panel.classList.toggle('expanded');
      expandBtn.replaceChildren(icon(big ? 'collapse' : 'expand'));
      expandBtn.title = big ? '还原' : '放大';
      expandBtn.setAttribute('aria-label', expandBtn.title);
      expandBtn.setAttribute('aria-pressed', String(big));
    });
    const closeBtn = el('button', { class: 'icon-btn small', type: 'button', title: '关闭备忘录', 'aria-label': '关闭备忘录', onclick: () => { closePanel(); fab.focus(); } }, icon('close'));

    const sep = () => el('span', { class: 'memo-sep', 'aria-hidden': 'true' });
    const toolbar = el(
      'div',
      { class: 'memo-toolbar', role: 'toolbar', 'aria-label': '备忘录格式' },
      toolButton('bold', '加粗 (Ctrl+B)', () => cmd('bold'), 'bold'),
      toolButton('italic', '斜体 (Ctrl+I)', () => cmd('italic'), 'italic'),
      toolButton('underline', '下划线 (Ctrl+U)', () => cmd('underline'), 'underline'),
      toolButton('strike', '删除线', () => cmd('strikeThrough'), 'strikeThrough'),
      sep(),
      toolButton('heading', '标题', () => toggleBlock('h3')),
      toolButton('quote', '引用', () => toggleBlock('blockquote')),
      toolButton('listUl', '无序列表', () => cmd('insertUnorderedList'), 'insertUnorderedList'),
      toolButton('listOl', '有序列表', () => cmd('insertOrderedList'), 'insertOrderedList'),
      sep(),
      toolButton('link', '插入链接 (Ctrl+K)', openLinkDialog),
      toolButton('image', '插入图片（也可以直接粘贴或拖入）', () => canEdit() && fileInput.click()),
      toolButton('table', '插入表格', insertTable),
      toolButton('hr', '分隔线', () => cmd('insertHorizontalRule'))
    );

    tableTools = el(
      'div',
      { class: 'memo-tabletools', role: 'toolbar', 'aria-label': '表格操作', hidden: true },
      el('span', { class: 'memo-tabletools-label', text: '表格' }),
      textButton('加行', () => tableAction((i) => placeCaret(addRow(i).cells[0], false))),
      textButton('加列', () => tableAction(addCol)),
      textButton('删行', () => tableAction(delRow)),
      textButton('删列', () => tableAction(delCol)),
      textButton('删表', () => tableAction(delTable))
    );

    editor = el('div', {
      class: 'memo-editor is-empty',
      contenteditable: 'false',
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': '备忘录内容',
      'data-placeholder': '在这里记录项目相关的内容：文字、图片、表格都可以，可直接粘贴截图或 Excel 表格',
      spellcheck: 'false',
    });

    fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', multiple: true, hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = '';
      if (files.length) insertImages(files);
    });

    panel = el(
      'section',
      { id: 'memo-panel', class: 'memo-panel', role: 'dialog', 'aria-label': '项目备忘录', hidden: true },
      el('header', { class: 'memo-head' }, dotEl, titleEl, el('span', { class: 'memo-head-sub', text: '备忘录' }), el('span', { class: 'tb-spacer' }), expandBtn, closeBtn),
      toolbar,
      tableTools,
      editor,
      fileInput
    );

    fab = el(
      'button',
      {
        id: 'memo-fab',
        class: 'memo-fab',
        type: 'button',
        title: '项目备忘录',
        'aria-label': '项目备忘录',
        'aria-expanded': 'false',
        'aria-controls': 'memo-panel',
        hidden: true,
        onclick: () => (open ? closePanel() : openPanel()),
      },
      icon('note'),
      el('span', { class: 'memo-badge', 'aria-hidden': 'true' })
    );

    document.getElementById('app').append(fab, panel);
    document.execCommand('defaultParagraphSeparator', false, 'p');
  }

  function bind() {
    editor.addEventListener('input', onEdit);
    editor.addEventListener('blur', flush);

    editor.addEventListener('paste', (e) => {
      if (!e.clipboardData) return;
      e.preventDefault();
      handleIncoming(e.clipboardData);
    });

    editor.addEventListener('dragstart', () => {
      internalDrag = true;
    });
    editor.addEventListener('dragend', () => {
      internalDrag = false;
    });
    editor.addEventListener('dragover', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
    });
    editor.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      if (internalDrag) {
        internalDrag = false; // 编辑区内部拖动：交给浏览器移动内容
        return;
      }
      e.preventDefault();
      if (!canEdit()) return;
      const r = document.caretRangeFromPoint && document.caretRangeFromPoint(e.clientX, e.clientY);
      if (r && editor.contains(r.startContainer)) lastRange = r;
      ensureSelection(r && editor.contains(r.startContainer) ? r : null);
      handleIncoming(dt);
    });

    // 按住 Ctrl 单击链接打开浏览器：见 links.js

    editor.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openLinkDialog();
        return;
      }
      if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
      const info = currentCell();
      if (info) {
        // 表格里 Tab / Shift+Tab 在单元格间移动，停在最后一格时自动加一行
        e.preventDefault();
        const cells = Array.from(info.table.querySelectorAll('th, td'));
        const i = cells.indexOf(info.cell) + (e.shiftKey ? -1 : 1);
        if (i < 0) return;
        if (i >= cells.length) {
          const row = addRow(info);
          onEdit();
          placeCaret(row.cells[0], false);
        } else {
          placeCaret(cells[i], false);
        }
      } else if (editor.contains(getSelection().anchorNode) && anchorLi()) {
        e.preventDefault();
        document.execCommand(e.shiftKey ? 'outdent' : 'indent');
      }
    });

    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        closePanel();
        fab.focus();
      }
    });

    document.addEventListener('selectionchange', () => {
      if (!open) return;
      const sel = getSelection();
      if (!sel.rangeCount || !editor.contains(sel.anchorNode)) return;
      lastRange = sel.getRangeAt(0).cloneRange();
      tableTools.hidden = !currentCell();
      updateFormatState();
    });
  }

  function anchorLi() {
    const sel = getSelection();
    const n = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    return n && n.closest('li');
  }

  function init(opts) {
    if (inited) return;
    api = opts.api;
    getProject = opts.getProject;
    onHasChange = opts.onHasMemoChange;
    build();
    bind();
    inited = true;
    sync();
  }

  window.Memo = { init, sync, flush: () => inited && flush(), discard, sanitize: (html) => sanitizeToElement(html).innerHTML };
})();

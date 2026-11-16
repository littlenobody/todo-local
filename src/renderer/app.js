'use strict';
(function () {
  const { $, el, icon, toast, openModal, closeModal, confirmDialog } = window.Dom;
  const TL = window.TaskLib;
  const KM = window.Keymap;
  const api = window.api;

  /* ---------- 状态 ---------- */
  let state = null;
  let dataDir = '';
  let shortcut = '';
  let updateStatus = null;
  let appVersion = '';
  let updateToasted = '';
  let searchText = '';
  const filter = { include: [], exclude: [], mode: 'and' }; // 标签键均为小写
  let tagbarOpen = false;
  let addingSub = null; // 正在添加子任务的父任务 id
  let pendingFocus = null; // { id, sel } 渲染后聚焦
  let composer = null; // { pid, text }：正在列表末尾“添加任务”框里编辑的项目与草稿
  let composerFocus = false; // 渲染后把焦点放回添加框
  let listRendering = false; // 重建列表期间，忽略被移除输入框触发的 blur
  const doneOpen = new Set(); // 已展开的“已完成”分组
  let saveTimer = null;
  let draggingTaskId = null;
  let currentDropRow = null;
  let currentDropPlacement = null;
  let keyBindings = {}; // 当前生效的快捷键 { 操作id: 组合键 }
  let keyLookup = new Map(); // 组合键 -> 操作id
  const fresh = new Set(); // 用快捷键新建、还没写内容的任务 id；离开时仍为空就丢弃
  let pointerDown = false;
  let sweepPending = false; // 鼠标按下期间离开了空白新任务，松开后再清理
  const ROW_TEXT = '.row .task-text'; // 配合 pendingFocus.sel，定位任务行里的文字框

  const short = (t) => TL.taskLabel(t, 18);
  const nodeOf = (id) => document.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
  const getPredicate = () => TL.andPredicates(TL.makeTagPredicate(filter), TL.makeSearchPredicate(searchText));
  const isComposing = (e) => e.isComposing || e.keyCode === 229;

  /* ---------- 快捷键：显示辅助 ---------- */
  const keyOf = (id) => (keyBindings[id] ? KM.formatCombo(keyBindings[id]) : '');
  const withKey = (label, id) => (keyOf(id) ? `${label}（${keyOf(id)}）` : label);

  function applyKeyHints() {
    $('#search').placeholder = withKey('搜索内容、标签', 'search');
    $('#btn-settings').title = withKey('设置', 'openSettings');
    $('#btn-filter').title = withKey('按标签筛选', 'toggleFilter');
  }

  function rebuildKeys() {
    keyBindings = KM.resolve(state.settings.keybindings);
    keyLookup = KM.buildLookup(keyBindings);
    applyKeyHints();
  }

  function taskTextTitle() {
    const parts = ['Enter 换行'];
    if (keyOf('addSibling')) parts.push(`${keyOf('addSibling')} 新建同级任务`);
    if (keyOf('addChild')) parts.push(`${keyOf('addChild')} 新建子任务`);
    parts.push(`${[keyOf('finishEdit'), 'Esc'].filter(Boolean).join(' 或 ')} 结束编辑`);
    if (keyOf('openShortcuts')) parts.push(`${keyOf('openShortcuts')} 查看全部快捷键`);
    return parts.join(' · ');
  }

  function clearDropIndicators() {
    if (currentDropRow) {
      currentDropRow.classList.remove('drop-before', 'drop-after', 'drop-inside');
      currentDropRow = null;
    }
    currentDropPlacement = null;
    document.querySelectorAll('.node.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
  }

  /* ---------- 保存 ---------- */
  function commit(immediate) {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (immediate) api.save(state);
    else
      saveTimer = setTimeout(() => {
        saveTimer = null;
        api.save(state);
      }, 200);
  }
  function flush() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    api.save(state);
  }
  window.addEventListener('pagehide', () => {
    dropFresh(null, true);
    flush();
    window.Memo.flush();
  });

  /* ---------- 视图辅助 ---------- */
  function scopeProjects() {
    return state.ui.view === 'all' ? state.projects : state.projects.filter((p) => p.id === state.ui.view);
  }
  function projectById(id) {
    return state.projects.find((p) => p.id === id);
  }
  function setView(id) {
    state.ui.view = id;
    composer = null;
    addingSub = null;
    document.body.classList.remove('drawer-open');
    commit();
    renderAll();
  }
  function applyMode() {
    document.body.classList.toggle('note', state.settings.noteMode);
    checkNarrow();
  }
  function checkNarrow() {
    document.body.classList.toggle('narrow', window.innerWidth < 640);
    if (window.innerWidth >= 640 && !state.settings.noteMode) document.body.classList.remove('drawer-open');
  }
  function setNoteMode(note) {
    state.settings.noteMode = note;
    document.body.classList.remove('drawer-open', 'show-search');
    applyMode();
    renderAll();
    commit(true);
  }

  /* ---------- 渲染：标题栏 / 侧栏 ---------- */
  function renderTitlebar() {
    const note = state.settings.noteMode;
    let name;
    let open;
    if (state.ui.view === 'all') {
      name = '全部项目';
      open = state.projects.reduce((n, p) => n + TL.countOpen(p.tasks), 0);
    } else {
      const p = projectById(state.ui.view);
      name = p.name;
      open = TL.countOpen(p.tasks);
    }
    $('#tb-title').replaceChildren(name, el('span', { class: 'sub', text: `${open} 项待办` }));
    const mode = $('#btn-mode');
    const label = withKey(note ? '切换为普通窗口' : '切换为便笺模式', 'toggleMode');
    mode.replaceChildren(icon(note ? 'window' : 'sticky'));
    mode.title = label;
    mode.setAttribute('aria-label', label);
    const closeLabel = note ? '退出程序' : '隐藏到系统托盘';
    $('#btn-close').title = closeLabel;
    $('#btn-close').setAttribute('aria-label', closeLabel);
    const pinned = !!state.settings.noteAlwaysOnTop;
    const pin = $('#btn-pin');
    pin.setAttribute('aria-pressed', String(pinned));
    pin.title = withKey(pinned ? '取消置顶' : '置顶显示', 'togglePin');
    pin.setAttribute('aria-label', pin.title);
  }

  function renderSidebar() {
    const ul = $('#project-list');
    const item = (id, name, color, roots, project) => {
      const active = state.ui.view === id;
      const open = TL.countOpen(roots);
      const overdue = TL.countOverdue(roots);
      const badge = overdue
        ? el('span', { class: 'count overdue', title: `${overdue} 项已逾期`, text: String(overdue) })
        : open
          ? el('span', { class: 'count', text: String(open) })
          : null;
      const li = el(
        'li',
        { class: 'proj-item' + (active ? ' active' : '') },
        el(
          'button',
          { class: 'proj-main', type: 'button', 'aria-current': active ? 'true' : null, onclick: () => setView(id) },
          el('span', { class: 'dot', style: color ? { background: color } : null }),
          el('span', { class: 'proj-name', text: name }),
          badge
        )
      );
      if (project) {
        li.append(
          el(
            'div',
            { class: 'proj-actions' },
            el('button', { class: 'icon-btn small', type: 'button', title: '编辑项目', 'aria-label': `编辑项目 ${name}`, onclick: () => openProjectDialog(project) }, icon('edit')),
            el('button', { class: 'icon-btn small', type: 'button', title: '删除项目', 'aria-label': `删除项目 ${name}`, onclick: () => deleteProject(project) }, icon('trash'))
          )
        );
      }
      return li;
    };
    ul.replaceChildren(
      item('all', '全部项目', null, state.projects.flatMap((p) => p.tasks)),
      ...state.projects.map((p) => item(p.id, p.name, p.color, p.tasks, p))
    );
  }

  /* ---------- 渲染：标签筛选条 ---------- */
  function cycleTag(key) {
    if (filter.include.includes(key)) {
      filter.include = filter.include.filter((k) => k !== key);
      filter.exclude.push(key);
    } else if (filter.exclude.includes(key)) {
      filter.exclude = filter.exclude.filter((k) => k !== key);
    } else {
      filter.include.push(key);
    }
    renderTagbar();
    renderList();
    const again = $('#tagbar').querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (again) again.focus();
  }
  function toggleInclude(tag) {
    const key = tag.toLowerCase();
    filter.exclude = filter.exclude.filter((k) => k !== key);
    if (filter.include.includes(key)) filter.include = filter.include.filter((k) => k !== key);
    else filter.include.push(key);
    renderTagbar();
    renderList();
  }
  function clearFilter() {
    filter.include = [];
    filter.exclude = [];
    renderTagbar();
    renderList();
  }

  function renderTagbar() {
    const n = filter.include.length + filter.exclude.length;
    const badge = $('#filter-badge');
    badge.hidden = n === 0;
    badge.textContent = String(n);
    const btn = $('#btn-filter');
    btn.classList.toggle('active', n > 0 || tagbarOpen);
    btn.setAttribute('aria-expanded', String(tagbarOpen));
    const bar = $('#tagbar');
    bar.hidden = !tagbarOpen;
    if (!tagbarOpen) return;

    const map = new Map();
    scopeProjects().forEach((p) => TL.collectTags(p.tasks, map));
    [...filter.include, ...filter.exclude].forEach((k) => {
      if (!map.has(k)) map.set(k, { name: k, count: 0 });
    });
    const tags = [...map.entries()].sort((a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name, 'zh'));

    const segBtn = (label, mode) =>
      el(
        'button',
        {
          type: 'button',
          'aria-pressed': String(filter.mode === mode),
          onclick: () => {
            filter.mode = mode;
            renderTagbar();
            renderList();
          },
        },
        label
      );
    const head = el(
      'div',
      { class: 'tagbar-head' },
      el('strong', { text: '标签筛选' }),
      el('div', { class: 'segmented', role: 'group', 'aria-label': '多个标签的组合方式' }, segBtn('满足全部', 'and'), segBtn('满足任一', 'or')),
      n ? el('button', { class: 'btn small', type: 'button', onclick: clearFilter }, '清除筛选') : null
    );
    const chips = tags.map(([key, info]) => {
      const st = filter.include.includes(key) ? 'inc' : filter.exclude.includes(key) ? 'exc' : '';
      const stLabel = st === 'inc' ? '已包含' : st === 'exc' ? '已排除' : '未选择';
      return el(
        'button',
        { class: 'chip tag ' + st, type: 'button', dataset: { key }, 'aria-label': `${info.name}，${info.count} 项，${stLabel}`, onclick: () => cycleTag(key) },
        '#' + info.name,
        el('span', { text: String(info.count) })
      );
    });
    bar.replaceChildren(
      ...[
        head,
        tags.length ? el('div', { class: 'tagbar-chips' }, chips) : el('div', { class: 'empty small', text: '还没有标签，在任务详情里添加' }),
        tags.length ? el('p', { class: 'tagbar-hint', text: '点击标签切换：包含 → 排除 → 取消' }) : null,
      ].filter(Boolean) // 原生 replaceChildren 会把 null 变成文字 "null"
    );
  }

  function updateTagSuggest() {
    const map = new Map();
    state.projects.forEach((p) => TL.collectTags(p.tasks, map));
    $('#tag-suggest').replaceChildren(...[...map.values()].map((t) => el('option', { value: t.name })));
  }

  /* ---------- 渲染：任务列表 ---------- */
  function renderList() {
    dropFresh(pendingFocus && pendingFocus.id);
    const list = $('#list');
    const scrollTop = list.scrollTop;
    const pred = getPredicate();
    const view = state.ui.view;
    const frag = document.createDocumentFragment();
    let total = 0;

    for (const project of scopeProjects()) {
      const nodes = TL.filterTree(project.tasks, pred);
      if (view === 'all' && pred && !nodes.length) continue;
      total += nodes.length;
      if (view === 'all') {
        frag.append(
          el(
            'div',
            { class: 'proj-head' },
            el('span', { class: 'dot', style: { background: project.color } }),
            el('button', { class: 'link', type: 'button', onclick: () => setView(project.id) }, project.name),
            el('span', { class: 'count', text: `${TL.countOpen(project.tasks)} 项待办` })
          )
        );
      }
      if (nodes.length) frag.append(renderLevel(nodes, project, 'root:' + project.id, false, !!pred, buildAddBox(project)));
      else {
        if (!pred) frag.append(el('div', { class: 'empty' + (view === 'all' ? ' small' : ''), text: '还没有任务' }));
        else if (view !== 'all') frag.append(noResults());
        frag.append(buildAddBox(project));
      }
    }
    if (pred && total === 0 && view === 'all') frag.append(noResults());
    listRendering = true;
    list.replaceChildren(frag);
    listRendering = false;
    list.scrollTop = scrollTop;

    if (composerFocus) {
      composerFocus = false;
      const ta = list.querySelector('.add-box.open textarea');
      if (ta) {
        ta.focus();
        ta.scrollIntoView({ block: 'nearest' });
      }
    }

    if (pendingFocus) {
      const { id, sel, range, alt } = pendingFocus;
      pendingFocus = null;
      let node = nodeOf(id);
      const usedAlt = !node && !!alt;
      if (usedAlt) node = nodeOf(alt); // 原任务已不可见（已删除、收进“已完成”），改为聚焦相邻任务
      const target = node && node.querySelector(':scope > ' + sel);
      if (target) {
        target.focus();
        if (range === 'end') target.setSelectionRange(target.value.length, target.value.length);
        else if (range && !usedAlt && target.setSelectionRange) target.setSelectionRange(range[0], range[1]);
        target.scrollIntoView({ block: 'nearest' });
      }
    }
    if (fresh.size) scheduleSweep();
  }

  function noResults() {
    return el(
      'div',
      { class: 'empty' },
      el('div', { text: '没有符合条件的任务' }),
      el(
        'button',
        {
          class: 'btn small',
          type: 'button',
          onclick: () => {
            searchText = '';
            $('#search').value = '';
            $('#search-clear').hidden = true;
            filter.include = [];
            filter.exclude = [];
            renderTagbar();
            renderList();
          },
        },
        '清除搜索和筛选'
      )
    );
  }

  /** tail：追加在本层未完成任务之后、“已完成”分组之前（新任务正好插在这里） */
  function renderLevel(nodes, project, groupKey, inDone, filtering, tail) {
    const box = el('div', { class: 'level' });
    const group = state.settings.completedToBottom && !inDone;
    const openNodes = group ? nodes.filter((n) => !n.task.done) : nodes;
    const doneNodes = group ? nodes.filter((n) => n.task.done) : [];
    openNodes.forEach((n) => box.append(renderNode(n, project, inDone, filtering)));
    if (tail) box.append(tail);
    if (doneNodes.length) {
      const expanded = filtering || doneOpen.has(groupKey);
      const label = [icon('chevronRight'), `已完成 (${doneNodes.length})`];
      if (filtering) {
        box.append(el('div', { class: 'done-toggle open' }, ...label));
      } else {
        box.append(
          el(
            'button',
            {
              class: 'done-toggle' + (expanded ? ' open' : ''),
              type: 'button',
              'aria-expanded': String(expanded),
              onclick: () => {
                if (doneOpen.has(groupKey)) doneOpen.delete(groupKey);
                else doneOpen.add(groupKey);
                renderList();
              },
            },
            ...label
          )
        );
      }
      if (expanded) doneNodes.forEach((n) => box.append(renderNode(n, project, inDone, filtering)));
    }
    return box;
  }

  function renderNode(node, project, inDone, filtering) {
    const t = node.task;
    const wrap = el('div', { class: 'node', dataset: { id: t.id } });
    wrap.append(buildRow(node, project, filtering));
    if (addingSub === t.id) wrap.append(buildSubForm(t, project));
    if (node.children.length && (filtering || !t.collapsed)) {
      wrap.append(el('div', { class: 'children' }, renderLevel(node.children, project, t.id, inDone || t.done, filtering)));
    }
    return wrap;
  }

  function iconBtn(name, label, onclick, pressed, extra) {
    return el(
      'button',
      {
        class: 'icon-btn small' + (extra ? ' ' + extra : ''),
        type: 'button',
        title: label,
        'aria-label': label,
        'aria-pressed': pressed === undefined ? null : String(pressed),
        onclick,
      },
      icon(name)
    );
  }

  function buildRow(node, project, filtering) {
    const t = node.task;
    const hasKids = t.children.length > 0;
    const expanded = filtering || !t.collapsed;

    const dragHandle = el(
      'span',
      {
        class: 'drag-handle',
        title: '拖动排序',
        'aria-label': '拖动排序',
        draggable: 'true',
      },
      icon('drag')
    );
    dragHandle.addEventListener('dragstart', (e) => {
      draggingTaskId = t.id;
      e.dataTransfer.setData('text/plain', t.id);
      e.dataTransfer.effectAllowed = 'move';
      const nodeEl = nodeOf(t.id);
      if (nodeEl) {
        setTimeout(() => nodeEl.classList.add('is-dragging'), 0);
      }
    });
    dragHandle.addEventListener('dragend', () => {
      clearDropIndicators();
      draggingTaskId = null;
    });

    const twisty = hasKids
      ? el(
          'button',
          {
            class: 'twisty' + (expanded ? ' open' : ''),
            type: 'button',
            'aria-expanded': String(expanded),
            'aria-label': expanded ? '收起子任务' : '展开子任务',
            onclick: () => {
              t.collapsed = !t.collapsed;
              commit();
              renderList();
            },
          },
          icon('chevronRight')
        )
      : el('span', { class: 'twisty ph' });

    const check = el(
      'button',
      {
        class: 'check' + (t.done ? ' done' : ''),
        type: 'button',
        role: 'checkbox',
        'aria-checked': String(t.done),
        'aria-label': t.done ? '标记为未完成' : '标记为完成',
        onclick: () => toggleDone(project, t),
      },
      t.done ? icon('check') : null
    );

    const text = el('textarea', {
      class: 'task-text',
      rows: '1',
      maxlength: '20000',
      spellcheck: 'false',
      placeholder: '写点内容…',
      title: taskTextTitle(),
      'aria-label': '任务内容',
    });
    text.value = t.note;
    text.addEventListener('input', () => {
      t.note = text.value;
      commit();
    });
    // 新建、缩进、移动等快捷键由 onGlobalKey 统一处理；Esc 固定为结束编辑
    text.addEventListener('keydown', (e) => {
      if (isComposing(e)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        text.blur();
      }
    });
    text.addEventListener('change', () => {
      tidyText(text, t); // 结束编辑时规整空白
      commit();
    });

    const row = el(
      'div',
      { class: 'row' + (t.done ? ' is-done' : '') + (node.match ? (getPredicate() ? ' hit' : '') : ' dim'), dataset: { id: t.id } },
      dragHandle,
      twisty,
      check,
      el('div', { class: 'row-main' }, text, buildMeta(t)),
      el(
        'div',
        { class: 'row-actions' },
        iconBtn('sub', '添加子任务', () => startSub(t)),
        iconBtn('trash', '删除任务', () => deleteTask(project, t), undefined, 'del')
      )
    );

    // 快捷键新建的空白任务的清理见 dropFresh / scheduleSweep，这里不逐行监听

    row.addEventListener('dragover', (e) => {
      if (!draggingTaskId || draggingTaskId === t.id) return;
      const sourceInfo = TL.findInState(state, draggingTaskId);
      if (sourceInfo && TL.findPath(sourceInfo.task.children, t.id)) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const rect = row.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const h = rect.height;
      let placement = 'after';
      if (relY < h * 0.35) {
        placement = 'before';
      } else if (relY > h * 0.65) {
        placement = 'after';
      } else {
        if (e.clientX - rect.left > 32) {
          placement = 'inside';
        } else {
          placement = relY < h * 0.5 ? 'before' : 'after';
        }
      }

      if (currentDropRow && currentDropRow !== row) {
        currentDropRow.classList.remove('drop-before', 'drop-after', 'drop-inside');
      }
      currentDropRow = row;
      currentDropPlacement = placement;
      row.classList.toggle('drop-before', placement === 'before');
      row.classList.toggle('drop-after', placement === 'after');
      row.classList.toggle('drop-inside', placement === 'inside');
    });

    row.addEventListener('dragleave', (e) => {
      if (row.contains(e.relatedTarget)) return;
      if (currentDropRow === row) {
        row.classList.remove('drop-before', 'drop-after', 'drop-inside');
        currentDropRow = null;
        currentDropPlacement = null;
      }
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const sourceId = draggingTaskId || e.dataTransfer.getData('text/plain');
      const placement = currentDropPlacement;
      clearDropIndicators();
      draggingTaskId = null;
      if (!sourceId || sourceId === t.id || !placement) return;

      const ok = TL.moveTaskInState(state, sourceId, t.id, placement);
      if (ok) {
        commit();
        renderAll();
      }
    });

    return row;
  }

  /* ---------- 任务内容下面平铺的信息：时间 / 标签 / 子任务进度 ---------- */
  function setDue(t, value) {
    t.due = TL.parseDue(value) ? value : null;
    commit();
    renderSidebar();
  }

  function quickDue(dayOffset, hour) {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, 0, 0, 0);
    return TL.toDueString(d);
  }

  /**
   * 时间和标签直接显示在内容下面，可就地修改。
   * 添加入口（class="ghost"）只在这一行获得焦点时显示。
   * 修改只重绘本区域，不重建整个列表，避免打断正在输入的焦点。
   */
  function buildMeta(t) {
    const meta = el('div', { class: 'meta' });
    const dueSlot = el('span', { class: 'contents' });
    const tagsBox = el('span', { class: 'contents' });
    let editingDue = false;

    const syncInfo = () => meta.classList.toggle('has-info', !!(t.due || t.tags.length || t.children.length || editingDue));

    const paintDue = () => {
      syncInfo();
      if (editingDue) {
        const input = el('input', { class: 'due-input', type: 'datetime-local', 'aria-label': '到期时间', value: t.due });
        input.addEventListener('change', () => setDue(t, input.value));
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            input.blur();
            const rowEl = meta.closest('.row');
            const ta = rowEl && rowEl.querySelector('.task-text');
            if (ta) ta.focus(); // 回到文字框，方便继续用键盘操作
          }
        });
        input.addEventListener('blur', () => {
          if (!editingDue) return;
          editingDue = false;
          paintDue();
        });
        dueSlot.replaceChildren(input);
        input.focus();
        try {
          input.showPicker();
        } catch {
          /* 需要用户操作才能弹出，失败时手动输入即可 */
        }
        return;
      }
      const edit = () => {
        editingDue = true;
        paintDue();
      };
      if (t.due) {
        const st = TL.dueState(t);
        dueSlot.replaceChildren(
          el('button', { class: 'chip due ' + st, type: 'button', title: '修改时间', onclick: edit }, icon('clock'), TL.formatDue(t.due) + (st === 'overdue' ? '（已逾期）' : '')),
          el(
            'button',
            {
              class: 'chip ghost icon-chip',
              type: 'button',
              title: '清除时间',
              'aria-label': '清除时间',
              onclick: () => {
                setDue(t, '');
                paintDue();
              },
            },
            icon('close')
          )
        );
      } else {
        const quick = (label, value) =>
          el(
            'button',
            {
              class: 'chip ghost',
              type: 'button',
              onclick: () => {
                setDue(t, value);
                paintDue();
              },
            },
            label
          );
        dueSlot.replaceChildren(
          el('button', { class: 'chip ghost', type: 'button', title: '设置到期时间', onclick: edit }, icon('clock'), '时间'),
          quick('今天 18:00', quickDue(0, 18)),
          quick('明天 9:00', quickDue(1, 9))
        );
      }
    };

    // 快捷键触发：直接进入时间编辑
    meta.addEventListener('edit-due', () => {
      if (editingDue) return;
      editingDue = true;
      paintDue();
    });

    const tagsChanged = () => {
      commit();
      syncInfo();
      renderTagbar();
      updateTagSuggest();
    };
    const paintTags = () => {
      tagsBox.replaceChildren(
        ...t.tags.map((tag) => {
          const active = filter.include.includes(tag.toLowerCase()) ? ' active' : '';
          return el(
            'span',
            { class: 'chip tag removable' + active },
            el('button', { class: 'chip-label', type: 'button', title: '按此标签筛选', onclick: () => toggleInclude(tag) }, '#' + tag),
            el(
              'button',
              {
                type: 'button',
                title: '移除标签',
                'aria-label': `移除标签 ${tag}`,
                onclick: () => {
                  t.tags = t.tags.filter((x) => x !== tag);
                  paintTags();
                  tagsChanged();
                },
              },
              icon('close')
            )
          );
        })
      );
    };

    const tagInput = el('input', { class: 'tag-input ghost', type: 'text', maxlength: '30', list: 'tag-suggest', placeholder: '＋标签', 'aria-label': '添加标签' });
    const addTags = () => {
      const fresh = TL.splitTagInput(tagInput.value);
      tagInput.value = '';
      if (!fresh.length) return;
      t.tags = TL.uniqueTags([...t.tags, ...fresh]);
      paintTags();
      tagsChanged();
    };
    tagInput.addEventListener('keydown', (e) => {
      if (isComposing(e)) return;
      if (e.key === 'Enter' && !tagInput.value.trim()) {
        // 标签框是空的再按回车：回到任务文字
        e.preventDefault();
        const rowEl = meta.closest('.row');
        const ta = rowEl && rowEl.querySelector('.task-text');
        if (ta) ta.focus();
      } else if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
        e.preventDefault();
        addTags();
      } else if (e.key === 'Backspace' && !tagInput.value && t.tags.length) {
        t.tags = t.tags.slice(0, -1);
        paintTags();
        tagsChanged();
      } else if (e.key === 'Escape') {
        tagInput.blur();
        const rowEl = meta.closest('.row');
        const ta = rowEl && rowEl.querySelector('.task-text');
        if (ta) ta.focus();
      }
    });
    tagInput.addEventListener('blur', addTags);

    let progress = null;
    if (t.children.length) {
      const done = t.children.filter((c) => c.done).length;
      progress = el('span', { class: 'chip', title: '子任务完成进度', text: `${done}/${t.children.length}` });
    }

    meta.append(...[dueSlot, tagsBox, progress, tagInput].filter(Boolean));
    paintDue();
    paintTags();
    return meta;
  }

  /* ---------- 任务操作 ---------- */
  /* ---------- 列表末尾的“添加任务”框 ---------- */
  /**
   * 平时是一行“＋ 添加任务”，点击后变成文本域：Enter 换行，Ctrl+Enter 添加，Esc 取消。
   * 内容里的 #标签 会被提取为标签。重建列表时草稿会保留；失焦且内容为空时自动收起。
   */
  function buildAddBox(project) {
    const box = el('div', { class: 'add-box' });

    const submit = (fromBlur = false) => {
      if (!composer) return;
      const parsed = TL.parseQuickInput(composer.text);
      if (!parsed.text && !parsed.tags.length) {
        if (fromBlur) {
          composer = null;
          paint();
        }
        return;
      }
      if (fromBlur) {
        composer = null;
        composerFocus = false;
      } else {
        composer = { pid: project.id, text: '' };
        composerFocus = true; // Ctrl+Enter 添加后保持展开，方便连续输入
      }
      addTask(project, null, parsed);
    };

    const paint = () => {
      const open = !!composer && composer.pid === project.id;
      box.classList.toggle('open', open);
      if (!open) {
        box.replaceChildren(
          el(
            'button',
            {
              class: 'add-open',
              title: withKey('添加任务', 'newTask'),
              type: 'button',
              onclick: () => {
                composer = { pid: project.id, text: '' };
                paint();
                const ta = box.querySelector('textarea');
                ta.focus();
                ta.scrollIntoView({ block: 'nearest' });
              },
            },
            el('span', { class: 'drag-handle ph' }),
            el('span', { class: 'twisty ph' }),
            el('span', { class: 'check add' }, icon('plus')),
            el('span', { class: 'add-label', text: '添加任务' })
          )
        );
        return;
      }

      const ta = el('textarea', {
        class: 'task-text add-text',
        rows: '2',
        maxlength: '20000',
        spellcheck: 'false',
        placeholder: '写点内容，可用 #标签',
        'aria-label': '添加任务',
      });
      ta.value = composer.text;
      ta.addEventListener('input', () => {
        composer.text = ta.value;
      });
      ta.addEventListener('keydown', (e) => {
        if (isComposing(e)) return;
        const combo = KM.comboFromEvent(e);
        if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || (combo && combo === keyBindings.addSibling)) {
          e.preventDefault();
          composer.text = ta.value;
          submit(false);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          composer = null;
          paint();
        }
      });
      ta.addEventListener('blur', () => {
        if (listRendering || !composer || composer.pid !== project.id) return;
        composer.text = ta.value;
        submit(true);
      });
      box.replaceChildren(
        el(
          'div',
          { class: 'row add-row' },
          el('span', { class: 'drag-handle ph' }),
          el('span', { class: 'twisty ph' }),
          el('span', { class: 'check add' }, icon('plus')),
          el(
            'div',
            { class: 'row-main' },
            ta,
            el(
              'div',
              { class: 'add-hint' },
              el('span', { text: '失焦自动保存 · Ctrl+Enter 继续添加 · Esc 取消' })
            )
          )
        )
      );
    };

    paint();
    return box;
  }

  function addTask(project, parent, parsed) {
    const task = TL.createTask(parsed.text, { tags: parsed.tags });
    const keep = state.settings.completedToBottom;
    if (parent) {
      if (parent.done) TL.setDone(project.tasks, parent.id, false, { moveToBottom: keep });
      parent.collapsed = false;
      TL.insertTask(parent.children, task, keep);
    } else {
      TL.insertTask(project.tasks, task, keep);
    }
    commit();
    // 从列表末尾的添加框连续添加时，文本域保持展开并已滚动到可见位置，不再把视图拉到新任务
    const fromAddBox = !parent && !!composer && composer.pid === project.id;
    renderAll();
    const pred = getPredicate();
    if (pred && !pred(task)) toast('已添加，但不符合当前搜索或筛选，暂时不可见');
    else {
      const n = nodeOf(task.id);
      if (n) {
        if (!fromAddBox) n.scrollIntoView({ block: 'nearest' });
        flash(n);
      }
    }
  }

  function flash(node) {
    const row = node.querySelector(':scope > .row');
    if (!row) return;
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 2000);
  }

  function startSub(t) {
    addingSub = t.id;
    t.collapsed = false;
    pendingFocus = { id: t.id, sel: '.sub-form .sub-input' };
    renderList();
  }

  function buildSubForm(t, project) {
    const input = el('input', { class: 'sub-input', type: 'text', maxlength: '200', placeholder: '子任务，回车或失焦添加，Esc 结束', 'aria-label': `为「${short(t)}」添加子任务` });
    const form = el('form', { class: 'sub-form', autocomplete: 'off' }, input);
    let handled = false;
    const saveSub = () => {
      if (handled) return;
      handled = true;
      const parsed = TL.parseQuickInput(input.value);
      if (!parsed.text && !parsed.tags.length) {
        if (addingSub === t.id) addingSub = null;
        renderList();
        return;
      }
      addingSub = null;
      addTask(project, t, parsed);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveSub();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !isComposing(e)) {
        handled = true;
        addingSub = null;
        renderList();
      }
    });
    input.addEventListener('blur', () => {
      if (listRendering || handled) return;
      saveSub();
    });
    return form;
  }

  function toggleDone(project, t) {
    const willDone = !t.done;
    const snap = [];
    TL.walk([t], (x) => snap.push([x, x.done, x.doneAt]));
    TL.setDone(project.tasks, t.id, willDone, { moveToBottom: state.settings.completedToBottom });
    commit();
    renderAll();
    if (willDone && state.settings.completedToBottom) {
      toast(`已完成「${short(t)}」，收起到“已完成”`, {
        action: '撤销',
        onAction: () => {
          TL.setDone(project.tasks, t.id, false, { moveToBottom: true });
          snap.forEach(([x, done, at]) => {
            x.done = done;
            x.doneAt = at;
          });
          commit();
          renderAll();
        },
      });
    }
  }

  function deleteTask(project, t) {
    const path = TL.findPath(project.tasks, t.id);
    if (!path) return;
    const { siblings, index } = path[path.length - 1];
    const parentId = path.length > 1 ? path[path.length - 2].task.id : null;
    siblings.splice(index, 1);
    if (addingSub === t.id) addingSub = null;
    commit();
    renderAll();
    const extra = t.children.length ? `（含 ${t.children.length} 个子任务）` : '';
    toast(`已删除「${short(t)}」${extra}`, {
      action: '撤销',
      onAction: () => {
        const p = projectById(project.id);
        if (!p) return;
        let target = p.tasks;
        if (parentId) {
          const pp = TL.findPath(p.tasks, parentId);
          if (pp) target = pp[pp.length - 1].task.children;
        }
        target.splice(Math.min(index, target.length), 0, t);
        commit();
        renderAll();
      },
    });
  }

  /* ---------- 项目操作 ---------- */
  function addProject(name) {
    const p = TL.createProject(name, state.projects.length);
    state.projects.push(p);
    setView(p.id);
  }

  function openProjectDialog(project) {
    let color = project.color;
    const name = el('input', { class: 'field', type: 'text', maxlength: '40', 'aria-label': '项目名称' });
    name.value = project.name;
    const swatches = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': '项目颜色' });
    const paint = () =>
      swatches.replaceChildren(
        ...TL.PROJECT_COLORS.map((c) =>
          el('button', {
            class: 'swatch' + (c === color ? ' sel' : ''),
            type: 'button',
            role: 'radio',
            'aria-checked': String(c === color),
            'aria-label': c,
            style: { background: c },
            onclick: () => {
              color = c;
              paint();
              swatches.querySelector('.sel').focus();
            },
          })
        )
      );
    paint();
    const save = () => {
      const v = name.value.trim();
      if (!v) {
        name.focus();
        return;
      }
      project.name = v;
      project.color = color;
      commit();
      closeModal();
      renderAll();
    };
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !isComposing(e)) {
        e.preventDefault();
        save();
      }
    });
    openModal({
      title: '编辑项目',
      body: el('div', { class: 'form-grid' }, el('label', {}, el('div', { text: '名称' }), name), el('div', {}, el('div', { text: '颜色' }), swatches)),
      actions: [
        el('button', { class: 'btn', type: 'button', onclick: closeModal }, '取消'),
        el('button', { class: 'btn primary', type: 'button', onclick: save }, '保存'),
      ],
      focus: name,
    });
  }

  async function deleteProject(project) {
    let count = 0;
    TL.walk(project.tasks, () => count++);
    const ok = await confirmDialog('删除项目', `确定删除项目「${project.name}」及其中的 ${count} 个任务吗？此操作无法撤销。`, '删除', true);
    if (!ok) return;
    state.projects = state.projects.filter((p) => p.id !== project.id);
    window.Memo.discard(project.id);
    if (!state.projects.length) state.projects.push(TL.createProject('收件箱', 0));
    if (state.ui.view === project.id) state.ui.view = state.projects[0].id;
    composer = null;
    addingSub = null;
    commit();
    renderAll();
  }

  /* ---------- 设置 ---------- */
  function switchRow(label, desc, checked, onChange) {
    const id = 'sw-' + Math.random().toString(36).slice(2);
    const input = el('input', { type: 'checkbox', role: 'switch', id, checked });
    input.addEventListener('change', () => onChange(input.checked));
    return el(
      'div',
      { class: 'setting' },
      el('label', { class: 'setting-text', for: id }, el('span', { text: label }), desc ? el('span', { class: 'setting-desc', text: desc }) : null),
      input
    );
  }

  /* ---------- 软件更新 ---------- */
  /** 说明文字始终以当前版本号开头，后面跟检查 / 下载状态 */
  function updateText(u) {
    const cur = `当前版本 v${u.current || appVersion}`;
    switch (u.state) {
      case 'checking':
        return `${cur}，正在检查更新…`;
      case 'uptodate':
        return `${cur}，已是最新`;
      case 'downloading':
        return `${cur}，正在下载 v${u.version}（${u.percent || 0}%）`;
      case 'ready':
        return `${cur}，v${u.version} 已下载完成，可以安装`;
      case 'error':
        return `${cur}，检查更新失败：${u.message}`;
      default:
        return cur;
    }
  }

  /** 设置里的“软件更新”一行；状态变化时原地刷新 */
  function renderUpdateRow() {
    const row = document.getElementById('update-row');
    if (!row) return;
    const u = updateStatus || { state: 'idle', current: appVersion };
    const busy = u.state === 'checking' || u.state === 'downloading';
    const ready = u.state === 'ready';
    row.replaceChildren(
      el('span', { class: 'setting-text' }, el('span', { text: '软件更新' }), el('span', { class: 'setting-desc', text: updateText(u) })),
      el(
        'button',
        {
          class: ready ? 'btn primary' : 'btn',
          type: 'button',
          disabled: busy,
          onclick: () => {
            if (ready) {
              flush();
              api.installUpdate();
            } else {
              api.checkUpdate();
            }
          },
        },
        ready ? '重启并安装' : busy ? '请稍候' : '检查更新'
      )
    );
  }

  function onUpdateStatus(u) {
    updateStatus = u;
    renderUpdateRow();
    if (u && u.state === 'ready' && updateToasted !== u.version) {
      updateToasted = u.version;
      toast(`新版本 v${u.version} 已下载完成`, {
        action: '重启并安装',
        timeout: 15000,
        onAction: () => {
          flush();
          api.installUpdate();
        },
      });
    }
  }

  function openSettings(initialTab) {
    const startTab = initialTab === 'keys' ? 'keys' : 'general';
    const s = state.settings;
    const opacity = el('input', { type: 'range', min: '0.4', max: '1', step: '0.05', 'aria-label': '便笺透明度' });
    opacity.value = String(s.noteOpacity);
    opacity.addEventListener('input', () => {
      s.noteOpacity = parseFloat(opacity.value);
      commit();
    });
    const lead = el('input', { class: 'field', type: 'number', min: '0', max: '1440', step: '1', 'aria-label': '提前提醒分钟数' });
    lead.value = String(s.remindLeadMinutes);
    lead.addEventListener('change', () => {
      const n = Math.min(1440, Math.max(0, Math.round(Number(lead.value) || 0)));
      lead.value = String(n);
      s.remindLeadMinutes = n;
      commit();
    });

    const general = el(
      'div',
      { class: 'tab-panel', id: 'panel-general', role: 'tabpanel', 'aria-labelledby': 'tab-general' },
      switchRow('开机自启动', '计算机开机登录后自动启动待办清单', s.autoStart, (v) => {
        s.autoStart = v;
        commit();
      }),
      switchRow('便笺模式', '小窗口、隐藏托盘图标、窗口层级较低', s.noteMode, (v) => {
        closeModal();
        setNoteMode(v);
      }),
      switchRow('完成后置底并收起', '完成的任务移到当前层级最下面，收进“已完成”', s.completedToBottom, (v) => {
        s.completedToBottom = v;
        commit();
        renderAll();
      }),
      switchRow('便笺模式置于底层', '失去焦点后沉到其他窗口下面', s.noteSendToBottom, (v) => {
        s.noteSendToBottom = v;
        commit();
      }),
      switchRow('便笺置顶显示', '始终显示在其他窗口上面；开启后“置于底层”不生效', s.noteAlwaysOnTop, (v) => {
        s.noteAlwaysOnTop = v;
        commit();
        renderTitlebar();
      }),
      switchRow('便笺贴边收起', '拖到屏幕左、右、上边缘后自动缩起，鼠标移到边缘再展开', s.noteEdgeDock, (v) => {
        s.noteEdgeDock = v;
        commit();
      }),
      el('div', { class: 'setting' }, el('span', { class: 'setting-text' }, el('span', { text: '便笺透明度' })), opacity),
      el(
        'div',
        { class: 'setting' },
        el('label', { class: 'setting-text', for: 'lead-min' }, el('span', { text: '提前提醒（分钟）' }), el('span', { class: 'setting-desc', text: '0 表示到点才提醒' })),
        lead
      ),
      el('div', { class: 'setting', id: 'update-row' }),
      el(
        'div',
        { class: 'settings-foot' },
        el('button', { class: 'btn', type: 'button', onclick: () => api.openDataDir() }, '打开数据目录'),
        el(
          'button',
          {
            class: 'btn danger',
            type: 'button',
            onclick: () => {
              flush();
              api.quit();
            },
          },
          '退出程序'
        )
      ),
      el('p', { class: 'settings-info', text: `数据文件夹：${dataDir}` }),
      el('p', {
        class: 'settings-info',
        text: shortcut
          ? `全局快捷键 ${shortcut.replace('CommandOrControl', 'Ctrl')}：显示 / 收起窗口。便笺模式没有托盘图标，可用它找回窗口。`
          : '全局快捷键注册失败（被其他程序占用）。便笺模式下可再次启动程序来找回窗口。',
      })
    );
    lead.id = 'lead-min';

    const keysUi = window.KeysPanel.build({
      getSettings: () => state.settings,
      getBindings: () => keyBindings,
      onChange: () => {
        commit();
        rebuildKeys();
        renderTitlebar();
      },
    });
    const tabs = [
      { id: 'general', label: '常规', panel: general },
      { id: 'keys', label: '快捷键', panel: keysUi.panel },
    ];
    const tabBtns = tabs.map((t) => el('button', { class: 'tab', type: 'button', role: 'tab', id: 'tab-' + t.id, 'aria-controls': 'panel-' + t.id }, t.label));
    const select = (id) => {
      tabs.forEach((t, i) => {
        const on = t.id === id;
        tabBtns[i].setAttribute('aria-selected', String(on));
        tabBtns[i].tabIndex = on ? 0 : -1;
        t.panel.hidden = !on;
      });
    };
    tabBtns.forEach((b, i) => {
      b.addEventListener('click', () => select(tabs[i].id));
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        select(tabs[n].id);
        tabBtns[n].focus();
      });
    });
    select(startTab);
    const body = el('div', {}, el('div', { class: 'tabs', role: 'tablist', 'aria-label': '设置分类' }, ...tabBtns), general, keysUi.panel);
    openModal({
      title: '设置',
      body,
      actions: null,
      className: 'modal-wide',
      focus: tabBtns[tabs.findIndex((t) => t.id === startTab)],
      onClose: () => {
        keysUi.dispose();
        renderAll(); // 快捷键可能有变，刷新列表里的提示文字
      },
    });
    renderUpdateRow();
  }

  /* ---------- 快捷键：空白新任务 ---------- */
  let sweepTimer = null;

  /**
   * 删除“用快捷键新建、一直没写内容”的任务，返回被删除的 id。keepId 是马上要聚焦的任务。
   * 默认跳过焦点仍在其中的那一行；force 时（关闭窗口前）不跳过。
   */
  function dropFresh(keepId, force) {
    if (!fresh.size) return [];
    if (pointerDown && !force) {
      sweepPending = true; // 鼠标按下期间不动列表，松开后再清理
      return [];
    }
    const active = document.activeElement;
    const dropped = [];
    for (const id of Array.from(fresh)) {
      const found = TL.findInState(state, id);
      if (!found || !TL.isBlankTask(found.task)) {
        fresh.delete(id); // 已经写了内容（或已不存在），不再跟踪
        continue;
      }
      if (id === keepId) continue;
      const n = nodeOf(id);
      const row = n && n.querySelector(':scope > .row');
      if (!force && row && active && row.contains(active)) continue; // 还在这一行里编辑（文字、标签、时间）
      const { siblings, index } = found.path[found.path.length - 1];
      siblings.splice(index, 1);
      fresh.delete(id);
      dropped.push(id);
    }
    if (dropped.length) commit();
    return dropped;
  }

  /** 记下任务文字框里的焦点和光标，重绘后恢复 */
  function captureFocus() {
    const a = document.activeElement;
    if (!a || !a.matches) return null;
    if (a.matches('.add-box textarea')) {
      composerFocus = true;
      return null;
    }
    if (!a.matches('.node > .row .task-text')) return null;
    return { id: a.closest('.node').dataset.id, sel: ROW_TEXT, range: [a.selectionStart, a.selectionEnd] };
  }

  /** 焦点离开后检查一次。焦点在按钮、输入框上时只隐藏被丢弃的行，避免重绘把刚点中的控件弄丢。 */
  function scheduleSweep() {
    if (sweepTimer || !fresh.size) return;
    sweepTimer = setTimeout(() => {
      sweepTimer = null;
      const dropped = dropFresh(null);
      if (!dropped.length) return;
      const a = document.activeElement;
      if (a && a !== document.body && !a.matches('.task-text')) {
        dropped.forEach((id) => {
          const n = nodeOf(id);
          if (n) n.hidden = true;
        });
        renderTitlebar();
        renderSidebar();
      } else {
        const keep = captureFocus();
        if (keep) pendingFocus = keep;
        renderAll();
      }
    }, 0);
  }

  /** 结束编辑时去掉首尾空白和行尾空格，连续空行最多保留一个 */
  function tidyText(ta, t) {
    const v = ta.value.replace(/\r\n?/g, '\n').replace(/[^\S\n]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (v !== ta.value) ta.value = v;
    t.note = v;
  }

  function togglePin() {
    state.settings.noteAlwaysOnTop = !state.settings.noteAlwaysOnTop;
    renderTitlebar();
    commit(true);
  }

  /* ---------- 快捷键：任务内操作 ---------- */
  const keepDone = () => !!state.settings.completedToBottom;
  const MIRROR_PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'wordSpacing', 'textIndent', 'tabSize', 'textTransform', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'];

  /** 光标是否在文字框的第一行（dir<0）或最后一行（dir>0），按显示行（含自动换行）判断 */
  function caretAtEdge(ta, dir) {
    if (ta.selectionStart !== ta.selectionEnd) return false;
    const cs = getComputedStyle(ta);
    const mirror = el('div', {
      style: { position: 'absolute', visibility: 'hidden', left: '-9999px', top: '0', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', boxSizing: 'border-box', width: ta.clientWidth + 'px' },
    });
    MIRROR_PROPS.forEach((p) => {
      mirror.style[p] = cs[p];
    });
    document.body.append(mirror);
    const height = (s) => {
      mirror.textContent = s + '\u200b';
      return mirror.offsetHeight;
    };
    const upTo = ta.value.slice(0, ta.selectionStart);
    const at = dir < 0 ? height(upTo) <= height('') : height(upTo) >= height(ta.value);
    mirror.remove();
    return at;
  }

  /** 除自身及其子任务外，界面上相邻的任务 id（删除 / 完成后把焦点交给它） */
  function adjacentTaskId(ta, preferNext) {
    const self = ta.closest('.node');
    let prev = null;
    let next = null;
    for (const x of $('#list').querySelectorAll('.node > .row .task-text')) {
      if (self.contains(x)) continue;
      if (x.compareDocumentPosition(ta) & Node.DOCUMENT_POSITION_FOLLOWING) prev = x;
      else if (!next) next = x;
    }
    const pick = preferNext ? next || prev : prev || next;
    return pick ? pick.closest('.node').dataset.id : null;
  }

  /** 在相邻任务之间跳转。用默认的上下方向键时，只在光标已到首行 / 末行才跳。 */
  function moveFocus(c, dir, combo) {
    if (/^Arrow(Up|Down)$/.test(combo) && !caretAtEdge(c.ta, dir)) return false;
    const all = Array.from($('#list').querySelectorAll('.node > .row .task-text'));
    const target = all[all.indexOf(c.ta) + dir];
    if (!target) return false;
    target.focus();
    const pos = dir < 0 ? target.value.length : 0;
    target.setSelectionRange(pos, pos);
    target.scrollIntoView({ block: 'nearest' });
    return true;
  }

  /** 结构变化（缩进、移动）后重绘，焦点和光标留在原任务上。无法执行时什么也不做。 */
  function restructure(c, change) {
    if (!change()) return true;
    commit();
    pendingFocus = { id: c.id, sel: ROW_TEXT, range: [c.ta.selectionStart, c.ta.selectionEnd] };
    renderAll();
    return true;
  }

  /** 新建空白任务并把光标放进去。mode：'below' 下方同级 | 'above' 上方同级 | 'child' 子任务 */
  function createBlank(c, mode) {
    if (getPredicate()) {
      toast('搜索或筛选中不能新建，请先清除搜索和筛选');
      return true;
    }
    tidyText(c.ta, c.task);
    const keep = keepDone();
    const { task, project, path } = c;
    const nt = TL.createTask('');
    if (mode === 'child') {
      if (task.done) TL.setDone(project.tasks, task.id, false, { moveToBottom: keep });
      task.collapsed = false;
      TL.insertTask(task.children, nt, keep);
    } else {
      const parent = path.length > 1 ? path[path.length - 2].task : null;
      if (parent && parent.done) TL.setDone(project.tasks, parent.id, false, { moveToBottom: keep });
      TL.insertSibling(project.tasks, task.id, nt, mode === 'above' ? 'before' : 'after', keep);
    }
    fresh.add(nt.id);
    commit();
    pendingFocus = { id: nt.id, sel: ROW_TEXT };
    renderAll();
    return true;
  }

  const indentTask = (c) => restructure(c, () => TL.indentTask(c.project.tasks, c.id, { keepDoneAtBottom: keepDone() }));
  const outdentTask = (c) => restructure(c, () => TL.outdentTask(c.project.tasks, c.id, { keepDoneAtBottom: keepDone() }));

  /** 每个函数收到 (任务上下文, 组合键)，返回 false 表示不处理，交还给浏览器默认行为 */
  const TASK_ACTIONS = {
    // 空白任务上再按：不再新建，改为升一级（和大纲笔记一样，连按两次回车跳出当前层级）
    addSibling: (c) => (TL.isBlankTask(c.task) ? outdentTask(c) : createBlank(c, 'below')),
    addSiblingAbove: (c) => createBlank(c, 'above'),
    addChild: (c) => (TL.isBlankTask(c.task) ? indentTask(c) : createBlank(c, 'child')),
    indent: indentTask,
    outdent: outdentTask,
    moveUp: (c) => restructure(c, () => TL.shiftTask(c.project.tasks, c.id, 'up', { keepDoneAtBottom: keepDone() })),
    moveDown: (c) => restructure(c, () => TL.shiftTask(c.project.tasks, c.id, 'down', { keepDoneAtBottom: keepDone() })),
    toggleDone: (c) => {
      const completing = !c.task.done;
      // 完成后任务会收进“已完成”，看不到了，焦点改交给相邻任务
      pendingFocus = { id: c.id, sel: ROW_TEXT, range: [c.ta.selectionStart, c.ta.selectionEnd], alt: completing && keepDone() ? adjacentTaskId(c.ta, true) : null };
      toggleDone(c.project, c.task);
      return true;
    },
    toggleCollapse: (c) => {
      if (!c.task.children.length) return true;
      c.task.collapsed = !c.task.collapsed;
      commit();
      pendingFocus = { id: c.id, sel: ROW_TEXT, range: [c.ta.selectionStart, c.ta.selectionEnd] };
      renderList();
      return true;
    },
    editDue: (c) => {
      const meta = nodeOf(c.id).querySelector(':scope > .row .meta');
      if (meta) meta.dispatchEvent(new Event('edit-due'));
      return true;
    },
    editTag: (c) => {
      const input = nodeOf(c.id).querySelector(':scope > .row .tag-input');
      if (input) input.focus();
      return true;
    },
    deleteTask: (c) => {
      const next = adjacentTaskId(c.ta, false);
      pendingFocus = next ? { id: next, sel: ROW_TEXT, range: 'end' } : null;
      fresh.delete(c.id);
      deleteTask(c.project, c.task);
      return true;
    },
    focusPrev: (c, combo) => moveFocus(c, -1, combo),
    focusNext: (c, combo) => moveFocus(c, 1, combo),
    finishEdit: (c) => {
      c.ta.blur();
      return true;
    },
  };

  /* ---------- 快捷键：全局操作 ---------- */
  function currentProject() {
    const a = document.activeElement;
    const n = a && a.closest ? a.closest('.node') : null;
    const found = n && TL.findInState(state, n.dataset.id);
    if (found) return found.project;
    return (state.ui.view !== 'all' && projectById(state.ui.view)) || state.projects[0];
  }

  function cycleProject(step) {
    const ids = ['all', ...state.projects.map((p) => p.id)];
    const i = Math.max(0, ids.indexOf(state.ui.view));
    setView(ids[(i + step + ids.length) % ids.length]);
  }

  function showToolbar() {
    if (state.settings.noteMode) document.body.classList.add('show-search'); // 便笺模式下工具栏平时是隐藏的
  }

  const GLOBAL_ACTIONS = {
    newTask: () => {
      const project = currentProject();
      if (!composer || composer.pid !== project.id) composer = { pid: project.id, text: '' };
      addingSub = null;
      composerFocus = true;
      renderList();
    },
    search: () => {
      showToolbar();
      const input = $('#search');
      input.focus();
      input.select();
    },
    toggleFilter: () => {
      showToolbar();
      tagbarOpen = !tagbarOpen;
      renderTagbar();
    },
    prevProject: () => cycleProject(-1),
    nextProject: () => cycleProject(1),
    openSettings: () => openSettings(),
    openShortcuts: () => openSettings('keys'),
    toggleMode: () => setNoteMode(!state.settings.noteMode),
    togglePin,
  };

  const REPEATABLE = new Set(['moveUp', 'moveDown', 'focusPrev', 'focusNext']); // 按住不放时可以连续触发的操作

  function taskContext(target) {
    if (!target || !target.matches || !target.matches('.node > .row .task-text')) return null;
    const found = TL.findInState(state, target.closest('.node').dataset.id);
    return found ? { ta: target, id: found.task.id, task: found.task, project: found.project, path: found.path } : null;
  }

  function onKeyDown(e) {
    if (!state || isComposing(e) || e.defaultPrevented) return;
    if ($('#modal-root').childElementCount) return; // 弹窗打开时不响应
    if (e.target.closest && e.target.closest('#memo-panel')) return; // 备忘录编辑器有自己的按键
    const combo = KM.comboFromEvent(e);
    const id = combo && keyLookup.get(combo);
    if (!id) return;
    const scope = KM.ACTIONS_BY_ID[id].scope;
    let ctx = null;
    if (scope === 'task') {
      ctx = taskContext(e.target);
      if (!ctx) return; // 光标不在任务文字里，按键保持原样（如 Tab 仍然移动焦点）
    }
    if (e.repeat && !REPEATABLE.has(id)) {
      e.preventDefault();
      return;
    }
    let handled = true;
    if (scope === 'task') handled = TASK_ACTIONS[id](ctx, combo);
    else GLOBAL_ACTIONS[id]();
    if (handled) e.preventDefault();
  }

  /* ---------- 其他 ---------- */
  function revealTask(id) {
    const found = TL.findInState(state, id);
    if (!found) return;
    closeModal();
    if (getPredicate()) {
      searchText = '';
      $('#search').value = '';
      $('#search-clear').hidden = true;
      filter.include = [];
      filter.exclude = [];
    }
    if (state.ui.view !== 'all' && state.ui.view !== found.project.id) state.ui.view = found.project.id;
    found.path.forEach((p, i) => {
      if (i < found.path.length - 1) p.task.collapsed = false;
      if (p.task.done) doneOpen.add(i === 0 ? 'root:' + found.project.id : found.path[i - 1].task.id);
    });
    renderAll();
    requestAnimationFrame(() => {
      const n = nodeOf(id);
      if (n) {
        n.scrollIntoView({ block: 'center' });
        flash(n);
      }
    });
  }

  function renderAll() {
    dropFresh(pendingFocus && pendingFocus.id);
    renderTitlebar();
    renderSidebar();
    renderTagbar();
    renderList();
    updateTagSuggest();
    window.Memo.sync();
  }

  function bindStatic() {
    const set = (sel, name) => $(sel).prepend(icon(name));
    set('#btn-drawer', 'menu');
    set('#btn-settings', 'sliders');
    set('#btn-pin', 'pin');
    set('#btn-min', 'minimize');
    set('#btn-max', 'maximize');
    set('#btn-close', 'close');
    set('#search-clear', 'close');
    set('#btn-filter', 'filter');
    set('#new-project button', 'plus');
    $('#search-icon').append(icon('search'));
    $('#btn-close').classList.add('close');
    $('#btn-drawer').addEventListener('click', () => document.body.classList.toggle('drawer-open'));
    $('#scrim').addEventListener('click', () => document.body.classList.remove('drawer-open'));
    $('#btn-mode').addEventListener('click', () => setNoteMode(!state.settings.noteMode));
    $('#btn-pin').addEventListener('click', togglePin);
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-min').addEventListener('click', () => api.minimize());
    $('#btn-max').addEventListener('click', () => api.toggleMaximize());
    $('#btn-close').addEventListener('click', () => {
      flush();
      window.Memo.flush();
      api.close();
    });
    $('#titlebar').addEventListener('dblclick', (e) => {
      if (e.target.closest('button') || state.settings.noteMode) return;
      api.toggleMaximize();
    });
    $('#btn-filter').addEventListener('click', () => {
      tagbarOpen = !tagbarOpen;
      renderTagbar();
    });

    const search = $('#search');
    let searchTimer = null;
    search.addEventListener('input', () => {
      $('#search-clear').hidden = !search.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchText = search.value;
        renderList();
      }, 120);
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !isComposing(e)) {
        if (search.value) {
          e.preventDefault();
          $('#search-clear').click();
        } else if (state.settings.noteMode) {
          e.preventDefault();
          document.body.classList.remove('show-search');
          search.blur();
        }
      }
    });
    $('#search-clear').addEventListener('click', () => {
      search.value = '';
      searchText = '';
      $('#search-clear').hidden = true;
      if (state.settings.noteMode) document.body.classList.remove('show-search');
      renderList();
      search.focus();
    });

    $('#new-project').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#new-project-input');
      const name = input.value.trim();
      if (!name) return;
      input.value = '';
      addProject(name);
    });

    // 快捷键：统一在 onKeyDown 里按当前键位表分发
    document.addEventListener('keydown', onKeyDown);
    // 鼠标按下期间不重绘列表，否则行位置变化会让这次点击失效
    document.addEventListener('mousedown', () => (pointerDown = true), true);
    const released = () => {
      pointerDown = false;
      if (sweepPending) {
        sweepPending = false;
        scheduleSweep();
      }
    };
    document.addEventListener('mouseup', released, true);
    document.addEventListener('dragend', released, true);
    window.addEventListener('blur', released);
    // 焦点离开一个用快捷键新建、还没写内容的任务时，把它丢弃
    document.addEventListener('focusout', () => {
      if (fresh.size && !listRendering) scheduleSweep();
    });
    window.addEventListener('resize', checkNarrow);

    // 每分钟刷新一次“已逾期”等时间状态；正在输入时不打断
    setInterval(() => {
      const a = document.activeElement;
      const typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
      if (!typing && !$('#modal-root').childElementCount) renderAll();
    }, 60000);

    document.body.append(el('datalist', { id: 'tag-suggest' }));

    api.onFocusTask(revealTask);
    api.onSetMode((note) => {
      state.settings.noteMode = note;
      document.body.classList.remove('drawer-open');
      applyMode();
      renderAll();
    });
  }

  async function init() {
    const res = await api.load();
    if (!res) {
      document.body.textContent = '数据加载失败，请重启程序。';
      return;
    }
    state = res.state;
    dataDir = res.dataDir;
    shortcut = res.shortcut || '';
    appVersion = res.version || '';
    rebuildKeys();
    api.onUpdateStatus(onUpdateStatus);
    api.getUpdateStatus().then(onUpdateStatus);
    bindStatic();
    window.Memo.init({
      api,
      getProject: () => (state.ui.view === 'all' ? null : projectById(state.ui.view) || null),
      onHasMemoChange: (id, has) => {
        const p = projectById(id);
        if (!p || !!p.hasMemo === has) return;
        p.hasMemo = has;
        commit(true); // 立即发送，确保先于随后的备忘录保存到达主进程
        window.Memo.sync();
      },
    });
    applyMode();
    renderAll();
  }

  init();
})();

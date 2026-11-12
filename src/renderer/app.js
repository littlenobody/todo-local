'use strict';
(function () {
  const { $, el, icon, toast, openModal, closeModal, confirmDialog } = window.Dom;
  const TL = window.TaskLib;
  const api = window.api;

  /* ---------- 状态 ---------- */
  let state = null;
  let dataDir = '';
  let shortcut = '';
  let searchText = '';
  const filter = { include: [], exclude: [], mode: 'and' }; // 标签键均为小写
  let tagbarOpen = false;
  let panelOpen = null; // 展开详情面板的任务 id
  let addingSub = null; // 正在添加子任务的父任务 id
  let pendingFocus = null; // { id, sel } 渲染后聚焦
  let composeProjectId = null;
  const doneOpen = new Set(); // 已展开的“已完成”分组
  let saveTimer = null;

  const short = (s) => {
    const t = (s || '').trim() || '（无标题）';
    return t.length > 18 ? t.slice(0, 18) + '…' : t;
  };
  const nodeOf = (id) => document.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
  const getPredicate = () => TL.andPredicates(TL.makeTagPredicate(filter), TL.makeSearchPredicate(searchText));
  const isComposing = (e) => e.isComposing || e.keyCode === 229;

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
  window.addEventListener('pagehide', flush);

  /* ---------- 视图辅助 ---------- */
  function scopeProjects() {
    return state.ui.view === 'all' ? state.projects : state.projects.filter((p) => p.id === state.ui.view);
  }
  function projectById(id) {
    return state.projects.find((p) => p.id === id);
  }
  function setView(id) {
    state.ui.view = id;
    panelOpen = null;
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
    document.body.classList.remove('drawer-open');
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
    const label = note ? '切换为普通窗口' : '切换为便笺模式';
    mode.replaceChildren(icon(note ? 'window' : 'sticky'));
    mode.title = label;
    mode.setAttribute('aria-label', label);
    const closeLabel = note ? '退出程序' : '隐藏到系统托盘';
    $('#btn-close').title = closeLabel;
    $('#btn-close').setAttribute('aria-label', closeLabel);
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
      head,
      tags.length ? el('div', { class: 'tagbar-chips' }, chips) : el('div', { class: 'empty small', text: '还没有标签，在任务详情里添加' }),
      tags.length ? el('p', { class: 'tagbar-hint', text: '点击标签切换：包含 → 排除 → 取消' }) : null
    );
  }

  function updateTagSuggest() {
    const map = new Map();
    state.projects.forEach((p) => TL.collectTags(p.tasks, map));
    $('#tag-suggest').replaceChildren(...[...map.values()].map((t) => el('option', { value: t.name })));
  }

  /* ---------- 渲染：任务列表 ---------- */
  function renderList() {
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
      if (nodes.length) frag.append(renderLevel(nodes, project, 'root:' + project.id, false, !!pred));
      else if (!pred) frag.append(el('div', { class: 'empty' + (view === 'all' ? ' small' : ''), text: '还没有任务，在下方输入添加' }));
    }
    if (pred && total === 0) {
      frag.append(
        el(
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
        )
      );
    }
    list.replaceChildren(frag);
    list.scrollTop = scrollTop;

    if (pendingFocus) {
      const { id, sel } = pendingFocus;
      pendingFocus = null;
      const node = nodeOf(id);
      const target = node && node.querySelector(':scope > ' + sel);
      if (target) {
        target.focus();
        target.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  function renderLevel(nodes, project, groupKey, inDone, filtering) {
    const box = el('div', { class: 'level' });
    const group = state.settings.completedToBottom && !inDone;
    const openNodes = group ? nodes.filter((n) => !n.task.done) : nodes;
    const doneNodes = group ? nodes.filter((n) => n.task.done) : [];
    openNodes.forEach((n) => box.append(renderNode(n, project, inDone, filtering)));
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
    if (panelOpen === t.id) wrap.append(buildPanel(t, project));
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

    const title = el('textarea', { class: 'title-input', rows: '1', maxlength: '500', spellcheck: 'false', 'aria-label': '任务标题' });
    title.value = t.title;
    title.addEventListener('keydown', (e) => {
      if (isComposing(e)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        title.blur();
      } else if (e.key === 'Escape') {
        title.value = t.title;
        title.blur();
      }
    });
    title.addEventListener('change', () => {
      const v = title.value.replace(/\s+/g, ' ').trim();
      if (!v) {
        title.value = t.title;
        return;
      }
      title.value = v;
      t.title = v;
      commit();
    });

    const row = el(
      'div',
      { class: 'row' + (t.done ? ' is-done' : '') + (node.match ? (getPredicate() ? ' hit' : '') : ' dim') + (panelOpen === t.id ? ' sel' : '') },
      twisty,
      check,
      el('div', { class: 'row-main' }, title, buildMeta(t)),
      el(
        'div',
        { class: 'row-actions' },
        iconBtn('sub', '添加子任务', () => startSub(t)),
        iconBtn('edit', '备注 / 标签 / 时间', () => togglePanel(t.id), panelOpen === t.id),
        iconBtn('trash', '删除任务', () => deleteTask(project, t), undefined, 'del')
      )
    );
    return row;
  }

  function buildMeta(t) {
    const meta = el('div', { class: 'meta' });
    if (t.due) {
      const st = TL.dueState(t);
      meta.append(
        el('button', { class: 'chip due ' + st, type: 'button', title: '修改时间', onclick: () => openPanel(t.id) }, icon('clock'), TL.formatDue(t.due) + (st === 'overdue' ? '（已逾期）' : ''))
      );
    }
    for (const tag of t.tags) {
      const key = tag.toLowerCase();
      const cls = filter.include.includes(key) ? ' active' : '';
      meta.append(el('button', { class: 'chip tag' + cls, type: 'button', title: '按此标签筛选', onclick: () => toggleInclude(tag) }, '#' + tag));
    }
    if (t.note.trim()) {
      meta.append(el('button', { class: 'chip', type: 'button', title: '查看备注', onclick: () => openPanel(t.id) }, icon('note'), '备注'));
    }
    if (t.children.length) {
      const done = t.children.filter((c) => c.done).length;
      meta.append(el('span', { class: 'chip', title: '子任务完成进度', text: `${done}/${t.children.length}` }));
    }
    meta.hidden = meta.childNodes.length === 0;
    return meta;
  }

  /** 只替换某个任务行里的徽标区，不重建列表（避免打断输入焦点） */
  function refreshMeta(id) {
    const found = TL.findInState(state, id);
    const node = nodeOf(id);
    const old = node && node.querySelector(':scope > .row .meta');
    if (found && old) old.replaceWith(buildMeta(found.task));
  }

  /* ---------- 详情面板 ---------- */
  function openPanel(id) {
    panelOpen = id;
    pendingFocus = { id, sel: '.panel .note-input' };
    renderList();
  }
  function togglePanel(id) {
    if (panelOpen === id) {
      panelOpen = null;
      renderList();
    } else {
      openPanel(id);
    }
  }

  function setDue(t, value, input) {
    t.due = TL.parseDue(value) ? value : null;
    if (input) input.value = t.due || '';
    commit();
    refreshMeta(t.id);
    renderSidebar();
  }

  function quickDue(dayOffset, hour) {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, 0, 0, 0);
    return TL.toDueString(d);
  }

  function buildTagEditor(t) {
    const holder = el('span', { class: 'contents' });
    const input = el('input', { class: 'tag-input', type: 'text', maxlength: '30', list: 'tag-suggest', placeholder: '输入后回车添加', 'aria-label': '添加标签' });
    const box = el('div', { class: 'tag-edit' }, holder, input);

    const changed = () => {
      commit();
      refreshMeta(t.id);
      renderTagbar();
      updateTagSuggest();
    };
    const paint = () => {
      holder.replaceChildren(
        ...t.tags.map((tag) =>
          el(
            'span',
            { class: 'chip removable' },
            '#' + tag,
            el(
              'button',
              {
                type: 'button',
                'aria-label': `移除标签 ${tag}`,
                onclick: () => {
                  t.tags = t.tags.filter((x) => x !== tag);
                  paint();
                  changed();
                  input.focus();
                },
              },
              icon('close')
            )
          )
        )
      );
    };
    const add = () => {
      const fresh = TL.splitTagInput(input.value);
      input.value = '';
      if (!fresh.length) return;
      t.tags = TL.uniqueTags([...t.tags, ...fresh]);
      paint();
      changed();
    };
    input.addEventListener('keydown', (e) => {
      if (isComposing(e)) return;
      if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
        e.preventDefault();
        add();
      } else if (e.key === 'Backspace' && !input.value && t.tags.length) {
        t.tags = t.tags.slice(0, -1);
        paint();
        changed();
      }
    });
    input.addEventListener('blur', add);
    paint();
    return box;
  }

  function buildPanel(t) {
    const note = el('textarea', { class: 'field note-input', rows: '3', maxlength: '20000', placeholder: '写点备注…', 'aria-label': '备注' });
    note.value = t.note;
    note.addEventListener('input', () => {
      t.note = note.value;
      commit();
      refreshMeta(t.id);
    });

    const due = el('input', { class: 'field', type: 'datetime-local', 'aria-label': '到期时间', value: t.due });
    due.addEventListener('change', () => setDue(t, due.value, due));
    const quick = (label, value) => el('button', { class: 'btn small', type: 'button', onclick: () => setDue(t, value, due) }, label);

    return el(
      'div',
      { class: 'panel' },
      el('div', { class: 'panel-row' }, el('span', { class: 'lbl', text: '备注' }), note),
      el('div', { class: 'panel-row' }, el('span', { class: 'lbl', text: '标签' }), buildTagEditor(t)),
      el(
        'div',
        { class: 'panel-row' },
        el('span', { class: 'lbl', text: '时间' }),
        el(
          'div',
          { class: 'panel-ctl' },
          due,
          quick('今天 18:00', quickDue(0, 18)),
          quick('明天 9:00', quickDue(1, 9)),
          quick('清除', '')
        )
      )
    );
  }

  /* ---------- 任务操作 ---------- */
  function parseQuickInput(text) {
    const tags = [];
    const title = String(text)
      .replace(/(^|\s)[#＃]([^\s#＃]+)/g, (_m, sp, tag) => {
        tags.push(tag);
        return sp;
      })
      .replace(/\s+/g, ' ')
      .trim();
    return { title, tags: TL.uniqueTags(tags) };
  }

  function addTask(project, parent, parsed) {
    const task = TL.createTask(parsed.title, { tags: parsed.tags });
    const keep = state.settings.completedToBottom;
    if (parent) {
      if (parent.done) TL.setDone(project.tasks, parent.id, false, { moveToBottom: keep });
      parent.collapsed = false;
      TL.insertTask(parent.children, task, keep);
    } else {
      TL.insertTask(project.tasks, task, keep);
    }
    commit();
    renderAll();
    const pred = getPredicate();
    if (pred && !pred(task)) toast('已添加，但不符合当前搜索或筛选，暂时不可见');
    else {
      const n = nodeOf(task.id);
      if (n) {
        n.scrollIntoView({ block: 'nearest' });
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
    const input = el('input', { class: 'sub-input', type: 'text', maxlength: '200', placeholder: '子任务，回车添加，Esc 结束', 'aria-label': `为「${short(t.title)}」添加子任务` });
    const form = el('form', { class: 'sub-form', autocomplete: 'off' }, input);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const parsed = parseQuickInput(input.value);
      if (!parsed.title) return;
      pendingFocus = { id: t.id, sel: '.sub-form .sub-input' };
      addTask(project, t, parsed);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !isComposing(e)) {
        addingSub = null;
        renderList();
      }
    });
    input.addEventListener('blur', () => {
      if (!input.value.trim()) {
        if (addingSub === t.id) addingSub = null;
        form.remove();
      }
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
      toast(`已完成「${short(t.title)}」，收起到“已完成”`, {
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
    if (panelOpen === t.id) panelOpen = null;
    if (addingSub === t.id) addingSub = null;
    commit();
    renderAll();
    const extra = t.children.length ? `（含 ${t.children.length} 个子任务）` : '';
    toast(`已删除「${short(t.title)}」${extra}`, {
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
    if (!state.projects.length) state.projects.push(TL.createProject('收件箱', 0));
    if (state.ui.view === project.id) state.ui.view = state.projects[0].id;
    panelOpen = null;
    addingSub = null;
    commit();
    renderAll();
  }

  /* ---------- 底部输入 ---------- */
  function renderComposer() {
    const select = $('#compose-project');
    const show = state.ui.view === 'all' && state.projects.length > 1;
    select.hidden = !show;
    if (!projectById(composeProjectId)) composeProjectId = state.projects[0].id;
    select.replaceChildren(...state.projects.map((p) => el('option', { value: p.id, text: p.name })));
    select.value = composeProjectId;
  }
  function composeTarget() {
    if (state.ui.view !== 'all') return projectById(state.ui.view);
    return projectById(composeProjectId) || state.projects[0];
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

  function openSettings() {
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

    const body = el(
      'div',
      {},
      switchRow('便笺模式', '小窗口、隐藏托盘图标和任务栏、窗口层级较低', s.noteMode, (v) => {
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
      el('div', { class: 'setting' }, el('span', { class: 'setting-text' }, el('span', { text: '便笺透明度' })), opacity),
      el(
        'div',
        { class: 'setting' },
        el('label', { class: 'setting-text', for: 'lead-min' }, el('span', { text: '提前提醒（分钟）' }), el('span', { class: 'setting-desc', text: '0 表示到点才提醒' })),
        lead
      ),
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
    openModal({ title: '设置', body, actions: null });
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
    renderTitlebar();
    renderSidebar();
    renderTagbar();
    renderList();
    renderComposer();
    updateTagSuggest();
  }

  function bindStatic() {
    const set = (sel, name) => $(sel).prepend(icon(name));
    set('#btn-drawer', 'menu');
    set('#btn-settings', 'sliders');
    set('#btn-min', 'minimize');
    set('#btn-max', 'maximize');
    set('#btn-close', 'close');
    set('#search-clear', 'close');
    set('#btn-filter', 'filter');
    set('#new-project button', 'plus');
    set('#composer button', 'plus');
    $('#search-icon').append(icon('search'));
    $('#btn-close').classList.add('close');
    $('#btn-drawer').addEventListener('click', () => document.body.classList.toggle('drawer-open'));
    $('#scrim').addEventListener('click', () => document.body.classList.remove('drawer-open'));
    $('#btn-mode').addEventListener('click', () => setNoteMode(!state.settings.noteMode));
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-min').addEventListener('click', () => api.minimize());
    $('#btn-max').addEventListener('click', () => api.toggleMaximize());
    $('#btn-close').addEventListener('click', () => {
      flush();
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
      if (e.key === 'Escape' && !isComposing(e) && search.value) {
        e.preventDefault();
        $('#search-clear').click();
      }
    });
    $('#search-clear').addEventListener('click', () => {
      search.value = '';
      searchText = '';
      $('#search-clear').hidden = true;
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

    $('#compose-project').addEventListener('change', (e) => {
      composeProjectId = e.target.value;
    });
    $('#composer').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#compose-input');
      const parsed = parseQuickInput(input.value);
      if (!parsed.title) {
        if (input.value.trim()) toast('请输入任务内容，标签之外至少要有一些文字');
        return;
      }
      input.value = '';
      addTask(composeTarget(), null, parsed);
      input.focus();
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        search.focus();
        search.select();
      }
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
    bindStatic();
    applyMode();
    renderAll();
  }

  init();
})();

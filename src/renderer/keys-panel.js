'use strict';
/*
 * 设置里的“快捷键”页：列出所有操作，点击按键框后按下新组合键即可修改。
 * 用 window.KeysPanel.build(ctx) 创建；ctx 由 app.js 提供：
 *   getSettings()  当前设置对象（读写 keybindings）
 *   getBindings()  当前生效的键位 { 操作id: 组合键 }
 *   onChange()     键位改动后调用（保存并刷新界面提示）
 */
(function () {
  const { el } = window.Dom;
  const KM = window.Keymap;

  function build(ctx) {
    const panel = el('div', { class: 'tab-panel', id: 'panel-keys', role: 'tabpanel', 'aria-labelledby': 'tab-keys' });
    let recording = null; // 正在录入的操作 id
    let notice = null; // { id, kind: 'error' | 'conflict', text?, combo?, other? }
    let resetAllArmed = false;
    let armTimer = null;
    let painting = false; // 重绘期间被移除的按钮会触发 blur，忽略

    const custom = () => ctx.getSettings().keybindings;
    const bindings = () => ctx.getBindings();
    const labelOf = (id) => KM.ACTIONS_BY_ID[id].label;
    const isCustom = (id) => Object.prototype.hasOwnProperty.call(custom(), id);

    const save = (next) => {
      ctx.getSettings().keybindings = next;
      ctx.onChange();
    };

    /** 设置某个操作的组合键（空串 = 清除）。与其他操作冲突时不直接改，先提示。 */
    const assign = (id, combo) => {
      const other = combo ? KM.conflictWith(bindings(), id, combo) : null;
      if (other) {
        notice = { id, kind: 'conflict', combo, other };
        return;
      }
      notice = null;
      save(KM.setBinding(custom(), id, combo));
    };

    /* 录入监听挂在 window 捕获阶段，先于弹窗自己的 Esc / Tab 处理 */
    const onRecordKey = (e) => {
      if (!recording) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.isComposing || e.keyCode === 229) return;
      const id = recording;
      const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
      if (e.key === 'Escape' && plain) {
        stopRecording();
        paint(id);
        return;
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && plain) {
        stopRecording();
        assign(id, '');
        paint(id);
        return;
      }
      const combo = KM.comboFromEvent(e);
      if (!combo) return; // 只按了修饰键，继续等
      stopRecording();
      const err = KM.validateCombo(combo, KM.ACTIONS_BY_ID[id].scope);
      if (err) notice = { id, kind: 'error', text: err };
      else assign(id, combo);
      paint(id);
    };

    function stopRecording() {
      recording = null;
      window.removeEventListener('keydown', onRecordKey, true);
    }

    function startRecording(id) {
      stopRecording();
      recording = id;
      notice = null;
      window.addEventListener('keydown', onRecordKey, true);
      paint(id);
    }

    const caps = (id) => {
      if (recording === id) return [el('span', { class: 'key-wait', text: '按下新的快捷键…' })];
      if (!bindings()[id]) return [el('span', { class: 'key-none', text: '未设置' })];
      const out = [];
      KM.displayParts(bindings()[id]).forEach((p, i) => {
        if (i) out.push(el('span', { class: 'key-plus', text: '+' }));
        out.push(el('kbd', { text: p }));
      });
      return out;
    };

    const noteFor = (a) => {
      if (!notice || notice.id !== a.id) return null;
      if (notice.kind === 'error') return el('div', { class: 'key-note', role: 'alert', text: notice.text });
      const { combo, other } = notice;
      return el(
        'div',
        { class: 'key-note', role: 'alert' },
        el('span', { text: `${KM.formatCombo(combo)} 已被「${labelOf(other)}」使用。` }),
        el(
          'button',
          {
            class: 'btn small',
            type: 'button',
            onclick: () => {
              save(KM.setBinding(KM.setBinding(custom(), other, ''), a.id, combo));
              notice = null;
              paint(a.id);
            },
          },
          '覆盖'
        ),
        el(
          'button',
          {
            class: 'btn small',
            type: 'button',
            onclick: () => {
              notice = null;
              paint(a.id);
            },
          },
          '取消'
        )
      );
    };

    const row = (a) => {
      const cur = bindings()[a.id];
      const btn = el(
        'button',
        {
          class: 'key-btn' + (recording === a.id ? ' recording' : ''),
          type: 'button',
          dataset: { id: a.id },
          'aria-label': `${a.label}，当前 ${cur ? KM.formatCombo(cur) : '未设置'}，点击修改`,
          onclick: () => startRecording(a.id),
        },
        ...caps(a.id)
      );
      // 点到别处或切到其他窗口：取消录入。只更新这个按钮，整页重绘会丢掉刚点中的控件
      btn.addEventListener('blur', () => {
        if (painting || !btn.isConnected || recording !== a.id) return;
        stopRecording();
        btn.classList.remove('recording');
        btn.replaceChildren(...caps(a.id));
      });
      const reset = isCustom(a.id)
        ? el(
            'button',
            {
              class: 'btn small',
              type: 'button',
              title: `恢复默认 ${KM.formatCombo(a.default)}`,
              'aria-label': `恢复「${a.label}」的默认快捷键`,
              onclick: () => {
                stopRecording();
                assign(a.id, a.default);
                paint(a.id);
              },
            },
            '恢复默认'
          )
        : null;
      return el(
        'div',
        { class: 'key-row' },
        el('div', { class: 'key-label' }, el('span', { text: a.label }), a.hint ? el('span', { class: 'setting-desc', text: a.hint }) : null),
        el('div', { class: 'key-ctrl' }, reset, btn),
        noteFor(a)
      );
    };

    function paint(focusId) {
      const armed = resetAllArmed;
      const any = Object.keys(custom()).length > 0;
      const resetAll = el(
        'button',
        {
          class: 'btn' + (armed ? ' danger' : ''),
          type: 'button',
          disabled: !any && !armed,
          onclick: () => {
            clearTimeout(armTimer);
            if (!resetAllArmed) {
              resetAllArmed = true;
              armTimer = setTimeout(() => {
                resetAllArmed = false;
                if (panel.isConnected) paint();
              }, 4000);
            } else {
              resetAllArmed = false;
              notice = null;
              stopRecording();
              save({});
            }
            paint();
          },
        },
        armed ? '再点一次确认恢复' : '恢复全部默认'
      );

      const children = [el('p', { class: 'keys-intro', text: '点击右侧的按键框，再按下想用的组合键。Backspace 或 Delete 清除，Esc 取消。' })];
      KM.GROUPS.forEach((g) => {
        children.push(el('h3', { class: 'keys-group' }, g.title, el('span', { text: g.desc })));
        KM.ACTIONS.filter((a) => a.scope === g.scope).forEach((a) => children.push(row(a)));
      });
      children.push(
        el('div', { class: 'settings-foot' }, resetAll),
        el('p', { class: 'settings-info', text: '固定按键：Enter 在任务里换行；Esc 结束编辑或关闭弹窗；按住 Ctrl 单击链接在浏览器打开。' })
      );
      painting = true;
      panel.replaceChildren(...children);
      painting = false;
      if (focusId) {
        const b = panel.querySelector(`.key-btn[data-id="${CSS.escape(focusId)}"]`);
        if (b) b.focus();
      }
    }

    paint();
    return {
      panel,
      dispose() {
        stopRecording();
        clearTimeout(armTimer);
      },
    };
  }

  window.KeysPanel = { build };
})();

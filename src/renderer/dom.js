'use strict';
/* 轻量 DOM 工具：元素构建、图标、提示条、弹窗。全部使用 textContent / DOM API，不拼接 HTML。 */
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);

  function append(node, children) {
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    let deferredValue;
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k === 'style' && typeof v === 'object') {
        // CSP 禁止内联 style 属性，这里走 CSSOM
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) node.style.setProperty(sk, sv);
          else node.style[sk] = sv;
        }
      }
      else if (k === 'value') deferredValue = v; // select 需要先有 option
      else if (k === 'checked' || k === 'hidden' || k === 'disabled') node[k] = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    append(node, children);
    if (deferredValue !== undefined) node.value = deferredValue;
    return node;
  }

  function icon(name) {
    const span = el('span', { class: 'ico', 'aria-hidden': 'true' });
    span.innerHTML = window.ICONS[name] || '';
    return span;
  }

  /* ---------- 提示条 ---------- */
  let toastTimer = null;
  function hideToast() {
    clearTimeout(toastTimer);
    $('#toast').classList.remove('show');
  }
  function toast(message, opts) {
    const o = opts || {};
    const box = $('#toast');
    box.replaceChildren(el('span', { text: message }));
    if (o.action) {
      box.append(
        el(
          'button',
          {
            class: 'toast-action',
            type: 'button',
            onclick: () => {
              hideToast();
              if (o.onAction) o.onAction();
            },
          },
          o.action
        )
      );
    }
    box.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, o.timeout || 5000);
  }

  /* ---------- 弹窗 ---------- */
  let current = null;

  function closeModal() {
    if (current) current.close();
  }

  function focusables(root) {
    return Array.from(root.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
      (n) => !n.disabled && !n.hidden
    );
  }

  function openModal(opts) {
    closeModal();
    const prev = document.activeElement;
    const closeBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': '关闭', title: '关闭', onclick: closeModal }, icon('close'));
    const dialog = el(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
      el('div', { class: 'modal-head' }, el('h2', { text: opts.title }), closeBtn),
      opts.body,
      opts.actions ? el('div', { class: 'modal-actions' }, opts.actions) : null
    );
    const backdrop = el('div', {
      class: 'modal-backdrop',
      onmousedown: (e) => {
        if (e.target === backdrop) closeModal();
      },
    });
    backdrop.append(dialog);

    const handle = {
      close() {
        if (current !== handle) return;
        current = null;
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        if (opts.onClose) opts.onClose();
        if (prev && prev.focus && document.contains(prev)) prev.focus();
      },
    };

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handle.close();
      } else if (e.key === 'Tab') {
        const items = focusables(dialog);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    current = handle;
    document.addEventListener('keydown', onKey, true);
    $('#modal-root').append(backdrop);
    const target = opts.focus || focusables(dialog).find((n) => n !== closeBtn) || closeBtn;
    target.focus();
    return handle;
  }

  function confirmDialog(title, message, okLabel, danger) {
    return new Promise((resolve) => {
      let result = false;
      const cancel = el('button', { class: 'btn', type: 'button', onclick: closeModal }, '取消');
      const ok = el(
        'button',
        {
          class: 'btn ' + (danger ? 'danger' : 'primary'),
          type: 'button',
          onclick: () => {
            result = true;
            closeModal();
          },
        },
        okLabel || '确定'
      );
      openModal({
        title,
        body: el('p', { class: 'modal-text', text: message }),
        actions: [cancel, ok],
        focus: cancel,
        onClose: () => resolve(result),
      });
    });
  }

  window.Dom = { $, el, icon, toast, hideToast, openModal, closeModal, confirmDialog };
})();

'use strict';
/* 内联 SVG 图标（24x24，描边风格）。内容均为静态常量。 */
(function () {
  const wrap = (body) =>
    `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

  window.ICONS = {
    menu: wrap('<path d="M4 6h16M4 12h16M4 18h16"/>'),
    plus: wrap('<path d="M12 5v14M5 12h14"/>'),
    close: wrap('<path d="M6 6l12 12M18 6L6 18"/>'),
    check: wrap('<path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="2.6"/>'),
    chevronRight: wrap('<path d="M9 6l6 6-6 6"/>'),
    search: wrap('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
    filter: wrap('<path d="M3 5h18l-7 8.5V20l-4-2v-4.5z"/>'),
    note: wrap('<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h5"/>'),
    tag: wrap('<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1"/>'),
    clock: wrap('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    trash: wrap('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>'),
    sticky: wrap('<path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5"/>'),
    window: wrap('<path d="M4 5h16v14H4z"/><path d="M4 9h16"/>'),
    minimize: wrap('<path d="M5 12h14"/>'),
    maximize: wrap('<path d="M6 6h12v12H6z"/>'),
    sliders: wrap('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'),
    inbox: wrap('<path d="M4 13l2-8h12l2 8v6H4zM4 13h5l1 2h4l1-2h5"/>'),
    edit: wrap('<path d="M4 20l1-4L16 5l3 3L8 19z"/>'),
    sub: wrap('<path d="M6 4v9a3 3 0 0 0 3 3h8M14 12l4 4-4 4"/>'),
    drag: wrap('<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>'),
  };
})();

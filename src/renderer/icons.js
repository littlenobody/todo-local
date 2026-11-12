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
    pin: wrap('<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>'),
    sub: wrap('<path d="M6 4v9a3 3 0 0 0 3 3h8M14 12l4 4-4 4"/>'),
    bold: wrap('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7.5a3.5 3.5 0 0 1 0 7H7z"/>'),
    italic: wrap('<path d="M14 5h-4M14 19h-4M15 5l-4 14"/>'),
    underline: wrap('<path d="M7 5v7a5 5 0 0 0 10 0V5M5 20h14"/>'),
    strike: wrap('<path d="M4 12h16M8 8c.4-1.7 2-3 4-3 2.3 0 4 1.2 4 3M8 16c.3 1.8 2 3 4.2 3 2.3 0 3.8-1.2 3.8-3"/>'),
    heading: wrap('<path d="M6 5v14M18 5v14M6 12h12"/>'),
    listUl: wrap('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>'),
    listOl: wrap('<path d="M10 6h10M10 12h10M10 18h10M4 4.5l1.5-1V9M4 14a1.6 1.6 0 1 1 2.7 1.1L4 18h3"/>'),
    quote: wrap('<path d="M4 6v12M9 8h11M9 12h11M9 16h7"/>'),
    link: wrap('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    image: wrap('<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5L20 17"/>'),
    table: wrap('<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M3.5 10h17M3.5 14.5h17M9.5 5v14M15 5v14"/>'),
    hr: wrap('<path d="M4 12h3M10.5 12h3M17 12h3"/>'),
    expand: wrap('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
    collapse: wrap('<path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7"/>'),
    drag: wrap('<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>'),
  };
})();

/*
 * 项目备忘录的纯函数工具。
 * 同时被主进程（require）和渲染进程（<script>，挂到 window.MemoLib）使用，也方便做单元测试。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MemoLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 单个备忘录（HTML 字符串，图片以 data URL 内嵌）的字符数上限 */
  const MAX_MEMO_CHARS = 30 * 1024 * 1024;

  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const IMG_SRC_RE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
  const LINK_PROTOCOLS = ['http:', 'https:', 'mailto:'];

  /** 项目 id 会用作文件名，只允许字母、数字、下划线和连字符 */
  function isValidMemoId(id) {
    return typeof id === 'string' && ID_RE.test(id);
  }

  /** 只放行内嵌的位图 data URL（不含 svg），避免外链图片与脚本载体 */
  function isSafeImageSrc(src) {
    return typeof src === 'string' && src.length <= MAX_MEMO_CHARS && IMG_SRC_RE.test(src);
  }

  /**
   * 规范化用户输入的链接。仅允许 http / https / mailto；
   * 没写协议时补 https://。不合法返回空字符串。
   */
  function safeLinkHref(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (!s || /[\u0000-\u001f\s]/.test(s)) return '';
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^:/]+:\d+(?:[/?#]|$)/.test(s);
    if (!hasScheme) s = 'https://' + s;
    let u;
    try {
      u = new URL(s);
    } catch {
      return '';
    }
    if (!LINK_PROTOCOLS.includes(u.protocol.toLowerCase())) return '';
    if (u.protocol !== 'mailto:' && !u.hostname) return '';
    return s;
  }

  return { MAX_MEMO_CHARS, isValidMemoId, isSafeImageSrc, safeLinkHref };
});

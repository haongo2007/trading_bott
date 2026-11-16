// Script chạy BÊN TRONG trang web (page.evaluate). Viết dưới dạng chuỗi JS thuần để
// tránh việc tsx/esbuild chèn helper (vd __name) làm hỏng hàm khi serialize sang trình duyệt.

import type { Rect } from "@/lib/live-protocol";

export type InspectResult = {
  tag: string;
  type: string | null;
  text: string;
  value: string | null;
  rect: Rect;
  candidates: string[];
} | null;

const INSPECT_FN = String.raw`
(function (opts) {
  var el = opts.active ? document.activeElement : document.elementFromPoint(opts.x, opts.y);
  if (!el || el === document.body || el === document.documentElement) return null;
  var interactive = el.closest('button,a,input,select,textarea,label,[role=button],[role=link],[onclick]');
  if (interactive) el = interactive;
  var r = el.getBoundingClientRect();
  var rect = { x: r.x, y: r.y, w: r.width, h: r.height };
  if (opts.rectOnly) return { rect: rect };

  var tag = el.tagName.toLowerCase();
  var q = function (v) { return JSON.stringify(v); };
  var stable = function (v) { return v && !/\d{4,}|^[0-9]|[:]/.test(v) && v.length < 60; };
  var c = [];
  if (stable(el.id)) c.push('#' + CSS.escape(el.id));
  ['data-testid', 'data-test', 'data-qa', 'data-cy', 'name', 'aria-label', 'placeholder', 'title'].forEach(function (a) {
    var v = el.getAttribute(a);
    if (v && v.length < 80) c.push(tag + '[' + a + '=' + q(v) + ']');
  });
  var type = el.getAttribute('type');
  if (tag === 'input' && type) c.push('input[type=' + q(type) + ']');
  var text = ((el.innerText || '') + '').trim().replace(/\s+/g, ' ');
  if (text && text.length <= 40 && ['input', 'textarea', 'select'].indexOf(tag) < 0) c.push(tag + ':has-text(' + q(text) + ')');
  var cls = Array.prototype.filter.call(el.classList, function (k) {
    return k.length < 40 && !/\d{3,}|^(active|hover|focus|selected|disabled|open|show)$/.test(k);
  }).slice(0, 3);
  if (cls.length) c.push(tag + '.' + cls.map(function (k) { return CSS.escape(k); }).join('.'));
  var path = [], cur = el;
  while (cur && cur.nodeType === 1 && path.length < 6) {
    var seg = cur.tagName.toLowerCase();
    if (stable(cur.id)) { path.unshift('#' + CSS.escape(cur.id)); break; }
    var p = cur.parentElement;
    if (p) {
      var same = Array.prototype.filter.call(p.children, function (s) { return s.tagName === cur.tagName; });
      if (same.length > 1) seg += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
    }
    path.unshift(seg);
    cur = p;
  }
  c.push(path.join(' > '));
  var value = ('value' in el) ? String(el.value).slice(0, 500) : null;
  return { tag: tag, type: type, text: text.slice(0, 80), value: value, rect: rect, candidates: Array.from(new Set(c)) };
})`;

export function inspectAtPoint(x: number, y: number, rectOnly = false) {
  return `${INSPECT_FN}(${JSON.stringify({ x, y, rectOnly })})`;
}

export function inspectActiveElement() {
  return `${INSPECT_FN}(${JSON.stringify({ active: true })})`;
}

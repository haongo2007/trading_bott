import type { Locator, Page } from "playwright";

// Selector dạng `tag:has-text("…")` hoặc `tag.class:has-text("…")` (không có khoảng trắng / combinator).
const SIMPLE_HAS_TEXT = /^[a-z][a-z0-9-]*(?:\.[\w-]+)*:has-text\("(?:[^"\\]|\\.)*"\)$/i;

/**
 * `:has-text` khớp MỌI phần tử có chứa chữ ở bên trong — kể cả các khung bao bên ngoài
 * (VD `div:has-text("Đánh Long")` khớp cả div gốc của trang). Chỉ giữ phần tử TRONG CÙNG:
 * phần tử khớp mà không chứa phần tử khớp nào khác.
 */
export function innermostSelector(selector: string): string {
  const s = selector.trim();
  return SIMPLE_HAS_TEXT.test(s) ? `${s}:not(:has(${s}))` : s;
}

/** Tất cả phần tử khớp selector và ĐANG HIỂN THỊ (bỏ qua bản ẩn trong popup luật chơi, tab khác…). */
export function visibleMatches(page: Page, selector: string): Locator {
  return page.locator(innermostSelector(selector)).filter({ visible: true });
}

/** Phần tử hiển thị đầu tiên khớp selector — dùng cho mọi thao tác click / nhập / đọc của bot. */
export function locate(page: Page, selector: string): Locator {
  return visibleMatches(page, selector).first();
}

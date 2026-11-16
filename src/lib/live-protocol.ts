// Giao thức WebSocket giữa canvas (dashboard) và worker.
// Khung hình được gửi dạng binary (JPEG); mọi message khác là JSON.

export type LiveMode = "interact" | "pick" | "record";

export type Rect = { x: number; y: number; w: number; h: number };

export type SelectorCandidate = { selector: string; count: number };

export type PickedElement = {
  tag: string;
  type: string | null;
  text: string;
  rect: Rect;
  selectors: SelectorCandidate[]; // đã sắp xếp: selector duy nhất (count = 1) lên đầu
};

export type RecordedStep = {
  id: string;
  action: "goto" | "click" | "fill" | "press";
  selector?: string;
  value?: string; // {{username}} / {{password}} thay cho giá trị nhạy cảm
  url?: string;
  key?: string;
  label: string;
};

export type ClientMsg =
  | { t: "navigate"; url: string }
  | { t: "back" }
  | { t: "forward" }
  | { t: "reload" }
  | { t: "click"; x: number; y: number; detail?: number } // detail: 1 = click, 2 = double, 3 = triple (chọn hết chữ)
  | { t: "move"; x: number; y: number }
  | { t: "wheel"; x: number; y: number; dx: number; dy: number }
  | { t: "key"; key: string }
  | { t: "text"; text: string }
  | { t: "mode"; mode: LiveMode }
  | { t: "saveSession" }
  | { t: "autoLogin" }
  | { t: "testSelector"; selector: string };

export type ServerMsg =
  | { t: "ready"; viewport: { width: number; height: number } }
  | { t: "url"; url: string; title: string }
  | { t: "hover"; rect: Rect | null }
  | { t: "picked"; element: PickedElement }
  | { t: "step"; step: RecordedStep }
  | { t: "selectorTest"; selector: string; count: number; rect: Rect | null; error?: string }
  | { t: "toast"; level: "info" | "success" | "error"; message: string }
  | { t: "busy"; busy: boolean };

// Mã đóng kết nối (reason của WebSocket bị giới hạn 123 byte nên dùng mã)
export const CLOSE_CODES: Record<number, string> = {
  4401: "Phiên không hợp lệ hoặc đã hết hạn. Hãy kết nối lại.",
  4404: "Không tìm thấy tài khoản.",
  4409: "Tài khoản đang được dùng ở phiên khác (trình duyệt trực tiếp hoặc kiểm tra đăng nhập).",
  4429: "Worker đã đạt số phiên trình duyệt tối đa. Thử lại sau.",
  4408: "Phiên đã đóng do không thao tác quá lâu.",
  4410: "Phiên đã đóng.",
  1011: "Worker gặp lỗi khi mở trình duyệt.",
};

export const ASSIGNABLE_FIELDS = {
  usernameSelector: "Ô tên đăng nhập",
  passwordSelector: "Ô mật khẩu",
  submitSelector: "Nút đăng nhập",
  successSelector: "Dấu hiệu đã đăng nhập",
  balanceSelector: "Vị trí số dư",
} as const;

export type AssignableField = keyof typeof ASSIGNABLE_FIELDS;

// Chuyển chuỗi số dư hiển thị trên web thành số.
// Hỗ trợ: "12.500.000 ₫", "12,500,000 VND", "$1,234.56", "1.234,56 €", "0.5", "-250.000"
export function parseBalance(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(/\s/g, "").match(/-?\d[\d.,]*/);
  if (!m) return null;

  let s = m[0];
  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);
  s = s.replace(/[.,]+$/, "");

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");

  if (lastDot > -1 && lastComma > -1) {
    // Có cả 2 dấu: dấu xuất hiện sau cùng là dấu thập phân
    const dec = lastDot > lastComma ? "." : ",";
    const thousands = dec === "." ? "," : ".";
    s = s.split(thousands).join("").replace(dec, ".");
  } else if (lastDot > -1 || lastComma > -1) {
    const sep = lastDot > -1 ? "." : ",";
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    // Nhiều dấu, hoặc 1 dấu + đúng 3 chữ số phía sau (VD "12.500") → phân cách hàng nghìn
    const isThousands = parts.length > 2 || (tail.length === 3 && parts[0] !== "0");
    s = isThousands ? parts.join("") : parts.join(".");
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

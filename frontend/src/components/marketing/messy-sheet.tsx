/* A deliberately messy spreadsheet: the problem, shown rather than described. */

const COLS = ["A", "B", "C", "D", "E", "F"];
const ROWS: (string | { v: string; err?: boolean; hl?: boolean; note?: boolean })[][] = [
  ["Client", "Invoice #", "Month", "Amount", "Status", "Total (?)"],
  ["Halden & Co", "INV-2291", "Sep", "4,200", "Paid", "4,200"],
  ["Mira Foods", "INV-2292", "Sep", "1,850", "paid", "6,050"],
  ["Ostro Labs", "INV-2293", "Sep", "3,100", "Pending", { v: "#REF!", err: true }],
  [{ v: "Halden & Co", hl: true }, { v: "INV-2294", hl: true }, { v: "Oct", hl: true }, { v: "4,200", hl: true, note: true }, { v: "PAID", hl: true }, { v: "#REF!", err: true, hl: true }],
  ["Tailspin", "INV-2295", "Oct", "980", "Refunded", ""],
  ["Mira Foods", "", "Oct", "2,040", "Paid", "=SUM(D2:D6"],
  ["Kestrel", "INV-2297", "Oct", "5,600", "Paid", ""],
];
const TABS = ["Jan", "Feb", "Mar", "Copy of Mar", "pivot DO NOT TOUCH", "Oct (new)"];

export function MessySheet() {
  return (
    <figure className="relative" aria-label="A typical messy sales spreadsheet with broken formulas and duplicate tabs">
      <div className="overflow-hidden rounded-[10px] bg-[#f6f5f8] text-[#1d1b22] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] ring-1 ring-black/10 md:-rotate-[1.5deg]">
        {/* Title bar */}
        <div className="flex items-center gap-2 border-b border-black/10 bg-[#e9e7ee] px-3 py-2">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-2 truncate text-[12px] font-medium text-black/70">Sales_FINAL_v3 (2).xlsx</span>
          <span className="ml-auto hidden text-[11px] text-black/45 sm:inline">Last edited by Ravi · 3 days ago</span>
        </div>
        {/* Formula bar */}
        <div className="flex items-center gap-2 border-b border-black/10 bg-white px-3 py-1.5 font-mono text-[11px]">
          <span className="text-black/45">F5</span>
          <span className="text-black/30">fx</span>
          <span className="truncate text-[#b3261e]">=SUM(Sheet3!D2:D5)+&apos;Copy of Mar&apos;!F9</span>
        </div>
        {/* Grid */}
        <div data-lenis-prevent-horizontal className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse font-mono text-[11.5px]">
            <thead>
              <tr className="bg-[#eceaf1] text-black/50">
                <th className="w-8 border border-black/10 font-normal" />
                {COLS.map((c) => (
                  <th key={c} className="border border-black/10 py-1 font-normal">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, r) => (
                <tr key={r} className={r === 0 ? "font-semibold" : ""}>
                  <td className="border border-black/10 bg-[#eceaf1] py-1 text-center text-black/50">{r + 1}</td>
                  {row.map((cell, c) => {
                    const cellObj = typeof cell === "string" ? { v: cell } : cell;
                    return (
                      <td
                        key={c}
                        className={`relative whitespace-nowrap border border-black/10 px-2 py-1 ${
                          cellObj.hl ? "bg-[#fff3a8]" : ""
                        } ${cellObj.err ? "font-semibold text-[#b3261e]" : ""} ${c === 3 || c === 5 ? "text-right" : ""}`}
                      >
                        {cellObj.v}
                        {cellObj.note && <span className="absolute right-0 top-0 size-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-[#d93025]" />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Tabs */}
        <div className="flex gap-px overflow-x-auto border-t border-black/10 bg-[#e9e7ee] px-2 text-[11px]">
          {TABS.map((t, i) => (
            <span
              key={t}
              className={`whitespace-nowrap px-3 py-1.5 ${i === TABS.length - 1 ? "bg-white font-semibold text-[#137333]" : "text-black/55"}`}
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* Comment left by a teammate */}
      <figcaption className="absolute -right-2 top-[44%] w-[200px] rotate-[2deg] rounded-[8px] bg-[#fff8c5] p-3 text-[12.5px] leading-snug text-[#3b3520] shadow-[0_12px_30px_-8px_rgba(0,0,0,0.6)] sm:-right-6">
        <span className="block text-[11px] font-semibold text-[#8a7a2e]">Ravi</span>
        is this before or after refunds?? numbers don&apos;t match the bank
      </figcaption>
    </figure>
  );
}

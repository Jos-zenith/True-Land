"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="rounded-[6px] bg-[#18181b] px-3 py-1.5 text-[13px] font-[510] text-white hover:bg-black">
      Print or save as PDF
    </button>
  );
}

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-window px-6">
      <div className="max-w-[420px]">
        <p className="text-xs text-meta">404</p>
        <h1 className="mt-1 text-[20px] font-[590] text-figure">This page does not exist</h1>
        <p className="mt-2 text-[13px] text-meta">The check or page may have been removed by a demo reset. Nothing was changed.</p>
        <Link href="/overview" className="mt-4 inline-flex h-7 items-center rounded-[6px] bg-accent px-3 text-[13px] font-[510] text-white hover:bg-accent-hover">
          Go to overview
        </Link>
      </div>
    </div>
  );
}

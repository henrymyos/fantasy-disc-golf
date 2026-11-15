import Link from "next/link";

export const metadata = { title: "Page not found · Disc Fantasy" };

export default function NotFound() {
  return (
    <main className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center bg-[#1a1d23] rounded-2xl p-8 shadow-2xl border border-white/5">
        <p className="text-2xl font-black text-white tracking-tight">
          <span className="text-[#6A5DFF]">Disc</span> Fantasy
        </p>
        <h1 className="text-xl font-bold text-white mt-6 mb-2">Page not found</h1>
        <p className="text-gray-400 text-sm">That link is out of bounds. The league or page may have moved or been deleted.</p>
        <Link
          href="/"
          className="inline-block mt-6 rounded-lg bg-[#4B3DFF] hover:bg-[#3d30e0] text-white text-sm font-semibold px-4 py-2.5"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}

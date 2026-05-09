export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-white tracking-tight">
            <span className="text-[#4B3DFF]">Disc</span> Fantasy
          </h1>
          <p className="text-gray-400 text-sm mt-1">Fantasy Disc Golf League Platform</p>
        </div>
        {children}
      </div>
    </div>
  );
}

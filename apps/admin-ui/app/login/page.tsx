import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#0a0a0b] px-4 py-10">
      <section className="w-full max-w-sm rounded-xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/40 backdrop-blur-xl">
        <div className="mb-6">
          <div className="mb-4 grid size-10 place-items-center rounded-lg bg-[#E52227] text-sm font-semibold text-white">
            FD
          </div>
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-white">Admin sign in</h1>
          <p className="mt-2 text-sm leading-6 text-[#9ca0a8]">
            This is the UI shell only. Real authentication will use Nest admin sessions, 2FA, RBAC,
            and audit logs.
          </p>
        </div>

        <form className="space-y-4">
          <label className="block space-y-2">
            <span className="text-xs font-medium text-[#c8cad0]">Email</span>
            <input
              type="email"
              placeholder="operator@fizzdragon.com"
              className="h-10 w-full rounded-md border border-[#262629] bg-[#101012] px-3 text-sm text-white outline-none transition placeholder:text-[#6b6f78] focus:border-[#E52227]"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-xs font-medium text-[#c8cad0]">Password</span>
            <input
              type="password"
              placeholder="Required"
              className="h-10 w-full rounded-md border border-[#262629] bg-[#101012] px-3 text-sm text-white outline-none transition placeholder:text-[#6b6f78] focus:border-[#E52227]"
            />
          </label>
          <button
            type="button"
            className="h-10 w-full rounded-md bg-[#E52227] px-4 text-sm font-medium text-white transition hover:bg-[#c91d22]"
          >
            Continue
          </button>
        </form>

        <Link
          href="/"
          className="mt-5 block text-center text-xs font-medium text-[#9ca0a8] transition hover:text-white"
        >
          Back to operations overview
        </Link>
      </section>
    </main>
  );
}

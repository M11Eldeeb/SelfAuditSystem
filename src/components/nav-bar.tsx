import Link from "next/link";
import { logout } from "@/app/actions/auth";
import type { CurrentUser } from "@/lib/auth";

export function NavBar({
  user,
  links,
}: {
  user: CurrentUser;
  links: { href: string; label: string }[];
}) {
  return (
    <header className="border-b-4 border-brand bg-brand-ink">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 overflow-x-auto px-4 py-3">
        <div className="flex shrink-0 items-center gap-6">
          <span className="shrink-0 text-sm font-bold whitespace-nowrap text-white uppercase">
            MG <span className="text-brand">Self Audit</span>
          </span>
          <nav className="flex items-center gap-4">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium whitespace-nowrap text-neutral-300 transition hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <span className="text-sm whitespace-nowrap text-neutral-400">{user.email}</span>
          <Link
            href="/account/password"
            className="text-sm font-medium whitespace-nowrap text-neutral-300 transition hover:text-white"
          >
            Change password
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="text-sm font-medium whitespace-nowrap text-neutral-300 transition hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

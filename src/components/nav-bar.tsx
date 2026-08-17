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
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold text-neutral-900">Warranty Self-Audit</span>
          <nav className="flex items-center gap-4">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-neutral-600 hover:text-neutral-900"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-500">{user.email}</span>
          <form action={logout}>
            <button type="submit" className="text-sm text-neutral-600 hover:text-neutral-900">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

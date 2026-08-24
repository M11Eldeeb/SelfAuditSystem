import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { PasswordForm } from "./password-form";

export default async function AccountPasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const homeHref = user.role === "officer" ? "/admin" : "/audit";

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <NavBar user={user} links={[{ href: homeHref, label: "Home" }]} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <h1 className="mb-4 text-2xl font-bold tracking-tight text-neutral-900">Change password</h1>
        <PasswordForm />
      </main>
    </div>
  );
}

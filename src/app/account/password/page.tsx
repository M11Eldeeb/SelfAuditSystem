import { redirect } from "next/navigation";
import { getCurrentUser, homePathFor } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";
import { getNotifications } from "@/lib/notifications";
import { PasswordForm } from "./password-form";

export default async function AccountPasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const homeHref = homePathFor(user.role);
  const notifications = user.role === "finance" || user.role === "technical" || user.role === "workshop_supervisor" || user.role === "team_leader" || user.role === "technician" ? undefined : await getNotifications(user);

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <NavBar user={user} links={[{ href: homeHref, label: "Home" }]} notifications={notifications} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <h1 className="mb-4 text-2xl font-bold tracking-tight text-neutral-900">Change password</h1>
        {user.must_change_password && (
          <div className="mb-4 max-w-md rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
            <p>Welcome! Choose your own password to continue (at least 8 characters).</p>
            <p dir="rtl" lang="ar" className="mt-1">
              مرحبًا! اختر كلمة مرور خاصة بك للمتابعة (8 أحرف على الأقل).
            </p>
          </div>
        )}
        <PasswordForm />
      </main>
    </div>
  );
}

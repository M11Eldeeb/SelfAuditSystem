import { redirect } from "next/navigation";

// The dashboard is the officer's home page; the old Overview now lives under Audits.
export default function AdminIndexPage() {
  redirect("/admin/dashboard");
}

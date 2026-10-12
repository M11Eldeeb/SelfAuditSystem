import { redirect } from "next/navigation";

// Results now live inside the Self Audit and Internal Audit folders under Audits.
export default function ResultsIndexPage() {
  redirect("/admin/audits");
}

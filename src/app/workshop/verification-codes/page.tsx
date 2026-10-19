import { redirect } from "next/navigation";

/** Verification codes moved into Technical Inquiries (old e-mail links still land here). */
export default async function VerificationCodesPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const { open } = await searchParams;
  redirect(`/workshop/technical-inquiries?view=codes${open ? `&open=${encodeURIComponent(open)}` : ""}`);
}

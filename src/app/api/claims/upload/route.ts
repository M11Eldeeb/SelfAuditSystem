import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { processClaimsUpload } from "@/lib/upload-claims";

// Plain Route Handler instead of a Server Action: Server Actions' multipart
// body handling has open, unresolved bugs with file uploads ("Unexpected end
// of form" - see vercel/next.js#60225/#60227). Route Handlers just parse the
// standard Request body via the Fetch API, which doesn't hit that issue.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (user.role !== "officer") {
    return NextResponse.json({ error: "Only warranty officers can upload claims." }, { status: 403 });
  }

  const formData = await request.formData();
  const result = await processClaimsUpload(user.id, formData);

  if (result.success) {
    revalidatePath("/admin/claims");
  }

  return NextResponse.json(result);
}

import { isCronAuthorized } from "@/lib/cron-auth";
import { sendCourtesyWelcome } from "@/lib/courtesy/welcome-mail";

// TEMPORARY - one sample of the welcome e-mail to ahmad.hamdani (no password is changed). Removed right after use.
export async function GET(request: Request) {
  if (!(await isCronAuthorized(request))) return new Response("Unauthorized", { status: 401 });
  const r = await sendCourtesyWelcome({
    name: "Ahmad Hamadani",
    email: "ahmad.hamdani@jiadmotors.com",
    tempPassword: "(sample - set when the account is created)",
    receptionManager: false,
    senderName: "Warranty Team",
    site: "https://mgwarranty.vercel.app",
  });
  return Response.json(r);
}

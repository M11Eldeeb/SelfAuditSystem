import type { DriveConnection } from "@/lib/google-drive";

const MESSAGES: Record<string, { tone: "good" | "bad"; text: string }> = {
  connected: { tone: "good", text: "Google Drive is connected. Attachments will now be saved to the company Drive." },
  cancelled: { tone: "bad", text: "The Google sign-in was cancelled, so nothing was connected." },
  "not-configured": { tone: "bad", text: "Google sign-in is not set up on the server yet (the Google client ID and secret are missing)." },
  "bad-state": { tone: "bad", text: "That sign-in could not be verified. Please try connecting again." },
  "no-refresh-token": { tone: "bad", text: "Google did not give a lasting connection. Remove the app's access in your Google account settings, then connect again." },
  "wrong-account": { tone: "bad", text: "That Google account is not a company (@jiadmotors.com) account. Connect with the company account." },
  failed: { tone: "bad", text: "Connecting to Google Drive failed. Please try again; if it keeps failing, check the server settings." },
};

/**
 * Officer-only strip on the diary: whether Google Drive is connected (and as
 * whom), a Connect / Reconnect button, and the outcome of the last attempt.
 */
export function DriveStatus({ connection, flag, detail }: { connection: DriveConnection | null; flag?: string; detail?: string }) {
  const note = flag ? MESSAGES[flag] : undefined;
  return (
    <div className="space-y-2">
      {note && (
        <p
          role="status"
          className={`rounded-lg border px-3 py-2 text-sm ${
            note.tone === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {note.text}
          {detail && <span className="mt-1 block font-mono text-xs break-words opacity-90">{detail}</span>}
        </p>
      )}
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
          connection ? "border-neutral-200/70 bg-white shadow-sm" : "border-amber-200 bg-amber-50"
        }`}
      >
        <p className={connection ? "text-neutral-700" : "text-amber-900"}>
          {connection ? (
            <>
              <span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" aria-hidden="true" />
              Attachments are saved to Google Drive in{" "}
              <span className="font-medium text-neutral-900">Rejected Claims From Workshop</span>, owned by{" "}
              <span className="font-medium text-neutral-900">{connection.accountEmail}</span>. Officers can open all of it, and each branch&apos;s admins open their own
              branch&apos;s folder - shared automatically, view only.
            </>
          ) : (
            <>
              <span className="font-semibold">Google Drive is not connected.</span> Entries can be logged, but attachments are unavailable until you connect the company account.
            </>
          )}
        </p>
        <div className="flex shrink-0 flex-wrap items-start justify-end gap-2">
          {connection && (
            <>
              <a
                href={`https://drive.google.com/drive/folders/${connection.rootFolderId}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50"
              >
                Open folder in Drive
              </a>
            </>
          )}
          {/* A plain link on purpose: this starts a full-page redirect to Google. */}
          <a
            href="/api/google-drive/connect"
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors ${
              connection ? "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50" : "bg-brand text-white hover:bg-brand-dark"
            }`}
          >
            {connection ? "Reconnect" : "Connect Google Drive"}
          </a>
        </div>
      </div>
    </div>
  );
}

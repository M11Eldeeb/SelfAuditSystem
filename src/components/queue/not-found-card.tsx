/** A customer page whose branch or ticket does not exist. */
export function NotFoundCard({ en, ar }: { en: string; ar: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-neutral-100 p-8 text-center">
      <p className="text-lg font-semibold text-neutral-900">{en}</p>
      <p className="text-neutral-600" dir="rtl">
        {ar}
      </p>
    </main>
  );
}

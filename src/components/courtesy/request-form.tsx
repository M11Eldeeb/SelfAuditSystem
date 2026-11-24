"use client";

import { useState } from "react";
import { PublicShell, Spinner } from "@/components/queue/public-shell";
import { SignaturePad, shrinkPhoto } from "@/components/courtesy/signature-pad";
import { submitCourtesyRequest } from "@/app/actions/courtesy-agreements";
import { CC_T, ID_RE, NATIONALITIES, PHONE_RE, VIN_RE, cleanPlate, digitsOnly, isAdult, todayKsa, type CourtesyLang } from "@/lib/courtesy/agreements";
import { readRegistration } from "@/components/courtesy/registration-ocr";

/** The customer's courtesy car form (no sign-in): his details, his advisor, the terms, his signature. Arabic or English. */
export function CourtesyRequestForm({ code, branch, advisors, presetAdvisor, terms, termsId }: { code: string; branch: { name: string; name_ar: string | null }; advisors: { id: string; name: string }[]; presetAdvisor: string | null; terms: { en: string; ar: string }[]; termsId: string | null }) {
  const [lang, setLang] = useState<CourtesyLang>("ar");
  const t = CC_T[lang];
  const ar = lang === "ar";
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [birth, setBirth] = useState("");
  const [nat, setNat] = useState("");
  const [otherNat, setOtherNat] = useState("");
  const [vin, setVin] = useState("");
  const [plate, setPlate] = useState("");
  const [reading, setReading] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const [advisor, setAdvisor] = useState(presetAdvisor && advisors.some((a) => a.id === presetAdvisor) ? presetAdvisor : "");
  const [accepted, setAccepted] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [license, setLicense] = useState<{ base64: string; mimeType: string; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [today] = useState(todayKsa);

  const nationality = nat === "__other" ? otherNat.trim() : nat;

  async function submit() {
    setError(null);
    const p = digitsOnly(phone);
    const id = digitsOnly(idNumber);
    if (name.trim().length < 3) return setError(t.errName);
    if (!PHONE_RE.test(p)) return setError(t.errPhone);
    if (!ID_RE.test(id)) return setError(t.errId);
    if (!isAdult(birth, today)) return setError(t.errBirth);
    if (!nationality) return setError(t.errNationality);
    if (!VIN_RE.test(vin)) return setError(t.errVin);
    if (plate.trim().length < 3) return setError(t.errPlate);
    if (!advisor) return setError(t.errAdvisor);
    if (!accepted) return setError(t.errAccept);
    if (!signature) return setError(t.errSign);
    setBusy(true);
    const r = await submitCourtesyRequest({ code, lang, name, phone: p, idNumber: id, birthDate: birth, nationality, vin, plate: cleanPlate(plate), advisorId: advisor, accepted, termsId, signature, license: license ? { base64: license.base64, mimeType: license.mimeType } : null }).catch(() => ({ error: ar ? "تعذر الإرسال - حاول مرة أخرى." : "Could not send - please try again.", ref: undefined }));
    setBusy(false);
    if (r.error || !r.ref) return setError(r.error ?? "?");
    setDone(r.ref);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const input = "w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-3 text-base text-neutral-900 shadow-sm focus:border-[#c4121a] focus:ring-2 focus:ring-[#c4121a]/15 focus:outline-none";
  const label = "mb-1 block text-sm font-semibold text-neutral-800";
  // A mandatory field: a red star after its name (optional fields have none).
  const req = (
    <span className="ms-0.5 text-[#c4121a]" aria-hidden="true">
      *
    </span>
  );
  const help = "mt-1 text-xs text-neutral-500";

  return (
    <PublicShell title={t.title} subtitle={ar ? (branch.name_ar ?? branch.name) : branch.name} lang={lang} dir={ar ? "rtl" : "ltr"} onToggle={() => setLang(ar ? "en" : "ar")}>
      {done ? (
        <div className="m-4 space-y-3 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
          <h1 className="text-xl font-bold text-neutral-900">{t.doneTitle}</h1>
          <p className="text-sm text-neutral-600">{t.doneText}</p>
          <p className="text-sm text-neutral-500">
            {t.ref}: <b dir="ltr" className="font-mono text-neutral-900">{done}</b>
          </p>
        </div>
      ) : (
        <div className="space-y-4 p-4 pb-44">
          <p className="text-sm text-neutral-600">{t.intro}</p>
          <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div>
              <label className={label} htmlFor="cc-name">
                {t.name}
                {req}
              </label>
              <input id="cc-name" className={input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
            <div>
              <label className={label} htmlFor="cc-phone">
                {t.phone}
                {req}
              </label>
              <input id="cc-phone" dir="ltr" className={input} value={phone} onChange={(e) => setPhone(digitsOnly(e.target.value).slice(0, 10))} inputMode="numeric" autoComplete="tel" placeholder="05XXXXXXXX" />
              <p className={help}>{t.phoneHelp}</p>
            </div>
            <div>
              <label className={label} htmlFor="cc-id">
                {t.id}
                {req}
              </label>
              <input id="cc-id" dir="ltr" className={input} value={idNumber} onChange={(e) => setIdNumber(digitsOnly(e.target.value).slice(0, 10))} inputMode="numeric" placeholder="1XXXXXXXXX / 2XXXXXXXXX" />
              <p className={help}>{t.idHelp}</p>
            </div>
            <div>
              <label className={label} htmlFor="cc-birth">
                {t.birth}
                {req}
              </label>
              <input id="cc-birth" type="date" className={input} value={birth} max={today} onChange={(e) => setBirth(e.target.value)} />
              <p className={help}>{t.birthHelp}</p>
            </div>
            <div>
              <label className={label} htmlFor="cc-nat">
                {t.nationality}
                {req}
              </label>
              <select id="cc-nat" className={input} value={nat} onChange={(e) => setNat(e.target.value)}>
                <option value="">—</option>
                {NATIONALITIES.map((n) => (
                  <option key={n.en} value={n.en}>
                    {ar ? n.ar : n.en}
                  </option>
                ))}
                <option value="__other">{t.otherNationality}</option>
              </select>
              {nat === "__other" && <input className={`${input} mt-2`} value={otherNat} onChange={(e) => setOtherNat(e.target.value)} aria-label={t.otherNationality} />}
            </div>
          </section>

          <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div>
              <h2 className="font-bold text-neutral-900">{t.yourCar}</h2>
              <p className={help}>{t.yourCarHelp}</p>
            </div>
            <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed px-3 py-3 text-sm font-bold ${reading === "busy" ? "border-neutral-300 text-neutral-500" : "border-[#c4121a]/40 text-[#c4121a] hover:bg-red-50"}`}>
              <span aria-hidden="true">📷</span>
              {reading === "busy" ? t.reading : t.readCard}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={reading === "busy"}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  setReading("busy");
                  try {
                    const r = await readRegistration(f);
                    if (r.vin) setVin(r.vin);
                    if (r.plate) setPlate(r.plate);
                    setReading(r.vin || r.plate ? "done" : "fail");
                  } catch {
                    setReading("fail");
                  }
                }}
              />
            </label>
            {reading === "done" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{t.readDone}</p>}
            {reading === "fail" && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{t.readFail}</p>}
            <div>
              <label className={label} htmlFor="cc-vin">
                {t.vin}
                {req}
              </label>
              <input id="cc-vin" dir="ltr" className={`${input} font-mono tracking-wide`} value={vin} maxLength={30} autoCapitalize="characters" onChange={(e) => setVin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 30))} placeholder="LSJ…" />
            </div>
            <div>
              <label className={label} htmlFor="cc-plate">
                {t.plate}
                {req}
              </label>
              <input id="cc-plate" dir="ltr" className={input} value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase().slice(0, 12))} placeholder="1234 ABC" />
            </div>
            <div>
              <label className={label} htmlFor="cc-adv">
                {t.advisor}
                {req}
              </label>
              <select id="cc-adv" className={input} value={advisor} onChange={(e) => setAdvisor(e.target.value)}>
                <option value="">{t.chooseAdvisor}</option>
                {advisors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className={label}>{t.license}</span>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-3 text-sm font-semibold text-neutral-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {license ? <img src={license.preview} alt="" className="h-14 w-20 rounded object-cover" /> : <span className="flex h-14 w-20 items-center justify-center rounded bg-white text-2xl">🪪</span>}
                {t.takePhoto}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    try {
                      const p = await shrinkPhoto(f);
                      setLicense({ ...p, preview: `data:${p.mimeType};base64,${p.base64}` });
                    } catch {
                      setError(ar ? "تعذرت قراءة الصورة." : "The photo could not be read.");
                    }
                  }}
                />
              </label>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <h2 className="font-bold text-neutral-900">{t.terms}</h2>
            <ol className="max-h-80 space-y-2.5 overflow-y-auto rounded-xl bg-neutral-50 p-3 text-[13px] leading-relaxed text-neutral-700">
              {terms.map((x, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 font-bold text-neutral-900">{i + 1}-</span>
                  <span>{ar ? x.ar : x.en}</span>
                </li>
              ))}
            </ol>
            <label className="flex items-start gap-3 rounded-xl bg-neutral-50 p-3 text-sm font-semibold text-neutral-900">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#c4121a]" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              <span>
                {t.accept}
                {req}
              </span>
            </label>
            <div>
              <span className={label}>
                {t.sign}
                {req}
              </span>
              <SignaturePad onChange={setSignature} clearLabel={t.clear} hint={t.signHelp} dir={ar ? "rtl" : "ltr"} />
            </div>
          </section>

          <div className="fixed inset-x-0 bottom-0 z-20 flex justify-center border-t border-black/5 bg-white/90 p-3 backdrop-blur-xl">
            <div className="w-full max-w-md space-y-2 px-1">
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
              <p className="text-center text-[11px] leading-snug text-neutral-500">
                <span className="font-semibold text-[#c4121a]">{t.required}</span> · {t.consent}
              </p>
              <button type="button" disabled={busy} onClick={() => void submit()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#c4121a] py-3.5 text-base font-bold text-white shadow-sm disabled:opacity-60">
                {busy && <Spinner />}
                {busy ? t.sending : t.submit}
              </button>
            </div>
          </div>
        </div>
      )}
    </PublicShell>
  );
}

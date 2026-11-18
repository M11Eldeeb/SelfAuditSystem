import "server-only";
import React from "react";
import { Document, Font, Link, Page, Path, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { TAJAWAL_BOLD, TAJAWAL_REGULAR } from "@/assets/fonts/tajawal-data";
import { BRAND, INK, LINE, MUTED, brandLockup } from "@/lib/rejected-claims-logbook";

/**
 * The branch's reception poster (A4, to print and put on the counter): a large QR code that opens the branch's join page
 * and a short guide in English and Arabic. Same look as the QC and technical inquiry sheets: the company mark, the red
 * title and rule, the footer.
 */

Font.register({
  family: "Tajawal",
  fonts: [
    { src: TAJAWAL_REGULAR, fontWeight: 400 },
    { src: TAJAWAL_BOLD, fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

const h = React.createElement;

/** A QR code as vector squares (sharp in print), `size` points wide. */
function bigQr(url: string, size: number) {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 2;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  const total = n + quiet * 2;
  return h(
    Link,
    { src: url, style: { textDecoration: "none" } },
    h(
      View,
      { style: { padding: 10, borderWidth: 1.5, borderColor: LINE, borderRadius: 14, backgroundColor: "#ffffff" } },
      h(Svg, { width: size, height: size, viewBox: `0 0 ${total} ${total}` }, h(Path, { d, fill: INK }))
    )
  );
}

const STEPS: { en: [string, string]; ar: [string, string] }[] = [
  { en: ["Scan the code", "Open your phone's camera and point it at the code above."], ar: ["امسح الرمز", "افتح كاميرا جوالك ووجّهها نحو الرمز أعلاه."] },
  { en: ["Enter your mobile", "9 digits starting with 5 (5XXXXXXXX)."], ar: ["أدخل رقم جوالك", "تسعة أرقام تبدأ بالرقم خمسة."] },
  {
    en: ["Confirm and join", "With an appointment today your details appear - just confirm. Otherwise choose your service."],
    ar: ["أكّد وانضم", "إذا كان لديك موعد اليوم تظهر بياناتك فقط أكّدها، وإلا اختر الخدمة."],
  },
  {
    en: ["Wait", "Keep the page open. We call your ticket number on the screen."],
    ar: ["انتظر", "أبقِ الصفحة مفتوحة، وسننادي رقم تذكرتك على الشاشة."],
  },
];

function posterDocument(branch: { name: string; name_ar: string | null }, joinUrl: string) {
  const step = (i: number) =>
    h(
      View,
      { key: i, wrap: false, style: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 7, borderTopWidth: i ? 1 : 0, borderTopColor: LINE } },
      // English (left)
      h(
        View,
        { style: { flex: 1, flexDirection: "row", paddingRight: 10 } },
        h(
          View,
          { style: { width: 22, height: 22, borderRadius: 11, backgroundColor: BRAND, alignItems: "center", justifyContent: "center", marginRight: 9 } },
          h(Text, { style: { color: "#ffffff", fontSize: 11, fontWeight: 700 } }, String(i + 1))
        ),
        h(
          View,
          { style: { flex: 1 } },
          h(Text, { style: { fontSize: 12.5, fontWeight: 700 } }, STEPS[i].en[0]),
          h(Text, { style: { fontSize: 9.5, color: MUTED, marginTop: 2, lineHeight: 1.45 } }, STEPS[i].en[1])
        )
      ),
      h(View, { style: { width: 1, alignSelf: "stretch", backgroundColor: LINE } }),
      // Arabic (right)
      h(
        View,
        { style: { flex: 1, flexDirection: "row-reverse", paddingLeft: 10 } },
        h(
          View,
          { style: { width: 22, height: 22, borderRadius: 11, backgroundColor: BRAND, alignItems: "center", justifyContent: "center", marginLeft: 9 } },
          h(Text, { style: { color: "#ffffff", fontSize: 11, fontWeight: 700 } }, String(i + 1))
        ),
        h(
          View,
          { style: { flex: 1 } },
          h(Text, { style: { fontSize: 13, fontWeight: 700, textAlign: "right" } }, STEPS[i].ar[0]),
          h(Text, { style: { fontSize: 10, color: MUTED, marginTop: 2, lineHeight: 1.45, textAlign: "right" } }, STEPS[i].ar[1])
        )
      )
    );

  return h(
    Document,
    { title: `Customer queue - ${branch.name}`, author: "MG Warranty Management", subject: "Customer queue" },
    h(
      Page,
      { size: "A4", style: { paddingTop: 26, paddingBottom: 50, paddingHorizontal: 40, fontFamily: "Tajawal", fontSize: 10, color: INK } },
      // Header: the company mark, the red title and rule (as the QC report)
      h(
        View,
        { style: { borderBottomWidth: 2, borderBottomColor: BRAND, paddingBottom: 10, marginBottom: 14 } },
        h(View, { style: { flexDirection: "row", justifyContent: "flex-start", marginHorizontal: -14 } }, brandLockup(56)),
        h(
          View,
          { style: { alignItems: "center", marginTop: -8 } },
          h(
            View,
            { style: { flexDirection: "row", alignItems: "center" } },
            h(Text, { style: { fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: 1.5 } }, "CUSTOMER QUEUE"),
            h(Text, { style: { fontSize: 9, color: MUTED, marginHorizontal: 6 } }, "·"),
            h(Text, { style: { fontSize: 10, color: MUTED, fontWeight: 700 } }, "طابور العملاء")
          ),
          h(Text, { style: { fontSize: 24, color: BRAND, fontWeight: 700, letterSpacing: 1.5, marginTop: 4 } }, "JOIN THE QUEUE"),
          h(Text, { style: { fontSize: 20, color: BRAND, fontWeight: 700, marginTop: 1 } }, "انضم إلى الطابور"),
          h(View, { style: { width: 36, height: 2, backgroundColor: BRAND, marginTop: 6, marginBottom: 6 } }),
          h(Text, { style: { fontSize: 15, fontWeight: 700 } }, branch.name),
          branch.name_ar ? h(Text, { style: { fontSize: 13, fontWeight: 700, color: MUTED, marginTop: 1 } }, branch.name_ar) : null
        )
      ),
      // The QR code, large
      h(
        View,
        { style: { alignItems: "center", marginBottom: 6 } },
        bigQr(joinUrl, 190),
        h(
          View,
          { style: { flexDirection: "row", alignItems: "center", marginTop: 8 } },
          h(Text, { style: { fontSize: 12, fontWeight: 700 } }, "Scan with your phone camera"),
          h(Text, { style: { fontSize: 12, color: MUTED, marginHorizontal: 8 } }, "·"),
          h(Text, { style: { fontSize: 12.5, fontWeight: 700 } }, "امسح بكاميرا جوالك")
        ),
        h(Text, { style: { fontSize: 8.5, color: MUTED, marginTop: 3 } }, joinUrl.replace(/^https?:\/\//, ""))
      ),
      // The guide
      h(
        View,
        { style: { marginTop: 10, borderWidth: 1, borderColor: LINE, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 2 } },
        h(
          View,
          { style: { flexDirection: "row", justifyContent: "space-between", paddingTop: 6, paddingBottom: 2 } },
          h(Text, { style: { fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: 1 } }, "HOW IT WORKS"),
          h(Text, { style: { fontSize: 10, color: MUTED, fontWeight: 700 } }, "طريقة الاستخدام")
        ),
        ...STEPS.map((_, i) => step(i))
      ),
      h(
        View,
        { style: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 } },
        h(Text, { style: { fontSize: 9, color: MUTED, flex: 1 } }, "Already have a ticket? Scan the code and tap Find it."),
        h(Text, { style: { fontSize: 9.5, color: MUTED, flex: 1, textAlign: "right" } }, "لديك تذكرة؟ امسح الرمز واضغط ابحث عنها.")
      ),
      h(
        View,
        { fixed: true, style: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6 } },
        h(Text, { style: { fontSize: 8, color: MUTED } }, `${branch.name} - customer queue`),
        h(
          View,
          { style: { flexDirection: "row" } },
          h(Text, { style: { fontSize: 8, color: MUTED } }, "Need help? Please ask at the reception."),
          h(Text, { style: { fontSize: 8, color: MUTED, marginHorizontal: 5 } }, "·"),
          h(Text, { style: { fontSize: 8.5, color: MUTED } }, "تحتاج مساعدة؟ اسأل الاستقبال.")
        )
      )
    )
  );
}

export async function renderQueuePoster(branch: { name: string; name_ar: string | null }, joinUrl: string): Promise<Uint8Array> {
  const buffer = await renderToBuffer(posterDocument(branch, joinUrl) as Parameters<typeof renderToBuffer>[0]);
  return new Uint8Array(buffer);
}

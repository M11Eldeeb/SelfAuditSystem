// Courtesy car agreements: what the customer form, the advisor's handover, the server and the PDF share.
// Bilingual (Arabic / English) - the customer fills the form in his language.

export type CourtesyLang = "ar" | "en";
export type AgreementStatus = "requested" | "open" | "closed" | "cancelled";

/** A damage mark on the walk-around drawing: where (0-1 of the drawing's width / height) and what. */
export type DamageMark = { x: number; y: number; kind: DamageKind; note?: string };
export type DamageKind = "scratch" | "dent" | "broken" | "other";
export const DAMAGE_KINDS: { id: DamageKind; en: string; ar: string; color: string }[] = [
  { id: "scratch", en: "Scratch", ar: "خدش", color: "#d97706" },
  { id: "dent", en: "Dent", ar: "صدمة", color: "#d70015" },
  { id: "broken", en: "Broken / cracked", ar: "كسر / شرخ", color: "#7c3aed" },
  { id: "other", en: "Other", ar: "أخرى", color: "#1d4ed8" },
];

export const STATUS_LABEL: Record<AgreementStatus, string> = {
  requested: "Waiting for the car",
  open: "Car with the customer",
  closed: "Returned",
  cancelled: "Cancelled",
};

/** Fuel: the gauge in eighths, kept as a percentage. */
export const FUEL_STEPS = [0, 13, 25, 38, 50, 63, 75, 88, 100];
export const fuelLabel = (v: number | null | undefined) => (v == null ? "—" : v === 0 ? "Empty (0%)" : v === 100 ? "Full (100%)" : `${Math.round((v / 100) * 8)}/8 (${v}%)`);

export const NATIONALITIES: { en: string; ar: string }[] = [
  { en: "Saudi", ar: "سعودي" },
  { en: "Egyptian", ar: "مصري" },
  { en: "Indian", ar: "هندي" },
  { en: "Pakistani", ar: "باكستاني" },
  { en: "Bangladeshi", ar: "بنغلاديشي" },
  { en: "Filipino", ar: "فلبيني" },
  { en: "Yemeni", ar: "يمني" },
  { en: "Sudanese", ar: "سوداني" },
  { en: "Jordanian", ar: "أردني" },
  { en: "Syrian", ar: "سوري" },
  { en: "Lebanese", ar: "لبناني" },
  { en: "Palestinian", ar: "فلسطيني" },
  { en: "Iraqi", ar: "عراقي" },
  { en: "Emirati", ar: "إماراتي" },
  { en: "Kuwaiti", ar: "كويتي" },
  { en: "Bahraini", ar: "بحريني" },
  { en: "Qatari", ar: "قطري" },
  { en: "Omani", ar: "عماني" },
  { en: "Moroccan", ar: "مغربي" },
  { en: "Tunisian", ar: "تونسي" },
  { en: "Algerian", ar: "جزائري" },
  { en: "Ethiopian", ar: "إثيوبي" },
  { en: "Eritrean", ar: "إريتري" },
  { en: "Nepali", ar: "نيبالي" },
  { en: "Sri Lankan", ar: "سريلانكي" },
  { en: "Indonesian", ar: "إندونيسي" },
  { en: "Turkish", ar: "تركي" },
  { en: "American", ar: "أمريكي" },
  { en: "British", ar: "بريطاني" },
];

/** Customer's details as the form sends them. */
export type CourtesyRequestInput = {
  code: string;
  lang: CourtesyLang;
  name: string;
  phone: string;
  idNumber: string;
  birthDate: string; // YYYY-MM-DD
  nationality: string;
  /** The customer's own car (in for service). */
  vin: string;
  plate: string;
  advisorId: string;
  accepted: boolean;
  /** The branch's terms version the customer read (null: the standard terms). */
  termsId?: string | null;
  signature: string; // PNG, base64 (no data: prefix)
  license?: { base64: string; mimeType: string } | null;
};

export const PHONE_RE = /^05\d{8}$/;
/** The VIN / chassis number as on the card: letters and digits, any length (older and imported cars differ from 17). */
export const VIN_RE = /^[A-Z0-9]{1,30}$/;
/** "2012 r g r", "2012-RGR" -> "2012 RGR". */
export const cleanPlate = (v: string) => {
  const t = v.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).toUpperCase().replace(/[^A-Z0-9\u0600-\u06FF]/g, "");
  const m = t.match(/^(\d{1,4})([A-Z\u0600-\u06FF]{1,3})$/) ?? t.match(/^([A-Z\u0600-\u06FF]{1,3})(\d{1,4})$/);
  // Digits, then the letters spaced as on the registration card: "4200 X Z R".
  return m ? (/^\d/.test(m[1]) ? `${m[1]} ${[...m[2]].join(" ")}` : `${m[2]} ${[...m[1]].join(" ")}`) : v.trim().toUpperCase();
};
export const ID_RE = /^[12]\d{9}$/;
/** 18 or older on `today` (YYYY-MM-DD). */
export function isAdult(birth: string, today: string): boolean {
  const m = birth.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [y, mo, d] = today.split("-").map(Number);
  let age = y - Number(m[1]);
  if (mo < Number(m[2]) || (mo === Number(m[2]) && d < Number(m[3]))) age--;
  return age >= 18 && age < 100;
}
export const digitsOnly = (v: string) => v.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/\D/g, "");

/** The words of the customer form, in both languages. */
export const CC_T = {
  en: {
    title: "Courtesy car request",
    intro: "Fill in your details, read the terms and sign. Your service advisor will then prepare the car.",
    name: "Full name (as on your ID)",
    phone: "Mobile number",
    phoneHelp: "10 digits, starts with 05",
    id: "National ID / Iqama number",
    idHelp: "10 digits",
    birth: "Date of birth",
    birthHelp: "You must be 18 or older",
    nationality: "Nationality",
    otherNationality: "Other - write it",
    yourCar: "Your car (in for service)",
    yourCarHelp: "As on your vehicle registration card (istimara).",
    readCard: "Read from a photo of the registration card",
    reading: "Reading the card…",
    readFail: "The card could not be read - type the VIN and plate.",
    readDone: "Check the VIN and plate below and correct them if needed.",
    vin: "VIN (chassis number)",
    plate: "Plate number",
    errVin: "Enter the VIN / chassis number (letters and digits, as on the registration card).",
    errPlate: "Write the plate number.",
    advisor: "Your service advisor",
    chooseAdvisor: "Choose your service advisor",
    license: "Photo of your driving licence",
    takePhoto: "Add photo",
    terms: "Terms and conditions",
    accept: "I have read and accept the terms and conditions",
    sign: "Your signature",
    signHelp: "Sign with your finger in the box",
    clear: "Clear",
    submit: "Submit",
    sending: "Sending…",
    doneTitle: "Thank you - your request was sent",
    doneText: "Your service advisor has been told and will prepare the courtesy car. Please wait at reception.",
    ref: "Reference",
    errName: "Write your full name.",
    errPhone: "The mobile number must be 10 digits and start with 05.",
    errId: "The ID / Iqama number must be 10 digits.",
    errBirth: "You must be 18 or older to receive a courtesy car.",
    errNationality: "Choose your nationality.",
    errAdvisor: "Choose your service advisor.",
    errAccept: "Read and accept the terms and conditions.",
    errSign: "Sign in the box.",
    required: "* means mandatory",
    consent: "By continuing, you agree that your name, mobile number and visit details are used by MG and its service partners and systems to manage your visit and send you queue notifications.",
    language: "العربية",
  },
  ar: {
    title: "طلب سيارة بديلة",
    intro: "أدخل بياناتك واقرأ الشروط ووقّع، وسيقوم مستشار الخدمة بتجهيز السيارة.",
    name: "الاسم الكامل (كما في الهوية)",
    phone: "رقم الجوال",
    phoneHelp: "10 أرقام ويبدأ بـ 05",
    id: "رقم الهوية / الإقامة",
    idHelp: "10 أرقام",
    birth: "تاريخ الميلاد",
    birthHelp: "يجب أن يكون عمرك 18 سنة أو أكثر",
    nationality: "الجنسية",
    otherNationality: "أخرى - اكتبها",
    yourCar: "سيارتك (في الصيانة)",
    yourCarHelp: "كما في استمارة السيارة.",
    readCard: "قراءة من صورة الاستمارة",
    reading: "جارٍ قراءة الاستمارة…",
    readFail: "تعذرت قراءة الاستمارة - اكتب رقم الهيكل ورقم اللوحة.",
    readDone: "تحقق من رقم الهيكل ورقم اللوحة أدناه وصححهما إذا لزم.",
    vin: "رقم الهيكل (VIN)",
    plate: "رقم اللوحة",
    errVin: "أدخل رقم الهيكل (حروف وأرقام، كما في الاستمارة).",
    errPlate: "اكتب رقم اللوحة.",
    advisor: "مستشار الخدمة",
    chooseAdvisor: "اختر مستشار الخدمة",
    license: "صورة رخصة القيادة",
    takePhoto: "إضافة صورة",
    terms: "الشروط والأحكام",
    accept: "قرأت الشروط والأحكام وأوافق عليها",
    sign: "توقيعك",
    signHelp: "وقّع بإصبعك داخل المربع",
    clear: "مسح",
    submit: "إرسال",
    sending: "جارٍ الإرسال…",
    doneTitle: "شكرًا لك - تم إرسال طلبك",
    doneText: "تم إبلاغ مستشار الخدمة وسيقوم بتجهيز السيارة البديلة. يرجى الانتظار في الاستقبال.",
    ref: "الرقم المرجعي",
    errName: "اكتب اسمك الكامل.",
    errPhone: "رقم الجوال يجب أن يكون 10 أرقام ويبدأ بـ 05.",
    errId: "رقم الهوية / الإقامة يجب أن يكون 10 أرقام.",
    errBirth: "يجب أن يكون عمرك 18 سنة أو أكثر لاستلام سيارة بديلة.",
    errNationality: "اختر الجنسية.",
    errAdvisor: "اختر مستشار الخدمة.",
    errAccept: "اقرأ الشروط والأحكام ووافق عليها.",
    errSign: "وقّع داخل المربع.",
    required: "* تعني حقلًا إلزاميًا",
    consent: "بالمتابعة، أنت توافق على استخدام اسمك ورقم جوالك وبيانات زيارتك من قبل إم جي وشركائها ومزوّدي الأنظمة لإدارة زيارتك وإرسال تنبيهات الدور.",
    language: "English",
  },
} as const;

/** The agreement's terms and conditions (English and Arabic, same numbering). */
export const TERMS: { en: string; ar: string }[] = [
  {
    en: "The customer or the authorized driver accept that they will be the only person to drive this vehicle and that the vehicle will be treated with the utmost care whilst following Saudi Arabia's motor laws.",
    ar: "يلتزم العميل أو المفوض نظامًا (فقط) باستخدام السيارة البديلة بحرص شديد، ويلتزم باتباع أصول القيادة السوية والالتزام بأنظمة المرور.",
  },
  {
    en: "The customer above is responsible for all damages caused by the customer, this includes any malfunctions to the engine or to the body (interior & exterior).",
    ar: "يلتزم العميل بتحمّل كامل المسؤولية عن أي أضرار قد تنشأ بسبب استخدامه للمركبة، ويشمل ذلك أي أضرار ميكانيكية قد تصيب محرك المركبة أو أي أضرار قد تصيب هيكل السيارة (من الداخل أو الخارج).",
  },
  {
    en: "The customer agrees that Jiad Modern Motors will register the loaner vehicle under his name on (TAMM) as long as the vehicle is in his possession; any traffic infringements incurred will be charged to the customer, even if discovered after the vehicle is returned.",
    ar: "يحق لشركة جياد الحديثة للسيارات تسجيل العميل كمستخدم للمركبة في نظام (تم) طوال فترة استخدامه لها، كما يلتزم بدفع أي مخالفات مرورية تُقيَّد عن هذه الفترة وإن تم اكتشافها لاحقًا.",
  },
  {
    en: "The customer acknowledges that he/they will not rent, loan, share or gift the loaner vehicle to anybody under any circumstance, or take the vehicle outside of the country, neither for a financial amount nor for free.",
    ar: "لا يحق للعميل استغلال المركبة كتأجيرها أو إعارتها أو هبتها للغير بمقابل أو دون مقابل، أو السفر بها خارج البلاد.",
  },
  {
    en: "The customer agrees to return the loaner vehicle no later than 2 days after being informed that it is due for service or that his/their vehicle is ready for collection. Otherwise a fine of SAR 1,000 per day is charged from the 3rd day as rental fees, up to 10 days. If the vehicle is not returned after the 10-day limit, Jiad Modern Motors Co. has the right to take back the car by all means, including but not limited to immobilizing or tracking the vehicle and informing government parties, without any liability on the company, while keeping the right to charge rental fees for the full duration.",
    ar: "يلتزم العميل بتسليم المركبة البديلة إلى شركة جياد الحديثة للسيارات خلال مدة أقصاها يومان من تاريخ إبلاغ الشركة له بضرورة إعادتها بغرض صيانتها أو لاستلام مركبته، وفي حال عدم إعادتها في الوقت المحدد يُحتسب مبلغ (1,000) ريال سعودي لليوم الواحد من اليوم الثالث ولمدة 10 أيام لقاء أجرة المركبة، وفي حال الإخلال بهذا الالتزام يحق للشركة استرداد السيارة بكافة الطرق المتاحة، ومنها على سبيل المثال لا الحصر تثبيت السيارة أو تعطيلها أو مراقبتها أو إبلاغ الجهات المختصة، دون أدنى مسؤولية على الشركة، مع احتفاظها بحقها في المطالبة بأجرة السيارة البديلة عن كامل الفترة.",
  },
  {
    en: "The customer must return the vehicle to Jiad Modern Motors Co. once every 30 days in case the vehicle, registration or documentation needs to be serviced, changed, returned or updated. If the vehicle is not returned on time, Jiad Modern Motors Co. reserves the right to take back the car by all the means stated in point (5), without any liability to the company.",
    ar: "يتوجب على العميل إعادة السيارة البديلة إلى شركة جياد الحديثة للسيارات كل 30 يومًا (في حال طالت مدة الإصلاح عن ذلك) لفحص المركبة وصيانتها أو لتجديد تفويض القيادة، ويحق للشركة استبدال السيارة إن لزم الأمر، وفي حال الإخلال بهذا الالتزام يتحمل العميل كامل المسؤولية عما قد يقع على السيارة من أضرار أو أعطال، ويحق للشركة استردادها بكافة الطرق الموضحة في البند رقم (5) دون أدنى مسؤولية عليها.",
  },
  {
    en: "Jiad Modern Motors is not responsible for any personal belongings left in the vehicle at the time of return.",
    ar: "لا تتحمل شركة جياد الحديثة للسيارات المسؤولية عن أي أغراض شخصية للعميل تُترك في السيارة عند إعادتها للشركة.",
  },
  {
    en: "The customer agrees that he/they are liable for any damages to the vehicle not covered by the insurance company/policy.",
    ar: "يلتزم العميل بتحمّل تكاليف إصلاح أي حادث لا تغطيه شركة التأمين أثناء فترة وجود السيارة البديلة معه.",
  },
  {
    en: "The customer must report any damage caused during an accident to Jiad Modern Motors (8002440390), the Traffic Police and NAJM (199033) as soon as possible, and must supply the accident report to Jiad Modern Motors.",
    ar: "يلتزم العميل بإبلاغ شركة جياد الحديثة للسيارات (8002440390) وإدارة المرور وخدمة نجم (199033) عن أي حادث قد يتعرض له - لا سمح الله - كما يلتزم بتقديم تقرير المرور وجميع الأوراق المطلوبة لإصلاح السيارة.",
  },
  {
    en: "If the vehicle is damaged, whether by the customer or a third party, the customer agrees to pay up to SAR 1,000 as an insurance deductible, along with any balance not covered by or exceeding the insurance coverage.",
    ar: "في حال تعرضت السيارة البديلة لأي ضرر أو حادث بسبب يعود للعميل أو لطرف آخر، يلتزم العميل بدفع مبلغ (1,000) ريال سعودي كنسبة تحمل من إجمالي قيمة الإصلاح، مع دفع فرق قيمة الإصلاح الذي لا تغطيه أو يتجاوز التغطية التأمينية.",
  },
  {
    en: "If the customer installs any window tinting on the company vehicle, a removal fee of SAR 500 will be charged, along with any cost borne by the company due to the installation or removal. The customer also bears all fines from the relevant government parties.",
    ar: "في حال قام العميل بتركيب عازل حراري أو تظليل لزجاج السيارة البديلة، يتحمل مبلغ (500) ريال سعودي مقابل إزالته بالوكالة، إضافةً إلى قيمة أي أضرار تقع على زجاج السيارة أو أجزائها بسبب التركيب أو الإزالة، كما يتحمل أي غرامات تسجلها الجهات المختصة على المركبة.",
  },
  {
    en: "By signing and receiving the vehicle, the customer waives all rights to claim compensation for the difference between his vehicle model and the vehicle model provided by the company.",
    ar: "ليس للعميل الحق في المطالبة بفرق قيمة اختلاف فئة السيارة البديلة عن سيارته بمجرد موافقته على استلامها، وإن كانت أقل من فئة سيارته.",
  },
  {
    en: "The customer agrees that Jiad Modern Motors Co. has the right to detain his/their vehicle if any of the above fines/fees are not settled with the dealership, while keeping the right to take back the courtesy car by the means stated in point (5), without any liability to the company.",
    ar: "يقر العميل بأن لشركة جياد الحديثة للسيارات الحق في حجز سيارته الموجودة لديها في حال عدم دفع المبالغ المستحقة عليه نتيجة أي أضرار أو أي من الأسباب المذكورة أعلاه، مع احتفاظ الشركة بحق استرداد السيارة البديلة بالطرق الواردة في البند رقم (5) دون أدنى مسؤولية عليها.",
  },
  {
    en: "The customer confirms that the contact details above are accurate and current and shall be used by Jiad Modern Motors Co. for all official correspondence.",
    ar: "يتعهد العميل بأن بياناته المدونة أعلاه صحيحة وهي بمثابة الموطن المختار له لكافة المراسلات التي تصدر من شركة جياد الحديثة للسيارات.",
  },
  {
    en: "Jiad Modern Motors Co. reserves the right to share any information, including vehicle registration and driving licence details, with the Traffic Department, Police Department or relevant government parties.",
    ar: "لشركة جياد الحديثة للسيارات الحق في تزويد الجهات المختصة بالمملكة بأي معلومات عن المفوض بقيادة السيارة إذا لزم الأمر.",
  },
  {
    en: "Smoking is prohibited inside the vehicle. If the vehicle is returned with a smoke smell, the customer pays the interior cleaning fee of SAR 1,500.",
    ar: "يُمنع التدخين داخل السيارة، وفي حال إعادتها وبها رائحة دخان يلتزم العميل بدفع رسوم تنظيفها من الداخل بمبلغ (1,500) ريال سعودي.",
  },
];

/** The driving authorization's statement (Arabic, as on the company form). */
export const AUTHORIZATION_AR =
  "تمنح الشركة بموجب هذه الوثيقة تفويضًا نظاميًا بقيادة المركبة الموضحة بياناتها للمفوض أعلاه داخل حدود المملكة العربية السعودية فقط، وقد أُعطي قائد المركبة صورة من الاستمارة والتأمين مع احتفاظ الشركة بالأصل، ويجب على المفوض الالتزام بالأنظمة المرورية وإعادة المركبة فور انتهاء مدة التفويض.";
export const AUTHORIZATION_EN =
  "By this document the company authorizes the person above to drive the vehicle described above inside the Kingdom of Saudi Arabia only. The driver has received a copy of the registration and insurance; the originals are kept by the company. The driver must follow the traffic laws and return the vehicle as soon as the authorization expires.";

/** The time now, and today's date in Saudi time (YYYY-MM-DD). */
export const nowMs = () => Date.now();
export const todayKsa = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

/** The agreement PDF's file name: "Courtesy car agreement_<customer name>.pdf" (any language; only characters a file name cannot hold are dropped). */
export function agreementFileName(customerName: string | null | undefined): string {
  const name = (customerName ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `Courtesy car agreement_${name || "customer"}.pdf`;
}

/** The Content-Disposition header for it: a plain Latin fallback name, then the full name (Arabic too) for browsers. */
export function agreementDisposition(customerName: string | null | undefined): string {
  const full = agreementFileName(customerName);
  const ascii = full
    .replace(/[^\x20-\x7e]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/_\s*\.pdf$/, ".pdf")
    .replace(/"/g, "");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(full)}`;
}

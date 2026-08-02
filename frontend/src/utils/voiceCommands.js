// ============================================================
// voiceCommands.js
// Parses a spoken sentence into an action and executes it
// against the SAME API endpoints the UI already uses.
// Nothing here creates new MongoDB collections or fields -
// it only calls existing customer / payment / expense /
// dashboard / whatsapp routes.
//
// HOW IT ALL FITS TOGETHER
//  1. normalizeMultilingual() rewrites Urdu/Roman-Urdu/Punjabi
//     words to ONE canonical English trigger word (e.g. "fee",
//     "charges", "package fee", "bakaya" all become "fee" or
//     "dues") so every pattern below only has to check for the
//     canonical word - this is "the dictionary".
//  2. matchCommand() tries a list of exact-ish patterns first
//     (PATTERNS), then - if nothing matched - looseIntentFallback()
//     scans the sentence for keywords in ANY order/position, so a
//     jumbled or ungrammatical sentence still gets understood.
//  3. findCustomer() never requires an exact spelling: it accepts
//     an exact/partial match first, then falls back to a
//     similarity score (Levenshtein distance) so mis-heard or
//     mistyped names still resolve to the right person.
//  4. Anything that changes real data in a way that's hard to
//     undo (adding a customer, deleting one, marking paid/unpaid,
//     changing status, or a bulk WhatsApp blast) is never run
//     immediately - runVoiceCommand() instead returns a
//     confirmation prompt naming the customer and the exact
//     action, and only actually performs it once the person
//     confirms (by voice - "yes"/"no" - or with the on-screen
//     Confirm/Cancel buttons the UI shows for this).
//  5. MESSAGES holds every spoken/toast reply in English, Urdu
//     and Punjabi, so the reply comes back in whichever language
//     is currently selected on the mic button.
// ============================================================

import { setPendingCustomerTarget } from './voiceBus';

// Android Chrome's speech engine occasionally repeats the whole sentence
// back several times in a row (a known engine quirk, not something the
// person actually said) - "open customer open customer open customer".
// That breaks every anchored command pattern below and falls through to a
// hapless "customer not found". If the ENTIRE transcript is just the same
// short phrase tiled back-to-back, collapse it down to one copy before any
// command matching runs. Exported so the UI layer can clean up what it
// displays/speaks too, not just what gets matched.
export function collapseRepeatedSpeech(text) {
  const trimmed = (text || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return trimmed;
  const words = trimmed.split(' ');
  const n = words.length;
  for (let len = 1; len <= Math.floor(n / 2); len++) {
    if (n % len !== 0) continue;
    const phrase = words.slice(0, len).join(' ');
    let tiles = true;
    for (let i = len; i < n; i += len) {
      if (words.slice(i, i + len).join(' ').toLowerCase() !== phrase.toLowerCase()) {
        tiles = false;
        break;
      }
    }
    if (tiles && n / len >= 2) return phrase;
  }
  return trimmed;
}

export const VOICE_LANGUAGES = {
  en: { code: 'en-US', label: 'English' },
  ur: { code: 'ur-PK', label: 'Urdu' },
  pa: { code: 'pa-Guru-IN', label: 'Punjabi' },
};

// ------------------------------------------------------------
// THE DICTIONARY
// Add new words/phrases here and every command that uses that
// slot understands the new word immediately - nothing else
// needs to change.
// ------------------------------------------------------------
const MULTILINGUAL_KEYWORDS = [
  // --- navigation verbs ---
  [/\b(kholo|khol do|کھولو|کھول دو|ਖੋਲ੍ਹੋ)\b/gi, 'open'],
  [/\b(dikhao|دکھاؤ|دکھائیں|ਦਿਖਾਓ)\b/gi, 'show'],

  // --- customer / person words ---
  [/\b(customer|kasto?mar|client|consumer|user|گاہک|کسٹمر|صارف|ਗਾਹਕ)\b/gi, 'customer'],

  // --- fee / bill / amount - every synonym funnels to ONE word: "fee" ---
  [
    /\b(fees?|amounts?|rupees?|rs\.?|charges?|price|prices?|subscription|rent|bills?|monthly fee|monthly bill|monthly charges?|monthly rent|package fee|internet fee|connection fee|بل|فیس|رقم|چارجز|کرایہ|ماہانہ فیس|پیکج فیس|ਬਿੱਲ|ਫੀਸ|ਰਕਮ)\b/gi,
    'fee',
  ],

  // --- dues / balance / outstanding - every synonym funnels to "dues" ---
  [
    /\b(dues?|balance|outstanding|bakaya|baqaya|udhar|remaining amount|due amount|pending amount|واجبات|بقایا|ادھار|بیلنس|باقی رقم|ਬਕਾਇਆ|ਬਾਕੀ)\b/gi,
    'dues',
  ],

  // --- action verbs ---
  [/\b(set karo|mqrr karo|مقرر کرو|لگاؤ|ਸੈੱਟ ਕਰੋ)\b/gi, 'set'],
  [/\b(change karo|badlo|بدلو|تبدیل کرو|ਬਦਲੋ)\b/gi, 'change'],
  [/\b(mark karo|نشان لگاؤ)\b/gi, 'mark'],
  [/\b(add karo|shamil karo|create|register|نیا|شامل کرو|ਸ਼ਾਮਲ ਕਰੋ)\b/gi, 'add'],
  [/\b(delete karo|remove|hatao|nikaal do|ہٹاؤ|نکال دو|حذف کرو|ਹਟਾਓ)\b/gi, 'delete'],
  [/\b(new|naya|نیا)\b/gi, 'new'],
  [/\b(named|kay naam|کے نام سے|نام)\b/gi, 'named'],

  // --- payment status ---
  [/\b(paid|ada|ada shuda|wasool|ادا شدہ|ادا|وصول)\b/gi, 'paid'],
  [/\b(unpaid|na ada|نا ادا|غیر ادا شدہ)\b/gi, 'unpaid'],

  // --- misc fields ---
  [/\b(status|حالت|صورتحال|ਹਾਲਤ)\b/gi, 'status'],
  [/\b(active|فعال|چالو|ਸਰਗਰਮ)\b/gi, 'active'],
  [/\b(cut ?off|بند|منقطع|ਬੰਦ)\b/gi, 'cut off'],
  [/\b(disable[d]?|غیر فعال|ਅਯੋਗ)\b/gi, 'disable'],
  [/\b(phone number|number|mobile|contact number|whatsapp number|نمبر|موبائل|ਨੰਬਰ)\b/gi, 'phone'],
  [/\b(address|pata|پتہ|ایڈریس|ਪਤਾ)\b/gi, 'address'],
  [/\b(connection date|billing date|due date|bill date|din|tareekh|تاریخ|دن|ਤਾਰੀਖ਼|ਦਿਨ)\b/gi, 'day'],
  [/\b(profile|details?|record|info|تفصیلات|پروفائل)\b/gi, 'details'],
  [/\b(package|plan|پیکج|پلان)\b/gi, 'package'],
  [/\b(how much|kitna|کتنا)\b/gi, 'how much'],
  [/\b(owe|owes|bakaya hai|واجب الادا)\b/gi, 'owe'],
  [/\b(reminder|remind|whatsapp|whats app|یاد دہانی|واٹس ایپ)\b/gi, 'whatsapp'],

  // --- pages ---
  [/\b(dashboard|ڈیش بورڈ)\b/gi, 'dashboard'],
  [/\b(payments?|ادائیگی|ادائیگیاں)\b/gi, 'payment'],
  [/\b(expenses?|kharcha|kharche|خرچہ|خرچے|اخراجات|ਖਰਚਾ)\b/gi, 'expense'],
  [/\b(reports?|رپورٹ)\b/gi, 'report'],
  [/\b(settings?|ترتیبات)\b/gi, 'setting'],
  [/\b(help|madad|مدد)\b/gi, 'help'],

  // --- whole-phrase dashboard questions ---
  [/\b(kitne customer|kitne gahak|کتنے کسٹمر|کتنے گاہک)\b/gi, 'how many customers'],
  [/\b(kul aamdani|کل آمدنی)\b/gi, 'total revenue'],
  [/\b(kul baqaya|kul bakaya|کل بقایا)\b/gi, 'total dues'],
  [/\b(kul wasooli|kul vasooli|کل وصولی)\b/gi, 'total recovery'],
  [/\b(kul kharcha|کل اخراجات)\b/gi, 'total expenses'],
  [/\b(khalis munafa|خالص منافع)\b/gi, 'net profit'],

  // --- yes / no (for confirmation prompts) ---
  [/\b(haan|han|ji haan|bilkul|theek hai|ہاں|جی ہاں|بالکل|ٹھیک ہے|ਹਾਂ|ਜੀ)\b/gi, 'yes'],
  [/\b(nahi|nahin|نہیں|نہ|ਨਹੀਂ)\b/gi, 'no'],
];

// Runs before pattern matching so a mixed Urdu/Punjabi/English sentence
// still lines up with the (English-based) command grammar below.
function normalizeMultilingual(text) {
  let out = text;
  for (const [pattern, replacement] of MULTILINGUAL_KEYWORDS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// A real customer can be named things like "Hadi Mobile" or "Ahmed Package"
// where a word inside their own name is ALSO a dictionary trigger word
// ("mobile" -> "phone", "package" -> "package command", etc). Without this
// step, normalizeMultilingual would silently rewrite "Hadi Mobile" into
// "Hadi phone" before any pattern ever sees it, so the customer can never
// be found. This swaps known customer names out for a safe placeholder
// BEFORE normalization runs, then restoreNames() puts the real name back
// into whatever the command parser captured.
function protectKnownNames(text, customerNames) {
  const map = {};
  let out = text;
  const uniqueNames = [...new Set((customerNames || []).filter(Boolean))].sort(
    (a, b) => b.length - a.length
  );
  uniqueNames.forEach((name, i) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    if (re.test(out)) {
      const token = `voiceprotectedname${i}token`;
      map[token] = name;
      out = out.replace(re, token);
    }
  });
  return { text: out, map };
}

function restoreNames(text, map) {
  if (!text || !map || Object.keys(map).length === 0) return text;
  let out = text;
  for (const [token, name] of Object.entries(map)) {
    out = out.replace(new RegExp(token, 'gi'), name);
  }
  return out;
}

const PAGE_MAP = {
  dashboard: '/dashboard',
  customer: '/customers',
  customers: '/customers',
  payment: '/payments',
  payments: '/payments',
  expense: '/expenses',
  expenses: '/expenses',
  report: '/reports',
  reports: '/reports',
  setting: '/settings',
  settings: '/settings',
};

const PAGE_LABELS = {
  en: { dashboard: 'dashboard', customer: 'customers', payment: 'payments', expense: 'expenses', report: 'reports', setting: 'settings' },
  ur: { dashboard: 'ڈیش بورڈ', customer: 'کسٹمرز', payment: 'ادائیگیاں', expense: 'اخراجات', report: 'رپورٹس', setting: 'ترتیبات' },
  pa: { dashboard: 'ਡੈਸ਼ਬੋਰਡ', customer: 'ਗਾਹਕ', payment: 'ਭੁਗਤਾਨ', expense: 'ਖਰਚੇ', report: 'ਰਿਪੋਰਟਾਂ', setting: 'ਸੈਟਿੰਗਾਂ' },
};

const STATUS_LABELS = {
  en: { Active: 'Active', 'Cut Off': 'Cut Off', Disable: 'Disable', Paid: 'Paid', Unpaid: 'Unpaid', '1 YEAR ADVANCED': '1 Year Advanced', FREE: 'Free' },
  ur: { Active: 'فعال', 'Cut Off': 'بند', Disable: 'غیر فعال', Paid: 'ادا شدہ', Unpaid: 'غیر ادا شدہ', '1 YEAR ADVANCED': 'ایک سال ایڈوانس', FREE: 'مفت' },
  pa: { Active: 'ਸਰਗਰਮ', 'Cut Off': 'ਬੰਦ', Disable: 'ਅਯੋਗ', Paid: 'ਅਦਾ ਕੀਤਾ', Unpaid: 'ਅਦਾ ਨਹੀਂ ਕੀਤਾ', '1 YEAR ADVANCED': 'ਇੱਕ ਸਾਲ ਐਡਵਾਂਸ', FREE: 'ਮੁਫ਼ਤ' },
};

const STAT_LABELS = {
  totalCustomers: { en: 'total number of customers', ur: 'کل کسٹمرز کی تعداد', pa: 'ਕੁੱਲ ਗਾਹਕਾਂ ਦੀ ਗਿਣਤੀ', money: false },
  active: { en: 'active customers', ur: 'فعال کسٹمرز', pa: 'ਸਰਗਰਮ ਗਾਹਕ', money: false },
  cutOff: { en: 'cut off customers', ur: 'بند کسٹمرز', pa: 'ਬੰਦ ਗਾਹਕ', money: false },
  disable: { en: 'disabled customers', ur: 'غیر فعال کسٹمرز', pa: 'ਅਯੋਗ ਗਾਹਕ', money: false },
  unpaid: { en: 'unpaid customers', ur: 'غیر ادا شدہ کسٹمرز', pa: 'ਅਦਾ ਨਾ ਕੀਤੇ ਗਾਹਕ', money: false },
  paid: { en: 'customers marked as paid', ur: 'ادا شدہ کسٹمرز', pa: 'ਅਦਾ ਕੀਤੇ ਗਾਹਕ', money: false },
  totalRevenue: { en: 'total monthly revenue', ur: 'کل ماہانہ آمدنی', pa: 'ਕੁੱਲ ਮਹੀਨਾਵਾਰ ਆਮਦਨ', money: true },
  totalDues: { en: 'total pending dues', ur: 'کل بقایا رقم', pa: 'ਕੁੱਲ ਬਕਾਇਆ', money: true },
  totalRecovery: { en: 'total recovery amount', ur: 'کل وصولی رقم', pa: 'ਕੁੱਲ ਵਸੂਲੀ ਰਕਮ', money: true },
  totalExpenses: { en: 'total expenses', ur: 'کل اخراجات', pa: 'ਕੁੱਲ ਖਰਚੇ', money: true },
  netProfit: { en: 'net profit', ur: 'خالص منافع', pa: 'ਸ਼ੁੱਧ ਮੁਨਾਫ਼ਾ', money: true },
  collected: { en: 'amount collected', ur: 'وصول شدہ رقم', pa: 'ਵਸੂਲ ਕੀਤੀ ਰਕਮ', money: true },
  pendingCollection: { en: 'pending collection', ur: 'باقی وصولی', pa: 'ਬਾਕੀ ਵਸੂਲੀ', money: true },
};

const EXPENSE_CATEGORY_HINTS = [
  [/salary|salaries|staff|wages|تنخواہ/i, 'Salaries'],
  [/internet|bandwidth|fiber|انٹرنیٹ/i, 'Internet'],
  [/electric|utility|utilities|bijli|بجلی/i, 'Utilities'],
  [/router|equipment|cable|hardware|آلات/i, 'Equipment'],
  [/repair|maintenance|مرمت/i, 'Maintenance'],
  [/ad|marketing|promotion|اشتہار/i, 'Marketing'],
  [/rent|office|دفتر|کرایہ/i, 'Office'],
];
function guessExpenseCategory(title) {
  const hit = EXPENSE_CATEGORY_HINTS.find(([re]) => re.test(title));
  return hit ? hit[1] : 'Other';
}

// ------------------------------------------------------------
// Reply templates - one function/string per key, per language.
// t() falls back to English if a translation is ever missing.
// ------------------------------------------------------------
const MESSAGES = {
  en: {
    notUnderstood: (tr) => `Sorry, I didn't understand: "${tr}". Say "help" to hear what I can do.`,
    help:
      'Try things like: "open customers", "show John" (opens his profile), "set John\'s fee to fifteen hundred", ' +
      '"mark John as paid", "John paid 1500", "set John\'s status to cut off", "how much does John owe", ' +
      '"add customer John with fee 1500", "add expense of 500 for diesel", "delete customer John", ' +
      '"send John a WhatsApp reminder", or "what is my total revenue". Anything that changes or removes a ' +
      'customer will ask you to confirm first.',
    openingPage: (p) => `Opening ${p}.`,
    unknownPage: (p) => `I don't know a page called ${p}.`,
    customerNotFound: (n) => `I couldn't find a customer matching ${n}.`,
    openingProfile: (n) => `Opening ${n}'s profile.`,
    openingProfileWithInfo: (n, fee, dues, status) =>
      `Opening ${n}'s profile - fee ${fee}, pending dues ${dues}, status ${status}.`,
    feeLine: (n, fee) => `${n}'s monthly fee is ${fee}.`,
    packageLine: (n, pkg) => `${n}'s package is ${pkg}.`,
    phoneLine: (n, phone) => `${n}'s phone number is ${phone}.`,
    addressLine: (n, address) => `${n}'s address is ${address}.`,
    statusLine: (n, status) => `${n}'s status is ${status}.`,
    paymentStatusLine: (n, pay) => `${n}'s payment status is ${pay}.`,
    noPhone: (n) => `${n} doesn't have a phone number on file.`,
    noAddress: (n) => `${n} doesn't have an address on file.`,
    noPackage: (n) => `${n} doesn't have a package set.`,
    owes: (n, amt) => `${n} owes ${amt}.`,
    askNameFee: 'Sure - what is the customer\'s name and monthly fee? For example: "add customer Ahmed with fee 1500".',
    missedName: 'I got the fee but missed the name. Try: "add customer Ahmed with fee 1500".',
    askFee: (n) => `Got the name ${n} - now what's the monthly fee? Try: "add customer ${n} with fee 1500".`,
    addedCustomer: (n, fee) => `Add new customer ${n} with a monthly fee of ${fee}? Say "yes" to confirm or "no" to cancel.`,
    missedAmount: (n) => `I didn't catch the amount for ${n}.`,
    updatedBill: (n, before, after) => `Updated ${n}'s fee from ${before} to ${after}.`,
    setDues: (n, amt) => `Set ${n}'s pending dues to ${amt}.`,
    addedDues: (amt, n, total) => `Added ${amt} to ${n}'s dues. New balance is ${total}.`,
    unknownStatus: (s) => `I don't recognize the status ${s}.`,
    statusUpdated: (n, s) => `${n}'s status is now ${s}.`,
    markedPaid: (n) => `Marked ${n} as paid and cleared their dues.`,
    markedUnpaid: (n) => `Marked ${n} as unpaid.`,
    deletedCustomer: (n) => `Customer ${n} has been permanently deleted.`,
    addedExpense: (amt, title, cat) => `Added an expense of ${amt} for ${title} (category: ${cat}).`,
    expenseMissingAmount: 'I didn\'t catch the expense amount. Try: "add expense of 500 for diesel".',
    expenseMissingTitle: 'What is the expense for? Try: "add expense of 500 for diesel".',
    recordedPayment: (amt, n, dues) => `Recorded a payment of ${amt} from ${n}. Remaining dues: ${dues}.`,
    packageUpdated: (n, pkg) => `${n}'s package is now ${pkg}.`,
    phoneUpdated: (n) => `${n}'s phone number has been updated.`,
    addressUpdated: (n) => `${n}'s address has been updated.`,
    dayUpdated: (n, d) => `${n}'s billing day is now day ${d}.`,
    missedDay: (n) => `I didn't catch a valid day (1-31) for ${n}.`,
    statLine: (label, value) => `Your ${label} is ${value}.`,
    genericError: 'Something went wrong running that command.',
    noPhoneOnFile: (n) => `${n} doesn't have a phone number saved, so I can't send a WhatsApp reminder.`,
    whatsappSent: (n) => `Opening a WhatsApp reminder for ${n}.`,
    noUnpaidWithPhone: 'There are no unpaid customers with a phone number saved.',
    bulkWhatsappSent: (n) => `Opened WhatsApp reminders for ${n} customers.`,
    confirmDeleteCustomer: (n) =>
      `Are you sure you want to permanently delete ${n}? This can't be undone. Say "yes" to confirm or "no" to cancel.`,
    confirmMarkPaid: (n) =>
      `Mark ${n} as paid and clear their dues? Say "yes" to confirm or "no" to cancel.`,
    confirmMarkUnpaid: (n) =>
      `Mark ${n} as unpaid? Say "yes" to confirm or "no" to cancel.`,
    confirmSetStatus: (n, status) =>
      `Change ${n}'s status to ${status}? Say "yes" to confirm or "no" to cancel.`,
    confirmBulkWhatsapp: (count) =>
      `Send WhatsApp reminders to ${count} unpaid customers? Say "yes" to confirm or "no" to cancel.`,
    cancelled: 'Okay, cancelled - no changes were made.',
    nothingToConfirm: 'There\'s nothing waiting for confirmation right now.',
  },
  ur: {
    notUnderstood: (tr) => `معاف کیجیے، میں سمجھ نہیں سکا: "${tr}"۔ مدد کے لیے "مدد" کہیں۔`,
    help:
      'کوشش کریں: "کسٹمرز کھولو"، "احمد دکھاؤ" (اس کی پروفائل کھلے گی)، "احمد کی فیس پندرہ سو کرو"، ' +
      '"احمد کو ادا شدہ کریں"، "احمد نے پندرہ سو ادا کیے"، "احمد کا سٹیٹس کٹ آف کرو"، "احمد پر کتنے بقایا ہیں"، ' +
      '"کسٹمر احمد فیس پندرہ سو کے ساتھ شامل کرو"، "پانچ سو کا خرچہ ڈیزل کے لیے شامل کرو"، "کسٹمر احمد حذف کرو"، ' +
      '"احمد کو واٹس ایپ یاد دہانی بھیجو"، یا "میری کل آمدنی کتنی ہے"۔ کسٹمر شامل کرنے، ہٹانے، یا سٹیٹس بدلنے ' +
      'سے پہلے میں آپ سے تصدیق مانگوں گا۔',
    openingPage: (p) => `${p} کھول رہا ہوں۔`,
    unknownPage: (p) => `مجھے ${p} نامی کوئی صفحہ نہیں ملا۔`,
    customerNotFound: (n) => `مجھے ${n} سے ملتا جلتا کوئی کسٹمر نہیں ملا۔`,
    openingProfile: (n) => `${n} کی پروفائل کھول رہا ہوں۔`,
    openingProfileWithInfo: (n, fee, dues, status) =>
      `${n} کی پروفائل کھول رہا ہوں - فیس ${fee}، بقایا ${dues}، حالت ${status}۔`,
    feeLine: (n, fee) => `${n} کی ماہانہ فیس ${fee} ہے۔`,
    packageLine: (n, pkg) => `${n} کا پیکج ${pkg} ہے۔`,
    phoneLine: (n, phone) => `${n} کا فون نمبر ${phone} ہے۔`,
    addressLine: (n, address) => `${n} کا پتہ ${address} ہے۔`,
    statusLine: (n, status) => `${n} کی حالت ${status} ہے۔`,
    paymentStatusLine: (n, pay) => `${n} کی ادائیگی کی حالت ${pay} ہے۔`,
    noPhone: (n) => `${n} کا کوئی فون نمبر درج نہیں ہے۔`,
    noAddress: (n) => `${n} کا کوئی پتہ درج نہیں ہے۔`,
    noPackage: (n) => `${n} کا کوئی پیکج مقرر نہیں ہے۔`,
    owes: (n, amt) => `${n} پر ${amt} بقایا ہیں۔`,
    askNameFee: 'ٹھیک ہے - کسٹمر کا نام اور ماہانہ فیس بتائیں۔ مثلاً: "کسٹمر احمد فیس پندرہ سو شامل کرو"۔',
    missedName: 'فیس مل گئی مگر نام نہیں ملا۔ کوشش کریں: "کسٹمر احمد فیس پندرہ سو شامل کرو"۔',
    askFee: (n) => `${n} کا نام مل گیا - ماہانہ فیس کیا ہے؟ کوشش کریں: "کسٹمر ${n} فیس پندرہ سو شامل کرو"۔`,
    addedCustomer: (n, fee) => `نیا کسٹمر ${n} ماہانہ فیس ${fee} کے ساتھ شامل کریں؟ تصدیق کے لیے "ہاں" یا منسوخ کے لیے "نہیں" کہیں۔`,
    missedAmount: (n) => `${n} کے لیے رقم سمجھ نہیں آئی۔`,
    updatedBill: (n, before, after) => `${n} کی فیس ${before} سے ${after} کر دی گئی۔`,
    setDues: (n, amt) => `${n} کے بقایا ${amt} مقرر کر دیے۔`,
    addedDues: (amt, n, total) => `${n} کے بقایا میں ${amt} شامل کیا۔ نیا بیلنس ${total} ہے۔`,
    unknownStatus: (s) => `مجھے سٹیٹس ${s} سمجھ نہیں آیا۔`,
    statusUpdated: (n, s) => `${n} کا سٹیٹس اب ${s} ہے۔`,
    markedPaid: (n) => `${n} کو ادا شدہ کر دیا اور بقایا ختم کر دیا۔`,
    markedUnpaid: (n) => `${n} کو غیر ادا شدہ کر دیا۔`,
    deletedCustomer: (n) => `کسٹمر ${n} کو ہمیشہ کے لیے حذف کر دیا گیا۔`,
    addedExpense: (amt, title, cat) => `${amt} کا خرچہ "${title}" کے لیے شامل کر دیا (زمرہ: ${cat})۔`,
    expenseMissingAmount: 'خرچے کی رقم سمجھ نہیں آئی۔ کوشش کریں: "پانچ سو کا خرچہ ڈیزل کے لیے شامل کرو"۔',
    expenseMissingTitle: 'خرچہ کس چیز کے لیے ہے؟ کوشش کریں: "پانچ سو کا خرچہ ڈیزل کے لیے شامل کرو"۔',
    recordedPayment: (amt, n, dues) => `${n} سے ${amt} کی ادائیگی موصول ہو گئی۔ باقی بقایا ${dues} ہے۔`,
    packageUpdated: (n, pkg) => `${n} کا پیکج اب ${pkg} ہے۔`,
    phoneUpdated: (n) => `${n} کا فون نمبر اپڈیٹ کر دیا گیا۔`,
    addressUpdated: (n) => `${n} کا پتہ اپڈیٹ کر دیا گیا۔`,
    dayUpdated: (n, d) => `${n} کی بلنگ تاریخ اب دن ${d} ہے۔`,
    missedDay: (n) => `${n} کے لیے درست دن (1-31) سمجھ نہیں آیا۔`,
    statLine: (label, value) => `آپ کا ${label} ${value} ہے۔`,
    genericError: 'کچھ غلط ہو گیا، دوبارہ کوشش کریں۔',
    noPhoneOnFile: (n) => `${n} کا فون نمبر محفوظ نہیں ہے، اس لیے واٹس ایپ یاد دہانی نہیں بھیج سکتا۔`,
    whatsappSent: (n) => `${n} کے لیے واٹس ایپ یاد دہانی کھول رہا ہوں۔`,
    noUnpaidWithPhone: 'کوئی غیر ادا شدہ کسٹمر فون نمبر کے ساتھ موجود نہیں ہے۔',
    bulkWhatsappSent: (n) => `${n} کسٹمرز کے لیے واٹس ایپ یاد دہانی کھول دی گئی۔`,
    confirmDeleteCustomer: (n) => `کیا آپ واقعی ${n} کو ہمیشہ کے لیے حذف کرنا چاہتے ہیں؟ یہ واپس نہیں ہو سکتا۔ "ہاں" یا "نہیں" کہیں۔`,
    confirmMarkPaid: (n) => `${n} کو ادا شدہ کریں اور بقایا صاف کریں؟ "ہاں" یا "نہیں" کہیں۔`,
    confirmMarkUnpaid: (n) => `${n} کو غیر ادا شدہ کریں؟ "ہاں" یا "نہیں" کہیں۔`,
    confirmSetStatus: (n, status) => `${n} کی حالت ${status} کریں؟ "ہاں" یا "نہیں" کہیں۔`,
    confirmBulkWhatsapp: (count) => `${count} غیر ادا شدہ کسٹمرز کو واٹس ایپ یاد دہانی بھیجیں؟ "ہاں" یا "نہیں" کہیں۔`,
    cancelled: 'ٹھیک ہے، منسوخ کر دیا - کوئی تبدیلی نہیں ہوئی۔',
    nothingToConfirm: 'ابھی تصدیق کے لیے کچھ نہیں ہے۔',
  },
  pa: {
    notUnderstood: (tr) => `ਮੁਆਫ਼ ਕਰਨਾ, ਮੈਨੂੰ ਸਮਝ ਨਹੀਂ ਆਇਆ: "${tr}"। ਮਦਦ ਲਈ "ਮਦਦ" ਕਹੋ।`,
    help:
      'ਕੋਸ਼ਿਸ਼ ਕਰੋ: "ਗਾਹਕ ਖੋਲ੍ਹੋ", "ਜੌਨ ਦਿਖਾਓ" (ਪ੍ਰੋਫਾਈਲ ਖੁੱਲ੍ਹੇਗੀ), "ਜੌਨ ਦੀ ਫੀਸ ਪੰਦਰਾਂ ਸੌ ਕਰੋ", "ਜੌਨ ਨੂੰ ਅਦਾ ਕੀਤਾ ਕਰੋ", ' +
      '"ਜੌਨ ਦਾ ਸਟੇਟਸ ਕੱਟ ਆਫ ਕਰੋ", "ਜੌਨ ਤੇ ਕਿੰਨਾ ਬਕਾਇਆ ਹੈ", "ਨਵਾਂ ਗਾਹਕ ਜੌਨ ਫੀਸ ਪੰਦਰਾਂ ਸੌ ਨਾਲ ਸ਼ਾਮਲ ਕਰੋ", ' +
      'ਜਾਂ "ਮੇਰੀ ਕੁੱਲ ਆਮਦਨ ਕਿੰਨੀ ਹੈ"। ਗਾਹਕ ਸ਼ਾਮਲ ਕਰਨ, ਹਟਾਉਣ ਜਾਂ ਸਟੇਟਸ ਬਦਲਣ ਤੋਂ ਪਹਿਲਾਂ ਮੈਂ ਤੁਹਾਡੇ ਤੋਂ ਪੁਸ਼ਟੀ ਮੰਗਾਂਗਾ।',
    openingPage: (p) => `${p} ਖੋਲ੍ਹ ਰਿਹਾ ਹਾਂ।`,
    unknownPage: (p) => `ਮੈਨੂੰ ${p} ਨਾਮ ਦਾ ਕੋਈ ਪੰਨਾ ਨਹੀਂ ਮਿਲਿਆ।`,
    customerNotFound: (n) => `ਮੈਨੂੰ ${n} ਨਾਲ ਮਿਲਦਾ ਕੋਈ ਗਾਹਕ ਨਹੀਂ ਮਿਲਿਆ।`,
    openingProfile: (n) => `${n} ਦੀ ਪ੍ਰੋਫਾਈਲ ਖੋਲ੍ਹ ਰਿਹਾ ਹਾਂ।`,
    openingProfileWithInfo: (n, fee, dues, status) =>
      `${n} ਦੀ ਪ੍ਰੋਫਾਈਲ ਖੋਲ੍ਹ ਰਿਹਾ ਹਾਂ - ਫੀਸ ${fee}, ਬਕਾਇਆ ${dues}, ਹਾਲਤ ${status}।`,
    feeLine: (n, fee) => `${n} ਦੀ ਮਹੀਨਾਵਾਰ ਫੀਸ ${fee} ਹੈ।`,
    packageLine: (n, pkg) => `${n} ਦਾ ਪੈਕੇਜ ${pkg} ਹੈ।`,
    phoneLine: (n, phone) => `${n} ਦਾ ਫੋਨ ਨੰਬਰ ${phone} ਹੈ।`,
    addressLine: (n, address) => `${n} ਦਾ ਪਤਾ ${address} ਹੈ।`,
    statusLine: (n, status) => `${n} ਦੀ ਹਾਲਤ ${status} ਹੈ।`,
    paymentStatusLine: (n, pay) => `${n} ਦੀ ਭੁਗਤਾਨ ਹਾਲਤ ${pay} ਹੈ।`,
    noPhone: (n) => `${n} ਦਾ ਕੋਈ ਫੋਨ ਨੰਬਰ ਦਰਜ ਨਹੀਂ ਹੈ।`,
    noAddress: (n) => `${n} ਦਾ ਕੋਈ ਪਤਾ ਦਰਜ ਨਹੀਂ ਹੈ।`,
    noPackage: (n) => `${n} ਦਾ ਕੋਈ ਪੈਕੇਜ ਸੈੱਟ ਨਹੀਂ ਹੈ।`,
    owes: (n, amt) => `${n} ਤੇ ${amt} ਬਕਾਇਆ ਹੈ।`,
    askNameFee: 'ਠੀਕ ਹੈ - ਗਾਹਕ ਦਾ ਨਾਮ ਅਤੇ ਮਹੀਨਾਵਾਰ ਫੀਸ ਦੱਸੋ।',
    missedName: 'ਫੀਸ ਮਿਲ ਗਈ ਪਰ ਨਾਮ ਨਹੀਂ ਮਿਲਿਆ।',
    askFee: (n) => `${n} ਦਾ ਨਾਮ ਮਿਲ ਗਿਆ - ਮਹੀਨਾਵਾਰ ਫੀਸ ਕੀ ਹੈ?`,
    addedCustomer: (n, fee) => `ਨਵਾਂ ਗਾਹਕ ${n} ਮਹੀਨਾਵਾਰ ਫੀਸ ${fee} ਨਾਲ ਸ਼ਾਮਲ ਕਰੀਏ? "ਹਾਂ" ਜਾਂ "ਨਹੀਂ" ਕਹੋ।`,
    missedAmount: (n) => `${n} ਲਈ ਰਕਮ ਸਮਝ ਨਹੀਂ ਆਈ।`,
    updatedBill: (n, before, after) => `${n} ਦੀ ਫੀਸ ${before} ਤੋਂ ${after} ਕਰ ਦਿੱਤੀ।`,
    setDues: (n, amt) => `${n} ਦਾ ਬਕਾਇਆ ${amt} ਸੈੱਟ ਕਰ ਦਿੱਤਾ।`,
    addedDues: (amt, n, total) => `${n} ਦੇ ਬਕਾਏ ਵਿੱਚ ${amt} ਜੋੜਿਆ। ਨਵਾਂ ਬਕਾਇਆ ${total} ਹੈ।`,
    unknownStatus: (s) => `ਮੈਨੂੰ ਸਟੇਟਸ ${s} ਸਮਝ ਨਹੀਂ ਆਇਆ।`,
    statusUpdated: (n, s) => `${n} ਦਾ ਸਟੇਟਸ ਹੁਣ ${s} ਹੈ।`,
    markedPaid: (n) => `${n} ਨੂੰ ਅਦਾ ਕੀਤਾ ਮਾਰਕ ਕੀਤਾ ਅਤੇ ਬਕਾਇਆ ਸਾਫ਼ ਕੀਤਾ।`,
    markedUnpaid: (n) => `${n} ਨੂੰ ਅਦਾ ਨਾ ਕੀਤਾ ਮਾਰਕ ਕੀਤਾ।`,
    deletedCustomer: (n) => `ਗਾਹਕ ${n} ਨੂੰ ਹਮੇਸ਼ਾ ਲਈ ਹਟਾ ਦਿੱਤਾ ਗਿਆ।`,
    addedExpense: (amt, title, cat) => `${title} ਲਈ ${amt} ਦਾ ਖਰਚਾ ਸ਼ਾਮਲ ਕੀਤਾ (ਸ਼੍ਰੇਣੀ: ${cat})।`,
    expenseMissingAmount: 'ਖਰਚੇ ਦੀ ਰਕਮ ਸਮਝ ਨਹੀਂ ਆਈ।',
    expenseMissingTitle: 'ਖਰਚਾ ਕਿਸ ਲਈ ਹੈ?',
    recordedPayment: (amt, n, dues) => `${n} ਤੋਂ ${amt} ਦਾ ਭੁਗਤਾਨ ਮਿਲਿਆ। ਬਾਕੀ ਬਕਾਇਆ ${dues} ਹੈ।`,
    packageUpdated: (n, pkg) => `${n} ਦਾ ਪੈਕੇਜ ਹੁਣ ${pkg} ਹੈ।`,
    phoneUpdated: (n) => `${n} ਦਾ ਫੋਨ ਨੰਬਰ ਅੱਪਡੇਟ ਕਰ ਦਿੱਤਾ।`,
    addressUpdated: (n) => `${n} ਦਾ ਪਤਾ ਅੱਪਡੇਟ ਕਰ ਦਿੱਤਾ।`,
    dayUpdated: (n, d) => `${n} ਦਾ ਬਿਲਿੰਗ ਦਿਨ ਹੁਣ ${d} ਹੈ।`,
    missedDay: (n) => `${n} ਲਈ ਸਹੀ ਦਿਨ (1-31) ਸਮਝ ਨਹੀਂ ਆਇਆ।`,
    statLine: (label, value) => `ਤੁਹਾਡਾ ${label} ${value} ਹੈ।`,
    genericError: 'ਕੁਝ ਗਲਤ ਹੋ ਗਿਆ, ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
    noPhoneOnFile: (n) => `${n} ਦਾ ਫੋਨ ਨੰਬਰ ਸੇਵ ਨਹੀਂ ਹੈ, ਇਸ ਲਈ ਵਟਸਐਪ ਰਿਮਾਈਂਡਰ ਨਹੀਂ ਭੇਜ ਸਕਦਾ।`,
    whatsappSent: (n) => `${n} ਲਈ ਵਟਸਐਪ ਰਿਮਾਈਂਡਰ ਖੋਲ੍ਹ ਰਿਹਾ ਹਾਂ।`,
    noUnpaidWithPhone: 'ਕੋਈ ਅਦਾ ਨਾ ਕੀਤਾ ਗਾਹਕ ਫੋਨ ਨੰਬਰ ਨਾਲ ਮੌਜੂਦ ਨਹੀਂ ਹੈ।',
    bulkWhatsappSent: (n) => `${n} ਗਾਹਕਾਂ ਲਈ ਵਟਸਐਪ ਰਿਮਾਈਂਡਰ ਖੋਲ੍ਹ ਦਿੱਤੇ ਗਏ।`,
    confirmDeleteCustomer: (n) => `ਕੀ ਤੁਸੀਂ ਸੱਚਮੁੱਚ ${n} ਨੂੰ ਹਮੇਸ਼ਾ ਲਈ ਹਟਾਉਣਾ ਚਾਹੁੰਦੇ ਹੋ? "ਹਾਂ" ਜਾਂ "ਨਹੀਂ" ਕਹੋ।`,
    confirmMarkPaid: (n) => `${n} ਨੂੰ ਅਦਾ ਕੀਤਾ ਮਾਰਕ ਕਰੀਏ ਅਤੇ ਬਕਾਇਆ ਸਾਫ਼ ਕਰੀਏ? "ਹਾਂ" ਜਾਂ "ਨਹੀਂ" ਕਹੋ।`,
    confirmMarkUnpaid: (n) => `${n} ਨੂੰ ਅਦਾ ਨਾ ਕੀਤਾ ਮਾਰਕ ਕਰੀਏ? "ਹਾਂ" ਜਾਂ "ਨਹੀਂ" ਕਹੋ।`,
    confirmSetStatus: (n, status) => `${n} ਦੀ ਹਾਲਤ ${status} ਕਰੀਏ? "ਹਾਂ" ਜਾਂ "ਨਹੀਂ" ਕਹੋ।`,
    confirmBulkWhatsapp: (count) => `${count} ਅਦਾ ਨਾ ਕੀਤੇ ਗਾਹਕਾਂ ਨੂੰ ਵਟਸਐਪ ਰਿਮਾਈਂਡਰ ਭੇਜੀਏ? "ਹਾਂ" ਜਾਂ "ਨਹੀਂ" ਕਹੋ।`,
    cancelled: 'ਠੀਕ ਹੈ, ਰੱਦ ਕਰ ਦਿੱਤਾ - ਕੋਈ ਬਦਲਾਅ ਨਹੀਂ ਹੋਇਆ।',
    nothingToConfirm: 'ਹੁਣ ਪੁਸ਼ਟੀ ਲਈ ਕੁਝ ਨਹੀਂ ਹੈ।',
  },
};

function t(lang, key, ...args) {
  const dict = MESSAGES[lang] || MESSAGES.en;
  const entry = dict[key] ?? MESSAGES.en[key];
  return typeof entry === 'function' ? entry(...args) : entry;
}

const SMALL_NUMBERS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};
const SCALE_NUMBERS = { hundred: 100, thousand: 1000, lakh: 100000, million: 1000000 };

function wordsToNumber(text) {
  const digitMatch = text.replace(/,/g, '').match(/\d+(\.\d+)?/);
  if (digitMatch) return parseFloat(digitMatch[0]);

  const tokens = text.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let found = false;

  for (const token of tokens) {
    if (token in SMALL_NUMBERS) {
      current += SMALL_NUMBERS[token];
      found = true;
    } else if (token in SCALE_NUMBERS) {
      current = (current || 1) * SCALE_NUMBERS[token];
      if (SCALE_NUMBERS[token] >= 1000) {
        total += current;
        current = 0;
      }
      found = true;
    } else if (token === 'and') {
      // skip filler
    }
  }
  return found ? total + current : null;
}

// ------------------------------------------------------------
// Flexible expense parsing.
// Instead of requiring one exact sentence shape ("add expense
// of X for Y"), this pulls the amount (digits OR spoken number
// words, wherever they sit in the sentence) and treats whatever
// text is left over - once filler/command words are stripped -
// as the title. That means "add expense 500 diesel", "expense
// of five hundred for diesel", "diesel expense 500 rupees" all
// resolve to the same { amount: 500, title: "diesel" }.
// ------------------------------------------------------------
function extractExpenseDetails(normalizedText) {
  let working = normalizedText
    .replace(/\b(please|can you|could you|i want to|i want you to|kindly|record|log|create|new)\b/gi, ' ')
    .replace(/\badds?\b/gi, ' ')
    .replace(/\bexpense[s]?\b/gi, ' ')
    .replace(/\b(of|for|on|worth|amount|rs\.?|rupees?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let amount = null;

  const digitMatch = working.match(/\d[\d,]*(\.\d+)?/);
  if (digitMatch) {
    amount = parseFloat(digitMatch[0].replace(/,/g, ''));
    working = (working.slice(0, digitMatch.index) + ' ' + working.slice(digitMatch.index + digitMatch[0].length))
      .replace(/\s+/g, ' ')
      .trim();
  } else {
    // No digits - look for a contiguous run of spoken number words
    // ANYWHERE in the sentence (not just at the start/end), since
    // people put the amount before or after the item interchangeably.
    const tokens = working.split(/\s+/).filter(Boolean);
    let start = -1;
    let end = -1;
    for (let i = 0; i < tokens.length; i++) {
      const lc = tokens[i].toLowerCase();
      if (lc in SMALL_NUMBERS || lc in SCALE_NUMBERS) {
        if (start === -1) start = i;
        end = i;
      } else if (start !== -1) {
        break;
      }
    }
    if (start !== -1) {
      amount = wordsToNumber(tokens.slice(start, end + 1).join(' '));
      tokens.splice(start, end - start + 1);
      working = tokens.join(' ').trim();
    }
  }

  const title = working.replace(/^(a|an|the)\s+/i, '').trim();
  return { amount, title };
}

function cleanName(raw) {
  let name = (raw || '').replace(/'s$/i, '').trim();
  const fillerRe = /^(customer|the|for|mr|mrs|ms|names?|named|called)\s+/i;
  let previous;
  do {
    previous = name;
    name = name.replace(fillerRe, '').trim();
  } while (name !== previous);
  return name;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

const NAME_MATCH_THRESHOLD = 0.72;

function findCustomer(customers, rawName) {
  const name = cleanName(rawName || '').toLowerCase();
  if (!name) return null;

  const exact =
    customers.find((c) => c.name?.toLowerCase() === name) ||
    customers.find((c) => c.name?.toLowerCase().startsWith(name)) ||
    customers.find((c) => c.name?.toLowerCase().includes(name)) ||
    customers.find((c) => c.customerId?.toLowerCase() === name);
  if (exact) return exact;

  const nameWords = name.split(/\s+/).filter(Boolean);
  let best = null;
  let bestScore = 0;
  for (const c of customers) {
    if (!c.name) continue;
    const fullName = c.name.toLowerCase();
    const fullWords = fullName.split(/\s+/).filter(Boolean);

    let score = similarity(name, fullName);
    for (const nw of nameWords) {
      for (const fw of fullWords) {
        score = Math.max(score, similarity(nw, fw));
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return bestScore >= NAME_MATCH_THRESHOLD ? best : null;
}

function money(n) {
  return `Rs ${Number(n || 0).toLocaleString()}`;
}

const AFFIRMATIVE_RE = /^(yes|yeah|yep|yup|ya|confirm(ed)?|ok(ay)?|sure|do it|go ahead|correct|right|haan|han|ji( haan)?|g|theek\s*hai|bilkul|ہاں|جی( ہاں)?|بالکل|ٹھیک ہے|ਹਾਂ|ਜੀ)\b/i;
const NEGATIVE_RE = /^(no|nope|nah|never ?mind|cancel|don'?t|stop|nahi|nahin|na|نہیں|نہ|ਨਹੀਂ)\b/i;

function isAffirmative(text) {
  return AFFIRMATIVE_RE.test((text || '').trim());
}
function isNegative(text) {
  return NEGATIVE_RE.test((text || '').trim());
}

const FILLER_PREFIX = "(?:please\\s+)?(?:can you\\s+|could you\\s+|i want to\\s+|i want you to\\s+)?";
const LOOKUP_PREFIX = FILLER_PREFIX + "(?:show(?:\\s+me)?|what(?:'s| is)|tell me|find out|check)?\\s*";

const PATTERNS = [
  { key: 'navigate', regex: /^(?:go to|opens?|shows?(?:\s+me)?|navigate to|pulls?\s+up)\s+(dashboard|customer|payment|expense|report|setting)(?:s|es)?\s*$/i },

  { key: 'help', regex: /^(help|what can you do|what can i say|commands)/i },

  { key: 'bulkWhatsapp', regex: /(?:send|blast)\s+(?:a\s+)?whatsapp(?:\s+reminders?)?\s+to\s+(?:all\s+)?unpaid(?:\s+customers?)?/i },
  { key: 'bulkWhatsapp', regex: /send\s+(?:bulk\s+)?(?:whatsapp\s+)?reminders?\s+to\s+(?:all\s+)?(?:unpaid\s+)?customers?/i },
  { key: 'sendWhatsapp', regex: /(?:send|give)\s+(.+?)\s+(?:a\s+)?whatsapp(?:\s+reminder)?/i },
  { key: 'sendWhatsapp', regex: /(?:send|give)\s+(?:a\s+)?whatsapp(?:\s+reminder)?\s+to\s+(.+)/i },
  { key: 'sendWhatsapp', regex: /remind\s+(.+?)\s+(?:about|of)?\s*(?:his|her|their)?\s*(?:dues|bill|fee)?\s*$/i },

  { key: 'addExpense', regex: /adds?\s+(?:an?\s+)?expense(?:s|es)?\s+(?:of\s+)?(.+?)\s+for\s+(.+)/i, order: ['value', 'name'] },
  { key: 'recordPayment', regex: /(?:records?|logs?)?\s*(?:a\s+)?payments?\s+of\s+(.+?)\s+(?:from|for)\s+(.+)/i, order: ['value', 'name'] },
  { key: 'recordPayment', regex: /^(.+?)\s+paid\s+(fee\s+)?(\d[\d,]*|(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thir(?:teen|ty)|four(?:teen|ty)|fif(?:teen|ty)|six(?:teen|ty)|seven(?:teen|ty)|eigh(?:teen|ty)|nine(?:teen|ty)|twenty|hundred|thousand|lakh|million)(?:\s+\w+)*)\s*$/i, order: ['name', 'skip', 'value'] },

  { key: 'queryStat', statKey: 'totalCustomers', regex: /how many customers?|total number of customers?/i },
  { key: 'queryStat', statKey: 'active', regex: /how many active customers?/i },
  { key: 'queryStat', statKey: 'cutOff', regex: /how many cut ?off customers?/i },
  { key: 'queryStat', statKey: 'disable', regex: /how many disabled? customers?/i },
  { key: 'queryStat', statKey: 'unpaid', regex: /how many unpaid customers?|how many pending customers?/i },
  { key: 'queryStat', statKey: 'paid', regex: /how many paid customers?/i },
  { key: 'queryStat', statKey: 'totalRevenue', regex: /(?:what(?:'s| is) )?(?:my |the )?total revenue/i },
  { key: 'queryStat', statKey: 'totalDues', regex: /(?:what(?:'s| is) )?(?:my |the )?total dues/i },
  { key: 'queryStat', statKey: 'totalRecovery', regex: /(?:what(?:'s| is) )?(?:my |the )?total recovery/i },
  { key: 'queryStat', statKey: 'totalExpenses', regex: /(?:what(?:'s| is) )?(?:my |the )?total expenses?/i },
  { key: 'queryStat', statKey: 'netProfit', regex: /(?:what(?:'s| is) )?(?:my |the )?net profit/i },
  { key: 'queryStat', statKey: 'collected', regex: /(?:what(?:'s| is) )?(?:my |the )?(?:amount collected|total collected)/i },
  { key: 'queryStat', statKey: 'pendingCollection', regex: /(?:what(?:'s| is) )?(?:my |the )?pending collection/i },

  { key: 'deleteCustomer', regex: /^deletes?\s+customers?\s+(.+)/i },
  { key: 'deleteCustomer', regex: /^(?:remove|delete)\s+(.+?)(?:\s+(?:from|as)\s+(?:a\s+)?customers?)?$/i },

  { key: 'addCustomer', regex: /^(?:please\s+)?adds?(?:\s+a)?(?:\s+new)?\s+customers?(?:\s+(?:named|called))?\s*(.*)$/i },

  { key: 'setBill', regex: /(?:sets?|updates?|changes?)\s+(.+?)(?:'s)?\s+fee(?:s|es)?\s+(?:to|as)\s+(.+)/i },
  { key: 'setDues', regex: /(?:sets?|updates?|changes?)\s+(.+?)(?:'s)?\s+dues\s+(?:to|as)\s+(.+)/i },
  { key: 'addDues', regex: /adds?\s+(.+?)\s+(?:to|in)\s+(.+?)(?:'s)?\s+dues/i, order: ['value', 'name'] },
  { key: 'setPackage', regex: /(?:sets?|updates?|changes?)\s+(.+?)(?:'s)?\s+package(?:s|es)?\s+(?:to|as)\s+(.+)/i },
  { key: 'setPhone', regex: /(?:sets?|updates?|changes?)\s+(.+?)(?:'s)?\s+phone(?:s|es)?\s+(?:to|as)\s+(.+)/i },
  { key: 'setAddress', regex: /(?:sets?|updates?|changes?)\s+(.+?)(?:'s)?\s+address(?:es)?\s+(?:to|as)\s+(.+)/i },
  { key: 'setDay', regex: /(?:sets?|updates?|changes?)\s+(.+?)(?:'s)?\s+(?:day|date)\s+(?:to|as)\s+(\d{1,2}|[a-z-]+)/i },

  { key: 'setStatus', regex: /(?:sets?|changes?|marks?)\s+(.+?)(?:'s)?\s+status(?:es)?\s+(?:to|as)\s+(active|cut ?off|disable[d]?)/i },
  { key: 'setStatus', regex: /^(.+?)\s+(?:should be|is now)\s+(active|cut ?off|disable[d]?)\s*$/i },
  { key: 'markPaid', regex: /(?:marks?|sets?)\s+(.+?)\s+(?:as\s+)?paid/i },
  { key: 'markUnpaid', regex: /(?:marks?|sets?)\s+(.+?)\s+(?:as\s+)?unpaid/i },

  { key: 'queryDues', regex: /^(?:how much does|what does)\s+(.+?)\s+owes?/i },
  { key: 'queryDues', regex: new RegExp('^' + LOOKUP_PREFIX + "(.+?)(?:'s)?\\s+dues\\s*$", 'i') },
  { key: 'queryFee', regex: new RegExp('^' + LOOKUP_PREFIX + "(.+?)(?:'s)?\\s+fee\\s*$", 'i') },
  { key: 'queryPackage', regex: new RegExp('^' + LOOKUP_PREFIX + "(.+?)(?:'s)?\\s+package\\s*$", 'i') },
  { key: 'queryPhone', regex: new RegExp('^' + LOOKUP_PREFIX + "(.+?)(?:'s)?\\s+phone\\s*$", 'i') },
  { key: 'queryAddress', regex: new RegExp('^' + LOOKUP_PREFIX + "(.+?)(?:'s)?\\s+address\\s*$", 'i') },
  { key: 'queryPaymentStatus', regex: new RegExp('^' + LOOKUP_PREFIX + "(.+?)(?:'s)?\\s+payment status\\s*$", 'i') },
  { key: 'queryStatus', regex: new RegExp('^' + LOOKUP_PREFIX + "(.+?)(?:'s)?\\s+status\\s*$", 'i') },

  { key: 'openCustomerDetail', regex: /^(?:opens?|shows?(?:\s+me)?|views?|finds?|search(?:es)?\s+for|looks?\s+up|pulls?\s+up|get\s+me)\s+(?:customers?\s+)?(.+?)(?:'s)?\s*(?:profile|details?|record|info)?(?:s|es)?$/i },

  { key: 'queryInfo', regex: /(?:finds?|search(?:es)? for|looks?\s+up)\s+(?:customers?\s+)?(.+)/i },
];

// Anything that mentions "expense" but is really a stats question
// ("total expenses", "how much did I spend this month" style) should
// still fall through to the queryStat patterns instead of being
// grabbed by the flexible expense-adder below.
const EXPENSE_STAT_QUESTION_RE = /\b(total|how much|what(?:'s| is)|net profit|report)\b/i;

function matchCommand(transcript) {
  const text = normalizeMultilingual(transcript.trim().replace(/[.?!]+$/, ''));

  // Expense-adding is highly free-form in real speech ("add expense of
  // 500 for diesel", "500 diesel expense", "expense diesel five hundred
  // rupees"...) so instead of forcing one exact sentence shape, pull the
  // amount and title out wherever they land and go straight to adding it.
  if (/\bexpense\b/i.test(text) && !EXPENSE_STAT_QUESTION_RE.test(text)) {
    const { amount, title } = extractExpenseDetails(text);
    if (amount != null) {
      return { key: 'addExpense', groups: [String(amount), title] };
    }
  }

  for (const p of PATTERNS) {
    const m = text.match(p.regex);
    if (m) return { key: p.key, groups: m.slice(1), order: p.order, statKey: p.statKey };
  }
  return null;
}

const FILLER_WORDS = /\b(please|can you|could you|i want to|i want you to|kindly|the|for|of|to|a|an|is|are|his|her|their|now|today|me)\b/gi;
const KEYWORD_WORDS = /\b(open|show|view|find|search|look|up|pull|get|add|delete|remove|mark|set|update|change|customer|paid|unpaid|active|cut|off|cutoff|disable|fee|dues|balance|owe|owes|profile|details|record|info|package|phone|address|status|expense|payment|report|reports|dashboard|settings|help|new|named|called|as|whatsapp|reminder|send)\b/gi;

function extractLooseName(text) {
  return text.replace(FILLER_WORDS, ' ').replace(KEYWORD_WORDS, ' ').replace(/\s+/g, ' ').trim();
}

function looseIntentFallback(text) {
  const hasWord = (w) => new RegExp('\\b' + w + '\\b', 'i').test(text);

  if (hasWord('expense')) {
    const { amount, title } = extractExpenseDetails(text);
    // Even with no amount caught, route to addExpense so the reply is a
    // helpful "what's the amount?" prompt instead of a flat "didn't understand".
    return { key: 'addExpense', groups: [amount != null ? String(amount) : '', title] };
  }
  if (hasWord('delete') || hasWord('remove')) {
    const name = extractLooseName(text);
    if (name) return { key: 'deleteCustomer', groups: [name] };
  }
  if (hasWord('whatsapp') || hasWord('reminder')) {
    const name = extractLooseName(text);
    if (name) return { key: 'sendWhatsapp', groups: [name] };
  }
  if (hasWord('add') && hasWord('customer')) {
    const rest = text.replace(/^.*?\b(?:add|customer)\b/i, '').trim();
    if (rest) return { key: 'addCustomer', groups: [rest] };
  }
  if (hasWord('unpaid')) {
    const name = extractLooseName(text);
    if (name) return { key: 'markUnpaid', groups: [name] };
  }
  if (hasWord('paid')) {
    const name = extractLooseName(text);
    if (name) return { key: 'markPaid', groups: [name] };
  }
  if (hasWord('active') || hasWord('cutoff') || hasWord('cut') || hasWord('disable')) {
    const statusWord = hasWord('active') ? 'active' : hasWord('disable') ? 'disable' : 'cut off';
    const name = extractLooseName(text);
    if (name) return { key: 'setStatus', groups: [name, statusWord] };
  }
  if (hasWord('owe') || hasWord('owes') || hasWord('dues')) {
    const name = extractLooseName(text);
    if (name) return { key: 'queryDues', groups: [name] };
  }
  if (hasWord('fee')) {
    const name = extractLooseName(text);
    if (name) return { key: 'queryFee', groups: [name] };
  }
  if (hasWord('open') || hasWord('show') || hasWord('find') || hasWord('search') || hasWord('view') || hasWord('customer')) {
    const name = extractLooseName(text);
    if (name) return { key: 'openCustomerDetail', groups: [name] };
  }
  return null;
}

const STATUS_MAP = { active: 'Active', cutoff: 'Cut Off', cutOff: 'Cut Off', disabled: 'Disable', disable: 'Disable' };

async function executeConfirmedAction(pending, ctx, lang) {
  const { type, payload } = pending;
  try {
    if (type === 'addCustomer') {
      await ctx.API.post('/customers', payload);
      ctx.refreshCustomers();
      return { ok: true, message: `Added new customer ${payload.name} with a monthly fee of ${money(payload.monthlyFee)}.` };
    }
    if (type === 'deleteCustomer') {
      await ctx.API.delete('/customers/' + payload.mongoId);
      ctx.refreshCustomers();
      return { ok: true, message: t(lang, 'deletedCustomer', payload.name) };
    }
    if (type === 'markPaid') {
      await ctx.API.put('/customers/' + payload.mongoId, { paymentStatus: 'Paid', pendingDues: 0 });
      try {
        await ctx.API.post('/payments', {
          customerId: payload.customerId,
          amount: payload.monthlyFee,
          billingMonth: new Date().toLocaleString('en-US', { month: 'long' }),
          method: 'Cash',
          notes: 'Recorded via voice command',
        });
      } catch (e) {
        // Payment log is best-effort; the customer status update is what matters most.
      }
      ctx.refreshCustomers();
      return { ok: true, message: t(lang, 'markedPaid', payload.name) };
    }
    if (type === 'markUnpaid') {
      await ctx.API.put('/customers/' + payload.mongoId, { paymentStatus: 'Unpaid' });
      ctx.refreshCustomers();
      return { ok: true, message: t(lang, 'markedUnpaid', payload.name) };
    }
    if (type === 'setStatus') {
      await ctx.API.put('/customers/' + payload.mongoId, { status: payload.status });
      ctx.refreshCustomers();
      return { ok: true, message: t(lang, 'statusUpdated', payload.name, STATUS_LABELS[lang]?.[payload.status] || payload.status) };
    }
    if (type === 'bulkWhatsapp') {
      const res = await ctx.API.post('/whatsapp/bulk');
      const links = res.data?.data || [];
      links.forEach((item) => window.open(item.whatsappUrl, '_blank'));
      return { ok: true, message: t(lang, 'bulkWhatsappSent', links.length) };
    }
  } catch (err) {
    return { ok: false, message: err.response?.data?.message || t(lang, 'genericError') };
  }
  return { ok: false, message: t(lang, 'genericError') };
}

export async function runVoiceCommand(rawTranscript, ctx) {
  const transcript = collapseRepeatedSpeech(rawTranscript);
  const lang = ctx.lang && MESSAGES[ctx.lang] ? ctx.lang : 'en';
  const setPending = ctx.setPendingConfirmation || (() => {});

  // Fetch the real customer list up front (this is cached after the first
  // call, so it's effectively free) and shield any customer name that
  // happens to contain a dictionary trigger word - e.g. a customer named
  // "Hadi Mobile" would otherwise get silently rewritten to "Hadi phone"
  // by normalizeMultilingual before any command ever sees the real name.
  let customers = [];
  try {
    customers = await ctx.getCustomers();
  } catch (e) {
    // If this fails we just skip name-protection for this turn; the
    // rest of the flow still works normally without it.
  }
  const { text: protectedTranscript, map: nameMap } = protectKnownNames(
    transcript,
    customers.map((c) => c.name)
  );
  const restoreInMatch = (m) => {
    if (m && Array.isArray(m.groups)) {
      m.groups = m.groups.map((g) => (typeof g === 'string' ? restoreNames(g, nameMap) : g));
    }
    return m;
  };

  if (ctx.pendingConfirmation) {
    const pending = ctx.pendingConfirmation;
    if (isAffirmative(transcript)) {
      setPending(null);
      return await executeConfirmedAction(pending, ctx, lang);
    }
    if (isNegative(transcript)) {
      setPending(null);
      return { ok: true, message: t(lang, 'cancelled') };
    }
    const freshMatch = restoreInMatch(matchCommand(protectedTranscript));
    if (!freshMatch) {
      return { ok: true, needsConfirmation: true, message: pending.message };
    }
    setPending(null);
    return runParsedCommand(freshMatch, ctx, lang, setPending);
  }

  const normalized = normalizeMultilingual(protectedTranscript.trim().replace(/[.?!]+$/, ''));
  let match = restoreInMatch(matchCommand(protectedTranscript) || looseIntentFallback(normalized));

  if (!match) {
    // Last resort: no command word matched at all - but the client almost
    // certainly just said (or the mic mis-heard) a customer's name on its
    // own, e.g. "Ahmed Khan" with no "open"/"show" in front of it. If that
    // name resolves to a real customer, open their profile instead of
    // making the person repeat themselves with a keyword.
    const candidate = restoreNames(extractLooseName(normalized) || normalized, nameMap);
    if (candidate && findCustomer(customers, candidate)) {
      match = { key: 'openCustomerDetail', groups: [candidate] };
    }
  }

  if (!match) {
    return { ok: false, message: t(lang, 'notUnderstood', transcript) };
  }
  return runParsedCommand(match, ctx, lang, setPending);
}

async function runParsedCommand(match, ctx, lang, setPending) {
  const { key, groups, order, statKey } = match;

  if (key === 'help') {
    return { ok: true, message: t(lang, 'help') };
  }

  if (key === 'navigate') {
    const target = groups[0].toLowerCase().replace(/s$/, '');
    const path = PAGE_MAP[target] || PAGE_MAP[target + 's'];
    if (!path) return { ok: false, message: t(lang, 'unknownPage', groups[0]) };
    ctx.navigate(path);
    return { ok: true, message: t(lang, 'openingPage', PAGE_LABELS[lang]?.[target] || target) };
  }

  if (key === 'queryStat') {
    const res = await ctx.API.get('/dashboard');
    const stats = res.data?.data?.stats || {};
    const info = STAT_LABELS[statKey];
    const raw = stats[statKey];
    const value = info.money ? money(raw) : Number(raw || 0).toLocaleString();
    return { ok: true, message: t(lang, 'statLine', info[lang] || info.en, value) };
  }

  if (key === 'addExpense') {
    let [rawValue, rawTitle] = groups;
    const amount = wordsToNumber(rawValue || '');
    if (amount == null) return { ok: false, message: t(lang, 'expenseMissingAmount') };
    // Amount is the only hard requirement - if no title/category came
    // through, still record the expense rather than refusing outright.
    const title = (rawTitle || '').trim() || 'General';
    const category = guessExpenseCategory(title);
    await ctx.API.post('/expenses', { title, amount, category, description: 'Added via voice command' });
    return { ok: true, message: t(lang, 'addedExpense', money(amount), title, category) };
  }

  if (key === 'bulkWhatsapp') {
    const customers = await ctx.getCustomers();
    const unpaid = customers.filter((c) => c.paymentStatus === 'Unpaid' && c.phone);
    if (unpaid.length === 0) return { ok: false, message: t(lang, 'noUnpaidWithPhone') };
    const message = t(lang, 'confirmBulkWhatsapp', unpaid.length);
    setPending({ type: 'bulkWhatsapp', payload: {}, message });
    return { ok: true, needsConfirmation: true, message };
  }

  const customers = await ctx.getCustomers();

  if (key === 'sendWhatsapp') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', groups[0]) };
    if (!customer.phone) return { ok: false, message: t(lang, 'noPhoneOnFile', customer.name) };
    try {
      const res = await ctx.API.post('/whatsapp/send', { customerId: customer.customerId });
      const url = res.data?.data?.whatsappUrl;
      if (url) window.open(url, '_blank');
      return { ok: true, message: t(lang, 'whatsappSent', customer.name) };
    } catch (err) {
      return { ok: false, message: err.response?.data?.message || t(lang, 'genericError') };
    }
  }

  if (key === 'recordPayment') {
    let rawValue, rawName;
    if (order && order[0] === 'name') {
      [rawName, , rawValue] = groups;
    } else {
      [rawValue, rawName] = groups;
    }
    const customer = findCustomer(customers, rawName);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', rawName) };
    const amount = wordsToNumber(rawValue);
    if (amount == null) return { ok: false, message: t(lang, 'missedAmount', customer.name) };

    const newDues = Math.max((customer.pendingDues || 0) - amount, 0);
    await ctx.API.put(`/customers/${customer._id}`, {
      pendingDues: newDues,
      paymentStatus: newDues <= 0 ? 'Paid' : customer.paymentStatus,
    });
    try {
      await ctx.API.post('/payments', {
        customerId: customer.customerId,
        amount,
        billingMonth: new Date().toLocaleString('en-US', { month: 'long' }),
        method: 'Cash',
        notes: 'Recorded via voice command',
      });
    } catch (e) {
      // Payment log is best-effort; the balance update above is what matters most.
    }
    ctx.refreshCustomers();
    return { ok: true, message: t(lang, 'recordedPayment', money(amount), customer.name, money(newDues)) };
  }

  if (key === 'deleteCustomer') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', groups[0]) };
    const message = t(lang, 'confirmDeleteCustomer', customer.name);
    setPending({ type: 'deleteCustomer', payload: { mongoId: customer._id, name: customer.name }, message });
    return { ok: true, needsConfirmation: true, message };
  }

  if (key === 'queryInfo' || key === 'openCustomerDetail') {
    const rawName = groups[0];
    const customer = findCustomer(customers, rawName);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', rawName) };
    setPendingCustomerTarget({ customerId: customer.customerId, mongoId: customer._id }, 'view');
    ctx.navigate('/customers');
    return {
      ok: true,
      message: t(
        lang,
        'openingProfileWithInfo',
        customer.name,
        money(customer.monthlyFee),
        money(customer.pendingDues || 0),
        STATUS_LABELS[lang]?.[customer.status] || customer.status
      ),
    };
  }

  if (key === 'queryDues') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', groups[0]) };
    return { ok: true, message: t(lang, 'owes', customer.name, money(customer.pendingDues || 0)) };
  }

  if (key === 'queryFee') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', groups[0]) };
    return { ok: true, message: t(lang, 'feeLine', customer.name, money(customer.monthlyFee)) };
  }

  if (key === 'queryPackage') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', groups[0]) };
    if (!customer.package) return { ok: true, message: t(lang, 'noPackage', customer.name) };
    return { ok: true, message: t(lang, 'packageLine', customer.name, customer.package) };
  }

  if (key === 'queryPhone') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', groups[0]) };
    if (!customer.phone) return { ok: true, message: t(lang, 'noPhone', customer.name) };
    return { ok: true, message: t(lang, 'phoneLine', customer.name, customer.phone) };
  }

  if (key === 'queryAddress') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', groups[0]) };
    if (!customer.address) return { ok: true, message: t(lang, 'noAddress', customer.name) };
    return { ok: true, message: t(lang, 'addressLine', customer.name, customer.address) };
  }

  if (key === 'queryStatus') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', groups[0]) };
    return { ok: true, message: t(lang, 'statusLine', customer.name, STATUS_LABELS[lang]?.[customer.status] || customer.status) };
  }

  if (key === 'queryPaymentStatus') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', groups[0]) };
    return { ok: true, message: t(lang, 'paymentStatusLine', customer.name, STATUS_LABELS[lang]?.[customer.paymentStatus] || customer.paymentStatus) };
  }

  if (key === 'addCustomer') {
    const remainder = (groups[0] || '').trim();
    if (!remainder) return { ok: false, message: t(lang, 'askNameFee') };

    const nameMatch = remainder.match(/^(.+?)(?:\s+with)?(?:\s+(?:package|fee|phone|address|day|date)\b|$)/i);
    const name = cleanName(nameMatch ? nameMatch[1] : remainder);
    if (!name) return { ok: false, message: t(lang, 'missedName') };

    const packageMatch = remainder.match(/package\s+([a-z0-9\s]+?)(?=\s+(?:fee|phone|address|day|date)\b|$)/i);
    const feeMatch = remainder.match(/fee\s+([\w\s]+?)(?=\s+(?:phone|package|address|day|date)\b|$)/i);
    const phoneMatch = remainder.match(/phone\s+([\d\s]+)/i);
    const addressMatch = remainder.match(/address\s+(.+?)(?=\s+(?:fee|package|phone|day|date)\b|$)/i);
    const dayMatch = remainder.match(/(?:day|date)\s+([\w-]+(?:\s+[\w-]+)?)(?=\s+(?:fee|package|phone|address)\b|$)/i);

    const monthlyFee = feeMatch ? wordsToNumber(feeMatch[1]) : null;
    if (monthlyFee == null) return { ok: false, message: t(lang, 'askFee', name) };

    let day = dayMatch ? wordsToNumber(dayMatch[1]) : null;
    if (day == null || day < 1 || day > 31) day = new Date().getDate();

    const payload = {
      name,
      customerId: `VC-${Date.now().toString().slice(-6)}`,
      monthlyFee,
      pendingDues: 0,
      connectionDate: String(day),
      package: packageMatch ? packageMatch[1].trim() : '',
      phone: phoneMatch ? phoneMatch[1].replace(/\s+/g, '') : '',
      address: addressMatch ? addressMatch[1].trim() : '',
      status: 'Active',
      paymentStatus: 'Unpaid',
    };

    const message = t(lang, 'addedCustomer', name, money(monthlyFee));
    setPending({ type: 'addCustomer', payload, message });
    return { ok: true, needsConfirmation: true, message };
  }

  if (key === 'setBill') {
    const [rawName, rawValue] = groups;
    const customer = findCustomer(customers, rawName);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', rawName) };
    const amount = wordsToNumber(rawValue);
    if (amount == null) return { ok: false, message: t(lang, 'missedAmount', customer.name) };
    const before = customer.monthlyFee;
    await ctx.API.put(`/customers/${customer._id}`, { monthlyFee: amount });
    ctx.refreshCustomers();
    return { ok: true, message: t(lang, 'updatedBill', customer.name, money(before), money(amount)) };
  }

  if (key === 'setDues') {
    const [rawName, rawValue] = groups;
    const customer = findCustomer(customers, rawName);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', rawName) };
    const amount = wordsToNumber(rawValue);
    if (amount == null) return { ok: false, message: t(lang, 'missedAmount', customer.name) };
    await ctx.API.put(`/customers/${customer._id}`, { pendingDues: amount });
    ctx.refreshCustomers();
    return { ok: true, message: t(lang, 'setDues', customer.name, money(amount)) };
  }

  if (key === 'addDues') {
    let [rawValue, rawName] = groups;
    if (order && order[0] === 'name') [rawName, rawValue] = groups;
    const customer = findCustomer(customers, rawName);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', rawName) };
    const amount = wordsToNumber(rawValue);
    if (amount == null) return { ok: false, message: t(lang, 'missedAmount', rawName) };
    const newDues = (customer.pendingDues || 0) + amount;
    await ctx.API.put(`/customers/${customer._id}`, { pendingDues: newDues });
    ctx.refreshCustomers();
    return { ok: true, message: t(lang, 'addedDues', money(amount), customer.name, money(newDues)) };
  }

  if (key === 'setPackage') {
    const [rawName, rawPkg] = groups;
    const customer = findCustomer(customers, rawName);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', rawName) };
    const pkg = rawPkg.trim();
    await ctx.API.put(`/customers/${customer._id}`, { package: pkg });
    ctx.refreshCustomers();
    return { ok: true, message: t(lang, 'packageUpdated', customer.name, pkg) };
  }

  if (key === 'setPhone') {
    const [rawName, rawPhone] = groups;
    const customer = findCustomer(customers, rawName);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', rawName) };
    const phone = rawPhone.replace(/[^\d]/g, '');
    await ctx.API.put(`/customers/${customer._id}`, { phone });
    ctx.refreshCustomers();
    return { ok: true, message: t(lang, 'phoneUpdated', customer.name) };
  }

  if (key === 'setAddress') {
    const [rawName, rawAddress] = groups;
    const customer = findCustomer(customers, rawName);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', rawName) };
    await ctx.API.put(`/customers/${customer._id}`, { address: rawAddress.trim() });
    ctx.refreshCustomers();
    return { ok: true, message: t(lang, 'addressUpdated', customer.name) };
  }

  if (key === 'setDay') {
    const [rawName, rawDay] = groups;
    const customer = findCustomer(customers, rawName);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', rawName) };
    const day = wordsToNumber(rawDay);
    if (day == null || day < 1 || day > 31) return { ok: false, message: t(lang, 'missedDay', customer.name) };
    await ctx.API.put(`/customers/${customer._id}`, { connectionDate: String(day) });
    ctx.refreshCustomers();
    return { ok: true, message: t(lang, 'dayUpdated', customer.name, day) };
  }

  if (key === 'setStatus') {
    const [rawName, rawStatus] = groups;
    const customer = findCustomer(customers, rawName);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', rawName) };
    const normalized = rawStatus.toLowerCase().replace(/\s+/g, '');
    const status = STATUS_MAP[normalized];
    if (!status) return { ok: false, message: t(lang, 'unknownStatus', rawStatus) };
    const message = t(lang, 'confirmSetStatus', customer.name, STATUS_LABELS[lang]?.[status] || status);
    setPending({ type: 'setStatus', payload: { mongoId: customer._id, name: customer.name, status }, message });
    return { ok: true, needsConfirmation: true, message };
  }

  if (key === 'markPaid') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', groups[0]) };
    const message = t(lang, 'confirmMarkPaid', customer.name);
    setPending({
      type: 'markPaid',
      payload: { mongoId: customer._id, name: customer.name, customerId: customer.customerId, monthlyFee: customer.monthlyFee },
      message,
    });
    return { ok: true, needsConfirmation: true, message };
  }

  if (key === 'markUnpaid') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', groups[0]) };
    const message = t(lang, 'confirmMarkUnpaid', customer.name);
    setPending({ type: 'markUnpaid', payload: { mongoId: customer._id, name: customer.name }, message });
    return { ok: true, needsConfirmation: true, message };
  }

  return { ok: false, message: t(lang, 'genericError') };
}

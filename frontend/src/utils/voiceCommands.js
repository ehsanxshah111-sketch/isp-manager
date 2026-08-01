// ============================================================
// voiceCommands.js
// Parses a spoken sentence into an action and executes it
// against the SAME API endpoints the UI already uses.
// Nothing here creates new MongoDB collections or fields -
// it only calls existing customer / payment / expense routes.
//
// Two layers make this multilingual:
//  1. normalizeMultilingual() rewrites Urdu/Roman-Urdu/Punjabi
//     words to ONE canonical English trigger word (e.g. "fee",
//     "charges", "package fee", "bakaya" all become "fee" or
//     "dues") so every pattern below only has to check for the
//     canonical word - this is the "dictionary".
//  2. MESSAGES holds every spoken/toast reply in English, Urdu
//     and Punjabi, so the reply comes back in whichever
//     language is currently selected on the mic button.
// ============================================================

import { setPendingCustomerTarget } from './voiceBus';

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
  [/\b(customer|kasto?mar|client|consumer|گاہک|کسٹمر|صارف|ਗਾਹਕ)\b/gi, 'customer'],

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
  [/\b(disable|غیر فعال|ਅਯੋਗ)\b/gi, 'disable'],
  [/\b(phone number|number|mobile|contact number|whatsapp number|نمبر|موبائل|ਨੰਬਰ)\b/gi, 'phone'],
  [/\b(address|pata|پتہ|ایڈریس|ਪਤਾ)\b/gi, 'address'],
  [/\b(profile|details?|record|info|تفصیلات|پروفائل)\b/gi, 'details'],
  [/\b(package|plan|پیکج|پلان)\b/gi, 'package'],
  [/\b(how much|kitna|کتنا)\b/gi, 'how much'],
  [/\b(owe|owes|bakaya hai|واجب الادا)\b/gi, 'owe'],

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
  [/\b(kul kharcha|کل اخراجات)\b/gi, 'total expenses'],
  [/\b(khalis munafa|خالص منافع)\b/gi, 'net profit'],
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
  unpaid: { en: 'unpaid customers', ur: 'غیر ادا شدہ کسٹمرز', pa: 'ਅਦਾ ਨਾ ਕੀਤੇ ਗਾਹਕ', money: false },
  paid: { en: 'customers marked as paid', ur: 'ادا شدہ کسٹمرز', pa: 'ਅਦਾ ਕੀਤੇ ਗਾਹਕ', money: false },
  totalRevenue: { en: 'total monthly revenue', ur: 'کل ماہانہ آمدنی', pa: 'ਕੁੱਲ ਮਹੀਨਾਵਾਰ ਆਮਦਨ', money: true },
  totalDues: { en: 'total pending dues', ur: 'کل بقایا رقم', pa: 'ਕੁੱਲ ਬਕਾਇਆ', money: true },
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
      'Try things like: "open customers", "set John\'s fee to fifteen hundred", "mark John as paid", ' +
      '"John paid 1500", "set John\'s status to cut off", "how much does John owe", "open John\'s profile", ' +
      '"add customer John with fee 1500", "add expense of 500 for diesel", "delete customer John", or ' +
      '"what is my total revenue".',
    openingPage: (p) => `Opening ${p}.`,
    unknownPage: (p) => `I don't know a page called ${p}.`,
    customerNotFound: (n) => `I couldn't find a customer matching ${n}.`,
    customerInfo: (c, pkg, fee, dues, status, pay) =>
      `${c.name}: package ${pkg}, monthly fee ${fee}, pending dues ${dues}, status ${status}, payment ${pay}.`,
    owes: (n, amt) => `${n} owes ${amt}.`,
    openingProfile: (n) => `Opening ${n}'s profile.`,
    askNameFee: 'Sure - what is the customer\'s name and monthly fee? For example: "add customer Ahmed with fee 1500".',
    missedName: 'I got the fee but missed the name. Try: "add customer Ahmed with fee 1500".',
    askFee: (n) => `Got the name ${n} - now what's the monthly fee? Try: "add customer ${n} with fee 1500".`,
    addedCustomer: (n, fee) => `Added new customer ${n} with a monthly fee of ${fee}.`,
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
    statLine: (label, value) => `Your ${label} is ${value}.`,
    genericError: 'Something went wrong running that command.',
  },
  ur: {
    notUnderstood: (tr) => `معاف کیجیے، میں سمجھ نہیں سکا: "${tr}"۔ مدد کے لیے "مدد" کہیں۔`,
    help:
      'کوشش کریں: "کسٹمرز کھولو"، "احمد کی فیس پندرہ سو کرو"، "احمد کو ادا شدہ کریں"، ' +
      '"احمد نے پندرہ سو ادا کیے"، "احمد کا سٹیٹس کٹ آف کرو"، "احمد پر کتنے بقایا ہیں"، ' +
      '"احمد کی پروفائل کھولو"، "کسٹمر احمد فیس پندرہ سو کے ساتھ شامل کرو"، ' +
      '"پانچ سو کا خرچہ ڈیزل کے لیے شامل کرو"، "کسٹمر احمد حذف کرو"، یا "میری کل آمدنی کتنی ہے"۔',
    openingPage: (p) => `${p} کھول رہا ہوں۔`,
    unknownPage: (p) => `مجھے ${p} نامی کوئی صفحہ نہیں ملا۔`,
    customerNotFound: (n) => `مجھے ${n} سے ملتا جلتا کوئی کسٹمر نہیں ملا۔`,
    customerInfo: (c, pkg, fee, dues, status, pay) =>
      `${c.name}: پیکج ${pkg}، ماہانہ فیس ${fee}، بقایا ${dues}، حالت ${status}، ادائیگی ${pay}۔`,
    owes: (n, amt) => `${n} پر ${amt} بقایا ہیں۔`,
    openingProfile: (n) => `${n} کی پروفائل کھول رہا ہوں۔`,
    askNameFee: 'ٹھیک ہے - کسٹمر کا نام اور ماہانہ فیس بتائیں۔ مثلاً: "کسٹمر احمد فیس پندرہ سو شامل کرو"۔',
    missedName: 'فیس مل گئی مگر نام نہیں ملا۔ کوشش کریں: "کسٹمر احمد فیس پندرہ سو شامل کرو"۔',
    askFee: (n) => `${n} کا نام مل گیا - ماہانہ فیس کیا ہے؟ کوشش کریں: "کسٹمر ${n} فیس پندرہ سو شامل کرو"۔`,
    addedCustomer: (n, fee) => `نیا کسٹمر ${n} شامل کر دیا، ماہانہ فیس ${fee}۔`,
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
    statLine: (label, value) => `آپ کا ${label} ${value} ہے۔`,
    genericError: 'کچھ غلط ہو گیا، دوبارہ کوشش کریں۔',
  },
  pa: {
    notUnderstood: (tr) => `ਮੁਆਫ਼ ਕਰਨਾ, ਮੈਨੂੰ ਸਮਝ ਨਹੀਂ ਆਇਆ: "${tr}"। ਮਦਦ ਲਈ "ਮਦਦ" ਕਹੋ।`,
    help:
      'ਕੋਸ਼ਿਸ਼ ਕਰੋ: "ਗਾਹਕ ਖੋਲ੍ਹੋ", "ਜੌਨ ਦੀ ਫੀਸ ਪੰਦਰਾਂ ਸੌ ਕਰੋ", "ਜੌਨ ਨੂੰ ਅਦਾ ਕੀਤਾ ਕਰੋ", ' +
      '"ਜੌਨ ਦਾ ਸਟੇਟਸ ਕੱਟ ਆਫ ਕਰੋ", "ਜੌਨ ਤੇ ਕਿੰਨਾ ਬਕਾਇਆ ਹੈ", "ਨਵਾਂ ਗਾਹਕ ਜੌਨ ਫੀਸ ਪੰਦਰਾਂ ਸੌ ਨਾਲ ਸ਼ਾਮਲ ਕਰੋ", ' +
      'ਜਾਂ "ਮੇਰੀ ਕੁੱਲ ਆਮਦਨ ਕਿੰਨੀ ਹੈ"।',
    openingPage: (p) => `${p} ਖੋਲ੍ਹ ਰਿਹਾ ਹਾਂ।`,
    unknownPage: (p) => `ਮੈਨੂੰ ${p} ਨਾਮ ਦਾ ਕੋਈ ਪੰਨਾ ਨਹੀਂ ਮਿਲਿਆ।`,
    customerNotFound: (n) => `ਮੈਨੂੰ ${n} ਨਾਲ ਮਿਲਦਾ ਕੋਈ ਗਾਹਕ ਨਹੀਂ ਮਿਲਿਆ।`,
    customerInfo: (c, pkg, fee, dues, status, pay) =>
      `${c.name}: ਪੈਕੇਜ ${pkg}, ਮਹੀਨਾਵਾਰ ਫੀਸ ${fee}, ਬਕਾਇਆ ${dues}, ਹਾਲਤ ${status}, ਭੁਗਤਾਨ ${pay}।`,
    owes: (n, amt) => `${n} ਤੇ ${amt} ਬਕਾਇਆ ਹੈ।`,
    openingProfile: (n) => `${n} ਦੀ ਪ੍ਰੋਫਾਈਲ ਖੋਲ੍ਹ ਰਿਹਾ ਹਾਂ।`,
    askNameFee: 'ਠੀਕ ਹੈ - ਗਾਹਕ ਦਾ ਨਾਮ ਅਤੇ ਮਹੀਨਾਵਾਰ ਫੀਸ ਦੱਸੋ।',
    missedName: 'ਫੀਸ ਮਿਲ ਗਈ ਪਰ ਨਾਮ ਨਹੀਂ ਮਿਲਿਆ।',
    askFee: (n) => `${n} ਦਾ ਨਾਮ ਮਿਲ ਗਿਆ - ਮਹੀਨਾਵਾਰ ਫੀਸ ਕੀ ਹੈ?`,
    addedCustomer: (n, fee) => `ਨਵਾਂ ਗਾਹਕ ${n} ਸ਼ਾਮਲ ਕੀਤਾ, ਮਹੀਨਾਵਾਰ ਫੀਸ ${fee}।`,
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
    statLine: (label, value) => `ਤੁਹਾਡਾ ${label} ${value} ਹੈ।`,
    genericError: 'ਕੁਝ ਗਲਤ ਹੋ ਗਿਆ, ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
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

// Converts spoken numbers ("fifteen hundred", "two thousand five") to a Number.
// Falls back to any digits already present in the text (Chrome often
// transcribes numbers as digits already).
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

function cleanName(raw) {
  return raw
    .replace(/'s$/i, '')
    .replace(/^(customer|the|for|mr|mrs|ms)\s+/i, '')
    .trim();
}

// ------------------------------------------------------------
// Fuzzy name matching
// Speech-to-text is never perfect - a single mis-heard letter
// ("Ahmad" heard as "Ahmed"), a dropped/added "s" or "es"
// ("Karim" vs "Karims"), or a slightly garbled ending are all
// completely normal. Instead of requiring an exact/startsWith/
// includes match, we fall back to comparing how CLOSE the
// spoken name is to each real customer name (Levenshtein edit
// distance) and accept the closest one if it's close enough.
// ------------------------------------------------------------
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
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return dp[m][n];
}

// Returns a similarity score from 0 (nothing alike) to 1 (identical).
function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

// A spoken name is accepted as a match if it's this similar (or closer)
// to a real customer name. 0.72 comfortably absorbs one or two mis-heard
// letters or a missing/extra "s"/"es" on names of ordinary length, while
// still rejecting names that are genuinely different.
const NAME_MATCH_THRESHOLD = 0.72;

function findCustomer(customers, rawName) {
  const name = cleanName(rawName).toLowerCase();
  if (!name) return null;

  // 1) Exact / prefix / substring match - fast path for the common case.
  const exact =
    customers.find((c) => c.name?.toLowerCase() === name) ||
    customers.find((c) => c.name?.toLowerCase().startsWith(name)) ||
    customers.find((c) => c.name?.toLowerCase().includes(name)) ||
    customers.find((c) => c.customerId?.toLowerCase() === name);
  if (exact) return exact;

  // 2) Fuzzy fallback - handles mishearing, typos, and singular/plural
  // slips ("Ahmed" vs "Ahmeds", "Bilal" vs "Bilal's" already stripped
  // above, "Farhan" heard as "Farhaan", etc.).
  const nameWords = name.split(/\s+/).filter(Boolean);
  let best = null;
  let bestScore = 0;
  for (const c of customers) {
    if (!c.name) continue;
    const fullName = c.name.toLowerCase();
    const fullWords = fullName.split(/\s+/).filter(Boolean);

    // Compare the whole spoken phrase to the whole real name...
    let score = similarity(name, fullName);
    // ...and also compare word-by-word, so "Ahmed" alone still matches
    // a customer stored as "Ahmed Khan", and vice versa.
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

// ------------------------------------------------------------
// Command patterns, tried in order. Each returns a handler
// context (name/value groups) when matched. All slot keywords
// here are the CANONICAL words produced by normalizeMultilingual
// above (fee, dues, customer, expense, payment, package, phone,
// address, delete, paid, unpaid) - add a synonym once in the
// dictionary and every one of these understands it.
// ------------------------------------------------------------
// NOTE ON (?:s|es)? / s? SUFFIXES BELOW:
// Speech recognition regularly adds or drops a trailing "s"/"es" on verbs
// and nouns ("open" -> "opens", "customer" -> "customers", "expense" ->
// "expenses", "fee" -> "fees"). Every keyword below that could plausibly
// pick up an extra letter this way has an optional (?:s|es)? so a small
// mis-hearing never breaks the match.
const PATTERNS = [
  { key: 'navigate', regex: /^(?:go to|opens?|shows?|navigate to)\s+(dashboard|customer|payment|expense|report|setting)(?:s|es)?\s*$/i },
  { key: 'openCustomerDetail', regex: /^(?:opens?|shows?|views?)\s+(?:customers?\s+)?(.+?)(?:'s)?\s+(?:profile|details?|record|info)(?:s|es)?$/i },
  { key: 'openCustomerDetail', regex: /^(?:opens?|shows?|views?)\s+customers?\s+(.+)/i },

  { key: 'deleteCustomer', regex: /^deletes?\s+customers?\s+(.+)/i },

  { key: 'addExpense', regex: /adds?\s+(?:an?\s+)?expense(?:s|es)?\s+(?:of\s+)?(.+?)\s+for\s+(.+)/i, order: ['value', 'name'] },

  { key: 'recordPayment', regex: /(?:records?|logs?)?\s*(?:a\s+)?payments?\s+of\s+(.+?)\s+(?:from|for)\s+(.+)/i, order: ['value', 'name'] },
  { key: 'recordPayment', regex: /^(.+?)\s+paid\s+(fee\s+)?(\d[\d,]*|\S+)\s*$/i, order: ['name', 'skip', 'value'] },

  { key: 'addCustomer', regex: /^(?:please\s+)?adds?(?:\s+a)?(?:\s+new)?\s+customers?(?:\s+(?:named|called))?\s*(.*)$/i },

  { key: 'setBill', regex: /(?:sets?|updates?|changes?)\s+(.+?)(?:'s)?\s+fee(?:s|es)?\s+(?:to|as)\s+(.+)/i },
  { key: 'setDues', regex: /(?:sets?|updates?|changes?)\s+(.+?)(?:'s)?\s+dues\s+(?:to|as)\s+(.+)/i },
  { key: 'addDues', regex: /adds?\s+(.+?)\s+(?:to|in)\s+(.+?)(?:'s)?\s+dues/i, order: ['value', 'name'] },
  { key: 'setPackage', regex: /(?:sets?|updates?|changes?)\s+(.+?)(?:'s)?\s+package(?:s|es)?\s+(?:to|as)\s+(.+)/i },
  { key: 'setPhone', regex: /(?:sets?|updates?|changes?)\s+(.+?)(?:'s)?\s+phone(?:s|es)?\s+(?:to|as)\s+(.+)/i },
  { key: 'setAddress', regex: /(?:sets?|updates?|changes?)\s+(.+?)(?:'s)?\s+address(?:es)?\s+(?:to|as)\s+(.+)/i },
  { key: 'setStatus', regex: /(?:sets?|changes?|marks?)\s+(.+?)(?:'s)?\s+status(?:es)?\s+(?:to|as)\s+(active|cut ?off|disable[d]?)/i },

  { key: 'markPaid', regex: /(?:marks?|sets?)\s+(.+?)\s+(?:as\s+)?paid/i },
  { key: 'markUnpaid', regex: /(?:marks?|sets?)\s+(.+?)\s+(?:as\s+)?unpaid/i },

  { key: 'queryDues', regex: /(?:how much does|what does)\s+(.+?)\s+owes?/i },
  { key: 'queryDues', regex: /(.+?)(?:'s)?\s+dues\s*$/i },
  { key: 'queryInfo', regex: /(?:finds?|search(?:es)? for|looks?\s+up|shows?\s+me)\s+(?:customers?\s+)?(.+)/i },

  { key: 'queryStat', statKey: 'totalCustomers', regex: /how many customers?|total number of customers?/i },
  { key: 'queryStat', statKey: 'active', regex: /how many active customers?/i },
  { key: 'queryStat', statKey: 'unpaid', regex: /how many unpaid customers?|how many pending customers?/i },
  { key: 'queryStat', statKey: 'paid', regex: /how many paid customers?/i },
  { key: 'queryStat', statKey: 'totalRevenue', regex: /(?:what(?:'s| is) )?(?:my |the )?total revenue/i },
  { key: 'queryStat', statKey: 'totalDues', regex: /(?:what(?:'s| is) )?(?:my |the )?total dues/i },
  { key: 'queryStat', statKey: 'totalExpenses', regex: /(?:what(?:'s| is) )?(?:my |the )?total expenses/i },
  { key: 'queryStat', statKey: 'netProfit', regex: /(?:what(?:'s| is) )?(?:my |the )?net profit/i },
  { key: 'queryStat', statKey: 'collected', regex: /(?:what(?:'s| is) )?(?:my |the )?(?:amount collected|total collected)/i },
  { key: 'queryStat', statKey: 'pendingCollection', regex: /(?:what(?:'s| is) )?(?:my |the )?pending collection/i },

  { key: 'help', regex: /^(help|what can you do|what can i say|commands)/i },
];

function matchCommand(transcript) {
  const text = normalizeMultilingual(transcript.trim().replace(/[.?!]+$/, ''));
  for (const p of PATTERNS) {
    const m = text.match(p.regex);
    if (m) return { key: p.key, groups: m.slice(1), order: p.order, statKey: p.statKey };
  }
  return null;
}

/**
 * Executes a parsed voice command.
 * ctx = { API, navigate, getCustomers, refreshCustomers, lang }
 */
export async function runVoiceCommand(transcript, ctx) {
  const lang = ctx.lang && MESSAGES[ctx.lang] ? ctx.lang : 'en';
  const match = matchCommand(transcript);
  if (!match) {
    return { ok: false, message: t(lang, 'notUnderstood', transcript) };
  }

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
    const amount = wordsToNumber(rawValue);
    if (amount == null) return { ok: false, message: t(lang, 'expenseMissingAmount') };
    const title = (rawTitle || '').trim();
    if (!title) return { ok: false, message: t(lang, 'expenseMissingTitle') };
    const category = guessExpenseCategory(title);
    await ctx.API.post('/expenses', { title, amount, category, description: 'Added via voice command' });
    return { ok: true, message: t(lang, 'addedExpense', money(amount), title, category) };
  }

  // Everything below needs the customer list
  const customers = await ctx.getCustomers();

  if (key === 'recordPayment') {
    let rawValue, rawName;
    if (order && order[0] === 'name') {
      [rawName, , rawValue] = groups; // skip the optional "fee " capture
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
    await ctx.API.delete(`/customers/${customer._id}`);
    ctx.refreshCustomers();
    return { ok: true, message: t(lang, 'deletedCustomer', customer.name) };
  }

  if (key === 'queryInfo') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', groups[0]) };
    ctx.navigate('/customers');
    const statusLbl = STATUS_LABELS[lang]?.[customer.status] || customer.status;
    const payLbl = STATUS_LABELS[lang]?.[customer.paymentStatus] || customer.paymentStatus;
    return {
      ok: true,
      message: t(
        lang,
        'customerInfo',
        customer,
        customer.package || '-',
        money(customer.monthlyFee),
        money(customer.pendingDues || 0),
        statusLbl,
        payLbl
      ),
    };
  }

  if (key === 'queryDues') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', groups[0]) };
    return { ok: true, message: t(lang, 'owes', customer.name, money(customer.pendingDues || 0)) };
  }

  if (key === 'openCustomerDetail') {
    const rawName = groups[0];
    const customer = findCustomer(customers, rawName);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', rawName) };
    setPendingCustomerTarget({ customerId: customer.customerId, mongoId: customer._id }, 'view');
    ctx.navigate('/customers');
    return { ok: true, message: t(lang, 'openingProfile', customer.name) };
  }

  if (key === 'addCustomer') {
    const remainder = groups[0].trim();
    if (!remainder) return { ok: false, message: t(lang, 'askNameFee') };

    const nameMatch = remainder.match(/^(.+?)(?:\s+with)?(?:\s+(?:package|fee)\b|$)/i);
    const name = cleanName(nameMatch ? nameMatch[1] : remainder);
    if (!name) return { ok: false, message: t(lang, 'missedName') };

    const packageMatch = remainder.match(/package\s+([a-z0-9\s]+?)(?=\s+(?:fee|phone|address)\b|$)/i);
    const feeMatch = remainder.match(/fee\s+([\w\s]+?)(?=\s+(?:phone|package|address)\b|$)/i);
    const phoneMatch = remainder.match(/phone\s+([\d\s]+)/i);
    const addressMatch = remainder.match(/address\s+(.+?)(?=\s+(?:fee|package|phone)\b|$)/i);

    const monthlyFee = feeMatch ? wordsToNumber(feeMatch[1]) : null;
    if (monthlyFee == null) return { ok: false, message: t(lang, 'askFee', name) };

    const today = new Date();
    const payload = {
      name,
      customerId: `VC-${Date.now().toString().slice(-6)}`,
      monthlyFee,
      pendingDues: 0,
      connectionDate: String(today.getDate()),
      package: packageMatch ? packageMatch[1].trim() : '',
      phone: phoneMatch ? phoneMatch[1].replace(/\s+/g, '') : '',
      address: addressMatch ? addressMatch[1].trim() : '',
      status: 'Active',
      paymentStatus: 'Unpaid',
    };

    await ctx.API.post('/customers', payload);
    ctx.refreshCustomers();
    return { ok: true, message: t(lang, 'addedCustomer', name, money(monthlyFee)) };
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

  if (key === 'setStatus') {
    const [rawName, rawStatus] = groups;
    const customer = findCustomer(customers, rawName);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', rawName) };
    const normalized = rawStatus.toLowerCase().replace(/\s+/g, '');
    const statusMap = { active: 'Active', cutoff: 'Cut Off', disabled: 'Disable', disable: 'Disable' };
    const status = statusMap[normalized];
    if (!status) return { ok: false, message: t(lang, 'unknownStatus', rawStatus) };
    await ctx.API.put(`/customers/${customer._id}`, { status });
    ctx.refreshCustomers();
    return { ok: true, message: t(lang, 'statusUpdated', customer.name, STATUS_LABELS[lang]?.[status] || status) };
  }

  if (key === 'markPaid') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', groups[0]) };
    await ctx.API.put(`/customers/${customer._id}`, { paymentStatus: 'Paid', pendingDues: 0 });
    try {
      await ctx.API.post('/payments', {
        customerId: customer.customerId,
        amount: customer.monthlyFee,
        billingMonth: new Date().toLocaleString('en-US', { month: 'long' }),
        method: 'Cash',
        notes: 'Recorded via voice command',
      });
    } catch (e) {
      // Payment log is best-effort; the customer status update is what matters most.
    }
    ctx.refreshCustomers();
    return { ok: true, message: t(lang, 'markedPaid', customer.name) };
  }

  if (key === 'markUnpaid') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: t(lang, 'customerNotFound', groups[0]) };
    await ctx.API.put(`/customers/${customer._id}`, { paymentStatus: 'Unpaid' });
    ctx.refreshCustomers();
    return { ok: true, message: t(lang, 'markedUnpaid', customer.name) };
  }

  return { ok: false, message: t(lang, 'genericError') };
}

// ============================================================
// voiceCommands.js
// Parses a spoken sentence into an action and executes it
// against the SAME API endpoints the UI already uses.
// Nothing here creates new MongoDB collections or fields -
// it only calls existing customer / payment routes.
// ============================================================

import { setPendingCustomerTarget } from './voiceBus';

export const VOICE_LANGUAGES = {
  en: { code: 'en-US', label: 'English' },
  ur: { code: 'ur-PK', label: 'Urdu' },
  pa: { code: 'pa-Guru-IN', label: 'Punjabi' },
};

// Common Urdu-script and Roman-Urdu/Punjabi words mapped to the English
// trigger words the regex patterns below understand. Speech recognition
// output for these languages varies a lot by device/browser, so this is
// a best-effort layer - it widens what gets recognized without needing
// a full translation engine (which would need an external API + cost).
const MULTILINGUAL_KEYWORDS = [
  [/\b(kholo|khol do|کھولو|کھول دو)\b/gi, 'open'],
  [/\b(dikhao|دکھاؤ|دکھائیں)\b/gi, 'show'],
  [/\b(customer|kasto?mar|گاہک|کسٹمر)\b/gi, 'customer'],
  [/\b(bill|بل)\b/gi, 'bill'],
  [/\b(fees?|فیس)\b/gi, 'fee'],
  [/\b(set karo|mqrr karo|مقرر کرو|لگاؤ)\b/gi, 'set'],
  [/\b(change karo|badlo|بدلو|تبدیل کرو)\b/gi, 'change'],
  [/\b(mark karo|نشان لگاؤ)\b/gi, 'mark'],
  [/\b(paid|ada|ada shuda|ادا شدہ|ادا)\b/gi, 'paid'],
  [/\b(unpaid|na ada|نا ادا|غیر ادا شدہ)\b/gi, 'unpaid'],
  [/\b(dues?|bakaya|واجبات|بقایا)\b/gi, 'dues'],
  [/\b(balance|بیلنس)\b/gi, 'balance'],
  [/\b(status|حالت|صورتحال)\b/gi, 'status'],
  [/\b(active|فعال|چالو)\b/gi, 'active'],
  [/\b(cut ?off|بند|منقطع)\b/gi, 'cut off'],
  [/\b(disable|غیر فعال)\b/gi, 'disable'],
  [/\b(add karo|shamil karo|شامل کرو|نیا)\b/gi, 'add'],
  [/\b(new|naya|نیا)\b/gi, 'new'],
  [/\b(named|kay naam|کے نام سے|نام)\b/gi, 'named'],
  [/\b(phone number|number|نمبر)\b/gi, 'phone'],
  [/\b(profile|details?|record|تفصیلات|پروفائل)\b/gi, 'details'],
  [/\b(package|پیکج)\b/gi, 'package'],
  [/\b(how much|kitna|کتنا)\b/gi, 'how much'],
  [/\b(owe|owes|bakaya hai|واجب الادا)\b/gi, 'owe'],
  [/\b(dashboard|ڈیش بورڈ)\b/gi, 'dashboard'],
  [/\b(payments?|ادائیگی|ادائیگیاں)\b/gi, 'payments'],
  [/\b(expenses?|اخراجات)\b/gi, 'expenses'],
  [/\b(reports?|رپورٹ)\b/gi, 'reports'],
  [/\b(settings?|ترتیبات)\b/gi, 'settings'],
  [/\b(help|madad|مدد)\b/gi, 'help'],
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

function findCustomer(customers, rawName) {
  const name = cleanName(rawName).toLowerCase();
  if (!name) return null;
  // exact match first, then "starts with", then "includes"
  return (
    customers.find((c) => c.name?.toLowerCase() === name) ||
    customers.find((c) => c.name?.toLowerCase().startsWith(name)) ||
    customers.find((c) => c.name?.toLowerCase().includes(name)) ||
    customers.find((c) => c.customerId?.toLowerCase() === name) ||
    null
  );
}

function money(n) {
  return `Rs ${Number(n).toLocaleString()}`;
}

// ------------------------------------------------------------
// Command patterns, tried in order. Each returns a handler
// context (name/value groups) when matched.
// ------------------------------------------------------------
const PATTERNS = [
  {
    key: 'navigate',
    regex: /^(?:go to|open|show|navigate to)\s+(dashboard|customers?|payments?|expenses?|reports?|settings?)\s*$/i,
  },
  {
    key: 'openCustomerDetail',
    regex: /^(?:open|show|view)\s+(?:customer\s+)?(.+?)(?:'s)?\s+(?:profile|details|record|info)$/i,
  },
  {
    key: 'openCustomerDetail',
    regex: /^(?:open|show|view)\s+customer\s+(.+)/i,
  },
  {
    key: 'addCustomer',
    regex: /^add(?:\s+a)?(?:\s+new)?\s+customer(?:\s+(?:named|called))?\s+(.+)/i,
  },
  {
    key: 'setBill',
    regex: /(?:set|update|change)\s+(.+?)(?:'s)?\s+(?:bill|monthly fee|package price|fee)\s+(?:to|as)\s+(.+)/i,
  },
  {
    key: 'setDues',
    regex: /(?:set|update|change)\s+(.+?)(?:'s)?\s+(?:pending dues|dues|balance|outstanding)\s+(?:to|as)\s+(.+)/i,
  },
  {
    key: 'addDues',
    regex: /add\s+(.+?)\s+(?:to|in)\s+(.+?)(?:'s)?\s+(?:pending dues|dues|balance)/i,
    order: ['value', 'name'],
  },
  {
    key: 'setStatus',
    regex: /(?:set|change|mark)\s+(.+?)(?:'s)?\s+status\s+(?:to|as)\s+(active|cut ?off|disable[d]?)/i,
  },
  {
    key: 'markPaid',
    regex: /(?:mark|set)\s+(.+?)\s+(?:as\s+)?paid/i,
  },
  {
    key: 'markUnpaid',
    regex: /(?:mark|set)\s+(.+?)\s+(?:as\s+)?unpaid/i,
  },
  {
    key: 'queryDues',
    regex: /(?:how much does|what does)\s+(.+?)\s+owe/i,
  },
  {
    key: 'queryDues',
    regex: /(.+?)(?:'s)?\s+(?:pending dues|balance|dues)\s*$/i,
  },
  {
    key: 'queryInfo',
    regex: /(?:find|search for|look up|show me)\s+(?:customer\s+)?(.+)/i,
  },
  {
    key: 'help',
    regex: /^(help|what can you do|what can i say|commands)/i,
  },
];

function matchCommand(transcript) {
  const text = normalizeMultilingual(transcript.trim().replace(/[.?!]+$/, ''));
  for (const p of PATTERNS) {
    const m = text.match(p.regex);
    if (m) return { key: p.key, groups: m.slice(1), order: p.order };
  }
  return null;
}

/**
 * Executes a parsed voice command.
 * ctx = { API, navigate, getCustomers } where getCustomers()
 * returns a (cached) array of customers already fetched from
 * the existing GET /api/customers endpoint - no extra storage.
 */
export async function runVoiceCommand(transcript, ctx) {
  const match = matchCommand(transcript);
  if (!match) {
    return {
      ok: false,
      message: `Sorry, I didn't understand: "${transcript}". Try saying "help" to hear what I can do.`,
    };
  }

  const { key, groups, order } = match;

  if (key === 'help') {
    return {
      ok: true,
      message:
        'You can say things like: "open customers", "set John\'s bill to fifteen hundred", ' +
        '"mark John as paid", "set John\'s status to cut off", "how much does John owe", ' +
        '"open John\'s profile", or "add customer John with fee 1500".',
    };
  }

  if (key === 'navigate') {
    const target = groups[0].toLowerCase().replace(/s$/, '');
    const path = PAGE_MAP[target] || PAGE_MAP[target + 's'];
    if (!path) return { ok: false, message: `I don't know a page called ${groups[0]}.` };
    ctx.navigate(path);
    return { ok: true, message: `Opening ${target}.` };
  }

  // Everything below needs the customer list
  const customers = await ctx.getCustomers();

  if (key === 'queryInfo') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: `I couldn't find a customer matching ${groups[0]}.` };
    ctx.navigate('/customers');
    return {
      ok: true,
      message: `${customer.name}: package ${customer.package || 'not set'}, monthly fee ${money(
        customer.monthlyFee
      )}, pending dues ${money(customer.pendingDues || 0)}, status ${customer.status}, payment ${customer.paymentStatus}.`,
    };
  }

  if (key === 'queryDues') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: `I couldn't find a customer matching ${groups[0]}.` };
    return { ok: true, message: `${customer.name} owes ${money(customer.pendingDues || 0)}.` };
  }

  if (key === 'openCustomerDetail') {
    const rawName = groups[0];
    const customer = findCustomer(customers, rawName);
    if (!customer) return { ok: false, message: `I couldn't find a customer matching ${rawName}.` };
    setPendingCustomerTarget({ customerId: customer.customerId, mongoId: customer._id }, 'view');
    ctx.navigate('/customers');
    return { ok: true, message: `Opening ${customer.name}'s profile.` };
  }

  if (key === 'addCustomer') {
    // Pull the name out of the remainder up to the first known slot keyword.
    const remainder = groups[0];
    const nameMatch = remainder.match(/^(.+?)(?:\s+with)?(?:\s+(?:package|fee|phone)\b|$)/i);
    const name = cleanName(nameMatch ? nameMatch[1] : remainder);
    if (!name) return { ok: false, message: "I didn't catch the customer's name." };

    const packageMatch = remainder.match(/package\s+([a-z0-9\s]+?)(?=\s+(?:fee|phone)\b|$)/i);
    const feeMatch = remainder.match(/(?:monthly\s+)?fee\s+([\w\s]+?)(?=\s+(?:phone|package)\b|$)/i);
    const phoneMatch = remainder.match(/phone(?:\s+number)?\s+([\d\s]+)/i);

    const monthlyFee = feeMatch ? wordsToNumber(feeMatch[1]) : null;
    if (monthlyFee == null) {
      return {
        ok: false,
        message: `I need a monthly fee to add ${name}. Try: "add customer ${name} with fee 1500".`,
      };
    }

    const today = new Date();
    const payload = {
      name,
      customerId: `VC-${Date.now().toString().slice(-6)}`,
      monthlyFee,
      pendingDues: 0,
      connectionDate: String(today.getDate()),
      package: packageMatch ? packageMatch[1].trim() : '',
      phone: phoneMatch ? phoneMatch[1].replace(/\s+/g, '') : '',
      status: 'Active',
      paymentStatus: 'Unpaid',
    };

    await ctx.API.post('/customers', payload);
    ctx.refreshCustomers();
    return { ok: true, message: `Added new customer ${name} with a monthly fee of ${money(monthlyFee)}.` };
  }

  if (key === 'setBill') {
    const [rawName, rawValue] = groups;
    const customer = findCustomer(customers, rawName);
    if (!customer) return { ok: false, message: `I couldn't find a customer matching ${rawName}.` };
    const amount = wordsToNumber(rawValue);
    if (amount == null) return { ok: false, message: `I didn't catch the amount for ${customer.name}.` };
    const before = customer.monthlyFee;
    await ctx.API.put(`/customers/${customer._id}`, { monthlyFee: amount });
    ctx.refreshCustomers();
    return { ok: true, message: `Updated ${customer.name}'s bill from ${money(before)} to ${money(amount)}.` };
  }

  if (key === 'setDues') {
    const [rawName, rawValue] = groups;
    const customer = findCustomer(customers, rawName);
    if (!customer) return { ok: false, message: `I couldn't find a customer matching ${rawName}.` };
    const amount = wordsToNumber(rawValue);
    if (amount == null) return { ok: false, message: `I didn't catch the amount for ${customer.name}.` };
    await ctx.API.put(`/customers/${customer._id}`, { pendingDues: amount });
    ctx.refreshCustomers();
    return { ok: true, message: `Set ${customer.name}'s pending dues to ${money(amount)}.` };
  }

  if (key === 'addDues') {
    let [rawValue, rawName] = groups;
    if (order && order[0] === 'name') [rawName, rawValue] = groups;
    const customer = findCustomer(customers, rawName);
    if (!customer) return { ok: false, message: `I couldn't find a customer matching ${rawName}.` };
    const amount = wordsToNumber(rawValue);
    if (amount == null) return { ok: false, message: `I didn't catch that amount.` };
    const newDues = (customer.pendingDues || 0) + amount;
    await ctx.API.put(`/customers/${customer._id}`, { pendingDues: newDues });
    ctx.refreshCustomers();
    return { ok: true, message: `Added ${money(amount)} to ${customer.name}'s dues. New balance is ${money(newDues)}.` };
  }

  if (key === 'setStatus') {
    const [rawName, rawStatus] = groups;
    const customer = findCustomer(customers, rawName);
    if (!customer) return { ok: false, message: `I couldn't find a customer matching ${rawName}.` };
    const normalized = rawStatus.toLowerCase().replace(/\s+/g, '');
    const statusMap = { active: 'Active', cutoff: 'Cut Off', disabled: 'Disable', disable: 'Disable' };
    const status = statusMap[normalized];
    if (!status) return { ok: false, message: `I don't recognize the status ${rawStatus}.` };
    await ctx.API.put(`/customers/${customer._id}`, { status });
    ctx.refreshCustomers();
    return { ok: true, message: `${customer.name}'s status is now ${status}.` };
  }

  if (key === 'markPaid') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: `I couldn't find a customer matching ${groups[0]}.` };
    await ctx.API.put(`/customers/${customer._id}`, { paymentStatus: 'Paid', pendingDues: 0 });
    try {
      await ctx.API.post('/payments', {
        receiptNumber: `VC-${Date.now()}`,
        customerId: customer.customerId,
        customerName: customer.name,
        amount: customer.monthlyFee,
        billingMonth: new Date().toLocaleString('en-US', { month: 'long' }),
        billingYear: new Date().getFullYear(),
        method: 'Cash',
        notes: 'Recorded via voice command',
      });
    } catch (e) {
      // Payment log is best-effort; the customer status update is what matters most.
    }
    ctx.refreshCustomers();
    return { ok: true, message: `Marked ${customer.name} as paid and cleared their dues.` };
  }

  if (key === 'markUnpaid') {
    const customer = findCustomer(customers, groups[0]);
    if (!customer) return { ok: false, message: `I couldn't find a customer matching ${groups[0]}.` };
    await ctx.API.put(`/customers/${customer._id}`, { paymentStatus: 'Unpaid' });
    ctx.refreshCustomers();
    return { ok: true, message: `Marked ${customer.name} as unpaid.` };
  }

  return { ok: false, message: "I understood the command type but couldn't complete it." };
}

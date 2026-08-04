const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

dotenv.config();
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '5mb' }));

// =====================================================
// MODELS (kept in this single file on purpose - this is
// the file Vercel actually runs, per backend/vercel.json)
// =====================================================
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, default: '' },
  fullName: { type: String, default: '' },
  profilePicture: { type: String, default: '' },
  brandName: { type: String, default: 'ZEEP BROAD BRAND' },
  password: { type: String, required: true },
  role: { type: String, default: 'admin' }
});

const CustomerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  customerId: { type: String, required: true, unique: true },
  package: { type: String, default: '' },
  monthlyFee: { type: Number, required: true },
  connectionDate: { type: String, default: '' },
  pendingDues: { type: Number, default: 0 },
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
  status: { type: String, enum: ['Active', 'Cut Off', 'Disable'], default: 'Active' },
  paymentStatus: { type: String, enum: ['Unpaid', 'Paid', '1 YEAR ADVANCED', 'FREE'], default: 'Unpaid' }
}, { timestamps: true });

const PaymentSchema = new mongoose.Schema({
  receiptNumber: { type: String, required: true, unique: true },
  date: { type: Date, default: Date.now },
  customerId: { type: String, required: true },
  customerName: { type: String, default: '' },
  amount: { type: Number, required: true },
  billingMonth: { type: String, default: '' },
  billingYear: { type: Number, default: () => new Date().getFullYear() },
  method: { type: String, enum: ['Cash', 'Bank Transfer', 'Easypaisa', 'JazzCash', 'Other'], default: 'Cash' },
  notes: { type: String, default: '' }
}, { timestamps: true });

const ExpenseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  amount: { type: Number, required: true },
  category: {
    type: String,
    enum: ['Utilities', 'Salaries', 'Equipment', 'Maintenance', 'Marketing', 'Office', 'Internet', 'Other'],
    default: 'Other'
  },
  date: { type: Date, default: Date.now },
  description: { type: String, default: '' }
}, { timestamps: true });

// Single shared document (key: 'global') holding app-wide settings, e.g. the
// sliding text shown in the header. Lives on the server (not localStorage) so
// every admin/device sees the same banner.
const AppSettingSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },
  bannerText: { type: String, default: 'Welcome AT Muhammad Shah Panel' }
}, { timestamps: true });

// Audit trail: one document per change to a customer's record - who did it,
// exactly which fields moved from what to what, and when (via timestamps).
// This is intentionally append-only (nothing here ever gets edited/deleted
// by the app itself) so it can be trusted as a compliance record.
const ActivityLogSchema = new mongoose.Schema({
  user: { type: String, default: 'Unknown' },        // readable username, not just an ID
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true },          // e.g. "Customer Updated"
  module: { type: String, enum: ['Customers', 'Payments', 'Expenses', 'Auth', 'System'], default: 'Customers' },
  entityType: { type: String, default: '' },         // e.g. "Customer"
  entityId: { type: mongoose.Schema.Types.ObjectId }, // the customer's _id this entry is about
  changes: [{
    field: String,
    from: mongoose.Schema.Types.Mixed,
    to: mongoose.Schema.Types.Mixed
  }],
  // If this "Customer Updated" entry auto-created a "Pending Dues Cleared"
  // Payment (because pendingDues was lowered), this points at that Payment.
  // Undo uses it to delete the payment too, so an accidental dues edit
  // doesn't leave stray money sitting in "collected" after the undo.
  linkedPaymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
  details: { type: String, default: '' },            // human-readable one-line summary
  ip: { type: String, default: '' }
}, { timestamps: true });

// One document per "Generate Bill" action - a locked-in snapshot of that
// billing period's numbers (Total Recovery, Total Collected, etc.), plus
// what the rollover did. Once created for a monthKey it is never edited, so
// opening a past month always shows exactly what it showed the day it was
// closed, no matter how today's live numbers have moved since.
const MonthlyBillingSchema = new mongoose.Schema({
  monthKey: { type: String, required: true, unique: true },  // e.g. "2026-08"
  monthLabel: { type: String, required: true },               // e.g. "August 2026"
  generatedBy: { type: String, default: 'Unknown' },
  periodStart: { type: Date, required: true }, // previous generation's periodEnd (or account start)
  periodEnd: { type: Date, required: true },   // the moment this bill was generated
  totalCustomers: { type: Number, default: 0 },
  activeCustomers: { type: Number, default: 0 },
  paidCount: { type: Number, default: 0 },
  unpaidCount: { type: Number, default: 0 },
  totalRevenue: { type: Number, default: 0 },   // this cycle's billed fees (Active customers)
  totalDues: { type: Number, default: 0 },       // pendingDues total at close, before rollover
  totalRecovery: { type: Number, default: 0 },   // everything owed at close (dues + unpaid fee)
  totalCollected: { type: Number, default: 0 },  // payments received during [periodStart, periodEnd]
  rolledOverCount: { type: Number, default: 0 }  // customers whose unpaid fee moved into dues
}, { timestamps: true });

// Reuse existing models on hot-reload / repeated invocation instead of
// throwing "Cannot overwrite model once compiled".
const User = mongoose.models.User || mongoose.model('User', UserSchema);
const Customer = mongoose.models.Customer || mongoose.model('Customer', CustomerSchema);
const Payment = mongoose.models.Payment || mongoose.model('Payment', PaymentSchema);
const Expense = mongoose.models.Expense || mongoose.model('Expense', ExpenseSchema);
const AppSetting = mongoose.models.AppSetting || mongoose.model('AppSetting', AppSettingSchema);
const ActivityLog = mongoose.models.ActivityLog || mongoose.model('ActivityLog', ActivityLogSchema);
const MonthlyBilling = mongoose.models.MonthlyBilling || mongoose.model('MonthlyBilling', MonthlyBillingSchema);

// =====================================================
// DATABASE (cached connection so it survives warm
// serverless invocations on Vercel)
// =====================================================
let cached = global.mongoose;
if (!cached) cached = global.mongoose = { conn: null, promise: null };

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI, {
      bufferCommands: false
    }).then(m => {
      console.log('MongoDB Connected');
      return m;
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

// Make sure every request has a DB connection before hitting a route
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error('DB connection error:', error.message);
    res.status(500).json({ success: false, message: 'Database connection failed' });
  }
});

// =====================================================
// AUTH MIDDLEWARE
// =====================================================
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

const auth = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ success: false, message: 'No token provided. Access denied.' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    req.username = decoded.username;
    if (!req.username) {
      // Token was issued before usernames were embedded in it - look it up
      // once so audit-log entries still show a name instead of a raw ID.
      const u = await User.findById(decoded.id).select('username');
      req.username = u?.username || 'Unknown';
    }
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token. Please login again.' });
  }
};

// Records one audit-trail entry. Never throws into the caller - a logging
// hiccup should never block the actual customer change from saving.
const logActivity = async ({ req, action, module = 'Customers', entityType = '', entityId = null, changes = [], details = '', linkedPaymentId = null }) => {
  try {
    await ActivityLog.create({
      user: req.username || 'Unknown',
      userId: req.userId,
      action,
      module,
      entityType,
      entityId,
      changes,
      details,
      linkedPaymentId,
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || ''
    });
  } catch (e) {
    console.error('Activity log error:', e.message);
  }
};

// Fields tracked for the customer change-history / audit log feature.
const CUSTOMER_TRACKED_FIELDS = [
  'name', 'customerId', 'package', 'monthlyFee', 'connectionDate',
  'pendingDues', 'phone', 'address', 'status', 'paymentStatus'
];

function diffCustomerFields(oldDoc, newBody) {
  const changes = [];
  for (const field of CUSTOMER_TRACKED_FIELDS) {
    if (!(field in newBody)) continue;
    const oldVal = oldDoc[field] ?? '';
    const newVal = newBody[field] ?? '';
    if (String(oldVal) !== String(newVal)) {
      changes.push({ field, from: oldVal, to: newVal });
    }
  }
  return changes;
}

function formatChanges(changes) {
  return changes.map(c => `${c.field}: "${c.from}" \u2192 "${c.to}"`).join('; ');
}

// =====================================================
// HELPERS
// =====================================================
const formatPhoneForWhatsApp = (phone) => {
  let digits = (phone || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '92' + digits.slice(1);
  return digits;
};

// Shared WhatsApp reminder text for both the single-send and bulk-send
// routes, so the wording never drifts between the two. Pending dues are
// only mentioned when there actually are some, to avoid a confusing
// "Pending dues: PKR 0" line on a fully caught-up customer.
const buildReminderMessage = (c) => {
  const duesLine = c.pendingDues > 0 ? ` You also have pending dues of PKR ${c.pendingDues}.` : '';
  return (
    `Dear ${c.name}, this is a reminder that your internet bill of PKR ${c.monthlyFee} is due.${duesLine} Please clear it at your earliest convenience.\n\n` +
    `*💳 Online Payment Options*\n\n` +
    `📱 *JazzCash*\n03000878181\n_Syed Muhammad Bin Haider_\n\n` +
    `🔗 *Raast ID*\n03000878181\n_M. Bin Haider_\n\n` +
    `🏦 *HBL Bank*\n12727900655203\n_M. Bin Haider_\n\n` +
    `⚠️ *Please send a screenshot of the payment after transferring - payment will not be accepted without it.*\n\n` +
    `Thank you.`
  );
};

const startOfThisMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

// HEALTH
// =====================================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server running on Vercel!' });
});

// =====================================================
// AUTH ROUTES
// =====================================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid password' });

    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: { id: user._id, username: user.username, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/auth/logout', auth, (req, res) => {
  res.json({ success: true, message: 'Logged out' });
});

app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/auth/change-username', auth, async (req, res) => {
  try {
    const { newUsername } = req.body;
    if (!newUsername || newUsername.trim().length < 3) {
      return res.status(400).json({ success: false, message: 'Username must be at least 3 characters' });
    }
    const existing = await User.findOne({ username: newUsername.trim(), _id: { $ne: req.userId } });
    if (existing) return res.status(400).json({ success: false, message: 'Username already taken' });

    const user = await User.findByIdAndUpdate(
      req.userId,
      { username: newUsername.trim() },
      { new: true }
    ).select('-password');

    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Used by the "Edit Profile" popup (click your name, top-right) to update
// display name (fullName) and email. Separate from change-username above.
app.put('/api/auth/update', auth, async (req, res) => {
  try {
    const { fullName, email } = req.body;
    if (!fullName || fullName.trim() === '') {
      return res.status(400).json({ success: false, message: 'Name cannot be empty' });
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { fullName: fullName.trim(), email: (email || '').trim() },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Profile picture is stored on the User document (as a base64 data URL) so
// it follows the account across devices/browsers, instead of only living
// in one browser's localStorage.
app.put('/api/auth/profile-picture', auth, async (req, res) => {
  try {
    const { profilePicture } = req.body;
    if (!profilePicture || !profilePicture.startsWith('data:image/')) {
      return res.status(400).json({ success: false, message: 'Invalid image data' });
    }
    // Roughly enforce the same 2MB limit the frontend already checks client-side.
    const approxBytes = profilePicture.length * 0.75;
    if (approxBytes > 2 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Image must be less than 2MB' });
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { profilePicture },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/auth/profile-picture', auth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.userId,
      { profilePicture: '' },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// The text shown top-left of the sidebar (default "ZEEP BROAD BRAND") -
// kept separate from /auth/update since this is the business's brand
// name, not the logged-in person's own display name.
app.put('/api/auth/brand-name', auth, async (req, res) => {
  try {
    const { brandName } = req.body;
    if (!brandName || !brandName.trim()) {
      return res.status(400).json({ success: false, message: 'Brand name cannot be empty' });
    }
    const trimmed = brandName.trim().slice(0, 40);

    const user = await User.findByIdAndUpdate(
      req.userId,
      { brandName: trimmed },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/auth/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Current password is incorrect' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =====================================================
// CUSTOMER ROUTES
// =====================================================
app.get('/api/customers', auth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 0;
    let customers = await Customer.find();

    // connectionDate is stored as a string ("1.0", "27.0", etc.), so a normal
    // Mongo/string sort would put "10.0" before "2.0". Sort numerically by
    // day instead, so Day 1 customers come first, then Day 2, and so on.
    customers.sort((a, b) => {
      const dayA = parseFloat(a.connectionDate);
      const dayB = parseFloat(b.connectionDate);
      const safeA = isNaN(dayA) ? 999 : dayA;
      const safeB = isNaN(dayB) ? 999 : dayB;
      if (safeA !== safeB) return safeA - safeB;
      return (a.name || '').localeCompare(b.name || '');
    });

    if (limit) customers = customers.slice(0, limit);
    res.json({ success: true, data: customers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/customers', auth, async (req, res) => {
  try {
    const customer = new Customer(req.body);
    await customer.save();

    await logActivity({
      req,
      action: 'Customer Added',
      entityType: 'Customer',
      entityId: customer._id,
      details: `Added customer ${customer.name} (${customer.customerId})`
    });

    res.status(201).json({ success: true, data: customer });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/customers/:id', auth, async (req, res) => {
  try {
    const existing = await Customer.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Customer not found' });

    // Snapshot exactly what's changing BEFORE the update overwrites it, so
    // the audit trail can show old value -> new value for every field.
    const changes = diffCustomerFields(existing, req.body);

    // If pendingDues is being LOWERED, that difference is money the customer
    // just paid off - it should count as collected revenue, not just vanish
    // from the dues total. We record it as a real Payment (so it shows up in
    // "Total Collected" / dashboard collections) for exactly the amount
    // cleared - never for an increase in dues, and never more than what was
    // actually reduced.
    const oldPendingDues = existing.pendingDues || 0;
    let duesClearedAmount = 0;
    if ('pendingDues' in req.body) {
      const newPendingDues = parseFloat(req.body.pendingDues) || 0;
      if (newPendingDues < oldPendingDues) {
        duesClearedAmount = oldPendingDues - newPendingDues;
      }
    }

    const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true });

    // Create the auto-payment BEFORE logging "Customer Updated" so that log
    // entry can point at it. That link is what lets Undo clean up the
    // payment too, instead of leaving it stuck in "collected" forever.
    let duesPayment = null;
    if (duesClearedAmount > 0) {
      const receiptNumber = `RCPT-DUES-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      duesPayment = await Payment.create({
        receiptNumber,
        customerId: customer.customerId,
        customerName: customer.name,
        amount: duesClearedAmount,
        billingMonth: 'Pending Dues Cleared',
        method: req.body.duesPaymentMethod || 'Cash',
        notes: `Auto-recorded: pending dues reduced from PKR ${oldPendingDues} to PKR ${customer.pendingDues || 0}`
      });
    }

    if (changes.length > 0) {
      await logActivity({
        req,
        action: 'Customer Updated',
        entityType: 'Customer',
        entityId: customer._id,
        changes,
        details: `Updated ${customer.name} (${customer.customerId}): ${formatChanges(changes)}`,
        linkedPaymentId: duesPayment ? duesPayment._id : null
      });
    }

    if (duesPayment) {
      await logActivity({
        req,
        action: 'Pending Dues Cleared',
        entityType: 'Customer',
        entityId: customer._id,
        details: `PKR ${duesClearedAmount} of pending dues cleared for ${customer.name} (${customer.customerId}) - added to collected amount, removed from pending dues`
      });
    }

    res.json({ success: true, data: customer, duesPayment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc  Bulk-import phone numbers matched by customerId (e.g. from a CSV of
//        numbers recovered from old PDFs/receipts). This only ever UPDATES
//        customers who already exist in the website - it never creates a new
//        customer. Matching happens in three passes, each one only used if
//        the previous one didn't find anything, so the safest match always
//        wins:
//          1. Exact customerId match (case + spacing must match exactly).
//          2. Same customerId but ignoring case/punctuation/spacing - catches
//             things like "M68.Krachi.Sale.Mala" vs "M68KrachiSaleMala", or a
//             different case. Only used when the normalized form is unique
//             across all customers, so it can never guess wrong between two
//             similar IDs.
//          3. The PDF's name column matched against the customer's stored
//             name (same case/punctuation-insensitive comparison) - only
//             used when that normalized name matches exactly ONE customer,
//             and only as a last resort after both ID passes fail.
//        Anything that still doesn't match is reported back, never guessed.
const normalizeForMatch = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');

app.post('/api/customers/import-phones', auth, async (req, res) => {
  try {
    const records = Array.isArray(req.body.records) ? req.body.records : [];
    if (records.length === 0) {
      return res.status(400).json({ success: false, message: 'No records provided' });
    }

    const allCustomers = await Customer.find();

    // Normalized-ID index - only keep keys that map to exactly ONE customer,
    // so this pass can never pick the wrong one between two similar IDs.
    const idIndex = new Map(); // normalizedId -> customer | 'AMBIGUOUS'
    for (const c of allCustomers) {
      const key = normalizeForMatch(c.customerId);
      if (!key) continue;
      idIndex.set(key, idIndex.has(key) ? 'AMBIGUOUS' : c);
    }

    // Normalized-name index - same "only if unique" safety rule.
    const nameIndex = new Map(); // normalizedName -> customer | 'AMBIGUOUS'
    for (const c of allCustomers) {
      const key = normalizeForMatch(c.name);
      if (!key) continue;
      nameIndex.set(key, nameIndex.has(key) ? 'AMBIGUOUS' : c);
    }

    let updated = 0;
    let unchanged = 0;
    let updatedViaNormalizedId = 0;
    let updatedViaName = 0;
    const notFound = [];

    for (const rec of records) {
      const customerId = (rec.customerId || '').toString().trim();
      const name = (rec.name || '').toString().trim();
      const phone = (rec.phone || '').toString().trim();
      if (!customerId || !phone) continue;

      let existing = await Customer.findOne({ customerId });
      let matchMethod = 'exact';

      if (!existing) {
        const byId = idIndex.get(normalizeForMatch(customerId));
        if (byId && byId !== 'AMBIGUOUS') {
          existing = byId;
          matchMethod = 'normalized-id';
        }
      }

      if (!existing && name) {
        const byName = nameIndex.get(normalizeForMatch(name));
        if (byName && byName !== 'AMBIGUOUS') {
          existing = byName;
          matchMethod = 'name';
        }
      }

      if (!existing) {
        notFound.push(name ? `${customerId} (${name})` : customerId);
        continue;
      }

      if (existing.phone === phone) {
        unchanged++;
        continue;
      }

      const oldPhone = existing.phone || '(none)';
      existing.phone = phone;
      await existing.save();
      updated++;
      if (matchMethod === 'normalized-id') updatedViaNormalizedId++;
      if (matchMethod === 'name') updatedViaName++;

      const matchNote = matchMethod === 'exact' ? '' : ` [matched by ${matchMethod === 'name' ? 'name' : 'customerId, ignoring case/punctuation'} - the import file said "${customerId}"]`;
      await logActivity({
        req,
        action: 'Customer Updated',
        entityType: 'Customer',
        entityId: existing._id,
        changes: [{ field: 'phone', from: oldPhone, to: phone }],
        details: `Updated ${existing.name} (${existing.customerId}): phone: "${oldPhone}" \u2192 "${phone}" (bulk phone import${matchNote})`
      });
    }

    res.json({
      success: true,
      data: {
        updated,
        updatedViaNormalizedId,
        updatedViaName,
        unchanged,
        notFoundCount: notFound.length,
        notFound
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/customers/:id', auth, async (req, res) => {
  try {
    const customer = await Customer.findByIdAndDelete(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    await logActivity({
      req,
      action: 'Customer Deleted',
      entityType: 'Customer',
      entityId: customer._id,
      details: `Deleted customer ${customer.name} (${customer.customerId}) - pending dues at time of deletion: PKR ${customer.pendingDues || 0}`
    });

    res.json({ success: true, message: 'Customer deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc  Full change history for one customer - who changed what and when.
//        Kept even after the customer is deleted (entityId still matches),
//        so this doubles as the compliance record for removed accounts.
app.get('/api/customers/:id/history', auth, async (req, res) => {
  try {
    const logs = await ActivityLog.find({ entityType: 'Customer', entityId: req.params.id })
      .sort({ createdAt: -1 })
      .limit(300);
    res.json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc  Undo a single "Customer Updated" log entry - puts every field it
//        changed back to its recorded "from" value. This is the safety net
//        for accidental edits (e.g. clearing someone's pending dues, or
//        marking the wrong customer Paid): find the entry in the history,
//        undo it, done - no need to remember and retype the old numbers.
//        A fresh "Customer Updated" entry is logged for the undo itself, so
//        the audit trail always shows the truth of what actually happened.
app.post('/api/activity-logs/:id/undo', auth, async (req, res) => {
  try {
    const log = await ActivityLog.findById(req.params.id);
    if (!log) return res.status(404).json({ success: false, message: 'Log entry not found' });
    if (log.action !== 'Customer Updated' || !log.changes || log.changes.length === 0) {
      return res.status(400).json({ success: false, message: 'This entry has nothing that can be undone' });
    }

    const customer = await Customer.findById(log.entityId);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'That customer no longer exists - cannot undo' });
    }

    // Rebuild the pre-change values from the log's own "from" side.
    const revertBody = {};
    log.changes.forEach((c) => {
      revertBody[c.field] = c.from;
    });

    const changes = diffCustomerFields(customer, revertBody);
    const updated = await Customer.findByIdAndUpdate(log.entityId, revertBody, { new: true });

    // If this update had auto-recorded a "Pending Dues Cleared" payment
    // (pendingDues got lowered, on purpose or by mistake), undoing the
    // pendingDues field back is not enough on its own - that payment is
    // still sitting in the Payments collection and still counted in
    // "Total Collected" on the dashboard. Remove it too so the undo is
    // actually complete.
    let removedPayment = null;
    if (log.linkedPaymentId) {
      removedPayment = await Payment.findByIdAndDelete(log.linkedPaymentId);
    }

    if (changes.length > 0) {
      await logActivity({
        req,
        action: 'Customer Updated',
        entityType: 'Customer',
        entityId: updated._id,
        changes,
        details: `Undid a previous change for ${updated.name} (${updated.customerId}): ${formatChanges(changes)}`
      });
    }

    if (removedPayment) {
      await logActivity({
        req,
        action: 'Pending Dues Cleared',
        entityType: 'Customer',
        entityId: updated._id,
        details: `Undo reversed: removed the auto-recorded PKR ${removedPayment.amount} "Pending Dues Cleared" payment for ${updated.name} (${updated.customerId}) - it no longer counts toward collected amount`
      });
    }

    res.json({ success: true, data: updated, removedPayment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc  Company-wide activity/audit log - every recorded change across every
//        customer, newest first. This is the general "Activity Log" section
//        (as opposed to /api/customers/:id/history, which is scoped to one
//        customer). Supports optional ?module= and ?action= filters and a
//        ?limit= (defaults to 300, capped at 1000 so one request can't pull
//        the entire collection).
app.get('/api/activity-logs', auth, async (req, res) => {
  try {
    const { module: moduleFilter, action, limit } = req.query;
    const query = {};
    if (moduleFilter) query.module = moduleFilter;
    if (action) query.action = action;
    const capped = Math.min(parseInt(limit) || 300, 1000);
    const logs = await ActivityLog.find(query).sort({ createdAt: -1 }).limit(capped);
    res.json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =====================================================
// PAYMENT ROUTES
// =====================================================
app.get('/api/payments', auth, async (req, res) => {
  try {
    const payments = await Payment.find().sort({ date: -1 });
    res.json({ success: true, data: payments });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/payments/summary', auth, async (req, res) => {
  try {
    const monthStart = startOfThisMonth();
    const [allAgg, monthAgg, totalTransactions, monthlyTransactions] = await Promise.all([
      Payment.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
      Payment.aggregate([
        { $match: { date: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      Payment.countDocuments(),
      Payment.countDocuments({ date: { $gte: monthStart } })
    ]);

    res.json({
      success: true,
      data: {
        totalCollected: allAgg[0]?.total || 0,
        monthlyCollection: monthAgg[0]?.total || 0,
        totalTransactions,
        monthlyTransactions
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/payments', auth, async (req, res) => {
  try {
    const { customerId, amount, billingMonth, method, notes } = req.body;
    const customer = await Customer.findOne({ customerId });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const receiptNumber = `RCPT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const payment = new Payment({
      receiptNumber,
      customerId,
      customerName: customer.name,
      amount,
      billingMonth,
      method,
      notes
    });
    await payment.save();

    res.status(201).json({ success: true, data: payment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/payments/:id', auth, async (req, res) => {
  try {
    const { amount, billingMonth, method, notes } = req.body;
    const payment = await Payment.findByIdAndUpdate(
      req.params.id,
      { amount, billingMonth, method, notes },
      { new: true }
    );
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    res.json({ success: true, data: payment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/payments/:id', auth, async (req, res) => {
  try {
    const payment = await Payment.findByIdAndDelete(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    res.json({ success: true, message: 'Payment deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =====================================================
// EXPENSE ROUTES
// =====================================================
app.get('/api/expenses', auth, async (req, res) => {
  try {
    const expenses = await Expense.find().sort({ date: -1 });
    res.json({ success: true, data: expenses });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/expenses/summary', auth, async (req, res) => {
  try {
    const monthStart = startOfThisMonth();
    const [allAgg, monthAgg, totalTransactions, categoryAgg] = await Promise.all([
      Expense.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
      Expense.aggregate([
        { $match: { date: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      Expense.countDocuments(),
      Expense.aggregate([{ $group: { _id: '$category', total: { $sum: '$amount' } } }])
    ]);

    const categories = {};
    categoryAgg.forEach(c => { categories[c._id] = c.total; });

    res.json({
      success: true,
      data: {
        totalExpenses: allAgg[0]?.total || 0,
        monthlyExpenses: monthAgg[0]?.total || 0,
        totalTransactions,
        categories
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/expenses', auth, async (req, res) => {
  try {
    const expense = new Expense(req.body);
    await expense.save();
    res.status(201).json({ success: true, data: expense });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/expenses/:id', auth, async (req, res) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' });
    res.json({ success: true, message: 'Expense deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =====================================================
// MONTHLY BILLING ROUTES
// "Generate Bill" closes out the current billing period: it locks in that
// period's Total Recovery / Total Collected numbers forever (so looking
// back at "August" always shows what August actually looked like, even
// after September's numbers move on), then rolls every still-Unpaid
// Active customer's monthly fee into their pending dues and resets them
// to Unpaid for the new period. Cut Off/Disabled customers and customers
// on '1 YEAR ADVANCED'/'FREE' are left untouched, same as everywhere else
// in the app.
// =====================================================

// Shared by both the live preview and the real generate action, so the
// numbers a user sees in the preview are exactly what generating would
// lock in.
const computeBillingSnapshot = async (periodStart, periodEnd) => {
  const customers = await Customer.find();
  const totalCustomers = customers.length;
  const activeCustomers = customers.filter((c) => c.status === 'Active').length;
  const paidCount = customers.filter((c) => c.paymentStatus === 'Paid' || c.paymentStatus === '1 YEAR ADVANCED').length;
  const unpaidCount = customers.filter((c) => c.paymentStatus === 'Unpaid').length;

  const totalRevenue = customers
    .filter((c) => c.status === 'Active')
    .reduce((sum, c) => sum + (c.monthlyFee || 0), 0);
  const totalDues = customers.reduce((sum, c) => sum + (c.pendingDues || 0), 0);

  const amountOwed = (c) =>
    (c.pendingDues || 0) + (c.status === 'Active' && c.paymentStatus === 'Unpaid' ? (c.monthlyFee || 0) : 0);
  const totalRecovery = customers.reduce((sum, c) => sum + amountOwed(c), 0);

  const rolledOverCount = customers.filter((c) => c.status === 'Active' && c.paymentStatus === 'Unpaid').length;

  const collectedAgg = await Payment.aggregate([
    { $match: { date: { $gte: periodStart, $lte: periodEnd } } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const totalCollected = collectedAgg[0]?.total || 0;

  return {
    totalCustomers, activeCustomers, paidCount, unpaidCount,
    totalRevenue, totalDues, totalRecovery, totalCollected, rolledOverCount
  };
};

// @desc  Every past generated month, most recent first - the list used to
//        jump back to any previous month's locked-in numbers.
app.get('/api/billing', auth, async (req, res) => {
  try {
    const bills = await MonthlyBilling.find().sort({ periodEnd: -1 });
    res.json({ success: true, data: bills });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc  One past month's locked-in snapshot, by its monthKey (e.g. "2026-08").
app.get('/api/billing/:monthKey', auth, async (req, res) => {
  try {
    const bill = await MonthlyBilling.findOne({ monthKey: req.params.monthKey });
    if (!bill) return res.status(404).json({ success: false, message: 'No bill generated for that month yet' });
    res.json({ success: true, data: bill });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc  Live numbers for the CURRENT, not-yet-generated period - what
//        generating right now would lock in. Also tells the frontend
//        whether a suggested monthKey has already been billed.
app.get('/api/billing-preview/now', auth, async (req, res) => {
  try {
    const lastBill = await MonthlyBilling.findOne().sort({ periodEnd: -1 });
    const periodStart = lastBill ? lastBill.periodEnd : new Date(0);
    const periodEnd = new Date();
    const snapshot = await computeBillingSnapshot(periodStart, periodEnd);
    res.json({
      success: true,
      data: {
        ...snapshot,
        periodStart,
        periodEnd,
        lastGeneratedMonth: lastBill ? { monthKey: lastBill.monthKey, monthLabel: lastBill.monthLabel } : null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc  Generate (close out) a billing month. Locks in the current
//        numbers under monthKey forever, then rolls unpaid fees into dues
//        and resets Active/Unpaid customers for the new period. Blocked if
//        that monthKey was already generated, so the same month can never
//        be double-billed.
app.post('/api/billing/generate', auth, async (req, res) => {
  try {
    const { monthKey, monthLabel } = req.body;
    if (!monthKey || !monthLabel) {
      return res.status(400).json({ success: false, message: 'monthKey and monthLabel are required' });
    }

    const already = await MonthlyBilling.findOne({ monthKey });
    if (already) {
      return res.status(400).json({ success: false, message: `${monthLabel} has already been generated` });
    }

    const lastBill = await MonthlyBilling.findOne().sort({ periodEnd: -1 });
    const periodStart = lastBill ? lastBill.periodEnd : new Date(0);
    const periodEnd = new Date();

    const snapshot = await computeBillingSnapshot(periodStart, periodEnd);

    // Roll the fee forward for anyone Active and still Unpaid, and start a
    // fresh cycle for everyone else Active (so a Paid customer isn't left
    // marked Paid forever). 1 YEAR ADVANCED / FREE / non-Active customers
    // are left exactly as they are.
    const activeCustomers = await Customer.find({ status: 'Active' });
    const bulkOps = activeCustomers
      .filter((c) => c.paymentStatus === 'Unpaid' || c.paymentStatus === 'Paid')
      .map((c) => {
        if (c.paymentStatus === 'Unpaid') {
          return {
            updateOne: {
              filter: { _id: c._id },
              update: { $inc: { pendingDues: c.monthlyFee || 0 }, $set: { paymentStatus: 'Unpaid' } }
            }
          };
        }
        // was Paid -> new cycle begins, nothing owed rolls over
        return {
          updateOne: {
            filter: { _id: c._id },
            update: { $set: { paymentStatus: 'Unpaid' } }
          }
        };
      });
    if (bulkOps.length > 0) {
      await Customer.bulkWrite(bulkOps);
    }

    const bill = await MonthlyBilling.create({
      monthKey,
      monthLabel,
      generatedBy: req.username || 'Unknown',
      periodStart,
      periodEnd,
      ...snapshot
    });

    await logActivity({
      req,
      action: 'Monthly Bill Generated',
      module: 'System',
      entityType: 'MonthlyBilling',
      entityId: bill._id,
      details: `Generated bill for ${monthLabel}: Total Recovery PKR ${snapshot.totalRecovery.toLocaleString()}, ` +
        `Total Collected PKR ${snapshot.totalCollected.toLocaleString()}, ${snapshot.rolledOverCount} customer(s) rolled into next cycle's dues`
    });

    res.status(201).json({ success: true, data: bill });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =====================================================
// DASHBOARD ROUTE
// This is the one the screenshot's error came from:
// the frontend reads res.data.data.stats, so the response
// MUST be shaped as { success, data: { stats, dailyData, recentCustomers } }
// =====================================================
app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const customers = await Customer.find();
    const expenses = await Expense.find();

    const totalCustomers = customers.length;
    const active = customers.filter(c => c.status === 'Active').length;
    const cutOff = customers.filter(c => c.status === 'Cut Off').length;
    const disable = customers.filter(c => c.status === 'Disable').length;

    const paid = customers.filter(c => c.paymentStatus === 'Paid' || c.paymentStatus === '1 YEAR ADVANCED').length;
    const unpaid = customers.filter(c => c.paymentStatus === 'Unpaid').length;

    // Total Revenue = recurring income from customers who are still Active.
    // The instant a customer is Cut Off or Disabled, their monthly fee drops
    // out of this figure (and out of Net Profit, since that's derived from
    // this) - that's the "cut" the client wants to see when someone is
    // disabled.
    const totalRevenue = customers
      .filter(c => c.status === 'Active')
      .reduce((sum, c) => sum + (c.monthlyFee || 0), 0);
    const totalDues = customers.reduce((sum, c) => sum + (c.pendingDues || 0), 0);

    // What's actually still owed by a customer = their tracked arrears
    // (pendingDues) PLUS this month's fee, but ONLY while they're Active
    // and unpaid. Once someone is Cut Off or Disabled, no new fee should
    // keep accruing on top of what they already owed - that's the "don't
    // add their fee to Total Recovery after cutting them off" fix - but
    // pendingDues (money genuinely owed from before) is never erased.
    const amountOwed = (c) =>
      (c.pendingDues || 0) + (c.status === 'Active' && c.paymentStatus === 'Unpaid' ? (c.monthlyFee || 0) : 0);

    // Total Recovery = everything still owed, from EVERY customer regardless
    // of status. Cutting someone off or disabling them doesn't erase what
    // they owe - you still want to recover it - so unlike Total Revenue
    // above, this figure does NOT drop when a customer's status changes.
    const totalRecovery = customers
      .reduce((sum, c) => sum + amountOwed(c), 0);
    const cutOffDues = customers
      .filter(c => c.status !== 'Active')
      .reduce((sum, c) => sum + amountOwed(c), 0);
    // Cleared pending dues are real cash collected too, not just a Paid
    // customer's monthly fee - so on top of the Paid/1 YEAR ADVANCED fee
    // total below, add every Payment that was auto-recorded when someone's
    // pendingDues got reduced (see PUT /api/customers/:id above).
    const duesClearedAgg = await Payment.aggregate([
      { $match: { billingMonth: 'Pending Dues Cleared' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const duesClearedTotal = duesClearedAgg[0]?.total || 0;

    const collected = customers
      .filter(c => c.paymentStatus === 'Paid' || c.paymentStatus === '1 YEAR ADVANCED')
      .reduce((sum, c) => sum + (c.monthlyFee || 0), 0) + duesClearedTotal;
    const pendingCollection = customers
      .filter(c => c.paymentStatus === 'Unpaid')
      .reduce((sum, c) => sum + (c.monthlyFee || 0), 0);

    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netProfit = totalRevenue - totalExpenses;

    const days = Array.from({ length: 31 }, (_, i) => i + 1);
    const dailyData = days.map(day => {
      const dayCustomers = customers.filter(c => {
        if (!c.connectionDate) return false;
        return parseFloat(c.connectionDate) === day;
      });
      return {
        day,
        count: dayCustomers.length,
        revenue: dayCustomers.reduce((sum, c) => sum + (c.monthlyFee || 0), 0)
      };
    });

    const recentCustomers = customers
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);

    res.json({
      success: true,
      data: {
        stats: {
          totalCustomers,
          active,
          cutOff,
          disable,
          paid,
          unpaid,
          totalRevenue,
          totalDues,
          totalRecovery,
          cutOffDues,
          collected,
          pendingCollection,
          totalExpenses,
          netProfit
        },
        dailyData,
        recentCustomers
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// =====================================================
// APP SETTINGS (header banner text, etc.)
// One shared document for the whole app - not per-user - so
// every admin/device sees the same header banner.
// =====================================================
app.get('/api/settings', auth, async (req, res) => {
  try {
    let setting = await AppSetting.findOne({ key: 'global' });
    if (!setting) {
      setting = await AppSetting.create({ key: 'global' });
    }
    res.json({ success: true, data: setting });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/settings', auth, async (req, res) => {
  try {
    const { bannerText } = req.body;
    if (typeof bannerText !== 'string' || !bannerText.trim()) {
      return res.status(400).json({ success: false, message: 'Banner text cannot be empty' });
    }
    const setting = await AppSetting.findOneAndUpdate(
      { key: 'global' },
      { bannerText: bannerText.trim() },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, data: setting });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =====================================================
// WHATSAPP ROUTES
// =====================================================
app.post('/api/whatsapp/send', auth, async (req, res) => {
  try {
    const { customerId } = req.body;
    const customer = await Customer.findOne({ customerId });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    if (!customer.phone) return res.status(400).json({ success: false, message: 'No phone number for this customer' });

    const phone = formatPhoneForWhatsApp(customer.phone);
    const message = buildReminderMessage(customer);
    const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

    res.json({ success: true, data: { whatsappUrl } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/whatsapp/bulk', auth, async (req, res) => {
  try {
    // By default this targets every Unpaid customer with a phone number.
    // If the person picked specific customers in the "Bulk WhatsApp" modal,
    // customerIds narrows it down to just that selection (still only ever
    // customers who are actually Unpaid, as a safety net). If they picked a
    // billing day instead (e.g. "day 2"), day narrows it down to just the
    // customers whose connectionDate (billing day of month) matches - so a
    // reminder run can target just today's (or any chosen day's) renewals.
    const { customerIds, day } = req.body || {};
    const query = { paymentStatus: 'Unpaid', phone: { $ne: '' } };
    if (Array.isArray(customerIds) && customerIds.length > 0) {
      query.customerId = { $in: customerIds };
    }

    let unpaidCustomers = await Customer.find(query);

    if (day !== undefined && day !== null && day !== '') {
      const targetDay = parseFloat(day);
      unpaidCustomers = unpaidCustomers.filter(
        (c) => c.connectionDate && parseFloat(c.connectionDate) === targetDay
      );
    }

    const links = unpaidCustomers
      .filter(c => c.phone)
      .map(c => {
        const phone = formatPhoneForWhatsApp(c.phone);
        const message = buildReminderMessage(c);
        return {
          customerId: c.customerId,
          name: c.name,
          phone: c.phone,
          monthlyFee: c.monthlyFee,
          pendingDues: c.pendingDues || 0,
          connectionDate: c.connectionDate || '',
          whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
        };
      });

    res.json({ success: true, data: links });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Local dev support: `node api/index.js` will still boot a server,
// while Vercel just imports `app` as a serverless function.

if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;

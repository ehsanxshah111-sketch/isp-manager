// One-time backfill: creates a missing "Monthly Fee" Payment record for any
// customer currently marked Paid or 1 YEAR ADVANCED whose money never got
// recorded as a real Payment (this happened before the fix to
// PUT /api/customers/:id, specifically for the 1 YEAR ADVANCED status).
//
// SAFE TO RE-RUN: for each customer it checks whether a Payment already
// exists for them with billingMonth 'Monthly Fee' created today or later
// than their last known unpaid state - to keep this simple and safe, it
// just checks whether ANY 'Monthly Fee' Payment exists for that customerId
// at all. If you've genuinely collected their fee more than once (e.g. two
// different months), do those extra entries by hand on the Payments page
// instead of re-running this - this script is only meant to fix the ONE-TIME
// gap for customers who were marked Paid/1 YEAR ADVANCED but never got their
// first Payment record.
//
// Usage:
//   cd backend
//   node scripts/backfillMissingPayments.js          (dry run - just prints)
//   node scripts/backfillMissingPayments.js --apply   (actually creates them)

const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const APPLY = process.argv.includes('--apply');

const CustomerSchema = new mongoose.Schema({}, { strict: false });
const PaymentSchema = new mongoose.Schema({}, { strict: false });
const Customer = mongoose.model('Customer', CustomerSchema, 'customers');
const Payment = mongoose.model('Payment', PaymentSchema, 'payments');

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not found - make sure you run this from the backend folder with your .env present.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to MongoDB. Mode: ${APPLY ? 'APPLY (will write)' : 'DRY RUN (no changes)'}\n`);

  const settledCustomers = await Customer.find({
    paymentStatus: { $in: ['Paid', '1 YEAR ADVANCED'] }
  });

  console.log(`Found ${settledCustomers.length} customer(s) currently marked Paid / 1 YEAR ADVANCED.\n`);

  let missingCount = 0;
  let missingTotal = 0;
  const toCreate = [];

  for (const c of settledCustomers) {
    const existingPayment = await Payment.findOne({
      customerId: c.customerId,
      billingMonth: 'Monthly Fee'
    });

    if (!existingPayment) {
      missingCount++;
      missingTotal += (c.monthlyFee || 0);
      toCreate.push(c);
      console.log(`  MISSING: ${c.name} (${c.customerId}) - PKR ${c.monthlyFee || 0} [${c.paymentStatus}]`);
    }
  }

  console.log(`\n${missingCount} customer(s) missing a Payment record, totalling PKR ${missingTotal}.`);

  if (!APPLY) {
    console.log('\nThis was a dry run - nothing was written. Review the list above, then re-run with --apply to create these Payment records.');
    await mongoose.disconnect();
    return;
  }

  console.log('\nCreating missing Payment records...');
  for (const c of toCreate) {
    const receiptNumber = `RCPT-BACKFILL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await Payment.create({
      receiptNumber,
      customerId: c.customerId,
      customerName: c.name,
      amount: c.monthlyFee || 0,
      billingMonth: 'Monthly Fee',
      method: 'Cash',
      notes: `Backfilled: was marked ${c.paymentStatus} but had no Payment record`
    });
    console.log(`  Created payment for ${c.name} - PKR ${c.monthlyFee || 0}`);
  }

  console.log(`\nDone. Created ${toCreate.length} payment record(s) totalling PKR ${missingTotal}.`);
  console.log('Refresh your Dashboard, Payments, and Monthly Billing pages - the totals should now match.');

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

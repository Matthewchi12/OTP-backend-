// ===== ADD THIS MODEL with your other models =====
const TransactionSchema = new mongoose.Schema({
  reference: { type: String, unique: true },
  email: String,
  userId: String,
  amount: Number,
  status: String,
  raw: Object,
  createdAt: { type: Date, default: Date.now }
});
const Transaction = mongoose.models.Transaction || mongoose.model("Transaction", TransactionSchema);

// ===== ADD THIS: Get fresh balance =====
app.get("/api/user/me", authMiddleware, async (req, res) => {
  const freshUser = await User.findById(req.user._id);
  res.json({ success: true, user: { id: freshUser._id, email: freshUser.email, balances: freshUser.balances } });
});

app.get("/api/user/balance", authMiddleware, async (req, res) => {
  const freshUser = await User.findById(req.user._id);
  res.json({ success: true, balances: freshUser.balances });
});

// ===== REPLACE YOUR PAYSTACK SECTION WITH THIS =====

async function verifyAndCredit(reference, res) {
  try {
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(500).json({ success: false, message: "PAYSTACK_SECRET_KEY missing in env" });
    }
    // Prevent double crediting
    const existingTx = await Transaction.findOne({ reference });
    if (existingTx && existingTx.status === 'success') {
      const user = await User.findById(existingTx.userId);
      return res.json({ success: true, message: "Already credited", amount: existingTx.amount, balances: user?.balances });
    }

    const r = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    const data = await r.json();
    
    if (data.data && data.data.status === 'success') {
      const paidEmail = data.data.customer.email.toLowerCase();
      const paidAmount = data.data.amount / 100;
      const paidRef = data.data.reference;

      // Find user
      let user = await User.findOne({ email: paidEmail });
      // If reference was created by logged-in user, use userId from Transaction if exists
      if (!user && existingTx) {
        user = await User.findById(existingTx.userId);
      }

      if (!user) {
        return res.status(404).json({ success: false, message: "User not found for email " + paidEmail });
      }

      // Credit ONLY if not credited before
      if (!existingTx || existingTx.status !== 'success') {
        user.balances = user.balances || getDefaultBalances();
        user.balances.nigeria = (Number(user.balances.nigeria) || 0) + paidAmount;
        user.markModified('balances');
        await user.save();

        await Transaction.findOneAndUpdate(
          { reference: paidRef },
          { 
            reference: paidRef,
            email: paidEmail,
            userId: user._id.toString(),
            amount: paidAmount,
            status: 'success',
            raw: data.data
          },
          { upsert: true, new: true }
        );
      }

      const freshUser = await User.findById(user._id);
      return res.json({ success: true, amount: paidAmount, email: freshUser.email, balances: freshUser.balances, reference: paidRef });
    } else {
      await Transaction.findOneAndUpdate(
        { reference },
        { reference, status: 'failed', raw: data },
        { upsert: true }
      );
      return res.json({ success: false, message: "Payment not successful", data });
    }
  } catch (e) { 
    console.log("Verify error:", e.message);
    return res.status(500).json({ success: false, message: e.message }); 
  }
}

// Initialize - NOW WITH AUTH so we know who paid
app.post('/api/pay/initialize', authMiddleware, async (req, res) => {
  try {
    const { amount, country } = req.body;
    const email = req.user.email; // use logged in user email, not body

    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(500).json({ success: false, message: "PAYSTACK_SECRET_KEY missing" });
    }
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount" });
    }

    const r = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        email,
        amount: Math.round(Number(amount) * 100),
        callback_url: 'https://matthewchi12.github.io/payment-success.html',
        metadata: { userId: req.user._id.toString(), country: country || 'nigeria' }
      })
    });
    const data = await r.json();
    
    if (data.status) {
      // Save pending transaction
      await Transaction.create({
        reference: data.data.reference,
        email,
        userId: req.user._id.toString(),
        amount: Number(amount),
        status: 'pending',
        raw: data.data
      });
    }
    
    res.json(data);
  } catch (e) { 
    console.log("Init error:", e.message);
    res.status(500).json({ success: false, message: e.message }); 
  }
});

app.get('/api/pay/verify', async (req, res) => { return verifyAndCredit(req.query.reference, res); });
app.get('/api/pay/verify/:reference', async (req, res) => { return verifyAndCredit(req.params.reference, res); });

// Webhook - Paystack will call this automatically (more reliable than callback)
app.post('/api/pay/webhook', express.json({ type: 'application/json' }), async (req, res) => {
  try {
    const event = req.body;
    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      // call verify logic but don't need response
      await verifyAndCredit(reference, { json: () => {} });
    }
    res.sendStatus(200);
  } catch (e) {
    res.sendStatus(200);
  }
});

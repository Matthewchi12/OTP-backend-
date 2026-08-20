const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

dotenv.config();
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";
const FIVESIM_KEY = process.env.FIVESIM_API_KEY || process.env.FIVESIM_KEY || "";
const MONGODB_URI = process.env.MONGODB_URI || "";
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || "";

const countries = [
  { code: "nigeria", name: "Nigeria", prefix: "+234", currency: "NGN", price: 1000, topups: [5000, 10000, 20000], fivesim: "nigeria" },
  { code: "usa", name: "USA", prefix: "+1", currency: "USD", price: 1, topups: [5, 10, 20], fivesim: "usa" },
  { code: "uk", name: "UK", prefix: "+44", currency: "GBP", price: 0.80, topups: [5, 10, 15], fivesim: "england" },
  { code: "canada", name: "Canada", prefix: "+1", currency: "CAD", price: 1.35, topups: [6, 13, 27], fivesim: "canada" },
  { code: "ghana", name: "Ghana", prefix: "+233", currency: "GHS", price: 12, topups: [60, 120, 240], fivesim: "ghana" },
  { code: "kenya", name: "Kenya", prefix: "+254", currency: "KES", price: 130, topups: [650, 1300, 2600], fivesim: "kenya" },
  { code: "india", name: "India", prefix: "+91", currency: "INR", price: 70, topups: [350, 700, 1400], fivesim: "india" },
  { code: "southafrica", name: "South Africa", prefix: "+27", currency: "ZAR", price: 18, topups: [90, 180, 360], fivesim: "southafrica" },
  { code: "germany", name: "Germany", prefix: "+49", currency: "EUR", price: 0.9, topups: [5, 9, 18], fivesim: "germany" },
  { code: "france", name: "France", prefix: "+33", currency: "EUR", price: 0.9, topups: [5, 9, 18], fivesim: "france" },
  { code: "spain", name: "Spain", prefix: "+34", currency: "EUR", price: 0.9, topups: [5, 9, 18], fivesim: "spain" },
  { code: "italy", name: "Italy", prefix: "+39", currency: "EUR", price: 0.9, topups: [5, 9, 18], fivesim: "italy" },
  { code: "australia", name: "Australia", prefix: "+61", currency: "AUD", price: 1.5, topups: [7, 15, 30], fivesim: "australia" },
  { code: "brazil", name: "Brazil", prefix: "+55", currency: "BRL", price: 5, topups: [25, 50, 100], fivesim: "brazil" },
  { code: "mexico", name: "Mexico", prefix: "+52", currency: "MXN", price: 18, topups: [90, 180, 360], fivesim: "mexico" },
];

if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Connected")).catch(e => console.log("❌ Mongo Error:", e.message));
}

const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true, lowercase: true },
  passwordHash: { type: String, default: null },
  authProvider: { type: String, enum: ["email", "google"], default: "email" },
  googleId: { type: String, default: null },
  name: { type: String, default: "" },
  picture: { type: String, default: "" },
  balances: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now }
});

const OrderSchema = new mongoose.Schema({
  id: String, userId: String, email: String, country: String, service: String, phone: String,
  fiveSimId: { type: String, default: null }, price: Number, status: String, otp: { type: String, default: null },
  isReal: Boolean, createdAt: { type: Date, default: Date.now }, expiresAt: Date
});

const TransactionSchema = new mongoose.Schema({
  reference: { type: String, unique: true },
  email: String, userId: String, amount: Number, status: String,
  raw: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model("User", UserSchema);
const Order = mongoose.models.Order || mongoose.model("Order", OrderSchema);
const Transaction = mongoose.models.Transaction || mongoose.model("Transaction", TransactionSchema);

function getDefaultBalances() { const b = {}; countries.forEach(c => b[c.code] = c.topups[1]); return b; }
function generateId() { return "ORD-" + Date.now() + "-" + Math.random().toString(36).slice(2,6); }
function generateToken(user) { return jwt.sign({ id: user._id.toString(), email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES }); }

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header ||!header.startsWith("Bearer ")) return res.status(401).json({ success: false, message: "No token" });
  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ success: false, message: "User not found" });
    req.user = user; next();
  } catch (e) { return res.status(401).json({ success: false, message: "Invalid token" }); }
}

app.get("/api/health", (req, res) => {
  res.json({ success: true, hasApiKey:!!FIVESIM_KEY, hasPaystack:!!PAYSTACK_SECRET, mongoConnected: mongoose.connection.readyState === 1 });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email ||!password) return res.status(400).json({ success: false, message: "Email and password required" });
    const cleanEmail = email.trim().toLowerCase();
    const exists = await User.findOne({ email: cleanEmail });
    if (exists) return res.status(409).json({ success: false, message: "Email exists" });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email: cleanEmail, passwordHash, balances: getDefaultBalances() });
    const token = generateToken(user);
    res.status(201).json({ success: true, token, user: { id: user._id, email: user.email, balances: user.balances } });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const cleanEmail = req.body.email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });
    if (!user) return res.status(401).json({ success: false, message: "Invalid email or password" });
    const match = await bcrypt.compare(req.body.password, user.passwordHash);
    if (!match) return res.status(401).json({ success: false, message: "Invalid email or password" });
    user.lastLogin = new Date(); await user.save();
    const token = generateToken(user);
    res.json({ success: true, token, user: { id: user._id, email: user.email, balances: user.balances } });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get("/api/user/me", authMiddleware, async (req, res) => {
  const fresh = await User.findById(req.user._id);
  res.json({ success: true, balances: fresh.balances, user: fresh });
});
app.get("/api/user/balance", authMiddleware, async (req, res) => {
  const fresh = await User.findById(req.user._id);
  res.json({ success: true, balances: fresh.balances });
});

// Buy order
app.post("/api/orders", authMiddleware, async (req, res) => {
  try {
    const { country, service } = req.body;
    const selectedCountry = countries.find(c => c.code === country);
    if (!selectedCountry) return res.status(400).json({ success: false, message: "Number is unavailable" });
    if (!FIVESIM_KEY) return res.status(400).json({ success: false, message: "Number is unavailable" });
    const price = selectedCountry.price;
    const userBalances = req.user.balances || getDefaultBalances();
    if ((userBalances[country] || 0) < price) {
      return res.status(400).json({ success: false, message: "insufficient balance add money" });
    }
    let realPhone = null; let fiveSimId = null;
    try {
      const resp = await fetch(`https://5sim.net/v1/user/buy/activation/${selectedCountry.fivesim}/any/${service}`, {
        headers: { Authorization: `Bearer ${FIVESIM_KEY}`, Accept: "application/json" }
      });
      const data = await resp.json();
      if (resp.ok && data.phone) { realPhone = data.phone; fiveSimId = data.id; }
      else return res.status(400).json({ success: false, message: "Number is unavailable" });
    } catch(e) { return res.status(400).json({ success: false, message: "Number is unavailable" }); }

    userBalances[country] -= price;
    req.user.balances = userBalances;
    req.user.markModified('balances');
    await req.user.save();
    const order = await Order.create({
      id: generateId(), userId: req.user._id.toString(), email: req.user.email,
      country, service, phone: realPhone, fiveSimId, price,
      status: "waiting", isReal:true, createdAt: new Date(), expiresAt: new Date(Date.now() + 15*60*1000)
    });
    const freshUser = await User.findById(req.user._id);
    res.json({ success: true, order, balances: freshUser.balances });
  } catch(e){ res.status(500).json({ success: false, message: "Number is unavailable" }); }
});

app.get("/api/orders/:orderId", authMiddleware, async (req, res) => {
  try {
    const order = await Order.findOne({ id: req.params.orderId, userId: req.user._id.toString() });
    if (!order) return res.status(404).json({ success: false, message: "Not found" });
    if (order.fiveSimId && FIVESIM_KEY &&!order.otp) {
      try {
        const resp = await fetch(`https://5sim.net/v1/user/check/${order.fiveSimId}`, { headers: { Authorization: `Bearer ${FIVESIM_KEY}`, Accept: "application/json" } });
        const data = await resp.json();
        if (data.sms && data.sms[0]) {
          order.otp = data.sms[0].code || data.sms[0].text?.match(/\d{4,6}/)?.[0];
          order.status = "received"; await order.save();
        }
      } catch(e){}
    }
    res.json({ success: true, order });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ===== PAYSTACK - NOW REFLECTS =====
async function verifyAndCredit(reference, res) {
  try {
    if (!PAYSTACK_SECRET) return res.status(500).json({ success: false, message: "PAYSTACK_SECRET_KEY missing" });
    const existingTx = await Transaction.findOne({ reference });
    if (existingTx && existingTx.status === 'success') {
      const user = await User.findById(existingTx.userId);
      return res.json({ success: true, message: "Already credited", amount: existingTx.amount, balances: user?.balances, reference });
    }
    const r = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    const data = await r.json();
    if (data.data && data.data.status === 'success') {
      const paidEmail = data.data.customer.email.toLowerCase();
      const paidAmount = data.data.amount / 100;
      const paidRef = data.data.reference;
      let user = await User.findOne({ email: paidEmail });
      if (!user && existingTx) user = await User.findById(existingTx.userId);
      if (!user) return res.status(404).json({ success: false, message: "User not found" });

      user.balances = user.balances || getDefaultBalances();
      user.balances.nigeria = (Number(user.balances.nigeria) || 0) + paidAmount;
      user.markModified('balances');
      await user.save();

      await Transaction.findOneAndUpdate(
        { reference: paidRef },
        { reference: paidRef, email: paidEmail, userId: user._id.toString(), amount: paidAmount, status: 'success', raw: data.data },
        { upsert: true }
      );
      const fresh = await User.findById(user._id);
      return res.json({ success: true, amount: paidAmount, balances: fresh.balances, reference: paidRef });
    } else {
      await Transaction.findOneAndUpdate({ reference }, { reference, status: 'failed', raw: data }, { upsert: true });
      return res.json({ success: false, message: "Payment not successful", data });
    }
  } catch(e) { return res.status(500).json({ success: false, message: e.message }); }
}

app.post('/api/pay/initialize', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!PAYSTACK_SECRET) return res.status(500).json({ success: false, message: "PAYSTACK_SECRET_KEY missing" });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, message: "Invalid amount" });
    const r = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: req.user.email,
        amount: Math.round(Number(amount) * 100),
        callback_url: 'https://matthewchi12.github.io/payment-success.html',
        metadata: { userId: req.user._id.toString() }
      })
    });
    const data = await r.json();
    if (data.status && data.data) {
      await Transaction.create({ reference: data.data.reference, email: req.user.email, userId: req.user._id.toString(), amount: Number(amount), status: 'pending', raw: data.data });
    }
    res.json(data);
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/pay/verify', async (req, res) => verifyAndCredit(req.query.reference, res));
app.get('/api/pay/verify/:reference', async (req, res) => verifyAndCredit(req.params.reference, res));
app.post('/api/pay/webhook', async (req, res) => {
  try { if (req.body.event === 'charge.success') await verifyAndCredit(req.body.data.reference, { json: ()=>{} }); res.sendStatus(200); }
  catch(e){ res.sendStatus(200); }
});

app.listen(PORT, () => console.log(`✅ FIXED - Port ${PORT}`));

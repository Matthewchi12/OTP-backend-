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
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";

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
  mongoose.connect(MONGODB_URI)
.then(() => console.log("✅ MongoDB Connected"))
.catch(e => console.log("❌ Mongo Error:", e.message));
}

const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true, lowercase: true },
  passwordHash: { type: String, default: null },
  authProvider: { type: String, enum: ["email", "google"], default: "email" },
  googleId: { type: String, default: null },
  name: { type: String, default: "" },
  picture: { type: String, default: "" },
  balances: { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now }
});

const OrderSchema = new mongoose.Schema({
  id: String, userId: String, email: String, country: String, service: String, phone: String,
  fiveSimId: { type: String, default: null }, price: Number, status: String, otp: { type: String, default: null },
  isReal: Boolean, createdAt: { type: Date, default: Date.now }, expiresAt: Date
});

const User = mongoose.models.User || mongoose.model("User", UserSchema);
const Order = mongoose.models.Order || mongoose.model("Order", OrderSchema);

function getDefaultBalances() { const b = {}; countries.forEach(c => b[c.code] = c.topups[1]); return b; }
function generateId() { return "ORD-" + Date.now() + "-" + Math.random().toString(36).slice(2,6); }
function generateToken(user) {
  const id = user._id? user._id.toString() : user.id;
  return jwt.sign({ id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header ||!header.startsWith("Bearer ")) return res.status(401).json({ success: false, message: "No token" });
  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ success: false, message: "User not found - Please login again" });
    req.user = user; next();
  } catch (e) { return res.status(401).json({ success: false, message: "Invalid token" }); }
}

app.get("/api/health", (req, res) => {
  res.json({ success: true, hasApiKey:!!FIVESIM_KEY, hasMongo:!!MONGODB_URI, mongoConnected: mongoose.connection.readyState === 1, mode: FIVESIM_KEY? "REAL API" : "NO KEY" });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email ||!password) return res.status(400).json({ success: false, message: "Email and password required" });
    const cleanEmail = email.trim().toLowerCase();
    const exists = await User.findOne({ email: cleanEmail });
    if (exists) return res.status(409).json({ success: false, message: "Email exists" });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email: cleanEmail, passwordHash, authProvider: "email", balances: getDefaultBalances(), createdAt: new Date(), lastLogin: new Date() });
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
    res.json({ success: true, token, user: { id: user._id, email: user.email, balances: user.balances, name: user.name } });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ===== BUY - FIXED WITH INSUFFICIENT BALANCE MESSAGE =====
app.post("/api/orders", authMiddleware, async (req, res) => {
  try {
    const { country, service } = req.body;
    const selectedCountry = countries.find(c => c.code === country);
    if (!selectedCountry) return res.status(400).json({ success: false, message: "Number is unavailable" });

    if (!FIVESIM_KEY) {
      return res.status(400).json({ success: false, message: "Number is unavailable" });
    }

    const price = selectedCountry.price;
    const userBalances = req.user.balances || getDefaultBalances();
    // ✅ ADDED: Check if balance less than product amount - returns your exact message
    if ((userBalances[country] || 0) < price) {
      return res.status(400).json({ success: false, message: "insufficient balance add money" });
    }

    // Buy REAL number
    let realPhone = null;
    let fiveSimId = null;
    try {
      const resp = await fetch(`https://5sim.net/v1/user/buy/activation/${selectedCountry.fivesim}/any/${service}`, {
        headers: { Authorization: `Bearer ${FIVESIM_KEY}`, Accept: "application/json" }
      });
      const data = await resp.json();
      console.log("5sim:", data);
      if (resp.ok && data.phone) {
        realPhone = data.phone;
        fiveSimId = data.id;
      } else {
        return res.status(400).json({ success: false, message: "Number is unavailable" });
      }
    } catch(e) {
      console.log("5sim error:", e.message);
      return res.status(400).json({ success: false, message: "Number is unavailable" });
    }

    // Deduct only after success
    userBalances[country] -= price;
    req.user.balances = userBalances;
    req.user.markModified('balances');
    await req.user.save();

    const orderId = generateId();
    const order = await Order.create({
      id: orderId, userId: req.user._id.toString(), email: req.user.email,
      country, service, phone: realPhone, fiveSimId, price,
      status: "waiting", otp: null, isReal:true,
      createdAt: new Date(), expiresAt: new Date(Date.now() + 15*60*1000)
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
          order.status = "received";
          await order.save();
        }
      } catch(e){}
    }
    res.json({ success: true, order });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// PAYSTACK
app.post('/api/pay/initialize', async (req, res) => {
  try{
    const { email, amount } = req.body;
    const r = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        amount: Math.round(Number(amount) * 100),
        callback_url: 'https://matthewchi12.github.io/payment-success.html',
      })
    });
    const data = await r.json();
    res.json(data);
  }catch(e){ res.json({ success: false, message: e.message }); }
});

async function verifyAndCredit(reference, res) {
  try{
    const r = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    const data = await r.json();
    if(data.data && data.data.status === 'success'){
      const paidEmail = data.data.customer.email.toLowerCase();
      const paidAmount = data.data.amount / 100;
      const user = await User.findOne({ email: paidEmail });
      if(user){
        user.balances = user.balances || {};
        user.balances.nigeria = (user.balances.nigeria || 0) + paidAmount;
        user.markModified('balances');
        await user.save();
      }
      return res.json({ success: true, amount: paidAmount, email: paidEmail, balances: user?.balances, paystackData: data });
    } else {
      return res.json({ success: false, message: "Payment not success", data });
    }
  }catch(e){ return res.json({ success: false, message: e.message }); }
}
app.get('/api/pay/verify', async (req, res) => { return verifyAndCredit(req.query.reference, res); });
app.get('/api/pay/verify/:reference', async (req, res) => { return verifyAndCredit(req.params.reference, res); });


app.get("/test-paystack-key", async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    console.log("Secret exists?", secret ? "YES" : "NO - not loaded");

    const response = await fetch("https://api.paystack.co/balance", {
      headers: { Authorization: `Bearer ${secret}` }
    });
    const data = await response.json();
    res.json(data); // if key works, you will see your balance
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.listen(PORT, () => console.log(`✅ FIXED - No demo - Returns 'Number is unavailable' on fail - Port ${PORT}`));

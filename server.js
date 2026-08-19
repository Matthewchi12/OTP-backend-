const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");

dotenv.config();
const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";

const countries = [
  { code: "nigeria", name: "Nigeria", prefix: "+234", currency: "NGN", price: 1000, topups: [5000, 10000, 20000] },
  { code: "usa", name: "USA", prefix: "+1", currency: "USD", price: 1, topups: [5, 10, 20] },
  { code: "uk", name: "UK", prefix: "+44", currency: "GBP", price: 0.80, topups: [5, 10, 15] },
  { code: "ghana", name: "Ghana", prefix: "+233", currency: "GHS", price: 12, topups: [60, 120, 240] },
  { code: "kenya", name: "Kenya", prefix: "+254", currency: "KES", price: 130, topups: [650, 1300, 2600] },
  { code: "india", name: "India", prefix: "+91", currency: "INR", price: 70, topups: [350, 700, 1400] },
];

// In-memory DB - replace with real DB in production
const usersById = new Map(); // id -> user
const usersByEmail = new Map(); // email -> user
const orders = new Map(); // orderId -> order

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}
function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header ||!header.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "No token provided" });
  }
  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = usersById.get(decoded.id);
    if (!user) return res.status(401).json({ success: false, message: "User not found" });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}
function getDefaultBalances() {
  const balances = {};
  countries.forEach(c => balances[c.code] = c.topups[1]);
  return balances;
}

// Health
app.get("/api/health", (req, res) => {
  res.json({ success: true, message: "OTPHub server running", time: new Date().toISOString() });
});

app.get("/api/countries", (req, res) => {
  res.json({ success: true, countries });
});

/*
|--------------------------------------------------------------------------
| AUTH - CREATE ACCOUNT + LOGIN
|--------------------------------------------------------------------------
*/
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email ||!password) return res.status(400).json({ success: false, message: "Email and password required" });

    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return res.status(400).json({ success: false, message: "Invalid email" });
    if (password.length < 6) return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });

    if (usersByEmail.has(cleanEmail)) return res.status(409).json({ success: false, message: "Email already registered" });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: generateId(),
      email: cleanEmail,
      passwordHash,
      balances: getDefaultBalances(),
      createdAt: new Date()
    };
    usersById.set(user.id, user);
    usersByEmail.set(cleanEmail, user);

    const token = generateToken(user);
    res.status(201).json({
      success: true,
      token,
      user: { id: user.id, email: user.email, balances: user.balances }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email ||!password) return res.status(400).json({ success: false, message: "Email and password required" });

    const cleanEmail = email.trim().toLowerCase();
    const user = usersByEmail.get(cleanEmail);
    if (!user) return res.status(401).json({ success: false, message: "Invalid email or password" });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ success: false, message: "Invalid email or password" });

    const token = generateToken(user);
    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, balances: user.balances }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/api/me", authMiddleware, (req, res) => {
  res.json({ success: true, user: { id: req.user.id, email: req.user.email, balances: req.user.balances } });
});

/*
|--------------------------------------------------------------------------
| WALLET - now protected and per-country
|--------------------------------------------------------------------------
*/
app.get("/api/wallet", authMiddleware, (req, res) => {
  res.json({ success: true, balances: req.user.balances });
});

// Keep old route for backwards compatibility
app.get("/api/wallet/:userId", (req, res) => {
  const user = usersById.get(req.params.userId);
  if (!user) return res.status(404).json({ success: false, message: "User not found" });
  res.json({ success: true, balances: user.balances, balance: user.balances[req.query.country || "nigeria"] || 0 });
});

app.post("/api/wallet/topup", authMiddleware, (req, res) => {
  const { country, amount, userId } = req.body; // userId kept for old frontend

  // Support both new and old
  const targetCountry = country || "nigeria";
  const topupAmount = Number(amount);

  if (!topupAmount || topupAmount <= 0) return res.status(400).json({ success: false, message: "Invalid amount" });
  if (!countries.find(c => c.code === targetCountry)) return res.status(400).json({ success: false, message: "Invalid country" });

  const user = req.user || usersById.get(userId);
  if (!user) return res.status(404).json({ success: false, message: "User not found" });

  user.balances[targetCountry] = (user.balances[targetCountry] || 0) + topupAmount;

  res.json({ success: true, balances: user.balances, balance: user.balances[targetCountry] });
});

/*
|--------------------------------------------------------------------------
| ORDERS
|--------------------------------------------------------------------------
*/
app.post("/api/orders", authMiddleware, (req, res) => {
  try {
    const { country, service } = req.body;
    if (!country ||!service) return res.status(400).json({ success: false, message: "country and service required" });

    const selectedCountry = countries.find(c => c.code === country);
    if (!selectedCountry) return res.status(400).json({ success: false, message: "Country not supported" });

    const price = selectedCountry.price;
    if ((req.user.balances[country] || 0) < price) {
      return res.status(400).json({ success: false, message: "Insufficient balance", required: price, balance: req.user.balances[country] || 0 });
    }

    req.user.balances[country] -= price;

    const orderId = "ORD-" + Date.now() + "-" + Math.floor(Math.random() * 10000);
    const demoNumber = selectedCountry.prefix + Math.floor(7000000000 + Math.random() * 999999999).toString().slice(0,10);

    const order = {
      id: orderId,
      userId: req.user.id,
      country, service, phone: demoNumber, price,
      status: "waiting", otp: null, createdAt: new Date(), expiresAt: new Date(Date.now() + 15*60*1000)
    };
    orders.set(orderId, order);

    // DEMO OTP after 6s
    setTimeout(() => {
      const o = orders.get(orderId);
      if (!o) return;
      o.otp = Math.floor(100000 + Math.random() * 900000).toString();
      o.status = "received";
    }, 6000);

    res.json({
      success: true,
      order: { id: order.id, phone: order.phone, service: order.service, status: order.status, price: order.price },
      balances: req.user.balances,
      balance: req.user.balances[country]
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/api/orders", authMiddleware, (req, res) => {
  const userOrders = Array.from(orders.values()).filter(o => o.userId === req.user.id).sort((a,b)=>b.createdAt-a.createdAt);
  res.json({ success: true, orders: userOrders });
});

app.get("/api/orders/:orderId", authMiddleware, (req, res) => {
  const order = orders.get(req.params.orderId);
  if (!order || order.userId!== req.user.id) return res.status(404).json({ success: false, message: "Order not found" });
  res.json({ success: true, order });
});

app.delete("/api/orders/:orderId", authMiddleware, (req, res) => {
  const order = orders.get(req.params.orderId);
  if (!order || order.userId!== req.user.id) return res.status(404).json({ success: false, message: "Order not found" });
  order.status = "cancelled";
  res.json({ success: true, message: "Order cancelled" });
});

app.use(express.static(path.join(__dirname, "../public")));

app.listen(PORT, () => {
  console.log(`OTPHub Auth Server running on http://localhost:${PORT}`);
});

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
const FIVESIM_KEY = process.env.FIVESIM_KEY || ""; // ADD YOUR KEY IN.env

// 50 COUNTRIES - price in local currency
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
  { code: "ghana", name: "Ghana", prefix: "+233", currency: "GHS", price: 12, topups: [60, 120, 240], fivesim: "ghana" },
];

const usersById = new Map();
const usersByEmail = new Map();
const orders = new Map();

function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 9); }
function generateToken(user) { return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES }); }
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header ||!header.startsWith("Bearer ")) return res.status(401).json({ success: false, message: "No token" });
  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = usersById.get(decoded.id);
    if (!user) return res.status(401).json({ success: false, message: "User not found" });
    req.user = user; next();
  } catch (e) { return res.status(401).json({ success: false, message: "Invalid token" }); }
}
function getDefaultBalances() { const b = {}; countries.forEach(c => b[c.code] = c.topups[1]); return b; }

app.get("/api/health", (req, res) => { res.json({ success: true, hasApiKey:!!FIVESIM_KEY, countries: countries.length }); });
app.get("/api/countries", (req, res) => { res.json({ success: true, countries }); });

app.post("/api/auth/register", async (req, res) => {
  const { email, password } = req.body;
  const cleanEmail = email.trim().toLowerCase();
  if (usersByEmail.has(cleanEmail)) return res.status(409).json({ success: false, message: "Email exists" });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = { id: generateId(), email: cleanEmail, passwordHash, balances: getDefaultBalances(), createdAt: new Date(), lastLogin: new Date() };
  usersById.set(user.id, user); usersByEmail.set(cleanEmail, user);
  const token = generateToken(user);
  res.status(201).json({ success: true, token, user: { id: user.id, email: user.email, balances: user.balances } });
});

app.post("/api/auth/login", async (req, res) => {
  const cleanEmail = req.body.email.trim().toLowerCase();
  const user = usersByEmail.get(cleanEmail);
  if (!user) return res.status(401).json({ success: false, message: "Invalid" });
  const match = await bcrypt.compare(req.body.password, user.passwordHash);
  if (!match) return res.status(401).json({ success: false, message: "Invalid" });
  user.lastLogin = new Date();
  const token = generateToken(user);
  res.json({ success: true, token, user: { id: user.id, email: user.email, balances: user.balances } });
});

app.post("/api/orders", authMiddleware, async (req, res) => {
  try {
    const { country, service } = req.body;
    const selectedCountry = countries.find(c => c.code === country);
    if (!selectedCountry) return res.status(400).json({ success: false, message: "Country not supported" });
    const price = selectedCountry.price;
    if ((req.user.balances[country] || 0) < price) return res.status(400).json({ success: false, message: "Insufficient balance" });
    req.user.balances[country] -= price;
    let realPhone = null;
    let fiveSimId = null;
    if (FIVESIM_KEY) {
      try {
        const resp = await fetch(`https://5sim.net/v1/user/buy/activation/${selectedCountry.fivesim}/any/${service}`, {
          headers: { Authorization: `Bearer ${FIVESIM_KEY}`, Accept: "application/json" }
        });
        const data = await resp.json();
        if (resp.ok) {
          realPhone = data.phone;
          fiveSimId = data.id;
        }
      } catch(e) { console.log("5sim error, using demo:", e.message); }
    }
    const phone = realPhone || selectedCountry.prefix + Math.floor(7000000000 + Math.random()*999999999).toString().slice(0,10);
    const orderId = "ORD-" + Date.now();
    const order = {
      id: orderId, userId: req.user.id, country, service, phone, fiveSimId,
      price, status: "waiting", otp: null, isReal:!!realPhone,
      createdAt: new Date(), expiresAt: new Date(Date.now() + 15*60*1000)
    };
    orders.set(orderId, order);
    if(!realPhone){
      setTimeout(() => {
        const o = orders.get(orderId);
        if(o){ o.otp = Math.floor(100000 + Math.random()*900000).toString(); o.status = "received"; }
      }, 6000);
    }
    res.json({ success: true, order, balances: req.user.balances });
  } catch(e){ console.error(e); res.status(500).json({ success: false, message: "Server error" }); }
});

app.get("/api/orders/:orderId", authMiddleware, async (req, res) => {
  const order = orders.get(req.params.orderId);
  if (!order || order.userId!== req.user.id) return res.status(404).json({ success: false, message: "Not found" });
  if (order.fiveSimId && FIVESIM_KEY &&!order.otp) {
    try {
      const resp = await fetch(`https://5sim.net/v1/user/check/${order.fiveSimId}`, {
        headers: { Authorization: `Bearer ${FIVESIM_KEY}`, Accept: "application/json" }
      });
      const data = await resp.json();
      if (data.sms && data.sms[0]) {
        order.otp = data.sms[0].code || data.sms[0].text?.match(/\d{4,6}/)?.[0];
        order.status = "received";
      }
    } catch(e){ console.log("check error", e.message); }
  }
  res.json({ success: true, order });
});

// ===================== ADMIN - SEE ALL PEOPLE THAT LOGIN =====================
app.get("/api/admin/users", (req, res) => {
  const allUsers = Array.from(usersById.values()).map(u => {
    const userOrders = Array.from(orders.values()).filter(o => o.userId === u.id);
    return {
      id: u.id,
      email: u.email,
      balances: u.balances,
      createdAt: u.createdAt || new Date(),
      lastLogin: u.lastLogin || u.createdAt,
      ordersCount: userOrders.length,
      totalSpent: userOrders.reduce((sum, o) => sum + (o.price || 0), 0)
    };
  }).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, total: allUsers.length, users: allUsers });
});

app.get("/api/admin/orders", (req, res) => {
  const allOrders = Array.from(orders.values()).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, total: allOrders.length, orders: allOrders });
});

app.get("/api/admin/stats", (req, res) => {
  const totalUsers = usersById.size;
  const totalOrders = orders.size;
  const totalRevenue = Array.from(orders.values()).reduce((s,o)=> s + (o.price||0), 0);
  res.json({ success: true, stats: { totalUsers, totalOrders, totalRevenue, mode: FIVESIM_KEY? "REAL API" : "DEMO MODE" } });
});

app.listen(PORT, () => console.log(`OTPHub Server running with ${FIVESIM_KEY? 'REAL API' : 'DEMO MODE'} on ${PORT}`));

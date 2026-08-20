const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const crypto = require("crypto");

dotenv.config();

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "30d";
const FIVESIM_KEY = process.env.FIVESIM_API_KEY || process.env.FIVESIM_KEY || "";
const MONGODB_URI = process.env.MONGODB_URI || "";
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || "";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://matthewchi12.github.io";

const countries = [
  { code:"nigeria", name:"Nigeria", prefix:"+234", currency:"NGN", price:1000, topups:[5000,10000,20000], fivesim:"nigeria" },
  { code:"usa", name:"USA", prefix:"+1", currency:"USD", price:1, topups:[5,10,20], fivesim:"usa" },
  { code:"uk", name:"UK", prefix:"+44", currency:"GBP", price:0.8, topups:[5,10,15], fivesim:"england" },
  { code:"canada", name:"Canada", prefix:"+1", currency:"CAD", price:1.35, topups:[6,13,27], fivesim:"canada" },
  { code:"ghana", name:"Ghana", prefix:"+233", currency:"GHS", price:12, topups:[60,120,240], fivesim:"ghana" },
  { code:"kenya", name:"Kenya", prefix:"+254", currency:"KES", price:130, topups:[650,1300,2600], fivesim:"kenya" },
  { code:"india", name:"India", prefix:"+91", currency:"INR", price:70, topups:[350,700,1400], fivesim:"india" },
  { code:"southafrica", name:"South Africa", prefix:"+27", currency:"ZAR", price:18, topups:[90,180,360], fivesim:"southafrica" },
  { code:"germany", name:"Germany", prefix:"+49", currency:"EUR", price:0.9, topups:[5,9,18], fivesim:"germany" },
  { code:"france", name:"France", prefix:"+33", currency:"EUR", price:0.9, topups:[5,9,18], fivesim:"france" },
  { code:"spain", name:"Spain", prefix:"+34", currency:"EUR", price:0.9, topups:[5,9,18], fivesim:"spain" },
  { code:"italy", name:"Italy", prefix:"+39", currency:"EUR", price:0.9, topups:[5,9,18], fivesim:"italy" },
  { code:"australia", name:"Australia", prefix:"+61", currency:"AUD", price:1.5, topups:[7,15,30], fivesim:"australia" },
  { code:"brazil", name:"Brazil", prefix:"+55", currency:"BRL", price:5, topups:[25,50,100], fivesim:"brazil" },
  { code:"mexico", name:"Mexico", prefix:"+52", currency:"MXN", price:18, topups:[90,180,360], fivesim:"mexico" },
  { code:"netherlands", name:"Netherlands", prefix:"+31", currency:"EUR", price:0.9, topups:[5,9,18], fivesim:"netherlands" },
  { code:"sweden", name:"Sweden", prefix:"+46", currency:"EUR", price:0.9, topups:[5,9,18], fivesim:"sweden" },
  { code:"norway", name:"Norway", prefix:"+47", currency:"EUR", price:0.9, topups:[5,9,18], fivesim:"norway" },
  { code:"poland", name:"Poland", prefix:"+48", currency:"EUR", price:0.9, topups:[5,9,18], fivesim:"poland" },
  { code:"turkey", name:"Turkey", prefix:"+90", currency:"TRY", price:20, topups:[100,200,400], fivesim:"turkey" },
  { code:"uae", name:"UAE", prefix:"+971", currency:"AED", price:4, topups:[20,40,80], fivesim:"uae" },
  { code:"saudiarabia", name:"Saudi Arabia", prefix:"+966", currency:"SAR", price:4, topups:[20,40,80], fivesim:"saudiarabia" },
];

if (MONGODB_URI) { mongoose.connect(MONGODB_URI).then(()=>console.log("✅ MongoDB")).catch(e=>console.log("❌ Mongo", e.message)); }

const UserSchema = new mongoose.Schema({
  email:{type:String, unique:true, lowercase:true, trim:true},
  passwordHash:{type:String, default:null},
  authProvider:{type:String, enum:["email","google","firebase"], default:"email"},
  googleId:{type:String, default:null}, name:{type:String, default:""}, picture:{type:String, default:""},
  balances:{type:mongoose.Schema.Types.Mixed, default:{}},
  createdAt:{type:Date, default:Date.now}, lastLogin:{type:Date, default:Date.now}
});
const OrderSchema = new mongoose.Schema({
  id:String, userId:String, email:String, country:String, service:String, phone:String,
  fiveSimId:{type:String, default:null}, price:Number, status:String, otp:{type:String, default:null},
  isReal:Boolean, createdAt:{type:Date, default:Date.now}, expiresAt:Date
});
const TransactionSchema = new mongoose.Schema({
  reference:{type:String, unique:true}, email:String, userId:String, amount:Number, status:String,
  raw:{type:mongoose.Schema.Types.Mixed, default:{}}, creditedAt:{type:Date, default:null}, createdAt:{type:Date, default:Date.now}
});
const User = mongoose.models.User || mongoose.model("User", UserSchema);
const Order = mongoose.models.Order || mongoose.model("Order", OrderSchema);
const Transaction = mongoose.models.Transaction || mongoose.model("Transaction", TransactionSchema);

function getDefaultBalances(){ const b={}; countries.forEach(c=>b[c.code]=0); return b; }
function ensureBalances(user){
  if(!user.balances) user.balances=getDefaultBalances();
  countries.forEach(c=>{ if(user.balances[c.code]===undefined||user.balances[c.code]===null) user.balances[c.code]=0; });
  return user.balances;
}
function generateId(){ return "ORD-"+Date.now()+"-"+Math.random().toString(36).slice(2,8); }
function generateToken(user){ return jwt.sign({id:user._id.toString(), email:user.email}, JWT_SECRET, {expiresIn:JWT_EXPIRES}); }

async function processPayment(reference){
  if(!reference) throw new Error("Payment reference missing");
  if(!PAYSTACK_SECRET) throw new Error("PAYSTACK_SECRET_KEY missing");
  let transaction=await Transaction.findOne({reference});
  if(transaction&&transaction.status==="success"){
    const user=await User.findById(transaction.userId);
    if(!user) throw new Error("User account not found");
    ensureBalances(user);
    return {success:true, alreadyCredited:true, amount:transaction.amount, reference, balances:user.balances};
  }
  const response=await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {headers:{Authorization:`Bearer ${PAYSTACK_SECRET}`, Accept:"application/json"}});
  const data=await response.json();
  if(!response.ok||!data.status||!data.data) throw new Error(data.message||"Paystack verification failed");
  const payment=data.data;
  if(payment.status!=="success") return {success:false, message:"Payment has not been completed", status:payment.status};
  const paidReference=payment.reference;
  const paidEmail=String(payment.customer?.email||transaction?.email||"").trim().toLowerCase();
  if(!paidEmail) throw new Error("Payment email missing");
  const paidAmount=Number(payment.amount)/100;
  let user=null;
  if(transaction&&transaction.userId) user=await User.findById(transaction.userId);
  if(!user){ const mid=payment.metadata?.userId; if(mid){ try{ user=await User.findById(mid); }catch(e){} } }
  if(!user) user=await User.findOne({email:paidEmail});
  if(!user) throw new Error("User account not found");
  const existingSuccess=await Transaction.findOne({reference:paidReference, status:"success"});
  if(existingSuccess){ ensureBalances(user); return {success:true, alreadyCredited:true, amount:existingSuccess.amount, reference:paidReference, balances:user.balances}; }
  ensureBalances(user);
  user.balances.nigeria=(Number(user.balances.nigeria)||0)+paidAmount;
  user.markModified("balances"); await user.save();
  await Transaction.findOneAndUpdate({reference:paidReference},{reference:paidReference, email:paidEmail, userId:user._id.toString(), amount:paidAmount, status:"success", raw:payment, creditedAt:new Date()},{upsert:true, new:true});
  return {success:true, alreadyCredited:false, amount:paidAmount, reference:paidReference, balances:user.balances};
}

const app = require("express")();
const cors = require("cors");
app.use(cors({ origin: "*" }));

// re-init app correctly - use same app instance
const mainApp = express();
mainApp.use(cors({ origin: "*" }));
mainApp.post("/api/pay/webhook", express.raw({type: "application/json"}), async (req,res) => {
  try {
    const signature = req.headers["x-paystack-signature"];
    if (!signature) return res.sendStatus(401);
    const expected = crypto.createHmac("sha512", PAYSTACK_SECRET).update(req.body).digest("hex");
    if (signature!== expected) return res.sendStatus(401);
    res.sendStatus(200);
    const payload = JSON.parse(req.body.toString());
    if (payload.event === "charge.success") {
      const ref = payload.data?.reference;
      if (ref) { try { await processPayment(ref); } catch(e){} }
    }
  } catch(e){ if(!res.headersSent) res.sendStatus(200); }
});
mainApp.use(express.json());

// Use mainApp for all routes
async function authMiddleware(req,res,next){
  const header=req.headers.authorization;
  if(!header||!header.toLowerCase().startsWith("bearer ")) return res.status(401).json({success:false, message:"No token"});
  try{
    const token=header.split(" ")[1]?.trim();
    if(!token) return res.status(401).json({success:false, message:"No token"});
    const decoded=jwt.verify(token, JWT_SECRET);
    const user=await User.findById(decoded.id);
    if(!user) return res.status(401).json({success:false, message:"User not found"});
    ensureBalances(user); req.user=user; next();
  }catch(e){ return res.status(401).json({success:false, message:"Invalid token"}); }
}

mainApp.get("/api/health",(req,res)=>{ res.json({success:true, hasApiKey:!!FIVESIM_KEY, hasPaystack:!!PAYSTACK_SECRET, mongoConnected:mongoose.connection.readyState===1}); });
mainApp.post("/api/auth/register", async (req,res)=>{
  try{
    const {email,password}=req.body;
    if(!email||!password) return res.status(400).json({success:false, message:"Email and password required"});
    const cleanEmail=String(email).trim().toLowerCase();
    const exists=await User.findOne({email:cleanEmail});
    if(exists) return res.status(409).json({success:false, message:"Email exists"});
    const passwordHash=await bcrypt.hash(password,10);
    const user=await User.create({email:cleanEmail, passwordHash, authProvider:"email", balances:getDefaultBalances()});
    const token=generateToken(user);
    res.status(201).json({success:true, token, user:{id:user._id, email:user.email, balances:user.balances}});
  }catch(e){ res.status(500).json({success:false, message:e.message}); }
});
mainApp.post("/api/auth/login", async (req,res)=>{
  try{
    const cleanEmail=String(req.body.email||"").trim().toLowerCase();
    const user=await User.findOne({email:cleanEmail});
    if(!user) return res.status(401).json({success:false, message:"Invalid email or password"});
    if(!user.passwordHash) return res.status(401).json({success:false, message:"This account uses another login method"});
    const match=await bcrypt.compare(req.body.password, user.passwordHash);
    if(!match) return res.status(401).json({success:false, message:"Invalid email or password"});
    ensureBalances(user); user.lastLogin=new Date(); user.markModified("balances"); await user.save();
    const token=generateToken(user);
    res.json({success:true, token, user:{id:user._id, email:user.email, balances:user.balances}});
  }catch(e){ res.status(500).json({success:false, message:e.message}); }
});
mainApp.get("/api/user/me", authMiddleware, async (req,res)=>{
  const fresh=await User.findById(req.user._id); ensureBalances(fresh); await fresh.save();
  res.json({success:true, balances:fresh.balances, user:fresh});
});
mainApp.get("/api/user/balance", authMiddleware, async (req,res)=>{
  const fresh=await User.findById(req.user._id); ensureBalances(fresh); await fresh.save();
  res.json({success:true, balances:fresh.balances});
});
mainApp.post("/api/firebase/sync", async (req,res)=>{
  try{
    const {email, name="", picture=""}=req.body;
    if(!email) return res.status(400).json({success:false, message:"Email required"});
    const cleanEmail=email.trim().toLowerCase();
    let user=await User.findOne({email:cleanEmail});
    if(!user) user=await User.create({email:cleanEmail, name, picture, authProvider:"firebase", balances:getDefaultBalances()});
    else { ensureBalances(user); user.lastLogin=new Date(); user.markModified("balances"); await user.save(); }
    const token=generateToken(user);
    res.json({success:true, token, user:{id:user._id, email:user.email, balances:user.balances}});
  }catch(e){ res.status(500).json({success:false, message:e.message}); }
});
mainApp.post("/api/orders", authMiddleware, async (req,res)=>{
  try{
    const {country, service}=req.body;
    const selectedCountry=countries.find(c=>c.code===country);
    if(!selectedCountry) return res.status(400).json({success:false, message:"Number is unavailable"});
    if(!FIVESIM_KEY) return res.status(500).json({success:false, message:"5SIM API key missing"});
    const price=Number(selectedCountry.price);
    const balances=ensureBalances(req.user);
    const currentBalance=Number(balances[country])||0;
    const checkBalance = country==="nigeria"? currentBalance : (Number(balances.nigeria)||0) < 1000? 0 : currentBalance || Number(balances.nigeria)||0;
    // allow NGN balance to pay for other countries
    const effectiveBalance = country==="nigeria"? currentBalance : (Number(balances[country])>0? Number(balances[country]) : Number(balances.nigeria)||0);
    if(effectiveBalance<price && (Number(balances.nigeria)||0)<1000){
      if(country!=="nigeria" && (Number(balances.nigeria)||0) >= 1000){} else {
        return res.status(400).json({success:false, message:"insufficient balance add money"});
      }
    }
    let realPhone=null, fiveSimId=null;
    try{
      const resp=await fetch(`https://5sim.net/v1/user/buy/activation/${selectedCountry.fivesim}/any/${service}`, {headers:{Authorization:`Bearer ${FIVESIM_KEY}`, Accept:"application/json"}});
      const data=await resp.json();
      if(resp.ok&&data.phone){ realPhone=data.phone; fiveSimId=data.id; }
      else return res.status(400).json({success:false, message:"Number is unavailable"});
    }catch(e){ return res.status(400).json({success:false, message:"Number is unavailable"}); }
    if(country==="nigeria" || Number(balances[country])>=price){
      balances[country]=currentBalance-price;
    } else {
      balances.nigeria=(Number(balances.nigeria)||0)-1000;
    }
    req.user.balances=balances; req.user.markModified("balances"); await req.user.save();
    const order=await Order.create({id:generateId(), userId:req.user._id.toString(), email:req.user.email, country, service, phone:realPhone, fiveSimId, price, status:"waiting", isReal:true, createdAt:new Date(), expiresAt:new Date(Date.now()+15*60*1000)});
    res.json({success:true, order, balances:req.user.balances});
  }catch(e){ res.status(500).json({success:false, message:"Number is unavailable"}); }
});
mainApp.get("/api/orders/:orderId", authMiddleware, async (req,res)=>{
  try{
    const order=await Order.findOne({id:req.params.orderId, userId:req.user._id.toString()});
    if(!order) return res.status(404).json({success:false, message:"Not found"});
    if(order.fiveSimId&&FIVESIM_KEY&&!order.otp){
      try{
        const resp=await fetch(`https://5sim.net/v1/user/check/${order.fiveSimId}`, {headers:{Authorization:`Bearer ${FIVESIM_KEY}`, Accept:"application/json"}});
        const data=await resp.json();
        if(data.sms&&data.sms[0]){ order.otp=data.sms[0].code||data.sms[0].text?.match(/\d{4,6}/)?.[0]; order.status="received"; await order.save(); }
      }catch(e){}
    }
    res.json({success:true, order});
  }catch(e){ res.status(500).json({success:false, message:e.message}); }
});
mainApp.post("/api/pay/initialize", authMiddleware, async (req,res)=>{
  try{
    const {amount}=req.body;
    if(!PAYSTACK_SECRET) return res.status(500).json({success:false, message:"PAYSTACK_SECRET_KEY missing"});
    const numericAmount=Number(amount);
    if(!Number.isFinite(numericAmount)||numericAmount<100) return res.status(400).json({success:false, message:"Minimum payment is ₦100"});
    const cleanEmail=String(req.user.email).trim().toLowerCase();
    const callbackUrl=`${FRONTEND_URL}/`;
    const response=await fetch("https://api.paystack.co/transaction/initialize", {
      method:"POST", headers:{Authorization:`Bearer ${PAYSTACK_SECRET}`, "Content-Type":"application/json"},
      body:JSON.stringify({email:cleanEmail, amount:Math.round(numericAmount*100), currency:"NGN", callback_url:callbackUrl, metadata:{userId:req.user._id.toString(), email:cleanEmail, purpose:"wallet_funding"}})
    });
    const data=await response.json();
    if(!response.ok||!data.status||!data.data) return res.status(400).json({success:false, message:data.message||"Unable to initialize payment"});
    await Transaction.findOneAndUpdate({reference:data.data.reference},{reference:data.data.reference, email:cleanEmail, userId:req.user._id.toString(), amount:numericAmount, status:"pending", raw:data.data},{upsert:true, new:true});
    res.json(data);
  }catch(e){ res.status(500).json({success:false, message:"Payment initialization failed"}); }
});
mainApp.get("/api/pay/verify", authMiddleware, async (req,res)=>{
  try{
    const result=await processPayment(req.query.reference);
    const tx=await Transaction.findOne({reference:req.query.reference});
    if(tx&&tx.userId!==req.user._id.toString()) return res.status(403).json({success:false, message:"Payment does not belong to this account"});
    res.json(result);
  }catch(e){ res.status(500).json({success:false, message:e.message}); }
});
mainApp.get("/api/pay/verify/:reference", authMiddleware, async (req,res)=>{
  try{
    const result=await processPayment(req.params.reference);
    const tx=await Transaction.findOne({reference:req.params.reference});
    if(tx&&tx.userId!==req.user._id.toString()) return res.status(403).json({success:false, message:"Payment does not belong to this account"});
    res.json(result);
  }catch(e){ res.status(500).json({success:false, message:e.message}); }
});
mainApp.listen(PORT, ()=>{ console.log(`✅ FIXED - Port ${PORT}`); });

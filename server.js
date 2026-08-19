const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

/*
|--------------------------------------------------------------------------
| Demo data
|--------------------------------------------------------------------------
*/

const countries = [
  {
    code: "nigeria",
    name: "Nigeria",
    prefix: "+234",
    currency: "NGN",
    price: 1000
  },
  {
    code: "usa",
    name: "USA",
    prefix: "+1",
    currency: "USD",
    price: 1
  },
  {
    code: "uk",
    name: "UK",
    prefix: "+44",
    currency: "GBP",
    price: 0.80
  },
  {
    code: "ghana",
    name: "Ghana",
    prefix: "+233",
    currency: "GHS",
    price: 12
  },
  {
    code: "kenya",
    name: "Kenya",
    prefix: "+254",
    currency: "KES",
    price: 130
  },
  {
    code: "india",
    name: "India",
    prefix: "+91",
    currency: "INR",
    price: 70
  }
];

/*
|--------------------------------------------------------------------------
| Temporary in-memory users
|--------------------------------------------------------------------------
| For production, replace this with PostgreSQL/Supabase/MongoDB.
|--------------------------------------------------------------------------
*/

const users = new Map();

const orders = new Map();

/*
|--------------------------------------------------------------------------
| Health check
|--------------------------------------------------------------------------
*/

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "OTPHub server is running",
    time: new Date().toISOString()
  });
});

/*
|--------------------------------------------------------------------------
| Get countries
|--------------------------------------------------------------------------
*/

app.get("/api/countries", (req, res) => {
  res.json({
    success: true,
    countries
  });
});

/*
|--------------------------------------------------------------------------
| Create demo user
|--------------------------------------------------------------------------
*/

app.post("/api/users", (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "userId is required"
    });
  }

  if (!users.has(userId)) {
    users.set(userId, {
      id: userId,
      balance: 0,
      createdAt: new Date()
    });
  }

  res.json({
    success: true,
    user: users.get(userId)
  });
});

/*
|--------------------------------------------------------------------------
| Get wallet
|--------------------------------------------------------------------------
*/

app.get("/api/wallet/:userId", (req, res) => {
  const user = users.get(req.params.userId);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found"
    });
  }

  res.json({
    success: true,
    balance: user.balance
  });
});

/*
|--------------------------------------------------------------------------
| Add wallet balance
|--------------------------------------------------------------------------
|
| IMPORTANT:
| This is DEMO top-up logic.
| In production, only credit wallet after Paystack/
| Flutterwave/Stripe confirms the payment on the server.
|--------------------------------------------------------------------------
*/

app.post("/api/wallet/topup", (req, res) => {
  const { userId, amount } = req.body;

  if (!userId || !amount || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid top-up"
    });
  }

  const user = users.get(userId);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found"
    });
  }

  user.balance += Number(amount);

  res.json({
    success: true,
    balance: user.balance
  });
});

/*
|--------------------------------------------------------------------------
| Buy number
|--------------------------------------------------------------------------
*/

app.post("/api/orders", async (req, res) => {
  try {

    const {
      userId,
      country,
      service
    } = req.body;

    if (!userId || !country || !service) {
      return res.status(400).json({
        success: false,
        message: "userId, country and service are required"
      });
    }

    const user = users.get(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const selectedCountry = countries.find(
      c => c.code === country
    );

    if (!selectedCountry) {
      return res.status(400).json({
        success: false,
        message: "Country not supported"
      });
    }

    const price = selectedCountry.price;

    if (user.balance < price) {
      return res.status(400).json({
        success: false,
        message: "Insufficient balance",
        required: price,
        balance: user.balance
      });
    }

    /*
    |--------------------------------------------------------------------------
    | In production:
    |
    | 1. Call your legitimate SMS provider here.
    | 2. Request a number.
    | 3. Save provider order ID.
    | 4. Return the real phone number.
    |--------------------------------------------------------------------------
    */

    user.balance -= price;

    const orderId =
      "ORD-" +
      Date.now() +
      "-" +
      Math.floor(Math.random() * 10000);

    const demoNumber =
      selectedCountry.prefix +
      " " +
      Math.floor(
        7000000000 +
        Math.random() * 999999999
      );

    const order = {
      id: orderId,
      userId,
      country,
      service,
      phone: demoNumber,
      price,
      status: "waiting",
      otp: null,
      createdAt: new Date()
    };

    orders.set(orderId, order);

    /*
    |--------------------------------------------------------------------------
    | DEMO ONLY
    |--------------------------------------------------------------------------
    */

    setTimeout(() => {

      const currentOrder = orders.get(orderId);

      if (!currentOrder) return;

      currentOrder.otp =
        Math.floor(
          100000 +
          Math.random() * 900000
        ).toString();

      currentOrder.status = "received";

    }, 6000);

    res.json({
      success: true,
      order: {
        id: order.id,
        phone: order.phone,
        service: order.service,
        status: order.status,
        price: order.price
      },

      balance: user.balance
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Server error"
    });

  }
});

/*
|--------------------------------------------------------------------------
| Check order / OTP
|--------------------------------------------------------------------------
*/

app.get("/api/orders/:orderId", (req, res) => {

  const order = orders.get(req.params.orderId);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found"
    });
  }

  res.json({
    success: true,
    order
  });

});

/*
|--------------------------------------------------------------------------
| Cancel order
|--------------------------------------------------------------------------
*/

app.delete("/api/orders/:orderId", (req, res) => {

  const order = orders.get(req.params.orderId);

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found"
    });
  }

  order.status = "cancelled";

  res.json({
    success: true,
    message: "Order cancelled"
  });

});

/*
|--------------------------------------------------------------------------
| Serve frontend
|--------------------------------------------------------------------------
*/

app.use(express.static(path.join(__dirname, "../public")));

/*
|--------------------------------------------------------------------------
| Start server
|--------------------------------------------------------------------------
*/

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(`
================================
       OTPHub SERVER
================================

Server running on:
http://localhost:${PORT}

API:
GET    /api/health
GET    /api/countries
POST   /api/users
GET    /api/wallet/:userId
POST   /api/wallet/topup
POST   /api/orders
GET    /api/orders/:orderId
DELETE /api/orders/:orderId

================================
  `);

});

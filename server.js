/*****************************************************************
  server.js example using MySQL to store wallet, streak, winRate
*****************************************************************/
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
require("dotenv").config(); // if using a .env file locally

const app = express();
app.use(cors());
app.use(express.json());

// Dynamic import for node-fetch
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Access your environment variables
const SOLTRACKER_API_KEY = process.env.SOLTRACKER_API_KEY || "YOUR_FALLBACK_KEY";

// Create MySQL pool
let pool;
(async function initDB() {
  try {
    pool = await mysql.createPool({
      host: process.env.DB_HOST || "mysql.railway.internal",
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "some_password",
      database: process.env.DB_NAME || "railway",
      port: process.env.DB_PORT || 3306,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    });

    // CREATE TABLE IF NOT EXISTS ...
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS leaderboard (
        wallet    VARCHAR(255) PRIMARY KEY,
        streak    INT          DEFAULT 0,
        winRate   FLOAT        DEFAULT 0,
        updated_at DATETIME    DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await pool.execute(createTableSQL);
    console.log("MySQL table 'leaderboard' is ready.");
  } catch (err) {
    console.error("Error initializing DB:", err);
  }
})();
const bs58 = require("bs58"); // Include bs58 for Solana address validation

// Function to validate Solana addresses
function isValidSolanaAddress(addr) {
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
  return addr.length >= 32 && addr.length <= 44 && base58Regex.test(addr);
}

// Basic logs
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// POST /leaderboard => upsert { wallet, streak, winRate }
app.post("/leaderboard", async (req, res) => {
  try {
    const { wallet, streak, winRate } = req.body;

    // Validate wallet address with the simplified approach
    if (!wallet || !isValidSolanaAddress(wallet)) {
      console.error(`Invalid Solana wallet address: ${wallet}`);
      return res.status(400).json({ error: "Invalid Solana wallet address." });
    }

    // Proceed with insert/upsert logic
    const sql = `
      INSERT INTO leaderboard (wallet, streak, winRate)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        streak = VALUES(streak),
        winRate = VALUES(winRate),
        updated_at = CURRENT_TIMESTAMP
    `;
    await pool.execute(sql, [wallet, streak || 0, winRate || 0]);

    console.log(`Upsert done for wallet=${wallet}, streak=${streak}, winRate=${winRate}`);
    return res.json({ message: "Leaderboard updated", wallet, streak, winRate });
  } catch (err) {
    console.error("DB insert/update error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});


// GET /leaderboard => returns [ { wallet, streak, winRate, updated_at }, ... ]
app.get("/leaderboard", async (req, res) => {
  try {
    const selectSQL = `
      SELECT wallet, streak, winRate, updated_at
      FROM leaderboard
      ORDER BY streak DESC, updated_at DESC
      LIMIT 50
    `;
    const [rows] = await pool.execute(selectSQL);

    return res.json(rows);
  } catch (err) {
    console.error("DB select error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

// Optional: GET /api/trades
app.get("/api/trades", async (req, res) => {
  try {
    const walletAddress = req.query.wallet;
    if (!walletAddress) {
      return res.status(400).json({ error: "Missing wallet parameter" });
    }

    const url = `https://data.solanatracker.io/wallet/${walletAddress}/trades`;
    const response = await fetch(url, {
      headers: { "x-api-key": process.env.SOLTRACKER_API_KEY },
    });
    if (!response.ok) {
      throw new Error(`SolTracker error: ${response.statusText}`);
    }

    const data = await response.json();
    res.json({ trades: data.trades || [] });
  } catch (err) {
    console.error("Error in /api/trades:", err);
    res.status(500).json({ error: err.message });
  }
});


// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

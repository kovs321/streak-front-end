/*****************************************************************
  server.js example using MySQL to store wallet, streak, winRate
*****************************************************************/
const express = require("express");
const cors    = require("cors");
const mysql   = require("mysql2/promise"); // note: use the promise variant
require("dotenv").config(); // if using a .env file locally

const app = express();
app.use(cors());
app.use(express.json());

// 1) Create MySQL pool
let pool;

(async function initDB() {
  try {
    pool = await mysql.createPool({
      host:     process.env.DB_HOST     || "mysql.railway.internal",
      user:     process.env.DB_USER     || "root",
      password: process.env.DB_PASSWORD || "some_password",
      database: process.env.DB_NAME     || "railway",
      port:     process.env.DB_PORT     || 3306,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0
    });

    // CREATE TABLE IF NOT EXISTS ...
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS leaderboard (
        wallet   VARCHAR(255) PRIMARY KEY,
        streak   INT          DEFAULT 0,
        winRate  FLOAT        DEFAULT 0,
        updated_at DATETIME   DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await pool.execute(createTableSQL);
    console.log("MySQL table 'leaderboard' is ready.");

  } catch (err) {
    console.error("Error initializing DB:", err);
  }
})();

// 2) Basic logs
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

/*****************************************************************
  POST /leaderboard => upsert { wallet, streak, winRate }
*****************************************************************/
app.post("/leaderboard", async (req, res) => {
  try {
    const { wallet, streak, winRate } = req.body;
    if (!wallet) {
      return res.status(400).json({ error: "Missing wallet" });
    }

    // Insert or update => ON DUPLICATE KEY
    const sql = `
      INSERT INTO leaderboard (wallet, streak, winRate)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        streak   = VALUES(streak),
        winRate  = VALUES(winRate),
        updated_at = CURRENT_TIMESTAMP
    `;
    await pool.execute(sql, [wallet, streak || 0, winRate || 0]);

    return res.json({ message: "Leaderboard updated", wallet, streak, winRate });
  } catch (err) {
    console.error("DB insert/update error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

/*****************************************************************
  GET /leaderboard => returns [ { wallet, streak, winRate, rank }, ... ]
*****************************************************************/
app.get("/leaderboard", async (req, res) => {
  try {
    // 1) Grab the entire table, sorted by streak desc
    const selectSQL = `
      SELECT wallet, streak, winRate, updated_at
      FROM leaderboard
      ORDER BY streak DESC, updated_at DESC
    `;
    const [rows] = await pool.execute(selectSQL);

    // 2) We can compute rank on the fly: row index + 1
    //    (Because MySQL doesn't have an easy "RANK()" unless we do 8.0 window functions)
    //    We'll just do it in JS for clarity.
    const leaderboardWithRank = rows.map((r, i) => ({
      ...r,
      rank: i + 1
    }));

    return res.json(leaderboardWithRank);
  } catch (err) {
    console.error("DB select error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

/*****************************************************************
  (Optional) GET /leaderboard/:wallet => return that user’s rank
*****************************************************************/
app.get("/leaderboard/:wallet", async (req, res) => {
  try {
    const userWallet = req.params.wallet;
    // 1) Get entire table
    const selectSQL = `
      SELECT wallet, streak, winRate, updated_at
      FROM leaderboard
      ORDER BY streak DESC, updated_at DESC
    `;
    const [rows] = await pool.execute(selectSQL);

    // 2) Compute rank
    let userEntry;
    rows.forEach((r, i) => {
      if (r.wallet === userWallet) {
        userEntry = {
          wallet: r.wallet,
          streak: r.streak,
          winRate: r.winRate,
          rank: i + 1
        };
      }
    });

    if (!userEntry) {
      return res.status(404).json({ error: "Wallet not found" });
    }
    return res.json(userEntry);
  } catch (err) {
    console.error("DB select error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

/*****************************************************************
  Start server
*****************************************************************/
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

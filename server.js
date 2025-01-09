////////////////////////////////////////////////////////////
// server.js (MySQL + Railway)
////////////////////////////////////////////////////////////
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise"); // <-- using mysql2/promise

const app = express();
app.use(cors());
app.use(express.json());

// Just optional debug/logging middleware
app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

// -------------- MySQL Setup --------------
// We'll create a "pool" of connections, using your env vars from Railway:
//
//   process.env.MYSQLHOST
//   process.env.MYSQLUSER
//   process.env.MYSQLPASSWORD
//   process.env.MYSQLDATABASE
//   process.env.MYSQLPORT
//
// *Make sure these are actually present in your Railway environment tab*
let db;

async function initDB() {
  try {
    db = await mysql.createPool({
      host: process.env.MYSQLHOST || "mysql.railway.internal",
      user: process.env.MYSQLUSER || "root",
      password: process.env.MYSQLPASSWORD || "",
      database: process.env.MYSQLDATABASE || "railway",
      port: process.env.MYSQLPORT ? parseInt(process.env.MYSQLPORT, 10) : 3306,
      waitForConnections: true,
      connectionLimit: 5, // or higher if needed
    });

    console.log("MySQL pool created.");

    // Ensure leaderboard table exists:
    await db.execute(`
      CREATE TABLE IF NOT EXISTS leaderboard (
        id INT AUTO_INCREMENT PRIMARY KEY,
        wallet VARCHAR(255) UNIQUE,
        streak INT DEFAULT 0,
        winRate FLOAT DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log("leaderboard table ensured/existing or created.");
  } catch (err) {
    console.error("Error initializing DB:", err);
  }
}

// -------------- Routes --------------

// POST /leaderboard => upsert (wallet, streak, winRate)
app.post("/leaderboard", async (req, res) => {
  console.log("POST /leaderboard body:", req.body);

  const { wallet, streak, winRate } = req.body;
  if (!wallet) {
    return res.status(400).json({ error: "Missing wallet" });
  }

  try {
    // MySQL "upsert" with ON DUPLICATE KEY
    const sql = `
      INSERT INTO leaderboard (wallet, streak, winRate)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        streak = VALUES(streak),
        winRate = VALUES(winRate),
        updated_at = CURRENT_TIMESTAMP
    `;
    const params = [wallet, streak || 0, winRate || 0];
    await db.execute(sql, params);

    console.log(`Upsert done: wallet=${wallet}, streak=${streak}, winRate=${winRate}`);
    return res.json({ message: "Leaderboard updated", wallet, streak, winRate });
  } catch (err) {
    console.error("DB insert/update error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

// GET /leaderboard => top 50 by streak desc
app.get("/leaderboard", async (req, res) => {
  console.log("GET /leaderboard");
  try {
    const sql = `
      SELECT wallet, streak, winRate, updated_at
      FROM leaderboard
      ORDER BY streak DESC, updated_at DESC
      LIMIT 50
    `;
    const [rows] = await db.execute(sql);
    console.log(`Returning ${rows.length} rows`);
    return res.json(rows);
  } catch (err) {
    console.error("DB select error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

// -------------- Start Server --------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  await initDB();
});

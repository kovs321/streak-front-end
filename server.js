require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise'); // <-- for async/await

const app = express();
app.use(cors());
app.use(express.json());

// Create a MySQL connection pool
let pool;

/**
 * Initialize DB pool ONCE when the app starts.
 * We read the env vars and create the pool. 
 */
async function initDB() {
  try {
    pool = await mysql.createPool({
      host:     process.env.MYSQLHOST,      // e.g. 'mysql.railway.internal'
      user:     process.env.MYSQLUSER,      // e.g. 'root'
      password: process.env.MYSQLPASSWORD,  // your password from Railway
      database: process.env.MYSQLDATABASE,  // e.g. 'railway'
      port:     process.env.MYSQLPORT,      // 3306
      // You can tweak connectionLimit, etc. if you like
    });
    console.log("MySQL pool created.");

    // Optional: test a simple query
    await pool.execute('SELECT 1');
    console.log("DB connected successfully.");
  } catch (err) {
    console.error("Error initializing DB:", err);
  }
}

// Call initDB at startup
initDB();

// ROUTE 1) POST /leaderboard
// Insert or update a wallet’s streak & winRate in MySQL
app.post('/leaderboard', async (req, res) => {
  try {
    const { wallet, streak, winRate } = req.body;

    if (!wallet) {
      return res.status(400).json({ error: "Missing wallet" });
    }

    // Using MySQL's "INSERT … ON DUPLICATE KEY UPDATE" 
    // (requires "wallet" to be the PRIMARY KEY or UNIQUE in your table)
    const sql = `
      INSERT INTO leaderboard (wallet, streak, winRate)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        streak  = VALUES(streak),
        winRate = VALUES(winRate)
    `;

    // Execute the query (pool must be initialized)
    await pool.execute(sql, [wallet, streak || 0, winRate || 0]);

    console.log(`Upsert done for wallet: ${wallet}, streak: ${streak}, winRate: ${winRate}`);
    return res.json({ message: "Leaderboard updated", wallet, streak, winRate });
  } catch (err) {
    console.error("POST /leaderboard error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// ROUTE 2) GET /leaderboard
// Return top 50, sorted by streak DESC
app.get('/leaderboard', async (req, res) => {
  try {
    const sql = `
      SELECT wallet, streak, winRate
      FROM leaderboard
      ORDER BY streak DESC
      LIMIT 50
    `;
    const [rows] = await pool.execute(sql);
    return res.json(rows);
  } catch (err) {
    console.error("GET /leaderboard error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Start server
const PORT = process.env.PORT || 3000; 
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

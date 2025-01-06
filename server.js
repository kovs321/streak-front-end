// server.js
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json());

// OPTIONAL: log requests
app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

// Open or create streak.db
const db = new sqlite3.Database('streak.db', (err) => {
  if (err) console.error("DB error:", err);
  else console.log("SQLite DB connected.");
});

// Create table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS leaderboard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT UNIQUE,
    streak INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// POST /leaderboard => upsert wallet & streak
app.post('/leaderboard', (req, res) => {
  console.log("POST /leaderboard body:", req.body);

  const { wallet, streak } = req.body;
  if (!wallet) {
    return res.status(400).json({ error: "Missing wallet" });
  }

  const sql = `
    INSERT INTO leaderboard (wallet, streak)
    VALUES (?, ?)
    ON CONFLICT(wallet) DO UPDATE
      SET streak=excluded.streak,
          updated_at=CURRENT_TIMESTAMP
  `;
  db.run(sql, [wallet, streak || 0], function(err) {
    if (err) {
      console.error("DB insert/update error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    console.log(`Upsert for ${wallet}, streak: ${streak}`);
    return res.json({ message: "Leaderboard updated", wallet, streak });
  });
});

// GET /leaderboard => top 50
app.get('/leaderboard', (req, res) => {
  console.log("GET /leaderboard called");
  const sql = `
    SELECT wallet, streak, updated_at
    FROM leaderboard
    ORDER BY streak DESC, updated_at DESC
    LIMIT 50
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error("DB select error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    console.log(`Returning ${rows.length} rows`);
    res.json(rows);
  });
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port:", PORT);
});

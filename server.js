// server.js
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json());

// 1) OPTIONAL MIDDLEWARE: log every request method + URL
app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

// Open (or create) streak.db
const db = new sqlite3.Database('streak.db', (err) => {
  if (err) console.error("DB error:", err);
  else console.log("SQLite DB connected.");
});

// CREATE/UPDATE TABLE to add 'winRate'
db.run(`
  CREATE TABLE IF NOT EXISTS leaderboard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT UNIQUE,
    streak INTEGER DEFAULT 0,
    winRate REAL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);



app.post('/leaderboard', (req, res) => {
  console.log("POST /leaderboard called with body:", req.body);

  // ADD this:
  const { wallet, streak, winRate } = req.body; // or rename to winRate if you prefer

  if (!wallet) {
    return res.status(400).json({ error: "Missing wallet" });
  }

  // Insert or update => include 'winRate' in both the columns and ON CONFLICT
  const sql = `
  INSERT INTO leaderboard (wallet, streak, winRate)
  VALUES (?, ?, ?)
  ON CONFLICT(wallet) DO UPDATE
    SET streak=excluded.streak,
        winRate=excluded.winRate,
        updated_at=CURRENT_TIMESTAMP
`;

  // pass [wallet, streak||0, winRate||0] to handle undefined
  db.run(sql, [wallet, streak || 0, winRate || 0], function(err) {
    if (err) {
      console.error("DB insert/update error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    console.log(`Upsert done for wallet: ${wallet}, streak: ${streak}, winRate: ${winRate}`);
    return res.json({ message: "Leaderboard updated", wallet, streak, winRate });
  });
});


// GET /leaderboard => return top 50, sorted by streak desc
app.get('/leaderboard', (req, res) => {
  console.log("GET /leaderboard called");
  const sql = `
    SELECT wallet, streak, winRate, updated_at
    FROM leaderboard
    ORDER BY streak DESC, updated_at DESC
    LIMIT 50
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error("DB select error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    console.log(`Returning ${rows.length} leaderboard rows`);
    res.json(rows);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});




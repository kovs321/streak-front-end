/*************************************************************
  SINGLE “BUY→SELL” CYCLE CODE
  (partial sells do NOT produce multiple wins)
*************************************************************/

/** DOM references (IDs from your HTML) */
const searchBtn          = document.getElementById("searchBtn");
const walletInput        = document.getElementById("walletInput");
const leaderboardTable   = document.getElementById("leaderboard");
const mainStreakHeading  = document.getElementById("mainStreak");
const gotoRankBtn        = document.getElementById("gotoRankBtn");

/** SolTracker API key (visible in front-end) */
const SOLTRACKER_API_KEY = "c9bae0d7-03b1-48a8-8347-c952d84534dc"; // <-- Replace with real key

let lastWalletUsed = null; // We'll store the user’s wallet after they input it

/*************************************************************
  1) Fetch trades from SolTracker
*************************************************************/
async function fetchWalletTrades(walletAddress) {
  const url = `https://data.solanatracker.io/wallet/${walletAddress}/trades`;
  const response = await fetch(url, {
    headers: { "x-api-key": SOLTRACKER_API_KEY },
  });
  if (!response.ok) {
    throw new Error(`Fetch error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return data.trades || [];
}

/*************************************************************
  2) Identify if token is SOL/WSOL
*************************************************************/
function isSolMint(addr = "") {
  return (
    addr.includes("So11111111111111111111111111111111111111112") ||
    addr.includes("WSOL")
  );
}

/*************************************************************
  3) parseTrade => "buy", "sell", or skip
*************************************************************/
function parseTrade(trade) {
  const fromAddr = trade?.from?.address || "";
  const toAddr   = trade?.to?.address   || "";
  const fromAmt  = trade?.from?.amount  || 0;
  const toAmt    = trade?.to?.amount    || 0;
  const time     = trade.time;

  const fromIsSol = isSolMint(fromAddr);
  const toIsSol   = isSolMint(toAddr);

  // skip if from->to is both SOL or both SPL
  if ((fromIsSol && toIsSol) || (!fromIsSol && !toIsSol)) {
    return { action: "skip" };
  }

  // SOL => SPL => buy
  if (fromIsSol && !toIsSol) {
    return {
      action: "buy",
      tokenMint: toAddr,
      costSol: fromAmt,
      tokenAmt: toAmt,
      time,
    };
  } else {
    // SPL => SOL => sell
    return {
      action: "sell",
      tokenMint: fromAddr,
      sellAmt: fromAmt,
      proceedsSol: toAmt,
      time,
    };
  }
}

/*************************************************************
  4) Data structure for each token’s buy->sell cycle
*************************************************************/
function createLedger() {
  // ledger[mint] = { netTokenHolding, totalBoughtSol, totalProceedsSol, completedTrades: [] }
  return {};
}

function ensureTokenObj(ledger, mint) {
  if (!ledger[mint]) {
    ledger[mint] = {
      netTokenHolding: 0,
      totalBoughtSol: 0,
      totalProceedsSol: 0,
      completedTrades: [],
    };
  }
  return ledger[mint];
}

/*************************************************************
  5) handleBuy
*************************************************************/
function handleBuy(ledger, mint, tokenAmt, costSol) {
  const obj = ensureTokenObj(ledger, mint);
  obj.netTokenHolding += tokenAmt;
  obj.totalBoughtSol  += costSol;
}

/*************************************************************
  6) handleSell => finalize cycle if netTokenHolding ~0
*************************************************************/
function handleSell(ledger, mint, sellAmt, proceedsSol, time) {
  const obj = ensureTokenObj(ledger, mint);
  const amtToSell = Math.min(sellAmt, obj.netTokenHolding);

  obj.netTokenHolding  -= amtToSell;
  obj.totalProceedsSol += proceedsSol;

  // finalize cycle if netTokenHolding < ~0
  if (obj.netTokenHolding < 0.0000001) {
    const netProfit = obj.totalProceedsSol - obj.totalBoughtSol;
    obj.completedTrades.push({ closeTime: time, netProfit });

    // reset
    obj.netTokenHolding  = 0;
    obj.totalBoughtSol   = 0;
    obj.totalProceedsSol = 0;
  }
}

/*************************************************************
  7) processTradesByFullCycles => returns { maxStreak, winRate, ...}
*************************************************************/
function processTradesByFullCycles(rawTrades) {
  rawTrades.sort((a, b) => a.time - b.time);

  const ledger = createLedger();
  for (const t of rawTrades) {
    const info = parseTrade(t);
    if (info.action === "skip") continue;
    if (info.action === "buy") {
      handleBuy(ledger, info.tokenMint, info.tokenAmt, info.costSol);
    } else if (info.action === "sell") {
      handleSell(ledger, info.tokenMint, info.sellAmt, info.proceedsSol, info.time);
    }
  }

  // gather all completed trades across tokens
  let allCompleted = [];
  for (const mint in ledger) {
    allCompleted.push(...ledger[mint].completedTrades);
  }
  allCompleted.sort((a, b) => a.closeTime - b.closeTime);

  let current = 0;
  let maxStreak = 0;
  let totalTrades = 0;
  let totalWins = 0;

  for (const c of allCompleted) {
    totalTrades++;
    if (c.netProfit > 0) {
      totalWins++;
      current++;
      maxStreak = Math.max(maxStreak, current);
    } else {
      current = 0;
    }
  }

  // Compute winRate
  let winRate = 0;
  if (totalTrades > 0) {
    winRate = (totalWins / totalTrades) * 100; 
  }

  return {
    maxStreak,
    allCompleted,
    winRate,
    totalTrades,
    totalWins
  };
}

/*************************************************************
  8) Show final row (just for immediate user feedback)
*************************************************************/
function showSingleRow(wallet, bestStreak) {
  // Clear existing placeholders
  leaderboardTable.innerHTML = "";

  const row = document.createElement("div");
  row.classList.add("leaderboard-row");

  const rankDiv = document.createElement("div");
  rankDiv.classList.add("rank");
  rankDiv.innerText = "?";

  const userDiv = document.createElement("div");
  userDiv.classList.add("user");

  // Link to solscan
  const link = document.createElement("a");
  link.href = `https://solscan.io/account/${wallet}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.innerText = wallet;
  userDiv.appendChild(link);

  const streakDiv = document.createElement("div");
  streakDiv.classList.add("streak");
  streakDiv.innerText = bestStreak;

  row.appendChild(rankDiv);
  row.appendChild(userDiv);
  row.appendChild(streakDiv);

  leaderboardTable.appendChild(row);
}

/*************************************************************
  9) MAIN: on search click => fetch, compute, post, fetch leaderboard
*************************************************************/
searchBtn.addEventListener("click", async () => {
  const wallet = walletInput.value.trim();
  if (!wallet) {
    console.error("No wallet address provided.");
    return;
  }

  // Mark the start time
  const startTime = Date.now();

  // 1) Show overlay
  showLoadingOverlay();
  // Show "Streak: ..." while loading
  mainStreakHeading.innerText = "Streak: ...";

  let maxStreak = 0;
  try {
    // 2) Fetch trades
    const rawTrades = await fetchWalletTrades(wallet);

    // 3) Compute streak & winRate
    const { maxStreak: computedStreak, winRate } = processTradesByFullCycles(rawTrades);
    maxStreak = computedStreak;
    console.log("Computed winRate:", winRate);

    // 4) Post to DB & fetch entire leaderboard
    lastWalletUsed = wallet;
    // If you also want to store the winRate in the DB, 
    // you must pass it to postToLeaderboard and handle it on the server:
    // await postToLeaderboard(wallet, maxStreak, winRate);
    await postToLeaderboard(wallet, maxStreak, winRate);
    await fetchAndRenderLeaderboard();

    // 5) Wait at least 3s total
    const elapsed = Date.now() - startTime;
    const minLoading = 3000;
    if (elapsed < minLoading) {
      await new Promise(resolve => setTimeout(resolve, minLoading - elapsed));
    }

    // 6) Now 3s are done, show final streak
    mainStreakHeading.innerHTML = `Streak: <span class="myStreakValue">${maxStreak}</span>`;

    // 7) Clear input
    walletInput.value = "";

  } catch (error) {
    console.error("Could not fetch or parse trades:", error);
    alert("Error fetching trades or computing streak!");
  } finally {
    // 8) Hide overlay
    hideLoadingOverlay();
  }
});

/*************************************************************
  OVERLAY LOGIC
*************************************************************/
function showLoadingOverlay() {
  console.log("showLoadingOverlay() called");
  let overlay = document.getElementById("loadingOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "loadingOverlay";
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100vw";
    overlay.style.height = "100vh";
    overlay.style.backgroundColor = "rgba(255,0,0,0.9)";
    overlay.style.zIndex = "9999";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";

    let spinner = document.createElement("div");
    spinner.innerText = "Loading...";
    spinner.style.fontSize = "2rem";
    spinner.style.color = "#fff";
    overlay.appendChild(spinner);

    document.body.appendChild(overlay);
    console.log("Created new overlay in DOM");
  } else {
    overlay.style.display = "flex";
    console.log("Re-used existing overlay in DOM");
  }
}

function hideLoadingOverlay() {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) {
    overlay.style.display = "none";
  }
}

/*************************************************************
  POST => your deployed server
*************************************************************/
async function postToLeaderboard(wallet, streak, winRate) {
  try {
    const body = { wallet, streak, winRate };
    const response = await fetch("https://streak-front-end-production.up.railway.app/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    console.log("Server POST response:", data);
  } catch (err) {
    console.error("Failed to POST leaderboard data:", err);
  }
}

/*************************************************************
  GET => render entire leaderboard
*************************************************************/
async function fetchAndRenderLeaderboard() {
  try {
    const res = await fetch("https://streak-front-end-production.up.railway.app/leaderboard");
    const data = await res.json();

    // Clear existing
    leaderboardTable.innerHTML = "";

    data.forEach((rowData, index) => {
      const rankIndex = index + 1;

      const divRow = document.createElement("div");
      divRow.classList.add("leaderboard-row");

      // rank
      const rankDiv = document.createElement("div");
      rankDiv.classList.add("rank");
      rankDiv.innerText = rankIndex;

      // user
      const userDiv = document.createElement("div");
      userDiv.classList.add("user");
      const link = document.createElement("a");
      link.href = `https://solscan.io/account/${rowData.wallet}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.innerText = rowData.wallet;
      userDiv.appendChild(link);

      // streak
      const streakDiv = document.createElement("div");
      streakDiv.classList.add("streak");
      streakDiv.innerText = rowData.streak;

      // (NEW) If you also have rowData.winRate from the server:
      // create a <div> for it
      const winRateDiv = document.createElement("div");
      winRateDiv.classList.add("winrate");
      winRateDiv.innerText = rowData.winRate 
        ? rowData.winRate.toFixed(1) + "%"
        : "--";

      // Append columns in final order: rank, user, streak, winRate
      divRow.appendChild(rankDiv);
      divRow.appendChild(userDiv);
      divRow.appendChild(streakDiv);
      divRow.appendChild(winRateDiv);

      // highlight newly searched user
      if (rowData.wallet === lastWalletUsed) {
        divRow.id = "currentUserRow";
        divRow.classList.add("highlight-current-user");
      }
      leaderboardTable.appendChild(divRow);
    });

  } catch (err) {
    console.error("Error fetching leaderboard:", err);
  }
}

/*************************************************************
  SCROLL TO CURRENT USER’S RANK
*************************************************************/
gotoRankBtn.addEventListener("click", () => {
  const userRow = document.getElementById("currentUserRow");
  if (userRow) {
    userRow.scrollIntoView({ behavior: "smooth", block: "center" });
  } else {
    alert("Your rank isn't found yet. Please search first!");
  }
});

/*************************************************************
  (NEW) Load leaderboard on page load
*************************************************************/
document.addEventListener("DOMContentLoaded", async () => {
  fetchAndRenderLeaderboard();
});



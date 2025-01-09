/*************************************************************
  SINGLE “BUY→SELL” CYCLE CODE
  (partial sells do NOT produce multiple wins)
*************************************************************/

/** DOM references */
const searchBtn         = document.getElementById("searchBtn");
const walletInput       = document.getElementById("walletInput");
const leaderboardTable  = document.getElementById("leaderboard");
const mainStreakHeading = document.getElementById("mainStreak");
const gotoRankBtn       = document.getElementById("gotoRankBtn");

// The numeric portion in <span class="myStreakValue">0</span>
const streakNumEl       = document.querySelector(".myStreakValue");

// (NEW) For sorting columns
const sortByStreakEl    = document.getElementById("sortByStreak");  // <div id="sortByStreak" ...
const sortByWinEl       = document.getElementById("sortByWin");     // <div id="sortByWin" ...

/** SolTracker API key (visible in front-end) */
const SOLTRACKER_API_KEY = "c9bae0d7-03b1-48a8-8347-c952d84534dc";

/** 
 * We keep track of which column is currently sorted & whether ascending or descending.
 * e.g. currentSortColumn = "streak" or "winRate"
 *      currentSortOrder  = "asc" or "desc"
 */
let currentSortColumn   = null; 
let currentSortOrder    = "desc";

let lastWalletUsed      = null; 
let lastStreakForShare  = 0; // used for "Share My Streak" overlay

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
  4) Data structure
*************************************************************/
function createLedger() {
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
  6) handleSell => finalize if netTokenHolding ~0
*************************************************************/
function handleSell(ledger, mint, sellAmt, proceedsSol, time) {
  const obj = ensureTokenObj(ledger, mint);
  const amtToSell = Math.min(sellAmt, obj.netTokenHolding);

  obj.netTokenHolding  -= amtToSell;
  obj.totalProceedsSol += proceedsSol;

  if (obj.netTokenHolding < 0.0000001) {
    const netProfit = obj.totalProceedsSol - obj.totalBoughtSol;
    obj.completedTrades.push({ closeTime: time, netProfit });

    obj.netTokenHolding  = 0;
    obj.totalBoughtSol   = 0;
    obj.totalProceedsSol = 0;
  }
}

/*************************************************************
  7) processTradesByFullCycles => { maxStreak, winRate, ...}
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

  // gather all completed
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
  leaderboardTable.innerHTML = "";

  const row = document.createElement("div");
  row.classList.add("leaderboard-row");

  const rankDiv = document.createElement("div");
  rankDiv.classList.add("rank");
  rankDiv.innerText = "?";

  const userDiv = document.createElement("div");
  userDiv.classList.add("user");

  const link = document.createElement("a");
  link.href = `https://solscan.io/account/${wallet}`;
  link.target = "_blank";
  link.rel    = "noopener noreferrer";
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
  9) MAIN: on search click => fetch, compute, post, fetch
*************************************************************/
searchBtn.addEventListener("click", async () => {
  const wallet = walletInput.value.trim();
  if (!wallet) {
    alert("Please enter a valid wallet!");
    return;
  }

  // 1) Show overlay
  showLoadingOverlay();

  let maxStreak = 0;
  try {
    const rawTrades = await fetchWalletTrades(wallet);
    const { maxStreak: computedStreak, winRate } = processTradesByFullCycles(rawTrades);

    maxStreak           = computedStreak;
    lastWalletUsed      = wallet;
    lastStreakForShare  = maxStreak; 

    // 2) Post to DB & fetch entire leaderboard
    await postToLeaderboard(wallet, maxStreak, winRate);
    await fetchAndRenderLeaderboard();

    // 3) Update the numeric part => green
    streakNumEl.textContent = maxStreak;
    streakNumEl.style.color = "#00ffa2";

  } catch (error) {
    console.error("Could not fetch/parse trades:", error);
    alert("Error fetching trades or computing streak!");
  } finally {
    hideLoadingOverlay();
  }
});

/*************************************************************
  OVERLAY LOGIC
*************************************************************/
function showLoadingOverlay() {
  let overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;
  overlay.classList.remove("hidden");
}

function hideLoadingOverlay() {
  let overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
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
  SORT HELPER (NEW)
  
  Use this function to sort the data array by the currentSortColumn
  and currentSortOrder (asc/desc). This runs inside fetchAndRenderLeaderboard
  after we get the data from the server.
*************************************************************/
function sortDataArray(data) {
  if (!currentSortColumn) {
    return data; // no sort => return as is
  }

  // sort in place
  data.sort((a, b) => {
    let valA = a[currentSortColumn] || 0;
    let valB = b[currentSortColumn] || 0;

    // parse numeric
    valA = parseFloat(valA);
    valB = parseFloat(valB);

    if (valA < valB) return (currentSortOrder === "asc") ? -1 : 1;
    if (valA > valB) return (currentSortOrder === "asc") ? 1 : -1;
    return 0;
  });

  return data;
}

/*************************************************************
  GET => render entire leaderboard
*************************************************************/
async function fetchAndRenderLeaderboard() {
  try {
    const res = await fetch("https://streak-front-end-production.up.railway.app/leaderboard");
    let data = await res.json();

    // (NEW) We sort the data in memory
    data = sortDataArray(data);

    leaderboardTable.innerHTML = "";

    data.forEach((rowData, index) => {
      const rankIndex = index + 1;

      const divRow = document.createElement("div");
      divRow.classList.add("leaderboard-row");

      const rankDiv = document.createElement("div");
      rankDiv.classList.add("rank");
      rankDiv.innerText = rankIndex;

      const userDiv = document.createElement("div");
      userDiv.classList.add("user");
      const link = document.createElement("a");
      link.href = `https://solscan.io/account/${rowData.wallet}`;
      link.target = "_blank";
      link.rel    = "noopener noreferrer";
      link.innerText = rowData.wallet;
      userDiv.appendChild(link);

      const streakDiv = document.createElement("div");
      streakDiv.classList.add("streak");
      streakDiv.innerText = rowData.streak;

      const winRateDiv = document.createElement("div");
      winRateDiv.classList.add("winrate");
      winRateDiv.innerText = rowData.winRate
        ? rowData.winRate.toFixed(1) + "%"
        : "--";

      divRow.appendChild(rankDiv);
      divRow.appendChild(userDiv);
      divRow.appendChild(streakDiv);
      divRow.appendChild(winRateDiv);

      if (rowData.wallet === lastWalletUsed) {
        divRow.id = "currentUserRow";
        divRow.classList.add("highlight-current-user");
      }
      leaderboardTable.appendChild(divRow);
    });

    // (NEW) Update the arrow icons/indicators
    updateSortArrows();

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
document.addEventListener("DOMContentLoaded", () => {
  fetchAndRenderLeaderboard();
});

// Hide the intro overlay when "closeIntroBtn" is clicked
const closeIntroBtn = document.getElementById("closeIntroBtn");
closeIntroBtn.addEventListener("click", () => {
  const introOverlay = document.getElementById("introOverlay");
  if (introOverlay) {
    introOverlay.style.display = "none";
  }
});

/*************************************************************
  SHARE MY STREAK Overlay
*************************************************************/
const openShareBtn      = document.getElementById("openShareBtn");
const shareCanvasOverlay= document.getElementById("shareCanvasOverlay");
const shareCanvas       = document.getElementById("shareCanvas");
const closeShareBtn     = document.getElementById("closeShareBtn");
const downloadCanvasBtn = document.getElementById("downloadCanvasBtn");
const tweetShareBtn     = document.getElementById("tweetShareBtn");

// 1) "Open Share" => show overlay, draw canvas
openShareBtn.addEventListener("click", () => {
  console.log("openShareBtn clicked!");
  shareCanvasOverlay.classList.remove("hidden");

  const ctx = shareCanvas.getContext("2d");
  ctx.clearRect(0, 0, shareCanvas.width, shareCanvas.height);

  // load background
  const bg = new Image();
  bg.src = "share.png"; // or your updated background
  bg.onload = () => {
    ctx.drawImage(bg, 0, 0, shareCanvas.width, shareCanvas.height);

    ctx.font = "bold 80px sans-serif";
    ctx.fillStyle = "#00ffa2";
    ctx.textAlign = "center";
    const x = shareCanvas.width / 2;
    const y = 250;

    ctx.fillText(`${lastStreakForShare}`, x, y);
  };
});

// 2) "Close" => hide
closeShareBtn.addEventListener("click", () => {
  shareCanvasOverlay.classList.add("hidden");
});

// 3) "Download" => save
downloadCanvasBtn.addEventListener("click", () => {
  const dataURL = shareCanvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.download = "my_streak.png";
  link.href = dataURL;
  link.click();
});

// 4) "Tweet This!"
tweetShareBtn.addEventListener("click", () => {
  const tweetText = encodeURIComponent(
    `I just reached a streak of ${lastStreakForShare}!`
  );
  const twitterUrl = `https://twitter.com/intent/tweet?text=${tweetText}`;
  window.open(twitterUrl, "_blank");
});

/*************************************************************
  (NEW) Sorting Implementation
*************************************************************/
function toggleSort(column) {
  // If same column => flip order
  if (currentSortColumn === column) {
    currentSortOrder = (currentSortOrder === "asc") ? "desc" : "asc";
  } else {
    currentSortColumn = column;
    currentSortOrder  = "desc";  // default
  }
  // re-fetch or re-sort
  fetchAndRenderLeaderboard();
}

// Add event listeners for your headings
sortByStreakEl.addEventListener("click", () => {
  toggleSort("streak");
});
sortByWinEl.addEventListener("click", () => {
  toggleSort("winRate");
});

/**
 * Optionally show arrow icons or up/down text next to headings
 */
function updateSortArrows() {
  // Clear out any old arrows
  sortByStreakEl.textContent = "STREAK";
  sortByWinEl.textContent    = "WIN%";

  // If sorted by 'streak'
  if (currentSortColumn === "streak") {
    if (currentSortOrder === "asc") {
      sortByStreakEl.textContent += " ↑";
    } else {
      sortByStreakEl.textContent += " ↓";
    }
  }

  // If sorted by 'winRate'
  if (currentSortColumn === "winRate") {
    if (currentSortOrder === "asc") {
      sortByWinEl.textContent += " ↑";
    } else {
      sortByWinEl.textContent += " ↓";
    }
  }
}

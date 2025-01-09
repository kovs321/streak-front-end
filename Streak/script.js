/*************************************************************
  script.js — Front-End Logic 
  with sorting (Streak & Win%) and “Share My Streak” overlay
*************************************************************/

/** DOM references */
const searchBtn         = document.getElementById("searchBtn");
const walletInput       = document.getElementById("walletInput");
const leaderboardTable  = document.getElementById("leaderboard");
const mainStreakHeading = document.getElementById("mainStreak");
const gotoRankBtn       = document.getElementById("gotoRankBtn");

// The numeric portion in <span class="myStreakValue">0</span>
const streakNumEl       = document.querySelector(".myStreakValue");

/** 
 * Columns to sort by:
 * We'll attach events to #sortByStreak, #sortByWin (DIVs or SPANs in your HTML)
 */
const sortByStreakEl    = document.getElementById("sortByStreak");
const sortByWinEl       = document.getElementById("sortByWin");

let currentSortColumn   = null;  // "streak" or "winRate"
let currentSortOrder    = "desc";

let lastWalletUsed      = null; 
let lastStreakForShare  = 0;     // used for “Share My Streak” overlay

/*************************************************************
  1) fetchWalletTrades => If you still call SolTracker from front-end 
     (Not recommended if you want to hide the API key).
     If you want your server to do it, remove this and call your 
     server endpoint instead.
*************************************************************/
// If you plan to hide your key, remove or disable the direct fetch here 
// and let your server handle SolTracker requests.
const SOLTRACKER_API_KEY = "YOUR_SOLTRACKER_KEY_HERE"; 
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
  2) processTrades => parse & compute (same as your older logic)
*************************************************************/
function isSolMint(addr = "") {
  return (
    addr.includes("So11111111111111111111111111111111111111112") ||
    addr.includes("WSOL")
  );
}
function parseTrade(trade) {
  // same parse logic
  const fromAddr = trade?.from?.address || "";
  const toAddr   = trade?.to?.address   || "";
  const fromAmt  = trade?.from?.amount  || 0;
  const toAmt    = trade?.to?.amount    || 0;
  const time     = trade.time;

  const fromIsSol = isSolMint(fromAddr);
  const toIsSol   = isSolMint(toAddr);

  if ((fromIsSol && toIsSol) || (!fromIsSol && !toIsSol)) {
    return { action: "skip" };
  }

  if (fromIsSol && !toIsSol) {
    return {
      action: "buy",
      tokenMint: toAddr,
      costSol: fromAmt,
      tokenAmt: toAmt,
      time,
    };
  } else {
    return {
      action: "sell",
      tokenMint: fromAddr,
      sellAmt: fromAmt,
      proceedsSol: toAmt,
      time,
    };
  }
}
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
function handleBuy(ledger, mint, tokenAmt, costSol) {
  const obj = ensureTokenObj(ledger, mint);
  obj.netTokenHolding += tokenAmt;
  obj.totalBoughtSol  += costSol;
}
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
function processTradesByFullCycles(rawTrades) {
  rawTrades.sort((a, b) => a.time - b.time);

  const ledger = createLedger();
  for (const t of rawTrades) {
    const info = parseTrade(t);
    if (info.action === "skip") continue;
    if (info.action === "buy")  handleBuy(ledger, info.tokenMint, info.tokenAmt, info.costSol);
    if (info.action === "sell") handleSell(ledger, info.tokenMint, info.sellAmt, info.proceedsSol, info.time);
  }

  let allCompleted = [];
  for (const mint in ledger) {
    allCompleted.push(...ledger[mint].completedTrades);
  }
  allCompleted.sort((a, b) => a.closeTime - b.closeTime);

  let current = 0, maxStreak = 0, totalTrades = 0, totalWins = 0;
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
  return { maxStreak, winRate, allCompleted, totalTrades, totalWins };
}

/*************************************************************
  3) searchBtn => main logic
*************************************************************/
searchBtn.addEventListener("click", async () => {
  const wallet = walletInput.value.trim();
  if (!wallet) {
    alert("Please enter a valid wallet address!");
    return;
  }

  showLoadingOverlay();

  try {
    // 1) If you’re calling *directly* to SolTracker:
    const rawTrades = await fetchWalletTrades(wallet);

    // 2) Process
    const { maxStreak, winRate } = processTradesByFullCycles(rawTrades);
    lastStreakForShare = maxStreak; 
    lastWalletUsed     = wallet;

    // 3) Post to your DB (MySQL) — adjust URL if needed
    const body = { wallet, streak: maxStreak, winRate };
    await fetch("https://YOUR_SERVER_DOMAIN/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    // 4) Re-fetch the entire leaderboard
    await fetchAndRenderLeaderboard();

    // 5) Update the streak in the H1
    streakNumEl.textContent = maxStreak;
    streakNumEl.style.color = "#00ffa2"; // green highlight

  } catch (err) {
    console.error("Error in search flow:", err);
    alert("Could not fetch or compute trades!");
  } finally {
    hideLoadingOverlay();
  }
});

/*************************************************************
  4) fetchAndRenderLeaderboard => GET from your MySQL server
*************************************************************/
async function fetchAndRenderLeaderboard() {
  try {
    const res = await fetch("https://YOUR_SERVER_DOMAIN/leaderboard");
    let data = await res.json();

    // Sort if needed
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
      link.target= "_blank";
      link.rel   = "noopener noreferrer";
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

    updateSortArrows(); // update arrow icons

  } catch (err) {
    console.error("Error fetching leaderboard:", err);
  }
}

/*************************************************************
  5) (Optional) Sorting
*************************************************************/

function sortDataArray(data) {
  if (!currentSortColumn) return data;
  data.sort((a, b) => {
    let valA = parseFloat(a[currentSortColumn] || 0);
    let valB = parseFloat(b[currentSortColumn] || 0);
    if (valA < valB) return (currentSortOrder === "asc") ? -1 : 1;
    if (valA > valB) return (currentSortOrder === "asc") ? 1 : -1;
    return 0;
  });
  return data;
}
function toggleSort(column) {
  if (currentSortColumn === column) {
    currentSortOrder = (currentSortOrder === "asc") ? "desc" : "asc";
  } else {
    currentSortColumn = column;
    currentSortOrder  = "desc";
  }
  fetchAndRenderLeaderboard();
}
sortByStreakEl.addEventListener("click", () => toggleSort("streak"));
sortByWinEl.addEventListener("click", () => toggleSort("winRate"));

function updateSortArrows() {
  sortByStreakEl.textContent = "STREAK";
  sortByWinEl.textContent    = "WIN%";
  if (currentSortColumn === "streak") {
    if (currentSortOrder === "asc") {
      sortByStreakEl.textContent += " ↑";
    } else {
      sortByStreakEl.textContent += " ↓";
    }
  }
  if (currentSortColumn === "winRate") {
    if (currentSortOrder === "asc") {
      sortByWinEl.textContent += " ↑";
    } else {
      sortByWinEl.textContent += " ↓";
    }
  }
}

/*************************************************************
  6) “Go to My Rank” button
*************************************************************/
gotoRankBtn.addEventListener("click", () => {
  const userRow = document.getElementById("currentUserRow");
  if (userRow) {
    userRow.scrollIntoView({ behavior: "smooth", block: "center" });
  } else {
    alert("Your rank isn't found. Please search first!");
  }
});

/*************************************************************
  7) Overlays: intro + share
*************************************************************/
document.addEventListener("DOMContentLoaded", () => {
  // on page load => fetch leaderboard
  fetchAndRenderLeaderboard();
});
const closeIntroBtn = document.getElementById("closeIntroBtn");
closeIntroBtn.addEventListener("click", () => {
  const introOverlay = document.getElementById("introOverlay");
  if (introOverlay) introOverlay.style.display = "none";
});

/*************************************************************
  8) Share My Streak Overlay
*************************************************************/
const openShareBtn      = document.getElementById("openShareBtn");
const shareCanvasOverlay= document.getElementById("shareCanvasOverlay");
const shareCanvas       = document.getElementById("shareCanvas");
const closeShareBtn     = document.getElementById("closeShareBtn");
const downloadCanvasBtn = document.getElementById("downloadCanvasBtn");
const tweetShareBtn     = document.getElementById("tweetShareBtn");

openShareBtn.addEventListener("click", () => {
  shareCanvasOverlay.classList.remove("hidden");
  // draw the canvas
  const ctx = shareCanvas.getContext("2d");
  ctx.clearRect(0, 0, shareCanvas.width, shareCanvas.height);

  const bg = new Image();
  bg.src = "share.png"; // or your background image
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
closeShareBtn.addEventListener("click", () => {
  shareCanvasOverlay.classList.add("hidden");
});
downloadCanvasBtn.addEventListener("click", () => {
  const dataURL = shareCanvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.download = "my_streak.png";
  link.href = dataURL;
  link.click();
});
tweetShareBtn.addEventListener("click", () => {
  const tweetText  = encodeURIComponent(`I just reached a streak of ${lastStreakForShare}!`);
  const twitterUrl = `https://twitter.com/intent/tweet?text=${tweetText}`;
  window.open(twitterUrl, "_blank");
});

/*************************************************************
  Loading Overlay
*************************************************************/
function showLoadingOverlay() {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;
  overlay.classList.remove("hidden");
}
function hideLoadingOverlay() {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
}

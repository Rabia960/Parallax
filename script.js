// ==========================================
// PARALLAX - 7 levels + shared leaderboard
// ==========================================
// RULE: when you move a ring on the Primary board from platform X to Y,
// the Shadow board ALSO moves its own top ring, from map[X] to map[Y].
// The map changes with the "phase". BOTH moves must be legal.

const platformNames = ["A", "B", "C"];

const PHASES = {
    cw:    { label: "CLOCKWISE",         map: [1, 2, 0] },
    ccw:   { label: "COUNTER-CLOCKWISE", map: [2, 0, 1] },
    still: { label: "STILL (SAME SPOT)", map: [0, 1, 2] },
    swap:  { label: "SWAP A<->B",        map: [1, 0, 2] }
};

// opt = fewest possible moves (checked with a solver, so every level IS solvable)
const LEVELS = [
    { name: "Awakening",      rings: 3, phases: ["cw"],                 start: 1, goal: 0, opt: 7,  tip: "Classic Hanoi. The Shadow copies every move." },
    { name: "Deeper",         rings: 4, phases: ["cw"],                 start: 1, goal: 0, opt: 15, tip: "One more ring. Plan ahead." },
    { name: "The Twist",      rings: 3, phases: ["cw", "ccw", "still"], start: 1, goal: 1, opt: 11, tip: "The Shadow's rotation changes every move. Watch the lifted Shadow ring!" },
    { name: "Mirror Swap",    rings: 3, phases: ["cw", "cw", "swap"],   start: 1, goal: 0, opt: 16, tip: "Every third move, the Shadow swaps A and B." },
    { name: "Race Against Time", rings: 4, phases: ["cw"],              start: 1, goal: 0, opt: 15, time: 80, tip: "Solve it before the clock hits zero!" },
    { name: "Thin Ice",       rings: 3, phases: ["cw", "still", "ccw"], start: 1, goal: 1, opt: 15, maxMoves: 19, tip: "You only get 19 moves. Undo costs points but not moves." },
    { name: "Final Fracture", rings: 5, phases: ["cw"],                 start: 1, goal: 0, opt: 31, time: 160, tip: "Five rings against the clock. Good luck." }
];

let levelIndex = 0, totalScore = 0;
let primaryState, shadowState;
let selectedPlatform = null, lastLanded = null, lastShadowLanded = null;
let moveCount = 0, undos = 0, elapsed = 0, timerId = null;
let gameWon = false, playerName = "", history = [], nextAction = null;

const $ = id => document.getElementById(id);
const level = () => LEVELS[levelIndex];
const currentMap = () => PHASES[level().phases[moveCount % level().phases.length]].map;


// ==========================================
// LEVEL SETUP
// ==========================================

function loadLevel() {
    const L = level();
    const full = Array.from({ length: L.rings }, (_, i) => L.rings - i);   // [n, ..., 1]

    primaryState = [[...full], [], []];
    shadowState = [[], [], []];
    shadowState[L.start] = [...full];

    selectedPlatform = lastLanded = lastShadowLanded = null;
    moveCount = 0; undos = 0; elapsed = 0; history = [];
    gameWon = false;
    stopTimer();

    $("level-banner").innerHTML = "<b>LEVEL " + (levelIndex + 1) + " / " + LEVELS.length + " &mdash; " +
        L.name.toUpperCase() + "</b><br>" + L.tip;
    showMessage("Select a ring on the Primary Dimension.", "info");
    $("win-overlay").classList.add("hidden");
    updateGame();
}


// ==========================================
// RINGS + BOARDS
// ==========================================

function createRing(size, extraClass) {
    const ring = document.createElement("div");
    ring.className = "ring" + (extraClass ? " " + extraClass : "");
    ring.style.width = (26 + size * (68 / level().rings)) + "%";
    ring.style.setProperty("--s", size);
    return ring;
}

function renderBoard(boardId, state, isPrimary, highlightIndex, landedIndex) {

    const board = $(boardId);
    board.innerHTML = "";

    state.forEach((stack, index) => {

        const platform = document.createElement("div");
        platform.className = "platform" + (index === highlightIndex ? " active" : "");

        const pole = document.createElement("div");
        pole.className = "platform-pole";
        const base = document.createElement("div");
        base.className = "platform-base";
        const label = document.createElement("div");
        label.className = "platform-label";
        label.textContent = platformNames[index];
        const rings = document.createElement("div");
        rings.className = "rings";

        [...stack].reverse().forEach((size, i) => {
            let extra = "";
            if (i === 0) {
                if (index === highlightIndex) extra = isPrimary ? "selected" : "mirror";
                else if (index === landedIndex) extra = "landed";
            }
            rings.appendChild(createRing(size, extra));
        });

        platform.append(pole, base, label, rings);

        if (isPrimary) {
            platform.tabIndex = 0;
            platform.setAttribute("role", "button");
            platform.setAttribute("aria-label", "Platform " + platformNames[index]);
            platform.addEventListener("click", () => handlePlatformClick(index));
            platform.addEventListener("keydown", e => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handlePlatformClick(index); }
            });
        }
        board.appendChild(platform);
    });
}

function canPlace(stack, ring) {
    return stack.length === 0 || ring < stack[stack.length - 1];
}


// ==========================================
// HANDLE A CLICK (select, cancel, or move)
// ==========================================

function handlePlatformClick(dest) {

    if (gameWon || !$("win-overlay").classList.contains("hidden")) return;

    // 1) Select
    if (selectedPlatform === null) {
        if (primaryState[dest].length === 0) { showMessage("This platform is empty.", "error"); shake(); return; }
        selectedPlatform = dest;
        lastLanded = lastShadowLanded = null;
        startTimer();
        showMessage("Ring selected. The lifted Shadow ring will move too. Choose a destination.", "info");
        updateGame();
        return;
    }

    // 2) Cancel
    if (selectedPlatform === dest) {
        selectedPlatform = null;
        showMessage("Selection cancelled.", "info");
        updateGame();
        return;
    }

    // 3) Try the move in BOTH dimensions
    const map = currentMap();
    const src = selectedPlatform;
    const pSrc = primaryState[src], pDest = primaryState[dest];
    const sSrc = shadowState[map[src]], sDest = shadowState[map[dest]];
    const ring = pSrc[pSrc.length - 1];

    if (!canPlace(pDest, ring)) {
        showMessage("Primary blocked! A larger ring cannot sit on a smaller one.", "error"); shake(); return;
    }
    if (sSrc.length === 0) {
        showMessage("Shadow blocked! There is no Shadow ring on " + platformNames[map[src]] + " to move.", "error"); shake(); return;
    }
    const shadowRing = sSrc[sSrc.length - 1];
    if (!canPlace(sDest, shadowRing)) {
        showMessage("Shadow blocked! Its ring cannot go from " + platformNames[map[src]] + " to " + platformNames[map[dest]] + ".", "error"); shake(); return;
    }

    // 4) Both legal: save for undo, then move
    history.push({ p: primaryState.map(s => [...s]), s: shadowState.map(s => [...s]), moves: moveCount });

    pSrc.pop(); pDest.push(ring);
    sSrc.pop(); sDest.push(shadowRing);

    moveCount++;
    selectedPlatform = null;
    lastLanded = dest;
    lastShadowLanded = map[dest];

    showMessage("Synchronized! Both dimensions changed.", "success");
    updateGame();
    checkEnd();
}


// ==========================================
// UNDO, TIMER, SCORE
// ==========================================

function undoMove() {
    if (gameWon || history.length === 0) return;
    const prev = history.pop();
    primaryState = prev.p; shadowState = prev.s; moveCount = prev.moves;
    selectedPlatform = lastLanded = lastShadowLanded = null;
    undos++;
    showMessage("Move undone (-30 points).", "info");
    updateGame();
}

function startTimer() {
    if (timerId || gameWon) return;
    timerId = setInterval(() => {
        elapsed++;
        updateHUD();
        if (level().time && elapsed >= level().time) endLevel(false, "TIME'S UP");
    }, 1000);
}

function stopTimer() { clearInterval(timerId); timerId = null; }

function levelScore() {
    const L = level();
    const raw = 1000 + levelIndex * 100 - (moveCount - L.opt) * 20 - undos * 30 - elapsed * 2;
    return Math.max(100, raw);
}


// ==========================================
// WIN / FAIL
// ==========================================

function isSolved() {
    const L = level();
    return primaryState[2].length === L.rings && shadowState[L.goal].length === L.rings;
}

function checkEnd() {
    if (isSolved()) { endLevel(true); return; }
    if (level().maxMoves && moveCount >= level().maxMoves) endLevel(false, "OUT OF MOVES");
}

function endLevel(won, reason) {
    gameWon = true;                 // blocks further clicks
    stopTimer();
    const last = levelIndex === LEVELS.length - 1;

    if (won) {
        const pts = levelScore();
        totalScore += pts;
        const stars = moveCount <= level().opt ? "★★★" : moveCount <= level().opt * 1.3 ? "★★☆" : "★☆☆";
        $("win-title").textContent = last ? "ALL DIMENSIONS SYNCHRONIZED" : "LEVEL CLEARED " + stars;
        $("win-summary").textContent = moveCount + " moves (best: " + level().opt + "), " + elapsed + "s. +" + pts +
            " points. Total: " + totalScore + ".";
        $("next-button").textContent = last ? "PLAY AGAIN" : "NEXT LEVEL";
        nextAction = last ? () => { levelIndex = 0; totalScore = 0; loadLevel(); } : () => { levelIndex++; loadLevel(); };
        submitScore(totalScore, levelIndex + 1);
    } else {
        $("win-title").textContent = reason;
        $("win-summary").textContent = "You didn't make it this time. Try the level again.";
        $("next-button").textContent = "RETRY LEVEL";
        nextAction = loadLevel;
    }
    updateHUD();
    setTimeout(() => $("win-overlay").classList.remove("hidden"), won ? 600 : 100);
}


// ==========================================
// HUD + MESSAGES
// ==========================================

function showMessage(text, type) {
    const box = $("game-message");
    box.textContent = text;
    box.dataset.type = type || "info";
}

function shake() {
    const b = $("primary-board");
    b.classList.remove("shake"); void b.offsetWidth; b.classList.add("shake");
}

function updateHUD() {
    const L = level();
    $("level-indicator").textContent = "LEVEL " + (levelIndex + 1);
    $("phase-indicator").textContent = "NEXT PHASE: " + PHASES[L.phases[moveCount % L.phases.length]].label;
    $("move-counter").textContent = "MOVES: " + moveCount + (L.maxMoves ? " / " + L.maxMoves : "");
    $("score-chip").textContent = "SCORE: " + totalScore;

    const t = $("timer");
    if (L.time) {
        const left = Math.max(0, L.time - elapsed);
        t.textContent = "TIME LEFT: " + left + "s";
        t.classList.toggle("low", left <= 15);
    } else {
        t.textContent = "TIME: " + elapsed + "s";
        t.classList.remove("low");
    }
}

function updateGame() {
    const mirror = selectedPlatform === null ? null : currentMap()[selectedPlatform];
    renderBoard("primary-board", primaryState, true, selectedPlatform, lastLanded);
    renderBoard("shadow-board", shadowState, false, mirror, lastShadowLanded);
    updateHUD();
}


// ==========================================
// LEADERBOARD (shared via /api/leaderboard, local fallback)
// ==========================================

const LOCAL_KEY = "parallax-local-lb";

function localBoard() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}; } catch (e) { return {}; }
}

async function submitScore(score, lvl) {
    // always keep a local copy as a fallback
    const local = localBoard();
    if (!local[playerName] || local[playerName].score < score) {
        local[playerName] = { score, level: lvl };
        try { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); } catch (e) {}
    }
    await loadLeaderboard({ name: playerName, score, level: lvl });
}

async function loadLeaderboard(post) {
    let rows, online = true;
    try {
        const res = await fetch("/api/leaderboard", post
            ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(post) }
            : undefined);
        if (!res.ok) throw new Error("bad response");
        rows = await res.json();
    } catch (e) {
        online = false;
        rows = Object.entries(localBoard()).map(([name, v]) => ({ name, score: v.score, level: v.level }))
            .sort((a, b) => b.score - a.score).slice(0, 10);
    }

    $("lb-status").textContent = online ? "ONLINE · SHARED WITH ALL PLAYERS"
                                        : "OFFLINE · SHOWING SCORES FROM THIS DEVICE ONLY";
    const list = $("lb-list");
    list.innerHTML = "";
    if (!rows.length) list.innerHTML = "<li><span class='nm'>No scores yet. Be the first!</span></li>";

    rows.forEach(r => {
        const li = document.createElement("li");
        if (r.name === playerName) li.className = "me";
        const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = r.name;
        const lv = document.createElement("span"); lv.className = "lv"; lv.textContent = "LV " + r.level;
        const sc = document.createElement("span"); sc.textContent = r.score;
        li.append(nm, lv, sc);
        list.appendChild(li);
    });
}


// ==========================================
// BUTTONS, KEYS, START
// ==========================================

$("undo-button").addEventListener("click", undoMove);
$("restart-button").addEventListener("click", () => { if (!$("win-overlay").classList.contains("hidden")) return; loadLevel(); });
$("next-button").addEventListener("click", () => nextAction && nextAction());

function startGame() {
    playerName = $("name-input").value.replace(/[^\w \-]/g, "").trim().slice(0, 16) || "Player";
    try { localStorage.setItem("parallax-name", playerName); } catch (e) {}
    $("name-overlay").classList.add("hidden");
    levelIndex = 0; totalScore = 0;
    loadLeaderboard();
    loadLevel();
}

$("start-button").addEventListener("click", startGame);
$("name-input").addEventListener("keydown", e => { if (e.key === "Enter") startGame(); });

document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT" || !$("name-overlay").classList.contains("hidden")) return;
    if (["1", "2", "3"].includes(e.key)) handlePlatformClick(Number(e.key) - 1);
    if (e.key.toLowerCase() === "r" && $("win-overlay").classList.contains("hidden")) loadLevel();
    if (e.key.toLowerCase() === "u") undoMove();
});

// Show an empty board behind the name screen, prefill saved name, show the board.
try { $("name-input").value = localStorage.getItem("parallax-name") || ""; } catch (e) {}
loadLevel();
loadLeaderboard();
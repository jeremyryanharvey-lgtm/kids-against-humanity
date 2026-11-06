
const $ = id => document.getElementById(id);

let code = "";
let playerId = "";
let socket = null;
let isHost = false;

const msg = t => {
  $("message").textContent = t;
};

async function api(path, body) {
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });

  const d = await r.json();

  if (!r.ok) throw Error(d.error || "Something went wrong.");

  return d;
}

function showRoom() {
  $("home").classList.add("hidden");
  $("room").classList.remove("hidden");
  $("roomCode").textContent = code;
}

function returnHome(message = "") {
  code = "";
  playerId = "";
  isHost = false;

  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }

  $("room").classList.add("hidden");
  $("home").classList.remove("hidden");
  $("gameArea").innerHTML = "";
  $("message").textContent = message;

  if ($("scoreBar")) {
    $("scoreBar").style.display = "none";
  }
}

function connect() {
  const scheme = location.protocol === "https:" ? "wss" : "ws";

  socket = new WebSocket(
    `${scheme}://${location.host}/api/rooms/${code}/socket?playerId=${encodeURIComponent(playerId)}`
  );

  socket.onmessage = e => {
    const d = JSON.parse(e.data);

    if (d.type === "state") {
      render(d.state);
    }

    if (d.type === "error") {
      msg(d.message || "Something went wrong.");
    }

    if (d.type === "removed") {
      returnHome(d.message || "You are no longer in this room.");
    }

    if (d.type === "closed") {
      returnHome(d.message || "This room has closed.");
    }
  };

  socket.onclose = () => {
    if (code) {
      setTimeout(() => {
        if (code && playerId) connect();
      }, 1800);
    }
  };
}

function send(type, extra = {}) {
  if (socket?.readyState === 1) {
    socket.send(JSON.stringify({ type, ...extra }));
  } else {
    msg("Reconnecting. Please try again.");
  }
}

function addActionButton(parent, label, action, className = "") {
  const button = document.createElement("button");

  button.type = "button";
  button.textContent = label;

  if (className) {
    button.className = className;
  }

  button.onclick = action;
  parent.append(button);

  return button;
}

function addQuitButton(parent) {
  addActionButton(
    parent,
    "QUIT",
    () => {
      if (confirm("Are you sure you want to leave this room?")) {
        send("quit");
      }
    },
    "quit-button"
  );
}

function setupScoreBar() {
  if ($("scoreBar")) return;

  const style = document.createElement("style");

  style.textContent = `
    body {
      padding-bottom: 115px !important;
    }

    #scoreBar {
      position: fixed;
      z-index: 1000;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
      background: #18213a;
      color: white;
      box-shadow: 0 -4px 18px rgba(0,0,0,0.16);
      display: none;
    }

    #scoreBar .score-title {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 1px;
      margin-bottom: 7px;
      text-align: center;
    }

    #scoreBar .score-list {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 2px 0;
      scrollbar-width: none;
    }

    #scoreBar .score-list::-webkit-scrollbar {
      display: none;
    }

    #scoreBar .score-player {
      flex: 0 0 auto;
      min-width: 76px;
      padding: 7px 10px;
      border-radius: 12px;
      background: rgba(255,255,255,0.13);
      text-align: center;
      font-size: 12px;
    }

    #scoreBar .score-player.current {
      background: white;
      color: #18213a;
    }

    #scoreBar .score-name {
      display: block;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    #scoreBar .score-points {
      display: block;
      margin-top: 3px;
      font-size: 16px;
      font-weight: 900;
    }

    .quit-button {
      margin-top: 18px;
      background: #777;
      color: white;
    }

    .rematch-button {
      margin: 12px 6px;
    }
  `;

  document.head.append(style);

  const bar = document.createElement("div");
  bar.id = "scoreBar";
  bar.setAttribute("aria-label", "Game scores");

  document.body.append(bar);
}

function renderScoreBar(s) {
  setupScoreBar();

  const bar = $("scoreBar");

  if (s.view === "lobby" || s.view === "removed") {
    bar.style.display = "none";
    return;
  }

  bar.style.display = "block";

  const players = [...s.players].sort((a, b) => b.score - a.score);

  bar.innerHTML = `
    <div class="score-title">LIVE SCORES</div>
    <div class="score-list">
      ${players.map(p => `
        <div class="score-player ${p.id === playerId ? "current" : ""}">
          <span class="score-name">
            ${escapeHtml(p.name)}${p.id === s.judgeId ? " 👑" : ""}
          </span>
          <span class="score-points">${p.score}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function render(s) {
  if (!s || s.view === "removed") {
    returnHome("You are no longer in this room.");
    return;
  }

  // Host status is controlled by the server.
  isHost = !!s.isHost;

  const inLobbyView = s.view === "lobby";
  const inGame = !inLobbyView;

  $("siteHeader").classList.toggle("hidden", inGame);
  $("roomCode").classList.toggle("hidden", inGame);
  $("roomCode").previousElementSibling.classList.toggle("hidden", inGame);
  $("players").classList.toggle("hidden", inGame);
  $("players").previousElementSibling.classList.toggle("hidden", inGame);

  $("status").classList.toggle("hidden", inGame);
  $("status").textContent = inGame ? "" : "Waiting for players";

  $("players").innerHTML = s.players.map(p =>
    `<li>${escapeHtml(p.name)} — ${p.score} points ${p.id === s.judgeId ? "👑 Judge" : ""} ${p.online ? "" : "(offline)"}</li>`
  ).join("");

  const start = $("start");

  const canStart = inLobbyView &&
    isHost &&
    (s.status === "lobby" || s.status === "finished");

  start.classList.toggle("hidden", !canStart);
  start.disabled = s.players.length < 3;
  start.textContent = s.players.length < 3
    ? `Waiting for players (${s.players.length}/3)`
    : "Start game";

  const area = $("gameArea");
  area.innerHTML = "";

  renderScoreBar(s);

  // Each player has their own lobby view after choosing PLAY AGAIN.
  if (inLobbyView) {
    const heading = document.createElement("h2");
    heading.textContent = "You're back in the lobby!";
    area.append(heading);

    const waiting = document.createElement("p");
    waiting.textContent = isHost
      ? "You're the host. Start a new game when at least 3 players are ready."
      : "Waiting for the host to start a new game.";
    area.append(waiting);

    const count = document.createElement("p");
    count.textContent = `${s.players.length} player${s.players.length === 1 ? "" : "s"} in the lobby`;
    area.append(count);

    addQuitButton(area);
    return;
  }

  if (s.status === "finished") {
    const winner = [...s.players].sort((a, b) => b.score - a.score)[0];

    area.innerHTML = `
      <h2>🏆 Game over!</h2>
      <h3>${escapeHtml(winner?.name || "Winner")} wins!</h3>
      <p>They reached ${s.targetScore || 5} points!</p>
      <h3>Final scores</h3>
      <ul>
        ${[...s.players].sort((a, b) => b.score - a.score)
          .map(p => `<li>${escapeHtml(p.name)} — ${p.score} points</li>`)
          .join("")}
      </ul>
      <p>Choose what you'd like to do next.</p>
    `;

    addActionButton(
      area,
      "PLAY AGAIN",
      () => send("playAgain"),
      "rematch-button"
    );

    addActionButton(
      area,
      "QUIT",
      () => {
        if (confirm("Are you sure you want to leave this room?")) {
          send("quit");
        }
      },
      "quit-button"
    );

    return;
  }

  // Exactly one round heading, visible to the judge and all players.
  const roundHeading = document.createElement("h2");
  roundHeading.className = "round-heading";
  roundHeading.textContent = `Round ${s.round}`;
  area.append(roundHeading);

  const question = document.createElement("h2");
  question.className = "question";
  question.textContent = s.question || "";
  area.append(question);

  const isJudge = playerId === s.judgeId;
  const hand = Array.isArray(s.hand) ? s.hand : [];

  if (s.status === "playing" && !s.revealed) {
    if (isJudge) {
      const waiting = document.createElement("p");
      waiting.textContent =
        "You're judging this round. Waiting for the other players...";
      area.append(waiting);

    } else if (s.hasSubmitted) {
      const waiting = document.createElement("p");
      waiting.textContent =
        "Your card has been submitted. Waiting for the judge...";
      area.append(waiting);

    } else {
      const heading = document.createElement("h3");
      heading.textContent = "Choose one answer card";
      area.append(heading);

      const handArea = document.createElement("div");
      handArea.className = "hand";

      hand.forEach(card => {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "answer hand-card";
        button.textContent = card.text;

        button.onclick = () => {
          handArea.querySelectorAll("button").forEach(b => {
            b.disabled = true;
          });

          button.textContent = "Submitting...";
          send("submit", { cardId: card.id });
        };

        handArea.append(button);
      });

      area.append(handArea);
    }
  }

  if (s.status === "playing" && s.revealed) {
    if (isJudge) {
      const heading = document.createElement("h3");
      heading.textContent = "Choose the funniest answer";
      area.append(heading);

      s.submissions.forEach(answer => {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "answer";
        button.textContent = answer.answer;

        button.onclick = () => {
          send("pick", { winnerId: answer.playerId });
        };

        area.append(button);
      });

    } else {
      const waiting = document.createElement("p");
      waiting.textContent =
        "All answers are in. The judge is choosing the winner...";
      area.append(waiting);
    }
  }

  if (s.status === "between") {
    const winner = s.players.find(p => p.id === s.winnerId);

    const result = document.createElement("div");

    result.innerHTML = `
      <h2>🎉 Round winner!</h2>
      <h3>${escapeHtml(winner?.name || "A player")} gets 1 point!</h3>
      <h3>Current scores</h3>
      <ul>
        ${[...s.players].sort((a, b) => b.score - a.score)
          .map(p => `<li>${escapeHtml(p.name)} — ${p.score} points</li>`)
          .join("")}
      </ul>
    `;

    area.append(result);

    if (isHost) {
      addActionButton(
        area,
        "Next round",
        () => send("next")
      );
    } else {
      const waiting = document.createElement("p");
      waiting.textContent =
        "Waiting for the host to start the next round...";
      area.append(waiting);
    }
  }

  addQuitButton(area);
}

function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

$("create").onclick = async () => {
  try {
    const name = $("name").value.trim() || "Host";
    const d = await api("/api/rooms", { name });

    code = d.code;
    playerId = d.playerId;
    isHost = true;

    showRoom();
    connect();
    msg("");

  } catch (e) {
    msg(e.message);
  }
};

$("join").onclick = async () => {
  try {
    code = $("code").value.trim().toUpperCase();

    const name = $("name").value.trim();

    if (!name) throw Error("Enter your name first.");

    const d = await api(`/api/rooms/${code}/join`, { name });

    playerId = d.playerId;
    isHost = false;

    showRoom();
    connect();
    msg("");

  } catch (e) {
    msg(e.message);
  }
};

$("start").onclick = () => send("start");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

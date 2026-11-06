
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
  };

  socket.onclose = () => {
    if (code) {
      setTimeout(connect, 1800);
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

function render(s) {
  const inGame = s.status !== "lobby";

  // Hide lobby information once the game starts.
  $("roomCode").classList.toggle("hidden", inGame);
  $("roomCode").previousElementSibling.classList.toggle("hidden", inGame);
  $("players").classList.toggle("hidden", inGame);
  $("players").previousElementSibling.classList.toggle("hidden", inGame);

  $("status").textContent =
    inGame
      ? `Round ${s.round || 1}`
      : "Waiting for players";

  $("players").innerHTML = s.players.map(p =>
    `<li>${escapeHtml(p.name)} — ${p.score} points ${p.id === s.judgeId ? "👑 Judge" : ""} ${p.online ? "" : "(offline)"}</li>`
  ).join("");

  const start = $("start");

  start.classList.toggle("hidden", !isHost || s.status !== "lobby");
  start.disabled = s.players.length < 3;
  start.textContent = s.players.length < 3
    ? `Waiting for players (${s.players.length}/3)`
    : "Start game";

  const area = $("gameArea");
  area.innerHTML = "";

  if (s.status === "lobby") {
    area.innerHTML =
      "<p>Waiting for everyone to join. You need at least 3 players.</p>";
    return;
  }

  if (s.status === "finished") {
    const winner = [...s.players].sort((a, b) => b.score - a.score)[0];

    area.innerHTML = `
      <h2>🏆 Game over!</h2>
      <h3>${escapeHtml(winner?.name || "Winner")} wins!</h3>
      <p>They reached 5 points!</p>
      <h3>Final scores</h3>
      <ul>
        ${[...s.players].sort((a, b) => b.score - a.score)
          .map(p => `<li>${escapeHtml(p.name)} — ${p.score} points</li>`)
          .join("")}
      </ul>
    `;

    return;
  }

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
    } else if (hand.length < 10) {
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

    const nextText = document.createElement("p");
    nextText.textContent = "The next round is ready.";
    area.append(nextText);

    if (isHost) {
      const button = document.createElement("button");

      button.textContent = "Next round";
      button.onclick = () => send("next");

      area.append(button);
    } else {
      const waiting = document.createElement("p");
      waiting.textContent =
        "Waiting for the host to start the next round...";
      area.append(waiting);
    }
  }
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




const $ = id => document.getElementById(id);

let code = "";
let playerId = "";
let socket = null;
let isHost = false;

let chatOpen = false;
let chatUnread = 0;
let chatMessages = [];
let chatReady = false;

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
  setupChatUI();
  $("chatDock").classList.remove("hidden");
}

function returnHome(message = "") {
  code = "";
  playerId = "";
  isHost = false;

  chatOpen = false;
  chatUnread = 0;
  chatMessages = [];

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

  if ($("chatDock")) {
    $("chatDock").classList.add("hidden");
    $("chatWindow").classList.add("hidden");
    $("chatButton").classList.remove("has-unread");
    $("chatButton").textContent = "CHAT";
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

    if (d.type === "chat") {
      receiveChatMessage(d.message);
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

    /* CHAT BUTTON */

    #chatDock {
      position: fixed;
      z-index: 1100;
      right: 14px;
      bottom: calc(125px + env(safe-area-inset-bottom));
    }

    #chatButton {
      border: 0;
      border-radius: 30px;
      padding: 13px 23px;
      background: #18213a;
      color: white;
      font-weight: 900;
      font-size: 14px;
      letter-spacing: 1px;
      box-shadow: 0 3px 12px rgba(0,0,0,0.3);
      cursor: pointer;
    }

    #chatButton.has-unread {
      background: #ff8c00;
      color: #18213a;
      animation: chatPulse 1s infinite alternate;
    }

    @keyframes chatPulse {
      from { transform: scale(1); }
      to { transform: scale(1.06); }
    }

    /* CHAT WINDOW */

    #chatWindow {
      position: fixed;
      z-index: 1101;
      right: 12px;
      bottom: calc(180px + env(safe-area-inset-bottom));
      width: min(350px, calc(100vw - 24px));
      height: min(440px, 60vh);
      background: white;
      border-radius: 16px;
      box-shadow: 0 5px 30px rgba(0,0,0,0.3);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: #18213a;
      box-sizing: border-box;
    }

    #chatWindow.hidden {
      display: none;
    }

    #chatHeader {
      flex: 0 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 13px 15px;
      background: #18213a;
      color: white;
      font-weight: 900;
    }

    #chatClose {
      border: 0;
      background: transparent;
      color: white;
      font-size: 24px;
      padding: 0 5px;
      cursor: pointer;
    }

    #chatMessages {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 12px;
      background: #f2f4f8;
      display: flex;
      flex-direction: column;
      gap: 9px;
    }

    .chat-message {
      max-width: 88%;
      padding: 9px 11px;
      border-radius: 12px;
      background: white;
      overflow-wrap: anywhere;
      align-self: flex-start;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }

    .chat-message.mine {
      align-self: flex-end;
      background: #dce8ff;
    }

    .chat-message-name {
      display: block;
      font-size: 11px;
      font-weight: 900;
      color: #52617c;
      margin-bottom: 3px;
    }

    .chat-message-text {
      font-size: 14px;
      white-space: pre-wrap;
      line-height: 1.4;
    }

    .chat-message-time {
      display: block;
      text-align: right;
      font-size: 10px;
      color: #7c8492;
      margin-top: 4px;
    }

    /* CHAT INPUT FIX */

    #chatForm {
      flex: 0 0 auto;
      display: flex !important;
      flex-direction: row !important;
      align-items: center;
      gap: 8px;
      width: 100%;
      box-sizing: border-box;
      padding: 10px;
      background: white;
      border-top: 1px solid #ddd;
    }

    #chatInput {
      display: block;
      flex: 1 1 0% !important;
      width: 0 !important;
      min-width: 0 !important;
      max-width: none !important;
      height: 46px;
      min-height: 46px;
      max-height: 46px;
      box-sizing: border-box;
      resize: none;
      border: 1px solid #cbd0da;
      border-radius: 10px;
      padding: 11px;
      margin: 0;
      font-family: inherit;
      font-size: 16px;
      line-height: 22px;
      color: #18213a;
      outline: none;
      overflow-y: auto;
      -webkit-appearance: none;
    }

    #chatInput:focus {
      border-color: #526da8;
    }

    #chatSend {
      display: block;
      flex: 0 0 88px !important;
      width: 88px !important;
      min-width: 88px !important;
      max-width: 88px !important;
      height: 46px;
      box-sizing: border-box;
      border: 0;
      border-radius: 10px;
      padding: 0 8px;
      margin: 0;
      background: #18213a;
      color: white;
      font-weight: 800;
      font-size: 14px;
      cursor: pointer;
      -webkit-appearance: none;
    }

    #chatSend:disabled {
      opacity: 0.5;
    }

    @media (max-width: 480px) {
      #chatWindow {
        right: 8px;
        width: calc(100vw - 16px);
        bottom: calc(175px + env(safe-area-inset-bottom));
      }
    }
  `;

  document.head.append(style);

  const bar = document.createElement("div");
  bar.id = "scoreBar";
  bar.setAttribute("aria-label", "Game scores");
  document.body.append(bar);
}

function setupChatUI() {
  if (chatReady) return;

  const dock = document.createElement("div");
  dock.id = "chatDock";
  dock.className = "hidden";

  const button = document.createElement("button");
  button.id = "chatButton";
  button.type = "button";
  button.textContent = "CHAT";

  button.onclick = () => {
    chatOpen = !chatOpen;

    $("chatWindow").classList.toggle("hidden", !chatOpen);

    if (chatOpen) {
      chatUnread = 0;
      updateChatButton();
      renderChatMessages();
      $("chatInput").focus();
    }
  };

  const window = document.createElement("div");
  window.id = "chatWindow";
  window.className = "hidden";

  const header = document.createElement("div");
  header.id = "chatHeader";

  const title = document.createElement("span");
  title.textContent = "ROOM CHAT";

  const close = document.createElement("button");
  close.id = "chatClose";
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close chat");

  close.onclick = () => {
    chatOpen = false;
    window.classList.add("hidden");
  };

  header.append(title, close);

  const messages = document.createElement("div");
  messages.id = "chatMessages";

  const form = document.createElement("form");
  form.id = "chatForm";

  const input = document.createElement("textarea");
  input.id = "chatInput";
  input.rows = 1;
  input.maxLength = 300;
  input.placeholder = "Write a message...";

  const sendButton = document.createElement("button");
  sendButton.id = "chatSend";
  sendButton.type = "submit";
  sendButton.textContent = "SEND";

  form.onsubmit = event => {
    event.preventDefault();

    const text = input.value.trim();

    if (!text) return;

    if (text.length > 300) {
      msg("Chat messages must be 300 characters or fewer.");
      return;
    }

    if (socket?.readyState !== 1) {
      msg("Reconnecting. Please try again.");
      return;
    }

    send("chat", { text });
    input.value = "";
    input.focus();
  };

  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.append(input, sendButton);
  window.append(header, messages, form);
  dock.append(button, window);
  document.body.append(dock);

  chatReady = true;
}

function updateChatButton() {
  const button = $("chatButton");

  if (!button) return;

  button.classList.toggle("has-unread", chatUnread > 0);

  button.textContent = chatUnread > 0
    ? `CHAT (${chatUnread > 9 ? "9+" : chatUnread})`
    : "CHAT";
}

function mergeChatMessages(messages) {
  if (!Array.isArray(messages)) return;

  const known = new Set(chatMessages.map(m => m.id));

  for (const message of messages) {
    if (message?.id && !known.has(message.id)) {
      chatMessages.push(message);
      known.add(message.id);
    }
  }

  chatMessages.sort((a, b) => a.time - b.time);

  if (chatMessages.length > 100) {
    chatMessages = chatMessages.slice(-100);
  }
}

function receiveChatMessage(message) {
  if (!message || !message.id) return;

  const alreadyExists = chatMessages.some(
    m => m.id === message.id
  );

  if (alreadyExists) return;

  chatMessages.push(message);

  if (chatMessages.length > 100) {
    chatMessages = chatMessages.slice(-100);
  }

  if (!chatOpen && message.playerId !== playerId) {
    chatUnread++;
  }

  updateChatButton();

  if (chatOpen) {
    renderChatMessages();
  }
}

function renderChatMessages() {
  const container = $("chatMessages");

  if (!container) return;

  container.innerHTML = "";

  if (chatMessages.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No messages yet. Say hello!";
    empty.style.textAlign = "center";
    empty.style.color = "#777";
    empty.style.marginTop = "25px";
    container.append(empty);
    return;
  }

  chatMessages.forEach(message => {
    const item = document.createElement("div");

    item.className = "chat-message";

    if (message.playerId === playerId) {
      item.classList.add("mine");
    }

    const name = document.createElement("span");
    name.className = "chat-message-name";
    name.textContent = message.name || "Player";

    const text = document.createElement("div");
    text.className = "chat-message-text";
    text.textContent = message.text || "";

    const time = document.createElement("span");
    time.className = "chat-message-time";

    time.textContent = message.time
      ? new Date(message.time).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        })
      : "";

    item.append(name, text, time);
    container.append(item);
  });

  container.scrollTop = container.scrollHeight;
}

function renderScoreBar(s) {
  setupScoreBar();

  const bar = $("scoreBar");

  if (
    s.view === "lobby" ||
    s.status === "lobby" ||
    s.view === "removed"
  ) {
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

  isHost = !!s.isHost;

  setupChatUI();
  $("chatDock").classList.remove("hidden");

  mergeChatMessages(s.chat);
  updateChatButton();

  // Recognise the lobby from either the view or the server status.
  const inLobbyView = s.view === "lobby" || s.status === "lobby";
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

  if (inLobbyView) {
    const heading = document.createElement("h2");
    heading.textContent = "Room lobby";
    area.append(heading);

    const waiting = document.createElement("p");
    waiting.textContent = isHost
      ? "You're the host. Start a new game when at least 3 players are ready."
      : "Waiting for the host to start the game.";
    area.append(waiting);

    const count = document.createElement("p");
    count.textContent = `${s.players.length} player${s.players.length === 1 ? "" : "s"} in the room`;
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

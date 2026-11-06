

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

const shuffle = items => {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const body = await request.json();
      const name = String(body.name || "Host").trim().slice(0, 18) || "Host";

      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      const id = env.GAME_ROOMS.idFromName(code);
      const room = env.GAME_ROOMS.get(id);
      const hostId = crypto.randomUUID();

      const init = await room.fetch("https://room/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, hostId, name })
      });

      if (!init.ok) return json({ error: "Couldn't create room." }, 500);

      return json({ code, playerId: hostId });
    }

    const match = url.pathname.match(
      /^\/api\/rooms\/([A-Z0-9]{6})(?:\/(join|state|socket))?$/
    );

    if (match) {
      const [, code, action = "state"] = match;
      const id = env.GAME_ROOMS.idFromName(code);
      const room = env.GAME_ROOMS.get(id);

      if (action === "join" && request.method === "POST") {
        const playerId = crypto.randomUUID();

        const response = await room.fetch("https://room/join", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...(await request.json()),
            playerId
          })
        });

        const data = await response.json();

        return json(
          { ...data, playerId },
          response.status
        );
      }

      if (action === "socket") {
        const target = new URL("https://room/ws");
        target.search = url.search;

        return room.fetch(new Request(target, request));
      }

      return room.fetch("https://room/state");
    }

    return env.ASSETS.fetch(request);
  }
};

export class GameRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = null;
  }

  async load() {
    if (!this.state) {
      this.state = await this.ctx.storage.get("game") || null;
    }

    return this.state;
  }

  async save() {
    if (this.state) {
      await this.ctx.storage.put("game", this.state);
    }
  }

  async loadDeck(path) {
    const response = await this.env.ASSETS.fetch(
      new Request(`https://assets/data/${path}`)
    );

    if (!response.ok) {
      throw new Error(`Couldn't load ${path}.`);
    }

    const data = await response.json();

    if (!Array.isArray(data.cards) || data.cards.length === 0) {
      throw new Error(`${path} contains no cards.`);
    }

    return data.cards;
  }

  async prepareDecks() {
    const s = this.state;

    const [questions, answers] = await Promise.all([
      this.loadDeck("questions.json"),
      this.loadDeck("answers.json")
    ]);

    const uniqueAnswers = [];
    const seenIds = new Set();
    const seenTexts = new Set();

    for (const card of answers) {
      if (!card || !card.id || !card.text) continue;

      const id = String(card.id);
      const text = String(card.text).trim();
      const normalisedText = text.toLowerCase().replace(/\s+/g, " ");

      if (
        !text ||
        seenIds.has(id) ||
        seenTexts.has(normalisedText)
      ) {
        continue;
      }

      seenIds.add(id);
      seenTexts.add(normalisedText);

      uniqueAnswers.push({ id, text });
    }

    if (uniqueAnswers.length < 10 * s.players.length) {
      throw new Error(
        "There aren't enough unique answer cards for everyone. Please check answers.json."
      );
    }

    s.questionDeck = shuffle(questions);
    s.usedQuestions = [];
    s.answerDeck = shuffle(uniqueAnswers);
    s.answerDiscard = [];
  }

  drawQuestion() {
    const s = this.state;

    if (!s.questionDeck || s.questionDeck.length === 0) {
      s.questionDeck = shuffle(s.usedQuestions || []);
      s.usedQuestions = [];
    }

    const card = s.questionDeck.shift();

    if (!card) {
      throw new Error("No question cards available.");
    }

    s.usedQuestions.push(card);

    return card.text;
  }

  drawAnswer() {
    const s = this.state;

    if (s.answerDeck.length === 0 && s.answerDiscard.length > 0) {
      s.answerDeck = shuffle(s.answerDiscard);
      s.answerDiscard = [];
    }

    if (s.answerDeck.length === 0) {
      throw new Error("No answer cards available.");
    }

    return s.answerDeck.shift();
  }

  dealHands() {
    for (const player of this.state.players) {
      while (player.hand.length < 10) {
        player.hand.push(this.drawAnswer());
      }
    }
  }

  publicState(playerId = null) {
    const s = this.state;

    if (!s) return null;

    const viewer = playerId
      ? s.players.find(p => p.id === playerId)
      : null;

    const view = !viewer
      ? "removed"
      : s.status === "finished" && viewer.inLobby
        ? "lobby"
        : "game";

    const visiblePlayers = view === "lobby"
      ? s.players.filter(p => p.inLobby)
      : s.players;

    return {
      code: s.code,
      status: s.status,
      view,
      isHost: playerId === s.hostId,
      round: s.round,
      judgeId: s.judgeId,
      targetScore: s.targetScore,

      players: visiblePlayers.map(({ id, name, score, online }) => ({
        id,
        name,
        score,
        online
      })),

      question: s.question,

      submissions: s.revealed
        ? s.submissions.map(x => ({
            playerId: x.submissionId,
            answer: x.answer
          }))
        : s.submissions.map(() => ({
            answer: "Submitted"
          })),

      revealed: s.revealed,
      winnerId: s.winnerId,

      hasSubmitted: playerId
        ? s.submissions.some(x => x.playerId === playerId)
        : false,

      hand: playerId
        ? viewer?.hand || []
        : []
    };
  }

  async notifyHost(message) {
    if (!this.state) return;

    const hostId = this.state.hostId;

    for (const ws of this.ctx.getWebSockets()) {
      try {
        const attachment = ws.deserializeAttachment();

        if (attachment?.playerId === hostId) {
          // The existing app.js displays this message in its message area.
          ws.send(JSON.stringify({
            type: "error",
            message
          }));

          return;
        }
      } catch {}
    }
  }

  async broadcast() {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const attachment = ws.deserializeAttachment();
        const playerId = attachment?.playerId || null;

        const playerExists = this.state?.players.some(
          p => p.id === playerId
        );

        if (!playerExists) {
          ws.send(JSON.stringify({
            type: "removed",
            message: "The room has moved on without you."
          }));

          continue;
        }

        ws.send(JSON.stringify({
          type: "state",
          state: this.publicState(playerId)
        }));
      } catch {}
    }
  }

  async closeRoom() {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify({
          type: "closed",
          message: "Everyone has left. This room is now closed."
        }));

        ws.close(1000, "Room closed");
      } catch {}
    }

    this.state = null;
    await this.ctx.storage.deleteAll();
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      if (!this.state) {
        const { code, hostId, name } = await request.json();

        this.state = {
          code,
          hostId,
          status: "lobby",
          round: 0,
          judgeIndex: 0,
          judgeId: hostId,
          targetScore: 5,

          players: [{
            id: hostId,
            name: name || "Host",
            score: 0,
            online: true,
            hand: [],
            inLobby: true
          }],

          question: null,
          questionDeck: null,
          usedQuestions: [],
          answerDeck: null,
          answerDiscard: [],
          submissions: [],
          revealed: false,
          winnerId: null
        };

        await this.save();
      }

      return json({ ok: true });
    }

    await this.load();

    if (!this.state) {
      return json({ error: "Room not found." }, 404);
    }

    if (url.pathname === "/join" && request.method === "POST") {
      const body = await request.json();
      const name = String(body.name || "").trim().slice(0, 18);

      if (!name) {
        return json({ error: "Enter a name." }, 400);
      }

      if (!["lobby", "finished"].includes(this.state.status)) {
        return json({
          error: "A game is in progress. Please try again after it finishes."
        }, 409);
      }

      if (this.state.players.length >= 10) {
        return json({ error: "Room is full." }, 409);
      }

      this.state.players.push({
        id: body.playerId,
        name,
        score: 0,
        online: true,
        hand: [],
        inLobby: true
      });

      await this.save();
      await this.broadcast();

      return json({ ok: true });
    }

    if (url.pathname === "/state") {
      return json(this.publicState());
    }

    if (url.pathname === "/ws") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      const playerId = url.searchParams.get("playerId");
      const player = this.state.players.find(p => p.id === playerId);

      if (!player) {
        return json({ error: "Player not found." }, 404);
      }

      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ playerId });

      player.online = true;
      await this.save();

      server.send(JSON.stringify({
        type: "state",
        state: this.publicState(playerId)
      }));

      await this.broadcast();

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    return json({ error: "Not found." }, 404);
  }

  async webSocketMessage(ws, message) {
    let data;

    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    const s = await this.load();

    if (!s) return;

    const attachment = ws.deserializeAttachment();
    const playerId = attachment?.playerId;
    const player = s.players.find(p => p.id === playerId);

    if (!player) return;

    // Player chooses to leave the room.
    if (data.type === "quit") {
      const leavingIndex = s.players.findIndex(p => p.id === playerId);
      const wasHost = playerId === s.hostId;
      const wasJudge = playerId === s.judgeId;
      const leavingName = player.name;

      s.players.splice(leavingIndex, 1);

      s.submissions = s.submissions.filter(
        x => x.playerId !== playerId
      );

      if (s.players.length === 0) {
        await this.closeRoom();
        return;
      }

      if (wasHost) {
        // The earliest remaining player becomes the new host.
        s.hostId = s.players[0].id;
      }

      if (wasJudge && ["playing", "between"].includes(s.status)) {
        const nextIndex = leavingIndex % s.players.length;

        s.judgeIndex = nextIndex;
        s.judgeId = s.players[nextIndex].id;

        s.submissions = s.submissions.filter(
          x => x.playerId !== s.judgeId
        );
      } else {
        s.judgeIndex = Math.max(
          0,
          s.players.findIndex(p => p.id === s.judgeId)
        );
      }

      if (s.status === "playing") {
        s.revealed = s.submissions.length >= s.players.length - 1;
      }

      if (
        s.players.length < 2 &&
        ["playing", "between"].includes(s.status)
      ) {
        s.status = "lobby";
        s.round = 0;
        s.question = null;
        s.submissions = [];
        s.revealed = false;
        s.winnerId = null;

        for (const p of s.players) {
          p.inLobby = true;
          p.hand = [];
        }
      }

      await this.save();
      await this.broadcast();

      // Notify the new host if the host left.
      if (wasHost) {
        const newHost = s.players[0];

        await this.notifyHost(
          `${leavingName} has left the room. You are now the host.`
        );
      } else {
        // Otherwise notify the existing host.
        await this.notifyHost(
          `${leavingName} has left the room.`
        );
      }

      try {
        ws.send(JSON.stringify({
          type: "removed",
          message: "You left the room."
        }));

        ws.close(1000, "Player left");
      } catch {}

      return;
    }

    // Player returns to the lobby after a finished game.
    if (
      data.type === "playAgain" &&
      s.status === "finished"
    ) {
      player.inLobby = true;
      player.hand = [];
    }

    // Host starts a fresh game with the players currently in the lobby.
    else if (
      data.type === "start" &&
      playerId === s.hostId &&
      (s.status === "lobby" || s.status === "finished") &&
      player.inLobby
    ) {
      const lobbyPlayers = s.players.filter(p => p.inLobby);

      if (lobbyPlayers.length < 3) {
        ws.send(JSON.stringify({
          type: "error",
          message: "You need at least 3 players to start."
        }));

        return;
      }

      const previousPlayers = s.players;
      s.players = lobbyPlayers;

      // Notify players who stayed on the previous winner screen.
      for (const oldPlayer of previousPlayers) {
        if (!lobbyPlayers.some(p => p.id === oldPlayer.id)) {
          for (const otherWs of this.ctx.getWebSockets()) {
            try {
              const otherId = otherWs.deserializeAttachment()?.playerId;

              if (otherId === oldPlayer.id) {
                otherWs.send(JSON.stringify({
                  type: "removed",
                  message: "A new game has started without you."
                }));
              }
            } catch {}
          }
        }
      }

      try {
        await this.prepareDecks();

        for (const p of s.players) {
          p.hand = [];
          p.score = 0;
          p.inLobby = false;
        }

        this.dealHands();

        s.status = "playing";
        s.round = 1;
        s.judgeIndex = 0;
        s.judgeId = s.players[0].id;
        s.question = this.drawQuestion();
        s.submissions = [];
        s.revealed = false;
        s.winnerId = null;

      } catch (error) {
        s.players = previousPlayers;

        for (const p of s.players) {
          p.inLobby = true;
        }

        await this.save();

        ws.send(JSON.stringify({
          type: "error",
          message: error.message
        }));

        return;
      }
    }

    // Player submits one answer card.
    else if (
      data.type === "submit" &&
      s.status === "playing" &&
      playerId !== s.judgeId &&
      !s.revealed
    ) {
      if (!data.cardId) return;

      if (s.submissions.some(x => x.playerId === playerId)) {
        return;
      }

      const index = player.hand.findIndex(
        card => card.id === data.cardId
      );

      if (index === -1) return;

      const card = player.hand.splice(index, 1)[0];

      s.answerDiscard.push(card);

      s.submissions.push({
        playerId,
        submissionId: crypto.randomUUID(),
        cardId: card.id,
        answer: card.text
      });

      if (s.submissions.length === s.players.length - 1) {
        s.revealed = true;
      }
    }

    // Judge selects the winning answer.
    else if (
      data.type === "pick" &&
      playerId === s.judgeId &&
      s.status === "playing" &&
      s.revealed
    ) {
      const chosen = s.submissions.find(
        x => x.submissionId === data.winnerId
      );

      if (!chosen) return;

      const winner = s.players.find(
        p => p.id === chosen.playerId
      );

      if (winner) {
        winner.score += 1;
      }

      s.winnerId = chosen.playerId;

      if (winner && winner.score >= s.targetScore) {
        s.status = "finished";

        for (const p of s.players) {
          p.inLobby = false;
        }
      } else {
        s.status = "between";
        this.dealHands();
      }
    }

    // Host advances to the next round.
    else if (
      data.type === "next" &&
      playerId === s.hostId &&
      s.status === "between"
    ) {
      s.round += 1;
      s.judgeIndex = (s.judgeIndex + 1) % s.players.length;
      s.judgeId = s.players[s.judgeIndex].id;
      s.question = this.drawQuestion();
      s.submissions = [];
      s.revealed = false;
      s.winnerId = null;
      s.status = "playing";
    }

    await this.save();
    await this.broadcast();
  }

  async webSocketClose(ws) {
    const attachment = ws.deserializeAttachment();
    const playerId = attachment?.playerId;

    const s = await this.load();

    if (!s) return;

    const player = s.players.find(p => p.id === playerId);

    if (player) {
      player.online = false;
      await this.save();
    }

    await this.broadcast();
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
}

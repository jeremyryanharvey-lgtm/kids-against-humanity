

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

const shuffle = (items) => {
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
        return json({ ...data, playerId }, response.status);
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
    await this.ctx.storage.put("game", this.state);
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

    if (s.questionDeck && s.answerDeck) return;

    const [questions, answers] = await Promise.all([
      this.loadDeck("questions.json"),
      this.loadDeck("answers.json")
    ]);

    s.questionDeck = shuffle(questions);
    s.usedQuestions = [];
    s.answerDeck = shuffle(answers);
    s.answerDiscard = [];
  }

  drawQuestion() {
    const s = this.state;

    if (s.questionDeck.length === 0) {
      s.questionDeck = shuffle(s.usedQuestions);
      s.usedQuestions = [];
    }

    const card = s.questionDeck.shift();

    if (!card) throw new Error("No question cards available.");

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

    return {
      code: s.code,
      status: s.status,
      round: s.round,
      judgeId: s.judgeId,
      targetScore: s.targetScore,

      players: s.players.map(({ id, name, score, online }) => ({
        id,
        name,
        score,
        online
      })),

      question: s.question,

      // Submission identities are replaced with anonymous tokens.
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

      // Only the owner of a hand receives its cards.
      hand: playerId
        ? s.players.find(p => p.id === playerId)?.hand || []
        : []
    };
  }

  async broadcast() {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const attachment = ws.deserializeAttachment();
        const playerId = attachment?.playerId || null;

        ws.send(JSON.stringify({
          type: "state",
          state: this.publicState(playerId)
        }));
      } catch {}
    }
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
            hand: []
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

      if (!name) return json({ error: "Enter a name." }, 400);

      if (this.state.status !== "lobby") {
        return json({ error: "Game already started." }, 409);
      }

      if (this.state.players.length >= 10) {
        return json({ error: "Room is full." }, 409);
      }

      this.state.players.push({
        id: body.playerId,
        name,
        score: 0,
        online: true,
        hand: []
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

    // The player identity comes from the socket, not the message.
    const attachment = ws.deserializeAttachment();
    const playerId = attachment?.playerId;

    const player = s.players.find(p => p.id === playerId);
    if (!player) return;

    if (
      data.type === "start" &&
      playerId === s.hostId &&
      s.status === "lobby" &&
      s.players.length >= 3
    ) {
      try {
        await this.prepareDecks();

        for (const p of s.players) {
          p.hand = [];
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
        ws.send(JSON.stringify({
          type: "error",
          message: error.message
        }));
        return;
      }

    } else if (
      data.type === "submit" &&
      s.status === "playing" &&
      playerId !== s.judgeId &&
      !s.revealed
    ) {
      // New card-based submission.
      let answer = "";
      let cardId = null;

      if (data.cardId) {
        const index = player.hand.findIndex(
          card => card.id === data.cardId
        );

        if (index === -1) return;

        // Prevent a player from submitting more than one card.
        if (s.submissions.some(x => x.playerId === playerId)) return;

        const card = player.hand.splice(index, 1)[0];
        answer = card.text;
        cardId = card.id;

        s.answerDiscard.push(card);
      } else {
        // Temporary compatibility with the old typed-answer screen.
        answer = String(data.answer || "").trim().slice(0, 100);
      }

      if (
        answer &&
        !s.submissions.some(x => x.playerId === playerId)
      ) {
        s.submissions.push({
          playerId,
          submissionId: crypto.randomUUID(),
          cardId,
          answer
        });
      }

      if (s.submissions.length === s.players.length - 1) {
        s.revealed = true;
      }

    } else if (
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

      if (winner) winner.score += 1;

      s.winnerId = chosen.playerId;

      // Finish immediately when a player reaches the target score.
      if (winner && winner.score >= s.targetScore) {
        s.status = "finished";
      } else {
        s.status = "between";

        // Refill everyone's hand to ten cards for the next round.
        this.dealHands();
      }

    } else if (
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



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

// --------------------------------------------------
// CARD STATISTICS
// --------------------------------------------------

async function recordCardStat(env, card, event) {
  if (!card || !card.id) return;

  try {
    const id = env.CARD_STATS.idFromName("global");
    const stats = env.CARD_STATS.get(id);

    await stats.fetch("https://stats/record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cardId: String(card.id),
        text: String(card.text || ""),
        event
      })
    });
  } catch (error) {
    console.error("Card statistics error:", error);
  }
}

// --------------------------------------------------
// GAME TIMER SETTINGS
// --------------------------------------------------

const TURN_TIME = 90 * 1000;

// --------------------------------------------------
// PROFANITY FILTER
// --------------------------------------------------

const PROFANITY = [
  "fuck", "fucker", "fuckers", "fucking", "fucked",
  "fuckface", "fuckhead", "fuckwit",
  "motherfucker", "motherfuckers", "motherfucking",
  "shit", "shits", "shitty", "shitting", "shithead",
  "shitface", "bullshit", "horseshit", "dipshit",
  "bitch", "bitches", "bitchy", "bitching",
  "bastard", "bastards",
  "asshole", "assholes", "arsehole", "arseholes",
  "dick", "dicks", "dickhead", "dickheads",
  "cock", "cocks", "cocksucker", "cocksucking",
  "piss", "pissed", "pissing", "pisser",
  "pussy", "pussies", "cunt", "cunts",
  "twat", "twats", "wanker", "wankers", "wanking",
  "prick", "pricks", "bollocks", "bugger", "buggers",

  "damn", "dammit", "goddamn", "goddammit",
  "crap", "crappy", "crapper",
  "hell", "bloody",
  "douche", "douchebag", "douchebags",
  "dumbass", "dumbasses", "jackass", "jackasses",
  "jerkoff", "moron", "morons", "idiot", "idiots",
  "slut", "sluts", "whore", "whores",

  "penis", "vagina", "boobs", "boobies",
  "tits", "titty", "titties",
  "ballsack", "nutsack", "boner",
  "blowjob", "handjob", "masturbate",
  "masturbation", "orgasm", "orgasms",
  "dildo", "porn", "porno", "pornography",

  "fuk", "fuking", "fukin", "fck", "fcking",
  "phuck", "fuq", "fuqq", "fux",
  "shyt", "shiit", "shitt", "sh1t",
  "biatch", "biotch", "bich",
  "azz", "dik", "dikk", "kock", "kunt",
  "bstrd", "bastid", "douchbag"
];

const CONFUSABLES = {
  "0": "o", "1": "i", "3": "e", "4": "a",
  "5": "s", "7": "t", "8": "b", "@": "a", "$": "s",
  "а": "a", "с": "c", "е": "e", "і": "i",
  "о": "o", "р": "p", "х": "x", "у": "y",
  "к": "k", "м": "m", "т": "t", "в": "b",
  "н": "h", "ј": "j",
  "α": "a", "β": "b", "ε": "e", "ι": "i",
  "κ": "k", "ο": "o", "ρ": "p", "τ": "t",
  "υ": "u", "χ": "x"
};

function normaliseCharacter(char) {
  const lower = char.toLowerCase();
  const mapped = CONFUSABLES[lower] || lower;

  return mapped
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z]/g, "");
}

function normaliseWord(value) {
  return Array.from(String(value))
    .map(normaliseCharacter)
    .join("")
    .replace(/(.)\1+/g, "$1");
}

const PROFANITY_SET = new Set(
  PROFANITY.map(normaliseWord)
);

function normaliseWithPositions(value, offset = 0) {
  let text = "";
  const positions = [];
  let index = offset;

  for (const character of value) {
    const converted = normaliseCharacter(character);

    for (const letter of converted) {
      text += letter;
      positions.push(index);
    }

    index += character.length;
  }

  return { text, positions };
}

function filterProfanity(message) {
  const original = String(message);
  const blockedRanges = [];
  const tokens = [];

  for (const match of original.matchAll(/\S+/gu)) {
    const start = match.index;
    const value = match[0];
    const normalised = normaliseWithPositions(value, start);

    tokens.push({
      start,
      end: start + value.length - 1,
      text: normalised.text,
      positions: normalised.positions
    });
  }

  for (const token of tokens) {
    if (!token.text) continue;

    for (const badWord of PROFANITY_SET) {
      if (!badWord || badWord.length < 3) continue;

      let searchFrom = 0;

      while (true) {
        const found = token.text.indexOf(badWord, searchFrom);

        if (found === -1) break;

        const before = token.text[found - 1] || "";
        const after = token.text[found + badWord.length] || "";

        const leftBoundary = !/[a-z]/.test(before);
        const rightBoundary = !/[a-z]/.test(after);

        if (leftBoundary && rightBoundary) {
          blockedRanges.push({
            start: token.positions[found],
            end: token.positions[found + badWord.length - 1]
          });
        }

        searchFrom = found + 1;
      }
    }
  }

  let group = [];

  const checkGroup = () => {
    if (group.length < 3) {
      group = [];
      return;
    }

    const combined = group.map(x => x.text).join("");

    for (const badWord of PROFANITY_SET) {
      if (combined.includes(badWord)) {
        const found = combined.indexOf(badWord);
        const startToken = group[found];
        const endToken = group[found + badWord.length - 1];

        if (startToken && endToken) {
          blockedRanges.push({
            start: startToken.start,
            end: endToken.end
          });
        }
      }
    }

    group = [];
  };

  for (const token of tokens) {
    if (token.text.length === 1) {
      if (
        group.length &&
        token.start - group[group.length - 1].end > 4
      ) {
        checkGroup();
      }

      group.push(token);
    } else {
      checkGroup();
    }
  }

  checkGroup();

  blockedRanges.sort((a, b) => a.start - b.start);

  const merged = [];

  for (const range of blockedRanges) {
    const last = merged[merged.length - 1];

    if (last && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  const result = original.split("");

  for (const range of merged) {
    for (let i = range.start; i <= range.end; i++) {
      if (!/\s/.test(result[i])) {
        result[i] = "*";
      }
    }
  }

  return result.join("");
}

// --------------------------------------------------
// MAIN WORKER
// --------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CARD STATISTICS API
    if (
      url.pathname === "/api/stats" &&
      request.method === "GET"
    ) {
      const id = env.CARD_STATS.idFromName("global");
      const stats = env.CARD_STATS.get(id);

      return stats.fetch("https://stats/list");
    }

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

// --------------------------------------------------
// DURABLE OBJECT GAME ROOM
// --------------------------------------------------

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

  // --------------------------------------------------
  // TIMER FUNCTIONS
  // --------------------------------------------------

  startSubmissionTimers() {
    const s = this.state;

    s.submissionDeadlines = {};
    s.judgeDeadline = null;
    s.revealed = false;

    const deadline = Date.now() + TURN_TIME;

    for (const player of s.players) {
      if (player.id !== s.judgeId) {
        s.submissionDeadlines[player.id] = deadline;
      }
    }
  }

  startJudgeTimerIfReady() {
    const s = this.state;
    const required = s.players.length - 1;

    if (s.submissions.length >= required) {
      s.revealed = true;
      s.submissionDeadlines = {};

      if (!s.judgeDeadline) {
        s.judgeDeadline = Date.now() + TURN_TIME;
      }

      return true;
    }

    s.revealed = false;
    s.judgeDeadline = null;

    return false;
  }

  async scheduleAlarm() {
    const s = this.state;

    if (!s || s.status !== "playing") {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    const deadlines = [
      ...Object.values(s.submissionDeadlines || {}),
      ...(s.judgeDeadline ? [s.judgeDeadline] : [])
    ].filter(Number.isFinite);

    if (!deadlines.length) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    await this.ctx.storage.setAlarm(Math.min(...deadlines));
  }

  async recordAutomaticSubmission(player) {
    const s = this.state;

    if (!player || !player.hand || player.hand.length === 0) {
      return false;
    }

    const index = Math.floor(Math.random() * player.hand.length);
    const card = player.hand.splice(index, 1)[0];

    s.answerDiscard.push(card);

    s.submissions.push({
      playerId: player.id,
      submissionId: crypto.randomUUID(),
      cardId: card.id,
      answer: card.text
    });

    await recordCardStat(this.env, card, "submitted");

    return true;
  }

  async resolveWinner(chosen) {
    const s = this.state;

    if (!chosen) return;

    const winner = s.players.find(
      p => p.id === chosen.playerId
    );

    if (winner) {
      winner.score += 1;
    }

    await recordCardStat(
      this.env,
      { id: chosen.cardId, text: chosen.answer },
      "selected"
    );

    s.winnerId = chosen.playerId;
    s.submissionDeadlines = {};
    s.judgeDeadline = null;

    if (winner && winner.score >= s.targetScore) {
      s.status = "finished";

      for (const p of s.players) {
        p.inLobby = false;
      }
    } else {
      s.status = "between";
      await this.dealHands();
    }
  }

  // Cloudflare Durable Object alarm.
  async alarm() {
    const s = await this.load();

    if (!s || s.status !== "playing") {
      return;
    }

    let changed = false;
    const now = Date.now();

    if (!s.submissionDeadlines) {
      s.submissionDeadlines = {};
    }

    for (const [playerId, deadline] of Object.entries(
      s.submissionDeadlines
    )) {
      if (deadline > now) continue;

      const player = s.players.find(p => p.id === playerId);

      if (
        player &&
        playerId !== s.judgeId &&
        !s.submissions.some(x => x.playerId === playerId)
      ) {
        await this.recordAutomaticSubmission(player);
      }

      delete s.submissionDeadlines[playerId];
      changed = true;
    }

    if (s.submissions.length >= s.players.length - 1) {
      if (!s.revealed || !s.judgeDeadline) {
        this.startJudgeTimerIfReady();
        changed = true;
      }
    }

    if (
      s.revealed &&
      s.judgeDeadline &&
      s.judgeDeadline <= now &&
      s.submissions.length > 0
    ) {
      const index = Math.floor(Math.random() * s.submissions.length);
      const chosen = s.submissions[index];

      await this.resolveWinner(chosen);
      changed = true;
    }

    await this.save();
    await this.scheduleAlarm();

    if (changed) {
      await this.broadcast();
    }
  }

  // --------------------------------------------------
  // DECK FUNCTIONS
  // --------------------------------------------------

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

  async drawAnswer() {
    const s = this.state;

    if (s.answerDeck.length === 0 && s.answerDiscard.length > 0) {
      s.answerDeck = shuffle(s.answerDiscard);
      s.answerDiscard = [];
    }

    if (s.answerDeck.length === 0) {
      throw new Error("No answer cards available.");
    }

    const card = s.answerDeck.shift();

    await recordCardStat(this.env, card, "drawn");

    return card;
  }

  async dealHands() {
    for (const player of this.state.players) {
      while (player.hand.length < 10) {
        player.hand.push(await this.drawAnswer());
      }
    }
  }

  // --------------------------------------------------
  // PUBLIC GAME STATE
  // --------------------------------------------------

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
        : [],

      chat: s.chat || []
    };
  }

  // --------------------------------------------------
  // NOTIFICATIONS AND BROADCASTS
  // --------------------------------------------------

  async notifyHost(message) {
    if (!this.state) return;

    const hostId = this.state.hostId;

    for (const ws of this.ctx.getWebSockets()) {
      try {
        const attachment = ws.deserializeAttachment();

        if (attachment?.playerId === hostId) {
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

  async broadcastChat(message) {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const playerId = ws.deserializeAttachment()?.playerId;

        if (this.state.players.some(p => p.id === playerId)) {
          ws.send(JSON.stringify({
            type: "chat",
            message
          }));
        }
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

    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // --------------------------------------------------
  // DURABLE OBJECT REQUEST HANDLING
  // --------------------------------------------------

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
          winnerId: null,

          chat: [],

          submissionDeadlines: {},
          judgeDeadline: null
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

  // --------------------------------------------------
  // WEBSOCKET GAME ACTIONS
  // --------------------------------------------------

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

    // CHAT
    if (data.type === "chat") {
      const originalText = String(data.text || "").trim();

      if (!originalText) return;

      if (originalText.length > 300) {
        ws.send(JSON.stringify({
          type: "error",
          message: "Chat messages must be 300 characters or fewer."
        }));

        return;
      }

      const filteredText = filterProfanity(originalText);

      const chatMessage = {
        id: crypto.randomUUID(),
        playerId,
        name: player.name,
        text: filteredText,
        time: Date.now()
      };

      if (!Array.isArray(s.chat)) {
        s.chat = [];
      }

      s.chat.push(chatMessage);

      if (s.chat.length > 100) {
        s.chat = s.chat.slice(-100);
      }

      await this.save();
      await this.broadcastChat(chatMessage);

      return;
    }

    // PLAYER QUITS
    if (data.type === "quit") {
      const leavingIndex = s.players.findIndex(p => p.id === playerId);
      const wasHost = playerId === s.hostId;
      const wasJudge = playerId === s.judgeId;
      const leavingName = player.name;

      s.players.splice(leavingIndex, 1);

      s.submissions = s.submissions.filter(
        x => x.playerId !== playerId
      );

      if (s.submissionDeadlines) {
        delete s.submissionDeadlines[playerId];
      }

      if (s.players.length === 0) {
        await this.closeRoom();
        return;
      }

      if (wasHost) {
        s.hostId = s.players[0].id;
      }

      if (wasJudge && ["playing", "between"].includes(s.status)) {
        const nextIndex = leavingIndex % s.players.length;

        s.judgeIndex = nextIndex;
        s.judgeId = s.players[nextIndex].id;

        s.submissions = s.submissions.filter(
          x => x.playerId !== s.judgeId
        );

        if (s.submissionDeadlines) {
          delete s.submissionDeadlines[s.judgeId];
        }
      } else {
        s.judgeIndex = Math.max(
          0,
          s.players.findIndex(p => p.id === s.judgeId)
        );
      }

      if (s.status === "playing") {
        if (!s.submissionDeadlines) {
          s.submissionDeadlines = {};
        }

        for (const p of s.players) {
          if (
            p.id !== s.judgeId &&
            !s.submissions.some(x => x.playerId === p.id) &&
            !s.submissionDeadlines[p.id]
          ) {
            s.submissionDeadlines[p.id] = Date.now() + TURN_TIME;
          }
        }

        this.startJudgeTimerIfReady();
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
        s.submissionDeadlines = {};
        s.judgeDeadline = null;

        for (const p of s.players) {
          p.inLobby = true;
          p.hand = [];
        }
      }

      await this.save();
      await this.scheduleAlarm();
      await this.broadcast();

      if (wasHost) {
        await this.notifyHost(
          `${leavingName} has left the room. You are now the host.`
        );
      } else {
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

    // PLAYER RETURNS TO LOBBY AFTER FINISHED GAME
    if (
      data.type === "playAgain" &&
      s.status === "finished"
    ) {
      player.inLobby = true;
      player.hand = [];
    }

    // HOST STARTS A NEW GAME
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

        await this.dealHands();

        s.status = "playing";
        s.round = 1;
        s.judgeIndex = 0;
        s.judgeId = s.players[0].id;
        s.question = this.drawQuestion();
        s.submissions = [];
        s.revealed = false;
        s.winnerId = null;

        this.startSubmissionTimers();

      } catch (error) {
        s.players = previousPlayers;

        await this.save();

        ws.send(JSON.stringify({
          type: "error",
          message: error.message
        }));

        return;
      }
    }

    // PLAYER SUBMITS AN ANSWER
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

      await recordCardStat(this.env, card, "submitted");

      if (s.submissionDeadlines) {
        delete s.submissionDeadlines[playerId];
      }

      this.startJudgeTimerIfReady();
    }

    // JUDGE PICKS WINNER
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

      await this.resolveWinner(chosen);
    }

    // HOST ADVANCES TO NEXT ROUND
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

      this.startSubmissionTimers();
    }

    await this.save();
    await this.scheduleAlarm();
    await this.broadcast();
  }

  // --------------------------------------------------
  // WEBSOCKET CONNECTION EVENTS
  // --------------------------------------------------

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

// --------------------------------------------------
// PERMANENT CARD STATISTICS DURABLE OBJECT
// --------------------------------------------------

export class CardStats {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/record" && request.method === "POST") {
      const body = await request.json();

      if (
        !body.cardId ||
        !["drawn", "submitted", "selected"].includes(body.event)
      ) {
        return json({ error: "Invalid statistics entry." }, 400);
      }

      const stats = await this.ctx.storage.get("stats") || {};

      if (!stats[body.cardId]) {
        stats[body.cardId] = {
          cardId: body.cardId,
          text: body.text || "",
          drawn: 0,
          submitted: 0,
          selected: 0
        };
      }

      const card = stats[body.cardId];

      if (body.text) {
        card.text = body.text;
      }

      card[body.event] += 1;

      await this.ctx.storage.put("stats", stats);

      return json({ ok: true });
    }

    if (url.pathname === "/list" && request.method === "GET") {
      const stats = await this.ctx.storage.get("stats") || {};

      return json({
        cards: Object.values(stats).sort((a, b) =>
          a.cardId.localeCompare(b.cardId)
        )
      });
    }

    return json({ error: "Not found." }, 404);
  }
}

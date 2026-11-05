const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      const id = env.GAME_ROOMS.idFromName(code);
      const room = env.GAME_ROOMS.get(id);
      const hostId = crypto.randomUUID();

      const init = await room.fetch("https://room/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, hostId })
      });

      if (!init.ok) return json({ error: "Couldn't create room." }, 500);
      return json({ code, playerId: hostId });
    }

    const match = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})(?:\/(join|state|socket))?$/);

    if (match) {
      const [, code, action = "state"] = match;
      const id = env.GAME_ROOMS.idFromName(code);
      const room = env.GAME_ROOMS.get(id);

      if (action === "join" && request.method === "POST") {
        const playerId = crypto.randomUUID();
        const response = await room.fetch("https://room/join", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...(await request.json()), playerId })
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
  constructor(ctx) {
    this.ctx = ctx;
    this.state = null;
  }

  async load() {
    if (!this.state) this.state = await this.ctx.storage.get("game") || null;
    return this.state;
  }

  async save() {
    await this.ctx.storage.put("game", this.state);
  }

  publicState() {
    const s = this.state;
    if (!s) return null;

    return {
      code: s.code,
      status: s.status,
      round: s.round,
      judgeId: s.judgeId,
      targetScore: s.targetScore,
      players: s.players.map(({id,name,score,online}) => ({id,name,score,online})),
      question: s.question,
      submissions: s.revealed
        ? s.submissions.map(x => ({playerId:x.playerId, answer:x.answer}))
        : s.submissions.map(() => ({answer:"Submitted"})),
      revealed: s.revealed,
      winnerId: s.winnerId
    };
  }

  async broadcast() {
    const message = JSON.stringify({
      type: "state",
      state: this.publicState()
    });

    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(message); } catch {}
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      if (!this.state) {
        const {code, hostId} = await request.json();
        this.state = {
          code,
          hostId,
          status: "lobby",
          round: 0,
          judgeIndex: 0,
          judgeId: hostId,
          targetScore: 5,
          players: [{id:hostId,name:"Host",score:0,online:true}],
          question: null,
          submissions: [],
          revealed: false,
          winnerId: null
        };
        await this.save();
      }
      return json({ok:true});
    }

    await this.load();
    if (!this.state) return json({error:"Room not found."},404);

    if (url.pathname === "/join" && request.method === "POST") {
      const body = await request.json();
      const name = String(body.name || "").trim().slice(0,18);

      if (!name) return json({error:"Enter a name."},400);
      if (this.state.status !== "lobby") return json({error:"Game already started."},409);
      if (this.state.players.length >= 10) return json({error:"Room is full."},409);

      this.state.players.push({
        id: body.playerId,
        name,
        score: 0,
        online: true
      });

      await this.save();
      await this.broadcast();
      return json({ok:true});
    }

    if (url.pathname === "/state") return json(this.publicState());

    if (url.pathname === "/ws") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);

      const playerId = url.searchParams.get("playerId");
      const player = this.state.players.find(p => p.id === playerId);

      if (player) {
        player.online = true;
        await this.save();
      }

      server.send(JSON.stringify({
        type:"state",
        state:this.publicState()
      }));

      await this.broadcast();
      return new Response(null,{status:101,webSocket:client});
    }

    return json({error:"Not found."},404);
  }

  async webSocketMessage(ws, message) {
    let data;
    try { data = JSON.parse(message); } catch { return; }

    const s = await this.load();
    const player = s.players.find(p => p.id === data.playerId);
    if (!player) return;

    if (data.type === "start" &&
        data.playerId === s.hostId &&
        s.status === "lobby" &&
        s.players.length >= 3) {
      s.status = "playing";
      s.round = 1;
      s.judgeIndex = 0;
      s.judgeId = s.players[0].id;
      s.question = "What's the most unexpected thing to find in a school bag?";
      s.submissions = [];
      s.revealed = false;

    } else if (data.type === "submit" &&
        s.status === "playing" &&
        data.playerId !== s.judgeId &&
        !s.revealed) {
      const answer = String(data.answer || "").trim().slice(0,100);

      if (answer && !s.submissions.some(x => x.playerId === data.playerId)) {
        s.submissions.push({playerId:data.playerId,answer});
      }

      if (s.submissions.length === s.players.length - 1) {
        s.revealed = true;
      }

    } else if (data.type === "pick" &&
        data.playerId === s.judgeId &&
        s.revealed) {
      const chosen = s.submissions.find(x => x.playerId === data.winnerId);
      if (!chosen) return;

      const winner = s.players.find(p => p.id === chosen.playerId);
      if (winner) winner.score += 1;

      s.winnerId = chosen.playerId;
      s.status = "between";

    } else if (data.type === "next" &&
        data.playerId === s.hostId &&
        s.status === "between") {
      if (s.players.some(p => p.score >= s.targetScore)) {
        s.status = "finished";
      } else {
        s.round += 1;
        s.judgeIndex = (s.judgeIndex + 1) % s.players.length;
        s.judgeId = s.players[s.judgeIndex].id;
        s.question = "What would make an ordinary day completely unforgettable?";
        s.submissions = [];
        s.revealed = false;
        s.winnerId = null;
        s.status = "playing";
      }
    }

    await this.save();
    await this.broadcast();
  }

  async webSocketClose() {
    await this.broadcast();
  }
}


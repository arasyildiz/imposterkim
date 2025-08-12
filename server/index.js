import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { nanoid } from "nanoid";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

// __dirname çözümü (ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.ORIGIN?.split(",") || "*",
    methods: ["GET","POST"]
  }
});

app.use(cors());
app.use(express.json());

// --- Kategorileri JSON'dan oku ---
const categoriesPath = path.join(
  process.cwd(),
  process.env.CATEGORIES_FILE || "categories.json"
);
const categoriesRaw = JSON.parse(fs.readFileSync(categoriesPath, "utf-8"));

function normalizeCategories(data){
  const out = {};
  for (const [cat, arr] of Object.entries(data)) {
    out[cat] = (arr || []).map(item => {
      if (typeof item === "string") {
        return { word: item, hint: "genel" };
      }
      return { word: item.word, hint: item.hint || "genel" };
    });
  }
  return out;
}
const categoriesData = normalizeCategories(categoriesRaw);

// --- Oda & yardımcılar ---
const rooms = new Map();
const PROFANITY = ["küfür","salak","aptal","gerizekalı","mal"];

function norm(t){
  return (t||"").toString().toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g,"");
}
function containsProfanity(t){
  const nt = norm(t);
  return PROFANITY.some(p => nt.includes(norm(p)));
}
function revealLeak(clue, secret){
  const c=norm(clue), s=norm(secret); if(!s) return false;
  if(c.includes(s)) return true;
  for(let i=0;i<s.length-2;i++){
    const chunk=s.slice(i, i+Math.max(3, Math.floor(s.length*0.5)));
    if(chunk.length>=3 && c.includes(chunk)) return true;
  }
  return false;
}
function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function publicRoom(room){
  return {
    id: room.id,
    players: room.players.map(p=> ({ id:p.id, nickname:p.nickname, isReady:p.isReady })),
    settings: room.settings,
    state: room.state,
    currentRound: room.currentRound,
    hostId: room.hostId
  };
}

function pickSecretAndHint(category){
  let pool = [];
  if (category === "All") {
    Object.values(categoriesData).forEach(list => pool.push(...list));
  } else {
    pool = categoriesData[category] || [];
  }
  if (pool.length === 0) {
    return { secret: "pizza", hint: "genel" };
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return { secret: pick.word, hint: pick.hint || "genel" };
}

io.on("connection", (socket)=>{
  const broadcastRoom = (roomId) => {
    const room = rooms.get(roomId);
    if (room) io.to(roomId).emit("room_update", publicRoom(room));
  };

  const removePlayer = (roomId, playerId) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const idx = room.players.findIndex(p => p.id === playerId);
    if (idx !== -1) room.players.splice(idx, 1);
    if (room.hostId === playerId) room.hostId = room.players[0]?.id || null;
    if (room.players.length === 0) rooms.delete(roomId);
    else broadcastRoom(roomId);
  };

  socket.on("create_room", ({ nickname, rounds, category, votingType, waitSeconds }) => {
    const roomId = nanoid(6);
    const room = {
      id: roomId,
      hostId: socket.id,
      players: [],
      settings: {
        rounds: Math.max(1, Math.min(10, parseInt(rounds || 3))),
        category: category || "All",
        votingType: votingType === "open" ? "open" : "secret",
        waitSeconds: Math.max(5, Math.min(300, parseInt((waitSeconds ?? 20))))
      },
      state: "lobby",
      currentRound: 0,
      clues: [],
      votes: {},
      imposterId: null,
      secretWord: null,
      imposterHint: null,
      order: [],
      speakIndex: 0,
      turnTimeout: null,
      endsAt: null
    };
    rooms.set(roomId, room);
    joinRoomInternal(roomId, nickname, socket);
  });

  socket.on("join_room", ({ roomId, nickname }) => joinRoomInternal(roomId, nickname, socket));

  function joinRoomInternal(roomId, nickname, sock){
    const room = rooms.get(roomId);
    if(!room){ sock.emit("error_message", {message:"Oda bulunamadı."}); return; }
    if(room.state!=="lobby" && room.state!=="results"){
      sock.emit("error_message", {message:"Oyun başladı, katılım kapalı."});
      return;
    }
    const nick = (nickname||"").trim().slice(0,16) || "Oyuncu";
    const player = { id: sock.id, nickname: nick, isReady: false };
    room.players.push(player);

    sock.join(roomId);
    sock.data.roomId = roomId;
    sock.data.nickname = nick;
    broadcastRoom(roomId);
  }

  socket.on("toggle_ready", ({ roomId, ready }) => {
    const room = rooms.get(roomId); if(!room) return;
    const p = room.players.find(p=>p.id===socket.id); if(!p) return;
    p.isReady = !!ready;
    broadcastRoom(roomId);
  });

  socket.on("reset_room", ({ roomId }) => {
    const room = rooms.get(roomId); if(!room) return;
    room.state = "lobby";
    room.currentRound = 0;
    room.clues = [];
    room.votes = {};
    room.order = [];
    room.speakIndex = 0;
    room.endsAt = null;
    room.imposterId = null;
    room.secretWord = null;
    room.imposterHint = null;
    room.players.forEach(p => p.isReady = false);
    broadcastRoom(roomId);
  });

  socket.on("start_game", ({ roomId }) => {
    const room = rooms.get(roomId); if(!room) return;
    if(socket.id !== room.hostId) return;
    if(room.state !== "lobby") return;
    const MIN_PLAYERS = parseInt(process.env.MIN_PLAYERS || "4");
    if(room.players.length < MIN_PLAYERS){
      io.to(socket.id).emit("error_message", {message:`En az ${MIN_PLAYERS} oyuncu gerekli.`});
      return;
    }
    if(!room.players.every(p=>p.isReady)){
      io.to(socket.id).emit("error_message", {message:"Herkes hazır olmalı."});
      return;
    }
    const imposter = room.players[Math.floor(Math.random()*room.players.length)];
    room.imposterId = imposter.id;
    const { secret, hint } = pickSecretAndHint(room.settings.category);
    room.secretWord = secret;
    room.imposterHint = hint;
    room.state = "playing";
    room.currentRound = 1;
    room.clues = [];
    room.votes = {};
    room.order = shuffle([...room.players.map(p=>p.id)]);
    room.speakIndex = 0;

    io.to(room.id).emit("game_started", { room: publicRoom(room) });
    room.players.forEach(p => {
      if(p.id === room.imposterId) io.to(p.id).emit("private_card", { role:"imposter", hint: room.imposterHint });
      else io.to(p.id).emit("private_card", { role:"player", word: room.secretWord });
    });
    io.to(room.id).emit("round_started", { round: room.currentRound, order: room.order });
    startTurnTimer(room);
  });

  socket.on("submit_clue", ({ roomId, text }) => {
    const room = rooms.get(roomId); if(!room || room.state!=="playing") return;
    const player = room.players.find(p=>p.id===socket.id); if(!player) return;
    const clueText = (text||"").trim().slice(0,120);
    if(!clueText){ io.to(socket.id).emit("error_message",{message:"Boş ipucu gönderilemez."}); return; }
    if(containsProfanity(clueText)){ io.to(socket.id).emit("error_message",{message:"Küfür tespit edildi."}); return; }
    if(revealLeak(clueText, room.secretWord)){ io.to(socket.id).emit("error_message",{message:"Gizli kelimeyi ifşa etmeyin!"}); return; }

    const expected = room.order[room.speakIndex];
    if(expected !== player.id){ io.to(socket.id).emit("error_message",{message:"Sıra sizde değil."}); return; }

    const already = room.clues.find(c=> c.round===room.currentRound && c.playerId===player.id);
    if(already){ io.to(socket.id).emit("error_message",{message:"Bu tur için zaten ipucu verdiniz."}); return; }

    const c = { playerId: player.id, nickname: player.nickname, text: clueText, round: room.currentRound, ts: Date.now() };
    room.clues.push(c);
    io.to(room.id).emit("clue_accepted", { round: room.currentRound, clue: { nickname: c.nickname, text: c.text } });

    if(room.turnTimeout){ clearTimeout(room.turnTimeout); room.turnTimeout = null; }
    advanceTurn(room);
  });

  socket.on("submit_vote", ({ roomId, targetId }) => {
    const room = rooms.get(roomId); if(!room || room.state!=="voting") return;
    const me = room.players.find(p=>p.id===socket.id); if(!me) return;
    if(!room.players.find(p=>p.id===targetId)) return;

    room.votes[me.id] = targetId;
    if(room.settings.votingType==="open"){
      io.to(room.id).emit("vote_update", { voter: me.nickname, targetId });
    }
    if(Object.keys(room.votes).length >= room.players.length){
      room.state = "results";
      if(room.turnTimeout){ clearTimeout(room.turnTimeout); room.turnTimeout=null; }
      const tally = {};
      Object.values(room.votes).forEach(t=> { tally[t]=(tally[t]||0)+1; });
      let max=0, winners=[];
      for(const [pid,count] of Object.entries(tally)){
        if(count>max){max=count; winners=[pid];}
        else if(count===max){ winners.push(pid);}
      }
      const selectedId = winners[0];
      const impCaught = selectedId === room.imposterId;
      io.to(room.id).emit("game_results", {
        votes: room.votes,
        tally,
        selectedId,
        selectedNickname: room.players.find(p=>p.id===selectedId)?.nickname,
        imposterId: room.imposterId,
        imposterNickname: room.players.find(p=>p.id===room.imposterId)?.nickname,
        secretWord: room.secretWord,
        imposterHint: room.imposterHint,
        impCaught,
        clues: room.clues.map(c=> ({ round:c.round, nickname:c.nickname, text:c.text }))
      });
    }
  });

  socket.on("leave_room", ({ roomId }) => {
    const rid = roomId || socket.data.roomId;
    if (!rid) return;
    socket.leave(rid);
    removePlayer(rid, socket.id);
    socket.data.roomId = null;
  });

  socket.on("disconnect", () => {
    const rid = socket.data.roomId;
    if (rid) removePlayer(rid, socket.id);
    else {
      const room = [...rooms.values()].find(r => r.players.some(p=>p.id===socket.id));
      if (room) removePlayer(room.id, socket.id);
    }
  });

  function startTurnTimer(room){
    if(room.state!=="playing") return;
    if(room.turnTimeout){ clearTimeout(room.turnTimeout); room.turnTimeout=null; }
    const waitMs = (room.settings.waitSeconds ?? 20) * 1000;
    room.endsAt = Date.now() + waitMs;
    const currentSpeakerId = room.order[room.speakIndex];
    const currentSpeakerNickname = room.players.find(p=>p.id===currentSpeakerId)?.nickname;
    io.to(room.id).emit("turn_update", { round: room.currentRound, currentSpeakerId, currentSpeakerNickname, endsAt: room.endsAt });
    room.turnTimeout = setTimeout(()=> advanceTurn(room), waitMs + 50);
  }
  function advanceTurn(room){
    if(room.state!=="playing") return;
    room.speakIndex += 1;
    if(room.speakIndex >= room.players.length){
      if(room.currentRound >= room.settings.rounds){
        room.state="voting";
        if(room.turnTimeout){ clearTimeout(room.turnTimeout); room.turnTimeout=null; }
        io.to(room.id).emit("voting_started", { votingType: room.settings.votingType });
        return;
      } else {
        room.currentRound += 1;
        room.speakIndex = 0;
        io.to(room.id).emit("round_started", { round: room.currentRound, order: room.order });
      }
    }
    startTurnTimer(room);
  }
});

// ---- Kategori endpoint ----
app.get("/categories", (_req, res) => {
  res.json({ categories: Object.keys(categoriesData) });
});

// ---- Statik frontend servis + SPA fallback ----
const distPath = path.resolve(__dirname, "../client/dist");
app.use(express.static(distPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

const PORT = process.env.PORT || 3001;
app.get("/", (_req,res)=> res.json({ok:true}));
httpServer.listen(PORT, ()=> console.log("Server listening on", PORT));

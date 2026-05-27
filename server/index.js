import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import {
  BOT_NAMES,
  chooseBidBot,
  chooseCardBot,
  createGame,
  nextRound,
  playCard,
  resolveTrick,
  sanitizeGame,
  submitBid,
} from "./engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const rooms = new Map();
const disconnectGraceMs = 60_000;
const botDelayMs = 450;

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let tries = 0; tries < 20; tries++) {
    let code = "";
    for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error("Could not allocate room code");
}

function token() {
  return randomBytes(18).toString("base64url");
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    settings: room.settings,
    seats: room.seats.map(({ token: _token, socket: _socket, disconnectTimer: _timer, ...seat }) => seat),
  };
}

function broadcastRoom(room) {
  for (const seat of room.seats) {
    if (!seat.socket || seat.socket.readyState !== seat.socket.OPEN) continue;
    send(seat.socket, {
      type: "room",
      room: publicRoom(room),
      game: room.game ? sanitizeGame(room.game, seat.id) : null,
      playerId: seat.id,
      token: seat.token,
    });
  }
}

function broadcastError(ws, message) {
  send(ws, { type: "error", message });
}

function addBotSeat(room) {
  const botNum = room.seats.filter((s) => s.isBot).length;
  if (room.seats.length >= 6) return;
  room.seats.push({
    id: randomUUID(),
    name: BOT_NAMES[botNum] ?? `Bot ${botNum + 1}`,
    isBot: true,
    connected: true,
  });
}

function removeBotSeat(room) {
  const idx = room.seats.findLastIndex((s) => s.isBot);
  if (idx >= 0) room.seats.splice(idx, 1);
}

function ensureMinimumSeats(room) {
  while (room.seats.length < 3) addBotSeat(room);
}

function startRoom(room) {
  ensureMinimumSeats(room);
  room.status = "playing";
  room.game = createGame(room.settings, room.seats);
  broadcastRoom(room);
  scheduleBots(room);
}

function activeSeatIds(room) {
  return new Set(room.seats.filter((s) => !s.removed).map((s) => s.id));
}

function syncSeatFlags(room) {
  if (!room.game) return;
  const activeIds = activeSeatIds(room);
  room.game.players = room.game.players.map((p) => {
    const seat = room.seats.find((s) => s.id === p.id);
    return {
      ...p,
      isBot: !!seat?.isBot,
      isHuman: !seat?.isBot,
      connected: !!seat?.isBot || !!seat?.connected,
      removed: !activeIds.has(p.id),
    };
  });
}

function currentPlayer(room) {
  if (!room.game || room.game.turn === null) return null;
  return room.game.players[room.game.turn];
}

function advanceRoom(room) {
  if (!room.game) return;
  let guard = 0;
  while (guard++ < 20) {
    if (room.game.phase === "trickPause") {
      room.game = resolveTrick(room.game);
      if (room.game.phase === "roundEnd") room.game = nextRound(room.game);
      syncSeatFlags(room);
      continue;
    }
    if (room.game.phase === "roundEnd") {
      room.game = nextRound(room.game);
      syncSeatFlags(room);
      continue;
    }
    break;
  }
  broadcastRoom(room);
  scheduleBots(room);
}

function scheduleBots(room) {
  if (room.botTimer) clearTimeout(room.botTimer);
  if (!room.game || room.game.phase === "gameEnd") return;
  const player = currentPlayer(room);
  if (!player?.isBot) return;
  room.botTimer = setTimeout(() => {
    if (!room.game) return;
    const idx = room.game.turn;
    const bot = room.game.players[idx];
    if (!bot?.isBot) return;
    if (room.game.phase === "bidding") {
      room.game = submitBid(room.game, idx, chooseBidBot(room.game, idx));
    } else if (room.game.phase === "playing") {
      room.game = playCard(room.game, idx, chooseCardBot(room.game, idx).id);
    }
    advanceRoom(room);
  }, botDelayMs);
}

function handleDisconnect(room, seat) {
  seat.connected = false;
  seat.socket = null;
  if (seat.isBot || room.status !== "playing") {
    broadcastRoom(room);
    return;
  }
  seat.disconnectTimer = setTimeout(() => {
    const current = room.seats.find((s) => s.id === seat.id);
    if (!current || current.connected || current.isBot) return;
    current.isBot = true;
    current.connected = true;
    current.removed = true;
    current.name = `${current.name} (left)`;
    syncSeatFlags(room);
    if (room.game) {
      room.game.auditLog = [...(room.game.auditLog ?? []), `${seat.name} disconnected for 60 seconds and was removed. A bot will finish that seat until the next deal.`];
      room.game.log = [`${seat.name} was removed after disconnecting.`, ...(room.game.log ?? [])].slice(0, 24);
    }
    advanceRoom(room);
  }, disconnectGraceMs);
  broadcastRoom(room);
}

function createRoom(ws, data) {
  const name = String(data.name ?? "").trim().slice(0, 24);
  if (name.length < 1) return broadcastError(ws, "Enter a name first.");
  const code = roomCode();
  const seat = { id: randomUUID(), name, token: token(), isBot: false, connected: true, socket: ws };
  const settings = {
    players: Number(data.settings?.players ?? 4),
    maxHand: Number(data.settings?.maxHand ?? 7),
    screwDealer: data.settings?.screwDealer !== false,
    difficulty: String(data.settings?.difficulty ?? "hard"),
    botSpeed: 450,
    helper: false,
    samples: Number(data.settings?.samples ?? 120),
  };
  const room = { code, hostId: seat.id, status: "lobby", settings, seats: [seat], game: null, botTimer: null };
  const bots = Math.max(0, Math.min(5, Number(data.bots ?? 0)));
  for (let i = 0; i < bots; i++) addBotSeat(room);
  rooms.set(code, room);
  ws.roomCode = code;
  ws.playerId = seat.id;
  broadcastRoom(room);
}

function joinRoom(ws, data) {
  const code = String(data.code ?? "").trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) return broadcastError(ws, "Room not found.");
  const suppliedToken = String(data.token ?? "");
  let seat = suppliedToken ? room.seats.find((s) => s.token === suppliedToken) : null;
  if (!seat) {
    if (room.status !== "lobby") return broadcastError(ws, "Game already started. Rejoin with the original browser.");
    const name = String(data.name ?? "").trim().slice(0, 24);
    if (name.length < 1) return broadcastError(ws, "Enter a name first.");
    if (room.seats.length >= 6) return broadcastError(ws, "Room is full.");
    seat = { id: randomUUID(), name, token: token(), isBot: false, connected: true, socket: ws };
    room.seats.push(seat);
  }
  if (seat.disconnectTimer) clearTimeout(seat.disconnectTimer);
  seat.connected = true;
  seat.isBot = false;
  seat.removed = false;
  seat.socket = ws;
  ws.roomCode = code;
  ws.playerId = seat.id;
  syncSeatFlags(room);
  broadcastRoom(room);
  scheduleBots(room);
}

function handleMessage(ws, raw) {
  let data;
  try {
    data = JSON.parse(raw.toString());
  } catch {
    return broadcastError(ws, "Invalid message.");
  }
  if (data.type === "create") return createRoom(ws, data);
  if (data.type === "join") return joinRoom(ws, data);

  const room = rooms.get(ws.roomCode);
  if (!room) return broadcastError(ws, "Join or create a room first.");
  const seat = room.seats.find((s) => s.id === ws.playerId);
  if (!seat) return broadcastError(ws, "Seat not found.");

  if (data.type === "addBot" && room.hostId === seat.id && room.status === "lobby") {
    addBotSeat(room);
    return broadcastRoom(room);
  }
  if (data.type === "removeBot" && room.hostId === seat.id && room.status === "lobby") {
    removeBotSeat(room);
    return broadcastRoom(room);
  }
  if (data.type === "start" && room.hostId === seat.id && room.status === "lobby") {
    return startRoom(room);
  }
  if (!room.game || room.status !== "playing") return broadcastError(ws, "Game is not running.");
  const playerIndex = room.game.players.findIndex((p) => p.id === seat.id);
  if (playerIndex < 0) return broadcastError(ws, "You are not in this game.");
  if (data.type === "bid") {
    room.game = submitBid(room.game, playerIndex, Number(data.bid));
    return advanceRoom(room);
  }
  if (data.type === "play") {
    room.game = playCard(room.game, playerIndex, String(data.cardId));
    return advanceRoom(room);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(dist, requested));
  if (!filePath.startsWith(dist) || !existsSync(filePath)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff" });
    res.end(await readFile(path.join(dist, "index.html"), "utf8"));
    return;
  }
  const ext = path.extname(filePath);
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
  res.writeHead(200, {
    "content-type": types[ext] ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(await readFile(filePath));
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 8 * 1024 });
wss.on("connection", (ws) => {
  ws.on("message", (raw) => handleMessage(ws, raw));
  ws.on("close", () => {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    const seat = room.seats.find((s) => s.id === ws.playerId);
    if (seat) handleDisconnect(room, seat);
  });
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => {
  console.log(`River server listening on http://127.0.0.1:${port}`);
});

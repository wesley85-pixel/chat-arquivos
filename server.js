const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5 * 1024 * 1024 * 1024 });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");
const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_FILE_EXPIRY_DAYS = Number(process.env.DEFAULT_FILE_EXPIRY_DAYS || 7);
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function initDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({
      rooms: [],
      files: [],
      messages: []
    }, null, 2));
  }
}
initDb();

function dbRead() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return { rooms: [], files: [], messages: [] };
  }
}
function dbWrite(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
}
function randomId(len = 12) {
  return crypto.randomBytes(24).toString("base64url").slice(0, len);
}
function slugify(str = "") {
  return str
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}
function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}
function sanitizeFilename(name) {
  return name.replace(/[^\w.\- ]+/g, "_");
}
function getRoomPublic(room) {
  return {
    id: room.id,
    name: room.name,
    slug: room.slug,
    isPrivate: room.isPrivate,
    createdAt: room.createdAt
  };
}
function getRoomBySlug(slug) {
  const db = dbRead();
  return db.rooms.find(r => r.slug === slug);
}
function getRoomById(id) {
  const db = dbRead();
  return db.rooms.find(r => r.id === id);
}
function upsertRoom({ name, password, expiryDays }) {
  const db = dbRead();
  const slugBase = slugify(name) || "sala";
  let slug = slugBase;
  let counter = 2;
  while (db.rooms.some(r => r.slug === slug)) {
    slug = `${slugBase}-${counter++}`;
  }
  const room = {
    id: randomId(10),
    name: name.trim().slice(0, 40),
    slug,
    isPrivate: Boolean(password),
    passwordHash: password ? hashPassword(password) : null,
    expiryDays: Math.max(1, Math.min(30, Number(expiryDays || DEFAULT_FILE_EXPIRY_DAYS))),
    createdAt: Date.now()
  };
  db.rooms.push(room);
  dbWrite(db);
  return room;
}
function listRooms() {
  const db = dbRead();
  return db.rooms.map(getRoomPublic).sort((a,b) => a.name.localeCompare(b.name, "pt-BR"));
}
function verifyRoom(slug, password) {
  const room = getRoomBySlug(slug);
  if (!room) return { ok: false, error: "Sala não encontrada." };
  if (room.isPrivate && room.passwordHash !== hashPassword(password || "")) {
    return { ok: false, error: "Senha incorreta." };
  }
  return { ok: true, room };
}
function roomMessages(roomId) {
  const db = dbRead();
  return db.messages
    .filter(m => m.roomId === roomId)
    .sort((a,b) => a.createdAt - b.createdAt)
    .slice(-200);
}
function roomFiles(roomId) {
  const db = dbRead();
  return db.files
    .filter(f => f.roomId === roomId && (!f.expiresAt || f.expiresAt > Date.now()))
    .sort((a,b) => b.createdAt - a.createdAt);
}
function saveMessage(message) {
  const db = dbRead();
  db.messages.push(message);
  if (db.messages.length > 5000) db.messages = db.messages.slice(-5000);
  dbWrite(db);
}
function saveFile(file) {
  const db = dbRead();
  db.files.push(file);
  if (db.files.length > 5000) db.files = db.files.slice(-5000);
  dbWrite(db);
}
function removeFileRecord(fileId) {
  const db = dbRead();
  const idx = db.files.findIndex(f => f.id === fileId);
  if (idx >= 0) {
    const [removed] = db.files.splice(idx, 1);
    dbWrite(db);
    return removed;
  }
  return null;
}
function getFileById(id) {
  const db = dbRead();
  return db.files.find(f => f.id === id);
}
function cleanupExpiredFiles() {
  const db = dbRead();
  const now = Date.now();
  const keep = [];
  for (const file of db.files) {
    const expired = file.expiresAt && file.expiresAt <= now;
    const filePath = path.join(UPLOAD_DIR, file.storedName);
    if (expired) {
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch {}
      }
    } else {
      keep.push(file);
    }
  }
  if (keep.length !== db.files.length) {
    db.files = keep;
    dbWrite(db);
  }
}
cleanupExpiredFiles();
setInterval(cleanupExpiredFiles, CLEANUP_INTERVAL_MS);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = sanitizeFilename(path.basename(file.originalname, ext));
    cb(null, `${Date.now()}-${randomId(8)}-${base}${ext}`);
  }
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/public", express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/rooms", (_req, res) => {
  res.json({ rooms: listRooms() });
});

app.post("/api/rooms", (req, res) => {
  const name = (req.body.name || "").toString().trim();
  const password = (req.body.password || "").toString().trim();
  const expiryDays = Number(req.body.expiryDays || DEFAULT_FILE_EXPIRY_DAYS);
  if (!name) return res.status(400).json({ error: "Digite o nome da sala." });
  const room = upsertRoom({ name, password, expiryDays });
  res.json({ ok: true, room: getRoomPublic(room) });
});

app.post("/api/rooms/join", (req, res) => {
  const slug = (req.body.slug || "").toString().trim();
  const password = (req.body.password || "").toString().trim();
  const check = verifyRoom(slug, password);
  if (!check.ok) return res.status(403).json({ error: check.error });
  const room = check.room;
  res.json({
    ok: true,
    room: getRoomPublic(room),
    messages: roomMessages(room.id),
    files: roomFiles(room.id).slice(0, 50)
  });
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  try {
    const slug = (req.body.roomSlug || "").toString().trim();
    const password = (req.body.roomPassword || "").toString();
    const nickname = (req.body.nickname || "Anônimo").toString().trim().slice(0, 24) || "Anônimo";
    const check = verifyRoom(slug, password);
    if (!check.ok) {
      if (req.file) {
        try { fs.unlinkSync(req.file.path); } catch {}
      }
      return res.status(403).json({ error: check.error });
    }
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });

    const room = check.room;
    const id = randomId(12);
    const expiresAt = Date.now() + room.expiryDays * 24 * 60 * 60 * 1000;
    const record = {
      id,
      roomId: room.id,
      roomSlug: room.slug,
      originalName: req.file.originalname,
      storedName: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size,
      nickname,
      createdAt: Date.now(),
      expiresAt
    };
    saveFile(record);

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const shareUrl = `${baseUrl}/share/${id}`;
    const directUrl = `${baseUrl}/download/${id}`;

    const message = {
      id: randomId(10),
      type: "file",
      roomId: room.id,
      nickname,
      text: "",
      createdAt: Date.now(),
      file: {
        id,
        originalName: record.originalName,
        mimetype: record.mimetype,
        size: record.size,
        shareUrl,
        directUrl,
        expiresAt
      }
    };
    saveMessage(message);
    io.to(room.slug).emit("chat message", message);
    res.json({ ok: true, file: message.file });
  } catch {
    res.status(500).json({ error: "Erro ao enviar arquivo." });
  }
});

app.get("/share/:id", (req, res) => {
  cleanupExpiredFiles();
  const file = getFileById(req.params.id);
  if (!file) {
    return res.status(404).send(`<!doctype html><html><head><meta charset="utf-8"><title>Arquivo não encontrado</title>
    <style>body{font-family:Arial;background:#313338;color:#f2f3f5;display:grid;place-items:center;min-height:100vh;margin:0} .card{background:#1e1f22;border:1px solid #3f4147;padding:28px;border-radius:18px;max-width:700px;width:calc(100% - 32px)} a{color:#9ab8ff;text-decoration:none}</style></head>
    <body><div class="card"><h1>Arquivo não encontrado</h1><p>Esse link expirou ou não existe mais.</p><a href="/">Voltar</a></div></body></html>`);
  }
  const mb = (file.size / (1024*1024)).toFixed(2);
  const date = new Date(file.createdAt).toLocaleString("pt-BR");
  const expires = new Date(file.expiresAt).toLocaleString("pt-BR");
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${file.originalName}</title>
  <style>
  body{font-family:Arial;background:#313338;color:#f2f3f5;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
  .card{background:#1e1f22;border:1px solid #3f4147;padding:28px;border-radius:18px;max-width:720px;width:100%;box-shadow:0 14px 40px rgba(0,0,0,.35)}
  .badge{display:inline-block;background:#5865f226;color:#d7ddff;border:1px solid #5865f255;padding:6px 10px;border-radius:999px;font-size:12px;margin-bottom:10px}
  .meta{background:#232428;padding:16px;border-radius:14px;border:1px solid #3f4147;margin:18px 0;line-height:1.9}
  a.btn{display:inline-block;background:#5865f2;color:#fff;padding:12px 16px;border-radius:12px;text-decoration:none;font-weight:700}
  a.btn.secondary{background:#3f4147}
  .stack{display:flex;gap:10px;flex-wrap:wrap}
  </style></head><body><div class="card">
  <div class="badge">Link de compartilhamento</div>
  <h1>${file.originalName}</h1>
  <p>Arquivo enviado por ${file.nickname}.</p>
  <div class="meta">
    <div><strong>Sala:</strong> ${file.roomSlug}</div>
    <div><strong>Tamanho:</strong> ${mb} MB</div>
    <div><strong>Tipo:</strong> ${file.mimetype || "desconhecido"}</div>
    <div><strong>Enviado em:</strong> ${date}</div>
    <div><strong>Expira em:</strong> ${expires}</div>
  </div>
  <div class="stack">
    <a class="btn" href="/download/${file.id}">Baixar arquivo</a>
    <a class="btn secondary" href="/">Abrir site</a>
  </div>
  </div></body></html>`);
});

app.get("/download/:id", (req, res) => {
  cleanupExpiredFiles();
  const file = getFileById(req.params.id);
  if (!file) return res.status(404).send("Arquivo não encontrado.");
  const filePath = path.join(UPLOAD_DIR, file.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).send("Arquivo não existe mais.");
  res.download(filePath, file.originalName);
});

app.delete("/api/files/:id", (req, res) => {
  const file = getFileById(req.params.id);
  if (!file) return res.status(404).json({ error: "Arquivo não encontrado." });
  const removed = removeFileRecord(file.id);
  if (removed) {
    const filePath = path.join(UPLOAD_DIR, removed.storedName);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
  res.json({ ok: true });
});

const onlineByRoom = new Map();

function emitOnline(roomSlug) {
  const roomUsers = Array.from((onlineByRoom.get(roomSlug) || new Map()).values());
  io.to(roomSlug).emit("online users", roomUsers);
}

io.on("connection", (socket) => {
  socket.data.nickname = "Anônimo";
  socket.data.roomSlug = null;

  socket.on("join room", ({ roomSlug, password, nickname }) => {
    const check = verifyRoom((roomSlug || "").trim(), password || "");
    if (!check.ok) {
      socket.emit("join error", check.error);
      return;
    }
    const room = check.room;
    const cleanNick = (nickname || "Anônimo").toString().trim().slice(0, 24) || "Anônimo";
    socket.data.nickname = cleanNick;

    if (socket.data.roomSlug) {
      socket.leave(socket.data.roomSlug);
      const prev = onlineByRoom.get(socket.data.roomSlug);
      if (prev) {
        prev.delete(socket.id);
        emitOnline(socket.data.roomSlug);
      }
    }

    socket.join(room.slug);
    socket.data.roomSlug = room.slug;

    if (!onlineByRoom.has(room.slug)) onlineByRoom.set(room.slug, new Map());
    onlineByRoom.get(room.slug).set(socket.id, cleanNick);

    socket.emit("room joined", {
      room: getRoomPublic(room),
      messages: roomMessages(room.id),
      files: roomFiles(room.id).slice(0, 50)
    });

    io.to(room.slug).emit("system message", `${cleanNick} entrou na sala.`);
    emitOnline(room.slug);
  });

  socket.on("chat message", ({ text }) => {
    const roomSlug = socket.data.roomSlug;
    const nickname = socket.data.nickname || "Anônimo";
    if (!roomSlug) return;
    const room = getRoomBySlug(roomSlug);
    if (!room) return;
    const clean = (text || "").toString().trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!clean) return;
    const message = {
      id: randomId(10),
      type: "text",
      roomId: room.id,
      nickname,
      text: clean,
      createdAt: Date.now()
    };
    saveMessage(message);
    io.to(room.slug).emit("chat message", message);
  });

  socket.on("disconnect", () => {
    const roomSlug = socket.data.roomSlug;
    const nickname = socket.data.nickname || "Anônimo";
    if (!roomSlug) return;
    const roomUsers = onlineByRoom.get(roomSlug);
    if (roomUsers) {
      roomUsers.delete(socket.id);
      emitOnline(roomSlug);
    }
    io.to(roomSlug).emit("system message", `${nickname} saiu da sala.`);
  });
});

server.listen(PORT, () => {
  console.log(`Servidor em http://localhost:${PORT}`);
});
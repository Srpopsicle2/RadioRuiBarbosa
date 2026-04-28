import express from 'express';
import fs from 'fs';
import path from 'path';
import * as mm from 'music-metadata';
import { fileURLToPath } from 'url';
import { Server } from "socket.io";
import http from "http";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 🔥 recriar __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let messages = [];
let playlist = [];
let currentIndex = 0;
let startTime = Date.now();


async function loadAudios() {
  playlist = [];

  const folderPath = path.join(__dirname, 'public/audios');
  const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.mp3'));

  for (let file of files) {
    const metadata = await mm.parseFile(path.join(folderPath, file));

    playlist.push({
      name: file,
      duration: metadata.format.duration
    });
  }

  console.log("Playlist carregada:", playlist);
}

function checkMusic() {
  if (playlist.length === 0) return;

  const current = playlist[currentIndex];
  const elapsed = (Date.now() - startTime) / 1000;

  if (elapsed >= current.duration) {
    currentIndex = (currentIndex + 1) % playlist.length;
    startTime = Date.now();
  }
}

setInterval(checkMusic, 1000);

io.on("connection", (socket) => {
  console.log("Usuário conectado");

  socket.emit("chat history", messages);

  socket.on("chat message", (msg) => {
    messages.push(msg);

    if (messages.length > 50) {
      messages.shift();
    }

    io.emit("chat message", msg);
  });
});

app.get('/status', (req, res) => {
  if (playlist.length === 0) return res.json({});

  const current = playlist[currentIndex];
  const elapsed = (Date.now() - startTime) / 1000;

  res.json({
    music: current.name,
    time: elapsed,
    duration: current.duration
  });
});

app.use(express.static('public'));

loadAudios().then(() => {
  server.listen(3000, () => {
    console.log("Servidor rodando em http://localhost:3000");
  });
});
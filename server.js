import express from 'express';
import fs from 'fs';
import path from 'path';
import * as mm from 'music-metadata';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import http from 'http';
import session from 'express-session';
import multer from 'multer';
import 'dotenv/config';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

let globalVolume = 1.0;
let messages = [];
let playlist = [];
let currentIndex = 0;
let startTime = Date.now();

const publicAudiosDir = path.join(__dirname, 'public', 'audios');
const tempDir = path.join(__dirname, 'temp');

if (!fs.existsSync(publicAudiosDir)) {
  fs.mkdirSync(publicAudiosDir, { recursive: true });
}

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, publicAudiosDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage });
const audioUpload = multer({ dest: tempDir });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax'
    }
  })
);

function requireAdmin(req, res, next) {
  if (req.session?.isAdmin === true) {
    return next();
  }
  return res.redirect('/admin');
}

async function loadAudios() {
  playlist = [];

  if (!fs.existsSync(publicAudiosDir)) {
    return;
  }

  const files = fs
    .readdirSync(publicAudiosDir)
    .filter(file => file.endsWith('.mp3'));

  for (const file of files) {
    try {
      const metadata = await mm.parseFile(
        path.join(publicAudiosDir, file)
      );

      playlist.push({
        name: file,
        duration: metadata.format.duration || 0
      });
    } catch {}
  }
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

io.on('connection', socket => {
  socket.emit('chat history', messages);

  socket.on('chat message', msg => {
    messages.push(msg);

    if (messages.length > 50) {
      messages.shift();
    }

    io.emit('chat message', msg);
  });
});

app.get('/status', (req, res) => {
  if (playlist.length === 0) {
    return res.json({});
  }

  const current = playlist[currentIndex];
  const elapsed = (Date.now() - startTime) / 1000;

  res.json({
    music: current.name,
    time: elapsed,
    duration: current.duration
  });
});

app.get('/playlist', (req, res) => {
  res.json(playlist);
});

app.get('/volume', (req, res) => {
  res.json({
    volume: globalVolume
  });
});

app.post('/volume', requireAdmin, (req, res) => {
  const { volume } = req.body;

  globalVolume = Math.max(0, Math.min(2, Number(volume)));

  io.emit('volumeUpdate', globalVolume);

  res.json({
    success: true
  });
});

app.get('/admin', (req, res) => {
  if (req.session?.isAdmin) {
    return res.redirect('/painel');
  }

  res.sendFile(
    path.join(__dirname, 'private', 'adminLogin.html')
  );
});

app.post('/admin', (req, res) => {
  const { password } = req.body;

  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;

    return req.session.save(err => {
      if (err) {
        return res.status(500).send('Erro ao salvar sessão');
      }

      return res.redirect('/painel');
    });
  }

  return res.redirect('/admin?erro=1');
});

app.post(
  '/upload',
  requireAdmin,
  upload.array('musics'),
  async (req, res) => {

    await loadAudios();

    currentIndex = 0;
    startTime = Date.now();

    io.emit('playlistUpdated');

    res.json({
      success: true
    });

  }
);

app.post('/speech', requireAdmin, (req, res) => {
  const { text } = req.body;

  io.emit('pauseMusic');
  io.emit('speech', text);

  res.json({
    success: true
  });
});

app.post(
  '/speech-audio',
  requireAdmin,
  audioUpload.single('audio'),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Nenhum áudio enviado'
      });
    }

    try {
      const audioBuffer = fs.readFileSync(req.file.path);

      io.emit('speechAudio', audioBuffer);

      return res.json({
        success: true
      });
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  }
);

app.get('/painel', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store');

  res.sendFile(
    path.join(__dirname, 'private', 'painelDeControle.html')
  );
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

app.use(express.static(path.join(__dirname, 'public')));

loadAudios().then(() => {

  currentIndex = 0;
  startTime = Date.now();

  server.listen(3000, () => {
    console.log('Servidor rodando em http://localhost:3000');
  });

});
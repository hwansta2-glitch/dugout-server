const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const jwt = require('jsonwebtoken');

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://voluble-snickerdoodle-794915.netlify.app',
];
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true }
});

app.use(express.json());
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS 차단: ' + origin));
  },
  credentials: true,
}));
app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: '/auth/google/callback',
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const user = await prisma.user.upsert({
      where: { email: profile.emails[0].value },
      update: { name: profile.displayName },
      create: { email: profile.emails[0].value, name: profile.displayName, team: 'LG' },
    });
    return done(null, user);
  } catch(e) { return done(e, null); }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await prisma.user.findUnique({ where: { id } });
  done(null, user);
});

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/failed' }),
  (req, res) => {
    const token = jwt.sign(
      { id: req.user.id, name: req.user.name, email: req.user.email, team: req.user.team },
      process.env.JWT_SECRET, { expiresIn: '7d' }
    );
    res.redirect(`${process.env.CLIENT_URL}/auth/callback?token=${token}`);
  }
);
app.get('/auth/failed', (req, res) => res.json({ success: false, message: '로그인 실패' }));
app.get('/auth/me', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: '토큰 없음' });
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ success: true, data: user });
  } catch(e) { res.status(401).json({ success: false, message: '토큰 만료' }); }
});

app.get('/', (req, res) => res.json({ message: '⚾ Dugout 서버 실행 중!', version: '2.0.0' }));

app.get('/api/posts', async (req, res) => {
  try {
    const { boardType } = req.query;
    const posts = await prisma.post.findMany({
      where: boardType ? { boardType } : {},
      include: { author: { select: { name: true, team: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: posts });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/posts', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: '로그인 필요' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { title, content, team, boardType } = req.body;
    const post = await prisma.post.create({
      data: { title, content: content || '', team: team || '', boardType: boardType || 'team', authorId: decoded.id },
      include: { author: { select: { name: true, team: true } } },
    });
    res.status(201).json({ success: true, data: post });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/posts/:id/like', async (req, res) => {
  try {
    const post = await prisma.post.update({
      where: { id: parseInt(req.params.id) },
      data: { likes: { increment: 1 } },
    });
    res.json({ success: true, data: post });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/users', async (req, res) => {
  try {
    const { email, name, team } = req.body;
    const user = await prisma.user.upsert({
      where: { email }, update: { name, team }, create: { email, name, team },
    });
    res.json({ success: true, data: user });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/users/:id/checkin', async (req, res) => {
  try {
    const user = await prisma.user.update({
      where: { id: parseInt(req.params.id) },
      data: { points: { increment: 50 } },
    });
    await prisma.pointLog.create({ data: { userId: user.id, amount: 50, reason: '출석체크' } });
    res.json({ success: true, data: user });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

io.on('connection', (socket) => {
  console.log('✅ 유저 접속: ' + socket.id);
  socket.on('join', async (roomId) => {
    socket.join(roomId);
    try {
      const messages = await prisma.chatMessage.findMany({
        where: { roomId },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      socket.emit('chat_history', messages);
    } catch(e) { console.log('채팅 기록 불러오기 실패:', e.message); }
  });
  socket.on('send_message', async (data) => {
    try {
      const { message, userId, roomId, userName } = data;
      let user = await prisma.user.findFirst({ where: { id: userId || 1 } });
      if (!user) {
        user = await prisma.user.create({
          data: { email: 'temp_' + Date.now() + '@dugout.app', name: userName || '익명', team: 'LG' }
        });
      }
      const newMsg = await prisma.chatMessage.create({
        data: { message, userId: user.id, roomId: roomId || 'general' },
        include: { user: { select: { name: true } } },
      });
      io.to(roomId || 'general').emit('receive_message', {
        id: newMsg.id, message: newMsg.message, userName: newMsg.user.name, createdAt: newMsg.createdAt,
      });
    } catch(e) {
      console.log('메시지 저장 실패:', e.message);
      socket.to(data.roomId || 'general').emit('receive_message', {
        id: Date.now(), message: data.message, userName: data.userName, createdAt: new Date(),
      });
    }
  });
  socket.on('reaction', (data) => {
    io.to(data.roomId || 'general').emit('receive_reaction', data);
  });
  socket.on('disconnect', () => console.log('❌ 유저 퇴장: ' + socket.id));
});
// 뉴스 (네이버 RSS)
const https = require('https');
app.get('/api/news', (req, res) => {
  const url = 'https://sports.news.naver.com/kbaseball/news/index?isphoto=N';
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => {
      // 제목, 링크 파싱
      const items = [];
      const regex = /<a[^>]+href="(\/kbaseball\/news\/read[^"]+)"[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/a>/g;
      let match;
      while ((match = regex.exec(data)) !== null && items.length < 20) {
        items.push({
          title: match[2].trim(),
          link: 'https://sports.news.naver.com' + match[1],
        });
      }
      res.json({ success: true, data: items });
    });
  }).on('error', (e) => {
    res.status(500).json({ success: false, message: e.message });
  });
});
server.listen(PORT, () => console.log('✅ Dugout 서버 실행 중: http://localhost:' + PORT));

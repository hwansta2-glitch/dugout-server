const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

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

// Cloudinary 설정
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'dugout/images', allowed_formats: ['jpg','jpeg','png','gif','webp'], transformation: [{ width:1200, crop:'limit' }] },
});
const videoStorage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'dugout/videos', resource_type: 'video', allowed_formats: ['mp4','mov','avi'] },
});
const uploadImage = multer({ storage: imageStorage, limits: { fileSize: 10*1024*1024 } });
const uploadVideo = multer({ storage: videoStorage, limits: { fileSize: 100*1024*1024 } });

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

app.get('/auth/me', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: '토큰 없음' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) return res.status(401).json({ success: false, message: '유저 없음' });
    res.json({ success: true, data: user });
  } catch(e) { res.status(401).json({ success: false, message: '토큰 만료' }); }
});

app.get('/', (req, res) => res.json({ message: '⚾ Dugout 서버 실행 중!', version: '2.0.0' }));

// 게시글 목록
app.get('/api/posts', async (req, res) => {
  try {
    const { boardType } = req.query;
    const posts = await prisma.post.findMany({
      where: boardType ? { boardType } : {},
      include: { author: { select: { name: true, team: true, nickname: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: posts });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// 게시글 작성
app.post('/api/posts', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: '로그인 필요' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { title, content, team, boardType, tag, imageUrl, videoUrl } = req.body;
    const post = await prisma.post.create({
      data: {
        title,
        content: content || '',
        team: team || '',
        boardType: boardType || 'team',
        tag: tag || '',
        imageUrl: imageUrl || null,
        videoUrl: videoUrl || null,
        authorId: decoded.id,
      },
      include: { author: { select: { name: true, team: true, nickname: true } } },
    });
    res.status(201).json({ success: true, data: post });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// 게시글 좋아요
app.post('/api/posts/:id/like', async (req, res) => {
  try {
    const post = await prisma.post.update({ where: { id: parseInt(req.params.id) }, data: { likes: { increment: 1 } } });
    res.json({ success: true, data: post });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// 게시글 비추천
app.post('/api/posts/:id/dislike', async (req, res) => {
  try {
    const post = await prisma.post.update({ where: { id: parseInt(req.params.id) }, data: { dislikes: { increment: 1 } } });
    res.json({ success: true, data: post });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// 게시글 삭제
app.delete('/api/posts/:id', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: '로그인 필요' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const post = await prisma.post.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!post) return res.status(404).json({ success: false, message: '게시글 없음' });
    if (post.authorId !== decoded.id) return res.status(403).json({ success: false, message: '본인 게시글만 삭제 가능' });
    await prisma.comment.deleteMany({ where: { postId: post.id } });
    await prisma.post.delete({ where: { id: post.id } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// 댓글 목록
app.get('/api/posts/:id/comments', async (req, res) => {
  try {
    const comments = await prisma.comment.findMany({
      where: { postId: parseInt(req.params.id) },
      include: { author: { select: { nickname: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: comments });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// 댓글 작성
app.post('/api/posts/:id/comments', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: '로그인 필요' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { content } = req.body;
    const comment = await prisma.comment.create({
      data: { content, authorId: decoded.id, postId: parseInt(req.params.id) },
      include: { author: { select: { nickname: true, name: true } } },
    });
    res.status(201).json({ success: true, data: comment });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// 댓글 추천/비추천
app.post('/api/comments/:id/like', async (req, res) => {
  try {
    const comment = await prisma.comment.update({ where: { id: parseInt(req.params.id) }, data: { likes: { increment: 1 } } });
    res.json({ success: true, data: comment });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});
app.post('/api/comments/:id/dislike', async (req, res) => {
  try {
    const comment = await prisma.comment.update({ where: { id: parseInt(req.params.id) }, data: { dislikes: { increment: 1 } } });
    res.json({ success: true, data: comment });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// 댓글 삭제
app.delete('/api/comments/:id', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: '로그인 필요' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const comment = await prisma.comment.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!comment) return res.status(404).json({ success: false, message: '댓글 없음' });
    if (comment.authorId !== decoded.id) return res.status(403).json({ success: false, message: '본인 댓글만 삭제 가능' });
    await prisma.comment.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// 유저 생성
app.post('/api/users', async (req, res) => {
  try {
    const { email, name, team } = req.body;
    const user = await prisma.user.upsert({ where: { email }, update: { name, team }, create: { email, name, team } });
    res.json({ success: true, data: user });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// 출석체크
app.post('/api/users/:id/checkin', async (req, res) => {
  try {
    const user = await prisma.user.update({ where: { id: parseInt(req.params.id) }, data: { points: { increment: 50 } } });
    await prisma.pointLog.create({ data: { userId: user.id, amount: 50, reason: '출석체크' } });
    res.json({ success: true, data: user });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// 닉네임 설정
app.post('/api/users/:id/nickname', async (req, res) => {
  try {
    const { nickname } = req.body;
    const valid = /^[a-zA-Z0-9가-힣]{2,8}$/.test(nickname);
    if (!valid) return res.status(400).json({ success: false, message: '닉네임은 2~8글자 한영숫자만 가능합니다' });
    const exists = await prisma.user.findFirst({ where: { nickname } });
    if (exists) return res.status(400).json({ success: false, message: '이미 사용 중인 닉네임입니다' });
    const user = await prisma.user.findUnique({ where: { id: parseInt(req.params.id) } });
    if (user.nicknameChangedAt) {
      const diff = Date.now() - new Date(user.nicknameChangedAt).getTime();
      const days = diff / (1000 * 60 * 60 * 24);
      if (days < 7) {
        const remaining = Math.ceil(7 - days);
        return res.status(400).json({ success: false, message: `닉네임 변경은 ${remaining}일 후 가능합니다` });
      }
    }
    const updated = await prisma.user.update({
      where: { id: parseInt(req.params.id) },
      data: { nickname, nicknameChangedAt: new Date() },
    });
    res.json({ success: true, data: updated });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// 게시글 검색
app.get('/api/search', async (req, res) => {
  try {
    const { q, boardType } = req.query;
    if (!q) return res.json({ success: true, data: [] });
    const posts = await prisma.post.findMany({
      where: {
        AND: [
          boardType ? { boardType } : {},
          { OR: [{ title: { contains: q, mode: 'insensitive' } }, { content: { contains: q, mode: 'insensitive' } }] },
        ],
      },
      include: { author: { select: { name: true, nickname: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    res.json({ success: true, data: posts });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// 뉴스
app.get('/api/news', (req, res) => {
  const url = 'https://sports.news.naver.com/kbaseball/news/index?isphoto=N';
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => {
      const items = [];
      const regex = /<a[^>]+href="(\/kbaseball\/news\/read[^"]+)"[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/a>/g;
      let match;
      while ((match = regex.exec(data)) !== null && items.length < 20) {
        items.push({ title: match[2].trim(), link: 'https://sports.news.naver.com' + match[1] });
      }
      res.json({ success: true, data: items });
    });
  }).on('error', (e) => res.status(500).json({ success: false, message: e.message }));
});

// KBO 경기 데이터
app.get('/api/kbo/games', (req, res) => {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const url = `https://sports.news.naver.com/kbaseball/schedule/index?date=${yyyy}${mm}${dd}`;
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => {
      try {
        const games = [];
        const regex = /class="team_lft"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>[\s\S]*?class="score[^"]*"[^>]*>([\d]+)<[\s\S]*?class="score[^"]*"[^>]*>([\d]+)<[\s\S]*?class="team_rgt"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/g;
        let match;
        while ((match = regex.exec(data)) !== null) {
          games.push({ awayTeam: match[1].trim(), awayScore: match[2], homeScore: match[3], homeTeam: match[4].trim(), date: `${yyyy}-${mm}-${dd}` });
        }
        res.json({ success: true, data: games, date: `${yyyy}-${mm}-${dd}` });
      } catch(e) { res.status(500).json({ success: false, message: e.message }); }
    });
  }).on('error', (e) => res.status(500).json({ success: false, message: e.message }));
});

// 이미지 업로드
app.post('/api/upload/image', uploadImage.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '파일 없음' });
    res.json({ success: true, url: req.file.path });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// 동영상 업로드
app.post('/api/upload/video', uploadVideo.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '파일 없음' });
    res.json({ success: true, url: req.file.path });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// Socket.io 채팅
io.on('connection', (socket) => {
  console.log('유저 접속: ' + socket.id);
  socket.on('join', async (roomId) => {
    socket.join(roomId);
    try {
      const messages = await prisma.chatMessage.findMany({
        where: { roomId },
        include: { user: { select: { name: true, nickname: true } } },
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
        include: { user: { select: { name: true, nickname: true } } },
      });
      io.to(roomId || 'general').emit('receive_message', {
        id: newMsg.id, message: newMsg.message,
        userName: newMsg.user.nickname || newMsg.user.name,
        createdAt: newMsg.createdAt,
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
  socket.on('disconnect', () => console.log('유저 퇴장: ' + socket.id));
});

// 야구 뉴스
app.get('/api/sports/news', (req, res) => {
  const url = 'https://sports.daum.net/baseball';
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15', 'Referer': 'https://sports.daum.net' } }, (response) => {
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => {
      const items = [];
      const regex = /class="tit_feed"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
      let match;
      while ((match = regex.exec(data)) !== null && items.length < 15) {
        items.push({ title: match[2].trim(), link: match[1] });
      }
      if (items.length === 0) {
        const r2 = /"title":"([^"]{10,100})","(?:pcLink|mLink|link)":"(https:\/\/[^"]+)"/g;
        while ((match = r2.exec(data)) !== null && items.length < 15) {
          if (match[1].includes('KBO') || match[1].includes('야구') || match[1].includes('KIA') || match[1].includes('LG') || match[1].includes('롯데') || match[1].includes('한화') || match[1].includes('삼성') || match[1].includes('두산') || match[1].includes('NC') || match[1].includes('SSG') || match[1].includes('키움') || match[1].includes('KT')) {
            items.push({ title: match[1], link: match[2] });
          }
        }
      }
      res.json({ success: true, data: items });
    });
  }).on('error', (e) => res.status(500).json({ success: false, message: e.message }));
});

// 야구 뉴스

server.listen(PORT, () => console.log('Dugout 서버 실행 중: http://localhost:' + PORT));
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// ── 서버 상태 확인 ─────────────────────────────────
app.get('/', (req, res) => {
  res.json({ message: '⚾ Dugout 서버 정상 작동 중!', version: '2.0.0' });
});

// ── 게시글 API ──────────────────────────────────────

// 게시글 목록
app.get('/api/posts', async (req, res) => {
  try {
    const { boardType } = req.query;
    const posts = await prisma.post.findMany({
      where: boardType ? { boardType } : {},
      include: { author: { select: { name:true, team:true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success:true, data:posts });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
});

// 게시글 작성
app.post('/api/posts', async (req, res) => {
  try {
    const { title, content, team, boardType, authorId } = req.body;
    const post = await prisma.post.create({
      data: { title, content, team, boardType: boardType||'team', authorId },
      include: { author: { select: { name:true, team:true } } },
    });
    res.status(201).json({ success:true, data:post });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
});

// 게시글 좋아요
app.post('/api/posts/:id/like', async (req, res) => {
  try {
    const post = await prisma.post.update({
      where: { id: parseInt(req.params.id) },
      data: { likes: { increment: 1 } },
    });
    res.json({ success:true, data:post });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
});

// ── 채팅 API ────────────────────────────────────────

// 채팅 메시지 목록
app.get('/api/chat', async (req, res) => {
  try {
    const messages = await prisma.chatMessage.findMany({
      include: { user: { select: { name:true } } },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    res.json({ success:true, data:messages });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
});

// 채팅 메시지 전송
app.post('/api/chat', async (req, res) => {
  try {
    const { message, userId } = req.body;
    const newMsg = await prisma.chatMessage.create({
      data: { message, userId },
      include: { user: { select: { name:true } } },
    });
    res.status(201).json({ success:true, data:newMsg });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
});

// ── 유저 API ────────────────────────────────────────

// 유저 생성 (회원가입)
app.post('/api/users', async (req, res) => {
  try {
    const { email, name, team } = req.body;
    const user = await prisma.user.upsert({
      where: { email },
      update: { name, team },
      create: { email, name, team },
    });
    res.json({ success:true, data:user });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
});

// 유저 정보 조회
app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: parseInt(req.params.id) },
    });
    if (!user) return res.status(404).json({ success:false, message:'유저 없음' });
    res.json({ success:true, data:user });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
});

// 출석체크 포인트
app.post('/api/users/:id/checkin', async (req, res) => {
  try {
    const user = await prisma.user.update({
      where: { id: parseInt(req.params.id) },
      data: { points: { increment: 50 } },
    });
    await prisma.pointLog.create({
      data: { userId: user.id, amount:50, reason:'출석체크' }
    });
    res.json({ success:true, data:user });
  } catch(e) {
    res.status(500).json({ success:false, message:e.message });
  }
});

// ── 서버 시작 ───────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Dugout 서버 실행 중: http://localhost:${PORT}`);
})
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import next from 'next';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { promisify } from 'util';

// promisify crypto.scrypt — the overload that returns Buffer
const scryptAsync = promisify<string | Buffer, string | Buffer, number, Buffer>(
  crypto.scrypt as (password: string | Buffer, salt: string | Buffer, keylen: number, cb: (err: Error | null, derivedKey: Buffer) => void) => void
);

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const nextApp = next({ dev, hostname, port });
const handle = nextApp.getRequestHandler();

const DATA_FILE = path.join(process.cwd(), 'board-data.json');

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserRecord {
  id: string;
  username: string;    // lowercase, for lookup
  displayName: string; // original case as entered
  passwordHash: string;
  salt: string;
  createdAt: string;
}

interface BoardMember {
  role: 'dm' | 'player';
  joinedAt: string;
}

interface BoardRecord {
  dmPasswordHash: string;
  dmPasswordSalt: string;
  boardPasswordHash?: string;
  boardPasswordSalt?: string;
  members: Record<string, BoardMember>;
  tabs: any[];
}

interface AppState {
  users: Record<string, UserRecord>;
  sessions: Record<string, { userId: string; createdAt: string }>;
  boards: Record<string, BoardRecord>;
}

let state: AppState = {
  users: {},
  sessions: {},
  boards: {},
};

// ─── Data Persistence ─────────────────────────────────────────────────────────

async function loadData() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    if (data && data.trim()) {
      const parsed = JSON.parse(data);
      state = {
        users: parsed.users || {},
        sessions: parsed.sessions || {},
        boards: parsed.boards || {},
      };
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      console.error('Error reading data file:', err);
    }
  }
}

async function saveData() {
  try {
    await fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('Error saving data file:', err);
  }
}

// ─── Auth Helpers ─────────────────────────────────────────────────────────────

async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64);
  return { hash: derived.toString('hex'), salt };
}

async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const derived = await scryptAsync(password, salt, 64);
  return derived.toString('hex') === hash;
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function getAuthUser(req: express.Request): UserRecord | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const session = state.sessions[token];
  if (!session) return null;
  return state.users[session.userId] || null;
}

function requireAuth(req: express.Request, res: express.Response): UserRecord | null {
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return user;
}

// ─── Main Server ──────────────────────────────────────────────────────────────

nextApp.prepare().then(async () => {
  await loadData();

  const server = express();
  server.use(express.json({ limit: '100mb' }));
  server.use(express.urlencoded({ limit: '100mb', extended: true }));

  const httpServer = createServer(server);
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    maxHttpBufferSize: 1e8,
  });

  // ─── Socket.IO (real-time board sync) ──────────────────────────────────────

  io.on('connection', (socket) => {
    let currentUser: { id: string; username: string; role: string; boardId: string } | null = null;

    socket.on('join_board', ({ boardId, sessionToken }: { boardId: string; sessionToken: string }) => {
      try {
        const session = state.sessions[sessionToken];
        if (!session) { socket.emit('board_error', 'Invalid session'); return; }
        const user = state.users[session.userId];
        if (!user) { socket.emit('board_error', 'User not found'); return; }
        const board = state.boards[boardId];
        if (!board) { socket.emit('board_error', 'Board not found'); return; }
        const member = board.members[user.id];
        if (!member) { socket.emit('board_error', 'Not a board member'); return; }

        currentUser = { id: user.id, username: user.displayName, role: member.role, boardId };
        socket.join(boardId);
        socket.to(boardId).emit('user_joined', { id: user.id, username: user.displayName, role: member.role });
      } catch (err) {
        console.error('Error in join_board:', err);
      }
    });

    socket.on('update_board', (data: { tabs: any[] }) => {
      try {
        if (!currentUser) return;
        const board = state.boards[currentUser.boardId];
        if (!board || !board.members[currentUser.id]) return;
        board.tabs = data.tabs || [];
        saveData();
        socket.to(currentUser.boardId).emit('board_update', { tabs: board.tabs });
      } catch (err) {
        console.error('Error in update_board:', err);
      }
    });

    socket.on('disconnect', () => {
      if (currentUser) {
        socket.to(currentUser.boardId).emit('user_left', currentUser.id);
      }
    });
  });

  // ─── Auth Routes ───────────────────────────────────────────────────────────

  /** POST /api/auth/register  —  Create a new account */
  server.post('/api/auth/register', async (req, res) => {
    try {
      const { username, password } = req.body as { username?: string; password?: string };
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
      }
      if (username.trim().length < 2 || username.trim().length > 32) {
        return res.status(400).json({ error: 'Username must be 2–32 characters.' });
      }
      if (!/^[a-zA-Z0-9_\- ]+$/.test(username)) {
        return res.status(400).json({ error: 'Username may only contain letters, numbers, spaces, hyphens, and underscores.' });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      }

      const lowerUsername = username.trim().toLowerCase();
      const taken = Object.values(state.users).some(u => u.username === lowerUsername);
      if (taken) {
        return res.status(409).json({ error: 'That username is already taken.' });
      }

      const { hash, salt } = await hashPassword(password);
      const userId = crypto.randomUUID();
      state.users[userId] = {
        id: userId,
        username: lowerUsername,
        displayName: username.trim(),
        passwordHash: hash,
        salt,
        createdAt: new Date().toISOString(),
      };

      const sessionToken = generateToken();
      state.sessions[sessionToken] = { userId, createdAt: new Date().toISOString() };
      await saveData();

      res.json({
        sessionToken,
        user: { id: userId, username: lowerUsername, displayName: username.trim() },
      });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  /** POST /api/auth/login  —  Authenticate and get a session token */
  server.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body as { username?: string; password?: string };
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
      }

      const lowerUsername = username.trim().toLowerCase();
      const user = Object.values(state.users).find(u => u.username === lowerUsername);
      if (!user) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      const valid = await verifyPassword(password, user.passwordHash, user.salt);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      const sessionToken = generateToken();
      state.sessions[sessionToken] = { userId: user.id, createdAt: new Date().toISOString() };
      await saveData();

      res.json({
        sessionToken,
        user: { id: user.id, username: user.username, displayName: user.displayName },
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  /** POST /api/auth/logout  —  Invalidate session */
  server.post('/api/auth/logout', (req, res) => {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      delete state.sessions[auth.slice(7)];
      saveData();
    }
    res.json({ success: true });
  });

  /** POST /api/auth/change-password  —  Update account password */
  server.post('/api/auth/change-password', async (req, res) => {
    try {
      const user = requireAuth(req, res);
      if (!user) return;

      const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string };
      if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: 'Current password and new password are required.' });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
      }

      const isValid = await verifyPassword(oldPassword, user.passwordHash, user.salt);
      if (!isValid) {
        return res.status(401).json({ error: 'Incorrect current password.' });
      }

      const { hash, salt } = await hashPassword(newPassword);
      user.passwordHash = hash;
      user.salt = salt;
      await saveData();

      res.json({ success: true, message: 'Password successfully updated.' });
    } catch (err) {
      console.error('Change password error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  /** GET /api/auth/me  —  Validate session and return user info */
  server.get('/api/auth/me', (req, res) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    res.json({ user: { id: user.id, username: user.username, displayName: user.displayName } });
  });

  /** GET /api/auth/my-boards  —  List all boards the user belongs to */
  server.get('/api/auth/my-boards', (req, res) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const boards = Object.entries(state.boards)
      .filter(([, board]) => board.members && board.members[user.id])
      .map(([boardId, board]) => ({
        boardId,
        role: board.members[user.id].role,
        joinedAt: board.members[user.id].joinedAt,
      }));

    res.json({ boards });
  });

  // ─── Board Routes ──────────────────────────────────────────────────────────

  /** GET /api/boards/:id  —  Public check: does this board exist? */
  server.get('/api/boards/:id', (req, res) => {
    const board = state.boards[req.params.id];
    if (board) {
      res.json({ exists: true, requiresBoardPassword: !!board.boardPasswordHash });
    } else {
      res.json({ exists: false });
    }
  });

  /** POST /api/boards  —  Create a board (auth required; creator becomes DM by account) */
  server.post('/api/boards', async (req, res) => {
    try {
      const user = requireAuth(req, res);
      if (!user) return;

      const { boardId, boardPassword } = req.body as {
        boardId?: string; boardPassword?: string;
      };

      if (!boardId) {
        return res.status(400).json({ error: 'Board ID is required.' });
      }
      const cleanId = boardId.trim().toLowerCase();
      if (!/^[a-z0-9-]+$/.test(cleanId) || cleanId.length < 2 || cleanId.length > 48) {
        return res.status(400).json({ error: 'Board ID must be 2–48 lowercase letters, numbers, or hyphens.' });
      }
      if (state.boards[cleanId]) {
        return res.status(409).json({ error: 'A board with that ID already exists.' });
      }

      const newBoard: BoardRecord = {
        dmPasswordHash: '',
        dmPasswordSalt: '',
        members: { [user.id]: { role: 'dm', joinedAt: new Date().toISOString() } },
        tabs: [{ id: 'default-tab', name: 'Main Board', color: '#3B82F6', items: [], connections: [] }],
      };

      if (boardPassword && boardPassword.trim()) {
        const bPass = await hashPassword(boardPassword);
        newBoard.boardPasswordHash = bPass.hash;
        newBoard.boardPasswordSalt = bPass.salt;
      }

      state.boards[cleanId] = newBoard;
      await saveData();

      res.json({ success: true, boardId: cleanId, role: 'dm' });
    } catch (err) {
      console.error('Create board error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  /** POST /api/boards/:id/join  —  Join a board as player (auth required) */
  server.post('/api/boards/:id/join', async (req, res) => {
    try {
      const user = requireAuth(req, res);
      if (!user) return;

      const board = state.boards[req.params.id];
      if (!board) return res.status(404).json({ error: 'Board not found.' });

      // Already a DM — cannot downgrade to player
      const existing = board.members[user.id];
      if (existing?.role === 'dm') {
        return res.status(400).json({ error: 'You are already the Dungeon Master of this board.' });
      }

      // Already a player — no-op
      if (existing?.role === 'player') {
        return res.json({ success: true, role: 'player' });
      }

      if (board.boardPasswordHash) {
        const { boardPassword } = req.body as { boardPassword?: string };
        if (!boardPassword) {
          return res.status(401).json({ error: 'This board requires a join password.', requiresPassword: true });
        }
        const valid = await verifyPassword(boardPassword, board.boardPasswordHash, board.boardPasswordSalt!);
        if (!valid) {
          return res.status(401).json({ error: 'Incorrect board password.' });
        }
      }

      board.members[user.id] = { role: 'player', joinedAt: new Date().toISOString() };
      await saveData();
      res.json({ success: true, role: 'player' });
    } catch (err) {
      console.error('Join board error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // /api/boards/:id/join-as-dm removed — DM role is now determined by board creation account, not password

  /** GET /api/boards/:id/state  —  Load board state (auth + membership required) */
  server.get('/api/boards/:id/state', (req, res) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const board = state.boards[req.params.id];
    if (!board) return res.status(404).json({ error: 'Board not found.' });

    const member = board.members[user.id];
    if (!member) return res.status(403).json({ error: 'You are not a member of this board.' });

    res.json({
      userId: user.id,
      username: user.displayName,
      role: member.role,
      tabs: board.tabs || [],
    });
  });

  /** POST /api/boards/:id/state  —  Save board state (auth + membership required) */
  server.post('/api/boards/:id/state', async (req, res) => {
    try {
      const user = getAuthUser(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const board = state.boards[req.params.id];
      if (!board) return res.status(404).json({ error: 'Board not found.' });

      const member = board.members[user.id];
      if (!member) return res.status(403).json({ error: 'You are not a member of this board.' });

      const { tabs } = req.body as { tabs?: any[] };
      if (tabs) board.tabs = tabs;
      await saveData();

      // Broadcast to other connected clients on this board
      io.to(req.params.id).emit('board_update', { tabs: board.tabs });

      res.json({ success: true });
    } catch (err) {
      console.error('Save board state error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  /** GET /api/boards/:id/members  —  List all members of a board */
  server.get('/api/boards/:id/members', (req, res) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const board = state.boards[req.params.id];
    if (!board) return res.status(404).json({ error: 'Board not found.' });

    const member = board.members[user.id];
    if (!member) return res.status(403).json({ error: 'You are not a member of this board.' });

    const membersList = Object.entries(board.members).map(([mId, m]) => {
      const u = state.users[mId];
      return {
        id: mId,
        displayName: u?.displayName || 'Unknown User',
        username: u?.username || '',
        role: m.role,
        joinedAt: m.joinedAt,
      };
    });

    res.json({ members: membersList });
  });

  /** DELETE /api/boards/:id/members/:targetUserId  —  Remove player from board (DM only) */
  server.delete('/api/boards/:id/members/:targetUserId', async (req, res) => {
    try {
      const user = requireAuth(req, res);
      if (!user) return;

      const { id: boardId, targetUserId } = req.params;
      const board = state.boards[boardId];
      if (!board) return res.status(404).json({ error: 'Board not found.' });

      const callerMember = board.members[user.id];
      if (!callerMember || callerMember.role !== 'dm') {
        return res.status(403).json({ error: 'Only a Dungeon Master can manage board members.' });
      }

      if (!board.members[targetUserId]) {
        return res.status(404).json({ error: 'Target user is not a member of this board.' });
      }

      if (targetUserId === user.id) {
        return res.status(400).json({ error: 'Dungeon Master cannot remove themselves.' });
      }

      delete board.members[targetUserId];
      await saveData();

      // Emit real-time kick event to connected clients
      io.to(boardId).emit('member_kicked', { targetUserId, boardId });

      res.json({ success: true, message: 'Member removed successfully.' });
    } catch (err) {
      console.error('Remove member error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // ─── Next.js fallthrough ───────────────────────────────────────────────────
  server.use((req: express.Request, res: express.Response) => {
    return handle(req, res);
  });

  httpServer.listen(port, (err?: any) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});

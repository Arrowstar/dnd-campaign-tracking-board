import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import next from 'next';
import fs from 'fs/promises';
import path from 'path';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const DATA_FILE = path.join(process.cwd(), 'board-data.json');

// Default initial state
let state: { boards: Record<string, any> } = {
  boards: {}
};

async function loadData() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    if (data && data.trim()) {
      state = JSON.parse(data);
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

app.prepare().then(async () => {
  await loadData();

  const server = express();
  server.use(express.json({ limit: '100mb' }));
  server.use(express.urlencoded({ limit: '100mb', extended: true }));
  const httpServer = createServer(server);
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    maxHttpBufferSize: 1e8 // 100 MB payload limit for high-res images
  });

  io.on('connection', (socket) => {
    let currentUser: { id: string; name: string; role: string; boardId: string } | null = null;

    socket.on('join_board', (user) => {
      try {
        if (!user || !user.boardId) return;
        currentUser = user;
        
        if (!state.boards[user.boardId]) {
           socket.emit('board_error', 'Board does not exist');
           return;
        }

        socket.join(user.boardId);
        
        // Ensure tabs exist for legacy boards
        if (!state.boards[user.boardId].tabs || !Array.isArray(state.boards[user.boardId].tabs) || state.boards[user.boardId].tabs.length === 0) {
          const oldItems = state.boards[user.boardId].items || [];
          const oldConnections = state.boards[user.boardId].connections || [];
          state.boards[user.boardId].tabs = [
            { id: 'default-tab', name: 'Main Board', color: '#3B82F6', items: oldItems, connections: oldConnections }
          ];
        }
        
        socket.emit('board_state', state.boards[user.boardId]);
        socket.to(user.boardId).emit('user_joined', user);
      } catch (err) {
        console.error('Error in join_board event:', err);
      }
    });

    socket.on('update_board', (data) => {
      try {
        if (!currentUser || !currentUser.boardId) return;
        const board = state.boards[currentUser.boardId];
        state.boards[currentUser.boardId] = {
          ...data,
          ownerId: board?.ownerId // preserve ownerId
        };
        saveData();
        socket.to(currentUser.boardId).emit('board_update', state.boards[currentUser.boardId]);
      } catch (err) {
        console.error('Error in update_board event:', err);
      }
    });

    socket.on('disconnect', () => {
      if (currentUser) {
        socket.to(currentUser.boardId).emit('user_left', currentUser.id);
      }
    });
  });

  server.get('/api/boards/:id', (req, res) => {
    const board = state.boards[req.params.id];
    if (board) {
      res.json({ exists: true, ownerId: board.ownerId, requiresBoardPassword: !!board.boardPassword });
    } else {
      res.json({ exists: false });
    }
  });

  server.post('/api/boards', (req, res) => {
    const { boardId, ownerId, ownerName, password, boardPassword } = req.body;
    if (!boardId || !ownerId || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (state.boards[boardId]) {
      return res.status(400).json({ error: 'Board already exists.' });
    }
    state.boards[boardId] = {
      ownerId,
      ownerName,
      password,
      boardPassword,
      tabs: [
        { id: 'default-tab', name: 'Main Board', color: '#3B82F6', items: [], connections: [] }
      ]
    };
    saveData();
    res.json({ success: true });
  });

  server.post('/api/boards/:id/verify-board', (req, res) => {
    const board = state.boards[req.params.id];
    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }
    const { boardPassword } = req.body;
    if (board.boardPassword && board.boardPassword !== boardPassword) {
      return res.status(401).json({ error: 'Incorrect Board password' });
    }
    res.json({ success: true });
  });

  server.post('/api/boards/:id/verify-dm', (req, res) => {
    const board = state.boards[req.params.id];
    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }
    const { password, userId } = req.body;
    // If the board has no password (legacy), we can either allow claiming or reject. 
    // Let's reject if password doesn't match to be safe, or allow if it matches exactly.
    if (board.password && board.password === password) {
      board.ownerId = userId; // Update ownerId to the new session
      saveData();
      res.json({ success: true });
    } else {
      res.status(401).json({ error: 'Incorrect DM password' });
    }
  });

  server.use((req: express.Request, res: express.Response) => {
    return handle(req, res);
  });

  httpServer.listen(port, (err?: any) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});

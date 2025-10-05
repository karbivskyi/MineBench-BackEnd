import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import { PrismaClient } from '@prisma/client';
import userRoutes from './routes/users.js';
import miningRoutes from './routes/mining.js';
import benchmarkRoutes from './routes/benchmark.js';
import walletRoutes from './routes/wallet.js';
import { setupWebSocket } from './websocket/index.js';
import { startRewardDistribution } from './services/rewardService.js';

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const prisma = new PrismaClient();

const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/users', userRoutes);
app.use('/api/mining', miningRoutes);
app.use('/api/benchmark', benchmarkRoutes);
app.use('/api/wallet', walletRoutes);

// WebSocket setup
setupWebSocket(wss, prisma);

// Start reward distribution cron job
startRewardDistribution(prisma);

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 WebSocket server running`);
  console.log(`💰 Reward distribution service started`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await prisma.$disconnect();
  server.close();
  process.exit(0);
});
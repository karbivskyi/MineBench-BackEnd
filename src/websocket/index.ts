import { WebSocketServer, WebSocket } from 'ws';
import { PrismaClient } from '@prisma/client';

interface ClientMessage {
  type: string;
  payload: any;
}

interface MiningStats {
  userId: string;
  sessionId: string;
  hashRate: number;
  temperature: number;
  power: number;
}

export function setupWebSocket(wss: WebSocketServer, prisma: PrismaClient) {
  console.log('Setting up WebSocket server...');

  wss.on('connection', (ws: WebSocket) => {
    console.log('New WebSocket connection');

    ws.on('message', async (data: Buffer) => {
      try {
        const message: ClientMessage = JSON.parse(data.toString());
        await handleMessage(ws, message, prisma);
      } catch (error) {
        console.error('WebSocket message error:', error);
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: 'Invalid message format' }
        }));
      }
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      payload: { message: 'Connected to mining server' }
    }));
  });
}

async function handleMessage(ws: WebSocket, message: ClientMessage, prisma: PrismaClient) {
  switch (message.type) {
    case 'mining_stats':
      await handleMiningStats(ws, message.payload, prisma);
      break;
    
    case 'benchmark_progress':
      await handleBenchmarkProgress(ws, message.payload);
      break;
    
    case 'subscribe_leaderboard':
      await handleLeaderboardSubscription(ws, prisma);
      break;
    
    default:
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Unknown message type' }
      }));
  }
}

async function handleMiningStats(ws: WebSocket, stats: MiningStats, prisma: PrismaClient) {
  try {
    // Update mining record with real-time stats
    await prisma.miningRecord.updateMany({
      where: { sessionId: stats.sessionId },
      data: {
        hashRate: stats.hashRate
      }
    });

    // Broadcast stats to all connected clients
    ws.send(JSON.stringify({
      type: 'mining_stats_updated',
      payload: stats
    }));
  } catch (error) {
    console.error('Mining stats update error:', error);
  }
}

async function handleBenchmarkProgress(ws: WebSocket, progress: any) {
  // Send benchmark progress updates
  ws.send(JSON.stringify({
    type: 'benchmark_progress',
    payload: progress
  }));
}

async function handleLeaderboardSubscription(ws: WebSocket, prisma: PrismaClient) {
  try {
    // Send current leaderboard
    const leaderboard = await prisma.benchmarkResult.findMany({
      orderBy: { score: 'desc' },
      take: 10,
      include: {
        user: {
          select: {
            walletAddress: true,
            username: true
          }
        }
      }
    });

    ws.send(JSON.stringify({
      type: 'leaderboard_update',
      payload: { leaderboard }
    }));
  } catch (error) {
    console.error('Leaderboard subscription error:', error);
  }
}
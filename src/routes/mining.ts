import express from 'express';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

// Start mining session
router.post('/start', async (req, res) => {
  try {
    const { userId, algorithm, difficulty, gpuInfo } = req.body;

    const sessionId = `mining_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const miningRecord = await prisma.miningRecord.create({
      data: {
        userId,
        sessionId,
        startTime: new Date(),
        algorithm: algorithm || 'NEXA',
        difficulty: difficulty || 'medium',
        hashRate: 0,
        gpuInfo
      }
    });

    res.json({ sessionId, recordId: miningRecord.id });
  } catch (error) {
    console.error('Mining start error:', error);
    res.status(500).json({ error: 'Failed to start mining session' });
  }
});

// Update mining session
router.put('/update/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { hashRate, duration } = req.body;

    const miningRecord = await prisma.miningRecord.findUnique({
      where: { sessionId }
    });

    if (!miningRecord) {
      return res.status(404).json({ error: 'Mining session not found' });
    }

    // Calculate rewards based on hash rate and duration
    const coinsEarned = calculateMiningReward(hashRate, duration);
    const tokensEarned = coinsEarned * parseFloat(process.env.MINING_REWARD_RATE || '1.0');

    // Only calculate incremental rewards (difference from previous)
    const previousCoinsEarned = parseFloat(miningRecord.coinsEarned.toString()) || 0;
    const previousTokensEarned = parseFloat(miningRecord.tokensEarned.toString()) || 0;
    
    const newCoinsEarned = coinsEarned - previousCoinsEarned;
    const newTokensEarned = tokensEarned - previousTokensEarned;

    const updated = await prisma.miningRecord.update({
      where: { sessionId },
      data: {
        hashRate,
        duration,
        coinsEarned,
        tokensEarned
      }
    });

    // Update user's total stats (only add new earnings since last update)
    if (newCoinsEarned > 0 || newTokensEarned > 0) {
      await prisma.user.update({
        where: { id: miningRecord.userId },
        data: {
          totalHashRate: hashRate, // Set current hashrate
          totalMined: { increment: newCoinsEarned },
          virtualBalance: { increment: newTokensEarned },
          lastActive: new Date()
        }
      });
    } else {
      // Just update hashrate and last active
      await prisma.user.update({
        where: { id: miningRecord.userId },
        data: {
          totalHashRate: hashRate,
          lastActive: new Date()
        }
      });
    }

    res.json({ success: true, tokensEarned, coinsEarned });
  } catch (error) {
    console.error('Mining update error:', error);
    res.status(500).json({ error: 'Failed to update mining session' });
  }
});

// Stop mining session
router.post('/stop/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const miningRecord = await prisma.miningRecord.findUnique({
      where: { sessionId }
    });

    if (!miningRecord) {
      return res.status(404).json({ error: 'Mining session not found' });
    }

    const endTime = new Date();
    const duration = Math.floor((endTime.getTime() - miningRecord.startTime.getTime()) / 1000);

    const updated = await prisma.miningRecord.update({
      where: { sessionId },
      data: {
        endTime,
        duration
      }
    });

    res.json({ success: true, duration, finalReward: updated.tokensEarned });
  } catch (error) {
    console.error('Mining stop error:', error);
    res.status(500).json({ error: 'Failed to stop mining session' });
  }
});

// Get mining history
router.get('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const records = await prisma.miningRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit as string),
      include: {
        user: {
          select: {
            walletAddress: true,
            username: true
          }
        }
      }
    });

    const total = await prisma.miningRecord.count({
      where: { userId }
    });

    res.json({
      records,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        pages: Math.ceil(total / parseInt(limit as string))
      }
    });
  } catch (error) {
    console.error('Mining history error:', error);
    res.status(500).json({ error: 'Failed to fetch mining history' });
  }
});

// Get mining leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const topMiners = await prisma.user.findMany({
      orderBy: { totalMined: 'desc' },
      take: 100,
      select: {
        id: true,
        walletAddress: true,
        username: true,
        totalMined: true,
        totalHashRate: true,
        lastActive: true
      }
    });

    res.json({ leaderboard: topMiners });
  } catch (error) {
    console.error('Mining leaderboard error:', error);
    res.status(500).json({ error: 'Failed to fetch mining leaderboard' });
  }
});

// Helper function to calculate mining reward
function calculateMiningReward(hashRate: number, duration: number): number {
  // Simple reward calculation: hashRate * duration * difficulty multiplier
  const baseReward = (hashRate * duration) / 1000000; // Convert to reasonable units
  return Math.max(baseReward, 0.001); // Minimum reward
}

export default router;
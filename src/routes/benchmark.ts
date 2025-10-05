import express from 'express';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

// Submit benchmark result
router.post('/submit', async (req, res) => {
  try {
    const {
      userId,
      duration,
      hashRate,
      difficulty,
      algorithm,
      score,
      gpuInfo
    } = req.body;

    // Validate required fields
    if (!userId || !duration || !hashRate || !difficulty || !algorithm || score === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate numeric values
    if (duration <= 0 || hashRate <= 0 || score < 0) {
      return res.status(400).json({ error: 'Invalid numeric values' });
    }

    // Validate algorithm
    const validAlgorithms = ['sha256', 'scrypt', 'x11'];
    if (!validAlgorithms.includes(algorithm.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid algorithm' });
    }

    // Validate difficulty
    const validDifficulties = ['easy', 'medium', 'hard'];
    if (!validDifficulties.includes(difficulty.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid difficulty' });
    }

    // Calculate token reward based on benchmark performance
    const tokensEarned = calculateBenchmarkReward(score, duration, difficulty);

    const benchmarkResult = await prisma.benchmarkResult.create({
      data: {
        userId,
        duration,
        hashRate,
        difficulty,
        algorithm,
        score,
        tokensEarned,
        gpuInfo
      }
    });

    // Update user's virtual balance
    await prisma.user.update({
      where: { id: userId },
      data: {
        virtualBalance: { increment: tokensEarned },
        lastActive: new Date()
      }
    });

    res.json({
      success: true,
      benchmarkId: benchmarkResult.id,
      tokensEarned,
      score
    });
  } catch (error) {
    console.error('Benchmark submit error:', error);
    res.status(500).json({ error: 'Failed to submit benchmark result' });
  }
});

// Get benchmark leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const { algorithm, difficulty, period = '24h' } = req.query;

    // Calculate time filter
    const timeFilter = getTimeFilter(period as string);

    const whereClause: any = {};
    if (algorithm) whereClause.algorithm = algorithm;
    if (difficulty) whereClause.difficulty = difficulty;
    if (timeFilter) whereClause.timestamp = { gte: timeFilter };

    const results = await prisma.benchmarkResult.findMany({
      where: whereClause,
      orderBy: { score: 'desc' },
      take: 100,
      include: {
        user: {
          select: {
            walletAddress: true,
            username: true
          }
        }
      }
    });

    const leaderboard = results.map((result, index) => ({
      rank: index + 1,
      id: result.id,
      walletAddress: result.user.walletAddress,
      username: result.user.username,
      score: result.score,
      hashRate: result.hashRate,
      duration: result.duration,
      algorithm: result.algorithm,
      difficulty: result.difficulty,
      tokensEarned: result.tokensEarned,
      timestamp: result.timestamp,
      gpuInfo: result.gpuInfo
    }));

    res.json({ leaderboard });
  } catch (error) {
    console.error('Benchmark leaderboard error:', error);
    res.status(500).json({ error: 'Failed to fetch benchmark leaderboard' });
  }
});

// Get user's benchmark history
router.get('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const results = await prisma.benchmarkResult.findMany({
      where: { userId },
      orderBy: { timestamp: 'desc' },
      skip,
      take: parseInt(limit as string)
    });

    const total = await prisma.benchmarkResult.count({
      where: { userId }
    });

    res.json({
      results,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        pages: Math.ceil(total / parseInt(limit as string))
      }
    });
  } catch (error) {
    console.error('Benchmark history error:', error);
    res.status(500).json({ error: 'Failed to fetch benchmark history' });
  }
});

// Get benchmark statistics
router.get('/stats', async (req, res) => {
  try {
    const totalBenchmarks = await prisma.benchmarkResult.count();
    
    const avgScore = await prisma.benchmarkResult.aggregate({
      _avg: { score: true }
    });

    const topScore = await prisma.benchmarkResult.aggregate({
      _max: { score: true }
    });

    const algorithmStats = await prisma.$queryRaw`
      SELECT algorithm, COUNT(*) as count, AVG(score) as avgScore
      FROM benchmark_results
      GROUP BY algorithm
    `;

    const difficultyStats = await prisma.$queryRaw`
      SELECT difficulty, COUNT(*) as count, AVG(score) as avgScore
      FROM benchmark_results
      GROUP BY difficulty
    `;

    res.json({
      totalBenchmarks,
      averageScore: avgScore._avg.score,
      topScore: topScore._max.score,
      algorithmStats,
      difficultyStats
    });
  } catch (error) {
    console.error('Benchmark stats error:', error);
    res.status(500).json({ error: 'Failed to fetch benchmark statistics' });
  }
});

// Helper functions
function calculateBenchmarkReward(score: number, duration: number, difficulty: string): number {
  const baseRate = parseFloat(process.env.BENCHMARK_REWARD_RATE || '0.5');
  const difficultyMultiplier = getDifficultyMultiplier(difficulty);
  
  // Reward based on score and difficulty
  const reward = (score * baseRate * difficultyMultiplier) / 1000;
  
  return Math.max(reward, 0.1); // Minimum reward
}

function getDifficultyMultiplier(difficulty: string): number {
  switch (difficulty.toLowerCase()) {
    case 'easy': return 1.0;
    case 'medium': return 1.5;
    case 'hard': return 2.0;
    default: return 1.0;
  }
}

function getTimeFilter(period: string): Date | null {
  const now = new Date();
  
  switch (period) {
    case '1h':
      return new Date(now.getTime() - 60 * 60 * 1000);
    case '24h':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

export default router;
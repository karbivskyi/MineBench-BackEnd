import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';

export function startRewardDistribution(prisma: PrismaClient) {
  console.log('Starting reward distribution service...');

  // Run every minute to process rewards
  cron.schedule('*/1 * * * *', async () => {
    try {
      await distributeRewards(prisma);
    } catch (error) {
      console.error('Reward distribution error:', error);
    }
  });

  // Run every hour to update token pool statistics
  cron.schedule('0 * * * *', async () => {
    try {
      await updateTokenPoolStats(prisma);
    } catch (error) {
      console.error('Token pool update error:', error);
    }
  });
}

async function distributeRewards(prisma: PrismaClient) {
  // This function would handle:
  // 1. Processing pending mining rewards
  // 2. Calculating benchmark bonuses
  // 3. Updating user balances
  // 4. Managing token pool supply

  const pendingMiningRecords = await prisma.miningRecord.findMany({
    where: {
      tokensEarned: 0,
      endTime: { not: null }
    },
    take: 100
  });

  for (const record of pendingMiningRecords) {
    const tokensEarned = calculateMiningTokens(record.hashRate, record.duration || 0);
    
    await prisma.miningRecord.update({
      where: { id: record.id },
      data: { tokensEarned }
    });

    await prisma.user.update({
      where: { id: record.userId },
      data: {
        virtualBalance: { increment: tokensEarned }
      }
    });
  }

  console.log(`Processed ${pendingMiningRecords.length} mining rewards`);
}

async function updateTokenPoolStats(prisma: PrismaClient) {
  // Calculate total distributed tokens
  const totalDistributed = await prisma.user.aggregate({
    _sum: { virtualBalance: true }
  });

  const totalMiningRewards = await prisma.miningRecord.aggregate({
    _sum: { tokensEarned: true }
  });

  const totalBenchmarkRewards = await prisma.benchmarkResult.aggregate({
    _sum: { tokensEarned: true }
  });

  // Update or create token pool record
  let tokenPool = await prisma.tokenPool.findFirst();
  
  if (!tokenPool) {
    tokenPool = await prisma.tokenPool.create({
      data: {
        totalSupply: 1000000, // 1M BMT tokens
        circulatingSupply: totalDistributed._sum.virtualBalance || 0,
        reserveBalance: 900000, // Reserve for distribution
        miningRewardRate: 1.0,
        benchmarkRewardRate: 0.5,
        minimumWithdrawal: 100.0
      }
    });
  } else {
    await prisma.tokenPool.update({
      where: { id: tokenPool.id },
      data: {
        circulatingSupply: totalDistributed._sum.virtualBalance || 0
      }
    });
  }

  console.log('Token pool stats updated');
}

function calculateMiningTokens(hashRate: number, duration: number): number {
  // Simple calculation: hashRate * duration * rate
  const baseReward = (hashRate * duration) / 1000000;
  return Math.max(baseReward, 0.001);
}
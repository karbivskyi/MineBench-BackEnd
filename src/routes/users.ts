import express from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = express.Router();
const prisma = new PrismaClient();

// Register/Login user
router.post('/auth', async (req, res) => {
  try {
    const { walletAddress, username } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    // Check if user exists
    let user = await prisma.user.findUnique({
      where: { walletAddress }
    });

    if (!user) {
      // Create new user
      user = await prisma.user.create({
        data: {
          walletAddress,
          username: username || `user_${walletAddress.slice(-8)}`
        }
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, walletAddress: user.walletAddress },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    res.json({
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        username: user.username,
        virtualBalance: user.virtualBalance,
        totalMined: user.totalMined
      },
      token
    });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Get user profile
router.get('/profile/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const user = await prisma.user.findUnique({
      where: { walletAddress },
      include: {
        miningRecords: {
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        benchmarkResults: {
          orderBy: { timestamp: 'desc' },
          take: 10
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        username: user.username,
        virtualBalance: user.virtualBalance,
        totalMined: user.totalMined,
        totalHashRate: user.totalHashRate,
        lastActive: user.lastActive
      },
      recentMining: user.miningRecords,
      recentBenchmarks: user.benchmarkResults
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update user profile
router.put('/profile', async (req, res) => {
  try {
    const { userId, username } = req.body;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { username }
    });

    res.json({ user });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

export default router;
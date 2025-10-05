import express from 'express';
import { PrismaClient } from '@prisma/client';
import { Connection, PublicKey, Transaction, sendAndConfirmTransaction, Keypair } from '@solana/web3.js';
import { createTransferInstruction, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';

const router = express.Router();
const prisma = new PrismaClient();

// Initialize Solana connection
const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com');

// Get user's virtual wallet balance
router.get('/balance/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        virtualBalance: true,
        totalMined: true,
        walletTransactions: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const pendingWithdrawals = await prisma.walletTransaction.aggregate({
      where: {
        userId,
        type: 'WITHDRAWAL',
        status: { in: ['PENDING', 'PROCESSING'] }
      },
      _sum: { amount: true }
    });

    const availableBalance = parseFloat(user.virtualBalance.toString()) - 
                           parseFloat(pendingWithdrawals._sum.amount?.toString() || '0');

    res.json({
      virtualBalance: user.virtualBalance,
      availableBalance,
      totalMined: user.totalMined,
      pendingWithdrawals: pendingWithdrawals._sum.amount || 0,
      recentTransactions: user.walletTransactions
    });
  } catch (error) {
    console.error('Balance error:', error);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// Request withdrawal
router.post('/withdraw', async (req, res) => {
  try {
    const { userId, amount, toAddress } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const withdrawAmount = parseFloat(amount);
    const minWithdrawal = parseFloat(process.env.MINIMUM_WITHDRAWAL || '100.0');

    // Validate withdrawal amount
    if (withdrawAmount < minWithdrawal) {
      return res.status(400).json({ 
        error: `Minimum withdrawal amount is ${minWithdrawal} BMT` 
      });
    }

    const availableBalance = parseFloat(user.virtualBalance.toString());
    if (withdrawAmount > availableBalance) {
      return res.status(400).json({ 
        error: 'Insufficient balance' 
      });
    }

    // Validate Solana address
    try {
      new PublicKey(toAddress);
    } catch {
      return res.status(400).json({ error: 'Invalid Solana address' });
    }

    // Create withdrawal transaction record
    const transaction = await prisma.walletTransaction.create({
      data: {
        userId,
        type: 'WITHDRAWAL',
        amount: withdrawAmount,
        toAddress,
        status: 'PENDING'
      }
    });

    // Process withdrawal (this would be handled by a background service)
    processWithdrawal(transaction.id);

    res.json({
      success: true,
      transactionId: transaction.id,
      message: 'Withdrawal request submitted successfully'
    });
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({ error: 'Failed to process withdrawal request' });
  }
});

// Get transaction history
router.get('/transactions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20, type } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const whereClause: any = { userId };
    if (type) whereClause.type = type;

    const transactions = await prisma.walletTransaction.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit as string)
    });

    const total = await prisma.walletTransaction.count({
      where: whereClause
    });

    res.json({
      transactions,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        pages: Math.ceil(total / parseInt(limit as string))
      }
    });
  } catch (error) {
    console.error('Transaction history error:', error);
    res.status(500).json({ error: 'Failed to fetch transaction history' });
  }
});

// Get withdrawal status
router.get('/withdrawal/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;

    const transaction = await prisma.walletTransaction.findUnique({
      where: { id: transactionId },
      include: {
        user: {
          select: {
            walletAddress: true,
            username: true
          }
        }
      }
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({ transaction });
  } catch (error) {
    console.error('Withdrawal status error:', error);
    res.status(500).json({ error: 'Failed to fetch withdrawal status' });
  }
});

// Background function to process withdrawals
async function processWithdrawal(transactionId: string) {
  try {
    const transaction = await prisma.walletTransaction.findUnique({
      where: { id: transactionId },
      include: { user: true }
    });

    if (!transaction || transaction.status !== 'PENDING') {
      return;
    }

    // Update status to processing
    await prisma.walletTransaction.update({
      where: { id: transactionId },
      data: { status: 'PROCESSING' }
    });

    // This is where you would implement the actual Solana token transfer
    // For now, we'll simulate the process
    
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 5000));

    // In a real implementation, you would:
    // 1. Create a Solana transaction to transfer BMT tokens
    // 2. Sign and send the transaction
    // 3. Wait for confirmation
    // 4. Update the transaction status

    const mockTxHash = `solana_tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Update transaction as completed
    await prisma.walletTransaction.update({
      where: { id: transactionId },
      data: {
        status: 'COMPLETED',
        txHash: mockTxHash,
        processedAt: new Date()
      }
    });

    // Deduct amount from user's virtual balance
    await prisma.user.update({
      where: { id: transaction.userId },
      data: {
        virtualBalance: {
          decrement: transaction.amount
        }
      }
    });

    console.log(`Withdrawal processed: ${transactionId}`);
  } catch (error) {
    console.error('Withdrawal processing error:', error);
    
    // Mark transaction as failed
    await prisma.walletTransaction.update({
      where: { id: transactionId },
      data: { status: 'FAILED' }
    });
  }
}

export default router;
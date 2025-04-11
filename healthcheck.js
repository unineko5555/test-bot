// healthcheck.js
// Docker healthcheckで使用するための簡易ヘルスチェックスクリプト

const ethers = require('ethers');
const fs = require('fs');
const CONFIG = require('./config');

async function healthCheck() {
  try {
    // RPC接続チェック
    const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
    const blockNumber = await provider.getBlockNumber();
    
    if (!blockNumber) {
      console.error("Failed to get block number");
      process.exit(1);
    }
    
    // プロセスが実行中かチェック
    const processRunning = true; // 実際のプロセス監視ロジックに置き換えることもできます
    
    if (!processRunning) {
      console.error("Process is not running");
      process.exit(1);
    }
    
    // 正常終了
    console.log("Health check passed");
    process.exit(0);
  } catch (error) {
    console.error("Health check failed:", error.message);
    process.exit(1);
  }
}

// ヘルスチェック実行
healthCheck();

// config.example.js
// このファイルをconfig.jsにコピーしてから編集してください

// .envからの環境変数の読み込み
require('dotenv').config();

// 設定
const CONFIG = {
  // チェーン設定
  chainId: 42161, // Arbitrum
  chainName: 'Arbitrum',
  rpcUrl: process.env.RPC_URL || 'YOUR_RPC_URL',
  
  // アカウント設定
  privateKey: process.env.PRIVATE_KEY || 'YOUR_PRIVATE_KEY',
  
  // コントラクト設定
  contractAddress: process.env.CONTRACT_ADDRESS || 'YOUR_CONTRACT_ADDRESS',
  
  // フラッシュボット設定
  useFlashbots: process.env.USE_FLASHBOTS === 'true',
  flashbotsRelayUrl: process.env.FLASHBOTS_RELAY_URL || 'https://relay.flashbots.net',
  flashbotsAuthKey: process.env.FLASHBOTS_AUTH_KEY,
  
  // DEX設定
  dexes: [
    {
      name: 'UniswapV2',
      routerAddress: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // メインネット用アドレス
      factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', // メインネット用アドレス
      fee: 0.003, // 0.3%
    },
    {
      name: 'SushiSwap',
      routerAddress: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F', // メインネット用アドレス
      factoryAddress: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac', // メインネット用アドレス
      fee: 0.003, // 0.3%
    }
    // 他のDEXを追加
  ],
  
  // トークン設定
  baseTokens: [
    {
      symbol: 'WETH',
      address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // Arbitrum WETH
      decimals: 18
    },
    {
      symbol: 'USDC',
      address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', // Arbitrum USDC
      decimals: 6
    }
    // 他のベーストークンを追加
  ],
  
  // トレーディング設定
  minProfitUSD: parseFloat(process.env.MIN_PROFIT_USD) || 5, // 最低利益（USD）
  minProfitPercent: parseFloat(process.env.MIN_PROFIT_PERCENT) || 0.5, // 最低利益（%）
  maxGasPrice: parseFloat(process.env.MAX_GAS_PRICE) || 100, // Gwei
  gasLimit: 1500000,
  slippageTolerance: parseFloat(process.env.SLIPPAGE_TOLERANCE) || 0.5, // 0.5%
  simulateBeforeExecution: true, // 取引前にシミュレーションを実行
  priorityFeeMultiplier: 1.1, // 優先手数料の乗数（フロントランニング対策）
  
  // 監視設定
  pollingInterval: 1000, // ミリ秒
  routeTimeout: 300, // 秒
  maxHops: 3,
  
  // セキュリティ設定
  maxExecutionsPerHour: parseInt(process.env.MAX_EXECUTIONS_PER_HOUR) || 20,
  executionCooldown: 30, // 秒
  
  // APIキー設定（価格取得用）
  coinGeckoApiKey: process.env.COINGECKO_API_KEY || '', // オプション
  
  // ロギング設定
  logLevel: process.env.LOG_LEVEL || 'info',
  logToFile: true,
  logDir: './logs',
};

module.exports = CONFIG;
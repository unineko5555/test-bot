// .envからの環境変数の読み込み
require('dotenv').config();

// 設定
const CONFIG = {
  // チェーン設定
  chainId: 1, // Ethereum Mainnet
  chainName: 'Ethereum',
  rpcUrl: process.env.RPC_URL,
  
  // アカウント設定
  privateKey: process.env.PRIVATE_KEY,
  
  // コントラクト設定
  contractAddress: process.env.CONTRACT_ADDRESS,
  
  // フラッシュボット設定
  useFlashbots: process.env.USE_FLASHBOTS === 'true',
  flashbotsRelayUrl: process.env.FLASHBOTS_RELAY_URL,
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
      name: 'UniswapV3',
      routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // メインネット用アドレス
      factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // メインネット用アドレス
      quoterAddress: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6', // メインネット用アドレス
      fee: 0.003, // 0.3%
    }
    // 他のDEXを追加
  ],
  
  // トークン設定
  baseTokens: [
    {
      symbol: 'WETH',
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // メインネット用WETH
      decimals: 18
    },
    {
      symbol: 'USDC',
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // メインネット用USDC
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
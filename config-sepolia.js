// .envからの環境変数の読み込み
require('dotenv').config();

// 設定
const CONFIG = {
  // チェーン設定
  chainId: 11155111, // Sepolia Testnet
  chainName: 'Sepolia',
  rpcUrl: process.env.RPC_URL,
  
  // アカウント設定
  privateKey: process.env.PRIVATE_KEY,
  
  // コントラクト設定
  contractAddress: process.env.TEST_CONTRACT_ADDRESS,
  
  // フラッシュボット設定
  useFlashbots: process.env.USE_FLASHBOTS === 'true',
  flashbotsRelayUrl: process.env.FLASHBOTS_RELAY_URL,
  flashbotsAuthKey: process.env.FLASHBOTS_AUTH_KEY,
  
  // DEX設定
  dexes: [
    {
      name: 'UniswapV2',
      routerAddress: '0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3', //Sepolia用アドレス
      factoryAddress: '0xF62c03E08ada871A0bEb309762E260a7a6a880E6', // Sepolia用アドレス
      fee: 0.003, // 0.3%
    },
    {
      name: 'UniswapV3',
      routerAddress: '', // 存在しない 
      factoryAddress: '0x0227628f3F023bb0B980b67D528571c95c6DaC1c', // Sepolia用アドレス
      quoterAddress: '0x', // Sepolia用アドレス存在しない
      fee: 0.003, // 0.3%
    }
    // 他のDEXを追加
  ],
  
  // トークン設定
  baseTokens: [
    {
      symbol: 'WETH',
      address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', // Sepolia用WETH
      decimals: 18
    },
    {
      symbol: 'USDC',
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // Sepolia用USDC
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
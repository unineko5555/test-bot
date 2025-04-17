// arbitrage-manager.js
const ethers = require('ethers');
const { Contract, BigNumber } = ethers;
const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');
const winston = require('winston');

require('dotenv').config();
const CONFIG = require('./config-mainnet.js');


// ロギング設定
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'arbitrage-bot' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

// ABIをJSONファイルから読み込み
const loadAbi = (filename) => {
  // filenameはファイル名のみを渡すこと（例: 'MultiDexArbitrageBot.json'）
  const filePath = path.join(__dirname, 'abis', filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

// コントラクトABI
const ARBITRAGE_BOT_ABI = loadAbi('MultiDexArbitrageBot.json');
const UNISWAP_ROUTER_ABI = loadAbi('UniswapV2Router.json');
const UNISWAP_FACTORY_ABI = loadAbi('UniswapV2Factory.json');
const UNISWAP_PAIR_ABI = loadAbi('UniswapV2Pair.json');
const ERC20_ABI = loadAbi('ERC20.json');
const QUOTER_ABI = loadAbi('QuoterV2.json');

// トークンリスト
let tokenList = [];
let watchedPairs = [];
let executionHistory = [];
let isRunning = false;
let gasPrice = BigNumber.from('0');
let provider;
let wallet;
let contract;

// Slack通知用関数
async function sendSlackNotification(message) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL || CONFIG.slackWebhookUrl;
  if (!webhookUrl) return;
  try {
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message })
    });
  } catch (e) {
    logger.warn('Slack通知に失敗しました', { error: e.message });
  }
}

// ボット初期化
async function initializeBot() {
  try {
    logger.info(`Initializing arbitrage bot on ${CONFIG.chainName}`);
    
    // プロバイダー初期化
    provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
    wallet = new ethers.Wallet(CONFIG.privateKey, provider);
    
    // コントラクト初期化
    contract = new Contract(CONFIG.contractAddress, ARBITRAGE_BOT_ABI, wallet);
    
    // チェーン情報確認
    const network = await provider.getNetwork();
    if (network.chainId !== CONFIG.chainId) {
      throw new Error(`Chain ID mismatch: expected ${CONFIG.chainId}, got ${network.chainId}`);
    }
    
    // ガス価格取得
    gasPrice = await provider.getGasPrice();
    logger.info(`Current gas price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} Gwei`);
    
    // DEXルーター初期化
    for (const dex of CONFIG.dexes) {
      dex.router = new Contract(dex.routerAddress, UNISWAP_ROUTER_ABI, provider);
      dex.factory = new Contract(dex.factoryAddress, UNISWAP_FACTORY_ABI, provider);
      logger.info(`Initialized DEX: ${dex.name}`);
    }
    
    // トークンリスト初期化
    await loadTokenList();
    
    // 監視ペア初期化
    await initWatchedPairs();
    
    logger.info('Bot initialization complete');
    return true;
  } catch (error) {
    logger.error('Bot initialization failed', { error: error.message, stack: error.stack });
    return false;
  }
}

// トークンリスト読み込み
async function loadTokenList() {
  try {
    // トークンリストをローカルJSONから読み込むか、APIから取得
    const tokenListPath = path.join(__dirname, 'token-list.json');
    
    if (fs.existsSync(tokenListPath)) {
      tokenList = JSON.parse(fs.readFileSync(tokenListPath, 'utf8'));
      logger.info(`Loaded ${tokenList.length} tokens from local file`);
    } else {
      // トークンリストが存在しない場合、基本トークンのみを使用
      tokenList = CONFIG.baseTokens;
      logger.info(`Using ${tokenList.length} base tokens`);
    }
    
    // 各トークンのコントラクトインスタンスを作成
    for (const token of tokenList) {
      token.contract = new Contract(token.address, ERC20_ABI, provider);
    }
  } catch (error) {
    logger.error('Failed to load token list', { error: error.message });
    // 基本トークンのみを使用
    tokenList = CONFIG.baseTokens;
  }
}

// 監視ペア初期化
async function initWatchedPairs() {
  try {
    // 基本トークンと全トークンのペアを作成
    for (const baseToken of CONFIG.baseTokens) {
      for (const token of tokenList) {
        // 同じトークンの場合はスキップ
        if (baseToken.address.toLowerCase() === token.address.toLowerCase()) continue;
        
        // ペアが存在するか確認
        let pairExists = false;
        
        for (const dex of CONFIG.dexes) {
          try {
            const pairAddress = await dex.factory.getPair(baseToken.address, token.address);
            if (pairAddress !== ethers.constants.AddressZero) {
              pairExists = true;
              break;
            }
          } catch (error) {
            continue;
          }
        }
        
        if (pairExists) {
          watchedPairs.push({
            tokenA: baseToken,
            tokenB: token,
            active: true,
            lastChecked: 0,
            lastProfit: 0,
            successCount: 0
          });
        }
      }
    }
    
    logger.info(`Initialized ${watchedPairs.length} token pairs for monitoring`);
  } catch (error) {
    logger.error('Failed to initialize watched pairs', { error: error.message });
  }
}

// アービトラージ機会のチェック
async function checkArbitrageOpportunities() {
  if (!isRunning) return;
  
  const startTime = performance.now();
  
  try {
    // ガス価格更新
    gasPrice = await provider.getGasPrice();
    if (gasPrice.gt(ethers.utils.parseUnits(CONFIG.maxGasPrice.toString(), 'gwei'))) {
      logger.info(`Gas price too high: ${ethers.utils.formatUnits(gasPrice, 'gwei')} Gwei, skipping check`);
      return;
    }
    
    // ランダムにペアを選択して検査（一度にすべてを検査しない）
    const shuffledPairs = [...watchedPairs].sort(() => 0.5 - Math.random());
    const pairsToCheck = shuffledPairs.slice(0, 10); // 一度に10ペアをチェック
    
    for (const pair of pairsToCheck) {
      if (!isRunning) return;
      
      const now = Date.now();
      // 前回のチェックから指定時間が経過していない場合はスキップ
      if (now - pair.lastChecked < 5000) continue;
      
      pair.lastChecked = now;
      
      const { tokenA, tokenB } = pair;
      logger.debug(`Checking arbitrage for ${tokenA.symbol} <> ${tokenB.symbol}`);
      
      // 最適なルートとプロフィットを計算
      const result = await findBestArbitrageRoute(tokenA, tokenB);
      
      if (result && result.profitable) {
        pair.lastProfit = result.estimatedProfitUSD;
        
        // プロフィットが閾値を超えていれば、アービトラージを実行
        if (result.estimatedProfitUSD >= CONFIG.minProfitUSD && 
            result.profitPercent >= CONFIG.minProfitPercent) {
          
          logger.info(`Found profitable arbitrage: ${tokenA.symbol} <> ${tokenB.symbol}`, {
            route: result.routeDescription,
            estimatedProfit: `$${result.estimatedProfitUSD.toFixed(2)} (${result.profitPercent.toFixed(2)}%)`,
            gasEstimate: result.gasEstimate
          });
          
          // アービトラージの実行
          const success = await executeArbitrage(result);
          
          if (success) {
            pair.successCount++;
            // 成功したペアは一時的にスキップ（クールダウン）
            pair.lastChecked = now + (CONFIG.executionCooldown * 1000);
          }
        }
      }
    }
  } catch (error) {
    logger.error('Error checking arbitrage opportunities', { error: error.message });
  }
  
  const endTime = performance.now();
  logger.debug(`Checking completed in ${(endTime - startTime).toFixed(2)}ms`);
}

// 最適なアービトラージルートを見つける
async function findBestArbitrageRoute(tokenA, tokenB) {
  try {
    // 各DEXでの価格を取得
    const prices = [];
    
    for (const dex of CONFIG.dexes) {
      if (!dex.router) continue;
      
      try {
        // A→B方向の価格
        const pathAB = [tokenA.address, tokenB.address];
        const amountIn = ethers.utils.parseUnits('1', tokenA.decimals);
        
        const amountsAB = await dex.router.getAmountsOut(amountIn, pathAB);
        const priceAB = amountsAB[1];
        
        // B→A方向の価格
        const pathBA = [tokenB.address, tokenA.address];
        const amountInB = ethers.utils.parseUnits('1', tokenB.decimals);
        
        const amountsBA = await dex.router.getAmountsOut(amountInB, pathBA);
        const priceBA = amountsBA[1];
        
        prices.push({
          dex: dex.name,
          dexIndex: CONFIG.dexes.indexOf(dex),
          AtoB: {
            price: priceAB,
            normalizedPrice: ethers.utils.formatUnits(priceAB, tokenB.decimals)
          },
          BtoA: {
            price: priceBA,
            normalizedPrice: ethers.utils.formatUnits(priceBA, tokenA.decimals)
          }
        });
      } catch (error) {
        logger.debug(`Error getting price from ${dex.name}`, { error: error.message });
        continue;
      }
    }
    
    if (prices.length < 2) {
      logger.debug(`Not enough prices available for ${tokenA.symbol} <> ${tokenB.symbol}`);
      return null;
    }
    
    // マルチホップルートを探索（各DEXでの最適な取引経路）
    const routes = [];
    
    // 単純なA→B→A（2ホップ）
    for (let i = 0; i < prices.length; i++) {
      for (let j = 0; j < prices.length; j++) {
        if (i === j) continue; // 同じDEXはスキップ
        
        const sellDex = prices[i];
        const buyDex = prices[j];
        
        // シナリオ1: DEX1でA→B, DEX2でB→A
        const amountIn = ethers.utils.parseUnits('1', tokenA.decimals);
        const amountOut1 = await CONFIG.dexes[sellDex.dexIndex].router.getAmountsOut(
          amountIn, 
          [tokenA.address, tokenB.address]
        );
        const intermediateAmount = amountOut1[1];
        const amountOut2 = await CONFIG.dexes[buyDex.dexIndex].router.getAmountsOut(
          intermediateAmount,
          [tokenB.address, tokenA.address]
        );
        const finalAmount = amountOut2[1];
        
        const profit = finalAmount.sub(amountIn);
        const profitPercent = parseFloat(ethers.utils.formatUnits(profit, tokenA.decimals)) * 100;
        
        if (profit.gt(0)) {
          routes.push({
            type: '2-hop',
            path: [tokenA.address, tokenB.address, tokenA.address],
            dexIndices: [sellDex.dexIndex, buyDex.dexIndex],
            routeDescription: `Buy ${tokenB.symbol} on ${sellDex.dex}, Sell on ${buyDex.dex}`,
            amountIn,
            expectedOut: finalAmount,
            profit,
            profitPercent,
            dexes: [CONFIG.dexes[sellDex.dexIndex].name, CONFIG.dexes[buyDex.dexIndex].name]
          });
        }
      }
    }
    
    // 3ホップルートを探索（より複雑なルート、例: A→C→B→A）
    if (CONFIG.maxHops >= 3) {
      // その他のトークンを介してのルート
      for (const tokenC of tokenList) {
        // 同じトークンはスキップ
        if (tokenC.address === tokenA.address || tokenC.address === tokenB.address) continue;
        
        for (let i = 0; i < CONFIG.dexes.length; i++) {
          for (let j = 0; i < CONFIG.dexes.length; j++) {
            for (let k = 0; i < CONFIG.dexes.length; k++) {
              try {
                const dex1 = CONFIG.dexes[i];
                const dex2 = CONFIG.dexes[j];
                const dex3 = CONFIG.dexes[k];
                
                // A→C→B→A の経路をシミュレーション
                const amountIn = ethers.utils.parseUnits('1', tokenA.decimals);
                
                // A→C
                const amountsAC = await dex1.router.getAmountsOut(
                  amountIn,
                  [tokenA.address, tokenC.address]
                );
                const amountC = amountsAC[1];
                
                // C→B
                const amountsCB = await dex2.router.getAmountsOut(
                  amountC,
                  [tokenC.address, tokenB.address]
                );
                const amountB = amountsCB[1];
                
                // B→A
                const amountsBA = await dex3.router.getAmountsOut(
                  amountB,
                  [tokenB.address, tokenA.address]
                );
                const finalAmount = amountsBA[1];
                
                const profit = finalAmount.sub(amountIn);
                const profitPercent = parseFloat(ethers.utils.formatUnits(profit, tokenA.decimals)) * 100;
                
                if (profit.gt(0)) {
                  routes.push({
                    type: '3-hop',
                    path: [tokenA.address, tokenC.address, tokenB.address, tokenA.address],
                    dexIndices: [i, j, k],
                    routeDescription: `${tokenA.symbol}→${tokenC.symbol} on ${dex1.name}, ${tokenC.symbol}→${tokenB.symbol} on ${dex2.name}, ${tokenB.symbol}→${tokenA.symbol} on ${dex3.name}`,
                    amountIn,
                    expectedOut: finalAmount,
                    profit,
                    profitPercent,
                    dexes: [dex1.name, dex2.name, dex3.name]
                  });
                }
              } catch (error) {
                continue;
              }
            }
          }
        }
      }
    }
    
    // 最も利益の大きいルートを選択
    if (routes.length === 0) {
      return null;
    }
    
    routes.sort((a, b) => b.profitPercent - a.profitPercent);
    const bestRoute = routes[0];
    
    // ガス代の見積もり
    const gasEstimate = await estimateGasCost();
    const gasEstimateInToken = await convertEthToToken(
      gasEstimate,
      tokenA.address
    );
    
    // 純利益の計算（ガス代を差し引く）
    const netProfitInToken = bestRoute.profit.sub(gasEstimateInToken);
    const netProfitPercent = parseFloat(ethers.utils.formatUnits(netProfitInToken, tokenA.decimals)) * 100;
    
    // USD価格の取得
    const tokenPriceUSD = await getTokenPriceUSD(tokenA.address);
    const estimatedProfitUSD = parseFloat(ethers.utils.formatUnits(netProfitInToken, tokenA.decimals)) * tokenPriceUSD;
    
    // 最終判断
    const profitable = netProfitInToken.gt(0) && 
                       estimatedProfitUSD >= CONFIG.minProfitUSD &&
                       netProfitPercent >= CONFIG.minProfitPercent;
    
    return {
      ...bestRoute,
      netProfitInToken,
      netProfitPercent,
      tokenPriceUSD,
      estimatedProfitUSD,
      gasEstimate: ethers.utils.formatEther(gasEstimate),
      profitable
    };
  } catch (error) {
    logger.error('Error finding best arbitrage route', { error: error.message });
    return null;
  }
}

// アービトラージの実行
async function executeArbitrage(opportunity) {
  try {
    // 安全チェック
    if (executionHistory.length >= CONFIG.maxExecutionsPerHour) {
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      const recentExecutions = executionHistory.filter(e => e.timestamp > oneHourAgo);
      
      if (recentExecutions.length >= CONFIG.maxExecutionsPerHour) {
        logger.warn(`Maximum executions per hour (${CONFIG.maxExecutionsPerHour}) reached, skipping execution`);
        return false;
      }
    }
    
    const { tokenA, tokenB, amountIn, path, dexIndices } = opportunity;
    
    // ルートデータの準備
    const route = {
      path: path,
      dexIndices: dexIndices,
      expectedProfit: opportunity.profit,
      timestamp: Math.floor(Date.now() / 1000)
    };
    
    // トランザクションの準備
    const gasPrice = await provider.getGasPrice();
    const gasLimit = CONFIG.gasLimit;
    
    logger.info('Executing arbitrage transaction', {
      tokenA: tokenA.symbol,
      tokenB: tokenB.symbol,
      route: opportunity.routeDescription,
      estimatedProfit: `${opportunity.estimatedProfitUSD.toFixed(2)}`
    });
    await sendSlackNotification(`:moneybag: アービトラージ検知！\n${tokenA.symbol} <> ${tokenB.symbol}\nルート: ${opportunity.routeDescription}\n推定利益: $${opportunity.estimatedProfitUSD.toFixed(2)}`);
    
    // スマートコントラクトの呼び出し
    const tx = await contract.executeArbitrage(
      tokenA.address,
      tokenB.address,
      amountIn,
      route,
      {
        gasPrice,
        gasLimit
      }
    );
    
    logger.info(`Transaction sent: ${tx.hash}`);
    
    // トランザクション完了を待つ
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      // 成功
      logger.info(`Arbitrage successful: ${tx.hash}`, {
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.effectiveGasPrice.toString()
      });
      
      // 実行履歴を更新
      executionHistory.push({
        timestamp: Date.now(),
        txHash: tx.hash,
        profit: opportunity.estimatedProfitUSD,
        route: opportunity.routeDescription
      });
      await sendSlackNotification(`:white_check_mark: アービトラージ成功！\nTx: <https://sepolia.etherscan.io/tx/${tx.hash}>\n利益: $${opportunity.estimatedProfitUSD.toFixed(2)}`);
      
      return true;
    } else {
      // 失敗
      logger.error(`Arbitrage failed: ${tx.hash}`);
      await sendSlackNotification(`:x: アービトラージ失敗\nTx: <https://sepolia.etherscan.io/tx/${tx.hash}>`);
      return false;
    }
  } catch (error) {
    logger.error('Error executing arbitrage', { error: error.message });
    await sendSlackNotification(`:warning: アービトラージ実行エラー: ${error.message}`);
    return false;
  }
}

// ガスコストの見積もり
async function estimateGasCost() {
  const gasPrice = await provider.getGasPrice();
  const gasLimit = BigNumber.from(CONFIG.gasLimit);
  return gasPrice.mul(gasLimit);
}

// ETHをトークンに変換（ガスコスト計算用）
async function convertEthToToken(ethAmount, tokenAddress) {
  try {
    // WETHのアドレスを取得
    const wethAddress = CONFIG.baseTokens.find(t => t.symbol === 'WETH').address;
    
    // 同じトークンの場合
    if (tokenAddress.toLowerCase() === wethAddress.toLowerCase()) {
      return ethAmount;
    }
    
    // ETH→トークンの変換レートを取得
    const router = CONFIG.dexes[0].router;
    const amountsOut = await router.getAmountsOut(
      ethAmount,
      [wethAddress, tokenAddress]
    );
    
    return amountsOut[1];
  } catch (error) {
    logger.error('Error converting ETH to token', { error: error.message });
    return BigNumber.from('0');
  }
}

// トークンのUSD価格を取得
async function getTokenPriceUSD(tokenAddress) {
  try {
    // WETHの場合は固定価格を返す（テスト用）
    const wethAddress = CONFIG.baseTokens.find(t => t.symbol === 'WETH').address;
    if (tokenAddress.toLowerCase() === wethAddress.toLowerCase()) {
      return 2000; // ETH価格を仮定
    }

    // USDCの場合
    const usdcAddress = CONFIG.baseTokens.find(t => t.symbol === 'USDC')?.address;
    if (usdcAddress && tokenAddress.toLowerCase() === usdcAddress.toLowerCase()) {
      return 1;
    }

    // CoinGecko APIで価格取得
    const apiKey = CONFIG.coinGeckoApiKey;
    const url = `https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${tokenAddress}&vs_currencies=usd${apiKey ? `&x_cg_pro_api_key=${apiKey}` : ''}`;
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    const response = await fetch(url);
    if (!response.ok) throw new Error(`CoinGecko API error: ${response.status}`);
    const data = await response.json();
    const price = data[tokenAddress.toLowerCase()]?.usd;
    if (price) return price;
    logger.warn(`CoinGecko price not found for ${tokenAddress}`);
    return 0;
  } catch (error) {
    logger.error('Error getting token price from CoinGecko', { error: error.message });
    return 0;
  }
}

// DEXの流動性監視
async function monitorLiquidity() {
  try {
    for (const pair of watchedPairs) {
      const { tokenA, tokenB } = pair;
      
      for (const dex of CONFIG.dexes) {
        try {
          const pairAddress = await dex.factory.getPair(tokenA.address, tokenB.address);
          
          if (pairAddress !== ethers.constants.AddressZero) {
            const pairContract = new Contract(pairAddress, UNISWAP_PAIR_ABI, provider);
            const reserves = await pairContract.getReserves();
            
            // トークンの順序を確認
            const token0 = await pairContract.token0();
            const isTokenAFirst = token0.toLowerCase() === tokenA.address.toLowerCase();
            
            const reserveA = isTokenAFirst ? reserves[0] : reserves[1];
            const reserveB = isTokenAFirst ? reserves[1] : reserves[0];
            
            // 流動性が十分かチェック
            const reserveAInEth = await convertTokenToEth(reserveA, tokenA.address);
            const reserveBInEth = await convertTokenToEth(reserveB, tokenB.address);
            
            // 10 ETH相当以上の流動性があるかチェック
            const minLiquidity = ethers.utils.parseEther('10');
            if (reserveAInEth.lt(minLiquidity) || reserveBInEth.lt(minLiquidity)) {
              pair.lowLiquidity = true;
              logger.debug(`Low liquidity for ${tokenA.symbol}-${tokenB.symbol} on ${dex.name}`);
            } else {
              pair.lowLiquidity = false;
            }
          }
        } catch (error) {
          continue;
        }
      }
    }
  } catch (error) {
    logger.error('Error monitoring liquidity', { error: error.message });
  }
}

// トークンをETHに変換（流動性チェック用）
async function convertTokenToEth(tokenAmount, tokenAddress) {
  try {
    // WETHのアドレスを取得
    const wethAddress = CONFIG.baseTokens.find(t => t.symbol === 'WETH').address;
    
    // 同じトークンの場合
    if (tokenAddress.toLowerCase() === wethAddress.toLowerCase()) {
      return tokenAmount;
    }
    
    // トークン→ETHの変換レートを取得
    const router = CONFIG.dexes[0].router;
    const amountsOut = await router.getAmountsOut(
      tokenAmount,
      [tokenAddress, wethAddress]
    );
    
    return amountsOut[1];
  } catch (error) {
    logger.error('Error converting token to ETH', { error: error.message });
    return BigNumber.from('0');
  }
}

// 新しいトークンの検出と追加
async function discoverNewTokens() {
  try {
    // 新しく作成されたペアを探す（最新のペアから検索）
    const factory = CONFIG.dexes[0].factory;
    const allPairsLength = await factory.allPairsLength();
    
    // 最新の100ペアをチェック
    const startIndex = Math.max(0, allPairsLength.toNumber() - 100);
    const endIndex = allPairsLength.toNumber();
    
    for (let i = startIndex; i < endIndex; i++) {
      try {
        const pairAddress = await factory.allPairs(i);
        const pairContract = new Contract(pairAddress, UNISWAP_PAIR_ABI, provider);
        
        const token0 = await pairContract.token0();
        const token1 = await pairContract.token1();
        
        // トークンリストに存在しないトークンを追加
        await addNewTokenIfNotExists(token0);
        await addNewTokenIfNotExists(token1);
      } catch (error) {
        continue;
      }
    }
  } catch (error) {
    logger.error('Error discovering new tokens', { error: error.message });
  }
}

// 新しいトークンをリストに追加
async function addNewTokenIfNotExists(tokenAddress) {
  // 既存のトークンかチェック
  const exists = tokenList.some(t => t.address.toLowerCase() === tokenAddress.toLowerCase());
  if (exists) return;
  
  try {
    // トークン情報を取得
    const tokenContract = new Contract(tokenAddress, ERC20_ABI, provider);
    const symbol = await tokenContract.symbol();
    const decimals = await tokenContract.decimals();
    const name = await tokenContract.name();
    
    // スパムトークンの除外（必要に応じて）
    if (symbol.length > 30 || name.length > 50) {
      return;
    }
    
    // 新しいトークンを追加
    const newToken = {
      address: tokenAddress,
      symbol,
      decimals,
      name,
      contract: tokenContract
    };
    
    tokenList.push(newToken);
    logger.info(`Added new token: ${symbol} (${tokenAddress})`);
    
    // ベーストークンとのペアを監視リストに追加
    for (const baseToken of CONFIG.baseTokens) {
      watchedPairs.push({
        tokenA: baseToken,
        tokenB: newToken,
        active: true,
        lastChecked: 0,
        lastProfit: 0,
        successCount: 0
      });
    }
    
    // トークンリストを保存
    saveTokenList();
  } catch (error) {
    logger.debug(`Error adding new token ${tokenAddress}`, { error: error.message });
  }
}

// トークンリストを保存
function saveTokenList() {
  try {
    const tokenListToSave = tokenList.map(token => ({
      address: token.address,
      symbol: token.symbol,
      decimals: token.decimals,
      name: token.name || ''
    }));
    
    const tokenListPath = path.join(__dirname, 'token-list.json');
    fs.writeFileSync(tokenListPath, JSON.stringify(tokenListToSave, null, 2));
    logger.info(`Saved ${tokenListToSave.length} tokens to token-list.json`);
  } catch (error) {
    logger.error('Error saving token list', { error: error.message });
  }
}

// 定期タスクのスケジュール
function schedulePeriodicTasks() {
  // アービトラージ機会のチェック（高頻度）
  setInterval(checkArbitrageOpportunities, CONFIG.pollingInterval);
  
  // 流動性監視（低頻度）
  setInterval(monitorLiquidity, 5 * 60 * 1000); // 5分ごと
  
  // 新トークン検出（低頻度）
  setInterval(discoverNewTokens, 30 * 60 * 1000); // 30分ごと
  
  // ガス価格監視（中頻度）
  setInterval(async () => {
    try {
      gasPrice = await provider.getGasPrice();
      logger.debug(`Updated gas price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} Gwei`);
    } catch (error) {
      logger.error('Error updating gas price', { error: error.message });
    }
  }, 30 * 1000); // 30秒ごと
}

// 収益レポート生成
function generateProfitReport() {
  try {
    // 過去24時間の取引を抽出
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    const recentExecutions = executionHistory.filter(e => e.timestamp > oneDayAgo);
    
    const totalProfit = recentExecutions.reduce((sum, e) => sum + e.profit, 0);
    const averageProfit = recentExecutions.length > 0 ? totalProfit / recentExecutions.length : 0;
    
    // トークンペアごとの収益性をソート
    const pairPerformance = watchedPairs
      .filter(p => p.successCount > 0)
      .map(p => ({
        pair: `${p.tokenA.symbol}-${p.tokenB.symbol}`,
        successCount: p.successCount,
        lastProfit: p.lastProfit
      }))
      .sort((a, b) => b.successCount - a.successCount);
    
    logger.info('24-Hour Profit Report', {
      totalExecutions: recentExecutions.length,
      totalProfitUSD: totalProfit.toFixed(2),
      averageProfitUSD: averageProfit.toFixed(2),
      topPairs: pairPerformance.slice(0, 5)
    });
    
    // CSVレポートを生成
    const reportPath = path.join(__dirname, `profit-report-${new Date().toISOString().split('T')[0]}.csv`);
    const csvHeader = 'timestamp,txHash,tokenPair,profit,route\n';
    const csvRows = recentExecutions.map(e => {
      return `${new Date(e.timestamp).toISOString()},${e.txHash},${e.tokenPair || 'N/A'},${e.profit.toFixed(2)},${e.route}`;
    }).join('\n');
    
    fs.writeFileSync(reportPath, csvHeader + csvRows);
    logger.info(`Profit report saved to ${reportPath}`);
  } catch (error) {
    logger.error('Error generating profit report', { error: error.message });
  }
}

// DEXごとの各トークン価格を取得・ログ・Slack通知
async function logAndNotifyDexTokenPrices() {
  let msg = `*${CONFIG.chainName} 各DEXごとのWETH価格（USD換算）一覧*\n`;
  const weth = CONFIG.baseTokens.find(t => t.symbol === 'WETH');
  for (const dex of CONFIG.dexes) {
    msg += `\n*${dex.name}*\n`;
    for (const token of tokenList) {
      if (!weth || weth.address.toLowerCase() === token.address.toLowerCase()) continue;
      try {
        // UniswapV3はQuoterで取得
        if (dex.name === 'UniswapV3' && dex.quoterAddress && token.symbol === 'USDC') {
          const quoter = new ethers.Contract(dex.quoterAddress, QUOTER_ABI, provider);
          const amountIn = ethers.utils.parseUnits('1', weth.decimals);
          // QuoterV2用のstruct引数で呼び出し
          const params = {
            tokenIn: weth.address,
            tokenOut: token.address,
            amountIn: amountIn,
            fee: dex.fee,
            sqrtPriceLimitX96: 0
          };
          const quotedResult = await quoter.quoteExactInputSingle(params);
          // QuoterV2は複数返すので最初の値を使う
          const price = parseFloat(ethers.utils.formatUnits(quotedResult.amountOut || quotedResult[0], token.decimals));
          logger.info(`[${CONFIG.chainName}][${dex.name}] WETH price: $${price} (per 1 WETH)`);
          msg += `• WETH price: $${price} (per 1 WETH)\n`;
        } else if (token.symbol === 'USDC') {
          // UniswapV2等は従来通り
          const amountIn = ethers.utils.parseUnits('1', weth.decimals);
          const amounts = await dex.router.getAmountsOut(amountIn, [weth.address, token.address]);
          const price = parseFloat(ethers.utils.formatUnits(amounts[1], token.decimals));
          logger.info(`[${CONFIG.chainName}][${dex.name}] WETH price: $${price} (per 1 WETH)`);
          msg += `• WETH price: $${price} (per 1 WETH)\n`;
        }
      } catch (e) {
        if (token.symbol === 'USDC') {
          logger.warn(`[${CONFIG.chainName}][${dex.name}] WETH price取得失敗: ${e.message}`);
          msg += `• WETH price: price取得失敗\n`;
        }
      }
    }
  }
  await sendSlackNotification(msg);
}

// メインの実行関数
async function startBot() {
  logger.info('Starting arbitrage bot...');
  await sendSlackNotification(':rocket: Arbitrage Botが起動しました');

  const initialized = await initializeBot();
  if (!initialized) {
    logger.error('Failed to initialize bot. Exiting...');
    return;
  }

  // 監視DEX・トークン情報をSlack通知
  let dexMsg = '*監視DEX一覧*\n';
  for (const dex of CONFIG.dexes) {
    dexMsg += `• ${dex.name}\n  Router: \`${dex.routerAddress}\`\n  Factory: \`${dex.factoryAddress}\`\n`;
  }
  let tokenMsg = '*監視トークン一覧*\n';
  for (const token of tokenList) {
    tokenMsg += `• ${token.symbol} (${token.name || ''})\n  Address: \`${token.address}\`\n`;
  }
  await sendSlackNotification(`${dexMsg}\n${tokenMsg}`);

  // DEXごとの各トークン価格をログ・Slack通知
  await logAndNotifyDexTokenPrices();

  isRunning = true;
  schedulePeriodicTasks();
  
  // 毎日0時に収益レポートを生成
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const timeUntilMidnight = midnight.getTime() - now.getTime();
  
  setTimeout(() => {
    generateProfitReport();
    // 毎日定時に実行
    setInterval(generateProfitReport, 24 * 60 * 60 * 1000);
  }, timeUntilMidnight);
  
  logger.info('Bot started successfully. Monitoring for arbitrage opportunities...');
  await sendSlackNotification(':mag: Arbitrage Botが監視を開始しました');
}

// ボットの停止
async function stopBot() {
  logger.info('Stopping arbitrage bot...');
  isRunning = false;
  // 最終レポートを生成
  generateProfitReport();
  logger.info('Bot stopped');
  await sendSlackNotification(':stop_sign: Arbitrage Botが停止しました');
}

// プロセス終了時の処理
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await stopBot();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await stopBot();
  process.exit(0);
});

// エラーハンドリング
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  // クリティカルなエラーの場合はボットを再起動
  stopBot();
  setTimeout(() => {
    startBot();
  }, 60000); // 1分後に再起動
});

// メイン実行
startBot().catch(error => {
  logger.error('Error in main execution', { error: error.message, stack: error.stack });
  process.exit(1);
});
// scripts/deploy.js
const { ethers } = require("hardhat");
require('dotenv').config();

async function main() {
  console.log("Starting deployment...");
  
  // ネットワーク情報を取得
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  
  console.log(`Deploying to network: ${network.name} (chainId: ${network.chainId})`);
  console.log(`Deployer address: ${deployer.address}`);
  console.log(`Deployer balance: ${ethers.utils.formatEther(await deployer.getBalance())} ETH`);
  
  // AAVEレンディングプールアドレスプロバイダーの設定
  // ネットワークに応じて正しいアドレスを使用すること
  let lendingPoolAddressesProvider;
  
  if (network.chainId === 1) {
    // イーサリアムメインネット
    lendingPoolAddressesProvider = "0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5";
  } else if (network.chainId === 42161) {
    // Arbitrum
    lendingPoolAddressesProvider = "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb";
  } else if (network.chainId === 5) {
    // Goerli (テストネット)
    lendingPoolAddressesProvider = "0x5E52dEc931FFb32f609681B8438A51c675cc232d";
  } else {
    console.log("Warning: Unknown network, using default address provider");
    lendingPoolAddressesProvider = process.env.LENDING_POOL_ADDRESSES_PROVIDER;
  }
  
  if (!lendingPoolAddressesProvider) {
    throw new Error("Lending pool addresses provider not set");
  }
  
  console.log(`Using AAVE lending pool addresses provider: ${lendingPoolAddressesProvider}`);
  
  // MultiDexArbitrageBotコントラクトのデプロイ
  console.log("Deploying MultiDexArbitrageBot...");
  const ArbitrageBot = await ethers.getContractFactory("MultiDexArbitrageBot");
  const arbitrageBot = await ArbitrageBot.deploy(lendingPoolAddressesProvider);
  
  await arbitrageBot.deployed();
  console.log(`MultiDexArbitrageBot deployed to: ${arbitrageBot.address}`);
  
  // DEXの追加
  // ネットワークに応じて正しいアドレスを使用すること
  console.log("Initializing DEXes...");
  
  // Uniswap V2
  let uniswapRouter, uniswapFactory;
  
  if (network.chainId === 1) {
    // イーサリアムメインネット
    uniswapRouter = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
    uniswapFactory = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
  } else if (network.chainId === 42161) {
    // Arbitrum
    uniswapRouter = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; // 正しいアドレスに更新する必要があります
    uniswapFactory = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"; // 正しいアドレスに更新する必要があります
  } else {
    uniswapRouter = process.env.UNISWAP_ROUTER;
    uniswapFactory = process.env.UNISWAP_FACTORY;
  }
  
  if (uniswapRouter && uniswapFactory) {
    try {
      await arbitrageBot.addDex("UniswapV2", uniswapRouter, uniswapFactory);
      console.log("Added UniswapV2");
    } catch (error) {
      console.error("Failed to add UniswapV2:", error.message);
    }
  }
  
  // SushiSwap
  let sushiswapRouter, sushiswapFactory;
  
  if (network.chainId === 1) {
    // イーサリアムメインネット
    sushiswapRouter = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";
    sushiswapFactory = "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac";
  } else if (network.chainId === 42161) {
    // Arbitrum
    sushiswapRouter = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F"; // 正しいアドレスに更新する必要があります
    sushiswapFactory = "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac"; // 正しいアドレスに更新する必要があります
  } else {
    sushiswapRouter = process.env.SUSHISWAP_ROUTER;
    sushiswapFactory = process.env.SUSHISWAP_FACTORY;
  }
  
  if (sushiswapRouter && sushiswapFactory) {
    try {
      await arbitrageBot.addDex("SushiSwap", sushiswapRouter, sushiswapFactory);
      console.log("Added SushiSwap");
    } catch (error) {
      console.error("Failed to add SushiSwap:", error.message);
    }
  }
  
  // パラメータ設定
  console.log("Setting parameters...");
  try {
    await arbitrageBot.updateParameters(
      100, // minProfitPercent: 0.1%
      ethers.utils.parseUnits("100", "gwei"), // maxGasPrice
      20 // minReserveRatio: 2%
    );
    console.log("Parameters updated");
  } catch (error) {
    console.error("Failed to update parameters:", error.message);
  }
  
  console.log("Deployment and initialization complete!");
  console.log(`Contract address: ${arbitrageBot.address}`);
  console.log("Don't forget to update your .env and config.js files with the new contract address.");
  
  // デプロイ情報をファイルに保存
  const fs = require('fs');
  const deployInfo = {
    network: network.name,
    chainId: network.chainId,
    contractAddress: arbitrageBot.address,
    deployerAddress: deployer.address,
    deploymentTime: new Date().toISOString(),
    dexes: [
      {
        name: "UniswapV2",
        router: uniswapRouter,
        factory: uniswapFactory
      },
      {
        name: "SushiSwap",
        router: sushiswapRouter,
        factory: sushiswapFactory
      }
    ]
  };
  
  fs.writeFileSync(
    `deployment-${network.name}-${new Date().toISOString().replace(/:/g, '-')}.json`,
    JSON.stringify(deployInfo, null, 2)
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

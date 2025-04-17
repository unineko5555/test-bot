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
  
  // AAVE V3レンディングプールアドレスプロバイダーの設定
  // ネットワークに応じて正しいアドレスを使用すること
  let lendingPoolAddressesProvider;
  
  if (network.chainId === 1) {
    // イーサリアムメインネット
    lendingPoolAddressesProvider = "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e";
  } else if (network.chainId === 42161) {
    // Arbitrum
    lendingPoolAddressesProvider = "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb";
  } else if (network.chainId === 11155111) {
    // Sepolia (テストネット)
    lendingPoolAddressesProvider = "0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A";
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

  // --- ガス見積もり追加 ---
  const deployTx = ArbitrageBot.getDeployTransaction(lendingPoolAddressesProvider);
  const estimatedGas = await deployer.estimateGas(deployTx);
  const gasPrice = await ethers.provider.getGasPrice();
  const ethNeeded = estimatedGas.mul(gasPrice);
  console.log(`Estimated gas: ${estimatedGas.toString()} (gas)`);
  console.log(`Gas price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} Gwei`);
  console.log(`Estimated ETH needed: ${ethers.utils.formatEther(ethNeeded)} ETH`);
  // ---

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
    uniswapRouter = "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24";
    uniswapFactory = "0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9"; 
  } else if (network.chainId === 11155111) {
    // Sepolia (テストネット)
    uniswapRouter = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3"; 
    uniswapFactory = "0xF62c03E08ada871A0bEb309762E260a7a6a880E6"; 
  } else {
    // その他のネットワークの場合、環境変数から取得
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
  
  // Uniswap V3
  let uniswapV3Router, uniswapV3Factory;
  
  if (network.chainId === 1) {
    // イーサリアムメインネット
    uniswapV3Router = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
    uniswapV3Factory = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
  } else if (network.chainId === 42161) {
    // Arbitrum
    uniswapV3Router = "0xE592427A0AEce92De3Edee1F18E0157C05861564"; 
    uniswapV3Factory = "0x1F98431c8aD98523631AE4a59f267346ea31F984"; 
  } else if (network.chainId === 11155111) {
    // Sepolia (テストネット)
    uniswapV3Router = ""; // 存在しない
    uniswapV3Factory = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c"; 
  } else {
    // その他のネットワークの場合、環境変数から取得
    uniswapV3Router = process.env.UNISWAP_V3_ROUTER;
    uniswapV3Factory = process.env.UNISWAP_V3_FACTORY;
  }
  
  if (uniswapV3Router && uniswapV3Factory) {
    try {
      await arbitrageBot.addDex("UniswapV3", uniswapV3Router, uniswapV3Factory);
      console.log("Added UniswapV3");
    } catch (error) {
      console.error("Failed to add UniswapV3:", error.message);
    }
  }
  
  // パラメータ設定
  console.log("Setting parameters...");
  try {
// minProfitPercent, maxGasPrice, minReserveRatio の型・単位に注意
    await arbitrageBot.updateParameters(
      100, // minProfitPercent: 0.1%（コントラクト側の単位に合わせて整数で渡す）
      ethers.BigNumber.from("100000000000"), // maxGasPrice: 100 * 1e9 (100 gwei)
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
        name: "UniswapV3",
        router: uniswapV3Router,
        factory: uniswapV3Factory
      }
    ]
  };
  const outPath = `deployment-${network.name}-${new Date().toISOString().replace(/:/g, '-')}.json`;
  fs.writeFileSync(outPath, JSON.stringify(deployInfo, null, 2));
  console.log(`Deployment info saved to: ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

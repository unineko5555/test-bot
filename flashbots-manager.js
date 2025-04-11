// flashbots-manager.js
const ethers = require('ethers');

/**
 * Flashbotsとの統合を管理するクラス
 * フロントランニング対策とMEV保護を提供します
 */
class FlashbotsManager {
  constructor(logger, config) {
    this.logger = logger;
    this.config = config;
    this.flashbotsProvider = null;
    this.authSigner = null;
    this.supportedNetworks = [1, 5, 11155111]; // mainnet, goerli, sepolia
  }

  /**
   * Flashbotsプロバイダーの初期化
   * @param {Object} provider Ethersプロバイダー
   * @param {Object} wallet Ethersウォレット
   * @return {Boolean} 初期化が成功したかどうか
   */
  async initialize(provider, wallet) {
    try {
      // Flashbotsが利用可能か確認
      try {
        require.resolve('@flashbots/ethers-provider-bundle');
      } catch (e) {
        this.logger.warn('Flashbots package not found. Please install: npm install @flashbots/ethers-provider-bundle');
        return false;
      }

      const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');
      
      // ネットワークの確認
      const network = await provider.getNetwork();
      this.chainId = network.chainId;
      
      // Flashbotsがサポートするネットワークか確認
      if (!this.supportedNetworks.includes(this.chainId)) {
        this.logger.warn(`Flashbots is not supported on network ${network.name} (chainId: ${this.chainId})`);
        return false;
      }
      
      // 認証用の署名者を作成（プライベートキーは本番環境では安全に管理すること）
      this.authSigner = new ethers.Wallet(
        this.config.flashbotsAuthKey || wallet.privateKey, 
        provider
      );
      
      // Flashbotsプロバイダーの初期化
      const flashbotsUrl = this.getFlashbotsUrl(this.chainId);
      this.flashbotsProvider = await FlashbotsBundleProvider.create(
        provider,
        this.authSigner,
        flashbotsUrl
      );
      
      this.logger.info(`Flashbots provider initialized for ${network.name}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to initialize Flashbots provider', { error: error.message });
      return false;
    }
  }

  /**
   * チェーンIDに基づいてFlashbotsのURLを取得
   * @param {Number} chainId チェーンID
   * @return {String} FlashbotsのURL
   */
  getFlashbotsUrl(chainId) {
    switch (chainId) {
      case 1: // mainnet
        return 'https://relay.flashbots.net';
      case 5: // goerli
        return 'https://relay-goerli.flashbots.net';
      case 11155111: // sepolia
        return 'https://relay-sepolia.flashbots.net';
      default:
        return 'https://relay.flashbots.net'; // デフォルトはmainnet
    }
  }

  /**
   * トランザクションのシミュレーション
   * @param {Object} transaction トランザクションオブジェクト
   * @param {Object} wallet 署名者ウォレット
   * @param {Number} targetBlock 対象ブロック番号
   * @return {Object} シミュレーション結果
   */
  async simulateTransaction(transaction, wallet, targetBlock) {
    if (!this.flashbotsProvider) {
      throw new Error('Flashbots provider not initialized');
    }
    
    try {
      const signedBundle = await this.flashbotsProvider.signBundle([
        {
          signer: wallet,
          transaction: transaction
        }
      ]);
      
      const simulation = await this.flashbotsProvider.simulate(
        signedBundle,
        targetBlock
      );
      
      if ('error' in simulation) {
        this.logger.error(`Simulation error: ${simulation.error.message}`);
        return {
          success: false,
          error: simulation.error.message
        };
      }
      
      return {
        success: true,
        gasUsed: simulation.totalGasUsed,
        value: simulation.coinbaseDiff.toString(),
        results: simulation.results
      };
    } catch (error) {
      this.logger.error('Simulation failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * バンドルの送信
   * @param {Object} transaction トランザクションオブジェクト
   * @param {Object} wallet 署名者ウォレット
   * @param {Number} targetBlock 対象ブロック番号（オプション）
   * @param {Number} maxBlocks 最大ブロック数（オプション）
   * @return {Object} 送信結果
   */
  async sendBundle(transaction, wallet, targetBlock = null, maxBlocks = 5) {
    if (!this.flashbotsProvider) {
      throw new Error('Flashbots provider not initialized');
    }
    
    try {
      // 対象ブロックが指定されていない場合は現在のブロック+1
      if (!targetBlock) {
        const provider = this.flashbotsProvider.provider;
        const blockNumber = await provider.getBlockNumber();
        targetBlock = blockNumber + 1;
      }
      
      const signedBundle = await this.flashbotsProvider.signBundle([
        {
          signer: wallet,
          transaction: transaction
        }
      ]);
      
      // 複数のブロックに送信（maxBlocksで指定されたブロック数だけ試行）
      const bundleSubmissions = [];
      
      for (let i = 0; i < maxBlocks; i++) {
        const targetBlockNumber = targetBlock + i;
        const bundleSubmission = await this.flashbotsProvider.sendBundle(
          signedBundle,
          targetBlockNumber
        );
        
        bundleSubmissions.push({
          targetBlock: targetBlockNumber,
          submission: bundleSubmission
        });
        
        // バンドルの状態をモニタリング
        bundleSubmission.wait()
          .then(waitResponse => {
            this.handleBundleResolution(waitResponse, targetBlockNumber);
          })
          .catch(error => {
            this.logger.error(`Bundle error for block ${targetBlockNumber}`, { error: error.message });
          });
      }
      
      return {
        success: true,
        bundleSubmissions,
        firstTargetBlock: targetBlock
      };
    } catch (error) {
      this.logger.error('Failed to send bundle', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * バンドル解決のハンドリング
   * @param {Number} waitResponse 待機レスポンス
   * @param {Number} targetBlock 対象ブロック
   */
  handleBundleResolution(waitResponse, targetBlock) {
    switch (waitResponse) {
      case 0: // 成功
        this.logger.info(`Bundle included in block ${targetBlock}`);
        break;
      case 1: // ブロックがマイニングされたがバンドルは含まれなかった
        this.logger.info(`Block ${targetBlock} mined without bundle`);
        break;
      case 2: // ブロックがマイニングされなかった（アンクル）
        this.logger.info(`Block ${targetBlock} was uncled`);
        break;
      default:
        this.logger.warn(`Unknown bundle status for block ${targetBlock}: ${waitResponse}`);
    }
  }

  /**
   * MEV検出
   * @param {Number} blockNumber ブロック番号
   * @return {Object} 検出結果
   */
  async detectMEV(blockNumber) {
    try {
      const provider = this.flashbotsProvider?.provider || ethers.getDefaultProvider();
      const block = await provider.getBlock(blockNumber, true);
      
      if (!block || !block.transactions) {
        return { detected: false, reason: 'No transactions in block' };
      }
      
      // MEVの可能性がある取引パターンを検出
      // - 同一ブロック内での同一トークンペアの複数取引
      // - 高額なガス代を支払う取引
      const tokenInteractions = new Map();
      const highGasTxs = [];
      
      for (const tx of block.transactions) {
        // 入力データからトークン取引を検出（簡易実装）
        if (tx.data && tx.data.length >= 10) {
          const methodId = tx.data.substring(0, 10);
          
          // スワップ関連のメソッドシグネチャ（例）
          const swapSignatures = [
            '0x38ed1739', // swapExactTokensForTokens
            '0x8803dbee', // swapTokensForExactTokens
            '0x7ff36ab5', // swapExactETHForTokens
            '0x4a25d94a', // swapTokensForExactETH
            '0x18cbafe5', // swapExactTokensForETH
            '0xfb3bdb41', // swapETHForExactTokens
            '0x5c11d795'  // swapExactTokensForTokensSupportingFeeOnTransferTokens
          ];
          
          if (swapSignatures.includes(methodId)) {
            if (!tokenInteractions.has(tx.to)) {
              tokenInteractions.set(tx.to, []);
            }
            tokenInteractions.get(tx.to).push(tx.hash);
            
            // 高いガス価格の取引を記録
            const avgGasPrice = block.baseFeePerGas || ethers.BigNumber.from('0');
            if (tx.gasPrice && tx.gasPrice.gt(avgGasPrice.mul(2))) {
              highGasTxs.push({
                hash: tx.hash,
                gasPriceGwei: ethers.utils.formatUnits(tx.gasPrice, 'gwei'),
                gasUsed: tx.gasUsed?.toString() || 'unknown',
                valueEth: ethers.utils.formatEther(tx.value)
              });
            }
          }
        }
      }
      
      // MEVの検出
      const mevDetected = 
        Array.from(tokenInteractions.values()).some(txs => txs.length > 2) || // 同じDEXでの複数取引
        highGasTxs.length > 0; // 高いガス代を払っている取引がある
      
      return {
        detected: mevDetected,
        blockNumber,
        suspiciousContracts: Array.from(tokenInteractions.entries())
          .filter(([_, txs]) => txs.length > 2)
          .map(([contract, txs]) => ({ contract, transactionCount: txs.length })),
        highGasTransactions: highGasTxs
      };
    } catch (error) {
      this.logger.error('Failed to detect MEV', { error: error.message });
      return { detected: false, error: error.message };
    }
  }

  /**
   * オプティマルなガス設定を取得
   * @return {Object} ガス設定
   */
  async getOptimalGasSettings() {
    try {
      const provider = this.flashbotsProvider?.provider || ethers.getDefaultProvider();
      
      // EIP-1559サポートのチェック
      let eip1559Supported = false;
      try {
        const block = await provider.getBlock('latest');
        eip1559Supported = !!block.baseFeePerGas;
      } catch (error) {
        eip1559Supported = false;
      }
      
      if (eip1559Supported) {
        // EIP-1559ガス設定の計算
        const feeData = await provider.getFeeData();
        const baseFee = feeData.lastBaseFeePerGas;
        const priorityFee = feeData.maxPriorityFeePerGas;
        
        // MEV競争に勝つため、ベースフィーに120%を乗算
        const maxBaseFee = baseFee.mul(120).div(100);
        // 優先手数料も少し増やす
        const maxPriorityFee = priorityFee.mul(110).div(100);
        
        return {
          type: 'eip1559',
          maxFeePerGas: maxBaseFee.add(maxPriorityFee),
          maxPriorityFeePerGas: maxPriorityFee,
          baseFeePerGas: baseFee
        };
      } else {
        // 従来型のガス価格設定
        const gasPrice = await provider.getGasPrice();
        return {
          type: 'legacy',
          gasPrice: gasPrice.mul(110).div(100) // 10%増し
        };
      }
    } catch (error) {
      this.logger.error('Failed to get optimal gas settings', { error: error.message });
      // 安全なフォールバック
      return {
        type: 'legacy',
        gasPrice: ethers.utils.parseUnits('50', 'gwei')
      };
    }
  }
}

module.exports = FlashbotsManager;
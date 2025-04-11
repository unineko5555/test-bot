// profit-analyzer.js
const fs = require('fs');
const path = require('path');
const ethers = require('ethers');

/**
 * 利益分析と取引モニタリングを行うモジュール
 * アービトラージボットのリスク管理を強化します
 */
class ProfitAnalyzer {
  constructor(logger, config) {
    this.logger = logger;
    this.config = config;
    this.historicalData = [];
    this.errorThreshold = 0.1; // 10%の見積もり誤差を許容
    this.criticalErrorThreshold = 0.3; // 30%以上の誤差は危険とみなす
    this.statisticsPath = path.join(__dirname, 'profit-statistics.json');
    this.loadHistoricalData();
  }

  /**
   * 履歴データの読み込み
   */
  loadHistoricalData() {
    try {
      if (fs.existsSync(this.statisticsPath)) {
        const data = fs.readFileSync(this.statisticsPath, 'utf8');
        this.historicalData = JSON.parse(data);
        this.logger.info(`Loaded ${this.historicalData.length} historical profit records`);
      }
    } catch (error) {
      this.logger.error('Failed to load historical data', { error: error.message });
      this.historicalData = [];
    }
  }

  /**
   * データの保存
   */
  saveHistoricalData() {
    try {
      fs.writeFileSync(
        this.statisticsPath,
        JSON.stringify(this.historicalData, null, 2)
      );
    } catch (error) {
      this.logger.error('Failed to save historical data', { error: error.message });
    }
  }

  /**
   * 見積もり精度の分析
   * @param {Object} tradeData 取引データ
   * @return {Object} 分析結果
   */
  analyzeEstimationAccuracy(tradeData) {
    const { estimated, actual, pair, timestamp } = tradeData;
    
    if (!estimated || !actual) {
      return { accurate: false, error: 'Missing data' };
    }
    
    const errorRatio = Math.abs(estimated - actual) / estimated;
    const errorPercent = errorRatio * 100;
    
    // 記録を追加
    this.historicalData.push({
      timestamp,
      pair,
      estimated,
      actual,
      errorRatio
    });
    
    // 直近10件のみ保持（オプション）
    if (this.historicalData.length > 100) {
      this.historicalData = this.historicalData.slice(-100);
    }
    
    this.saveHistoricalData();
    
    // 分析結果
    return {
      accurate: errorRatio <= this.errorThreshold,
      critical: errorRatio > this.criticalErrorThreshold,
      errorRatio,
      errorPercent: errorPercent.toFixed(2),
      message: `Estimation accuracy: ${(100 - errorPercent).toFixed(2)}%`
    };
  }

  /**
   * スリッページ分析
   * @param {Object} swapData スワップデータ
   * @return {Object} 分析結果
   */
  analyzeSlippage(swapData) {
    const { expected, received, tokenSymbol } = swapData;
    
    if (!expected || !received) {
      return { acceptable: false, error: 'Missing data' };
    }
    
    const slippageRatio = (expected - received) / expected;
    const slippagePercent = slippageRatio * 100;
    
    return {
      acceptable: slippageRatio <= (this.config.slippageTolerance / 100),
      slippageRatio,
      slippagePercent: slippagePercent.toFixed(2),
      message: `Slippage for ${tokenSymbol}: ${slippagePercent.toFixed(2)}%`
    };
  }

  /**
   * リスク評価
   * @return {Object} リスク評価結果
   */
  assessRisk() {
    if (this.historicalData.length < 5) {
      return { level: 'unknown', message: 'Not enough historical data' };
    }
    
    // 直近10件の平均誤差
    const recentTrades = this.historicalData.slice(-10);
    const avgError = recentTrades.reduce((sum, trade) => sum + trade.errorRatio, 0) / recentTrades.length;
    
    // 誤差の標準偏差
    const variance = recentTrades.reduce((sum, trade) => {
      return sum + Math.pow(trade.errorRatio - avgError, 2);
    }, 0) / recentTrades.length;
    const stdDev = Math.sqrt(variance);
    
    let riskLevel, message;
    
    if (avgError > this.criticalErrorThreshold) {
      riskLevel = 'high';
      message = 'High risk: Large average estimation error';
    } else if (avgError > this.errorThreshold) {
      riskLevel = 'medium';
      message = 'Medium risk: Significant estimation error';
    } else if (stdDev > 0.2) {
      riskLevel = 'medium';
      message = 'Medium risk: Volatile estimation accuracy';
    } else {
      riskLevel = 'low';
      message = 'Low risk: Consistent estimation accuracy';
    }
    
    return {
      level: riskLevel,
      avgError: (avgError * 100).toFixed(2),
      stdDev: (stdDev * 100).toFixed(2),
      message
    };
  }

  /**
   * 先行取引（フロントランニング）の検出
   * @param {Object} txData トランザクションデータ
   * @return {Boolean} フロントランニングの可能性
   */
  detectFrontrunning(txData) {
    const { gasPrice, expectedGasPrice, timestamp, blockNumber } = txData;
    
    // ガス価格が予想より著しく高い場合はフロントランの可能性
    const gasPriceRatio = gasPrice / expectedGasPrice;
    
    return {
      suspected: gasPriceRatio > 1.5,
      gasPriceRatio: gasPriceRatio.toFixed(2),
      message: gasPriceRatio > 1.5 
        ? `Possible frontrunning detected: Gas price ${gasPriceRatio.toFixed(2)}x higher than expected` 
        : 'No frontrunning suspected'
    };
  }

  /**
   * 取引戦略の推奨
   * @return {Object} 推奨設定
   */
  recommendStrategy() {
    const risk = this.assessRisk();
    
    let recommendedSlippage, recommendedMinProfit, useMEVProtection;
    
    switch (risk.level) {
      case 'high':
        recommendedSlippage = 0.2; // 0.2%
        recommendedMinProfit = this.config.minProfitPercent * 2;
        useMEVProtection = true;
        break;
      case 'medium':
        recommendedSlippage = 0.5; // 0.5%
        recommendedMinProfit = this.config.minProfitPercent * 1.5;
        useMEVProtection = true;
        break;
      case 'low':
      default:
        recommendedSlippage = 1.0; // 1.0%
        recommendedMinProfit = this.config.minProfitPercent;
        useMEVProtection = this.config.useFlashbots;
        break;
    }
    
    return {
      recommendedSlippage,
      recommendedMinProfit,
      useMEVProtection,
      message: `Based on current risk (${risk.level}): Set slippage to ${recommendedSlippage}%, min profit to ${recommendedMinProfit}%`
    };
  }

  /**
   * 取引レポートの生成
   */
  generateTradeReport() {
    if (this.historicalData.length === 0) {
      return { error: 'No historical data available' };
    }
    
    // 最新の10件
    const recentTrades = this.historicalData.slice(-10);
    
    // 利益計算
    const totalEstimated = recentTrades.reduce((sum, trade) => sum + trade.estimated, 0);
    const totalActual = recentTrades.reduce((sum, trade) => sum + trade.actual, 0);
    
    // 平均誤差
    const avgError = recentTrades.reduce((sum, trade) => sum + trade.errorRatio, 0) / recentTrades.length;
    
    // トークンペアごとの集計
    const pairStats = {};
    this.historicalData.forEach(trade => {
      if (!pairStats[trade.pair]) {
        pairStats[trade.pair] = {
          count: 0,
          totalProfit: 0,
          avgError: 0,
          totalError: 0
        };
      }
      
      pairStats[trade.pair].count++;
      pairStats[trade.pair].totalProfit += trade.actual;
      pairStats[trade.pair].totalError += trade.errorRatio;
    });
    
    // 平均を計算
    Object.keys(pairStats).forEach(pair => {
      pairStats[pair].avgProfit = pairStats[pair].totalProfit / pairStats[pair].count;
      pairStats[pair].avgError = pairStats[pair].totalError / pairStats[pair].count;
    });
    
    // 最も収益性の高いペアを特定
    const pairRanking = Object.keys(pairStats)
      .map(pair => ({
        pair,
        avgProfit: pairStats[pair].avgProfit,
        count: pairStats[pair].count,
        avgError: pairStats[pair].avgError
      }))
      .sort((a, b) => b.avgProfit - a.avgProfit);
    
    return {
      tradeCount: this.historicalData.length,
      recentTrades: {
        count: recentTrades.length,
        totalEstimated,
        totalActual,
        avgError: (avgError * 100).toFixed(2) + '%',
        profitAccuracy: ((totalActual / totalEstimated) * 100).toFixed(2) + '%'
      },
      topPairs: pairRanking.slice(0, 5),
      risk: this.assessRisk(),
      recommendation: this.recommendStrategy()
    };
  }
}

module.exports = ProfitAnalyzer;
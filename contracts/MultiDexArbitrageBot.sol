// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title MultiDexArbitrageBot
 * @dev 複数のDEX間でアービトラージを実行するスマートコントラクト
 * 特徴:
 * - マルチホップスワップのサポート
 * - 複数DEXの自動検出
 * - ガス最適化
 * - 安全性強化
 */
contract MultiDexArbitrageBot is FlashLoanSimpleReceiverBase, Ownable, ReentrancyGuard {
    // DEXインターフェース
    struct DexRouter {
        IUniswapV2Router02 router;
        IUniswapV2Factory factory;
        string name;
        bool active;
    }
    
    // アービトラージルート
    struct ArbitrageRoute {
        address[] path;
        uint8[] dexIndices; // どのDEXを使用するかのインデックス
        uint256 expectedProfit;
        uint256 timestamp;
    }
    
    // イベント
    event ArbitrageExecuted(
        address indexed tokenA,
        address indexed tokenB,
        uint256 amountIn,
        uint256 amountOut,
        uint256 profit,
        uint256 timestamp
    );
    
    event ArbitrageFailed(
        address indexed tokenA,
        address indexed tokenB,
        string reason,
        uint256 timestamp
    );
    
    event DexAdded(string name, address router, address factory);
    event DexStatusChanged(string name, bool active);
    
    // DEXリスト
    DexRouter[] public dexRouters;
    
    // アクティブなトークンペア
    mapping(address => mapping(address => bool)) public activePairs;
    
    // 設定
    uint256 public minProfitPercent = 100; // 0.1% = 1/1000
    uint256 public maxGasPrice = 100 gwei;
    uint256 public minReserveRatio = 20; // 2%
    
    // プロテクション
    bool private _paused;
    
    constructor(
        address _aaveLendingPoolAddressesProvider
    ) FlashLoanSimpleReceiverBase(_aaveLendingPoolAddressesProvider) Ownable() ReentrancyGuard() {
        _paused = false;
    }
    
    /**
     * @dev DEXをルーターリストに追加
     */
    function addDex(
        string memory name,
        address routerAddress,
        address factoryAddress
    ) external onlyOwner {
        IUniswapV2Router02 router = IUniswapV2Router02(routerAddress);
        IUniswapV2Factory factory = IUniswapV2Factory(factoryAddress);
        
        dexRouters.push(DexRouter({
            router: router,
            factory: factory,
            name: name,
            active: true
        }));
        
        emit DexAdded(name, routerAddress, factoryAddress);
    }
    
    /**
     * @dev DEXのアクティブ状態を変更
     */
    function setDexStatus(uint8 dexIndex, bool active) external onlyOwner {
        require(dexIndex < dexRouters.length, "Invalid DEX index");
        dexRouters[dexIndex].active = active;
        emit DexStatusChanged(dexRouters[dexIndex].name, active);
    }
    
    /**
     * @dev トークンペアのアクティブ状態を設定
     */
    function setActivePair(address tokenA, address tokenB, bool active) external onlyOwner {
        activePairs[tokenA][tokenB] = active;
        activePairs[tokenB][tokenA] = active;
    }
    
    /**
     * @dev 設定パラメータを更新
     */
    function updateParameters(
        uint256 _minProfitPercent,
        uint256 _maxGasPrice,
        uint256 _minReserveRatio
    ) external onlyOwner {
        minProfitPercent = _minProfitPercent;
        maxGasPrice = _maxGasPrice;
        minReserveRatio = _minReserveRatio;
    }
    
    /**
     * @dev 緊急停止モードの切り替え
     */
    function togglePause() external onlyOwner {
        _paused = !_paused;
    }
    
    /**
     * @dev パウズ状態の確認
     */
    function isPaused() external view returns (bool) {
        return _paused;
    }
    
    /**
     * @dev トークンペア間の最適なアービトラージ経路を探索し実行
     */
    function executeArbitrage(
        address tokenA, 
        address tokenB,
        uint256 amountIn,
        ArbitrageRoute calldata route
    ) external onlyOwner nonReentrant {
        // フロントランニング対策: 取引期限を厳密に設定
        require(block.timestamp - route.timestamp < 2 minutes, "Route too old, frontrunning risk");
        require(!_paused, "Contract is paused");
        require(tokenA != tokenB, "Same tokens");
        require(activePairs[tokenA][tokenB], "Pair not active");
        require(block.timestamp <= route.timestamp + 5 minutes, "Route expired");
        require(tx.gasprice <= maxGasPrice, "Gas price too high");
        
        bytes memory params = abi.encode(
            tokenB,
            route,
            amountIn
        );
        
        // フラッシュローン実行
        POOL.flashLoanSimple(
            address(this),
            tokenA,
            amountIn,
            params,
            0 // referralCode
        );
    }
    
    /**
     * @dev ネイティブトークンでのアービトラージ（ETH、BNB等）
     */
    function executeArbitrageWithNative(
        address tokenB,
        ArbitrageRoute calldata route
    ) external payable onlyOwner nonReentrant {
        require(!_paused, "Contract is paused");
        require(msg.value > 0, "No ETH sent");
        require(activePairs[dexRouters[0].router.WETH()][tokenB], "Pair not active");
        require(block.timestamp <= route.timestamp + 5 minutes, "Route expired");
        require(tx.gasprice <= maxGasPrice, "Gas price too high");
        
        address tokenA = dexRouters[0].router.WETH();
        uint256 amountIn = msg.value;
        
        // WETHにラップ
        address weth = dexRouters[0].router.WETH();
        // solhint-disable-next-line avoid-low-level-calls
        (bool success,) = weth.call{value: amountIn}(abi.encodeWithSignature("deposit()"));
        require(success, "ETH wrap failed");
        
        // マルチホップスワップ実行
        uint256 initialBalance = IERC20(tokenA).balanceOf(address(this));
        bool success = executeSwaps(tokenA, tokenB, amountIn, route);
        
        if (success) {
            uint256 finalBalance = IERC20(tokenA).balanceOf(address(this));
            require(finalBalance > initialBalance, "No profit generated");
            uint256 profit = finalBalance - initialBalance;
            
            // WETHからETHに変換
            IERC20(weth).approve(address(dexRouters[0].router), finalBalance);
            dexRouters[0].router.swapExactTokensForETH(
                finalBalance,
                0,
                getPathForTokenToEth(weth),
                msg.sender,
                block.timestamp
            );
            
            emit ArbitrageExecuted(
                tokenA,
                tokenB,
                amountIn,
                finalBalance,
                profit,
                block.timestamp
            );
        } else {
            // 失敗した場合はETHを返す
            // solhint-disable-next-line avoid-low-level-calls
            (bool unwrapSuccess,) = weth.call(abi.encodeWithSignature("withdraw(uint256)", amountIn));
            require(unwrapSuccess, "ETH unwrap failed");
            payable(msg.sender).transfer(amountIn);
            
            emit ArbitrageFailed(
                tokenA,
                tokenB,
                "Swap execution failed",
                block.timestamp
            );
        }
    }
    
    /**
     * @dev フラッシュローンコールバック
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "Caller is not POOL");
        require(initiator == owner(), "Initiator is not owner");
        
        (
            address tokenB,
            ArbitrageRoute memory route,
            uint256 amountIn
        ) = abi.decode(params, (address, ArbitrageRoute, uint256));
        
        uint256 totalDebt = amount + premium;
        
        // 初期残高確認
        uint256 initialBalance = IERC20(asset).balanceOf(address(this));
        require(initialBalance >= amount, "Insufficient loan received");
        
        // 取引前にシミュレーションを実行して利益を確認
        bool profitable = simulateArbitrage(asset, tokenB, amount, route);
        require(profitable, "Simulation shows no profit");
        
        // マルチホップスワップ実行
        bool success = executeSwaps(asset, tokenB, amount, route);
        
        if (success) {
            // 最終残高確認
            uint256 finalBalance = IERC20(asset).balanceOf(address(this));
            require(finalBalance >= totalDebt, "Insufficient funds to repay");
            
            // 利益計算
            uint256 profit = finalBalance - totalDebt;
            uint256 minProfit = amount * minProfitPercent / 100000; // 例: 0.1%
            
            require(profit >= minProfit, "Profit below threshold");
            
            // フラッシュローン返済承認
            IERC20(asset).approve(address(POOL), totalDebt);
            
            // 利益をオーナーに送信
            if (profit > 0) {
                IERC20(asset).transfer(owner(), profit);
            }
            
            emit ArbitrageExecuted(
                asset,
                tokenB,
                amount,
                finalBalance,
                profit,
                block.timestamp
            );
        } else {
            emit ArbitrageFailed(
                asset,
                tokenB,
                "Swap execution failed",
                block.timestamp
            );
        }
        
        return true;
    }
    
    /**
     * @dev マルチホップスワップを実行
     */
    function executeSwaps(
        address tokenA,
        address tokenB,
        uint256 amountIn,
        ArbitrageRoute memory route
    ) internal returns (bool) {
        require(route.path.length >= 2, "Invalid path length");
        require(route.path.length == route.dexIndices.length + 1, "Path/DEX indices mismatch");
        
        address currentToken = tokenA;
        uint256 currentAmount = amountIn;
        
        for (uint i = 0; i < route.dexIndices.length; i++) {
            uint8 dexIndex = route.dexIndices[i];
            require(dexIndex < dexRouters.length, "Invalid DEX index");
            require(dexRouters[dexIndex].active, "DEX not active");
            
            address nextToken = route.path[i + 1];
            
            // スワップ前の残高確認
            uint256 preBalance = IERC20(nextToken).balanceOf(address(this));
            
            // DEXごとに適切なスワップ方法を選択
            DexRouter memory dex = dexRouters[dexIndex];
            
            // トークン承認
            IERC20(currentToken).approve(address(dex.router), 0);
            IERC20(currentToken).approve(address(dex.router), currentAmount);
            
            // スリッページ保護のための最低受け取り量を計算
            address[] memory tempPath = new address[](2);
            tempPath[0] = currentToken;
            tempPath[1] = nextToken;
            
            uint256[] memory amountsOut = dex.router.getAmountsOut(currentAmount, tempPath);
            uint256 minAmountOut = amountsOut[1] * (10000 - 50) / 10000; // 0.5%のスリッページ許容
            
            try dex.router.swapExactTokensForTokens(
                currentAmount,
                minAmountOut, // 最低受け取り量を設定
                tempPath,
                address(this),
                block.timestamp
            ) returns (uint256[] memory amounts) {
                // スワップ後の残高確認
                uint256 postBalance = IERC20(nextToken).balanceOf(address(this));
                uint256 swappedAmount = postBalance - preBalance;
                
                require(swappedAmount > 0, "Zero swap amount");
                
                // スワップ次第に現在のトークンと量を更新
                currentToken = nextToken;
                currentAmount = swappedAmount;
            } catch {
                return false;
            }
        }
        
        // 最終トークンが開始トークンと同じであることを確認（ループの場合）
        if (tokenA == tokenB) {
            require(currentToken == tokenA, "Path does not form a loop");
        } else {
            // 最終トークンを開始トークンに戻す
            try swapTokensBack(currentToken, tokenA, currentAmount) returns (uint256 finalAmount) {
                currentAmount = finalAmount;
            } catch {
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * @dev 最終トークンを初期トークンに戻す（必要な場合）
     */
    function swapTokensBack(
        address fromToken,
        address toToken,
        uint256 amount
    ) internal returns (uint256) {
        // 最適なDEXを検索
        uint8 bestDexIndex = findBestDexForSwap(fromToken, toToken, amount);
        DexRouter memory dex = dexRouters[bestDexIndex];
        
        // スワップ実行
        IERC20(fromToken).approve(address(dex.router), 0);
        IERC20(fromToken).approve(address(dex.router), amount);
        
        address[] memory path = new address[](2);
        path[0] = fromToken;
        path[1] = toToken;
        
        uint256 preBalance = IERC20(toToken).balanceOf(address(this));
        
        // スリッページ保護
        uint256[] memory expectedAmounts = dex.router.getAmountsOut(amount, path);
        uint256 minOut = expectedAmounts[1] * (10000 - 50) / 10000; // 0.5%のスリッページ許容
        
        uint256[] memory amounts = dex.router.swapExactTokensForTokens(
            amount,
            minOut,
            path,
            address(this),
            block.timestamp
        );
        
        uint256 postBalance = IERC20(toToken).balanceOf(address(this));
        return postBalance - preBalance;
    }
    
    /**
     * @dev トークンスワップに最適なDEXを検索
     */
    function findBestDexForSwap(
        address fromToken,
        address toToken,
        uint256 amount
    ) internal view returns (uint8) {
        uint256 bestOutput = 0;
        uint8 bestDexIndex = 0;
        
        for (uint8 i = 0; i < dexRouters.length; i++) {
            if (!dexRouters[i].active) continue;
            
            try dexRouters[i].router.getAmountsOut(
                amount,
                getPathForTokenToToken(fromToken, toToken)
            ) returns (uint256[] memory amounts) {
                if (amounts[amounts.length - 1] > bestOutput) {
                    bestOutput = amounts[amounts.length - 1];
                    bestDexIndex = i;
                }
            } catch {
                // このDEXでは利用できないペアの場合はスキップ
                continue;
            }
        }
        
        require(bestOutput > 0, "No valid DEX found");
        return bestDexIndex;
    }
    
    /**
     * @dev トークンからETHへのパスを取得
     */
    function getPathForTokenToEth(address weth) internal pure returns (address[] memory) {
        address[] memory path = new address[](2);
        path[0] = weth;
        path[1] = weth; // WETH→ETH
        return path;
    }
    
    /**
     * @dev トークン間のパスを取得
     */
    function getPathForTokenToToken(
        address tokenA,
        address tokenB
    ) internal pure returns (address[] memory) {
        address[] memory path = new address[](2);
        path[0] = tokenA;
        path[1] = tokenB;
        return path;
    }
    
    /**
     * @dev 残高確認用ヘルパー関数
     */
    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
    
    /**
     * @dev ERC20トークン救出関数
     */
    function rescueERC20(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).transfer(owner(), balance);
    }
    
    /**
     * @dev ネイティブコイン救出関数
     */
    function rescueETH() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
    
    /**
     * @dev 取引シミュレーション - 実際に実行せずに利益を計算
     */
    function simulateArbitrage(
        address tokenA,
        address tokenB,
        uint256 amountIn,
        ArbitrageRoute memory route
    ) internal view returns (bool) {
        address currentToken = tokenA;
        uint256 currentAmount = amountIn;
        uint256[] memory simulatedAmounts = new uint256[](route.path.length);
        simulatedAmounts[0] = amountIn;
        
        // 各ホップのシミュレーション
        for (uint i = 0; i < route.dexIndices.length; i++) {
            uint8 dexIndex = route.dexIndices[i];
            if (dexIndex >= dexRouters.length || !dexRouters[dexIndex].active) {
                return false;
            }
            
            address nextToken = route.path[i + 1];
            DexRouter memory dex = dexRouters[dexIndex];
            
            // 取引シミュレーション
            address[] memory tempPath = new address[](2);
            tempPath[0] = currentToken;
            tempPath[1] = nextToken;
            
            try dex.router.getAmountsOut(currentAmount, tempPath) returns (uint256[] memory amounts) {
                if (amounts[1] == 0) return false;
                currentAmount = amounts[1];
                simulatedAmounts[i + 1] = currentAmount;
                currentToken = nextToken;
            } catch {
                return false;
            }
        }
        
        // 利益計算
        if (tokenA == tokenB) {
            // ループ取引の場合
            return currentAmount > amountIn && 
                   currentAmount >= amountIn + (amountIn * minProfitPercent / 100000);
        } else {
            // 最終トークンを開始トークンに戻すシミュレーション
            try getBestOutputForSwap(currentToken, tokenA, currentAmount) returns (uint256 finalAmount) {
                uint256 totalDebt = amountIn; // フラッシュローン返済額
                if (msg.sender == address(POOL)) {
                    // プレミアム計算のシミュレーション (AAVEは通常0.09%)
                    totalDebt = amountIn + (amountIn * 9 / 10000);
                }
                
                return finalAmount > totalDebt && 
                       finalAmount >= totalDebt + (amountIn * minProfitPercent / 100000);
            } catch {
                return false;
            }
        }
    }
    
    /**
     * @dev 最適な出力量を取得（シミュレーション用）
     */
    function getBestOutputForSwap(
        address fromToken,
        address toToken,
        uint256 amount
    ) internal view returns (uint256) {
        uint256 bestOutput = 0;
        
        for (uint8 i = 0; i < dexRouters.length; i++) {
            if (!dexRouters[i].active) continue;
            
            try dexRouters[i].router.getAmountsOut(
                amount,
                getPathForTokenToToken(fromToken, toToken)
            ) returns (uint256[] memory amounts) {
                if (amounts[amounts.length - 1] > bestOutput) {
                    bestOutput = amounts[amounts.length - 1];
                }
            } catch {
                continue;
            }
        }
        
        return bestOutput;
    }
    
    /**
     * @dev 受け取り失敗を防ぐためのフォールバック
     */
    receive() external payable {}
}

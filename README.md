# Docker対応 Multi-DEX アービトラージボット

このプロジェクトは、複数の分散型取引所（DEX）間でのアービトラージ（価格差取引）を自動的に検出し、実行するボットシステムです。Aaveのフラッシュローンを活用して、資本効率の高い取引を行います。

## 特徴

- **マルチホップスワップ**: 複数のトークンを経由する複雑な取引経路をサポート
- **複数DEX対応**: UniswapやSushiSwapなど、異なるDEX間での取引を実行
- **フラッシュローン活用**: AAVEのフラッシュローンを利用して大きな取引量を実現
- **リスク管理**: 取引前シミュレーション、スリッページ保護、最低利益チェックなど
- **MEV保護**: Flashbotsとの統合による先行取引（フロントランニング）対策
- **詳細な分析**: 利益分析と取引モニタリング機能
- **自動検出**: 新しいトークンや取引ペアの自動検出と追加
- **Docker対応**: コンテナ化されたデプロイメントで安全かつ簡単に実行可能

## Dockerを使用したインストールと実行

### 前提条件

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

### 1. リポジトリのクローン

```bash
git clone https://github.com/yourusername/multi-dex-arbitrage-bot.git
cd multi-dex-arbitrage-bot
```

### 2. 環境設定

1. 設定ファイルのコピー

```bash
cp .env.example .env
cp docker-compose.override.example.yml docker-compose.override.yml
```

2. `.env` ファイルと `docker-compose.override.yml` を編集して実際の情報を設定
   - RPC URL
   - プライベートキー（安全に管理すること）
   - コントラクトアドレス（デプロイ後に設定）
   - その他のパラメータ

### 3. ABIファイルの準備

必要なABIファイルを `abis` ディレクトリに配置します。以下のファイルが必要です：
- MultiDexArbitrageBot.json
- UniswapV2Router.json
- UniswapV2Factory.json
- UniswapV2Pair.json
- ERC20.json

### 4. Dockerイメージのビルドと実行

```bash
# イメージをビルド
docker-compose build

# シミュレーションテストを実行（オプション）
docker-compose --profile test up simulation

# ボットを実行
docker-compose up -d arbitrage-bot
```

### 5. ログの確認

```bash
# ボットのログを確認
docker-compose logs -f arbitrage-bot
```

## スマートコントラクトのデプロイ

### Hardhatを使用したデプロイ

```bash
# Hardhatを使用してコントラクトをデプロイ
docker-compose run --rm arbitrage-bot npm run deploy
```

または、コンテナ外部からHardhatを使用する場合：

```bash
npm install
npx hardhat run scripts/deploy.js --network arbitrum
```

### デプロイ後の設定

1. デプロイされたコントラクトアドレスを `.env` ファイルと `config.js` に設定
2. DEXの追加とトークンペアのアクティブ化（デプロイスクリプトで自動化されています）

## 詳細な使用方法

### コマンド

```bash
# ボットの開始
docker-compose up -d arbitrage-bot

# ボットの停止
docker-compose stop arbitrage-bot

# ボットの再起動
docker-compose restart arbitrage-bot

# シミュレーションのみ実行
docker-compose --profile test up simulation

# ログの表示
docker-compose logs -f arbitrage-bot
```

### ヘルスチェック

ボットのヘルスチェックはDockerの`healthcheck`機能で自動的に実行されます。

```bash
# ヘルスステータスの確認
docker inspect --format='{{.State.Health.Status}}' arbitrage-bot
```

## セキュリティ対策

1. **プライベートキーの保護**:
   - `.env` ファイルは公開リポジトリにコミットしないでください
   - 本番環境では、Docker Secretsやボルト機能を使用してください

2. **コンテナのセキュリティ**:
   - 非rootユーザーでボットを実行
   - 最小限の権限を付与

3. **トランザクションの保護**:
   - フラッシュボット対応でMEV保護
   - 取引前シミュレーションで損失回避
   - スリッページ保護で予期しない価格変動から保護

## トラブルシューティング

### 一般的な問題

1. **RPC接続エラー**:
   - `.env` ファイルのRPC URLが正しいことを確認
   - プロバイダーのステータスを確認

2. **トランザクション失敗**:
   - ログを確認してリバート理由を特定
   - ガス代設定を確認
   - コントラクトのパラメータが適切に設定されているか確認

3. **コンテナ起動失敗**:
   - `docker-compose logs arbitrage-bot` でエラーを確認
   - 必要なファイルがすべて配置されているか確認
   - ABIファイルの形式が正しいか確認

4. **低い収益性**:
   - DEX間の価格差が小さい場合は収益が減少
   - ガス代が高すぎないか確認
   - 異なるトークンペアを試してみる

### ログ分析

ログ分析ツールを使用して、ボットのパフォーマンスを監視できます：

```bash
# ログをフィルタリングして利益情報を取得
docker-compose logs arbitrage-bot | grep "ArbitrageExecuted"

# エラーのみ表示
docker-compose logs arbitrage-bot | grep "Error\|Failed\|ArbitrageFailed"
```

## JavaScriptとPythonの比較

このプロジェクトではJavaScriptを使用していますが、以下の理由からこの選択をしました：

### JavaScriptの利点

1. **イーサリアムエコシステムとの統合**:
   - ethers.jsやweb3.jsの成熟したライブラリ
   - DEXの公式SDKが多くJavaScriptで提供されている
   - Hardhat/Truffle/Remixとの互換性

2. **非同期処理の取り扱い**:
   - Node.jsの非同期イベント駆動モデルはブロックチェーンの監視に最適
   - Promise、async/awaitの自然な統合

3. **Flashbots統合**:
   - Flashbots SDKはJavaScriptで提供
   - MEV保護機能の実装が容易

### Pythonを使用する場合の考慮点

Pythonは以下の点で優れており、特定のユースケースでは検討に値します：

1. **データ分析と機械学習**:
   - pandas、numpy、scikit-learnなどのライブラリを使用した高度な分析
   - 価格予測モデルや最適化アルゴリズムの実装が容易

2. **アルゴリズム開発**:
   - 複雑なルート検索アルゴリズムの開発に適している
   - 数学的計算の実装が直感的

3. **非同期処理**:
   - asyncioを使用した非同期処理が可能
   - web3.pyの開発が進んでいる

### ハイブリッドアプローチ

最適な戦略は、両方の言語の強みを活かすハイブリッドアプローチかもしれません：

- JavaScriptをブロックチェーン通信とトランザクション実行に使用
- Pythonをデータ分析とストラテジー最適化に使用
- APIやメッセージキューを使用して両方のコンポーネントを接続

## 技術的アーキテクチャ

このプロジェクトは以下のコンポーネントで構成されています：

1. **スマートコントラクト** (`contracts/MultiDexArbitrageBot.sol`):
   - フラッシュローン処理
   - マルチホップスワップ実行
   - 利益検証とトランザクション保護

2. **ボット管理システム** (`arbitrage-manager.js`):
   - 市場監視と機会検出
   - トランザクション生成と送信
   - 利益分析とリスク管理

3. **利益分析ツール** (`profit-analyzer.js`):
   - 取引結果の分析
   - リスク評価と戦略提案
   - 履歴データの管理

4. **フラッシュボット統合** (`flashbots-manager.js`):
   - MEV保護
   - プライベートトランザクション
   - 最適なガス戦略

5. **シミュレーションツール** (`test-simulation.js`):
   - コントラクト動作の検証
   - 利益予測の精度評価
   - リスク評価シナリオのテスト

## 将来の拡張計画

1. **クロスチェーンアービトラージ**:
   - 複数のチェーン間でのアービトラージ機会の活用
   - クロスチェーンブリッジの統合

2. **高度なアルゴリズム**:
   - 機械学習を使用した市場動向予測
   - グラフ理論を使用した最適経路探索

3. **追加DEXの統合**:
   - Balancer、Curve、Dodonなどのプロトコル対応
   - DEX集約型アプローチの採用

4. **ガバナンスシステム**:
   - パラメータ調整のためのDAOツール
   - 利益分配メカニズム

## ライセンス

MIT

## 免責事項

このソフトウェアは教育目的で提供されています。暗号通貨取引には重大なリスクが伴います。使用による損失について開発者は責任を負いません。使用する前に、十分な調査とリスク評価を行ってください。

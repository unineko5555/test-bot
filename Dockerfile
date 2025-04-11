FROM node:16-alpine

# セキュリティのため非root ユーザーを作成
RUN addgroup -g 1001 -S appuser && \
    adduser -u 1001 -S appuser -G appuser

# 作業ディレクトリの作成
WORKDIR /app

# パッケージの更新とセキュリティ強化
RUN apk --no-cache upgrade && \
    apk --no-cache add git curl bash python3 make g++ && \
    npm install -g npm@latest

# 依存関係の管理
COPY package*.json ./

# 依存関係のインストール
RUN npm ci --only=production

# その他必要なファイルのコピー
COPY . .

# ABIディレクトリの作成
RUN mkdir -p abis

# セキュリティのための所有権変更
RUN chown -R appuser:appuser /app

# 設定ファイルの例示
RUN cp -n config.example.js config.js || true

# 非rootユーザーに切り替え
USER appuser

# コンテナ実行時のコマンド
CMD ["node", "arbitrage-manager.js"]

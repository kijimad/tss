FROM node:22-slim

WORKDIR /app

# 各プロジェクトの依存をインストール
COPY dns/package.json dns/package-lock.json* dns/
COPY http/package.json http/package-lock.json* http/
COPY mdb/package.json mdb/package-lock.json* mdb/
COPY os/package.json os/package-lock.json* os/
COPY tsc/package.json tsc/package-lock.json* tsc/

RUN cd dns && npm install && \
    cd ../http && npm install && \
    cd ../mdb && npm install && \
    cd ../os && npm install && \
    cd ../tsc && npm install

# ソースコードをコピー
COPY dns/ dns/
COPY http/ http/
COPY mdb/ mdb/
COPY os/ os/
COPY tsc/ tsc/

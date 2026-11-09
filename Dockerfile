# ScoreBridge + Audiveris を1つのコンテナで動かす（Synology NAS / x86_64 向け）。
# Audiveris の .deb は Ubuntu 22.04/24.04 x86_64 向けのため、ベースは ubuntu:24.04。
FROM node:22-bookworm-slim AS nodesrc

FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl jq \
      fontconfig fonts-dejavu-core libfreetype6 libxrender1 libxtst6 libxi6 libx11-6 libxext6 \
    && rm -rf /var/lib/apt/lists/*

# Node.js は公式イメージから借りる（ビルド済みバイナリなのでglibcの上位互換で動く）
COPY --from=nodesrc /usr/local/ /usr/local/

# Audiveris: GitHubリリースから最新の ubuntu24.04 x86_64 の .deb を探してインストール。
# 特定のバージョンにしたい場合は --build-arg AUDIVERIS_VERSION=5.10.2 のように指定する。
ARG AUDIVERIS_VERSION=
RUN set -eux; \
    if [ -n "$AUDIVERIS_VERSION" ]; then \
      url="https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/Audiveris-${AUDIVERIS_VERSION}-ubuntu24.04-x86_64.deb"; \
    else \
      url="$(curl -fsSL 'https://api.github.com/repos/Audiveris/audiveris/releases?per_page=15' \
        | jq -r '[.[].assets[].browser_download_url | select(test("ubuntu24.04-x86_64.deb$"))][0]')"; \
    fi; \
    echo "Audiveris package: $url"; \
    test -n "$url" -a "$url" != "null"; \
    curl -fsSL -o /tmp/audiveris.deb "$url"; \
    for c in xdg-desktop-menu xdg-mime xdg-icon-resource xdg-desktop-icon; do \
      printf '#!/bin/sh\nexit 0\n' > /usr/local/bin/$c; chmod +x /usr/local/bin/$c; \
    done; \
    apt-get update; apt-get install -y /tmp/audiveris.deb; \
    rm -f /usr/local/bin/xdg-desktop-menu /usr/local/bin/xdg-mime /usr/local/bin/xdg-icon-resource /usr/local/bin/xdg-desktop-icon; \
    rm -rf /tmp/audiveris.deb /var/lib/apt/lists/*; \
    ls -l /opt/audiveris/bin/Audiveris

# OCR言語データ（コード記号・文字の認識用）。Audiveris は Tesseract のレガシーモデルが必要。
ENV TESSDATA_PREFIX=/opt/tessdata
RUN mkdir -p /opt/tessdata && \
    curl -fsSL -o /opt/tessdata/eng.traineddata https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata && \
    curl -fsSL -o /opt/tessdata/jpn.traineddata https://github.com/tesseract-ocr/tessdata/raw/main/jpn.traineddata

# Audiveris の設定・作業ファイル用（書き込み可能な場所）
ENV HOME=/data
RUN mkdir -p /data && chmod 777 /data

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV NODE_ENV=production \
    AUDIVERIS_CMD=/opt/audiveris/bin/Audiveris \
    JAVA_TOOL_OPTIONS="-Djava.awt.headless=true -Xmx1200m"
EXPOSE 3000
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]

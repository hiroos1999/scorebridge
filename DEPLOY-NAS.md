# NAS(Synology DS224+)で ScoreBridge + Audiveris を動かす

外出先の iPhone/iPad から、NASのVPN経由で使うための構成。ルーターのポート開放はしない（VPNのみ）。

## 1. NASにコピー（Macのターミナル）
```
rsync -av --exclude node_modules --exclude .next --exclude .git ~/scorebridge/ "/Volumes/homes/hiroo_s/docker/scorebridge/"
```
（Finderで NAS の `homes` に接続してある状態で実行）

## 2. Container Manager でビルド・起動
1. DSM → Container Manager → プロジェクト → 作成
2. 名前 `scorebridge`、パスに `homes/hiroo_s/docker/scorebridge`（`docker-compose.yml` のあるフォルダ）
3. 完了するとビルドが始まる（初回は10〜20分かかることがある）

## 3. 使う
- 家の中: `http://192.168.0.14:3002`
- 外出先: iPhone/iPadでNASのVPNをオンにして、同じアドレスを開く

## 4. 更新するとき
手順1をもう一度実行 → Container Manager でプロジェクトを「ビルド」して再起動。

## 困ったとき
- ビルドが途中で落ちる: NASのメモリ不足の可能性（DS224+の標準は2GB）。ログの最後を確認。
- Audiveris が見つからない: コンテナのログで `Audiveris package:` の行（取得したURL）を確認。
- OCR（コード記号の認識）が動かない: ログに `Installed OCR languages: eng,jpn` が出ているか確認。

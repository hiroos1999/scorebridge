This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## 楽譜画像/PDFの取り込み（Audiveris, localhostのみ）
1. https://github.com/Audiveris/audiveris/releases から Mac用 dmg（Apple Silicon: `macosx-arm64` / Intel: `macosx-x86_64`）を入手し、`Audiveris.app` を「アプリケーション」へ。初回は「システム設定 > プライバシーとセキュリティ > このまま開く」。Javaは同梱。
2. 既定パスは `/Applications/Audiveris.app/Contents/MacOS/Audiveris`。違う場合は `AUDIVERIS_CMD=/path/to/Audiveris npm run dev`。
3. 画面の「楽譜画像・PDFを取り込む」からJPEG/PNG/PDFを選択。失敗時はエラーと Audiveris のログが画面に出ます。

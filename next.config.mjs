// @ts-check

// 設定ファイルを .ts にすると、本番の `next start` がこのファイルをトランスパイルするためだけに
// SWCのネイティブバイナリを読み込み、そのまま常駐してメモリとスレッドを食う。.mjs ならその読み込みが
// 起きない。TypeScriptに戻さない（型は下のJSDocと `// @ts-check` で効いている）。

/** @type {import("next").NextConfig} */
const nextConfig = {
  // スマートフォンなど同一LANの端末からは <IP>.sslip.io で開く。IPは変わりうるためホスト名を直書きしない。
  //
  // ワイルドカードは "*" が1ラベル、"**" が複数ラベルに対応する。sslip.ioのホスト名は
  // IPがそのままラベルになる（192.168.2.114.sslip.io）ため、"*.sslip.io" では一致せず、
  // devサーバーがJSチャンクをブロックしてハイドレーションが完了しなくなる。
  allowedDevOrigins: ["**.sslip.io"],

  experimental: {
    serverActions: {
      // Server Actionの本文上限は既定で1MB。超えるとアクションに届く前に拒否され、service.tsの
      // 枚数・サイズ検証（分かりやすいエラー）まで処理が届かない。写真取込（createIntakeAction）と
      // 減算（analyzeConsumptionPhotosAction）は src/lib/intake/config.ts の
      // MAX_IMAGES_PER_BATCH(5) × MAX_IMAGE_BYTES(10MB) = 50MB まで受けるので、multipartの
      // 枠ぶんを足して60MBにする。.mjsからは.tsをimportできないため数値を直書きしている。
      // 上の2定数を変えたらここも直す。
      bodySizeLimit: "60mb",
    },
  },
};

export default nextConfig;

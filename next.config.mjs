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
};

export default nextConfig;

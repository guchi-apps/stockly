import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // スマートフォンなど同一LANの端末からは <IP>.sslip.io で開く。IPは変わりうるためホスト名を直書きしない。
  //
  // ワイルドカードは "*" が1ラベル、"**" が複数ラベルに対応する。sslip.ioのホスト名は
  // IPがそのままラベルになる（192.168.2.114.sslip.io）ため、"*.sslip.io" では一致せず、
  // devサーバーがJSチャンクをブロックしてハイドレーションが完了しなくなる。
  allowedDevOrigins: ["**.sslip.io"],
};

export default nextConfig;

/**
 * 写真の種類（#11）。**減らす量の出し方がこれで変わる**ので、利用者に選ばせて記録する。
 *
 * 画面（`"use client"`）からも読むため、ここには依存を持たせない
 * （`nav-items.ts`と同じ理由で、素のモジュールに置いておく）。
 * `enum`ではなく`as const`で書くのは、`node --test`がstrip-onlyモードで動くため
 * （[CLAUDE.md](../../../CLAUDE.md)「検証」）。
 */

export const CONSUMPTION_SCAN_KINDS = ["EMPTY_CONTAINER", "REMAINING", "SHELF"] as const;
export type ConsumptionScanKind = (typeof CONSUMPTION_SCAN_KINDS)[number];

export interface ScanKindDefinition {
  readonly label: string;
  /** 画面のタブの下に出す一行の説明。 */
  readonly hint: string;
  /** モデルへ渡す指示。**読み取ってほしいものだけを書き、商品や数量の判断をさせない。** */
  readonly prompt: string;
}

export const SCAN_KIND_DEFINITIONS: Readonly<Record<ConsumptionScanKind, ScanKindDefinition>> = {
  EMPTY_CONTAINER: {
    label: "空き容器",
    hint: "飲み終わった容器・使い切ったパッケージを撮る",
    prompt: [
      "空になった容器・パッケージの写真です。",
      "写っている商品ごとに、パッケージの商品名と、空になっている容器の数（containerCount）を報告してください。",
      "バーコードが読めれば barcode に入れてください。",
      "中身が残っているものは containerCount に数えないでください。",
    ].join("\n"),
  },
  REMAINING: {
    label: "残量",
    hint: "飲みかけ・使いかけの残りを撮る",
    prompt: [
      "使いかけの容器の写真です。",
      "写っている商品ごとに、パッケージの商品名と、いま容器に残っている割合（remainingRatio、0〜1）を報告してください。",
      "液面や中身が見えず割合を判断できない場合は remainingRatio を null にしてください。推測で埋めないでください。",
    ].join("\n"),
  },
  SHELF: {
    label: "棚",
    hint: "棚・冷蔵庫の中をまとめて撮る",
    prompt: [
      "棚や冷蔵庫の中の写真です。",
      "写っている商品ごとに、パッケージの商品名と、写真に見えている個数（visibleCount）を報告してください。",
      "奥に隠れていて数えられないものは visibleCount を null にしてください。",
      "同じ商品が複数の場所に写っている場合は、1件にまとめて数えてください。",
    ].join("\n"),
  },
};

export function isConsumptionScanKind(value: string): value is ConsumptionScanKind {
  return (CONSUMPTION_SCAN_KINDS as readonly string[]).includes(value);
}

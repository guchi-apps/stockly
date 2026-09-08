import {
  Backpack,
  Boxes,
  CalendarClock,
  Camera,
  History,
  LifeBuoy,
  MapPin,
  Menu,
  ScanLine,
  ShoppingCart,
} from "lucide-react";

/**
 * 在庫まわりの行き先の定義。
 *
 * **`app-nav.tsx`（`"use client"`）ではなくここに置く。** クライアントコンポーネントの
 * ファイルからexportした値は、サーバーコンポーネントから見るとクライアント参照のプロキシに
 * なり、配列として扱えない（`OVERFLOW_ITEMS.map is not a function`で落ちる）。
 * メニュー画面（`/menu`）はサーバーコンポーネントなので、データはこの素のモジュールに置く。
 *
 * **PCとスマホで出す数を変える。** 左の列（PC・iPad）は縦に伸びるだけなので全項目を並べるが、
 * 下タブ（スマホ）は画面幅を等分するため、増やすほど1つずつ細くなって押し分けられなくなる。
 * そこで下タブは5つで打ち止めにし、あふれる行き先は「メニュー」（`/menu`）へまとめる。
 *
 * **下タブに残すのは、スマホでしかできないことと毎日触るもの。** バーコード読取は
 * `navigator.mediaDevices`がhttpsかlocalhostでしか生えず**実質スマホ専用の入力導線**なので、
 * 下タブに残す（PCでは左ナビにあるので、外すとスマホだけが1段深くなる）。防災は読むための
 * 集計画面で毎日押すものではないため、メニュー側に置く（#7の計画レビューでの判断）。
 *
 * **行き先を足すときは`ITEMS`に足すだけでよい。** `BOTTOM_NAV_HREFS`に入れなければ、
 * 自動的にメニュー側に並ぶ。下タブへ入れたい場合は、代わりに何を外すかを決めること。
 */
export const ITEMS = [
  {
    href: "/inventory",
    label: "在庫",
    icon: Boxes,
    matches: ["/inventory"],
    note: "いまある在庫と記録",
  },
  {
    href: "/inventory/scan",
    label: "読取",
    icon: ScanLine,
    matches: ["/inventory/scan", "/barcodes"],
    note: "バーコードで商品を引く（カメラ）",
  },
  {
    href: "/intake",
    label: "写真取込",
    icon: Camera,
    matches: ["/intake"],
    note: "レシート・購入品の写真から候補を作る",
  },
  {
    href: "/expiry",
    label: "期限",
    icon: CalendarClock,
    matches: ["/expiry"],
    note: "期限切れ・期限間近と通知",
  },
  {
    href: "/disaster",
    label: "防災",
    icon: LifeBuoy,
    // 防災バッグ（/disaster/bags）は別の行き先として下に持つため、ここでは拾わない
    // （現在地は「前方一致の長いもの」で選ぶので、/disaster/bagsを開くとバッグ側が光る）。
    matches: ["/disaster"],
    note: "非常時に何日ぶんあるか",
  },
  {
    href: "/disaster/bags",
    label: "防災バッグ",
    icon: Backpack,
    matches: ["/disaster/bags"],
    note: "バッグごとの中身と点検",
  },
  {
    href: "/history",
    label: "履歴",
    icon: History,
    matches: ["/history"],
    note: "入出庫の記録と取消",
  },
  {
    href: "/replenishment",
    label: "補充",
    icon: ShoppingCart,
    matches: ["/replenishment"],
    note: "不足した在庫を買い物リストへ",
  },
  {
    href: "/storage",
    label: "保管場所",
    icon: MapPin,
    matches: ["/storage"],
    note: "冷蔵庫・食品棚・防災バッグ",
  },
] as const;

export type NavItem = (typeof ITEMS)[number];

/**
 * スマホの下タブに出す行き先。**「メニュー」を含めて5つを超えないこと。**
 *
 * 写真取込（#10）はここへ入れていない。入れるには在庫・読取・期限・履歴のどれかを外すことになり、
 * どれも毎日触るもののほうが優先度が高いため。写真取込は「買ってきたとき」に開く導線で、
 * メニューから1段深くても押し分けやすさを損なうほうが痛い。
 */
const BOTTOM_NAV_HREFS: readonly string[] = [
  "/inventory",
  "/inventory/scan",
  "/expiry",
  "/history",
];

/** 下タブに出ない行き先。メニュー画面（`/menu`）がこれを並べる。 */
export const OVERFLOW_ITEMS: readonly NavItem[] = ITEMS.filter(
  (item) => !BOTTOM_NAV_HREFS.includes(item.href),
);

/**
 * 下タブの5つ目。
 *
 * **メニュー側の行き先を開いているときも、このタブを現在地として光らせる**
 * （`matches`にあふれた行き先のパスを入れてある）。入れないと、防災や補充を開いている間だけ
 * スマホの下タブがどれも光らず、いまどこにいるのかが読めなくなる。
 */
export const MENU_ITEM = {
  href: "/menu",
  label: "メニュー",
  icon: Menu,
  matches: ["/menu", ...OVERFLOW_ITEMS.flatMap((item) => item.matches)],
} as const;

/** 下タブに出す行き先（最後がメニュー）。 */
export const BOTTOM_ITEMS = [
  ...ITEMS.filter((item) => BOTTOM_NAV_HREFS.includes(item.href)),
  MENU_ITEM,
];

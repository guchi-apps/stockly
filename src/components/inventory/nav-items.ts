import {
  Boxes,
  CalendarClock,
  History,
  LifeBuoy,
  MapPin,
  Menu,
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
 * 下タブ（スマホ）は画面幅を等分するため、増やすほど1つずつ細くなって押し分けられなくなる
 * （#7の計画レビューでの指摘）。そこで下タブは5つで打ち止めにし、あふれる行き先は
 * 「メニュー」（`/menu`）へまとめる。
 *
 * **行き先を足すときは`ITEMS`に足すだけでよい。** `BOTTOM_NAV_HREFS`に入れなければ、
 * 自動的にメニュー側に並ぶ。下タブへ入れたい場合は、代わりに何を外すかを決めること。
 */
export const ITEMS = [
  { href: "/inventory", label: "在庫", icon: Boxes, note: "いまある在庫と記録" },
  { href: "/expiry", label: "期限", icon: CalendarClock, note: "期限切れ・期限間近と通知" },
  { href: "/disaster", label: "防災", icon: LifeBuoy, note: "非常時に何日ぶんあるか" },
  { href: "/history", label: "履歴", icon: History, note: "入出庫の記録と取消" },
  {
    href: "/replenishment",
    label: "補充",
    icon: ShoppingCart,
    note: "不足した在庫を買い物リストへ",
  },
  { href: "/storage", label: "保管場所", icon: MapPin, note: "冷蔵庫・食品棚・防災バッグ" },
] as const;

export type NavItem = (typeof ITEMS)[number];

/** スマホの下タブに出す行き先。**「メニュー」を含めて5つを超えないこと。** */
const BOTTOM_NAV_HREFS: readonly string[] = ["/inventory", "/expiry", "/disaster", "/history"];

export const MENU_ITEM = { href: "/menu", label: "メニュー", icon: Menu } as const;

/** 下タブに出す行き先（最後がメニュー）。 */
export const BOTTOM_ITEMS = [
  ...ITEMS.filter((item) => BOTTOM_NAV_HREFS.includes(item.href)),
  MENU_ITEM,
];

/** 下タブに出ない行き先。メニュー画面（`/menu`）がこれを並べる。 */
export const OVERFLOW_ITEMS: readonly NavItem[] = ITEMS.filter(
  (item) => !BOTTOM_NAV_HREFS.includes(item.href),
);

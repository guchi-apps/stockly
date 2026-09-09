/**
 * バーコードから出す「登録の候補」を組み立てる純関数（#9）。
 *
 * 優先順位は **確定済みルール > バーコードマスタ > AI候補**。強いものが弱いものを上書きし、
 * 欄ごとにどれを採ったかを一緒に返す。画面はその出所をそのままチップとして出す
 * （どこから来た値か分からないまま埋まっていると、直してよいのか判断できない）。
 *
 * ただし**商品名・カテゴリ・単位はマスタ（`Product`）が正本**なので、確定済みルールの段を持たない
 * （#52）。確定のたびにマスタ側が書き換わるため、段を足さなくても最後に確定した値が出る。
 *
 * ここにはPrismaもNext.jsも持ち込まない。DBの無いCIで優先順位そのものを試せるようにするため
 * （`candidate.test.ts`）。DBから材料を集めるのは`src/lib/inventory/queries.ts`が担う。
 */
import type { ExpiryKind } from "../inventory/operations.ts";
import type { UnitCode } from "../inventory/units.ts";

/** 候補の出所。並び順がそのまま優先順位（強い順）。 */
export const CANDIDATE_SOURCES = ["RULE", "BARCODE", "AI"] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

/**
 * 画面に出す出所の名前。
 *
 * `BARCODE`を「バーコード」ではなく「商品マスタ」と呼ぶ（#10）。#52でカテゴリと単位の正本が
 * `Product`へ移り、この段が返すのは**商品マスタの値＝その家庭で最後に確定した値**になった。
 * 写真からの登録候補（#10）はコードを読まずに商品名でマスタを引くため、「バーコード」と出すと
 * 嘘になる。どちらの画面でも正しい呼び方に揃えてある。
 */
export const CANDIDATE_SOURCE_LABELS: Readonly<Record<CandidateSource, string>> = {
  RULE: "前回の確定",
  BARCODE: "商品マスタ",
  AI: "AI候補",
};

/** 候補として埋められる欄。`StockLotForm`の入力名と同じにしてある。 */
export const CANDIDATE_FIELDS = [
  "productName",
  "categoryName",
  "unit",
  "storageLocationId",
  "storagePositionId",
  "expiryKind",
  "expiryDate",
] as const;

export type CandidateField = (typeof CANDIDATE_FIELDS)[number];

/**
 * そのユーザーがその商品で最後に確定した内容（`ProductRule`）。
 *
 * **カテゴリと単位は持たない**（#52）。どちらも商品マスタ（`Product`）が正本で、確定のたびに
 * そちらへ書き戻すため、ここに置くと同じ値が2か所にあることになる。したがってこの2欄は
 * 下の`BarcodeMaster`から採る——それが「前回確定した値」そのものになる。
 */
export interface ConfirmedRule {
  readonly storageLocationId?: string | null;
  readonly storagePositionId?: string | null;
  readonly expiryKind?: ExpiryKind | null;
  /** 登録日から期限までの日数。次回は「今日＋この日数」を既定にする。 */
  readonly shelfLifeDays?: number | null;
  readonly confirmedCount?: number;
}

/**
 * バーコードに紐付いた商品マスタ（`Barcode` → `Product`）。
 *
 * カテゴリと既定の単位の正本でもある（#52）。確定するたびに`Product`側が更新されるので、
 * ここから採る値は「その家庭で最後に確定した値」と一致する。
 */
export interface BarcodeMaster {
  readonly productName: string;
  readonly categoryName?: string | null;
  readonly defaultUnit?: UnitCode | null;
}

/**
 * AIが返した候補。**今回のIssueでは常に`null`**で、購入写真AI（#10）が埋める場所。
 *
 * 形だけ先に決めてあるのは、優先順位を後から差し込むと「AIのほうが新しいから強い」といった
 * 別の規則が紛れ込むため。ここへ値が入っても、確定済みルールとマスタが必ず勝つ。
 */
export interface AiSuggestion {
  readonly productName?: string | null;
  readonly categoryName?: string | null;
  readonly unit?: UnitCode | null;
  readonly expiryKind?: ExpiryKind | null;
  readonly expiryDate?: string | null;
}

export interface CandidateInput {
  readonly rule?: ConfirmedRule | null;
  readonly master?: BarcodeMaster | null;
  readonly ai?: AiSuggestion | null;
  /** 期限の既定日を「今日＋日数」で出すための基準日。 */
  readonly today: Date;
}

/** 候補の値と、どこから来たか。画面はこの2つを対にして出す。 */
export type CandidateValues = Partial<Record<CandidateField, string>>;
export type CandidateSources = Partial<Record<CandidateField, CandidateSource>>;

export interface StockLotCandidate {
  readonly values: CandidateValues;
  readonly sources: CandidateSources;
  /** 何回この内容で登録したか。「3回登録しています」の説明に使う。 */
  readonly confirmedCount: number;
}

/**
 * 日付に日数を足して`YYYY-MM-DD`にする。
 *
 * 日付はUTCの暦日として扱う（`operations.ts`の`resolveExpiry()`と同じ約束）。
 * ここだけローカル時刻で数えると、同じ在庫の期限が画面ごとに1日ずれる。
 */
export function addDays(today: Date, days: number): string {
  const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/** 登録日と期限日から、覚えておく日数を求める。過去の期限は0日として扱う。 */
export function shelfLifeDaysBetween(from: Date, expiry: Date): number {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/**
 * 欄ごとに、強い候補から順に最初に見つかった値を採る。
 *
 * 空文字とnullは「値が無い」として次の候補へ落とす。空文字で上書きしてしまうと、
 * 弱いほうにある正しい値が消える。
 */
function pick(
  candidates: readonly (readonly [CandidateSource, string | null | undefined])[],
): { value: string; source: CandidateSource } | null {
  for (const [source, value] of candidates) {
    if (typeof value === "string" && value !== "") return { value, source };
  }
  return null;
}

/**
 * 在庫登録フォームの初期値を組み立てる。
 *
 * 数量（amount）は候補に含めない。前回3本買ったからといって今回も3本とは限らず、
 * 数量だけは毎回その場で決めるものだから。
 */
export function buildStockLotCandidate(input: CandidateInput): StockLotCandidate {
  const { rule, master, ai, today } = input;

  const values: CandidateValues = {};
  const sources: CandidateSources = {};

  const assign = (
    field: CandidateField,
    candidates: readonly (readonly [CandidateSource, string | null | undefined])[],
  ): void => {
    const chosen = pick(candidates);
    if (!chosen) return;
    values[field] = chosen.value;
    sources[field] = chosen.source;
  };

  // 商品名は確定済みルールが持たない（名前を変えたら商品そのものを直す運用のため）。
  // カテゴリ・単位も同じで、正本の`Product`＝マスタから採る（#52）。
  assign("productName", [
    ["BARCODE", master?.productName],
    ["AI", ai?.productName],
  ]);
  assign("categoryName", [
    ["BARCODE", master?.categoryName],
    ["AI", ai?.categoryName],
  ]);
  assign("unit", [
    ["BARCODE", master?.defaultUnit],
    ["AI", ai?.unit],
  ]);
  assign("storageLocationId", [["RULE", rule?.storageLocationId]]);
  // 詳細位置は保管場所とセットでしか意味がないので、場所を採れたときだけ出す。
  if (values.storageLocationId) {
    assign("storagePositionId", [["RULE", rule?.storagePositionId]]);
  }

  const expiryKind = pick([
    ["RULE", rule?.expiryKind],
    ["AI", ai?.expiryKind],
  ]);
  if (expiryKind && expiryKind.value !== "NONE") {
    values.expiryKind = expiryKind.value;
    sources.expiryKind = expiryKind.source;

    const fromRule =
      expiryKind.source === "RULE" && typeof rule?.shelfLifeDays === "number"
        ? addDays(today, rule.shelfLifeDays)
        : null;
    assign("expiryDate", [
      ["RULE", fromRule],
      ["AI", ai?.expiryDate],
    ]);
  }

  return { values, sources, confirmedCount: rule?.confirmedCount ?? 0 };
}

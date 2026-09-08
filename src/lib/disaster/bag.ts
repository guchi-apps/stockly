/**
 * 防災バッグの点検（#8）。
 *
 * ここにはPrismaクライアントもNext.jsも持ち込まない（DBの無いCIで単体テストできるように
 * するため。`bag.test.ts`）。DBの読み書きは`bag-queries.ts`。
 *
 * このモジュールが持つのは次の3つで、**充足の判定そのものは1行も持たない**。
 *
 * 1. **バッグの基準**（`DisasterBagPlanValue`）と、それを家庭の基準へ重ねる`toBagPlan()`。
 *    バッグの目標だけを差し替えて`assessDisasterStock()`をそのまま呼ぶための関数で、
 *    受入条件の「集計値は防災判定エンジンの出力を使用し、UI内に別ルールを重複実装しない」は
 *    この一点に集約している。
 * 2. **手当てが要るものの数え方**（`summarizeAttention()`）。期限と残量だけを見る、
 *    充足とは独立した観点。「非常時に数えられるか」ではなく「いま人が手を入れるべきか」を出す。
 * 3. **次回の点検予定**（`nextInspectionDueOn()`・`resolveInspectionState()`）。
 *
 * **バッグの目標は家庭全体（既定2人・3日）とは別に持つ。** 持ち出し袋に家全体の3日ぶんを
 * 求めるとどのバッグも常に不足になり、点検の役に立たない。既定は「1人・1日ぶん」。
 */
import { InventoryInputError, type ParseResult, type RawInput } from "../inventory/operations.ts";
import type { ExpiryState } from "../inventory/operations.ts";
import { tokyoDayNumber, tokyoDaysBetween } from "../time/tokyo.ts";

import type { DisasterPlanValue } from "./rules.ts";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// バッグごとの基準
// ---------------------------------------------------------------------------

/** バッグ1つぶんの目標。行が無いバッグは`DEFAULT_DISASTER_BAG_PLAN`で動く。 */
export interface DisasterBagPlanValue {
  readonly peopleCount: number;
  readonly targetDays: number;
  /** 何日ごとに点検するか。最後の点検日にこれを足したものが次回の予定。 */
  readonly inspectionIntervalDays: number;
}

/**
 * バッグの基準の既定値。
 *
 * **スキーマの`@default`と同じ値にしてある（片方だけ変えないこと）。**
 * `db-tests/disaster-plan.test.ts`が`DisasterPlanSetting`について見ているのと同じ約束。
 */
export const DEFAULT_DISASTER_BAG_PLAN: DisasterBagPlanValue = {
  peopleCount: 1,
  targetDays: 1,
  inspectionIntervalDays: 180,
};

export const MAX_BAG_PEOPLE_COUNT = 50;
export const MAX_BAG_TARGET_DAYS = 90;
export const MAX_INSPECTION_INTERVAL_DAYS = 730;
export const MAX_INSPECTION_NOTE_LENGTH = 500;

/**
 * 家庭の基準へバッグの目標を重ねる。
 *
 * **重ねるのは人数と日数だけ。** 1人1日あたりの必要量も、冷蔵・冷凍・開封済みを数えるか
 * どうかも家庭の基準をそのまま使う。バッグごとに「冷蔵を数える」を変えられるようにすると、
 * 同じ在庫が置き場所で違う扱いになり、判定の意味が家庭の中で割れる。
 */
export function toBagPlan(
  household: DisasterPlanValue,
  bag: DisasterBagPlanValue,
): DisasterPlanValue {
  return { ...household, peopleCount: bag.peopleCount, targetDays: bag.targetDays };
}

// ---------------------------------------------------------------------------
// 手当てが要るもの
// ---------------------------------------------------------------------------

/**
 * 点検で見る観点。**充足の判定（`assess.ts`の除外理由）とは別物。**
 *
 * 除外理由は「非常時に数えられるか」を答えるが、点検が答えたいのは「いま人が何をすべきか」。
 * たとえば冷蔵の在庫は集計からは外れるが、バッグに入っていないので点検の対象にならない。
 * 逆に期限間近は集計では算入されるが、点検では入れ替えの対象として出す必要がある。
 */
export const BAG_ATTENTION_KINDS = [
  "EXPIRED",
  "EXPIRING_SOON",
  "UNKNOWN_EXPIRY",
  "OPENED",
  "NOT_POSITIVE",
] as const;
export type BagAttentionKind = (typeof BAG_ATTENTION_KINDS)[number];

export const BAG_ATTENTION_LABELS: Readonly<Record<BagAttentionKind, string>> = {
  EXPIRED: "期限切れ",
  EXPIRING_SOON: "期限間近",
  UNKNOWN_EXPIRY: "期限が要確認",
  OPENED: "開封済み",
  NOT_POSITIVE: "残量なし",
};

export const BAG_ATTENTION_NOTES: Readonly<Record<BagAttentionKind, string>> = {
  EXPIRED: "入れ替えが要ります",
  EXPIRING_SOON: "そろそろ入れ替えます",
  UNKNOWN_EXPIRY: "期限が空のままです",
  OPENED: "開封済みなので数えていません",
  NOT_POSITIVE: "数量が0以下です",
};

/** 点検の対象になる、バッグの中身1件。 */
export interface BagItem {
  readonly lotId: string;
  readonly productName: string;
  /** 数量が0より大きいか。`Decimal`をここへ持ち込まないよう、判定済みの値で受け取る。 */
  readonly hasQuantity: boolean;
  readonly opened: boolean;
  readonly expiry: ExpiryState;
}

/**
 * 中身1件について、手当てが要る理由を1つだけ返す。要らなければ`null`。
 *
 * **1件につき1つに絞る。** 期限切れで開封済みのものを2か所で数えると、
 * 「7件のうち9件に手当てが要る」という読めない画面になる。上から順に強いものを採る。
 */
export function attentionOf(item: BagItem): BagAttentionKind | null {
  if (!item.hasQuantity) return "NOT_POSITIVE";
  if (item.expiry.status === "EXPIRED") return "EXPIRED";
  if (item.expiry.status === "SOON") return "EXPIRING_SOON";
  if (item.expiry.status === "UNKNOWN") return "UNKNOWN_EXPIRY";
  if (item.opened) return "OPENED";
  return null;
}

/**
 * 点検の並び順。**手当てが要るものを先に出す。**
 *
 * 点検で最初に見たいのは「手を入れる必要があるもの」で、登録順ではない。
 * 数字が小さいほど先。手当ての要らないものは最後にまとめる。
 */
export function attentionRank(item: BagItem): number {
  const kind = attentionOf(item);
  return kind === null ? BAG_ATTENTION_KINDS.length : BAG_ATTENTION_KINDS.indexOf(kind);
}

export interface BagAttentionGroup {
  readonly kind: BagAttentionKind;
  readonly label: string;
  readonly note: string;
  readonly items: readonly BagItem[];
}

/**
 * 中身を観点ごとにまとめる。**0件の観点も落とさずに返す。**
 *
 * 件数だけを並べる画面なので、0件が消えると「見ていない」のか「0件だった」のかが
 * 読み分けられなくなる（`assess.ts`の除外理由を0件で畳むのと逆なのはこのため。
 * あちらは一覧、こちらは点検表）。
 */
export function summarizeAttention(items: readonly BagItem[]): BagAttentionGroup[] {
  return BAG_ATTENTION_KINDS.map((kind) => ({
    kind,
    label: BAG_ATTENTION_LABELS[kind],
    note: BAG_ATTENTION_NOTES[kind],
    items: items.filter((item) => attentionOf(item) === kind),
  }));
}

/** 点検の記録に残す件数。あとから「前回はいくつ手当てが要ったか」を振り返るために使う。 */
export interface BagInspectionCounts {
  readonly itemCount: number;
  readonly expiredCount: number;
  readonly expiringSoonCount: number;
  readonly unknownExpiryCount: number;
}

export function countForInspection(items: readonly BagItem[]): BagInspectionCounts {
  const of = (kind: BagAttentionKind) =>
    items.filter((item) => attentionOf(item) === kind).length;
  return {
    itemCount: items.length,
    expiredCount: of("EXPIRED"),
    expiringSoonCount: of("EXPIRING_SOON"),
    unknownExpiryCount: of("UNKNOWN_EXPIRY"),
  };
}

// ---------------------------------------------------------------------------
// 次回の点検予定
// ---------------------------------------------------------------------------

/**
 * 次回の点検予定日。まだ一度も点検していなければ`null`。
 *
 * 日付の加算は**日本時間の通し番号の上で**行う（`Date`のミリ秒に日数を足すと、
 * 期限の列と同じUTC0時の値に戻らないことがある）。
 */
export function nextInspectionDueOn(
  lastInspectedOn: Date | null,
  intervalDays: number,
): Date | null {
  if (!lastInspectedOn) return null;
  return new Date((tokyoDayNumber(lastInspectedOn) + intervalDays) * DAY_MS);
}

/**
 * 点検の状態。
 *
 * - `NEVER`: 一度も点検していない。**`OVERDUE`と分ける**——「期限を過ぎた」と
 *   「まだ始めていない」では、次にやることが違う
 * - `OVERDUE`: 予定日を過ぎている
 * - `DUE_SOON`: 予定日まで14日以内
 * - `OK`: まだ先
 */
export const INSPECTION_DUE_SOON_DAYS = 14;

export type InspectionStatus = "NEVER" | "OVERDUE" | "DUE_SOON" | "OK";

export interface InspectionState {
  readonly status: InspectionStatus;
  readonly lastInspectedOn: Date | null;
  readonly dueOn: Date | null;
  /** 予定日までの日数。過ぎていれば負。一度も点検していなければ`null`。 */
  readonly daysLeft: number | null;
}

export function resolveInspectionState(
  lastInspectedOn: Date | null,
  intervalDays: number,
  today: Date,
): InspectionState {
  const dueOn = nextInspectionDueOn(lastInspectedOn, intervalDays);
  if (!dueOn) {
    return { status: "NEVER", lastInspectedOn: null, dueOn: null, daysLeft: null };
  }
  const daysLeft = tokyoDaysBetween(today, dueOn);
  const status: InspectionStatus =
    daysLeft < 0 ? "OVERDUE" : daysLeft <= INSPECTION_DUE_SOON_DAYS ? "DUE_SOON" : "OK";
  return { status, lastInspectedOn, dueOn, daysLeft };
}

/** 点検を促す必要がある状態か。一覧の並べ替えと、防災ストックの帯の出し分けに使う。 */
export function needsInspection(state: InspectionState): boolean {
  return state.status === "NEVER" || state.status === "OVERDUE";
}

export const INSPECTION_STATUS_LABELS: Readonly<Record<InspectionStatus, string>> = {
  NEVER: "未点検",
  OVERDUE: "点検の期限切れ",
  DUE_SOON: "点検が近い",
  OK: "点検済み",
};

// ---------------------------------------------------------------------------
// フォームの読み取り
// ---------------------------------------------------------------------------

function normalizeDigits(raw: string | undefined | null): string {
  return (raw ?? "")
    .trim()
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/,/g, "");
}

function parseCount(
  raw: string | undefined | null,
  field: string,
  label: string,
  max: number,
): number {
  const normalized = normalizeDigits(raw);
  if (normalized === "") throw new InventoryInputError(field, `${label}を入力してください。`);
  if (!/^\d+$/.test(normalized)) {
    throw new InventoryInputError(field, `${label}は1以上の整数で入力してください。`);
  }
  const value = Number(normalized);
  if (value < 1) throw new InventoryInputError(field, `${label}は1以上で入力してください。`);
  if (value > max) throw new InventoryInputError(field, `${label}は${max}までです。`);
  return value;
}

export function parseDisasterBagPlanForm(input: RawInput): ParseResult<DisasterBagPlanValue> {
  try {
    return {
      ok: true,
      value: {
        peopleCount: parseCount(input.peopleCount, "peopleCount", "人数", MAX_BAG_PEOPLE_COUNT),
        targetDays: parseCount(input.targetDays, "targetDays", "目標日数", MAX_BAG_TARGET_DAYS),
        inspectionIntervalDays: parseCount(
          input.inspectionIntervalDays,
          "inspectionIntervalDays",
          "点検の間隔",
          MAX_INSPECTION_INTERVAL_DAYS,
        ),
      },
    };
  } catch (error) {
    if (error instanceof InventoryInputError) {
      return { ok: false, errors: { [error.field]: error.message } };
    }
    throw error;
  }
}

export interface BagInspectionFormValue {
  readonly inspectedOn: Date;
  readonly note: string | null;
}

/**
 * 点検の記録のフォームを読む。
 *
 * **未来の日付は受け付けない。** 点検は「見た」ことの記録なので、まだ見ていない日を
 * 入れられると次回の予定がそのぶん先送りされる。
 */
export function parseBagInspectionForm(
  input: RawInput,
  today: Date,
): ParseResult<BagInspectionFormValue> {
  const raw = (input.inspectedOn ?? "").trim();
  if (raw === "") {
    return { ok: false, errors: { inspectedOn: "点検日を入力してください。" } };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { ok: false, errors: { inspectedOn: "点検日はカレンダーから選んでください。" } };
  }
  const inspectedOn = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(inspectedOn.getTime())) {
    return { ok: false, errors: { inspectedOn: "存在しない日付です。" } };
  }
  if (tokyoDaysBetween(today, inspectedOn) > 0) {
    return { ok: false, errors: { inspectedOn: "点検日に未来の日付は入れられません。" } };
  }

  const note = (input.note ?? "").trim();
  if (note.length > MAX_INSPECTION_NOTE_LENGTH) {
    return {
      ok: false,
      errors: { note: `メモは${MAX_INSPECTION_NOTE_LENGTH}文字までです。` },
    };
  }

  return { ok: true, value: { inspectedOn, note: note === "" ? null : note } };
}

/**
 * 画面から来た入力を、履歴として積める形へ組み立てる純関数。
 *
 * ここにはPrismaのクライアントもNext.jsも持ち込まない。DBの無いCIでも
 * 「数量の検証」「符号の決定」「在庫不足の判定」「期限の状態」を単体テストできるようにするため
 * （`operations.test.ts`）。永続化は`service.ts`が担う。
 *
 * 数量は必ず`Decimal`で扱う。`number`は0.1+0.2が0.30000000000000004になり、
 * 0.4ロールのような小数の在庫がすぐ合わなくなる。
 */
import { tokyoDaysBetween } from "../time/tokyo.ts";

import { applyEntry, isReversed, type LedgerEntry } from "./ledger.ts";
import {
  Decimal,
  UNIT_DEFINITIONS,
  canConvert,
  quantity,
  type Quantity,
  type UnitCode,
} from "./units.ts";

/**
 * 画面から記録できる操作。
 * `REVERSAL`（取消）は既存の履歴からしか作れないため、ここには含めない。
 */
export const RECORDABLE_TYPES = ["PURCHASE", "CONSUME", "DISPOSE", "ADJUST"] as const;
export type RecordableTransactionType = (typeof RECORDABLE_TYPES)[number];

export const RECORDABLE_TYPE_LABELS: Readonly<Record<RecordableTransactionType, string>> = {
  PURCHASE: "補充",
  CONSUME: "消費",
  DISPOSE: "廃棄",
  ADJUST: "訂正",
};

/**
 * 期限の種別。ロットは賞味期限と消費期限のどちらか一方だけを持つ。
 *
 * **`UNKNOWN`（未確認）と`NONE`（期限なし）を分ける。** どちらも日付を持たないが、
 * 「まだ確かめていない」と「この商品に期限は無い（塩・工具など）」は別のことで、
 * 混ぜると後者に永久に「要確認」が付く。区別は`StockLot.noExpiry`が持つ。
 */
export const EXPIRY_KINDS = ["UNKNOWN", "NONE", "BEST_BEFORE", "USE_BY"] as const;
export type ExpiryKind = (typeof EXPIRY_KINDS)[number];

/** 数量の入力欄で許す小数の桁数。DB側が`Decimal(14, 3)`のため3桁に揃える。 */
const QUANTITY_SCALE = 3;

/**
 * 期限が「近い」と扱う残り日数の既定値。
 *
 * 賞味期限と消費期限で違えてあるのは、切れたときの困り方が違うため。賞味期限は品質の目安で
 * 少し過ぎても食べられることが多い一方、消費期限は過ぎたら食べない。同じ日数で騒ぐと、
 * 賞味期限の通知に慣れて消費期限も見落とす。家庭ごとの上書きは`ExpirySetting`が持つ。
 */
export const DEFAULT_EXPIRY_POLICY: ExpiryPolicy = {
  bestBeforeSoonDays: 7,
  useBySoonDays: 3,
};

/** 設定で受け付ける接近日数の上限。1年より先を「期限間近」と呼ぶ意味がないため。 */
export const EXPIRY_SOON_DAYS_MAX = 365;

/**
 * 入力が受け付けられなかったことを表す。
 *
 * `field`には入力欄の名前を入れる。画面はこれを見て、該当する欄の下にメッセージを出す。
 */
export class InventoryInputError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "InventoryInputError";
    this.field = field;
  }
}

export type FieldErrors = Record<string, string>;
export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

/** フォームから来る値。`FormData.get()`の戻り値をそのまま渡せる形にしてある。 */
export type RawInput = Record<string, string | undefined | null>;

function text(input: RawInput, key: string): string {
  return (input[key] ?? "").trim();
}

/**
 * 数量を読み取る。
 *
 * 全角数字と桁区切りのカンマは、スマホの入力でそのまま混ざりやすいので受け付けて正規化する。
 */
export function parseAmount(
  raw: string | undefined | null,
  field: string,
  label = "数量",
  /**
   * `allowZero`は0を受け付ける。補充基準の「0になったら買う」のように、0が意味を持つ
   * 入力欄でだけ渡す（在庫の増減では0の記録に意味が無いため、既定は0を弾く）。
   */
  options: { allowZero?: boolean } = {},
): Decimal {
  const normalized = (raw ?? "")
    .trim()
    .replace(/[０-９．]/g, (char) =>
      char === "．" ? "." : String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/,/g, "");

  if (normalized === "") {
    throw new InventoryInputError(field, `${label}を入力してください。`);
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new InventoryInputError(field, `${label}は数字で入力してください。`);
  }

  const amount = new Decimal(normalized);
  if (amount.isZero() ? !options.allowZero : !amount.isPositive()) {
    throw new InventoryInputError(
      field,
      options.allowZero
        ? `${label}は0以上の値を入力してください。`
        : `${label}は0より大きい値を入力してください。`,
    );
  }
  if (amount.decimalPlaces() > QUANTITY_SCALE) {
    throw new InventoryInputError(
      field,
      `${label}の小数は${QUANTITY_SCALE}桁までです（例: 0.4）。`,
    );
  }
  return amount;
}

export function parseUnit(raw: string | undefined | null, field = "unit"): UnitCode {
  const value = (raw ?? "").trim();
  if (value in UNIT_DEFINITIONS) return value as UnitCode;
  throw new InventoryInputError(field, "単位を選んでください。");
}

export function parseRecordableType(
  raw: string | undefined | null,
  field = "type",
): RecordableTransactionType {
  const value = (raw ?? "").trim();
  const found = RECORDABLE_TYPES.find((type) => type === value);
  if (!found) throw new InventoryInputError(field, "操作の種類を選んでください。");
  return found;
}

/** `YYYY-MM-DD`をUTCの0時として読む。時差でカレンダー上の日付がずれないようにする。 */
export function parseDate(raw: string | undefined | null, field: string): Date | null {
  const value = (raw ?? "").trim();
  if (value === "") return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new InventoryInputError(field, "日付はカレンダーから選んでください。");
  }

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(day)) {
    throw new InventoryInputError(field, "存在しない日付です。");
  }
  return date;
}

/**
 * 二重送信を見分けるための操作ID。
 *
 * 画面がフォームへ埋めた値をそのまま`InventoryTransaction.id`に使うので、
 * ここを通っていない値をIDにしない（長すぎる値や空文字がそのままidになると、
 * あとから履歴を追えなくなる）。
 */
export function parseOperationId(raw: string | undefined | null, field = "operationId"): string {
  const value = (raw ?? "").trim();
  if (!/^[0-9a-z-]{8,64}$/i.test(value)) {
    throw new InventoryInputError(field, "操作を識別できませんでした。画面を開き直してください。");
  }
  return value;
}

/**
 * 種別から`quantityDelta`の符号を決める。
 *
 * 画面は常に正の数量を受け取り、符号はここでしか付けない。入力欄でマイナスを扱わせると
 * 「消費に−1と入れて在庫が増える」類の取り違えが起きる。
 */
export function signedDelta(type: RecordableTransactionType, amount: Decimal): Decimal {
  return type === "CONSUME" || type === "DISPOSE" ? amount.negated() : amount;
}

/**
 * その履歴を積んだあとのロット数量。積めない場合は`InventoryInputError`。
 *
 * 在庫を負にする操作はここで止める。DB制約では負の数量を防げないうえ、
 * 負のまま積むと以後の再計算がすべて負のまま進む。
 */
export function applyRecordToLot(
  current: Quantity,
  entry: { type: RecordableTransactionType | "REVERSAL"; quantityDelta: Decimal; unit: UnitCode },
  options: { allowNegative?: boolean } = {},
): Quantity {
  if (!canConvert(entry.unit, current.unit)) {
    throw new InventoryInputError(
      "unit",
      `単位「${UNIT_DEFINITIONS[entry.unit].label}」は、この在庫の「${UNIT_DEFINITIONS[current.unit].label}」と合算できません。`,
    );
  }

  const next = applyEntry(current, entry);
  if (!options.allowNegative && next.amount.isNegative()) {
    throw new InventoryInputError(
      "amount",
      `在庫が足りません（残り${formatAmount(current.amount)}${UNIT_DEFINITIONS[current.unit].label}）。`,
    );
  }
  return next;
}

/**
 * 数量からロットの状態を決める。ちょうど0になったロットは一覧の既定の表示から外す。
 *
 * **負の数量はACTIVEのまま残す。** 取消で数量が負になることはありうる
 * （買ったぶんを消費したあとで、その購入を取り消した場合など）。これをDEPLETEDにすると
 * 一覧から消え、訂正する手段が無くなる。画面はマイナスのまま出して、棚卸を促す。
 */
export function nextLotStatus(
  next: Quantity,
  entryType: RecordableTransactionType | "REVERSAL",
): "ACTIVE" | "DEPLETED" | "DISCARDED" {
  // Decimalの`isPositive()`は0でもtrueを返すため、0より大きいことを明示して比べる。
  if (next.amount.greaterThan(0) || next.amount.isNegative()) return "ACTIVE";
  return entryType === "DISPOSE" ? "DISCARDED" : "DEPLETED";
}

/** 末尾の余分な0を落とした数量表示（1.500 → 1.5）。 */
export function formatAmount(amount: Decimal): string {
  return amount.toDecimalPlaces(QUANTITY_SCALE).toString();
}

export function formatQuantityWithUnit(amount: Decimal, unit: UnitCode): string {
  return `${formatAmount(amount)}${UNIT_DEFINITIONS[unit].label}`;
}

// ---------------------------------------------------------------------------
// 期限
// ---------------------------------------------------------------------------

/**
 * 期限の状態。
 *
 * **期限が入っていないことを`FINE`（期限内）と混ぜない。** 期限不明は「まだ大丈夫」ではなく
 * 「確かめていない」であり、期限内として畳むと、期限を入れ忘れた在庫が一覧の奥へ沈んで
 * そのまま古くなる。`UNKNOWN`として別に数え、画面では「要確認」として出す。
 *
 * ただし**利用者が「期限なし」と決めた在庫は`NONE`**で、要確認にはしない（塩・ゴミ袋・工具など、
 * そもそも期限が存在しないものが毎回並ぶと、要確認そのものが読まれなくなる）。
 */
export type ExpiryStatus = "EXPIRED" | "SOON" | "FINE" | "UNKNOWN" | "NONE";

export const EXPIRY_STATUS_LABELS: Readonly<Record<ExpiryStatus, string>> = {
  EXPIRED: "期限切れ",
  SOON: "期限間近",
  FINE: "期限内",
  UNKNOWN: "要確認",
  NONE: "期限なし",
};

/** 家庭ごとの「あと何日から期限間近とみなすか」。 */
export interface ExpiryPolicy {
  readonly bestBeforeSoonDays: number;
  readonly useBySoonDays: number;
}

export interface ExpiryState {
  readonly status: ExpiryStatus;
  readonly kind: ExpiryKind;
  readonly date: Date | null;
  /** 今日を0とした残り日数。過ぎていれば負。期限が無ければnull。 */
  readonly daysLeft: number | null;
}

/**
 * ロットの期限の状態。
 *
 * 消費期限（安全に食べられる期限）と賞味期限（品質の期限）の両方があるときは、
 * 切れると困る度合いが強い消費期限を優先し、しきい値もその種別のものを使う。
 *
 * 日付の境目は日本時間の0時（`tokyoDaysBetween()`）。`now`には「いま」をそのまま渡してよく、
 * 日付の列（UTC0時）を渡しても同じ結果になる。
 */
export function resolveExpiry(
  lot: { bestBeforeDate?: Date | null; useByDate?: Date | null; noExpiry?: boolean },
  now: Date,
  policy: ExpiryPolicy = DEFAULT_EXPIRY_POLICY,
): ExpiryState {
  const date = lot.useByDate ?? lot.bestBeforeDate ?? null;
  if (!date) {
    const kind: ExpiryKind = lot.noExpiry ? "NONE" : "UNKNOWN";
    return { status: kind, kind, date: null, daysLeft: null };
  }
  const kind: ExpiryKind = lot.useByDate ? "USE_BY" : "BEST_BEFORE";

  const daysLeft = tokyoDaysBetween(now, date);
  const soonDays = kind === "USE_BY" ? policy.useBySoonDays : policy.bestBeforeSoonDays;
  const status: ExpiryStatus = daysLeft < 0 ? "EXPIRED" : daysLeft <= soonDays ? "SOON" : "FINE";
  return { status, kind, date, daysLeft };
}

export const EXPIRY_KIND_LABELS: Readonly<Record<ExpiryKind, string>> = {
  UNKNOWN: "未確認（あとで入れる）",
  NONE: "期限なし",
  BEST_BEFORE: "賞味期限",
  USE_BY: "消費期限",
};

// ---------------------------------------------------------------------------
// フォームの読み取り
// ---------------------------------------------------------------------------

/** 数量の増減を1件記録するときの入力。 */
export interface RecordFormValue {
  readonly operationId: string;
  readonly type: RecordableTransactionType;
  readonly amount: Decimal;
  readonly note: string | null;
}

export function parseRecordForm(input: RawInput): ParseResult<RecordFormValue> {
  return collect(() => ({
    operationId: parseOperationId(input.operationId),
    type: parseRecordableType(input.type),
    amount: parseAmount(input.amount, "amount"),
    note: text(input, "note") || null,
  }));
}

/** 在庫の新規登録・編集の入力。 */
export interface StockLotFormValue {
  readonly productName: string;
  readonly brand: string;
  /** カテゴリは名前で扱い、未登録なら登録時に作る（選択肢は既存カテゴリをdatalistで出す）。 */
  readonly categoryName: string | null;
  readonly amount: Decimal;
  readonly unit: UnitCode;
  readonly storageLocationId: string | null;
  readonly storagePositionId: string | null;
  readonly expiryKind: ExpiryKind;
  readonly expiryDate: Date | null;
  readonly opened: boolean;
  readonly note: string | null;
}

export function parseStockLotForm(input: RawInput): ParseResult<StockLotFormValue> {
  return collect(() => {
    const productName = text(input, "productName");
    if (productName === "") {
      throw new InventoryInputError("productName", "商品名を入力してください。");
    }
    if (productName.length > 120) {
      throw new InventoryInputError("productName", "商品名は120文字までです。");
    }

    const expiryKind = parseExpiryKind(input.expiryKind);
    const expiryDate = parseDate(input.expiryDate, "expiryDate");
    if (hasExpiryDate(expiryKind) && !expiryDate) {
      throw new InventoryInputError("expiryDate", "期限の日付を入力してください。");
    }

    const storageLocationId = text(input, "storageLocationId") || null;
    const storagePositionId = text(input, "storagePositionId") || null;
    if (!storageLocationId && storagePositionId) {
      throw new InventoryInputError("storageLocationId", "詳細位置を選ぶ前に保管場所を選んでください。");
    }

    return {
      productName,
      brand: text(input, "brand"),
      categoryName: text(input, "categoryName") || null,
      amount: parseAmount(input.amount, "amount"),
      unit: parseUnit(input.unit),
      storageLocationId,
      storagePositionId,
      expiryKind,
      expiryDate: hasExpiryDate(expiryKind) ? expiryDate : null,
      opened: text(input, "opened") === "on",
      note: text(input, "note") || null,
    };
  });
}

/** 日付を持つ種別か（賞味期限・消費期限）。 */
export function hasExpiryDate(kind: ExpiryKind): boolean {
  return kind === "BEST_BEFORE" || kind === "USE_BY";
}

function parseExpiryKind(raw: string | undefined | null): ExpiryKind {
  const value = (raw ?? "UNKNOWN").trim();
  const found = EXPIRY_KINDS.find((kind) => kind === value);
  if (!found) throw new InventoryInputError("expiryKind", "期限の種類を選んでください。");
  return found;
}

/** 保管場所の入力。 */
export interface StorageLocationFormValue {
  readonly name: string;
  readonly kind: StorageKind;
  readonly temperatureZone: TemperatureZone;
}

export const STORAGE_KINDS = [
  "REFRIGERATOR",
  "FREEZER",
  "PANTRY",
  "CUPBOARD",
  "CLOSET",
  "EMERGENCY_STOCK",
  "OTHER",
] as const;

export type StorageKind = (typeof STORAGE_KINDS)[number];

export const TEMPERATURE_ZONES = ["AMBIENT", "CHILLED", "FROZEN"] as const;
export type TemperatureZone = (typeof TEMPERATURE_ZONES)[number];

export function parseStorageLocationForm(input: RawInput): ParseResult<StorageLocationFormValue> {
  return collect(() => {
    const name = text(input, "name");
    if (name === "") throw new InventoryInputError("name", "保管場所の名前を入力してください。");
    if (name.length > 60) throw new InventoryInputError("name", "名前は60文字までです。");

    const kind = STORAGE_KINDS.find((value) => value === text(input, "kind")) ?? "OTHER";
    const temperatureZone =
      TEMPERATURE_ZONES.find((value) => value === text(input, "temperatureZone")) ?? "AMBIENT";

    return { name, kind, temperatureZone };
  });
}

// ---------------------------------------------------------------------------
// 商品の防災属性（#47）
// ---------------------------------------------------------------------------

/**
 * 非常時にその商品が担う役割。`prisma/schema.prisma`の`EmergencyRole`と同じ並びにしてある
 * （`StorageKind`・`TemperatureZone`と同じく、Prismaの型をそのまま持ち込まず手で揃える）。
 *
 * `src/lib/disaster/rules.ts`の`DISASTER_CATEGORY_RULES`が、このうち一部だけを集計へ割り当てる。
 * `NONE`・`UTILITY_WATER`・`MEDICAL`・`OTHER`は記録用で、防災の集計には出てこない
 * （どれが集計対象かは`categoryOfRole()`が持つ。ここでは重複して持たない）。
 */
export const EMERGENCY_ROLES = [
  "NONE",
  "STAPLE_FOOD",
  "SIDE_DISH",
  "DRINKING_WATER",
  "UTILITY_WATER",
  "HEAT_SOURCE",
  "SANITATION",
  "LIGHTING",
  "POWER",
  "MEDICAL",
  "OTHER",
] as const;

export type EmergencyRole = (typeof EMERGENCY_ROLES)[number];

export const EMERGENCY_ROLE_LABELS: Readonly<Record<EmergencyRole, string>> = {
  NONE: "なし（対象外）",
  STAPLE_FOOD: "主食",
  SIDE_DISH: "主菜・副菜",
  DRINKING_WATER: "飲料水",
  UTILITY_WATER: "生活用水",
  HEAT_SOURCE: "熱源（カセットボンベ等）",
  SANITATION: "衛生（携帯トイレ等）",
  LIGHTING: "照明（ライト・ランタン）",
  POWER: "電源（モバイルバッテリー・乾電池）",
  MEDICAL: "医療",
  OTHER: "その他",
};

/**
 * 商品の防災属性の入力。1商品につき1組で、その商品のすべての在庫ロットに共通で効く
 * （ロットごとには持たない）。
 */
export interface ProductDisasterFormValue {
  readonly emergencyRole: EmergencyRole;
  /** 1defaultUnitあたりの食数。空欄はnull（その区分の在庫としては数えられない）。 */
  readonly servingsPerUnit: Decimal | null;
  /** 1defaultUnitあたりの使用回数。空欄はnull。 */
  readonly usesPerUnit: Decimal | null;
  readonly requiresHeating: boolean;
  readonly requiresWater: boolean;
  readonly temperatureZone: TemperatureZone;
}

export function parseProductDisasterForm(input: RawInput): ParseResult<ProductDisasterFormValue> {
  return collect(() => ({
    emergencyRole: parseEmergencyRole(input.emergencyRole),
    servingsPerUnit: parsePerUnitCount(input.servingsPerUnit, "servingsPerUnit", "1単位あたりの食数"),
    usesPerUnit: parsePerUnitCount(input.usesPerUnit, "usesPerUnit", "1単位あたりの使用回数"),
    requiresHeating: text(input, "requiresHeating") === "on",
    requiresWater: text(input, "requiresWater") === "on",
    temperatureZone:
      TEMPERATURE_ZONES.find((value) => value === text(input, "temperatureZone")) ?? "AMBIENT",
  }));
}

function parseEmergencyRole(raw: string | undefined | null): EmergencyRole {
  const value = (raw ?? "NONE").trim();
  const found = EMERGENCY_ROLES.find((role) => role === value);
  if (!found) throw new InventoryInputError("emergencyRole", "非常時の役割を選んでください。");
  return found;
}

/**
 * 1単位あたりの食数・使用回数。**空欄は`null`を許す**点が`parseAmount()`と違う
 * （防災の判定に使わない商品では、この欄を埋める理由が無い）。0は「1単位に満たない」という
 * 意味を持たないため受け付けない（空欄にするか、1以上の値を入れる）。
 */
function parsePerUnitCount(
  raw: string | undefined | null,
  field: string,
  label: string,
): Decimal | null {
  const normalized = (raw ?? "")
    .trim()
    .replace(/[０-９．]/g, (char) =>
      char === "．" ? "." : String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/,/g, "");

  if (normalized === "") return null;
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new InventoryInputError(field, `${label}は数字で入力してください。`);
  }

  const amount = new Decimal(normalized);
  if (amount.isZero()) {
    throw new InventoryInputError(
      field,
      `${label}は0より大きい値を入力してください（使わないなら空欄にしてください）。`,
    );
  }
  if (amount.decimalPlaces() > QUANTITY_SCALE) {
    throw new InventoryInputError(field, `${label}の小数は${QUANTITY_SCALE}桁までです（例: 0.4）。`);
  }
  return amount;
}

/** 期限の設定（家庭ごと）の入力。 */
export interface ExpirySettingsFormValue {
  readonly bestBeforeSoonDays: number;
  readonly useBySoonDays: number;
  readonly highlightUnknownExpiry: boolean;
  readonly notifyEnabled: boolean;
}

export function parseExpirySettingsForm(input: RawInput): ParseResult<ExpirySettingsFormValue> {
  return collect(() => ({
    bestBeforeSoonDays: parseDayCount(input.bestBeforeSoonDays, "bestBeforeSoonDays", "賞味期限の日数"),
    useBySoonDays: parseDayCount(input.useBySoonDays, "useBySoonDays", "消費期限の日数"),
    highlightUnknownExpiry: text(input, "highlightUnknownExpiry") === "on",
    notifyEnabled: text(input, "notifyEnabled") === "on",
  }));
}

/** 0以上`EXPIRY_SOON_DAYS_MAX`以下の整数。0は「当日だけを期限間近にする」の意味で許す。 */
export function parseDayCount(
  raw: string | undefined | null,
  field: string,
  label: string,
): number {
  const normalized = (raw ?? "")
    .trim()
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));

  if (normalized === "") throw new InventoryInputError(field, `${label}を入力してください。`);
  if (!/^\d+$/.test(normalized)) {
    throw new InventoryInputError(field, `${label}は0以上の整数で入力してください。`);
  }

  const days = Number(normalized);
  if (days > EXPIRY_SOON_DAYS_MAX) {
    throw new InventoryInputError(field, `${label}は${EXPIRY_SOON_DAYS_MAX}日までです。`);
  }
  return days;
}

/**
 * 投げられた`InventoryInputError`を欄ごとのメッセージへ畳む。
 *
 * 1つ目で止めているのは、画面が直す順番と同じにするため。全欄を集めても、
 * 直したときに次のエラーが出る点は変わらない。
 */
function collect<T>(build: () => T): ParseResult<T> {
  try {
    return { ok: true, value: build() };
  } catch (error) {
    if (error instanceof InventoryInputError) {
      return { ok: false, errors: { [error.field]: error.message } };
    }
    throw error;
  }
}

/**
 * 取り消せる履歴か。取消行そのものと、すでに取り消された行は対象外。
 *
 * 判定の実体は`ledger.ts`の`isReversed()`で、ここは画面が「取消ボタンを出すか」を
 * 決めるための入口。**同じ判定をここで書き直さないこと**（片方だけ直すと、押せるのに
 * サーバー側で拒否されるボタンが並ぶ）。実際に取り消すときは`buildReversal()`が
 * 同じ規則でもう一度確かめる。
 */
export function canReverse(
  target: Pick<LedgerEntry, "id" | "type" | "reversesTransactionId">,
  entries: readonly Pick<LedgerEntry, "reversesTransactionId">[],
): boolean {
  if (target.type === "REVERSAL") return false;
  return !isReversed(target as LedgerEntry, entries as LedgerEntry[]);
}

export { quantity };

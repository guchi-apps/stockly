/**
 * 写真から出した観察を、いまの在庫と照らし合わせて「減らす候補」に組み立てる純関数（#11）。
 *
 * **ここが「AIより現在庫を優先する」ことの実体。** モデルが決めるのは「写真に何が見えたか」までで、
 * どの商品か・どのロットか・いくつ減らすかは、この関数がその家庭の在庫だけを材料に決める。
 * だから**在庫に無いものは候補にならない**（受入条件「存在しない商品を自動減算しない」）。
 *
 * PrismaもNext.jsも持ち込まない。DBの無いCIで、複数商品・部分消費・判定不能・単位の食い違いを
 * そのまま試せるようにするため（`matching.test.ts`）。DBから材料を集めるのは`queries.ts`が担う。
 *
 * **同じ入力なら必ず同じ結果になる**（乱数も現在時刻の暗黙参照も持たない）。#7の判定と同じ約束で、
 * 「後から判定結果を再説明できる」ことを、保存ではなく再現性と根拠の表示で満たす。
 */
import type { $Enums } from "@prisma/client";

import {
  Decimal,
  canConvert,
  convertQuantity,
  unitDefinition,
  type UnitCode,
} from "../inventory/units.ts";
import type { VisionObservation } from "../vision/client.ts";
import { SCAN_KIND_DEFINITIONS, type ConsumptionScanKind } from "./kinds.ts";

/**
 * 照合ルールの版。
 *
 * **同じ在庫・同じ写真から違う候補が出るようになったら上げる**（文言や並び順だけの変更では上げない）。
 * `ConsumptionScan.ruleVersion`に書き、画面にも出す（#7の`DISASTER_RULE_VERSION`と同じ役割）。
 */
export const CONSUMPTION_RULE_VERSION = "v1";

export type ConsumptionSkipReason = $Enums.ConsumptionSkipReason;

/** 商品を突き止めた手がかり。並び順がそのまま強さ（強い順）。 */
export const MATCH_STRENGTHS = ["BARCODE", "NAME", "ALIAS", "PARTIAL"] as const;
export type MatchStrength = (typeof MATCH_STRENGTHS)[number];

/**
 * 手がかりごとの重み。最終的な信頼度は「モデルの確からしさ × これ」。
 *
 * バーコードが読めていれば商品の取り違えはまず起きないので1.0。名前の部分一致だけの照合は
 * 「おいしい牛乳」と「おいしい牛乳 低脂肪」を取り違えうるので、はっきり下げる。
 */
const STRENGTH_WEIGHT: Readonly<Record<MatchStrength, number>> = {
  BARCODE: 1,
  NAME: 0.9,
  ALIAS: 0.85,
  PARTIAL: 0.6,
};

/** 信頼度の段。**色だけでなくこの語と記号を必ず併記する**（#8の充足率と同じ約束）。 */
export const CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const CONFIDENCE_LABELS: Readonly<Record<ConfidenceLevel, string>> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};

/** 記号での併記。色が読めない環境でも段が分かるようにする。 */
export const CONFIDENCE_MARKS: Readonly<Record<ConfidenceLevel, string>> = {
  HIGH: "●●●",
  MEDIUM: "●●○",
  LOW: "●○○",
};

const HIGH_THRESHOLD = 0.8;
const MEDIUM_THRESHOLD = 0.5;

export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= HIGH_THRESHOLD) return "HIGH";
  if (confidence >= MEDIUM_THRESHOLD) return "MEDIUM";
  return "LOW";
}

export const SKIP_REASON_LABELS: Readonly<Record<ConsumptionSkipReason, string>> = {
  NO_PRODUCT: "商品を特定できませんでした",
  NO_STOCK: "この商品の在庫がありません",
  NO_AMOUNT: "減らす量を決められませんでした",
  UNIT_MISMATCH: "この在庫の単位へ換算できませんでした",
};

/** 照合に使う在庫1件。`queries.ts`がDBから組み立てて渡す。 */
export interface MatchableLot {
  readonly id: string;
  readonly productId: string;
  readonly productName: string;
  readonly brand: string;
  /** 商品の別名（`ProductAlias`）。バーコードや過去のAI候補で登録された表記ゆれ。 */
  readonly aliases: readonly string[];
  /** その商品に紐付いたバーコード（数字列）。 */
  readonly barcodes: readonly string[];
  readonly quantity: Decimal;
  readonly unit: UnitCode;
  readonly storageLocationName: string | null;
  readonly storagePositionName: string | null;
  /** 期限（賞味・消費のうち先に来るほう）。無ければ`null`で、選ぶときは後ろへ回す。 */
  readonly expiryOn: Date | null;
  readonly openedAt: Date | null;
  /** 1単位あたりの内容量（例: 1本 = 2 LITER）。容量で持っている在庫の換算に使う。 */
  readonly contentAmount: Decimal | null;
  readonly contentUnit: UnitCode | null;
}

/** 減らす候補1件。 */
export interface ConsumptionCandidate {
  readonly label: string;
  readonly detectedBarcode: string | null;
  readonly lot: MatchableLot;
  readonly amount: Decimal;
  readonly unit: UnitCode;
  readonly aiConfidence: number;
  readonly confidence: number;
  readonly strength: MatchStrength;
  /** なぜこの商品・この量になったのか。画面にそのまま並べる。 */
  readonly evidence: readonly string[];
}

/** 候補にしなかったもの1件。**件数だけでなく理由を必ず出す。** */
export interface SkippedObservation {
  readonly label: string;
  readonly detectedBarcode: string | null;
  readonly reason: ConsumptionSkipReason;
  /** 理由の具体。「棚の奥を確かめてください」のように、次にやることが分かる文にする。 */
  readonly detail: string;
  readonly aiConfidence: number;
  /** 商品までは分かったが在庫が無かった場合の商品id。「在庫に登録する」の行き先に使う。 */
  readonly productId: string | null;
  readonly productName: string | null;
}

export interface MatchInput {
  readonly kind: ConsumptionScanKind;
  readonly observations: readonly VisionObservation[];
  /** その家庭の、いま持っている在庫（ACTIVE）。数量0のものも渡してよい。 */
  readonly lots: readonly MatchableLot[];
}

export interface MatchResult {
  readonly candidates: readonly ConsumptionCandidate[];
  readonly skipped: readonly SkippedObservation[];
}

// ---------------------------------------------------------------------------
// 文字の正規化と照合
// ---------------------------------------------------------------------------

/**
 * 照合用に文字を揃える。
 *
 * 全角・半角、大文字・小文字、空白と記号の違いは、パッケージの表記と登録名のあいだで
 * 日常的に食い違う。ここで吸収しないと、同じ商品がほぼ毎回「特定できませんでした」になる。
 */
export function normalizeLabel(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　]/g, "")
    .replace(/[-‐-―ー・.,、。()（）[\]【】「」/／+＋]/g, "");
}

/** 数字だけを残す。バーコードの表記ゆれ（ハイフン・空白）を吸収する。 */
function normalizeCode(value: string): string {
  return value.replace(/\D/g, "");
}

interface ProductMatch {
  readonly productId: string;
  readonly strength: MatchStrength;
  /** 一致した文字列。根拠の文に埋める。 */
  readonly matched: string;
}

/**
 * 観察を商品へ結び付ける。**強い手がかりから順に見て、最初に当たったものを採る。**
 *
 * 優先順位はバーコード > 商品名の完全一致 > 別名の完全一致 > 部分一致で、
 * `src/lib/barcode/candidate.ts`の「確定済みルール > バーコードマスタ > AI候補」と同じ考え方
 * ——**強いほうが弱いほうを常に上書きし、「新しいほうを採る」のような別の規則を混ぜない。**
 */
export function matchProduct(
  observation: VisionObservation,
  lots: readonly MatchableLot[],
): ProductMatch | null {
  const code = observation.barcode ? normalizeCode(observation.barcode) : "";
  if (code !== "") {
    for (const lot of lots) {
      if (lot.barcodes.some((barcode) => normalizeCode(barcode) === code)) {
        return { productId: lot.productId, strength: "BARCODE", matched: code };
      }
    }
  }

  const label = normalizeLabel(observation.label);
  if (label === "") return null;

  for (const lot of lots) {
    const name = normalizeLabel(lot.productName);
    const withBrand = normalizeLabel(`${lot.brand}${lot.productName}`);
    if (name !== "" && (name === label || withBrand === label)) {
      return { productId: lot.productId, strength: "NAME", matched: lot.productName };
    }
  }

  for (const lot of lots) {
    const alias = lot.aliases.find((value) => normalizeLabel(value) === label);
    if (alias) return { productId: lot.productId, strength: "ALIAS", matched: alias };
  }

  // 部分一致。2文字以下だと「水」が何にでも当たるため、長さで足切りする。
  const MIN_PARTIAL_LENGTH = 3;
  let best: ProductMatch | null = null;
  let bestLength = 0;
  for (const lot of lots) {
    for (const value of [lot.productName, ...lot.aliases]) {
      const normalized = normalizeLabel(value);
      if (normalized.length < MIN_PARTIAL_LENGTH) continue;
      if (!label.includes(normalized) && !normalized.includes(label)) continue;
      // いちばん長く重なったものを採る（短い名前ほど偶然当たりやすい）。
      if (normalized.length > bestLength) {
        best = { productId: lot.productId, strength: "PARTIAL", matched: value };
        bestLength = normalized.length;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 対象ロットの選び方
// ---------------------------------------------------------------------------

/**
 * 減らす対象のロットを1件選ぶ。
 *
 * 既定は**期限がいちばん近いもの**（FEFO。期限の無いものは後ろ）。残量の写真だけは
 * **開封済みを先に見る**——飲みかけを撮っているのだから、未開封のロットを減らすのは不自然になる。
 */
export function selectLot(
  lots: readonly MatchableLot[],
  kind: ConsumptionScanKind,
): { lot: MatchableLot; reason: string } | null {
  const inStock = lots.filter((lot) => lot.quantity.greaterThan(0));
  if (inStock.length === 0) return null;

  const opened = inStock.filter((lot) => lot.openedAt !== null);
  const pool = kind === "REMAINING" && opened.length > 0 ? opened : inStock;
  const sorted = [...pool].sort(compareByExpiry);
  const lot = sorted[0];

  if (pool !== inStock) {
    return { lot, reason: "開封済みのロットを対象にしています" };
  }
  if (inStock.length > 1) {
    return { lot, reason: "同じ商品のロットのうち、期限がいちばん近いものを選んでいます" };
  }
  return { lot, reason: "この商品の在庫はこの1件です" };
}

function compareByExpiry(a: MatchableLot, b: MatchableLot): number {
  const left = a.expiryOn?.getTime() ?? null;
  const right = b.expiryOn?.getTime() ?? null;
  if (left === right) return a.id.localeCompare(b.id);
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

// ---------------------------------------------------------------------------
// 減らす量
// ---------------------------------------------------------------------------

interface AmountProposal {
  readonly amount: Decimal;
  readonly evidence: string;
}

interface AmountRejection {
  readonly reason: ConsumptionSkipReason;
  readonly detail: string;
}

function isRejection(value: AmountProposal | AmountRejection): value is AmountRejection {
  return "reason" in value;
}

/**
 * ロットの単位で「容器1つぶん」がいくつになるか。
 *
 * 個数で持っている在庫（本・パック）なら1。容量・重量で持っている在庫は、商品の内容量
 * （`Product.contentAmount`／`contentUnit`）を通して換算する。内容量が未登録なら決めようがないので`null`。
 */
export function oneContainerAmount(lot: MatchableLot): Decimal | null {
  if (unitDefinition(lot.unit).dimension === "COUNT") return new Decimal(1);

  if (lot.contentAmount === null || lot.contentUnit === null) return null;
  if (!canConvert(lot.contentUnit, lot.unit)) return null;
  return convertQuantity({ amount: lot.contentAmount, unit: lot.contentUnit }, lot.unit).amount;
}

/**
 * 写真の種類ごとに、減らす量を出す。
 *
 * **決められないときは0や1で埋めず、必ず理由を返して候補から外す。** 誤減算の影響が大きく、
 * 「とりあえず1」が積み上がると在庫の数字そのものが信用できなくなる。
 */
export function proposeAmount(
  kind: ConsumptionScanKind,
  observation: VisionObservation,
  lot: MatchableLot,
): AmountProposal | AmountRejection {
  const oneContainer = oneContainerAmount(lot);
  const unitLabel = unitDefinition(lot.unit).label;

  if (kind === "EMPTY_CONTAINER") {
    if (oneContainer === null) {
      return {
        reason: "UNIT_MISMATCH",
        detail: `この在庫は${unitLabel}で持っているため、容器1つぶんの量が分かりません。商品に内容量を登録すると数えられます。`,
      };
    }
    const containers = observation.containerCount ?? 1;
    if (containers === 0) {
      return { reason: "NO_AMOUNT", detail: "空になった容器が写っていませんでした。" };
    }
    return {
      amount: oneContainer.mul(containers),
      evidence: `空の容器が${containers}つ写っているので、${containers}つぶんを減らします`,
    };
  }

  if (kind === "REMAINING") {
    if (observation.remainingRatio === null) {
      return {
        reason: "NO_AMOUNT",
        detail: "容器にどれだけ残っているかを読み取れませんでした。中身が見えるように撮り直すか、量を手で入れてください。",
      };
    }
    if (oneContainer === null) {
      return {
        reason: "UNIT_MISMATCH",
        detail: `この在庫は${unitLabel}で持っているため、容器1つぶんの量が分かりません。商品に内容量を登録すると数えられます。`,
      };
    }
    // 写真は容器1つの残量なので、在庫が1容器ぶんを超えているとその写真だけでは全体を説明できない。
    // ここで安全側へ倒さないと、未開封のぶんまで減らしてしまう。
    if (lot.quantity.greaterThan(oneContainer)) {
      return {
        reason: "NO_AMOUNT",
        detail: `この在庫は${lot.quantity.toDecimalPlaces(3).toString()}${unitLabel}あり、写真の容器1つでは減った量を決められません。手で入力してください。`,
      };
    }
    const remaining = oneContainer.mul(observation.remainingRatio);
    const percent = Math.round(observation.remainingRatio * 100);
    return {
      amount: lot.quantity.sub(remaining),
      evidence: `容器に残り${percent}%と見えるので、いまの${lot.quantity.toDecimalPlaces(3).toString()}${unitLabel}との差を減らします`,
    };
  }

  // SHELF
  if (unitDefinition(lot.unit).dimension !== "COUNT") {
    return {
      reason: "UNIT_MISMATCH",
      detail: `棚に写っている数から減らせるのは個数で数える在庫だけです（この在庫は${unitLabel}）。`,
    };
  }
  if (observation.visibleCount === null) {
    return {
      reason: "NO_AMOUNT",
      detail: "写真から個数を数えられませんでした。奥に隠れている場合は、正面から撮り直してください。",
    };
  }
  const visible = new Decimal(observation.visibleCount);
  if (visible.greaterThanOrEqualTo(lot.quantity)) {
    return {
      reason: "NO_AMOUNT",
      detail: `棚に${observation.visibleCount}${unitLabel}写っていますが、記録は${lot.quantity.toDecimalPlaces(3).toString()}${unitLabel}です。減った量はありません。`,
    };
  }
  return {
    amount: lot.quantity.sub(visible),
    evidence: `棚に${observation.visibleCount}${unitLabel}写っているので、記録の${lot.quantity.toDecimalPlaces(3).toString()}${unitLabel}との差を減らします`,
  };
}

// ---------------------------------------------------------------------------
// 組み立て
// ---------------------------------------------------------------------------

const MATCH_EVIDENCE: Readonly<Record<MatchStrength, (matched: string) => string>> = {
  BARCODE: (matched) => `バーコード ${matched} が登録済みの商品と一致しました`,
  NAME: (matched) => `商品名が「${matched}」と一致しました`,
  ALIAS: (matched) => `別名「${matched}」と一致しました`,
  PARTIAL: (matched) => `商品名「${matched}」との部分一致だけで結び付けています`,
};

/**
 * 観察を候補と「減らさなかったもの」に振り分ける。
 *
 * 候補は信頼度の高い順に並べる。**候補にしなかったものも必ず返す**——件数の合計が写真の中身と
 * 合っていないと、「見落とされた」のか「安全側に倒された」のかを読み分けられない。
 */
export function buildConsumptionCandidates(input: MatchInput): MatchResult {
  const { kind, observations, lots } = input;
  const candidates: ConsumptionCandidate[] = [];
  const skipped: SkippedObservation[] = [];

  for (const observation of observations) {
    const match = matchProduct(observation, lots);
    if (!match) {
      skipped.push({
        label: observation.label,
        detectedBarcode: observation.barcode,
        reason: "NO_PRODUCT",
        detail:
          observation.note ??
          "写真から読み取った名前に当たる商品が在庫にありません。自分で在庫を選べば、そのまま減らせます。",
        aiConfidence: observation.confidence,
        productId: null,
        productName: null,
      });
      continue;
    }

    const productLots = lots.filter((lot) => lot.productId === match.productId);
    const productName = productLots[0]?.productName ?? observation.label;
    const selected = selectLot(productLots, kind);
    if (!selected) {
      skipped.push({
        label: observation.label,
        detectedBarcode: observation.barcode,
        reason: "NO_STOCK",
        detail: `「${productName}」は登録されていますが、いまの在庫が0です。買ったぶんを先に登録してください。`,
        aiConfidence: observation.confidence,
        productId: match.productId,
        productName,
      });
      continue;
    }

    const proposal = proposeAmount(kind, observation, selected.lot);
    if (isRejection(proposal)) {
      skipped.push({
        label: observation.label,
        detectedBarcode: observation.barcode,
        reason: proposal.reason,
        detail: proposal.detail,
        aiConfidence: observation.confidence,
        productId: match.productId,
        productName,
      });
      continue;
    }

    const { amount, clamped } = clampToStock(proposal.amount, selected.lot);
    if (!amount.greaterThan(0)) {
      skipped.push({
        label: observation.label,
        detectedBarcode: observation.barcode,
        reason: "NO_AMOUNT",
        detail: "写真から読み取れた内容では、減る量が0になりました。",
        aiConfidence: observation.confidence,
        productId: match.productId,
        productName,
      });
      continue;
    }

    const evidence = [
      `写真の文字を「${observation.label}」と読み取りました`,
      MATCH_EVIDENCE[match.strength](match.matched),
      selected.reason,
      proposal.evidence,
    ];
    if (clamped) {
      evidence.push("いまの在庫より多くは減らせないため、在庫のぶんまでに丸めています");
    }
    if (observation.note) evidence.push(`モデルの補足: ${observation.note}`);

    candidates.push({
      label: observation.label,
      detectedBarcode: observation.barcode,
      lot: selected.lot,
      amount,
      unit: selected.lot.unit,
      aiConfidence: observation.confidence,
      confidence: round3(observation.confidence * STRENGTH_WEIGHT[match.strength]),
      strength: match.strength,
      evidence,
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence || a.label.localeCompare(b.label, "ja"));
  return { candidates, skipped };
}

/** 数量はDBの`Decimal(14,3)`に合わせて3桁へ丸め、いまの在庫を超えないようにする。 */
function clampToStock(amount: Decimal, lot: MatchableLot): { amount: Decimal; clamped: boolean } {
  const rounded = amount.toDecimalPlaces(3);
  if (rounded.greaterThan(lot.quantity)) {
    return { amount: lot.quantity.toDecimalPlaces(3), clamped: true };
  }
  return { amount: rounded, clamped: false };
}

function round3(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

/** モデルへ渡す指示。`kinds.ts`の定義をそのまま使う（画面のタブと同じ並びを保つため）。 */
export function promptFor(kind: ConsumptionScanKind): string {
  return SCAN_KIND_DEFINITIONS[kind].prompt;
}

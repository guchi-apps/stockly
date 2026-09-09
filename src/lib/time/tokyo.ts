/**
 * 日付の境目を日本時間（Asia/Tokyo）で扱う。
 *
 * 期限は「日付」であって時刻ではないため、どこかで必ず「今日は何日か」を決めることになる。
 * これをサーバーのローカル時刻やUTCで決めると、**UTCとJSTの日付が違う時間帯（JSTの0時〜9時）で
 * 判定が1日ずれる**。日本時間の朝8時に開いた画面で「今日まで」の在庫が「期限切れ」に見えないのは、
 * 期限管理としては致命的なので、この1か所に閉じて必ず日本時間で数える。
 *
 * 期限の列（`bestBeforeDate`・`useByDate`）はMySQLの`DATE`型で、Prismaは**UTCの0時**の`Date`として
 * 返す。この値も`tokyoDayNumber()`へそのまま渡してよい（UTC0時 + 9時間 = 同じ日の朝9時なので、
 * カレンダー上の日付は変わらない）。時刻を持つ値（`sentAt`など）と同じ関数で扱えるのはこのため。
 *
 * `Intl`のタイムゾーン変換を使わないのは、日本には現在サマータイムが無く固定オフセットで正しく、
 * 純関数のまま（DBもICUのデータも要らずに）テストできるようにするため。
 */

/** JSTの固定オフセット。日本にサマータイムは無い。 */
const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/**
 * 日本時間のカレンダー日を表す通し番号（1970-01-01を0とする）。
 *
 * 日付どうしの引き算は必ずこの番号で行う。`Date`のミリ秒差を86_400_000で割ると、
 * 同じ日でも時刻の差で±1日ずれる。
 */
export function tokyoDayNumber(instant: Date): number {
  return Math.floor((instant.getTime() + TOKYO_OFFSET_MS) / DAY_MS);
}

/**
 * 日本時間での「今日」を、期限の列と同じ形（UTC0時の`Date`）で返す。
 *
 * 期限の比較はこの値を基準に行う。引数を取るのは、テストで時刻を固定するため。
 */
export function tokyoToday(now: Date = new Date()): Date {
  return new Date(tokyoDayNumber(now) * DAY_MS);
}

/** `from`から`to`までの日数。日本時間のカレンダー上で数える。 */
export function tokyoDaysBetween(from: Date, to: Date): number {
  return tokyoDayNumber(to) - tokyoDayNumber(from);
}

/**
 * 日本時間での「今月」の範囲を、実際の時刻（UTC）で返す。`start`以上`end`未満。
 *
 * 費用の上限は「月あたり」で数えるため、月の変わり目もここで決める（#10）。UTCで数えると、
 * **月初の0時〜9時に使ったぶんが前の月に数えられ、上限に達したまま月が変わっても解けない。**
 */
export function tokyoMonthRange(now: Date = new Date()): { start: Date; end: Date } {
  const jst = tokyoParts(now);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1) - TOKYO_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - TOKYO_OFFSET_MS),
  };
}

function tokyoParts(value: Date): Date {
  return new Date(value.getTime() + TOKYO_OFFSET_MS);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `2026/09/08`。日付の列にも時刻を持つ値にも使える。 */
export function formatTokyoDate(value: Date): string {
  const jst = tokyoParts(value);
  return `${jst.getUTCFullYear()}/${pad(jst.getUTCMonth() + 1)}/${pad(jst.getUTCDate())}`;
}

/** `09/08 07:00`。通知や履歴の一覧で、年を省いて並べるとき用。 */
export function formatTokyoDateTime(value: Date): string {
  const jst = tokyoParts(value);
  return `${pad(jst.getUTCMonth() + 1)}/${pad(jst.getUTCDate())} ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
}

/** `2026-09-08`。フォームの`<input type="date">`とdedupeKeyで使う。 */
export function toTokyoDateInput(value: Date): string {
  const jst = tokyoParts(value);
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}`;
}

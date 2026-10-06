/**
 * ログインした利用者を、Stockly側のUser・家庭に結びつける（#134）。
 *
 * **Supabaseのユーザーid（`supabaseUserId`）は、同じ本人でも変わりうる。** 共有のSupabase
 * プロジェクトでユーザーが作り直されると、同じGoogleアカウントでも新しいidでログインしてくる。
 * idだけで引くと新しいUserと新しい家庭ができ、旧い家庭の在庫・履歴・所属は残ったまま
 * 「データが消えた」ように見える（エラーは出ない）。
 *
 * そこで本人の照合は次の順で行う。
 *
 * 1. `supabaseUserId`が一致するUser —— いつもどおりのログイン
 * 2. GoogleアカウントのID（`googleSubject`）が一致するUser —— 認証idが変わった同じ本人。
 *    **User.idを保ったまま`supabaseUserId`だけを付け替える**ので、所属・役割・履歴の記録者は
 *    そのまま引き継がれる。Supabaseは1つのGoogleアカウントを同時に2人のユーザーへ結びつけない
 *    （`auth.identities`の`(provider, provider_id)`が一意）ため、旧いidはもうこのアカウントの
 *    ものではない
 * 3. どちらも無く、**同じメールのUserも無い** —— 本当に初めての利用者。Userと初期の家庭を作る
 *
 * **メールが一致するだけでは同じ本人とみなさない**（一意でもなく、本人が変えられる値でもある）。
 * 1・2で見つからないのに同じメールのUserが居るときは、何も作らずに「復旧が必要」を返す。
 * ここで新しいUserと家庭を作ると、分かれたデータが増えるだけで、後から統合するのが難しくなる。
 * 復旧は`scripts/account-links.ts`で人が確かめてから行う（docs/account-recovery.md）。
 *
 * `scripts/`・`db-tests/`からも呼ぶため、Prismaクライアントは引数で受け取る
 * （`@/`のパスエイリアスは素の`node`では解決できない）。
 */
import type { Prisma, PrismaClient } from "@prisma/client";

export type AccountLinkClient = PrismaClient;

export type StocklyUserProfile = {
  supabaseUserId: string;
  /** `resolveGoogleSubject()`で取り出した値。取り出せなければnull（照合の2段目を使わない）。 */
  googleSubject: string | null;
  email: string | null;
  name: string | null;
  imageUrl: string | null;
};

/** Supabaseの`User.identities`の1件。使う欄だけを構造で受ける（SDKの型に依存しない）。 */
export type SupabaseIdentityLike = {
  id?: string | null;
  provider?: string | null;
  identity_data?: Record<string, unknown> | null;
};

/**
 * Supabaseが記録したGoogleの識別子（OpenID Connectの`sub`）を取り出す。
 *
 * 読むのは`identities`（Supabaseの`auth.identities`。プロバイダの応答からSupabase自身が書き、
 * 利用者は書き換えられない）だけで、**`user_metadata`は読まない**——`updateUser()`で本人が
 * 書き換えられるため、照合の根拠にすると他人のUserへ付け替えられてしまう。
 *
 * Googleの識別子が1つに定まらないとき（無い・複数ある・`id`と`identity_data.sub`が食い違う）はnull。
 * nullのときは照合の2段目を使わないだけで、ログイン自体は止めない。
 */
export function resolveGoogleSubject(
  identities: readonly SupabaseIdentityLike[] | null | undefined,
): string | null {
  const google = (identities ?? []).filter((identity) => identity.provider === "google");
  if (google.length !== 1) return null;

  const [identity] = google;
  const providerId = nonEmpty(identity.id);
  const sub = nonEmpty(identity.identity_data?.sub);
  if (providerId && sub && providerId !== sub) return null;
  return providerId ?? sub;
}

/** 照合の材料。どれも同じトランザクションの中で読んだ値。 */
export type LinkCandidates = {
  /** `supabaseUserId`が一致するUser。 */
  byAuth: { id: string; googleSubject: string | null } | null;
  /** `googleSubject`が一致するUser。 */
  bySubject: { id: string; supabaseUserId: string } | null;
  /** 同じメールを持つUserの数（`byAuth`・`bySubject`がどちらも無いときだけ数える）。 */
  sameEmailUserCount: number;
};

export type RecoveryReason =
  /** 照合できないが、同じメールのUserがすでに居る。 */
  | "same_email"
  /** 同じ`supabaseUserId`のUserが、別のGoogleアカウントに結びついている。 */
  | "subject_mismatch";

export type LinkDecision =
  | { kind: "existing"; userId: string; recordSubject: boolean }
  | { kind: "relink"; userId: string; previousSupabaseUserId: string }
  | { kind: "create" }
  | { kind: "recovery_required"; reason: RecoveryReason };

/**
 * 照合の判定（純関数）。DBを読む・書くのは`linkStocklyUser()`で、ここは決めるだけ。
 */
export function decideAccountLink(
  profile: Pick<StocklyUserProfile, "googleSubject">,
  candidates: LinkCandidates,
): LinkDecision {
  const { byAuth, bySubject } = candidates;
  const subject = profile.googleSubject;

  if (byAuth) {
    // 同じSupabaseユーザーなのに、覚えているGoogleアカウントと違う。どちらの本人のデータかを
    // ここでは決められないので、上書きせずに人の確認へ回す。
    if (subject && byAuth.googleSubject && byAuth.googleSubject !== subject) {
      return { kind: "recovery_required", reason: "subject_mismatch" };
    }
    // このGoogleアカウントを別のUserがすでに持っている（データが分かれた後）。いつもどおり
    // `byAuth`でログインさせ、識別子は書かない（一意制約で落ちるうえ、どちらへ寄せるかは人が決める）。
    const recordSubject = Boolean(subject && !byAuth.googleSubject && !bySubject);
    return { kind: "existing", userId: byAuth.id, recordSubject };
  }

  if (bySubject) {
    return {
      kind: "relink",
      userId: bySubject.id,
      previousSupabaseUserId: bySubject.supabaseUserId,
    };
  }

  if (candidates.sameEmailUserCount > 0) {
    return { kind: "recovery_required", reason: "same_email" };
  }

  return { kind: "create" };
}

export type LinkResult =
  | {
      status: "ready";
      userId: string;
      outcome: "existing" | "relink" | "create";
      /** 所属している家庭が無く、初期の家庭を作ったか。 */
      createdHousehold: boolean;
    }
  | { status: "recovery_required"; reason: RecoveryReason };

/** 同時ログインの競合（一意制約・付け替え先の変化・デッドロック）で、やり直す回数の上限。 */
const MAX_ATTEMPTS = 3;

/**
 * ログインした利用者のUserを用意し、所属している家庭が無ければ初期の家庭を作る。
 *
 * **許可判定（`isAllowedEmail()`）を通した後にだけ呼ぶこと。** ここではもう判定しない。
 *
 * 照合・付け替え・家庭の作成は1つのトランザクションに入れる。途中で失敗しても、
 * 付け替えだけが済んで家庭が無い、のような途中の状態を残さない。同じ本人のログインが
 * 同時に走って一意制約に当たったときは、トランザクションごとやり直す（2回目は1段目で見つかる）。
 */
export async function linkStocklyUser(
  prisma: AccountLinkClient,
  profile: StocklyUserProfile,
): Promise<LinkResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction((tx) => linkInTransaction(tx, profile));
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isRetryableConflict(error)) throw error;
    }
  }
}

async function linkInTransaction(
  tx: Prisma.TransactionClient,
  profile: StocklyUserProfile,
): Promise<LinkResult> {
  const byAuth = await tx.user.findUnique({
    where: { supabaseUserId: profile.supabaseUserId },
    select: { id: true, googleSubject: true },
  });
  const bySubject = profile.googleSubject
    ? await tx.user.findUnique({
        where: { googleSubject: profile.googleSubject },
        select: { id: true, supabaseUserId: true },
      })
    : null;
  const sameEmailUserCount =
    !byAuth && !bySubject && profile.email
      ? await tx.user.count({ where: { email: profile.email } })
      : 0;

  const decision = decideAccountLink(profile, { byAuth, bySubject, sameEmailUserCount });
  const display = { email: profile.email, name: profile.name, imageUrl: profile.imageUrl };

  let userId: string;
  switch (decision.kind) {
    case "recovery_required":
      return { status: "recovery_required", reason: decision.reason };

    case "existing":
      userId = decision.userId;
      await tx.user.update({
        where: { id: userId },
        data: {
          ...display,
          ...(decision.recordSubject ? { googleSubject: profile.googleSubject } : {}),
        },
      });
      break;

    case "relink": {
      userId = decision.userId;
      // 読んだ時点の旧idを条件に入れる。同時に別のログインが付け替えていたら0件になり、やり直す。
      const { count } = await tx.user.updateMany({
        where: { id: userId, supabaseUserId: decision.previousSupabaseUserId },
        data: { ...display, supabaseUserId: profile.supabaseUserId },
      });
      if (count !== 1) throw new LinkRaceError();
      break;
    }

    case "create":
      userId = (
        await tx.user.create({
          data: {
            ...display,
            supabaseUserId: profile.supabaseUserId,
            googleSubject: profile.googleSubject,
          },
          select: { id: true },
        })
      ).id;
      break;
  }

  const createdHousehold = await ensureHousehold(tx, userId, profile);
  return { status: "ready", userId, outcome: decision.kind, createdHousehold };
}

/**
 * 所属している家庭が1つも無ければ、家庭を作って本人をOWNERにする。
 *
 * 数えるのは**いま所属している**行だけ（`removedAt: null`。#12）。除名・脱退した家庭へは
 * 戻さない（付け替えたUserでも同じ）。全部の家庭から外れた人には新しい家庭を作る——
 * 画面から家庭を作る手段が無く、作らないと「家庭が未設定」で固まるため。
 *
 * 同じ利用者のログインが同時に2つ走ると、件数を数えた直後に両方が「まだ家庭が無い」と判断して
 * 家庭が2つできる。数える前にUser行をロックして後続を待たせる。
 */
async function ensureHousehold(
  tx: Prisma.TransactionClient,
  userId: string,
  profile: StocklyUserProfile,
): Promise<boolean> {
  await tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`;

  if ((await tx.householdMember.count({ where: { userId, removedAt: null } })) > 0) {
    return false;
  }

  const household = await tx.household.create({
    data: { name: defaultHouseholdName(profile) },
  });
  await tx.householdMember.create({
    data: { householdId: household.id, userId, role: "OWNER" },
  });
  return true;
}

/** 初回に作る家庭の名前。あとから変えられる前提の仮の名前で、識別には使わない。 */
export function defaultHouseholdName(profile: Pick<StocklyUserProfile, "name" | "email">): string {
  const owner = profile.name?.trim() || profile.email?.split("@")[0]?.trim();
  return owner ? `${owner}の家` : "わが家";
}

/** 付け替えの直前に、別のログインが同じUserを付け替えていた。 */
class LinkRaceError extends Error {
  constructor() {
    super("付け替え先のUserが同時に更新された");
    this.name = "LinkRaceError";
  }
}

/**
 * やり直せば通りうる競合か。P2002（一意制約）・P2034（書き込みの競合・デッドロック）と、
 * 付け替えの競合だけを数える。それ以外はやり直しても同じなので、そのまま投げる。
 */
export function isRetryableConflict(error: unknown): boolean {
  if (error instanceof LinkRaceError) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return code === "P2002" || code === "P2034";
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

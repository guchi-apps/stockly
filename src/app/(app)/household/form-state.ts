import type { FieldErrors } from "@/lib/inventory/operations";

/**
 * 招待フォームが`useActionState`で受け取る状態（#12）。
 *
 * `issued`が入っているのは発行に成功した直後の1回だけ。**平文のトークンはDBに残らないので、
 * ここで受け取り損ねると同じリンクは二度と出せない**（発行し直すことになる）。
 * リダイレクトのクエリではなくこの戻り値で渡しているのは、トークンをURL＝ブラウザの履歴や
 * サーバーのアクセスログへ残さないため。
 */
export interface IssuedInvitation {
  readonly email: string;
  /** 招待リンクのパス。オリジンは画面側で`window.location.origin`から足す。 */
  readonly path: string;
  readonly expiresAt: string;
  readonly roleLabel: string;
}

export interface InviteFormState {
  readonly errors: FieldErrors;
  readonly values: Record<string, string>;
  readonly issued?: IssuedInvitation;
}

export const EMPTY_INVITE_FORM_STATE: InviteFormState = { errors: {}, values: {} };

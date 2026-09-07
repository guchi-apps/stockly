import type { ReactNode } from "react";

/**
 * 在庫まわりの画面で共通に使う枠組み。
 *
 * 見出し・通知・空状態を1か所へ置き、画面ごとに書き分けないようにする
 * （同じ役割の要素が画面ごとに違う見た目になると、操作のたびに読み直すことになる）。
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="bg-background/95 sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 backdrop-blur md:px-6">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-muted-foreground truncate text-xs">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * 操作の結果。Server Actionが戻り先へ付けた`?notice=`／`?error=`をそのまま出す。
 *
 * 文字列はReactが自動でエスケープするため、URLへ入った内容がそのまま描画されることはない。
 * 長すぎる値は切り詰める（URLは誰でも書き換えられるため）。
 */
export function ActionNotice({ notice, error }: { notice?: string; error?: string }) {
  const message = error ?? notice;
  if (!message) return null;

  return (
    <p
      role={error ? "alert" : "status"}
      className={
        error
          ? "border-destructive/40 bg-destructive/10 text-destructive mx-4 mt-4 rounded-lg border px-3 py-2 text-sm md:mx-6"
          : "text-muted-foreground bg-muted mx-4 mt-4 rounded-lg border px-3 py-2 text-sm md:mx-6"
      }
    >
      {message.slice(0, 200)}
    </p>
  );
}

/** 何も無いときに、次にやることを1つだけ示す。 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-16 text-center">
      <span className="text-muted-foreground" aria-hidden>
        {icon}
      </span>
      <b className="text-base font-semibold">{title}</b>
      <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">{description}</p>
      {action}
    </div>
  );
}

/** URLのクエリは配列で来ることがある。先頭だけを使う。 */
export function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

"use client";

import { useFormStatus } from "react-dom";
import { cn } from "cn";

import { Button } from "@/components/ui/button";

import { useOnlineStatus } from "./use-online-status";

/**
 * 送信中とオフラインのあいだは押せなくなるボタン。
 *
 * **送信中**（`useFormStatus`）。二重送信の防止は操作ID（`InventoryTransaction.id`）で行って
 * いるが、それだけだと**「同じ画面から続けて2回消費した」つもりの2回目が、送信中の二重送信と
 * 区別できず黙って落ちる**。操作IDはサーバーが1レンダーにつき1つ発行するため、再描画が終わる
 * までは同じ値のままだからである。
 *
 * 送信中だけ押せなくすると、2回目のタップは必ず再描画後（＝新しい操作ID）になるので、
 * 続けて2回の記録がそのまま2件積まれる。JSが読み込まれる前は無効化が効かないが、
 * その場合は同じ操作IDが送られるので数量が二重に動くことはない（安全側に倒れる）。
 *
 * **オフライン**（#12）。オフラインで送っても届かないので、押せなくしたうえで理由を出す。
 * 送信を溜めて後から流す仕組みは持たない——**「送れたことにして消える」のがいちばん困る**ため、
 * 受入条件どおり、記録できないことをその場で見せる側に倒す。
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "outline",
  size = "sm",
  className,
  name,
  value,
  disabled,
  title,
  ...props
}: React.ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  const online = useOnlineStatus();

  return (
    <Button
      type="submit"
      name={name}
      value={value}
      variant={variant}
      size={size}
      disabled={disabled || pending || !online}
      title={online ? title : "オフラインのため記録できません"}
      className={cn(className)}
      {...props}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

"use client";

import { useFormStatus } from "react-dom";
import { cn } from "cn";

import { Button } from "@/components/ui/button";

/**
 * 送信中は押せなくなるボタン。
 *
 * 二重送信の防止は操作ID（`InventoryTransaction.id`）で行っているが、それだけだと
 * **「同じ画面から続けて2回消費した」つもりの2回目が、送信中の二重送信と区別できず
 * 黙って落ちる**。操作IDはサーバーが1レンダーにつき1つ発行するため、再描画が終わるまでは
 * 同じ値のままだからである。
 *
 * 送信中だけ押せなくすると、2回目のタップは必ず再描画後（＝新しい操作ID）になるので、
 * 続けて2回の記録がそのまま2件積まれる。JSが読み込まれる前は無効化が効かないが、
 * その場合は同じ操作IDが送られるので数量が二重に動くことはない（安全側に倒れる）。
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "outline",
  size = "sm",
  className,
  name,
  value,
  ...props
}: React.ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      name={name}
      value={value}
      variant={variant}
      size={size}
      disabled={pending}
      className={cn(className)}
      {...props}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

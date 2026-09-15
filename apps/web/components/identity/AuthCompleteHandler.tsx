"use client";

import AuthHashHandler from "@/components/identity/AuthHashHandler";

export default function AuthCompleteHandler({
  next,
  exchangeError,
}: {
  next?: string | null;
  exchangeError?: boolean;
}) {
  return <AuthHashHandler next={next} required exchangeError={exchangeError} />;
}

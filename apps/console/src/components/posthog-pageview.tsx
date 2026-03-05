"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (pathname && typeof window !== "undefined") {
      import("posthog-js")
        .then((posthogModule) => {
          const posthog = posthogModule.default;
          if (posthog.__loaded) {
            let url = window.origin + pathname;
            if (searchParams?.toString()) {
              url = `${url}?${searchParams.toString()}`;
            }
            posthog.capture("$pageview", { $current_url: url });
          }
        })
        .catch(() => {});
    }
  }, [pathname, searchParams]);

  return null;
}

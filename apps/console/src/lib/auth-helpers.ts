import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createClient } from "@/lib/supabase/client";

export interface AuthValidationResult {
  isValid: boolean;
  shouldSignOut: boolean;
  error?: string;
}

type AddToastFunction = (message: string, type: "success" | "error") => void;

export async function validateSession(): Promise<AuthValidationResult> {
  const supabase = createClient();

  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) {
      return { isValid: false, shouldSignOut: true, error: "Session corrupted" };
    }

    if (!session) {
      return { isValid: false, shouldSignOut: false, error: "No session found" };
    }

    const { error: userError } = await supabase.auth.getUser();

    if (userError?.code === "user_not_found") {
      return { isValid: false, shouldSignOut: true, error: "User no longer exists" };
    }

    if (userError) {
      return { isValid: false, shouldSignOut: true, error: "Authentication error" };
    }

    return { isValid: true, shouldSignOut: false };
  } catch (error) {
    console.error("Session validation failed:", error);
    return { isValid: false, shouldSignOut: true, error: "Session validation failed" };
  }
}

export async function handleAuthError(
  // biome-ignore lint/suspicious/noExplicitAny: error type varies
  error: any,
  router: AppRouterInstance,
  addToast?: AddToastFunction,
) {
  const supabase = createClient();

  if (error?.code === "user_not_found" || error?.shouldSignOut) {
    await supabase.auth.signOut();
    if (addToast) {
      addToast("Session expired. Please sign in again.", "error");
    }
    router.push("/auth/signin");
    return true;
  }

  return false;
}

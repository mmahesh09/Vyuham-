"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { api, ApiError, type User } from "@/lib/api/client";
import { authClient } from "@/lib/auth-client";
import type { SocialProvider } from "@/lib/auth";

import { PRIVACY_VERSION } from "@/lib/legal";
import type { ForgotInput, LoginInput, SignupInput } from "./schemas";

export const authKeys = { me: ["auth", "me"] as const };

/** Better Auth error codes we show in our own words; anything else uses its message. */
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Wrong email or password",
  USER_ALREADY_EXISTS: "An account with this email already exists",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "An account with this email already exists",
  INVALID_TOKEN: "This reset link is invalid or has expired. Request a new one.",
};

type AuthResult<T> = { data: T | null; error: { message?: string; status: number; code?: string } | null };

/** Turn Better Auth's `{ data, error }` result into a thrown ApiError. */
async function unwrap<T>(call: Promise<AuthResult<T>>): Promise<T> {
  const { data, error } = await call;
  if (error) {
    const message = (error.code && MESSAGES[error.code]) || error.message || "Something went wrong. Please try again.";
    throw new ApiError(error.status, message, error.code);
  }
  return data as T;
}

export function authErrorMessage(code: string | undefined | null) {
  if (!code) return undefined;
  return MESSAGES[code] ?? "Sign-in didn't go through. Please try again.";
}

export function useMe() {
  return useQuery({ queryKey: authKeys.me, queryFn: () => api<User>("/me") });
}

/** Shared success path: go to the app and let the server load the user + workspace. */
function useOnSignedIn() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return () => {
    queryClient.removeQueries({ queryKey: authKeys.me });
    // Came from an invite link: go back and accept it before the app creates a workspace.
    let invite: string | null = null;
    try {
      invite = sessionStorage.getItem("vyuham:pending-invite");
    } catch {}
    router.replace(invite ? `/invite/${invite}` : "/home");
    router.refresh();
  };
}

export function useLogin() {
  const onSignedIn = useOnSignedIn();
  return useMutation({
    mutationFn: (input: LoginInput) => unwrap(authClient.signIn.email(input)),
    onSuccess: onSignedIn,
  });
}

export function useSignup() {
  const onSignedIn = useOnSignedIn();
  return useMutation({
    mutationFn: ({ consent: _consent, ...input }: SignupInput) =>
      unwrap(authClient.signUp.email({ ...input, privacyConsentVersion: PRIVACY_VERSION })),
    onSuccess: onSignedIn,
  });
}

/** Redirects the browser to Google / Apple; comes back to /home or to /login?error=… */
export function useSocialSignIn() {
  return useMutation({
    mutationFn: (provider: SocialProvider) =>
      unwrap(authClient.signIn.social({ provider, callbackURL: "/home", errorCallbackURL: "/login" })),
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: ({ email }: ForgotInput) => unwrap(authClient.requestPasswordReset({ email, redirectTo: "/reset-password" })),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ password, token }: { password: string; token: string }) =>
      unwrap(authClient.resetPassword({ newPassword: password, token })),
  });
}

export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(authClient.signOut()),
    onSettled: () => {
      queryClient.clear();
      router.replace("/login");
      router.refresh();
    },
  });
}

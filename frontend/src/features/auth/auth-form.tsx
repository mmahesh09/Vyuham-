"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useForm, useWatch, type FieldValues, type Path, type UseFormSetError } from "react-hook-form";

import type { SocialProvider } from "@/lib/auth";
import { ApiError } from "@/lib/api/client";

import { AuthField, FormError, FormNotice, OrDivider, SubmitButton, textLink } from "./fields";
import { useForgotPassword, useLogin, useResetPassword, useSignup } from "./hooks";
import {
  forgotSchema,
  loginSchema,
  resetSchema,
  signupSchema,
  type ForgotInput,
  type LoginInput,
  type ResetInput,
  type SignupInput,
} from "./schemas";
import { SocialButtons } from "./social-buttons";

type Providers = Record<SocialProvider, boolean>;

/** Put a taken email on the email field; anything else becomes a form-level message. */
function applyServerError<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>) {
  const message = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
  if (err instanceof ApiError && err.code?.startsWith("USER_ALREADY_EXISTS")) setError("email" as Path<T>, { message });
  else setError("root", { message });
}

const footer = "text-center text-sm text-muted";

export function LoginForm({ providers, initialError }: { providers: Providers; initialError?: string }) {
  const login = useLogin();
  const { register, handleSubmit, setError, control, formState } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const [email, password] = useWatch({ control, name: ["email", "password"] });
  const { errors } = formState;

  return (
    <div className="flex flex-col gap-6">
      <SocialButtons verb="Log in" enabled={providers} />
      <OrDivider />
      <form
        onSubmit={handleSubmit((v) => login.mutateAsync(v).catch((e) => applyServerError(e, setError)))}
        className="flex flex-col gap-4"
        noValidate
      >
        <AuthField
          id="email"
          type="email"
          label="Email"
          placeholder="Your email address"
          autoComplete="email"
          error={errors.email?.message}
          {...register("email")}
        />
        <AuthField
          id="password"
          type="password"
          label="Password"
          placeholder="Your password"
          autoComplete="current-password"
          error={errors.password?.message}
          aside={
            <Link href="/forgot-password" className={`text-sm ${textLink}`}>
              Forgot password?
            </Link>
          }
          {...register("password")}
        />
        <FormError message={errors.root?.message ?? initialError} />
        <SubmitButton ready={Boolean(email && password)} pending={login.isPending || login.isSuccess}>
          Log in
        </SubmitButton>
      </form>
      <p className={footer}>
        Don&apos;t have an account?{" "}
        <Link href="/signup" className={textLink}>
          Sign up
        </Link>
      </p>
    </div>
  );
}

export function SignupForm({ providers }: { providers: Providers }) {
  const signup = useSignup();
  const { register, handleSubmit, setError, control, formState } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", company: "", email: "", password: "", consent: false },
  });
  const values = useWatch({ control });
  const { errors } = formState;
  const ready = Boolean(values.name && values.company && values.email && values.password && values.consent);

  return (
    <div className="flex flex-col gap-6">
      <SocialButtons verb="Sign up" enabled={providers} />
      <p className="-mt-3 text-center text-[12.5px] text-faint">
        By continuing with Google or Apple you agree to the{" "}
        <Link href="/privacy" target="_blank" className={textLink}>
          Privacy Policy
        </Link>
        .
      </p>
      <OrDivider />
      <form
        onSubmit={handleSubmit((v) => signup.mutateAsync(v).catch((e) => applyServerError(e, setError)))}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <AuthField id="name" label="Your name" placeholder="Asha Rao" autoComplete="name" error={errors.name?.message} {...register("name")} />
          <AuthField
            id="company"
            label="Company"
            placeholder="Acme Co"
            autoComplete="organization"
            error={errors.company?.message}
            {...register("company")}
          />
        </div>
        <AuthField
          id="email"
          type="email"
          label="Work email"
          placeholder="you@company.com"
          autoComplete="email"
          error={errors.email?.message}
          {...register("email")}
        />
        <AuthField
          id="password"
          type="password"
          label="Password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          error={errors.password?.message}
          {...register("password")}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="consent" className="flex cursor-pointer items-start gap-3 text-[13.5px] leading-relaxed text-muted">
            <input
              id="consent"
              type="checkbox"
              className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
              aria-invalid={errors.consent ? true : undefined}
              aria-describedby={errors.consent ? "consent-error" : undefined}
              {...register("consent")}
            />
            <span>
              I&apos;m 18 or older and I agree to Vyuham processing my personal data as described in the{" "}
              <Link href="/privacy" target="_blank" className={textLink}>
                Privacy Policy
              </Link>
              , under India&apos;s DPDP Act, 2023. I can withdraw consent at any time.
            </span>
          </label>
          {errors.consent && (
            <p id="consent-error" className="text-[13px] text-accent">
              {errors.consent.message}
            </p>
          )}
        </div>
        <FormError message={errors.root?.message} />
        <SubmitButton ready={ready} pending={signup.isPending || signup.isSuccess}>
          Create free account
        </SubmitButton>
      </form>
      <p className={footer}>
        Already have an account?{" "}
        <Link href="/login" className={textLink}>
          Log in
        </Link>
      </p>
    </div>
  );
}

export function ForgotPasswordForm() {
  const forgot = useForgotPassword();
  const { register, handleSubmit, setError, control, formState } = useForm<ForgotInput>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });
  const email = useWatch({ control, name: "email" });
  const { errors } = formState;

  return (
    <div className="flex flex-col gap-6">
      {forgot.isSuccess ? (
        <FormNotice>
          If an account exists for <span className="font-medium text-text">{forgot.variables.email}</span>, a reset link is on its
          way. It expires in one hour.
        </FormNotice>
      ) : (
        <form
          onSubmit={handleSubmit((v) => forgot.mutateAsync(v).catch((e) => applyServerError(e, setError)))}
          className="flex flex-col gap-4"
          noValidate
        >
          <AuthField
            id="email"
            type="email"
            label="Email"
            placeholder="Your email address"
            autoComplete="email"
            error={errors.email?.message}
            {...register("email")}
          />
          <FormError message={errors.root?.message} />
          <SubmitButton ready={Boolean(email)} pending={forgot.isPending}>
            Send reset link
          </SubmitButton>
        </form>
      )}
      <p className={footer}>
        Remembered it?{" "}
        <Link href="/login" className={textLink}>
          Back to log in
        </Link>
      </p>
    </div>
  );
}

export function ResetPasswordForm({ token, initialError }: { token?: string; initialError?: string }) {
  const reset = useResetPassword();
  const { register, handleSubmit, setError, control, formState } = useForm<ResetInput>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "" },
  });
  const password = useWatch({ control, name: "password" });
  const { errors } = formState;

  if (!token || initialError) {
    return (
      <div className="flex flex-col gap-6">
        <FormError message={initialError ?? "This reset link is incomplete. Request a new one."} />
        <Link href="/forgot-password" className={`text-center text-sm ${textLink}`}>
          Request a new link
        </Link>
      </div>
    );
  }

  if (reset.isSuccess) {
    return (
      <div className="flex flex-col gap-6">
        <FormNotice>Your password has been changed. Log in with your new password.</FormNotice>
        <Link href="/login" className="flex h-11 items-center justify-center rounded-[10px] bg-primary text-[15px] font-semibold text-white">
          Go to log in
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit((v) => reset.mutateAsync({ password: v.password, token }).catch((e) => applyServerError(e, setError)))}
      className="flex flex-col gap-4"
      noValidate
    >
      <AuthField
        id="password"
        type="password"
        label="New password"
        placeholder="At least 8 characters"
        autoComplete="new-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <FormError message={errors.root?.message} />
      <SubmitButton ready={Boolean(password)} pending={reset.isPending}>
        Set new password
      </SubmitButton>
    </form>
  );
}

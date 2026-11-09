import { z } from "zod";

// Limits mirror src/lib/auth.ts (Better Auth emailAndPassword options).
const email = z.email("Enter a valid email address").max(320);
const newPassword = z.string().min(8, "Use at least 8 characters").max(72, "Passwords can be at most 72 characters");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password").max(72, "Passwords can be at most 72 characters"),
});

export const signupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  company: z.string().trim().min(1, "Enter your company name").max(120),
  email,
  password: newPassword,
  consent: z.boolean().refine((v) => v, "Please agree to the Privacy Policy to create an account"),
});

export const forgotSchema = z.object({ email });
export const resetSchema = z.object({ password: newPassword });

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type ForgotInput = z.infer<typeof forgotSchema>;
export type ResetInput = z.infer<typeof resetSchema>;

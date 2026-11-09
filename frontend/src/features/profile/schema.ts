import { isValidPhoneNumber } from "react-phone-number-input";
import { z } from "zod";

// Limits mirror backend/app/schemas.py ProfileIn.
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time")
  .nullable();

export const ROLE_MAX = 280;

export const profileSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  job_role: z
    .string()
    .trim()
    .min(2, "Your role is required — e.g. “Finance lead, owns monthly reporting”")
    .max(ROLE_MAX, `Keep it under ${ROLE_MAX} characters`),
  phone: z
    .string()
    .refine((v) => v === "" || isValidPhoneNumber(v), "Enter a valid phone number for the selected country"),
  timezone: z.string(),
  work_start: hhmm,
  work_end: hhmm,
  signature: z.string().nullable(),
  dashboard_visibility: z.enum(["team", "anyone"]),
  notify_email: z.boolean(),
  notify_weekly: z.boolean(),
});

export type ProfileForm = z.infer<typeof profileSchema>;

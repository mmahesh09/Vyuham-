"use client";

import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { planName, usePlanPrompt } from "./plans";

/** Shown when the server refuses something because of the plan: what the limit is, and where to go next. */
export function PlanLimitDialog() {
  const { prompt, close } = usePlanPrompt();
  return (
    <Dialog open={!!prompt} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{prompt?.requiredPlan ? `Available on ${planName(prompt.requiredPlan)}` : "You've reached a plan limit"}</DialogTitle>
          <DialogDescription>
            {prompt?.message} Nothing you&apos;ve already made is affected. Paid plans open soon. Until then, see your usage
            on the billing page.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Link href="/pricing" onClick={close} className={buttonVariants({ variant: "outline" })}>
            Compare plans
          </Link>
          <Link href="/billing" onClick={close} className={buttonVariants()}>
            View usage
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

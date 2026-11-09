"use client";

import { Check } from "lucide-react";
import { useState } from "react";

import { Rating } from "@/components/reui/rating";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { useSendFeedback } from "./api";

const LABELS = ["", "Not useful", "Needs work", "It's okay", "Pretty good", "Love it"];

/** Rate Vyuham (ReUI c-rating-6, editable). */
export function FeedbackCard() {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const send = useSendFeedback();

  if (send.isSuccess) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-highlight">
        <Check className="size-4" aria-hidden /> Thanks — your feedback reached the team.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (rating) send.mutate({ rating, comment: comment.trim() || undefined });
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Rating rating={rating} editable onRatingChange={setRating} aria-label="Your rating" />
        <span className="text-sm text-muted" aria-live="polite">
          {LABELS[rating] || "Tap a star"}
        </span>
      </div>
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value.slice(0, 2000))}
        placeholder="What would make Vyuham more useful? (optional)"
        rows={2}
        aria-label="Feedback comment"
      />
      {send.isError && <p className="text-[13px] text-accent">{send.error.message}</p>}
      <Button type="submit" variant="outline" className="self-start" disabled={!rating || send.isPending}>
        {send.isPending ? "Sending…" : "Send feedback"}
      </Button>
    </form>
  );
}

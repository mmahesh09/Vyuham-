"use client";

import { PenLine } from "lucide-react";
import { useRef, useState } from "react";

import {
  SignaturePad,
  SignaturePadArea,
  SignaturePadClear,
  SignaturePadControls,
  SignaturePadGuide,
  SignaturePadPlaceholder,
  type SignaturePadApi,
  type SignaturePadStroke,
} from "@/components/reui/signature-pad";
import { Button } from "@/components/ui/button";

type Props = {
  /** PNG data URL, or null when there's no signature. */
  value: string | null;
  onChange: (value: string | null) => void;
  signerName: string;
};

/**
 * Draw a signature (ReUI c-signature-pad-7). Stored as a black-ink PNG so it prints on paper;
 * shown on a light "paper" chip so it stays readable on the dark theme.
 */
export function SignatureField({ value, onChange, signerName }: Props) {
  const padRef = useRef<SignaturePadApi>(null);
  const [strokes, setStrokes] = useState<SignaturePadStroke[]>([]);
  const [editing, setEditing] = useState(value === null);

  if (!editing && value) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex h-36 items-center justify-center rounded-xl bg-text p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing for next/image to optimise */}
          <img src={value} alt={`Signature of ${signerName}`} className="max-h-full max-w-full object-contain" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>{signerName}</span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setStrokes([]);
                setEditing(true);
                requestAnimationFrame(() => padRef.current?.focus());
              }}
            >
              <PenLine aria-hidden /> Redraw
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              Remove
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <SignaturePad
      apiRef={padRef}
      value={strokes}
      onValueChange={(next) => {
        setStrokes(next);
        // Export after the pad has committed the stroke; black ink on transparent, cropped to the ink.
        requestAnimationFrame(() => {
          const pad = padRef.current;
          onChange(pad && !pad.isEmpty ? pad.toDataURL({ padding: 8, scale: 2 }) : null);
        });
      }}
      className="flex flex-col gap-2"
    >
      <SignaturePadArea aria-label="Your signature" className="h-36">
        <SignaturePadGuide />
        <SignaturePadPlaceholder />
        <SignaturePadControls position="top-end">
          <SignaturePadClear variant="ghost" />
        </SignaturePadControls>
      </SignaturePadArea>
      <div className="flex justify-between text-xs text-muted">
        <span>{signerName}</span>
        {value === null ? <span>Draw with a mouse, finger or pen</span> : <span>Saved when you save your profile</span>}
      </div>
    </SignaturePad>
  );
}

"use client"

import { useState } from "react"
import type { CSSProperties } from "react"
import { Badge } from "@/components/reui/badge"
import {
  ColorPicker,
  getContrastRatio,
} from "@/components/reui/color-picker"
import { Frame, FramePanel } from "@/components/reui/frame"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { ArrowLeftRightIcon } from "lucide-react"

/* WCAG 2.2 thresholds: 4.5 and 7 for body text, 3 for large text. */
const CHECKS = [
  { level: "AA", text: "Body", min: 4.5 },
  { level: "AAA", text: "Body", min: 7 },
  { level: "AA", text: "Large", min: 3 },
]

export function Pattern() {
  const [text, setText] = useState<string | null>("#1e3a8a")
  const [background, setBackground] = useState<string | null>("#dbeafe")
  const ratio = text && background ? getContrastRatio(text, background) : null

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Contrast checker</CardTitle>
        <CardDescription>
          WCAG ratios for a text and background pair.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-5">
          <Frame>
            <FramePanel
              style={
                {
                  "--frame-panel-bg": background ?? undefined,
                  color: text ?? undefined,
                } as CSSProperties
              }
            >
              <div className="flex flex-col gap-1">
                <p className="text-lg font-semibold">
                  Quarterly report is ready
                </p>
                <p className="text-sm">
                  Revenue grew 18% on the quarter, led by self-serve plans.
                </p>
              </div>
            </FramePanel>
          </Frame>
          <div className="flex items-end gap-2">
            <Field className="min-w-0 flex-1">
              <FieldLabel id="contrast-text-label" htmlFor="contrast-text">
                Text
              </FieldLabel>
              <ColorPicker
                id="contrast-text"
                value={text}
                onValueChange={setText}
                aria-labelledby="contrast-text-label"
              />
            </Field>
            <Button
              variant="outline"
              size="icon"
              aria-label="Swap text and background"
              onClick={() => {
                setText(background)
                setBackground(text)
              }}
            >
              <ArrowLeftRightIcon aria-hidden="true" />
            </Button>
            <Field className="min-w-0 flex-1">
              <FieldLabel
                id="contrast-background-label"
                htmlFor="contrast-background"
              >
                Background
              </FieldLabel>
              <ColorPicker
                id="contrast-background"
                value={background}
                onValueChange={setBackground}
                aria-labelledby="contrast-background-label"
              />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div role="status">
              <p className="text-3xl font-semibold tabular-nums">
                {ratio ? `${ratio.toFixed(2)}:1` : "None"}
              </p>
              <p className="text-muted-foreground text-xs">Contrast ratio</p>
            </div>
            <ul className="flex flex-col items-end gap-1.5">
              {CHECKS.map((check) => {
                const pass = ratio !== null && ratio >= check.min
                return (
                  <li
                    key={`${check.level}-${check.text}`}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span className="text-muted-foreground">
                      {check.text} {check.level}
                    </span>
                    <Badge
                      variant={pass ? "success-light" : "destructive-light"}
                    >
                      {pass ? "Pass" : "Fail"}
                    </Badge>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
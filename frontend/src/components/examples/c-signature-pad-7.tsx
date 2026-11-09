"use client"

import { useId, useRef, useState } from "react"
import { Badge } from "@/components/reui/badge"
import {
  SignaturePad,
  SignaturePadArea,
  SignaturePadClear,
  SignaturePadControls,
  SignaturePadGuide,
  SignaturePadPlaceholder,
  type SignaturePadApi,
  type SignaturePadStroke,
} from "@/components/reui/signature-pad"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"

export function Pattern() {
  const id = useId()
  const [strokes, setStrokes] = useState<SignaturePadStroke[]>([])
  const [agreed, setAgreed] = useState(false)
  const [signedAt, setSignedAt] = useState<string | null>(null)
  const padRef = useRef<SignaturePadApi>(null)

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>Service agreement</CardTitle>
        <CardDescription>Northwind Studio, 12-month retainer</CardDescription>
        <CardAction>
          {/* Up here, away from Sign agreement, so a double click on it
              cannot land on Start over and wipe what was just signed. */}
          <div className="flex items-center gap-2">
            {signedAt && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setSignedAt(null)
                  setStrokes([])
                  setAgreed(false)
                  requestAnimationFrame(() => padRef.current?.focus())
                }}
              >
                Start over
              </Button>
            )}
            <Badge variant={signedAt ? "success-light" : "warning-light"}>
              {signedAt ? "Signed" : "Awaiting signature"}
            </Badge>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            By signing you accept the scope, the payment schedule and the 30-day
            notice period in sections 2 to 5.
          </p>
          <SignaturePad
            apiRef={padRef}
            value={strokes}
            onValueChange={setStrokes}
            readOnly={signedAt !== null}
          >
            <SignaturePadArea aria-label="Client signature" className="h-36">
              <SignaturePadGuide />
              <SignaturePadPlaceholder />
              {signedAt === null && (
                <SignaturePadControls position="top-end">
                  <SignaturePadClear variant="ghost" />
                </SignaturePadControls>
              )}
            </SignaturePadArea>
            <div className="text-muted-foreground flex justify-between text-xs">
              <span>Maya Chen, Client</span>
              <span>{signedAt ?? "Dated on signing"}</span>
            </div>
          </SignaturePad>
          <Field orientation="horizontal">
            <Checkbox
              id={`${id}-agree`}
              checked={agreed}
              disabled={signedAt !== null}
              onCheckedChange={(checked) => setAgreed(checked === true)}
            />
            <FieldLabel htmlFor={`${id}-agree`}>
              I have read and agree to the agreement
            </FieldLabel>
          </Field>
        </div>
      </CardContent>
      <CardFooter>
        {signedAt ? (
          <p
            ref={(node) => node?.focus()}
            tabIndex={-1}
            role="status"
            className="w-full text-center text-sm font-medium outline-none"
          >
            Agreement signed
          </p>
        ) : (
          <Button
            className="w-full"
            disabled={!agreed || strokes.length === 0}
            onClick={() =>
              setSignedAt(
                new Intl.DateTimeFormat("en-US", {
                  dateStyle: "medium",
                }).format(new Date())
              )
            }
          >
            Sign agreement
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
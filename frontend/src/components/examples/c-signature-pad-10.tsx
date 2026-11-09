"use client"

import { useState } from "react"
import { Badge } from "@/components/reui/badge"
import {
  SignaturePad,
  SignaturePadArea,
  SignaturePadClear,
  SignaturePadControls,
  SignaturePadPlaceholder,
} from "@/components/reui/signature-pad"

import { Button } from "@/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { CircleCheckIcon, CircleDashedIcon } from "lucide-react"

const CLAUSES = [
  {
    id: "scope",
    number: 2,
    title: "Scope of work",
    description: "Design and build of the marketing site, 6 templates.",
  },
  {
    id: "payment",
    number: 3,
    title: "Payment terms",
    description: "Invoiced monthly in arrears, due within 30 days.",
  },
  {
    id: "ownership",
    number: 4,
    title: "Ownership",
    description: "Source files transfer to the client on final payment.",
  },
  {
    id: "termination",
    number: 5,
    title: "Termination",
    description: "Either party, with 30 days written notice.",
  },
]

export function Pattern() {
  const [initialed, setInitialed] = useState<Record<string, boolean>>({})
  const [submitted, setSubmitted] = useState(false)
  const count = CLAUSES.filter((clause) => initialed[clause.id]).length
  const complete = count === CLAUSES.length

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium">Initial each clause</p>
          <p className="text-muted-foreground text-xs">
            Your initials confirm you have read the section.
          </p>
        </div>
        <Badge variant={complete ? "success-light" : "secondary"}>
          {count} of {CLAUSES.length} initialed
        </Badge>
      </div>
      <ItemGroup>
        {CLAUSES.map((clause) => {
          const done = initialed[clause.id] === true
          return (
            <Item key={clause.id} variant="outline" size="sm">
              <ItemMedia variant="icon" aria-hidden="true">
                {done ? (
                  <CircleCheckIcon className="text-success" />
                ) : (
                  <CircleDashedIcon className="text-muted-foreground" />
                )}
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {clause.number}. {clause.title}
                  {done && <span className="sr-only">, initialed</span>}
                </ItemTitle>
                <ItemDescription>{clause.description}</ItemDescription>
              </ItemContent>
              <ItemActions>
                {/* Initials are small, so the line range is narrower too. */}
                <SignaturePad
                  minWidth={0.6}
                  maxWidth={2.4}
                  readOnly={submitted}
                  className="w-28"
                  onValueChange={(strokes) =>
                    setInitialed((current) => ({
                      ...current,
                      [clause.id]: strokes.length > 0,
                    }))
                  }
                >
                  <SignaturePadArea
                    variant="muted"
                    aria-label={`Initials for ${clause.title}`}
                    className="h-14"
                  >
                    <SignaturePadPlaceholder>Initials</SignaturePadPlaceholder>
                    {done && !submitted && (
                      <SignaturePadControls className="end-1 top-1">
                        <SignaturePadClear variant="ghost" size="icon-xs" />
                      </SignaturePadControls>
                    )}
                  </SignaturePadArea>
                </SignaturePad>
              </ItemActions>
            </Item>
          )
        })}
      </ItemGroup>
      {submitted ? (
        <p
          ref={(node) => node?.focus()}
          tabIndex={-1}
          role="status"
          className="self-end text-sm font-medium outline-none"
        >
          Initials submitted
        </p>
      ) : (
        <Button
          disabled={!complete}
          onClick={() => setSubmitted(true)}
          className="self-end"
        >
          Submit initials
        </Button>
      )}
    </div>
  )
}
"use client"

import { useId, useLayoutEffect, useRef, useState } from "react"
import {
  EmojiPicker,
  EmojiPickerCategories,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerHeader,
  EmojiPickerList,
  EmojiPickerPreview,
  EmojiPickerSearch,
  EmojiPickerSkinTone,
  EmojiPickerTrigger,
  EmojiPickerValue,
  useEmojiPicker,
} from "@/components/reui/emoji-picker"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { PopoverTitle } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { FileTextIcon, SmilePlusIcon } from "lucide-react"

const RANDOM_CATEGORIES = new Set<string>([
  "nature",
  "food",
  "travel",
  "activities",
  "objects",
])

/* Rendered inside the picker for its loaded emoji and its select(), so
   Random commits and closes the popover exactly like a click on a cell. */
function IconMenuTitle({ titleId }: { titleId: string }) {
  const { emojis, value, select, clear, setOpen } = useEmojiPicker()

  return (
    <div className="flex items-center justify-between gap-2 px-(--emoji-picker-padding) pt-(--emoji-picker-padding)">
      <PopoverTitle id={titleId}>Icon</PopoverTitle>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={emojis.length === 0}
          onClick={() => {
            /* Objects, places, food and nature make page icons. Faces read
               as a mood, symbols as a status ("Black square button") and
               flags render as letters on Windows. */
            const pool = emojis.filter((emoji) =>
              RANDOM_CATEGORIES.has(emoji.category)
            )
            select(pool[Math.floor(Math.random() * pool.length)])
          }}
        >
          Random
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!value}
          onClick={() => {
            /* Closing hands focus back to the trigger, the same button now
               reading Add icon. */
            clear()
            setOpen(false)
          }}
        >
          Remove
        </Button>
      </div>
    </div>
  )
}

export function Pattern() {
  const titleId = useId()
  /* Preselected: the page already has a stored icon, kept as the emoji
     itself so it fits a plain text column. */
  const [icon, setIcon] = useState<string | null>("🎯")
  const slotRef = useRef<HTMLDivElement>(null)

  /* Every style pads a ghost button differently, so the pull is read off the
     button: it puts the glyph, not the box, on the title's edge. The trigger
     stays one node across both states, and each swap resizes it. */
  useLayoutEffect(() => {
    const slot = slotRef.current
    const button = slot?.firstElementChild
    if (!slot || !button) return
    const observer = new ResizeObserver(() => {
      const mark = button.querySelector("svg, [data-slot=emoji-picker-value]")
      if (!mark) return
      const box = button.getBoundingClientRect()
      const glyph = mark.getBoundingClientRect()
      const inset =
        getComputedStyle(slot).direction === "rtl"
          ? box.right - glyph.right
          : glyph.left - box.left
      slot.style.marginInlineStart = `${-inset}px`
    })
    observer.observe(button)
    return () => observer.disconnect()
  }, [])

  return (
    <EmojiPicker value={icon} onValueChange={setIcon} aria-label="Page icon">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Workspace</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Projects</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>
                  {/* A fixed box, so the name stays put when the icon is
                      removed and a plain document glyph takes its place. The
                      emoji is set at the icon's 16px, not the crumb's text
                      size, so both read the same size in every style. */}
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="flex size-4 shrink-0 items-center justify-center text-base"
                    >
                      {icon ? (
                        <EmojiPickerValue />
                      ) : (
                        <FileTextIcon className="size-4" />
                      )}
                    </span>
                    Q4 planning
                  </span>
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </CardHeader>
        <Separator />
        <CardContent>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3">
              {/* One 72px row for both states, so the title never moves.
                  -ms-1.5 is the stored icon's pull, for the server render. */}
              <div ref={slotRef} className="-ms-1.5 flex h-18 items-end">
                {icon ? (
                  <EmojiPickerTrigger variant="ghost" className="size-18">
                    {/* The value draws at the font size around it, custom
                        image emoji included. */}
                    <span className="text-6xl">
                      <EmojiPickerValue />
                    </span>
                  </EmojiPickerTrigger>
                ) : (
                  /* Still the one trigger, so the popover keeps its anchor
                     and focus its target. The label matches the text. */
                  <EmojiPickerTrigger
                    variant="ghost"
                    size="sm"
                    aria-label="Add icon"
                  >
                    <SmilePlusIcon data-icon="inline-start" aria-hidden="true" />
                    Add icon
                  </EmojiPickerTrigger>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <h2 className="text-3xl font-semibold tracking-tight">
                  Q4 planning
                </h2>
                <p className="text-muted-foreground">
                  Goals, owners and launch dates for the quarter.
                </p>
              </div>
            </div>
            {/* The card's own type size, so the row matches the description
                in every style. Each item leads with its dot and the row is
                pulled out by dot plus gap, so the clip hides only the dot
                that starts a line: wrapped or not, none ends or opens one. */}
            <div className="overflow-x-clip">
              <div className="text-muted-foreground -ms-3.5 flex flex-wrap items-center gap-x-2.5 gap-y-2">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
                  />
                  <div className="flex items-center gap-2">
                    <Avatar size="sm">
                      <AvatarImage
                        src="https://images.unsplash.com/photo-1519699047748-de8e457a634e?w=96&h=96&dpr=2&q=80"
                        alt=""
                      />
                      <AvatarFallback>AO</AvatarFallback>
                    </Avatar>
                    <span className="text-foreground font-medium">
                      Amara Okafor
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
                  />
                  <Badge variant="secondary">On track</Badge>
                </div>
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
                  />
                  <span>Edited 2 days ago</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      {/* Opens under the icon, like Notion, leaving it in view. The explicit
          labelledby keeps the twins equal: only the Base UI PopoverTitle
          names its popover on its own. */}
      <EmojiPickerContent align="start" aria-labelledby={titleId}>
        <IconMenuTitle titleId={titleId} />
        <EmojiPickerHeader>
          <EmojiPickerSearch />
        </EmojiPickerHeader>
        <EmojiPickerCategories />
        <EmojiPickerList />
        <EmojiPickerFooter>
          <EmojiPickerPreview />
          <EmojiPickerSkinTone />
        </EmojiPickerFooter>
      </EmojiPickerContent>
    </EmojiPicker>
  )
}
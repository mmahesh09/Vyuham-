"use client"

import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerTrigger,
  getEmojiValue,
  searchEmojis,
  useEmojiPickerData,
  type EmojiPickerEmoji,
} from "@/components/reui/emoji-picker"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { SendIcon } from "lucide-react"

type Author = { name: string; initials: string; avatar: string }

type Comment = { id: string; author: Author; time: string; text: string }

const photo = (id: string) =>
  `https://images.unsplash.com/photo-${id}?w=96&h=96&dpr=2&q=80`

const PRIYA: Author = {
  name: "Priya Shah",
  initials: "PS",
  avatar: photo("1584308972272-9e4e7685e80f"),
}
const LUCAS: Author = {
  name: "Lucas Martin",
  initials: "LM",
  avatar: photo("1527980965255-d3b416303d12"),
}
const ME: Author = {
  name: "Mira Stone",
  initials: "MS",
  avatar: photo("1494790108377-be9c29b29330"),
}

const THREAD: Comment[] = [
  {
    id: "c1",
    author: PRIYA,
    time: "10:12 AM",
    text: "Moved the promo code field under the total and tightened the order summary. Ready for another look.",
  },
  {
    id: "c2",
    author: LUCAS,
    time: "10:20 AM",
    text: "Pay button stays above the fold on the smallest phones now.",
  },
]

/* Ends mid-shortcode so the suggestions already show on load. */
const DRAFT = "So much cleaner now :fire"

/* `:` then two or more letters, right before the caret. */
const TOKEN = /(?:^|\s):([\p{L}\p{N}_+-]{2,})$/u
/* The rest of the word after the caret, replaced along with the token. */
const TAIL = /^[\p{L}\p{N}_+-]*/u
/* A finished `:shortcode:`, converted as soon as the closing colon lands. */
const FINISHED = /:([a-z0-9_+-]+):$/

const shortcodeOf = (emoji: EmojiPickerEmoji) =>
  `:${emoji.shortcodes[0] ?? emoji.label.replace(/\s+/g, "_")}:`

const sentenceCase = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1)

export function Pattern() {
  const id = useId()
  /* The same shared data the picker loads, fetched once for both. */
  const { data } = useEmojiPickerData()
  const [comments, setComments] = useState(THREAD)
  const [text, setText] = useState(DRAFT)
  const [caret, setCaret] = useState(DRAFT.length)
  const [highlight, setHighlight] = useState(0)
  /* Escape hides the list for this exact token only; the next keystroke
     makes a new token and the list comes back. */
  const [dismissed, setDismissed] = useState<string | null>(null)
  const fieldRef = useRef<HTMLInputElement>(null)
  const empty = !text.trim()

  /* The DOM caret starts at 0 while `caret` starts at the end; matching them
     makes a click into the field resume where the draft stops. */
  useEffect(() => {
    fieldRef.current?.setSelectionRange(DRAFT.length, DRAFT.length)
  }, [])

  const token = TOKEN.exec(text.slice(0, caret))?.[1] ?? null
  const suggestions =
    token && data && token !== dismissed
      ? searchEmojis(data.emojis, token, { limit: 5 })
      : []
  const active = suggestions[Math.min(highlight, suggestions.length - 1)]
  const open = suggestions.length > 0

  const place = (next: string, position: number) => {
    setText(next)
    setCaret(position)
    setHighlight(0)
    /* Focus now, the caret after React writes the value, or the browser
       parks it at the end of the text. A focus() deferred to that frame
       would pull focus back from wherever a fast Tab already took it. */
    fieldRef.current?.focus()
    requestAnimationFrame(() =>
      fieldRef.current?.setSelectionRange(position, position)
    )
  }

  const accept = (emoji: EmojiPickerEmoji) => {
    if (!token) return
    const from = caret - token.length - 1
    const to = caret + (TAIL.exec(text.slice(caret))?.[0].length ?? 0)
    const rest = text.slice(to)
    const value = getEmojiValue(emoji)
    /* Reuse a space that already follows the word instead of doubling it;
       either way the caret lands after the space, ready for the next word. */
    const insert = /^\s/.test(rest) ? value : `${value} `
    place(text.slice(0, from) + insert + rest, from + value.length + 1)
  }

  /* A pick from the picker lands at the caret. The field is blurred while
     the popover is open, so this writes the value and the selection by
     hand; returnFocus brings focus back with the caret already placed. */
  const insert = (value: string) => {
    const field = fieldRef.current
    if (!field) return
    const start = field.selectionStart ?? text.length
    const end = field.selectionEnd ?? start
    const next = text.slice(0, start) + value + text.slice(end)
    field.value = next
    field.setSelectionRange(start + value.length, start + value.length)
    setText(next)
    setCaret(start + value.length)
  }

  const post = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    /* An empty submit sends the user back to the field. */
    if (empty) {
      fieldRef.current?.focus()
      return
    }
    setComments([
      ...comments,
      {
        id: `c${comments.length + 1}`,
        author: ME,
        time: "Just now",
        text: text.trim(),
      },
    ])
    setDismissed(null)
    place("", 0)
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Mobile checkout</CardTitle>
        <CardDescription>Design review</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Plain rows, not Items: an Item pads its media in from the edge
            the title and the composer share. A log announces each comment
            as it lands, so a post needs no separate status region. */}
        <div role="log" aria-label="Comments" className="flex flex-col gap-4">
          {comments.map((comment) => (
            <div key={comment.id} className="flex gap-3">
              {/* An empty alt: the name sits beside the photo. */}
              <Avatar>
                <AvatarImage src={comment.author.avatar} alt="" />
                <AvatarFallback>{comment.author.initials}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2 font-medium">
                  {comment.author.name}
                  <span
                    aria-hidden="true"
                    className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
                  />
                  <span className="text-muted-foreground font-normal">
                    {comment.time}
                  </span>
                </div>
                <p className="text-pretty wrap-break-word">{comment.text}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter>
        <form onSubmit={post} className="flex w-full flex-col gap-2">
          <p role="status" className="sr-only">
            {open
              ? `${suggestions.length} emoji suggestion${suggestions.length === 1 ? "" : "s"}`
              : ""}
          </p>
          <InputGroup>
            <InputGroupInput
              ref={fieldRef}
              value={text}
              role="combobox"
              aria-expanded={open}
              aria-controls={open ? `${id}-list` : undefined}
              aria-activedescendant={active ? `${id}-${active.id}` : undefined}
              aria-autocomplete="list"
              aria-label="Add a comment"
              placeholder="Add a comment"
              onChange={(event) => {
                const value = event.target.value
                const position = event.target.selectionStart ?? value.length
                setText(value)
                setCaret(position)
                setHighlight(0)
                setDismissed(null)
                const finished = FINISHED.exec(value.slice(0, position))
                const match =
                  finished &&
                  data?.emojis.find((emoji) =>
                    emoji.shortcodes.includes(finished[1])
                  )
                if (finished && match) {
                  const head =
                    value.slice(0, position - finished[0].length) +
                    getEmojiValue(match)
                  place(head + value.slice(position), head.length)
                }
              }}
              /* The selection end, so a select-all on focus keeps the
                 token under the caret. */
              onSelect={(event) =>
                setCaret(event.currentTarget.selectionEnd ?? 0)
              }
              /* A list left open after focus moves on reads as stuck.
                 Coming back to an unfinished token shows it again. */
              onBlur={() => setDismissed(token)}
              onFocus={() => setDismissed(null)}
              onKeyDown={(event) => {
                /* Enter also confirms an IME composition; that one belongs
                   to the input method. */
                if (event.nativeEvent.isComposing) return
                /* Cmd/Ctrl+Enter posts the draft as typed, list or not. */
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  post()
                  return
                }
                /* With no list open, Enter submits and Tab leaves. */
                if (!active) return
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault()
                  const step = event.key === "ArrowDown" ? 1 : -1
                  setHighlight(
                    (suggestions.indexOf(active) + step + suggestions.length) %
                      suggestions.length
                  )
                } else if (
                  event.key === "Enter" ||
                  (event.key === "Tab" && !event.shiftKey)
                ) {
                  event.preventDefault()
                  accept(active)
                } else if (event.key === "Escape") {
                  event.preventDefault()
                  setDismissed(token)
                }
              }}
            />
            <InputGroupAddon align="inline-end">
              {/* Controlled to null so the trigger keeps its smiley: this
                  button inserts, it does not hold a value. Opening it hides
                  the suggestions, which would sit under the popover. */}
              <EmojiPicker
                value={null}
                aria-label="Add emoji"
                onOpenChange={(next) => next && setDismissed(token)}
                onEmojiSelect={({ value }) => insert(value)}
              >
                <EmojiPickerTrigger variant="ghost" size="icon-sm" />
                {/* Above the field so the thread stays in view; it flips
                    below when the page leaves no room. */}
                <EmojiPickerContent
                  side="top"
                  align="end"
                  returnFocus={fieldRef}
                />
              </EmojiPicker>
              {/* Never `disabled`: inside an InputGroup that greys out the
                  whole field. The button fills once there is a draft. */}
              <Button
                type="submit"
                variant={empty ? "ghost" : "default"}
                size="icon-sm"
                aria-label="Post comment"
                aria-disabled={empty}
              >
                <SendIcon aria-hidden="true" />
              </Button>
            </InputGroupAddon>
          </InputGroup>
          {/* Under the field, so the line being typed never moves when it
              opens. Rows are not focusable: the field keeps focus and
              aria-activedescendant points at one. A press would blur the
              field, closing the list before the click lands. */}
          {open && (
            <div
              id={`${id}-list`}
              role="listbox"
              aria-label="Emoji suggestions"
              className="flex flex-col"
              onPointerDown={(event) => event.preventDefault()}
            >
              {suggestions.map((emoji, index) => (
                <Item
                  key={emoji.id}
                  id={`${id}-${emoji.id}`}
                  role="option"
                  size="xs"
                  /* Outline, not muted: bg-surface-2/50 all but vanishes on a
                     tinted footer, a border reads in every style and theme. */
                  variant={emoji === active ? "outline" : "default"}
                  aria-selected={emoji === active}
                  onPointerMove={() => setHighlight(index)}
                  onClick={() => accept(emoji)}
                >
                  <ItemMedia aria-hidden="true">
                    <span className="text-xl leading-none">{emoji.emoji}</span>
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    {/* One row on a shared baseline: the 12px shortcode
                        centred beside the 14px name sits visibly high.
                        Both ellipsize, so a long name never wraps the row
                        or pushes the emoji onto a line of its own; the
                        shortcode, which repeats the name, gives way first. */}
                    <div className="flex min-w-0 items-baseline justify-between gap-2">
                      <ItemTitle>
                        <span className="truncate">
                          {sentenceCase(emoji.label)}
                        </span>
                      </ItemTitle>
                      <ItemDescription className="shrink-3">
                        <span className="block truncate">
                          {shortcodeOf(emoji)}
                        </span>
                      </ItemDescription>
                    </div>
                  </ItemContent>
                </Item>
              ))}
            </div>
          )}
        </form>
      </CardFooter>
    </Card>
  )
}
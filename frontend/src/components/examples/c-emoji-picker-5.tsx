"use client"

import { useRef, useState } from "react"
import {
  EMOJI_PICKER_CATEGORIES,
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerTrigger,
  type EmojiPickerCustomCategory,
  type EmojiPickerCustomEmoji,
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
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Separator } from "@/components/ui/separator"
import { SendIcon } from "lucide-react"

/* Inline SVG so the example ships no image files. In an app these are the
   workspace's uploads, and any image URL works as `src`. One font size keeps
   one cap height; 4-letter labels are fitted to 44 of the 64 units, so a
   wider system font (Segoe UI, Roboto) cannot push them into the corners. */
const glyph = (text: string, color: string, size = 18) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${color}"/><text x="32" y="${32 + size * 0.35}" font-family="system-ui,sans-serif" font-size="${size}" font-weight="800" letter-spacing="-0.5" fill="#fff" text-anchor="middle"${text.length >= 4 ? ' textLength="44" lengthAdjust="spacingAndGlyphs"' : ""}>${text}</text></svg>`
  )}`

/* Emoji whose `category` matches a `customCategories` id get their own tab,
   named by its label. The workspace logo replaces the default sparkle, the
   way Discord marks each server's set. */
const WORKSPACE: EmojiPickerCustomCategory = {
  id: "northwind",
  label: "Northwind Labs",
  icon: (
    <img
      src={glyph("N", "#4f46e5", 40)}
      alt=""
      width={16}
      height={16}
      className="size-4"
    />
  ),
}

/* The team's set leads, ahead of Frequently used, so it opens first however
   much the picker has been used. */
const CATEGORIES = [WORKSPACE.id, "recent", ...EMOJI_PICKER_CATEGORIES]

/* Two full rows of the default 8 columns, so the set opens as a block of its
   own above Smileys. The id doubles as the shortcode: `:lgtm:`. Where the
   tile prints another word, that word is a second shortcode, so it ties the
   native emoji of that name and the team's set, listed first, wins; a tag
   ranks below a name match. Only the id is stored and rendered, so a typed
   `:ship:` stays text and `:+1:` (a tag) stays the thumbs up. */
const TEAM_EMOJI: EmojiPickerCustomEmoji[] = [
  { id: "lgtm", label: "Looks good to me", src: glyph("LGTM", "#16a34a") },
  {
    id: "shipit",
    label: "Ship it",
    src: glyph("SHIP", "#7c3aed"),
    shortcodes: ["shipit", "ship"],
  },
  {
    id: "plusone",
    label: "Plus one",
    src: glyph("+1", "#2563eb"),
    tags: ["+1", "agree", "yes"],
  },
  { id: "wip", label: "Work in progress", src: glyph("WIP", "#d97706") },
  {
    id: "blocked",
    label: "Blocked",
    src: glyph("STOP", "#dc2626"),
    shortcodes: ["blocked", "stop"],
  },
  {
    id: "ty",
    label: "Thank you",
    src: glyph("TY", "#db2777"),
    tags: ["thanks"],
  },
  { id: "ack", label: "Acknowledged", src: glyph("ACK", "#475569") },
  {
    id: "hotfix",
    label: "Hotfix",
    src: glyph("FIX", "#ea580c"),
    shortcodes: ["hotfix", "fix"],
  },
  { id: "nit", label: "Nitpick", src: glyph("NIT", "#0891b2") },
  { id: "sync", label: "Let's sync", src: glyph("SYNC", "#65a30d") },
  {
    id: "revert",
    label: "Revert",
    src: glyph("UNDO", "#c026d3"),
    shortcodes: ["revert", "undo"],
  },
  {
    id: "live",
    label: "Live in production",
    src: glyph("LIVE", "#0284c7"),
    tags: ["deployed"],
  },
  { id: "brb", label: "Be right back", src: glyph("BRB", "#ca8a04") },
  {
    id: "looking",
    label: "Taking a look",
    src: glyph("LOOK", "#0d9488"),
    shortcodes: ["looking", "look"],
    tags: ["eyes"],
  },
  { id: "help", label: "Need a hand", src: glyph("HELP", "#e11d48") },
  { id: "qa", label: "Ready for QA", src: glyph("QA", "#9333ea") },
].map((emoji) => ({ ...emoji, category: WORKSPACE.id }))

const BY_CODE = new Map(TEAM_EMOJI.map((emoji) => [`:${emoji.id}:`, emoji]))

/* Custom emoji travel as `:shortcode:` in the stored text and become images
   on render, the way Slack and Discord keep them. `h-lh` fills the line
   box each style sets (20px on nova, 16px on lyra) and the width follows
   the square intrinsic size, so the line keeps its height. */
function renderText(text: string) {
  return text.split(/(:[a-z0-9_+-]+:)/g).map((part, index) => {
    const emoji = BY_CODE.get(part)
    return emoji ? (
      <img
        key={index}
        src={emoji.src}
        alt={emoji.label}
        title={part}
        width={20}
        height={20}
        className="inline-block h-lh w-auto align-top"
      />
    ) : (
      part
    )
  })
}

type Author = { name: string; initials: string; avatar: string }

type Post = { id: string; author: Author; time: string; text: string }

const photo = (id: string) =>
  `https://images.unsplash.com/photo-${id}?w=96&h=96&dpr=2&q=80`

const AMARA: Author = {
  name: "Amara Okafor",
  initials: "AO",
  avatar: photo("1519699047748-de8e457a634e"),
}
const MICHAEL: Author = {
  name: "Michael Rodriguez",
  initials: "MR",
  avatar: photo("1500648767791-00dcc994a43e"),
}
const DANIEL: Author = {
  name: "Daniel Kim",
  initials: "DK",
  avatar: photo("1535713875002-d1d0cf377fde"),
}
const PRIYA: Author = {
  name: "Priya Shah",
  initials: "PS",
  avatar: photo("1584308972272-9e4e7685e80f"),
}
const ME: Author = {
  name: "Mira Stone",
  initials: "MS",
  avatar: photo("1494790108377-be9c29b29330"),
}

const ROOT: Post = {
  id: "root",
  author: AMARA,
  time: "9:36 AM",
  text: "Release candidate is on staging :shipit: and one flaky checkout spec is left :wip:",
}

const REPLIES: Post[] = [
  {
    id: "r1",
    author: MICHAEL,
    time: "9:48 AM",
    text: "Pinned the payment mock :hotfix:",
  },
  {
    id: "r2",
    author: DANIEL,
    time: "9:52 AM",
    text: "Green on all three browsers :lgtm:",
  },
  {
    id: "r3",
    author: PRIYA,
    time: "9:55 AM",
    text: "Release notes are merged :ty: :plusone:",
  },
]

function PostItem({
  post,
  variant,
}: {
  post: Post
  variant?: "default" | "muted"
}) {
  return (
    <Item variant={variant}>
      {/* An empty alt: the name sits beside the photo, so a screen reader
          would otherwise read it twice. Top-aligned by hand, since Item only
          does that when it finds an ItemDescription. */}
      <ItemMedia className="self-start">
        <Avatar>
          <AvatarImage src={post.author.avatar} alt="" />
          <AvatarFallback>{post.author.initials}</AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {post.author.name}
          <span
            aria-hidden="true"
            className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
          />
          <span className="text-muted-foreground font-normal">{post.time}</span>
        </ItemTitle>
        {/* Not ItemDescription, which clamps to two lines: a thread shows
            every message whole, the one you just sent included. */}
        <p className="text-pretty wrap-break-word">{renderText(post.text)}</p>
      </ItemContent>
    </Item>
  )
}

export function Pattern() {
  const [replies, setReplies] = useState(REPLIES)
  const [text, setText] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const empty = !text.trim()

  /* A blurred input keeps its selection, so the shortcode replaces it and
     the caret lands after it. Padding it with spaces keeps it a token of its
     own: in `at 10:30:ty:` the time would swallow the opening colon. */
  const insert = (code: string) => {
    const field = inputRef.current
    if (!field) return
    const { value, selectionStart, selectionEnd } = field
    const start = selectionStart ?? value.length
    const before = value.slice(0, start)
    const after = value.slice(selectionEnd ?? start)
    const chunk = `${before && !before.endsWith(" ") ? " " : ""}${code}${after.startsWith(" ") ? "" : " "}`
    const caret = start + chunk.length + (after.startsWith(" ") ? 1 : 0)
    const next = before + chunk + after
    field.value = next
    field.setSelectionRange(caret, caret)
    setText(next)
  }

  /* A fixed label, not a clock read, so the server render and the first
     client render agree. Focus goes back to the field for the next reply. */
  const send = () => {
    if (empty) return
    setReplies([
      ...replies,
      {
        id: `r${replies.length + 1}`,
        author: ME,
        time: "Just now",
        text: text.trim(),
      },
    ])
    setText("")
    inputRef.current?.focus()
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Release 4.2</CardTitle>
        <CardDescription>#release-train</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          <PostItem post={ROOT} variant="muted" />
          {/* The rows bring their own padding, so a tight gap here keeps
              the label as far from the first reply as from the root. */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground shrink-0 text-xs">
                {replies.length} {replies.length === 1 ? "reply" : "replies"}
              </span>
              {/* Separator is shrink-0 at full width, so a flex-1 wrapper
                gives it the room the label leaves. */}
              <div className="flex-1">
                <Separator />
              </div>
            </div>
            {/* A log announces each reply as it lands, so a send needs no
              separate status region. */}
            <div role="log" aria-label="Replies" className="flex flex-col">
              {replies.map((reply) => (
                <PostItem key={reply.id} post={reply} />
              ))}
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <InputGroup>
          <InputGroupInput
            ref={inputRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              /* Enter that confirms an IME composition is not a send. */
              if (event.key === "Enter" && !event.nativeEvent.isComposing)
                send()
            }}
            placeholder="Reply"
            aria-label="Reply to thread"
          />
          <InputGroupAddon align="inline-end">
            {/* Controlled to null so the trigger keeps its smiley: this
                button inserts, it does not hold a value. Recent picks are
                kept per workspace, since another workspace's `:shortcode:`
                means nothing here. */}
            <EmojiPicker
              value={null}
              aria-label="Add emoji"
              customEmojis={TEAM_EMOJI}
              customCategories={[WORKSPACE]}
              categories={CATEGORIES}
              recentStorageKey="northwind-emoji-recent"
              onEmojiSelect={({ value }) => insert(value)}
            >
              <EmojiPickerTrigger variant="ghost" size="icon-sm" />
              {/* Above the field so the draft stays in view; it flips below
                  when the thread leaves no room. */}
              <EmojiPickerContent
                side="top"
                align="end"
                returnFocus={inputRef}
              />
            </EmojiPicker>
            {/* Never `disabled`: inside an InputGroup that greys out the
                whole field. An empty send is a no-op that says so, and the
                button fills once there is a draft. It stays mounted rather
                than appearing with the draft, so the emoji button never
                jumps under the pointer. */}
            <Button
              variant={empty ? "ghost" : "default"}
              size="icon-sm"
              aria-label="Send reply"
              aria-disabled={empty}
              onClick={send}
            >
              <SendIcon aria-hidden="true" />
            </Button>
          </InputGroupAddon>
        </InputGroup>
      </CardFooter>
    </Card>
  )
}
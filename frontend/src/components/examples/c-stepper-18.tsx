"use client"

import { useEffect, useRef, useState, type PointerEvent } from "react"
import { Badge, type BadgeProps } from "@/components/reui/badge"
import {
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperPanel,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/reui/stepper"
import { cn } from "cn"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel"
import { CircleDashedIcon, CheckIcon } from "lucide-react"

interface Detail {
  label: string
  value: string
  badge?: BadgeProps["variant"]
  avatar?: string
}

interface Stage {
  title: string
  time: string
  summary: string
  details: Detail[]
}

const stages: Stage[] = [
  {
    title: "Loaded",
    time: "15:08",
    summary: "Parcels scanned and loaded at depot B23.",
    details: [
      { label: "Depot", value: "B23" },
      {
        label: "Agent",
        value: "Mark",
        avatar:
          "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=96&h=96&dpr=2&q=80",
      },
    ],
  },
  {
    title: "Out",
    time: "15:10",
    summary: "Left the yard through gate A3 on schedule.",
    details: [
      { label: "Gate", value: "A3" },
      { label: "Status", value: "On time", badge: "success-light" },
    ],
  },
  {
    title: "Transit",
    time: "15:18",
    summary: "On the ring road at 18 km/h, 6 minutes behind plan.",
    details: [
      { label: "Speed", value: "18 km/h" },
      { label: "Delay", value: "+6 min", badge: "warning-light" },
    ],
  },
  {
    title: "Delivery",
    time: "15:28",
    summary: "Last of 8 stops, arriving in about 5 minutes.",
    details: [
      { label: "Stop", value: "8/8" },
      { label: "ETA", value: "5 min", badge: "success-light" },
    ],
  },
  {
    title: "Return",
    time: "15:45",
    summary: "Back to depot B23 to charge, battery at 62%.",
    details: [
      { label: "Depot", value: "B23" },
      { label: "Battery", value: "62%" },
    ],
  },
]

function Pending({ spin = false }: { spin?: boolean }) {
  return (
    <span className="bg-ring/80 flex size-5.5 items-center justify-center rounded-full text-white">
      <CircleDashedIcon className={cn("size-3.5", spin && "animate-spin")} aria-hidden="true" />
    </span>
  )
}

// The 26px ring stays transparent and the 22px dot inside it carries the
// state color, so the 1px gap between them shows whatever surface is behind.
const indicators = {
  completed: (
    <span className="bg-success flex size-5.5 items-center justify-center rounded-full text-white">
      <CheckIcon className="size-3.5" aria-hidden="true" />
    </span>
  ),
  inactive: <Pending />,
  loading: <Pending spin />,
}

// A flex item with no text has its baseline at its bottom edge, so in an
// items-baseline row this dashed rule lands on the text baseline.
function Leader() {
  return (
    <span
      aria-hidden="true"
      className="border-ring/30 min-w-2 flex-1 border-b border-dashed"
    />
  )
}

// 4px dots spaced edge to edge by mask-repeat: space, so a connector at least
// one tile wide never shows a clipped dot. Tiles are in rem, like the box.
const dots =
  "m-0 bg-transparent bg-linear-to-r mask-[radial-gradient(circle_closest-side,#000_90%,transparent)] mask-size-[0.4375rem_0.25rem] mask-repeat-space rtl:bg-linear-to-l group-data-[orientation=horizontal]/stepper-nav:h-1"

const START_STEP = 4
// Matches the fade width: a mouse resting this close to a faded edge
// steps the row that way, one stage per beat.
const EDGE_PX = 40
const STEP_MS = 600

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches

// Embla follows focus only after a Tab press, but the stepper moves focus
// with the arrow keys, so the browser would scroll the clipped viewport
// natively. Undo that and bring the stage in through Embla instead.
function followFocus(api: NonNullable<CarouselApi>, event: FocusEvent) {
  const root = api.rootNode()
  root.scrollLeft = 0
  const slide = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-slot=carousel-item]"
  )
  const index = slide ? api.slideNodes().indexOf(slide) : -1
  if (index < 0) return false
  const box = root.getBoundingClientRect()
  const { left, right } = slide!.getBoundingClientRect()
  if (left < box.left || right > box.right) {
    api.scrollTo(
      Math.min(index, api.scrollSnapList().length - 1),
      reducedMotion()
    )
  }
  return false
}

const carouselOptions = {
  align: "start",
  dragFree: true,
  inViewThreshold: 1,
  startIndex: START_STEP - 1,
  watchFocus: followFocus,
} as const

export function Pattern() {
  const [current, setCurrent] = useState(START_STEP)
  const [api, setApi] = useState<CarouselApi>()
  const [edges, setEdges] = useState({ prev: false, next: false })
  const prevRef = useRef<HTMLButtonElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  // One past the last step marks every step complete. No tab is selected
  // then, so the last one keeps the tablist's tab stop.
  const allDone = current > stages.length
  const hover = useRef({ dir: 0, timer: 0 })

  // Each faded edge shows only while there is more row past it, so a
  // row that fits renders as a plain stepper: no fade, nothing to drag.
  useEffect(() => {
    if (!api) return
    const sync = () =>
      setEdges((prev) => {
        const next = { prev: api.canScrollPrev(), next: api.canScrollNext() }
        return prev.prev === next.prev && prev.next === next.next ? prev : next
      })
    sync()
    api.on("scroll", sync).on("reInit", sync)
    return () => {
      api.off("scroll", sync).off("reInit", sync)
    }
  }, [api])

  // Previous and Next live outside the row, so bring the active stage in
  // when it is not fully visible. Snaps are trimmed at the end, so a late
  // stage shares the last snap.
  useEffect(() => {
    if (!api || api.slidesInView().includes(current - 1)) return
    const snap = Math.min(current - 1, api.scrollSnapList().length - 1)
    api.scrollTo(snap, reducedMotion())
  }, [api, current])

  useEffect(() => () => window.clearInterval(hover.current.timer), [])

  function hoverEdge(dir: number) {
    if (!api || dir === hover.current.dir) return
    window.clearInterval(hover.current.timer)
    hover.current = { dir, timer: 0 }
    if (!dir) return
    const step = () => {
      if (dir < 0 ? !api.canScrollPrev() : !api.canScrollNext()) {
        return hoverEdge(0)
      }
      if (dir < 0) api.scrollPrev(reducedMotion())
      else api.scrollNext(reducedMotion())
    }
    step()
    hover.current.timer = window.setInterval(step, STEP_MS)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || event.buttons) return hoverEdge(0)
    const { left, right } = event.currentTarget.getBoundingClientRect()
    hoverEdge(
      event.clientX < left + EDGE_PX && edges.prev
        ? -1
        : event.clientX > right - EDGE_PX && edges.next
          ? 1
          : 0
    )
  }

  function goTo(step: number) {
    setCurrent(step)
    // The pressed button disables itself at either end, so focus moves
    // to its partner.
    if (step === 1) nextRef.current?.focus()
    if (step > stages.length) prevRef.current?.focus()
  }

  return (
    <Stepper
      value={current}
      onValueChange={setCurrent}
      indicators={indicators}
      className="flex max-w-3xl flex-col gap-6"
      aria-label="Shipment timeline"
    >
      <StepperNav>
        {/* The stepper owns the tablist roles and the arrow keys, so the
            carousel's own region role and key handler are switched off; it
            only moves the row. Slides grow to fill a wide box and keep their
            content width in a narrow one, which is when the row scrolls. */}
        <Carousel
          setApi={setApi}
          opts={carouselOptions}
          role={undefined}
          aria-roledescription={undefined}
          onKeyDownCapture={undefined}
          onPointerMove={onPointerMove}
          onPointerLeave={() => hoverEdge(0)}
          data-prev={edges.prev || undefined}
          data-next={edges.next || undefined}
          className="-m-1 min-w-0 flex-1 data-next:mask-r-from-[calc(100%-2.5rem)] data-prev:mask-l-from-[calc(100%-2.5rem)]"
        >
          <CarouselContent className="ml-0 py-1">
            {stages.map((stage, index) => {
              const step = index + 1
              const last = step === stages.length

              // The primitive shows loading on the active stage only, so every
              // stage carries the flag, the spinner follows the selection and
              // `indicators` needs no `active` entry.
              return (
                <CarouselItem
                  key={stage.title}
                  role={undefined}
                  aria-roledescription={undefined}
                  className={cn(
                    "basis-auto pl-1",
                    last ? "min-w-32 pr-1" : "grow"
                  )}
                >
                  <StepperItem
                    step={step}
                    loading
                    className="items-stretch justify-start gap-2 group-data-[orientation=horizontal]/stepper-nav:flex-col"
                  >
                    <div className="flex items-center gap-1">
                      <StepperTrigger
                        tabIndex={
                          allDone && step === stages.length ? 0 : undefined
                        }
                        aria-label={stage.title}
                      >
                        <StepperIndicator className="border-ring/80 data-[state=completed]:border-success size-6.5 border bg-transparent data-[state=active]:bg-transparent data-[state=completed]:bg-transparent" />
                      </StepperTrigger>

                      {/* data-state greens the start once this stage is done;
                          the end follows only when the next stage is done too.
                          The last connector fades out: the route continues past
                          the part this timeline shows. */}
                      {step < stages.length ? (
                        <StepperSeparator
                          className={cn(
                            dots,
                            "from-ring/80 to-ring/80 data-[state=completed]:from-success to-70%",
                            step + 1 < current
                              ? "to-success"
                              : "data-[state=completed]:to-ring"
                          )}
                        />
                      ) : (
                        <StepperSeparator
                          className={cn(dots, "from-ring/80 to-transparent")}
                        />
                      )}
                    </div>

                    {/* The title and the detail labels share one auto column
                        through subgrid, so every leader in a stage starts at the
                        same x and the column follows the font, not a fixed width. */}
                    <div
                      className={cn(
                        "grid grid-cols-[auto_1fr] items-baseline gap-x-1 gap-y-1.5 ps-0.5",
                        last ? "pe-1" : "pe-5"
                      )}
                    >
                      <StepperTitle>{stage.title}</StepperTitle>
                      <div className="flex items-baseline gap-1">
                        <Leader />
                        <span className="text-muted-foreground text-xs whitespace-nowrap">
                          {stage.time}
                        </span>
                      </div>

                      <dl className="col-span-2 grid grid-cols-subgrid gap-y-1.5">
                        {stage.details.map((detail) => (
                          <div
                            key={detail.label}
                            className="col-span-2 grid grid-cols-subgrid items-baseline"
                          >
                            <dt className="text-xs font-medium">
                              {detail.label}
                            </dt>
                            <dd className="flex items-baseline gap-1">
                              <Leader />
                              {detail.avatar ? (
                                // Only the name takes part in baseline alignment (the avatar
                                // centers itself), so the badge's baseline is its text and the
                                // row lines up with its neighbours.
                                <Badge
                                  variant="outline"
                                  radius="full"
                                  className="items-baseline"
                                >
                                  <Avatar className="size-3.5 self-center">
                                    <AvatarImage src={detail.avatar} alt="" />
                                    <AvatarFallback>
                                      {detail.value.charAt(0)}
                                    </AvatarFallback>
                                  </Avatar>
                                  {detail.value}
                                </Badge>
                              ) : detail.badge ? (
                                <Badge variant={detail.badge} radius="full">
                                  {detail.value}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-xs whitespace-nowrap">
                                  {detail.value}
                                </span>
                              )}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </StepperItem>
                </CarouselItem>
              )
            })}
          </CarouselContent>
        </Carousel>
      </StepperNav>

      <StepperPanel className="text-center">
        {stages.map((stage, index) => (
          <StepperContent key={stage.title} value={index + 1}>
            <p className="text-sm font-medium">{stage.title}</p>
            <p className="text-muted-foreground text-sm">{stage.summary}</p>
          </StepperContent>
        ))}
        <StepperContent value={stages.length + 1}>
          <p className="text-sm font-medium">Run complete</p>
          <p className="text-muted-foreground text-sm">
            Back at depot B23 with every stop delivered.
          </p>
        </StepperContent>
        <div className="mt-3 flex justify-center gap-2">
          <Button
            ref={prevRef}
            variant="outline"
            size="sm"
            disabled={current === 1}
            onClick={() => goTo(current - 1)}
          >
            Previous
          </Button>
          <Button
            ref={nextRef}
            variant="outline"
            size="sm"
            disabled={allDone}
            onClick={() => goTo(current + 1)}
          >
            Next
          </Button>
        </div>
      </StepperPanel>
    </Stepper>
  )
}
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  ButtonGroup,
  ButtonGroupText,
} from "@/components/ui/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { UsersIcon, PlusIcon, ClockIcon, MoreHorizontalIcon, UserIcon, SettingsIcon, ExternalLinkIcon } from "lucide-react"

const team = [
  { name: "Shadcn", src: "https://github.com/shadcn.png", fallback: "CN" },
  { name: "Max", src: "https://github.com/maxleiter.png", fallback: "ML" },
  {
    name: "Evil Rabbit",
    src: "https://github.com/evilrabbit.png",
    fallback: "ER",
  },
]

export function Pattern() {
  return (
    <ButtonGroup>
      {/* Team Context */}
      <Button variant="outline">
        <UsersIcon aria-hidden="true" />
        <span>Team</span>
      </Button>

      {/* Active Members - Inspired by Avatar Patterns */}
      <ButtonGroupText className="gap-0 bg-transparent">
        <AvatarGroup>
          {team.map((member) => (
            <Avatar key={member.name} className="size-5">
              <AvatarImage src={member.src} alt={member.name} />
              <AvatarFallback>{member.fallback}</AvatarFallback>
            </Avatar>
          ))}
        </AvatarGroup>
        <div className="ml-2 flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-green-500" />
          <span className="text-muted-foreground text-xs font-medium">
            3 Live
          </span>
        </div>
      </ButtonGroupText>

      {/* Collaboration Actions */}
      <Button variant="outline" size="icon">
        <PlusIcon aria-hidden="true" />
      </Button>
      <Button variant="outline" size="icon">
        <ClockIcon aria-hidden="true" />
      </Button>

      {/* Options Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="icon">
              <MoreHorizontalIcon aria-hidden="true" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Team Settings</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <UserIcon aria-hidden="true" />
              <span>Manage members</span>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <SettingsIcon aria-hidden="true" />
              <span>Team preferences</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <ExternalLinkIcon aria-hidden="true" />
            <span>Open dashboard</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
}
import { Badge } from "@/components/reui/badge"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { BadgeCheckIcon } from "lucide-react"

export function Pattern() {
  return (
    <div className="flex items-center justify-center">
      <p className="text-sm">
        Verified domain{" "}
        <Tooltip>
          <TooltipTrigger className="text-muted-foreground align-middle">
            <BadgeCheckIcon className="size-4 text-emerald-600" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>
            <div className="flex items-center gap-2">
              <Badge variant="success" size="sm">
                Verified
              </Badge>
              <p>Domain ownership has been confirmed.</p>
            </div>
          </TooltipContent>
        </Tooltip>
      </p>
    </div>
  )
}
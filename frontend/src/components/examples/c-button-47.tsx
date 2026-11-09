import { Badge } from "@/components/reui/badge"

import { Button } from "@/components/ui/button"

export function Pattern() {
  return (
    <Button aria-label="Updates (new)">
      Updates
      <Badge variant="success" size="xs" aria-hidden="true">
        New
      </Badge>
    </Button>
  )
}
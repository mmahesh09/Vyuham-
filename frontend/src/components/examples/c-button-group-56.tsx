import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { PaperclipIcon, DownloadIcon } from "lucide-react"

const attachment = {
  name: "Q4-Product-Roadmap.pdf",
  size: "2.4 MB",
}

export function Pattern() {
  return (
    <ButtonGroup>
      <Button variant="outline" size="xs">
        <PaperclipIcon aria-hidden="true" />
        {attachment.name}
        <span className="opacity-60">({attachment.size})</span>
      </Button>
      <Button variant="outline" size="icon-xs" aria-label="Download attachment">
        <DownloadIcon aria-hidden="true" />
      </Button>
    </ButtonGroup>
  )
}
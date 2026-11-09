import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/reui/alert"
import { CircleAlertIcon } from "lucide-react"

export function Pattern() {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon
      />
      <AlertTitle>Payment Failed</AlertTitle>
      <AlertDescription>
        <p>Please check your payment details:</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm">
          <li>Card number and expiry</li>
          <li>Billing address</li>
          <li>Available funds</li>
        </ul>
      </AlertDescription>
    </Alert>
  )
}
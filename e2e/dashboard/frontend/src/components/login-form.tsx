import { useState } from "react"
import { Loader2Icon } from "lucide-react"
import { useSearchParams } from "react-router-dom"

import GoogleIcon from "@/assets/GoogleIcon"
import { cn } from "@/lib/utils"
import { googleLoginUrl } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
} from "@/components/ui/field"

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [params] = useSearchParams()
  const error = params.get("error")
  const [redirecting, setRedirecting] = useState(false)

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col items-center gap-2 text-center">
        <a href="/" className="flex items-center gap-2 font-medium">
          <img src="/favicon.svg" alt="" className="size-8" />
          <span className="text-2xl font-semibold tracking-tight">Scout</span>
        </a>
        <p className="text-muted-foreground text-sm text-balance">
          End-to-end test management Platform for modern web applications
        </p>
      </div>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Welcome back</CardTitle>
          <CardDescription>Login with your Google account</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
            <Field>
              <Button
                variant="outline"
                type="button"
                disabled={redirecting}
                onClick={() => {
                  setRedirecting(true)
                  window.location.href = googleLoginUrl()
                }}
              >
                {redirecting ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <GoogleIcon className="size-4" />
                )}
                {redirecting ? "Logging in…" : "Continue with Google"}
              </Button>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our <a href="#">Terms of Service</a>{" "}
        and <a href="#">Privacy Policy</a>.
      </FieldDescription>
    </div>
  )
}

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

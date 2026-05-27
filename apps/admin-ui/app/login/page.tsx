import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <Card className="w-full max-w-sm border-border bg-card/80 shadow-2xl shadow-black/40 backdrop-blur-xl">
        <CardHeader>
          <div className="mb-2 grid size-10 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
            FD
          </div>
          <CardTitle className="text-xl tracking-[-0.02em]">Admin sign in</CardTitle>
          <FieldDescription className="leading-6">
            This is the UI shell only. Real authentication will use Nest admin sessions, 2FA, RBAC,
            and audit logs.
          </FieldDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" type="email" placeholder="operator@fizzdragon.com" />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input id="password" type="password" placeholder="Required" />
              </Field>
            </FieldGroup>
            <Button type="button" className="w-full">
              Continue
            </Button>
          </form>
          <Button asChild variant="link" className="mt-4 w-full text-muted-foreground">
            <Link href="/">Back to operations overview</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarImage, AvatarFallback, AvatarGroup } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Empty, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { useTranslations, useLocale, setLanguage } from "@/src/i18n/i18n";
import { SITE_LOCALE_OPTIONS } from "@/src/i18n/config";
import { setCurrentLocale } from "@/src/i18n/locale-url";
import { useRouter } from "next/navigation";

export default function Home() {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const switchLang = (lng: string) => {
    setCurrentLocale(lng);
    setLanguage(lng);
    router.replace("/art-studio/theme-preview");
  };

  return (
    <>
      <div className="min-h-screen bg-background text-foreground p-8">
        <div className="max-w-4xl mx-auto space-y-12">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">{t("appName")}</h1>
              <p className="text-muted-foreground mt-2">Theme & Component Preview</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-1 text-sm">
                {SITE_LOCALE_OPTIONS.map((lng) => (
                  <button
                    key={lng.value}
                    type="button"
                    onClick={() => switchLang(lng.value)}
                    className={`px-2 py-1 rounded ${locale === lng.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {lng.value === "zh-CN" ? "简" : lng.value === "zh-HK" ? "繁" : "EN"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Color Palette */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Color Palette</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <ColorBlock name="Primary" className="bg-primary text-primary-foreground" />
              <ColorBlock name="Secondary" className="bg-secondary text-secondary-foreground" />
              <ColorBlock name="Muted" className="bg-muted text-muted-foreground" />
              <ColorBlock name="Accent" className="bg-accent text-accent-foreground" />
              <ColorBlock name="Destructive" className="bg-destructive text-white" />
              <ColorBlock name="Card" className="bg-card text-card-foreground border" />
              <ColorBlock name="Popover" className="bg-popover text-popover-foreground border" />
              <ColorBlock name="Background" className="bg-background text-foreground border" />
            </div>
          </section>

          {/* Background Layers */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Background Layers</h2>
            <div className="space-y-2">
              <div className="bg-background p-4 rounded-lg border">
                <span className="text-sm">Background — Page base</span>
              </div>
              <div className="bg-card p-4 rounded-lg border">
                <span className="text-sm">Card — Sidebar / Panel</span>
              </div>
              <div className="bg-popover p-4 rounded-lg border">
                <span className="text-sm">Popover — Dropdown / Modal</span>
              </div>
              <div className="bg-muted p-4 rounded-lg">
                <span className="text-sm">Muted — Hover / Subtle</span>
              </div>
              <div className="bg-accent p-4 rounded-lg">
                <span className="text-sm">Accent — Active / Selected</span>
              </div>
              <div className="bg-secondary p-4 rounded-lg">
                <span className="text-sm">Secondary — Input / Container</span>
              </div>
            </div>
          </section>

          {/* Text Hierarchy */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Text Hierarchy</h2>
            <Card>
              <CardContent className="pt-6 space-y-3">
                <p className="text-foreground text-lg font-semibold">Foreground — Title text</p>
                <p className="text-foreground">Foreground — Body text</p>
                <p className="text-muted-foreground">Muted Foreground — Secondary text</p>
                <p className="text-muted-foreground/50">Muted Foreground / 50 — Placeholder</p>
              </CardContent>
            </Card>
          </section>

          {/* Buttons */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Buttons</h2>
            <div className="flex flex-wrap gap-4">
              <Button>Primary</Button>
              <Button variant="soft" color="muted">
                Secondary
              </Button>
              <Button variant="soft" color="destructive">
                Destructive
              </Button>
              <Button variant="outline" color="muted">
                Outline
              </Button>
              <Button variant="ghost" color="muted">
                Ghost
              </Button>
              <Button variant="link">Link</Button>
            </div>
            <div className="flex flex-wrap gap-4">
              <Button size="xs">Extra Small</Button>
              <Button size="sm">Small</Button>
              <Button size="default">Default</Button>
              <Button size="lg">Large</Button>
              <Button disabled>Disabled</Button>
            </div>
          </section>

          {/* Cards */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Cards</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Project Card</CardTitle>
                  <CardDescription>A sample project card with muted description.</CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button size="sm" className="w-full">
                    Open Project
                  </Button>
                </CardFooter>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Asset Card</CardTitle>
                  <CardDescription>Character, scene, and prop assets.</CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button size="sm" variant="soft" color="muted" className="w-full">
                    Browse
                  </Button>
                </CardFooter>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Task Card</CardTitle>
                  <CardDescription>AI generation task status and progress.</CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button size="sm" variant="outline" className="w-full">
                    View Tasks
                  </Button>
                </CardFooter>
              </Card>
            </div>
          </section>

          {/* Input & Form */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Input & Form</h2>
            <Card className="max-w-md">
              <CardContent className="pt-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Project Name</label>
                  <Input placeholder="Enter project name..." />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <Textarea placeholder="Describe your project..." rows={3} />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="agree" />
                  <label htmlFor="agree" className="text-sm">
                    I agree to the terms
                  </label>
                </div>
                <div className="flex gap-3">
                  <Button>Create</Button>
                  <Button variant="outline" color="muted">
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Avatar */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Avatar</h2>
            <div className="flex items-center gap-6">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Sizes</p>
                <div className="flex items-center gap-3">
                  <Avatar size="sm">
                    <AvatarFallback>SM</AvatarFallback>
                  </Avatar>
                  <Avatar>
                    <AvatarFallback>DF</AvatarFallback>
                  </Avatar>
                  <Avatar size="lg">
                    <AvatarFallback>LG</AvatarFallback>
                  </Avatar>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Group</p>
                <AvatarGroup>
                  <Avatar>
                    <AvatarFallback>A</AvatarFallback>
                  </Avatar>
                  <Avatar>
                    <AvatarFallback>B</AvatarFallback>
                  </Avatar>
                  <Avatar>
                    <AvatarFallback>C</AvatarFallback>
                  </Avatar>
                  <Avatar>
                    <AvatarFallback>+3</AvatarFallback>
                  </Avatar>
                </AvatarGroup>
              </div>
            </div>
          </section>

          {/* Tooltip */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Tooltip</h2>
            <div className="flex gap-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" color="muted">
                    Hover me
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>This is a tooltip</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" color="muted">
                    Info
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Helpful information here</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </section>

          {/* Dropdown Menu */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Dropdown Menu</h2>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" color="muted">
                  Open Menu
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Profile</DropdownMenuItem>
                <DropdownMenuItem>Settings</DropdownMenuItem>
                <DropdownMenuItem>Projects</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </section>

          {/* Alert Dialog */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Alert Dialog</h2>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="soft" color="destructive">
                  Delete Project
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete the project and all
                    associated data.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </section>

          {/* Alert */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Alert</h2>
            <div className="space-y-3">
              <Alert>
                <AlertTitle>Default Alert</AlertTitle>
                <AlertDescription>This is a default alert message.</AlertDescription>
              </Alert>
              <Alert variant="destructive">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>Something went wrong. Please try again.</AlertDescription>
              </Alert>
            </div>
          </section>

          {/* Toast */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Toast (Sonner)</h2>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                color="muted"
                onClick={() => toast("Default toast message")}
              >
                Default
              </Button>
              <Button
                variant="outline"
                onClick={() => toast.success("Operation completed successfully")}
              >
                Success
              </Button>
              <Button
                variant="outline"
                color="muted"
                onClick={() => toast.error("Something went wrong")}
              >
                Error
              </Button>
              <Button
                variant="outline"
                color="muted"
                onClick={() => toast.info("Here is some info")}
              >
                Info
              </Button>
              <Button
                variant="outline"
                color="muted"
                onClick={() => toast.warning("Please be careful")}
              >
                Warning
              </Button>
            </div>
          </section>

          {/* Empty State */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Empty State</h2>
            <Card>
              <CardContent className="pt-6">
                <Empty>
                  <EmptyTitle>No projects yet</EmptyTitle>
                  <EmptyDescription>
                    Create your first project to get started with AI animation.
                  </EmptyDescription>
                  <Button size="sm" className="mt-4">
                    Create Project
                  </Button>
                </Empty>
              </CardContent>
            </Card>
          </section>

          {/* Spinner */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Spinner</h2>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Spinner />
                <span className="text-sm text-muted-foreground">Loading...</span>
              </div>
            </div>
          </section>

          {/* Borders & Dividers */}
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Borders & Dividers</h2>
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span>Item 1</span>
                  <span className="text-muted-foreground text-sm">Detail</span>
                </div>
                <hr className="border-border" />
                <div className="flex items-center justify-between">
                  <span>Item 2</span>
                  <span className="text-muted-foreground text-sm">Detail</span>
                </div>
                <hr className="border-border" />
                <div className="flex items-center justify-between">
                  <span>Item 3</span>
                  <span className="text-muted-foreground text-sm">Detail</span>
                </div>
              </CardContent>
            </Card>
          </section>

          <div className="pb-12" />
        </div>
      </div>
      <Toaster />
    </>
  );
}

function ColorBlock({ name, className }: { name: string; className: string }) {
  return <div className={`rounded-lg p-4 text-sm font-medium ${className}`}>{name}</div>;
}

import Link from "next/link";
import { IconArtboard, IconPhoto, IconSparkles, IconVideo } from "@tabler/icons-react";

const CREATE_ENTRIES = [
  {
    href: "/images",
    icon: IconPhoto,
    title: "Image",
    description: "Generate images from a text prompt.",
  },
  {
    href: "/video",
    icon: IconVideo,
    title: "Video",
    description: "Turn prompts and stills into motion.",
  },
  {
    href: "/canvas",
    icon: IconArtboard,
    title: "Canvas",
    description: "Infinite boards for generating and arranging images.",
  },
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-[1480px] px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-4xl pt-14 sm:pt-20">
        <section className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            What will you create today?
          </h1>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            Generate images, video, and infinite boards — all in one studio.
          </p>
        </section>

        <section className="mt-10 grid gap-4 sm:grid-cols-3">
          {CREATE_ENTRIES.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              className="group rounded-xl bg-card p-5 transition-colors hover:bg-accent"
            >
              <span className="flex size-10 items-center justify-center rounded-lg bg-muted">
                <entry.icon
                  className="size-5 text-white/55 transition-colors group-hover:text-white/85"
                  stroke={1.5}
                />
              </span>
              <div className="mt-4 text-sm font-medium">{entry.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{entry.description}</div>
            </Link>
          ))}
        </section>

        <section className="mt-16 pb-8">
          <h2 className="text-sm font-semibold">Recent creations</h2>
          <div className="mt-3 flex flex-col items-center rounded-xl bg-card px-6 py-16 text-center">
            <IconSparkles className="size-8 text-white/25" stroke={1.5} />
            <p className="mt-3 text-sm font-medium">Nothing here yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your generations will show up here as you create.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

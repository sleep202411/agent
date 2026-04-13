export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-border pb-10">
      <div className="mx-auto max-w-screen-xl px-6 pt-12">
        <div className="flex flex-col gap-10 lg:flex-row">
          <div className="flex shrink-0 flex-col lg:w-64">
            <img src="/logo.png" alt="FizzDragon" className="h-8 w-fit" />
            <div className="mt-8 flex gap-3">
              {["X", "In", "YT", "IG"].map((icon) => (
                <a
                  key={icon}
                  href="#"
                  className="flex size-9 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background transition-opacity hover:opacity-80"
                >
                  {icon}
                </a>
              ))}
            </div>
            <p className="mt-8 text-xs text-muted-foreground">
              Copyright © {new Date().getFullYear()} FizzDragon.
            </p>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-8 lg:grid-cols-4">
            {[
              { title: "Story Plaza", links: ["Home", "Video List", "Publish Video"] },
              {
                title: "Project Center",
                links: ["Project List", "My Projects", "Create Project"],
              },
              { title: "Profile", links: ["User Info", "Portfolio", "Account Settings"] },
              { title: "Other", links: ["Privacy Policy", "Terms of Service", "Refund Policy"] },
            ].map((col) => (
              <div key={col.title}>
                <h4 className="mb-4 text-sm font-bold text-foreground">{col.title}</h4>
                <ul className="flex flex-col gap-2.5">
                  {col.links.map((link) => (
                    <li key={link}>
                      <a
                        href="#"
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

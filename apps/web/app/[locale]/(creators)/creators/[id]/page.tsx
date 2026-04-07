"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  IconArrowLeft,
  IconStar,
  IconCircleCheck,
  IconBriefcase,
  IconClock,
  IconMessage,
  IconHeart,
  IconAward,
  IconUsers,
  IconMovie,
  IconExternalLink,
  IconX,
  IconMapPin,
  IconWorld,
  IconStarFilled,
  IconFileText,
  IconMessageCircle,
} from "@tabler/icons-react";
import {
  MOCK_CREATORS,
  LEVEL_COLORS,
  AVAILABILITY_CONFIG,
} from "@/components/creators/creators-mock";

const MOCK_DETAIL = {
  timezone: "UTC+8",
  school: "Shanghai Theatre Academy · Animation",
  fullBio:
    "Specializes in blending Eastern aesthetics with cyberpunk style, focused on AI animation art direction. Representative work 'Neon Dragon' has over 1M views, continuously exploring the boundaries of AI-assisted creation.",
  studioHistory: [
    {
      name: "Neon Studio",
      role: "AI Art Director",
      period: "2023.06 - Present",
      project: "'Neon Dragon' Series",
    },
    {
      name: "Spark Creative",
      role: "Character Designer",
      period: "2022.09 - 2023.05",
      project: "'Wasteland Era'",
    },
    {
      name: "Freelance",
      role: "AI Art",
      period: "2022.01 - 2022.08",
      project: "Multiple short films",
    },
  ],
  ips: [
    {
      title: "'Neon Dragon'",
      role: "Art Director",
      status: "In Production",
      episodes: 12,
      cover: "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=100&q=70",
    },
    {
      title: "'Cyber Hanafuda'",
      role: "Concept Design",
      status: "Completed",
      episodes: 6,
      cover: "https://images.unsplash.com/photo-1679083216051-aa510a1a2c0e?w=100&q=70",
    },
  ],
  portfolio: [
    {
      id: "p1",
      title: "Neon Dragon · Character Design",
      type: "AI Art",
      cover: "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=400&q=80",
    },
    {
      id: "p2",
      title: "Wasteland Era · Scene",
      type: "Scene Design",
      cover: "https://images.unsplash.com/photo-1676299023918-6c6c6b524488?w=400&q=80",
    },
    {
      id: "p3",
      title: "Cyber Hanafuda · Concept",
      type: "Concept Design",
      cover: "https://images.unsplash.com/photo-1679083216051-aa510a1a2c0e?w=400&q=80",
    },
    {
      id: "p4",
      title: "Dragon · Storyboard",
      type: "Storyboard",
      cover: "https://images.unsplash.com/photo-1686191128892-3b37add3bfb3?w=400&q=80",
    },
  ],
  reviews: [
    {
      author: "Pax_Storyboarder",
      rating: 5,
      text: "Momo's character design is stunning, the cyberpunk details are perfectly handled.",
      date: "2024-03",
    },
    {
      author: "Galaxy Writer",
      rating: 5,
      text: "Precise art direction, highly efficient communication, perfectly realized the visual imagination.",
      date: "2024-02",
    },
    {
      author: "Ghost Voice",
      rating: 4,
      text: "Top-notch design quality. Would be even better with a few more alternative options.",
      date: "2024-01",
    },
  ],
};

const SKILL_COLORS = [
  "border-red-400/30 bg-red-400/10 text-red-400",
  "border-violet-400/30 bg-violet-400/10 text-violet-400",
  "border-blue-400/30 bg-blue-400/10 text-blue-400",
  "border-amber-400/30 bg-amber-400/10 text-amber-400",
  "border-green-400/30 bg-green-400/10 text-green-400",
  "border-pink-400/30 bg-pink-400/10 text-pink-400",
];

type Tab = "overview" | "portfolio" | "reviews";

export default function CreatorDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [showContact, setShowContact] = useState(false);
  const [inviteStudio, setInviteStudio] = useState("");
  const [inviteRole, setInviteRole] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");

  const creator = MOCK_CREATORS.find((c) => c.id === id) ?? MOCK_CREATORS[0];
  const levelStyle = LEVEL_COLORS[creator.level];
  const avail = AVAILABILITY_CONFIG[creator.availability];

  const tabs: { key: Tab; label: string; icon: typeof IconUsers }[] = [
    { key: "overview", label: "Overview", icon: IconUsers },
    { key: "portfolio", label: "Portfolio", icon: IconFileText },
    { key: "reviews", label: "Reviews", icon: IconMessageCircle },
  ];

  const statItems = [
    {
      icon: IconFileText,
      iconColor: "bg-blue-500/20 text-blue-400",
      label: "Projects",
      value: String(creator.projects),
    },
    {
      icon: IconMessageCircle,
      iconColor: "bg-violet-500/20 text-violet-400",
      label: "Reviews",
      value: String(creator.reviews),
    },
    {
      icon: IconStarFilled,
      iconColor: "bg-amber-500/20 text-amber-400",
      label: "Rating",
      value: String(creator.rating),
    },
    {
      icon: IconClock,
      iconColor: "bg-green-500/20 text-green-400",
      label: "Response",
      value: creator.responseTime,
    },
    {
      icon: IconMapPin,
      iconColor: "bg-red-500/20 text-red-400",
      label: "Location",
      value: creator.location,
    },
    {
      icon: IconWorld,
      iconColor: "bg-cyan-500/20 text-cyan-400",
      label: "Timezone",
      value: MOCK_DETAIL.timezone,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Cover */}
      <div className="relative h-52 overflow-hidden">
        <img src={creator.covers[0]} alt="" className="h-full w-full object-cover opacity-50" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
      </div>

      {/* Profile header */}
      <div className="mx-auto max-w-screen-xl px-6">
        <div className="relative -mt-16 flex items-start gap-5">
          {/* Avatar */}
          <div className="flex size-24 shrink-0 items-center justify-center rounded-full border-4 border-background bg-gradient-to-br from-primary/30 to-violet-500/30 text-3xl font-bold text-primary shadow-xl">
            {creator.name.charAt(0)}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1 pt-2">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{creator.name}</h1>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${avail.text} bg-white/[0.06]`}
              >
                <span className={`size-1.5 rounded-full ${avail.dot}`} /> {avail.label}
              </span>
              <span
                className={`rounded border px-2 py-0.5 text-xs font-semibold ${levelStyle.text} ${levelStyle.bg} ${levelStyle.border}`}
              >
                {creator.level}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{MOCK_DETAIL.school}</p>
            <div className="mt-1 flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1 text-amber-400">
                <IconStarFilled className="size-3.5" /> {creator.rating}
              </span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <IconMessageCircle className="size-3.5 text-blue-400" /> {creator.reviews} reviews
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-3 pt-4">
            <button
              type="button"
              onClick={() => setShowContact(true)}
              className="rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:brightness-110"
            >
              Invite
            </button>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-white/[0.06]"
            >
              <IconHeart className="size-4" /> Bookmark
            </button>
          </div>
        </div>

        {/* Bio */}
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {MOCK_DETAIL.fullBio}
        </p>

        {/* Meta */}
        <div className="mt-3 flex items-center gap-5 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <IconBriefcase className="size-3.5" /> {creator.projects} projects
          </span>
          <span className="flex items-center gap-1">
            <IconClock className="size-3.5" /> {creator.responseTime}
          </span>
          <span className="flex items-center gap-1">
            <IconMapPin className="size-3.5" /> {creator.location}
          </span>
        </div>

        {/* Skills */}
        <div className="mt-3 flex flex-wrap gap-2">
          {creator.skills.map((skill, i) => (
            <span
              key={skill}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${SKILL_COLORS[i % SKILL_COLORS.length]}`}
            >
              {skill}
            </span>
          ))}
        </div>

        {/* Tabs */}
        <div className="mt-5 flex items-center gap-0 border-b border-border">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-colors ${
                activeTab === key
                  ? "border-primary bg-primary/10 text-primary rounded-t-lg"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-screen-xl px-6 py-6">
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            {/* Left column */}
            <div className="space-y-6 lg:col-span-3">
              {/* Studio History */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <IconBriefcase className="size-4 text-primary" /> Studio History
                </h3>
                <div className="space-y-3">
                  {MOCK_DETAIL.studioHistory.map((s, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-lg bg-white/[0.03] p-3">
                      <div className="mt-2 size-2 shrink-0 rounded-full bg-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-foreground">
                            {s.name} · {s.role}
                          </p>
                          <span className="shrink-0 text-xs text-muted-foreground">{s.period}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">Project: {s.project}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* IPs */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <IconAward className="size-4 text-primary" /> IPs Involved
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {MOCK_DETAIL.ips.map((ip, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg bg-white/[0.03] p-3">
                      <img
                        src={ip.cover}
                        alt=""
                        className="size-12 shrink-0 rounded-lg object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <p className="truncate text-sm font-medium text-foreground">{ip.title}</p>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                              ip.status === "In Production"
                                ? "bg-green-400/10 text-green-400"
                                : "bg-white/[0.06] text-muted-foreground"
                            }`}
                          >
                            {ip.status}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {ip.role} · {ip.episodes} episodes
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right column */}
            <div className="space-y-6 lg:col-span-2">
              {/* Stats grid */}
              <div className="rounded-xl border border-primary/20 bg-white/[0.03] p-5">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <IconCircleCheck className="size-4 text-primary" /> Statistics
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {statItems.map((stat) => {
                    const Icon = stat.icon;
                    return (
                      <div
                        key={stat.label}
                        className="flex items-center gap-3 rounded-lg bg-white/[0.03] p-3"
                      >
                        <div
                          className={`flex size-10 items-center justify-center rounded-xl ${stat.iconColor}`}
                        >
                          <Icon className="size-5" />
                        </div>
                        <div>
                          <div className="text-[11px] text-muted-foreground">{stat.label}</div>
                          <div className="text-sm font-bold text-foreground">{stat.value}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Skills */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <IconStarFilled className="size-4 text-primary" /> Skills
                </h3>
                <div className="flex flex-wrap gap-2">
                  {creator.skills.map((skill, i) => (
                    <span
                      key={skill}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${SKILL_COLORS[i % SKILL_COLORS.length]}`}
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Recent Works - full width below the 2-column layout */}
        {activeTab === "overview" && (
          <div className="mt-6 rounded-xl border border-white/[0.06] bg-white/[0.03] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <IconMovie className="size-4 text-primary" /> Recent Works
              </h3>
              <button
                type="button"
                onClick={() => setActiveTab("portfolio")}
                className="text-xs text-primary hover:underline"
              >
                View All →
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {MOCK_DETAIL.portfolio.map((p) => (
                <div key={p.id} className="group overflow-hidden rounded-xl">
                  <div className="aspect-[4/3] overflow-hidden rounded-lg">
                    <img
                      src={p.cover}
                      alt={p.title}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </div>
                  <div className="mt-2">
                    <p className="text-xs font-medium text-foreground">{p.title}</p>
                    <span
                      className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] ${SKILL_COLORS[MOCK_DETAIL.portfolio.indexOf(p) % SKILL_COLORS.length]}`}
                    >
                      {p.type}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "portfolio" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {MOCK_DETAIL.portfolio.map((p) => (
              <div
                key={p.id}
                className="group overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.03] transition-all hover:border-primary/30"
              >
                <div className="aspect-[4/3] overflow-hidden">
                  <img
                    src={p.cover}
                    alt={p.title}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <div className="p-4">
                  <h3 className="text-sm font-semibold text-foreground">{p.title}</h3>
                  <span
                    className={`mt-1.5 inline-block rounded-full border px-2.5 py-0.5 text-[10px] ${SKILL_COLORS[MOCK_DETAIL.portfolio.indexOf(p) % SKILL_COLORS.length]}`}
                  >
                    {p.type}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "reviews" && (
          <div className="max-w-2xl space-y-4">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex items-center gap-1 text-xl font-bold text-amber-400">
                <IconStarFilled className="size-5" /> {creator.rating}
              </span>
              <span className="text-sm text-muted-foreground">{creator.reviews} reviews</span>
            </div>
            {MOCK_DETAIL.reviews.map((review, i) => (
              <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5">
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-violet-500/20 text-sm font-bold text-primary">
                    {review.author.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">{review.author}</div>
                    <div className="text-xs text-muted-foreground">{review.date}</div>
                  </div>
                  <div className="ml-auto flex items-center gap-0.5">
                    {Array.from({ length: review.rating }).map((_, j) => (
                      <IconStarFilled key={j} className="size-3.5 text-amber-400" />
                    ))}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{review.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invite Modal */}
      {showContact && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6 backdrop-blur-sm"
          onClick={() => setShowContact(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-card p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-foreground">Invite to Collaborate</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Invite {creator.name} to join your project
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowContact(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <IconX className="size-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Studio / Project */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  Studio / Project <span className="text-primary">*</span>
                </label>
                <select
                  value={inviteStudio}
                  onChange={(e) => setInviteStudio(e.target.value)}
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-sm text-foreground backdrop-blur-sm focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">Select a project...</option>
                  <option value="s1">Neon Dragon · Season 2</option>
                  <option value="s2">Crimson Tide</option>
                  <option value="s3">Wasteland Chronicles</option>
                </select>
              </div>

              {/* Role */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  Role <span className="text-primary">*</span>
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-sm text-foreground backdrop-blur-sm focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">Select a role...</option>
                  <option value="ai_art">AI Artist</option>
                  <option value="storyboard">Storyboarder</option>
                  <option value="screenwriter">Screenwriter</option>
                  <option value="voice">Voice Actor</option>
                  <option value="postprod">Post-production</option>
                  <option value="music">Music Producer</option>
                  <option value="director">Director</option>
                  <option value="scene">Scene Designer</option>
                </select>
              </div>

              {/* Message */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">Message</label>
                <textarea
                  value={inviteMessage}
                  onChange={(e) => setInviteMessage(e.target.value)}
                  placeholder="Write a message to the creator. This will appear in their notification..."
                  rows={3}
                  className="w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground backdrop-blur-sm focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  This message will be visible in the creator's notification center.
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={!inviteStudio || !inviteRole}
              onClick={() => {
                setShowContact(false);
                setInviteStudio("");
                setInviteRole("");
                setInviteMessage("");
              }}
              className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:brightness-110 disabled:opacity-50 disabled:shadow-none"
            >
              Send Invitation
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

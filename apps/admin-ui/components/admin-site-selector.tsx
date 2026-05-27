"use client";

import { Globe2Icon } from "lucide-react";
import { useAdminSite } from "@/components/admin-site-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ADMIN_SITES, isAdminSiteCode } from "@/lib/sites";

export function AdminSiteSelector() {
  const { siteCode, setSiteCode } = useAdminSite();

  return (
    <Select
      value={siteCode}
      onValueChange={(value) => {
        if (isAdminSiteCode(value)) {
          setSiteCode(value);
        }
      }}
    >
      <SelectTrigger className="h-9 min-w-42 border-border bg-secondary/70 text-xs">
        <Globe2Icon className="size-4 text-muted-foreground" />
        <SelectValue placeholder="Select site" />
      </SelectTrigger>
      <SelectContent>
        {ADMIN_SITES.map((site) => (
          <SelectItem key={site.code} value={site.code}>
            {site.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

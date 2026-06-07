"use client"

import * as React from "react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  BarChart2Icon,
  CalendarClockIcon,
  GitMergeIcon,
  LayoutDashboardIcon,
  PlayIcon,
  SparklesIcon,
  Settings2Icon,
  FolderIcon,
  ZapIcon,
} from "lucide-react"

const data = {
  user: {
    name: "Rajvir",
    email: "rajvir@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  navMain: [
    {
      title: "Overview",
      url: "/dashboard",
      icon: <LayoutDashboardIcon />,
    },
    {
      title: "Runs",
      url: "/dashboard/runs",
      icon: <PlayIcon />,
    },
    {
      title: "Pipeline",
      url: "/dashboard/pipeline",
      icon: <GitMergeIcon />,
    },
    {
      title: "Sprints",
      url: "/dashboard/sprints",
      icon: <ZapIcon />,
    },
    {
      title: "AI Assistant",
      url: "/dashboard/ai-assistant",
      icon: <SparklesIcon />,
    },
    {
      title: "Analytics",
      url: "/dashboard/analytics",
      icon: <BarChart2Icon />,
    },
    {
      title: "Projects",
      url: "/projects",
      icon: <FolderIcon />,
    },
  ],
  navSettings: [
    {
      title: "Settings",
      url: "/dashboard/settings",
      icon: <Settings2Icon />,
      items: [
        { title: "Environments", url: "/dashboard/settings/environments" },
        { title: "Members", url: "/dashboard/settings/members" },
        { title: "Archive Queue", url: "/dashboard/settings/archive-queue" },
        { title: "AI Config", url: "/dashboard/settings/ai-config" },
        { title: "Integrations", url: "/dashboard/settings/integrations" },
        { title: "Organisations", url: "/dashboard/settings/organisations" },
        { title: "Scheduled Runs", url: "/dashboard/settings/scheduled-runs", icon: <CalendarClockIcon /> },
      ],
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavMain items={data.navSettings} label="" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

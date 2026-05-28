"use client"

import * as React from "react"
import { Building2Icon, ChevronsUpDownIcon, PlusIcon } from "lucide-react"

import { AddOrganisationDialog } from "@/components/dialogs/add-organisation-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useAuthStore } from "@/lib/auth"
import type { ScoutOrg } from "@/lib/scout-api"

export function TeamSwitcher() {
  const { isMobile } = useSidebar()
  const orgs = useAuthStore((s) => s.orgs)
  const activeOrgId = useAuthStore((s) => s.activeOrgId)
  const setActiveOrgId = useAuthStore((s) => s.setActiveOrgId)
  const loadMe = useAuthStore((s) => s.loadMe)
  const [dialogOpen, setDialogOpen] = React.useState(false)

  const activeOrg: ScoutOrg | null =
    orgs.find((o) => o.id === activeOrgId) ?? orgs[0] ?? null

  if (!activeOrg) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            onClick={() => setDialogOpen(true)}
            className="gap-2"
          >
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg border bg-sidebar-primary text-sidebar-primary-foreground">
              <PlusIcon className="size-4" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">No organisation</span>
              <span className="text-muted-foreground truncate text-xs">
                Click to create one
              </span>
            </div>
          </SidebarMenuButton>
          <AddOrganisationDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            onCreated={() => loadMe()}
          />
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Building2Icon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{activeOrg.name}</span>
                <span className="text-muted-foreground truncate font-mono text-xs">
                  {activeOrg.slug}
                </span>
              </div>
              <ChevronsUpDownIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-none"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Organisations
            </DropdownMenuLabel>
            {orgs.map((org) => (
              <DropdownMenuItem
                key={org.id}
                onClick={() => setActiveOrgId(org.id)}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border">
                  <Building2Icon className="size-3.5" />
                </div>
                <span className="truncate text-sm normal-case">{org.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

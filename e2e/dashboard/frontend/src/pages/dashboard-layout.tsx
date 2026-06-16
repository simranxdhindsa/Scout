import { useEffect } from "react"
import { Outlet, useLocation } from "react-router-dom"

import { AppSidebar } from "@/components/app-sidebar"
import { ModeToggle } from "@/components/mode-toggle"
import { NotificationsBell } from "@/components/notifications-bell"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

const pageMeta: Record<string, { label: string; title: string }> = {
  "/dashboard":               { label: "Overview",     title: "Overview — SCOUT" },
  "/dashboard/runs":          { label: "Test Runs",    title: "Test Runs — SCOUT" },
  "/dashboard/pipeline":      { label: "Pipeline",     title: "Pipeline — SCOUT" },
  "/dashboard/sprints":       { label: "Sprints",      title: "Sprints — SCOUT" },
  "/dashboard/ai-assistant":  { label: "AI Assistant", title: "AI Assistant — SCOUT" },
  "/dashboard/analytics":     { label: "Analytics",    title: "Analytics — SCOUT" },
  "/dashboard/specs":         { label: "Specs",        title: "Specs — SCOUT" },
  "/projects":                { label: "Projects",     title: "Projects — SCOUT" },
}

function resolveMeta(pathname: string): { label: string; title: string } {
  if (pageMeta[pathname]) return pageMeta[pathname]
  if (pathname.startsWith("/projects/"))            return { label: "Project",  title: "Projects — SCOUT" }
  if (pathname.startsWith("/runs/"))                return { label: "Run",      title: "Test Runs — SCOUT" }
  if (pathname.startsWith("/dashboard/pipeline"))   return { label: "Pipeline", title: "Pipeline — SCOUT" }
  if (pathname.startsWith("/dashboard/sprints"))    return { label: "Sprints",  title: "Sprints — SCOUT" }
  if (pathname.startsWith("/dashboard/settings"))   return { label: "Settings", title: "Settings — SCOUT" }
  return { label: "Dashboard", title: "SCOUT" }
}

export default function DashboardLayout() {
  const { pathname } = useLocation()
  const { label, title } = resolveMeta(pathname)

  useEffect(() => {
    document.title = title
  }, [title])

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex w-full items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 h-4 data-vertical:self-center"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>{label}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <div className="ml-auto flex items-center gap-2">
              <NotificationsBell />
              <ModeToggle />
            </div>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

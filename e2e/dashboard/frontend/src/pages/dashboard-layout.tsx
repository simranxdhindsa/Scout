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

const titles: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/runs": "Runs",
  "/dashboard/pipeline": "Pipeline",
  "/dashboard/sprints": "Sprints",
  "/dashboard/ai-assistant": "AI Assistant",
  "/dashboard/analytics": "Analytics",
  "/projects": "Projects",
}

function resolveTitle(pathname: string) {
  if (titles[pathname]) return titles[pathname]
  if (pathname.startsWith("/projects/")) return "Project"
  if (pathname.startsWith("/runs/")) return "Run"
  if (pathname.startsWith("/dashboard/pipeline")) return "Pipeline"
  if (pathname.startsWith("/dashboard/sprints")) return "Sprints"
  if (pathname.startsWith("/dashboard/settings")) return "Settings"
  return "Dashboard"
}

export default function DashboardLayout() {
  const { pathname } = useLocation()
  const title = resolveTitle(pathname)

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
                  <BreadcrumbPage>{title}</BreadcrumbPage>
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

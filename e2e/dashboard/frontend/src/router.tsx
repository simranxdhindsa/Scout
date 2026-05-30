import { createBrowserRouter } from "react-router-dom"

import { RedirectIfAuthed, RequireAuth } from "@/components/require-auth"
import AiAssistantPage from "@/pages/ai-assistant"
import AuthCallbackPage from "@/pages/auth-callback"
import DashboardLayout from "@/pages/dashboard-layout"
import DashboardPage from "@/pages/dashboard"
import AiConfigPage from "@/pages/settings/ai-config"
import ArchiveQueuePage from "@/pages/settings/archive-queue"
import EnvironmentsPage from "@/pages/settings/environments"
import IntegrationsPage from "@/pages/settings/integrations"
import MembersPage from "@/pages/settings/members"
import OrganisationsPage from "@/pages/settings/organisations"
import HomePage from "@/pages/home"
import LoginPage from "@/pages/login"
import NotFoundPage from "@/pages/not-found"
import PipelinePage from "@/pages/pipeline"
import ProjectPage from "@/pages/project"
import ProjectsPage from "@/pages/projects"
import RunDetailPage from "@/pages/run-detail"
import RunsPage from "@/pages/runs"

export const router = createBrowserRouter([
  { path: "/auth/callback", element: <AuthCallbackPage /> },
  {
    element: <RedirectIfAuthed />,
    children: [{ path: "/login", element: <LoginPage /> }],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: "/", element: <HomePage /> },
      {
        path: "/dashboard",
        element: <DashboardLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: "runs", element: <RunsPage /> },
          { path: "pipeline", element: <PipelinePage /> },
          { path: "ai-assistant", element: <AiAssistantPage /> },
          { path: "settings/environments", element: <EnvironmentsPage /> },
          { path: "settings/members", element: <MembersPage /> },
          { path: "settings/archive-queue", element: <ArchiveQueuePage /> },
          { path: "settings/ai-config", element: <AiConfigPage /> },
          { path: "settings/integrations", element: <IntegrationsPage /> },
          { path: "settings/organisations", element: <OrganisationsPage /> },
        ],
      },
      {
        path: "/projects",
        element: <DashboardLayout />,
        children: [
          { index: true, element: <ProjectsPage /> },
          { path: ":slug", element: <ProjectPage /> },
        ],
      },
      {
        path: "/runs",
        element: <DashboardLayout />,
        children: [{ path: ":runId", element: <RunDetailPage /> }],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
])

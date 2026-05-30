import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthBootstrap } from '@/components/auth-bootstrap'
import { ThemeProvider } from '@/components/theme-provider'
import { TooltipProvider } from '@/components/ui/tooltip'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="scout-ui-theme">
      <TooltipProvider>
        <AuthBootstrap>
          <App />
        </AuthBootstrap>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
)

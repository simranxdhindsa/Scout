'use client'

import { Topbar } from '@/components/layout/Topbar'
import { ChatBot } from '@/components/ai/ChatBot'
import { useCurrentOrg } from '@/lib/auth'
import s from './AI.module.css'

interface PageProps { params: { orgSlug: string } }

export default function AIPage({ params }: PageProps) {
  const { orgSlug } = params
  const org = useCurrentOrg(orgSlug)
  const orgId = org?.id ?? ''

  return (
    <>
      <Topbar title="AI Assistant" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 1 }}>
        {orgId && <ChatBot orgId={orgId} />}
        <div className={s.footer}>Handcrafted by Simran · ApyHub QA · 2026</div>
      </div>
    </>
  )
}

'use client'

import { useState } from 'react'
import {
  Folder, FolderOpen, FileCode2, ChevronRight,
  ChevronDown, Plus, MoreHorizontal, Play, Trash2, Pencil
} from 'lucide-react'
import { foldersApi, testsApi } from '@/lib/api'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

interface TestCase {
  id: string
  name: string
  file_name: string
  version: number
  updated_at: string
}

interface Folder {
  id: string
  name: string
  path: string
  parent_id: string | null
  children: Folder[]
  test_cases?: TestCase[]
}

interface FolderTreeProps {
  spId: string
  orgId: string
  orgSlug: string
  onSelectTest?: (testId: string) => void
  onRunTest?: (testId: string, testName: string) => void
  onRunFolder?: (folderId: string, folderName: string) => void
  selectedTestId?: string
}

export function FolderTree({
  spId, orgId, onSelectTest, onRunTest, onRunFolder, selectedTestId
}: FolderTreeProps) {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['folders', spId],
    queryFn: () => foldersApi.tree(spId).then((r) => r.data),
  })

  const createFolder = useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId?: string }) =>
      foldersApi.create(spId, { name, parent_id: parentId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['folders', spId] })
      toast.success('Folder created')
    },
    onError: () => toast.error('Failed to create folder'),
  })

  const handleNewRootFolder = () => {
    const name = prompt('Folder name:')
    if (name?.trim()) createFolder.mutate({ name: name.trim() })
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div style={{ width: 18, height: 18, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }

  const folders: Folder[] = data?.folders ?? []

  return (
    <div style={{ userSelect: 'none', paddingBottom: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px 8px' }}>
        <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          Tests
        </span>
        <button
          onClick={handleNewRootFolder}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 3, borderRadius: 4 }}
          title="New folder"
        >
          <Plus size={13} />
        </button>
      </div>

      {folders.length === 0 ? (
        <div style={{ padding: '24px 12px', textAlign: 'center' }}>
          <FileCode2 size={20} style={{ margin: '0 auto 8px', opacity: 0.3, color: 'var(--text-muted)', display: 'block' }} />
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>No folders yet</p>
          <button
            onClick={handleNewRootFolder}
            style={{ fontSize: 12, color: 'var(--accent-light)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Create first folder
          </button>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {folders.map((folder) => (
            <FolderNode
              key={folder.id}
              folder={folder}
              depth={0}
              spId={spId}
              orgId={orgId}
              selectedTestId={selectedTestId}
              onSelectTest={onSelectTest}
              onRunTest={onRunTest}
              onRunFolder={onRunFolder}
              onCreateSubFolder={(parentId, name) =>
                createFolder.mutate({ name, parentId })
              }
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface FolderNodeProps {
  folder: Folder
  depth: number
  spId: string
  orgId: string
  selectedTestId?: string
  onSelectTest?: (id: string) => void
  onRunTest?: (id: string, name: string) => void
  onRunFolder?: (id: string, name: string) => void
  onCreateSubFolder: (parentId: string, name: string) => void
}

function FolderNode({
  folder, depth, spId, orgId, selectedTestId,
  onSelectTest, onRunTest, onRunFolder, onCreateSubFolder,
}: FolderNodeProps) {
  const [expanded, setExpanded] = useState(depth === 0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const qc = useQueryClient()

  const { data: testsData } = useQuery({
    queryKey: ['tests', folder.id],
    queryFn: () => testsApi.list(folder.id).then((r) => r.data),
    enabled: expanded,
  })

  const tests: TestCase[] = testsData?.tests ?? []

  const deleteFolder = useMutation({
    mutationFn: () => foldersApi.delete(folder.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['folders', spId] })
      toast.success('Folder deleted')
    },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Cannot delete folder'),
  })

  const renameFolder = useMutation({
    mutationFn: (name: string) => foldersApi.rename(folder.id, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['folders', spId] })
      toast.success('Renamed')
    },
  })

  const indent = depth * 12

  return (
    <li>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); setMenuOpen(false) }}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: `5px 8px 5px ${8 + indent}px`,
          borderRadius: 4,
          cursor: 'pointer',
          background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        }}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', flexShrink: 0, padding: 0 }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {expanded
            ? <FolderOpen size={14} style={{ color: 'var(--accent-light)' }} />
            : <Folder size={14} style={{ color: 'var(--text-secondary)' }} />}
        </button>

        <span
          style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          onClick={() => setExpanded(!expanded)}
        >
          {folder.name}
        </span>

        {hovered && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button
              onClick={() => onRunFolder?.(folder.id, folder.name)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 3, borderRadius: 3 }}
              title="Run folder"
            >
              <Play size={11} />
            </button>
            <button
              onClick={() => {
                const name = prompt('Sub-folder name:')
                if (name?.trim()) onCreateSubFolder(folder.id, name.trim())
              }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 3, borderRadius: 3 }}
              title="New sub-folder"
            >
              <Plus size={11} />
            </button>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 3, borderRadius: 3 }}
            >
              <MoreHorizontal size={11} />
            </button>
          </div>
        )}

        {menuOpen && (
          <div
            style={{ position: 'absolute', right: 8, top: '100%', zIndex: 50, width: 140, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', overflow: 'hidden' }}
            onMouseLeave={() => setMenuOpen(false)}
          >
            <button
              onClick={() => {
                const name = prompt('New name:', folder.name)
                if (name?.trim()) renameFolder.mutate(name.trim())
                setMenuOpen(false)
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', fontSize: 12, color: 'var(--text-primary)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
            >
              <Pencil size={11} /> Rename
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete folder "${folder.name}"?`)) deleteFolder.mutate()
                setMenuOpen(false)
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', fontSize: 12, color: 'var(--failed)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
            >
              <Trash2 size={11} /> Delete
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {(folder.children ?? []).map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              spId={spId}
              orgId={orgId}
              selectedTestId={selectedTestId}
              onSelectTest={onSelectTest}
              onRunTest={onRunTest}
              onRunFolder={onRunFolder}
              onCreateSubFolder={onCreateSubFolder}
            />
          ))}

          {tests.map((test) => (
            <TestRow
              key={test.id}
              test={test}
              depth={depth + 1}
              isSelected={selectedTestId === test.id}
              onSelect={() => onSelectTest?.(test.id)}
              onRun={() => onRunTest?.(test.id, test.name)}
              folderId={folder.id}
              spId={spId}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function TestRow({
  test, depth, isSelected, onSelect, onRun, folderId, spId,
}: {
  test: TestCase
  depth: number
  isSelected: boolean
  onSelect: () => void
  onRun: () => void
  folderId: string
  spId: string
}) {
  const indent = depth * 12
  const [hovered, setHovered] = useState(false)

  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: `5px 8px 5px ${8 + indent}px`,
        borderRadius: 4,
        cursor: 'pointer',
        background: isSelected ? 'var(--accent-subtle)' : hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onSelect}
    >
      <FileCode2
        size={13}
        style={{ flexShrink: 0, color: isSelected ? 'var(--accent-light)' : 'var(--text-muted)' }}
      />
      <span style={{ flex: 1, fontSize: 12, color: isSelected ? 'var(--accent-light)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isSelected ? 500 : 400 }}>
        {test.name}
      </span>
      {hovered && (
        <>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>v{test.version}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onRun() }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--passed)', display: 'flex', padding: 3, borderRadius: 3, flexShrink: 0 }}
            title="Run test"
          >
            <Play size={11} />
          </button>
        </>
      )}
    </li>
  )
}

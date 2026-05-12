'use client'

// src/components/shared/WorkflowPanel.tsx
// Shared workflow status panel used on invoice review, entity detail, and PO detail pages.

import { useState } from 'react'

export interface WorkflowStep {
  id:          string
  name:        string
  type:        string
  order:       number
  status:      string
  result:      string | null
  completedAt: string | null
  completedBy: string | null
  isActive:    boolean
  isWaiting:   boolean
  dependencies: Array<{ id: string; dependencyType: string; subjectId: string; resolvedAt: string | null }>
}

export interface WorkflowHistoryEntry {
  id:          string
  stepName:    string
  stepType:    string
  result:      string | null
  status:      string
  completedAt: string | null
  completedBy: string | null
  instanceId:  string
}

export interface WorkflowState {
  id:              string
  status:          string
  templateName:    string
  templateVersion: number
  startedAt:       string | null
  completedAt:     string | null
  steps:           WorkflowStep[]
  currentSteps:    string[]
}

const WORKFLOW_STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  IN_PROGRESS: { color: '#2563eb', bg: '#eff6ff' },
  COMPLETED:   { color: '#16a34a', bg: '#f0fdf4' },
  FAILED:      { color: '#dc2626', bg: '#fef2f2' },
  PAUSED:      { color: '#d97706', bg: '#fffbeb' },
  CANCELLED:   { color: '#6b7280', bg: '#f9fafb' },
  NOT_STARTED: { color: '#6b7280', bg: '#f9fafb' },
}

const STEP_TYPE_LABEL: Record<string, string> = {
  APPROVAL:         'Approval',
  AUTO_RULE:        'Auto-rule',
  CONDITION_BRANCH: 'Branch',
  NOTIFICATION:     'Notify',
  WAIT_FOR:         'Wait',
  SUB_WORKFLOW:     'Sub-flow',
}

const STEP_STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  PENDING:     { color: '#6b7280', bg: '#f9fafb' },
  IN_PROGRESS: { color: '#2563eb', bg: '#eff6ff' },
  WAITING:     { color: '#d97706', bg: '#fffbeb' },
  COMPLETED:   { color: '#16a34a', bg: '#f0fdf4' },
  SKIPPED:     { color: '#9ca3af', bg: '#f3f4f6' },
  FAILED:      { color: '#dc2626', bg: '#fef2f2' },
}

interface WorkflowPanelProps {
  workflow: WorkflowState | null
  history?: WorkflowHistoryEntry[]
}

export function WorkflowPanel({ workflow, history }: WorkflowPanelProps) {
  const wfStyle = workflow ? (WORKFLOW_STATUS_STYLE[workflow.status] ?? { color: '#6b7280', bg: '#f9fafb' }) : null
  const [historyOpen, setHistoryOpen] = useState(false)

  const hasHistory = history && history.length > 0

  return (
    <section>
      <h2 className="text-sm font-medium mb-2" style={{ color: 'var(--muted)' }}>Workflow</h2>

      {!workflow ? (
        <p className="text-xs px-3 py-2 rounded-lg"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
          No workflow started for this object.
        </p>
      ) : (
        <div className="rounded-lg overflow-hidden"
          style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
          {/* Header */}
          <div className="px-3 py-2 flex items-center justify-between"
            style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-medium" style={{ color: 'var(--ink)' }}>
              {workflow.templateName}
              <span className="ml-1 font-normal" style={{ color: 'var(--muted)' }}>
                v{workflow.templateVersion}
              </span>
            </span>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ background: wfStyle!.bg, color: wfStyle!.color }}>
              {workflow.status.replace('_', ' ')}
            </span>
          </div>

          {/* Steps */}
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {workflow.steps.map(step => {
              const stepStyle     = STEP_STATUS_STYLE[step.status] ?? { color: '#6b7280', bg: '#f9fafb' }
              const isHighlighted = step.isActive || step.isWaiting

              return (
                <div key={step.id}
                  className="px-3 py-2 flex items-start gap-2"
                  style={{
                    background:  isHighlighted ? stepStyle.bg : 'transparent',
                    borderLeft:  isHighlighted ? `3px solid ${stepStyle.color}` : '3px solid transparent',
                  }}>
                  {/* Step order */}
                  <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium mt-0.5"
                    style={{ background: stepStyle.bg, color: stepStyle.color }}>
                    {step.order}
                  </span>

                  {/* Step info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium" style={{ color: 'var(--ink)' }}>
                        {step.name}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                        {STEP_TYPE_LABEL[step.type] ?? step.type}
                      </span>
                    </div>

                    {/* Status + result */}
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs px-1.5 py-0.5 rounded-full"
                        style={{ background: stepStyle.bg, color: stepStyle.color }}>
                        {step.status}
                      </span>
                      {step.result && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full"
                          style={{
                            background: step.result === 'PASS' ? '#f0fdf4' : '#fef2f2',
                            color:      step.result === 'PASS' ? '#16a34a' : '#dc2626',
                          }}>
                          {step.result}
                        </span>
                      )}
                      {step.completedAt && (
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>
                          {new Date(step.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* History section */}
      {hasHistory && (
        <div className="mt-2">
          <button
            onClick={() => setHistoryOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
            <span className="font-medium">Activity History ({history.length})</span>
            <span>{historyOpen ? '▼' : '▶'}</span>
          </button>

          {historyOpen && (
            <div className="mt-1 rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {history.map((entry, i) => {
                const resultStyle = entry.result === 'PASS'
                  ? { color: '#16a34a', bg: '#f0fdf4' }
                  : entry.result === 'FAIL'
                    ? { color: '#dc2626', bg: '#fef2f2' }
                    : { color: '#6b7280', bg: '#f3f4f6' }

                return (
                  <div key={entry.id}
                    className="px-3 py-2 flex items-start gap-2"
                    style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined, background: 'var(--surface)' }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium" style={{ color: 'var(--ink)' }}>{entry.stepName}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                          {STEP_TYPE_LABEL[entry.stepType] ?? entry.stepType}
                        </span>
                        {entry.result && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                            style={{ background: resultStyle.bg, color: resultStyle.color }}>
                            {entry.result}
                          </span>
                        )}
                        {entry.status !== 'COMPLETED' && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full"
                            style={{ background: '#fef2f2', color: '#dc2626' }}>
                            {entry.status}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {entry.completedAt && (
                          <span className="text-xs" style={{ color: 'var(--muted)' }}>
                            {new Date(entry.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                        {entry.completedBy && (
                          <span className="text-xs font-mono truncate" style={{ color: 'var(--muted)' }}>
                            {entry.completedBy.slice(0, 8)}…
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

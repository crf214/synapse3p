import Link from 'next/link'

export default function OnboardingWorkflowDetailPage() {
  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-semibold text-gray-900 mb-4">Onboarding Workflow</h1>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 mb-4">
        <p className="text-amber-800 font-medium mb-2">This feature has been replaced by the Workflow Engine.</p>
        <p className="text-amber-700 text-sm">
          Individual onboarding workflow editing is no longer available here.
          Workflows are now configured through the unified Workflow Engine.
        </p>
      </div>
      <Link href="/dashboard/settings/onboarding-workflows" className="text-sm text-blue-600 hover:underline">
        ← Back to Onboarding Workflows
      </Link>
    </div>
  )
}

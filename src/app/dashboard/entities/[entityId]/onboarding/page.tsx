import Link from 'next/link'

export default function EntityOnboardingPage({ params }: { params: { entityId: string } }) {
  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-semibold text-gray-900 mb-4">Entity Onboarding</h1>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 mb-4">
        <p className="text-amber-800 font-medium mb-2">This feature has been replaced by the Workflow Engine.</p>
        <p className="text-amber-700 text-sm">
          Entity onboarding is now handled through the unified Workflow Engine.
          Legacy onboarding step management is no longer available here.
        </p>
      </div>
      <Link href={`/dashboard/entities/${params.entityId}`} className="text-sm text-blue-600 hover:underline">
        ← Back to Entity
      </Link>
    </div>
  )
}

export default function AutoApprovePoliciesPage() {
  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-semibold text-gray-900 mb-4">Auto-Approve Policies</h1>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <p className="text-amber-800 font-medium mb-2">This feature has been replaced by the Workflow Engine.</p>
        <p className="text-amber-700 text-sm">
          Auto-approve policies are now configured as AUTO_RULE steps inside workflow templates
          in the unified Workflow Engine.
        </p>
      </div>
    </div>
  )
}

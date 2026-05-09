import { redirect } from 'next/navigation'

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/dashboard/invoices/${id}/review`)
}

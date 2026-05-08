import { redirect } from 'next/navigation'

export default function InvoicePage({ params }: { params: { id: string } }) {
  redirect(`/dashboard/invoices/${params.id}/review`)
}

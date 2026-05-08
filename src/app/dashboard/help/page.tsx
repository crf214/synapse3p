'use client'

import { useEffect, useRef, useState } from 'react'

// ── Table of contents ─────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'entities',           label: 'Entities' },
  { id: 'contracts',          label: 'Contracts' },
  { id: 'purchase-orders',    label: 'Purchase Orders' },
  { id: 'invoices',           label: 'Invoices' },
  { id: 'services',           label: 'Services & Service Levels' },
  { id: 'processing-rules',   label: 'Processing Rules' },
  { id: 'approval-workflows', label: 'Approval Workflows' },
  { id: 'onboarding',         label: 'Onboarding Workflows' },
  { id: 'activity-log',       label: 'Activity Log & Audit Trail' },
  { id: 'reconciliation',     label: 'Reconciliation' },
  { id: 'controls',           label: 'Controls & Audit Periods' },
  { id: 'settings',           label: 'Settings Reference' },
]

// ── Small layout helpers ──────────────────────────────────────────────────────

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-12 scroll-mt-8">
      <h2 className="text-xl font-semibold mb-4 pb-2"
        style={{ color: 'var(--ink)', borderBottom: '1px solid var(--border)' }}>
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
        {children}
      </div>
    </section>
  )
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="text-sm font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>{title}</h3>
      <div className="space-y-2" style={{ color: '#374151' }}>{children}</div>
    </div>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 rounded-xl text-sm mt-3"
      style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
      {children}
    </div>
  )
}

function DefList({ items }: { items: { term: string; def: string }[] }) {
  return (
    <dl className="space-y-2 mt-2">
      {items.map(({ term, def }) => (
        <div key={term} className="flex gap-3">
          <dt className="shrink-0 font-medium text-xs px-2 py-0.5 rounded self-start mt-0.5"
            style={{ background: '#f1f5f9', color: '#475569', minWidth: 120 }}>
            {term}
          </dt>
          <dd style={{ color: '#374151' }}>{def}</dd>
        </div>
      ))}
    </dl>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function HelpPage() {
  const [active, setActive] = useState(SECTIONS[0].id)
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    observerRef.current?.disconnect()
    observerRef.current = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting)
        if (visible.length > 0) {
          setActive(visible[0].target.id)
        }
      },
      { rootMargin: '-10% 0px -80% 0px', threshold: 0 }
    )
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (el) observerRef.current?.observe(el)
    })
    return () => observerRef.current?.disconnect()
  }, [])

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex min-h-screen">

      {/* ── Sticky TOC ── */}
      <aside className="w-52 flex-shrink-0 sticky top-0 h-screen overflow-y-auto py-8 pl-6 pr-3 hidden lg:block"
        style={{ borderRight: '1px solid var(--border)' }}>
        <p className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
          Contents
        </p>
        <nav className="space-y-0.5">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => scrollTo(s.id)}
              className="w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors"
              style={{
                background: active === s.id ? '#eff6ff' : 'transparent',
                color:      active === s.id ? '#2563eb' : 'var(--muted)',
                fontWeight: active === s.id ? 500 : 400,
              }}>
              {s.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Content ── */}
      <main className="flex-1 px-10 py-10 max-w-3xl">
        <div className="mb-10">
          <h1 className="text-3xl font-semibold mb-2" style={{ color: 'var(--ink)' }}>
            Synapse3P — How It Works
          </h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            A reference guide to the key concepts, workflows, and settings in this application.
          </p>
        </div>

        {/* ── ENTITIES ── */}
        <Section id="entities" title="Entities">
          <P>
            An <strong>Entity</strong> is any external party your organisation transacts with or relies on —
            a fund administrator, legal counsel, a broker, a technology platform, a contractor, or any
            other third party. Every contract, invoice, purchase order, and service engagement in the
            system belongs to an entity.
          </P>
          <Sub title="Entity Types">
            <DefList items={[
              { term: 'Vendor',           def: 'Suppliers of goods or general services.' },
              { term: 'Contractor',       def: 'Individuals or firms engaged on a project or time basis.' },
              { term: 'Broker',           def: 'Intermediaries for trade execution or capital markets.' },
              { term: 'Platform',         def: 'Technology or infrastructure providers.' },
              { term: 'Fund Svc Provider',def: 'Fund administrators, custodians, transfer agents, and similar.' },
              { term: 'Other',            def: 'Any entity that does not fit the above categories.' },
            ]} />
          </Sub>
          <Sub title="Entity Status">
            <DefList items={[
              { term: 'Active',          def: 'In good standing; can receive invoices and payments.' },
              { term: 'Inactive',        def: 'Relationship paused; transactions blocked.' },
              { term: 'Suspended',       def: 'Temporarily blocked, typically pending a review.' },
              { term: 'Pending Review',  def: 'Awaiting due diligence completion before activation.' },
              { term: 'Offboarded',      def: 'Relationship formally ended; retained for historical records.' },
            ]} />
          </Sub>
          <Sub title="Due Diligence & Risk">
            <P>
              Each entity carries a <strong>risk score</strong> (0–100), KYC / KYB status, sanctions
              screening status, and a PEP flag. These are maintained on the entity detail page under the
              Due Diligence tab. A <strong>Third Party Review</strong> can be scheduled periodically to
              reassess an entity&apos;s risk posture; each review records domain scores (Cyber, Legal, Privacy),
              findings, and follow-up notes.
            </P>
          </Sub>
          <Sub title="Entity Hierarchy">
            <P>
              Entities can have a <strong>parent</strong> and an <strong>ultimate parent</strong>, allowing
              you to model corporate group structures. For example, a fund administrator subsidiary can be
              linked to its parent holding company.
            </P>
          </Sub>
          <Callout>
            Where to find it: <strong>Entities</strong> in the main navigation.
            Entity detail pages include classifications, bank accounts, due diligence, linked contracts,
            invoices, activity log, and reviews.
          </Callout>
        </Section>

        {/* ── CONTRACTS ── */}
        <Section id="contracts" title="Contracts">
          <P>
            A <strong>Contract</strong> is the legal agreement between your organisation and an entity.
            Every <strong>Service Engagement</strong> and every <strong>Invoice</strong> must be backed
            by a contract — this is the foundational control that ties spend back to an authorised
            commitment.
          </P>
          <P>
            Contracts record the counterparty, contract value, currency, start and end dates, governing
            jurisdiction, and key clauses. Documents (PDFs, signed agreements) can be attached.
          </P>
          <Sub title="Contract → Invoice relationship">
            <P>
              When an invoice is received, it is matched to the entity and, where applicable, to a
              specific contract. The processing rules engine uses contract presence as one of its
              conditions to determine the correct processing track.
            </P>
          </Sub>
          <Callout>
            Where to find it: <strong>Contracts</strong> in the main navigation.
          </Callout>
        </Section>

        {/* ── PURCHASE ORDERS ── */}
        <Section id="purchase-orders" title="Purchase Orders">
          <P>
            A <strong>Purchase Order (PO)</strong> is an internal authorisation to spend. It is raised
            before goods or services are received and sets the approved amount, entity, and cost centre.
            When an invoice arrives it is matched against an open PO to confirm the spend was pre-authorised.
          </P>
          <Sub title="Processing Tracks and POs">
            <DefList items={[
              { term: 'Full PO',          def: 'Invoice must match a fully approved PO before it can be processed.' },
              { term: 'Lightweight',      def: 'Streamlined — PO required but approval chain is shorter.' },
              { term: 'STP',             def: 'Straight-Through Processing — invoice is auto-approved without a PO when all conditions are met.' },
              { term: 'Contract Required',def: 'A valid contract must exist; a PO is not required.' },
            ]} />
          </Sub>
          <P>
            The processing track for each invoice is assigned automatically by the <strong>Processing Rules</strong>
            engine (see below).
          </P>
          <Callout>
            Where to find it: <strong>Purchase Orders</strong> in the main navigation.
          </Callout>
        </Section>

        {/* ── INVOICES ── */}
        <Section id="invoices" title="Invoices">
          <P>
            Invoices represent amounts owed to entities. They can be ingested automatically (via the
            Ingestion Monitor) or created manually. Each invoice is linked to an entity and, once matched,
            to a contract and/or purchase order.
          </P>
          <Sub title="Invoice lifecycle">
            <DefList items={[
              { term: 'Pending',     def: 'Received but not yet reviewed.' },
              { term: 'In Review',   def: 'Assigned to an approver and under review.' },
              { term: 'Approved',    def: 'Cleared for payment.' },
              { term: 'Rejected',    def: 'Returned with a reason; may be re-submitted.' },
              { term: 'Paid',        def: 'Payment instruction has been executed.' },
              { term: 'Exported',    def: 'Posted to the ERP.' },
            ]} />
          </Sub>
          <Sub title="ERP export">
            <P>
              Approved invoices are packaged into <strong>Payment Instructions</strong> and sent to the
              ERP. The ERP handles final settlement. The application records the export event and the
              ERP reference for reconciliation.
            </P>
          </Sub>
          <Sub title="Recurring invoices">
            <P>
              Recurring schedules can be configured to auto-generate invoice stubs at defined intervals
              (monthly, quarterly, etc.) for regular service providers. These appear in
              <strong> Invoices → Recurring</strong>.
            </P>
          </Sub>
          <Callout>
            Where to find it: <strong>Invoices</strong> in the main navigation, with sub-pages for
            Ingestion Monitor and Recurring schedules.
          </Callout>
        </Section>

        {/* ── SERVICES ── */}
        <Section id="services" title="Services & Service Levels">
          <Sub title="Service Catalogue">
            <P>
              The <strong>Service Catalogue</strong> is an admin-managed list of the types of services
              your organisation procures. Examples: Fund Administration, Custody, Legal Counsel, Audit,
              Technology. Each catalogue entry has a name, category, and optional description.
            </P>
            <P>
              The catalogue is the reference list — it does not represent a specific engagement with a
              specific entity. Think of it as a menu of service types.
            </P>
          </Sub>
          <Sub title="Service Engagements">
            <P>
              A <strong>Service Engagement</strong> connects a specific entity to a specific service type
              and must reference a contract. It records:
            </P>
            <DefList items={[
              { term: 'Service',        def: 'The catalogue entry (e.g. Fund Administration).' },
              { term: 'Entity',         def: 'The provider of that service.' },
              { term: 'Contract',       def: 'The authorising agreement — required for every engagement.' },
              { term: 'Department',     def: 'The internal business unit consuming the service.' },
              { term: 'Internal Owner', def: 'The staff member responsible for managing the relationship.' },
            ]} />
          </Sub>
          <Sub title="Service Levels (SLA)">
            <P>
              Each engagement tracks an SLA target (a free-text description of the agreed service level)
              and an SLA status:
            </P>
            <DefList items={[
              { term: 'On Track',       def: 'Provider is meeting agreed service levels.' },
              { term: 'At Risk',        def: 'Performance is slipping but not yet in breach.' },
              { term: 'Breached',       def: 'SLA terms have been violated; action required.' },
              { term: 'Not Applicable', def: 'No formal SLA defined for this engagement.' },
            ]} />
          </Sub>
          <Callout>
            Where to manage: <strong>Settings → Service Catalogue</strong> to define service types.
            Service Engagements are managed from within each entity&apos;s detail page.
          </Callout>
        </Section>

        {/* ── PROCESSING RULES ── */}
        <Section id="processing-rules" title="Processing Rules">
          <P>
            <strong>Processing Rules</strong> are the routing logic that determines how each invoice or
            purchase order is handled. Rules are evaluated in <strong>priority order</strong> — the
            first rule whose conditions all match is applied.
          </P>
          <Sub title="How rules work">
            <P>
              Each rule defines one or more <strong>conditions</strong> (field, operator, value) that
              must all be true for the rule to match. Available fields:
            </P>
            <DefList items={[
              { term: 'Amount',     def: 'Invoice or PO amount. Supports =, ≠, >, ≥, <, ≤.' },
              { term: 'Currency',   def: 'Transaction currency code (e.g. USD, GBP).' },
              { term: 'Entity',     def: 'Specific entity ID.' },
              { term: 'Department', def: 'Cost centre or department.' },
              { term: 'Category',   def: 'Spend category.' },
            ]} />
            <P>
              When a rule matches, it assigns a <strong>Processing Track</strong> (Full PO, Lightweight,
              STP, or Contract Required) and can enforce two additional flags:
            </P>
            <DefList items={[
              { term: 'Requires Goods Receipt', def: 'Invoice cannot be approved until delivery is confirmed.' },
              { term: 'Requires Contract',      def: 'A valid contract must be linked before processing.' },
            ]} />
          </Sub>
          <Sub title="Evaluation log">
            <P>
              Every time a rule is evaluated, the result — including the conditions snapshot at that
              moment, whether it matched, and the track assigned — is stored in the evaluation log.
              This provides a complete, immutable record of why each transaction was routed the way it was.
            </P>
          </Sub>
          <Callout>
            Where to manage: <strong>Settings → Processing Rules</strong>.
            Accessible to Admin, CFO, Controller, and Finance Manager.
          </Callout>
        </Section>

        {/* ── APPROVAL WORKFLOWS ── */}
        <Section id="approval-workflows" title="Approval Workflows">
          <P>
            <strong>Approval Workflows</strong> define the human sign-off chain that applies once a
            processing track has been assigned. A workflow is triggered when a transaction falls within
            its configured scope.
          </P>
          <Sub title="Scope">
            <P>Each workflow is scoped by:</P>
            <DefList items={[
              { term: 'Amount range',      def: 'Minimum and optional maximum threshold (e.g. $10,000–$100,000).' },
              { term: 'Spend categories',  def: 'Blank means the workflow applies to all categories.' },
              { term: 'Departments',       def: 'Blank means all departments.' },
            ]} />
          </Sub>
          <Sub title="Approval steps">
            <P>
              Each workflow contains an ordered list of steps, each assigned to a role (e.g. Finance Manager,
              Controller, CFO). Steps are completed in sequence — the transaction cannot advance until the
              current approver acts.
            </P>
          </Sub>
          <Callout>
            Where to manage: <strong>Settings → Approval Workflows</strong>.
            Admin access only.
          </Callout>
        </Section>

        {/* ── ONBOARDING ── */}
        <Section id="onboarding" title="Onboarding Workflows">
          <P>
            <strong>Onboarding Workflows</strong> define the step-by-step process a new entity must go
            through before it is activated and able to receive payments. Different workflows can apply
            to different entity types — for example, a Fund Svc Provider may require more steps than a
            Contractor.
          </P>
          <Sub title="Step types">
            <DefList items={[
              { term: 'Information',     def: 'Collect or confirm data about the entity.' },
              { term: 'Document',        def: 'Obtain a signed document or certificate.' },
              { term: 'Review',          def: 'An internal review or sign-off.' },
              { term: 'Approval',        def: 'Formal approval by a designated role.' },
              { term: 'External Check',  def: 'A third-party verification (e.g. sanctions screen, credit check).' },
            ]} />
          </Sub>
          <Sub title="Parallel steps">
            <P>
              Steps can run <strong>sequentially</strong> (one after the other) or <strong>in parallel</strong>.
              Assign the same Parallel Group number to steps that can proceed simultaneously — for example,
              a legal review and a compliance check that do not depend on each other.
            </P>
          </Sub>
          <Sub title="Flags">
            <DefList items={[
              { term: 'Required',       def: 'Step must be completed before the workflow can advance.' },
              { term: 'Blocks Payment', def: 'Payments to this entity are blocked until this step is complete.' },
            ]} />
          </Sub>
          <Callout>
            Where to manage: <strong>Settings → Onboarding Workflows</strong>.
            Accessible to Admin, CFO, Controller, and Finance Manager.
          </Callout>
        </Section>

        {/* ── ACTIVITY LOG ── */}
        <Section id="activity-log" title="Activity Log & Audit Trail">
          <P>
            Every meaningful action taken on an entity is recorded in the <strong>Entity Activity Log</strong>.
            This is the primary audit trail for third-party relationship management.
          </P>
          <Sub title="What is logged">
            <DefList items={[
              { term: 'Entity changes',   def: 'Status updates, risk score changes, classification changes.' },
              { term: 'Review activity',  def: 'Third Party Reviews created, updated, or closed — including score changes and findings by domain.' },
              { term: 'Contract events',  def: 'New contracts, renewals, expirations.' },
              { term: 'Onboarding',       def: 'Step completions, approvals, and rejections.' },
              { term: 'Invoice events',   def: 'Invoice approval, rejection, and ERP export.' },
              { term: 'Payment events',   def: 'Payment instruction creation and execution.' },
            ]} />
          </Sub>
          <Sub title="Immutability">
            <P>
              Activity log entries are append-only — they are never edited or deleted. Each entry records
              the actor, timestamp, action type, and a human-readable description of what changed.
            </P>
          </Sub>
          <Sub title="Processing Rule Evaluations">
            <P>
              In addition to the entity activity log, the processing rules engine maintains its own
              evaluation log. Each entry snapshots the rule conditions at the time of evaluation, whether
              the rule matched, and which track was assigned. This log is separate from the entity activity
              log and exists to provide traceability for invoice routing decisions.
            </P>
          </Sub>
          <Callout>
            Where to find it: The <strong>History</strong> tab on each entity detail page and on Third
            Party Review detail pages.
          </Callout>
        </Section>

        {/* ── RECONCILIATION ── */}
        <Section id="reconciliation" title="Reconciliation">
          <P>
            <strong>Reconciliation</strong> addresses the question: does what the system has recorded as
            paid match what is reflected in the ERP and bank statements?
          </P>
          <Sub title="What reconciliation checks">
            <DefList items={[
              { term: 'Invoice ↔ PO',       def: 'Confirm every approved invoice references an authorised purchase order (where required by the processing track).' },
              { term: 'Invoice ↔ Contract',  def: 'Confirm spend is covered by a current, in-force contract.' },
              { term: 'Invoice ↔ ERP',       def: 'Confirm that invoices marked as exported are reflected in the ERP with matching reference numbers.' },
              { term: 'Vendor spend',        def: 'Compare actual payments to budgeted or contracted amounts per entity and period.' },
            ]} />
          </Sub>
          <Sub title="Vendor Spend Snapshots">
            <P>
              The system periodically snapshots cumulative spend per entity. These snapshots are used on
              the Reconciliation page to identify unexpected increases, over-spend against contract
              values, or entities receiving payments without active contracts.
            </P>
          </Sub>
          <Callout>
            Where to find it: <strong>Entities → Reconciliation</strong> in the main navigation.
          </Callout>
        </Section>

        {/* ── CONTROLS ── */}
        <Section id="controls" title="Controls & Audit Periods">
          <Sub title="Controls">
            <P>
              <strong>Controls</strong> are the formal checks the organisation runs to verify that key
              processes are operating correctly. Each control belongs to a domain and has a test frequency:
            </P>
            <DefList items={[
              { term: 'Access Control',       def: 'User permissions, role separation, authentication.' },
              { term: 'Change Management',    def: 'Approval and logging of system and process changes.' },
              { term: 'Financial Integrity',  def: 'Completeness and accuracy of financial records.' },
              { term: 'Vendor Risk',          def: 'Third-party due diligence and review cadence.' },
              { term: 'BC/DR',                def: 'Business continuity and disaster recovery readiness.' },
              { term: 'Monitoring',           def: 'Ongoing surveillance of signals, anomalies, and SLA breaches.' },
            ]} />
            <P>
              Controls are mapped to <strong>SOX</strong> requirements and <strong>SOC 2 criteria</strong>
              where applicable. Each control records the last test result (Pass / Fail / Warning) with a
              summary and the tester&apos;s identity.
            </P>
          </Sub>
          <Sub title="Audit Periods">
            <P>
              An <strong>Audit Period</strong> is a defined time window (typically a fiscal year or quarter)
              over which a formal audit is conducted. Linking controls to an audit period creates a snapshot
              of control test results and findings that can be provided to auditors. Periods have a status
              (Planning → In Progress → Review → Closed) and a designated lead auditor.
            </P>
          </Sub>
          <Callout>
            Where to find it: <strong>Controls</strong> and <strong>Audit Periods</strong> in the main navigation.
            Accessible to Admin, CFO, Controller, and Auditor.
          </Callout>
        </Section>

        {/* ── SETTINGS ── */}
        <Section id="settings" title="Settings Reference">
          <P>
            The following settings pages allow authorised users to configure the application&apos;s rules and
            reference data. Changes take effect immediately for all new transactions; existing records
            are not retroactively updated.
          </P>
          <DefList items={[
            {
              term: 'Service Catalogue',
              def: 'Define the types of services your organisation procures (e.g. Fund Administration, Audit). Used when creating Service Engagements. Accessible to Admin, CFO, Controller, Finance Manager.',
            },
            {
              term: 'Onboarding Workflows',
              def: 'Define step-by-step onboarding sequences by entity type, including sequential and parallel steps, required steps, and payment-blocking steps. Accessible to Admin, CFO, Controller, Finance Manager.',
            },
            {
              term: 'Processing Rules',
              def: 'Configure the conditions and priority order that route invoices and POs to a processing track (Full PO, Lightweight, STP, Contract Required). All rule evaluations are logged. Accessible to Admin, CFO, Controller, Finance Manager.',
            },
            {
              term: 'Approval Workflows',
              def: 'Define approval chains by amount threshold, spend category, and department. Each workflow specifies an ordered list of approver roles. Admin only.',
            },
            {
              term: 'External Signals',
              def: 'View live market signals for entities that have a stock ticker configured. Monitoring is automatic — no separate configuration is needed. Accessible to Admin, CFO, Controller, Finance Manager.',
            },
          ]} />
          <Sub title="Role reference">
            <DefList items={[
              { term: 'Admin',            def: 'Full access to all settings and data.' },
              { term: 'CFO',              def: 'Access to all financial data and most settings.' },
              { term: 'Controller',       def: 'Access to AP workflows, controls, and settings.' },
              { term: 'Finance Manager',  def: 'Access to invoices, POs, entities, and read-only settings.' },
              { term: 'AP Clerk',         def: 'Creates and processes invoices and POs.' },
              { term: 'Legal',            def: 'Read access to entities, contracts, and reviews.' },
              { term: 'CISO',             def: 'Read access to entities and third-party reviews.' },
              { term: 'Auditor',          def: 'Read-only access to controls, audit periods, and activity logs.' },
            ]} />
          </Sub>
        </Section>

      </main>
    </div>
  )
}

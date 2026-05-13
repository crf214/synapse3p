-- H4: Add composite indexes for hot query paths
-- WorkflowStepInstance: status filter within a workflow instance
CREATE INDEX "workflow_step_instances_workflowInstanceId_status_idx"
  ON "workflow_step_instances" ("workflowInstanceId", "status");

-- WorkflowInstance: org-scoped object lookup with status filter
CREATE INDEX "workflow_instances_orgId_targetObjectType_targetObjectId_status_idx"
  ON "workflow_instances" ("orgId", "targetObjectType", "targetObjectId", "status");

-- InvoiceApproval: composite for the pending-approvals queue (assignee + org + status)
CREATE INDEX "invoice_approvals_assignedTo_orgId_status_idx"
  ON "invoice_approvals" ("assignedTo", "orgId", "status");

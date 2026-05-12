-- Phase 4E: Remove dead schema models
-- ProcessingRuleEvaluation — never read; intended write path in PO route was never implemented.
-- ReportSnapshot — caching layer replaced with direct queries; snapshot writes were unreliable.

DROP TABLE IF EXISTS "processing_rule_evaluations";
DROP TABLE IF EXISTS "report_snapshots";

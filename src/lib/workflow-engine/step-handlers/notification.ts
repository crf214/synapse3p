import type { StepResult } from '../types'

// Config shape: { message: string, recipients: string[] }
// TODO: integrate real email sending (e.g. Resend) when notification service is wired up
export async function handleNotificationStep(
  _stepInstanceId: string,
  config: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<StepResult> {
  const message    = typeof config.message    === 'string' ? config.message    : '(no message)'
  const recipients = Array.isArray(config.recipients)     ? config.recipients : []

  // For now: log the notification — no email sending yet
  console.log('[WorkflowEngine:notification]', {
    message,
    recipients,
    context,
  })

  return {
    status: 'COMPLETED',
    result: 'PASS',
    metadata: { message, recipients },
  }
}
